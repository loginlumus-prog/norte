// O fechamento de mês, guiado.
//
// ── o problema que ele resolve ───────────────────────────────
// Fechar o mês não é uma tela, é uma SEQUÊNCIA de conferências que quase
// ninguém lembra inteira. O caixa de um sábado ficou aberto e o dinheiro
// daquele turno nunca entrou na conta; a conta de luz venceu e ninguém
// marcou; a maquininha cobrou taxa e o DRE não sabia. Cada um desses erra o
// resultado do mês para cima — e o dono descobre no ano seguinte, com o
// contador.
//
// Esta tela é a lista que a contadora faria por telefone, com o número de
// cada pendência já calculado e um link para onde se resolve.
//
// ── por que ela não "fecha" nada ─────────────────────────────
// Não existe botão de fechar o mês, e é de propósito. Trancar o mês exigiria
// uma trava no banco, e trava que a loja não entende vira chamado de suporte
// no dia em que alguém precisa lançar uma nota atrasada. O que a loja precisa
// aqui é SABER o que falta — não ser impedida.
//
// A conferência em si (`conferir`) é pura: entra fato, sai lista. É o pedaço
// que decide o que aparece em vermelho, e é o que tem teste.

import { comoOrg } from './banco'
import { exigir, pode, type Capacidade, type Sessao } from './permissao'
import { plural } from './texto'
import { diaEmSP, inicioDoDiaEmSP } from './dia'
import { montarDRE, aVencer, type DRE } from './financeiro'
import { listarCaixas } from './caixa'
import { resumoCrediario } from './crediario'
import { taxasDaEmpresa } from './taxas'
import { mesValido, nomeDoMes } from './metas'

export type Situacao = 'ok' | 'atencao' | 'pendente'

export type ItemDoFechamento = {
  chave: string
  titulo: string
  /** O número que sustenta a situação. */
  detalhe: string
  /** Por que isso importa para o resultado do mês. */
  porque: string
  situacao: Situacao
  /**
   * Para onde ir resolver. Sem `href` quando quem olha não abre aquela tela:
   * aí vira frase dizendo quem resolve — link que dá "este endereço não
   * abre" parece sistema quebrado.
   */
  onde?: { texto: string; href?: string }
}

/**
 * Tudo que a conferência precisa saber, já medido.
 *
 * Separado da busca no banco porque é aqui que mora a decisão — e decisão
 * sobre o que é pendência e o que é aviso é o tipo de regra que muda de
 * ideia com o tempo e precisa de teste.
 */
export type FatosDoMes = {
  caixasAbertos: number
  /** Soma do que faltou ou sobrou nas gavetas, em módulo. */
  diferencaGaveta: number
  turnosFechados: number
  contasVencidas: number
  valorVencido: number
  /** Nulo quando a empresa não usa crediário. */
  parcelasVencidas: number | null
  valorParcelasVencidas: number
  /** A loja recebeu em cartão ou Pix neste mês? */
  recebeuEmMaquina: boolean
  /** Alguma taxa escrita em Configurações? */
  temTaxa: boolean
  receita: number
  resultado: number
}

/** Diferença de gaveta acima disto deixa de ser troco e vira conferência. */
const GAVETA_TOLERANCIA = 20

export function conferir(f: FatosDoMes, slug: string): ItemDoFechamento[] {
  const brl = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const itens: ItemDoFechamento[] = [
    {
      chave: 'caixas',
      titulo: 'Todo caixa do mês foi fechado',
      detalhe:
        f.caixasAbertos === 0
          ? `${plural(f.turnosFechados, 'turno fechado', 'turnos fechados')}`
          : `${plural(f.caixasAbertos, 'caixa ainda aberto', 'caixas ainda abertos')}`,
      porque:
        'Caixa aberto não tem conferência de gaveta. O que faltou naquele turno não aparece em lugar nenhum, e o resultado do mês fica otimista.',
      situacao: f.caixasAbertos === 0 ? 'ok' : 'pendente',
      onde: f.caixasAbertos > 0 ? { texto: 'Ver os turnos', href: `/${slug}/caixa` } : undefined,
    },
    {
      chave: 'gaveta',
      titulo: 'A gaveta bateu com o sistema',
      detalhe:
        f.turnosFechados === 0
          ? 'nenhum turno fechado no mês'
          : f.diferencaGaveta === 0
            ? 'bateu em todos os turnos'
            : `${brl(f.diferencaGaveta)} de diferença somada`,
      porque:
        'Diferença pequena é troco. Diferença que repete é sangria que ninguém anotou, venda registrada errada, ou dinheiro saindo.',
      situacao:
        f.turnosFechados === 0 || f.diferencaGaveta === 0
          ? 'ok'
          : f.diferencaGaveta <= GAVETA_TOLERANCIA
            ? 'atencao'
            : 'pendente',
      onde:
        f.diferencaGaveta > 0 ? { texto: 'Conferir os turnos', href: `/${slug}/caixa` } : undefined,
    },
    {
      chave: 'contas',
      titulo: 'As contas do mês estão pagas',
      detalhe:
        f.contasVencidas === 0
          ? 'nenhuma conta vencida em aberto'
          : `${plural(f.contasVencidas, 'vencida', 'vencidas')}, somando ${brl(f.valorVencido)}`,
      porque:
        'Conta vencida corre juro e multa enquanto fica parada, e some do resultado do mês em que era para ter sido paga.',
      situacao: f.contasVencidas === 0 ? 'ok' : 'pendente',
      onde:
        f.contasVencidas > 0 ? { texto: 'Ver o que vence', href: `/${slug}/financeiro` } : undefined,
    },
    {
      chave: 'taxa',
      titulo: 'A taxa da maquininha está no cálculo',
      detalhe: !f.recebeuEmMaquina
        ? 'não houve recebimento em cartão ou Pix'
        : f.temTaxa
          ? 'taxas escritas em Configurações'
          : 'a loja recebeu em máquina e nenhuma taxa foi escrita',
      porque:
        'Sem a taxa, o DRE conta o valor cheio da venda. A maquininha desconta antes de depositar, e o lucro do mês fica maior do que foi de verdade.',
      situacao: !f.recebeuEmMaquina ? 'ok' : f.temTaxa ? 'ok' : 'pendente',
      onde:
        f.recebeuEmMaquina && !f.temTaxa
          ? { texto: 'Escrever as taxas', href: `/${slug}/configuracoes` }
          : undefined,
    },
  ]

  // O crediário só aparece para quem usa. Linha de conferência sobre coisa
  // que a loja não faz é ruído, e ruído ensina a pular a lista inteira.
  if (f.parcelasVencidas !== null) {
    itens.push({
      chave: 'crediario',
      titulo: 'O fiado do mês foi cobrado',
      detalhe:
        f.parcelasVencidas === 0
          ? 'nenhuma parcela vencida'
          : `${plural(f.parcelasVencidas, 'parcela vencida', 'parcelas vencidas')}, somando ${brl(f.valorParcelasVencidas)}`,
      porque:
        'Parcela vencida é venda que já saiu do estoque e ainda não virou dinheiro. Quanto mais velha, menos se recebe.',
      situacao: f.parcelasVencidas === 0 ? 'ok' : 'atencao',
      onde:
        f.parcelasVencidas > 0
          ? { texto: 'Ver quem deve', href: `/${slug}/crediario` }
          : undefined,
    })
  }

  itens.push({
    chave: 'resultado',
    titulo: 'O resultado do mês',
    detalhe:
      f.receita === 0
        ? 'nenhuma venda no mês'
        : `${brl(f.resultado)} sobre ${brl(f.receita)} de receita`,
    porque:
      'É o que sobrou depois de tudo: mercadoria, pessoal, ocupação e taxa. Com as linhas acima resolvidas, este número é o número.',
    situacao: f.receita === 0 ? 'atencao' : f.resultado >= 0 ? 'ok' : 'pendente',
    onde: { texto: 'Abrir o DRE', href: `/${slug}/financeiro` },
  })

  return itens
}

export type Fechamento = {
  mes: string
  titulo: string
  de: Date
  ate: Date
  itens: ItemDoFechamento[]
  dre: DRE
  /** Quantas linhas estão resolvidas. */
  prontos: number
  pendentes: number
}

/**
 * Início e fim (exclusivo) de "AAAA-MM", à meia-noite de São Paulo.
 *
 * Já foi a meia-noite da máquina: num servidor em UTC o mês começava às 21h
 * do último dia do anterior, e a venda da noite de 31/08 entrava no
 * fechamento de setembro.
 */
export function janelaDoMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  const seguinte = new Date(Date.UTC(a!, m!, 1)).toISOString().slice(0, 7)
  return { de: inicioDoDiaEmSP(`${mes}-01`), ate: inicioDoDiaEmSP(`${seguinte}-01`) }
}

/** O mês "AAAA-MM" somado de `n`. Aritmética de calendário, sem relógio. */
export function outroMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a!, m! - 1 + n, 1)).toISOString().slice(0, 7)
}

/** O mês de agora no calendário de São Paulo. */
export const mesDeAgora = (agora: Date = new Date()) => diaEmSP(agora).slice(0, 7)

// Quem abre cada tela para onde o fechamento aponta — a mesma régua que a
// própria tela usa para não abrir.
const QUEM_ABRE: { fim: string; capacidade: Capacidade; tela: string; quem: string }[] = [
  { fim: '/caixa', capacidade: 'caixa.ver', tela: 'Caixa', quem: 'quem cuida do caixa' },
  { fim: '/configuracoes', capacidade: 'empresa.configurar', tela: 'Configurações', quem: 'quem configura a empresa' },
  { fim: '/crediario', capacidade: 'crediario.ver', tela: 'Crediário', quem: 'quem cuida do crediário' },
  { fim: '/financeiro', capacidade: 'financeiro.ver', tela: 'Financeiro', quem: 'quem cuida do financeiro' },
]

/**
 * Tira o link das linhas que apontam para tela que esta pessoa não abre, e
 * diz no lugar quem resolve. Pura.
 */
export function soOQueAbre(itens: ItemDoFechamento[], podeAbrir: (c: Capacidade) => boolean): ItemDoFechamento[] {
  return itens.map((i) => {
    if (!i.onde?.href) return i
    const alvo = QUEM_ABRE.find((q) => i.onde!.href!.split('?')[0]!.endsWith(q.fim))
    if (!alvo || podeAbrir(alvo.capacidade)) return i
    return { ...i, onde: { texto: `Isso se resolve em ${alvo.tela}, com ${alvo.quem}.` } }
  })
}

export async function montarFechamento(
  sessao: Sessao,
  unidadeIds: string[],
  mes: string,
  slug: string,
  usaCrediario: boolean,
): Promise<Fechamento> {
  exigir(sessao, 'financeiro.ver')
  if (!mesValido(mes)) throw new Error('Mês inválido.')

  const { de, ate } = janelaDoMes(mes)
  // O DRE fecha no último instante do mês: `montarDRE` compara com `lte`, e
  // `ate` é o primeiro dia do mês seguinte.
  const fimDoMes = new Date(ate.getTime() - 1)

  const dre = await montarDRE(sessao, unidadeIds, de, fimDoMes)
  const contas = await aVencer(sessao, unidadeIds, 15)

  const turnos = pode(sessao, 'caixa.ver')
    ? await listarCaixas(sessao, { unidadeIds, de, ate })
    : []
  const fechados = turnos.filter((t) => !t.aberto)

  const fiado = usaCrediario && pode(sessao, 'crediario.ver')
    ? await resumoCrediario(sessao, unidadeIds)
    : null

  const taxas = await taxasDaEmpresa(sessao)

  // "Recebeu em máquina" olha o pagamento, não a venda: é o cartão e o Pix
  // que cobram taxa, e uma loja pode ter vendido muito e recebido tudo em
  // dinheiro.
  const recebeuEmMaquina = await comoOrg(sessao.orgId, async (db) => {
    const linha = await db.pagamento.findFirst({
      where: {
        forma: { in: ['CREDITO', 'DEBITO', 'PIX'] },
        venda: {
          unidadeId: { in: unidadeIds },
          situacao: 'CONCLUIDA',
          criadaEm: { gte: de, lt: ate },
        },
      },
      select: { id: true },
    })
    return linha !== null
  })

  // `bruta` é a receita depois da devolução e das outras receitas — a mesma
  // linha que a tela do financeiro mostra em negrito.
  const receita = dre.linhas.find((l) => l.chave === 'bruta')?.valor ?? 0

  const itens = soOQueAbre(conferir(
    {
      caixasAbertos: turnos.length - fechados.length,
      diferencaGaveta: fechados.reduce((s, t) => s + Math.abs(t.diferenca ?? 0), 0),
      turnosFechados: fechados.length,
      contasVencidas: contas.vencidas.length,
      valorVencido: contas.totalVencido,
      parcelasVencidas: fiado ? fiado.parcelasVencidas : null,
      valorParcelasVencidas: fiado ? fiado.vencido : 0,
      recebeuEmMaquina,
      temTaxa: taxas.length > 0,
      receita,
      resultado: dre.resultado,
    },
    slug,
  ), (c) => pode(sessao, c))

  return {
    mes,
    titulo: nomeDoMes(mes),
    de,
    ate,
    itens,
    dre,
    prontos: itens.filter((i) => i.situacao === 'ok').length,
    pendentes: itens.filter((i) => i.situacao === 'pendente').length,
  }
}
