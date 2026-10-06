// Os avisos do balcão: o sino que acende quando algo acontece longe da tela
// de venda — encomenda nova do catálogo, pedido da fábrica a caminho, proposta
// do assistente esperando resposta. O balcão fica aberto o dia todo (e muitas
// vezes em tela cheia, sem menu): sem o sino, essas coisas só eram vistas
// quando alguém lembrava de abrir a outra tela.
//
// Só contagens e o caminho para resolver; cada aviso respeita o que a pessoa
// pode ver (a mesma regra da tela de destino).

import { comoOrg } from './banco'
import { moduloLigado } from './modulos'
import { pode, type Sessao } from './permissao'

export type AvisoDoBalcao = { tipo: 'encomenda' | 'fabrica' | 'assistente'; n: number; texto: string; href: string }

export async function avisosDoBalcao(
  sessao: Sessao,
  slug: string,
  unidadeId: string,
  agora = new Date(),
): Promise<AvisoDoBalcao[]> {
  return comoOrg(sessao.orgId, async (db) => {
    const org = await db.org.findUnique({ where: { id: sessao.orgId }, select: { plano: true, modulos: true } })
    if (!org) return []
    const avisos: AvisoDoBalcao[] = []

    // Encomenda que chegou pelo catálogo e ninguém abriu ainda.
    if (moduloLigado(org, 'encomenda') && pode(sessao, 'venda.criar', unidadeId)) {
      const n = await db.encomenda.count({
        where: { unidadeId, situacao: 'ABERTA', origem: { not: 'BALCAO' }, vistaEm: null },
      })
      if (n > 0) avisos.push({ tipo: 'encomenda', n, texto: n === 1 ? 'Encomenda nova do catálogo' : `${n} encomendas novas do catálogo`, href: `/${slug}/encomendas` })
    }

    // Pedido da loja que a fábrica já mandou: falta conferir e receber.
    if (moduloLigado(org, 'fabrica') && pode(sessao, 'fabrica.pedir', unidadeId)) {
      const n = await db.pedidoFabrica.count({ where: { lojaId: unidadeId, situacao: 'ENVIADO' } })
      if (n > 0) avisos.push({ tipo: 'fabrica', n, texto: n === 1 ? 'Pedido da fábrica a caminho: conferir e receber' : `${n} pedidos da fábrica a caminho`, href: `/${slug}/fabrica/pedir` })
    }

    // Proposta do assistente (compra, estoque) esperando o sim ou o não.
    if (moduloLigado(org, 'agente') && pode(sessao, 'agente.configurar')) {
      const n = await db.propostaAgente.count({ where: { situacao: 'AGUARDANDO', expiraEm: { gt: agora } } })
      if (n > 0) avisos.push({ tipo: 'assistente', n, texto: n === 1 ? 'O assistente espera uma resposta' : `O assistente espera ${n} respostas`, href: `/${slug}/agente` })
    }
    return avisos
  })
}
