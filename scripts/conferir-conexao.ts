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
const { rows: travas } = await c.query<{ tabelas: string; sem_rls: string }>(
  `select count(*) as tabelas,
          count(*) filter (where not (c.relrowsecurity and c.relforcerowsecurity)) as sem_rls
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`,
)
ok(
  'toda tabela com RLS ligado e forçado',
  travas[0]!.sem_rls === '0',
  `${travas[0]!.tabelas} tabelas`,
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

console.log(
  `\n  ${falhou === 0 ? 'Tudo certo' : 'TEM COISA ERRADA'}. ${passou} conferências${
    falhou ? `, ${falhou} falharam` : ''
  }.\n`,
)
process.exit(falhou === 0 ? 0 : 1)
