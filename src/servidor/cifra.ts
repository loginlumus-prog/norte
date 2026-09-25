// Segredo de cliente guardado no banco — cifrado, nunca em texto.
//
// O caso que fez isto existir: o token da instância Z-API de cada empresa.
// Com ele, qualquer um manda mensagem pelo WhatsApp da loja, em nome dela.
// Se o banco vazar (um backup esquecido, um print de consulta, um papel com
// permissão demais), o que vaza é texto cifrado — sem a chave, que mora SÓ
// no ambiente do servidor, não serve para nada.
//
// ── como ─────────────────────────────────────────────────────
// AES-256-GCM, do `node:crypto`, sem biblioteca de fora:
//   • IV aleatório de 12 bytes a cada cifragem (o mesmo token cifrado duas
//     vezes dá dois textos diferentes — nada de "iguais no banco = iguais");
//   • a etiqueta de autenticação do GCM recusa qualquer byte mexido;
//   • o CONTEXTO entra como dado autenticado (AAD): o token cifrado da
//     empresa A, copiado para a linha da B — ou do campo "token" para o campo
//     "client-token" —, não decifra. Quem mexe no banco não troca segredo de
//     lugar sem ser notado.
//
// Formato guardado:  v1.<iv>.<etiqueta>.<cifrado>   (base64url)
// O "v1" deixa trocar de esquema um dia sem adivinhar o que cada linha é.
//
// ── a chave ──────────────────────────────────────────────────
// NORTE_CIFRA: 32 bytes, em base64 (44 caracteres, com o "=" no fim) ou em
// hex (64 caracteres). Gerar:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Sem a chave, NADA é gravado: melhor recusar com um recado claro do que
// guardar o token em texto "só por enquanto". Perder a chave é perder os
// tokens guardados — a empresa cola de novo, do painel do Z-API. Trocar a
// chave tem o mesmo efeito; não há rotação automática nesta versão.
//
// Este arquivo é puro: não lê banco, e só lê o ambiente em `chaveDoAmbiente`.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSAO = 'v1'
const ALGORITMO = 'aes-256-gcm'

export class SemChaveDeCifra extends Error {
  constructor() {
    super(
      'O servidor ainda não tem a chave de cifra (NORTE_CIFRA) configurada, então não dá para guardar ' +
        'credenciais com segurança. Fale com o suporte do Norte.',
    )
    this.name = 'SemChaveDeCifra'
  }
}

/**
 * Lê a chave de um texto em base64/base64url (32 bytes) ou hex (64 dígitos).
 * Qualquer outra coisa é "sem chave" — chave curta não é chave.
 */
export function lerChave(valor: string | undefined | null): Buffer | null {
  const v = (valor ?? '').trim()
  if (!v) return null
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex')
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) {
    const b = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (b.length === 32) return b
  }
  return null
}

/** A chave deste servidor, ou nulo se NORTE_CIFRA falta ou está fora do formato. */
export const chaveDoAmbiente = (): Buffer | null => lerChave(process.env.NORTE_CIFRA)

export const temCifra = () => chaveDoAmbiente() !== null

/**
 * Cifra `texto` preso a um `contexto` (ex.: "agente:org-a:zapi_token").
 * Sem chave, lança `SemChaveDeCifra` — nunca devolve o texto aberto.
 */
export function cifrar(texto: string, contexto: string, chave: Buffer | null = chaveDoAmbiente()): string {
  if (!chave) throw new SemChaveDeCifra()
  const iv = randomBytes(12)
  const c = createCipheriv(ALGORITMO, chave, iv)
  c.setAAD(Buffer.from(contexto, 'utf8'))
  const cifrado = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  const etiqueta = c.getAuthTag()
  return [VERSAO, iv.toString('base64url'), etiqueta.toString('base64url'), cifrado.toString('base64url')].join('.')
}

/**
 * Abre o que `cifrar` guardou, no MESMO contexto.
 *
 * Devolve nulo — e não lança — quando não abre: chave errada, texto mexido,
 * contexto trocado, formato desconhecido. Quem chama trata como "sem
 * credencial"; o motivo exato não ajuda ninguém na tela e ajudaria quem
 * estivesse testando o que mexer. Sem chave nenhuma, também nulo.
 */
export function decifrar(guardado: string, contexto: string, chave: Buffer | null = chaveDoAmbiente()): string | null {
  if (!chave || typeof guardado !== 'string') return null
  const partes = guardado.split('.')
  if (partes.length !== 4 || partes[0] !== VERSAO) return null
  try {
    const [, iv64, etiqueta64, cifrado] = partes as [string, string, string, string]
    const iv = Buffer.from(iv64, 'base64url')
    const etiqueta = Buffer.from(etiqueta64, 'base64url')
    // Etiqueta do tamanho cheio, sempre: o GCM aceitaria uma cortada (4 bytes
    // já "valem" para o Node), e etiqueta curta é autenticação fraca.
    if (iv.length !== 12 || etiqueta.length !== 16) return null
    const d = createDecipheriv(ALGORITMO, chave, iv, { authTagLength: 16 })
    d.setAAD(Buffer.from(contexto, 'utf8'))
    d.setAuthTag(etiqueta)
    return Buffer.concat([d.update(Buffer.from(cifrado, 'base64url')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
