'use client'

// "Cores do menu": a pessoa escolhe a cor de cada área (Vender, Catálogo...).
// Abre por cima do rodapé da barra; cada toque já vale (grava o cookie do
// aparelho e pede a tela de novo ao servidor, que pinta a barra pronta).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CORES_PADRAO, PALETA, cookieDasCores } from './cores-menu'
import { cx } from './base'
import { tocar } from './sons'

export function CoresDoMenu({
  slug,
  grupos,
  escolhidas,
  compacto = false,
}: {
  slug: string
  /** Os grupos que esta pessoa vê, com o nome que aparece (o do ramo) e a chave. */
  grupos: { chave: string; nome: string }[]
  escolhidas: Record<string, string>
  /** No trilho de ícones: só o botão redondo. */
  compacto?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [cores, setCores] = useState(escolhidas)
  const caixa = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => setCores(escolhidas), [escolhidas])
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false)
    document.addEventListener('pointerdown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  function gravar(novas: Record<string, string>) {
    setCores(novas)
    try {
      const seguro = window.location.protocol === 'https:' ? '; secure' : ''
      document.cookie = `${cookieDasCores(slug)}=${encodeURIComponent(JSON.stringify(novas))}; path=/${slug}; max-age=31536000; samesite=lax${seguro}`
    } catch {
      // sem cookie: vale só até recarregar
    }
    tocar('clique')
    router.refresh()
  }

  const todas = [{ chave: 'Painel', nome: 'Painel' }, ...grupos.filter((g) => g.chave !== 'Painel')]

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-label="Cores do menu"
        title="Cores do menu"
        className={cx(
          'group flex items-center gap-2 rounded-norte text-xs font-medium text-lado-tinta-2 transition-colors hover:bg-lado-2 hover:text-lado-tinta',
          compacto ? 'mx-auto size-8 justify-center' : 'w-full px-2 py-1.5',
        )}
      >
        <span aria-hidden className="flex -space-x-1 transition-transform group-hover:scale-110">
          {todas.slice(0, 4).map((g) => (
            <span key={g.chave} className="size-2.5 rounded-full ring-2 ring-lado" style={{ background: cores[g.chave] ?? CORES_PADRAO[g.chave] }} />
          ))}
        </span>
        {compacto ? null : 'Cores do menu'}
      </button>
      {aberto ? (
        <div
          role="dialog"
          aria-label="Cores do menu"
          className={cx(
            'menu-flutua absolute z-50 w-[290px] rounded-2xl border border-borda bg-superficie p-3 text-tinta shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)]',
            compacto ? 'bottom-0 left-full ml-3' : 'bottom-full left-0 mb-2',
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold">Cores do menu</p>
            <button type="button" onClick={() => gravar({})} className="text-xs font-semibold text-tinta-3 hover:text-tinta">
              Voltar ao padrão
            </button>
          </div>
          <ul className="flex flex-col gap-2.5">
            {todas.map((g) => {
              const atual = cores[g.chave] ?? CORES_PADRAO[g.chave]
              return (
                <li key={g.chave} className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-xs font-semibold text-tinta-2">
                    <span className="h-3 w-1 rounded-full" style={{ background: atual }} />
                    {g.nome}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {PALETA.map((cor) => (
                      <button
                        key={cor}
                        type="button"
                        onClick={() => gravar({ ...cores, [g.chave]: cor })}
                        aria-label={`${g.nome}: cor ${cor}`}
                        aria-pressed={atual === cor}
                        className={cx(
                          'size-5 rounded-full transition-transform hover:scale-125',
                          atual === cor && 'ring-2 ring-tinta ring-offset-2 ring-offset-superficie',
                        )}
                        style={{ background: cor }}
                      />
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-2.5 text-[11px] leading-snug text-tinta-3">Vale neste aparelho. Cada pessoa deixa o menu do jeito que prefere.</p>
        </div>
      ) : null}
    </div>
  )
}
