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
  // Cadastrar produto NOVO, com o preço de partida. Separado de editar e de
  // mexer em preço porque é o que a empresa pode dar à vendedora (ver
  // EXTRAS_DO_BALCAO): a peça chega, ela cadastra e etiqueta; o preço, depois
  // de publicado, continua de quem tem `produto.preco`.
  'produto.cadastrar',
  'estoque.ver',
  'estoque.ajustar',
  'estoque.consumir', // anotar o material usado dentro de casa (esmalte, luva)
  // compras
  'compra.ver', // ver pedidos e fornecedores — com o CUSTO do que se compra
  'compra.gerir', // montar, mandar, receber e cancelar pedido; cadastrar fornecedor
  // atendimento
  'agenda.ver', // ver a agenda de todos os profissionais da loja
  'agenda.marcar', // marcar, confirmar, remarcar, desmarcar, anotar falta
  'ponto.proprio', // bater o PRÓPRIO ponto e ver as próprias horas
  'ponto.ver', // ver as horas de todo mundo (é dado de folha de pagamento)
  'ponto.gerir', // bater por quem não tem login, ajustar e anular com motivo
  // escola
  'escola.ver', // ver turmas, matrículas e a ficha escolar do aluno (com o responsável)
  'escola.matricular', // matricular, trancar, cancelar; anotar o responsável
  'escola.gerir', // criar e editar turma (e o valor dela); dar bolsa
  'mensalidade.ver', // ver as mensalidades: quem pagou, quem deve e quanto
  'mensalidade.receber', // receber mensalidade — é dinheiro entrando, como a parcela
  'mensalidade.ajustar', // cancelar (dispensar) a mensalidade de um mês, com motivo
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
export type Papel = 'DONO' | 'GERENTE' | 'BALCAO' | 'FINANCEIRO' | 'CONTADOR' | 'SUPORTE' | 'CARGO'

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
  'compra.ver',
  'agenda.ver',
  'ponto.ver',
  'escola.ver',
  'mensalidade.ver',
]

export const PODERES: Record<Papel, readonly Capacidade[]> = {
  // Dono: tudo, em todas as unidades.
  DONO: CAPACIDADES,

  // Gerente: toca a operação da unidade dele. Não configura a empresa nem o
  // agente, e não lança no financeiro — vê, mas não escreve.
  GERENTE: [
    'venda.ver', 'venda.criar', 'venda.cancelar', 'venda.desconto',
    'caixa.ver', 'caixa.operar',
    'produto.ver', 'produto.editar', 'produto.preco', 'produto.cadastrar',
    'estoque.ver', 'estoque.ajustar', 'estoque.consumir',
    'compra.ver', 'compra.gerir',
    'agenda.ver', 'agenda.marcar',
    'ponto.proprio', 'ponto.ver', 'ponto.gerir',
    'escola.ver', 'escola.matricular', 'escola.gerir',
    'mensalidade.ver', 'mensalidade.receber', 'mensalidade.ajustar',
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
  //
  // Na recepção do salão e da clínica, é ela quem toca a agenda: vê a de
  // todos e marca. Bate o PRÓPRIO ponto e vê as próprias horas — as dos
  // colegas são dado de folha de pagamento, não dela. E anota o material que
  // usou; o que ele CUSTOU (o pedido ao fornecedor) fica fora da vista.
  //
  // Na escola, o balcão é a SECRETARIA: matricula, anota o responsável e
  // recebe a mensalidade com o pai na frente. O que não faz é o que mexe no
  // preço — criar turma, mudar o valor dela, dar bolsa — nem dispensar uma
  // mensalidade: isso é desconto, e desconto tem dono.
  BALCAO: [
    'venda.ver', 'venda.criar',
    'caixa.ver', 'caixa.operar',
    'produto.ver', 'estoque.ver', 'estoque.consumir',
    'agenda.ver', 'agenda.marcar',
    'ponto.proprio',
    'escola.ver', 'escola.matricular',
    'mensalidade.ver', 'mensalidade.receber',
    'cliente.ver', 'cliente.editar',
    'crediario.ver', 'crediario.receber',
    'tarefa.ver',
  ],

  // Financeiro: o dinheiro. Não mexe em produto nem vende.
  // Vê as compras (é conta a pagar que vem aí) e as horas de todos (é a
  // folha), sem mexer em nenhuma das duas. Na escola, cuida da mensalidade:
  // vê, recebe e dispensa a de um mês (com motivo) — sem matricular ninguém
  // nem mexer no preço da turma.
  FINANCEIRO: [
    'venda.ver', 'caixa.ver',
    'cliente.ver',
    'crediario.ver', 'crediario.cobrar', 'crediario.receber',
    'escola.ver',
    'mensalidade.ver', 'mensalidade.receber', 'mensalidade.ajustar',
    'financeiro.ver', 'financeiro.lancar',
    'compra.ver',
    'ponto.proprio', 'ponto.ver',
    'relatorio.ver', 'auditoria.ver',
    'tarefa.ver',
  ],

  // Contador: convidado. Só olha o dinheiro, não escreve nada em lugar nenhum.
  // As compras e as horas do mês entram porque são dinheiro também — a conta
  // do fornecedor e a folha de pagamento, que costuma ser ele quem fecha. As
  // mensalidades também: são a receita da escola. As turmas não — são
  // pedagógicas, não contábeis.
  CONTADOR: ['financeiro.ver', 'relatorio.ver', 'compra.ver', 'ponto.ver', 'mensalidade.ver'],

  // Suporte (nós): só leitura, com prazo e motivo obrigatórios, e tudo o que
  // fizer aparece no livro de auditoria do cliente, igual a qualquer pessoa.
  // O modo EDIÇÃO (escolhido ao conceder, `Acesso.suporteEdita`) troca isto
  // por SUPORTE_EDICAO — ver `concede`.
  SUPORTE: SO_LEITURA,

  // Cargo criado pela empresa ("Subgerente"): por si só, NADA. O que ele pode
  // vem do cargo (`Acesso.capacidades`), e só do que está em
  // CAPACIDADES_DE_CARGO. Vazio aqui é de propósito: qualquer caminho que
  // monte a sessão sem ler o cargo deixa a pessoa sem poder nenhum, e não com
  // o poder de um gerente — falha fechada.
  CARGO: [],
}

/**
 * O suporte do Norte no modo EDIÇÃO: o cliente travou e pediu que a gente
 * arrumasse. É a leitura de sempre mais o que arruma a OPERAÇÃO — produto,
 * preço, estoque, catálogo, Configurações, convidar gente, encomenda — com
 * alcance da empresa inteira (o acesso de suporte é sempre sem loja).
 *
 * O que fica de fora é de propósito, e não por esquecimento:
 *   • vender, cancelar venda, dar desconto acima do teto, mexer no caixa —
 *     dinheiro na mão é de quem está na loja;
 *   • receber parcela ou mensalidade, dispensar mensalidade, cobrar,
 *     lançar no financeiro, estornar — dinheiro também;
 *   • compra ao fornecedor (é compromisso de pagar), ponto (é folha),
 *     matrícula e turma (geram mensalidade), quadro de tarefas, assistente.
 * E mesmo com `empresa.configurar`, algumas portas recusam o suporte pelo
 * nome (`exigirQueNaoSejaSuporte`): a Assinatura, apagar ou anonimizar
 * dados, abrir e fechar loja, cargos, as regras do PIN e o link de senha de
 * outra pessoa.
 */
export const SUPORTE_EDICAO: readonly Capacidade[] = [
  ...SO_LEITURA,
  'produto.editar', 'produto.preco', 'produto.cadastrar',
  'estoque.ajustar', 'estoque.consumir',
  'cliente.editar',
  'agenda.marcar',
  'equipe.gerir',
  'empresa.configurar',
]

/**
 * Os papéis que o suporte no modo edição pode convidar ou mexer: os mesmos
 * do gerente. Dono e gerente são da loja decidir — e é assim que "trocar o
 * dono" nunca passa pelo suporte.
 */
const SUPORTE_EDICAO_CONCEDE: readonly Papel[] = ['BALCAO']

/**
 * O que um cargo criado pela empresa PODE ter. É o teto: o que o Gerente pode,
 * menos montar a equipe (quem dá acesso a outras pessoas é dono ou gerente de
 * verdade — um cargo que se dá acesso viraria escada para subir).
 */
export const CAPACIDADES_DE_CARGO: readonly Capacidade[] = PODERES.GERENTE.filter((c) => c !== 'equipe.gerir')

/**
 * O que a EMPRESA pode dar a mais ao papel Balcão (`Org.balcaoAmpliado`).
 *
 * A loja de roupa tem a vendedora que conta a arara e cadastra a peça que
 * chegou — é ela quem está no balcão quando o fornecedor entrega. Dar isso ao
 * papel Balcão de TODAS as empresas seria abrir o estoque da padaria para quem
 * só passa o pão; por isso é chave da empresa, desligada por padrão. Ligada, a
 * vendedora corrige o estoque pelo contado e cadastra produto novo (com o
 * preço de partida) — e assina com o PIN dela, sempre (ver `soPelaEmpresa`).
 * Mudar preço depois de publicado continua de quem tem `produto.preco`.
 */
export const EXTRAS_DO_BALCAO: readonly Capacidade[] = ['estoque.ajustar', 'produto.cadastrar']

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
  DONO: ['DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR', 'CARGO'],
  GERENTE: ['BALCAO'],
  BALCAO: [],
  FINANCEIRO: [],
  CONTADOR: [],
  SUPORTE: [],
  CARGO: [],
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
      concedeveis(a).includes(papel) &&
      (unidadeId === undefined || a.unidadeId === null || a.unidadeId === unidadeId),
  )
}

/** O que este acesso pode conceder — o suporte no modo edição, o do gerente. */
const concedeveis = (a: Acesso): readonly Papel[] =>
  a.papel === 'SUPORTE' && a.suporteEdita ? SUPORTE_EDICAO_CONCEDE : PODE_CONCEDER[a.papel]

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
      concedeveis(a).includes(papel),
  )
}

/** Um acesso concedido: papel, em qual unidade, até quando. */
export type Acesso = {
  papel: Papel
  /** null = vale para todas as unidades da empresa */
  unidadeId: string | null
  /** só o SUPORTE costuma ter; passou da hora, não vale mais */
  expiraEm?: Date | null
  /**
   * Só no papel CARGO: o que o cargo marca. Lido do banco a cada requisição
   * (ver `conferirSessao`), nunca do cookie. Ausente = nada.
   */
  capacidades?: readonly string[] | null
  /**
   * Só no papel SUPORTE: o modo edição (`Acesso.suporteEdita`). Lido do banco
   * a cada requisição (ver `conferirSessao`), nunca do cookie. Ausente = só
   * leitura — falha fechada.
   */
  suporteEdita?: boolean | null
}

export type Sessao = {
  orgId: string
  usuarioId: string
  nome: string
  acessos: Acesso[]
  /**
   * A empresa ligou `Org.balcaoAmpliado` (ver EXTRAS_DO_BALCAO). Lido do banco
   * a cada requisição, em `conferirSessao` — NUNCA do cookie: o cookie é uma
   * fotografia de até 12 horas, e desligar a chave tem de valer na próxima
   * tela. Sessão montada sem ele (o assistente, os testes) fica com o Balcão
   * de sempre, que é o lado seguro.
   */
  balcaoAmpliado?: boolean
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

const concede = (a: Acesso, c: Capacidade, s?: Pick<Sessao, 'balcaoAmpliado'>) =>
  ((a.papel === 'SUPORTE' && a.suporteEdita ? SUPORTE_EDICAO : PODERES[a.papel]).includes(c) ||
    (a.papel === 'BALCAO' && !!s?.balcaoAmpliado && EXTRAS_DO_BALCAO.includes(c)) ||
    (a.papel === 'CARGO' && CAPACIDADES_DE_CARGO.includes(c) && !!a.capacidades?.includes(c))) &&
  (a.unidadeId === null || !SO_DA_EMPRESA_INTEIRA.includes(c))

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
      concede(a, capacidade, sessao) &&
      (unidadeId === undefined || a.unidadeId === null || a.unidadeId === unidadeId),
  )
}

/**
 * Pode isso SÓ porque a empresa deu a mais ao Balcão (EXTRAS_DO_BALCAO)?
 *
 * É a pergunta de quem pede a assinatura: a gerente corrige o estoque como
 * sempre corrigiu (o PIN dela só é pedido se a empresa mandar assinar as
 * exceções); a vendedora, que corrige porque a empresa deixou, assina SEMPRE —
 * foi a condição para deixar.
 */
export function soPelaEmpresa(sessao: Sessao, capacidade: Capacidade, unidadeId?: string, agora = new Date()): boolean {
  return pode(sessao, capacidade, unidadeId, agora) && !pode({ ...sessao, balcaoAmpliado: false }, capacidade, unidadeId, agora)
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
  const validos = sessao.acessos.filter((a) => valeAgora(a, agora) && concede(a, capacidade, sessao))
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

/**
 * A sessão é do NOSSO suporte — só acesso de SUPORTE valendo, nenhum papel da
 * loja? (Quem tem SUPORTE e mais um papel da loja não existe: ver
 * `impedimentoDoSuporte` em operacao.ts.)
 */
export function ehSuporteDoNorte(sessao: Sessao, agora = new Date()): boolean {
  const vivos = sessao.acessos.filter((a) => valeAgora(a, agora))
  return vivos.length > 0 && vivos.every((a) => a.papel === 'SUPORTE')
}

/** O suporte no modo edição — o que a Equipe mostra como "edição". */
export function suporteEdita(sessao: Sessao, agora = new Date()): boolean {
  return sessao.acessos.some((a) => a.papel === 'SUPORTE' && !!a.suporteEdita && valeAgora(a, agora))
}

/**
 * As portas que o suporte do Norte não atravessa, nem no modo edição, mesmo
 * tendo a capacidade que elas pedem (`empresa.configurar`, `equipe.gerir`):
 * a Assinatura, apagar ou anonimizar dado, abrir e fechar loja, cargos, as
 * regras do PIN, o link de senha de outra pessoa. Chamar DEPOIS do `exigir`
 * da capacidade, no começo da ação.
 */
export function exigirQueNaoSejaSuporte(sessao: Sessao, oQue: string, agora = new Date()): void {
  if (ehSuporteDoNorte(sessao, agora)) throw new SoDaLoja(oQue)
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
 * É `SemPermissao` (quem já trata a recusa de permissão trata esta), com a
 * frase de gente: o suporte entende por que parou, e a loja, se ler, também.
 */
export class SoDaLoja extends SemPermissao {
  constructor(oQue: string) {
    super('empresa.configurar')
    this.message = `O suporte do Norte não ${oQue}: isso é com quem é da empresa.`
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

/**
 * Pode isso NESTA loja — ou, com `null`, na empresa inteira?
 *
 * `pode(sessao, c, undefined)` quer dizer "em alguma loja", e registro sem
 * loja (`unidadeId = null`) quer dizer "da empresa inteira": o financeiro da
 * loja 3 lançava o aluguel do escritório, dava baixa na conta do contador e
 * pausava a conta recorrente da empresa, porque "alguma loja" ele tem. É a
 * mesma régua de `podeConcederAcesso`: `null` só para quem tem acesso SEM
 * loja.
 */
export function podeNoAlcance(
  sessao: Sessao,
  capacidade: Capacidade,
  unidadeId: string | null,
  agora = new Date(),
): boolean {
  if (unidadeId !== null) return pode(sessao, capacidade, unidadeId, agora)
  return unidadesQuePodem(sessao, capacidade, agora) === 'todas'
}

/** `podeNoAlcance`, levantando `SemPermissao`. */
export function exigirNoAlcance(
  sessao: Sessao,
  capacidade: Capacidade,
  unidadeId: string | null,
  agora = new Date(),
): void {
  if (!podeNoAlcance(sessao, capacidade, unidadeId, agora)) {
    throw new SemPermissao(capacidade, unidadeId ?? undefined)
  }
}

/**
 * Capacidades que só valem num acesso da EMPRESA INTEIRA (`unidadeId: null`).
 *
 * Configurar a empresa (plano, lojas, fechar uma loja, anonimizar cliente) e
 * o assistente (campanha para todos os clientes) não tem "nesta loja": é a
 * empresa. Um DONO preso a uma loja só — que a tela de equipe deixava criar —
 * passava em todo `exigir(sessao, 'empresa.configurar')`, porque "alguma
 * loja" ele tem, e fechava a loja do outro sócio ou trocava o plano. Com
 * isto, acesso preso a loja nunca concede estas duas, em `pode` nem em
 * `unidadesQuePodem`. O resto do que o papel dá continua valendo na loja dele.
 */
const SO_DA_EMPRESA_INTEIRA: readonly Capacidade[] = ['empresa.configurar', 'agente.configurar']
