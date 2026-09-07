// Banco de desenvolvimento: um Postgres de verdade rodando na sua máquina,
// sem Docker, sem nuvem, sem conta em lugar nenhum.
//
// PGlite é o Postgres compilado para WASM; o pglite-socket põe ele numa porta
// falando o protocolo do Postgres. Resultado: a aplicação conecta com uma
// connection string normal e NÃO existe uma linha de código diferente entre
// desenvolvimento e produção.
//
//   npm run banco     → sobe o servidor (deixe rodando)
//   npm run preparar  → cria as tabelas, liga as travas e popula exemplo
//
// Os dados ficam em .banco/ (ignorado pelo git). Apagar a pasta = banco novo.

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PASTA = join(process.cwd(), '.banco')
const PORTA = Number(process.env.PORTA_BANCO ?? 5433) // 5433 p/ não brigar com Postgres instalado

mkdirSync(PASTA, { recursive: true })

const db = await PGlite.create({ dataDir: PASTA })
// maxConnections tem padrao 1, e qualquer pool de conexao derruba isso na hora.
// ATENCAO: o PGlite e um Postgres de UM backend so. Varias conexoes sao
// multiplexadas por cima dele, entao duas transacoes ao mesmo tempo NAO se
// comportam como num Postgres de verdade. Para desenvolver sozinho serve;
// qualquer coisa sensivel a concorrencia tem que ser validada no Neon/Supabase.
// Por isso o pool da aplicacao fica em 1 (POOL_MAX no .env).
const servidor = new PGLiteSocketServer({
  db,
  port: PORTA,
  host: '127.0.0.1',
  // Folgado de propósito: o `next dev` deixa conexão para trás a cada
  // recarregamento, e um limite apertado transforma isso em "Connection
  // terminated unexpectedly" no meio do trabalho.
  maxConnections: 30,
})

servidor.addEventListener('connection', () => console.log('  → conexão recebida'))
servidor.addEventListener('error', (e: any) =>
  console.log('  ! erro:', e?.detail?.message ?? e?.detail ?? e),
)

await servidor.start()

console.log(`
  Banco do Norte no ar.

  porta   ${PORTA}
  dados   ${PASTA}
  url     postgresql://postgres:postgres@127.0.0.1:${PORTA}/postgres

  Deixe esta janela aberta. Ctrl+C encerra.
`)

const encerrar = async () => {
  console.log('\n  encerrando...')
  await servidor.stop()
  await db.close()
  process.exit(0)
}
process.on('SIGINT', encerrar)
process.on('SIGTERM', encerrar)
