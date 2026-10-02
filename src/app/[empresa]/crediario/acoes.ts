'use server'

// Server Action é endereço público: tudo que chega aqui é conferido de novo
// no servidor (recibos.ts e crediario.ts exigem a capacidade NA LOJA, e a
// conta do recibo é refeita com o banco travado).

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { situacaoDeCredito, salvarConfigCrediario, configCrediario, type SituacaoDeCredito } from '@/servidor/crediario'
import {
  baixaExterna,
  estornarRecibo,
  fichaParaReceber,
  procurarDevedores,
  receberVarias,
  type FichaParaReceber,
  type PedidoDeBaixaExterna,
  type PedidoDeEstorno,
  type PedidoDeRecibo,
  type ResultadoDoEstorno,
  type ResultadoDoRecibo,
} from '@/servidor/recibos'
import { lerNumero } from '@/servidor/dinheiro'

const SEM_PERMISSAO = 'Você não tem permissão para isso nesta loja.'

function revalidar(slug: string, clienteId: string) {
  revalidatePath(`/${slug}/crediario`)
  revalidatePath(`/${slug}/clientes/${clienteId}`)
  revalidatePath(`/${slug}/balcao`)
  revalidatePath(`/${slug}/caixa`)
}

export async function fichaParaReceberAcao(
  slug: string,
  clienteId: string,
  unidadeId: string,
): Promise<{ ficha: FichaParaReceber } | { erro: string }> {
  try {
    const sessao = await exigirSessao(slug)
    const ficha = await fichaParaReceber(sessao, clienteId, unidadeId)
    return ficha ? { ficha } : { erro: 'Cliente não encontrado.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: SEM_PERMISSAO }
    throw e
  }
}

export async function procurarDevedoresAcao(slug: string, termo: string, unidadeId: string) {
  try {
    const sessao = await exigirSessao(slug)
    return await procurarDevedores(sessao, termo, unidadeId)
  } catch (e) {
    if (e instanceof SemPermissao) return []
    throw e
  }
}

export async function situacaoDeCreditoAcao(slug: string, clienteId: string, unidadeId: string): Promise<SituacaoDeCredito | null> {
  try {
    const sessao = await exigirSessao(slug)
    return await situacaoDeCredito(sessao, clienteId, unidadeId)
  } catch (e) {
    // Quem não vê o crediário não recebe o aviso — e o balcão segue.
    if (e instanceof SemPermissao) return null
    throw e
  }
}

export async function receberVariasAcao(slug: string, pedido: PedidoDeRecibo): Promise<ResultadoDoRecibo> {
  try {
    const sessao = await exigirSessao(slug)
    const r = await receberVarias(sessao, pedido)
    if (r.ok) revalidar(slug, pedido.clienteId)
    return r
  } catch (e) {
    if (e instanceof SemPermissao) return { ok: false, erro: SEM_PERMISSAO }
    throw e
  }
}

export async function baixaExternaAcao(slug: string, pedido: PedidoDeBaixaExterna): Promise<ResultadoDoRecibo> {
  try {
    const sessao = await exigirSessao(slug)
    const r = await baixaExterna(sessao, pedido)
    if (r.ok) revalidar(slug, pedido.clienteId)
    return r
  } catch (e) {
    if (e instanceof SemPermissao) return { ok: false, erro: 'Baixa de pagamento feito fora é de quem negocia o crediário (gerente ou dona).' }
    throw e
  }
}

/** Estornar o recibo lançado errado (ver `estornarRecibo`): volta para a lista da cliente. */
export async function estornarReciboAcao(
  slug: string,
  pedido: PedidoDeEstorno & { clienteId: string },
): Promise<ResultadoDoEstorno> {
  try {
    const sessao = await exigirSessao(slug)
    const r = await estornarRecibo(sessao, { reciboId: pedido.reciboId, motivo: pedido.motivo, pin: pedido.pin })
    if (r.ok) revalidar(slug, pedido.clienteId)
    return r
  } catch (e) {
    if (e instanceof SemPermissao) return { ok: false, erro: SEM_PERMISSAO }
    throw e
  }
}

export type EstadoRegra = { erro?: string; ok?: string }

/** A regra do atraso (multa, juro, carência, arredondar), da tela do Crediário. */
export async function salvarRegraAcao(slug: string, _anterior: EstadoRegra, form: FormData): Promise<EstadoRegra> {
  const multa = lerNumero(String(form.get('multaPct') ?? '0'))
  const juros = lerNumero(String(form.get('jurosMes') ?? '0'))
  const carencia = lerNumero(String(form.get('carenciaDias') ?? '0'), 0)
  if (multa === null || juros === null || carencia === null) return { erro: 'Não deu para ler um dos números. Escreva assim: 2 ou 2,5.' }
  if (multa > 2) return { erro: 'A multa passa do teto de 2% (Código de Defesa do Consumidor).' }
  try {
    const sessao = await exigirSessao(slug)
    const atual = await configCrediario(sessao)
    await salvarConfigCrediario(sessao, {
      jurosMes: juros,
      maxParcelas: atual.maxParcelas,
      diasEntre: atual.diasEntre,
      multaPct: multa,
      carenciaDias: carencia,
      arredondar: form.get('arredondar') === 'on',
    })
    revalidatePath(`/${slug}/crediario`)
    return { ok: 'Regra do atraso salva. Vale a partir do próximo recebimento.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Só quem configura a empresa muda a regra do atraso.' }
    throw e
  }
}

