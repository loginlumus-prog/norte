'use client'

// "Excluir produto": a ação que a equipe procura e não achava (antes era só
// desmarcar "Produto à venda" na ficha).
//
// Não apaga do banco: venda, estoque e relatório antigos apontam para o
// produto. Ele sai de venda — balcão, lista, catálogo e estoque — e a janela
// diz isso, e quanto estoque ainda tem, ANTES de o botão vermelho funcionar.
// O servidor confere permissão e loja de novo (`excluirProduto`).

import { useRef, useState, useTransition } from 'react'
import { Aviso, Botao, cx } from '@/ui/base'
import { excluir } from './acoes'

export function Excluir({
  slug,
  produtoId,
  nome,
  estoque = 0,
  medida = '',
  compacto = false,
}: {
  slug: string
  produtoId: string
  nome: string
  /** O saldo de hoje, somado; maior que zero acende o aviso na janela. */
  estoque?: number
  medida?: string
  /** Na linha da lista: texto pequeno, no lugar do botão grande da ficha. */
  compacto?: boolean
}) {
  const janela = useRef<HTMLDialogElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const id = `excluir-${produtoId}`
  const saldo = `${estoque.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${medida ? ` ${medida}` : ''}`

  return (
    <>
      {compacto ? (
        <button
          type="button"
          onClick={() => {
            setErro(null)
            janela.current?.showModal()
          }}
          title="Excluir este produto"
          className="font-semibold text-critico underline-offset-2 hover:underline"
        >
          excluir
        </button>
      ) : (
        <Botao
          type="button"
          tom="perigo"
          onClick={() => {
            setErro(null)
            janela.current?.showModal()
          }}
        >
          Excluir produto
        </Botao>
      )}

      <dialog
        ref={janela}
        aria-labelledby={`${id}-titulo`}
        className={cx(
          'm-auto w-[min(30rem,calc(100vw-2rem))] rounded-norte border border-borda bg-superficie p-0 text-tinta shadow-xl backdrop:bg-black/50',
        )}
      >
        <div className="flex flex-col gap-4 p-5">
          <h2 id={`${id}-titulo`} className="text-base font-bold">
            Excluir {nome}?
          </h2>
          <p className="text-sm text-tinta-2">
            Ele sai do balcão, da lista, do catálogo e do estoque. As vendas antigas e os relatórios continuam com ele.
          </p>
          {estoque > 0 && (
            <Aviso nivel="atencao">Ainda tem {saldo} em estoque; elas saem da conta do estoque.</Aviso>
          )}
          {erro && <Aviso nivel="critico">{erro}</Aviso>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Botao type="button" tom="discreto" disabled={indo} onClick={() => janela.current?.close()}>
              Cancelar
            </Botao>
            <Botao
              type="button"
              tom="perigo"
              carregando={indo}
              onClick={() =>
                comecar(async () => {
                  setErro(null)
                  try {
                    // Dando certo, a ação redireciona para a lista.
                    const r = await excluir(slug, produtoId)
                    if (r?.erro) setErro(r.erro)
                  } catch (e) {
                    // O redirect do Next sobe como exceção própria: deixa passar.
                    if (e && typeof e === 'object' && 'digest' in e) throw e
                    setErro('Não deu certo. Tente de novo em alguns segundos.')
                  }
                })
              }
            >
              Excluir
            </Botao>
          </div>
        </div>
      </dialog>
    </>
  )
}
