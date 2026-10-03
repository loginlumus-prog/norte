'use client'

// "E para o MEU ramo?" — a pergunta de quem não vende roupa nem sorvete.
// A pessoa toca no ramo dela e vê o que o Norte já traz pronto no cadastro:
// as gavetas (categorias), a grade de variação, o jeito de vender no balcão
// e as funções que a gente liga junto. Tudo vem de `RAMOS` (servidor/modulos.ts)
// pela página — o mesmo que o cadastro semeia; nada é inventado aqui.

import { useState } from 'react'

export type RamoNaVitrine = {
  id: string
  titulo: string
  frase: string
  cor: string
  categorias: string[]
  eixos: { nome: string; opcoes: string[] }[]
  medida: string
  balcao: 'busca' | 'grade'
  funcoes: string[]
}

const MEDIDA: Record<string, string> = {
  UN: 'por unidade',
  KG: 'por quilo, com balança',
  PAR: 'por par',
  M: 'por metro',
  L: 'por litro',
  CX: 'por caixa',
}

export function Ramos({ ramos }: { ramos: RamoNaVitrine[] }) {
  const [id, setId] = useState(ramos[0]!.id)
  const r = ramos.find((x) => x.id === id) ?? ramos[0]!

  return (
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
      <div role="tablist" aria-label="Escolha o seu ramo" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        {ramos.map((x) => {
          const ativo = x.id === r.id
          return (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={ativo}
              aria-controls="ramo-painel"
              onClick={() => setId(x.id)}
              className={`flex shrink-0 items-center gap-3 rounded-[var(--s-raio)] border px-4 py-3 text-left text-[15px] font-bold transition-all lg:py-3.5 ${
                ativo ? 'border-transparent bg-[var(--s-cartao)] shadow-[var(--s-sombra-alta)]' : 'border-[var(--s-borda)] text-[var(--s-tinta-2)] hover:bg-[var(--s-cartao)] hover:text-[var(--s-tinta)]'
              }`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full transition-transform" style={{ background: x.cor, transform: ativo ? 'scale(1.3)' : 'none' }} />
              <span className="whitespace-nowrap">{x.titulo}</span>
              <span aria-hidden className={`ml-auto hidden text-[var(--s-tinta-2)] lg:inline ${ativo ? '' : 'opacity-0'}`}>
                →
              </span>
            </button>
          )
        })}
      </div>

      <div id="ramo-painel" role="tabpanel" key={r.id} className="site-troca-painel site-cartao flex flex-col gap-6 rounded-[var(--s-raio)] p-6 sm:p-8">
        <div>
          <p className="site-olho" style={{ color: r.cor }}>
            {r.titulo}
          </p>
          <p className="mt-3 font-[family-name:var(--font-display)] text-2xl leading-snug font-extrabold text-balance sm:text-[1.7rem]">{r.frase}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-[var(--s-raio)] bg-[var(--s-fundo)] p-4">
            <p className="text-[12px] font-bold text-[var(--s-tinta-2)]">No balcão</p>
            <p className="mt-1 text-[15px] font-bold">{r.balcao === 'grade' ? 'Botões grandes na tela' : 'Bipa o código ou busca pelo nome'}</p>
            <p className="text-[13px] text-[var(--s-tinta-2)]">Vende {MEDIDA[r.medida] ?? 'por unidade'}</p>
          </div>
          <div className="rounded-[var(--s-raio)] bg-[var(--s-fundo)] p-4">
            <p className="text-[12px] font-bold text-[var(--s-tinta-2)]">{r.eixos.length ? 'Variações prontas' : 'Variações'}</p>
            {r.eixos.length ? (
              r.eixos.map((e) => (
                <div key={e.nome} className="mt-1">
                  <p className="text-[15px] font-bold">{e.nome}</p>
                  <p className="text-[13px] text-[var(--s-tinta-2)]">{e.opcoes.length ? e.opcoes.join(' · ') : 'você cadastra os seus'}</p>
                </div>
              ))
            ) : (
              <>
                <p className="mt-1 text-[15px] font-bold">Produto simples</p>
                <p className="text-[13px] text-[var(--s-tinta-2)]">e grade quando precisar</p>
              </>
            )}
          </div>
        </div>

        <div>
          <p className="text-[12px] font-bold text-[var(--s-tinta-2)]">Já abre com estas categorias</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {r.categorias.map((c) => (
              <span key={c} className="rounded-[var(--s-raio)] border border-[var(--s-borda)] px-3 py-1.5 text-[13px] font-semibold">
                {c}
              </span>
            ))}
          </div>
        </div>

        {r.funcoes.length ? (
          <div>
            <p className="text-[12px] font-bold text-[var(--s-tinta-2)]">E liga junto</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {r.funcoes.map((f) => (
                <span
                  key={f}
                  className="rounded-[var(--s-raio)] px-3 py-1.5 text-[13px] font-bold"
                  style={{ background: `color-mix(in srgb, ${r.cor} 12%, transparent)`, color: r.cor }}
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
