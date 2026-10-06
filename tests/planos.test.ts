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
  somar,
  respostasDoPlano,
  planoPermitePoder,
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
  PRECOS,
  PLANOS_COM_PRECO,
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

  // A tabela de 06/10/2026: a loja é o que se paga, com o assistente dentro.
  // Uma vem na base; cada loja a mais cabe, e a tela diz quanto passa a custar
  // ANTES de abrir — em centavos certos (89,90 + 59,90 = 149,80, não 149,79999).
  it('no Essencial e no Profissional a primeira loja vem na base e cada loja a mais cabe pagando', () => {
    expect(podeCriarUnidade('BALCAO', 0)).toEqual({ pode: true, custoExtra: 0 })
    expect(podeCriarUnidade('BALCAO', 1)).toEqual({ pode: true, custoExtra: 59.9, novoTotal: 149.8 })
    expect(podeCriarUnidade('BALCAO_AGENTE', 5)).toEqual({ pode: true, custoExtra: 99.9, novoTotal: 649.4 })
  })

  it('o Corporativo não tem teto nem conta de tabela', () => {
    expect(podeCriarUnidade('CORPORATIVO', 200)).toEqual({ pode: true, custoExtra: 0 })
  })

  // Barrar sem dizer para onde ir é barrar duas vezes.
  it('do Grátis, a segunda loja manda para o Norte, com o motivo', () => {
    const r = podeCriarUnidade('GRATIS', 1)
    expect(r.pode).toBe(false)
    if (!r.pode) {
      expect(r.motivo).toMatch(/1 unidade/)
      expect(r.sugestao).toBe('BALCAO')
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

  it('uma loja no Essencial: 89,90; duas no Profissional: 149,90 + 99,90', () => {
    expect(mensalidade('BALCAO', 1).total).toBe(89.9)
    expect(mensalidade('BALCAO_AGENTE', 2)).toMatchObject({ base: PRECOS.profissional, extras: 1, total: 249.8 })
  })

  it('cinco lojas no Essencial', () => {
    expect(mensalidade('BALCAO', 5).total).toBe(329.5)
  })

  // A conta que fez a tabela nova: cinco lojas e a fábrica, no Profissional.
  it('a rede com fábrica (cinco lojas) fica em 749,40', () => {
    expect(mensalidade('BALCAO_AGENTE', 5, 1).total).toBe(749.4)
  })

  it('o plano de contrato mostra a conta da tabela', () => {
    expect(mensalidade('REDE', 2).total).toBe(mensalidade('BALCAO_AGENTE', 2).total)
  })

  // A fábrica é UMA chave da empresa: com uma ou com três cozinhas, uma vez.
  // E só onde o plano tem a fábrica (o Profissional e os de cima).
  it('a fábrica entra uma vez, com qualquer número de unidades de fábrica', () => {
    const uma = mensalidade('BALCAO_AGENTE', 1, 1)
    const tres = mensalidade('BALCAO_AGENTE', 1, 3)
    expect(uma.fabrica).toBe(PRECOS.fabrica)
    expect(tres.fabrica).toBe(PRECOS.fabrica)
    expect(tres.fabricas).toBe(3)
    expect(tres.total).toBe(349.8)
    expect(mensalidade('BALCAO_AGENTE', 1, 0).fabrica).toBe(0)
    // No Essencial e no Grátis ela nem existe.
    expect(mensalidade('BALCAO', 1, 2).fabrica).toBe(0)
    expect(mensalidade('GRATIS', 1, 2).fabrica).toBe(0)
  })

  it('a conta aberta fecha com o total: lojas, fábrica e Farol', () => {
    const m = mensalidade('BALCAO_AGENTE', 3, 2, 2)
    expect(m.total).toBe(149.9 + 2 * 99.9 + 199.9 + 497 + 297)
  })

  it('só o Essencial e o Profissional estão à venda', () => {
    expect(PLANOS_COM_PRECO).toEqual(['BALCAO', 'BALCAO_AGENTE'])
  })
})

// ─────────────────────────────────────────────────────────────
// TROCAR DE PLANO
// ─────────────────────────────────────────────────────────────

describe('o que muda ao trocar de plano', () => {
  const pequeno = { unidades: 1 }

  it('do Grátis para o Essencial: ganha o básico da loja e o assistente básico', () => {
    const m = mudanca('GRATIS', 'BALCAO', pequeno)
    expect(m.sentido).toBe('subir')
    expect(m.diferenca).toBe(PRECOS.essencial)
    expect(m.ganha).toContain('multiUnidade')
    expect(m.ganha).toContain('agente')
    expect(m.ganha).not.toContain('crediario')
    expect(m.perde).toEqual([])
  })

  it('do Essencial para o Profissional: ganha o crediário, a fábrica e o resto', () => {
    const m = mudanca('BALCAO', 'BALCAO_AGENTE', { unidades: 3 })
    expect(m.sentido).toBe('subir')
    expect(m.diferenca).toBe(somar(PRECOS.profissional - PRECOS.essencial, 2 * (PRECOS.profissionalLojaExtra - PRECOS.essencialLojaExtra)))
    expect(m.ganha).toEqual(expect.arrayContaining(['crediario', 'fabrica', 'agenda', 'compras']))
    expect(m.perde).toEqual([])
  })

  // O caso que faz o cliente cancelar quando ninguém avisa.
  it('voltar para o Essencial mostra o que PERDE (e o assistente fica, básico)', () => {
    const m = mudanca('BALCAO_AGENTE', 'BALCAO', pequeno)
    expect(m.sentido).toBe('descer')
    expect(m.diferenca).toBe(-60)
    expect(m.perde).toContain('crediario')
    expect(m.perde).not.toContain('agente')
  })

  it('descer para o Grátis perde tudo que é módulo', () => {
    const m = mudanca('REDE', 'GRATIS', pequeno)
    expect(m.perde).toContain('notaFiscal')
    expect(m.perde).toContain('agente')
    expect(m.perde).toContain('crediario')
    expect(m.ganha).toEqual([])
  })

  it('trocar para o mesmo plano não muda nada', () => {
    const m = mudanca('BALCAO', 'BALCAO', pequeno)
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
  it('oito lojas não cabem no Grátis, e a mensagem diz quantas tirar', () => {
    const m = mudanca('BALCAO', 'GRATIS', { unidades: 8 })
    expect(m.impedimentos.length).toBe(1)
    expect(m.impedimentos[0]).toContain('8')
    expect(m.impedimentos[0]).toContain('Desative 7')
  })

  it('no Norte qualquer número cabe: a conta é que cresce', () => {
    expect(mudanca('REDE', 'BALCAO', { unidades: 8 }).impedimentos).toEqual([])
  })

  it('quantidade de gente não impede: cadastro é livre em todo plano', () => {
    expect(mudanca('REDE', 'GRATIS', { unidades: 1 }).impedimentos).toEqual([])
  })

  it('subir nunca impede', () => {
    for (const uso of [{ unidades: 1 }, { unidades: 40 }]) {
      expect(mudanca('GRATIS', 'CORPORATIVO', uso).impedimentos).toEqual([])
    }
  })
})

describe('o menor plano que cabe', () => {
  it('uma loja cabe no Grátis', () => expect(menorQueCabe({ unidades: 1 })).toBe('GRATIS'))
  it('duas ou vinte lojas: o Norte, com a loja a mais na conta', () => {
    expect(menorQueCabe({ unidades: 2 })).toBe('BALCAO')
    expect(menorQueCabe({ unidades: 20 })).toBe('BALCAO')
  })
})

// ─────────────────────────────────────────────────────────────
// COERÊNCIA DA TABELA
// ─────────────────────────────────────────────────────────────

describe('o plano decide quais módulos existem', () => {
  it('o Grátis não tem módulo nenhum', () => {
    expect(PLANOS.GRATIS.modulos).toEqual([])
    for (const m of TODOS) expect(planoLibera('GRATIS', m), m).toBe(false)
  })

  it('o Essencial tem o básico da loja e o assistente, sem crediário, agenda, compras e fábrica', () => {
    const tem = ['notaFiscal', 'encomenda', 'multiUnidade', 'ponto', 'agente']
    for (const m of TODOS) expect(planoLibera('BALCAO', m), m).toBe(tem.includes(m))
  })

  it('o Profissional tem tudo', () => {
    for (const m of TODOS) expect(planoLibera('BALCAO_AGENTE', m), m).toBe(true)
  })

  // A regra é: quem tem assistente tem respostas, quem não tem não tem. O
  // Corporativo cumpre por outro caminho — as respostas dele saem no
  // contrato, e é isso que `null` quer dizer. Zero seria outra coisa: seria
  // "tem assistente e não pode responder nada", que não é plano nenhum.
  it('todo plano com agente tem respostas, e sem agente tem zero', () => {
    for (const p of ORDEM) {
      const r = PLANOS[p].respostasMes
      if (planoLibera(p, 'agente')) expect(r === null || r > 0, `${p} tem agente sem respostas`).toBe(true)
      else expect(r, `${p} não tem agente mas tem respostas`).toBe(0)
    }
  })

  it('e só o Corporativo deixa as respostas para o contrato', () => {
    for (const p of ORDEM) {
      if (p !== 'CORPORATIVO') expect(PLANOS[p].respostasMes, p).not.toBeNull()
    }
    expect(PLANOS.CORPORATIVO.respostasMes).toBeNull()
  })

  // A tabela de 06/10/2026 nos valores do enum que já existiam: BALCAO é o
  // Essencial (assistente básico, 150), BALCAO_AGENTE o Profissional (completo,
  // 600), e o contrato dos primeiros clientes segue com as 1.000 combinadas.
  it('os planos caem no modelo novo sem migração', () => {
    expect(PLANOS.BALCAO_AGENTE.respostasMes).toBe(PRECOS.respostasProfissional)
    expect(PLANOS.BALCAO_AGENTE.assistente).toBe('completo')
    expect(PLANOS.BALCAO.respostasMes).toBe(PRECOS.respostasEssencial)
    expect(PLANOS.BALCAO.assistente).toBe('basico')
    expect(planoLibera('BALCAO', 'agente')).toBe(true)
    expect(planoLibera('BALCAO', 'crediario')).toBe(false)
    expect(PLANOS.REDE.aVenda).toBe(false)
    expect(PLANOS.REDE.respostasMes).toBe(PRECOS.respostasContrato)
  })

  it('cada loja a mais soma respostas à franquia', () => {
    expect(respostasDoPlano('BALCAO', 1)).toBe(150)
    expect(respostasDoPlano('BALCAO_AGENTE', 5)).toBe(600 + 4 * 200)
    expect(respostasDoPlano('GRATIS', 3)).toBe(0)
    expect(respostasDoPlano('CORPORATIVO', 3)).toBeNull()
  })

  // O básico conta e avisa; o que mexe pelo WhatsApp é do completo.
  it('o assistente básico só consulta', () => {
    expect(planoPermitePoder('BALCAO', 'ver.resumo')).toBe(true)
    expect(planoPermitePoder('BALCAO', 'consultar.produto')).toBe(true)
    expect(planoPermitePoder('BALCAO', 'estoque.entrada')).toBe(false)
    expect(planoPermitePoder('BALCAO', 'ajustar.estoque')).toBe(false)
    expect(planoPermitePoder('BALCAO', 'pedir.compra')).toBe(false)
    expect(planoPermitePoder('BALCAO_AGENTE', 'estoque.entrada')).toBe(true)
    expect(planoPermitePoder('GRATIS', 'ver.resumo')).toBe(false)
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

  it('as respostas na tabela são as do plano', () => {
    const r = acha('Respostas do assistente')
    for (const p of ORDEM) {
      const c = PLANOS[p].respostasMes
      if (!planoLibera(p, 'agente')) continue
      const dito = r.detalhe?.[p] ?? ''
      if (c === null) expect(dito, p).toBe('no contrato')
      else {
        const porLoja = PLANOS[p].respostasPorLojaExtra
        expect(dito, p).toBe(`${c.toLocaleString('pt-BR')}/mês${porLoja ? ` (+${porLoja.toLocaleString('pt-BR')} por loja)` : ''}`)
      }
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

  it('o número de vagas na tabela é a cota do plano, sem vender vaga extra', () => {
    // A vaga extra não se compra hoje (`ocuparVaga` só olha a cota), então a
    // tabela não pode anunciar o preço dela.
    const r = acha('Dentro ao mesmo tempo')
    for (const p of ORDEM) {
      const l = PLANOS[p]
      const dito = r.detalhe?.[p] ?? ''
      if (l.vagas === null) expect(dito, p).toBe('à vontade')
      else {
        expect(dito, p).toBe(String(l.vagas))
        expect(dito, p).not.toContain('R$')
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

  it('tudo o que é da loja abre no Norte; as campanhas, com o assistente', () => {
    for (const c of chaves.filter((x) => x !== 'campanhas')) expect(liberado('BALCAO', c), c).toBe(true)
    expect(liberado('BALCAO', 'campanhas')).toBe(false)
    expect(liberado('BALCAO_AGENTE', 'campanhas')).toBe(true)
  })

  it('a frase do cadeado sai com o artigo do plano', () => {
    expect(doPlano('BALCAO')).toBe('do Essencial')
    expect(doPlano('BALCAO_AGENTE')).toBe('do Profissional')
    expect(planoQueAbre('campanhas').codigo).toBe('BALCAO_AGENTE')
    expect(planoQueAbre('tarefas.rede').codigo).toBe('BALCAO')
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

describe('o assistente básico no servidor', () => {
  it('a ferramenta que mexe não vai para o modelo, e a proposta dela é recusada', async () => {
    const { ferramentasDe, conferirPoder, PoderNegado } = await import('../src/servidor/poderes')
    const agente = { poderes: ['ver.resumo', 'estoque.entrada', 'ajustar.estoque'], descontoMaxPct: 5, valorMaxCent: 100000 }
    const essencial = { modulos: ['agente'], plano: 'BALCAO' as const }
    const pro = { modulos: ['agente'], plano: 'BALCAO_AGENTE' as const }
    expect(ferramentasDe(agente, essencial)).toContain('ver.resumo')
    expect(ferramentasDe(agente, essencial)).not.toContain('estoque.entrada')
    expect(ferramentasDe(agente, pro)).toContain('estoque.entrada')
    expect(() => conferirPoder(agente, essencial, 'estoque.entrada')).toThrow(PoderNegado)
    expect(() => conferirPoder(agente, pro, 'estoque.entrada')).not.toThrow()
  })
})
