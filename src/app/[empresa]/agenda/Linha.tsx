'use client'

// Os botões de cada horário: confirmar, atender e cobrar, atendido, faltou,
// remarcar, desmarcar.
//
// "Faltou" e "Desmarcar" perguntam antes (não voltam atrás); desmarcar pede o
// motivo, que fica no livro. "Atender e cobrar" não registra nada aqui: abre o
// Balcão com o serviço e o cliente já na venda — é a venda que, ao fechar,
// carimba o horário como atendido. O dinheiro tem um caminho só.

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { Aviso, Botao, Campo, cx } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { mudarHorarioAcao } from './acoes'

type Situacao = 'MARCADO' | 'CONFIRMADO' | 'ATENDIDO' | 'FALTOU' | 'CANCELADO'

/** A janela por cima da tela. Esc ou clique fora fecha. */
function Janela({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => ev.key === 'Escape' && aoFechar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aoFechar])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div aria-hidden onClick={aoFechar} className="absolute inset-0 bg-nav/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="relative flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-norte border border-borda bg-superficie p-4 shadow-norte-alta"
      >
        <h2 className="text-[15px] font-bold text-tinta">{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

export function AcoesHorario({
  slug,
  id,
  resumo,
  situacao,
  cobrado,
  podeMexer,
  cobrarEm,
  remarcarEm,
  compacto = false,
}: {
  slug: string
  id: string
  /** "Joana — Manicure, 15:00": para a pergunta dizer de qual se trata. */
  resumo: string
  situacao: Situacao
  /** Já tem venda: não se cobra de novo. */
  cobrado: boolean
  podeMexer: boolean
  /** O endereço do balcão para cobrar, ou nulo se esta pessoa não vende aqui. */
  cobrarEm: string | null
  remarcarEm: string
  compacto?: boolean
}) {
  const [painel, setPainel] = useState<null | 'desmarcar'>(null)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()

  const vivo = situacao === 'MARCADO' || situacao === 'CONFIRMADO'
  const tam = compacto ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-xs'

  function mudar(m: Parameters<typeof mudarHorarioAcao>[2]) {
    setErro(null)
    comecar(async () => {
      const r = await mudarHorarioAcao(slug, id, m)
      if (r.erro) setErro(r.erro)
      else setPainel(null)
    })
  }

  // Atendido e ainda sem venda: o cobrar continua valendo (atendeu, e a
  // pessoa paga agora). Faltou e desmarcado não pedem nada.
  const podeCobrar = !!cobrarEm && !cobrado && (vivo || situacao === 'ATENDIDO')
  if (!podeMexer && !podeCobrar) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {podeCobrar && (
          <Link
            href={cobrarEm!}
            className={cx('inline-flex items-center justify-center rounded-norte border border-transparent bg-bom-vivo font-semibold text-white hover:brightness-95', tam)}
          >
            Atender e cobrar
          </Link>
        )}
        {podeMexer && situacao === 'MARCADO' && (
          <Botao tom="secundario" className={tam} carregando={indo} onClick={() => mudar({ para: 'CONFIRMADO' })} title="O cliente disse que vem">
            Confirmar
          </Botao>
        )}
        {podeMexer && vivo && (
          <Confirmar
            className={tam}
            tom="discreto"
            tomSim="confirmar"
            pergunta="Atendido sem cobrar agora?"
            sim="Sim, atendido"
            aoConfirmar={() => mudarHorarioAcao(slug, id, { para: 'ATENDIDO' })}
          >
            Atendido
          </Confirmar>
        )}
        {podeMexer && vivo && (
          <Confirmar
            className={tam}
            tom="discreto"
            pergunta="Anotar falta?"
            sim="Sim, faltou"
            aoConfirmar={() => mudarHorarioAcao(slug, id, { para: 'FALTOU' })}
          >
            Faltou
          </Confirmar>
        )}
        {podeMexer && vivo && (
          <Link
            href={remarcarEm}
            className={cx('inline-flex items-center justify-center rounded-norte border border-transparent font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta', tam)}
          >
            Remarcar
          </Link>
        )}
        {podeMexer && situacao === 'CONFIRMADO' && (
          <Botao tom="discreto" className={tam} carregando={indo} onClick={() => mudar({ para: 'MARCADO' })} title="Confirmou por engano? Volta para marcado.">
            Desfazer confirmação
          </Botao>
        )}
        {podeMexer && vivo && (
          <Botao tom="discreto" className={tam} onClick={() => setPainel('desmarcar')}>
            Desmarcar
          </Botao>
        )}
      </div>

      {painel === 'desmarcar' && (
        <Janela titulo={`Desmarcar: ${resumo}`} aoFechar={() => setPainel(null)}>
          <Campo
            rotulo="Por que desmarcar?"
            name={`motivo-${id}`}
            id={`motivo-${id}`}
            value={motivo}
            onChange={(ev) => setMotivo(ev.currentTarget.value)}
            placeholder="Pediu para remarcar, a profissional adoeceu..."
            required
          />
          <p className="text-xs text-tinta-3">O horário fica livre na agenda. O desmarcado continua na história do dia.</p>
          <div className="flex flex-wrap gap-1.5">
            <Botao
              tom="perigo"
              className="px-3 py-2 text-sm"
              carregando={indo}
              disabled={motivo.trim().length < 3}
              onClick={() => mudar({ para: 'CANCELADO', motivo })}
            >
              Desmarcar horário
            </Botao>
            <Botao tom="discreto" className="px-3 py-2 text-sm" onClick={() => setPainel(null)}>
              Voltar
            </Botao>
          </div>
          {erro && <Aviso nivel="critico">{erro}</Aviso>}
        </Janela>
      )}

      {erro && !painel && <Aviso nivel="critico">{erro}</Aviso>}
    </div>
  )
}
