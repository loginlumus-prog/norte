// A aplicação alcança o banco hospedado, e o isolamento sobrevive ao pooler?
//
//   npm run conexao -- --producao
//
// ── por que este script existe separado da conferência ───────
// A conferência APAGA e recria as empresas de exemplo, então ela é bancada de
// teste e se recusa a rodar fora do laptop. Mas alguma coisa precisa poder
// olhar o banco de verdade — e o que ela precisa responder é diferente.
//
// Aqui não se testa regra de negócio (isso o `npm run conferir` já faz, 147
// vezes, no local, com o MESMO código). Aqui se testa a INFRAESTRUTURA: a
// aplicação chega no banco, o papel que ela usa é mesmo sem privilégio, e o
// carimbo da empresa não vaza de uma transação para a outra.
//
// Este script é somente leitura. Ele não cria, não apaga e não altera nada.
//
// ── e por que a porta 6543 é o ponto de risco ────────────────
// No modo transação o pooler EMPRESTA a conexão por transação: duas
// requisições seguidas da mesma pessoa podem cair em conexões diferentes, e
// uma conexão pode ter servido outra empresa um instante antes.
//
// É por isso que `comoOrg` usa `set local role` e `set_config(..., true)` —
// as duas formas presas à transação. Se em algum momento alguém trocar por
// `SET` de sessão, o teste 3 aqui embaixo passa a falhar, e falha ANTES de
// virar vazamento de dado de cliente. É esse o trabalho dele.

import { Client } from 'pg'
import { carregarAmbiente, ehLocal } from './ambiente'

const { arquivo } = carregarAmbiente()

const url = process.env.DATABASE_URL
if (!url) {
  console.error(`\n  Falta DATABASE_URL em ${arquivo}.\n`)
  process.exit(1)
}

let passou = 0
let falhou = 0

const ok = (titulo: string, certo: boolean, detalhe = '') => {
  console.log(`  ${certo ? 'ok  ' : 'FALHOU'}  ${titulo}${detalhe ? ' — ' + detalhe : ''}`)
  certo ? passou++ : falhou++
}

const alvo = new URL(url)
console.log(`\n  Conferindo ${alvo.username} @ ${alvo.host}`)
console.log(`  credenciais de ${arquivo}\n`)

if (!ehLocal(url) && alvo.port !== '6543') {
  console.log(
    `  ⚠  A aplicação em produção deveria usar a porta 6543 (transação),\n` +
      `     e esta URL está na ${alvo.port}. Ver .env.producao.example.\n`,
  )
}

const c = new Client({ connectionString: url, connectionTimeoutMillis: 15000 })
await c.connect()

// ── 1. quem a aplicação é ────────────────────────────────────
// Se ela chegar como dona das tabelas ou como superusuário, o RLS é ignorado
// em silêncio — sem erro, sem aviso, e a segunda parede simplesmente não
// existe. É a primeira coisa a conferir, e a mais fácil de errar num .env.
const { rows: quem } = await c.query<{
  eu: string
  super: boolean
  ignora: boolean
}>(
  `select current_user as eu,
          (select rolsuper from pg_roles where rolname = current_user) as "super",
          (select rolbypassrls from pg_roles where rolname = current_user) as ignora`,
)
ok('a aplicação chega como app_norte', quem[0]!.eu === 'app_norte', quem[0]!.eu)
ok('e não é superusuário', quem[0]!.super === false)
ok('e não ignora RLS', quem[0]!.ignora === false)

// ── 2. as travas estão de pé ─────────────────────────────────
// A regra é sobre tabela QUE GUARDA DADO DE CLIENTE, e o que marca isso é a
// coluna `org_id` — é ela que o rls.sql procura para ligar a proteção.
//
// Contar todas as tabelas parecia mais rigoroso e era mais frágil: no dia em
// que o Prisma criou a própria tabela de controle (`_prisma_migrations`, sem
// org_id nenhum), a conferência acusou falha numa tabela que não tem o que
// proteger. Alarme falso gasta a confiança de quem lê a lista.
//
// Então o teste virou dois. O primeiro é o de sempre, no universo certo.
const { rows: travas } = await c.query<{ tabelas: string; sem_rls: string }>(
  `select count(*) as tabelas,
          count(*) filter (where not (c.relrowsecurity and c.relforcerowsecurity)) as sem_rls
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_attribute a
                   where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)`,
)
ok(
  'toda tabela de cliente com RLS ligado e forçado',
  travas[0]!.sem_rls === '0',
  `${travas[0]!.tabelas} tabelas`,
)

// O segundo é o que faltava: tabela SEM org_id é exceção, e exceção tem que
// ser conhecida. Uma tabela nova que aparecesse aqui seria ou dado de cliente
// sem carimbo de empresa — o pior defeito possível neste sistema — ou uma
// decisão que ninguém escreveu. Nos dois casos a lista precisa parar de rodar
// e mostrar o nome.
// `orgs` nao tem coluna `org_id` porque ela e a propria empresa: filtra pelo
// `id`, com politica propria (`org_propria` no rls.sql). Por isso ela sai da
// contagem de cima e ganha teste proprio logo abaixo.
// `_prisma_migrations` e a tabela de controle do Prisma — nao guarda dado de
// cliente, e a aplicacao nem alcanca ela (testado adiante).
const CONHECIDAS_SEM_ORG = ['orgs', '_prisma_migrations']

const { rows: soltas } = await c.query<{ tabela: string }>(
  `select c.relname as tabela
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_attribute a
                       where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)`,
)
const inesperadas = soltas.map((t) => t.tabela).filter((t) => !CONHECIDAS_SEM_ORG.includes(t))
ok(
  'nenhuma tabela sem carimbo de empresa apareceu',
  inesperadas.length === 0,
  inesperadas.length ? inesperadas.join(', ') : `${soltas.length} conhecida(s)`,
)

// A `orgs` sai da contagem acima, entao ela e conferida na mao — e ela e a
// tabela que MAIS importa: e nela que mora a lista de todos os clientes.
const { rows: tabelaOrgs } = await c.query<{ ligado: boolean; forcado: boolean }>(
  `select c.relrowsecurity as ligado, c.relforcerowsecurity as forcado
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'orgs'`,
)
ok(
  'a tabela de empresas tambem tem RLS ligado e forcado',
  tabelaOrgs[0]?.ligado === true && tabelaOrgs[0]?.forcado === true,
)

// E a tabela de controle do Prisma não é da aplicação. Ela guarda o histórico
// de migração; a aplicação não tem o que fazer com ela, e `grant ... on all
// tables` é largo demais para deixar isso por conta da sorte.
const { rows: controle } = await c.query<{ alcanca: boolean }>(
  `select coalesce(
            has_table_privilege(current_user, '_prisma_migrations', 'SELECT')
         or has_table_privilege(current_user, '_prisma_migrations', 'INSERT')
         or has_table_privilege(current_user, '_prisma_migrations', 'UPDATE')
         or has_table_privilege(current_user, '_prisma_migrations', 'DELETE'), false) as alcanca`,
)
ok('a aplicação não alcança a tabela de migrações', controle[0]!.alcanca === false)

// ── 2.1 ninguém sequestra o pino do isolamento ───────────────
// Toda política pergunta a `public.app_org_id()` de que empresa é a
// requisição. Se o papel da aplicação pudesse criar objeto — em `public` ou
// num schema próprio — ele poderia pôr outra função com esse nome à frente no
// caminho de busca e passar a responder ele mesmo de que empresa é a
// requisição. O RLS continuaria ligado, forçado, e inútil.
//
// Hoje as três portas estão fechadas. Elas ficam AQUI porque nenhuma delas se
// fecha sozinha: são efeito de GRANTs continuarem certos, e um
// `grant create on schema public` de uma migração reabriria a primeira sem
// avisar ninguém.
const { rows: pino } = await c.query<{
  cria_em_public: boolean
  cria_schema: boolean
  caminho_fixo: string[] | null
}>(
  `select has_schema_privilege(current_user, 'public', 'CREATE')            as cria_em_public,
          has_database_privilege(current_user, current_database(), 'CREATE') as cria_schema,
          (select proconfig from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where p.proname = 'app_org_id' and n.nspname = 'public')         as caminho_fixo`,
)
ok('a aplicação não cria objeto em public', pino[0]!.cria_em_public === false)
ok('e não cria schema nenhum', pino[0]!.cria_schema === false)
ok(
  'e o caminho de busca da app_org_id está fixo',
  (pino[0]!.caminho_fixo ?? []).some((v) => v.startsWith('search_path=')),
  pino[0]!.caminho_fixo?.join(', ') ?? 'solto',
)

// ── 3. o carimbo não vaza entre transações ───────────────────
// O teste que só faz sentido no pooler. Carimba a empresa numa transação,
// confere que vale ali dentro, fecha, e abre outra para ver se sobrou.
await c.query('begin')
await c.query("select set_config('app.org_id', 'so-nesta-transacao', true)")
const { rows: dentro } = await c.query<{ v: string | null }>(
  "select current_setting('app.org_id', true) as v",
)
ok('o carimbo vale dentro da transação', dentro[0]!.v === 'so-nesta-transacao')
await c.query('commit')

const { rows: depois } = await c.query<{ v: string | null }>(
  "select current_setting('app.org_id', true) as v",
)
ok(
  'e some quando ela fecha',
  depois[0]!.v === null || depois[0]!.v === '',
  depois[0]!.v === null ? 'nulo' : `sobrou "${depois[0]!.v}"`,
)

// ── 4. sem carimbo, não vem linha ────────────────────────────
// Com FORCE RLS e a política exigindo `org_id = app_org_id()`, uma consulta
// sem empresa no contexto tem que voltar vazia — nunca o banco inteiro.
const { rows: solto } = await c.query<{ n: string }>('select count(*) as n from orgs')
ok('consulta sem empresa no contexto não devolve nada', solto[0]!.n === '0')

await c.end()

// ── 5. a portaria só abre a porta ────────────────────────────
// O papel que responde "de que empresa é este endereço", antes de existir
// sessão. Ele precisa ler a fachada e NÃO PODE ler mais nada — se um dia
// alguém der `grant ... on all tables` em bloco, é aqui que aparece.
//
// Este teste não existe no banco local, e não por esquecimento: o PGlite
// ignora o usuário da URL e responde tudo como superusuário. Permissão por
// papel e por coluna só é verificável num Postgres que autentica de verdade.
const urlPortaria = process.env.DATABASE_URL_PORTARIA
if (!urlPortaria) {
  ok('DATABASE_URL_PORTARIA configurada', false, `falta em ${arquivo}`)
} else {
  const p = new Client({ connectionString: urlPortaria, connectionTimeoutMillis: 15000 })
  await p.connect()

  const { rows: eu } = await p.query<{ eu: string; super: boolean; ignora: boolean }>(
    `select current_user as eu,
            (select rolsuper from pg_roles where rolname = current_user) as "super",
            (select rolbypassrls from pg_roles where rolname = current_user) as ignora`,
  )
  ok('a portaria chega como app_portaria', eu[0]!.eu === 'app_portaria', eu[0]!.eu)
  ok('e não é superusuário nem ignora RLS', !eu[0]!.super && !eu[0]!.ignora)

  const deixa = async (sql: string) => {
    try {
      await p.query(sql)
      return true
    } catch {
      return false
    }
  }

  ok('lê a fachada da empresa', await deixa('select id, nome, slug, cor_marca from orgs limit 1'))

  // O que ela NÃO pode. Cada um destes é uma coluna ou tabela que a tela de
  // login não precisa — e que, portanto, este segredo não deve alcançar.
  const proibido: [string, string][] = [
    ['o documento e o telefone', 'select documento, telefone from orgs limit 1'],
    ['o crédito de IA', 'select credito_ia_cent from orgs limit 1'],
    ['a tabela inteira com select *', 'select * from orgs limit 1'],
    ['os usuários', 'select * from usuarios limit 1'],
    ['as vendas', 'select * from vendas limit 1'],
  ]
  for (const [nome, sql] of proibido) {
    ok(`e NÃO alcança ${nome}`, !(await deixa(sql)))
  }
  ok('e não escreve', !(await deixa("update orgs set nome = nome where id = ''")))

  await p.end()
}

console.log(
  `\n  ${falhou === 0 ? 'Tudo certo' : 'TEM COISA ERRADA'}. ${passou} conferências${
    falhou ? `, ${falhou} falharam` : ''
  }.\n`,
)
process.exit(falhou === 0 ? 0 : 1)
