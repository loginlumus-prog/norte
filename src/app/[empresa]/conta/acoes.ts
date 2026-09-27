'use server'

import { after } from 'next/server'
import { acharOrgPorSlug } from '@/servidor/banco'
import { exigirSessao, recadoDoErro, SessaoExpirada } from '@/servidor/pagina'
import { abrirSessao } from '@/servidor/sessao'
import { avisarSenhaTrocada, trocarMinhaSenha } from '@/servidor/conta'
import { deOndeVeio, enderecoPublico } from '@/servidor/requisicao'

export type EstadoTroca = { erro?: string; ok?: string }

export async function trocarSenhaAcao(slug: string, _anterior: EstadoTroca, form: FormData): Promise<EstadoTroca> {
  let sessao
  try {
    sessao = await exigirSessao(slug)
  } catch (e) {
    if (e instanceof SessaoExpirada) return { erro: e.message }
    throw e
  }

  const atual = String(form.get('atual') ?? '')
  const nova = String(form.get('nova') ?? '')
  const repetida = String(form.get('repetida') ?? '')
  if (nova !== repetida) return { erro: 'As duas senhas novas não são iguais.' }

  try {
    const r = await trocarMinhaSenha(sessao, atual, nova, await deOndeVeio())
    if (!r.ok) return { erro: r.motivo }

    // A troca cortou TODAS as sessões desta pessoa — inclusive esta. Um
    // cookie novo, agora, mantém este aparelho dentro; os outros saem na
    // próxima tela que abrirem.
    await abrirSessao(slug, sessao)

    const org = await acharOrgPorSlug(slug)
    const base = await enderecoPublico()
    if (org && base) {
      const aviso = { para: r.email, nome: r.nome, empresa: org.nome, slug, base }
      after(async () => {
        await avisarSenhaTrocada(aviso)
      })
    }
    return { ok: 'Senha trocada. Se a conta estava aberta em outro aparelho, ele saiu.' }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para trocar a senha agora.') }
  }
}
