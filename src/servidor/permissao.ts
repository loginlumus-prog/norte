// Quem pode o quê.
//
// Duas decisões que valem entender antes de mexer:
//
// 1. Permissão é POR UNIDADE. O gerente da loja 3 não vê o caixa da loja 5.
//    Um acesso com `unidadeId: null` vale para todas — é o caso do dono.
//
// 2. O código nunca pergunta "é gerente?". Pergunta "pode fechar o caixa?".
//    Papel é atalho para um conjunto de capacidades; a regra de negócio se
//    apoia na capacidade. Assim, criar um papel novo não obriga a caçar
//    `if (papel === ...)` espalhado pelo sistema.
//
// Este arquivo é puro: não toca no banco, não faz I/O. Por isso é barato de
// testar exaustivamente — e é o lugar mais perigoso para errar.

export const CAPACIDADES = [
  // balcão
  'venda.ver',
  'venda.criar',
  'venda.cancelar',
  'caixa.ver',
  'caixa.operar', // abrir, sangrar, suprir, fechar
  // catálogo e estoque
  'produto.ver',
  'produto.editar',
  'produto.preco', // separado: mexer em preço não é editar descrição
  'estoque.ver',
  'estoque.ajustar',
  // pessoas
  'cliente.ver',
  'cliente.editar',
  // dinheiro
  'crediario.ver',
  'crediario.cobrar',
  'financeiro.ver',
  'financeiro.lancar',
  'relatorio.ver',
  // administração
  'equipe.ver',
  'equipe.gerir',
  'empresa.configurar',
  'agente.configurar',
  'auditoria.ver',
] as const

export type Capacidade = (typeof CAPACIDADES)[number]
export type Papel = 'DONO' | 'GERENTE' | 'BALCAO' | 'FINANCEIRO' | 'CONTADOR' | 'SUPORTE'

const SO_LEITURA: Capacidade[] = [
  'venda.ver',
  'caixa.ver',
  'produto.ver',
  'estoque.ver',
  'cliente.ver',
  'crediario.ver',
  'financeiro.ver',
  'relatorio.ver',
  'equipe.ver',
  'auditoria.ver',
]

export const PODERES: Record<Papel, readonly Capacidade[]> = {
  // Dono: tudo, em todas as unidades.
  DONO: CAPACIDADES,

  // Gerente: toca a operação da unidade dele. Não configura a empresa nem o
  // agente, e não lança no financeiro — vê, mas não escreve.
  GERENTE: [
    'venda.ver', 'venda.criar', 'venda.cancelar',
    'caixa.ver', 'caixa.operar',
    'produto.ver', 'produto.editar', 'produto.preco',
    'estoque.ver', 'estoque.ajustar',
    'cliente.ver', 'cliente.editar',
    'crediario.ver', 'crediario.cobrar',
    'financeiro.ver', 'relatorio.ver',
    'equipe.ver', 'equipe.gerir', 'auditoria.ver',
  ],

  // Balcão: vende. Não mexe em preço, não ajusta estoque, não vê o financeiro.
  BALCAO: [
    'venda.ver', 'venda.criar',
    'caixa.ver', 'caixa.operar',
    'produto.ver', 'estoque.ver',
    'cliente.ver', 'cliente.editar',
    'crediario.ver',
  ],

  // Financeiro: o dinheiro. Não mexe em produto nem vende.
  FINANCEIRO: [
    'venda.ver', 'caixa.ver',
    'cliente.ver',
    'crediario.ver', 'crediario.cobrar',
    'financeiro.ver', 'financeiro.lancar',
    'relatorio.ver', 'auditoria.ver',
  ],

  // Contador: convidado. Só olha o dinheiro, não escreve nada em lugar nenhum.
  CONTADOR: ['financeiro.ver', 'relatorio.ver'],

  // Suporte (nós): só leitura, com prazo e motivo obrigatórios, e tudo o que
  // fizer aparece no livro de auditoria do cliente, igual a qualquer pessoa.
  SUPORTE: SO_LEITURA,
}

/**
 * Que papéis cada papel pode conceder a outra pessoa.
 *
 * A regra existe para impedir escalada: ter `equipe.gerir` deixa você montar a
 * equipe, não deixa você se promover. Um gerente contrata balconista; só o dono
 * cria outro dono.
 *
 * SUPORTE não aparece em lista nenhuma de propósito — esse acesso é nosso, tem
 * prazo e motivo, e não se concede pela tela de equipe do cliente.
 */
export const PODE_CONCEDER: Record<Papel, readonly Papel[]> = {
  DONO: ['DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR'],
  GERENTE: ['BALCAO'],
  BALCAO: [],
  FINANCEIRO: [],
  CONTADOR: [],
  SUPORTE: [],
}

/** Pode dar este papel a alguém, nesta unidade? */
export function podeConceder(
  sessao: Sessao,
  papel: Papel,
  unidadeId?: string,
  agora = new Date(),
): boolean {
  if (!pode(sessao, 'equipe.gerir', unidadeId, agora)) return false
  return sessao.acessos.some(
    (a) =>
      valeAgora(a, agora) &&
      PODE_CONCEDER[a.papel].includes(papel) &&
      (unidadeId === undefined || a.unidadeId === null || a.unidadeId === unidadeId),
  )
}

/** Um acesso concedido: papel, em qual unidade, até quando. */
export type Acesso = {
  papel: Papel
  /** null = vale para todas as unidades da empresa */
  unidadeId: string | null
  /** só o SUPORTE costuma ter; passou da hora, não vale mais */
  expiraEm?: Date | null
}

export type Sessao = {
  orgId: string
  usuarioId: string
  nome: string
  acessos: Acesso[]
}

const valeAgora = (a: Acesso, agora: Date) => !a.expiraEm || a.expiraEm > agora

const concede = (a: Acesso, c: Capacidade) => PODERES[a.papel].includes(c)

/**
 * Pode fazer isso?
 *
 *   pode(sessao, 'caixa.operar')            → em alguma unidade
 *   pode(sessao, 'caixa.operar', unidadeId) → naquela unidade
 *
 * Sem `unidadeId`, responde se pode em ALGUMA unidade — serve para decidir se
 * o item aparece no menu. Para a ação em si, sempre passe a unidade.
 */
export function pode(
  sessao: Sessao,
  capacidade: Capacidade,
  unidadeId?: string,
  agora = new Date(),
): boolean {
  return sessao.acessos.some(
    (a) =>
      valeAgora(a, agora) &&
      concede(a, capacidade) &&
      (unidadeId === undefined || a.unidadeId === null || a.unidadeId === unidadeId),
  )
}

/**
 * Em quais unidades a pessoa pode isso.
 * Devolve 'todas' quando o acesso não é preso a unidade (o caso do dono) —
 * quem consulta usa isso para nem colocar filtro de unidade na query.
 */
export function unidadesQuePodem(
  sessao: Sessao,
  capacidade: Capacidade,
  agora = new Date(),
): 'todas' | string[] {
  const validos = sessao.acessos.filter((a) => valeAgora(a, agora) && concede(a, capacidade))
  if (validos.some((a) => a.unidadeId === null)) return 'todas'
  return [...new Set(validos.map((a) => a.unidadeId!))]
}

/** Levanta erro em vez de devolver false. Para usar no começo de uma ação. */
export function exigir(
  sessao: Sessao,
  capacidade: Capacidade,
  unidadeId?: string,
  agora = new Date(),
): void {
  if (!pode(sessao, capacidade, unidadeId, agora)) {
    throw new SemPermissao(capacidade, unidadeId)
  }
}

export class SemPermissao extends Error {
  constructor(
    readonly capacidade: Capacidade,
    readonly unidadeId?: string,
  ) {
    super(
      `Sem permissão para "${capacidade}"` +
        (unidadeId ? ` nesta unidade.` : '.'),
    )
    this.name = 'SemPermissao'
  }
}
