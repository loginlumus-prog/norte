'use server'

// A parte Escola da ficha do aluno: o responsável. Server Action é endereço
// público — a forma do que veio se confere aqui; quem pode, e o módulo, em
// `servidor/escola.ts`.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { salvarResponsavel } from '@/servidor/escola'
import { registrarErro } from '@/servidor/registro'

export type EstadoResponsavel = { erro?: string; ok?: string; vez?: number }

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')

export async function salvarResponsavelAcao(slug: string, alunoId: string, anterior: EstadoResponsavel, form: FormData): Promise<EstadoResponsavel> {
  const sessao = await exigirSessao(slug)
  const vez = (anterior.vez ?? 0) + 1
  if (!/^[\w-]{1,64}$/.test(alunoId)) return { erro: 'Ficha inválida.', vez }
  const aviso = texto(form.get('avisos'), 3)
  const avisos = aviso === 'SIM' || aviso === 'NAO' ? { valor: aviso as 'SIM' | 'NAO', origem: texto(form.get('avisosOrigem'), 20) || null } : null
  try {
    const r = await salvarResponsavel(sessao, alunoId, {
      nome: texto(form.get('nome'), 120),
      parentesco: texto(form.get('parentesco'), 40),
      telefone: texto(form.get('telefone'), 30),
      email: texto(form.get('email'), 160),
      documento: texto(form.get('documento'), 20),
      avisos,
    })
    if (!r.ok) return { erro: r.erro, vez }
    revalidatePath(`/${slug}/clientes/${alunoId}`)
    return { ok: 'Responsável salvo.', vez }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não anota responsável.', vez }
    return { erro: `Não deu para salvar. Tente de novo. (código ${registrarErro('responsavel.salvar', e)})`, vez }
  }
}
