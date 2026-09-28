'use client'

// Os botões do ponto: bater (a entrada ou a saída que a tela mostra), lançar
// a batida que faltou (ajuste, com motivo) e anular a errada (com motivo).
//
// O botão manda o que ele MOSTRAVA ("Bater entrada"): se outra aba já bateu,
// o servidor recusa em vez de gravar uma saída no mesmo segundo.

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/ui/base'
import { ajustarPontoAcao, anularBatidaAcao, baterPontoAcao, type EstadoFicha } from './acoes'

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
