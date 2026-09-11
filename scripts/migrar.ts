// O schema do banco anda para a frente, sem apagar nada.
//
//   npm run migrar -- --nova cadastro-rico   → ESCREVE o SQL da diferença
//   npm run migrar -- --producao             → APLICA o que falta
//
// ── por que isto passou a existir ────────────────────────────
// O `preparar-banco` cria as tabelas quando o banco está vazio e, quando não
// está, confere se falta alguma. O buraco: ele comparava só NOMES DE TABELA.
// Coluna nova passava batido — o schema mudava aqui, produção continuava sem a
// coluna, e o erro só aparecia muito depois, no meio de uma tela, como
// "column does not exist".
//
// Enquanto não existe cliente lá dentro, dá para recriar o banco e seguir.
// Depois do primeiro, não dá: recriar é apagar a loja de alguém.
//
// ── o laptop não migra, e isso é limitação do PGlite ─────────
// O banco de desenvolvimento é PGlite falando pela porta 5433, e o motor de
// schema do Prisma não funciona contra ele: estoura em
// `prepared statement "s3" already exists` tanto no `deploy` quanto no
// `resolve`. Não é defeito do projeto e não tem contorno daqui.
//
// Na prática isso não custa nada, porque no laptop não existe dado a
// preservar: apagar a pasta .banco/ e rodar `npm run preparar` recria tudo do
// zero em segundos, já com o schema novo. É o que o README manda fazer.
//
// Então: MIGRAÇÃO É COISA DE POSTGRES DE VERDADE. Este script se recusa a
// apontar para o laptop, em vez de falhar com uma mensagem que não explica
// nada.
//
// ── e por que nada aqui usa `migrate dev` ────────────────────
// `migrate dev` compara, escreve o SQL e APLICA — e, quando a diferença não
// cabe sem perda, ele oferece recriar o banco. Como ele precisaria rodar
// contra produção (o laptop não serve), ele nunca entra: o que se usa é
// `migrate diff`, que só olha e escreve o arquivo, e `migrate deploy`, que só
// aplica o que já está escrito e revisado.

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { carregarAmbiente, ehLocal } from './ambiente'

const { producao, arquivo } = carregarAmbiente()

const url = process.env.DATABASE_URL_ADMIN
if (!url) {
  console.error(`\n  Falta DATABASE_URL_ADMIN em ${arquivo}.\n`)
  process.exit(1)
}

if (ehLocal(url)) {
  console.error(
    `\n  RECUSADO: o banco do laptop não migra, e não é escolha nossa.\n\n` +
      `  O PGlite não aguenta o motor de schema do Prisma — ele estoura em\n` +
      `  "prepared statement already exists". E não faz falta: aqui não há dado\n` +
      `  a preservar.\n\n` +
      `  Para pôr o laptop no schema novo:\n` +
      `    pare o 'npm run dev', apague a pasta .banco/ e rode 'npm run preparar'.\n\n` +
      `  Para migrar o banco hospedado:\n` +
      `    npm run migrar -- --producao\n`,
  )
  process.exit(1)
}

const raiz = join(import.meta.dirname, '..')
const pastaMigracoes = join(raiz, 'prisma', 'migrations')

/** A migração que representa "o banco como ele nasceu". */
const BASE = '0_inicial'

// Chama o CLI do Prisma pelo arquivo, com o Node que ja esta rodando.
//
// Nao e frescura: `npx` no Windows e um .cmd, e o Node se recusa a executar
// .cmd sem `shell: true` (EINVAL). E com `shell: true` os argumentos vao
// CONCATENADOS numa linha de comando em vez de passados um a um — qualquer
// aspas ou espaco no meio deixa de ser argumento e vira comando. Apontar para
// o build/index.js foge dos dois problemas e ainda economiza o npx.
const CLI = createRequire(import.meta.url).resolve('prisma/build/index.js')

const prisma = (args: string[], capturar = false) =>
  execFileSync(process.execPath, [CLI, ...args], {
    stdio: capturar ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    env: { ...process.env, NORTE_AMBIENTE: producao ? 'producao' : 'local' },
    encoding: 'utf8',
  })

const alvo = new URL(url)
console.log(`\n  Banco: ${alvo.username} @ ${alvo.host}\n  credenciais de ${arquivo}\n`)

// ── escrever uma migração nova ───────────────────────────────
// Só compara e escreve o arquivo. NÃO aplica: o SQL passa pelo olho de alguém
// antes de encostar num banco com cliente dentro. Aplicar é o outro comando.
const nova = process.argv.indexOf('--nova')
if (nova !== -1) {
  const nome = process.argv[nova + 1]
  if (!nome || nome.startsWith('--')) {
    console.error('  Falta o nome: npm run migrar -- --nova cadastro-rico --producao\n')
    process.exit(1)
  }

  // O carregador de .env escreve uma linha de propaganda na saida padrao, e ela
  // entraria no arquivo de migracao junto com o SQL. Fora daqui: arquivo que o
  // Prisma vai executar contra o banco nao leva texto que nao e SQL.
  const soSql = (bruto: string) =>
    bruto
      .split(/\r?\n/)
      .filter((l) => !/injected env/.test(l) && !/^[^\x00-\x7F]/.test(l))
      .join('\n')
      .trim() + '\n'

  const bruto = soSql(
    String(
      prisma(
        [
          'migrate',
          'diff',
          // o banco COMO ELE ESTA -> o schema COMO ELE DEVERIA SER
          '--from-config-datasource',
          '--to-schema',
          'prisma/schema.prisma',
          '--script',
        ],
        true,
      ),
    ),
  )

  // ── o que já está escrito em migração pendente não entra de novo ──
  // O diff é contra o banco. Se uma migração anterior ainda não foi aplicada
  // lá, tudo dela volta aqui, e aplicadas em sequência a segunda falharia em
  // "já existe". Cada bloco (comentário + comando, separados por linha em
  // branco) que já mora numa pasta de migração sai deste arquivo.
  const blocos = (texto: string) =>
    texto.replace(/\r\n/g, '\n').split('\n\n').map((b) => b.trim()).filter(Boolean)
  const jaEscritos = new Set(
    readdirSync(pastaMigracoes)
      .filter((d) => d !== BASE && existsSync(join(pastaMigracoes, d, 'migration.sql')))
      .flatMap((d) => blocos(readFileSync(join(pastaMigracoes, d, 'migration.sql'), 'utf8'))),
  )
  const meus = blocos(bruto)
  const repetidos = meus.filter((b) => jaEscritos.has(b)).length
  const sql = meus.filter((b) => !jaEscritos.has(b)).join('\n\n') + '\n'
  if (repetidos > 0) {
    console.log(`  ${repetidos} bloco(s) já estavam em migração pendente e ficaram de fora.\n`)
  }

  const vazio = sql
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('--'))
    .length === 0

  if (vazio) {
    console.log('  O banco já está igual ao schema. Nada a escrever.\n')
    process.exit(0)
  }

  const carimbo = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const pasta = join(pastaMigracoes, `${carimbo}_${nome.replace(/[^a-z0-9-]/gi, '-')}`)
  mkdirSync(pasta, { recursive: true })
  writeFileSync(join(pasta, 'migration.sql'), sql, 'utf8')

  console.log(`  Escrita em prisma/migrations/${carimbo}_${nome}/migration.sql:\n`)
  console.log(
    sql
      .split('\n')
      .map((l) => '    ' + l)
      .join('\n'),
  )
  console.log(
    `\n  LEIA o SQL acima antes de aplicar. Procure DROP, e procure NOT NULL sem\n` +
      `  DEFAULT em tabela que já tem linha — os dois apagam ou travam dado.\n\n` +
      `  Quando estiver certo:  npm run migrar -- --producao\n`,
  )
  process.exit(0)
}

// ── o banco veio de antes das migrações? ─────────────────────
// Ele nasceu com o DDL aplicado direto, sem registro nenhum. Para o Prisma
// isso é um banco que ele não conhece: ele tentaria criar tudo de novo e
// falharia em "já existe". A saída é dizer a ele, uma vez, que a primeira
// migração já está aplicada. `resolve --applied` só escreve na tabela de
// controle — não encosta no schema.
const c = new Client({ connectionString: url, connectionTimeoutMillis: 15000 })
await c.connect()
const { rows } = await c.query<{ tem_tabelas: boolean; tem_controle: boolean }>(
  `select to_regclass('public.orgs') is not null               as tem_tabelas,
          to_regclass('public._prisma_migrations') is not null as tem_controle`,
)
await c.end()

const { tem_tabelas, tem_controle } = rows[0]!

if (tem_tabelas && !tem_controle) {
  if (!existsSync(join(pastaMigracoes, BASE, 'migration.sql'))) {
    console.error(`  Falta prisma/migrations/${BASE}/migration.sql.\n`)
    process.exit(1)
  }
  console.log('  Banco de antes das migrações. Marcando a base como já aplicada...\n')
  prisma(['migrate', 'resolve', '--applied', BASE])
}

// ── aplicar o que falta ──────────────────────────────────────
prisma(['migrate', 'deploy'])

console.log(`\n  Pronto. O banco está no mesmo ponto que o schema.\n`)

// Um lembrete que vale mais do que parece: coluna nova nasce sem política de
// RLS nenhuma se a tabela for nova, e o `preparar-banco` é quem liga isso.
if (readFileSync(join(raiz, 'prisma', 'sql', 'rls.sql'), 'utf8').length > 0) {
  console.log(
    `  Se a migração criou TABELA nova, rode também:\n` +
      `    npm run preparar -- --producao\n` +
      `  É ele que liga RLS e as permissões na tabela nova.\n`,
  )
}
