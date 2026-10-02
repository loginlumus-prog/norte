'use client'

// Qual loja estou olhando.
//
// Abre ao clicar e a lista desce por cima da tela. Botões lado a lado só
// funcionam com duas ou três lojas — com quinze eles estouram a barra, e a
// rede grande é justamente o cliente que paga mais.
//
// Acima de oito lojas aparece uma busca: rolar lista de vinte procurando
// "Shopping da Bahia" é pior do que digitar três letras.
//
// A escolha vai para o ENDEREÇO: o gerente manda o link para o dono e os dois
// veem exatamente a mesma tela. E ela fica LEMBRADA (unidade-lembrada.ts): o
// menu e os links de cada tela não levam a loja, e sem a lembrança cada
// clique voltava para "Todas as unidades".

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { cx } from './base'
import type { UnidadeVisivel } from '@/servidor/unidade'
import { TODAS_AS_UNIDADES, UNIDADE_LEMBRADA_SEG, cookieDaUnidade } from '@/servidor/unidade-lembrada'

const COM_BUSCA = 8

/**
 * Guarda a escolha no cookie da empresa (o caminho `/<empresa>`). Escrito
 * aqui, e não por uma Server Action: ação que mexe em cookie faz o Next
 * redesenhar a tela inteira, e a navegação logo em seguida já faz isso.
 * O servidor confere a unidade de novo a cada leitura — o cookie só sugere.
 */
function lembrar(caminho: string, id: string | null) {
  const slug = caminho.split('/')[1]
  if (!slug) return
  const seguro = window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie =
    `${cookieDaUnidade(slug)}=${encodeURIComponent(id ?? TODAS_AS_UNIDADES)}` +
    `; path=/${slug}; max-age=${UNIDADE_LEMBRADA_SEG}; samesite=lax${seguro}`
}

export function SeletorUnidade({
  opcoes,
  atual,
}: {
  opcoes: UnidadeVisivel[]
  /** null = consolidado */
  atual: string | null
}) {
  const router = useRouter()
  const caminho = usePathname()
  const busca = useSearchParams()

  // Chegou por um link que já trazia a loja (o painel manda para o Estoque
  // daquela loja; o gerente manda o endereço): ela passa a ser a lembrada,
  // e o próximo clique no menu continua nela. Só quando o endereço foi
  // obedecido — loja que esta tela não alcança não apaga a lembrança.
  const doEndereco = busca.get('unidade')
  useEffect(() => {
    if (doEndereco && doEndereco === atual) lembrar(caminho, atual)
  }, [doEndereco, atual, caminho])

  const [aberto, setAberto] = useState(false)
  const [filtro, setFiltro] = useState('')
  const caixa = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora e no Esc — o que qualquer pessoa tenta primeiro.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])

  function ir(id: string | null) {
    const p = new URLSearchParams(busca.toString())
    if (id) p.set('unidade', id)
    else p.delete('unidade')
    setAberto(false)
    setFiltro('')
    lembrar(caminho, id)
    router.push(`${caminho}${p.size ? `?${p}` : ''}`)
  }

  const escolhida = atual ? opcoes.find((u) => u.id === atual) : null
  const rotulo = escolhida ? escolhida.nome : 'Todas as unidades'

  const lista = filtro
    ? opcoes.filter((u) => u.nome.toLowerCase().includes(filtro.toLowerCase()))
    : opcoes

  const item = (ativo: boolean) =>
    cx(
      'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm',
      ativo ? 'bg-marca-suave font-semibold text-marca' : 'text-tinta hover:bg-superficie-2',
    )

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        className={cx(
          'flex items-center gap-2 rounded-norte border border-borda bg-superficie',
          'px-2.5 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2',
        )}
      >
        <span className="max-w-44 truncate">{rotulo}</span>
        <span aria-hidden className="text-xs text-tinta-3">
          {aberto ? '▲' : '▼'}
        </span>
      </button>

      {aberto && (
        <div
          role="listbox"
          aria-label="Unidade"
          className={cx(
            'absolute right-0 z-30 mt-1 flex w-64 flex-col gap-1 rounded-norte',
            'border border-borda bg-superficie p-1.5 shadow-norte',
          )}
        >
          {opcoes.length > COM_BUSCA && (
            <input
              autoFocus
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Procurar loja..."
              className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta placeholder:text-tinta-3"
            />
          )}

          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            <button
              type="button"
              role="option"
              aria-selected={atual === null}
              onClick={() => ir(null)}
              className={item(atual === null)}
            >
              <span>Todas as unidades</span>
              <span className="numero text-xs text-tinta-3">{opcoes.length}</span>
            </button>

            <div className="my-0.5 h-px bg-borda-suave" />

            {lista.map((u) => (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={atual === u.id}
                onClick={() => ir(u.id)}
                className={item(atual === u.id)}
              >
                <span className="truncate">{u.nome}</span>
                {u.ehDeposito && (
                  <span className="shrink-0 text-xs text-tinta-3">depósito</span>
                )}
              </button>
            ))}

            {lista.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-tinta-3">
                Nenhuma loja com esse nome.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
