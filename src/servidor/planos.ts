// Planos, limites e o que custa a mais.
//
// ── a regra de ouro ──────────────────────────────────────────
// O cliente NUNCA descobre a cobrança na fatura. Antes de criar a décima
// loja, a tela diz "isto passa a custar R$ X por mês" e ele confirma. Surpresa
// em conta é o caminho mais curto para o cancelamento — e para a reclamação
// pública, que custa mais que o cliente.
//
// ── e por que limite existe de verdade ───────────────────────
// Não é só comercial: cada loja é estoque próprio, caixa próprio, gente
// própria e mais consulta no banco. Rede de vinte lojas custa mais para
// atender, e o preço precisa acompanhar, senão o cliente grande é prejuízo.

import type { Plano } from '@prisma/client'
import type { Modulo } from './modulos'

export type Limite = {
  titulo: string
  /** Uma frase: para quem este plano é. */
  resumo: string
  /** null = sem limite. */
  unidades: number | null
  usuarios: number | null
  /** Mensalidade base, em reais. `null` = sob consulta. */
  mensal: number | null
  /** Cobrado por unidade além da cota. null = não vende extra neste plano. */
  porUnidadeExtra: number | null
  /** Os módulos que o plano LIGA. Fora daqui, a chave nem aparece. */
  modulos: Modulo[]
  /**
   * Crédito de IA que já vem no plano, por mês, em reais.
   *
   * Existe separado da mensalidade porque o custo de IA é o único que varia
   * com o uso de CADA cliente: uma loja que conversa o dia inteiro no
   * WhatsApp gasta dez vezes o de outra do mesmo tamanho. Embutir tudo na
   * mensalidade obrigaria a cobrar do cliente pequeno o risco do grande.
   *
   * O que passa disso é recarga, e a recarga é o cliente que decide.
   */
  creditoMensal: number
  /**
   * Ordem comercial. É ela que define o que é SUBIR e o que é DESCER — e
   * comparar por preço não serviria, porque o Corporativo não tem preço.
   */
  degrau: number
}

export const PLANOS: Record<Plano, Limite> = {
  BALCAO: {
    titulo: 'Balcão',
    resumo: 'Uma loja, o essencial para parar de vender no caderno.',
    unidades: 1,
    usuarios: 5,
    mensal: 349,
    porUnidadeExtra: null, // quem quer a segunda loja sobe de plano
    modulos: ['notaFiscal', 'encomenda'],
    creditoMensal: 0,
    degrau: 1,
  },
  BALCAO_AGENTE: {
    titulo: 'Balcão + Assistente',
    resumo: 'Uma loja, com o assistente atendendo e cobrando no WhatsApp.',
    unidades: 1,
    usuarios: 5,
    mensal: 697,
    porUnidadeExtra: null,
    modulos: ['notaFiscal', 'encomenda', 'agente', 'metas'],
    // Calibrado em cima de consumo MEDIDO, nao estimado: uma loja de
    // movimento normal gasta ~R$ 36/mes de custo bruto com cache e roteamento
    // de modelo, o que da ~R$ 108 cobrados. R$ 120 cobre ela inteira e sobra.
    // O numero anterior era R$ 40 — duraria um dia e meio numa loja cheia.
    creditoMensal: 120,
    degrau: 2,
  },
  REDE: {
    titulo: 'Rede',
    resumo: 'Várias lojas, cada uma com estoque e caixa próprios.',
    unidades: 5,
    usuarios: 30,
    mensal: 1497,
    porUnidadeExtra: 249,
    modulos: ['notaFiscal', 'encomenda', 'agente', 'metas', 'multiUnidade', 'crediario'],
    // Rede sao varias lojas conversando ao mesmo tempo.
    creditoMensal: 350,
    degrau: 3,
  },
  CORPORATIVO: {
    titulo: 'Corporativo',
    resumo:
      'A operação inteira com a gente junto: site, tráfego e a condução do negócio. ' +
      'Preço fechado caso a caso, depois de entender a operação.',
    unidades: null,
    usuarios: null,
    mensal: null, // sob consulta — de propósito, e não é evasiva:
    // o trabalho é diferente em cada caso, e um número na tabela viraria
    // promessa que a gente não sabe se consegue cumprir antes de olhar.
    porUnidadeExtra: null,
    modulos: ['notaFiscal', 'encomenda', 'agente', 'metas', 'multiUnidade', 'crediario'],
    creditoMensal: 800,
    degrau: 4,
  },
}

/** Os que têm preço na tabela. O Corporativo passa por conversa. */
export const PLANOS_COM_PRECO = (Object.keys(PLANOS) as Plano[]).filter(
  (p) => PLANOS[p].mensal !== null,
)

export const ORDEM = (Object.keys(PLANOS) as Plano[]).sort(
  (a, b) => PLANOS[a].degrau - PLANOS[b].degrau,
)

/** O módulo está disponível neste plano? */
export function planoLibera(plano: Plano, modulo: Modulo): boolean {
  return PLANOS[plano].modulos.includes(modulo)
}

export type Veredito =
  | { pode: true; custoExtra: 0 }
  /** Cabe, mas passa a custar mais — a tela tem que dizer ANTES. */
  | { pode: true; custoExtra: number; novoTotal: number }
  /** Não cabe neste plano: o caminho é subir de plano, não bloquear e calar. */
  | { pode: false; motivo: string; sugestao: Plano }

/**
 * Posso criar mais uma unidade?
 *
 * Devolve o custo em vez de só sim/não, porque quem chama precisa MOSTRAR o
 * valor antes de confirmar.
 */
export function podeCriarUnidade(plano: Plano, jaTem: number): Veredito {
  const p = PLANOS[plano]

  // Sem limite: nada a avisar.
  if (p.unidades === null) return { pode: true, custoExtra: 0 }

  // Ainda dentro da cota.
  if (jaTem < p.unidades) return { pode: true, custoExtra: 0 }

  // Passou da cota e o plano vende extra: cobra, mas avisa antes.
  if (p.porUnidadeExtra !== null) {
    const extras = jaTem - p.unidades + 1
    return {
      pode: true,
      custoExtra: p.porUnidadeExtra,
      novoTotal: (p.mensal ?? 0) + extras * p.porUnidadeExtra,
    }
  }

  // Passou da cota e o plano não vende extra: sobe de plano.
  return {
    pode: false,
    motivo:
      `O plano ${p.titulo} atende ${p.unidades} ` +
      `${p.unidades === 1 ? 'unidade' : 'unidades'}.`,
    sugestao: 'REDE',
  }
}

/** Mesma ideia para gente na equipe. */
export function podeAdicionarUsuario(plano: Plano, jaTem: number): Veredito {
  const p = PLANOS[plano]
  if (p.usuarios === null || jaTem < p.usuarios) return { pode: true, custoExtra: 0 }
  return {
    pode: false,
    motivo: `O plano ${p.titulo} atende ${p.usuarios} pessoas.`,
    sugestao: plano === 'REDE' ? 'CORPORATIVO' : 'REDE',
  }
}

/** O que esta empresa deve pagar hoje, com as unidades que ela tem. */
export function mensalidade(plano: Plano, unidades: number) {
  const p = PLANOS[plano]
  if (p.mensal === null) return { base: null, extras: 0, porExtra: null, total: null }

  const cota = p.unidades ?? unidades
  const extras = p.porUnidadeExtra !== null ? Math.max(0, unidades - cota) : 0
  return {
    base: p.mensal,
    extras,
    porExtra: p.porUnidadeExtra,
    total: p.mensal + extras * (p.porUnidadeExtra ?? 0),
  }
}

// ─────────────────────────────────────────────────────────────
// TROCAR DE PLANO
// ─────────────────────────────────────────────────────────────

export type Mudanca = {
  de: Plano
  para: Plano
  sentido: 'subir' | 'descer' | 'igual'
  /** O que passa a pagar por mês. null quando o destino é sob consulta. */
  novoMensal: number | null
  /** Diferença contra o que paga hoje. Positivo = mais caro. */
  diferenca: number | null
  /** Módulos que passam a existir. */
  ganha: Modulo[]
  /** Módulos que somem — e ISSO precisa estar na tela antes do clique. */
  perde: Modulo[]
  /** Crédito de IA mensal que passa a vir incluso. */
  creditoMensal: number
  /**
   * Impedimentos concretos. Vazio = pode trocar.
   *
   * Descer de plano não é só pagar menos: uma rede com oito lojas não CABE no
   * plano de cinco. Deixar trocar e depois esconder três lojas seria perder
   * dado de vista sem avisar — e o dono só descobriria no dia do balanço.
   * Então o sistema recusa e diz exatamente o que fazer antes.
   */
  impedimentos: string[]
}

/**
 * O que acontece se esta empresa trocar de plano.
 *
 * Devolve o quadro inteiro em vez de sim/não: a tela precisa mostrar preço,
 * o que ganha, o que PERDE e o que impede — antes do clique, nunca depois.
 */
export function mudanca(
  de: Plano,
  para: Plano,
  uso: { unidades: number; usuarios: number },
): Mudanca {
  const atual = PLANOS[de]
  const alvo = PLANOS[para]

  const mensalAtual = mensalidade(de, uso.unidades).total
  const mensalNovo = mensalidade(para, uso.unidades).total

  const impedimentos: string[] = []
  if (alvo.unidades !== null && uso.unidades > alvo.unidades) {
    impedimentos.push(
      `Você tem ${uso.unidades} unidades e o plano ${alvo.titulo} atende ${alvo.unidades}. ` +
        `Desative ${uso.unidades - alvo.unidades} antes de trocar.`,
    )
  }
  if (alvo.usuarios !== null && uso.usuarios > alvo.usuarios) {
    impedimentos.push(
      `Você tem ${uso.usuarios} pessoas com acesso e o plano ${alvo.titulo} atende ` +
        `${alvo.usuarios}. Tire o acesso de ${uso.usuarios - alvo.usuarios} antes de trocar.`,
    )
  }

  return {
    de,
    para,
    sentido:
      alvo.degrau > atual.degrau ? 'subir' : alvo.degrau < atual.degrau ? 'descer' : 'igual',
    novoMensal: mensalNovo,
    diferenca: mensalNovo !== null && mensalAtual !== null ? mensalNovo - mensalAtual : null,
    ganha: alvo.modulos.filter((m) => !atual.modulos.includes(m)),
    perde: atual.modulos.filter((m) => !alvo.modulos.includes(m)),
    creditoMensal: alvo.creditoMensal,
    impedimentos,
  }
}

/** O menor plano que comporta este uso. Serve para sugerir, não para trocar sozinho. */
export function menorQueCabe(uso: { unidades: number; usuarios: number }): Plano {
  return (
    ORDEM.find(
      (p) =>
        (PLANOS[p].unidades === null || uso.unidades <= PLANOS[p].unidades!) &&
        (PLANOS[p].usuarios === null || uso.usuarios <= PLANOS[p].usuarios!),
    ) ?? 'CORPORATIVO'
  )
}

// ─────────────────────────────────────────────────────────────
// O QUE CADA PLANO ENTREGA — a lista, e a tabela de comparacao
// ─────────────────────────────────────────────────────────────
//
// Uma fonte so, usada em dois lugares: os pontos dentro do cartao e a tabela
// de comparacao embaixo. Duas listas separadas divergem — e divergir aqui e
// prometer na tabela o que o cartao nao dá.

export type Recurso = {
  titulo: string
  grupo: 'Operação' | 'Dinheiro' | 'Assistente' | 'Estrutura'
  /** Em quais planos ele existe. */
  em: Plano[]
  /** Quando o recurso e quantitativo, o numero de cada plano. */
  detalhe?: Partial<Record<Plano, string>>
  /** Aparece na lista curta do cartao. O resto so na tabela. */
  destaque?: boolean
}

const TODOS_OS_PLANOS: Plano[] = ['BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO']
const COM_AGENTE: Plano[] = ['BALCAO_AGENTE', 'REDE', 'CORPORATIVO']
const DE_REDE: Plano[] = ['REDE', 'CORPORATIVO']

export const RECURSOS: Recurso[] = [
  // ── Operação ──
  {
    titulo: 'Balcão, caixa e sangria',
    grupo: 'Operação',
    em: TODOS_OS_PLANOS,
    destaque: true,
  },
  { titulo: 'Produto com grade de cor e tamanho', grupo: 'Operação', em: TODOS_OS_PLANOS },
  { titulo: 'Estoque, entrada de mercadoria e balanço', grupo: 'Operação', em: TODOS_OS_PLANOS },
  { titulo: 'Ficha do cliente com histórico', grupo: 'Operação', em: TODOS_OS_PLANOS },
  { titulo: 'Programa de pontos', grupo: 'Operação', em: TODOS_OS_PLANOS },
  { titulo: 'Nota fiscal (NFC-e e NF-e)', grupo: 'Operação', em: TODOS_OS_PLANOS },
  { titulo: 'Encomenda e entrega', grupo: 'Operação', em: TODOS_OS_PLANOS },

  // ── Dinheiro ──
  { titulo: 'Financeiro com DRE do mês', grupo: 'Dinheiro', em: TODOS_OS_PLANOS, destaque: true },
  { titulo: 'Contas a pagar e recorrentes', grupo: 'Dinheiro', em: TODOS_OS_PLANOS },
  { titulo: 'Metas e comissão por vendedor', grupo: 'Dinheiro', em: COM_AGENTE },
  { titulo: 'Crediário próprio, com juros e cobrança', grupo: 'Dinheiro', em: DE_REDE, destaque: true },

  // ── Assistente ──
  {
    titulo: 'Assistente no WhatsApp',
    grupo: 'Assistente',
    em: COM_AGENTE,
    destaque: true,
  },
  {
    titulo: 'Crédito de IA incluso',
    grupo: 'Assistente',
    em: COM_AGENTE,
    detalhe: {
      BALCAO_AGENTE: 'R$ 120/mês',
      REDE: 'R$ 350/mês',
      CORPORATIVO: 'R$ 800/mês',
    },
    destaque: true,
  },
  { titulo: 'Relatório sozinho, de manhã e à noite', grupo: 'Assistente', em: COM_AGENTE },
  { titulo: 'Ele avisa quando falta peça ou some cliente', grupo: 'Assistente', em: COM_AGENTE },
  { titulo: 'Ele propõe reposição e você confirma', grupo: 'Assistente', em: COM_AGENTE },

  // ── Estrutura ──
  {
    titulo: 'Unidades',
    grupo: 'Estrutura',
    em: TODOS_OS_PLANOS,
    detalhe: {
      BALCAO: '1',
      BALCAO_AGENTE: '1',
      REDE: '5 (+R$ 249 cada)',
      CORPORATIVO: 'à vontade',
    },
    destaque: true,
  },
  {
    titulo: 'Pessoas com acesso',
    grupo: 'Estrutura',
    em: TODOS_OS_PLANOS,
    detalhe: {
      BALCAO: '5',
      BALCAO_AGENTE: '5',
      REDE: '30',
      CORPORATIVO: 'à vontade',
    },
    destaque: true,
  },
  { titulo: 'Estoque e caixa separados por loja', grupo: 'Estrutura', em: DE_REDE, destaque: true },
  { titulo: 'Painel consolidado da rede', grupo: 'Estrutura', em: DE_REDE },
  { titulo: 'Livro de auditoria de tudo que mexe', grupo: 'Estrutura', em: TODOS_OS_PLANOS },
  {
    titulo: 'Site, tráfego e condução do negócio',
    grupo: 'Estrutura',
    em: ['CORPORATIVO'],
    destaque: true,
  },
  { titulo: 'Atendimento direto com a gente', grupo: 'Estrutura', em: ['CORPORATIVO'] },
]

/** Qual plano a gente RECOMENDA. É onde a conta fecha melhor dos dois lados. */
export const RECOMENDADO: Plano = 'REDE'

export function temRecurso(r: Recurso, p: Plano): boolean {
  return r.em.includes(p)
}

/** Os pontos do cartão: os de destaque que o plano tem. */
export function destaquesDe(p: Plano): { titulo: string; detalhe?: string }[] {
  return RECURSOS.filter((r) => r.destaque && temRecurso(r, p)).map((r) => ({
    titulo: r.titulo,
    detalhe: r.detalhe?.[p],
  }))
}

/** Os grupos, na ordem, para a tabela. */
export const GRUPOS: Recurso['grupo'][] = ['Operação', 'Dinheiro', 'Assistente', 'Estrutura']
