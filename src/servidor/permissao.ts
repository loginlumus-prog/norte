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
  'venda.desconto', // separado: dar desconto ACIMA do teto da empresa
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
  // o quadro de tarefas da equipe
  'tarefa.ver', // ver o quadro e mexer nas PRÓPRIAS tarefas (situação, progresso)
  'tarefa.gerir', // criar quadro, criar e atribuir tarefa, apagar
  // dinheiro
  'crediario.ver',
  'crediario.cobrar', // mandar cobrança, negociar
  'crediario.receber', // receber a parcela no balcão — é dinheiro entrando, como venda
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
  'tarefa.ver',
]

export const PODERES: Record<Papel, readonly Capacidade[]> = {
  // Dono: tudo, em todas as unidades.
  DONO: CAPACIDADES,

  // Gerente: toca a operação da unidade dele. Não configura a empresa nem o
  // agente, e não lança no financeiro — vê, mas não escreve.
  GERENTE: [
    'venda.ver', 'venda.criar', 'venda.cancelar', 'venda.desconto',
    'caixa.ver', 'caixa.operar',
    'produto.ver', 'produto.editar', 'produto.preco',
    'estoque.ver', 'estoque.ajustar',
    'cliente.ver', 'cliente.editar',
    'crediario.ver', 'crediario.cobrar', 'crediario.receber',
    'financeiro.ver', 'relatorio.ver',
    'equipe.ver', 'equipe.gerir', 'auditoria.ver',
    'tarefa.ver', 'tarefa.gerir',
  ],

  // Balcão: vende. Não mexe em preço, não ajusta estoque, não vê o financeiro.
  // Recebe parcela porque é dinheiro entrando no caixa com a pessoa na
  // frente — a mesma coisa que uma venda.
  // Vê o quadro e dá baixa no que é dela — a lista de abertura da loja é
  // trabalho de quem abre a loja. Criar tarefa para os outros é do gerente.
  BALCAO: [
    'venda.ver', 'venda.criar',
    'caixa.ver', 'caixa.operar',
    'produto.ver', 'estoque.ver',
    'cliente.ver', 'cliente.editar',
    'crediario.ver', 'crediario.receber',
    'tarefa.ver',
  ],

  // Financeiro: o dinheiro. Não mexe em produto nem vende.
  FINANCEIRO: [
    'venda.ver', 'caixa.ver',
    'cliente.ver',
    'crediario.ver', 'crediario.cobrar', 'crediario.receber',
    'financeiro.ver', 'financeiro.lancar',
    'relatorio.ver', 'auditoria.ver',
    'tarefa.ver',
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

/**
 * Pode dar (ou mexer em) ESTE acesso — este papel, nesta loja ou na empresa
 * inteira?
 *
 * `podeConceder` recebe a loja como opcional, e opcional quer dizer "em
 * alguma loja". Com o acesso SEM loja (`null` = todas), isso abria a porta:
 * o gerente da loja 3 dava balcão "para todas as lojas", porque `null` virava
 * `undefined` e "alguma loja" ele tem. Aqui `null` quer dizer o que quer dizer
 * no banco: a empresa inteira — e só quem tem acesso à empresa inteira dá.
 *
 * É também a régua para mexer em quem JÁ está na equipe: para rebaixar,
 * desativar ou reativar alguém, é preciso poder conceder cada acesso que a
 * pessoa tem. Senão o gerente da loja 3 desativava a dona.
 */
export function podeConcederAcesso(
  sessao: Sessao,
  papel: Papel,
  unidadeId: string | null,
  agora = new Date(),
): boolean {
  if (unidadeId !== null) return podeConceder(sessao, papel, unidadeId, agora)
  return sessao.acessos.some(
    (a) =>
      valeAgora(a, agora) &&
      a.unidadeId === null &&
      concede(a, 'equipe.gerir') &&
      PODE_CONCEDER[a.papel].includes(papel),
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

/**
 * O cookie de sessão ainda vale?
 *
 * O cookie é assinado, então não dá para forjar — mas ele é uma FOTOGRAFIA:
 * carrega os papéis que a pessoa tinha na hora em que entrou. Sozinho, ele
 * significa que desativar um funcionário só faz efeito quando o cookie dele
 * expira, até 12 horas depois. Demitiu de manhã, continua vendendo à tarde.
 *
 * Por isso cada requisição confronta o cookie com o banco (ver `pagina.ts`),
 * e a decisão é esta função — pura, para poder ser testada exaustivamente.
 *
 * `<=` e não `<`: cortar as sessões e emitir uma nova no mesmo milissegundo é
 * o que acontece quando alguém troca a própria senha. Se o corte matasse a
 * sessão do mesmo instante, trocar a senha deslogaria quem trocou.
 */
export const sessaoAindaVale = (
  usuario: { ativo: boolean; sessoesDesde: Date } | null,
  nasceu: Date,
): boolean => !!usuario && usuario.ativo && usuario.sessoesDesde <= nasceu

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

/**
 * Das lojas pedidas, só as em que a pessoa pode isso.
 *
 * Para toda função que recebe uma lista de lojas de quem chama: a lista
 * costuma vir do endereço (`?unidade=`), e o endereço é do usuário. A tela
 * já filtra — mas a regra tem de valer também quando a função é chamada de
 * outro lugar, e é por isso que ela mora aqui e não só na tela.
 */
export function soAsQuePode(
  sessao: Sessao,
  capacidade: Capacidade,
  pedidas: readonly string[],
  agora = new Date(),
): string[] {
  return pedidas.filter((u) => pode(sessao, capacidade, u, agora))
}

/**
 * Abre a tela de Assinatura (os planos e a fatura)?
 *
 * Ela abre para quem configura a empresa E para quem cuida do dinheiro —
 * a fatura é conta a pagar. Todo link para os planos (o cadeado, o rodapé do
 * Guia, "ver os planos") pergunta isto antes de aparecer: para a balconista,
 * o link caía no "este endereço não abre", que parece sistema quebrado.
 */
export function podeVerPlanos(sessao: Sessao, agora = new Date()): boolean {
  return pode(sessao, 'empresa.configurar', undefined, agora) || pode(sessao, 'financeiro.ver', undefined, agora)
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

/**
 * O texto de uma busca que veio do endereço, pronto para usar.
 *
 * O Next entrega `?q=a&q=b` como LISTA, e `.trim()` numa lista derruba a tela
 * com erro de servidor. Tipado como texto, o endereço continua sendo do
 * usuário: aqui qualquer coisa que não seja texto vira busca vazia, e o
 * tamanho tem teto — ninguém procura um produto com mil letras.
 */
export function textoDaBusca(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, 120) : ''
}

/**
 * O número de venda digitado na busca, ou `null`.
 *
 * `Venda.numero` é inteiro de 32 bits: "3000000000" passava no teste de só
 * dígitos e o banco recusava a consulta — tela de erro no lugar de "nada
 * encontrado".
 */
export function numeroDaBusca(q: string): number | null {
  if (!/^\d{1,10}$/.test(q)) return null
  const n = Number(q)
  return n <= 2_147_483_647 ? n : null
}
