// A mídia das campanhas no servidor: guardar, e entregar ao fornecedor do
// WhatsApp por um endereço assinado.
//
// ── o endereço ───────────────────────────────────────────────
// O fornecedor busca a foto sem cookie e sem sessão — ele não é ninguém da
// loja. Então o endereço carrega a própria autorização:
//
//   /api/midia/<id>/<assinatura>?org=<empresa>&exp=<quando vence>
//
// A assinatura é um HMAC de (empresa, id, vencimento) com uma chave que só o
// servidor tem. Trocar qualquer pedaço — outro id, outra empresa, um prazo
// maior — invalida a assinatura. Sem a chave não se fabrica endereço, e o id
// sozinho (um cuid) não abre nada. Vencido, não abre mais.
//
// A chave é DERIVADA do SEGREDO_SESSAO (com um rótulo próprio, então a chave
// da mídia não serve para assinar sessão nem o contrário). Uma variável a
// menos para esquecer na hospedagem; trocar o segredo da sessão invalida
// também os endereços de mídia ainda não buscados — que vencem em horas de
// qualquer jeito.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { comoOrg } from '../banco'
import { exigir, type Sessao } from '../permissao'
import { conferirArquivo } from './midia-regras'
import { exigirCampanhasLiberadas } from './acesso'

/** Quanto tempo o endereço vale. Folga para as novas tentativas do fornecedor. */
export const VALIDADE_MIDIA_MS = 24 * 3_600_000

function chave(): Buffer | null {
  const s = process.env.SEGREDO_SESSAO ?? ''
  if (s.length < 32) return null
  return createHmac('sha256', s).update('norte:midia:v1').digest()
}

export function assinarMidia(orgId: string, midiaId: string, exp: number, k: Buffer | null = chave()): string | null {
  if (!k) return null
  return createHmac('sha256', k).update(`${orgId}.${midiaId}.${exp}`).digest('base64url')
}

/** A assinatura confere e o prazo não venceu? Tempo constante. */
export function conferirAssinatura(
  p: { orgId: string; midiaId: string; exp: number; assinatura: string },
  agora: Date = new Date(),
  k: Buffer | null = chave(),
): boolean {
  if (!Number.isFinite(p.exp) || p.exp < agora.getTime()) return false
  // Prazo absurdo é endereço fabricado: nenhum sai daqui com mais que a validade.
  if (p.exp > agora.getTime() + VALIDADE_MIDIA_MS + 60_000) return false
  const esperada = assinarMidia(p.orgId, p.midiaId, p.exp, k)
  if (!esperada) return false
  const a = Buffer.from(esperada)
  const b = Buffer.from(p.assinatura)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** O endereço público do Norte, sem barra no fim — o mesmo NORTE_URL do relógio. */
export const baseDoSite = () => (process.env.NORTE_URL ?? '').trim().replace(/\/$/, '') || null

/** O endereço assinado da mídia, ou nulo sem base pública ou sem chave. */
export function urlDaMidia(orgId: string, midiaId: string, agora: Date = new Date(), base = baseDoSite()): string | null {
  if (!base) return null
  const exp = agora.getTime() + VALIDADE_MIDIA_MS
  const assinatura = assinarMidia(orgId, midiaId, exp)
  if (!assinatura) return null
  return `${base}/api/midia/${encodeURIComponent(midiaId)}/${assinatura}?org=${encodeURIComponent(orgId)}&exp=${exp}`
}

/**
 * O mesmo endereço assinado, relativo — para a PRÉVIA no editor, que abre no
 * próprio site e não precisa do NORTE_URL. Vale menos tempo: é só para a tela.
 */
export function caminhoDaMidia(orgId: string, midiaId: string, agora: Date = new Date()): string | null {
  const exp = agora.getTime() + 2 * 3_600_000
  const assinatura = assinarMidia(orgId, midiaId, exp)
  if (!assinatura) return null
  return `/api/midia/${encodeURIComponent(midiaId)}/${assinatura}?org=${encodeURIComponent(orgId)}&exp=${exp}`
}

export type MidiaSalva = { id: string; nome: string; tipo: 'imagem' | 'video' | 'audio'; tamanho: number }

/**
 * Guarda o arquivo que a loja subiu. O mesmo arquivo duas vezes vira uma
 * linha só (sha256 por empresa).
 */
export async function salvarMidia(sessao: Sessao, arquivo: { name: string; type: string; bytes: Uint8Array }): Promise<MidiaSalva> {
  exigir(sessao, 'agente.configurar')
  await exigirCampanhasLiberadas(sessao.orgId)
  const c = conferirArquivo(arquivo.type, arquivo.bytes.byteLength, arquivo.bytes.subarray(0, 16))
  if (!c.ok) throw new Error(c.erro)
  const sha256 = createHash('sha256').update(arquivo.bytes).digest('hex')
  const nome = (arquivo.name || 'arquivo').replace(/[\r\n]/g, ' ').slice(0, 120)
  return comoOrg(sessao.orgId, async (db) => {
    const ja = await db.midia.findUnique({
      where: { orgId_sha256: { orgId: sessao.orgId, sha256 } },
      select: { id: true, nome: true, tipo: true, tamanho: true },
    })
    if (ja) return ja as MidiaSalva
    const m = await db.midia.create({
      data: {
        orgId: sessao.orgId,
        nome,
        mime: arquivo.type,
        tipo: c.tipo,
        tamanho: arquivo.bytes.byteLength,
        sha256,
        dados: Buffer.from(arquivo.bytes),
      },
      select: { id: true, nome: true, tipo: true, tamanho: true },
    })
    return m as MidiaSalva
  })
}

/** Os bytes, para o endereço assinado. Quem chama já conferiu a assinatura. */
export async function lerMidia(orgId: string, midiaId: string) {
  return comoOrg(orgId, (db) =>
    db.midia.findUnique({ where: { id: midiaId }, select: { mime: true, dados: true, tamanho: true, sha256: true } }),
  )
}
