'use client'

// "Feito para o seu ramo": as fichas dos ramos e o que muda em cada um.
//
// ── por que a fonte é `RAMOS`, e não um texto de venda ───────
// A página antiga tinha cinco cenas desenhadas e uma frase por ramo, escrita
// à mão. Frase à mão é onde a promessa escorrega ("a venda sai por quilo" num
// ramo que o sistema semeia em unidade). Aqui não há frase: o painel lê
// `servidor/modulos.ts` — a MESMA tabela que o cadastro inicial usa para
// semear a empresa. O que aparece é o que a pessoa vai encontrar pronto no
// primeiro dia: os eixos de variação com as opções, a medida, o jeito do
// balcão, as categorias, os módulos já marcados e o que o assistente já sabe.
//
// Nada disso é caminho no código — é semente, e o dono muda depois. O
// rodapé do painel diz isso, porque é a pergunta seguinte de quem tem um
// negócio misto.
//
// ── a amostra da grade ───────────────────────────────────────
// Os eixos e as opções são os da tabela; os SALDOS na amostra são de
// exemplo, e a legenda diz. A amostra existe porque "Tamanho: PP P M G GG ·
// Cor: Preto Branco" é abstrato, e a grade cruzada com saldo em cada casa é
// a tela que a pessoa vai usar — um cadastro, não trinta.
//
// ── teclado ──────────────────────────────────────────────────
// É o padrão de abas: as fichas são `tab`, o painel é `tabpanel`, as setas
// andam entre as fichas e já trocam (ativação automática — o painel é leve e
// não carrega nada). Só a ficha ativa entra no Tab; as outras se alcançam
// pelas setas, que é o que o leitor de tela anuncia.
//
// ── endereço ─────────────────────────────────────────────────
// `#ramo-calcados` abre direto aquele ramo. É o que o rodapé usa.

import { useEffect, useRef, useState } from 'react'
import { MODULOS, RAMOS, type Ramo } from '@/servidor/modulos'
import { Rotulo } from './Pecas'

// "Outro" começa vazio de propósito — mostrar ele seria mostrar um painel sem
// nada. Fica fora da fileira.
const LISTA: Ramo[] = (Object.keys(RAMOS) as Ramo[]).filter((r) => r !== 'outro')

const MEDIDA: Record<string, string> = {
  UN: 'por unidade',
  KG: 'por quilo',
  PAR: 'por par',
}

// O nome curto da ficha. O título inteiro ("Roupas e acessórios") entra no
// painel; na ficha, o que cabe numa linha no celular.
const CURTO: Partial<Record<Ramo, string>> = {
  roupa: 'Moda',
  bijuteria: 'Bijuteria',
  sorveteria: 'Sorveteria e açaí',
  lanchonete: 'Lanchonete',
  padaria: 'Padaria',
  mercearia: 'Mercearia',
  distribuidora: 'Distribuidora',
  construcao: 'Construção',
}

export function Ramos() {
  const [ativo, setAtivo] = useState<Ramo>('roupa')
  const [mexeu, setMexeu] = useState(false)
  const fichas = useRef<Map<Ramo, HTMLButtonElement>>(new Map())

  // O endereço escolhe o ramo: na carga e quando alguém clica num link
  // `#ramo-…` da própria página.
  useEffect(() => {
    const ler = () => {
      const h = window.location.hash.replace('#ramo-', '')
      if (h && (LISTA as string[]).includes(h)) {
        setAtivo(h as Ramo)
        setMexeu(true)
      }
    }
    ler()
    window.addEventListener('hashchange', ler)
    return () => window.removeEventListener('hashchange', ler)
  }, [])

  function escolher(r: Ramo, focar = false) {
    setAtivo(r)
    setMexeu(true)
    if (focar) fichas.current.get(r)?.focus()
  }

  function teclas(e: React.KeyboardEvent, r: Ramo) {
    const i = LISTA.indexOf(r)
    const alvo =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? LISTA[(i + 1) % LISTA.length]
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? LISTA[(i - 1 + LISTA.length) % LISTA.length]
          : e.key === 'Home'
            ? LISTA[0]
            : e.key === 'End'
              ? LISTA[LISTA.length - 1]
              : undefined
    if (!alvo) return
    e.preventDefault()
    escolher(alvo, true)
  }

  const r = RAMOS[ativo]

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Ramos" className="flex flex-wrap gap-2">
        {LISTA.map((k) => {
          const sim = k === ativo
          return (
            <button
              key={k}
              id={`ramo-${k}`}
              ref={(el) => {
                if (el) fichas.current.set(k, el)
              }}
              type="button"
              role="tab"
              aria-selected={sim}
              aria-controls="painel-ramo"
              tabIndex={sim ? 0 : -1}
              onClick={() => escolher(k)}
              onKeyDown={(e) => teclas(e, k)}
              className={
                'scroll-mt-24 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ' +
                (sim
                  ? 'border-marca bg-marca text-marca-tinta shadow-norte'
                  : 'border-borda bg-superficie text-tinta-2 hover:border-tinta-3 hover:text-tinta')
              }
            >
              {CURTO[k] ?? RAMOS[k].titulo}
            </button>
          )
        })}
      </div>

      <div
        id="painel-ramo"
        role="tabpanel"
        aria-labelledby={`ramo-${ativo}`}
        key={ativo}
        className={
          'grid gap-6 rounded-2xl border border-borda bg-superficie p-5 shadow-norte sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10 ' +
          (mexeu ? 'aba-entra' : '')
        }
      >
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-2xl">{r.titulo}</h3>
            <p className="mt-1 text-[15px] text-tinta-2">
              O que o Norte já deixa pronto quando você escolhe este ramo no cadastro.
            </p>
          </div>

          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Fato rotulo="Variações">
              {r.eixos.length === 0
                ? 'Sem grade — cada produto é um item'
                : r.eixos.map((e) => e.nome).join(' e ')}
            </Fato>
            <Fato rotulo="Vende">{MEDIDA[r.medida] ?? r.medida}</Fato>
            <Fato rotulo="Balcão">
              {r.balcao === 'grade' ? 'Por botões grandes, sem etiqueta' : 'Bipando a etiqueta'}
            </Fato>
            <Fato rotulo="Já vem ligado">
              {r.sugere.length === 0
                ? 'Só o essencial'
                : r.sugere.map((m) => MODULOS[m].titulo).join(', ')}
            </Fato>
          </dl>

          <div>
            <Rotulo>Categorias criadas</Rotulo>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {r.categorias.map((c) => (
                <li
                  key={c}
                  className="rounded-md bg-superficie-2 px-2 py-1 text-[12.5px] font-medium text-tinta-2"
                >
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Amostra ramo={ativo} />

          {/* O manual do assistente é o campo que evita vexame no dia um: ele
              quase sempre termina dizendo o que NÃO fazer naquele ramo. É
              texto da tabela, sem uma vírgula mudada. */}
          <figure className="rounded-xl border border-borda-suave bg-fundo p-4">
            <figcaption>
              <Rotulo>O que o assistente já sabe no primeiro dia</Rotulo>
            </figcaption>
            <blockquote className="mt-2 text-[13.5px] leading-relaxed text-tinta-2">
              {r.manual}
            </blockquote>
          </figure>
        </div>

        <p className="text-[12.5px] text-tinta-3 lg:col-span-2">
          Nada disso prende: é o ponto de partida. Loja de roupa com café dentro cria o que faltar
          em Configurações — o ramo escolhe o que vem semeado, nunca o que o sistema deixa fazer.
        </p>
      </div>
    </div>
  )
}

function Fato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-borda-suave pt-3">
      <dt>
        <Rotulo>{rotulo}</Rotulo>
      </dt>
      <dd className="text-[15px] font-semibold text-tinta">{children}</dd>
    </div>
  )
}

// Um número de exemplo, estável entre servidor e navegador: sai da posição da
// casa, não de `Math.random` — número sorteado mudaria entre a página que o
// servidor manda e a que o navegador monta, e o React reclamaria.
const saldo = (i: number, j: number) => ((i * 7 + j * 5 + 3) % 9) - 1

/**
 * A grade como ela aparece no produto.
 *
 * Dois eixos → a tabela cruzada (a linha é um, a coluna é o outro).
 * Um eixo  → uma fileira de casas, uma por opção.
 * Nenhum   → o produto simples, com a medida.
 * Eixo sem opção (o Sabor da sorveteria nasce vazio) → as casas pontilhadas
 * dizem "você cria as suas", em vez de o painel inventar sabores.
 */
function Amostra({ ramo }: { ramo: Ramo }) {
  const r = RAMOS[ramo]
  const [um, dois] = r.eixos

  return (
    <div className="rounded-xl border border-borda bg-superficie p-4">
      <div className="flex items-baseline justify-between gap-3">
        <Rotulo>{um ? 'A grade de um produto' : 'Um produto'}</Rotulo>
        <span className="text-[11px] text-tinta-3">saldos de exemplo</span>
      </div>

      {um && dois && um.opcoes.length > 0 && dois.opcoes.length > 0 ? (
        <div className="mt-3 overflow-hidden">
          <table className="w-full table-fixed border-collapse text-center text-[12px]">
            <thead>
              <tr>
                <th className="w-[4.5rem] pb-1.5 text-left text-[10.5px] font-medium text-tinta-3">
                  {dois.nome} \ {um.nome}
                </th>
                {um.opcoes.map((o) => (
                  <th key={o} className="pb-1.5 text-[11px] font-semibold text-tinta-2">
                    {o}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dois.opcoes.map((c, i) => (
                <tr key={c} className="border-t border-borda-suave">
                  <th className="truncate py-1.5 text-left text-[11.5px] font-medium text-tinta-2">
                    {c}
                  </th>
                  {um.opcoes.map((o, j) => {
                    const n = saldo(i, j)
                    return (
                      <td key={o} className="py-1">
                        <span
                          className={
                            'numero inline-block min-w-7 rounded px-1 py-0.5 font-semibold ' +
                            (n <= 0
                              ? 'bg-critico-fundo text-critico'
                              : n <= 2
                                ? 'bg-atencao-fundo text-atencao'
                                : 'bg-superficie-2 text-tinta')
                          }
                        >
                          {Math.max(0, n)}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : um ? (
        <div className="mt-3">
          <p className="text-[11.5px] font-medium text-tinta-3">{um.nome}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {um.opcoes.length > 0
              ? um.opcoes.map((o, j) => {
                  const n = saldo(1, j)
                  return (
                    <li
                      key={o}
                      className="flex min-w-14 flex-col items-center rounded-lg border border-borda-suave px-2 py-1.5"
                    >
                      <span className="text-[12px] font-semibold text-tinta">{o}</span>
                      <span
                        className={
                          'numero text-[11px] font-semibold ' +
                          (n <= 0 ? 'text-critico' : n <= 2 ? 'text-atencao' : 'text-tinta-3')
                        }
                      >
                        {n <= 0 ? 'acabou' : `${n} ${r.medida === 'PAR' ? 'pares' : 'un'}`}
                      </span>
                    </li>
                  )
                })
              : [0, 1, 2, 3].map((k) => (
                  <li
                    key={k}
                    className="grid h-12 w-20 place-items-center rounded-lg border border-dashed border-borda text-[11px] text-tinta-3"
                  >
                    {k === 0 ? `+ ${um.nome.toLowerCase()}` : ''}
                  </li>
                ))}
          </ul>
          {um.opcoes.length === 0 && (
            <p className="mt-2 text-[12px] text-tinta-3">
              O eixo nasce vazio: as opções são as suas.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-superficie-2 px-3 py-2.5">
          <span className="flex flex-col">
            <span className="text-[13px] font-semibold text-tinta">{r.categorias[0] ?? 'Produto'}</span>
            <span className="text-[11.5px] text-tinta-3">
              {r.balcao === 'grade' ? 'um botão no balcão' : 'uma etiqueta'} · vendido{' '}
              {MEDIDA[r.medida] ?? r.medida}
            </span>
          </span>
          <span className="numero text-[13px] font-semibold text-tinta-2">
            {r.medida === 'KG' ? '0,480 kg' : '× 1'}
          </span>
        </div>
      )}
    </div>
  )
}
