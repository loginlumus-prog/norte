'use client'

// "Imprimir etiquetas (N)": as etiquetas dos produtos MARCADOS na lista.
//
// A caixa de cada produto fica no cartão dele, longe deste botão — e é o
// atributo `form` que as liga a este formulário, sem um <form> em volta da
// lista inteira (a lista tem os seus próprios formulários, e formulário
// dentro de formulário não existe). Mandar é um GET para a tela de
// etiquetas, com `produto` repetido: funciona até sem JavaScript; aqui só se
// conta quantos estão marcados e se marca a página de uma vez.

import { useEffect, useState } from 'react'

/** O id do formulário; a caixa de cada cartão aponta para ele (produtos/page.tsx). */
const FORMULARIO_DO_LOTE = 'etiquetas-lote'

const marcadas = () => document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${FORMULARIO_DO_LOTE}"]`)

export function EtiquetasEmLote({ acao, unidade }: { acao: string; unidade: string | null }) {
  const [quantos, setQuantos] = useState(0)
  const [naPagina, setNaPagina] = useState(0)

  useEffect(() => {
    const contar = () => {
      const todas = [...marcadas()]
      setNaPagina(todas.length)
      setQuantos(todas.filter((c) => c.checked).length)
    }
    contar()
    // Ao trocar de página a lista é outra e as caixas também (o navegador
    // pode devolver marcadas as da página anterior ao voltar).
    document.addEventListener('change', contar)
    window.addEventListener('pageshow', contar)
    return () => {
      document.removeEventListener('change', contar)
      window.removeEventListener('pageshow', contar)
    }
  }, [])

  function marcarTodas(sim: boolean) {
    for (const c of marcadas()) c.checked = sim
    setQuantos(sim ? marcadas().length : 0)
  }

  if (naPagina === 0) return null
  return (
    <form id={FORMULARIO_DO_LOTE} action={acao} method="get" className="flex flex-wrap items-center gap-2">
      {unidade && <input type="hidden" name="unidade" value={unidade} />}
      <button
        type="submit"
        disabled={quantos === 0}
        title={quantos === 0 ? 'Marque os produtos na lista' : 'Imprimir as etiquetas dos produtos marcados'}
        className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2 disabled:opacity-50"
      >
        Imprimir etiquetas{quantos > 0 ? ` (${quantos})` : ''}
      </button>
      <button type="button" onClick={() => marcarTodas(quantos < naPagina)} className="text-xs font-medium text-marca underline-offset-2 hover:underline">
        {quantos < naPagina ? `marcar os ${naPagina} desta página` : 'desmarcar'}
      </button>
    </form>
  )
}
