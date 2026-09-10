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
create or replace function app_org_id() returns text
language sql stable as $$
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
        using (org_id = app_org_id())
        with check (org_id = app_org_id())
    $f$, t.relname);
  end loop;
end $$;

-- ── a tabela orgs se filtra pelo próprio id ──────────────────
alter table public.orgs enable row level security;
alter table public.orgs force row level security;
drop policy if exists org_propria on public.orgs;
create policy org_propria on public.orgs
  using (id = app_org_id())
  with check (id = app_org_id());

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
  for select using (org_id = app_org_id());

drop policy if exists auditoria_grava on public.auditoria;
create policy auditoria_grava on public.auditoria
  for insert with check (org_id = app_org_id());

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
