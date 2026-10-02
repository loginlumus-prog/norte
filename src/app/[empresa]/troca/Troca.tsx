'use client'

// A troca numa tela só (ver servidor/troca.ts).
//
// A ordem da tela é a ordem da conversa no balcão: QUAL compra (ou "não
// achei a compra"), O QUE voltou — peça por peça, pelo preço que ela pagou —,
// O QUE ela leva agora, e a conta embaixo dizendo uma frase só: "cliente
// paga R$ X", "vira vale R$ X" ou "sem diferença". Só quando ela paga aparece
// o "como paga".
//
// A conta é a mesma do servidor (troca-conta.ts); o servidor refaz tudo ao
// confirmar e recusa se o preço mudou no meio.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Aviso, Botao, Situacao, cx } from '@/ui/base'
import { brl } from '@/ui/painel'
import { plural } from '@/ui/texto'
import { centavos, lerDinheiro, lerNumero, multiplicar, reais } from '@/servidor/dinheiro'
import { agendaDoCrediario, primeiroVencimentoMaximo, primeiroVencimentoPadrao } from '@/servidor/crediario-agenda'
import { mostrarDiaDaColuna, somarDias } from '@/servidor/dia'
import { contaDaTroca, resultadoDaTroca, tabelaDaTroca, valorDoItemCent, type ContaDaTroca } from '@/servidor/troca-conta'
import type { Tabela } from '@/servidor/preco'
import type { Maquininha } from '@/servidor/maquininhas'
import type { CompraAchada, CompraParaTroca, ResultadoTroca } from '@/servidor/troca'
import { procurar, procurarClientes, type Achado, type ClienteNoBalcao } from '../balcao/acoes'
import { abrirCompraAcao, procurarComprasAcao, trocarAcao, type PedidoDaTela } from './acoes'

export type ConfigDaTroca = {
  slug: string
  unidadeId: string
  unidadeNome: string
  /** O dia de hoje em São Paulo ('AAAA-MM-DD'), vindo do servidor. */
  hoje: string
  /** Quem opera não pode autorizar a troca sem a compra: pede o PIN. */
  precisaPin: boolean
  caixaAberto: boolean
  vendeSemEstoque: boolean
  valePorLoja: boolean
  maquininhas: Maquininha[]
  credito: { maxParcelas: number; jurosPct: number }
  /** Nulo: a empresa não tem crediário. */
  crediario: { maxParcelas: number; diasEntre: number } | null
}

type Forma = 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | 'CREDIARIO'
const FORMAS: { forma: Forma; rotulo: string }[] = [
  { forma: 'DINHEIRO', rotulo: 'Dinheiro' },
  { forma: 'PIX', rotulo: 'Pix' },
  { forma: 'DEBITO', rotulo: 'Débito' },
  { forma: 'CREDITO', rotulo: 'Crédito' },
  { forma: 'CREDIARIO', rotulo: 'Crediário' },
]
const COM_MAQUININHA: Forma[] = ['PIX', 'DEBITO', 'CREDITO']

const PERIODOS = [
  { dias: 0, rotulo: 'Hoje' },
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
]

const MOTIVOS = ['Tamanho', 'Cor', 'Defeito', 'Não gostou']

const brlC = (cent: number) => brl(reais(cent))
const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
const dinheiroNaTela = (cent: number) => (cent / 100).toFixed(2).replace('.', ',')

type LinhaSemCompra = { chave: string; achado: Achado; quantidade: number; preco: string }
type LinhaLeva = { achado: Achado; quantidade: number }

const precoDoAchado = (a: Achado, t: Tabela) => centavos(a.precos?.[t] ?? a.preco)

export function Troca({ config, inicial }: { config: ConfigDaTroca; inicial: CompraParaTroca | null }) {
  const [compra, setCompra] = useState<CompraParaTroca | null>(inicial)
  const [semCompra, setSemCompra] = useState(false)
  // Peça por peça: a chave é `${item}#${n}` — quem levou duas saias devolve uma.
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  // Quilo, litro, metro: a quantidade digitada.
  const [fracoes, setFracoes] = useState<Record<string, string>>({})
  const [voltaSem, setVoltaSem] = useState<LinhaSemCompra[]>([])
  // Item sem cadastro: a peça do catálogo que volta ao estoque no lugar dele.
  const [estoqueComo, setEstoqueComo] = useState<Record<string, Achado>>({})
  const [leva, setLeva] = useState<LinhaLeva[]>([])
  const [clienteEscolhido, setClienteEscolhido] = useState<ClienteNoBalcao | null>(null)
  const [forma, setForma] = useState<Forma | null>(null)
  const [maquininha, setMaquininha] = useState('')
  const [vezesCredito, setVezesCredito] = useState(1)
  const [vezesCrediario, setVezesCrediario] = useState(1)
  const [primeiroVenc, setPrimeiroVenc] = useState(() => primeiroVencimentoPadrao(config.hoje, config.crediario?.diasEntre))
  const [recebido, setRecebido] = useState('')
  const [motivo, setMotivo] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pin, setPin] = useState<{ erro?: string } | null>(null)
  const [feito, setFeito] = useState<Extract<ResultadoTroca, { ok: true }> | null>(null)
  const [indo, comecar] = useTransition()

  const cliente: { id: string; nome: string } | null = compra?.cliente ?? clienteEscolhido

  // ── quanto de cada item volta ──
  const qtdDe = (i: CompraParaTroca['itens'][number]) => {
    if (i.inteiro) {
      let n = 0
      for (const k of marcadas) if (k.startsWith(`${i.id}#`)) n++
      return Math.min(n, i.restante)
    }
    const q = lerNumero(fracoes[i.id] ?? '', 3)
    return q && q > 0 ? Math.min(q, i.restante) : 0
  }

  const precoSem = (l: LinhaSemCompra) => {
    const v = lerDinheiro(l.preco)
    return v !== null && v > 0 ? centavos(v) : null
  }

  const voltaCent = compra
    ? compra.itens.reduce((s, i) => s + valorDoItemCent(i.totalCent, i.vendido, qtdDe(i), compra.fator), 0)
    : voltaSem.reduce((s, l) => s + multiplicar(precoSem(l) ?? 0, l.quantidade), 0)
  const pecasVoltando = compra
    ? compra.itens.reduce((s, i) => s + qtdDe(i), 0)
    : voltaSem.reduce((s, l) => s + l.quantidade, 0)
  const fiado = compra?.fiadoAbertoCent ?? 0
  const levaEm = (t: Tabela) => leva.reduce((s, l) => s + multiplicar(precoDoAchado(l.achado, t), l.quantidade), 0)

  // À vista primeiro: se o crédito cobre, não há forma a escolher. Se não
  // cobre, a forma da diferença escolhe a tabela das peças novas.
  const contaVista = contaDaTroca({ voltaCent, fiadoAbertoCent: fiado, levaCent: levaEm('vista') })
  const paga = contaVista.pagaCent > 0
  const contaDe = (f: Forma | null): ContaDaTroca =>
    paga ? contaDaTroca({ voltaCent, fiadoAbertoCent: fiado, levaCent: levaEm(tabelaDaTroca(f)) }) : contaVista
  const conta = contaDe(forma)
  const frase = resultadoDaTroca(conta)

  const maquininhasDe = (f: Forma | null) => (f ? config.maquininhas.filter((m) => (m.formas as string[]).includes(f)) : [])
  const maquininhasDaForma = maquininhasDe(forma)
  function escolherForma(f: Forma) {
    setForma(f)
    // Uma maquininha só para a forma: já vem escolhida (um toque a menos).
    const ms = maquininhasDe(f)
    setMaquininha(ms.length === 1 ? ms[0]!.nome : '')
  }

  const recebidoCent = (() => {
    const v = lerDinheiro(recebido)
    return v !== null && v > 0 ? centavos(v) : 0
  })()
  const trocoCent = forma === 'DINHEIRO' && recebidoCent > conta.pagaCent ? recebidoCent - conta.pagaCent : 0

  // ── o que impede de concluir, numa frase ──
  const falta: string | null = (() => {
    if (!compra && !semCompra) return 'Ache a compra, ou toque em "Não achei a compra".'
    if (pecasVoltando <= 0) return 'Marque o que está voltando.'
    if (semCompra && voltaSem.some((l) => precoSem(l) === null)) return 'Digite o preço que a cliente pagou em cada peça que volta.'
    if (paga && !forma) return 'Escolha como a cliente paga a diferença.'
    if (paga && forma === 'CREDIARIO' && !cliente) return 'No crediário a dívida precisa de dono: escolha a cliente.'
    if (paga && forma === 'DINHEIRO' && !config.caixaAberto) return 'O caixa desta loja está fechado: dinheiro não entra. Escolha outra forma ou abra o caixa.'
    if (paga && forma === 'DINHEIRO' && recebido.trim() && recebidoCent < conta.pagaCent) return 'O valor recebido é menor que a diferença.'
    return null
  })()

  function pedido(pinDigitado?: string): PedidoDaTela {
    return {
      unidadeId: config.unidadeId,
      vendaId: compra?.id ?? null,
      voltam: compra
        ? compra.itens
            .map((i) => ({ vendaItemId: i.id, quantidade: qtdDe(i), variacaoId: i.semCadastro ? (estoqueComo[i.id]?.id ?? null) : null }))
            .filter((x) => x.quantidade > 0)
        : [],
      semCompra: semCompra
        ? voltaSem.map((l) => ({ variacaoId: l.achado.id, quantidade: l.quantidade, precoUnit: reais(precoSem(l) ?? 0) }))
        : [],
      leva: leva.map((l) => ({ variacaoId: l.achado.id, quantidade: l.quantidade })),
      diferenca:
        conta.pagaCent > 0 && forma
          ? {
              forma,
              valor: reais(conta.pagaCent),
              parcelas: forma === 'CREDITO' ? vezesCredito : forma === 'CREDIARIO' ? vezesCrediario : undefined,
              maquininha: COM_MAQUININHA.includes(forma) ? maquininha || null : null,
              primeiroVencimento: forma === 'CREDIARIO' ? primeiroVenc : null,
            }
          : null,
      clienteId: cliente?.id ?? null,
      motivo,
      pin: pinDigitado ?? null,
      troco: reais(trocoCent),
    }
  }

  function enviar(pinDigitado?: string) {
    setErro(null)
    comecar(async () => {
      let r: ResultadoTroca
      try {
        r = await trocarAcao(config.slug, pedido(pinDigitado))
      } catch {
        // Sem resposta não se sabe se gravou: a transação é uma só, então
        // ou foi tudo ou nada — mas só Vendas diz qual.
        setErro('A conexão caiu antes da resposta. Confira em Vendas se a troca entrou antes de fazer de novo.')
        setConfirmando(false)
        return
      }
      if (r.ok) {
        setFeito(r)
        setPin(null)
        setConfirmando(false)
        return
      }
      if (r.precisaPin) {
        setPin({ erro: pinDigitado ? r.recado : undefined })
        return
      }
      setPin(null)
      setConfirmando(false)
      setErro(r.recado)
    })
  }

  function concluir() {
    // A troca sem a compra, para quem não pode autorizar: o PIN primeiro.
    if (semCompra && config.precisaPin) setPin({})
    else enviar()
  }

  function recomecar() {
    setCompra(null)
    setSemCompra(false)
    setMarcadas(new Set())
    setFracoes({})
    setEstoqueComo({})
    setVoltaSem([])
    setLeva([])
    setClienteEscolhido(null)
    setForma(null)
    setRecebido('')
    setMotivo('')
    setErro(null)
    setFeito(null)
    setConfirmando(false)
  }

  // As linhas de um item da compra: uma por peça (toque para marcar), ou um
  // campo de quantidade no que se pesa ou mede.
  function linhasDoItem(i: CompraParaTroca['itens'][number]) {
    if (!compra) return []
    if (!i.inteiro || i.restante > 20) {
      return [
        <li key={i.id} className="flex items-center justify-between gap-3 rounded-norte border border-borda px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-tinta">{i.descricao}</span>
            <span className="text-xs text-tinta-3">
              {brlC(i.precoUnitCent)} · pode voltar até {String(i.restante).replace('.', ',')}
            </span>
          </span>
          <input
            inputMode="decimal"
            aria-label={`Quanto volta de ${i.descricao}`}
            value={fracoes[i.id] ?? ''}
            onChange={(e) => setFracoes((f) => ({ ...f, [i.id]: e.target.value }))}
            placeholder="0"
            className="numero w-24 rounded-norte border border-borda bg-superficie px-2 py-1.5 text-right text-sm text-tinta"
          />
        </li>,
      ]
    }
    return Array.from({ length: i.restante }, (_, n) => {
      const chave = `${i.id}#${n}`
      const on = marcadas.has(chave)
      const valor = valorDoItemCent(i.totalCent, i.vendido, 1, compra.fator)
      return (
        <li key={chave}>
          <button
            type="button"
            aria-pressed={on}
            onClick={() =>
              setMarcadas((s) => {
                const novo = new Set(s)
                if (on) novo.delete(chave)
                else novo.add(chave)
                return novo
              })
            }
            className={cx(
              'flex w-full items-center justify-between gap-3 rounded-norte border px-3 py-2.5 text-left text-sm transition-colors',
              on ? 'border-marca bg-marca/10 font-semibold text-tinta' : 'border-borda bg-superficie text-tinta hover:bg-superficie-2',
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cx(
                  'flex size-5 shrink-0 items-center justify-center rounded border text-xs',
                  on ? 'border-marca bg-marca text-marca-tinta' : 'border-borda',
                )}
              >
                {on ? '✓' : ''}
              </span>
              <span className="truncate">
                {i.descricao}
                {i.restante > 1 && <span className="font-normal text-tinta-3"> · {n + 1}ª</span>}
              </span>
            </span>
            <span className="numero shrink-0">{brlC(valor)}</span>
          </button>
        </li>
      )
    })
  }

  if (feito) return <Feito config={config} r={feito} formaPaga={forma} aoRecomecar={recomecar} />

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── esquerda: a compra e o que volta ── */}
      <section className="flex min-w-0 flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
        <header className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-tinta">1. O que está voltando</h2>
          <span className="text-xs text-tinta-3">{config.unidadeNome}</span>
        </header>

        {!compra && !semCompra ? (
          <AcharCompra
            config={config}
            aoEscolher={async (id) => {
              const c = await abrirCompraAcao(config.slug, id)
              if (!c) {
                setErro('Esta compra não pode ser trocada (cancelada, ou de uma loja que você não opera).')
                return
              }
              if (c.unidadeId !== config.unidadeId) {
                setErro(`Esta compra foi na ${c.unidade}. A troca dela é feita lá.`)
                return
              }
              setErro(null)
              setMarcadas(new Set())
              setFracoes({})
              setEstoqueComo({})
              setCompra(c)
            }}
            aoNaoAchar={() => {
              setErro(null)
              setSemCompra(true)
            }}
          />
        ) : compra ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-norte bg-superficie-2 px-3 py-2 text-sm">
              <span className="text-tinta">
                <b className="font-semibold">Venda {compra.numero}</b> · {quando(compra.criadaEm)}
                {compra.dias > 0 && <span className="text-tinta-3"> · há {plural(compra.dias, 'dia', 'dias')}</span>}
                {' · '}
                <span className="numero">{brl(compra.total)}</span>
              </span>
              <button type="button" onClick={recomecar} className="text-xs font-medium text-marca underline-offset-2 hover:underline">
                trocar de compra
              </button>
            </div>
            {compra.itens.length === 0 ? (
              <Aviso nivel="atencao">Tudo desta compra já voltou. Não há peça para trocar.</Aviso>
            ) : (
              <>
                <p className="text-[13px] text-tinta-2">
                  Toque em cada peça que voltou. O valor é o que ela pagou{compra.fator < 0.9999 ? ', com o desconto da compra' : ''}.
                </p>
                <ul className="flex flex-col gap-1.5">
                  {compra.itens.flatMap((i) => {
                    const linhas = linhasDoItem(i)
                    // Peça sem cadastro (venda do sistema anterior): o valor
                    // volta; o estoque só volta se ela apontar a peça.
                    if (!i.semCadastro || qtdDe(i) <= 0) return linhas
                    const como = estoqueComo[i.id]
                    return [
                      ...linhas,
                      <li key={`${i.id}-estoque`} className="flex flex-col gap-1.5 rounded-norte border border-dashed border-borda px-3 py-2">
                        <span className="text-xs text-tinta-2">
                          Peça sem cadastro (veio do sistema anterior). Para o estoque voltar, diga qual é no catálogo:
                        </span>
                        {como ? (
                          <span className="flex items-center justify-between gap-2 text-sm text-tinta">
                            <span className="truncate">Volta ao estoque como {como.descricao}</span>
                            <button
                              type="button"
                              onClick={() => setEstoqueComo(({ [i.id]: _fora, ...resto }) => resto)}
                              className="shrink-0 text-xs text-marca underline-offset-2 hover:underline"
                            >
                              trocar
                            </button>
                          </span>
                        ) : (
                          <BuscaDePeca
                            config={config}
                            rotulo="Volta ao estoque como"
                            aoEscolher={(a) => setEstoqueComo((m) => ({ ...m, [i.id]: a }))}
                          />
                        )}
                        {!como && <span className="text-[11px] text-atencao">Sem escolher, o valor volta mas o estoque não.</span>}
                      </li>,
                    ]
                  })}
                </ul>
              </>
            )}
            {fiado > 0 && (
              <Aviso nivel="atencao">
                Esta compra tem {brlC(fiado)} em aberto no crediário. O que voltar abate essa dívida primeiro — só o que
                sobrar vira crédito para a troca.
              </Aviso>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-norte bg-superficie-2 px-3 py-2 text-sm">
              <span className="font-semibold text-tinta">Sem a compra (comprada antes do sistema)</span>
              <button type="button" onClick={recomecar} className="text-xs font-medium text-marca underline-offset-2 hover:underline">
                voltar a procurar a compra
              </button>
            </div>
            <p className="text-[13px] text-tinta-2">
              Escolha a peça que voltou e digite o preço que a cliente pagou. Vira vale desta loja
              {config.precisaPin ? ' — e precisa do PIN de quem pode autorizar' : ''}.
            </p>
            <BuscaDePeca config={config} rotulo="Peça que voltou" aoEscolher={(a) => setVoltaSem((l) => [...l, { chave: `${a.id}-${Date.now()}`, achado: a, quantidade: 1, preco: dinheiroNaTela(centavos(a.preco)) }])} />
            {voltaSem.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {voltaSem.map((l) => (
                  <li key={l.chave} className="flex flex-wrap items-center justify-between gap-2 rounded-norte border border-borda px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-tinta">{l.achado.descricao}</span>
                    <label className="flex items-center gap-1.5 text-xs text-tinta-2">
                      pagou R$
                      <input
                        inputMode="decimal"
                        aria-label={`Preço que a cliente pagou por ${l.achado.descricao}`}
                        value={l.preco}
                        onChange={(e) => setVoltaSem((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, preco: e.target.value } : x)))}
                        className={cx(
                          'numero w-24 rounded-norte border bg-superficie px-2 py-1.5 text-right text-sm text-tinta',
                          precoSem(l) === null ? 'border-critico' : 'border-borda',
                        )}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setVoltaSem((ls) => ls.filter((x) => x.chave !== l.chave))}
                      className="text-xs text-critico hover:underline"
                      aria-label={`Tirar ${l.achado.descricao}`}
                    >
                      tirar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* A cliente: a da compra; sem ela, escolhida aqui (o vale e o crediário precisam de dono). */}
        {(compra || semCompra) && (
          <div className="flex flex-col gap-1.5 border-t border-borda-suave pt-3">
            <span className="text-xs font-semibold tracking-wide text-tinta-3 uppercase">Cliente</span>
            {compra?.cliente ? (
              <span className="text-sm text-tinta">{compra.cliente.nome}</span>
            ) : (
              <EscolherCliente slug={config.slug} escolhido={clienteEscolhido} aoEscolher={setClienteEscolhido} />
            )}
          </div>
        )}
      </section>

      {/* ── direita: o que ela leva, a conta e o pagamento ── */}
      <section className="flex min-w-0 flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
        <h2 className="text-sm font-bold text-tinta">2. O que ela leva agora</h2>
        <BuscaDePeca
          config={config}
          rotulo="Peça nova"
          aoEscolher={(a) =>
            setLeva((l) => {
              const ja = l.find((x) => x.achado.id === a.id)
              return ja ? l.map((x) => (x.achado.id === a.id ? { ...x, quantidade: x.quantidade + 1 } : x)) : [...l, { achado: a, quantidade: 1 }]
            })
          }
        />
        {leva.length === 0 ? (
          <p className="text-[13px] text-tinta-3">Nada ainda. Sem peça nova, o que voltou vira vale.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {leva.map((l) => {
              const acabou = !l.achado.servico && l.achado.saldo < l.quantidade
              return (
                <li key={l.achado.id} className="flex items-center justify-between gap-2 rounded-norte border border-borda px-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-tinta">{l.achado.descricao}</span>
                    <span className="text-xs text-tinta-3">
                      {l.achado.codigo ? `${l.achado.codigo} · ` : ''}
                      {brlC(precoDoAchado(l.achado, tabelaDaTroca(paga ? forma : null)))}
                      {acabou && (
                        <span className="text-atencao">
                          {' '}
                          · {config.vendeSemEstoque ? 'o sistema diz que acabou (vende assim mesmo)' : 'o sistema diz que acabou'}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Um a menos de ${l.achado.descricao}`}
                      onClick={() =>
                        setLeva((ls) =>
                          ls.flatMap((x) => (x.achado.id !== l.achado.id ? [x] : x.quantidade > 1 ? [{ ...x, quantidade: x.quantidade - 1 }] : [])),
                        )
                      }
                      className="size-8 rounded-norte border border-borda text-tinta hover:bg-superficie-2"
                    >
                      −
                    </button>
                    <span className="numero w-6 text-center text-sm">{l.quantidade}</span>
                    <button
                      type="button"
                      aria-label={`Um a mais de ${l.achado.descricao}`}
                      onClick={() => setLeva((ls) => ls.map((x) => (x.achado.id === l.achado.id ? { ...x, quantidade: x.quantidade + 1 } : x)))}
                      className="size-8 rounded-norte border border-borda text-tinta hover:bg-superficie-2"
                    >
                      +
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {/* ── a conta ── */}
        <dl className="flex flex-col gap-1 border-t border-borda pt-3 text-sm">
          <div className="flex justify-between text-tinta-2">
            <dt>Voltou ({plural(pecasVoltando, 'peça', 'peças')})</dt>
            <dd className="numero">{brlC(conta.voltaCent)}</dd>
          </div>
          {conta.abatidoCent > 0 && (
            <div className="flex justify-between text-tinta-2">
              <dt>Abate do crediário desta compra</dt>
              <dd className="numero">− {brlC(conta.abatidoCent)}</dd>
            </div>
          )}
          <div className="flex justify-between text-tinta-2">
            <dt>Leva</dt>
            <dd className="numero">{brlC(conta.levaCent)}</dd>
          </div>
          <div
            className={cx(
              'mt-1 flex items-baseline justify-between rounded-norte px-3 py-2 text-base font-bold',
              frase === 'paga' ? 'bg-atencao-fundo text-tinta' : frase === 'vale' ? 'bg-bom-fundo text-bom' : 'bg-superficie-2 text-tinta',
            )}
          >
            <dt>{frase === 'paga' ? 'Cliente paga' : frase === 'vale' ? 'Vira vale' : 'Sem diferença'}</dt>
            <dd className="numero text-lg">{frase === 'paga' ? brlC(conta.pagaCent) : frase === 'vale' ? brlC(conta.sobraCent) : brlC(0)}</dd>
          </div>
          {frase === 'vale' && !cliente && (compra || semCompra) && (
            <p className="text-xs text-atencao">Sem cliente, o vale só vale pelo código do papel. Se der, escolha a cliente.</p>
          )}
          {frase === 'vale' && config.valePorLoja && (
            <p className="text-xs text-tinta-3">O vale só vale nesta loja ({config.unidadeNome}).</p>
          )}
        </dl>

        {/* ── como paga a diferença ── */}
        {paga && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-tinta-3 uppercase">Como paga a diferença</span>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {FORMAS.filter((f) => f.forma !== 'CREDIARIO' || config.crediario).map((f) => {
                const valor = contaDe(f.forma).pagaCent
                return (
                  <button
                    key={f.forma}
                    type="button"
                    aria-pressed={forma === f.forma}
                    onClick={() => escolherForma(f.forma)}
                    className={cx(
                      'flex flex-col items-center rounded-norte border px-2 py-2 text-sm font-semibold',
                      forma === f.forma ? 'border-marca bg-marca text-marca-tinta' : 'border-borda bg-superficie text-tinta hover:bg-superficie-2',
                    )}
                  >
                    {f.rotulo}
                    <span className="numero text-[11px] font-normal">{brlC(valor)}</span>
                  </button>
                )
              })}
            </div>

            {forma && COM_MAQUININHA.includes(forma) && maquininhasDaForma.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-tinta-2">
                Maquininha
                <select
                  value={maquininha}
                  onChange={(e) => setMaquininha(e.target.value)}
                  className="rounded-norte border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta"
                >
                  {maquininhasDaForma.length > 1 && <option value="">escolha…</option>}
                  {maquininhasDaForma.map((m) => (
                    <option key={m.nome} value={m.nome}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {forma === 'CREDITO' && config.credito.maxParcelas > 1 && (
              <label className="flex items-center gap-2 text-sm text-tinta-2">
                Em
                <select
                  value={vezesCredito}
                  onChange={(e) => setVezesCredito(Number(e.target.value))}
                  className="rounded-norte border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta"
                >
                  {Array.from({ length: config.credito.maxParcelas }, (_, n) => n + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}× de {brlC(Math.ceil(conta.pagaCent / n))}
                    </option>
                  ))}
                </select>
                {vezesCredito > 1 && config.credito.jurosPct > 0 && (
                  <span className="text-xs text-tinta-3">+ juro de {String(config.credito.jurosPct).replace('.', ',')}% da loja</span>
                )}
              </label>
            )}

            {forma === 'CREDIARIO' && config.crediario && (
              <div className="flex flex-col gap-2 rounded-norte border border-borda-suave p-3">
                {!cliente && <Aviso nivel="atencao">No crediário a dívida precisa de dono: escolha a cliente (à esquerda).</Aviso>}
                <div className="flex flex-wrap items-center gap-3 text-sm text-tinta-2">
                  <label className="flex items-center gap-2">
                    Em
                    <select
                      value={vezesCrediario}
                      onChange={(e) => setVezesCrediario(Number(e.target.value))}
                      className="rounded-norte border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta"
                    >
                      {Array.from({ length: config.crediario.maxParcelas }, (_, n) => n + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}× de {brlC(Math.ceil(conta.pagaCent / n))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    1º vencimento
                    <input
                      type="date"
                      value={primeiroVenc}
                      min={somarDias(config.hoje, 1)}
                      max={primeiroVencimentoMaximo(config.hoje, config.crediario.diasEntre)}
                      onChange={(e) => setPrimeiroVenc(e.target.value)}
                      className="rounded-norte border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta"
                    />
                  </label>
                </div>
                <p className="numero text-xs text-tinta-3">
                  {agendaDoCrediario({
                    totalCent: conta.pagaCent,
                    parcelas: vezesCrediario,
                    primeiroVencimento: primeiroVenc,
                    diasEntre: config.crediario.diasEntre,
                  })
                    .map((p) => `${p.numero}ª ${mostrarDiaDaColuna(p.vencimento, 'nao')} ${brlC(p.valorCent)}`)
                    .join(' · ')}
                </p>
              </div>
            )}

            {forma === 'DINHEIRO' && (
              <label className="flex flex-wrap items-center gap-2 text-sm text-tinta-2">
                Recebeu R$
                <input
                  inputMode="decimal"
                  value={recebido}
                  onChange={(e) => setRecebido(e.target.value)}
                  placeholder={dinheiroNaTela(conta.pagaCent)}
                  className="numero w-28 rounded-norte border border-borda bg-superficie px-2 py-1.5 text-right text-sm text-tinta"
                />
                {trocoCent > 0 && <span className="font-semibold text-tinta">troco {brlC(trocoCent)}</span>}
                {!config.caixaAberto && <span className="text-xs text-critico">O caixa desta loja está fechado.</span>}
              </label>
            )}
          </div>
        )}

        {/* ── o motivo ── */}
        {(compra || semCompra) && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wide text-tinta-3 uppercase">Motivo</span>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS.map((mo) => (
                <button
                  key={mo}
                  type="button"
                  aria-pressed={motivo === mo}
                  onClick={() => setMotivo((x) => (x === mo ? '' : mo))}
                  className={cx(
                    'rounded-full border px-3 py-1 text-xs font-semibold',
                    motivo === mo ? 'border-marca bg-marca text-marca-tinta' : 'border-borda text-tinta-2 hover:bg-superficie-2',
                  )}
                >
                  {mo}
                </button>
              ))}
            </div>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value.slice(0, 200))}
              placeholder="Ou escreva: trocou pela cor azul…"
              aria-label="Motivo da troca"
              className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
            />
          </div>
        )}

        {erro && <Aviso nivel="critico">{erro}</Aviso>}

        {/* ── concluir: pergunta antes ── */}
        {!confirmando ? (
          <Botao tom="confirmar" className="min-h-12 rounded-xl text-base" disabled={!!falta || indo} onClick={() => setConfirmando(true)}>
            Concluir a troca
          </Botao>
        ) : (
          <div role="group" aria-label="Confirmar a troca" className="flex flex-col gap-2 rounded-norte border border-borda bg-superficie-2 p-3">
            <p className="text-sm text-tinta">
              Volta {plural(pecasVoltando, 'peça', 'peças')} ({brlC(conta.voltaCent)})
              {leva.length > 0 ? `, leva ${plural(leva.reduce((s, l) => s + l.quantidade, 0), 'peça', 'peças')} (${brlC(conta.levaCent)})` : ''}.{' '}
              <b className="font-semibold">
                {frase === 'paga'
                  ? `Cliente paga ${brlC(conta.pagaCent)} no ${FORMAS.find((f) => f.forma === forma)?.rotulo ?? ''}.`
                  : frase === 'vale'
                    ? `Vira vale de ${brlC(conta.sobraCent)}.`
                    : 'Sem diferença.'}
              </b>{' '}
              Confirma?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Botao tom="secundario" onClick={() => setConfirmando(false)} disabled={indo} className="min-h-11 rounded-xl">
                Voltar
              </Botao>
              <Botao tom="confirmar" onClick={concluir} carregando={indo} className="min-h-11 rounded-xl" autoFocus>
                Sim, fazer a troca
              </Botao>
            </div>
          </div>
        )}
        {falta && !confirmando && (compra || semCompra) && <p className="text-xs text-tinta-3">{falta}</p>}
      </section>

      {pin && (
        <PedirPin
          erro={pin.erro}
          indo={indo}
          credito={conta.voltaCent}
          aoAutorizar={(p) => enviar(p)}
          aoVoltar={() => {
            setPin(null)
            setConfirmando(false)
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ACHAR A COMPRA
// ─────────────────────────────────────────────────────────────

function AcharCompra({
  config,
  aoEscolher,
  aoNaoAchar,
}: {
  config: ConfigDaTroca
  aoEscolher: (vendaId: string) => Promise<void>
  aoNaoAchar: () => void
}) {
  const [busca, setBusca] = useState('')
  const [dias, setDias] = useState(30)
  const [res, setRes] = useState<{ compras: CompraAchada[] | null; erro: string | null }>({ compras: null, erro: null })
  const [abrindo, setAbrindo] = useState<string | null>(null)

  // O resultado anterior fica na tela enquanto a nova busca não chega: a
  // lista não pisca a cada tecla.
  useEffect(() => {
    let vivo = true
    const t = setTimeout(
      () => {
        procurarComprasAcao(config.slug, config.unidadeId, dias, busca.trim())
          .then((r) => {
            if (!vivo) return
            setRes(r.ok ? { compras: r.compras, erro: null } : { compras: [], erro: r.erro })
          })
          .catch(() => vivo && setRes({ compras: [], erro: 'Não deu para buscar as compras. Tente de novo.' }))
      },
      busca ? 300 : 0,
    )
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [config.slug, config.unidadeId, dias, busca])

  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Nome da cliente, peça, código, nº da venda ou valor"
        aria-label="Procurar a compra"
        className="rounded-norte border border-borda bg-superficie px-3 py-2.5 text-sm text-tinta placeholder:text-tinta-3"
      />
      <div className="flex gap-1">
        {PERIODOS.map((p) => (
          <button
            key={p.dias}
            type="button"
            aria-pressed={dias === p.dias}
            onClick={() => setDias(p.dias)}
            className={cx(
              'flex-1 rounded-full border px-2 py-1 text-xs font-semibold',
              dias === p.dias ? 'border-tinta bg-tinta text-superficie' : 'border-borda text-tinta-2 hover:bg-superficie-2',
            )}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {res.compras === null ? (
        <p className="py-4 text-center text-sm text-tinta-3">Buscando…</p>
      ) : res.erro ? (
        <Aviso nivel="critico">{res.erro}</Aviso>
      ) : res.compras.length === 0 ? (
        <p className="py-4 text-center text-sm text-tinta-3">
          {busca ? 'Nenhuma compra com isso. Tente outro período ou outra palavra.' : 'Nenhuma venda neste período.'}
        </p>
      ) : (
        <ul className="flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto pr-1">
          {res.compras.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={!c.podeVoltar || abrindo !== null}
                onClick={async () => {
                  setAbrindo(c.id)
                  try {
                    await aoEscolher(c.id)
                  } finally {
                    setAbrindo(null)
                  }
                }}
                className="flex w-full flex-col gap-0.5 rounded-norte border border-borda bg-superficie px-3 py-2 text-left hover:bg-superficie-2 disabled:opacity-55"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-tinta">{c.cliente ?? 'Sem cliente'}</span>
                  <span className="numero shrink-0 text-sm font-bold text-tinta">{brl(c.total)}</span>
                </span>
                <span className="truncate text-xs text-tinta">{c.itens}</span>
                <span className="text-[11px] text-tinta-3">
                  Venda {c.numero} · {quando(c.criadaEm)}
                  {!c.podeVoltar && ' · tudo já voltou'}
                  {abrindo === c.id && ' · abrindo…'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* A saída para a compra que não está aqui: a do sistema anterior. */}
      <button
        type="button"
        onClick={aoNaoAchar}
        className="mt-1 rounded-norte border border-dashed border-borda px-3 py-2.5 text-sm font-medium text-tinta-2 hover:bg-superficie-2"
      >
        Não achei a compra (comprada antes do sistema)
        {config.precisaPin ? ' — precisa do PIN de quem autoriza' : ''}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// A PEÇA DO CATÁLOGO (a busca do balcão)
// ─────────────────────────────────────────────────────────────

function BuscaDePeca({ config, rotulo, aoEscolher }: { config: ConfigDaTroca; rotulo: string; aoEscolher: (a: Achado) => void }) {
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<Achado[]>([])
  const [buscando, setBuscando] = useState(false)
  const campo = useRef<HTMLInputElement>(null)
  const ultima = useRef(0)

  useEffect(() => {
    const t = termo.trim()
    if (t.length < 2) {
      setAchados([])
      return
    }
    const minha = ++ultima.current
    const espera = setTimeout(() => {
      setBuscando(true)
      procurar(config.slug, config.unidadeId, t)
        .then((r) => {
          if (minha === ultima.current) setAchados(r)
        })
        .catch(() => {
          if (minha === ultima.current) setAchados([])
        })
        .finally(() => {
          if (minha === ultima.current) setBuscando(false)
        })
    }, 250)
    return () => clearTimeout(espera)
  }, [termo, config.slug, config.unidadeId])

  const escolher = (a: Achado) => {
    aoEscolher(a)
    setTermo('')
    setAchados([])
    campo.current?.focus()
  }
  const daLoja = achados.filter((a) => !a.foraDaLoja)

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={campo}
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        onKeyDown={(e) => {
          // Bipe da etiqueta: um só, entra direto.
          if (e.key === 'Enter') {
            e.preventDefault()
            if (daLoja.length === 1) escolher(daLoja[0]!)
          }
        }}
        placeholder={`${rotulo}: código da etiqueta ou nome`}
        aria-label={rotulo}
        className="rounded-norte border border-borda bg-superficie px-3 py-2.5 text-sm text-tinta placeholder:text-tinta-3"
      />
      {termo.trim().length >= 2 && (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {buscando && achados.length === 0 && <li className="px-2 py-1 text-xs text-tinta-3">Buscando…</li>}
          {!buscando && achados.length === 0 && <li className="px-2 py-1 text-xs text-tinta-3">Nada com isso nesta loja.</li>}
          {achados.slice(0, 30).map((a) => (
            <li key={a.id}>
              <button
                type="button"
                disabled={a.foraDaLoja}
                onClick={() => escolher(a)}
                className="flex w-full items-center justify-between gap-2 rounded-norte border border-borda-suave px-3 py-1.5 text-left hover:bg-superficie-2 disabled:opacity-55"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-tinta">{a.descricao}</span>
                  <span className="text-[11px] text-tinta-3">
                    {a.codigo ? `${a.codigo} · ` : ''}
                    {a.foraDaLoja ? 'não é vendido nesta loja' : a.servico ? 'serviço' : `${String(a.saldo).replace('.', ',')} em estoque`}
                  </span>
                </span>
                <span className="numero shrink-0 text-sm font-semibold text-tinta">{brl(a.preco)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// A CLIENTE (quando a compra não tem, ou sem a compra)
// ─────────────────────────────────────────────────────────────

function EscolherCliente({
  slug,
  escolhido,
  aoEscolher,
}: {
  slug: string
  escolhido: ClienteNoBalcao | null
  aoEscolher: (c: ClienteNoBalcao | null) => void
}) {
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<ClienteNoBalcao[]>([])

  useEffect(() => {
    const t = termo.trim()
    if (t.length < 2) {
      setAchados([])
      return
    }
    let vivo = true
    const espera = setTimeout(() => {
      procurarClientes(slug, t)
        .then((r) => vivo && setAchados(r))
        .catch(() => vivo && setAchados([]))
    }, 250)
    return () => {
      vivo = false
      clearTimeout(espera)
    }
  }, [termo, slug])

  if (escolhido) {
    return (
      <span className="flex items-center gap-2 text-sm text-tinta">
        {escolhido.nome}
        <button type="button" onClick={() => aoEscolher(null)} className="text-xs text-marca underline-offset-2 hover:underline">
          trocar
        </button>
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Sem cliente — procure pelo nome, telefone ou CPF"
        aria-label="Procurar cliente"
        className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
      />
      {achados.length > 0 && (
        <ul className="flex flex-col gap-1">
          {achados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  aoEscolher(c)
                  setTermo('')
                }}
                className="flex w-full items-center justify-between gap-2 rounded-norte border border-borda-suave px-3 py-1.5 text-left text-sm text-tinta hover:bg-superficie-2"
              >
                <span className="truncate">{c.nome}</span>
                {c.vencido > 0 ? <Situacao nivel="critico">atrasado</Situacao> : c.devendo > 0 ? <Situacao nivel="neutro">deve</Situacao> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// O PIN (troca sem a compra)
// ─────────────────────────────────────────────────────────────

function PedirPin({
  erro,
  indo,
  credito,
  aoAutorizar,
  aoVoltar,
}: {
  erro?: string
  indo: boolean
  credito: number
  aoAutorizar: (pin: string) => void
  aoVoltar: () => void
}) {
  const [pin, setPin] = useState('')
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const t = setTimeout(() => campo.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])
  const autorizar = () => {
    const p = pin.replace(/\D/g, '')
    if (p.length < 4) return
    setPin('')
    aoAutorizar(p)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-troca-titulo"
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-borda bg-superficie p-5 shadow-norte-alta"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            aoVoltar()
          }
        }}
      >
        <div className="flex flex-col gap-1">
          <h2 id="pin-troca-titulo" className="text-lg font-bold text-tinta">
            Precisa de autorização
          </h2>
          <p className="text-sm text-tinta-2">
            Troca sem a compra: o preço digitado vira um vale de {brlC(credito)}. Quem pode autorizar digita o PIN
            pessoal aqui — a troca fica no nome de quem atendeu, e o livro guarda quem autorizou.
          </p>
        </div>
        {erro && <Aviso nivel="critico">{erro}</Aviso>}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-tinta">PIN de quem autoriza</span>
          <input
            ref={campo}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                autorizar()
              }
            }}
            className="numero h-14 rounded-xl border-2 border-borda bg-superficie px-4 text-center text-2xl font-bold tracking-[0.5em] text-tinta focus:border-marca focus:outline-none"
          />
          <span className="text-xs text-tinta-3">De 4 a 6 números. Quem não tem PIN cria o seu em Minha conta.</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Botao tom="secundario" onClick={aoVoltar} className="min-h-12 rounded-xl">
            Voltar
          </Botao>
          <Botao tom="confirmar" onClick={autorizar} carregando={indo} disabled={pin.length < 4} className="min-h-12 rounded-xl">
            Autorizar e trocar
          </Botao>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// FEITO
// ─────────────────────────────────────────────────────────────

function Feito({
  config,
  r,
  formaPaga,
  aoRecomecar,
}: {
  config: ConfigDaTroca
  r: Extract<ResultadoTroca, { ok: true }>
  formaPaga: Forma | null
  aoRecomecar: () => void
}) {
  const vale = r.vale
  const linhas = useMemo(
    () =>
      [
        `Voltou ${brl(r.voltou)}${r.compraNumero !== null ? ` da venda ${r.compraNumero}` : ' (sem a compra)'}`,
        r.abatido > 0 ? `${brl(r.abatido)} abateu o crediário dessa compra` : null,
        r.numero !== null ? `Levou ${brl(r.levou)} — venda ${r.numero}` : null,
        r.pagou > 0 ? `Pagou ${brl(r.pagou)}${formaPaga ? ` no ${FORMAS.find((f) => f.forma === formaPaga)?.rotulo}` : ''}` : null,
        r.autorizadoPor ? `Autorizada por ${r.autorizadoPor}` : null,
      ].filter(Boolean) as string[],
    [r, formaPaga],
  )
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-norte border border-bom-borda bg-bom-fundo px-4 py-3">
        <p className="text-base font-bold text-bom">Troca feita. O estoque já foi acertado.</p>
        <ul className="flex flex-col gap-0.5 text-sm text-tinta-2">
          {linhas.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>

      {r.semEstoque.length > 0 && (
        <Aviso nivel="atencao">
          Saiu sem o sistema ter estoque: {r.semEstoque.join(', ')}. Foi para “Vendido sem estoque — conferir”, em Estoque.
        </Aviso>
      )}

      {vale && (
        <div className="flex flex-col gap-2 rounded-norte border border-borda bg-superficie px-4 py-3">
          <p className="text-sm text-tinta-2">
            Sobrou crédito: vira vale de <b className="font-semibold text-tinta">{brl(vale.saldo)}</b>
            {vale.validade ? `, até ${mostrarDiaDaColuna(new Date(vale.validade), 'longo')}` : ''}
            {config.valePorLoja ? `, só na ${config.unidadeNome}` : ''}. Entregue o papel para a cliente.
          </p>
          <p className="numero self-start rounded-norte border border-borda bg-superficie-2 px-4 py-2 font-mono text-2xl font-bold tracking-[0.15em] text-tinta">
            {vale.codigo}
          </p>
          <a
            href={`/${config.slug}/troca/vale/${vale.codigo}?imprimir=1`}
            className="self-start rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            Imprimir o vale
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {r.vendaId && (
          <a
            href={`/${config.slug}/vendas/${r.vendaId}/comprovante?imprimir=1`}
            className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            Imprimir o comprovante
          </a>
        )}
        {r.vendaId && formaPaga === 'CREDIARIO' && (
          <a
            href={`/${config.slug}/vendas/${r.vendaId}/carne?imprimir=1`}
            className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            Imprimir o carnê
          </a>
        )}
        <Botao tom="principal" onClick={aoRecomecar}>
          Outra troca
        </Botao>
        <Link href={`/${config.slug}/balcao?unidade=${config.unidadeId}`} className="rounded-norte px-3 py-2 text-sm font-medium text-tinta-2 hover:text-tinta">
          Voltar ao balcão
        </Link>
      </div>
    </div>
  )
}
