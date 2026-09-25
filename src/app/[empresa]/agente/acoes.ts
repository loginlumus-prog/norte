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
  acompanharQr,
  apagarLinhaZapi,
  conectarCanal,
  conectarPeloQr,
  desconectarPeloQr,
  desconectarCanal,
  gerarEnderecoDoWebhook,
  mensagemDeTeste,
  salvarGatilhos,
  salvarLinhaZapi,
  ROTINAS_NA_TELA,
  type QrNaTela,
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

/** Gera o endereço próprio — ou troca, se já havia. O anterior para de valer na hora. */
export async function gerarEndereco(slug: string): Promise<EstadoConexaoAcao> {
  try {
    const sessao = await exigirSessao(slug)
    const r = await gerarEnderecoDoWebhook(sessao, await baseDoSite())
    revalidatePath(`/${slug}/agente`)
    // O endereço volta UMA vez, nesta resposta. A página não o imprime, e o
    // banco só tem o resumo: não há como mostrar de novo.
    if (!r.ok) return { erro: r.erro }
    return {
      ok: r.trocou
        ? 'Endereço trocado. O anterior já não abre: cole este no Z-API, em "Ao receber", agora.'
        : 'Conectado. Cole este endereço no Z-API, em "Ao receber":',
      endereco: r.endereco,
    }
  } catch (e) {
    return { erro: mensagem(e) }
  }
}

/** Reabre a porta com o endereço que já está no Z-API (depois de desconectar). */
export async function conectar(slug: string): Promise<EstadoConexaoAcao> {
  try {
    const r = await conectarCanal(await exigirSessao(slug))
    revalidatePath(`/${slug}/agente`)
    return r.ok ? { ok: 'Conectado de novo, com o mesmo endereço que já está no Z-API.' } : { erro: r.erro }
  } catch (e) {
    return { erro: mensagem(e) }
  }
}

/**
 * Guarda a linha própria do Z-API. Os tokens entram por aqui e não voltam:
 * a resposta é só "guardado" ou o erro, nunca o que foi colado.
 */
export async function salvarLinha(slug: string, form: FormData): Promise<EstadoConexaoAcao> {
  try {
    const r = await salvarLinhaZapi(await exigirSessao(slug), {
      instancia: String(form.get('instancia') ?? ''),
      token: String(form.get('token') ?? ''),
      clientToken: String(form.get('clientToken') ?? ''),
    })
    revalidatePath(`/${slug}/agente`)
    return r.ok ? { ok: 'Linha do WhatsApp guardada. Mande a mensagem de teste para conferir.' } : { erro: r.erro }
  } catch (e) {
    return { erro: mensagem(e) }
  }
}

export async function apagarLinha(slug: string): Promise<EstadoConexaoAcao> {
  try {
    await apagarLinhaZapi(await exigirSessao(slug))
    revalidatePath(`/${slug}/agente`)
    return { ok: 'Linha do WhatsApp removida desta conta.' }
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

// ── o WhatsApp pelo QR Code ──────────────────────────────────
// A tela chama `verQr` a cada 2–3 s enquanto espera o celular ler. Cada
// chamada confere a sessão e `agente.configurar` (lá dentro): o QR é a
// chave do WhatsApp da loja por um minuto, e só quem configura o assistente
// vê. `revalidatePath` só quando o canal mudou — a consulta repetida não
// redesenha a página inteira à toa.

export type QrAcao = QrNaTela | { erro: string }

export async function conectarQr(slug: string): Promise<QrAcao> {
  try {
    const r = await conectarPeloQr(await exigirSessao(slug))
    if (r.mudou) revalidatePath(`/${slug}/agente`)
    return r
  } catch (e) {
    return { erro: mensagem(e) }
  }
}

export async function verQr(slug: string): Promise<QrAcao> {
  try {
    const r = await acompanharQr(await exigirSessao(slug))
    if (r.mudou) revalidatePath(`/${slug}/agente`)
    return r
  } catch (e) {
    return { erro: mensagem(e) }
  }
}

export async function desconectarQr(slug: string): Promise<EstadoConexaoAcao> {
  try {
    const r = await desconectarPeloQr(await exigirSessao(slug))
    revalidatePath(`/${slug}/agente`)
    if (!r.ok) return { erro: r.erro }
    return { ok: r.aviso ?? 'Desconectado. O Norte saiu dos aparelhos conectados deste WhatsApp.' }
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
