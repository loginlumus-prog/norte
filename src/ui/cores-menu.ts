// A cor de cada área do menu: a tarja que faz o olho achar "onde estou".
//
// Cada grupo do menu (Vender, Catálogo, Pessoas...) tem uma cor; os itens do
// grupo herdam: o ícone ganha um azulejo na cor, o item aberto ganha o fundo
// e o fio da cor. Assim "estou no Estoque" vira "estou no âmbar" — e isso o
// olho percebe antes de ler.
//
// A pessoa troca a cor de qualquer grupo (CoresDoMenu.tsx). A escolha fica
// no APARELHO (cookie por empresa): é gosto de quem usa, não regra da loja.
//
// Sem I/O: serve ao servidor (que pinta a barra já na primeira resposta, sem
// piscar) e ao aparelho (que grava a escolha).

/** A chave é o nome do grupo em menu.ts, antes do vocabulário do ramo. */
export const CORES_PADRAO: Record<string, string> = {
  Painel: '#6366f1',
  Vender: '#10b981',
  Atendimento: '#0ea5e9',
  Catálogo: '#f59e0b',
  Fábrica: '#f97316',
  Pessoas: '#ec4899',
  Dinheiro: '#8b5cf6',
  Empresa: '#64748b',
}

/** As cores que o seletor oferece. Todas leem bem na barra clara e na escura. */
export const PALETA = [
  '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981',
  '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#d946ef',
  '#8b5cf6', '#64748b',
] as const

export const cookieDasCores = (slug: string) => `menu-cores-${slug}`

const HEX = /^#[0-9a-f]{6}$/i

/** Lê o que o cookie guardou: só chave conhecida e cor #rrggbb passam. */
export function lerCores(bruto: string | null | undefined): Record<string, string> {
  if (!bruto) return {}
  try {
    const obj = JSON.parse(decodeURIComponent(bruto)) as unknown
    if (!obj || typeof obj !== 'object') return {}
    const saida: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k in CORES_PADRAO && typeof v === 'string' && HEX.test(v)) saida[k] = v.toLowerCase()
    }
    return saida
  } catch {
    return {}
  }
}

/** A cor do grupo: a escolhida neste aparelho, ou a padrão. */
export const corDoGrupo = (grupo: string | undefined, escolhidas: Record<string, string>) =>
  escolhidas[grupo ?? 'Painel'] ?? CORES_PADRAO[grupo ?? 'Painel'] ?? CORES_PADRAO.Empresa!
