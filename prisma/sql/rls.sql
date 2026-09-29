-- Norte — isolamento no banco (a segunda parede)
--
-- A primeira parede é a aplicação: todo acesso passa por um cliente já preso
-- a uma Org. Esta aqui existe para o dia em que a primeira falhar — uma
-- consulta esquecida, um join errado, um endpoint novo sem filtro.
--
-- Como funciona: a cada requisição a aplicação executa
--     SELECT set_config('app.org_id', '<id da org>', true);
-- e a partir daí o Postgres se recusa a devolver linha de outra Org.
-- O 'true' faz valer só dentro da transação — não vaza entre requisições.
--
-- Rodar DEPOIS de `prisma migrate`.

-- ── quem é a org da requisição ────────────────────────────────
--
-- Esta função é o pino que segura o isolamento inteiro: TODA política aqui
-- embaixo pergunta a ela de que empresa é a requisição. Por isso ela leva duas
-- proteções que uma função comum não precisaria.
--
-- 1. `set search_path` FIXO. Sem isso, quem chamasse a função poderia pôr um
--    schema próprio na frente do caminho de busca e fazer o Postgres resolver
--    outro `nullif`, outro `current_setting` — e a resposta viria de código
--    que não é este.
--
-- 2. As políticas chamam `public.app_org_id()`, com o schema escrito. Uma
--    política que chama `public.app_org_id()` solto resolve o nome pelo caminho de
--    busca de QUEM está consultando: bastaria uma função com esse nome num
--    schema à frente para a política inteira passar a perguntar a ela de que
--    empresa é a requisição — e receber a resposta que o atacante quisesse.
--
-- Hoje isso não é alcançável: medido em produção, o papel da aplicação não
-- pode criar objeto em `public` nem criar schema nenhum. Mas essa porta está
-- fechada por um GRANT continuar certo para sempre, e um `grant create on
-- schema public` acidental — de uma migração, de uma ferramenta — reabriria
-- ela em silêncio. Fechar por construção custa duas linhas.
create or replace function public.app_org_id() returns text
language sql stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.org_id', true), '')
$$;

-- ── liga RLS em toda tabela com org_id ───────────────────────
-- Faz por varredura, não na mão: tabela nova entra sozinha quando
-- este arquivo rodar de novo. É o que impede o esquecimento.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attname = 'org_id'
      and not a.attisdropped
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('alter table public.%I force row level security', t.relname);

    execute format('drop policy if exists org_isolada on public.%I', t.relname);
    execute format($f$
      create policy org_isolada on public.%I
        using (org_id = public.app_org_id())
        with check (org_id = public.app_org_id())
    $f$, t.relname);
  end loop;
end $$;

-- ── chave estrangeira não atravessa empresa ──────────────────
--
-- O furo que o RLS não fecha: a conferência de chave estrangeira do Postgres
-- roda por cima do RLS. Código rodando como a empresa A consegue gravar
-- `vendas.cliente_id` apontando para um cliente da B — o FK só pergunta "o id
-- existe?", e existe. A venda nasce da A, com o nome e o telefone de um
-- cliente da B pendurados nela; o crediário da A cobra parcela de gente da B.
--
-- Até aqui isso era fechado ação por ação, conferindo antes de gravar. Uma
-- ação esquecida reabria. Agora é o banco que recusa: toda FK entre duas
-- tabelas que carregam org_id exige que a linha apontada seja da MESMA
-- empresa da linha que aponta.
--
-- Como:
--   • UMA função genérica, e UM gatilho por tabela filha. A lista de
--     (coluna, tabela pai) vai nos argumentos do gatilho, e vem do catálogo
--     (pg_constraint), não de uma lista escrita à mão: relação nova entra
--     sozinha quando este arquivo rodar de novo — o mesmo princípio do RLS
--     acima.
--   • Compara org_id explicitamente. Não basta "o pai é visível": para o
--     papel da aplicação o pai de outra empresa é invisível (daria certo por
--     acaso), mas o admin e os scripts passam por cima do RLS e veriam tudo.
--     A comparação vale para qualquer papel. Por isso também não precisa de
--     SECURITY DEFINER.
--   • Lê NEW por to_jsonb, e não com `UPDATE OF coluna`: gatilho com lista
--     de colunas cria dependência nelas, e aí uma migração que apaga ou muda o
--     tipo de uma coluna de FK falharia com "other objects depend on it".
--     No UPDATE, só confere quando a FK ou o org_id mudaram.
--   • Recusa com o código de FK violada (23503): para a empresa A, a linha da
--     B simplesmente não existe — mesma resposta de id inexistente, e a porta
--     não serve para descobrir se um id é de alguém.
--   • Custo: uma busca pela chave primária do pai por FK preenchida, no
--     INSERT; no UPDATE, só quando a FK muda.
--
-- Não confere linhas que já existiam (gatilho não olha para trás). Para
-- procurar sobra antiga, a consulta está no fim deste arquivo.
create or replace function public.fk_mesma_empresa() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  novo  jsonb := to_jsonb(NEW);
  velho jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) end;
  i     int := 0;
  coluna text; pai text; chave text; tipo text; restricao text;
  alvo  text;
  achou boolean;
begin
  -- argumentos em quíntuplas: coluna, tabela pai, coluna do pai, tipo, nome da FK
  while i + 4 < TG_NARGS loop
    coluna    := TG_ARGV[i];
    pai       := TG_ARGV[i + 1];
    chave     := TG_ARGV[i + 2];
    tipo      := TG_ARGV[i + 3];
    restricao := TG_ARGV[i + 4];
    i := i + 5;

    alvo := novo ->> coluna;
    continue when alvo is null;
    continue when TG_OP = 'UPDATE'
      and alvo is not distinct from (velho ->> coluna)
      and (novo ->> 'org_id') is not distinct from (velho ->> 'org_id');

    execute format(
      'select exists (select 1 from public.%I where %I = $1::%s and org_id = $2)',
      pai, chave, tipo
    ) into achou using alvo, novo ->> 'org_id';

    if not achou then
      raise exception 'referencia de outra empresa'
        using errcode = 'foreign_key_violation',
              detail = format('%s.%s -> %s', TG_TABLE_NAME, coluna, pai),
              schema = TG_TABLE_SCHEMA,
              table = TG_TABLE_NAME,
              column = coluna,
              constraint = restricao;
    end if;
  end loop;
  return NEW;
end $$;

do $$
declare
  t record;
begin
  -- Some antes de nascer de novo: tabela que perdeu a última FK entre
  -- empresas não pode ficar com gatilho velho.
  for t in
    select c.relname
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and g.tgname = 'zz_fk_mesma_empresa'
  loop
    execute format('drop trigger if exists zz_fk_mesma_empresa on public.%I', t.relname);
  end loop;

  -- Toda FK de uma coluna só, entre duas tabelas de public que têm org_id.
  -- `orgs` fica de fora sozinha: ela não tem org_id (é a própria empresa).
  for t in
    select filha.relname as tabela,
           string_agg(
             format('%L, %L, %L, %L, %L', fcol.attname, pai.relname, pcol.attname,
                    format_type(pcol.atttypid, pcol.atttypmod), k.conname),
             ', ' order by k.conname
           ) as args
    from pg_constraint k
    join pg_class filha on filha.oid = k.conrelid
    join pg_namespace nf on nf.oid = filha.relnamespace and nf.nspname = 'public'
    join pg_class pai on pai.oid = k.confrelid
    join pg_namespace np on np.oid = pai.relnamespace and np.nspname = 'public'
    join pg_attribute fcol on fcol.attrelid = k.conrelid and fcol.attnum = k.conkey[1]
    join pg_attribute pcol on pcol.attrelid = k.confrelid and pcol.attnum = k.confkey[1]
    where k.contype = 'f'
      and cardinality(k.conkey) = 1
      and fcol.attname <> 'org_id'
      and exists (select 1 from pg_attribute a where a.attrelid = filha.oid and a.attname = 'org_id' and not a.attisdropped)
      and exists (select 1 from pg_attribute a where a.attrelid = pai.oid and a.attname = 'org_id' and not a.attisdropped)
    group by filha.relname
  loop
    execute format(
      'create trigger zz_fk_mesma_empresa before insert or update on public.%I
         for each row execute function public.fk_mesma_empresa(%s)',
      t.tabela, t.args
    );
  end loop;
end $$;

-- ── a sessão do WhatsApp por QR Code (sessoes_whatsapp) ──────
-- Entra na varredura acima como qualquer tabela com org_id: org_isolada,
-- RLS ligado e forçado. Não ganha política especial, e é de propósito: quem a
-- lê e grava é a API interna do conector (src/app/api/whatsapp-proprio), SEMPRE
-- dentro do comoOrg da empresa do endereço — a assinatura HMAC diz que o
-- pedido veio do conector, e o RLS garante que ele só enxerga a sessão
-- daquela empresa. O conteúdo ainda vai cifrado com a empresa no contexto:
-- copiada para a linha de outra empresa, a sessão não abre.

-- ── campanhas (campanhas, campanha_execucoes, campanha_passos,
--    campanha_ajustes, midias) ─────────────────────────────────
-- Todas têm org_id e entram na varredura do começo: org_isolada, RLS ligado e
-- forçado. As FKs entre elas (execução → campanha, passo → execução e →
-- campanha) têm org_id dos dois lados, e o gatilho zz_fk_mesma_empresa acima
-- as descobre sozinho no catálogo: um passo não aponta para execução de outra
-- empresa. Nenhuma política especial, e é de propósito: até a entrega da
-- mídia ao fornecedor do WhatsApp (/api/midia, sem sessão) lê dentro do
-- comoOrg da empresa que está ASSINADA no endereço — a assinatura prova de
-- quem é o pedido; o RLS garante que só aquela empresa é lida.

-- ── a confirmação do telefone (confirmacoes_telefone) ────────
-- Tem org_id e entra na varredura do começo: org_isolada, RLS ligado e
-- forçado. A FK para usuarios tem org_id dos dois lados, e o gatilho
-- zz_fk_mesma_empresa a descobre sozinho: um código não nasce apontando para
-- a conta de outra empresa. O "CONFIRMAR 123456" que chega pelo WhatsApp é
-- procurado DENTRO do comoOrg da empresa dona do número que recebeu — nunca
-- entre empresas —, e a linha guarda só o resumo do código (HMAC com segredo
-- do servidor), nunca o código.

-- ── a tabela orgs se filtra pelo próprio id ──────────────────
alter table public.orgs enable row level security;
alter table public.orgs force row level security;
drop policy if exists org_propria on public.orgs;
create policy org_propria on public.orgs
  using (id = public.app_org_id())
  with check (id = public.app_org_id());

-- ── a portaria: quem responde "de quem é este endereço" ─────
--
-- Existe UMA leitura que acontece legitimamente antes de existir empresa no
-- contexto: descobrir de que empresa é o endereço acessado, para a tela de
-- login saber que nome e que cor mostrar. É o ovo e a galinha do multi-empresa.
--
-- Antes isso era feito com a credencial de ADMIN — que no Postgres do Supabase
-- tem BYPASSRLS, ou seja, passa por cima de toda política de toda tabela. Uma
-- credencial que lê o banco inteiro, no ambiente de produção, usada a cada
-- login, para responder uma pergunta de portaria.
--
-- Agora quem responde é um papel que só sabe isso. A política abaixo deixa ele
-- LER linha de orgs; o que limita o estrago é o GRANT por COLUNA, feito no
-- preparar-banco.ts: ele enxerga nome, slug, logo e cor, e mais nada — nem
-- documento, nem telefone, nem crédito, nem os limites do assistente.
--
-- Sobra: ele consegue enumerar empresas. Para fechar também isso, o caminho é
-- trocar a consulta por uma função SECURITY DEFINER que recebe o slug e não
-- deixa listar. Fica anotado; o ganho aqui já é sair de "lê tudo" para "lê a
-- fachada".
drop policy if exists org_portaria on public.orgs;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_portaria') then
    create policy org_portaria on public.orgs
      for select to app_portaria
      using (true);
  end if;
end $$;

-- ── a portaria do WhatsApp oficial: "de quem é este número?" ─
--
-- O webhook da Meta (Cloud API) chega sem empresa no endereço: é UM endereço
-- para todas as lojas, e o que diz de quem é a mensagem é o id do número que
-- a recebeu (`metadata.phone_number_id`). Descobrir a empresa por ele é uma
-- leitura que atravessa empresas — a mesma família da portaria de cima.
--
-- Aqui já vai do jeito que o comentário de cima pede para o futuro: em vez de
-- dar ao papel da portaria leitura na tabela `agentes` (ele passaria a poder
-- LISTAR os números de todo mundo), uma função SECURITY DEFINER que recebe o
-- id EXATO e devolve só id e slug da empresa. Não lista, não aceita curinga,
-- não devolve nada do agente. Quem pode chamar: só `app_portaria`. O
-- `app_norte` continua sem nenhuma leitura entre empresas.
--
-- Roda com os direitos do dono da função (quem aplica este arquivo: o admin,
-- que passa por cima do RLS). Se um dia o dono não passar, ela devolve vazio —
-- falha fechada: o webhook responde 200 e descarta.
--
-- plpgsql, e não sql: o corpo só é conferido na hora de rodar, então este
-- arquivo pode ser aplicado antes da migração que cria a coluna sem quebrar.
-- drop antes: `create or replace` não troca nome de parâmetro. E o parâmetro
-- não se chama "numero" porque `agentes` tem uma coluna com esse nome, e o
-- plpgsql não saberia qual das duas é qual.
drop function if exists public.org_do_numero_meta(text);
create function public.org_do_numero_meta(id_do_numero text)
returns table (org_id text, org_slug text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  -- id de número da Meta é só dígito; qualquer outra coisa nem consulta
  if id_do_numero is null or id_do_numero !~ '^[0-9]{1,32}$' then
    return;
  end if;
  return query
    select o.id::text, o.slug::text
      from public.agentes a
      join public.orgs o on o.id = a.org_id
     where a.meta_phone_number_id = id_do_numero
     limit 1;
end $$;

revoke all on function public.org_do_numero_meta(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_portaria') then
    grant execute on function public.org_do_numero_meta(text) to app_portaria;
  end if;
end $$;

-- ── a terceira pergunta de portaria: "crie esta empresa" ─────
--
-- O cadastro pelo site (/cadastro) cria uma empresa que ainda não existe —
-- e por isso não cabe no `comoOrg`, que só enxerga UMA empresa que já
-- existe. A saída fácil seria a credencial de admin, e ela é justamente o
-- que a aplicação nunca pode ter (passa por cima de todo RLS). O script de
-- operador (scripts/criar-empresa.ts) usa admin porque roda na máquina de
-- quem vende; o site roda na internet.
--
-- Então: uma função SECURITY DEFINER, no mesmo molde de org_do_numero_meta.
-- Só a portaria chama. Ela faz UMA coisa, inteira ou nada (é uma transação):
-- a empresa (plano Grátis), a primeira loja, a conta do dono com acesso de
-- DONO e a linha do livro. E não confia em quem chama:
--
--   • confere cada campo de novo (tamanho, formato, caractere de controle);
--   • recebe a senha JÁ em hash scrypt — a senha nunca chega ao banco, e um
--     texto que não tem a forma de hash é recusado;
--   • escolhe o endereço ela mesma, a partir da sugestão: pula os
--     reservados (a mesma lista de src/servidor/enderecos.ts, conferida
--     pelo teste) e os ocupados, acrescentando "-2", "-3"...;
--   • não recebe id nenhum: não há como mandar ela escrever numa empresa
--     que já existe;
--   • tem o próprio freio: 3 empresas por hora por endereço de rede (o
--     resumo SHA-256 do IP, não o IP) e 60 por hora no total, com trava do
--     Postgres para duas chamadas simultâneas não passarem juntas.
--
-- As tabelas das empresas têm RLS forçado; a função carimba a empresa nova
-- (`app.org_id`, só nesta transação) antes de gravar, então as políticas
-- aceitam mesmo que o dono da função um dia deixe de passar por cima delas.
--
-- A tabela do freio (cadastros_publicos) não tem org_id, e é trancada logo
-- abaixo: nem a aplicação nem a portaria leem ou escrevem nela.
do $$
declare r record;
begin
  -- antes da migração que a cria, não há o que trancar
  if to_regclass('public.cadastros_publicos') is null then
    return;
  end if;
  -- RLS ligado e SEM política: quem não é dono não enxerga linha nenhuma.
  -- Não é forçado — o dono (quem aplica este arquivo, e com os direitos de
  -- quem a função roda) precisa ler e gravar aqui.
  alter table public.cadastros_publicos enable row level security;
  for r in select rolname from pg_roles where rolname in ('app_norte', 'app_portaria') loop
    execute format('revoke all on public.cadastros_publicos from %I', r.rolname);
  end loop;
end $$;

drop function if exists public.criar_empresa_cadastro(text, text, text, text, text, text, text, boolean, text);
create function public.criar_empresa_cadastro(
  p_nome text,
  p_endereco text,
  p_dono text,
  p_email text,
  p_senha_hash text,
  p_ramo text,
  p_ip text,
  p_email_pendente boolean,
  p_termos text
)
returns table (r_org text, r_usuario text, r_endereco text, r_recusa text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  -- A MESMA lista de src/servidor/enderecos.ts (o teste confere).
  reservados text[] := array[
    'fontes', 'img', 'video', 'arte', 'marca', 'saude', 'exclusao-de-dados', '_next', 'api',
    'static', 'termos', 'privacidade', 'contrato', 'planos', 'precos', 'ajuda', 'suporte',
    'sobre', 'contato', 'blog', 'status', 'seguranca', 'lgpd', 'admin', 'app', 'painel',
    'entrar', 'sair', 'conta', 'assinatura', 'convite', 'cadastro', 'cadastrar', 'criar',
    'nova', 'novo', 'norte', 'www', 'mail', 'email', 'redefinir-senha', 'confirmar-email',
    'esqueci-a-senha', 'comecar', 'login'
  ];
  v_nome text := btrim(p_nome);
  v_dono text := btrim(p_dono);
  v_email text := lower(btrim(p_email));
  v_base text := lower(btrim(p_endereco));
  v_ramo text := btrim(p_ramo);
  v_ip text := encode(sha256(convert_to(coalesce(nullif(btrim(p_ip), ''), '-'), 'UTF8')), 'hex');
  -- As colunas são timestamp sem fuso, gravadas em UTC pelo Prisma.
  v_agora timestamp := now() at time zone 'utc';
  v_org text := replace(gen_random_uuid()::text, '-', '');
  v_usuario text := replace(gen_random_uuid()::text, '-', '');
  v_candidato text;
  v_sufixo text;
  v_criou boolean := false;
  n integer;
begin
  -- ── a entrada, conferida de novo ──
  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 80 or v_nome ~ '[[:cntrl:]]' then
    raise exception 'cadastro: nome da empresa inválido' using errcode = '22023';
  end if;
  if v_dono is null or length(v_dono) < 2 or length(v_dono) > 80 or v_dono ~ '[[:cntrl:]]' then
    raise exception 'cadastro: nome do dono inválido' using errcode = '22023';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'cadastro: e-mail inválido' using errcode = '22023';
  end if;
  if p_senha_hash is null or length(p_senha_hash) > 300
     or p_senha_hash !~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$' then
    raise exception 'cadastro: senha sem a forma de hash' using errcode = '22023';
  end if;
  if v_ramo is null or v_ramo !~ '^[a-z]{2,24}$' then
    raise exception 'cadastro: ramo inválido' using errcode = '22023';
  end if;
  if v_base is null or length(v_base) < 3 or length(v_base) > 40 or v_base !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' then
    raise exception 'cadastro: endereço inválido' using errcode = '22023';
  end if;
  if p_termos is null or length(btrim(p_termos)) < 1 or length(p_termos) > 60 then
    raise exception 'cadastro: versão dos termos inválida' using errcode = '22023';
  end if;
  if p_ip is not null and length(p_ip) > 100 then
    raise exception 'cadastro: endereço de rede inválido' using errcode = '22023';
  end if;
  if p_email_pendente is null then
    raise exception 'cadastro: falta dizer se o e-mail precisa de confirmação' using errcode = '22023';
  end if;

  -- ── o freio ──
  -- Trava por endereço de rede e depois a geral, sempre nessa ordem.
  perform pg_advisory_xact_lock(hashtext('cadastro:ip:' || v_ip));
  select count(*) into n from public.cadastros_publicos c
   where c.ip_resumo = v_ip and c.criado_em > v_agora - interval '1 hour';
  if n >= 3 then
    return query select null::text, null::text, null::text, 'muitas_tentativas'::text;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('cadastro:geral'));
  select count(*) into n from public.cadastros_publicos c
   where c.criado_em > v_agora - interval '1 hour';
  if n >= 60 then
    return query select null::text, null::text, null::text, 'muitas_no_geral'::text;
    return;
  end if;

  -- ── o endereço ──
  perform set_config('app.org_id', v_org, true);
  for i in 1..30 loop
    if i = 1 then
      v_candidato := v_base;
    else
      v_sufixo := '-' || case when i <= 20 then i::text else substr(md5(random()::text), 1, 5) end;
      v_candidato := rtrim(left(v_base, 40 - length(v_sufixo)), '-') || v_sufixo;
    end if;
    continue when v_candidato = any(reservados);
    continue when exists (select 1 from public.orgs o where o.slug = v_candidato);
    begin
      insert into public.orgs (id, nome, slug, email, ramo, plano, situacao, modulos, criada_em, atualizada_em)
      values (v_org, v_nome, v_candidato, v_email, v_ramo, 'GRATIS', 'ATIVA', '{}', v_agora, v_agora);
      v_criou := true;
    exception when unique_violation then
      -- outra pessoa levou este endereço no mesmo instante: tenta o próximo
      v_criou := false;
    end;
    exit when v_criou;
  end loop;
  if not v_criou then
    raise exception 'cadastro: nenhum endereço livre' using errcode = '22023';
  end if;

  -- ── a loja, a pessoa, o acesso e o livro ──
  insert into public.unidades (id, org_id, nome, ramo, criada_em, atualizada_em)
  values (replace(gen_random_uuid()::text, '-', ''), v_org, v_nome, v_ramo, v_agora, v_agora);

  insert into public.usuarios (id, org_id, nome, email, senha_hash, ativo, email_pendente, sessoes_desde, criado_em, atualizado_em)
  values (v_usuario, v_org, v_dono, v_email, p_senha_hash, true, p_email_pendente, v_agora, v_agora, v_agora);

  insert into public.acessos (id, org_id, usuario_id, unidade_id, papel, criado_em)
  values (replace(gen_random_uuid()::text, '-', ''), v_org, v_usuario, null, 'DONO', v_agora);

  insert into public.auditoria (id, org_id, usuario_id, quem, autor, acao, alvo_tipo, alvo_id, alvo_nome, depois, criado_em)
  values (
    replace(gen_random_uuid()::text, '-', ''), v_org, v_usuario, v_dono, 'PESSOA', 'empresa.criou', 'org', v_org, v_nome,
    jsonb_build_object('origem', 'cadastro', 'plano', 'GRATIS', 'ramo', v_ramo,
                       'termos', btrim(p_termos), 'emailConfirmado', not p_email_pendente),
    v_agora
  );

  insert into public.cadastros_publicos (id, ip_resumo, criado_em)
  values (replace(gen_random_uuid()::text, '-', ''), v_ip, v_agora);
  -- a limpeza vai de carona: linha de anteontem não freia ninguém
  delete from public.cadastros_publicos c where c.criado_em < v_agora - interval '2 days';

  return query select v_org, v_usuario, v_candidato, null::text;
end $fn$;

revoke all on function public.criar_empresa_cadastro(text, text, text, text, text, text, text, boolean, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_portaria') then
    grant execute on function public.criar_empresa_cadastro(text, text, text, text, text, text, text, boolean, text) to app_portaria;
  end if;
end $$;

-- ── auditoria é livro: só entra, nunca muda nem sai ──────────
drop policy if exists org_isolada on public.auditoria;

-- drop antes de criar: este arquivo precisa poder rodar de novo, e roda toda
-- vez que nasce tabela nova (é assim que ela entra na proteção sozinha).
drop policy if exists auditoria_le on public.auditoria;
create policy auditoria_le on public.auditoria
  for select using (org_id = public.app_org_id());

drop policy if exists auditoria_grava on public.auditoria;
create policy auditoria_grava on public.auditoria
  for insert with check (org_id = public.app_org_id());

-- sem policy de UPDATE e sem policy de DELETE: com FORCE RLS ligado,
-- a ausência da policy é a proibição. Nem o dono da tabela reescreve.
--
-- MAS só isso é silencioso demais: sem policy, o Postgres não levanta erro —
-- ele apenas não enxerga a linha, e o UPDATE volta "0 linhas afetadas".
-- Um bug tentando reescrever o livro passaria despercebido.
-- Tirando também a permissão, a tentativa estoura na hora e aparece no log.
do $$
declare r record;
begin
  for r in
    select distinct grantee
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'auditoria'
      and privilege_type in ('UPDATE', 'DELETE')
      and grantee <> current_user
  loop
    execute format('revoke update, delete on public.auditoria from %I', r.grantee);
  end loop;
end $$;

-- Reaplicar este arquivo depois de qualquer GRANT novo — o revoke acima
-- desfaz permissão concedida em bloco ("grant all on all tables").

-- ── a única exceção ao livro imutável: apagar o DADO PESSOAL ─
--
-- A LGPD dá ao cliente da loja o direito de ser anonimizado (art. 18, IV e
-- VI), e o livro guarda dado pessoal dele: o nome no "alvo" de "cadastrou um
-- cliente", o telefone no `antes` de "alterou um cliente", o nome no
-- "Maria: bolo de chocolate" da encomenda. Um livro que ninguém pode tocar
-- tornaria a anonimização uma mentira.
--
-- Então existe UM caminho, estreito, e só ele. Esta função:
--   • só mexe em linhas da empresa da requisição (app_org_id(), a mesma do
--     RLS) e só nas dos alvos que recebeu (o cliente, as encomendas e os
--     lançamentos dele — quem escolhe é src/servidor/cliente.ts);
--   • só faz duas coisas: troca o nome da pessoa pela frase fixa "Cliente
--     anonimizado" (em alvo_nome e motivo) e tira do `antes`/`depois` as
--     chaves de dado pessoal. Não muda ação, quem fez, valor, data nem loja —
--     o livro continua dizendo O QUE aconteceu, só não diz mais COM QUEM;
--   • não apaga linha nenhuma, e não consegue escrever texto livre.
--
-- O papel da aplicação continua sem UPDATE e sem DELETE no livro (o revoke
-- de cima). Quem escreve aqui é a função, com os direitos do dono dela (o
-- admin que aplica este arquivo, que passa por cima do RLS); se um dia o dono
-- não passar, o UPDATE não acha linha e a anonimização da ficha segue — o
-- teste (tests/lgpd-banco.test.ts) é quem pega.
drop function if exists public.anonimizar_auditoria(text[], text);
create function public.anonimizar_auditoria(alvos text[], nome text)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  org text := public.app_org_id();
  pii text[] := array['nome', 'telefone', 'clienteNome', 'documento', 'cpf', 'email',
                      'endereco', 'bairro', 'cep', 'nascimento', 'observacoes', 'envio'];
  -- Nome curto demais trocaria pedaço de palavra ("Ana" em "Banana"): só o
  -- alvo 'cliente' perde o nome inteiro, os outros só com nome de 3+ letras.
  troca text := case when length(coalesce(nome, '')) >= 3 then nome end;
  n integer;
begin
  if org is null or alvos is null or cardinality(alvos) = 0 then
    return 0;
  end if;
  update public.auditoria a
     set alvo_nome = case
                       when a.alvo_tipo = 'cliente' then 'Cliente anonimizado'
                       when troca is not null then replace(a.alvo_nome, troca, 'Cliente anonimizado')
                       else a.alvo_nome
                     end,
         motivo = case when troca is not null then replace(a.motivo, troca, 'Cliente anonimizado') else a.motivo end,
         antes  = case when jsonb_typeof(a.antes)  = 'object' then a.antes  - pii else a.antes  end,
         depois = case when jsonb_typeof(a.depois) = 'object' then a.depois - pii else a.depois end
   where a.org_id = org
     and a.alvo_id = any(alvos)
     -- a linha que registra a própria anonimização não tem dado pessoal, e
     -- não é reescrita
     and a.acao <> 'cliente.anonimizou';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.anonimizar_auditoria(text[], text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_norte') then
    grant execute on function public.anonimizar_auditoria(text[], text) to app_norte;
  end if;
end $$;

-- ── a lista de quem não recebe oferta (optout_whatsapp) ──────
-- Tem org_id e entra na varredura do começo: org_isolada, RLS ligado e
-- forçado — a lista de uma loja não diz a outra quem pediu para sair. A
-- leitura acontece no caminho da mensagem que chega (campanhas/entrada.ts),
-- SEMPRE dentro do comoOrg da empresa dona do número. Nenhuma política
-- especial, e nenhuma função que atravesse empresas: "PARAR" para a loja A
-- não tira a pessoa da loja B, porque o consentimento é dado a cada loja.

-- ── atendimento (colaboradores, registros_ponto, agendamentos,
--    fornecedores, pedidos_compra, itens_compra, recebimentos_compra) ──
-- Todas têm org_id e entram na varredura do começo: org_isolada, RLS ligado
-- e forçado — a agenda do salão A não aparece para o salão B, nem o ponto,
-- nem o custo do que ele compra. As FKs entre elas (horário → colaborador,
-- horário → cliente, horário → serviço, item → pedido, item → variação) têm
-- org_id dos dois lados, e o gatilho zz_fk_mesma_empresa as descobre sozinho:
-- ninguém marca horário com a profissional de outra empresa.
--
-- Duas regras a mais, que o RLS sozinho não dá:

-- 1. PONTO NÃO SE APAGA E NÃO SE REESCREVE.
--
-- A batida de ponto é prova — para a empresa e para quem trabalha. Errou? A
-- correção é uma batida nova de AJUSTE, com motivo, ou a anulação da errada,
-- também com motivo; a linha original continua lá. Então:
--   • sem política de DELETE (com FORCE RLS, ausência é proibição) e sem a
--     permissão de DELETE, para a tentativa estourar em vez de passar calada
--     — o mesmo desenho do livro de auditoria;
--   • UPDATE só existe para ANULAR: o gatilho recusa qualquer mudança que não
--     seja carimbar anulado_em, anulado_por e o motivo, uma vez só.
drop policy if exists org_isolada on public.registros_ponto;
drop policy if exists ponto_le on public.registros_ponto;
create policy ponto_le on public.registros_ponto
  for select using (org_id = public.app_org_id());
drop policy if exists ponto_grava on public.registros_ponto;
create policy ponto_grava on public.registros_ponto
  for insert with check (org_id = public.app_org_id());
drop policy if exists ponto_anula on public.registros_ponto;
create policy ponto_anula on public.registros_ponto
  for update using (org_id = public.app_org_id()) with check (org_id = public.app_org_id());

do $$
declare r record;
begin
  for r in
    select distinct grantee
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'registros_ponto'
      and privilege_type = 'DELETE'
      and grantee <> current_user
  loop
    execute format('revoke delete on public.registros_ponto from %I', r.grantee);
  end loop;
end $$;

create or replace function public.ponto_so_anula() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  anulacao text[] := array['anulado_em', 'anulado_por', 'motivo_anulacao'];
begin
  if OLD.anulado_em is not null then
    raise exception 'batida de ponto anulada não muda mais'
      using errcode = 'check_violation', constraint = 'registros_ponto_so_anula';
  end if;
  if NEW.anulado_em is null or NEW.anulado_por is null or coalesce(btrim(NEW.motivo_anulacao), '') = '' then
    raise exception 'batida de ponto só muda para ser anulada, com motivo'
      using errcode = 'check_violation', constraint = 'registros_ponto_so_anula';
  end if;
  if (to_jsonb(NEW) - anulacao) is distinct from (to_jsonb(OLD) - anulacao) then
    raise exception 'batida de ponto não se reescreve: anule e registre outra'
      using errcode = 'check_violation', constraint = 'registros_ponto_so_anula';
  end if;
  return NEW;
end $$;

do $$
begin
  -- antes da migração que cria a tabela, não há onde pendurar o gatilho
  if to_regclass('public.registros_ponto') is null then
    return;
  end if;
  drop trigger if exists ponto_so_anula on public.registros_ponto;
  create trigger ponto_so_anula before update on public.registros_ponto
    for each row execute function public.ponto_so_anula();
end $$;

-- 2. A MESMA PROFISSIONAL NÃO ATENDE DUAS PESSOAS NA MESMA HORA.
--
-- A agenda confere antes de gravar, com uma trava por profissional
-- (src/servidor/agenda.ts). Esta é a garantia do banco, para quem grava por
-- fora dela (script, rotina, bug): um horário vivo (marcado, confirmado ou
-- atendido) que encosta em outro vivo da mesma profissional é recusado.
--
-- Por que gatilho e não EXCLUDE: a restrição de exclusão por intervalo pede a
-- extensão btree_gist, que nem todo Postgres tem (o PGlite dos testes não
-- tem). O gatilho pega a MESMA trava da aplicação (pg_advisory_xact_lock por
-- profissional) antes de olhar: dois horários gravados ao mesmo tempo para a
-- mesma pessoa esperam um pelo outro, e o segundo enxerga o primeiro — a
-- consulta de dentro do gatilho vê o que foi confirmado depois da trava.
--
-- Encostar não é sobrepor: das 9h às 10h e das 10h às 11h cabem.
-- Faltou e desmarcado não ocupam: a cadeira ficou livre.
create or replace function public.agenda_sem_choque() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if NEW.fim <= NEW.inicio then
    raise exception 'horário termina antes de começar'
      using errcode = 'check_violation', constraint = 'agendamentos_sem_choque';
  end if;
  if NEW.situacao::text not in ('MARCADO', 'CONFIRMADO', 'ATENDIDO') then
    return NEW;
  end if;
  -- Mudou só a situação entre as vivas (marcado → confirmado → atendido):
  -- o lugar na agenda é o mesmo, não há o que conferir.
  if TG_OP = 'UPDATE'
     and OLD.situacao::text in ('MARCADO', 'CONFIRMADO', 'ATENDIDO')
     and NEW.colaborador_id = OLD.colaborador_id
     and NEW.inicio = OLD.inicio
     and NEW.fim = OLD.fim then
    return NEW;
  end if;
  perform pg_advisory_xact_lock(hashtext('agenda:' || NEW.colaborador_id));
  if exists (
    select 1 from public.agendamentos a
     where a.colaborador_id = NEW.colaborador_id
       and a.id <> NEW.id
       and a.situacao::text in ('MARCADO', 'CONFIRMADO', 'ATENDIDO')
       and a.inicio < NEW.fim
       and a.fim > NEW.inicio
  ) then
    raise exception 'horário ocupado para esta profissional'
      using errcode = 'exclusion_violation', constraint = 'agendamentos_sem_choque';
  end if;
  return NEW;
end $$;

do $$
begin
  if to_regclass('public.agendamentos') is null then
    return;
  end if;
  drop trigger if exists agenda_sem_choque on public.agendamentos;
  create trigger agenda_sem_choque before insert or update on public.agendamentos
    for each row execute function public.agenda_sem_choque();
end $$;

-- ── escola (responsaveis, turmas, matriculas, mensalidades,
--    pagamentos_mensalidade) ─────────────────────────────────
-- Todas têm org_id e entram na varredura do começo: org_isolada, RLS ligado
-- e forçado — a lista de alunos, o telefone do responsável e quem está em
-- atraso de uma escola não aparecem para outra. As FKs entre elas (matrícula →
-- aluno, → turma; mensalidade → matrícula, → aluno; pagamento → mensalidade,
-- → caixa; turma → professor) têm org_id dos dois lados, e o gatilho
-- zz_fk_mesma_empresa as descobre sozinho: ninguém matricula o aluno da
-- escola vizinha nem recebe a mensalidade dela no próprio caixa.
--
-- Uma regra a mais: O DINHEIRO QUE ENTROU NÃO SE APAGA NEM SE REESCREVE.
-- O pagamento de mensalidade é o rastro do caixa e do DRE — o mesmo desenho
-- do livro de auditoria: só lê e só grava. Recebeu errado? Isso se resolve
-- com uma conversa e um lançamento, nunca sumindo com a linha do que entrou.
drop policy if exists org_isolada on public.pagamentos_mensalidade;
drop policy if exists pagamento_mensalidade_le on public.pagamentos_mensalidade;
create policy pagamento_mensalidade_le on public.pagamentos_mensalidade
  for select using (org_id = public.app_org_id());
drop policy if exists pagamento_mensalidade_grava on public.pagamentos_mensalidade;
create policy pagamento_mensalidade_grava on public.pagamentos_mensalidade
  for insert with check (org_id = public.app_org_id());

do $$
declare r record;
begin
  for r in
    select distinct grantee
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'pagamentos_mensalidade'
      and privilege_type in ('UPDATE', 'DELETE')
      and grantee <> current_user
  loop
    execute format('revoke update, delete on public.pagamentos_mensalidade from %I', r.grantee);
  end loop;
end $$;

-- ── conferência ──────────────────────────────────────────────
-- Deve listar TODA tabela com org_id, e rowsecurity = true em todas.
--
--   select c.relname, c.relrowsecurity, c.relforcerowsecurity
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname='public' and c.relkind='r'
--   order by 1;
--
-- Sobra antiga de FK entre empresas (o gatilho só barra o que é gravado
-- DEPOIS dele). Gera uma consulta por relação; rodar o resultado como admin.
-- Todas devem voltar 0.
--
--   select format(
--     'select %L as fk, count(*) from public.%I f join public.%I p on p.%I = f.%I where p.org_id <> f.org_id;',
--     filha.relname || '.' || fcol.attname, filha.relname, pai.relname, pcol.attname, fcol.attname)
--   from pg_constraint k
--   join pg_class filha on filha.oid = k.conrelid
--   join pg_class pai on pai.oid = k.confrelid
--   join pg_attribute fcol on fcol.attrelid = k.conrelid and fcol.attnum = k.conkey[1]
--   join pg_attribute pcol on pcol.attrelid = k.confrelid and pcol.attnum = k.confkey[1]
--   where k.contype = 'f' and fcol.attname <> 'org_id'
--     and exists (select 1 from pg_attribute a where a.attrelid = filha.oid and a.attname = 'org_id')
--     and exists (select 1 from pg_attribute a where a.attrelid = pai.oid and a.attname = 'org_id');
