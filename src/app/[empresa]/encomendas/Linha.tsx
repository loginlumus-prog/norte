'use client'

// Os botões de cada encomenda: pronta, entregue, cancelar, mudar.
//
// Entregar e cancelar abrem uma pergunta ANTES de gravar, numa janela por
// cima da lista — são as duas mudanças que não voltam, e as duas mexem com
// dinheiro. Janela, e não painel dentro da linha: na tabela do modo avançado
// a célula de ações é estreita, e a pergunta espremida ali virava rolagem de
// lado.
//
// ── entregar e o balcão ──────────────────────────────────────
// O que falta pagar é recebido no Balcão, como venda. Esta tela NÃO registra
// venda nenhuma: o botão "Receber no balcão" marca a entrega e só abre a tela
// do Balcão. A pessoa lança lá o que falta — e a tela diz o valor, e diz que
// é SÓ o que falta, porque o sinal já entrou no financeiro e lançar o valor
// cheio contaria o sinal duas vezes.

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Marcar, cx } from '@/ui/base'
import { brl } from '@/ui/painel'
import { mudarSituacaoAcao } from './acoes'

type Situacao = 'ABERTA' | 'PRONTA' | 'ENTREGUE' | 'CANCELADA'

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

export function AcoesEncomenda({
  slug,
  id,
  resumo,
  situacao,
  falta,
  sinal,
  podeMexer,
  podeCancelar,
  podeVender,
  editarEm,
  simples,
}: {
  slug: string
  id: string
  /** "Marta — Bolo de chocolate 2 kg": para a janela dizer de qual se trata. */
  resumo: string
  situacao: Situacao
  falta: number
  sinal: number
  podeMexer: boolean
  podeCancelar: boolean
  /** Pode abrir o balcão (vender) nesta loja. */
  podeVender: boolean
  editarEm: string
  simples: boolean
}) {
  const [painel, setPainel] = useState<null | 'entregar' | 'cancelar'>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [devolveu, setDevolveu] = useState(false)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (situacao === 'ENTREGUE' || situacao === 'CANCELADA' || (!podeMexer && !podeCancelar)) return null

  const grande = simples ? 'px-4 py-2.5 text-sm' : 'px-2.5 py-1 text-xs'
  // Na janela há espaço: botão de tamanho normal nos dois modos.
  const normal = 'px-3 py-2 text-sm'

  function mudar(m: Parameters<typeof mudarSituacaoAcao>[2], depois?: () => void) {
    setErro(null)
    comecar(async () => {
      const r = await mudarSituacaoAcao(slug, id, m)
      if (r.erro) {
        setErro(r.erro)
        return
      }
      setPainel(null)
      depois?.()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={cx('flex flex-wrap gap-1.5', simples && 'gap-2')}>
        {podeMexer && situacao === 'ABERTA' && (
          <Botao tom="secundario" className={grande} carregando={indo} onClick={() => mudar({ para: 'PRONTA' })}>
            Pronta
          </Botao>
        )}
        {podeMexer && (
          <Botao tom="confirmar" className={grande} onClick={() => setPainel('entregar')}>
            Entregue
          </Botao>
        )}
        {podeMexer && (
          <Link
            href={editarEm}
            className={cx(
              'inline-flex items-center justify-center rounded-norte border border-transparent font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta',
              grande,
            )}
          >
            Mudar
          </Link>
        )}
        {podeMexer && situacao === 'PRONTA' && (
          <Botao tom="discreto" className={grande} carregando={indo} onClick={() => mudar({ para: 'ABERTA' })} title="Marcou pronta por engano? Volta para a fazer.">
            Não está pronta
          </Botao>
        )}
        {podeCancelar && (
          <Botao tom="discreto" className={grande} onClick={() => setPainel('cancelar')}>
            Cancelar
          </Botao>
        )}
      </div>

      {painel === 'entregar' && (
        <Janela titulo={`Entregar: ${resumo}`} aoFechar={() => setPainel(null)}>
          {falta > 0 ? (
            <>
              <p className="text-sm text-tinta">
                Falta receber <b className="numero">{brl(falta)}</b>.
                {sinal > 0 && (
                  <>
                    {' '}O sinal de <span className="numero">{brl(sinal)}</span> já está no financeiro.
                  </>
                )}
              </p>
              <p className="text-xs text-tinta-2">
                O cliente vai pagar agora? “Receber no balcão” marca a entrega e abre o Balcão — a venda você lança
                lá, de <b className="numero">{brl(falta)}</b>, só o que falta. Esta tela não registra venda.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {podeVender && (
                  <Botao
                    tom="confirmar"
                    className={normal}
                    carregando={indo}
                    onClick={() => mudar({ para: 'ENTREGUE' }, () => router.push(`/${slug}/balcao`))}
                  >
                    Receber no balcão
                  </Botao>
                )}
                <Botao tom="secundario" className={normal} carregando={indo} onClick={() => mudar({ para: 'ENTREGUE' })}>
                  Só marcar entregue
                </Botao>
                <Botao tom="discreto" className={normal} onClick={() => setPainel(null)}>
                  Voltar
                </Botao>
              </div>
              <p className="text-xs text-tinta-3">
                “Só marcar entregue” é para quando o que faltava já foi pago de outro jeito.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-tinta">Tudo pago. Confirma que a encomenda saiu?</p>
              <div className="flex flex-wrap gap-1.5">
                <Botao tom="confirmar" className={normal} carregando={indo} onClick={() => mudar({ para: 'ENTREGUE' })}>
                  Confirmar entrega
                </Botao>
                <Botao tom="discreto" className={normal} onClick={() => setPainel(null)}>
                  Voltar
                </Botao>
              </div>
            </>
          )}
          {erro && <Aviso nivel="critico">{erro}</Aviso>}
        </Janela>
      )}

      {painel === 'cancelar' && (
        <Janela titulo={`Cancelar: ${resumo}`} aoFechar={() => setPainel(null)}>
          <Campo
            rotulo="Por que cancelar?"
            name={`motivo-${id}`}
            id={`motivo-${id}`}
            value={motivo}
            onChange={(ev) => setMotivo(ev.currentTarget.value)}
            placeholder="O cliente desistiu, mudou a data..."
            required
          />
          {sinal > 0 && (
            <>
              <Aviso nivel="atencao">
                Esta encomenda tem sinal de <span className="numero">{brl(sinal)}</span>. Devolva ao cliente — ou
                combine com ele que a loja fica com o sinal.
              </Aviso>
              <Marcar
                name={`devolveu-${id}`}
                id={`devolveu-${id}`}
                checked={devolveu}
                onChange={(ev) => setDevolveu(ev.currentTarget.checked)}
                titulo={`Devolvi o sinal de ${brl(sinal)}`}
                resumo="A devolução sai no financeiro de hoje. Sem marcar, o sinal fica como receita da loja."
              />
            </>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Botao
              tom="perigo"
              className={normal}
              carregando={indo}
              disabled={motivo.trim().length < 3}
              onClick={() => mudar({ para: 'CANCELADA', motivo, devolveuSinal: devolveu })}
            >
              Cancelar encomenda
            </Botao>
            <Botao tom="discreto" className={normal} onClick={() => setPainel(null)}>
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
