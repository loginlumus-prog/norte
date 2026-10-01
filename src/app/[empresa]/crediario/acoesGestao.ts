'use server'

// A gestão do crediário por cliente (crediario-gestao.ts). Server Action é
// endereço público: cada função de lá confere de novo a capacidade NA LOJA,
// a ficha (pelo RLS) e o PIN quando a exceção pede.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import {
  anotarNaFicha,
  juntarFichas,
  lancarDivida,
  pausarCobranca,
  procurarFichas,
  type PedidoDeDivida,
} from '@/servidor/crediario-gestao'
import { baixaExterna } from '@/servidor/recibos'
import { lerDinheiro } from '@/servidor/dinheiro'
import { plural } from '@/ui/texto'

export type EstadoGestao = { erro?: string; ok?: string; precisaPin?: boolean; vendaId?: string; fica?: string }

const SEM_PERMISSAO = 'Isto é de quem negocia o crediário nesta loja (gerente ou dona).'

function revalidar(slug: string, ...clientes: string[]) {
  revalidatePath(`/${slug}/crediario`)
  for (const c of clientes) revalidatePath(`/${slug}/clientes/${c}`)
  revalidatePath(`/${slug}/balcao`)
}

async function tentar(fn: () => Promise<EstadoGestao>): Promise<EstadoGestao> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: SEM_PERMISSAO }
    return { erro: recadoDoErro(e, 'Não deu certo agora. Tente de novo.') }
  }
}

export async function pausarCobrancaAcao(slug: string, clienteId: string, pausar: boolean, motivo: string): Promise<EstadoGestao> {
  return tentar(async () => {
    const r = await pausarCobranca(await exigirSessao(slug), clienteId, pausar, motivo)
    if (!r.ok) return { erro: r.erro }
    revalidar(slug, clienteId)
    return { ok: pausar ? 'Cobrança pausada. A dívida continua no carnê; ela sai da lista de quem cobrar.' : 'Cobrança retomada.' }
  })
}

export async function anotarAcao(slug: string, clienteId: string, texto: string): Promise<EstadoGestao> {
  return tentar(async () => {
    const r = await anotarNaFicha(await exigirSessao(slug), clienteId, texto)
    if (!r.ok) return { erro: r.erro }
    revalidar(slug, clienteId)
    return { ok: 'Anotado na ficha.' }
  })
}

export async function lancarDividaAcao(
  slug: string,
  p: Omit<PedidoDeDivida, 'valor'> & { valor: string },
): Promise<EstadoGestao> {
  const valor = lerDinheiro(p.valor)
  if (valor === null || valor <= 0) return { erro: 'Diga quanto ela deve. Escreva assim: 350,00.' }
  return tentar(async () => {
    const r = await lancarDivida(await exigirSessao(slug), { ...p, valor })
    if (!r.ok) return { erro: r.erro }
    revalidar(slug, p.clienteId)
    return { ok: `Dívida lançada: nº ${r.numero}, em ${plural(p.parcelas, 'parcela', 'parcelas')}. Ela já aparece no carnê.`, vendaId: r.vendaId }
  })
}

export async function quitouTudoAcao(
  slug: string,
  p: { clienteId: string; unidadeId: string; referencia: string; pagoEm: string; pin?: string | null },
): Promise<EstadoGestao> {
  return tentar(async () => {
    const r = await baixaExterna(await exigirSessao(slug), {
      clienteId: p.clienteId,
      unidadeId: p.unidadeId,
      parcelaIds: [],
      valor: 0,
      tudo: true,
      referencia: p.referencia,
      pagoEm: p.pagoEm,
      pin: p.pin,
    })
    if (!r.ok) return { erro: r.erro, precisaPin: r.precisaPin }
    revalidar(slug, p.clienteId)
    return { ok: `Baixa de ${r.recebido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}: ela não deve mais nada nesta loja.` }
  })
}

export async function procurarFichasAcao(slug: string, termo: string, excetoId: string) {
  try {
    return await procurarFichas(await exigirSessao(slug), termo, excetoId)
  } catch (e) {
    if (e instanceof SemPermissao) return []
    throw e
  }
}

export async function juntarFichasAcao(
  slug: string,
  p: { ficaId: string; saiId: string; motivo: string; pin?: string | null },
): Promise<EstadoGestao> {
  return tentar(async () => {
    const r = await juntarFichas(await exigirSessao(slug), p)
    if (!r.ok) return { erro: r.erro, precisaPin: r.precisaPin }
    revalidar(slug, p.ficaId, p.saiId)
    revalidatePath(`/${slug}/clientes`)
    const m = r.movidos
    const partes = [
      m.vendas && plural(m.vendas, 'venda', 'vendas'),
      m.parcelas && plural(m.parcelas, 'parcela', 'parcelas'),
      m.recibos && plural(m.recibos, 'recibo', 'recibos'),
      m.vales && plural(m.vales, 'vale', 'vales'),
    ].filter(Boolean)
    return { ok: `Fichas juntadas${partes.length ? `: ${partes.join(', ')} foram para a que ficou` : ''}.`, fica: r.fica }
  })
}
