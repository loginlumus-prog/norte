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
