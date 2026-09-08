// Sobe o sistema inteiro com um comando: o banco e o site, na ordem certa.
//
//   npm run dev
//
// Antes eram dois comandos em duas janelas, e esquecer o primeiro dava isto,
// na cara de quem só queria ver o site:
//
//   PrismaClientKnownRequestError
//   Can't reach database server at 127.0.0.1:5433
//
// Ou seja: um erro de programador, com caminho de arquivo e pilha, para dizer
// "faltou ligar o banco". Ferramenta que exige ordem certa de dois comandos
// vai ser usada errado — não porque a pessoa é distraída, mas porque nada na
// tela lembra dela. Então o comando passou a ser um só.
//
// O banco sobe DENTRO deste processo (não é um filho): assim ele morre junto,
// e não fica um PGlite pendurado na 5433 travando a próxima subida.

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PASTA = join(process.cwd(), '.banco')
const PORTA = Number(process.env.PORTA_BANCO ?? 5433)

/** Já tem alguém na porta? Então é um `npm run banco` aberto noutra janela. */
const portaOcupada = () =>
  new Promise<boolean>((responder) => {
    const s = createConnection({ port: PORTA, host: '127.0.0.1' })
    s.once('connect', () => {
      s.destroy()
      responder(true)
    })
    s.once('error', () => responder(false))
  })

let servidor: PGLiteSocketServer | undefined
let db: PGlite | undefined

if (await portaOcupada()) {
  console.log(`\n  banco já está no ar na ${PORTA} — aproveitando esse\n`)
} else {
  mkdirSync(PASTA, { recursive: true })
  db = await PGlite.create({ dataDir: PASTA })
  servidor = new PGLiteSocketServer({ db, port: PORTA, host: '127.0.0.1', maxConnections: 30 })
  await servidor.start()
  console.log(`\n  banco no ar na ${PORTA}  (dados em .banco/)\n`)
}

// Comando inteiro numa string só, e não `spawn(cmd, [args])`: com `shell: true`
// o Node avisa (DEP0190) que argumentos separados não são escapados. Aqui são
// constantes, mas o aviso aparecia toda vez que alguém subia o sistema.
const web = spawn('npx next dev', { stdio: 'inherit', shell: true })

// Um encerramento só para os dois. Sem isto, Ctrl+C mata o Next e deixa o
// banco segurando a porta — e a próxima subida falha com EADDRINUSE, que é
// outro erro de programador na cara de quem só queria trabalhar.
let encerrando = false
const encerrar = async (codigo = 0) => {
  if (encerrando) return
  encerrando = true
  web.kill()
  if (servidor) await servidor.stop()
  if (db) await db.close()
  process.exit(codigo)
}

web.on('exit', (c) => encerrar(c ?? 0))
process.on('SIGINT', () => encerrar(0))
process.on('SIGTERM', () => encerrar(0))
