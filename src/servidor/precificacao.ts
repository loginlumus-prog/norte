// Precificação: margem, markup e o preço que a margem alvo pede.
//
// ── as duas contas que todo mundo confunde ───────────────────
// Margem é o que sobra DO PREÇO: (preço − custo) / preço. Markup é o quanto
// se põe EM CIMA DO CUSTO: (preço − custo) / custo. Custo 60 vendido a 100 é
// margem de 40% e markup de 67% — o mesmo produto, dois números, e a loja que
// "põe 40% em cima" achando que tem 40% de margem está com 28,6%. É o erro
// mais comum do varejo pequeno, e ele não aparece na venda: aparece no fim do
// mês, quando o dinheiro não fecha.
//
// Por isso a tela mostra os dois lado a lado, e o alvo é sempre MARGEM: é a
// margem que paga aluguel, gente e imposto, e é dela que a conta do fechamento
// depende.
//
// ── o que este arquivo NÃO faz ───────────────────────────────
// Não muda preço. Preço se muda na ficha do produto, com a permissão e o
// registro de auditoria de lá. Aqui é leitura: a conta, a comparação com o
// alvo, e o número que a pessoa levaria para a ficha se decidisse mexer.
//
// A parte pura (`analisarPreco`, `lerAlvo`, `resumirPrecos`) roda sem banco e
// está testada em `tests/precificacao.test.ts`. A parte com banco fica no fim.

import { Prisma } from '@prisma/client'
import { comoOrg } from './banco'
import { centavos } from './dinheiro'
import { exigir, unidadesQuePodem, type Sessao } from './permissao'

/**
 * A margem alvo quando a pessoa não escolheu.
 *
 * Quarenta é o número que a Análise e a ficha do produto já usam para pintar
 * de verde — e é a faixa em que roupa, calçado e acessório costumam viver.
 * Quem vende a granel ou eletrônico troca no campo da tela; o padrão só
 * precisa ser um número razoável para a primeira abertura.
 */
export const ALVO_PADRAO = 40
export const ALVO_MIN = 5
export const ALVO_MAX = 90

/**
 * A folga para dizer "no alvo".
 *
 * Um ponto. Alvo de 40 com margem de 39,4 não é um problema a resolver — é o
 * arredondamento do preço para terminar em 90. Sem a folga, metade do
 * catálogo apareceria em amarelo por causa de centavos, e amarelo demais
 * ensina a ignorar amarelo.
 */
export const FOLGA_PONTOS = 1

/** Quantos dias entram no "saiu 30d". */
export const JANELA_VENDAS_DIAS = 30

export type SituacaoPreco = 'sem_custo' | 'abaixo_do_custo' | 'abaixo_do_alvo' | 'no_alvo'

export type AnalisePreco = {
  /** (preço − custo) / preço, em porcento. Nulo sem custo. */
  margemPct: number | null
  /** (preço − custo) / custo, em porcento. Nulo sem custo. */
  markupPct: number | null
  /** O preço que dá a margem alvo, em centavos, arredondado PARA CIMA. Nulo sem custo. */
  sugeridoCent: number | null
  /** Sugerido − preço. Positivo = precisa subir. Nulo sem custo. */
  diferencaCent: number | null
  situacao: SituacaoPreco
}

/**
 * A conta de um produto.
 *
 * Tudo em centavos inteiros, pela regra de `dinheiro.ts`. Só a porcentagem é
 * quebrada, porque porcentagem é leitura e não vai para o banco.
 *
 * Custo zero conta como "sem custo": ninguém vende a custo zero de verdade, e
 * o zero costuma ser o valor que ficou do cadastro apressado. Tratar como
 * custo daria markup infinito e margem de 100% — um produto "perfeito" que na
 * verdade ninguém sabe quanto custou.
 */
export function analisarPreco({
  custoCent,
  precoCent,
  alvoPct,
}: {
  custoCent: number | null
  precoCent: number
  alvoPct: number
}): AnalisePreco {
  if (custoCent === null || custoCent <= 0) {
    return { margemPct: null, markupPct: null, sugeridoCent: null, diferencaCent: null, situacao: 'sem_custo' }
  }

  const sobra = precoCent - custoCent
  const margemPct = precoCent > 0 ? (sobra / precoCent) * 100 : null
  const markupPct = (sobra / custoCent) * 100

  // preço = custo / (1 − alvo). Em inteiros: custo × 100 / (100 − alvo), e o
  // teto porque o preço que dá a margem "quase" não dá a margem. Fazer a
  // conta com 0,6 em vez de 60/100 devolve 10000,000000000002 para custo
  // 60,00 — e o teto disso é 100,01. Com inteiros a divisão exata sai exata.
  const sugeridoCent = Math.ceil((custoCent * 100) / (100 - alvoPct))
  const diferencaCent = sugeridoCent - precoCent

  const situacao: SituacaoPreco =
    precoCent < custoCent ? 'abaixo_do_custo'
    : margemPct !== null && margemPct >= alvoPct - FOLGA_PONTOS ? 'no_alvo'
    : 'abaixo_do_alvo'

  return { margemPct, markupPct, sugeridoCent, diferencaCent, situacao }
}

/**
 * O alvo que veio no endereço (`?alvo=35`).
 *
 * Inteiro entre 5 e 90; fora disso encosta na borda mais próxima, porque quem
 * digitou 95 queria "muito" e não queria voltar para 40. Lixo e vazio caem no
 * padrão. Menos de 5 não é alvo, é liquidação; mais de 90 não existe fora de
 * software.
 */
export function lerAlvo(v: string | undefined): number {
  const texto = (v ?? '').trim()
  if (!/^\d+([.,]\d+)?$/.test(texto)) return ALVO_PADRAO
  const n = Math.round(Number(texto.replace(',', '.')))
  if (!Number.isFinite(n)) return ALVO_PADRAO
  return Math.min(ALVO_MAX, Math.max(ALVO_MIN, n))
}

export type ResumoPrecos = {
  itens: number
  semCusto: number
  abaixoDoCusto: number
  abaixoDoAlvo: number
  noAlvo: number
  /**
   * Margem média PONDERADA PELO PREÇO, em porcento. Nulo quando nenhum item
   * tem custo.
   *
   * Ponderada porque a média simples deixa a pulseira de R$ 9 pesar o mesmo
   * que o casaco de R$ 400. O que interessa é a margem do dinheiro que passa
   * pelo caixa, e o casaco é mais dinheiro.
   */
  margemMedia: number | null
}

export function resumirPrecos<T extends { precoCent: number; analise: AnalisePreco }>(
  linhas: T[],
): ResumoPrecos {
  let semCusto = 0
  let abaixoDoCusto = 0
  let abaixoDoAlvo = 0
  let noAlvo = 0
  let pesoTotal = 0
  let margemPesada = 0

  for (const l of linhas) {
    switch (l.analise.situacao) {
      case 'sem_custo': semCusto++; break
      case 'abaixo_do_custo': abaixoDoCusto++; break
      case 'abaixo_do_alvo': abaixoDoAlvo++; break
      case 'no_alvo': noAlvo++; break
    }
    if (l.analise.margemPct !== null && l.precoCent > 0) {
      pesoTotal += l.precoCent
      margemPesada += l.analise.margemPct * l.precoCent
    }
  }

  return {
    itens: linhas.length,
    semCusto,
    abaixoDoCusto,
    abaixoDoAlvo,
    noAlvo,
    margemMedia: pesoTotal > 0 ? margemPesada / pesoTotal : null,
  }
}

// ─────────────────────────────────────────────────────────────
// COM BANCO
// ─────────────────────────────────────────────────────────────

export type LinhaPreco = {
  produtoId: string
  nome: string
  marca: string
  categoria: string
  custoCent: number | null
  /** O preço À VISTA. É a tabela de referência; cartão e crediário são ele mais a taxa. */
  precoCent: number
  analise: AnalisePreco
}

/**
 * A ordem em que os problemas aparecem: primeiro o que dá prejuízo em cada
 * venda, depois o que dá menos do que devia, depois o que ninguém sabe, e por
 * último o que está bem. Dentro de cada grupo, a maior diferença primeiro.
 */
const PESO_SITUACAO: Record<SituacaoPreco, number> = {
  abaixo_do_custo: 0,
  abaixo_do_alvo: 1,
  sem_custo: 2,
  no_alvo: 3,
}

export function ordenarPorUrgenciaDePreco<T extends { nome: string; analise: AnalisePreco }>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => {
    const p = PESO_SITUACAO[a.analise.situacao] - PESO_SITUACAO[b.analise.situacao]
    if (p !== 0) return p
    const d = (b.analise.diferencaCent ?? 0) - (a.analise.diferencaCent ?? 0)
    if (d !== 0) return d
    return a.nome.localeCompare(b.nome)
  })
}

/**
 * O catálogo ativo, produto a produto, com a conta feita para este alvo.
 *
 * Por PRODUTO e não por variação: preço e custo moram no produto, e "Camiseta
 * canelada" é uma decisão de preço só. O ajuste de preço por variação
 * (`ajustePreco`) fica de fora de propósito — ele é exceção de tamanho
 * especial, e a margem que a loja precisa acertar é a da tabela.
 */
export async function analisarCatalogo(sessao: Sessao, alvoPct: number): Promise<LinhaPreco[]> {
  exigir(sessao, 'produto.preco')

  return comoOrg(sessao.orgId, async (db) => {
    const produtos = await db.produto.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        marca: true,
        custo: true,
        precoVista: true,
        categoria: { select: { nome: true } },
      },
    })

    return ordenarPorUrgenciaDePreco(
      produtos.map((p) => {
        // `centavos` lê o Decimal como texto: "22.5" vira 2250 sem passar
        // por ponto flutuante.
        const custoCent = p.custo === null ? null : centavos(p.custo)
        const precoCent = p.precoVista === null ? 0 : centavos(p.precoVista)
        return {
          produtoId: p.id,
          nome: p.nome,
          marca: p.marca ?? '',
          categoria: p.categoria?.nome ?? '',
          custoCent,
          precoCent,
          analise: analisarPreco({ custoCent, precoCent, alvoPct }),
        }
      }),
    )
  })
}

/**
 * Quantidade vendida por produto nos últimos 30 dias.
 *
 * É a coluna que dá peso à lista: o produto abaixo do alvo que sai vinte
 * vezes por semana importa mais que o que saiu uma vez no mês. Só as lojas
 * que a pessoa alcança entram na soma — o gerente de uma loja lê o giro da
 * loja dele, que é o que ele conhece.
 */
export async function vendidos30(sessao: Sessao): Promise<Map<string, number>> {
  exigir(sessao, 'produto.preco')

  const alcance = unidadesQuePodem(sessao, 'produto.preco')
  if (Array.isArray(alcance) && alcance.length === 0) return new Map()
  const corte = new Date(Date.now() - JANELA_VENDAS_DIAS * 86400000)

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.$queryRaw<{ produto_id: string; quantidade: string }[]>`
      select vr.produto_id, sum(i.quantidade) as quantidade
        from venda_itens i
        join vendas v on v.id = i.venda_id
        join variacoes vr on vr.id = i.variacao_id
       where v.situacao = 'CONCLUIDA' and v.criada_em >= ${corte}
         ${alcance === 'todas' ? Prisma.empty : Prisma.sql`and v.unidade_id = any(${alcance})`}
       group by 1
    `
    return new Map(linhas.map((l) => [l.produto_id, Number(l.quantidade ?? 0)]))
  })
}
