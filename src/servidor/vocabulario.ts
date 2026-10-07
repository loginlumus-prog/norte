// Como o negócio chama quem ele atende.
//
// A loja tem CLIENTE; a clínica tem PACIENTE; a escola tem ALUNO. É a mesma
// ficha (`Cliente`), com o mesmo histórico, a mesma LGPD e as mesmas regras —
// o que muda é a palavra na tela. Quem trabalha numa clínica e lê "Clientes"
// no menu sente que o sistema não é para ela; a palavra certa é o que faz a
// tela parecer feita para o lugar.
//
// ── a regra de modulos.ts continua valendo ───────────────────
// O ramo escolhe o que é SEMEADO e o que se ESCREVE, nunca o caminho do
// código. Não existe "tela de paciente": existe a tela de clientes, que diz
// "Pacientes" porque a empresa é uma clínica. Por isso o vocabulário mora
// aqui, num lugar só, e as telas pedem a palavra em vez de perguntar o ramo.
//
// ── e as telas ───────────────────────────────────────────────
// O mesmo vale para o nome de duas telas. Na clínica, quem cobra a consulta
// fica na RECEPÇÃO, não no "balcão"; na escola, na SECRETARIA. E o catálogo
// da clínica é de serviços e materiais, não de "produtos". A tela continua
// uma só (o balcão de sempre, o cadastro de sempre); muda o que o menu, o
// título e o guia escrevem.
//
// ── e a venda ────────────────────────────────────────────────
// E a própria venda: a clínica registra ATENDIMENTO, a escola RECEBIMENTO, e
// as duas dizem "Recebido hoje" onde a loja diz "Vendido hoje". Mesma `Venda`
// no banco, mesmo /vendas no endereço (ver PalavrasDaVenda).
//
// Puro em cima (as palavras); a leitura do ramo da empresa, embaixo.

import { cache } from 'react'
import { acharOrgPorSlug, comoOrg } from './banco'
import type { Ramo } from './modulos'

export type ChaveVocabulario = 'clientes' | 'pacientes' | 'alunos'

export type Vocabulario = {
  chave: ChaveVocabulario
  /** "cliente" */
  pessoa: string
  /** "clientes" */
  pessoas: string
  /** "Cliente" — começo de frase, rótulo de campo. */
  Pessoa: string
  /** "Clientes" — menu, título. */
  Pessoas: string
  /** "Novo cliente" — o botão e o título do cadastro. */
  novo: string
  /** "do cliente" — "Nome do paciente", "Ficha do aluno". */
  daPessoa: string
  /**
   * A frase do campo de observação da agenda, quando o ramo pede cuidado. Na
   * clínica ela diz com todas as letras que informação de saúde não entra ali
   * — o Norte não guarda prontuário, e anotação clínica num campo de agenda é
   * dado sensível espalhado onde não devia (LGPD, art. 11).
   */
  avisoObservacao: string | null
}

/** O nome das telas que mudam com o ramo — menu, título da tela e guia. */
export type NomesDasTelas = {
  /** "Balcão", "Recepção", "Secretaria". */
  Balcao: string
  /** "o balcão", "a recepção" — "Abrir a recepção". */
  oBalcao: string
  /** "no balcão", "na recepção" — "Recebido na recepção". */
  noBalcao: string
  /** "pelo balcão", "pela secretaria" — "o que entrou pela secretaria". */
  peloBalcao: string
  /** "Produtos", "Serviços e materiais". */
  Produtos: string
}

/**
 * Como o ramo fala da VENDA — a mesma `Venda` do banco, com outra palavra.
 *
 * A clínica não "vende" consulta: ela atende e recebe. "Vendido hoje · 15
 * vendas" e "Mais vendidos: Consulta, 24 un" é o painel de uma loja lido em
 * voz alta dentro de um consultório. Então a palavra muda — e só ela: a lista
 * continua em /vendas, a conta do ticket é a mesma, a regra é a mesma.
 */
export type PalavrasDaVenda = {
  /** O grupo do menu onde moram balcão, vendas e caixa: "Vender", "Recepção". */
  grupoVender: string
  /**
   * A lista do que foi cobrado — menu e título: "Vendas", "Recebimentos".
   *
   * Na clínica a CONTA é de atendimentos ("15 atendimentos"), mas a lista é
   * de recebimentos: é dinheiro que entrou, e no menu ela fica logo acima do
   * grupo "Atendimento" (Agenda) — "Atendimentos" ali seriam dois nomes quase
   * iguais para duas telas diferentes.
   */
  Vendas: string
  /** O rótulo de uma contagem: "Vendas", "Atendimentos" — "Atendimentos: 15". */
  Contagem: string
  /** "venda", "atendimento", "recebimento". */
  venda: string
  vendas: string
  /** "Venda" — começo de frase: "Venda 123 concluída". */
  Venda: string
  /** A palavra é feminina? Decide "concluída/concluído", "nenhuma/nenhum". */
  vendaFeminina: boolean
  /** "a venda" / "o atendimento". */
  aVenda: string
  /** "na venda" / "no atendimento". */
  naVenda: string
  /** "da venda" / "do atendimento". */
  daVenda: string
  /** "esta venda" / "este atendimento" — "Cancelar esta venda". */
  estaVenda: string
  /** "desta venda" / "deste atendimento". */
  destaVenda: string
  /** "nesta venda" / "neste atendimento". */
  nestaVenda: string
  /** "uma venda" / "um atendimento". */
  umaVenda: string
  /** "Nenhuma venda" / "Nenhum atendimento" — começo de frase. */
  nenhumaVenda: string
  /** "Nova venda" / "Novo atendimento" — o botão depois de concluir. */
  novaVenda: string
  /** "Venda concluída" / "Atendimento concluído". */
  vendaConcluida: string
  /** O carrinho do balcão: "Pedido" na loja; na recepção, o próprio "Atendimento". */
  Pedido: string
  /** O verbo do balcão: "vender", "receber" — "começar a receber". */
  vender: string
  /** "Vender", "Receber" — o botão grande do painel. */
  Vender: string
  /** Quem fez: "Vendeu", "Atendeu", "Recebeu" — coluna da lista. */
  vendeu: string
  /** O campo de quem fez, no balcão: "Vendedor", "Quem atendeu". */
  Vendedor: string
  /** "Vendido", "Recebido" — "Vendido hoje", "Total recebido". */
  Vendido: string
  /** "Ticket médio" é conversa de loja; o consultório fala "Valor médio". */
  ticketMedio: string
  /** "Mais vendidos", "Mais procurados". */
  maisVendidos: string
  /** O título do calor de dia × hora: "Quando a loja vende". */
  quandoVende: string
  /** O que a pessoa fez do lado de lá: "compra", "atendimento". */
  compra: string
  compras: string
  /** A pergunta do balcão: "Quem está comprando?". */
  quemCompra: string
  /** "de 12 pessoas que compraram" / "que foram atendidas". */
  compraram: string
  /** Um item do catálogo, na hora de vender: "produto", "serviço". */
  produto: string
  produtos: string
  /** O "Cadastrar serviço" do painel abre a ficha já marcada como serviço. */
  produtoEhServico: boolean
  /** O botão do cadastro: "Novo produto", "Novo serviço ou material". */
  novoProduto: string
  /** O que o cadastro pede, no atalho do painel. */
  resumoCadastro: string
  /** O que chega do fornecedor: "mercadoria", "material". */
  mercadoria: string
  /** "A mercadoria", "O material" — começo de frase. */
  aMercadoria: string
  /** "um produto", "um material" — o que se cadastra para ter estoque. */
  umItemDeEstoque: string
  /** "produto"/"produtos", "material"/"materiais" — "2 materiais no mínimo". */
  itemDeEstoque: string
  itensDeEstoque: string
  /** Por que o que acabou importa: a loja perde venda; a clínica, o material do atendimento. */
  acabouNoEstoque: string
  /**
   * O que o total das vendas NÃO soma, dito ao lado do número. Na escola, o
   * "Recebido hoje" do painel é o da secretaria — material, uniforme, curso —
   * e a mensalidade tem conta própria. Sem o aviso, o diretor lê "R$ 0,00
   * recebido" no dia em que entraram dez mensalidades. Nulo: soma tudo.
   */
  foraDoTotal: string | null
  /**
   * A lista de clientes e a ficha: o que a pessoa fez com a casa. Na escola o
   * que a ficha do aluno soma é o que ele comprou NA SECRETARIA (material,
   * uniforme) — a mensalidade tem conta própria. "41 nunca compraram" e
   * "Gastou aqui" na ficha de um aluno eram a lista de uma loja lida na
   * secretaria, e pareciam dizer que ele nunca pagou nada.
   */
  naFicha: {
    /** O total: "Gastou", "Pagou", "Na secretaria". */
    Gastou: string
    /** "Última compra", "Último atendimento". */
    Ultima: string
    /** A coluna da contagem: "Compras", "Atendimentos". */
    Contagem: string
    /** "comprou", "foi atendido" — a ficha da tira, no singular. */
    comprou: string
    compraram: string
    /** "nunca comprou" — célula e ficha. */
    nunca: string
    nuncaPlural: string
    /** "compra"/"compras" na frase da ficha: "3 compras". */
    uma: string
    varias: string
  }
}

/** As palavras do ramo: quem é atendido, como as telas se chamam e como se fala da venda. */
export type VocabularioDoRamo = Vocabulario & NomesDasTelas & PalavrasDaVenda

const VOCABULARIOS: Record<ChaveVocabulario, Vocabulario> = {
  clientes: {
    chave: 'clientes',
    pessoa: 'cliente',
    pessoas: 'clientes',
    Pessoa: 'Cliente',
    Pessoas: 'Clientes',
    novo: 'Novo cliente',
    daPessoa: 'do cliente',
    avisoObservacao: null,
  },
  pacientes: {
    chave: 'pacientes',
    pessoa: 'paciente',
    pessoas: 'pacientes',
    Pessoa: 'Paciente',
    Pessoas: 'Pacientes',
    novo: 'Novo paciente',
    daPessoa: 'do paciente',
    avisoObservacao:
      'Só combinados de atendimento (chega mais cedo, prefere a sala térrea). Não escreva sintoma, diagnóstico, exame ou remédio: informação de saúde não mora aqui.',
  },
  alunos: {
    chave: 'alunos',
    pessoa: 'aluno',
    pessoas: 'alunos',
    Pessoa: 'Aluno',
    Pessoas: 'Alunos',
    novo: 'Novo aluno',
    daPessoa: 'do aluno',
    avisoObservacao: null,
  },
}

const TELAS_PADRAO: NomesDasTelas = {
  Balcao: 'Balcão', oBalcao: 'o balcão', noBalcao: 'no balcão', peloBalcao: 'pelo balcão', Produtos: 'Produtos',
}

const RECEPCAO = { Balcao: 'Recepção', oBalcao: 'a recepção', noBalcao: 'na recepção', peloBalcao: 'pela recepção' }

/**
 * Os ramos que chamam as telas de outro jeito. O resto usa o padrão.
 *
 * O salão e a clínica recebem na RECEPÇÃO; a escola, na SECRETARIA. O
 * catálogo da clínica é quase todo serviço (consulta, sessão) mais o material
 * de uso — "Produtos" ali soa a farmácia; o do salão é serviço e o produto de
 * revenda. A escola vende material e uniforme: "Produtos" serve.
 */
const TELAS: Partial<Record<Ramo, Partial<NomesDasTelas>>> = {
  beleza: { ...RECEPCAO, Produtos: 'Serviços e produtos' },
  saude: { ...RECEPCAO, Produtos: 'Serviços e materiais' },
  escola: { Balcao: 'Secretaria', oBalcao: 'a secretaria', noBalcao: 'na secretaria', peloBalcao: 'pela secretaria' },
}

// ── a venda ──────────────────────────────────────────────────
// A palavra e o gênero bastam: as contrações ("na venda", "no atendimento")
// saem daqui, e não de um `? :` em cada tela — que é onde "o atendimento
// concluída" nasceria.

type BaseDaVenda = Omit<
  PalavrasDaVenda,
  | 'Venda' | 'aVenda' | 'naVenda' | 'daVenda' | 'estaVenda' | 'destaVenda' | 'nestaVenda' | 'umaVenda' | 'nenhumaVenda' | 'novaVenda'
  | 'vendaConcluida' | 'Pedido' | 'Contagem' | 'Vender' | 'Vendedor' | 'aMercadoria'
> & { mercadoriaFeminina: boolean }

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function montarVenda(b: BaseDaVenda): PalavrasDaVenda {
  const f = b.vendaFeminina
  const { mercadoriaFeminina, ...resto } = b
  return {
    ...resto,
    Venda: maiuscula(b.venda),
    Contagem: maiuscula(b.vendas),
    aVenda: `${f ? 'a' : 'o'} ${b.venda}`,
    naVenda: `${f ? 'na' : 'no'} ${b.venda}`,
    daVenda: `${f ? 'da' : 'do'} ${b.venda}`,
    estaVenda: `${f ? 'esta' : 'este'} ${b.venda}`,
    destaVenda: `${f ? 'desta' : 'deste'} ${b.venda}`,
    nestaVenda: `${f ? 'nesta' : 'neste'} ${b.venda}`,
    umaVenda: `${f ? 'uma' : 'um'} ${b.venda}`,
    nenhumaVenda: `${f ? 'Nenhuma' : 'Nenhum'} ${b.venda}`,
    novaVenda: `${f ? 'Nova' : 'Novo'} ${b.venda}`,
    vendaConcluida: `${maiuscula(b.venda)} ${f ? 'concluída' : 'concluído'}`,
    // A loja monta um PEDIDO e fecha a venda; a recepção monta o atendimento.
    Pedido: b.venda === 'venda' ? 'Pedido' : maiuscula(b.venda),
    Vender: maiuscula(b.vender),
    // A loja tem VENDEDOR; a recepção pergunta quem atendeu.
    Vendedor: b.vendeu === 'Vendeu' ? 'Vendedor' : `Quem ${b.vendeu.toLowerCase()}`,
    aMercadoria: `${mercadoriaFeminina ? 'A' : 'O'} ${b.mercadoria}`,
  }
}

/** A loja — e todo ramo que não está na tabela de baixo. É o texto de sempre. */
const VENDA_DA_LOJA = montarVenda({
  grupoVender: 'Vender',
  Vendas: 'Vendas',
  venda: 'venda',
  vendas: 'vendas',
  vendaFeminina: true,
  vender: 'vender',
  vendeu: 'Vendeu',
  Vendido: 'Vendido',
  ticketMedio: 'Ticket médio',
  maisVendidos: 'Mais vendidos',
  quandoVende: 'Quando a loja vende',
  compra: 'compra',
  compras: 'compras',
  quemCompra: 'Quem está comprando?',
  compraram: 'compraram',
  produto: 'produto',
  produtos: 'produtos',
  produtoEhServico: false,
  novoProduto: 'Novo produto',
  resumoCadastro: 'Nome, preço e código.',
  mercadoria: 'mercadoria',
  mercadoriaFeminina: true,
  umItemDeEstoque: 'um produto',
  itemDeEstoque: 'produto',
  itensDeEstoque: 'produtos',
  acabouNoEstoque: 'Sem saldo para vender — é venda indo para o vizinho.',
  foraDoTotal: null,
  naFicha: {
    Gastou: 'Gastou', Ultima: 'Última compra', Contagem: 'Compras',
    comprou: 'comprou', compraram: 'compraram', nunca: 'nunca comprou', nuncaPlural: 'nunca compraram',
    uma: 'compra', varias: 'compras',
  },
})

/**
 * Quem atende com hora marcada. Na recepção da clínica e do salão o que se
 * registra é o ATENDIMENTO — a consulta, a escova — e o que entra é
 * RECEBIDO. O catálogo, na hora de cobrar, é de serviços; o que chega do
 * fornecedor é material, não mercadoria.
 */
const ATENDIMENTO = {
  grupoVender: 'Recepção',
  Vendas: 'Recebimentos',
  venda: 'atendimento',
  vendas: 'atendimentos',
  vendaFeminina: false,
  vender: 'receber',
  vendeu: 'Atendeu',
  Vendido: 'Recebido',
  ticketMedio: 'Valor médio',
  maisVendidos: 'Mais procurados',
  // Sem "a clínica" ou "o salão": o painel é da empresa, e a mesma empresa
  // pode ter uma loja de outro ramo.
  quandoVende: 'Quando há mais movimento',
  compra: 'atendimento',
  compras: 'atendimentos',
  quemCompra: 'Quem está sendo atendido?',
  compraram: 'foram atendidas',
  produto: 'serviço',
  produtos: 'serviços',
  produtoEhServico: true,
  resumoCadastro: 'Nome, preço e duração.',
  mercadoria: 'material',
  mercadoriaFeminina: false,
  umItemDeEstoque: 'um material',
  itemDeEstoque: 'material',
  itensDeEstoque: 'materiais',
  acabouNoEstoque: 'Sem saldo — peça antes que faça falta no atendimento.',
  foraDoTotal: null,
  naFicha: {
    Gastou: 'Pagou', Ultima: 'Último atendimento', Contagem: 'Atendimentos',
    comprou: 'foi atendido', compraram: 'foram atendidos', nunca: 'nunca foi atendido', nuncaPlural: 'nunca foram atendidos',
    uma: 'atendimento', varias: 'atendimentos',
  },
} satisfies Omit<BaseDaVenda, 'novoProduto'>

/**
 * O jeito de cada ramo falar da venda. O resto fala como loja.
 *
 * A escola recebe na secretaria — a mensalidade tem tela própria; aqui é o
 * material, o uniforme, o curso avulso —, e o que a secretaria faz é
 * RECEBER. "Atendimento" não serve: ninguém "atende" o pai que paga o
 * uniforme. O catálogo dela continua de produtos (ver TELAS).
 */
const VENDA: Partial<Record<Ramo, PalavrasDaVenda>> = {
  saude: montarVenda({ ...ATENDIMENTO, novoProduto: 'Novo serviço ou material' }),
  beleza: montarVenda({ ...ATENDIMENTO, novoProduto: 'Novo serviço ou produto' }),
  escola: montarVenda({
    grupoVender: 'Secretaria',
    Vendas: 'Recebimentos',
    venda: 'recebimento',
    vendas: 'recebimentos',
    vendaFeminina: false,
    vender: 'receber',
    vendeu: 'Recebeu',
    Vendido: 'Recebido',
    ticketMedio: 'Valor médio',
    maisVendidos: 'Mais procurados',
    quandoVende: 'Quando há mais movimento',
    compra: 'pagamento',
    compras: 'pagamentos',
    quemCompra: 'Quem está pagando?',
    compraram: 'pagaram',
    produto: 'produto',
    produtos: 'produtos',
    produtoEhServico: false,
    novoProduto: 'Novo produto',
    resumoCadastro: 'Nome, preço e código.',
    mercadoria: 'material',
    mercadoriaFeminina: false,
    umItemDeEstoque: 'um material',
    itemDeEstoque: 'material',
    itensDeEstoque: 'materiais',
    acabouNoEstoque: 'Sem saldo — peça antes que faça falta.',
    foraDoTotal: 'sem as mensalidades',
    naFicha: {
      Gastou: 'Total na secretaria', Ultima: 'Último recebimento', Contagem: 'Recebimentos',
      comprou: 'comprou na secretaria', compraram: 'compraram na secretaria',
      nunca: 'nada na secretaria', nuncaPlural: 'sem compra na secretaria',
      uma: 'recebimento', varias: 'recebimentos',
    },
  }),
}

/** Os ramos que não chamam de cliente. O resto (a maioria) chama. */
const QUEM_ATENDE: Partial<Record<Ramo, ChaveVocabulario>> = {
  saude: 'pacientes',
  escola: 'alunos',
}

/** As palavras de um ramo. Ramo desconhecido ou vazio fala "cliente", "Balcão" e "venda". */
export function vocabularioDoRamo(ramo: string | null | undefined): VocabularioDoRamo {
  const chave = ramo && Object.hasOwn(QUEM_ATENDE, ramo) ? QUEM_ATENDE[ramo as Ramo]! : 'clientes'
  const telas = ramo && Object.hasOwn(TELAS, ramo) ? TELAS[ramo as Ramo] : undefined
  const venda = ramo && Object.hasOwn(VENDA, ramo) ? VENDA[ramo as Ramo]! : VENDA_DA_LOJA
  return { ...VOCABULARIOS[chave], ...TELAS_PADRAO, ...telas, ...venda }
}

/** O que o menu troca pela palavra do ramo: a chave do vocabulário. */
export type PalavraDoMenu = 'Pessoas' | 'Balcao' | 'Produtos' | 'Vendas'

/**
 * O título de um grupo do menu nesta empresa. Só o grupo "Vender" muda — na
 * clínica é "Recepção", na escola "Secretaria"; os outros são assunto
 * (Catálogo, Dinheiro) e servem a qualquer ramo.
 */
export function nomeDoGrupo(grupo: string, v: PalavrasDaVenda): string {
  // O grupo "Catálogo" aparece como "Produtos e estoque": "Catálogo" é também
  // o nome do catálogo online, no grupo Vender, e os dois juntos no menu
  // confundiam. A chave continua a mesma (é ela que guarda a cor do grupo).
  if (grupo === 'Catálogo') return 'Produtos e estoque'
  return grupo === VENDA_DA_LOJA.grupoVender ? v.grupoVender : grupo
}

/**
 * Os nomes das telas desta empresa que não são os do manual, pela chave da
 * entrada do guia (`guia.ts`): { balcao: 'Recepção', clientes: 'Pacientes' }.
 * Vazio para a loja de roupa — o guia fala como sempre falou.
 */
export function nomesNoGuia(v: VocabularioDoRamo): Record<string, string> {
  const nomes: Record<string, string> = {}
  if (v.Balcao !== TELAS_PADRAO.Balcao) nomes.balcao = v.Balcao
  if (v.Vendas !== VENDA_DA_LOJA.Vendas) nomes.vendas = v.Vendas
  if (v.Produtos !== TELAS_PADRAO.Produtos) nomes.produtos = v.Produtos
  if (v.Pessoas !== VOCABULARIOS.clientes.Pessoas) nomes.clientes = v.Pessoas
  return nomes
}

// ─────────────────────────────────────────────────────────────
// COM BANCO
// ─────────────────────────────────────────────────────────────

/**
 * O vocabulário da empresa, pelo ramo DELA (o do cadastro). O menu e as telas
 * de clientes são da empresa inteira, então vale o ramo da empresa — a loja
 * com ramo próprio muda o painel dela, não o nome do cadastro.
 *
 * Guardado por requisição: o menu, o título e a tela perguntam, o banco
 * responde uma vez.
 */
export const vocabularioDaEmpresa = cache(async (orgId: string): Promise<VocabularioDoRamo> => {
  try {
    const org = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { ramo: true } }))
    return vocabularioDoRamo(org?.ramo)
  } catch {
    // Palavra é enfeite: banco fora não derruba a tela por causa dela.
    return vocabularioDoRamo(null)
  }
})

/**
 * O mesmo, a partir do endereço — para o título da aba, que é montado antes
 * de existir sessão. Lê só o ramo da empresa do endereço.
 */
export const vocabularioDoEndereco = cache(async (slug: string): Promise<VocabularioDoRamo> => {
  try {
    const org = await acharOrgPorSlug(slug)
    return org ? await vocabularioDaEmpresa(org.id) : vocabularioDoRamo(null)
  } catch {
    return vocabularioDoRamo(null)
  }
})
