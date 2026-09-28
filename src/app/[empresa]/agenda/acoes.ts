'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// Permissão, loja e módulo são exigidos aqui e em `servidor/agenda.ts`; aqui
// se confere a FORMA do que veio (o navegador é do usuário) e se traduz o erro
// para uma frase que a tela pode mostrar.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { moduloLigado } from '@/servidor/modulos'
import { planoLibera } from '@/servidor/planos'
import {
  buscarClientesParaAgenda,
  marcarHorario,
  mudarSituacaoAgenda,
  remarcarHorario,
  type DadosHorario,
  type MudancaAgenda,
} from '@/servidor/agenda'
import { registrarErro } from '@/servidor/registro'

export type EstadoHorario = { erro?: string; ok?: string; pedeConfirmacao?: boolean; vez?: number }

const texto = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '')
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

/**
 * A Agenda é módulo de plano pago. O menu e a tela já somem sem ele; a ação é
 * endereço público, e confere de novo.
 */
async function agendaLigada(orgId: string): Promise<boolean> {
  const org = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { plano: true, modulos: true } }))
  return !!org && moduloLigado(org, 'agenda') && planoLibera(org.plano, 'agenda')
}

const DESLIGADA = 'A Agenda está desligada nesta empresa. Quem responde pela empresa liga em Configurações.'

export async function salvarHorarioAcao(slug: string, anterior: EstadoHorario, form: FormData): Promise<EstadoHorario> {
  const sessao = await exigirSessao(slug)
  const vez = (anterior.vez ?? 0) + 1
  if (!(await agendaLigada(sessao.orgId))) return { erro: DESLIGADA, vez }
  const id = texto(form.get('id'), 64)
  if (id && !idValido(id)) return { erro: 'Horário inválido.', vez }
  const clienteId = texto(form.get('clienteId'), 64)
  if (clienteId && !idValido(clienteId)) return { erro: 'Cadastro inválido.', vez }
  const produtoId = texto(form.get('produtoId'), 64)
  if (produtoId && !idValido(produtoId)) return { erro: 'Serviço inválido.', vez }
  const duracaoBruta = texto(form.get('duracao'), 5).trim()
  const duracao = duracaoBruta ? Number(duracaoBruta) : null
  if (duracao !== null && !Number.isInteger(duracao)) return { erro: 'A duração é em minutos inteiros.', vez }

  const d: DadosHorario = {
    unidadeId: texto(form.get('unidadeId'), 64),
    colaboradorId: texto(form.get('colaboradorId'), 64),
    clienteId: clienteId || null,
    clienteNome: texto(form.get('clienteNome'), 200),
    telefone: texto(form.get('telefone'), 40),
    produtoId: produtoId || null,
    servico: texto(form.get('servico'), 200),
    dia: texto(form.get('dia'), 10),
    hora: texto(form.get('hora'), 5),
    duracaoMin: duracao,
    observacao: texto(form.get('observacao'), 600),
    confirmar: form.get('confirmar') === 'on',
  }

  try {
    const r = id ? await remarcarHorario(sessao, id, d) : await marcarHorario(sessao, d)
    if (!r.ok) return { erro: r.erro, pedeConfirmacao: r.pedeConfirmacao, vez }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode marcar horário nesta loja.', vez }
    return { erro: `Não deu para salvar. Tente de novo. (código ${registrarErro('agenda.salvar', e)})`, vez }
  }
  revalidatePath(`/${slug}/agenda`)
  return { ok: id ? 'Horário remarcado.' : 'Horário marcado.', vez }
}

export async function mudarHorarioAcao(slug: string, id: string, mudanca: MudancaAgenda): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(id)) return { erro: 'Horário inválido.' }
  if (!(await agendaLigada(sessao.orgId))) return { erro: DESLIGADA }
  const para = mudanca?.para
  const validas = ['CONFIRMADO', 'MARCADO', 'ATENDIDO', 'FALTOU', 'CANCELADO'] as const
  if (!validas.includes(para as (typeof validas)[number])) return { erro: 'Essa mudança não existe.' }
  const m: MudancaAgenda =
    para === 'CANCELADO' ? { para, motivo: texto((mudanca as { motivo?: unknown }).motivo, 400) } : { para: para as Exclude<typeof para, 'CANCELADO'> }
  try {
    const r = await mudarSituacaoAgenda(sessao, id, m)
    if (!r.ok) return { erro: r.erro }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer na agenda desta loja.' }
    return { erro: `Não deu para salvar. Tente de novo. (código ${registrarErro('agenda.situacao', e)})` }
  }
  revalidatePath(`/${slug}/agenda`)
  const recado: Record<string, string> = {
    CONFIRMADO: 'Confirmado.',
    MARCADO: 'Voltou para marcado.',
    ATENDIDO: 'Atendido.',
    FALTOU: 'Falta anotada.',
    CANCELADO: 'Horário desmarcado.',
  }
  return { ok: recado[para!] }
}

export async function buscarClientesAgendaAcao(slug: string, termo: string) {
  const sessao = await exigirSessao(slug)
  try {
    return await buscarClientesParaAgenda(sessao, texto(termo, 80))
  } catch (e) {
    if (e instanceof SemPermissao) return []
    throw e
  }
}
