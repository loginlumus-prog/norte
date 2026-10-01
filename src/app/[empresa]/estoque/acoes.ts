'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// Cada função repete a checagem inteira: sessão viva, capacidade E unidade.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { exigir, SemPermissao } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { corrigirPeloContado, marcarConferido, transferir } from '@/servidor/estoque'
import { colunaDoDia } from '@/servidor/dia'
import { registrarEntrada, definirMinimo, type ItemEntrada } from '@/servidor/entrada'
import { plural } from '@/ui/texto'

/** Tirar de uma loja e pôr na outra. A trava inteira está em `transferir`. */
export async function transferirAcao(
  slug: string,
  dados: { variacaoId: string; deUnidadeId: string; paraUnidadeId: string; quantidade: number; motivo: string },
): Promise<EstadoEntrada> {
  const s = await exigirSessao(slug)
  try {
    const r = await transferir(s, dados)
    if (!r.ok) {
      return {
        erro:
          r.motivo === 'sem_saldo'
            ? `Só tem ${r.saldo ?? 0} na loja de origem.`
            : r.motivo === 'mesma_unidade'
              ? 'Escolha outra loja para receber.'
              : 'A quantidade precisa ser maior que zero.',
      }
    }
    revalidatePath(`/${slug}/estoque`)
    revalidatePath(`/${slug}/produtos`)
    return { ok: `Transferido. Ficaram ${r.saldoOrigem} aqui e ${r.saldoDestino} lá.` }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para mexer no estoque das duas lojas.' }
    return { erro: recadoDoErro(e, 'Não deu para transferir.') }
  }
}

export type AchadoEstoque = {
  id: string
  codigo: string | null
  descricao: string
  medida: string
  saldo: number
  custo: number | null
}

/**
 * Busca para dar entrada. É parecida com a do balcão e NÃO é a mesma: aqui a
 * pessoa precisa ver o custo e o saldo atual, que são informação da loja e
 * não podem vazar para a tela de vender.
 */
export async function procurarParaEntrada(
  slug: string,
  unidadeId: string,
  termo: string,
): Promise<AchadoEstoque[]> {
  const s = await exigirSessao(slug)
  exigir(s, 'estoque.ajustar', unidadeId)
  exigir(s, 'produto.ver', unidadeId)

  const t = termo.trim()
  if (t.length < 2) return []

  return comoOrg(s.orgId, async (db) => {
    const vs = await db.variacao.findMany({
      where: {
        ativa: true,
        produto: { ativo: true },
        OR: [
          { codigo: { equals: t, mode: 'insensitive' } },
          { codigoBarras: t },
          { produto: { nome: { contains: t, mode: 'insensitive' } } },
        ],
      },
      take: 12,
      select: {
        id: true,
        codigo: true,
        produto: { select: { nome: true, medida: true, custo: true } },
        opcoes: { select: { opcao: { select: { valor: true } } } },
        estoques: { where: { unidadeId }, select: { quantidade: true } },
      },
    })

    const achados = vs.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      medida: v.produto.medida as string,
      descricao:
        v.opcoes.length > 0
          ? `${v.produto.nome} — ${v.opcoes.map((o) => o.opcao.valor).join(' · ')}`
          : v.produto.nome,
      saldo: Number(v.estoques[0]?.quantidade ?? 0),
      custo: v.produto.custo != null ? Number(v.produto.custo) : null,
    }))

    const exato = t.toUpperCase()
    return achados.sort((a, b) =>
      a.codigo?.toUpperCase() === exato ? -1 : b.codigo?.toUpperCase() === exato ? 1 : 0,
    )
  })
}

export type EstadoEntrada = { erro?: string; ok?: string; aviso?: string }

export async function darEntrada(
  slug: string,
  dados: {
    unidadeId: string
    fornecedor: string
    documento: string
    itens: ItemEntrada[]
    conta: { categoriaId: string; vencimento: string; jaPago: boolean } | null
  },
): Promise<EstadoEntrada> {
  const s = await exigirSessao(slug)

  try {
    const r = await registrarEntrada(s, {
      unidadeId: dados.unidadeId,
      fornecedor: dados.fornecedor,
      documento: dados.documento,
      itens: dados.itens,
      conta: dados.conta
        ? {
            categoriaId: dados.conta.categoriaId,
            // Coluna `date`: o DIA digitado, à meia-noite UTC, como o banco o
            // guarda. Texto que não é data vira "Invalid Date", e a entrada
            // recusa com frase — ver `registrarEntrada`.
            vencimento: /^\d{4}-\d{2}-\d{2}$/.test(dados.conta.vencimento)
              ? colunaDoDia(dados.conta.vencimento)
              : new Date(Number.NaN),
            jaPago: dados.conta.jaPago,
          }
        : undefined,
    })

    if (!r.ok) return { erro: r.motivo }

    revalidatePath(`/${slug}/estoque`)
    revalidatePath(`/${slug}/produtos`)
    if (r.contaLancada) revalidatePath(`/${slug}/financeiro`)

    const partes = [`${plural(r.itens, 'item', 'itens')} no estoque`]
    if (r.custosAtualizados > 0) partes.push(`custo de ${plural(r.custosAtualizados, 'produto atualizado', 'produtos atualizados')}`)
    if (r.contaLancada) partes.push('conta a pagar lançada')

    return {
      ok: `Entrada registrada: ${partes.join(', ')}.`,
      // Não some com o que não foi feito. A tela precisa dizer, senão a
      // pessoa acha que o custo entrou e descobre no relatório do mês.
      aviso:
        r.naoFeito.length > 0 ? `Não foi possível gravar: ${r.naoFeito.join(' e ')}.` : undefined,
    }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para dar entrada.' }
    return { erro: recadoDoErro(e, 'Não deu para registrar a entrada.') }
  }
}

/**
 * Corrigir o saldo pelo que foi CONTADO na prateleira.
 *
 * É balanço, não ajuste por diferença: a pessoa digita o que contou, e o
 * sistema calcula o movimento. Pedir a diferença obrigaria quem está com a
 * peça na mão a fazer a subtração de cabeça — e é aí que o erro entra.
 */
/**
 * `saldoVisto` é o saldo que a tela mostrava quando a pessoa começou a contar:
 * se o banco já não está nele (uma venda no meio), a correção é recusada com o
 * número novo (`saldo`). `precisaPin`: a correção pede a assinatura de quem
 * corrige — a tela mostra o campo do PIN.
 */
export type EstadoContagem = EstadoEntrada & { precisaPin?: boolean; saldo?: number }

export async function contar(
  slug: string,
  variacaoId: string,
  unidadeId: string,
  contado: number,
  motivo: string,
  saldoVisto?: number | null,
  pin?: string | null,
): Promise<EstadoContagem> {
  const s = await exigirSessao(slug)
  if (!motivo.trim()) return { erro: 'Diga o motivo da correção. Sem isso não dá para conferir depois.' }

  try {
    const r = await corrigirPeloContado(s, { variacaoId, unidadeId, contado, motivo, saldoVisto, pin })
    if (!r.ok) return r.motivo === 'mudou' ? { erro: r.erro, saldo: r.saldo } : { erro: r.erro, precisaPin: true }
    revalidatePath(`/${slug}/estoque`)
    return { ok: `Saldo corrigido para ${r.saldo}.` }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para ajustar estoque.' }
    return { erro: recadoDoErro(e, 'Não deu para corrigir.') }
  }
}

export async function salvarMinimo(
  slug: string,
  variacaoId: string,
  unidadeId: string,
  minimo: number,
): Promise<EstadoEntrada> {
  const s = await exigirSessao(slug)
  try {
    await definirMinimo(s, variacaoId, unidadeId, minimo)
    revalidatePath(`/${slug}/estoque`)
    return { ok: 'Mínimo salvo.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para isso.' }
    return { erro: recadoDoErro(e, 'Não deu para salvar.') }
  }
}

/**
 * "Já conferi" na lista "Vendido sem estoque — conferir". A trava inteira
 * (`estoque.ajustar` na loja da venda, clique duplo) está em `marcarConferido`.
 */
export async function jaConferiAcao(slug: string, vendaItemId: string): Promise<{ erro?: string }> {
  try {
    const s = await exigirSessao(slug)
    const r = await marcarConferido(s, vendaItemId)
    if (!r.ok) return { erro: r.erro }
    revalidatePath(`/${slug}/estoque`)
    return {}
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Quem confere é quem pode corrigir o estoque desta loja.' }
    return { erro: recadoDoErro(e, 'Não deu para marcar agora.') }
  }
}
