// Corrigir a data de uma venda.
//
// ── por que existe ───────────────────────────────────────────
// A loja continua com o outro sistema para a nota fiscal, e às vezes a venda
// de sábado só é lançada aqui na segunda — no dia errado. Apagar e refazer
// estornava os pontos da cliente, mexia no estoque duas vezes e perdia o
// registro. Aqui muda SÓ a data do fato.
//
// ── o que muda e o que não muda ──────────────────────────────
// Muda `criadaEm`, que é a data do FATO: é por ela que o DRE, as metas, o
// painel e os relatórios contam. Não muda o caixa: o fechamento soma as
// vendas pelo TURNO (`caixaId`), e o dinheiro entrou na gaveta do dia em que
// entrou — se a data levasse o caixa junto, o turno conferido deixaria de
// bater com o que foi contado. Também não mudam itens, valores, formas de
// pagamento, vendedora, parcelas e pontos. A data de antes da PRIMEIRA
// correção fica guardada (`dataOriginal`), com quem, quando e por quê.
//
// ── o mês que já passou ──────────────────────────────────────
// O Norte não tranca mês (ver fechamento.ts), mas mês que já virou costuma
// ter ido para a contadora. Mover uma venda para dentro ou para fora dele
// muda um número que alguém já leu — então a correção AVISA e só segue com a
// confirmação de quem corrige. Os dois meses importam: o que perde a venda e
// o que ganha.

import { comoOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import { assinarExcecao } from './autorizacao'
import { diaEmSP, diasEntre, inicioDoDiaEmSP } from './dia'
import { motivoServe } from './excecoes'

/** Até quantos dias para trás uma venda pode ser levada. */
export const CORRECAO_MAX_DIAS = 366

export type CorrecaoDeData =
  | { ok: true; de: string; para: string; semMudanca?: true }
  | { ok: false; erro: string; precisaPin?: true }
  /** Mês que já passou: a tela mostra os avisos e pede a confirmação. */
  | { ok: false; erro: string; precisaConfirmar: true; avisos: string[] }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const nomeDoMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`

/** Os avisos de mês que já passou — puro, para a tela e o teste. */
export function avisosDeMesPassado(de: string, para: string, hoje: string): string[] {
  const atual = hoje.slice(0, 7)
  return [...new Set([de.slice(0, 7), para.slice(0, 7)])]
    .filter((m) => m < atual)
    .sort()
    .map((m) => `${nomeDoMes(m)} já passou: o resultado, as metas e as comissões desse mês mudam. Se a contadora já fechou, avise ela.`)
}

export async function corrigirDataDaVenda(
  sessao: Sessao,
  p: { vendaId: string; dia: string; motivo: string; confirmado?: boolean; pin?: string | null },
  agora = new Date(),
): Promise<CorrecaoDeData> {
  const hoje = diaEmSP(agora)
  const para = String(p.dia ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(para) || Number.isNaN(Date.parse(`${para}T12:00:00Z`))) {
    return { ok: false, erro: 'Escolha a data certa da venda.' }
  }
  if (para > hoje) return { ok: false, erro: 'A venda não pode ter data no futuro.' }
  if (diasEntre(para, hoje) > CORRECAO_MAX_DIAS) return { ok: false, erro: 'Isso é mais de um ano atrás. Confira o ano da data.' }
  const motivo = String(p.motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!motivoServe(motivo)) return { ok: false, erro: 'Diga o motivo da correção (fica no livro e na venda).' }

  // Uma olhada antes: a loja da venda decide quem pode, e a data de hoje dela
  // decide os avisos. A gravação lê de novo, com a venda travada.
  const v = await comoOrg(sessao.orgId, (db) =>
    db.venda.findUnique({ where: { id: p.vendaId }, select: { unidadeId: true, situacao: true, criadaEm: true } }),
  )
  if (!v) return { ok: false, erro: 'Venda não encontrada.' }
  exigir(sessao, 'venda.cancelar', v.unidadeId)
  if (v.situacao !== 'CONCLUIDA') {
    return {
      ok: false,
      erro:
        v.situacao === 'CANCELADA'
          ? 'Venda cancelada não tem data a corrigir.'
          : 'Só a venda concluída tem a data corrigida aqui.',
    }
  }
  const de = diaEmSP(v.criadaEm)
  if (de === para) return { ok: true, de, para, semMudanca: true }

  const avisos = avisosDeMesPassado(de, para, hoje)
  if (avisos.length > 0 && !p.confirmado) {
    return { ok: false, erro: 'Confirme: a correção muda um mês que já passou.', precisaConfirmar: true, avisos }
  }

  // Fora da transação: a conferência do PIN abre a dela (o freio).
  const assinatura = await assinarExcecao(sessao, { pin: p.pin })
  if (!assinatura.ok) return { ok: false, erro: assinatura.erro, precisaPin: true }

  return comoOrg(sessao.orgId, async (db) => {
    // A venda travada até o fim: o cancelamento e a devolução também travam,
    // e a correção não cruza com eles no meio.
    await db.$queryRaw`select id from vendas where id = ${p.vendaId} for update`
    const atual = await db.venda.findUnique({
      where: { id: p.vendaId },
      select: { id: true, numero: true, unidadeId: true, situacao: true, criadaEm: true, dataOriginal: true, total: true },
    })
    if (!atual || atual.situacao !== 'CONCLUIDA') return { ok: false as const, erro: 'A venda mudou agora. Recarregue a tela.' }
    const deAgora = diaEmSP(atual.criadaEm)
    // A mesma hora do dia, no dia certo: a venda das 15h continua das 15h.
    const horaDoDia = atual.criadaEm.getTime() - inicioDoDiaEmSP(deAgora).getTime()
    const novaData = new Date(inicioDoDiaEmSP(para).getTime() + horaDoDia)

    await db.venda.update({
      where: { id: atual.id },
      data: {
        criadaEm: novaData,
        // A de antes da PRIMEIRA correção: a segunda não apaga a primeira.
        dataOriginal: atual.dataOriginal ?? atual.criadaEm,
        dataCorrigidaEm: agora,
        dataCorrigidaPor: sessao.nome,
        dataCorrigidaMotivo: motivo,
      },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: atual.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'venda.data_corrigiu',
        alvoTipo: 'venda',
        alvoId: atual.id,
        alvoNome: `Venda ${atual.numero}`,
        valor: atual.total,
        motivo: `${deAgora.split('-').reverse().join('/')} → ${para.split('-').reverse().join('/')} · ${motivo}`.slice(0, 300),
        antes: { dia: deAgora },
        depois: { dia: para },
        assinado: assinatura.assinou,
      },
    })
    return { ok: true as const, de: deAgora, para }
  })
}
