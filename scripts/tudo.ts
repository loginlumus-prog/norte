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
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createConnection } from 'node:net'
import { mkdirSync, readFileSync, watch } from 'node:fs'
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

// ── o cliente do Prisma acompanha o schema ───────────────────
// O `prisma generate` escreve um cliente dentro do node_modules, e é ELE que
// sabe quais campos existem. Mudar o schema.prisma sem gerar de novo deixa um
// cliente velho no processo — e o erro que sai é this:
//
//   PrismaClientValidationError: Invalid `prisma.org.update()` invocation
//   Unknown argument `porte`. Did you mean `nome`?
//
// Que na tela vira "Deu problema aqui do nosso lado", sem nenhuma pista de que
// a causa é um comando que faltou rodar. Já custou caro uma vez: o cadastro
// inicial parou de funcionar e o motivo estava a três camadas de distância.
//
// A conferência é por CONTEÚDO, não por data de arquivo: `git checkout` mexe
// na data sem mexer no conteúdo, e a gente geraria de novo à toa toda vez que
// trocasse de branch.
//
// (Isto cobre subir o sistema com o schema já mudado. Mudar o schema com o
// sistema NO AR continua pedindo um reinício — o cliente já está carregado na
// memória do processo, e nada aqui alcança isso.)
const copiaGerada = join(process.cwd(), 'node_modules', '.prisma', 'client', 'schema.prisma')
const atual = join(process.cwd(), 'prisma', 'schema.prisma')

const igual = (() => {
  try {
    return readFileSync(copiaGerada, 'utf8') === readFileSync(atual, 'utf8')
  } catch {
    return false
  }
})()

if (!igual) {
  console.log('  schema mudou — gerando o cliente do Prisma...\n')
  const r = spawnSync('npx prisma generate', { stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    console.error('\n  O `prisma generate` falhou. Sem ele o sistema sobe com o cliente velho.\n')
    process.exit(1)
  }
}

// O Next é aberto pelo ARQUIVO do binário, com o Node que já está rodando —
// e não por `npx next dev` numa shell. Dois motivos, e o segundo custou caro:
//
// 1. Com `shell: true` o Node avisa (DEP0190) que os argumentos vão
//    concatenados numa linha de comando em vez de passados um a um.
//
// 2. No Windows, `.kill()` num filho aberto com shell mata o `cmd.exe` e
//    DEIXA O NEXT VIVO por baixo, segurando a porta 3000. O reinício do vigia
//    de schema subia um Next novo, que morria com EADDRINUSE — e o
//    `on('exit')` dele encerrava o processo inteiro, banco junto. Foi assim
//    que o sistema caiu no meio de um teste, com "exited with code 1" e
//    nenhuma pista. Sem shell, o filho é o próprio node.exe do Next, e
//    `.kill()` mata quem tem que matar.
//
// Vem de uma função porque o site pode ser trocado por um novo em pé (o
// vigia, logo abaixo). E cada filho carrega o próprio `on('exit')` comparando
// consigo mesmo: sem isso, matar o site para reiniciar dispararia o
// encerramento geral.
const NEXT = createRequire(import.meta.url).resolve('next/dist/bin/next')

const ligarSite = () => {
  const p = spawn(process.execPath, [NEXT, 'dev'], { stdio: 'inherit' })
  p.on('exit', (c) => {
    if (p === web) void encerrar(c ?? 0)
  })
  return p
}

let web = ligarSite()

// ── o schema mudou com o sistema NO AR ───────────────────────
// A conferência lá em cima cobre subir com o schema já mudado. Falta o outro
// caso, que é o que mais acontece: mexer no schema COM o sistema rodando.
//
// O cliente do Prisma já está carregado na memória do processo, e nada o
// recarrega — nem o recarregamento do Next, que não olha para node_modules.
// O que sai é um erro que não fala do assunto:
//
//   Value 'GRATIS' not found in enum 'Plano'
//   Unknown argument `porte`. Did you mean `nome`?
//
// Que na tela vira "Deu problema aqui do nosso lado". Já custou caro três
// vezes nesta mesma semana, e as três levaram um tempo até alguém desconfiar
// de um comando que faltou rodar.
//
// Então o schema é vigiado: mudou, gera o cliente e sobe o Next de novo. São
// uns segundos, e é o que a pessoa faria na mão de qualquer jeito — só que
// sem passar pelo erro antes.
let recriando = false

watch(atual, { persistent: false }, () => {
  if (recriando) return
  recriando = true

  // O editor grava em duas etapas (escreve e renomeia), então o evento vem
  // mais de uma vez. Esperar um pouco junta tudo num reinício só.
  setTimeout(() => {
    try {
      if (readFileSync(copiaGerada, 'utf8') === readFileSync(atual, 'utf8')) {
        recriando = false
        return
      }
    } catch {}

    console.log('\n  schema mudou — gerando o cliente e subindo o site de novo...\n')
    const r = spawnSync('npx prisma generate', { stdio: 'inherit', shell: true })
    if (r.status === 0) {
      // A ordem importa duas vezes. Trocar a referência ANTES de matar faz o
      // `on('exit')` do antigo se ver fora de `web` e sair calado. E subir o
      // novo só DEPOIS de o antigo morrer de verdade — senão a porta ainda
      // está presa por um instante e o novo cai com EADDRINUSE.
      const antigo = web
      web = undefined as unknown as typeof antigo
      antigo.once('exit', () => {
        web = ligarSite()
      })
      antigo.kill()
    } else {
      console.error('\n  O `prisma generate` falhou. O site continua com o cliente velho.\n')
    }
    recriando = false
  }, 400)
})

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

process.on('SIGINT', () => encerrar(0))
process.on('SIGTERM', () => encerrar(0))
