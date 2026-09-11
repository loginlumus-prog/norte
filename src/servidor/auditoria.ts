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
import { exigir, pode, type Sessao } from './permissao'

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
  'crediario.recebeu': 'recebeu uma parcela',
  'equipe.papel.alterou': 'mudou o acesso de alguém',
  'equipe.desativou': 'desativou uma conta',
  'equipe.reativou': 'reativou uma conta',
  'convite.criou': 'convidou alguém',
  'convite.revogou': 'cancelou um convite',
  'convite.aceitou': 'entrou pelo convite',
  'sessao.entrou': 'entrou no sistema',
  'vaga.assumiu': 'assumiu a vaga de alguém',
  'empresa.configurou': 'configurou a empresa',
  'empresa.modulos': 'ligou ou desligou módulos',
  'pontos.configurou': 'configurou o programa de pontos',
  'plano.trocou': 'trocou de plano',
  'agente.proposta.confirmou': 'confirmou uma proposta do assistente',
  'financeiro.lancou': 'lançou uma conta',
  'financeiro.pagou': 'deu baixa numa conta',
}

/**
 * Os assuntos do filtro. Cada um é um prefixo de ação — `venda.` pega
 * `venda.registrou` e `venda.cancelou`. Alguns juntam dois prefixos, porque
 * quem procura "gente" quer convite e sessão junto com equipe.
 */
export const ASSUNTOS: { chave: string; rotulo: string; prefixos: string[] }[] = [
  { chave: 'venda', rotulo: 'vendas', prefixos: ['venda.'] },
  { chave: 'caixa', rotulo: 'caixa', prefixos: ['caixa.'] },
  { chave: 'produto', rotulo: 'produtos e estoque', prefixos: ['produto.', 'estoque.'] },
  { chave: 'cliente', rotulo: 'clientes', prefixos: ['cliente.', 'crediario.', 'pontos.'] },
  { chave: 'equipe', rotulo: 'equipe e acessos', prefixos: ['equipe.', 'convite.', 'sessao.', 'vaga.'] },
  { chave: 'empresa', rotulo: 'empresa', prefixos: ['empresa.', 'plano.', 'agente.', 'financeiro.'] },
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

export async function listarAuditoria(sessao: Sessao, f: FiltroAuditoria): Promise<LinhaDoLivro[]> {
  exigir(sessao, 'auditoria.ver')

  // A unidade vem do endereço. Só entram as que a pessoa pode ver — e as
  // linhas SEM unidade (cadastro de produto, troca de plano), que são da
  // empresa inteira e valem para quem tem o livro liberado.
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'auditoria.ver', u))
  if (permitidas.length === 0) return []

  const q = f.q?.trim() ?? ''
  const assunto = ASSUNTOS.find((a) => a.chave === f.assunto)

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.auditoria.findMany({
      where: {
        criadoEm: { gte: f.de, lt: f.ate },
        OR: [{ unidadeId: null }, { unidadeId: { in: permitidas } }],
        ...(assunto
          ? { AND: [{ OR: assunto.prefixos.map((p) => ({ acao: { startsWith: p } })) }] }
          : {}),
        ...(q
          ? {
              AND: [
                {
                  OR: [
                    { quem: { contains: q, mode: 'insensitive' } },
                    { alvoNome: { contains: q, mode: 'insensitive' } },
                    { motivo: { contains: q, mode: 'insensitive' } },
                    { acao: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ],
            }
          : {}),
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
