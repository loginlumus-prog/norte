'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// A capacidade `financeiro.lancar` é exigida lá dentro, em `lancar()` e
// `marcarPago()`, junto da unidade.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { lancar, marcarPago } from '@/servidor/financeiro'
import { alternarRecorrente, criarRecorrente, editarRecorrente, garantirRecorrentes } from '@/servidor/recorrentes'
import { SemPermissao } from '@/servidor/permissao'
import { lerDinheiro } from '@/servidor/dinheiro'
import { colunaDoDia, diaEmSP } from '@/servidor/dia'
import type { TipoLancamento } from '@prisma/client'

export type EstadoLanc = { erro?: string; ok?: string }

export async function novoLancamento(
  slug: string,
  _anterior: EstadoLanc,
  form: FormData,
): Promise<EstadoLanc> {
  const s = await exigirSessao(slug)

  // "1.234,56" é mil duzentos e poucos. Só trocar a vírgula por ponto
  // recusava o valor escrito do jeito brasileiro, e aceitava "1.234" como
  // R$ 1,23. Ver `lerDinheiro`.
  const valor = lerDinheiro(String(form.get('valor') ?? '')) ?? Number.NaN
  const descricao = String(form.get('descricao') ?? '').slice(0, 200)
  const categoriaId = String(form.get('categoriaId') ?? '').slice(0, 64)
  const vencimento = String(form.get('vencimento') ?? '')
  const tipoBruto = String(form.get('tipo') ?? 'DESPESA')
  const tipo: TipoLancamento | null = tipoBruto === 'DESPESA' || tipoBruto === 'RECEITA' ? tipoBruto : null

  if (!descricao.trim()) return { erro: 'Descreva o que é este lançamento.' }
  if (!categoriaId) return { erro: 'Escolha uma categoria.' }
  if (!tipo) return { erro: 'Escolha se é despesa ou receita.' }
  if (Number.isNaN(valor)) return { erro: 'O valor não é um número. Escreva assim: 1.234,56.' }
  if (valor <= 0) return { erro: 'O valor precisa ser maior que zero.' }
  // A data vem do campo `date` (AAAA-MM-DD). Qualquer outra coisa virava
  // "Invalid Date" e o erro cru do banco aparecia na tela.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || Number.isNaN(colunaDoDia(vencimento).getTime())) {
    return { erro: 'Informe a data de vencimento.' }
  }

  const jaPago = form.get('jaPago') === 'on'

  try {
    await lancar(s, {
      categoriaId,
      contaId: String(form.get('contaId') ?? '').slice(0, 64) || null,
      unidadeId: String(form.get('unidadeId') ?? '').slice(0, 64) || null,
      tipo,
      descricao,
      valor,
      // Coluna `date`: grava o DIA digitado, à meia-noite UTC, que é como o
      // banco o devolve — ver `servidor/dia.ts`.
      vencimento: colunaDoDia(vencimento),
      pagoEm: jaPago ? colunaDoDia(vencimento) : null,
      fornecedor: String(form.get('fornecedor') ?? '').slice(0, 160),
      documento: String(form.get('documento') ?? '').slice(0, 80),
    })
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode lançar nesta loja.' }
    return { erro: recadoDoErro(e, 'Não deu para lançar.') }
  }

  revalidatePath(`/${slug}/financeiro`)
  return { ok: 'Lançado.' }
}

export async function pagar(slug: string, id: string) {
  const s = await exigirSessao(slug)
  // Coluna `date`: o DIA de hoje em São Paulo. `new Date()` depois das 21h já
  // é amanhã em UTC — e a conta paga no dia 30 caía no mês seguinte.
  await marcarPago(s, id, colunaDoDia(diaEmSP()))
  revalidatePath(`/${slug}/financeiro`)
}

// ── contas recorrentes ─────────────────────────────────────────
// `financeiro.lancar` é exigido em `servidor/recorrentes.ts`, junto da loja.

export type EstadoRecorrente = { erro?: string; ok?: string; vez?: number }

export async function salvarRecorrenteAcao(
  slug: string,
  anterior: EstadoRecorrente,
  form: FormData,
): Promise<EstadoRecorrente> {
  const s = await exigirSessao(slug)
  const vez = (anterior.vez ?? 0) + 1
  const id = String(form.get('id') ?? '')
  if (id && !/^[\w-]{1,64}$/.test(id)) return { erro: 'Conta inválida.', vez }

  const valor = lerDinheiro(String(form.get('valor') ?? '')) ?? Number.NaN
  const dados = {
    descricao: String(form.get('descricao') ?? '').slice(0, 200),
    categoriaId: String(form.get('categoriaId') ?? '').slice(0, 64),
    valor: Number.isFinite(valor) ? valor : Number.NaN,
    diaVencimento: Number(form.get('diaVencimento') ?? ''),
    fornecedor: String(form.get('fornecedor') ?? '').slice(0, 160),
    unidadeId: String(form.get('unidadeId') ?? '').slice(0, 64) || null,
    ateEm: String(form.get('ateEm') ?? '').slice(0, 10) || null,
  }

  try {
    const r = id
      ? await editarRecorrente(s, id, { ...dados, ativo: form.get('ativo') !== '0' })
      : await criarRecorrente(s, dados)
    if (!r.ok) return { erro: r.erro, vez }
    // A conta nova já nasce com os lançamentos do mês e do seguinte — sem
    // esperar alguém reabrir a tela.
    await garantirRecorrentes(s)
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode cadastrar conta nesta loja.', vez }
    console.error('[recorrente] salvar', e)
    return { erro: 'Não deu para salvar. Tente de novo.', vez }
  }

  revalidatePath(`/${slug}/financeiro`)
  return { ok: id ? 'Conta alterada. Os lançamentos em aberto dela foram acertados.' : 'Conta cadastrada.', vez }
}

export async function alternarRecorrenteAcao(slug: string, id: string, ativo: boolean): Promise<{ erro?: string }> {
  const s = await exigirSessao(slug)
  if (!/^[\w-]{1,64}$/.test(id)) return { erro: 'Conta inválida.' }
  try {
    const r = await alternarRecorrente(s, id, ativo === true)
    if (!r.ok) return { erro: r.erro }
    if (ativo) await garantirRecorrentes(s)
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer nesta conta.' }
    console.error('[recorrente] pausar', e)
    return { erro: 'Não deu para salvar. Tente de novo.' }
  }
  revalidatePath(`/${slug}/financeiro`)
  return {}
}
