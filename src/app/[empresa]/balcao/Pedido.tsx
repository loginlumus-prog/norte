'use client'

// O pedido do balcão simples: os itens, o total, e os três passos para fechar.
//
// ── os três passos ───────────────────────────────────────────
// 1. COMO VAI PAGAR. Quatro botões grandes — Dinheiro, Pix, Débito, Crédito —
//    e embaixo, menores, os que dependem de algo (crediário, com módulo e
//    cliente; vale-troca, com o papel na mão). Tocar numa forma já cobre o
//    total. Tocar em outra TROCA a forma, em vez de somar — "ah, vai ser no
//    Pix" é o gesto mais comum depois de já ter tocado em Dinheiro.
// 2. CONFIRA. No dinheiro: quanto recebeu, com as notas prováveis a um toque,
//    e o troco em letra grande — é o número que vai ser contado na gaveta.
//    No cartão e no Pix: o valor, e um "dividir" para quem paga metade em
//    cada. No crediário: em quantas vezes.
// 3. CONCLUIR. Verde, enorme, e sempre no mesmo lugar. Quando não dá para
//    concluir, o motivo está escrito embaixo dele — botão apagado sem motivo
//    é a pessoa tocando cinco vezes achando que travou.
//
// Depois de escolhida, a forma ENCOLHE para uma linha ("✓ Pix · trocar") e o
// passo 2 ocupa o lugar dela. É isso que faz o pedido caber de pé num tablet
// deitado sem esconder o botão de concluir.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Aviso, Botao, Situacao, cx } from '@/ui/base'
import { ROTULO_TABELA } from '@/servidor/preco'
import { brl, cent, linhaCent, notasSugeridas, passoAtual, precoDe } from './conta'
import { FORMAS, tituloDaForma, type Linha, type Venda } from './useVenda'
import { fracionado, partesDaDescricao, UNIDADE } from './vitrine'

/* ── os itens ─────────────────────────────────────────────── */

export function Itens({ v }: { v: Venda }) {
  if (v.carrinho.length === 0) {
    return (
      // Deitado, e não em pé: o vazio é o estado mais comum do balcão (toda
      // venda começa nele), e a altura que ele ocupar é tirada do pagamento.
      <div className="flex h-full items-center justify-center gap-3 px-2 py-5">
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-superficie-2 text-tinta-3">
          <svg viewBox="0 0 24 24" className="size-6" fill="none">
            <path d="M4 5h2l2.2 10.2a1 1 0 001 .8h8.6a1 1 0 001-.76L20.5 9H7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="10" cy="19.5" r="1.3" fill="currentColor" />
            <circle cx="17" cy="19.5" r="1.3" fill="currentColor" />
          </svg>
        </span>
        <span className="flex flex-col">
          <span className="text-base font-semibold text-tinta">Pedido vazio</span>
          <span className="text-sm text-tinta-2">Toque num produto ou bipe a etiqueta.</span>
        </span>
      </div>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-borda-suave">
      {v.carrinho.map((l) => (
        <ItemDoPedido key={l.id} l={l} v={v} />
      ))}
    </ul>
  )
}

function ItemDoPedido({ l, v }: { l: Linha; v: Venda }) {
  const { nome, detalhe } = partesDaDescricao(l.descricao)
  const pedaco = fracionado(l.medida)
  const un = UNIDADE[l.medida] ?? l.medida.toLowerCase()
  const passou = !l.avulso && l.quantidade > l.saldo
  const unit = precoDe(l, v.conta.tabela)
  const botao =
    'flex size-11 shrink-0 items-center justify-center rounded-xl border border-borda bg-superficie text-tinta hover:bg-superficie-2 active:scale-95 touch-manipulation'

  return (
    <li className={cx('flex flex-col gap-2 py-3', passou && '-mx-2 rounded-xl bg-atencao-fundo/50 px-2')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] leading-snug font-semibold text-tinta">{nome}</span>
          <span className="text-sm text-tinta-3">
            {detalhe && <span className="text-tinta-2">{detalhe} · </span>}
            {l.avulso && <span className="text-tinta-2">avulso · </span>}
            <span className="numero">
              {brl(unit)}
              {l.medida !== 'UN' && `/${un}`}
            </span>
          </span>
        </div>
        <span className="numero pt-0.5 text-base font-bold text-tinta">{brl(linhaCent(l, v.conta.tabela) / 100)}</span>
      </div>

      <div className="flex items-center gap-2">
        {pedaco ? (
          <label className="flex h-11 items-center gap-1.5 rounded-xl border border-borda bg-superficie px-3 focus-within:border-marca">
            <input
              type="number"
              min={0}
              step={0.001}
              inputMode="decimal"
              value={l.quantidade}
              onChange={(e) => v.mudarQtd(l.id, Number(e.target.value))}
              onFocus={(e) => e.target.select()}
              onBlur={() => l.quantidade <= 0 && v.tirar(l.id)}
              aria-label={`Quanto de ${l.descricao}, em ${un}`}
              className="numero w-20 bg-transparent text-center text-lg font-semibold text-tinta focus:outline-none"
            />
            <span className="text-sm font-semibold text-tinta-3">{un}</span>
          </label>
        ) : (
          <>
            {/* No 1, o "−" vira lixeira: é o mesmo lugar e o mesmo gesto, mas
                a pessoa VÊ que o próximo toque tira o item, em vez de descobrir
                depois que ele sumiu. */}
            {l.quantidade <= 1 ? (
              <button type="button" onClick={() => v.tirar(l.id)} aria-label={`Tirar ${l.descricao} do pedido`} className={cx(botao, 'text-critico hover:bg-critico-fundo')}>
                <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
                  <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.3a1 1 0 001 .9h4.6a1 1 0 001-.9L14 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <button type="button" onClick={() => v.mudarQtd(l.id, l.quantidade - 1)} aria-label={`Menos um de ${l.descricao}`} className={botao}>
                <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
                  <path d="M5 10h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={l.quantidade}
              onChange={(e) => v.mudarQtd(l.id, Math.floor(Number(e.target.value)))}
              onFocus={(e) => e.target.select()}
              onBlur={() => l.quantidade <= 0 && v.tirar(l.id)}
              aria-label={`Quantidade de ${l.descricao}`}
              className="numero h-11 w-14 rounded-xl border border-borda bg-superficie text-center text-lg font-bold text-tinta focus:border-marca focus:outline-none"
            />
            <button type="button" onClick={() => v.mudarQtd(l.id, l.quantidade + 1)} aria-label={`Mais um de ${l.descricao}`} className={botao}>
              <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
                <path d="M10 5v10M5 10h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </>
        )}
        {pedaco && (
          <button type="button" onClick={() => v.tirar(l.id)} aria-label={`Tirar ${l.descricao} do pedido`} className={cx(botao, 'text-critico hover:bg-critico-fundo')}>
            <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
              <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.3a1 1 0 001 .9h4.6a1 1 0 001-.9L14 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {passou && (
          <span className="ml-auto text-right text-xs font-semibold text-atencao">
            {l.saldo <= 0 ? 'sem estoque' : `só tem ${l.saldo}`}
          </span>
        )}
      </div>
    </li>
  )
}

/* ── o total ──────────────────────────────────────────────── */

export function Total({ v }: { v: Venda }) {
  const c = v.conta
  const temAjuste = v.desconto > 0 || v.pontosUsar > 0
  return (
    <div className="flex flex-col gap-1.5">
      {temAjuste && (
        <div className="flex flex-col gap-0.5 text-sm text-tinta-2">
          <span className="flex justify-between">
            <span>Subtotal</span>
            <span className="numero">{brl(c.totalCent / 100)}</span>
          </span>
          {v.desconto > 0 && (
            <span className="flex justify-between">
              <span>Desconto</span>
              <span className="numero">− {brl(cent(v.desconto) / 100)}</span>
            </span>
          )}
          {v.pontosUsar > 0 && (
            <span className="flex items-center justify-between gap-2">
              <span>
                {v.pontosUsar} pontos{' '}
                <button type="button" onClick={() => v.setPontosUsar(0)} className="text-xs font-semibold text-tinta-3 underline-offset-2 hover:text-tinta hover:underline">
                  não usar
                </button>
              </span>
              <span className="numero">− {brl(v.pontosCent / 100)}</span>
            </span>
          )}
        </div>
      )}

      <div className="flex items-end justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-tinta-2">Total</span>
          {c.temEscada && <span className="text-xs text-tinta-3">preço {ROTULO_TABELA[c.tabela]}</span>}
        </span>
        {/* O número que se fala em voz alta. aria-live: quem usa leitor de tela
            ouve o total mudar a cada item, como quem enxerga vê. */}
        <span aria-live="polite" aria-atomic="true" className="numero text-[2.5rem] leading-none font-extrabold tracking-tight text-tinta [@media(max-height:820px)]:text-[2.125rem]">
          <span className="sr-only">Total </span>
          {brl(c.aPagarCent / 100)}
        </span>
      </div>

      {/* A escada: "à vista sai por tanto", sem fazer conta. */}
      {c.temEscada && v.carrinho.length > 0 && (
        <p className="flex flex-wrap justify-end gap-x-3 text-xs text-tinta-3">
          {(['vista', 'cartao', 'crediario'] as const).map((t) => (
            <span key={t} className={cx(t === c.tabela && 'font-semibold text-tinta-2')}>
              {ROTULO_TABELA[t]} <span className="numero">{brl(c.escada[t] / 100)}</span>
            </span>
          ))}
        </p>
      )}

      {/* A oferta de pontos aparece sozinha, com o número pronto: ninguém no
          balcão abre outra tela para descobrir quanto os pontos valem. */}
      {v.oferta?.pode && v.pontosUsar === 0 && (
        <button
          type="button"
          onClick={() => v.oferta && v.setPontosUsar(v.oferta.pontos)}
          className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-bom-borda bg-bom-fundo px-3 py-2 text-left"
        >
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-tinta">Tem {v.oferta.saldo} pontos</span>
            <span className="text-xs text-tinta-2">dá {brl(v.oferta.centavos / 100)} de desconto</span>
          </span>
          <span className="shrink-0 text-sm font-bold text-bom">Usar</span>
        </button>
      )}
    </div>
  )
}

/* ── o pagamento ──────────────────────────────────────────── */

function Passo({ n, titulo, atual, children }: { n: 1 | 2; titulo: ReactNode; atual: number; children?: ReactNode }) {
  const feito = atual > n
  const agora = atual === n
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm font-semibold text-tinta">
        <span
          aria-hidden
          className={cx(
            'flex size-6 items-center justify-center rounded-full text-xs font-bold',
            feito ? 'bg-bom-vivo text-white' : agora ? 'bg-marca text-marca-tinta' : 'bg-superficie-3 text-tinta-3',
          )}
        >
          {feito ? '✓' : n}
        </span>
        <span className="sr-only">Passo {n}{feito ? ', feito' : ''}: </span>
        {titulo}
      </span>
      {children}
    </div>
  )
}

const ICONE: Record<string, ReactNode> = {
  DINHEIRO: (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none">
      <rect x="2.5" y="6" width="19" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 9.5v5M18 9.5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  PIX: (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none">
      <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12 12 3.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 12h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  DEBITO: (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2.5 9.5h19" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 14.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  CREDITO: (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2.5 9.5h19" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15 14.5h3M6 14.5h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
}

export function Pagamento({
  v,
  crediario,
  aoPedirCliente,
}: {
  v: Venda
  crediario: { maxParcelas: number } | null
  /** Crediário sem cliente: em vez de recusar, abre a escolha de cliente. */
  aoPedirCliente: () => void
}) {
  const c = v.conta
  const semItens = v.carrinho.length === 0
  const formas = v.pagos.filter((p) => p.forma !== 'VALE')
  const vales = v.pagos.filter((p) => p.forma === 'VALE')
  const passo = passoAtual({
    itens: v.carrinho.length,
    pagos: v.pagos.length,
    faltaCent: c.faltaCent,
    sobrouSemDinheiro: c.sobrouSemDinheiro,
  })
  // O passo 1 aparece enquanto não há forma, ou enquanto falta receber algo
  // (o resto de um pagamento dividido, ou o que o vale não cobriu).
  const mostrarFormas = formas.length === 0 || c.faltaCent > 0
  const [dividindo, setDividindo] = useState(false)

  function escolherForma(forma: string) {
    const ja = formas.some((p) => p.forma === forma)
    // Tocar na forma que já é a única desmarca: é o "errei" mais barato.
    if (ja && formas.length === 1) {
      v.setPagos(vales)
      setDividindo(false)
      return
    }
    if (ja) return
    // Dividindo e ainda falta: esta forma paga o resto.
    if (formas.length > 0 && c.faltaCent > 0) v.pagarCom(forma)
    else v.pagarSoCom(forma)
  }

  function crediarioToque() {
    if (!crediario) return
    if (!v.cliente) {
      aoPedirCliente()
      return
    }
    if (formas.some((p) => p.forma === 'CREDIARIO') && formas.length === 1) {
      v.setPagos(vales)
      return
    }
    v.pagarNoCrediario(v.parcelasN, formas.length === 0 || c.faltaCent <= 0)
  }

  return (
    <div className="flex flex-col gap-3">
      {mostrarFormas ? (
        <>
          {/* As formas que dependem de algo (crediário, com módulo e cliente;
              vale-troca, com o papel na mão) vão na linha do título, menores:
              são exceção, e a altura é dos itens do pedido. */}
          <Passo
            n={1}
            atual={passo}
            titulo={
              formas.length > 0 || vales.length > 0 ? (
                <span>
                  Falta <span className="numero">{brl(c.faltaCent / 100)}</span>
                  <span className="hidden sm:inline"> — como paga o resto?</span>
                </span>
              ) : (
                'Como vai pagar?'
              )
            }
          >
            <span className="flex shrink-0 gap-1">
              {crediario && (
                <button
                  type="button"
                  onClick={crediarioToque}
                  disabled={semItens}
                  title={v.cliente ? 'Vender no crediário' : 'Crediário precisa de cliente: toque para escolher'}
                  className="min-h-10 rounded-lg border border-borda bg-superficie px-2.5 text-xs font-semibold text-tinta hover:bg-superficie-2 disabled:opacity-45"
                >
                  Crediário
                </button>
              )}
              {!v.vale.aberto && (
                <button
                  type="button"
                  onClick={() => v.vale.setAberto(true)}
                  disabled={semItens}
                  className="min-h-10 rounded-lg border border-borda bg-superficie px-2.5 text-xs font-semibold text-tinta hover:bg-superficie-2 disabled:opacity-45"
                >
                  Vale-troca
                </button>
              )}
            </span>
          </Passo>
          <div role="group" aria-label="Forma de pagamento" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {FORMAS.map((f) => {
              const ativa = formas.some((p) => p.forma === f.chave)
              return (
                <button
                  key={f.chave}
                  ref={f.chave === 'DINHEIRO' ? v.primeiraForma : undefined}
                  type="button"
                  onClick={() => escolherForma(f.chave)}
                  disabled={semItens}
                  aria-pressed={ativa}
                  className={cx(
                    'relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-2 text-sm font-semibold transition-colors touch-manipulation',
                    // Tela baixa (notebook de 768px, tablet deitado com a
                    // moldura): o ícone vai para o lado e a altura é dos itens.
                    '[@media(max-height:820px)]:min-h-11 [@media(max-height:820px)]:flex-row [@media(max-height:820px)]:gap-2',
                    ativa
                      ? 'border-marca bg-marca-suave text-tinta'
                      : 'border-borda bg-superficie text-tinta hover:border-marca/50 hover:bg-superficie-2',
                    'disabled:cursor-not-allowed disabled:opacity-45',
                  )}
                >
                  <span className={cx(ativa ? 'text-marca' : 'text-tinta-2')}>{ICONE[f.chave]}</span>
                  {f.titulo}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <Passo
          n={1}
          atual={passo}
          titulo={
            <span>
              {formas.map((p) => tituloDaForma(p)).join(' + ')}
              {vales.length > 0 && ' + vale'}
            </span>
          }
        >
          <button
            type="button"
            onClick={() => {
              v.setPagos(vales)
              setDividindo(false)
            }}
            className="min-h-9 rounded-lg px-2 text-sm font-semibold text-marca hover:bg-marca-suave"
          >
            Trocar
          </button>
        </Passo>
      )}

      {/* O vale: o código do papel. */}
      {v.vale.aberto && (
        <div className="flex flex-col gap-2 rounded-xl border border-borda-suave bg-superficie-2 p-3">
          <label htmlFor="vale-simples" className="text-sm font-semibold text-tinta">
            Código do vale (está no papel)
          </label>
          <div className="flex gap-2">
            <input
              id="vale-simples"
              autoFocus
              value={v.vale.codigo}
              onChange={(e) => v.vale.setCodigo(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void v.vale.usar()
                }
                if (e.key === 'Escape') v.vale.setAberto(false)
              }}
              placeholder="VT-XXXXXX"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 rounded-xl border border-borda bg-superficie px-3 font-mono text-base tracking-wider text-tinta placeholder:text-tinta-3"
            />
            <Botao tom="secundario" onClick={() => void v.vale.usar()} carregando={v.vale.indo} className="h-11 rounded-xl">
              Usar
            </Botao>
            <button type="button" onClick={() => v.vale.setAberto(false)} className="h-11 px-2 text-sm text-tinta-3 hover:text-tinta">
              cancelar
            </button>
          </div>
          {v.vale.erro && <span className="text-sm font-medium text-critico">{v.vale.erro}</span>}
        </div>
      )}

      {/* ── passo 2: conferir ── */}
      {v.pagos.length > 0 && (
        <div className="flex flex-col gap-3">
          {v.pagos.map((p, i) => {
            const dinheiro = p.forma === 'DINHEIRO'
            // O que este pagamento precisa cobrir: o total menos o que as
            // outras formas já pagam. As notas sugeridas partem daí.
            const devidoCent = c.aPagarCent - (c.pagoCent - cent(p.valor))
            const varios = v.pagos.length > 1

            if (dinheiro) {
              const ultimo = v.pagos.map((x) => x.forma).lastIndexOf('DINHEIRO') === i
              return (
                <div key={i} className="flex flex-col gap-2">
                  {/* Com o dinheiro sozinho, o passo 2 é o par "Recebido |
                      Troco" logo abaixo do "✓ Dinheiro" — um título a mais ali
                      só roubaria a altura dos itens. Dividido, cada parte diz
                      de quem é e pode sair. */}
                  {varios && (
                    <Passo n={2} atual={passo} titulo="Quanto recebeu em dinheiro?">
                      <button type="button" onClick={() => v.tirarPago(i)} className="min-h-9 px-2 text-sm text-tinta-3 hover:text-critico">
                        tirar
                      </button>
                    </Passo>
                  )}
                  {/* Recebido e troco lado a lado: é a conta que a pessoa faz de
                      cabeça, e a altura que sobra fica para os itens. */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex h-14 min-w-0 flex-col justify-center rounded-xl border-2 border-borda bg-superficie px-3 focus-within:border-marca">
                      <span className="text-xs leading-none font-bold text-tinta-2">Recebido</span>
                      <span className="flex items-baseline gap-1">
                      <span className="text-sm font-semibold text-tinta-3">R$</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        inputMode="decimal"
                        value={p.valor}
                        onChange={(e) => v.mudarPago(i, Number(e.target.value))}
                        onFocus={(e) => e.target.select()}
                        aria-label="Valor recebido em dinheiro"
                        className="numero w-full min-w-0 bg-transparent text-xl leading-tight font-bold text-tinta focus:outline-none focus-visible:outline-none!"
                      />
                      </span>
                    </label>
                    {/* O troco: o número que vai ser contado na gaveta, antes de concluir. */}
                    {ultimo && (
                      <div
                        className={cx(
                          'flex h-14 min-w-0 flex-col justify-center rounded-xl px-3',
                          c.trocoCent > 0 ? 'border border-bom-borda bg-bom-fundo' : 'bg-superficie-2',
                        )}
                      >
                        <span className={cx('text-xs leading-none font-bold', c.trocoCent > 0 ? 'text-bom' : 'text-tinta-3')}>
                          Troco
                        </span>
                        <span
                          aria-live="polite"
                          className={cx('numero truncate text-2xl leading-tight font-extrabold', c.trocoCent > 0 ? 'text-bom' : 'text-tinta-3')}
                        >
                          {brl(c.trocoCent / 100)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div role="group" aria-label="Notas mais prováveis" className="grid grid-cols-4 gap-1.5">
                    {notasSugeridas(devidoCent).map((n, k) => {
                      const marcada = cent(p.valor) === n
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => v.mudarPago(i, n / 100)}
                          aria-pressed={marcada}
                          className={cx(
                            'numero min-h-11 rounded-lg border px-1 text-sm font-semibold transition-colors touch-manipulation',
                            marcada ? 'border-marca bg-marca-suave text-tinta' : 'border-borda bg-superficie text-tinta-2 hover:bg-superficie-2',
                          )}
                        >
                          {k === 0 ? 'Exato' : brl(n / 100).replace(',00', '')}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            }

            if (p.forma === 'CREDIARIO' && crediario) {
              return (
                <div key={i} className="flex flex-col gap-2">
                  <Passo n={2} atual={passo} titulo="Em quantas vezes?">
                    <span className="numero text-sm font-semibold text-tinta-2">{brl(p.valor)}</span>
                  </Passo>
                  <div role="group" aria-label="Parcelas" className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1.5">
                    {Array.from({ length: crediario.maxParcelas }, (_, k) => k + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => v.mudarParcelas(n)}
                        aria-pressed={p.parcelas === n}
                        className={cx(
                          'flex min-h-12 flex-col items-center justify-center rounded-lg border text-sm font-bold',
                          p.parcelas === n ? 'border-marca bg-marca-suave text-tinta' : 'border-borda bg-superficie text-tinta-2 hover:bg-superficie-2',
                        )}
                      >
                        {n}×
                        <span className="numero text-[10px] font-medium text-tinta-3">{brl(Math.ceil((cent(p.valor) / n)) / 100)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            }

            // Pix, cartão, vale: o valor, e o "dividir" para quem paga metade
            // em cada. O campo só aparece quando pedido — valor editável à toa
            // é convite para digitar errado.
            const editavel = dividindo || varios || p.forma === 'VALE'
            return (
              <div key={i} className="flex items-center justify-between gap-3 rounded-xl bg-superficie-2 px-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-tinta">{tituloDaForma(p)}</span>
                  {!editavel && (
                    <button
                      type="button"
                      onClick={() => setDividindo(true)}
                      className="self-start text-xs font-semibold text-marca underline-offset-2 hover:underline"
                    >
                      Dividir em duas formas
                    </button>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  {editavel && p.forma !== 'VALE' ? (
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      inputMode="decimal"
                      value={p.valor}
                      onChange={(e) => v.mudarPago(i, Number(e.target.value))}
                      onFocus={(e) => e.target.select()}
                      aria-label={`Valor em ${tituloDaForma(p)}`}
                      className="numero h-11 w-28 rounded-lg border border-borda bg-superficie px-2 text-right text-base font-bold text-tinta focus:border-marca focus:outline-none"
                    />
                  ) : (
                    <span className="numero text-base font-bold text-tinta">{brl(p.valor)}</span>
                  )}
                  {varios && (
                    <button
                      type="button"
                      onClick={() => v.tirarPago(i)}
                      aria-label={`Tirar ${tituloDaForma(p)}`}
                      className="flex size-9 items-center justify-center rounded-lg text-tinta-3 hover:bg-critico-fundo hover:text-critico"
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
            )
          })}

          {c.sobrouSemDinheiro && (
            <Aviso nivel="critico">
              O valor passou do total, e não há dinheiro na venda para dar troco. Ajuste o valor.
            </Aviso>
          )}

        </div>
      )}
    </div>
  )
}

/* ── concluir ─────────────────────────────────────────────── */

export function Concluir({ v, caixaId }: { v: Venda; caixaId: string | null }) {
  const c = v.conta
  const motivo = !caixaId
    ? 'O caixa está fechado.'
    : v.carrinho.length === 0
      ? 'Toque num produto para começar.'
      : v.pagos.length === 0
        ? 'Escolha como o cliente vai pagar.'
        : c.sobrouSemDinheiro
          ? 'O valor passou do total. Ajuste antes de concluir.'
          : c.faltaCent > 0
            ? `Falta receber ${brl(c.faltaCent / 100)}.`
            : null

  return (
    <div className="flex flex-col gap-2">
      {v.recado?.nivel === 'critico' && (
        <Aviso nivel="critico">
          {v.recado.texto}
          {v.recado.link && (
            <>
              {' '}
              <a href={v.recado.link.href} className="font-semibold underline underline-offset-2">
                {v.recado.link.rotulo}
              </a>
            </>
          )}
        </Aviso>
      )}
      <Botao
        tom="confirmar"
        largo
        onClick={v.concluir}
        carregando={v.indo}
        disabled={!v.podeConcluir}
        aria-describedby={motivo ? 'motivo-concluir' : undefined}
        className="min-h-16 rounded-xl text-lg shadow-norte"
      >
        {v.indo ? 'Concluindo…' : 'Concluir venda'}
        {!v.indo && (
          <kbd className="hidden rounded bg-white/20 px-1.5 py-px font-mono text-[11px] font-semibold sm:inline">F10</kbd>
        )}
      </Botao>
      {motivo && !v.indo && (
        <p id="motivo-concluir" className="text-center text-sm text-tinta-2">
          {motivo}
        </p>
      )}
    </div>
  )
}

/* ── depois de concluir ───────────────────────────────────── */

export function Sucesso({ v, aoNova }: { v: Venda; aoNova: () => void }) {
  const f = v.fechada
  const nova = useRef<HTMLButtonElement>(null)
  // O foco vai para "Nova venda": Enter começa a próxima, e o leitor de
  // código de barras, se bipar direto, cai na busca pela regra 10.
  useEffect(() => {
    nova.current?.focus()
  }, [f?.vendaId])
  if (!f) return null

  const formas = [...new Set(f.formas.map((x) => tituloDaForma({ forma: x })))].join(' + ')

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-5 py-8 text-center">
      <span
        aria-hidden
        className="flex size-20 items-center justify-center rounded-full bg-bom-vivo text-white shadow-norte-alta motion-safe:animate-[encaixar_480ms_cubic-bezier(.2,.8,.2,1)]"
      >
        <svg viewBox="0 0 24 24" className="size-10" fill="none">
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>

      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold">Venda concluída</h2>
        <p className="text-sm text-tinta-2">
          Nº <span className="numero">{f.numero}</span> · {formas}
        </p>
      </div>

      <p className="numero text-4xl font-extrabold tracking-tight text-tinta">{brl(f.total)}</p>

      {f.trocoCent > 0 && (
        <div className="flex w-full flex-col items-center gap-0.5 rounded-2xl border border-bom-borda bg-bom-fundo px-5 py-4">
          <span className="text-sm font-bold tracking-wide text-bom uppercase">Troco para devolver</span>
          <span className="numero text-5xl font-extrabold text-bom">{brl(f.trocoCent / 100)}</span>
        </div>
      )}

      {f.pontosGanhos > 0 && <Situacao nivel="bom">ganhou {f.pontosGanhos} pontos</Situacao>}

      <div className="grid w-full gap-2">
        <Botao botaoRef={nova} largo onClick={aoNova} className="min-h-14 rounded-xl text-base">
          Nova venda
        </Botao>
        <a
          href={f.comprovante}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-borda bg-superficie px-3 text-sm font-semibold text-tinta hover:bg-superficie-2"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
            <path d="M6 7V3h8v4M6 14H4.5A1.5 1.5 0 013 12.5v-4A1.5 1.5 0 014.5 7h11A1.5 1.5 0 0117 8.5v4a1.5 1.5 0 01-1.5 1.5H14M6 11h8v6H6v-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          Imprimir comprovante
        </a>
      </div>
    </div>
  )
}
