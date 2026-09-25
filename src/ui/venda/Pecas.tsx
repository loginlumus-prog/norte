// As peças miúdas que as telas desenhadas da página de venda repetem.
//
// ── por que elas existem separadas das peças do sistema ──────
// As telas da página de venda são AMOSTRA: números de exemplo, nada de
// servidor, nada de permissão. As peças do sistema (`ui/base.tsx`,
// `ui/painel.tsx`) carregam formulário, estado e regra — importar aquilo
// para desenhar uma pílula num quadro de vitrine traria junto o peso e o
// risco de a vitrine quebrar quando a tela de verdade mudar um detalhe.
//
// Mas o DESENHO é o mesmo: a pílula de situação com a palavra junto, o avatar
// de iniciais, a barra com trilho. É isso que faz a amostra ser reconhecida
// no dia em que a pessoa entra no sistema — "é igual ao que eu vi".
//
// Sem estado e sem efeito: desenha no servidor, e serve também dentro de
// componente de cliente.

import type { ReactNode } from 'react'
import { cx } from '../base'

export type Tom = 'bom' | 'atencao' | 'critico' | 'neutro' | 'marca'

// Cor nunca vem sozinha: toda pílula tem a palavra. Quem não distingue verde
// de vermelho lê "Feito" e "Parado" igual.
const PILULA: Record<Tom, string> = {
  bom: 'bg-bom-fundo text-bom',
  atencao: 'bg-atencao-fundo text-atencao',
  critico: 'bg-critico-fundo text-critico',
  neutro: 'bg-superficie-2 text-tinta-2',
  marca: 'bg-marca-suave text-marca',
}

export function Pilula({
  tom,
  children,
  className,
}: {
  tom: Tom
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap',
        PILULA[tom],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Avatar({
  iniciais,
  tom = 'marca',
  className,
}: {
  iniciais: string
  tom?: 'marca' | 'bom' | 'atencao'
  className?: string
}) {
  const cor =
    tom === 'bom'
      ? 'bg-bom-fundo text-bom'
      : tom === 'atencao'
        ? 'bg-atencao-fundo text-atencao'
        : 'bg-marca-suave text-marca'
  return (
    <span
      className={cx(
        'grid size-6 shrink-0 place-items-center rounded-full text-[9.5px] font-bold',
        cor,
        className,
      )}
    >
      {iniciais}
    </span>
  )
}

/** A barra de progresso: trilho claro e o preenchimento crescendo da esquerda. */
export function Barra({
  valor,
  tom = 'marca',
  atraso = 0,
  className,
}: {
  /** 0 a 100. */
  valor: number
  tom?: 'marca' | 'bom' | 'atencao' | 'critico'
  /** Segundos: para a barra crescer depois de a linha dela pousar. */
  atraso?: number
  className?: string
}) {
  const cor =
    tom === 'bom'
      ? 'bg-bom-vivo'
      : tom === 'atencao'
        ? 'bg-atencao-vivo'
        : tom === 'critico'
          ? 'bg-critico-vivo'
          : 'bg-marca'
  return (
    <span
      aria-hidden
      className={cx('relative block h-1.5 overflow-hidden rounded-full bg-superficie-3', className)}
    >
      <span
        className={cx('cresce absolute inset-y-0 left-0 rounded-full', cor)}
        style={{ width: `${Math.min(100, Math.max(0, valor))}%`, animationDelay: `${atraso}s` }}
      />
    </span>
  )
}

/**
 * A janela do produto: o quadro de uma tela do Norte, com a barra fina de
 * cima dizendo QUAL tela é.
 *
 * Moldura mínima de propósito. Três bolinhas e barra de navegador fazem a
 * amostra parecer print colado; uma linha com o caminho da tela diz "isto é
 * o sistema, nesta tela" e sai do caminho.
 */
export function Janela({
  caminho,
  children,
  className,
  corpo,
}: {
  /** O que aparece na barra: "loja-centro / estoque". */
  caminho: string
  children: ReactNode
  className?: string
  corpo?: string
}) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-xl border border-borda bg-superficie shadow-norte-alta',
        className,
      )}
    >
      <div className="flex items-center border-b border-borda-suave bg-superficie px-3.5 py-2">
        <span className="truncate rounded-md bg-superficie-2 px-2.5 py-0.5 font-mono text-[10.5px] text-tinta-3">
          {caminho}
        </span>
      </div>
      <div className={corpo}>{children}</div>
    </div>
  )
}

/** Rótulo de coluna/seção dentro das telas desenhadas. */
export function Rotulo({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cx(
        'text-[10px] font-bold tracking-[0.12em] text-tinta-3 uppercase',
        className,
      )}
    >
      {children}
    </p>
  )
}

export const reais = (v: number, casas = 2) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(v)
