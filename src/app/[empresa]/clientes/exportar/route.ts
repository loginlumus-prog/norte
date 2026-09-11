// A planilha dos clientes. Cláusula 11 dos termos: a empresa leva os dados
// dela quando quiser — e esta é a lista que ela mais vai querer levar.

import { sessaoViva } from '@/servidor/pagina'
import { acharOrgPorSlug } from '@/servidor/banco'
import { listarClientes, mostrarTelefone } from '@/servidor/cliente'
import { SemPermissao } from '@/servidor/permissao'
import { csv, respostaCsv } from '@/servidor/csv'

export async function GET(req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const [empresa, sessao] = await Promise.all([acharOrgPorSlug(slug), sessaoViva(slug)])
  if (!empresa) return new Response('Empresa não encontrada.', { status: 404 })
  if (!sessao || sessao.orgId !== empresa.id) return new Response('Entre no sistema para exportar.', { status: 401 })

  const q = new URL(req.url).searchParams.get('q') ?? undefined
  try {
    const clientes = await listarClientes(sessao, q)
    const corpo = csv(
      ['Nome', 'Telefone', 'Cidade', 'Nascimento', 'Cadastro', 'Ativo', 'Compras', 'Gastou', 'Última compra', 'Pontos', 'Deve no crediário', 'Vencido'],
      clientes.map((c) => [
        c.nome, mostrarTelefone(c.telefone), c.cidade, c.nascimento, c.criadoEm, c.ativo,
        c.compras, c.gastou, c.ultimaCompra, c.pontos, c.devendo, c.vencido,
      ]),
    )
    return respostaCsv(`clientes-${slug}`, corpo)
  } catch (e) {
    if (e instanceof SemPermissao) return new Response('Sem permissão para ver clientes.', { status: 403 })
    throw e
  }
}
