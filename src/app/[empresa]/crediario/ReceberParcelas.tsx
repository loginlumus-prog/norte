'use client'

// Receber o crediário: a cliente, as parcelas dela nesta loja, quanto paga e
// como — e o recibo no fim.
//
// ── por que tela própria por cima, e não um formulário na linha ──
// É a conversa mais longa do balcão: "quanto eu devo?", "quanto é com o
// atraso?", "posso pagar só as duas primeiras?", "metade no Pix". A tela
// precisa mostrar o carnê inteiro e o placar ao mesmo tempo, e o botão de
// receber sempre à vista — sem disputar altura com o pedido do balcão.
//
// ── a conta ──────────────────────────────────────────────────
// A mesma de recibos-conta.ts, feita aqui só para MOSTRAR. Quem grava é o
// servidor, que refaz tudo com o banco travado e recusa se der outra conta.
//
// ── marcar e o valor livre ───────────────────────────────────
// Marcar preenche o valor com o total das marcadas (com o atraso). O valor
// continua editável: menos abate na ordem (a última fica parcial), mais abate
// as mais antigas que faltam — e a tela diz isso antes de receber.

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Aviso, Botao, Situacao, cx } from '@/ui/base'
import { lerDinheiro, lerNumero } from '@/servidor/dinheiro'
import {
  contaDasMarcadas,
  explicarRecusa,
  planejarRecebimento,
  temMaquininha,
  type ParcelaParaReceber,
} from '@/servidor/recibos-conta'
import type { FichaParaReceber, ParcelaDoCarne } from '@/servidor/recibos'
import { baixaExternaAcao, fichaParaReceberAcao, procurarDevedoresAcao, receberVariasAcao } from './acoes'

type FormaChave = 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | 'TRANSFERENCIA'

const FORMAS: { chave: FormaChave; titulo: string }[] = [
  { chave: 'DINHEIRO', titulo: 'Dinheiro' },
  { chave: 'PIX', titulo: 'Pix' },
  { chave: 'DEBITO', titulo: 'Débito' },
  { chave: 'CREDITO', titulo: 'Crédito' },
  { chave: 'TRANSFERENCIA', titulo: 'Transferência' },
]

const brlC = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const campoC = (c: number) => (c / 100).toFixed(2).replace('.', ',')
const lerC = (t: string): number | null => {
  const v = lerDinheiro(t)
  return v === null ? null : Math.round(v * 100)
}
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`
const entre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 864e5)
const nParcelas = (n: number) => `${n} parcela${n === 1 ? '' : 's'}`

export type Recebeu = { reciboId: string; saldoDepois: number; quitou: boolean; troco: number; recebido: number; externo: boolean }

type LinhaForma = { forma: FormaChave; valor: string; maquininha: string }

export function ReceberParcelas({
  slug,
  unidadeId,
  clienteId: clienteInicial,
  marcar,
  aoFechar,
  aoReceber,
}: {
  slug: string
  unidadeId: string
  /** Sem cliente, a tela começa procurando quem veio pagar. */
  clienteId?: string | null
  /** Parcelas já marcadas ao abrir (o "Receber" da linha do Crediário). */
  marcar?: string[]
  aoFechar: () => void
  aoReceber?: (r: Recebeu) => void
}) {
  const idTitulo = useId()
  const painel = useRef<HTMLDivElement>(null)
  const [clienteId, setClienteId] = useState<string | null>(clienteInicial ?? null)
  const [ficha, setFicha] = useState<FichaParaReceber | null>(null)
  const [erroFicha, setErroFicha] = useState<string | null>(null)
  const [carregando, comecar] = useTransition()
  const [recebeu, setRecebeu] = useState<Recebeu | null>(null)

  // Esc fecha; a página de trás não rola com a tela aberta.
  const fechar = useRef(aoFechar)
  useEffect(() => {
    fechar.current = aoFechar
  })
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fechar.current()
      }
    }
    document.addEventListener('keydown', tecla)
    const rolagem = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    painel.current?.focus()
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = rolagem
    }
  }, [])

  function carregar(id: string) {
    setErroFicha(null)
    comecar(async () => {
      const r = await fichaParaReceberAcao(slug, id, unidadeId)
      if ('erro' in r) setErroFicha(r.erro)
      else setFicha(r.ficha)
    })
  }

  useEffect(() => {
    if (clienteId) carregar(clienteId)
  }, [clienteId])

  // No corpo da página, e não onde o botão está: aberta de dentro do pedido
  // do balcão simples (cabeçalho preso, `sticky`), ela ficava presa na camada
  // dele — e o rodapé do pedido, preso também, passava por cima do "Receber".
  if (typeof document === 'undefined') return null
  return createPortal(
    // z-[46]: por cima das folhas do balcão (45), abaixo da tranca de
    // inatividade (60).
    <div className="fixed inset-0 z-[46] flex items-end justify-center sm:items-center sm:p-6">
      <div aria-hidden onClick={aoFechar} className="absolute inset-0 bg-nav/45 backdrop-blur-[2px]" />
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className="realce-alto relative flex h-dvh w-full flex-col overflow-hidden border border-borda bg-superficie outline-none sm:h-[min(100dvh-3rem,60rem)] sm:max-w-3xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-borda-suave px-5 pt-4 pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id={idTitulo} className="text-xl leading-tight font-bold">
              {recebeu ? (recebeu.externo ? 'Baixa registrada' : 'Recebido') : 'Receber crediário'}
            </h2>
            <p className="truncate text-sm text-tinta-2">
              {ficha ? `${ficha.cliente.nome} · ${ficha.unidade.nome}` : 'Quem veio pagar?'}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
          >
            <svg aria-hidden width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {recebeu ? (
          <Feito slug={slug} r={recebeu} aoFechar={aoFechar} />
        ) : !clienteId ? (
          <Procurar slug={slug} unidadeId={unidadeId} aoEscolher={setClienteId} />
        ) : !ficha ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-tinta-2">
            {erroFicha ? <Aviso nivel="critico">{erroFicha}</Aviso> : carregando ? 'Abrindo o carnê…' : null}
          </div>
        ) : (
          <Receber
            key={ficha.cliente.id}
            slug={slug}
            ficha={ficha}
            marcar={marcar}
            aoTrocarCliente={clienteInicial ? undefined : () => { setFicha(null); setClienteId(null) }}
            aoReceber={(r) => {
              setRecebeu(r)
              aoReceber?.(r)
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}

// ─────────────────────────────────────────────────────────────
// QUEM VEIO PAGAR
// ─────────────────────────────────────────────────────────────

function Procurar({ slug, unidadeId, aoEscolher }: { slug: string; unidadeId: string; aoEscolher: (id: string) => void }) {
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<Awaited<ReturnType<typeof procurarDevedoresAcao>>>([])
  const [buscou, setBuscou] = useState(false)
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => campo.current?.focus(), [])
  // Espera a digitação parar: buscar a cada tecla faz a lista piscar.
  useEffect(() => {
    const t = setTimeout(() => {
      if (termo.trim().length < 2) {
        setAchados([])
        setBuscou(false)
        return
      }
      procurarDevedoresAcao(slug, termo, unidadeId).then((r) => {
        setAchados(r)
        setBuscou(true)
      })
    }, 250)
    return () => clearTimeout(t)
  }, [termo, slug, unidadeId])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
      <input
        ref={campo}
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Nome, telefone ou CPF"
        aria-label="Procurar quem deve"
        className="rounded-norte border border-borda bg-superficie px-3 py-2.5 text-base text-tinta placeholder:text-tinta-3"
      />
      {buscou && achados.length === 0 && (
        <p className="text-sm text-tinta-2">Ninguém com crediário em aberto nesta loja com esse nome.</p>
      )}
      <ul className="flex flex-col divide-y divide-borda-suave">
        {achados.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => aoEscolher(c.id)}
              className="flex w-full items-center justify-between gap-3 rounded px-2 py-2.5 text-left hover:bg-superficie-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-tinta">{c.nome}</span>
                <span className="text-xs text-tinta-3">{c.telefone ?? 'sem telefone'}</span>
              </span>
              <span className="flex flex-col items-end text-sm">
                <span className="numero font-semibold text-tinta">deve {brlC(c.devendoC)}</span>
                {c.vencidoC > 0 && <span className="numero text-xs font-semibold text-critico">{brlC(c.vencidoC)} vencido</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// O CARNÊ, O PLACAR E O PAGAMENTO
// ─────────────────────────────────────────────────────────────

function Receber({
  slug,
  ficha,
  marcar,
  aoTrocarCliente,
  aoReceber,
}: {
  slug: string
  ficha: FichaParaReceber
  marcar?: string[]
  aoTrocarCliente?: () => void
  aoReceber: (r: Recebeu) => void
}) {
  const parcelas = ficha.parcelas
  const paraConta: ParcelaParaReceber[] = useMemo(
    () => parcelas.map((p) => ({ id: p.id, restaC: p.restaC, multaC: p.multaC, jurosC: p.jurosC })),
    [parcelas],
  )
  const vencidas = useMemo(() => parcelas.filter((p) => p.dias > 0), [parcelas])

  const [modo, setModo] = useState<'agora' | 'fora'>('agora')
  // Abre com as vencidas marcadas (é o que quase sempre ela veio pagar) — ou
  // com a parcela que a pessoa clicou.
  const [marcadas, setMarcadas] = useState<Set<string>>(
    () => new Set(marcar?.length ? marcar.filter((id) => parcelas.some((p) => p.id === id)) : vencidas.map((p) => p.id)),
  )
  const [valorTexto, setValorTexto] = useState<string | null>(null)
  const [formas, setFormas] = useState<LinhaForma[]>([{ forma: 'DINHEIRO', valor: '', maquininha: '' }])
  const [entregue, setEntregue] = useState('')
  const [negociar, setNegociar] = useState(false)
  const [perdoar, setPerdoar] = useState(false)
  const [tirarAtraso, setTirarAtraso] = useState('')
  const [desconto, setDesconto] = useState('')
  const [descontoPct, setDescontoPct] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [pin, setPin] = useState('')
  const [referencia, setReferencia] = useState('')
  const [pagoEm, setPagoEm] = useState(ficha.hoje)
  const [formaFora, setFormaFora] = useState<FormaChave>('DINHEIRO')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()

  const fora = modo === 'fora'
  const conta = useMemo(() => contaDasMarcadas(paraConta, marcadas, ficha.regra.arredondar), [paraConta, marcadas, ficha.regra.arredondar])
  const atrasoMarcadasC = conta.multaC + conta.jurosC
  const descontoAtrasoC = fora || !negociar ? 0 : perdoar ? atrasoMarcadasC : Math.min(lerC(tirarAtraso) ?? 0, atrasoMarcadasC)
  const descontoC = (() => {
    if (fora || !negociar) return 0
    if (descontoPct) {
      const pct = lerNumero(desconto) ?? 0
      return Math.round((conta.principalC * Math.min(pct, 100)) / 100)
    }
    return lerC(desconto) ?? 0
  })()
  const sugeridoC = fora ? conta.principalC : Math.max(0, conta.totalC - descontoAtrasoC - descontoC)
  const valorC = valorTexto === null ? sugeridoC : (lerC(valorTexto) ?? NaN)

  const plano = useMemo(
    () =>
      Number.isFinite(valorC)
        ? planejarRecebimento(paraConta, {
            marcadas,
            dinheiroC: valorC,
            perdoarAtraso: !fora && negociar && perdoar,
            descontoAtrasoC: !fora && negociar && !perdoar ? descontoAtrasoC : 0,
            descontoC,
            arredondar: ficha.regra.arredondar,
            semAtraso: fora,
          })
        : null,
    [paraConta, marcadas, valorC, fora, negociar, perdoar, descontoAtrasoC, descontoC, ficha.regra.arredondar],
  )

  // As formas: a primeira linha é sempre o que falta (valor − as outras).
  const outrasC = formas.slice(1).map((f) => lerC(f.valor))
  const primeiraC = Number.isFinite(valorC) ? valorC - outrasC.reduce<number>((s, v) => s + (v ?? 0), 0) : NaN
  const valoresC = [primeiraC, ...outrasC]
  const dinheiroC = formas.reduce((s, f, i) => s + (f.forma === 'DINHEIRO' ? (valoresC[i] ?? 0) || 0 : 0), 0)
  const entregueC = entregue.trim() ? lerC(entregue) : null
  const trocoC = entregueC !== null && dinheiroC > 0 ? entregueC - dinheiroC : null

  const totalCarneC = parcelas.reduce((s, p) => s + p.restaC, 0)
  const vencidoC = vencidas.reduce((s, p) => s + p.restaC, 0)
  const atrasoHojeC = vencidas.reduce((s, p) => s + p.multaC + p.jurosC, 0)

  function trocarMarcadas(novas: Set<string>) {
    setMarcadas(novas)
    setValorTexto(null)
    setErro(null)
  }
  function alternar(id: string) {
    const n = new Set(marcadas)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    trocarMarcadas(n)
  }

  // O que impede receber, em uma frase — ou nada.
  const problema = (() => {
    if (!Number.isFinite(valorC)) return 'Não deu para ler o valor. Escreva assim: 49,90.'
    if (valorC <= 0 && marcadas.size === 0) return 'Marque as parcelas ou digite quanto ela está pagando.'
    if (plano && !plano.ok) return explicarRecusa(plano, brlC)
    if (fora) {
      if (referencia.trim().length < 3) return 'Diga de onde veio o pagamento (ex.: "sistema antigo, recibo 123").'
      return null
    }
    if (valoresC.some((v) => v === null || !Number.isFinite(v as number) || (v as number) <= 0)) {
      return formas.length > 1 ? 'Cada forma precisa de um valor, e a soma não pode passar do total.' : 'Diga quanto ela está pagando.'
    }
    if (dinheiroC > 0 && !ficha.caixaAberto) return 'Para receber em dinheiro o caixa desta loja precisa estar aberto. Abra o caixa — ou escolha Pix, cartão ou transferência.'
    if (trocoC !== null && trocoC < 0) return `Ela entregou menos que a parte em dinheiro (${brlC(dinheiroC)}).`
    if (negociar && (descontoAtrasoC > 0 || descontoC > 0)) {
      if (motivo.trim().length < 3) return 'Diga o motivo do desconto ou do perdão.'
      if (!ficha.negocia && pin.replace(/\D/g, '').length < 4) return 'Desconto e perdão precisam do PIN de quem negocia o crediário.'
    }
    return null
  })()

  function receber() {
    if (problema || !plano?.ok) return
    setErro(null)
    comecar(async () => {
      const r = fora
        ? await baixaExternaAcao(slug, {
            clienteId: ficha.cliente.id,
            unidadeId: ficha.unidade.id,
            parcelaIds: [...marcadas],
            valor: valorC / 100,
            forma: formaFora,
            referencia,
            pagoEm,
          })
        : await receberVariasAcao(slug, {
            clienteId: ficha.cliente.id,
            unidadeId: ficha.unidade.id,
            parcelaIds: [...marcadas],
            formas: formas.map((f, i) => ({ forma: f.forma, valor: (valoresC[i] as number) / 100, maquininha: f.maquininha || null })),
            entregue: entregueC !== null && dinheiroC > 0 ? entregueC / 100 : null,
            perdoarAtraso: negociar && perdoar,
            descontoAtraso: negociar && !perdoar ? descontoAtrasoC / 100 : 0,
            desconto: descontoC / 100,
            esperado: marcadas.size ? conta.totalC / 100 : null,
            autorizacao: negociar && !ficha.negocia && pin ? { pin: pin.replace(/\D/g, '') } : null,
            motivo: negociar ? motivo : null,
          })
      setPin('')
      if (r.ok) aoReceber({ ...r, externo: fora })
      else setErro(r.erro)
    })
  }

  // O carnê agrupado pela compra, na ordem da mais antiga.
  const grupos = useMemo(() => {
    const m = new Map<string, ParcelaDoCarne[]>()
    for (const p of parcelas) m.set(p.vendaId, [...(m.get(p.vendaId) ?? []), p])
    return [...m.values()]
  }, [parcelas])

  const maquininhasDe = (forma: string) => ficha.maquininhas.filter((m) => m.formas.includes(forma))

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-4">
          {/* ── o placar da cliente ── */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <Placar rotulo="Vencido" valor={brlC(vencidoC)} detalhe={vencidas.length ? nParcelas(vencidas.length) : 'nada vencido'} nivel={vencidoC > 0 ? 'critico' : 'bom'} />
            <Placar rotulo="Carnê inteiro" valor={brlC(totalCarneC)} detalhe={nParcelas(parcelas.length)} />
            <Placar
              rotulo="Atraso hoje"
              valor={brlC(atrasoHojeC)}
              detalhe={`${ficha.regra.multaPct.toLocaleString('pt-BR')}% multa · ${ficha.regra.jurosMes.toLocaleString('pt-BR')}% ao mês`}
              nivel={atrasoHojeC > 0 ? 'atencao' : undefined}
            />
          </div>

          {ficha.outrasLojas.length > 0 && (
            <Aviso nivel="neutro">
              Ela também deve em{' '}
              {ficha.outrasLojas.map((o, i) => (
                <span key={o.unidadeId}>
                  {i > 0 && ', '}
                  <b>{o.nome}</b> ({brlC(o.devendoC)}{o.vencidoC > 0 ? `, ${brlC(o.vencidoC)} vencido` : ''})
                </span>
              ))}
              . Cada loja recebe o dela.
            </Aviso>
          )}

          {ficha.negocia && (
            <div role="tablist" aria-label="Como foi pago" className="flex gap-1 self-start rounded-norte border border-borda p-1 text-sm">
              {(['agora', 'fora'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={modo === m}
                  onClick={() => {
                    setModo(m)
                    setValorTexto(null)
                    setErro(null)
                  }}
                  className={cx('rounded px-3 py-1.5 font-semibold', modo === m ? 'bg-marca text-marca-tinta' : 'text-tinta-2 hover:bg-superficie-2')}
                >
                  {m === 'agora' ? 'Recebendo agora' : 'Já pagou fora'}
                </button>
              ))}
            </div>
          )}
          {fora && (
            <p className="text-sm text-tinta-2">
              Para o pagamento que ela fez <b>fora daqui</b> (no outro sistema, direto na conta da loja). Acerta a dívida e
              fica no livro com a referência — não entra no caixa, no resultado nem nas metas, e não sai recibo de
              dinheiro recebido.
            </p>
          )}

          {/* ── os atalhos ── */}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Atalho ativo={vencidas.length > 0 && marcadas.size === vencidas.length && vencidas.every((p) => marcadas.has(p.id))} onClick={() => trocarMarcadas(new Set(vencidas.map((p) => p.id)))} desligado={vencidas.length === 0}>
              Só as vencidas
            </Atalho>
            <Atalho ativo={marcadas.size === parcelas.length} onClick={() => trocarMarcadas(new Set(parcelas.map((p) => p.id)))}>
              Carnê inteiro
            </Atalho>
            <Atalho ativo={false} onClick={() => trocarMarcadas(new Set())} desligado={marcadas.size === 0}>
              Desmarcar
            </Atalho>
            {aoTrocarCliente && (
              <button type="button" onClick={aoTrocarCliente} className="ml-auto text-xs text-tinta-3 underline-offset-2 hover:text-tinta hover:underline">
                outra cliente
              </button>
            )}
          </div>

          {/* ── o carnê ── */}
          <div className="flex flex-col gap-3">
            {grupos.map((g) => {
              const p0 = g[0]!
              const soma = g.reduce((s, p) => s + p.restaC, 0)
              return (
                <section key={p0.vendaId} className="rounded-norte border border-borda-suave">
                  <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-borda-suave bg-superficie-2 px-3 py-1.5 text-xs text-tinta-2">
                    <span className="font-semibold text-tinta">
                      {p0.importada ? `Saldo trazido do sistema anterior · nº ${p0.vendaNumero}` : `Compra nº ${p0.vendaNumero} · ${diaCurto(p0.vendaDia)}`}
                    </span>
                    <span className="numero">
                      {g.length} em aberto · {brlC(soma)}
                    </span>
                  </header>
                  <ul className="flex flex-col divide-y divide-borda-suave">
                    {g.map((p) => (
                      <LinhaParcela key={p.id} p={p} hoje={ficha.hoje} marcada={marcadas.has(p.id)} semAtraso={fora} aoMarcar={() => alternar(p.id)} />
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>

          {/* ── desconto e perdão ── */}
          {!fora && marcadas.size > 0 && (
            <details
              open={negociar}
              onToggle={(e) => setNegociar((e.target as HTMLDetailsElement).open)}
              className="rounded-norte border border-borda-suave px-3 py-2"
            >
              <summary className="cursor-pointer text-sm font-semibold text-tinta">
                Desconto ou perdão do atraso{!ficha.negocia && ' (precisa do PIN da gerente)'}
              </summary>
              <div className="mt-3 flex flex-col gap-3 text-sm">
                {atrasoMarcadasC > 0 && (
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={perdoar} onChange={(e) => { setPerdoar(e.target.checked); setValorTexto(null) }} />
                      Perdoar todo o atraso ({brlC(atrasoMarcadasC)})
                    </label>
                    {!perdoar && (
                      <label className="flex items-center gap-2 text-tinta-2">
                        ou tirar
                        <input
                          value={tirarAtraso}
                          onChange={(e) => { setTirarAtraso(e.target.value); setValorTexto(null) }}
                          inputMode="decimal"
                          placeholder="0,00"
                          className="numero w-24 rounded border border-borda bg-superficie px-2 py-1 text-tinta"
                        />
                        do atraso
                      </label>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-tinta-2">Desconto nas parcelas</span>
                  <input
                    value={desconto}
                    onChange={(e) => { setDesconto(e.target.value); setValorTexto(null) }}
                    inputMode="decimal"
                    placeholder="0"
                    className="numero w-24 rounded border border-borda bg-superficie px-2 py-1 text-tinta"
                  />
                  <div className="flex rounded border border-borda text-xs">
                    {[false, true].map((pct) => (
                      <button
                        key={String(pct)}
                        type="button"
                        onClick={() => { setDescontoPct(pct); setValorTexto(null) }}
                        className={cx('px-2 py-1 font-semibold', descontoPct === pct ? 'bg-marca text-marca-tinta' : 'text-tinta-2')}
                      >
                        {pct ? '%' : 'R$'}
                      </button>
                    ))}
                  </div>
                  {descontoC > 0 && <span className="numero text-tinta-2">− {brlC(descontoC)} · só para quitar as marcadas</span>}
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-tinta-2">Motivo (sai no recibo e no livro)</span>
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    maxLength={200}
                    placeholder="cliente antiga, acordo de quitação…"
                    className="rounded border border-borda bg-superficie px-2 py-1.5 text-tinta"
                  />
                </label>
                {!ficha.negocia && (
                  <label className="flex flex-col gap-1">
                    <span className="text-tinta-2">PIN de quem autoriza</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="numero w-32 rounded border border-borda bg-superficie px-2 py-1.5 text-tinta"
                    />
                    <span className="text-xs text-tinta-3">Fica registrado quem autorizou. O número não fica guardado em lugar nenhum.</span>
                  </label>
                )}
              </div>
            </details>
          )}

          {/* ── quanto e como ── */}
          <div className="flex flex-col gap-3 rounded-norte border border-borda p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-tinta">{fora ? 'Quanto ela pagou lá' : 'Recebendo agora'}</span>
                <input
                  value={valorTexto ?? campoC(sugeridoC)}
                  onChange={(e) => setValorTexto(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  inputMode="decimal"
                  className="numero rounded-norte border border-borda bg-superficie px-3 py-2 text-xl font-bold text-tinta"
                />
              </label>
              <Detalhe conta={conta} descontoAtrasoC={descontoAtrasoC} descontoC={descontoC} fora={fora} />
            </div>
            {plano?.ok && Number.isFinite(valorC) && marcadas.size > 0 && valorC !== sugeridoC && (
              <p className="text-xs text-tinta-2">
                {valorC > sugeridoC
                  ? `${brlC(valorC - sugeridoC)} a mais que as marcadas: abate as parcelas mais antigas que faltam.`
                  : 'Menos que as marcadas: abate na ordem, da mais antiga — a última fica com o resto.'}
              </p>
            )}
            {marcadas.size === 0 && plano?.ok && <p className="text-xs text-tinta-2">Sem parcela marcada, o valor abate das mais antigas.</p>}

            {fora ? (
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-tinta-2">De onde veio</span>
                  <input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={120} placeholder="sistema antigo, recibo 123" className="rounded border border-borda bg-superficie px-2 py-1.5 text-tinta" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-tinta-2">Pago em</span>
                  <input type="date" value={pagoEm} max={ficha.hoje} onChange={(e) => setPagoEm(e.target.value)} className="rounded border border-borda bg-superficie px-2 py-1.5 text-tinta" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-tinta-2">Como pagou</span>
                  <select value={formaFora} onChange={(e) => setFormaFora(e.target.value as FormaChave)} className="rounded border border-borda bg-superficie px-2 py-1.5 text-tinta">
                    {FORMAS.map((f) => (
                      <option key={f.chave} value={f.chave}>{f.titulo}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {formas.map((f, i) => {
                  const maqs = temMaquininha(f.forma) ? maquininhasDe(f.forma) : []
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <select
                        value={f.forma}
                        aria-label="Forma"
                        onChange={(e) => {
                          const n = [...formas]
                          n[i] = { ...f, forma: e.target.value as FormaChave, maquininha: '' }
                          setFormas(n)
                        }}
                        className="rounded border border-borda bg-superficie px-2 py-1.5 text-tinta"
                      >
                        {FORMAS.map((x) => (
                          <option key={x.chave} value={x.chave}>{x.titulo}</option>
                        ))}
                      </select>
                      {maqs.length > 1 && (
                        <select
                          value={f.maquininha}
                          aria-label="Maquininha"
                          onChange={(e) => {
                            const n = [...formas]
                            n[i] = { ...f, maquininha: e.target.value }
                            setFormas(n)
                          }}
                          className="rounded border border-borda bg-superficie px-2 py-1.5 text-tinta"
                        >
                          <option value="">maquininha…</option>
                          {maqs.map((m) => (
                            <option key={m.nome} value={m.nome}>{m.nome}</option>
                          ))}
                        </select>
                      )}
                      {maqs.length === 1 && <span className="text-xs text-tinta-3">{maqs[0]!.nome}</span>}
                      {i === 0 ? (
                        <span className="numero ml-auto font-semibold text-tinta">{Number.isFinite(primeiraC) ? brlC(primeiraC) : '—'}</span>
                      ) : (
                        <span className="ml-auto flex items-center gap-1">
                          <input
                            value={f.valor}
                            onChange={(e) => {
                              const n = [...formas]
                              n[i] = { ...f, valor: e.target.value }
                              setFormas(n)
                            }}
                            inputMode="decimal"
                            placeholder="0,00"
                            aria-label="Valor desta forma"
                            className="numero w-28 rounded border border-borda bg-superficie px-2 py-1.5 text-right text-tinta"
                          />
                          <button type="button" aria-label="Tirar esta forma" onClick={() => setFormas(formas.filter((_, j) => j !== i))} className="px-1 text-tinta-3 hover:text-critico">
                            ×
                          </button>
                        </span>
                      )}
                    </div>
                  )
                })}
                {formas.length < 4 && (
                  <button type="button" onClick={() => setFormas([...formas, { forma: 'PIX', valor: '', maquininha: '' }])} className="self-start text-xs font-semibold text-marca underline-offset-2 hover:underline">
                    + dividir em outra forma
                  </button>
                )}
                {dinheiroC > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex items-center gap-2 text-tinta-2">
                      Entregou em dinheiro
                      <input
                        value={entregue}
                        onChange={(e) => setEntregue(e.target.value)}
                        inputMode="decimal"
                        placeholder={campoC(dinheiroC)}
                        className="numero w-28 rounded border border-borda bg-superficie px-2 py-1.5 text-tinta"
                      />
                    </label>
                    {trocoC !== null && trocoC > 0 && <span className="numero text-lg font-bold text-tinta">Troco {brlC(trocoC)}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-borda-suave bg-superficie px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {(erro || problema) && (
          <div className="mb-2">
            <Aviso nivel={erro ? 'critico' : 'atencao'}>{erro ?? problema}</Aviso>
          </div>
        )}
        <Botao tom="confirmar" largo carregando={indo} disabled={!!problema} onClick={receber} className="py-3 text-base">
          {fora
            ? `Dar baixa de ${Number.isFinite(valorC) ? brlC(valorC) : '—'} pago fora`
            : `Receber ${Number.isFinite(valorC) ? brlC(valorC) : '—'}${plano?.ok ? ` · ${nParcelas(plano.linhas.length)}` : ''}`}
        </Botao>
      </footer>
    </>
  )
}

function LinhaParcela({
  p,
  hoje,
  marcada,
  semAtraso,
  aoMarcar,
}: {
  p: ParcelaDoCarne
  hoje: string
  marcada: boolean
  semAtraso: boolean
  aoMarcar: () => void
}) {
  const atrasoC = semAtraso ? 0 : p.multaC + p.jurosC
  const faltam = entre(hoje, p.vencimento)
  return (
    <li>
      <label className={cx('flex cursor-pointer items-center gap-3 px-3 py-2', marcada && 'bg-marca-suave')}>
        <input type="checkbox" checked={marcada} onChange={aoMarcar} className="size-5 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-tinta">
            Parcela {p.numero} de {p.de} · vence {diaCurto(p.vencimento)}
          </span>
          <span className="text-xs">
            {p.dias > 0 ? (
              <Situacao nivel="critico">
                {p.dias} dia{p.dias === 1 ? '' : 's'} atrasada
              </Situacao>
            ) : faltam === 0 ? (
              <Situacao nivel="atencao">vence hoje</Situacao>
            ) : (
              <span className="text-tinta-3">em dia · faltam {faltam} dia{faltam === 1 ? '' : 's'}</span>
            )}
            {p.pagoC + p.descontoC > 0 && <span className="text-tinta-3"> · já pagou {brlC(p.pagoC + p.descontoC)}</span>}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className={cx('numero font-semibold', p.dias > 0 ? 'text-critico' : 'text-tinta')}>{brlC(p.restaC + atrasoC)}</span>
          {atrasoC > 0 && (
            <span className="numero text-[11px] text-tinta-3">
              {brlC(p.restaC)} + {brlC(atrasoC)} atraso
            </span>
          )}
        </span>
      </label>
    </li>
  )
}

function Detalhe({
  conta,
  descontoAtrasoC,
  descontoC,
  fora,
}: {
  conta: ReturnType<typeof contaDasMarcadas>
  descontoAtrasoC: number
  descontoC: number
  fora: boolean
}) {
  if (conta.quantas === 0) return <div className="flex items-end text-sm text-tinta-3">Nenhuma parcela marcada.</div>
  const linhas: [string, number][] = [
    [`${nParcelas(conta.quantas)} marcada${conta.quantas === 1 ? '' : 's'}`, conta.principalC],
    ...(!fora && conta.multaC > 0 ? ([['Multa', conta.multaC]] as [string, number][]) : []),
    ...(!fora && conta.jurosC > 0 ? ([[conta.arredondamentoC ? 'Juros (arredondado)' : 'Juros', conta.jurosC]] as [string, number][]) : []),
    ...(descontoAtrasoC > 0 ? ([['Atraso perdoado', -descontoAtrasoC]] as [string, number][]) : []),
    ...(descontoC > 0 ? ([['Desconto', -descontoC]] as [string, number][]) : []),
  ]
  return (
    <dl className="flex flex-col justify-end text-sm">
      {linhas.map(([r, v]) => (
        <div key={r} className="flex justify-between gap-3 text-tinta-2">
          <dt>{r}</dt>
          <dd className="numero">{v < 0 ? `− ${brlC(-v)}` : brlC(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function Placar({ rotulo, valor, detalhe, nivel }: { rotulo: string; valor: string; detalhe: string; nivel?: 'critico' | 'atencao' | 'bom' }) {
  return (
    <div className="flex flex-col rounded-norte border border-borda-suave px-2 py-2">
      <span className="text-[11px] font-semibold tracking-wide text-tinta-3 uppercase">{rotulo}</span>
      <span className={cx('numero text-lg font-bold', nivel === 'critico' ? 'text-critico' : nivel === 'atencao' ? 'text-atencao' : 'text-tinta')}>{valor}</span>
      <span className="text-[11px] text-tinta-3">{detalhe}</span>
    </div>
  )
}

function Atalho({ ativo, desligado, onClick, children }: { ativo: boolean; desligado?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={desligado}
      onClick={onClick}
      aria-pressed={ativo}
      className={cx(
        'rounded-full border px-3 py-1 font-semibold disabled:opacity-40',
        ativo ? 'border-marca bg-marca text-marca-tinta' : 'border-borda text-tinta-2 hover:bg-superficie-2',
      )}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// DEPOIS DE RECEBER
// ─────────────────────────────────────────────────────────────

function Feito({ slug, r, aoFechar }: { slug: string; r: Recebeu; aoFechar: () => void }) {
  const recibo = `/${slug}/crediario/recibo/${r.reciboId}?imprimir=1`
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-8 text-center">
      {r.troco > 0 && (
        <div className="flex flex-col">
          <span className="text-sm text-tinta-2">Troco</span>
          <span className="numero text-4xl font-bold text-tinta">{brlC(Math.round(r.troco * 100))}</span>
        </div>
      )}
      <p className="text-lg font-semibold text-tinta">
        {r.externo ? 'Baixa de ' : 'Recebido '}
        {brlC(Math.round(r.recebido * 100))}.{' '}
        {r.quitou ? 'Ela quitou tudo nesta loja.' : `Ainda deve ${brlC(Math.round(r.saldoDepois * 100))} nesta loja.`}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {/* O recibo abre em OUTRA janela, e esta fica: o troco ainda está na
            tela, e no balcão a venda de trás continua lá. O `target` sozinho
            nem sempre basta: há navegador (e app instalado) que abre o link na
            mesma janela, e a tela do receber se perdia. Pedida como janela à
            parte, ela abre por cima; se o navegador recusar, o link segue. */}
        {!r.externo && (
          <a
            href={recibo}
            target="_blank"
            rel="noopener"
            onClick={(e) => {
              const janela = window.open(recibo, '_blank', 'popup=yes,width=480,height=760')
              if (janela) {
                e.preventDefault()
                try {
                  janela.opener = null
                } catch {}
              }
            }}
            className="rounded-norte bg-bom-vivo px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95"
          >
            Imprimir recibo
          </a>
        )}
        <Botao tom="secundario" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>
    </div>
  )
}
