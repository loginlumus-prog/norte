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
drop function if exists public.criar_empresa_cadastro(text, text, text, text, text, text, text, boolean, text, text);
create function public.criar_empresa_cadastro(
  p_nome text,
  p_endereco text,
  p_dono text,
  p_email text,
  p_senha_hash text,
  p_ramo text,
  p_ip text,
  p_email_pendente boolean,
  p_termos text,
  -- O código do parceiro que indicou (o ?ref= do link), ou nulo. Código que
  -- não existe, de parceiro bloqueado, ou do próprio dono, é ignorado em
  -- silêncio: a empresa nasce do mesmo jeito, só sem indicação.
  p_ref text default null
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
    'esqueci-a-senha', 'comecar', 'login', 'parceiros', 'parceiro', 'indique'
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
  v_parceiro text;
  v_parceiro_email text;
  v_ref text := upper(btrim(coalesce(p_ref, '')));
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
  if v_ref <> '' and v_ref !~ '^[A-Z0-9]{3,20}$' then
    v_ref := '';
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
      -- Teste de 30 dias com tudo (tabela de 02/10/2026): sem plano grátis
      -- para sempre. Quando o prazo vence, `vencerTesteSeAcabou` desce a
      -- empresa para o Grátis, que guarda os dados e o básico até assinar.
      insert into public.orgs (id, nome, slug, email, ramo, plano, situacao, teste_ate, modulos, criada_em, atualizada_em)
      values (v_org, v_nome, v_candidato, v_email, v_ramo, 'BALCAO_AGENTE', 'TESTE', v_agora + interval '30 days', '{}', v_agora, v_agora);
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
    jsonb_build_object('origem', 'cadastro', 'plano', 'BALCAO_AGENTE', 'teste_dias', 30, 'ramo', v_ramo,
                       'termos', btrim(p_termos), 'emailConfirmado', not p_email_pendente),
    v_agora
  );

  -- ── quem indicou ──
  -- A tabela de parceiros não é forçada: o dono desta função a lê. A
  -- indicação é da empresa nova (org_id carimbado acima).
  if v_ref <> '' then
    select pa.id, pa.email into v_parceiro, v_parceiro_email
      from public.parceiros pa
     where pa.codigo = v_ref and pa.situacao = 'ATIVO';
    if v_parceiro is not null and v_parceiro_email <> v_email then
      insert into public.indicacoes (id, org_id, parceiro_id, empresa_nome, criada_em)
      values (replace(gen_random_uuid()::text, '-', ''), v_org, v_parceiro, v_nome, v_agora);
      insert into public.auditoria (id, org_id, usuario_id, quem, autor, acao, alvo_tipo, alvo_id, alvo_nome, depois, criado_em)
      values (
        replace(gen_random_uuid()::text, '-', ''), v_org, v_usuario, v_dono, 'PESSOA', 'empresa.indicada', 'org', v_org, v_nome,
        jsonb_build_object('codigo', v_ref), v_agora
      );
    end if;
  end if;

  insert into public.cadastros_publicos (id, ip_resumo, criado_em)
  values (replace(gen_random_uuid()::text, '-', ''), v_ip, v_agora);
  -- a limpeza vai de carona: linha de anteontem não freia ninguém
  delete from public.cadastros_publicos c where c.criado_em < v_agora - interval '2 days';

  return query select v_org, v_usuario, v_candidato, null::text;
end $fn$;

revoke all on function public.criar_empresa_cadastro(text, text, text, text, text, text, text, boolean, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_portaria') then
    grant execute on function public.criar_empresa_cadastro(text, text, text, text, text, text, text, boolean, text, text) to app_portaria;
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

-- ── o programa de parceiros ──────────────────────────────────
--
-- Uma segunda dimensão de isolamento, ao lado da empresa: o PARCEIRO (quem
-- indica o Norte e recebe comissão). A cada requisição do painel do
-- parceiro a aplicação carimba
--     select set_config('app.parceiro_id', '<id>', true);
-- (`comoParceiro`, em src/servidor/banco.ts) e daí em diante ele só enxerga
-- a própria conta, as próprias indicações, comissões e repasses.
--
-- As tabelas:
--   • parceiros, repasses — sem org_id: não entram na varredura do começo.
--     RLS ligado e NÃO forçado, de propósito, como cadastros_publicos: quem
--     não é o dono (a aplicação) só vê a própria linha; o dono — com os
--     direitos de quem rodam as funções abaixo — lê para o login e o cadastro.
--   • indicacoes, comissoes, pagamentos_norte — têm org_id e já ganharam a
--     org_isolada na varredura: a EMPRESA vê a indicação dela e as comissões
--     que os pagamentos dela geraram (é na transação da empresa que o
--     pagamento é registrado). Indicações e comissões ganham aqui uma segunda
--     política, só de leitura: o PARCEIRO vê as que são dele.
--   • parceiros_tentativas — o freio. Trancada: só as funções.
--
-- O que o parceiro NÃO vê: o e-mail, o telefone e o Pix de quem está na rede
-- dele, e nada das empresas além do nome da indicação. A rede sai por uma
-- função (rede_do_parceiro) que devolve só nome curto e contagem.
create or replace function public.app_parceiro_id() returns text
language sql stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.parceiro_id', true), '')
$$;

do $$
declare r record;
begin
  if to_regclass('public.parceiros') is null then
    return;
  end if;

  alter table public.parceiros enable row level security;
  alter table public.parceiros no force row level security;
  drop policy if exists parceiro_proprio on public.parceiros;
  create policy parceiro_proprio on public.parceiros
    using (id = public.app_parceiro_id())
    with check (id = public.app_parceiro_id());

  alter table public.repasses enable row level security;
  alter table public.repasses no force row level security;
  drop policy if exists parceiro_proprio on public.repasses;
  create policy parceiro_proprio on public.repasses
    using (parceiro_id = public.app_parceiro_id())
    with check (parceiro_id = public.app_parceiro_id());

  drop policy if exists parceiro_le on public.indicacoes;
  create policy parceiro_le on public.indicacoes
    for select using (parceiro_id = public.app_parceiro_id());

  drop policy if exists parceiro_le on public.comissoes;
  create policy parceiro_le on public.comissoes
    for select using (parceiro_id = public.app_parceiro_id());
  -- O repasse marca as comissões que pagou (repasse_id), no contexto do parceiro.
  drop policy if exists parceiro_repasse on public.comissoes;
  create policy parceiro_repasse on public.comissoes
    for update using (parceiro_id = public.app_parceiro_id())
    with check (parceiro_id = public.app_parceiro_id());

  -- O pagamento da mensalidade é livro: entra, não muda nem sai.
  drop policy if exists org_isolada on public.pagamentos_norte;
  drop policy if exists pagamento_norte_le on public.pagamentos_norte;
  create policy pagamento_norte_le on public.pagamentos_norte
    for select using (org_id = public.app_org_id());
  drop policy if exists pagamento_norte_grava on public.pagamentos_norte;
  create policy pagamento_norte_grava on public.pagamentos_norte
    for insert with check (org_id = public.app_org_id());
  for r in
    select distinct grantee
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'pagamentos_norte'
      and privilege_type in ('UPDATE', 'DELETE')
      and grantee <> current_user
  loop
    execute format('revoke update, delete on public.pagamentos_norte from %I', r.grantee);
  end loop;

  -- O freio: ninguém além das funções.
  alter table public.parceiros_tentativas enable row level security;
  for r in select rolname from pg_roles where rolname in ('app_norte', 'app_portaria') loop
    execute format('revoke all on public.parceiros_tentativas from %I', r.rolname);
  end loop;
end $$;

-- ── as perguntas de portaria do parceiro ─────────────────────
-- O mesmo molde de criar_empresa_cadastro: SECURITY DEFINER, search_path
-- fixo, cada campo conferido de novo, senha só em hash, freio por resumo
-- de IP e de e-mail. Só a portaria chama.
create or replace function public.parceiro_resumo(p text) returns text
language sql immutable
set search_path = pg_catalog, public
as $$
  select encode(sha256(convert_to(coalesce(nullif(btrim(p), ''), '-'), 'UTF8')), 'hex')
$$;

-- "De quem é este código?" — para a tela de cadastro dizer quem indicou.
-- Só o primeiro nome, e só de parceiro ativo.
drop function if exists public.parceiro_pelo_codigo(text);
create function public.parceiro_pelo_codigo(p_codigo text)
returns table (r_nome text)
language sql stable
security definer
set search_path = pg_catalog, public
as $fn$
  select split_part(btrim(pa.nome), ' ', 1)
    from public.parceiros pa
   where pa.codigo = upper(btrim(p_codigo)) and pa.situacao = 'ATIVO'
     and upper(btrim(p_codigo)) ~ '^[A-Z0-9]{3,20}$'
$fn$;

drop function if exists public.criar_parceiro_cadastro(text, text, text, text, text, text, text, text);
create function public.criar_parceiro_cadastro(
  p_nome text,
  p_email text,
  p_senha_hash text,
  p_telefone text,
  p_codigo text,
  p_patrocinador text,
  p_ip text,
  p_termos text
)
returns table (r_parceiro text, r_codigo text, r_recusa text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_nome text := btrim(p_nome);
  v_email text := lower(btrim(p_email));
  v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'), '');
  v_base text := left(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), 14);
  v_ip text := public.parceiro_resumo(p_ip);
  v_agora timestamp := now() at time zone 'utc';
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_patrocinador text;
  v_codigo text;
  v_criou boolean := false;
  n integer;
begin
  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 80 or v_nome ~ '[[:cntrl:]]' then
    raise exception 'parceiro: nome inválido' using errcode = '22023';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'parceiro: e-mail inválido' using errcode = '22023';
  end if;
  if p_senha_hash is null or length(p_senha_hash) > 300
     or p_senha_hash !~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$' then
    raise exception 'parceiro: senha sem a forma de hash' using errcode = '22023';
  end if;
  if v_tel is not null and (length(v_tel) < 10 or length(v_tel) > 13) then
    raise exception 'parceiro: telefone inválido' using errcode = '22023';
  end if;
  if p_termos is null or length(btrim(p_termos)) < 1 or length(p_termos) > 60 then
    raise exception 'parceiro: versão dos termos inválida' using errcode = '22023';
  end if;
  if length(v_base) < 3 then
    v_base := 'NORTE';
  end if;

  -- o freio: 5 contas por hora por endereço de rede, 100 no total
  perform pg_advisory_xact_lock(hashtext('parceiro:cadastro:' || v_ip));
  select count(*) into n from public.parceiros_tentativas t
   where t.tipo = 'cadastro' and t.ip_resumo = v_ip and t.criado_em > v_agora - interval '1 hour';
  if n >= 5 then
    return query select null::text, null::text, 'muitas_tentativas'::text;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('parceiro:cadastro:geral'));
  select count(*) into n from public.parceiros_tentativas t
   where t.tipo = 'cadastro' and t.criado_em > v_agora - interval '1 hour';
  if n >= 100 then
    return query select null::text, null::text, 'muitas_no_geral'::text;
    return;
  end if;

  if exists (select 1 from public.parceiros pa where pa.email = v_email) then
    return query select null::text, null::text, 'email_em_uso'::text;
    return;
  end if;

  -- quem trouxe (o segundo nível): só parceiro ativo
  if p_patrocinador is not null and upper(btrim(p_patrocinador)) ~ '^[A-Z0-9]{3,20}$' then
    select pa.id into v_patrocinador from public.parceiros pa
     where pa.codigo = upper(btrim(p_patrocinador)) and pa.situacao = 'ATIVO';
  end if;

  for i in 1..30 loop
    v_codigo := case
      when i = 1 then v_base
      when i <= 20 then v_base || i::text
      else v_base || upper(substr(md5(random()::text), 1, 4))
    end;
    continue when exists (select 1 from public.parceiros pa where pa.codigo = v_codigo);
    begin
      insert into public.parceiros (id, nome, email, senha_hash, telefone, codigo, situacao, patrocinador_id,
                                    termos, sessoes_desde, criado_em, atualizado_em)
      values (v_id, v_nome, v_email, p_senha_hash, v_tel, v_codigo, 'ATIVO', v_patrocinador,
              btrim(p_termos), v_agora, v_agora, v_agora);
      v_criou := true;
    exception when unique_violation then
      if exists (select 1 from public.parceiros pa where pa.email = v_email) then
        return query select null::text, null::text, 'email_em_uso'::text;
        return;
      end if;
      v_criou := false;
    end;
    exit when v_criou;
  end loop;
  if not v_criou then
    raise exception 'parceiro: nenhum código livre' using errcode = '22023';
  end if;

  insert into public.parceiros_tentativas (id, tipo, email_resumo, ip_resumo, ok, criado_em)
  values (replace(gen_random_uuid()::text, '-', ''), 'cadastro', public.parceiro_resumo(v_email), v_ip, true, v_agora);
  delete from public.parceiros_tentativas t where t.criado_em < v_agora - interval '2 days';

  return query select v_id, v_codigo, null::text;
end $fn$;

-- Entrar: devolve o hash para a aplicação conferir (a senha nunca vem ao
-- banco) e já deixa a tentativa CONTADA como erro, até a aplicação dizer
-- que acertou. 5 erros por e-mail ou 20 por endereço em 15 minutos: espera.
drop function if exists public.parceiro_para_entrar(text, text);
create function public.parceiro_para_entrar(p_email text, p_ip text)
returns table (r_tentativa text, r_parceiro text, r_hash text, r_situacao text, r_recusa text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_er text := public.parceiro_resumo(lower(btrim(coalesce(p_email, ''))));
  v_ip text := public.parceiro_resumo(p_ip);
  v_agora timestamp := now() at time zone 'utc';
  v_t text := replace(gen_random_uuid()::text, '-', '');
  n integer;
begin
  if length(v_email) > 254 then
    return query select null::text, null::text, null::text, null::text, 'credenciais'::text;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('parceiro:entrar:' || v_er));
  select count(*) into n from public.parceiros_tentativas t
   where t.tipo = 'entrar' and not t.ok and t.email_resumo = v_er and t.criado_em > v_agora - interval '15 minutes';
  if n >= 5 then
    return query select null::text, null::text, null::text, null::text, 'muitas_tentativas'::text;
    return;
  end if;
  select count(*) into n from public.parceiros_tentativas t
   where t.tipo = 'entrar' and not t.ok and t.ip_resumo = v_ip and t.criado_em > v_agora - interval '15 minutes';
  if n >= 20 then
    return query select null::text, null::text, null::text, null::text, 'muitas_tentativas'::text;
    return;
  end if;

  insert into public.parceiros_tentativas (id, tipo, email_resumo, ip_resumo, ok, criado_em)
  values (v_t, 'entrar', v_er, v_ip, false, v_agora);

  return query
    select v_t, pa.id, pa.senha_hash, pa.situacao, null::text
      from public.parceiros pa where pa.email = v_email
    union all
    select v_t, null::text, null::text, null::text, null::text
     where not exists (select 1 from public.parceiros pa where pa.email = v_email);
end $fn$;

drop function if exists public.parceiro_tentativa_ok(text);
create function public.parceiro_tentativa_ok(p_tentativa text)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
  update public.parceiros_tentativas set ok = true where id = p_tentativa and tipo = 'entrar';
$fn$;

-- "Esqueci a senha": guarda o RESUMO do código (o código vai só no e-mail)
-- por uma hora. 3 pedidos por e-mail por hora. Devolve o nome para o e-mail
-- — a tela responde igual exista a conta ou não.
drop function if exists public.parceiro_pedir_troca(text, text, text);
create function public.parceiro_pedir_troca(p_email text, p_resumo text, p_ip text)
returns table (r_nome text, r_recusa text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_er text := public.parceiro_resumo(lower(btrim(coalesce(p_email, ''))));
  v_agora timestamp := now() at time zone 'utc';
  n integer;
begin
  if p_resumo is null or p_resumo !~ '^[0-9a-f]{64}$' then
    raise exception 'parceiro: resumo inválido' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('parceiro:senha:' || v_er));
  select count(*) into n from public.parceiros_tentativas t
   where t.tipo = 'senha' and t.email_resumo = v_er and t.criado_em > v_agora - interval '1 hour';
  if n >= 3 then
    return query select null::text, 'muitas_tentativas'::text;
    return;
  end if;
  insert into public.parceiros_tentativas (id, tipo, email_resumo, ip_resumo, ok, criado_em)
  values (replace(gen_random_uuid()::text, '-', ''), 'senha', v_er, public.parceiro_resumo(p_ip), true, v_agora);

  return query
    update public.parceiros pa
       set troca_resumo = p_resumo, troca_ate = v_agora + interval '1 hour', atualizado_em = v_agora
     where pa.email = v_email and pa.situacao = 'ATIVO'
    returning split_part(btrim(pa.nome), ' ', 1), null::text;
end $fn$;

drop function if exists public.parceiro_trocar_senha(text, text);
create function public.parceiro_trocar_senha(p_resumo text, p_senha_hash text)
returns table (r_parceiro text, r_email text, r_nome text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_agora timestamp := now() at time zone 'utc';
begin
  if p_resumo is null or p_resumo !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  if p_senha_hash is null or length(p_senha_hash) > 300
     or p_senha_hash !~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$' then
    raise exception 'parceiro: senha sem a forma de hash' using errcode = '22023';
  end if;
  return query
    update public.parceiros pa
       set senha_hash = p_senha_hash, troca_resumo = null, troca_ate = null,
           sessoes_desde = v_agora, atualizado_em = v_agora
     where pa.troca_resumo = p_resumo and pa.troca_ate > v_agora and pa.situacao = 'ATIVO'
    returning pa.id, pa.email, split_part(btrim(pa.nome), ' ', 1);
end $fn$;

-- A rede do parceiro (quem ele trouxe): nome curto, desde quando, quantas
-- empresas indicou e quantas pagaram nos últimos 45 dias. Sem e-mail, sem
-- telefone, sem Pix, sem nome de empresa. Quem chama é a aplicação, no
-- contexto do parceiro (app.parceiro_id).
drop function if exists public.rede_do_parceiro();
create function public.rede_do_parceiro()
returns table (r_id text, r_nome text, r_desde timestamp, r_indicadas integer, r_ativas integer)
language sql stable
security definer
set search_path = pg_catalog, public
as $fn$
  select pa.id,
         split_part(btrim(pa.nome), ' ', 1)
           || case when split_part(btrim(pa.nome), ' ', 2) <> '' then ' ' || left(split_part(btrim(pa.nome), ' ', 2), 1) || '.' else '' end,
         pa.criado_em,
         (select count(*)::int from public.indicacoes i where i.parceiro_id = pa.id),
         (select count(*)::int from public.indicacoes i
           where i.parceiro_id = pa.id
             and i.ultimo_pagamento_em > (now() at time zone 'utc') - interval '45 days')
    from public.parceiros pa
   where pa.patrocinador_id = public.app_parceiro_id()
     and public.app_parceiro_id() is not null
   order by pa.criado_em desc
$fn$;

-- Quantos clientes PAGANDO um parceiro tem (pagaram nos últimos 45 dias). É
-- o que decide a faixa da comissão e se o segundo nível vale. Chamada na
-- transação que registra o pagamento (contexto da empresa que pagou), que
-- não enxerga as indicações de outras empresas — por isso é função.
drop function if exists public.clientes_ativos_do_parceiro(text);
create function public.clientes_ativos_do_parceiro(p_parceiro text)
returns integer
language sql stable
security definer
set search_path = pg_catalog, public
as $fn$
  select count(*)::int from public.indicacoes i
   where i.parceiro_id = p_parceiro
     and i.ultimo_pagamento_em > (now() at time zone 'utc') - interval '45 days'
$fn$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.parceiro_pelo_codigo(text)',
    'public.criar_parceiro_cadastro(text, text, text, text, text, text, text, text)',
    'public.parceiro_para_entrar(text, text)',
    'public.parceiro_tentativa_ok(text)',
    'public.parceiro_pedir_troca(text, text, text)',
    'public.parceiro_trocar_senha(text, text)',
    'public.rede_do_parceiro()',
    'public.clientes_ativos_do_parceiro(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'app_portaria') then
    foreach f in array array[
      'public.parceiro_pelo_codigo(text)',
      'public.criar_parceiro_cadastro(text, text, text, text, text, text, text, text)',
      'public.parceiro_para_entrar(text, text)',
      'public.parceiro_tentativa_ok(text)',
      'public.parceiro_pedir_troca(text, text, text)',
      'public.parceiro_trocar_senha(text, text)'
    ] loop
      execute format('grant execute on function %s to app_portaria', f);
    end loop;
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_norte') then
    execute 'grant execute on function public.rede_do_parceiro() to app_norte';
    execute 'grant execute on function public.clientes_ativos_do_parceiro(text) to app_norte';
  end if;
end $$;

-- ── a tabela de controle das migrações ───────────────────────
-- O `grant ... on all tables` (preparar-banco.ts, e o .video/pos.ts no laptop)
-- pega tudo o que estiver em public — inclusive `_prisma_migrations`, que
-- guarda o histórico do schema e que a aplicação não tem o que ler nem
-- reescrever. Este arquivo roda DEPOIS de todo grant e de toda migração: é o
-- lugar que garante a retirada, qualquer que tenha sido o caminho.
do $$
begin
  if to_regclass('public._prisma_migrations') is not null
     and exists (select 1 from pg_roles where rolname = 'app_norte') then
    revoke all on public._prisma_migrations from app_norte;
  end if;
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
