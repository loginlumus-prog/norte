// Quem entra, quem fica de fora, e quem perde a vaga.
//
// Esta é a regra que decide se alguém consegue trabalhar. Errar para o lado
// frouxo é dar de graça o que se cobra; errar para o lado apertado é a caixa
// com cliente na frente sem conseguir entrar. Os dois erros são caros, e o
// segundo é o que faz cancelar.

import { describe, it, expect } from 'vitest'
import {
  decidirEntrada,
  precisaTrancar,
  VAGA_LIVRE_MIN,
  TRANCA_MIN,
  type Presente,
} from '../src/servidor/presenca'

const AGORA = new Date('2026-09-10T14:00:00Z')
const atras = (min: number) => new Date(AGORA.getTime() - min * 60000)

const pessoa = (id: string, paradaMin: number): Presente => ({
  usuarioId: id,
  nome: id,
  desde: atras(120),
  ultimoSinal: atras(paradaMin),
})

const caixa = { usuarioId: 'nova', ehDono: false }
const dona = { usuarioId: 'dona', ehDono: true }

describe('quando ainda tem vaga', () => {
  it('entra sem derrubar ninguém', () => {
    const v = decidirEntrada(AGORA, [pessoa('a', 0), pessoa('b', 0)], caixa, 3)
    expect(v.pode).toBe(true)
    if (v.pode) expect(v.derrubar).toBeFalsy()
  })

  it('plano sem teto nunca barra', () => {
    const muitos = Array.from({ length: 40 }, (_, i) => pessoa(`p${i}`, 0))
    expect(decidirEntrada(AGORA, muitos, caixa, null).pode).toBe(true)
  })
})

describe('quem já está dentro não gasta vaga de novo', () => {
  // Abrir o sistema no celular tendo o computador aberto é a MESMA pessoa.
  // Cobrar por isso seria cobrar por aparelho — que é justamente o que a gente
  // decidiu não fazer.
  it('a mesma pessoa entra outra vez com a casa cheia', () => {
    const cheio = [pessoa('a', 0), pessoa('b', 0), pessoa('c', 0)]
    const v = decidirEntrada(AGORA, cheio, { usuarioId: 'b', ehDono: false }, 3)
    expect(v.pode).toBe(true)
    if (v.pode) expect(v.derrubar).toBeFalsy()
  })
})

describe('com a casa cheia', () => {
  const cheio = () => [pessoa('a', 1), pessoa('b', 2), pessoa('c', 3)]

  it('barra, e diz quem está ocupando', () => {
    const v = decidirEntrada(AGORA, cheio(), caixa, 3)
    expect(v.pode).toBe(false)
    if (!v.pode) {
      expect(v.ocupantes).toHaveLength(3)
      // A mais parada primeiro: é dela que a vaga sai, e é ela que a tela
      // deve sugerir. Sugerir a mais recente seria sugerir quem está vendendo.
      expect(v.ocupantes[0]!.usuarioId).toBe('c')
      expect(v.ocupantes.every((o) => !o.tomavel)).toBe(true)
    }
  })

  it('mas vaga parada é tomada sem pedir nada a ninguém', () => {
    const com = [pessoa('a', 1), pessoa('b', VAGA_LIVRE_MIN + 5), pessoa('c', 3)]
    const v = decidirEntrada(AGORA, com, caixa, 3)
    expect(v.pode).toBe(true)
    if (v.pode) expect(v.derrubar?.usuarioId).toBe('b')
  })

  it('e no limite exato do tempo ela já conta como parada', () => {
    const com = [pessoa('a', 1), pessoa('b', VAGA_LIVRE_MIN), pessoa('c', 3)]
    const v = decidirEntrada(AGORA, com, caixa, 3)
    expect(v.pode).toBe(true)
  })

  it('entre duas paradas, sai a que está parada há mais tempo', () => {
    const com = [
      pessoa('a', VAGA_LIVRE_MIN + 1),
      pessoa('b', VAGA_LIVRE_MIN + 40),
      pessoa('c', 1),
    ]
    const v = decidirEntrada(AGORA, com, caixa, 3)
    if (v.pode) expect(v.derrubar?.usuarioId).toBe('b')
  })
})

describe('o dono nunca fica do lado de fora', () => {
  // Se ele não consegue entrar para resolver o problema, o produto está
  // quebrado — e é ele quem paga por ele.
  it('entra mesmo com todo mundo trabalhando, derrubando o mais parado', () => {
    const trabalhando = [pessoa('a', 0), pessoa('b', 2), pessoa('c', 1)]
    const v = decidirEntrada(AGORA, trabalhando, dona, 3)
    expect(v.pode).toBe(true)
    if (v.pode) expect(v.derrubar?.usuarioId).toBe('b')
  })

  it('e a caixa, no mesmo caso, é barrada', () => {
    const trabalhando = [pessoa('a', 0), pessoa('b', 2), pessoa('c', 1)]
    expect(decidirEntrada(AGORA, trabalhando, caixa, 3).pode).toBe(false)
  })
})

describe('o plano grátis é de uma pessoa por vez', () => {
  it('a segunda não entra', () => {
    expect(decidirEntrada(AGORA, [pessoa('a', 1)], caixa, 1).pode).toBe(false)
  })

  it('mas se a primeira parou, a segunda assume', () => {
    const v = decidirEntrada(AGORA, [pessoa('a', VAGA_LIVRE_MIN + 1)], caixa, 1)
    expect(v.pode).toBe(true)
  })
})

describe('trancar não é o mesmo que perder a vaga', () => {
  // São dois relógios, e essa é a decisão que protege a venda em andamento: a
  // vaga se solta cedo (é barato e reversível), a tela só tranca muito depois
  // (é o que pede a senha de novo).
  it('a vaga se solta antes de a tela trancar', () => {
    expect(VAGA_LIVRE_MIN).toBeLessThan(TRANCA_MIN)
  })

  it('parada dentro do prazo não tranca', () => {
    expect(precisaTrancar(AGORA, atras(TRANCA_MIN - 1))).toBe(false)
  })

  it('parada além do prazo tranca', () => {
    expect(precisaTrancar(AGORA, atras(TRANCA_MIN + 1))).toBe(true)
  })

  it('quem perdeu a vaga por inatividade ainda NÃO estava trancado', () => {
    // O caso que mostra que os dois relógios são mesmo diferentes: aos 15
    // minutos a vaga já pode ser tomada, e a tela da pessoa continua aberta
    // com a venda dela do jeito que estava.
    const quinze = atras(15)
    expect(precisaTrancar(AGORA, quinze)).toBe(false)
    const v = decidirEntrada(AGORA, [pessoa('a', 15)], caixa, 1)
    expect(v.pode).toBe(true)
  })
})
