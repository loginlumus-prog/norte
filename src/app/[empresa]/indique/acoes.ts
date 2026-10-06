'use server'

// SERVER ACTION É ENDEREÇO PÚBLICO — a checagem inteira acontece aqui.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { exigir, exigirQueNaoSejaSuporte, SemPermissao } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { ativarParceiroDaEmpresa, parceiroDaEmpresa, sessaoDoParceiroVale } from '@/servidor/parceiros'
import { abrirSessaoParceiro } from '@/servidor/sessao-parceiro'
import { deOndeVeio } from '@/servidor/requisicao'
import { recadoDoErro } from '@/servidor/pagina'

export type EstadoIndique = { erro?: string }

async function dono(slug: string) {
  const s = await exigirSessao(slug)
  try {
    exigir(s, 'empresa.configurar')
    exigirQueNaoSejaSuporte(s, 'ativa o programa de parceiros')
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: e.message } as const
    throw e
  }
  return { s } as const
}

export async function ativarAcao(slug: string, _: EstadoIndique, f: FormData): Promise<EstadoIndique> {
  const d = await dono(slug)
  if ('erro' in d) return { erro: d.erro }
  if (f.get('aceite') !== 'on') return { erro: 'Para ativar, aceite os termos do programa de parceiros.' }
  const u = await comoOrg(d.s.orgId, (db) => db.usuario.findUnique({ where: { id: d.s.usuarioId }, select: { nome: true, email: true } }))
  if (!u) return { erro: 'Não achamos a sua conta. Entre de novo.' }
  try {
    const r = await ativarParceiroDaEmpresa(d.s.orgId, u, String(f.get('senha') ?? ''), await deOndeVeio())
    if (!r.ok) return { erro: r.recado }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para ativar agora. Tente de novo em alguns minutos.') }
  }
  revalidatePath(`/${slug}/indique`)
  return {}
}

/** Quem é dono da empresa já está dentro: abre o painel completo sem pedir a senha de novo. */
export async function abrirPainelAcao(slug: string) {
  const d = await dono(slug)
  if ('erro' in d) redirect(`/${slug}/indique`)
  const id = await parceiroDaEmpresa(d.s.orgId)
  if (!id || !(await sessaoDoParceiroVale(id, new Date()))) redirect(`/${slug}/indique`)
  await abrirSessaoParceiro(id)
  redirect('/parceiros/painel')
}
