// A cifra dos segredos de cliente guardados no banco (src/servidor/cifra.ts).
//
// O que precisa ser verdade para o token do Z-API de uma loja poder morar no
// banco: volta igual com a chave certa, não volta com nenhuma outra coisa —
// chave errada, byte mexido, etiqueta cortada, texto de outra empresa ou de
// outro campo —, e sem chave nada é gravado.

import { describe, it, expect, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { cifrar, decifrar, lerChave, temCifra, SemChaveDeCifra } from '../src/servidor/cifra'

const CHAVE = randomBytes(32)
const OUTRA = randomBytes(32)
const CTX = 'agente:org-a:zapi_token'
const TOKEN = 'F1A2B3C4D5E6F7A8B9C0D1E2'

const antes = process.env.NORTE_CIFRA
afterEach(() => {
  if (antes === undefined) delete process.env.NORTE_CIFRA
  else process.env.NORTE_CIFRA = antes
})

/** Troca um caractere de uma das partes do texto guardado. */
function mexer(guardado: string, parte: 1 | 2 | 3): string {
  const p = guardado.split('.')
  const s = p[parte]!
  p[parte] = (s[0] === 'A' ? 'B' : 'A') + s.slice(1)
  return p.join('.')
}

describe('cifra: ida e volta', () => {
  it('volta igual com a mesma chave e o mesmo contexto', () => {
    const g = cifrar(TOKEN, CTX, CHAVE)
    expect(g).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(g).not.toContain(TOKEN)
    expect(decifrar(g, CTX, CHAVE)).toBe(TOKEN)
  })

  it('o mesmo token cifrado duas vezes dá dois textos diferentes (IV novo)', () => {
    const a = cifrar(TOKEN, CTX, CHAVE)
    const b = cifrar(TOKEN, CTX, CHAVE)
    expect(a).not.toBe(b)
    expect(decifrar(a, CTX, CHAVE)).toBe(decifrar(b, CTX, CHAVE))
  })

  it('texto com acento e vazio também vão e voltam', () => {
    expect(decifrar(cifrar('ção', CTX, CHAVE), CTX, CHAVE)).toBe('ção')
    expect(decifrar(cifrar('', CTX, CHAVE), CTX, CHAVE)).toBe('')
  })
})

describe('cifra: o que NÃO abre', () => {
  it('chave errada', () => {
    expect(decifrar(cifrar(TOKEN, CTX, CHAVE), CTX, OUTRA)).toBeNull()
  })

  it('qualquer parte mexida: IV, etiqueta ou o próprio cifrado', () => {
    const g = cifrar(TOKEN, CTX, CHAVE)
    expect(decifrar(mexer(g, 1), CTX, CHAVE)).toBeNull()
    expect(decifrar(mexer(g, 2), CTX, CHAVE)).toBeNull()
    expect(decifrar(mexer(g, 3), CTX, CHAVE)).toBeNull()
  })

  it('etiqueta cortada não vale, mesmo sendo o começo da certa', () => {
    const [v, iv, tag, c] = cifrar(TOKEN, CTX, CHAVE).split('.') as [string, string, string, string]
    const curta = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url')
    expect(decifrar([v, iv, curta, c].join('.'), CTX, CHAVE)).toBeNull()
  })

  it('o token da empresa A copiado para a B, ou para o outro campo, não abre', () => {
    const g = cifrar(TOKEN, 'agente:org-a:zapi_token', CHAVE)
    expect(decifrar(g, 'agente:org-b:zapi_token', CHAVE)).toBeNull()
    expect(decifrar(g, 'agente:org-a:zapi_client_token', CHAVE)).toBeNull()
  })

  it('formato estranho é só "não": versão desconhecida, pedaço faltando, lixo', () => {
    const g = cifrar(TOKEN, CTX, CHAVE)
    expect(decifrar(g.replace(/^v1/, 'v2'), CTX, CHAVE)).toBeNull()
    expect(decifrar(g.split('.').slice(0, 3).join('.'), CTX, CHAVE)).toBeNull()
    expect(decifrar('texto aberto', CTX, CHAVE)).toBeNull()
    expect(decifrar(TOKEN, CTX, CHAVE)).toBeNull()
  })
})

describe('cifra: a chave do servidor', () => {
  it('aceita 32 bytes em base64, base64url ou hex; recusa o resto', () => {
    const k = randomBytes(32)
    expect(lerChave(k.toString('base64'))?.equals(k)).toBe(true)
    expect(lerChave(k.toString('base64url'))?.equals(k)).toBe(true)
    expect(lerChave(k.toString('hex'))?.equals(k)).toBe(true)
    expect(lerChave(randomBytes(16).toString('base64'))).toBeNull()
    expect(lerChave(randomBytes(31).toString('hex'))).toBeNull()
    expect(lerChave('uma-senha-qualquer')).toBeNull()
    expect(lerChave('')).toBeNull()
    expect(lerChave(undefined)).toBeNull()
  })

  it('sem NORTE_CIFRA: cifrar RECUSA com recado claro, e nada decifra', () => {
    delete process.env.NORTE_CIFRA
    expect(temCifra()).toBe(false)
    expect(() => cifrar(TOKEN, CTX)).toThrow(SemChaveDeCifra)
    expect(() => cifrar(TOKEN, CTX)).toThrow(/NORTE_CIFRA/)
    expect(decifrar(cifrar(TOKEN, CTX, CHAVE), CTX)).toBeNull()
  })

  it('com NORTE_CIFRA no ambiente, é ela que vale', () => {
    process.env.NORTE_CIFRA = CHAVE.toString('base64')
    expect(temCifra()).toBe(true)
    expect(decifrar(cifrar(TOKEN, CTX), CTX, CHAVE)).toBe(TOKEN)
  })
})
