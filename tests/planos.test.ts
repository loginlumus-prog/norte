// A tabela de planos, conferida.
//
// Ela é a única coisa deste sistema que fala com o dinheiro do cliente, e ela
// é lida em três lugares que precisam concordar: a página de venda, a tela de
// assinatura e as travas que barram criar a quarta loja. Número errado aqui
// vira promessa quebrada lá.
//
// ── o modelo, em uma frase ───────────────────────────────────
// Cadastrar gente é de graça em qualquer plano. O que se paga é quanta gente
// fica DENTRO ao mesmo tempo (`vagas`) e quantas lojas existem (`unidades`).

import { describe, it, expect } from 'vitest'
import {
  podeCriarUnidade,
  podeAbrirVaga,
  mensalidade,
  PLANOS,
  ORDEM,
  mudanca,
  menorQueCabe,
  planoLibera,
  RECURSOS,
  LIBERACOES,
  liberado,
  planoQueAbre,
  doPlano,
  GRUPOS,
} from '../src/servidor/planos'
import { TODOS } from '../src/servidor/modulos'

// ─────────────────────────────────────────────────────────────
// LOJAS
// ─────────────────────────────────────────────────────────────

describe('quantas lojas cabem', () => {
  it('o Grátis é de uma loja só', () => {
    expect(podeCriarUnidade('GRATIS', 0)).toEqual({ pode: true, custoExtra: 0 })
    expect(podeCriarUnidade('GRATIS', 1).pode).toBe(false)
  })

  it('o Balcão vai até três', () => {
    for (let n = 0; n < 3; n++) {
      expect(podeCriarUnidade('BALCAO', n), `com ${n} lojas`).toEqual({
        pode: true,
        custoExtra: 0,
      })
    }
    expect(podeCriarUnidade('BALCAO', 3).pode).toBe(false)
  })

  it('o Balcão + Assistente vai até cinco', () => {
    expect(podeCriarUnidade('BALCAO_AGENTE', 4).pode).toBe(true)
    expect(podeCriarUnidade('BALCAO_AGENTE', 5).pode).toBe(false)
  })

  it('a Rede e o Corporativo não têm teto', () => {
    expect(podeCriarUnidade('REDE', 200)).toEqual({ pode: true, custoExtra: 0 })
    expect(podeCriarUnidade('CORPORATIVO', 200)).toEqual({ pode: true, custoExtra: 0 })
  })

  // Barrar sem dizer para onde ir é barrar duas vezes.
  it('quando barra, diz o motivo e o caminho', () => {
    const r = podeCriarUnidade('BALCAO', 3)
    expect(r.pode).toBe(false)
    if (!r.pode) {
      expect(r.motivo).toMatch(/3 unidades/)
      expect(r.sugestao).toBe('REDE')
    }
  })
})

// ─────────────────────────────────────────────────────────────
// VAGAS — quanta gente dentro ao mesmo tempo
// ─────────────────────────────────────────────────────────────

describe('quanta gente cabe dentro ao mesmo tempo', () => {
  it('no Grátis é uma pessoa, e a segunda não entra', () => {
    expect(podeAbrirVaga('GRATIS', 0)).toEqual({ pode: true, custoExtra: 0 })
    const r = podeAbrirVaga('GRATIS', 1)
    expect(r.pode).toBe(false)
    // Quem esbarra no grátis tem que ser mandado para o primeiro plano pago,
    // não para o topo da tabela: sugestão fora de escala não é sugestão.
    if (!r.pode) expect(r.sugestao).toBe('BALCAO')
  })

  it('no Balcão são três, e a quarta CABE pagando', () => {
    expect(podeAbrirVaga('BALCAO', 2)).toEqual({ pode: true, custoExtra: 0 })

    const quarta = podeAbrirVaga('BALCAO', 3)
    expect(quarta.pode).toBe(true)
    if (quarta.pode && 'novoTotal' in quarta) {
      expect(quarta.custoExtra).toBe(40)
      expect(quarta.novoTotal).toBe(100 + 40)
    }
  })

  it('e cada pessoa a mais soma outra vez o mesmo valor', () => {
    const quarta = podeAbrirVaga('BALCAO', 3)
    const quinta = podeAbrirVaga('BALCAO', 4)
    if (quarta.pode && 'novoTotal' in quarta && quinta.pode && 'novoTotal' in quinta) {
      expect(quinta.novoTotal - quarta.novoTotal).toBe(40)
    }
  })

  it('a Rede e o Corporativo não contam vaga', () => {
    expect(podeAbrirVaga('REDE', 500)).toEqual({ pode: true, custoExtra: 0 })
    expect(podeAbrirVaga('CORPORATIVO', 500)).toEqual({ pode: true, custoExtra: 0 })
  })
})

// ─────────────────────────────────────────────────────────────
// A CONTA
// ─────────────────────────────────────────────────────────────

describe('a conta do mês', () => {
  it('o Grátis é zero, e zero não é o mesmo que sob consulta', () => {
    expect(mensalidade('GRATIS', 1).total).toBe(0)
    expect(mensalidade('CORPORATIVO', 40).total).toBeNull()
  })

  it('nenhum plano cobra por loja extra: a cota é a cota', () => {
    for (const [nome, p] of Object.entries(PLANOS)) {
      expect(p.porUnidadeExtra, `${nome} cobra por loja extra`).toBeNull()
    }
  })

  it('três lojas no Balcão é só a base', () => {
    expect(mensalidade('BALCAO', 3)).toMatchObject({ base: 100, extras: 0, total: 100 })
  })

  it('a Rede é a base, com quantas lojas for', () => {
    expect(mensalidade('REDE', 40)).toMatchObject({ extras: 0, total: 1500 })
  })
})

// ─────────────────────────────────────────────────────────────
// TROCAR DE PLANO
// ─────────────────────────────────────────────────────────────

describe('o que muda ao trocar de plano', () => {
  const pequeno = { unidades: 1 }

  it('do Grátis para o Balcão: ganha nota fiscal e mais de uma loja', () => {
    const m = mudanca('GRATIS', 'BALCAO', pequeno)
    expect(m.sentido).toBe('subir')
    expect(m.diferenca).toBe(100)
    expect(m.ganha).toContain('notaFiscal')
    expect(m.ganha).toContain('multiUnidade')
    expect(m.perde).toEqual([])
  })

  it('subir mostra o que ganha, e a diferença de preço', () => {
    const m = mudanca('BALCAO', 'BALCAO_AGENTE', pequeno)
    expect(m.sentido).toBe('subir')
    expect(m.diferenca).toBe(350 - 100)
    expect(m.ganha).toContain('agente')
    expect(m.perde).toEqual([])
  })

  // O caso que faz o cliente cancelar quando ninguém avisa.
  it('descer mostra o que PERDE, e não só o desconto', () => {
    const m = mudanca('REDE', 'BALCAO', pequeno)
    expect(m.sentido).toBe('descer')
    expect(m.diferenca).toBe(100 - 1500)
    expect(m.perde).toContain('crediario')
    expect(m.perde).toContain('agente')
  })

  it('descer para o Grátis perde tudo que é módulo', () => {
    const m = mudanca('REDE', 'GRATIS', pequeno)
    expect(m.perde).toContain('notaFiscal')
    expect(m.perde).toContain('agente')
    expect(m.perde).toContain('multiUnidade')
    expect(m.ganha).toEqual([])
  })

  it('trocar para o mesmo plano não muda nada', () => {
    const m = mudanca('REDE', 'REDE', pequeno)
    expect(m.sentido).toBe('igual')
    expect(m.diferenca).toBe(0)
    expect(m.ganha).toEqual([])
    expect(m.perde).toEqual([])
  })

  it('para o Corporativo não existe diferença de preço: é sob consulta', () => {
    const m = mudanca('REDE', 'CORPORATIVO', pequeno)
    expect(m.novoMensal).toBeNull()
    expect(m.diferenca).toBeNull()
  })
})

describe('descer com mais loja do que cabe é recusado', () => {
  it('oito lojas não cabem no Balcão, e a mensagem diz quantas tirar', () => {
    const m = mudanca('REDE', 'BALCAO', { unidades: 8 })
    expect(m.impedimentos.length).toBe(1)
    expect(m.impedimentos[0]).toContain('8')
    expect(m.impedimentos[0]).toContain('Desative 5')
  })

  // Vaga NÃO impede descer: ela é do instante, não é dado que se perde. Quem
  // ficar de fora simplesmente não entra na próxima vez — e isso a tela avisa,
  // sem travar a troca.
  it('mas quantidade de gente não impede: cadastro é livre em todo plano', () => {
    const m = mudanca('REDE', 'GRATIS', { unidades: 1 })
    expect(m.impedimentos).toEqual([])
  })

  it('subir nunca impede', () => {
    for (const uso of [{ unidades: 1 }, { unidades: 40 }]) {
      expect(mudanca('GRATIS', 'CORPORATIVO', uso).impedimentos).toEqual([])
    }
  })
})

describe('o menor plano que cabe', () => {
  it('uma loja cabe no Grátis', () => expect(menorQueCabe({ unidades: 1 })).toBe('GRATIS'))
  it('duas lojas já pedem o Balcão', () => expect(menorQueCabe({ unidades: 2 })).toBe('BALCAO'))
  it('quatro lojas pedem o Balcão + Assistente', () =>
    expect(menorQueCabe({ unidades: 4 })).toBe('BALCAO_AGENTE'))
  it('seis lojas pedem a Rede', () => expect(menorQueCabe({ unidades: 6 })).toBe('REDE'))
})

// ─────────────────────────────────────────────────────────────
// COERÊNCIA DA TABELA
// ─────────────────────────────────────────────────────────────

describe('o plano decide quais módulos existem', () => {
  it('o Grátis não tem módulo nenhum', () => {
    expect(PLANOS.GRATIS.modulos).toEqual([])
    for (const m of TODOS) expect(planoLibera('GRATIS', m), m).toBe(false)
  })

  it('o Balcão tem nota fiscal e mais de uma loja, mas não agente nem crediário', () => {
    expect(planoLibera('BALCAO', 'notaFiscal')).toBe(true)
    expect(planoLibera('BALCAO', 'multiUnidade')).toBe(true)
    expect(planoLibera('BALCAO', 'agente')).toBe(false)
    expect(planoLibera('BALCAO', 'crediario')).toBe(false)
  })

  it('o Balcão + Assistente tem agente mas não crediário', () => {
    expect(planoLibera('BALCAO_AGENTE', 'agente')).toBe(true)
    expect(planoLibera('BALCAO_AGENTE', 'crediario')).toBe(false)
  })

  // A regra é: quem tem assistente tem crédito, quem não tem não tem. O
  // Corporativo cumpre por outro caminho — o crédito dele existe e sai no
  // contrato, e é isso que `null` quer dizer. Zero seria outra coisa: seria
  // "tem assistente e não tem com que rodar", que não é plano nenhum.
  it('todo plano com agente tem crédito, e sem agente tem zero', () => {
    for (const p of ORDEM) {
      const c = PLANOS[p].creditoMensal
      if (planoLibera(p, 'agente')) expect(c === null || c > 0, `${p} tem agente sem crédito`).toBe(true)
      else expect(c, `${p} não tem agente mas tem crédito`).toBe(0)
    }
  })

  it('e só o Corporativo deixa o crédito para o contrato', () => {
    for (const p of ORDEM) {
      if (p !== 'CORPORATIVO') expect(PLANOS[p].creditoMensal, p).not.toBeNull()
    }
    expect(PLANOS.CORPORATIVO.creditoMensal).toBeNull()
  })

  it('nenhum plano libera módulo que não existe', () => {
    for (const p of ORDEM) {
      for (const m of PLANOS[p].modulos) expect(TODOS, `${p} libera ${m}`).toContain(m)
    }
  })

  // Subir de plano nunca pode TIRAR coisa. Se isso acontecer, a tela de troca
  // passa a mostrar "você perde X" numa subida — e o cliente para de subir.
  it('subir de plano nunca tira módulo', () => {
    for (let i = 1; i < ORDEM.length; i++) {
      const antes = PLANOS[ORDEM[i - 1]!].modulos
      const depois = PLANOS[ORDEM[i]!].modulos
      for (const m of antes) {
        expect(depois, `${ORDEM[i]} não tem ${m}, que ${ORDEM[i - 1]} tinha`).toContain(m)
      }
    }
  })

  it('e a cota de loja e de vaga nunca encolhe ao subir', () => {
    const teto = (n: number | null) => (n === null ? Infinity : n)
    for (let i = 1; i < ORDEM.length; i++) {
      const antes = PLANOS[ORDEM[i - 1]!]
      const depois = PLANOS[ORDEM[i]!]
      expect(teto(depois.unidades), `lojas em ${ORDEM[i]}`).toBeGreaterThanOrEqual(
        teto(antes.unidades),
      )
      expect(teto(depois.vagas), `vagas em ${ORDEM[i]}`).toBeGreaterThanOrEqual(teto(antes.vagas))
    }
  })
})

// A tabela de comparacao e a tabela de planos precisam contar a MESMA coisa.
// Ja divergiram: a linha do credito dizia "R$ 120/mes" depois de o plano virar
// 100, porque o numero estava escrito a mao nos dois lugares. Agora ele e
// derivado — e este teste e o que impede alguem de escrever a mao de novo.
describe('a tabela de comparação não pode divergir dos planos', () => {
  const acha = (titulo: string) => {
    const r = RECURSOS.find((x) => x.titulo === titulo)
    if (!r) throw new Error(`sem a linha "${titulo}"`)
    return r
  }

  it('o crédito na tabela é o crédito do plano', () => {
    const r = acha('Crédito de IA incluso')
    for (const p of ORDEM) {
      const c = PLANOS[p].creditoMensal
      if (!planoLibera(p, 'agente')) continue
      const dito = r.detalhe?.[p] ?? ''
      if (c === null) expect(dito, p).toBe('no contrato')
      else expect(dito, p).toContain(String(c))
    }
  })

  it('o número de lojas na tabela é a cota do plano', () => {
    const r = acha('Lojas')
    for (const p of ORDEM) {
      const n = PLANOS[p].unidades
      const dito = r.detalhe?.[p] ?? ''
      if (n === null) expect(dito, p).toBe('à vontade')
      else expect(dito, p).toContain(String(n))
    }
  })

  it('o número de vagas na tabela é a cota do plano, com o preço da extra', () => {
    const r = acha('Dentro ao mesmo tempo')
    for (const p of ORDEM) {
      const l = PLANOS[p]
      const dito = r.detalhe?.[p] ?? ''
      if (l.vagas === null) expect(dito, p).toBe('à vontade')
      else {
        expect(dito, p).toContain(String(l.vagas))
        if (l.porVagaExtra) expect(dito, p).toContain(String(l.porVagaExtra))
      }
    }
  })

  it('nenhuma linha promete recurso em plano que não o tem', () => {
    for (const r of RECURSOS) {
      for (const p of Object.keys(r.detalhe ?? {}) as (keyof typeof PLANOS)[]) {
        expect(r.em, `${r.titulo} detalha ${p} sem ter ${p}`).toContain(p)
      }
    }
  })
})

describe('o teto de vendas é só do Grátis', () => {
  it('nenhum plano pago tem teto', () => {
    for (const p of ORDEM) {
      if (p === 'GRATIS') expect(PLANOS[p].tetoVendasMes).toBeGreaterThan(0)
      else expect(PLANOS[p].tetoVendasMes, p).toBeNull()
    }
  })

  it('e o plano grátis não vende vaga extra: o caminho dele é subir', () => {
    expect(PLANOS.GRATIS.porVagaExtra).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// A ESCADA: o que cada plano abre dentro de uma tela
// ─────────────────────────────────────────────────────────────

describe('a escada do que cada plano abre', () => {
  const chaves = Object.keys(LIBERACOES) as (keyof typeof LIBERACOES)[]

  it('todo degrau aponta para um plano que existe', () => {
    for (const c of chaves) expect(ORDEM, c).toContain(LIBERACOES[c].desde)
  })

  // Subir de plano nunca pode TRANCAR o que estava aberto. É a mesma regra
  // dos módulos, pelo mesmo motivo: a tela de troca mostraria perda numa
  // subida, e o cliente para de subir.
  it('subir de plano nunca tranca o que estava aberto', () => {
    for (const c of chaves) {
      let aberto = false
      for (const p of ORDEM) {
        const agora = liberado(p, c)
        if (aberto) expect(agora, `${c} fecha em ${p}`).toBe(true)
        aberto = agora
      }
    }
  })

  it('o Grátis tem o quadro, e só ele; o Corporativo abre tudo', () => {
    expect(liberado('GRATIS', 'tarefas.quadro')).toBe(true)
    expect(liberado('GRATIS', 'tarefas.responsavel')).toBe(false)
    expect(liberado('GRATIS', 'tarefas.linhaDoTempo')).toBe(false)
    for (const c of chaves) expect(liberado('CORPORATIVO', c), c).toBe(true)
  })

  it('a linha do tempo e o desempenho são do Assistente; a rede, da Direção', () => {
    expect(liberado('BALCAO', 'tarefas.linhaDoTempo')).toBe(false)
    expect(liberado('BALCAO_AGENTE', 'tarefas.linhaDoTempo')).toBe(true)
    expect(liberado('BALCAO_AGENTE', 'desempenho.basico')).toBe(true)
    expect(liberado('BALCAO_AGENTE', 'tarefas.rede')).toBe(false)
    expect(liberado('REDE', 'tarefas.rede')).toBe(true)
    expect(liberado('REDE', 'ruptura.previsao')).toBe(true)
  })

  it('a frase do cadeado sai com o artigo do plano', () => {
    expect(doPlano('BALCAO')).toBe('do Balcão')
    expect(doPlano('REDE')).toBe('da Direção')
    expect(planoQueAbre('tarefas.rede').codigo).toBe('REDE')
  })

  // A tabela de comparação promete em texto o que a escada abre em código.
  // As duas precisam concordar, senão a página de venda vende uma coisa e a
  // tela entrega outra.
  it('a tabela de comparação concorda com a escada', () => {
    const acha = (t: string) => RECURSOS.find((r) => r.titulo === t)!
    const quadro = acha('Quadro de tarefas da equipe')
    for (const p of ORDEM) expect(quadro.em, p).toContain(p)
    const detalhes = acha('Responsável, prazo e prioridade na tarefa')
    for (const p of ORDEM) expect(detalhes.em.includes(p), p).toBe(liberado(p, 'tarefas.responsavel'))
    const rede = acha('Quadro da rede inteira, loja a loja')
    for (const p of ORDEM) expect(rede.em.includes(p), p).toBe(liberado(p, 'tarefas.rede'))
    const desempenho = acha('Desempenho da equipe em estrelas')
    for (const p of ORDEM) expect(desempenho.em.includes(p), p).toBe(liberado(p, 'desempenho.basico'))
    const ruptura = acha('Previsão de ruptura com prazo de reposição')
    expect(ruptura.quando).toBeUndefined()
    for (const p of ORDEM) expect(ruptura.em.includes(p), p).toBe(liberado(p, 'ruptura.previsao'))
  })

  it('todo recurso da tabela está num grupo que a tabela desenha', () => {
    for (const r of RECURSOS) expect(GRUPOS, r.titulo).toContain(r.grupo)
  })
})
