'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// Permissão e loja são exigidas dentro de `servidor/encomenda.ts`; aqui se
// confere a FORMA do que veio (o navegador é do usuário) e se traduz o erro
// para uma frase que a tela pode mostrar.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import {
  buscarClientesParaEncomenda,
  criarEncomenda,
  editarEncomenda,
  mudarSituacao,
  type DadosEncomenda,
  type Mudanca,
} from '@/servidor/encomenda'

export type EstadoEncomenda = { erro?: string; ok?: string; pedeConfirmacao?: boolean; vez?: number }

const texto = (v: unknown, max = 1000) => (typeof v === 'string' ? v.slice(0, max) : '')
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

/** "1.234,56", "1234.56", "" → número. Vazio é zero; lixo é NaN, e o servidor recusa. */
function dinheiro(v: unknown): number {
  const t = texto(v, 20).trim()
  if (!t) return 0
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  return /^\d+(\.\d{0,2})?$/.test(normal) ? Number(normal) : Number.NaN
}

export async function salvarEncomendaAcao(
  slug: string,
  anterior: EstadoEncomenda,
  form: FormData,
): Promise<EstadoEncomenda> {
  const sessao = await exigirSessao(slug)
  const id = texto(form.get('id'), 64)
  if (id && !idValido(id)) return { erro: 'Encomenda inválida.' }
  const clienteId = texto(form.get('clienteId'), 64)
  if (clienteId && !idValido(clienteId)) return { erro: 'Cliente inválido.' }
  const unidadeId = texto(form.get('unidadeId'), 64)
  if (!id && !idValido(unidadeId)) return { erro: 'Escolha a loja da encomenda.' }

  const dados: DadosEncomenda = {
    unidadeId,
    clienteId: clienteId || null,
    clienteNome: texto(form.get('clienteNome'), 200),
    telefone: texto(form.get('telefone'), 40),
    descricao: texto(form.get('descricao'), 600),
    valor: dinheiro(form.get('valor')),
    sinal: dinheiro(form.get('sinal')),
    dia: texto(form.get('dia'), 10),
    hora: texto(form.get('hora'), 5),
    entrega: form.get('entrega') === '1',
    endereco: texto(form.get('endereco'), 400),
    observacao: texto(form.get('observacao'), 1200),
    confirmarPassado: form.get('confirmarPassado') === 'on',
  }
  if (Number.isNaN(dados.valor)) return { erro: 'O valor não é um número. Use só dígitos e vírgula: 120,00.' }
  if (Number.isNaN(dados.sinal)) return { erro: 'O sinal não é um número. Use só dígitos e vírgula: 50,00.' }

  const vez = (anterior.vez ?? 0) + 1
  try {
    const r = id ? await editarEncomenda(sessao, id, dados) : await criarEncomenda(sessao, dados)
    if (!r.ok) return { erro: r.erro, pedeConfirmacao: r.pedeConfirmacao, vez }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode anotar encomenda nesta loja.', vez }
    console.error('[encomenda] salvar', e)
    return { erro: 'Não deu para salvar. Tente de novo.', vez }
  }

  revalidatePath(`/${slug}/encomendas`)
  revalidatePath(`/${slug}/financeiro`)
  // Editar sai da tela de edição; anotar fica na lista, com o recado.
  if (id) redirect(`/${slug}/encomendas`)
  return { ok: 'Encomenda anotada.', vez }
}

export async function mudarSituacaoAcao(
  slug: string,
  id: string,
  mudanca: Mudanca,
): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(id)) return { erro: 'Encomenda inválida.' }
  const para = mudanca?.para
  if (para !== 'PRONTA' && para !== 'ABERTA' && para !== 'ENTREGUE' && para !== 'CANCELADA') {
    return { erro: 'Essa mudança não existe.' }
  }
  const m: Mudanca =
    para === 'CANCELADA'
      ? {
          para,
          motivo: texto((mudanca as { motivo?: unknown }).motivo, 400),
          devolveuSinal: (mudanca as { devolveuSinal?: unknown }).devolveuSinal === true,
        }
      : { para }

  try {
    const r = await mudarSituacao(sessao, id, m)
    if (!r.ok) return { erro: r.erro }
  } catch (e) {
    if (e instanceof SemPermissao) {
      return { erro: para === 'CANCELADA' ? 'Você não pode cancelar encomenda. Peça para a gerência.' : 'Você não pode mexer nas encomendas desta loja.' }
    }
    console.error('[encomenda] situação', e)
    return { erro: 'Não deu para salvar. Tente de novo.' }
  }

  revalidatePath(`/${slug}/encomendas`)
  if (para === 'CANCELADA') revalidatePath(`/${slug}/financeiro`)
  const recado: Record<typeof para, string> = {
    PRONTA: 'Marcada como pronta.',
    ABERTA: 'Voltou para a fazer.',
    ENTREGUE: 'Entregue.',
    CANCELADA: 'Cancelada.',
  }
  return { ok: recado[para] }
}

export async function buscarClientesAcao(slug: string, termo: string) {
  const sessao = await exigirSessao(slug)
  try {
    return await buscarClientesParaEncomenda(sessao, texto(termo, 80))
  } catch (e) {
    if (e instanceof SemPermissao) return []
    throw e
  }
}
