// O livro de auditoria — a parte que LÊ.
//
// Escrever nele todo mundo escreve: venda, caixa, produto, cliente, equipe,
// plano. Cada módulo grava a própria linha na mesma transação da ação, e é
// assim que o livro não mente. O que faltava era o outro lado: uma tela onde
// o dono abre e pergunta "quem deu 40% de desconto na terça?".
//
// ── o que este arquivo NÃO faz ───────────────────────────────
// Não escreve. Não existe `registrar()` aqui de propósito — se existisse, a
// tentação seria chamar de fora da transação da ação, e aí o livro passaria
// a registrar coisas que não aconteceram (a ação falhou, o registro ficou).
// Cada módulo grava dentro do próprio `comoOrg`, junto do que fez.
//
// E o banco não deixa reescrever nem apagar: ver `rls.sql`, política de
// `auditoria`. Ler é tudo que dá para fazer, e é o que esta tela faz.

import { comoOrg } from './banco'
import { exigir, pode, textoDaBusca, type Sessao } from './permissao'

/**
 * O que cada ação quer dizer, em português de gente.
 *
 * A chave é o que o código grava (`venda.registrou`); o valor é o que a tela
 * mostra. Ação que não estiver aqui aparece com a chave crua — não some.
 */
export const ACOES: Record<string, string> = {
  'venda.registrou': 'registrou uma venda',
  'venda.cancelou': 'cancelou uma venda',
  'venda.devolveu': 'recebeu uma devolução',
  'caixa.abriu': 'abriu o caixa',
  'caixa.fechou': 'fechou o caixa',
  'caixa.sangria': 'tirou dinheiro do caixa',
  'caixa.suprimento': 'pôs dinheiro no caixa',
  'produto.criou': 'cadastrou um produto',
  'produto.alterou': 'alterou um produto',
  'produto.preco.alterou': 'mudou um preço',
  'produto.grade.alterou': 'mexeu na grade',
  'estoque.entrada': 'deu entrada de mercadoria',
  'estoque.ajustou': 'ajustou o estoque',
  'estoque.transferiu': 'transferiu estoque entre lojas',
  'cliente.criou': 'cadastrou um cliente',
  'cliente.alterou': 'alterou um cliente',
  'cliente.ofertas.aceitou': 'registrou que o cliente aceita ofertas no WhatsApp',
  'cliente.ofertas.recusou': 'registrou que o cliente não quer ofertas no WhatsApp',
  'cliente.anonimizou': 'anonimizou um cliente (pedido do titular)',
  'ofertas.parou': 'um contato mandou PARAR e saiu das ofertas',
  'ofertas.voltou': 'um contato mandou VOLTAR e voltou às ofertas',
  'ofertas.anotou': 'pôs um número na lista de quem não recebe ofertas',
  'ofertas.tirou': 'tirou um número da lista de quem não recebe ofertas',
  // O acesso do NOSSO suporte (papel SUPORTE, com prazo e motivo): uma linha
  // por tela ou ação, no máximo uma a cada 10 minutos por tela — ver
  // `registrarAcessoDeSuporte` em pagina.ts.
  'suporte.acessou': 'acesso do suporte do Norte',
  'crediario.recebeu': 'recebeu uma parcela',
  'equipe.papel.alterou': 'mudou o acesso de alguém',
  'equipe.meta': 'definiu meta e comissão',
  'quadro.criou': 'criou um quadro de tarefas',
  'quadro.alterou': 'alterou um quadro de tarefas',
  'quadro.arquivou': 'arquivou um quadro de tarefas',
  'tarefa.criou': 'criou uma tarefa',
  'tarefa.alterou': 'alterou uma tarefa',
  'tarefa.moveu': 'mudou a situação de uma tarefa',
  'tarefa.concluiu': 'concluiu uma tarefa',
  'tarefa.apagou': 'apagou uma tarefa',
  'encomenda.criou': 'anotou uma encomenda',
  'encomenda.alterou': 'alterou uma encomenda',
  'encomenda.pronta': 'marcou uma encomenda como pronta',
  'encomenda.entregou': 'entregou uma encomenda',
  'encomenda.cancelou': 'cancelou uma encomenda',
  'financeiro.recorrente.criou': 'cadastrou uma conta recorrente',
  'financeiro.recorrente.alterou': 'alterou uma conta recorrente',
  'financeiro.recorrente.gerou': 'gerou as contas recorrentes do mês',
  'equipe.desativou': 'desativou uma conta',
  'equipe.reativou': 'reativou uma conta',
  'convite.criou': 'convidou alguém',
  'convite.revogou': 'cancelou um convite',
  'convite.aceitou': 'entrou pelo convite',
  'sessao.entrou': 'entrou no sistema',
  'vaga.assumiu': 'assumiu a vaga de alguém',
  'empresa.configurou': 'configurou a empresa',
  'unidade.criou': 'abriu uma loja',
  'unidade.alterou': 'alterou os dados de uma loja',
  'unidade.desativou': 'fechou uma loja',
  'unidade.reativou': 'reabriu uma loja',
  'empresa.modulos': 'ligou ou desligou módulos',
  'pontos.configurou': 'configurou o programa de pontos',
  'plano.trocou': 'trocou de plano',
  'plano.pediu': 'pediu outro plano',
  'credito.pediu': 'pediu crédito de IA',
  'agente.proposta.confirmou': 'confirmou uma proposta do assistente',
  'financeiro.despesa': 'lançou uma conta a pagar',
  'financeiro.receita': 'lançou uma receita',
  'financeiro.pagou': 'deu baixa numa conta',
  'financeiro.despagou': 'desfez a baixa de uma conta',
  'estoque.minimo': 'mudou o estoque mínimo',
  'agente.criou': 'criou o assistente',
  'agente.alterou': 'alterou o assistente',
  'agente.canal.conectou': 'conectou o WhatsApp do assistente',
  'agente.canal.desconectou': 'desconectou o WhatsApp do assistente',
  'agente.webhook.mostrou': 'viu o endereço do webhook do assistente',
  'agente.rotinas': 'ligou ou desligou rotinas do assistente',
  'campanha.criou': 'criou uma campanha de WhatsApp',
  'campanha.alterou': 'alterou uma campanha de WhatsApp',
  'campanha.ativou': 'ativou uma campanha de WhatsApp',
  'campanha.pausou': 'pausou uma campanha de WhatsApp',
  'campanha.apagou': 'apagou uma campanha de WhatsApp',
  'campanha.testou': 'testou uma campanha no próprio número',
}

/**
 * Os assuntos do filtro. Cada um é um prefixo de ação — `venda.` pega
 * `venda.registrou` e `venda.cancelou`. Alguns juntam dois prefixos, porque
 * quem procura "gente" quer convite e sessão junto com equipe.
 */
export const ASSUNTOS: { chave: string; rotulo: string; prefixos: string[] }[] = [
  { chave: 'venda', rotulo: 'vendas e encomendas', prefixos: ['venda.', 'encomenda.'] },
  { chave: 'caixa', rotulo: 'caixa', prefixos: ['caixa.'] },
  { chave: 'produto', rotulo: 'produtos e estoque', prefixos: ['produto.', 'estoque.'] },
  { chave: 'cliente', rotulo: 'clientes', prefixos: ['cliente.', 'crediario.', 'pontos.', 'ofertas.'] },
  { chave: 'equipe', rotulo: 'equipe e acessos', prefixos: ['equipe.', 'convite.', 'sessao.', 'vaga.'] },
  { chave: 'tarefa', rotulo: 'tarefas', prefixos: ['tarefa.', 'quadro.'] },
  { chave: 'empresa', rotulo: 'empresa e lojas', prefixos: ['empresa.', 'unidade.', 'plano.', 'agente.', 'campanha.', 'financeiro.'] },
  { chave: 'suporte', rotulo: 'suporte do Norte', prefixos: ['suporte.'] },
]

export type FiltroAuditoria = {
  unidadeIds: string[]
  de: Date
  /** Exclusivo. */
  ate: Date
  /** Nome de quem fez, nome do alvo, ou pedaço da ação. */
  q?: string | null
  assunto?: string | null
}

export type LinhaDoLivro = {
  id: string
  criadoEm: Date
  quem: string
  autor: string
  acao: string
  /** A ação em português. */
  texto: string
  alvoTipo: string | null
  alvoId: string | null
  alvoNome: string | null
  valor: number | null
  motivo: string | null
  unidade: string | null
  antes: unknown
  depois: unknown
}

/**
 * As condições do livro, cada uma no seu lugar do AND.
 *
 * Pura e exportada para o teste conferir a FORMA: é aqui que uma chave
 * repetida num objeto do Prisma apaga a outra sem erro nenhum.
 */
export function filtroDoLivro(permitidas: string[], prefixos: string[] | null, q: string) {
  return [
    // Linha sem unidade é da empresa inteira (cadastro de produto, troca de
    // plano) e vale para quem tem o livro liberado.
    { OR: [{ unidadeId: null }, { unidadeId: { in: permitidas } }] },
    ...(prefixos ? [{ OR: prefixos.map((p) => ({ acao: { startsWith: p } })) }] : []),
    ...(q
      ? [
          {
            OR: [
              { quem: { contains: q, mode: 'insensitive' as const } },
              { alvoNome: { contains: q, mode: 'insensitive' as const } },
              { motivo: { contains: q, mode: 'insensitive' as const } },
              { acao: { contains: q, mode: 'insensitive' as const } },
            ],
          },
        ]
      : []),
  ]
}

export async function listarAuditoria(sessao: Sessao, f: FiltroAuditoria): Promise<LinhaDoLivro[]> {
  exigir(sessao, 'auditoria.ver')

  // A unidade vem do endereço. Só entram as que a pessoa pode ver — e as
  // linhas SEM unidade (cadastro de produto, troca de plano), que são da
  // empresa inteira e valem para quem tem o livro liberado.
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'auditoria.ver', u))
  if (permitidas.length === 0) return []

  const q = textoDaBusca(f.q)
  const assunto = ASSUNTOS.find((a) => a.chave === f.assunto)

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.auditoria.findMany({
      where: {
        criadoEm: { gte: f.de, lt: f.ate },
        // TRÊS condições de "ou", e por isso as três num AND só. Antes o
        // assunto e a busca eram cada um um `AND` espalhado no mesmo objeto, e
        // o segundo SOBRESCREVIA o primeiro: filtrar por "caixa" e digitar
        // "Ana" devolvia tudo que a Ana fez, de qualquer assunto. É o mesmo
        // defeito do `OR` da busca que apagava o `OR` da loja no financeiro.
        AND: filtroDoLivro(permitidas, assunto?.prefixos ?? null, q),
      },
      orderBy: { criadoEm: 'desc' },
      // Um mês de loja movimentada são umas duas mil linhas. Quinhentas com
      // filtro cobrem qualquer pergunta; acima disso é exportação, não tela.
      take: 500,
      select: {
        id: true, criadoEm: true, quem: true, autor: true, acao: true,
        alvoTipo: true, alvoId: true, alvoNome: true, valor: true, motivo: true,
        antes: true, depois: true,
        unidade: { select: { nome: true } },
      },
    })

    return linhas.map((l) => ({
      id: l.id,
      criadoEm: l.criadoEm,
      quem: l.quem,
      autor: l.autor,
      acao: l.acao,
      texto: ACOES[l.acao] ?? l.acao,
      alvoTipo: l.alvoTipo,
      alvoId: l.alvoId,
      alvoNome: l.alvoNome,
      valor: l.valor === null ? null : Number(l.valor),
      motivo: l.motivo,
      unidade: l.unidade?.nome ?? null,
      antes: l.antes,
      depois: l.depois,
    }))
  })
}
