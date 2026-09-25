'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// A capacidade `financeiro.lancar` é exigida lá dentro, em `lancar()` e
// `marcarPago()`, junto da unidade.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { lancar, marcarPago } from '@/servidor/financeiro'
import { alternarRecorrente, criarRecorrente, editarRecorrente, garantirRecorrentes } from '@/servidor/recorrentes'
import { SemPermissao } from '@/servidor/permissao'
import type { TipoLancamento } from '@prisma/client'

export type EstadoLanc = { erro?: string; ok?: string }

export async function novoLancamento(
  slug: string,
  _anterior: EstadoLanc,
  form: FormData,
): Promise<EstadoLanc> {
  const s = await exigirSessao(slug)

  const valor = Number(String(form.get('valor') ?? '').replace(',', '.'))
  const descricao = String(form.get('descricao') ?? '')
  const categoriaId = String(form.get('categoriaId') ?? '')
  const vencimento = String(form.get('vencimento') ?? '')

  if (!descricao.trim()) return { erro: 'Descreva o que é este lançamento.' }
  if (!categoriaId) return { erro: 'Escolha uma categoria.' }
  if (!valor || valor <= 0) return { erro: 'O valor precisa ser maior que zero.' }
  if (!vencimento) return { erro: 'Informe a data de vencimento.' }

  const jaPago = form.get('jaPago') === 'on'

  try {
    await lancar(s, {
      categoriaId,
      contaId: String(form.get('contaId') ?? '') || null,
      unidadeId: String(form.get('unidadeId') ?? '') || null,
      tipo: (String(form.get('tipo') ?? 'DESPESA') as TipoLancamento),
      descricao,
      valor,
      // 'T12:00' evita o pulo de dia por fuso: a data digitada é a data gravada.
      vencimento: new Date(`${vencimento}T12:00:00`),
      pagoEm: jaPago ? new Date(`${vencimento}T12:00:00`) : null,
      fornecedor: String(form.get('fornecedor') ?? ''),
      documento: String(form.get('documento') ?? ''),
    })
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não deu para lançar.' }
  }

  revalidatePath(`/${slug}/financeiro`)
  return { ok: 'Lançado.' }
}

export async function pagar(slug: string, id: string) {
  const s = await exigirSessao(slug)
  await marcarPago(s, id, new Date())
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

  const bruto = String(form.get('valor') ?? '').trim()
  const valor = Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto)
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
