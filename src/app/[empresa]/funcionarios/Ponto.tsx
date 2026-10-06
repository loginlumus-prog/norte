'use client'

// Os botões do ponto: bater (a entrada ou a saída que a tela mostra), lançar
// a batida que faltou (ajuste, com motivo) e anular a errada (com motivo).
//
// O botão manda o que ele MOSTRAVA ("Bater entrada"): se outra aba já bateu,
// o servidor recusa em vez de gravar uma saída no mesmo segundo.

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/ui/base'
import { abonarAcao, ajustarPontoAcao, anularBatidaAcao, baterPontoAcao, desfazerAbonoAcao, inicioAcao, type EstadoFicha } from './acoes'

export function BaterPonto({
  slug,
  colaboradorId,
  proxima,
  rotulo,
  grande = false,
}: {
  slug: string
  colaboradorId: string
  proxima: 'ENTRADA' | 'SAIDA'
  /** "Bater entrada" ou "Bater entrada de Bia". */
  rotulo?: string
  grande?: boolean
}) {
  const [indo, comecar] = useTransition()
  const [recado, setRecado] = useState<{ ok?: string; erro?: string } | null>(null)
  const router = useRouter()
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Botao
        tom={proxima === 'ENTRADA' ? 'confirmar' : 'secundario'}
        carregando={indo}
        className={grande ? 'px-5 py-3 text-base' : 'px-2.5 py-1.5 text-xs'}
        onClick={() =>
          comecar(async () => {
            const r = await baterPontoAcao(slug, colaboradorId, proxima)
            setRecado(r)
            if (r.ok) router.refresh()
          })
        }
      >
        {rotulo ?? (proxima === 'ENTRADA' ? 'Bater entrada' : 'Bater saída')}
      </Botao>
      {recado?.ok && <span className="text-xs font-medium text-bom">{recado.ok}</span>}
      {recado?.erro && (
        <span role="alert" className="text-xs text-critico">
          {recado.erro}
        </span>
      )}
    </span>
  )
}

export function Ajuste({ slug, colaboradorId, hoje }: { slug: string; colaboradorId: string; hoje: string }) {
  const [aberto, setAberto] = useState(false)
  const acao = ajustarPontoAcao.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoFicha, FormData>(acao, {})
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset()
      setAberto(false)
    }
  }, [estado.vez, estado.ok])

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Botao tom="secundario" onClick={() => setAberto(true)}>
          Lançar batida que faltou
        </Botao>
        {estado.ok && <span className="text-sm font-medium text-bom">{estado.ok}</span>}
      </div>
    )
  }
  return (
    <Cartao
      caixa
      titulo="Lançar batida que faltou"
      acao={
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-tinta-3 hover:text-tinta">
          fechar
        </button>
      }
    >
      <form
        ref={formRef}
        onSubmit={(ev) => {
          ev.preventDefault()
          const dados = new FormData(ev.currentTarget)
          startTransition(() => agir(dados))
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="colaboradorId" value={colaboradorId} />
        {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Selecao
            rotulo="O que faltou"
            name="tipo"
            opcoes={[
              { valor: 'SAIDA', titulo: 'Saída' },
              { valor: 'ENTRADA', titulo: 'Entrada' },
            ]}
          />
          <Campo rotulo="Dia" name="dia" type="date" required max={hoje} defaultValue={hoje} />
          <Campo rotulo="Hora" name="hora" type="time" required />
        </div>
        <Campo
          rotulo="Motivo"
          name="motivo"
          required
          minLength={5}
          placeholder="Esqueceu de bater a saída; saiu às 18h, confirmado pela gerente"
          dica="Obrigatório. Fica na folha, junto da batida, com o seu nome."
        />
        <div className="flex justify-end">
          <Botao type="submit" carregando={pendente}>
            {pendente ? 'Salvando...' : 'Lançar ajuste'}
          </Botao>
        </div>
      </form>
    </Cartao>
  )
}

export function Anular({ slug, registroId }: { slug: string; registroId: string }) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  if (!aberto) {
    return (
      <Botao tom="discreto" className="px-2 py-1 text-xs" onClick={() => setAberto(true)}>
        Anular
      </Botao>
    )
  }
  return (
    <span className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-end gap-1.5">
        <Campo
          rotulo="Por que está errada?"
          name={`anular-${registroId}`}
          value={motivo}
          onChange={(ev) => setMotivo(ev.currentTarget.value)}
          placeholder="Bateu duas vezes"
        />
        <Botao
          tom="perigo"
          className="px-2.5 py-2 text-xs"
          carregando={indo}
          disabled={motivo.trim().length < 5}
          onClick={() =>
            comecar(async () => {
              const r = await anularBatidaAcao(slug, registroId, motivo)
              if (r.erro) setErro(r.erro)
              else {
                setAberto(false)
                router.refresh()
              }
            })
          }
        >
          Sim, anular
        </Botao>
        <Botao tom="discreto" className="px-2.5 py-2 text-xs" onClick={() => setAberto(false)}>
          Não
        </Botao>
      </span>
      {erro && <span className="text-xs text-critico">{erro}</span>}
    </span>
  )
}

/** Os motivos de sempre, a um toque. "Outro" abre o campo. */
const MOTIVOS_DE_ABONO = ['Folga', 'Atestado', 'Feriado', 'Ainda não trabalhava']

/**
 * "Abonar" no dia de falta: folga, atestado, feriado. O dia deixa de contar
 * jornada e falta. As batidas não mudam — ninguém apaga batida.
 */
export function Abonar({ slug, colaboradorId, dia }: { slug: string; colaboradorId: string; dia: string }) {
  const [aberto, setAberto] = useState(false)
  const [outro, setOutro] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const abonar = (motivo: string) =>
    comecar(async () => {
      setErro(null)
      const r = await abonarAcao(slug, colaboradorId, dia, motivo)
      if (r.erro) return setErro(r.erro)
      setAberto(false)
      router.refresh()
    })

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="text-xs font-semibold text-marca underline-offset-2 hover:underline">
        abonar
      </button>
    )
  }
  return (
    <span className="flex w-full flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-1.5">
        {MOTIVOS_DE_ABONO.map((m) => (
          <Botao key={m} tom="secundario" className="px-2 py-1 text-xs" disabled={indo} onClick={() => abonar(m)}>
            {m}
          </Botao>
        ))}
        <input
          value={outro}
          onChange={(e) => setOutro(e.target.value)}
          placeholder="Outro motivo"
          aria-label="Outro motivo do abono"
          maxLength={120}
          className="h-8 w-36 rounded-norte border border-borda bg-superficie px-2 text-xs text-tinta"
        />
        <Botao tom="principal" className="px-2 py-1 text-xs" carregando={indo} disabled={outro.trim().length < 3} onClick={() => abonar(outro)}>
          Abonar
        </Botao>
        <Botao tom="discreto" className="px-2 py-1 text-xs" onClick={() => setAberto(false)}>
          Não
        </Botao>
      </span>
      {erro && <span className="text-xs text-critico">{erro}</span>}
    </span>
  )
}

/** Tira o abono: o dia volta a contar. */
export function DesfazerAbono({ slug, colaboradorId, dia }: { slug: string; colaboradorId: string; dia: string }) {
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={indo}
        onClick={() =>
          comecar(async () => {
            const r = await desfazerAbonoAcao(slug, colaboradorId, dia)
            if (r.erro) setErro(r.erro)
            else router.refresh()
          })
        }
        className="text-xs font-semibold text-tinta-2 underline-offset-2 hover:text-critico hover:underline"
      >
        {indo ? 'tirando…' : 'tirar abono'}
      </button>
      {erro && <span className="text-xs text-critico">{erro}</span>}
    </span>
  )
}

/** Abonar um dia que ainda não aparece como falta: o feriado de amanhã, a folga combinada. */
export function AbonarOutroDia({ slug, colaboradorId, hoje }: { slug: string; colaboradorId: string; hoje: string }) {
  const [dia, setDia] = useState(hoje)
  const [motivo, setMotivo] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; erro?: string } | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  return (
    <details className="rounded-norte border border-borda-suave px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold text-tinta">Abonar um dia (folga, atestado, feriado)</summary>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Campo rotulo="Dia" type="date" name={`abono-dia-${colaboradorId}`} value={dia} onChange={(e) => setDia(e.currentTarget.value)} />
        <Campo
          rotulo="Motivo"
          name={`abono-motivo-${colaboradorId}`}
          value={motivo}
          onChange={(e) => setMotivo(e.currentTarget.value)}
          placeholder="Folga, Atestado, Feriado…"
          maxLength={120}
        />
        <Botao
          tom="secundario"
          carregando={indo}
          disabled={motivo.trim().length < 3 || !dia}
          onClick={() =>
            comecar(async () => {
              const r = await abonarAcao(slug, colaboradorId, dia, motivo)
              setMsg(r)
              if (!r.erro) {
                setMotivo('')
                router.refresh()
              }
            })
          }
        >
          Abonar
        </Botao>
      </div>
      {msg?.erro && <p className="mt-1 text-xs text-critico">{msg.erro}</p>}
      {msg?.ok && <p className="mt-1 text-xs text-bom">{msg.ok}</p>}
    </details>
  )
}

/**
 * O primeiro dia de trabalho. Antes dele não há jornada nem falta — quem foi
 * cadastrado antes de começar não carrega falta dos dias em que não vinha.
 */
export function Inicio({ slug, colaboradorId, inicio, hoje }: { slug: string; colaboradorId: string; inicio: string; hoje: string }) {
  const [editando, setEditando] = useState(false)
  const [dia, setDia] = useState(inicio)
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const falado = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${inicio}T12:00:00Z`))

  if (!editando) {
    return (
      <p className="text-sm text-tinta-2">
        Trabalha aqui desde <b className="numero text-tinta">{falado}</b>.{' '}
        <button type="button" onClick={() => setEditando(true)} className="text-xs font-semibold text-marca underline-offset-2 hover:underline">
          mudar
        </button>
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <Campo
          rotulo="Primeiro dia de trabalho"
          type="date"
          name={`inicio-${colaboradorId}`}
          value={dia}
          max={hoje}
          onChange={(e) => setDia(e.currentTarget.value)}
          dica="Antes deste dia a folha não conta jornada nem falta."
        />
        <Botao
          tom="principal"
          carregando={indo}
          disabled={!dia}
          onClick={() =>
            comecar(async () => {
              const r = await inicioAcao(slug, colaboradorId, dia)
              if (r.erro) return setErro(r.erro)
              setEditando(false)
              router.refresh()
            })
          }
        >
          Salvar
        </Botao>
        <Botao tom="discreto" onClick={() => setEditando(false)}>
          Cancelar
        </Botao>
      </div>
      {erro && <p className="text-xs text-critico">{erro}</p>}
    </div>
  )
}
