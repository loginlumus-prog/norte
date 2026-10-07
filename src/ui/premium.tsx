// Peças de tela com mais vida: o cartão-filtro colorido (número grande que é
// também o botão do filtro) e o avatar de iniciais. Sem hook: servem às
// páginas do servidor.
//
// A cor de cada cartão diz o ASSUNTO, não o estado: "sumidos" é âmbar porque
// pede atenção, "devendo" é vermelho, "compram" é verde. O escolhido ganha o
// cartão inteiro pintado da cor dele, com o visto no canto — o olho acha o
// filtro aceso sem ler. (Já foi só o contorno colorido: parecia campo com
// erro, e no azul se confundia com o foco do teclado.)

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { cx } from './base'

export type CorDoCartao = 'indigo' | 'verde' | 'ambar' | 'rosa' | 'vermelho' | 'ceu' | 'violeta' | 'ardosia'

export const COR: Record<CorDoCartao, string> = {
  indigo: '#6366f1',
  verde: '#10b981',
  ambar: '#f59e0b',
  rosa: '#ec4899',
  vermelho: '#ef4444',
  ceu: '#0ea5e9',
  violeta: '#8b5cf6',
  ardosia: '#64748b',
}

/** Os desenhos dos cartões: traço de 1.8 na grade de 20. */
export const ICONE = {
  pessoas: <><circle cx="7.5" cy="7" r="3" /><path d="M2 16.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><path d="M13.5 4.2a3 3 0 0 1 0 5.6M15.5 12.4c1.4.6 2.3 2 2.5 4.1" /></>,
  sacola: <><path d="M4 6.5h12l-1 10.5H5z" /><path d="M7.5 6.5V5a2.5 2.5 0 0 1 5 0v1.5" /></>,
  relogio: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4.2l2.8 1.8" /></>,
  bolo: <><path d="M3.5 17h13v-6.5h-13z" /><path d="M3.5 13.5c1.6 1 3 1 4.3 0s3-1 4.4 0 2.7 1 4.3 0" /><path d="M10 10.5V7.5" /><path d="M10 4.2c.9.8.9 1.9 0 2.6-.9-.7-.9-1.8 0-2.6z" /></>,
  moeda: <><circle cx="10" cy="10" r="7" /><path d="M12.4 7.6c-.5-.7-1.3-1-2.4-1-1.4 0-2.4.7-2.4 1.8 0 2.6 5 1.3 5 3.9 0 1.1-1.1 1.9-2.6 1.9-1.1 0-2-.4-2.6-1.1M10 5v1.6M10 13.8v1.4" /></>,
  estrela: <path d="M10 2.8l2.2 4.5 4.9.7-3.6 3.5.9 4.9L10 14.1l-4.4 2.3.9-4.9L2.9 8l4.9-.7z" />,
  novo: <><circle cx="10" cy="10" r="7" /><path d="M10 6.8v6.4M6.8 10h6.4" /></>,
  sono: <><path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z" /></>,
} satisfies Record<string, ReactNode>

export function CartaoFiltro({
  href,
  ativo,
  cor,
  icone,
  numero,
  rotulo,
  detalhe,
  de,
}: {
  href: string
  ativo: boolean
  cor: CorDoCartao
  icone: keyof typeof ICONE
  numero: number | string
  rotulo: string
  detalhe?: string
  /**
   * O todo de onde este recorte sai ("12 de 340 clientes"). Com ele, uma
   * barrinha embaixo mostra o tamanho do recorte — o número ganha escala:
   * 12 sumidos em 40 é alarme, em 4.000 é rotina.
   */
  de?: number
}) {
  const parte = typeof numero === 'number' && de && de > 0 && numero < de ? Math.max(numero / de, numero > 0 ? 0.03 : 0) : null
  return (
    <Link
      href={href}
      aria-current={ativo ? 'true' : undefined}
      style={{ '--c': COR[cor] } as CSSProperties}
      className="cartao-filtro group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl p-3 text-left"
    >
      <span className="cartao-filtro-icone grid size-10 shrink-0 place-items-center rounded-xl">
        <svg aria-hidden viewBox="0 0 20 20" className="size-[19px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {ICONE[icone]}
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="cartao-filtro-rotulo truncate text-xs font-semibold">{rotulo}</span>
        <span className="numero text-[22px] leading-[1.15] font-extrabold tracking-tight">{typeof numero === 'number' ? numero.toLocaleString('pt-BR') : numero}</span>
        {detalhe ? <span className="cartao-filtro-detalhe truncate text-[12.5px]">{detalhe}</span> : null}
        {parte !== null ? (
          <span aria-hidden className="cartao-filtro-trilho mt-1.5 h-1 w-full overflow-hidden rounded-full">
            <span className="block h-full rounded-full" style={{ width: `${Math.round(parte * 100)}%` }} />
          </span>
        ) : null}
      </span>
      {/* O escolhido ganha o visto no canto: forma, além de cor. */}
      {ativo ? (
        <span aria-hidden className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-white/25">
          <svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 10.5 3.2 3L15 6.5" />
          </svg>
        </span>
      ) : null}
    </Link>
  )
}

const TONS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316']

/** A cor que sai de um nome: o mesmo nome dá sempre a mesma cor (pessoa, loja). */
export function corDoNome(nome: string): string {
  let h = 0
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TONS[h % TONS.length]!
}

/** As iniciais de um nome: "Loja do Centro" → "LC"; "Matriz" → "MA". */
export function iniciaisDe(nome: string): string {
  const todas = nome.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  const fortes = todas.filter((p) => p.length > 2 || /^[A-Z0-9]/.test(p))
  const p = fortes.length ? fortes : todas
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : (p[0]?.[1] ?? ''))).toUpperCase() || '·'
}

/** As iniciais num círculo; a cor sai do nome, então a mesma pessoa tem sempre a mesma cor. */
export function Avatar({ nome, tamanho = 36, apagado = false }: { nome: string; tamanho?: number; apagado?: boolean }) {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  const iniciais = ((partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '')).toUpperCase() || '·'
  const cor = corDoNome(nome)
  return (
    <span
      aria-hidden
      className={cx('grid shrink-0 place-items-center rounded-full font-bold text-white', apagado && 'opacity-50 grayscale')}
      style={{
        width: tamanho,
        height: tamanho,
        fontSize: Math.round(tamanho * 0.36),
        background: `linear-gradient(140deg, color-mix(in oklab, ${cor} 75%, white), ${cor})`,
        boxShadow: `0 4px 10px -5px ${cor}`,
      }}
    >
      {iniciais}
    </span>
  )
}

/* ── Os botões de ação (de uma linha, de um cartão) ──────────── */

/** Os desenhos das ações: traço de 1.7 na grade de 20. */
export const ICONE_DA_ACAO = {
  imprimir: <><path d="M6 7.5V3.5h8v4" /><rect x="3" y="7.5" width="14" height="6.5" rx="1.8" /><path d="M6 12h8v4.5H6z" /></>,
  trocar: <><path d="M4 7h11l-3-3" /><path d="M16 13H5l3 3" /></>,
  carne: <><rect x="4" y="3" width="12" height="14" rx="2" /><path d="M7 7h6M7 10h6M7 13h3.5" /></>,
  abrir: <path d="m8 5 5 5-5 5" />,
  editar: <><path d="M12.6 3.9a1.9 1.9 0 0 1 2.7 2.7L7 14.9l-3.5.8.8-3.5z" /><path d="M11.3 5.2l2.7 2.7" /></>,
  excluir: <><path d="M4 6h12" /><path d="M8 6V4.5h4V6" /><path d="M5.5 6l.7 10h7.6l.7-10" /><path d="M8.5 9v4.5M11.5 9v4.5" /></>,
  ver: <><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5z" /><circle cx="10" cy="10" r="2.2" /></>,
  receber: <><circle cx="10" cy="10" r="7" /><path d="m6.8 10.2 2.2 2.2 4.2-4.6" /></>,
  cancelar: <><circle cx="10" cy="10" r="7" /><path d="m7.5 7.5 5 5M12.5 7.5l-5 5" /></>,
  etiqueta: <><path d="M3.5 10.2V4.5a1 1 0 0 1 1-1h5.7l6.3 6.3a1 1 0 0 1 0 1.4l-5.3 5.3a1 1 0 0 1-1.4 0z" /><circle cx="7" cy="7" r="1.1" /></>,
  copiar: <><rect x="7" y="7" width="9.5" height="9.5" rx="2" /><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6a1.5 1.5 0 0 0 1.5 1.5H7" /></>,
  baixar: <><path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9" /><path d="M4 15.5h12" /></>,
  enviar: <><path d="M3.5 9.5 16.5 3.5l-4.5 13-2.5-5.5z" /><path d="m9.5 11 2.5-2.5" /></>,
  mais: <path d="M10 5v10M5 10h10" />,
  desfazer: <><path d="M7 5.5 3.5 9 7 12.5" /><path d="M3.5 9H12a4.5 4.5 0 0 1 0 9H9" /></>,
  arquivar: <><rect x="3" y="4" width="14" height="4" rx="1" /><path d="M4.5 8v7.5h11V8M8.5 11h3" /></>,
  conferir: <><path d="M5 10.5l3.2 3L15 6.5" /></>,
  fechar: <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />,
  subir: <path d="m5 12.5 5-5 5 5" />,
  descer: <path d="m5 7.5 5 5 5-5" />,
  esconder: <><path d="M3 10s2.6-4.5 7-4.5c1.3 0 2.4.4 3.4.9M17 10s-2.6 4.5-7 4.5c-1.3 0-2.4-.4-3.4-.9" /><path d="M3.5 16.5 16.5 3.5" /></>,
  menu: <><circle cx="5" cy="10" r=".9" fill="currentColor" /><circle cx="10" cy="10" r=".9" fill="currentColor" /><circle cx="15" cy="10" r=".9" fill="currentColor" /></>,
  devolver: <><path d="M8 4.5 4.5 8 8 11.5" /><path d="M4.5 8h7a4 4 0 0 1 0 8H10" /></>,
  ficha: <><rect x="3.5" y="3.5" width="13" height="13" rx="2.5" /><circle cx="10" cy="8.5" r="2" /><path d="M6.5 14c.6-1.6 1.9-2.5 3.5-2.5s2.9.9 3.5 2.5" /></>,
  pausar: <><rect x="5.5" y="4.5" width="3" height="11" rx="1" /><rect x="11.5" y="4.5" width="3" height="11" rx="1" /></>,
  retomar: <path d="M6.5 4.5v11l9-5.5z" />,
  trancar: <><rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  responder: <><path d="M8 5 3.5 9.5 8 14" /><path d="M3.5 9.5H11a5.5 5.5 0 0 1 5.5 5.5" /></>,
} satisfies Record<string, ReactNode>

export type IconeDaAcao = keyof typeof ICONE_DA_ACAO
export type TomDaAcao = 'neutro' | 'principal' | 'perigo' | 'bom'

/** O desenho de uma ação, do tamanho certo para o botão. */
export function IconeDaAcao({ icone, tamanho = 17, grosso = false }: { icone: IconeDaAcao; tamanho?: number; grosso?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" width={tamanho} height={tamanho} fill="none" stroke="currentColor" strokeWidth={grosso ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      {ICONE_DA_ACAO[icone]}
    </svg>
  )
}

/**
 * As classes de um botão de ação — para quem precisa de um <button> com
 * onClick (as janelas de confirmar, num componente do cliente) e não de um
 * link. O desenho é o mesmo do `BotaoDaLinha`.
 *
 *   • `icone`: só o ícone num quadrado, com o nome na dica (`DicaDaAcao`);
 *   • `pilula`: ícone e nome — quando há espaço, ou a ação é a principal.
 */
export function classeDaAcao({ jeito = 'icone', tom = 'neutro' }: { jeito?: 'icone' | 'pilula'; tom?: TomDaAcao } = {}) {
  return [
    'botao-acao',
    jeito === 'icone' ? 'botao-acao-icone relative grid size-8 shrink-0 place-items-center rounded-lg' : 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold whitespace-nowrap',
    tom === 'principal' ? 'botao-acao-principal' : tom === 'perigo' ? 'botao-acao-perigo' : tom === 'bom' ? 'botao-acao-bom' : '',
  ].join(' ')
}

/** O nome da ação que sobe ao passar o mouse sobre o botão de ícone. */
export function DicaDaAcao({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="botao-acao-dica">
      {children}
    </span>
  )
}

/**
 * Um botão de ação que é LINK (abrir, editar, reimprimir, trocar).
 *
 * Eram links de texto azul — "Reimprimir Trocar abrir", "editar excluir" —
 * que quebravam linha e liam como frase. Agora as ações de apoio são ícones
 * num quadrado, com o nome numa dica que sobe ao passar o mouse (e no
 * `aria-label`), e a ação principal da linha é uma pílula cheia com nome e
 * seta. Juntos numa cápsula (`AcoesDaLinha`), sempre na mesma ordem: apoio
 * primeiro, o principal no fim — a mão aprende o lugar.
 */
export function BotaoDaLinha({
  href,
  icone,
  rotulo,
  dica,
  principal = false,
  tom,
  comRotulo = false,
  externo = false,
}: {
  href: string
  icone: IconeDaAcao
  /** O nome curto: aparece na pílula ou na dica. */
  rotulo: string
  /** O que o leitor de tela anuncia: "Reimprimir o comprovante da venda 12". Sem ele, o rótulo. */
  dica?: string
  /** A ação principal da linha: pílula cheia na cor da área, com seta. */
  principal?: boolean
  tom?: TomDaAcao
  /** Ícone E nome, sem ser a principal (quando há espaço). */
  comRotulo?: boolean
  /** Abre em outra aba (o comprovante, que já sai imprimindo). */
  externo?: boolean
}) {
  const pilula = principal || comRotulo
  const classe = classeDaAcao({ jeito: pilula ? 'pilula' : 'icone', tom: principal ? 'principal' : tom })
  const miolo = principal ? (
    <>
      {rotulo}
      <IconeDaAcao icone={icone} tamanho={14} grosso />
    </>
  ) : pilula ? (
    <>
      <IconeDaAcao icone={icone} tamanho={15} />
      {rotulo}
    </>
  ) : (
    <>
      <IconeDaAcao icone={icone} />
      <DicaDaAcao>{rotulo}</DicaDaAcao>
    </>
  )
  const nome = dica ?? (pilula ? undefined : rotulo)
  return externo ? (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={nome} className={classe}>
      {miolo}
    </a>
  ) : (
    <Link href={href} aria-label={nome} className={classe}>
      {miolo}
    </Link>
  )
}

/** A cápsula que junta os botões de uma linha ou de um cartão. */
export function AcoesDaLinha({ children, solta = false }: { children: ReactNode; solta?: boolean }) {
  return <span className={solta ? 'inline-flex flex-wrap items-center gap-1' : 'acoes-da-linha inline-flex items-center gap-0.5 rounded-xl p-0.5'}>{children}</span>
}
