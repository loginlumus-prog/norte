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
  /**
   * O artigo que o nome pede: "do Balcão", mas "da Rede".
   *
   * Parece frescura e não é — sem ele a página escreve "Do Rede para cima",
   * que qualquer brasileiro lê como erro e desconta da confiança em tudo que
   * está em volta. Mora aqui, junto do nome, porque é propriedade DO NOME: no
   * dia em que um plano for renomeado, o artigo vem junto.
   */
  artigo: 'o' | 'a'
  /** Uma frase: para quem este plano é. */
  resumo: string
  /** null = sem limite. */
  unidades: number | null

  /**
   * Quantas pessoas podem estar DENTRO ao mesmo tempo.
   *
   * ── por que não é "quantos usuários" ─────────────────────
   * Cobrar por conta cadastrada empurra a loja a compartilhar login: duas
   * pessoas, uma senha. Aí o livro de auditoria — que é uma das coisas que
   * este sistema vende — passa a mentir, porque toda ação aparece no nome de
   * uma pessoa só.
   *
   * Cobrando por simultaneidade, cadastrar a equipe inteira é de graça e não
   * sobra motivo nenhum para emprestar senha. E é mais justo: a loja com oito
   * meio-período e dois caixas paga por dois, não por oito.
   */
  vagas: number | null

  /** Mensalidade base, em reais. `null` = sob consulta. `0` = grátis. */
  mensal: number | null
  /** Cobrado por unidade além da cota. null = não vende extra neste plano. */
  porUnidadeExtra: number | null

  /**
   * Cobrado por vaga além da cota. null = não vende extra (o caminho é subir).
   *
   * O número importa mais do que parece. Vaga extra cara demais não é
   * adicional, é muro vestido de opção: ninguém compra, e o cliente que faz a
   * conta percebe. Perto da taxa de dentro do plano, ela é comprada — e vira
   * receita que sem ela não existiria.
   */
  porVagaExtra: number | null

  /**
   * Teto de vendas por mês. null = sem teto.
   *
   * Só o plano grátis tem. E é de propósito que o limite seja de VOLUME e não
   * só de recurso: quem está indo bem bate no teto e sobe porque está
   * vendendo, não porque esbarrou num muro. É a diferença entre "cresci" e
   * "me capou" — e a primeira converte, a segunda faz sair.
   */
  tetoVendasMes: number | null
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
   *
   * `null` = definido em contrato. Só o Corporativo: lá o volume de conversa
   * varia demais entre um cliente e outro para caber num número de tabela, e
   * um número de tabela viraria promessa antes de alguém olhar a operação.
   */
  creditoMensal: number | null
  /**
   * Ordem comercial. É ela que define o que é SUBIR e o que é DESCER — e
   * comparar por preço não serviria, porque o Corporativo não tem preço.
   */
  degrau: number
}

export const PLANOS: Record<Plano, Limite> = {
  GRATIS: {
    titulo: 'Grátis',
    artigo: 'o',
    resumo: 'Uma loja, uma pessoa por vez. Para sair do caderno hoje.',
    unidades: 1,
    vagas: 1,
    mensal: 0,
    porUnidadeExtra: null,
    porVagaExtra: null,
    // Nenhum módulo: sem nota fiscal, sem assistente, sem crediário. O que
    // fica é o miolo — vender no balcão, cadastrar produto, controlar estoque
    // e cliente. Que já é o dia inteiro de muita loja, e é o ponto.
    modulos: [],
    creditoMensal: 0,
    // Trezentas vendas por mês é ~10 por dia. Loja que passa disso não é mais
    // "estou experimentando": é operação, e operação cabe pagar R$ 100.
    tetoVendasMes: 300,
    degrau: 0,
  },
  BALCAO: {
    titulo: 'Balcão',
    artigo: 'o',
    resumo: 'Até três lojas, e o sistema inteiro — menos o assistente.',
    unidades: 3,
    vagas: 3,
    mensal: 100,
    porUnidadeExtra: null,
    porVagaExtra: 40,
    modulos: ['notaFiscal', 'encomenda', 'multiUnidade'],
    creditoMensal: 0,
    tetoVendasMes: null,
    degrau: 1,
  },
  BALCAO_AGENTE: {
    // Era "Balcao + Assistente". O "+" fazia o plano ler como ACESSORIO do
    // anterior — alguma coisa que se acrescenta — em vez de degrau proprio. Sem
    // ele, o nome diz o que muda: aqui alguem passa a atender por voce.
    titulo: 'Assistente',
    artigo: 'o',
    resumo: 'Até cinco lojas, com o assistente atendendo e cobrando no WhatsApp.',
    unidades: 5,
    vagas: 5,
    mensal: 350,
    porUnidadeExtra: null,
    porVagaExtra: 40,
    modulos: ['notaFiscal', 'encomenda', 'multiUnidade', 'agente', 'metas'],
    // ── este numero e apertado, e vale saber por que ────────
    // O consumo foi MEDIDO, nao estimado: uma loja de movimento normal gasta
    // ~R$ 36/mes de custo bruto com cache e roteamento de modelo, o que da
    // ~R$ 108 cobrados no mes cheio.
    //
    // R$ 100 cobre uns 27 dias dessa loja. Nos ultimos dias do mes ela fica
    // sem credito — e sao justamente os dias em que a cobranca de atraso mais
    // importa, porque e quando as pessoas recebem. Quem quiser o mes inteiro
    // recarrega, e a recarga e barata; mas a tela precisa avisar ANTES de
    // acabar, e o aviso ja existe (creditoAvisoCent).
    creditoMensal: 100,
    tetoVendasMes: null,
    degrau: 2,
  },
  REDE: {
    // Era "Rede", que descrevia o FORMATO do cliente (varias lojas) e nao o que
    // ele recebe. Passou a subvender no dia em que o destaque deste plano
    // deixou de ser loja ilimitada e virou a analise do negocio.
    //
    // "Direcao" e o que ele entrega, e e o nome do produto cumprido: o selo
    // deste plano ja e o mapa inteiro com a rosa dos ventos por tras.
    titulo: 'Direção',
    artigo: 'a',
    resumo:
      'Lojas e pessoas sem limite, e a análise que diz onde você está perdendo e o que fazer.',
    unidades: null,
    vagas: null,
    mensal: 1500,
    porUnidadeExtra: null,
    porVagaExtra: null,
    modulos: ['notaFiscal', 'encomenda', 'multiUnidade', 'agente', 'metas', 'crediario'],
    // Rede sao varias lojas conversando ao mesmo tempo.
    creditoMensal: 300,
    tetoVendasMes: null,
    degrau: 3,
  },
  CORPORATIVO: {
    titulo: 'Corporativo',
    artigo: 'o',
    resumo:
      'A operação inteira com a gente junto: site, tráfego e a condução do negócio. ' +
      'Preço fechado caso a caso, depois de entender a operação.',
    unidades: null,
    vagas: null,
    mensal: null, // sob consulta — de propósito, e não é evasiva:
    // o trabalho é diferente em cada caso, e um número na tabela viraria
    // promessa que a gente não sabe se consegue cumprir antes de olhar.
    porUnidadeExtra: null,
    porVagaExtra: null,
    modulos: ['notaFiscal', 'encomenda', 'multiUnidade', 'agente', 'metas', 'crediario'],
    // Sem numero de tabela, pelo mesmo motivo do preco: o volume de conversa
    // de um cliente Corporativo nao se parece com o de outro, e chutar aqui
    // seria prometer antes de olhar a operacao. Sai no contrato.
    creditoMensal: null,
    tetoVendasMes: null,
    degrau: 4,
  },
}

/** Os que têm preço na tabela. O Corporativo passa por conversa. */
/**
 * Os que têm mensalidade de verdade. Fora ficam o Corporativo (sob consulta) e
 * o Grátis — que tem preço, e o preço é zero, mas ele não disputa a tabela com
 * os pagos: quem está comparando preço não está escolhendo entre R$ 0 e
 * R$ 1.500, está escolhendo entre os pagos.
 */
export const PLANOS_COM_PRECO = (Object.keys(PLANOS) as Plano[]).filter(
  (p) => PLANOS[p].mensal !== null && PLANOS[p].mensal !== 0,
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

/**
 * Cabe mais uma pessoa DENTRO agora?
 *
 * Note que não existe mais cota de cadastro: registrar a equipe inteira é de
 * graça, e de propósito — ver o comentário de `vagas` lá em cima. O que a
 * assinatura limita é quanta gente fica dentro ao mesmo tempo.
 *
 * `jaDentro` é quem está com sessão viva neste instante, não quem tem conta.
 */
export function podeAbrirVaga(plano: Plano, jaDentro: number): Veredito {
  const p = PLANOS[plano]

  if (p.vagas === null) return { pode: true, custoExtra: 0 }
  if (jaDentro < p.vagas) return { pode: true, custoExtra: 0 }

  if (p.porVagaExtra !== null) {
    const extras = jaDentro - p.vagas + 1
    return {
      pode: true,
      custoExtra: p.porVagaExtra,
      novoTotal: (p.mensal ?? 0) + extras * p.porVagaExtra,
    }
  }

  return {
    pode: false,
    motivo:
      `O plano ${p.titulo} deixa ${p.vagas} ` +
      `${p.vagas === 1 ? 'pessoa' : 'pessoas'} dentro ao mesmo tempo.`,
    sugestao: plano === 'GRATIS' ? 'BALCAO' : 'BALCAO_AGENTE',
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
  /** Crédito de IA mensal que passa a vir incluso. `null` = sai no contrato. */
  creditoMensal: number | null
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
  /** Só as lojas: gente cadastrada deixou de ser cota — ver `vagas`. */
  uso: { unidades: number },
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
  // Não existe mais impedimento por quantidade de gente cadastrada: cadastro é
  // livre em todo plano. Descer de plano aperta as VAGAS, e vaga é coisa do
  // instante — quem estiver dentro além da nova cota simplesmente não
  // consegue entrar de novo depois de sair. Não é perda de dado e por isso
  // não impede a troca; é aperto de operação, e a tela de troca avisa disso
  // com o número.
  if (alvo.vagas !== null && (atual.vagas === null || atual.vagas > alvo.vagas)) {
    // Não é impedimento — é aviso. Fica fora de `impedimentos` de propósito.
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

/**
 * O menor plano que comporta este uso. Serve para sugerir, não para trocar
 * sozinho.
 *
 * Olha só as UNIDADES. Vaga não entra aqui porque vaga é do instante: sugerir
 * plano com base em "quantas pessoas estavam dentro agora" daria uma sugestão
 * diferente a cada hora do dia.
 */
export function menorQueCabe(uso: { unidades: number }): Plano {
  return (
    ORDEM.find((p) => PLANOS[p].unidades === null || uso.unidades <= PLANOS[p].unidades!) ??
    'CORPORATIVO'
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
  grupo: 'Operação' | 'Dinheiro' | 'Equipe' | 'Assistente' | 'Estrutura'
  /** Em quais planos ele existe. */
  em: Plano[]
  /** Quando o recurso e quantitativo, o numero de cada plano. */
  detalhe?: Partial<Record<Plano, string>>
  /** Aparece na lista curta do cartao. O resto so na tabela. */
  destaque?: boolean
  /**
   * `'breve'` = ESTA COMPRADO, mas ainda nao existe.
   *
   * Este campo existe para a pagina de venda poder falar do que vem sem
   * mentir. A tentacao e listar o que esta planejado junto com o que funciona
   * — e ai alguem assina o plano de cima pela analise profunda, entra, nao
   * acha, e cancela. Cancelamento por promessa quebrada e o unico que vem com
   * reclamacao publica junto.
   *
   * Marcado, ele vira expectativa em vez de mentira. E some daqui no dia em
   * que a coisa existir — se ficar marcado por seis meses, isso tambem esta
   * dizendo alguma coisa.
   */
  quando?: 'breve'
}

// O Grátis entra em TODOS_OS_PLANOS de propósito: o miolo do sistema — vender,
// cadastrar produto, controlar estoque e cliente — existe nele igual. O que ele
// não tem está nas outras listas.
const TODOS_OS_PLANOS: Plano[] = ['GRATIS', 'BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO']
const PAGOS: Plano[] = ['BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO']
const SEM_GRATIS = PAGOS
const COM_AGENTE: Plano[] = ['BALCAO_AGENTE', 'REDE', 'CORPORATIVO']
const DE_REDE: Plano[] = ['REDE', 'CORPORATIVO']

// ── os numeros da tabela saem do PLANO, nunca da mao ────────
// Aqui havia "R$ 120/mes" escrito a mao na linha do credito, e ele continuou
// dizendo 120 depois de o plano virar 100. Nao foi descuido: e o que SEMPRE
// acontece com numero repetido em dois lugares — um muda, o outro fica.
//
// O comentario no topo deste arquivo ja avisava disso para a pagina de venda.
// Valia para a tabela tambem, e agora vale de verdade: se o numero muda no
// plano, a tabela acompanha sozinha.
const porPlano = (planos: Plano[], f: (l: Limite) => string): Partial<Record<Plano, string>> =>
  Object.fromEntries(planos.map((p) => [p, f(PLANOS[p])]))

const aVontade = (n: number | null, texto: (n: number) => string) =>
  n === null ? 'à vontade' : texto(n)

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
  { titulo: 'Programa de pontos', grupo: 'Operação', em: PAGOS },
  { titulo: 'Nota fiscal (NFC-e e NF-e)', grupo: 'Operação', em: PAGOS, destaque: true },
  { titulo: 'Encomenda e entrega', grupo: 'Operação', em: PAGOS },
  {
    // Deixou de ser "em breve" em 16/09: o prazo mora no PRODUTO (dias que o
    // fornecedor leva para repor), não num cadastro de fornecedor — que
    // continua não existindo, e não precisa existir para isto funcionar.
    titulo: 'Previsão de ruptura com prazo de reposição',
    grupo: 'Operação',
    em: DE_REDE,
    destaque: true,
  },
  {
    // Custo contra preço, item a item: margem, markup e o preço que a margem
    // alvo pediria. A sugestão é do Assistente para cima; a leitura da margem
    // é de todo plano pago.
    titulo: 'Precificação: margem, markup e preço sugerido',
    grupo: 'Operação',
    em: PAGOS,
    detalhe: { BALCAO: 'margem', BALCAO_AGENTE: 'completa', REDE: 'completa', CORPORATIVO: 'completa' },
  },

  // ── Dinheiro ──
  {
    titulo: 'Relatório de vendas',
    grupo: 'Dinheiro',
    em: TODOS_OS_PLANOS,
    detalhe: { GRATIS: 'simples', BALCAO: 'completo', BALCAO_AGENTE: 'completo', REDE: 'completo', CORPORATIVO: 'completo' },
  },
  { titulo: 'Financeiro com DRE do mês', grupo: 'Dinheiro', em: PAGOS, destaque: true },
  { titulo: 'Contas a pagar e recorrentes', grupo: 'Dinheiro', em: PAGOS },
  { titulo: 'Metas e comissão por vendedor', grupo: 'Equipe', em: COM_AGENTE },
  { titulo: 'Fechamento de mês guiado', grupo: 'Dinheiro', em: PAGOS },
  {
    titulo: 'Curva ABC e dinheiro parado',
    grupo: 'Dinheiro',
    em: DE_REDE,
    destaque: true,
  },
  { titulo: 'Crediário próprio, com juros e cobrança', grupo: 'Dinheiro', em: DE_REDE, destaque: true },

  // ── Equipe ──
  // O quadro existe em TODO plano — inclusive no Grátis, com um quadro só. É
  // a tela que a equipe abre todo dia, e é onde quem paga pouco vê, trancado
  // e com nome, o que o plano de cima abre.
  {
    titulo: 'Quadro de tarefas da equipe',
    grupo: 'Equipe',
    em: TODOS_OS_PLANOS,
    detalhe: porPlano(TODOS_OS_PLANOS, (l) => (l.degrau === 0 ? '1 quadro' : 'à vontade')),
    destaque: true,
  },
  { titulo: 'Responsável, prazo e prioridade na tarefa', grupo: 'Equipe', em: PAGOS },
  { titulo: 'Linha do tempo e modelos de quadro', grupo: 'Equipe', em: COM_AGENTE },
  { titulo: 'Quadro da rede inteira, loja a loja', grupo: 'Equipe', em: DE_REDE },
  {
    // Estrelas por pessoa e por mês: meta batida, tarefa entregue no prazo,
    // dias presente. Básico conta; completo compara entre lojas e olha três
    // meses para trás.
    titulo: 'Desempenho da equipe em estrelas',
    grupo: 'Equipe',
    em: COM_AGENTE,
    detalhe: { BALCAO_AGENTE: 'básico', REDE: 'completo', CORPORATIVO: 'completo' },
    destaque: true,
  },
  {
    titulo: 'Escala e presença da equipe',
    grupo: 'Equipe',
    em: DE_REDE,
  },

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
    detalhe: porPlano(COM_AGENTE, (l) =>
      l.creditoMensal === null ? 'no contrato' : `R$ ${l.creditoMensal}/mês`,
    ),
    destaque: true,
  },
  { titulo: 'Relatório sozinho, de manhã e à noite', grupo: 'Assistente', em: COM_AGENTE },
  { titulo: 'Ele avisa quando falta peça ou some cliente', grupo: 'Assistente', em: COM_AGENTE },
  { titulo: 'Ele propõe reposição e você confirma', grupo: 'Assistente', em: COM_AGENTE },
  {
    // A linha que separa os dois planos de cima, e ela e uma so: um conta o
    // que aconteceu, o outro diz o que fazer a respeito.
    titulo: 'Análise do negócio',
    grupo: 'Assistente',
    em: COM_AGENTE,
    // Uma palavra por coluna. A tabela COMPARA; quem explica e o cartao do
     // plano, que tem largura para isso. Frase de cinquenta caracteres numa
     // celula de comparacao estoura a linha e empurra a tabela para fora da
     // tela — aconteceu, e o print mostrou.
    detalhe: {
      BALCAO_AGENTE: 'básica',
      REDE: 'profunda',
      CORPORATIVO: 'profunda',
    },
    quando: 'breve',
    destaque: true,
  },

  // ── Estrutura ──
  {
    titulo: 'Lojas',
    grupo: 'Estrutura',
    em: TODOS_OS_PLANOS,
    detalhe: porPlano(TODOS_OS_PLANOS, (l) =>
      aVontade(l.unidades, (n) => (n === 1 ? '1' : `até ${n}`)),
    ),
    destaque: true,
  },
  // Duas linhas, e a diferenca entre elas e o modelo de cobranca inteiro:
  // cadastrar a equipe e de graca, o que se paga e quanta gente fica dentro ao
  // mesmo tempo. Numa linha so, quem tem doze cadastrados e paga por tres
  // acharia que a conta esta errada.
  {
    titulo: 'Pessoas cadastradas',
    grupo: 'Estrutura',
    em: TODOS_OS_PLANOS,
    detalhe: porPlano(TODOS_OS_PLANOS, () => 'à vontade'),
  },
  {
    titulo: 'Dentro ao mesmo tempo',
    grupo: 'Estrutura',
    em: TODOS_OS_PLANOS,
    detalhe: porPlano(TODOS_OS_PLANOS, (l) =>
      aVontade(l.vagas, (n) => (l.porVagaExtra ? `${n} (+R$ ${l.porVagaExtra} cada)` : String(n))),
    ),
    destaque: true,
  },
  { titulo: 'Estoque e caixa separados por loja', grupo: 'Estrutura', em: SEM_GRATIS, destaque: true },
  { titulo: 'Painel consolidado da rede', grupo: 'Estrutura', em: DE_REDE },
  {
    titulo: 'Comparação entre lojas',
    grupo: 'Estrutura',
    em: DE_REDE,
    destaque: true,
  },
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
export const GRUPOS: Recurso['grupo'][] = ['Operação', 'Dinheiro', 'Equipe', 'Assistente', 'Estrutura']

// ─────────────────────────────────────────────────────────────
// O QUE CADA PLANO ABRE DENTRO DE UMA TELA — a escada
// ─────────────────────────────────────────────────────────────
//
// Módulo é grosso: liga ou desliga uma tela inteira. Isto aqui é fino: a
// MESMA tela existe em todo plano, e o que muda é quanto dela está aberto. O
// quadro de tarefas está no Grátis; o responsável e o prazo entram no Balcão;
// a linha do tempo, no Assistente; a visão da rede, na Direção.
//
// ── por que a parte trancada APARECE ─────────────────────────
// Esconder o que o plano não tem ensina que o sistema é pequeno. Mostrar
// trancado — com um exemplo por trás e o nome do plano que abre — ensina o
// que existe, e é a melhor propaganda que o plano de cima pode ter. A regra
// de cortesia é uma só: trancado nunca parece quebrado. Tem cadeado, tem o
// nome do plano, tem botão para ver os planos. Ver `ui/Cadeado.tsx`.
//
// ── por que é "a partir de", e não lista ─────────────────────
// Todo recurso, quando existe, existe do plano X para cima — é a mesma escada
// que a tabela de comparação já confere. Plano novo acima herda sozinho;
// lista precisaria ser lembrada.

export const LIBERACOES = {
  'tarefas.quadro': { desde: 'GRATIS', titulo: 'Quadro de tarefas' },
  'tarefas.varios': { desde: 'BALCAO', titulo: 'Mais de um quadro' },
  'tarefas.responsavel': { desde: 'BALCAO', titulo: 'Responsável pela tarefa' },
  'tarefas.prazo': { desde: 'BALCAO', titulo: 'Prazo da tarefa' },
  'tarefas.prioridade': { desde: 'BALCAO', titulo: 'Prioridade em estrelas' },
  'tarefas.linhaDoTempo': { desde: 'BALCAO_AGENTE', titulo: 'Linha do tempo' },
  'tarefas.modelos': { desde: 'BALCAO_AGENTE', titulo: 'Modelos de quadro' },
  'tarefas.rede': { desde: 'REDE', titulo: 'Quadro da rede inteira' },
  'desempenho.basico': { desde: 'BALCAO_AGENTE', titulo: 'Desempenho da equipe' },
  'desempenho.completo': { desde: 'REDE', titulo: 'Desempenho completo' },
  'precos.margem': { desde: 'BALCAO', titulo: 'Margem e markup' },
  'precos.sugestao': { desde: 'BALCAO_AGENTE', titulo: 'Preço sugerido' },
  'ruptura.previsao': { desde: 'REDE', titulo: 'Previsão de ruptura' },
} as const satisfies Record<string, { desde: Plano; titulo: string }>

export type Liberacao = keyof typeof LIBERACOES

/** Este plano abre este pedaço? */
export function liberado(plano: Plano, chave: Liberacao): boolean {
  return PLANOS[plano].degrau >= PLANOS[LIBERACOES[chave].desde].degrau
}

/** O plano que abre este pedaço — para a tela dizer "do Balcão para cima". */
export function planoQueAbre(chave: Liberacao): Limite & { codigo: Plano } {
  const codigo = LIBERACOES[chave].desde
  return { ...PLANOS[codigo], codigo }
}

/** "do Balcão", "da Direção" — com o artigo que o nome pede. */
export function doPlano(p: Plano): string {
  const l = PLANOS[p]
  return `${l.artigo === 'a' ? 'da' : 'do'} ${l.titulo}`
}

/**
 * No Grátis o quadro é um só, e as tarefas em aberto têm teto.
 *
 * Trinta é o tamanho de uma lista de abertura e fechamento com folga. Quem
 * passa disso está organizando uma equipe, e organizar equipe é o Balcão.
 */
export const TAREFAS_ABERTAS_NO_GRATIS = 30
