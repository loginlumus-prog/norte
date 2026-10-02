// A cor e a sigla da loja na vitrine pública (catálogo e acompanhar pedido).
//
// A cor vem do cadastro da empresa e só entra se for um #rrggbb de verdade —
// é texto digitado por gente, e vai parar dentro de um `style`. Sem ela, fica
// a cor do sistema. Os tons derivados (fundo suave, texto, botão) saem por
// `color-mix` contra a superfície e a tinta do tema: assim o mesmo rosa vira
// um fundo clarinho no tema claro e um fundo escuro no escuro, sem tabela.

import type { CSSProperties } from 'react'

const HEX = /^#[0-9a-f]{6}$/i

export function corValida(cor: string | null | undefined): string | null {
  return cor && HEX.test(cor) ? cor : null
}

/** Branco ou quase-preto, o que tiver mais contraste com a cor (WCAG). */
function tintaSobre(hex: string): string {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5)
  const comBranco = 1.05 / (l + 0.05)
  const comPreto = (l + 0.05) / 0.05
  return comBranco >= comPreto ? '#ffffff' : '#14161a'
}

export function estiloDaMarca(cor: string | null | undefined): CSSProperties {
  const c = corValida(cor)
  const base: Record<string, string> = {
    '--marca-suave': 'color-mix(in oklab, var(--marca) 13%, var(--superficie))',
    // Texto na cor da loja: puxado para a tinta do tema, para ler bem nos dois.
    '--marca-texto': 'color-mix(in oklab, var(--marca) 80%, var(--titulo))',
    '--marca-borda': 'color-mix(in oklab, var(--marca) 45%, var(--borda))',
    '--marca-anel': 'color-mix(in oklab, var(--marca) 28%, transparent)',
  }
  if (c) {
    base['--marca'] = c
    base['--marca-forte'] = `color-mix(in oklab, ${c} 82%, black)`
    base['--marca-tinta'] = tintaSobre(c)
  }
  return base as CSSProperties
}

const PEQUENAS = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'sem', 'em', 'no', 'na'])

/** "Casca de casquinha" → "CC"; "Picolé (a partir de 20 un.)" → "P". */
export function sigla(nome: string, max = 2): string {
  const palavras = nome
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s\-–—/·]+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((p) => p && !PEQUENAS.has(p.toLowerCase()))
  const s = palavras
    .slice(0, max)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
  return s || nome.trim().charAt(0).toUpperCase() || '•'
}

/** Um de quatro tons, fixo para o mesmo texto (a categoria): produtos da mesma família ficam parecidos. */
export function tomDe(chave: string | null): 0 | 1 | 2 | 3 {
  let h = 0
  for (const ch of chave ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (h % 4) as 0 | 1 | 2 | 3
}
