// A conexão com o banco cai (o pooler do Supabase derruba, a rede pisca):
// a consulta daquela hora falha com erro TRATÁVEL, o processo do Next não
// morre, e o pool se refaz sozinho para a próxima tela.
//
// Por que existe: o banco local (PGlite) já caiu por um 'error' de socket
// sem ouvinte — ECONNRESET vira exceção solta e derruba o processo inteiro.
// Aqui se prova que os pools da APLICAÇÃO (PrismaPg + pg-pool) têm ouvinte
// em toda fase: ociosa, no meio de consulta solta, e dentro de transação.
//
// Um proxy TCP no meio deixa o teste cortar a conexão na hora certa.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import net from 'node:net'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { subirBanco } from './banco'
import { opcoesDoPool } from '../src/servidor/banco'

let db: PGlite
let servidor: PGLiteSocketServer
let proxy: net.Server
let pool: pg.Pool
let prisma: PrismaClient
const pontas = new Set<net.Socket>()
const soltas: unknown[] = []
const pegar = (e: unknown) => soltas.push(e)

/** Corta toda conexão aberta, como o servidor do outro lado faria (RST). */
const derrubar = () => {
  for (const s of pontas) s.resetAndDestroy()
}
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  process.on('uncaughtException', pegar)
  db = await subirBanco()
  const portaBanco = 59000 + Math.floor(Math.random() * 500)
  servidor = new PGLiteSocketServer({ db, port: portaBanco, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()

  proxy = net.createServer((cliente) => {
    const banco = net.connect(portaBanco, '127.0.0.1')
    pontas.add(cliente)
    cliente.on('close', () => {
      pontas.delete(cliente)
      banco.destroy()
    })
    banco.on('close', () => cliente.destroy())
    cliente.on('error', () => {})
    banco.on('error', () => {})
    cliente.pipe(banco)
    banco.pipe(cliente)
  })
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
  const porta = (proxy.address() as net.AddressInfo).port
  pool = new pg.Pool(opcoesDoPool(`postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`, 2))
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
}, 60_000)

afterAll(async () => {
  process.off('uncaughtException', pegar)
  await prisma?.$disconnect()
  // O pool é nosso (PrismaPg não fecha pool que recebeu pronto).
  await pool?.end()
  derrubar()
  await new Promise((r) => proxy?.close(r))
  await servidor?.stop()
  await db?.close()
})

describe('queda de conexão', () => {
  it('ociosa: a próxima consulta abre outra, sem erro', async () => {
    await prisma.$queryRaw`select 1`
    derrubar()
    await dorme(100)
    await expect(prisma.$queryRaw`select 1`).resolves.toBeTruthy()
  })

  it('no meio de consulta solta: erro tratável, não exceção solta', async () => {
    const q = prisma.$queryRaw`select pg_sleep(0.5)`
    await dorme(100)
    derrubar()
    await expect(q).rejects.toThrow()
  })

  it('dentro de transação: a transação falha e a conexão quebrada sai do pool', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`select 1`
        derrubar()
        await dorme(100)
        await tx.$queryRaw`select 1`
      }),
    ).rejects.toThrow()
    await dorme(200)
    expect(pool.totalCount).toBe(0)
  })

  it('depois de tudo: o pool se refez e o processo não viu exceção solta', async () => {
    await expect(prisma.$queryRaw`select 1`).resolves.toBeTruthy()
    expect(soltas).toEqual([])
  })
})
