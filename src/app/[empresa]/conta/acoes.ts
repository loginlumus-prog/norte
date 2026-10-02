'use server'

import { after } from 'next/server'
import { acharOrgPorSlug } from '@/servidor/banco'
import { exigirSessao, recadoDoErro, SessaoExpirada } from '@/servidor/pagina'
import { abrirSessao } from '@/servidor/sessao'
import { avisarSenhaTrocada, trocarMinhaSenha } from '@/servidor/conta'
import { mudarMeuNome, mudarTelefone } from '@/servidor/equipe'
import { confirmarNaTela, pedirCodigo } from '@/servidor/assistente/confirmacao'
import { revalidatePath } from 'next/cache'
import { deOndeVeio, enderecoPublico } from '@/servidor/requisicao'
import { definirMeuPin, tirarMeuPin } from '@/servidor/autorizacao'

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

export type EstadoNome = { erro?: string; ok?: string; nome?: string }

/**
 * Trocar o próprio nome. O cookie leva o nome (é ele que vai para o livro
 * como "quem fez"), então sai um cookie novo com o nome novo — preso à mesma
 * vaga, sem derrubar ninguém.
 */
export async function trocarNomeAcao(slug: string, _anterior: EstadoNome, form: FormData): Promise<EstadoNome> {
  const digitado = String(form.get('nome') ?? '')
  let sessao
  try {
    sessao = await exigirSessao(slug)
  } catch (e) {
    if (e instanceof SessaoExpirada) return { erro: e.message, nome: digitado }
    throw e
  }
  try {
    const r = await mudarMeuNome(sessao, digitado)
    if (!r.ok) return { erro: r.motivo, nome: digitado }
    if (r.nome && r.nome !== sessao.nome) await abrirSessao(slug, { ...sessao, nome: r.nome })
    revalidatePath(`/${slug}`, 'layout')
    return { ok: 'Nome salvo.', nome: r.nome }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para salvar o nome agora.'), nome: digitado }
  }
}

// ─────────────────────────────────────────────────────────────
// MEU WHATSAPP
// ─────────────────────────────────────────────────────────────
//
// O telefone é o que faz o assistente reconhecer a pessoa no WhatsApp — e só
// depois de ELA confirmar que o número é dela (ver
// servidor/assistente/confirmacao.ts). Aqui cada um cuida do próprio: salvar,
// pedir o código, digitar o código.

export type EstadoWhatsApp = {
  erro?: string
  ok?: string
  /** O código foi mandado pelo WhatsApp: a tela abre o campo para digitar. */
  esperando?: boolean
  /** O código para a pessoa mandar do celular ("CONFIRMAR 123456"). */
  mostrar?: { codigo: string; numeroDaLoja: string | null }
  /** Não deu para mandar: a tela oferece o outro caminho. */
  oferecerMostrar?: boolean
  telefone?: string
}

export async function salvarMeuTelefoneAcao(slug: string, _anterior: EstadoWhatsApp, form: FormData): Promise<EstadoWhatsApp> {
  const digitado = String(form.get('telefone') ?? '').slice(0, 30)
  let sessao
  try {
    sessao = await exigirSessao(slug)
  } catch (e) {
    if (e instanceof SessaoExpirada) return { erro: e.message, telefone: digitado }
    throw e
  }
  try {
    const r = await mudarTelefone(sessao, sessao.usuarioId, digitado)
    if (!r.ok) return { erro: r.motivo, telefone: digitado }
    revalidatePath(`/${slug}/conta`)
    revalidatePath(`/${slug}/equipe`)
    if (!digitado.trim()) return { ok: 'Telefone apagado.' }
    return { ok: r.faltaConfirmar ? 'Telefone salvo. Agora confirme, logo abaixo.' : 'Telefone salvo.' }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para salvar o telefone agora.'), telefone: digitado }
  }
}

export async function pedirCodigoAcao(slug: string, modo: 'enviar' | 'mostrar'): Promise<EstadoWhatsApp> {
  let sessao
  try {
    sessao = await exigirSessao(slug)
  } catch (e) {
    if (e instanceof SessaoExpirada) return { erro: e.message }
    throw e
  }
  try {
    const r = await pedirCodigo(sessao, modo === 'mostrar' ? 'mostrar' : 'enviar')
    if (!r.ok) return { erro: r.erro, oferecerMostrar: r.oferecerMostrar }
    if (r.modo === 'mostrar') return { mostrar: { codigo: r.codigo, numeroDaLoja: r.numeroDaLoja } }
    return { ok: `Código enviado para o WhatsApp ${r.para}. Ele vale por 10 minutos.`, esperando: true }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para pedir o código agora.') }
  }
}

export async function confirmarCodigoAcao(slug: string, _anterior: EstadoWhatsApp, form: FormData): Promise<EstadoWhatsApp> {
  let sessao
  try {
    sessao = await exigirSessao(slug)
  } catch (e) {
    if (e instanceof SessaoExpirada) return { erro: e.message, esperando: true }
    throw e
  }
  try {
    const r = await confirmarNaTela(sessao, String(form.get('codigo') ?? '').slice(0, 20))
    if (!r.ok) return { erro: r.erro, esperando: true }
    revalidatePath(`/${slug}/conta`)
    revalidatePath(`/${slug}/equipe`)
    revalidatePath(`/${slug}/agente`)
    return { ok: 'WhatsApp confirmado. O assistente já reconhece você por ele.' }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para confirmar agora.'), esperando: true }
  }
}

// ─────────────────────────────────────────────────────────────
// MEU PIN (autorizar no balcão — ver servidor/autorizacao.ts)
// ─────────────────────────────────────────────────────────────

export type EstadoPin = { erro?: string; ok?: string }

export async function definirPinAcao(slug: string, _anterior: EstadoPin, form: FormData): Promise<EstadoPin> {
  let sessao
  try {
    sessao = await exigirSessao(slug)
  } catch (e) {
    if (e instanceof SessaoExpirada) return { erro: e.message }
    throw e
  }
  if (form.get('tirar') != null) {
    try {
      await tirarMeuPin(sessao)
      revalidatePath(`/${slug}/conta`)
      return { ok: 'PIN apagado. Ninguém autoriza nada com ele daqui em diante.' }
    } catch (e) {
      return { erro: recadoDoErro(e, 'Não deu para apagar o PIN agora.') }
    }
  }
  const pin = String(form.get('pin') ?? '').trim()
  const repetido = String(form.get('repetido') ?? '').trim()
  if (pin !== repetido) return { erro: 'Os dois PINs não são iguais.' }
  try {
    const r = await definirMeuPin(sessao, String(form.get('senha') ?? ''), pin)
    if (!r.ok) return { erro: r.erro }
    revalidatePath(`/${slug}/conta`)
    return { ok: 'PIN salvo. Use no balcão para confirmar as suas vendas (e autorizar, se o seu papel permite).' }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para salvar o PIN agora.') }
  }
}
