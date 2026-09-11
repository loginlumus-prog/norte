'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// `equipe.gerir` e `podeConceder` são exigidos dentro dos serviços.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { exigirSessao } from '@/servidor/pagina'
import { convidar, revogarConvite, EmailJaUsado } from '@/servidor/convite'
import { mudarAcesso, mudarSituacao } from '@/servidor/equipe'
import { salvarMeta, mesValido } from '@/servidor/metas'
import { SemPermissao, type Papel } from '@/servidor/permissao'

export async function salvarMetaAcao(
  slug: string,
  m: { usuarioId: string; mes: string; valor: number; comissaoPct: number },
): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  if (!mesValido(m.mes)) return { erro: 'Mês inválido.' }
  if (!Number.isFinite(m.valor) || m.valor < 0) return { erro: 'A meta é um valor em reais, zero ou mais.' }
  if (!Number.isFinite(m.comissaoPct) || m.comissaoPct < 0 || m.comissaoPct > 50) {
    return { erro: 'A comissão é uma porcentagem entre 0 e 50.' }
  }
  try {
    await salvarMeta(sessao, m)
    revalidatePath(`/${slug}/equipe`)
    revalidatePath(`/${slug}`)
    return { ok: 'Salvo.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode definir metas.' }
    return { erro: e instanceof Error ? e.message : 'Não deu para salvar.' }
  }
}

export type EstadoEquipe = { erro?: string; ok?: string; link?: string }

const PAPEIS: Papel[] = ['DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR']

/**
 * A base do link do convite.
 *
 * Sai dos cabeçalhos da requisição, não de variável de ambiente: o mesmo
 * código serve o domínio de produção, o de teste e o localhost, e um link de
 * convite que aponta para o lugar errado é um convite que ninguém aceita.
 */
async function baseDoSite(slug: string): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const protocolo = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protocolo}://${host}/${slug}`
}

export async function convidarPessoa(
  slug: string,
  _anterior: EstadoEquipe,
  form: FormData,
): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)

  const email = String(form.get('email') ?? '').trim()
  if (!email.includes('@')) return { erro: 'Informe um e-mail válido.' }

  const papelBruto = String(form.get('papel') ?? '') as Papel
  if (!PAPEIS.includes(papelBruto)) return { erro: 'Escolha um papel.' }

  const unidadeId = String(form.get('unidadeId') ?? '') || null

  try {
    const c = await convidar(sessao, { email, papel: papelBruto, unidadeId }, await baseDoSite(slug))
    revalidatePath(`/${slug}/equipe`)
    // O link aparece UMA vez. Ele não fica guardado em lugar nenhum que dê
    // para recuperar — o banco só tem o resumo dele.
    return { ok: `Convite criado para ${c.email}. Mande este link para ela:`, link: c.link }
  } catch (e) {
    if (e instanceof EmailJaUsado) return { erro: e.message }
    if (e instanceof SemPermissao) return { erro: 'Você não pode convidar para esse papel.' }
    return { erro: e instanceof Error ? e.message : 'Não deu para convidar.' }
  }
}

export async function revogar(slug: string, conviteId: string): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  try {
    await revogarConvite(sessao, conviteId)
    revalidatePath(`/${slug}/equipe`)
    return { ok: 'Convite cancelado.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode cancelar convite.' }
    return { erro: 'Não deu para cancelar.' }
  }
}

export async function trocarPapel(
  slug: string,
  usuarioId: string,
  papel: string,
  unidadeId: string | null,
): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  if (!PAPEIS.includes(papel as Papel)) return { erro: 'Papel inválido.' }

  try {
    const r = await mudarAcesso(sessao, usuarioId, { papel: papel as Papel, unidadeId })
    if (!r.ok) return { erro: r.motivo }
    revalidatePath(`/${slug}/equipe`)
    return { ok: 'Acesso alterado. A pessoa vai precisar entrar de novo.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer nesse acesso.' }
    return { erro: e instanceof Error ? e.message : 'Não deu para alterar.' }
  }
}

export async function trocarSituacao(
  slug: string,
  usuarioId: string,
  ativo: boolean,
): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await mudarSituacao(sessao, usuarioId, ativo)
    if (!r.ok) return { erro: r.motivo }
    revalidatePath(`/${slug}/equipe`)
    return { ok: ativo ? 'Acesso devolvido.' : 'Acesso tirado. Ela sai do sistema na próxima tela.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer nesse acesso.' }
    return { erro: e instanceof Error ? e.message : 'Não deu para alterar.' }
  }
}
