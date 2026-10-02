'use server'

// As duas ações da página PÚBLICA do catálogo. Sem sessão: quem chama é a
// cliente. Nada aqui confia no navegador — o servidor (src/servidor/catalogo.ts)
// lê preço e estoque de novo, e o pedido tem freio e carimbo.

import { headers } from 'next/headers'
import { conferirCarimbo } from '@/servidor/autocadastro'
import { fazerPedidoPeloCatalogo, produtosDoCatalogo, type PedidoDoCatalogo, type PedidoFeito } from '@/servidor/catalogo'
import { deOndeVeio, enderecoPublico } from '@/servidor/requisicao'
import { avisarEquipeDoPedido } from '@/servidor/assistente/avisos-encomenda'

export async function maisProdutos(
  slug: string,
  endereco: string,
  filtro: { categoriaId?: string | null; busca?: string | null; pular?: number },
) {
  if (typeof slug !== 'string' || typeof endereco !== 'string') return null
  return produtosDoCatalogo(slug, endereco, {
    categoriaId: typeof filtro?.categoriaId === 'string' ? filtro.categoriaId : null,
    busca: typeof filtro?.busca === 'string' ? filtro.busca : null,
    pular: Number(filtro?.pular) || 0,
  })
}

/** O endereço do Norte para o link de acompanhar. Sem NORTE_URL (laptop), o do próprio pedido. */
async function base(): Promise<string> {
  const fixo = await enderecoPublico()
  if (fixo) return fixo
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  return host ? `https://${host}` : ''
}

export async function pedir(
  slug: string,
  endereco: string,
  pedido: PedidoDoCatalogo,
  carimbo: string,
  site: string,
): Promise<PedidoFeito> {
  if (typeof slug !== 'string' || typeof endereco !== 'string' || !pedido || typeof pedido !== 'object') {
    return { ok: false, erro: 'Pedido inválido. Recarregue a página.' }
  }
  // O campo escondido: gente não vê, robô preenche.
  if (site) return { ok: false, erro: 'Não foi possível enviar. Recarregue a página.' }
  const c = conferirCarimbo(String(carimbo ?? ''))
  if (c === 'velho') return { ok: false, erro: 'A página ficou aberta muito tempo. Recarregue e mande de novo (o pedido continua guardado).' }
  if (c !== 'ok') return { ok: false, erro: 'Não foi possível enviar. Recarregue a página.' }

  const r = await fazerPedidoPeloCatalogo(slug, endereco, pedido, await deOndeVeio(), await base())
  if (!r.ok) return { ok: false, erro: r.erro, mudou: r.mudou }
  // O aviso para a equipe não segura a cliente: sai em segundo plano.
  if (r.orgId && r.encomendaId) void avisarEquipeDoPedido(r.orgId, r.encomendaId).catch(() => {})
  return { ok: true, codigo: r.codigo, acompanhamento: r.acompanhamento, totalC: r.totalC, whatsapp: r.whatsapp, mensagem: r.mensagem }
}
