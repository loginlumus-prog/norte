// O que entra como mídia de campanha. PURO — a tela usa as mesmas regras
// para avisar ANTES de subir 16 MB à toa.
//
// Os tetos são os do WhatsApp: imagem até 5 MB, áudio e vídeo até 16 MB.
// Acima disso o fornecedor recusa, e a recusa chega tarde — na hora de
// mandar para o cliente, não na hora de subir o arquivo.
//
// O tipo é conferido pelos PRIMEIROS BYTES, não só pelo nome ou pelo que o
// navegador disse: o arquivo é servido de volta com o tipo que foi gravado,
// e um "foto.jpg" que é outra coisa não entra.

import type { TipoMidia } from './tipos'

export const MB = 1024 * 1024

export const LIMITE: Record<TipoMidia, number> = {
  imagem: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
}

export const MIMES: Record<string, TipoMidia> = {
  'image/jpeg': 'imagem',
  'image/png': 'imagem',
  'image/webp': 'imagem',
  'video/mp4': 'video',
  'video/3gpp': 'video',
  'audio/ogg': 'audio',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/aac': 'audio',
  'audio/amr': 'audio',
}

/** Para o `accept` do campo de arquivo. */
export const ACEITA = Object.keys(MIMES).join(',')

const comeca = (b: Uint8Array, ...sig: number[]) => sig.every((v, i) => b[i] === v)
const texto = (b: Uint8Array, de: number, s: string) => [...s].every((c, i) => b[de + i] === c.charCodeAt(0))

/** Os primeiros bytes batem com o tipo declarado? */
export function assinaturaBate(mime: string, b: Uint8Array): boolean {
  switch (mime) {
    case 'image/jpeg':
      return comeca(b, 0xff, 0xd8, 0xff)
    case 'image/png':
      return comeca(b, 0x89, 0x50, 0x4e, 0x47)
    case 'image/webp':
      return texto(b, 0, 'RIFF') && texto(b, 8, 'WEBP')
    case 'video/mp4':
    case 'video/3gpp':
    case 'audio/mp4':
      return texto(b, 4, 'ftyp')
    case 'audio/ogg':
      return texto(b, 0, 'OggS')
    case 'audio/mpeg':
      return texto(b, 0, 'ID3') || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)
    case 'audio/aac':
      return b[0] === 0xff && ((b[1] ?? 0) & 0xf0) === 0xf0
    case 'audio/amr':
      return texto(b, 0, '#!AMR')
    default:
      return false
  }
}

export type Conferencia = { ok: true; tipo: TipoMidia } | { ok: false; erro: string }

/** O arquivo pode entrar? A frase de erro vai direto para a tela. */
export function conferirArquivo(mime: string, tamanho: number, inicio?: Uint8Array): Conferencia {
  const tipo = MIMES[mime]
  if (!tipo) return { ok: false, erro: 'Esse tipo de arquivo não vai pelo WhatsApp. Use JPG, PNG ou WEBP; MP4; ou áudio OGG, MP3, M4A, AAC ou AMR.' }
  if (tamanho <= 0) return { ok: false, erro: 'O arquivo está vazio.' }
  if (tamanho > LIMITE[tipo]) {
    const nome = tipo === 'imagem' ? 'Imagem' : tipo === 'video' ? 'Vídeo' : 'Áudio'
    return { ok: false, erro: `${nome} até ${LIMITE[tipo] / MB} MB. Este tem ${(tamanho / MB).toFixed(1).replace('.', ',')} MB.` }
  }
  if (inicio && !assinaturaBate(mime, inicio)) return { ok: false, erro: 'O conteúdo do arquivo não é do tipo que o nome diz.' }
  return { ok: true, tipo }
}
