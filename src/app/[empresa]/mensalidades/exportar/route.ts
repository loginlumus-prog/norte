// A planilha das mensalidades: o filtro da tela (mês, turma, situação), com o
// responsável de cada aluno. É a carteira da escola — por isso pede ver a
// mensalidade E ler relatório, e fica no livro (exportacao.ts).

import { sessaoViva } from '@/servidor/pagina'
import { acharOrgPorSlug } from '@/servidor/banco'
import { mostrarTelefone } from '@/servidor/cliente'
import { SemPermissao, textoDaBusca, unidadesQuePodem } from '@/servidor/permissao'
import { moduloLigado } from '@/servidor/modulos'
import { csv, respostaCsv } from '@/servidor/csv'
import { filtrosUsados, podeExportar, registrarExportacao } from '@/servidor/exportacao'
import { listarMensalidades, ROTULO_SITUACAO, type SituacaoMensalidade } from '@/servidor/mensalidades'
import { mesValido } from '@/servidor/recorrentes'
import { diaDaColuna, diaEmSP } from '@/servidor/dia'
import { comoOrg } from '@/servidor/banco'

const SITUACOES: SituacaoMensalidade[] = ['atrasada', 'a_receber', 'paga', 'cancelada']

export async function GET(req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const [empresa, sessao] = await Promise.all([acharOrgPorSlug(slug), sessaoViva(slug)])
  if (!empresa) return new Response('Empresa não encontrada.', { status: 404 })
  if (!sessao || sessao.orgId !== empresa.id) return new Response('Entre no sistema para exportar.', { status: 401 })
  if (!moduloLigado(empresa, 'escola')) return new Response('Alunos e mensalidades está desligado nesta empresa.', { status: 404 })
  if (!podeExportar(sessao, 'mensalidades')) return new Response('Sem permissão para baixar as mensalidades.', { status: 403 })

  const busca = new URL(req.url).searchParams
  const mesPedido = busca.get('mes')
  const mes = mesValido(mesPedido) ? mesPedido : diaEmSP().slice(0, 7)
  const situacao = SITUACOES.find((s) => s === busca.get('situacao')) ?? null
  const turma = busca.get('turma')
  const unidadePedida = busca.get('unidade')
  try {
    // As lojas: a do filtro, se a pessoa alcança; senão, todas as que ela vê.
    const alcance = unidadesQuePodem(sessao, 'mensalidade.ver')
    const todas =
      alcance === 'todas'
        ? (await comoOrg(sessao.orgId, (db) => db.unidade.findMany({ where: { ativa: true }, select: { id: true } }))).map((u) => u.id)
        : alcance
    const unidadeIds = unidadePedida && todas.includes(unidadePedida) ? [unidadePedida] : todas
    const lista = await listarMensalidades(sessao, {
      unidadeIds,
      mes,
      situacao,
      turmaId: turma && /^[\w-]{1,64}$/.test(turma) ? turma : null,
      q: textoDaBusca(busca.get('q')),
    })
    const corpo = csv(
      ['Aluno', 'Responsável', 'Telefone do responsável', 'Turma', 'Unidade', 'Mês', 'Vencimento', 'Valor', 'Desconto', 'Devido', 'Pago', 'Pontualidade', 'Juros', 'Multa', 'Falta', 'Situação', 'Dias de atraso', 'Motivo da dispensa'],
      lista.map((m) => [
        m.aluno, m.responsavel, mostrarTelefone(m.telefoneResponsavel), m.turma, m.unidade, m.mes, diaDaColuna(m.vencimento),
        m.valor, m.desconto, m.devido, m.pago, m.abono, m.juros, m.multa,
        m.situacao === 'cancelada' ? 0 : m.resta, ROTULO_SITUACAO[m.situacao], m.diasAtraso || null, m.motivoCancelamento,
      ]),
    )
    await registrarExportacao(sessao, 'mensalidades', { linhas: lista.length, filtros: filtrosUsados(busca), unidadeId: unidadeIds.length === 1 ? unidadeIds[0] : null })
    return respostaCsv(`mensalidades-${slug}-${situacao === 'atrasada' ? 'em-atraso' : mes}`, corpo)
  } catch (e) {
    if (e instanceof SemPermissao) return new Response('Sem permissão para ver as mensalidades.', { status: 403 })
    throw e
  }
}
