// A planilha dos clientes. Cláusula 11 dos termos: a empresa leva os dados
// dela quando quiser — e esta é a lista que ela mais vai querer levar.
// Também é a lista que um funcionário de saída mais quer levar: por isso
// exige ver relatório além de ver cliente, e fica no livro (exportacao.ts).

import { sessaoViva } from '@/servidor/pagina'
import { acharOrgPorSlug } from '@/servidor/banco'
import { listarClientes, mostrarTelefone } from '@/servidor/cliente'
import { SemPermissao } from '@/servidor/permissao'
import { csv, respostaCsv } from '@/servidor/csv'
import { filtrosUsados, podeExportar, registrarExportacao } from '@/servidor/exportacao'

export async function GET(req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const [empresa, sessao] = await Promise.all([acharOrgPorSlug(slug), sessaoViva(slug)])
  if (!empresa) return new Response('Empresa não encontrada.', { status: 404 })
  if (!sessao || sessao.orgId !== empresa.id) return new Response('Entre no sistema para exportar.', { status: 401 })

  if (!podeExportar(sessao, 'clientes')) return new Response('Sem permissão para baixar a lista de clientes.', { status: 403 })

  const busca = new URL(req.url).searchParams
  const q = busca.get('q') ?? undefined
  try {
    // A planilha é a cópia que a loja guarda: vai tudo, com a coluna "Ativo".
    const clientes = await listarClientes(sessao, q, 50_000, 'todos')
    const corpo = csv(
      ['Nome', 'Telefone', 'Cidade', 'Nascimento', 'Cadastro', 'Ativo', 'Compras', 'Gastou', 'Última compra', 'Pontos', 'Deve no crediário', 'Vencido'],
      clientes.map((c) => [
        c.nome, mostrarTelefone(c.telefone), c.cidade, c.nascimento, c.criadoEm, c.ativo,
        c.compras, c.gastou, c.ultimaCompra, c.pontos, c.devendo, c.vencido,
      ]),
    )
    await registrarExportacao(sessao, 'clientes', { linhas: clientes.length, filtros: filtrosUsados(busca) })
    return respostaCsv(`clientes-${slug}`, corpo)
  } catch (e) {
    if (e instanceof SemPermissao) return new Response('Sem permissão para ver clientes.', { status: 403 })
    throw e
  }
}
