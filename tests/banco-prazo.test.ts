// Banco inalcançável falha em segundos, não em minutos. Ver
// PRAZO_CONEXAO_MS em src/servidor/banco.ts.
//
// 10.255.255.1 é um endereço privado que não responde: o pacote some, que é
// o caso ruim (banco que RECUSA a conexão falha na hora de qualquer jeito).

import { describe, it, expect, beforeAll } from 'vitest'

let banco: typeof import('../src/servidor/banco')

beforeAll(async () => {
  process.env.DATABASE_URL_PORTARIA = 'postgresql://ninguem:nada@10.255.255.1:5432/nenhum'
  banco = await import('../src/servidor/banco')
})

describe('prazo de conexão', () => {
  it('as duas conexões nascem com prazo para conectar', () => {
    const o = banco.opcoesDoPool('postgresql://x@y/z', 3)
    expect(o.connectionTimeoutMillis).toBeGreaterThan(0)
    expect(o.connectionTimeoutMillis).toBeLessThanOrEqual(10_000)
    expect(o.max).toBe(3)
  })

  it('o /saude desiste do banco mudo no prazo dele, sem estourar', async () => {
    const inicio = Date.now()
    const r = await banco.pingBanco(300)
    expect(r.ok).toBe(false)
    // Folga para a máquina carregada (testes em paralelo): o que importa é
    // não chegar perto dos 21 s (Windows) ou 2 min (Linux) do TCP.
    expect(r.ok === false && r.motivo).toBe("prazo")
    expect(Date.now() - inicio).toBeLessThan(banco.PRAZO_CONEXAO_MS)
  })
})
