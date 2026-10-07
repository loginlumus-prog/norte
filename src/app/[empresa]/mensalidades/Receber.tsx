'use client'

// Receber uma mensalidade, na própria linha.
//
// O formulário abre com o valor certo já preenchido: o que falta, mais a
// multa e o juro de hoje se estiver atrasada. Juro e multa ficam editáveis
// PARA BAIXO — cobrança é conversa ("tira a multa dessa vez") —, e o servidor
// recusa para cima. O desconto de pontualidade é uma caixa: vale só para quem
// paga tudo, até o vencimento, de uma vez.

import { useActionState, useState } from 'react'
import { BotaoDaLinha, DicaDaAcao, IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { Aviso, Botao, cx } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { lerDinheiro } from '@/servidor/dinheiro'
import { dispensarMensalidadeAcao, receberMensalidadeAcao, type EstadoRecebimento } from './acoes'

const FORMAS = [
  { chave: 'DINHEIRO', titulo: 'Dinheiro' },
  { chave: 'PIX', titulo: 'Pix' },
  { chave: 'DEBITO', titulo: 'Débito' },
  { chave: 'CREDITO', titulo: 'Crédito' },
  { chave: 'TRANSFERENCIA', titulo: 'Transferência' },
]

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const campo = (v: number) => v.toFixed(2).replace('.', ',')

export function Receber({
  slug,
  mensalidadeId,
  resta,
  jurosHoje,
  multaHoje,
  abonoHoje,
  diasAtraso,
  diasJuros,
}: {
  slug: string
  mensalidadeId: string
  resta: number
  jurosHoje: number
  multaHoje: number
  /** O desconto de pontualidade possível hoje (zero = não cabe). */
  abonoHoje: number
  diasAtraso: number
  diasJuros: number
}) {
  const [aberto, setAberto] = useState(false)
  const [juros, setJuros] = useState(campo(jurosHoje))
  const [multa, setMulta] = useState(campo(multaHoje))
  const [pontual, setPontual] = useState(abonoHoje > 0)
  const [valor, setValor] = useState(campo(resta + jurosHoje + multaHoje - (abonoHoje > 0 ? abonoHoje : 0)))
  const [estado, agir, pendente] = useActionState<EstadoRecebimento, FormData>(receberMensalidadeAcao, {})

  if (estado.ok) {
    return (
      <span className="flex flex-col items-end gap-0.5 text-xs">
        <span className="font-semibold text-bom">{estado.ok}</span>
        {estado.mensalidadeId && (
          <BotaoDaLinha href={`/${slug}/mensalidades/${estado.mensalidadeId}/recibo`} icone="imprimir" rotulo="Recibo" comRotulo />
        )}
      </span>
    )
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={classeDaAcao({ jeito: 'pilula', tom: 'principal' })}>
        Receber
        <IconeDaAcao icone="receber" tamanho={14} grosso />
      </button>
    )
  }

  const recalcular = (j: string, m: string, p: boolean) => {
    const nj = lerDinheiro(j) ?? 0
    const nm = lerDinheiro(m) ?? 0
    setValor(campo(resta + nj + nm - (p ? abonoHoje : 0)))
  }

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex min-w-[17rem] flex-col gap-2 rounded-norte border border-borda bg-superficie-2 p-2 text-left text-xs">
      <input type="hidden" name="empresa" value={slug} />
      <input type="hidden" name="mensalidade" value={mensalidadeId} />

      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      {diasAtraso > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-tinta-2">
            Multa
            <input
              name="multa"
              value={multa}
              onChange={(e) => {
                setMulta(e.target.value)
                recalcular(juros, e.target.value, false)
              }}
              inputMode="decimal"
              className="numero rounded border border-borda bg-superficie px-2 py-1 text-sm text-tinta"
            />
            <span className="text-[12.5px] text-tinta-3">{multaHoje > 0 ? `até ${brl(multaHoje)}` : 'já resolvida antes'}</span>
          </label>
          <label className="flex flex-col gap-1 text-tinta-2">
            Juros
            <input
              name="juros"
              value={juros}
              onChange={(e) => {
                setJuros(e.target.value)
                recalcular(e.target.value, multa, false)
              }}
              inputMode="decimal"
              className="numero rounded border border-borda bg-superficie px-2 py-1 text-sm text-tinta"
            />
            <span className="text-[12.5px] text-critico">
              {diasAtraso} dia{diasAtraso === 1 ? '' : 's'} de atraso
              {diasJuros < diasAtraso && ` · juro de ${diasJuros} dia${diasJuros === 1 ? '' : 's'}`}
            </span>
          </label>
        </div>
      )}

      {abonoHoje > 0 && (
        <label className="flex items-center gap-2 text-tinta-2">
          <input
            type="checkbox"
            name="pontualidade"
            checked={pontual}
            onChange={(e) => {
              setPontual(e.target.checked)
              recalcular('0', '0', e.target.checked)
            }}
            className="accent-[var(--marca)]"
          />
          Desconto de pontualidade: −{brl(abonoHoje)}
        </label>
      )}

      <label className="flex flex-col gap-1 text-tinta-2">
        Recebendo agora
        <input
          name="valor"
          value={valor}
          onChange={(e) => {
            setValor(e.target.value)
            // Pagou uma parte: o desconto de pontualidade não vale.
            if (pontual && (lerDinheiro(e.target.value) ?? 0) + abonoHoje < resta) setPontual(false)
          }}
          inputMode="decimal"
          autoFocus
          onFocus={(e) => e.target.select()}
          className="numero rounded border border-borda bg-superficie px-2 py-1 text-sm font-semibold text-tinta"
        />
        <span className={cx('text-[12.5px] text-tinta-3')}>falta {brl(resta)}</span>
      </label>

      <label className="flex flex-col gap-1 text-tinta-2">
        Como recebeu
        <select name="forma" defaultValue="DINHEIRO" className="rounded border border-borda bg-superficie px-2 py-1 text-sm text-tinta">
          {FORMAS.map((f) => (
            <option key={f.chave} value={f.chave}>
              {f.titulo}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <Botao type="submit" tom="confirmar" carregando={pendente} className="py-1 text-xs">
          {pendente ? 'Registrando...' : 'Confirmar'}
        </Botao>
        <Botao type="button" tom="discreto" onClick={() => setAberto(false)} className="py-1 text-xs">
          Cancelar
        </Botao>
      </div>
    </form>
  )
}

/** Dispensar a mensalidade de um mês: pergunta o motivo antes. */
export function Dispensar({ slug, id }: { slug: string; id: string }) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [indo, setIndo] = useState(false)
  if (ok) return <span className="text-xs text-tinta-3">{ok}</span>
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={classeDaAcao({ tom: 'perigo' })} aria-label="Dispensar a mensalidade deste mês">
        <IconeDaAcao icone="cancelar" />
        <DicaDaAcao>Dispensar</DicaDaAcao>
      </button>
    )
  }
  return (
    <span className="flex min-w-[14rem] flex-col gap-1 rounded-norte border border-borda bg-superficie-2 p-2 text-xs">
      {erro && <span className="text-critico">{erro}</span>}
      <label className="flex flex-col gap-1 text-tinta-2">
        Por que dispensar?
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          autoFocus
          placeholder="entrou no fim do mês"
          className="rounded border border-borda bg-superficie px-2 py-1 text-sm text-tinta"
        />
      </label>
      <span className="flex gap-2">
        <Botao
          tom="perigo"
          className="py-1 text-xs"
          carregando={indo}
          disabled={motivo.trim().length < 3}
          onClick={async () => {
            setIndo(true)
            setErro(null)
            const r = await dispensarMensalidadeAcao(slug, id, motivo)
            setIndo(false)
            if (r.erro) setErro(r.erro)
            else setOk(r.ok ?? 'Dispensada.')
          }}
        >
          Sim, dispensar
        </Botao>
        <Botao tom="discreto" className="py-1 text-xs" onClick={() => setAberto(false)}>
          Não
        </Botao>
      </span>
    </span>
  )
}
