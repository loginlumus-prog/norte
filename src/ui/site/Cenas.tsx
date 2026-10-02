// As telinhas da página de venda: o produto funcionando, desenhado em HTML.
//
// Não são capturas de tela: são miniaturas do que a tela de verdade faz, com
// os nomes e os números de uma loja de exemplo (nenhum cliente nosso). Cada
// uma conta uma história curta em laço (ver `.site-passo-N` em site.css) —
// a cliente monta o pedido, o dono manda um áudio, o Farol escreve o roteiro.
//
// Tudo servidor, sem JavaScript: a animação é CSS, e quem pediu menos
// movimento vê a história inteira parada, já no fim.

import type { CSSProperties, ReactNode } from 'react'

const cor = (c: string) => ({ '--cor': c }) as CSSProperties

const BRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/* ── moldura de celular ─────────────────────────────────── */
export function Celular({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative mx-auto w-[270px] rounded-[44px] border border-[var(--s-borda)] bg-[#0b1020] p-[9px] shadow-[var(--s-sombra-alta)] ${className}`}
    >
      <div className="relative h-[540px] overflow-hidden rounded-[36px] bg-[var(--s-cartao)]">
        <span aria-hidden className="absolute top-2 left-1/2 z-20 h-[22px] w-[86px] -translate-x-1/2 rounded-full bg-[#0b1020]" />
        {children}
      </div>
    </div>
  )
}

/* ── o catálogo da loja, no celular da cliente ──────────── */
const SABORES: { nome: string; preco: number; cor: string; inicial: string }[] = [
  { nome: 'Picolé de morango', preco: 4, cor: '#ff7aa2', inicial: 'M' },
  { nome: 'Pote 1 L chocolate', preco: 32, cor: '#8b5a3c', inicial: 'C' },
  { nome: 'Açaí 500 ml', preco: 19.9, cor: '#6d2e8f', inicial: 'A' },
  { nome: 'Casquinha de pistache', preco: 9, cor: '#7cc576', inicial: 'P' },
]

export function CelularCatalogo() {
  return (
    <Celular>
      <div className="flex h-full flex-col">
        <div className="px-4 pt-11 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--s-rosa)] text-sm font-extrabold text-white">S</span>
            <div className="leading-tight">
              <p className="text-[13px] font-extrabold">Sorveteria Exemplo</p>
              <p className="text-[10px] text-[var(--s-tinta-2)]">Loja Centro · aberto até 22h</p>
            </div>
          </div>
          <div className="mt-3 flex gap-1.5 text-[10px] font-bold">
            <span className="rounded-full bg-[var(--s-rosa)] px-2.5 py-1 text-white">Tudo</span>
            <span className="rounded-full border border-[var(--s-borda)] px-2.5 py-1">Picolés</span>
            <span className="rounded-full border border-[var(--s-borda)] px-2.5 py-1">Potes</span>
            <span className="rounded-full border border-[var(--s-borda)] px-2.5 py-1">Açaí</span>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2 px-3 content-start">
          {SABORES.map((s, i) => (
            <div key={s.nome} className="overflow-hidden rounded-2xl border border-[var(--s-borda)] bg-[var(--s-cartao)]">
              <div className="relative flex aspect-square items-center justify-center text-2xl font-extrabold text-white" style={{ background: `linear-gradient(140deg, ${s.cor}, color-mix(in srgb, ${s.cor} 60%, #000))` }}>
                {s.inicial}
                {i < 3 ? (
                  <span className={`site-passo-${i} absolute right-1.5 bottom-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-black text-[#13a05f] shadow`}>
                    ✓
                  </span>
                ) : null}
              </div>
              <div className="p-2">
                <p className="truncate text-[10px] font-bold">{s.nome}</p>
                <p className="text-[11px] font-extrabold">{BRL(s.preco)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="relative px-3 pb-4">
          <div className="site-passo-1 flex items-center justify-between rounded-2xl bg-[var(--s-rosa)] px-4 py-3 text-[12px] font-bold text-white shadow-lg">
            <span>Ver pedido · 3</span>
            <span>{BRL(55.9)}</span>
          </div>
          <div className="site-passo-5 absolute inset-x-3 bottom-4 flex items-center gap-2 rounded-2xl bg-[#13a05f] px-4 py-3 text-[12px] font-bold text-white shadow-lg">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25">✓</span>
            Pedido ENC-7Q2K enviado
          </div>
        </div>
      </div>
    </Celular>
  )
}

/* ── a conversa com o assistente, no WhatsApp do dono ───── */
function Balao({ eu, passo, children, className = '' }: { eu?: boolean; passo: number; children: ReactNode; className?: string }) {
  return (
    <div className={`site-passo-${passo} flex ${eu ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[86%] rounded-2xl px-3 py-2 text-[11.5px] leading-snug shadow-sm ${eu ? 'rounded-br-md bg-[var(--s-zap-eu)]' : 'rounded-bl-md bg-[var(--s-cartao)]'} ${className}`}
      >
        {children}
      </div>
    </div>
  )
}

export function ConversaAssistente({ moldura = true }: { moldura?: boolean }) {
  const corpo = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 bg-[#0f6e47] px-4 pt-11 pb-3 text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-black">N</span>
        <div className="leading-tight">
          <p className="text-[12.5px] font-bold">Assistente da loja</p>
          <p className="text-[10px] opacity-80">online</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 bg-[var(--s-zap)] p-3">
        <Balao eu passo={0}>
          <span className="flex items-center gap-2 text-[#13a05f]">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#13a05f] text-[10px] text-white">▶</span>
            <span className="site-onda flex h-5 items-center gap-[3px]" aria-hidden>
              {[6, 12, 18, 9, 15, 20, 8, 14, 10, 17, 7, 12].map((h, i) => (
                <i key={i} style={{ height: h, animationDelay: `${i * 0.07}s` }} />
              ))}
            </span>
            <span className="text-[10px] text-[var(--s-tinta-2)]">0:06</span>
          </span>
        </Balao>
        <Balao passo={1}>
          <span className="text-[var(--s-tinta-2)]">Ouvi:</span> “comprei agora 10 kg de picanha a 39,90 o quilo”
        </Balao>
        <Balao passo={2} className="border-l-4 border-[#13a05f]">
          <b>Entrada na Loja Centro</b>
          <br />
          10 kg Picanha — R$ 39,90/kg = <b>R$ 399,00</b>
          <br />
          <span className="text-[var(--s-tinta-2)]">Responda SIM para lançar.</span>
        </Balao>
        <Balao eu passo={4}>sim</Balao>
        <Balao passo={5}>
          Feito: entrada de 10 kg de Picanha lançada. <b>Saldo agora: 14 kg.</b>
        </Balao>
        <Balao passo={7}>
          Bom dia! Ontem: <b>R$ 4.812</b> em 63 vendas. Acaba hoje: <b>linguiça toscana</b>. 2 contas vencem.
        </Balao>
      </div>
    </div>
  )
  return moldura ? <Celular>{corpo}</Celular> : corpo
}

/* ── o Farol escrevendo ─────────────────────────────────── */
export function PecasFarol() {
  return (
    <div className="relative mx-auto w-[340px] max-w-full">
      <div className="site-cartao rounded-3xl p-5" style={cor('var(--s-sol)')}>
        <div className="flex items-center justify-between">
          <span className="site-olho text-[var(--s-sol)]">Roteiro de Reels</span>
          <span className="rounded-full bg-[var(--s-sol-claro)] px-2.5 py-1 text-[11px] font-bold text-[var(--s-sol)]">para sábado</span>
        </div>
        <p className="mt-3 text-lg font-extrabold leading-snug">“O picolé que salva o calor de sábado”</p>
        <div className="mt-3 flex flex-col gap-1.5 text-[13px] text-[var(--s-tinta-2)]">
          <p className="site-digita max-w-full">0–3s: close no picolé suando no balcão…</p>
          <p className="site-passo-3">3–8s: a mão tira do freezer, o som do papel.</p>
          <p className="site-passo-4">8–15s: preço na tela e “só hoje, dois por R$ 7”.</p>
        </div>
      </div>
      <div className="site-passo-5 site-cartao absolute -right-3 -bottom-10 w-48 rotate-3 rounded-2xl p-3.5 sm:-right-10">
        <span className="site-olho text-[var(--s-violeta)]">Carrossel</span>
        <div className="mt-2 flex gap-1">
          {['#ff7aa2', '#ffb347', '#7cc576', '#6d4cf0', '#3fa7ff'].map((c) => (
            <span key={c} className="h-10 flex-1 rounded-md" style={{ background: c }} />
          ))}
        </div>
        <p className="mt-2 text-[11px] font-semibold">5 lâminas · “sabores da semana”</p>
      </div>
      <div className="site-passo-6 site-cartao absolute -top-8 -left-3 w-44 -rotate-3 rounded-2xl p-3.5 sm:-left-10">
        <span className="site-olho text-[var(--s-verde)]">Calendário</span>
        <div className="mt-2 grid grid-cols-7 gap-1">
          {Array.from({ length: 21 }, (_, i) => (
            <span
              key={i}
              className="aspect-square rounded-[4px]"
              style={{ background: [2, 5, 9, 12, 16, 19].includes(i) ? 'var(--s-sol)' : 'var(--s-borda)' }}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] font-semibold">6 posts no mês</p>
      </div>
    </div>
  )
}

/* ── a fábrica: ficha técnica, lote e o pedido das lojas ── */
export function FichaFabrica() {
  return (
    <div className="site-cartao w-[340px] max-w-full rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <span className="site-olho text-[var(--s-violeta)]">Ficha técnica</span>
        <span className="rounded-full bg-[var(--s-violeta-claro)] px-2.5 py-1 text-[11px] font-bold text-[var(--s-violeta)]">lote L021025-1</span>
      </div>
      <p className="mt-2 text-lg font-extrabold">Sorvete de morango · 10 L</p>
      <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
        {[
          ['Leite integral', '6 L', 'R$ 33,00'],
          ['Morango', '2 kg', 'R$ 28,00'],
          ['Açúcar', '1,5 kg', 'R$ 7,50'],
          ['Base neutra', '0,3 kg', 'R$ 12,90'],
        ].map(([n, q, v], i) => (
          <li key={n} className={`site-passo-${i} flex justify-between border-b border-[var(--s-borda)] pb-1.5`}>
            <span>
              {n} <span className="text-[var(--s-tinta-2)]">· {q}</span>
            </span>
            <span className="font-semibold tabular-nums">{v}</span>
          </li>
        ))}
      </ul>
      <div className="site-passo-4 mt-3 flex items-center justify-between rounded-2xl bg-[var(--s-violeta-claro)] px-4 py-2.5 text-[13px]">
        <span className="font-semibold text-[var(--s-violeta)]">Custo por litro</span>
        <span className="text-base font-extrabold tabular-nums">R$ 8,14</span>
      </div>
      <div className="site-passo-6 mt-3 rounded-2xl border border-[var(--s-borda)] p-3 text-[12px]">
        <p className="font-bold">Pedido da Loja Praia → Fábrica</p>
        <p className="text-[var(--s-tinta-2)]">12 potes morango · 8 chocolate · 20 picolés</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--s-borda)]">
          <div className="site-barra-x h-full w-3/4 rounded-full bg-[var(--s-violeta)]" />
        </div>
      </div>
    </div>
  )
}

/* ── a planilha velha entrando no Norte ──────────────────── */
export function PlanilhaParaNorte() {
  const linhas = [
    ['CAMISETA BÁSICA P', '49,90', '12'],
    ['CALÇA JEANS 38', '139,00', '5'],
    ['VESTIDO FLORAL M', '159,90', '3'],
    ['BERMUDA SARJA 40', '89,90', '9'],
  ]
  return (
    <div className="grid w-full items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
      <div className="site-cartao overflow-hidden rounded-2xl text-[11.5px]">
        <div className="flex items-center gap-2 border-b border-[var(--s-borda)] bg-[#e7f6ec] px-3 py-2 font-bold text-[#1d6f42]">
          <span className="rounded bg-[#1d6f42] px-1.5 text-[10px] text-white">X</span> produtos_sistema_antigo.xlsx
        </div>
        <table className="w-full tabular-nums">
          <thead className="text-left text-[var(--s-tinta-2)]">
            <tr>
              <th className="px-3 py-1.5 font-semibold">DESCRICAO</th>
              <th className="px-3 py-1.5 font-semibold">PR_VENDA</th>
              <th className="px-3 py-1.5 font-semibold">SALDO</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className="border-t border-[var(--s-borda)]">
                {l.map((c, j) => (
                  <td key={j} className="px-3 py-1.5">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div aria-hidden className="flex flex-row items-center justify-center gap-1 text-[var(--s-azul)] md:flex-col">
        <span className="site-pulsa flex h-12 w-12 items-center justify-center rounded-full bg-[var(--s-azul)] text-lg font-black text-white" style={cor('var(--s-azul)')}>
          →
        </span>
        <span className="text-[11px] font-bold">a IA lê as colunas</span>
      </div>
      <div className="site-cartao rounded-2xl p-4 text-[12px]">
        <p className="site-olho text-[var(--s-azul)]">No Norte</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {[
            ['DESCRICAO', 'Nome do produto'],
            ['PR_VENDA', 'Preço à vista'],
            ['SALDO', 'Estoque da loja'],
          ].map(([de, para], i) => (
            <li key={de} className={`site-passo-${i} flex items-center justify-between gap-2 rounded-xl bg-[var(--s-azul-claro)] px-3 py-2`}>
              <span className="font-mono text-[10.5px] text-[var(--s-tinta-2)]">{de}</span>
              <span className="font-bold">{para}</span>
            </li>
          ))}
        </ul>
        <div className="site-passo-4 mt-3 rounded-xl bg-[#13a05f] px-3 py-2 text-center font-bold text-white">312 produtos prontos · 0 repetidos</div>
      </div>
    </div>
  )
}

/* ── miniaturas do bento ────────────────────────────────── */
export function MiniBalcao() {
  return (
    <div className="site-cartao rounded-2xl p-4 text-[12px]">
      {[
        ['Blusa Ana — M · Azul', '89,90'],
        ['Calça Cargo — 40', '139,00'],
        ['Cinto couro', '59,90'],
      ].map(([n, v], i) => (
        <div key={n} className={`site-passo-${i} flex justify-between border-b border-[var(--s-borda)] py-1.5`}>
          <span>{n}</span>
          <span className="font-semibold tabular-nums">R$ {v}</span>
        </div>
      ))}
      <div className="mt-2 flex items-end justify-between">
        <span className="text-[var(--s-tinta-2)]">Total</span>
        <span className="text-xl font-extrabold tabular-nums">R$ 288,80</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10.5px] font-bold">
        {['Dinheiro', 'Pix', 'Débito', 'Crédito'].map((f, i) => (
          <span key={f} className={`rounded-lg border py-1.5 ${i === 1 ? 'site-passo-3 border-[var(--s-azul)] bg-[var(--s-azul-claro)] text-[var(--s-azul)]' : 'border-[var(--s-borda)]'}`}>
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}

export function MiniGrafico({ cor: c = 'var(--s-azul)', baixo = false }: { cor?: string; baixo?: boolean }) {
  const barras = [38, 52, 44, 66, 58, 74, 62, 88, 70, 96, 84, 100]
  return (
    <div className={`flex items-end ${baixo ? 'h-10 gap-1' : 'h-28 gap-1.5'}`}>
      {barras.map((h, i) => (
        <span
          key={i}
          className="site-barra flex-1 rounded-t-md"
          style={{ height: `${h}%`, background: i === barras.length - 1 ? c : `color-mix(in srgb, ${c} ${30 + i * 4}%, transparent)`, '--i': i } as CSSProperties}
        />
      ))}
    </div>
  )
}

export function MiniEstoque() {
  return (
    <div className="flex flex-col gap-2 text-[12px]">
      {[
        { n: 'Picanha', s: '14 kg', p: 70, c: 'var(--s-verde)', a: 'ok' },
        { n: 'Linguiça toscana', s: '2 kg', p: 12, c: 'var(--s-rosa)', a: 'acaba hoje' },
        { n: 'Fraldinha', s: '6 kg', p: 34, c: 'var(--s-sol)', a: 'pedir até sexta' },
      ].map((x) => (
        <div key={x.n} className="site-cartao rounded-xl px-3 py-2">
          <div className="flex justify-between">
            <span className="font-semibold">{x.n}</span>
            <span className="tabular-nums">{x.s}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--s-borda)]">
              <div className="site-barra-x h-full rounded-full" style={{ width: `${x.p}%`, background: x.c }} />
            </div>
            <span className="text-[10.5px] font-bold" style={{ color: x.c }}>
              {x.a}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function MiniSemInternet() {
  return (
    <div className="relative h-24 text-[12px]">
      <div className="site-passo-0 absolute inset-x-0 top-0 flex items-center gap-2 rounded-xl bg-[#fff4d6] px-3 py-2.5 font-semibold text-[#8a5a00]">
        <span className="h-2 w-2 rounded-full bg-[#e0a000]" /> Sem internet · 2 vendas guardadas no aparelho
      </div>
      <div className="site-passo-5 absolute inset-x-0 bottom-0 flex items-center gap-2 rounded-xl bg-[var(--s-verde-claro)] px-3 py-2.5 font-semibold text-[var(--s-verde)]">
        <span className="h-2 w-2 rounded-full bg-[var(--s-verde)]" /> A internet voltou · as 2 vendas subiram
      </div>
    </div>
  )
}

export function MiniEquipe() {
  return (
    <div className="flex flex-col gap-2 text-[12px]">
      {[
        { n: 'Júlia', m: 92, e: 5 },
        { n: 'Rafael', m: 74, e: 4 },
        { n: 'Bia', m: 58, e: 3 },
      ].map((p, i) => (
        <div key={p.n} className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black text-white" style={{ background: ['#6d4cf0', '#e83e7a', '#f2780c'][i] }}>
            {p.n[0]}
          </span>
          <div className="flex-1">
            <div className="flex justify-between">
              <span className="font-semibold">{p.n}</span>
              <span className="text-[var(--s-sol)]" aria-label={`${p.e} estrelas`}>
                {'★'.repeat(p.e)}
                <span className="text-[var(--s-borda)]">{'★'.repeat(5 - p.e)}</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--s-borda)]">
              <div className="site-barra-x h-full rounded-full bg-[var(--s-violeta)]" style={{ width: `${p.m}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
