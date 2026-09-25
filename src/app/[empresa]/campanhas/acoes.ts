'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// Cada uma confere a sessão aqui e, lá dentro (src/servidor/campanhas/
// admin.ts), a permissão `agente.configurar`, o plano e o módulo. O que chega
// do navegador — o desenho inteiro da campanha, o arquivo — é limpo e
// conferido no servidor antes de gravar.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { acharOrgPorSlug } from '@/servidor/banco'
import { canalPara } from '@/servidor/assistente/canal'
import {
  apagarCampanha,
  ativarCampanha,
  criarCampanha,
  duplicarCampanha,
  removerContato,
  salvarAjustes,
  salvarCampanha,
  testarCampanha,
  type Salvamento,
} from '@/servidor/campanhas/admin'
import { caminhoDaMidia, salvarMidia, type MidiaSalva } from '@/servidor/campanhas/midia'
import { LIMITE } from '@/servidor/campanhas/midia-regras'
import type { Pendencia } from '@/servidor/campanhas/grafo'

export type Resposta = { ok?: string; erro?: string; pendencias?: Pendencia[] }

const falhou = (e: unknown, padrao = 'Não deu certo.'): Resposta => ({ erro: recadoDoErro(e, padrao) })

export async function criarAcao(slug: string, _antes: Resposta, form: FormData): Promise<Resposta> {
  let id: string
  try {
    const sessao = await exigirSessao(slug)
    id = await criarCampanha(sessao, String(form.get('nome') ?? ''))
  } catch (e) {
    return falhou(e, 'Não deu para criar a campanha.')
  }
  revalidatePath(`/${slug}/campanhas`)
  redirect(`/${slug}/campanhas/${id}`)
}

export async function duplicarAcao(slug: string, id: string): Promise<Resposta> {
  try {
    const sessao = await exigirSessao(slug)
    await duplicarCampanha(sessao, id)
  } catch (e) {
    return falhou(e)
  }
  revalidatePath(`/${slug}/campanhas`)
  return { ok: 'Cópia criada, pausada e sem frase.' }
}

export async function apagarAcao(slug: string, id: string): Promise<Resposta> {
  try {
    const sessao = await exigirSessao(slug)
    await apagarCampanha(sessao, id)
  } catch (e) {
    return falhou(e)
  }
  revalidatePath(`/${slug}/campanhas`)
  return { ok: 'Campanha apagada.' }
}

const deSalvamento = (r: Salvamento, ok: string): Resposta =>
  r.ok ? { ok, pendencias: r.pendencias } : { erro: r.erro, pendencias: r.pendencias }

export async function ativarAcao(slug: string, id: string, ativa: boolean): Promise<Resposta> {
  try {
    const sessao = await exigirSessao(slug)
    const r = await ativarCampanha(sessao, id, ativa)
    revalidatePath(`/${slug}/campanhas`)
    revalidatePath(`/${slug}/campanhas/${id}`)
    return deSalvamento(r, ativa ? 'Campanha ativa: quem escrever a frase já entra.' : 'Campanha pausada.')
  } catch (e) {
    return falhou(e)
  }
}

export async function salvarAcao(
  slug: string,
  id: string,
  dados: { nome: string; pasta: string | null; gatilho: unknown; grafo: unknown },
): Promise<Resposta> {
  try {
    const sessao = await exigirSessao(slug)
    const r = await salvarCampanha(sessao, id, dados)
    revalidatePath(`/${slug}/campanhas`)
    return deSalvamento(r, 'Salvo.')
  } catch (e) {
    return falhou(e, 'Não deu para salvar.')
  }
}

export async function testarAcao(slug: string, id: string): Promise<Resposta> {
  try {
    const sessao = await exigirSessao(slug)
    const empresa = await acharOrgPorSlug(slug)
    if (!empresa) return { erro: 'Empresa não encontrada.' }
    const canal = await canalPara({ id: empresa.id, slug: empresa.slug })
    const r = await testarCampanha(sessao, id, canal)
    revalidatePath(`/${slug}/campanhas/${id}`)
    if (!r.ok) return { erro: r.erro }
    return { ok: r.aviso ?? 'Teste começou: olhe o seu WhatsApp.' }
  } catch (e) {
    return falhou(e, 'Não deu para testar.')
  }
}

export async function removerAcao(slug: string, campanhaId: string, execucaoId: string): Promise<Resposta> {
  try {
    const sessao = await exigirSessao(slug)
    await removerContato(sessao, execucaoId)
  } catch (e) {
    return falhou(e)
  }
  revalidatePath(`/${slug}/campanhas/${campanhaId}`)
  revalidatePath(`/${slug}/campanhas`)
  return { ok: 'Contato tirado da campanha.' }
}

export async function ajustesAcao(slug: string, _antes: Resposta, form: FormData): Promise<Resposta> {
  try {
    const sessao = await exigirSessao(slug)
    await salvarAjustes(sessao, {
      porContatoDia: form.get('porContatoDia'),
      porEmpresaDia: form.get('porEmpresaDia'),
      intervaloSeg: form.get('intervaloSeg'),
    })
  } catch (e) {
    return falhou(e, 'Não deu para salvar os limites.')
  }
  revalidatePath(`/${slug}/campanhas`)
  return { ok: 'Limites salvos.' }
}

export type RespostaMidia = { erro?: string; midia?: MidiaSalva; previa?: string | null }

export async function subirMidiaAcao(slug: string, form: FormData): Promise<RespostaMidia> {
  try {
    const sessao = await exigirSessao(slug)
    const arquivo = form.get('arquivo')
    if (!(arquivo instanceof File)) return { erro: 'Escolha um arquivo.' }
    // Antes de ler os bytes: o teto maior (16 MB) já recusa o que nem cabe.
    if (arquivo.size > LIMITE.video) return { erro: 'Arquivo acima de 16 MB: o WhatsApp não aceita.' }
    const bytes = new Uint8Array(await arquivo.arrayBuffer())
    const midia = await salvarMidia(sessao, { name: arquivo.name, type: arquivo.type, bytes })
    return { midia, previa: caminhoDaMidia(sessao.orgId, midia.id) }
  } catch (e) {
    return falhou(e, 'Não deu para subir o arquivo.')
  }
}
