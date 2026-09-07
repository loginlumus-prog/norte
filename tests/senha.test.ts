import { describe, it, expect } from 'vitest'
import {
  guardarSenha,
  conferirSenha,
  precisaTrocar,
  HASH_ISCA,
} from '../src/servidor/senha'

const SENHA = 'senha-de-teste-2026'

describe('guardar e conferir', () => {
  it('a senha certa passa', async () => {
    const h = await guardarSenha(SENHA)
    expect(await conferirSenha(SENHA, h)).toBe(true)
  })

  it('a senha errada não passa', async () => {
    const h = await guardarSenha(SENHA)
    expect(await conferirSenha(SENHA + 'x', h)).toBe(false)
    expect(await conferirSenha('', h)).toBe(false)
  })

  it('a senha nunca aparece no que é guardado', async () => {
    const h = await guardarSenha(SENHA)
    expect(h).not.toContain(SENHA)
  })

  it('a mesma senha gera hashes diferentes (sal)', async () => {
    const [a, b] = await Promise.all([guardarSenha(SENHA), guardarSenha(SENHA)])
    expect(a).not.toBe(b)
    // e os dois continuam válidos
    expect(await conferirSenha(SENHA, a)).toBe(true)
    expect(await conferirSenha(SENHA, b)).toBe(true)
  })

  it('acentos e emoji funcionam', async () => {
    const esquisita = 'coração-açaí-2026'
    const h = await guardarSenha(esquisita)
    expect(await conferirSenha(esquisita, h)).toBe(true)
    expect(await conferirSenha('coracao-acai-2026', h)).toBe(false)
  })
})

describe('formato guardado', () => {
  it('carrega algoritmo e parâmetros, para poder endurecer depois', async () => {
    const h = await guardarSenha(SENHA)
    const [algo, n, r, p, sal, derivado] = h.split('$')
    expect(algo).toBe('scrypt')
    expect(Number(n)).toBeGreaterThanOrEqual(16384)
    expect(Number(r)).toBeGreaterThan(0)
    expect(Number(p)).toBeGreaterThan(0)
    expect(Buffer.from(sal!, 'base64').length).toBeGreaterThanOrEqual(16)
    expect(Buffer.from(derivado!, 'base64').length).toBe(32)
  })
})

describe('não explode com lixo', () => {
  const lixos = ['', 'nada', 'scrypt$', 'scrypt$0$0$0$a$b', 'bcrypt$2b$10$xyz', '$$$$$']
  it.each(lixos)('conferir contra %j devolve false', async (l) => {
    expect(await conferirSenha(SENHA, l)).toBe(false)
  })
})

describe('senha fraca é recusada na hora de guardar', () => {
  it('curta demais', async () => {
    await expect(guardarSenha('1234567')).rejects.toThrow(/8 caracteres/)
  })
  it('longa demais (gasto de CPU à toa)', async () => {
    await expect(guardarSenha('a'.repeat(201))).rejects.toThrow(/longa/i)
  })
})

describe('hash isca', () => {
  it('nunca bate com nada — serve só para gastar tempo', async () => {
    expect(await conferirSenha(SENHA, HASH_ISCA)).toBe(false)
    expect(await conferirSenha('', HASH_ISCA)).toBe(false)
    expect(await conferirSenha('admin', HASH_ISCA)).toBe(false)
  })

  it('tem o mesmo formato de um hash real', async () => {
    // se o formato divergisse, conferir sairia cedo e o tempo denunciaria
    // que o usuário não existe — que é exatamente o que a isca evita
    expect(HASH_ISCA.split('$')).toHaveLength(6)
    expect(HASH_ISCA.startsWith('scrypt$')).toBe(true)
  })
})

describe('regravar quando os parâmetros endurecerem', () => {
  it('hash de hoje não precisa trocar', async () => {
    expect(precisaTrocar(await guardarSenha(SENHA))).toBe(false)
  })

  it('hash com custo menor precisa', () => {
    expect(precisaTrocar('scrypt$1024$8$1$c2Fs$aGFzaA==')).toBe(true)
  })

  it('algoritmo antigo precisa', () => {
    expect(precisaTrocar('bcrypt$2b$10$qualquercoisa')).toBe(true)
  })
})
