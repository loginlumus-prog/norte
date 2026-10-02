'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// Permissão e loja são exigidas dentro de `servidor/encomenda.ts`; aqui se
// confere a FORMA do que veio (o navegador é do usuário) e se traduz o erro
// para uma frase que a tela pode mostrar.

import { revalidatePath } from 'next/cache'
import { avisarClienteDaEncomenda } from '@/servidor/assistente/avisos-encomenda'
import { redirect } from 'next/navigation'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import {
  buscarClientesParaEncomenda,
  criarEncomenda,
  editarEncomenda,
  formaSinalValida,
  mudarSituacao,
  marcarVista,
  type DadosEncomenda,
  type Mudanca,
} from '@/servidor/encomenda'
import { registrarErro } from '@/servidor/registro'
import { DINHEIRO_ILEGIVEL, lerDinheiro } from '@/servidor/dinheiro'

export type EstadoEncomenda = { erro?: string; ok?: string; pedeConfirmacao?: boolean; vez?: number }

const texto = (v: unknown, max = 1000) => (typeof v === 'string' ? v.slice(0, max) : '')
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

/**
 * "1.234,56", "1234.56", "" → número, pela régua de todo campo de dinheiro
 * (`lerDinheiro`). Vazio é zero (o sinal é opcional); o que não dá para ler
 * é NaN, e a ação devolve o erro no campo em vez de gravar zero.
 */
function dinheiro(v: unknown): number {
  const t = texto(v, 20).trim()
  if (!t) return 0
  return lerDinheiro(t) ?? Number.NaN
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
    // Vazio = não disse. O servidor só exige quando há dinheiro se movendo.
    sinalForma: formaSinalValida(form.get('sinalForma')) ? (form.get('sinalForma') as DadosEncomenda['sinalForma']) : null,
    dia: texto(form.get('dia'), 10),
    hora: texto(form.get('hora'), 5),
    entrega: form.get('entrega') === '1',
    endereco: texto(form.get('endereco'), 400),
    observacao: texto(form.get('observacao'), 1200),
    confirmarPassado: form.get('confirmarPassado') === 'on',
  }
  if (Number.isNaN(dados.valor)) return { erro: `O valor: ${DINHEIRO_ILEGIVEL}` }
  if (Number.isNaN(dados.sinal)) return { erro: `O sinal: ${DINHEIRO_ILEGIVEL}` }

  const vez = (anterior.vez ?? 0) + 1
  try {
    const r = id ? await editarEncomenda(sessao, id, dados) : await criarEncomenda(sessao, dados)
    if (!r.ok) return { erro: r.erro, pedeConfirmacao: r.pedeConfirmacao, vez }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode anotar encomenda nesta loja.', vez }
    return { erro: `Não deu para salvar. Tente de novo. (código ${registrarErro('encomenda.salvar', e)})`, vez }
  }

  revalidatePath(`/${slug}/encomendas`)
  revalidatePath(`/${slug}/financeiro`)
  // O sinal em dinheiro passou pela gaveta: a conta do caixa mudou.
  revalidatePath(`/${slug}/balcao`)
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
          formaDevolucao: formaSinalValida((mudanca as { formaDevolucao?: unknown }).formaDevolucao)
            ? ((mudanca as { formaDevolucao: DadosEncomenda['sinalForma'] }).formaDevolucao)
            : null,
        }
      : { para }

  try {
    const r = await mudarSituacao(sessao, id, m)
    if (!r.ok) return { erro: r.erro }
    // O pedido do catálogo: a cliente fica sabendo pelo WhatsApp (sem esperar).
    if (para === 'PRONTA' || para === 'CANCELADA') void avisarClienteDaEncomenda(sessao.orgId, id, para).catch(() => {})
  } catch (e) {
    if (e instanceof SemPermissao) {
      return { erro: para === 'CANCELADA' ? 'Você não pode cancelar encomenda. Peça para a gerência.' : 'Você não pode mexer nas encomendas desta loja.' }
    }
    return { erro: `Não deu para salvar. Tente de novo. (código ${registrarErro('encomenda.situacao', e)})` }
  }

  revalidatePath(`/${slug}/encomendas`)
  if (para === 'CANCELADA') {
    revalidatePath(`/${slug}/financeiro`)
    revalidatePath(`/${slug}/balcao`)
  }
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

/** "Aceitar pedido": o pedido do catálogo foi visto, e a cliente fica sabendo. */
export async function aceitarEncomendaAcao(slug: string, id: string): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(id)) return { erro: 'Encomenda inválida.' }
  try {
    const r = await marcarVista(sessao, id)
    if (!r.ok) return { erro: r.erro }
    if (!r.jaEstava) void avisarClienteDaEncomenda(sessao.orgId, id, 'ACEITA').catch(() => {})
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer nas encomendas desta loja.' }
    return { erro: `Não deu para aceitar. Tente de novo. (código ${registrarErro('encomenda.aceitar', e)})` }
  }
  revalidatePath(`/${slug}/encomendas`)
  return { ok: 'Pedido aceito.' }
}
