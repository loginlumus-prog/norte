'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// `salvarAgente` exige `agente.configurar` lá dentro, e filtra os poderes
// contra a lista fechada antes de gravar: o que chega do formulário vem do
// navegador, e o navegador é do usuário.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import type { TipoGatilho } from '@prisma/client'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { salvarAgente, responderProposta } from '@/servidor/agente'
import { TODOS_PODERES } from '@/servidor/poderes'
import { centavos } from '@/servidor/dinheiro'
import { acharOrgPorSlug } from '@/servidor/banco'
import {
  conectarCanal,
  desconectarCanal,
  mensagemDeTeste,
  salvarGatilhos,
  ROTINAS_NA_TELA,
} from '@/servidor/assistente/conexao'

export type EstadoAgente = { erro?: string; ok?: string }

const num = (f: FormData, k: string, padrao: number) => {
  const v = Number(String(f.get(k) ?? '').replace(',', '.'))
  return Number.isFinite(v) && v >= 0 ? v : padrao
}

export async function salvar(
  slug: string,
  _anterior: EstadoAgente,
  form: FormData,
): Promise<EstadoAgente> {
  const sessao = await exigirSessao(slug)

  const nome = String(form.get('nome') ?? '').trim()
  if (!nome) return { erro: 'O assistente precisa de um nome.' }
  if (nome.length > 40) return { erro: 'Um nome de até 40 letras.' }

  try {
    await salvarAgente(sessao, {
      nome,
      personalidade: String(form.get('personalidade') ?? ''),
      saudacao: String(form.get('saudacao') ?? ''),
      manual: String(form.get('manual') ?? ''),
      poderes: TODOS_PODERES.filter((p) => form.get(`poder_${p}`) === 'on'),
      descontoMaxPct: num(form, 'descontoMaxPct', 5),
      valorMaxCent: centavos(num(form, 'valorMax', 500)),
      gastoDiaCent: centavos(num(form, 'gastoDia', 10)),
      mensagensDia: Math.round(num(form, 'mensagensDia', 300)),
      ativo: form.get('ativo') === 'on',
    })
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para salvar.') }
  }

  revalidatePath(`/${slug}/agente`)
  return { ok: 'Salvo.' }
}

/** Confirmar ou recusar uma proposta pela tela. Pelo WhatsApp é o mesmo caminho. */
export async function responder(slug: string, propostaId: string, aceita: boolean) {
  const sessao = await exigirSessao(slug)
  const empresa = await acharOrgPorSlug(slug)
  if (!empresa) return { ok: false as const, motivo: 'nao_existe' as const }

  const r = await responderProposta(sessao, empresa, propostaId, aceita)
  revalidatePath(`/${slug}/agente`)
  return r
}

// ─────────────────────────────────────────────────────────────
// CONEXÃO — as regras moram em src/servidor/assistente/conexao.ts, e cada
// uma confere `agente.configurar` lá dentro.
// ─────────────────────────────────────────────────────────────

export type EstadoConexaoAcao = { erro?: string; ok?: string; endereco?: string }

/**
 * A base do endereço do webhook, dos cabeçalhos da requisição — o mesmo
 * motivo do link de convite: o código serve produção, teste e localhost.
 * Sem o slug no fim: o webhook mora em /api, fora da empresa.
 */
async function baseDoSite(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const protocolo = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protocolo}://${host}`
}

const mensagem = (e: unknown) => recadoDoErro(e, 'Não deu certo.')

export async function conectar(slug: string): Promise<EstadoConexaoAcao> {
  try {
    const sessao = await exigirSessao(slug)
    const r = await conectarCanal(sessao, await baseDoSite(), slug)
    revalidatePath(`/${slug}/agente`)
    // O endereço volta UMA vez, nesta resposta. A página não o imprime.
    return r.ok
      ? { ok: 'Conectado. Cole este endereço no Z-API, em "Ao receber":', endereco: r.endereco }
      : { erro: r.erro }
  } catch (e) {
    return { erro: mensagem(e) }
  }
}

export async function desconectar(slug: string): Promise<EstadoConexaoAcao> {
  try {
    await desconectarCanal(await exigirSessao(slug))
    revalidatePath(`/${slug}/agente`)
    return { ok: 'Desconectado. O que chegar pelo webhook agora é descartado.' }
  } catch (e) {
    return { erro: mensagem(e) }
  }
}

export async function testar(slug: string): Promise<EstadoConexaoAcao> {
  try {
    const r = await mensagemDeTeste(await exigirSessao(slug))
    revalidatePath(`/${slug}/agente`)
    return r.ok ? { ok: r.recado } : { erro: r.erro }
  } catch (e) {
    return { erro: mensagem(e) }
  }
}

export async function salvarRotinas(
  slug: string,
  _anterior: EstadoAgente,
  form: FormData,
): Promise<EstadoAgente> {
  try {
    const sessao = await exigirSessao(slug)
    await salvarGatilhos(
      sessao,
      ROTINAS_NA_TELA.map((r) => ({
        tipo: r.tipo as TipoGatilho,
        ativo: form.get(`rotina_${r.tipo}`) === 'on',
        dias: r.tipo === 'CLIENTE_SUMIDO' ? num(form, 'dias_CLIENTE_SUMIDO', 45) : null,
      })),
    )
  } catch (e) {
    return { erro: mensagem(e) }
  }
  revalidatePath(`/${slug}/agente`)
  return { ok: 'Rotinas salvas.' }
}
