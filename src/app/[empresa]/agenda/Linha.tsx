'use client'

// Os botões de cada horário: confirmar, atender e cobrar, atendido, faltou,
// remarcar, desmarcar.
//
// UM botão à mostra — o próximo passo do horário (cobrar, ou confirmar) — e o
// resto num "Mais". Seis botões por cartão quebravam em três linhas, e o
// "Desmarcar" tinha a mesma cara dos outros: agora ele fica por último no
// menu, em vermelho, separado.
//
// "Faltou" e "Desmarcar" perguntam antes (não voltam atrás); desmarcar pede o
// motivo, que fica no livro. "Atender e cobrar" não registra nada aqui: abre o
// Balcão com o serviço e o cliente já na venda — é a venda que, ao fechar,
// carimba o horário como atendido. O dinheiro tem um caminho só.

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { Aviso, Botao, Campo } from '@/ui/base'
import { BotaoDaLinha, IconeDaAcao, classeDaAcao } from '@/ui/premium'
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
}) {
  const [painel, setPainel] = useState<null | 'desmarcar' | 'atendido' | 'faltou'>(null)
  const [menu, setMenu] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const caixa = useRef<HTMLDivElement>(null)

  // O menu fecha no Esc e no clique fora — como qualquer menu.
  useEffect(() => {
    if (!menu) return
    const tecla = (ev: KeyboardEvent) => ev.key === 'Escape' && setMenu(false)
    const fora = (ev: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(ev.target as Node)) setMenu(false)
    }
    window.addEventListener('keydown', tecla)
    window.addEventListener('mousedown', fora)
    return () => {
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('mousedown', fora)
    }
  }, [menu])

  const vivo = situacao === 'MARCADO' || situacao === 'CONFIRMADO'

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

  // O botão à mostra é o próximo passo: cobrar; sem cobrar, confirmar.
  const confirmarAMostra = !podeCobrar && podeMexer && situacao === 'MARCADO'
  const fechar = () => setMenu(false)

  const itemMenu = 'block w-full rounded-norte px-3 py-2 text-left text-sm font-medium text-tinta hover:bg-superficie-2'
  const itens: ReactNode[] = []
  if (podeMexer && situacao === 'MARCADO' && !confirmarAMostra) {
    itens.push(
      <button key="confirmar" type="button" role="menuitem" className={itemMenu} title="O cliente disse que vem" onClick={() => { fechar(); mudar({ para: 'CONFIRMADO' }) }}>
        Confirmar
      </button>,
    )
  }
  if (podeMexer && vivo) {
    itens.push(
      <button key="atendido" type="button" role="menuitem" className={itemMenu} onClick={() => { fechar(); setPainel('atendido') }}>
        Atendido, sem cobrar agora
      </button>,
      <button key="faltou" type="button" role="menuitem" className={itemMenu} onClick={() => { fechar(); setPainel('faltou') }}>
        Faltou
      </button>,
      <Link key="remarcar" href={remarcarEm} role="menuitem" className={itemMenu} onClick={fechar}>
        Remarcar
      </Link>,
    )
  }
  if (podeMexer && situacao === 'CONFIRMADO') {
    itens.push(
      <button key="desfazer" type="button" role="menuitem" className={itemMenu} title="Confirmou por engano? Volta para marcado." onClick={() => { fechar(); mudar({ para: 'MARCADO' }) }}>
        Desfazer confirmação
      </button>,
    )
  }
  const podeDesmarcar = podeMexer && vivo

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={caixa} className="relative flex flex-wrap items-center gap-1">
        {/* O próximo passo em pílula; o "Mais" ao lado, com o resto. */}
        {podeCobrar && (
          <BotaoDaLinha href={cobrarEm!} icone="receber" rotulo="Atender e cobrar" tom="bom" comRotulo dica={`Atender e cobrar: ${resumo}`} />
        )}
        {confirmarAMostra && (
          <button
            type="button"
            className={classeDaAcao({ jeito: 'pilula' })}
            disabled={indo}
            aria-busy={indo || undefined}
            title="O cliente disse que vem"
            onClick={() => mudar({ para: 'CONFIRMADO' })}
          >
            <IconeDaAcao icone="conferir" tamanho={15} />
            Confirmar
          </button>
        )}
        {(itens.length > 0 || podeDesmarcar) && (
          <button
            type="button"
            className={classeDaAcao({ jeito: 'pilula' })}
            aria-haspopup="menu"
            aria-expanded={menu}
            disabled={indo && !confirmarAMostra && !painel}
            aria-busy={(indo && !confirmarAMostra && !painel) || undefined}
            onClick={() => setMenu((m) => !m)}
          >
            Mais ▾
          </button>
        )}
        {menu && (
          <div
            role="menu"
            className="absolute top-full left-0 z-30 mt-1 flex min-w-52 flex-col rounded-norte border border-borda bg-superficie p-1 shadow-norte-alta"
          >
            {itens}
            {podeDesmarcar && (
              <>
                {itens.length > 0 && <span aria-hidden className="my-1 border-t border-borda-suave" />}
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-norte px-3 py-2 text-left text-sm font-semibold text-critico hover:bg-critico-fundo"
                  onClick={() => {
                    fechar()
                    setPainel('desmarcar')
                  }}
                >
                  Desmarcar…
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {(painel === 'atendido' || painel === 'faltou') && (
        <Janela titulo={painel === 'atendido' ? `Atendido: ${resumo}` : `Faltou: ${resumo}`} aoFechar={() => setPainel(null)}>
          <p className="text-sm text-tinta-2">
            {painel === 'atendido'
              ? 'Marca como atendido sem cobrar agora. Para receber, use "Atender e cobrar".'
              : 'Anota a falta. Não volta atrás.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Botao
              tom={painel === 'atendido' ? 'confirmar' : 'perigo'}
              className="px-3 py-2 text-sm"
              carregando={indo}
              onClick={() => mudar({ para: painel === 'atendido' ? 'ATENDIDO' : 'FALTOU' })}
            >
              {painel === 'atendido' ? 'Sim, atendido' : 'Sim, faltou'}
            </Botao>
            <Botao tom="discreto" className="px-3 py-2 text-sm" onClick={() => setPainel(null)}>
              Voltar
            </Botao>
          </div>
          {erro && <Aviso nivel="critico">{erro}</Aviso>}
        </Janela>
      )}

      {painel === 'desmarcar' && (
        <Janela titulo={`Desmarcar: ${resumo}`} aoFechar={() => setPainel(null)}>
          <Campo
            rotulo="Por que desmarcar?"
            name={`motivo-${id}`}
            id={`motivo-${id}`}
            value={motivo}
            onChange={(ev) => setMotivo(ev.currentTarget.value)}
            placeholder="Pediu para remarcar, imprevisto..."
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
