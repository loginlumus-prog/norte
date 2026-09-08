// Os banners da página de venda.
//
// ── por que são HTML, e não imagem ───────────────────────────
// A cena é montada com as mesmas peças da interface — etiqueta, total, bolha
// de conversa, barra de gráfico. Nenhuma imagem exportada: fica nítido em
// qualquer tela, muda de cor com o tema, anima de graça, e não precisa ser
// refeito quando a tela de verdade mudar um botão de lugar.
//
// ── O ERRO QUE ESTAVA AQUI ───────────────────────────────────
// A primeira versão punha a cena DENTRO de uma caixinha com borda, dentro do
// banner. Caixa dentro de caixa, que é justamente o que a gente tirou do
// sistema inteiro — e o resultado parece print colado numa moldura.
//
// A referência faz o contrário: os elementos ficam soltos sobre o fundo do
// próprio banner, se sobrepõem, e SANGRAM pela borda. É a sangria que separa
// "cena desenhada" de "captura de tela emoldurada": o que corta é a beirada do
// banner, então o olho entende que tem mais coisa ali fora.
//
// Daí as três regras da cena:
//   1. nenhum contêiner com borda em volta da cena;
//   2. pelo menos um elemento cortado pela borda do banner;
//   3. profundidade por sobreposição e sombra, nunca por moldura.
//
// ── a regra do movimento ─────────────────────────────────────
// A animação é o argumento: mostra a mecânica (a conta refazendo, o preço
// caindo, os três números virando juntos). Se não mostra, é enfeite e sai.
// Roda uma vez, entre 300 e 600ms, e a peça já está legível parada.

import type { ReactNode } from 'react'
import { AoEntrar, Contando } from './AoEntrar'
import { Traco } from './Traco'

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

/* ── a moldura comum ──────────────────────────────────────── */

type Tom = 'noite' | 'escuro' | 'claro' | 'creme' | 'verde' | 'ambar'

const eEscuro = (t: Tom) => t !== 'claro' && t !== 'creme'

const FUNDO: Record<Tom, string> = {
  noite: 'nav-fundo',
  escuro: 'bg-nav',
  claro: 'bg-superficie border border-borda',
  creme: 'bg-superficie-2 border border-borda-suave',
  verde: '',
  ambar: '',
}

const DEGRADE: Partial<Record<Tom, string>> = {
  verde: 'linear-gradient(155deg,#0b8a4c 0%,#05713a 55%,#04562d 100%)',
  ambar: 'linear-gradient(155deg,#96610b 0%,#7a4a06 55%,#5b3704 100%)',
}

export function Banner({
  tom,
  titulo,
  texto,
  largura = 1,
  children,
}: {
  tom: Tom
  titulo: string
  texto: string
  /** Colunas no mosaico de quatro. */
  largura?: 1 | 2 | 4
  /** A cena. Solta, sobreposta, sangrando pela borda. */
  children: ReactNode
}) {
  const escuro = eEscuro(tom)
  const cols =
    largura === 4 ? 'sm:col-span-2 lg:col-span-4'
    : largura === 2 ? 'sm:col-span-2'
    : ''

  return (
    <AoEntrar
      className={`realce group relative flex flex-col overflow-hidden rounded-norte ${FUNDO[tom]} ${cols}`}
    >
      {DEGRADE[tom] && (
        <span aria-hidden className="absolute inset-0" style={{ background: DEGRADE[tom] }} />
      )}

      <header className="relative z-10 flex flex-col gap-1.5 p-5 pb-0 sm:p-6 sm:pb-0">
        <h3
          className={`text-xl leading-tight font-bold tracking-tight text-balance sm:text-[26px] ${
            escuro ? '!text-white' : ''
          }`}
        >
          {titulo}
        </h3>
        <p
          className={`max-w-[44ch] text-sm leading-relaxed ${
            escuro ? 'text-white/65' : 'text-tinta-2'
          }`}
        >
          {texto}
        </p>
      </header>

      {/* A cena não tem padding de baixo nem dos lados de propósito: é ela que
          decide onde sangra. */}
      <div className="relative z-10 mt-5 flex-1">{children}</div>
    </AoEntrar>
  )
}

/* ═══════════════════════════════════════════════════════════
   B-01 · o balcão
   ═══════════════════════════════════════════════════════════ */

export function BannerBalcao() {
  return (
    <Banner
      tom="noite"
      largura={2}
      titulo="Vende em três toques"
      texto="Bipa a etiqueta, escolhe como recebeu, fecha. O estoque baixa, o caixa registra e o livro guarda quem vendeu — sem ninguém digitar duas vezes."
    >
      {/* Sangra pela direita: as linhas passam da borda e o banner corta. */}
      <div className="-mr-6 flex flex-col gap-1.5 pl-5 sm:pl-6">
        <div className="encaixa flex items-center justify-between gap-4 rounded-l-norte bg-bom-vivo/12 py-2 pr-6 pl-3 shadow-[inset_2px_0_0_var(--bom-vivo)]">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-semibold text-white">
              Camiseta canelada — Azul · G
            </span>
            <span className="numero text-[10px] text-white/45">CAM003</span>
          </span>
          <span className="numero shrink-0 text-xs font-semibold text-white">R$ 49,90</span>
        </div>

        <div className="flex items-center justify-between gap-4 py-1.5 pr-6 pl-3">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs text-white/75">Camiseta canelada — Azul · P</span>
            <span className="numero text-[10px] text-white/35">CAM001</span>
          </span>
          <span className="numero shrink-0 text-xs text-white/75">R$ 49,90</span>
        </div>
      </div>

      {/* O total é TIPOGRAFIA, não caixa. É o maior elemento da cena porque é
          o que a pessoa olha no balcão. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 p-5 pt-4 sm:p-6 sm:pt-5">
        <div className="flex flex-col">
          <span className="text-[11px] text-white/45">A pagar</span>
          <Contando
            ate={99.8}
            de={49.9}
            formatar={brl}
            className="numero text-[32px] leading-none font-bold tracking-tight text-white"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-white/60">
            Dinheiro
          </span>
          <span className="acende rounded-full bg-bom-vivo px-4 py-1.5 text-[11px] font-bold text-white">
            Fechar venda
          </span>
        </div>
      </div>
    </Banner>
  )
}

/* ═══════════════════════════════════════════════════════════
   B-02 · o assistente
   ═══════════════════════════════════════════════════════════ */

export function BannerAssistente() {
  return (
    <Banner
      tom="escuro"
      largura={2}
      titulo="Ele atende, e pede licença antes"
      texto="Responde cliente no WhatsApp a qualquer hora. Quando é para gastar dinheiro, ele propõe e espera você confirmar — e nunca pode mais do que quem confirma."
    >
      <Traco
        arte="estrelas"
        sobre="escuro"
        opacidade={0.09}
        className="pointer-events-none absolute inset-0 h-full w-full max-w-none object-cover"
      />

      {/* As bolhas sangram pelos dois lados: a do cliente pela esquerda, a da
          Aurora pela direita. Conversa não tem moldura. */}
      <div className="cascata relative flex flex-col gap-2">
        <span className="-ml-2 max-w-[78%] self-start rounded-r-2xl rounded-l-lg bg-white/[0.09] px-3.5 py-2 text-xs text-white/85">
          tem essa blusa no G?
        </span>
        <span className="-mr-2 max-w-[82%] self-end rounded-l-2xl rounded-r-lg bg-bom-vivo/18 px-3.5 py-2 text-right text-xs text-white/90">
          tem sim! São R$ 79,90. Separo pra você?
        </span>
      </div>

      {/* A proposta não é caixa: é uma faixa com um fio âmbar de um lado.
          E respira — a única animação em laço do sistema, porque proposta
          parada é coisa que espera resposta. */}
      <div className="relative mt-5 mb-6 ml-5 sm:ml-6">
        <div className="pulsa pulsa-atencao rounded-l-norte bg-atencao-vivo/[0.09] py-3 pr-6 pl-4 shadow-[inset_2px_0_0_var(--atencao-vivo)]">
          <span className="mb-1 block text-[10px] font-bold tracking-[0.14em] text-atencao-vivo uppercase">
            esperando você
          </span>
          <p className="max-w-[42ch] text-xs leading-snug text-white/85">
            Camiseta Preto G tem <strong className="text-white">2 peças</strong> e vende 9 por
            semana. Pedir 20 un × R$ 22,40 ={' '}
            <strong className="text-white">R$ 448,00</strong> na Distribuidora Norte?
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="rounded-full bg-bom-vivo px-3.5 py-1 text-[11px] font-bold text-white">
              Confirmar
            </span>
            <span className="text-[11px] text-white/45">Não</span>
          </div>
        </div>
      </div>
    </Banner>
  )
}

/* ═══════════════════════════════════════════════════════════
   B-09 · o painel
   ═══════════════════════════════════════════════════════════ */

const DIAS = [
  38, 62, 55, 71, 48, 30, 92, 22, 58, 60, 35, 40, 44, 51, 68, 33, 47, 54, 49, 41,
  75, 88, 52, 39, 31, 28, 45, 57, 36, 43,
]

export function BannerPainel() {
  const maior = Math.max(...DIAS)
  const iMaior = DIAS.indexOf(maior)

  return (
    <Banner
      tom="noite"
      largura={4}
      titulo="O dia inteiro em uma olhada"
      texto="Quanto entrou, quanto sobrou e o que está parado na prateleira. Escolhe o período e a tela toda se refaz — hoje, sete dias, o mês, ou o mês passado."
    >
      <div className="grid items-end gap-6 px-5 pb-6 sm:px-6 lg:grid-cols-[minmax(0,17rem)_1fr] lg:gap-8">
        {/* Números soltos, separados por fio — a mesma regra do painel real. */}
        <div className="cascata grid grid-cols-2 gap-x-5 gap-y-4">
          {[
            ['Hoje', 'R$ 774,71'],
            ['Média por dia', 'R$ 360,56'],
            ['Ticket médio', 'R$ 96,58'],
            ['Margem', '56%'],
          ].map(([r, v]) => (
            <div key={r} className="flex flex-col border-l border-white/12 pl-3">
              <span className="text-[11px] text-white/45">{r}</span>
              <span className="numero text-xl leading-tight font-bold tracking-tight text-white">
                {v}
              </span>
            </div>
          ))}
        </div>

        {/* O gráfico sangra pela direita: mostra que há mais dia do que cabe. */}
        <div className="-mr-5 flex flex-col gap-2 sm:-mr-6">
          <div className="surge inline-flex w-fit flex-wrap items-baseline gap-x-2.5">
            <span className="text-[11px] font-semibold text-white">sáb, 15/08</span>
            <span className="numero text-sm font-bold text-white">R$ 990,38</span>
            <span className="text-[11px] text-white/55">7 vendas</span>
            <span className="text-[11px] text-white/35">ticket R$ 141,48</span>
          </div>

          <div className="relative flex h-20 items-end gap-px" aria-hidden>
            {/* A linha da média, atrás: é ela que transforma "barra alta" em
                "acima do normal". */}
            <span className="absolute inset-x-0 bottom-[42%] border-t border-dashed border-white/15" />
            {DIAS.map((d, i) => (
              <span
                key={i}
                className={`cresce relative flex-1 rounded-t-sm ${
                  i === iMaior ? 'bg-bom' : 'bg-bom-vivo/70'
                }`}
                style={{
                  height: `${(d / maior) * 100}%`,
                  animationDelay: `${i * 0.02}s`,
                  transformOrigin: 'bottom',
                }}
              />
            ))}
          </div>
          <div className="flex justify-between pr-5 text-[10px] text-white/35 sm:pr-6">
            <span>09/08</span>
            <span>média R$ 372,99</span>
            <span>07/09</span>
          </div>
        </div>
      </div>
    </Banner>
  )
}
