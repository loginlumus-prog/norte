'use server'

// Server Action é endereço público — ver `balcao/acoes.ts`. Aqui se confere a
// forma do que veio e o MÓDULO; quem pode o quê, por pessoa e por loja, é de
// `servidor/ponto.ts`.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { moduloLigado, type Modulo } from '@/servidor/modulos'
import { planoLibera } from '@/servidor/planos'
import { ajustarPonto, anularBatida, baterPonto, lerJornada, salvarColaborador } from '@/servidor/ponto'
import { registrarErro } from '@/servidor/registro'

export type EstadoFicha = { erro?: string; ok?: string; vez?: number }

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

/** Algum destes módulos está ligado (e no plano)? */
async function ligado(orgId: string, ...modulos: Modulo[]): Promise<boolean> {
  const org = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { plano: true, modulos: true } }))
  return !!org && modulos.some((m) => moduloLigado(org, m) && planoLibera(org.plano, m))
}

const SEM_PONTO = 'O Ponto está desligado nesta empresa. Quem responde pela empresa liga em Configurações.'

export async function salvarColaboradorAcao(slug: string, anterior: EstadoFicha, form: FormData): Promise<EstadoFicha> {
  const sessao = await exigirSessao(slug)
  const vez = (anterior.vez ?? 0) + 1
  if (!(await ligado(sessao.orgId, 'ponto', 'agenda'))) return { erro: 'Ligue a Agenda ou o Ponto em Configurações.', vez }
  const id = texto(form.get('id'), 64)
  if (id && !idValido(id)) return { erro: 'Ficha inválida.', vez }
  const jornada = lerJornada([0, 1, 2, 3, 4, 5, 6].map((d) => texto(form.get(`jornada_${d}`), 6)))
  if (!jornada.ok) return { erro: jornada.erro, vez }
  const unidadeId = texto(form.get('unidadeId'), 64)
  const usuarioId = texto(form.get('usuarioId'), 64)
  if ((unidadeId && !idValido(unidadeId)) || (usuarioId && !idValido(usuarioId))) return { erro: 'Dados inválidos.', vez }
  try {
    const r = await salvarColaborador(
      sessao,
      {
        nome: texto(form.get('nome'), 100),
        cargo: texto(form.get('cargo'), 80),
        telefone: texto(form.get('telefone'), 30),
        unidadeId: unidadeId || null,
        usuarioId: usuarioId || null,
        atende: form.get('atende') === 'on',
        jornadaMin: jornada.jornada,
        ativo: id ? form.get('ativo') === 'on' : undefined,
      },
      id || undefined,
    )
    if (!r.ok) return { erro: r.erro, vez }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer na ficha desta pessoa.', vez }
    return { erro: `Não deu para salvar. Tente de novo. (código ${registrarErro('colaborador.salvar', e)})`, vez }
  }
  revalidatePath(`/${slug}/funcionarios`)
  revalidatePath(`/${slug}/agenda`)
  return { ok: id ? 'Ficha salva.' : 'Pessoa cadastrada.', vez }
}

export async function baterPontoAcao(slug: string, colaboradorId: string, esperado: string): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(colaboradorId)) return { erro: 'Pessoa inválida.' }
  if (esperado !== 'ENTRADA' && esperado !== 'SAIDA') return { erro: 'Batida inválida.' }
  if (!(await ligado(sessao.orgId, 'ponto'))) return { erro: SEM_PONTO }
  try {
    const r = await baterPonto(sessao, { colaboradorId, esperado })
    if (!r.ok) return { erro: r.erro }
    revalidatePath(`/${slug}/funcionarios`)
    const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(r.em)
    return { ok: `${r.tipo === 'ENTRADA' ? 'Entrada' : 'Saída'} às ${hora}.` }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode bater o ponto desta pessoa.' }
    return { erro: `Não deu para bater o ponto. Tente de novo. (código ${registrarErro('ponto.bater', e)})` }
  }
}

export async function ajustarPontoAcao(slug: string, anterior: EstadoFicha, form: FormData): Promise<EstadoFicha> {
  const sessao = await exigirSessao(slug)
  const vez = (anterior.vez ?? 0) + 1
  if (!(await ligado(sessao.orgId, 'ponto'))) return { erro: SEM_PONTO, vez }
  const colaboradorId = texto(form.get('colaboradorId'), 64)
  if (!idValido(colaboradorId)) return { erro: 'Pessoa inválida.', vez }
  const tipo = texto(form.get('tipo'), 10)
  if (tipo !== 'ENTRADA' && tipo !== 'SAIDA') return { erro: 'Escolha entrada ou saída.', vez }
  try {
    const r = await ajustarPonto(sessao, {
      colaboradorId,
      tipo,
      dia: texto(form.get('dia'), 10),
      hora: texto(form.get('hora'), 5),
      motivo: texto(form.get('motivo'), 400),
    })
    if (!r.ok) return { erro: r.erro, vez }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode ajustar o ponto desta pessoa.', vez }
    return { erro: `Não deu para salvar. Tente de novo. (código ${registrarErro('ponto.ajustar', e)})`, vez }
  }
  revalidatePath(`/${slug}/funcionarios`)
  return { ok: 'Ajuste lançado. Ele aparece na folha como ajuste, com o motivo.', vez }
}

export async function anularBatidaAcao(slug: string, registroId: string, motivo: string): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(registroId)) return { erro: 'Batida inválida.' }
  if (!(await ligado(sessao.orgId, 'ponto'))) return { erro: SEM_PONTO }
  try {
    const r = await anularBatida(sessao, registroId, texto(motivo, 400))
    if (!r.ok) return { erro: r.erro }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode anular o ponto desta pessoa.' }
    return { erro: `Não deu para anular. Tente de novo. (código ${registrarErro('ponto.anular', e)})` }
  }
  revalidatePath(`/${slug}/funcionarios`)
  return { ok: 'Batida anulada. Ela continua na folha, riscada, com o motivo.' }
}
