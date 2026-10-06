'use client'

// "corrigir" na linha do lançamento: muda descrição, valor e vencimento, ou
// exclui. Antes só existia "Paguei" e "desfazer" — o lançamento de teste, ou
// o lançado em dobro, ficava para sempre na lista e no resultado do mês.
//
// Excluir pede o motivo: a auditoria guarda o que era, quem tirou e por quê.
// A conta fixa (recorrente) não volta no mesmo mês (ver `excluirLancamento`).

import { useRef, useState, useTransition } from 'react'
import { Aviso, Botao, Campo, cx } from '@/ui/base'
import { corrigirLancamento, excluirLancamentoAcao } from './acoes'

const valorNaTela = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function Corrigir({
  slug,
  lancamento: l,
}: {
  slug: string
  lancamento: { id: string; descricao: string; valor: number; vencimento: string; recorrente: boolean; pago: boolean }
}) {
  const janela = useRef<HTMLDialogElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [indo, comecar] = useTransition()
  const id = `corrigir-${l.id}`

  const abrir = () => {
    setErro(null)
    setExcluindo(false)
    setMotivo('')
    janela.current?.showModal()
  }

  const correr = (f: () => Promise<{ erro?: string }>) =>
    comecar(async () => {
      setErro(null)
      try {
        const r = await f()
        if (r?.erro) return setErro(r.erro)
        janela.current?.close()
      } catch {
        setErro('Não deu certo. Tente de novo em alguns segundos.')
      }
    })

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        title="Corrigir ou excluir este lançamento"
        className="text-xs font-semibold text-tinta-2 underline-offset-2 hover:text-marca hover:underline"
      >
        corrigir
      </button>

      <dialog
        ref={janela}
        aria-labelledby={`${id}-titulo`}
        className={cx(
          'm-auto w-[min(30rem,calc(100vw-2rem))] rounded-norte border border-borda bg-superficie p-0 text-left text-tinta shadow-xl backdrop:bg-black/50',
        )}
      >
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            correr(() =>
              corrigirLancamento(slug, l.id, {
                descricao: String(f.get('descricao') ?? ''),
                valor: String(f.get('valor') ?? ''),
                vencimento: String(f.get('vencimento') ?? ''),
              }),
            )
          }}
        >
          <h2 id={`${id}-titulo`} className="text-base font-bold">
            Corrigir lançamento
          </h2>
          <Campo id={`${id}-descricao`} rotulo="Descrição" name="descricao" defaultValue={l.descricao} required maxLength={200} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id={`${id}-valor`} rotulo="Valor (R$)" name="valor" defaultValue={valorNaTela(l.valor)} inputMode="decimal" required />
            <Campo id={`${id}-vencimento`} rotulo="Vencimento" name="vencimento" type="date" defaultValue={l.vencimento} required />
          </div>
          {l.pago && (
            <p className="text-xs text-tinta-3">
              Já está pago. Para mudar o dia do pagamento, use <b>desfazer</b> e depois <b>Paguei</b> no dia certo.
            </p>
          )}

          {excluindo ? (
            <div className="flex flex-col gap-2.5 rounded-norte border border-critico-borda bg-critico-fundo p-3">
              <p className="text-sm text-tinta">
                O lançamento sai da lista e do resultado do mês.
                {l.recorrente && ' Como é uma conta fixa, ela não volta a ser lançada neste mês; os outros meses continuam.'}
              </p>
              <Campo
                id={`${id}-motivo`}
                rotulo="Por que excluir?"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: lançado em dobro, era teste"
                maxLength={200}
                autoFocus
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Botao type="button" tom="discreto" disabled={indo} onClick={() => setExcluindo(false)}>
                  Voltar
                </Botao>
                <Botao
                  type="button"
                  tom="perigo"
                  carregando={indo}
                  disabled={motivo.trim().length < 3}
                  onClick={() => correr(() => excluirLancamentoAcao(slug, l.id, motivo))}
                >
                  Excluir lançamento
                </Botao>
              </div>
            </div>
          ) : null}

          {erro && <Aviso nivel="critico">{erro}</Aviso>}

          {!excluindo && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Botao type="button" tom="discreto" className="text-critico" onClick={() => setExcluindo(true)}>
                Excluir
              </Botao>
              <span className="flex gap-2">
                <Botao type="button" tom="discreto" disabled={indo} onClick={() => janela.current?.close()}>
                  Cancelar
                </Botao>
                <Botao type="submit" tom="principal" carregando={indo}>
                  Salvar
                </Botao>
              </span>
            </div>
          )}
        </form>
      </dialog>
    </>
  )
}
