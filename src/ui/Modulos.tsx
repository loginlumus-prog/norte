// O diagrama dos módulos: o Norte no centro, e as oito portas em volta.
//
// ── o que ele diz ────────────────────────────────────────────
// "Um sistema só" é frase que todo concorrente escreve. O desenho prova: um
// centro, oito módulos ligados a ele por seta, e uma órbita pontilhada que
// passa por todos. Não há seta entre módulo e módulo de propósito — eles não
// conversam entre si por integração, eles leem a MESMA base. É essa a
// diferença que a página vende.
//
// ── os oito são os grupos do menu real ───────────────────────
// Vender, Catálogo, Pessoas e Dinheiro são os grupos de `ui/menu.ts`, na
// ordem em que aparecem lá; a Empresa abre em quatro (Assistente, Auditoria,
// Assinatura, Configurações) porque cada um é um argumento de venda por si.
// Nome que não existe no menu não entra aqui: o diagrama é o mapa do que a
// pessoa vai encontrar quando entrar.
//
// ── SVG para a geometria, HTML para a palavra ────────────────
// Círculo, seta e órbita são SVG, porque posição exata é coisa de vetor. O
// rótulo de cada módulo é HTML posicionado por cima, em porcentagem da mesma
// caixa: texto de verdade, que o buscador lê, a pessoa seleciona e o tema
// pinta. Para os dois coincidirem, a caixa trava a proporção do viewBox e o
// diagrama tem largura máxima igual à do desenho (40rem) — de `md` para cima
// ele é sempre 1:1, então nenhum rótulo precisa escalar.
//
// ── e por que ele não se mexe ────────────────────────────────
// A regra da página é que animação mostra mecânica; se não mostra, é enfeite
// e sai. Aqui não há mecânica a mostrar — o argumento é a forma parada.
//
// ── no celular ───────────────────────────────────────────────
// Oito círculos em roda não cabem em 375px sem virar confete. Abaixo de `md`
// a mesma lista vira grade de duas colunas, com o mesmo ícone e o mesmo
// rótulo — o que se perde é a roda, o que fica é a informação.

import type { ComponentType } from 'react'
import { Simbolo } from './Marca'
import {
  IconeAssinatura,
  IconeAssistente,
  IconeAuditoria,
  IconeCatalogo,
  IconeConfiguracoes,
  IconeDinheiro,
  IconePessoas,
  IconeVender,
} from './Icones'

type Modulo = {
  nome: string
  partes: string
  Icone: ComponentType<{ tamanho?: number; className?: string }>
  /** Posição na órbita, em graus: -90 é o topo, e cresce no sentido horário. */
  ang: number
}

const MODULOS: Modulo[] = [
  { nome: 'Vender', partes: 'balcão, caixa, crediário', Icone: IconeVender, ang: -90 },
  { nome: 'Catálogo', partes: 'produto, estoque, preços', Icone: IconeCatalogo, ang: -45 },
  { nome: 'Pessoas', partes: 'clientes, equipe, tarefas', Icone: IconePessoas, ang: 0 },
  { nome: 'Dinheiro', partes: 'financeiro, fechamento, análise', Icone: IconeDinheiro, ang: 45 },
  { nome: 'Assistente', partes: 'no WhatsApp', Icone: IconeAssistente, ang: 90 },
  { nome: 'Auditoria', partes: 'o livro de tudo que mexeu', Icone: IconeAuditoria, ang: 135 },
  { nome: 'Assinatura', partes: 'plano, lojas e vagas', Icone: IconeAssinatura, ang: 180 },
  { nome: 'Configurações', partes: 'módulos, ramo e eixos', Icone: IconeConfiguracoes, ang: 225 },
]

// A geometria, em unidades do viewBox.
const LARGURA = 640
const ALTURA = 420
const CENTRO = { x: 320, y: 210 }
// Elipse, e não círculo: a caixa é mais larga que alta, e uma roda redonda
// deixaria as laterais vazias e o topo apertado.
const ORBITA = { x: 228, y: 138 }
/** Raio do círculo de cada módulo. */
const NO = 30
/** Lado do azulejo do símbolo, no centro. */
const AZULEJO = 64
/** Folga entre a ponta da seta e a borda do círculo. */
const FOLGA = 7

const posicao = (ang: number) => {
  const r = (ang * Math.PI) / 180
  return { x: CENTRO.x + ORBITA.x * Math.cos(r), y: CENTRO.y + ORBITA.y * Math.sin(r) }
}

/** A seta do centro até o módulo: do canto do azulejo à borda do círculo. */
function seta(alvo: { x: number; y: number }) {
  const dx = alvo.x - CENTRO.x
  const dy = alvo.y - CENTRO.y
  const d = Math.hypot(dx, dy)
  const ux = dx / d
  const uy = dy / d
  const inicio = { x: CENTRO.x + ux * (AZULEJO_META + 6), y: CENTRO.y + uy * (AZULEJO_META + 6) }
  const fim = { x: alvo.x - ux * (NO + FOLGA), y: alvo.y - uy * (NO + FOLGA) }
  // A ponta: dois traços curtos abrindo para trás. Desenhada à mão em vez de
  // `<marker>` porque marcador não herda `currentColor` em todo navegador.
  const atras = { x: fim.x - ux * 6, y: fim.y - uy * 6 }
  const px = -uy * 3.5
  const py = ux * 3.5
  return {
    linha: `M${f(inicio.x)} ${f(inicio.y)} L${f(fim.x)} ${f(fim.y)}`,
    ponta: `M${f(atras.x + px)} ${f(atras.y + py)} L${f(fim.x)} ${f(fim.y)} L${f(atras.x - px)} ${f(atras.y - py)}`,
  }
}

// Meia diagonal do azulejo: é de onde a seta parte para não nascer por baixo dele.
const AZULEJO_META = (AZULEJO / 2) * Math.SQRT2

const f = (n: number) => n.toFixed(1)

export function Modulos() {
  return (
    <>
      {/* ── celular: a mesma lista, em grade ── */}
      <ul className="grid grid-cols-2 gap-x-4 md:hidden">
        {MODULOS.map((m) => (
          <li key={m.nome} className="flex items-center gap-3 border-t border-borda py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full border border-borda bg-superficie text-marca">
              <m.Icone tamanho={24} />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[13px] font-bold text-tinta">{m.nome}</span>
              <span className="text-[11px] text-tinta-3">{m.partes}</span>
            </span>
          </li>
        ))}
      </ul>

      {/* ── daqui para cima, a roda ── */}
      <div
        className="relative mx-auto hidden w-full max-w-[40rem] md:block"
        style={{ aspectRatio: `${LARGURA} / ${ALTURA}` }}
      >
        <svg
          viewBox={`0 0 ${LARGURA} ${ALTURA}`}
          className="absolute inset-0 h-full w-full text-tinta-3"
          aria-hidden
          focusable="false"
        >
          {/* A órbita: pontilhada e na cor da borda, para ficar atrás de tudo. */}
          <ellipse
            cx={CENTRO.x}
            cy={CENTRO.y}
            rx={ORBITA.x}
            ry={ORBITA.y}
            fill="none"
            stroke="var(--borda)"
            strokeWidth="1.2"
            strokeDasharray="3 5"
          />

          {/* O halo do centro. Sem ele o azulejo encosta seco no papel; com
              ele, o olho entende que tudo em volta nasce dali. */}
          <circle
            cx={CENTRO.x}
            cy={CENTRO.y}
            r={AZULEJO * 0.85}
            style={{ fill: 'color-mix(in srgb, var(--marca) 8%, transparent)' }}
          />

          {/* As setas, em `currentColor` do svg (tinta-3). */}
          <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            {MODULOS.map((m) => {
              const s = seta(posicao(m.ang))
              return (
                <g key={m.nome}>
                  <path d={s.linha} />
                  <path d={s.ponta} />
                </g>
              )
            })}
          </g>

          {/* O símbolo, com o azulejo — o mesmo da barra do topo. O id do
              degradê é único na página, senão ele atropela o do topo. */}
          <g transform={`translate(${CENTRO.x - AZULEJO / 2} ${CENTRO.y - AZULEJO / 2})`}>
            <Simbolo tamanho={AZULEJO} id="modulos-sol" />
          </g>

          {/* Os módulos: círculo de papel com a borda do tema, e o ícone em
              azul da marca. */}
          {MODULOS.map((m) => {
            const p = posicao(m.ang)
            return (
              <g key={m.nome}>
                <circle
                  cx={f(p.x)}
                  cy={f(p.y)}
                  r={NO}
                  fill="var(--superficie)"
                  stroke="var(--borda)"
                  strokeWidth="1.2"
                />
                <g transform={`translate(${f(p.x - 14)} ${f(p.y - 14)})`} className="text-marca">
                  <m.Icone tamanho={28} />
                </g>
              </g>
            )
          })}
        </svg>

        {/* Os rótulos, em HTML, na mesma caixa. Todos embaixo do círculo,
            menos o do topo, que vai em cima — embaixo dele passaria a seta. */}
        <ul className="pointer-events-none absolute inset-0 m-0 list-none p-0">
          {MODULOS.map((m) => {
            const p = posicao(m.ang)
            const emCima = m.ang === -90
            const y = emCima ? p.y - NO - 8 : p.y + NO + 8
            return (
              <li
                key={m.nome}
                className="absolute flex w-max flex-col items-center text-center leading-tight"
                style={{
                  left: `${(p.x / LARGURA) * 100}%`,
                  top: `${(y / ALTURA) * 100}%`,
                  transform: emCima ? 'translate(-50%, -100%)' : 'translateX(-50%)',
                }}
              >
                <span className="text-[13px] font-bold text-tinta">{m.nome}</span>
                <span className="text-[11px] text-tinta-3">{m.partes}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
