'use client'

// As ordens em produção, e o encerramento: quanto saiu DE VERDADE e quanto
// de cada insumo foi usado. Tudo já vem preenchido com o previsto — na
// maioria dos dias a pessoa só confere e encerra; quando o leite rendeu
// menos, ela troca um número.
//
// O resultado (o custo apurado, ou o aviso de que faltou custo) fica em cima
// da lista, e não dentro do cartão da ordem: ao encerrar, a ordem sai das
// abertas e o cartão some — o recado não pode sumir com ele.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Situacao } from '@/ui/base'
import { CampoDoPin } from '@/ui/Assinar'
import { brl } from '@/ui/painel'
import { quantidade } from '@/ui/texto'
import type { OrdemNaTela } from '@/servidor/fabrica'
import { cancelarOrdemAcao, encerrarOrdemAcao, type RecadoDoEncerramento } from './acoes'
import { LEGIVEL, diaBR, diaMaisDias, ler, paraCampo, quando, sigla } from './formato'

type Resultado = RecadoDoEncerramento & { ordemId: string; numero: number; produto: string; medida: string; produzida: number; comInsumos: boolean }

export function OrdensAbertas({
  slug,
  ordens,
  podeEm,
  validadeDias,
  hoje,
  verCusto,
}: {
  slug: string
  ordens: OrdemNaTela[]
  /** Ids das ordens que a pessoa pode encerrar (estoque da fábrica dela). */
  podeEm: string[]
  /** Dias de validade da ficha técnica, por produto. */
  validadeDias: Record<string, number>
  hoje: string
  verCusto: boolean
}) {
  const [resultado, setResultado] = useState<Resultado | null>(null)

  return (
    <div className="flex flex-col gap-3">
      {resultado && <ResultadoDoEncerramento slug={slug} r={resultado} verCusto={verCusto} />}
      {ordens.length === 0 ? (
        <p className="text-sm text-tinta-3">Nenhuma ordem em produção agora.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {ordens.map((o) => (
            <li key={o.id}>
              <Ordem
                slug={slug}
                ordem={o}
                pode={podeEm.includes(o.id)}
                validadeSugerida={validadeDias[o.variacaoId] ? diaMaisDias(hoje, validadeDias[o.variacaoId]!) : ''}
                diasDaFicha={validadeDias[o.variacaoId] ?? null}
                aoEncerrar={(r) => setResultado(r)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ResultadoDoEncerramento({ slug, r, verCusto }: { slug: string; r: Resultado; verCusto: boolean }) {
  const linha = `OP ${r.numero} encerrada: saíram ${quantidade(r.produzida, r.medida)} de ${r.produto}, lote ${r.lote}${r.validade ? `, validade ${diaBR(r.validade)}` : ''}.`
  const etiquetas = (
    <Link href={`/${slug}/fabrica/ordens/${r.ordemId}/etiqueta`} className="font-semibold underline underline-offset-2">
      Imprimir as etiquetas do lote
    </Link>
  )
  if (!r.comInsumos) {
    return (
      <Aviso nivel="bom">
        {linha} Sem ficha técnica, o custo não é apurado. {etiquetas}
      </Aviso>
    )
  }
  if (r.faltouCusto) {
    return (
      <Aviso nivel="atencao">
        {linha} Faltou o custo de algum insumo, então o custo do produto NÃO mudou — meia conta seria custo falso. Ponha o
        custo na ficha do insumo (Produtos) e a próxima produção já apura. {etiquetas}
      </Aviso>
    )
  }
  const fora = r.foraDaReceita
    ? ` ${r.foraDaReceita === 1 ? 'Um insumo usado não estava' : `${r.foraDaReceita} insumos usados não estavam`} na ficha técnica: entrou na ordem e no custo.`
    : ''
  // Quem encerra sem poder mexer em preço registra a produção; o custo do
  // produto fica com quem decide preço.
  if (!r.custoAtualizado) {
    return (
      <Aviso nivel="atencao">
        {linha}
        {verCusto && r.custoUnitario != null ? ` Custo apurado: ${brl(r.custoUnitario)} por ${sigla(r.medida)}.` : ''} O custo do produto
        ficou como estava — mexer em custo é de quem decide preço.{fora} {etiquetas}
      </Aviso>
    )
  }
  return (
    <Aviso nivel="bom">
      {linha}{' '}
      {verCusto && r.custoUnitario != null
        ? `Custo apurado: ${brl(r.custoUnitario)} por ${sigla(r.medida)} — entrou no custo médio deste item, e a margem das lojas é calculada por ele.`
        : 'O custo apurado entrou no custo médio deste item.'}
      {fora} {etiquetas}
    </Aviso>
  )
}

function Ordem({
  slug,
  ordem: o,
  pode,
  validadeSugerida,
  diasDaFicha,
  aoEncerrar,
}: {
  slug: string
  ordem: OrdemNaTela
  pode: boolean
  validadeSugerida: string
  diasDaFicha: number | null
  aoEncerrar: (r: Resultado) => void
}) {
  const [modo, setModo] = useState<'ver' | 'encerrar' | 'cancelar'>('ver')
  const [produzida, setProduzida] = useState(paraCampo(o.prevista))
  const [usado, setUsado] = useState<Record<string, string>>(() => Object.fromEntries(o.consumos.map((c) => [c.insumoId, paraCampo(c.previsto)])))
  const [lote, setLote] = useState(o.lote)
  const [validade, setValidade] = useState(validadeSugerida)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  // A vendedora que produz porque a empresa deixou assina com o PIN dela.
  const [pedePin, setPedePin] = useState(false)
  const [pin, setPin] = useState('')
  const [indo, comecar] = useTransition()
  const router = useRouter()

  function encerrar() {
    const q = ler(produzida)
    const consumos = o.consumos.map((c) => ({ insumoId: c.insumoId, usado: ler(usado[c.insumoId] ?? '') ?? 0 }))
    if (q === null || Number.isNaN(q) || consumos.some((c) => Number.isNaN(c.usado))) {
      setErro(q === null ? 'Quanto saiu de verdade?' : LEGIVEL)
      return
    }
    setErro(null)
    comecar(async () => {
      const r = await encerrarOrdemAcao(slug, o.id, { produzida: q, consumos, lote, validade, pin: pin || null })
      setPin('')
      if (r.erro) {
        if (r.precisaPin) setPedePin(true)
        setErro(r.erro)
        return
      }
      aoEncerrar({ ...r, ordemId: o.id, numero: o.numero, produto: o.produto, medida: o.medida, produzida: q, comInsumos: o.consumos.length > 0 })
      router.refresh()
    })
  }

  function cancelar() {
    comecar(async () => {
      const r = await cancelarOrdemAcao(slug, o.id, motivo)
      if (r.erro) setErro(r.erro)
      else router.refresh()
    })
  }

  return (
    <article className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-tinta-3">OP {o.numero}</span>
            <span className="font-semibold text-tinta">{o.produto}</span>
            <Situacao nivel="atencao">em produção</Situacao>
          </span>
          <span className="text-xs text-tinta-3">
            {o.unidade} · {o.consumos.length > 0 ? `${paraCampo(o.bateladas)} ${o.bateladas === 1 ? 'batelada' : 'bateladas'} · ` : ''}
            previsto {quantidade(o.prevista, o.medida)} · lote <span className="font-mono">{o.lote}</span> · aberta {quando(o.criadaEm)} por {o.quem}
          </span>
        </div>
        {pode && modo === 'ver' && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Botao tom="confirmar" onClick={() => setModo('encerrar')}>
              Encerrar
            </Botao>
            <Botao tom="discreto" onClick={() => setModo('cancelar')}>
              Cancelar
            </Botao>
          </div>
        )}
      </header>

      {modo === 'encerrar' && (
        <div className="flex flex-col gap-4 border-t border-borda-suave pt-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo
              rotulo={`Quanto saiu de verdade (${sigla(o.medida)})`}
              name={`saiu-${o.id}`}
              id={`saiu-${o.id}`}
              inputMode="decimal"
              value={produzida}
              onChange={(ev) => setProduzida(ev.currentTarget.value)}
              dica={`Previsto: ${quantidade(o.prevista, o.medida)}`}
            />
            <Campo rotulo="Lote" name={`lote-${o.id}`} id={`lote-${o.id}`} value={lote} onChange={(ev) => setLote(ev.currentTarget.value)} maxLength={40} />
            <Campo
              rotulo="Validade"
              name={`validade-${o.id}`}
              id={`validade-${o.id}`}
              type="date"
              value={validade}
              onChange={(ev) => setValidade(ev.currentTarget.value)}
              dica={diasDaFicha ? `Pela ficha técnica: ${diasDaFicha} dias a partir de hoje.` : 'Opcional.'}
            />
          </div>

          {o.consumos.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-tinta">O que foi usado</p>
              <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda">
                {o.consumos.map((c) => (
                  <li key={c.insumoId} className="grid grid-cols-1 items-end gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-tinta">{c.nome}</span>
                      <span className="text-xs text-tinta-3">previsto {quantidade(c.previsto, c.medida)}</span>
                    </span>
                    <Campo
                      rotulo={`Usado (${sigla(c.medida)})`}
                      name={`usado-${o.id}-${c.insumoId}`}
                      id={`usado-${o.id}-${c.insumoId}`}
                      inputMode="decimal"
                      value={usado[c.insumoId] ?? ''}
                      onChange={(ev) => {
                        const v = ev.currentTarget.value
                        setUsado((m) => ({ ...m, [c.insumoId]: v }))
                      }}
                    />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-tinta-3">
                O usado sai do estoque da fábrica. Insumo sem estoque lançado não trava a produção: o saldo fica negativo, e
                é o aviso de que falta dar entrada na compra.
              </p>
            </div>
          )}

          {pedePin && (
            <div className="max-w-xs">
              <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} aoEnviar={encerrar} />
            </div>
          )}
          {erro && <Aviso nivel="critico">{erro}</Aviso>}
          <div className="flex flex-wrap justify-end gap-2">
            <Botao tom="discreto" onClick={() => { setErro(null); setModo('ver') }}>
              Voltar
            </Botao>
            <Botao tom="confirmar" carregando={indo} onClick={encerrar}>
              {indo ? 'Encerrando…' : 'Encerrar e dar entrada'}
            </Botao>
          </div>
        </div>
      )}

      {modo === 'cancelar' && (
        <div className="flex flex-col gap-2 border-t border-borda-suave pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <Campo
              rotulo="Por que cancelar?"
              name={`motivo-${o.id}`}
              id={`motivo-${o.id}`}
              value={motivo}
              onChange={(ev) => setMotivo(ev.currentTarget.value)}
              placeholder="Abri errado, faltou leite…"
            />
            <Botao tom="perigo" carregando={indo} disabled={motivo.trim().length < 3} onClick={cancelar}>
              Cancelar a ordem
            </Botao>
            <Botao tom="discreto" onClick={() => { setErro(null); setModo('ver') }}>
              Voltar
            </Botao>
          </div>
          <p className="text-xs text-tinta-3">Nada saiu do estoque ainda: cancelar só tira a ordem da fila.</p>
          {erro && <Aviso nivel="critico">{erro}</Aviso>}
        </div>
      )}
    </article>
  )
}
