'use client'

// A aparência da tela, num botão só.
//
// Eram três chaves sempre à vista no cabeçalho (som · Simples/Avançado ·
// claro/escuro): uma cápsula larga que disputava lugar com as ações da tela e
// descia para uma segunda linha no notebook. E fora do sistema (o site, o
// entrar, o cadastro) só existia a do tema. Agora é um botão redondo, igual em
// todo lugar, que abre o painel com o que vale ali:
//
//   • Tema — em toda página (o site, o entrar, o sistema, o balcão);
//   • Modo e Sons — só dentro do sistema, onde eles existem (`modo` passado).
//
// O tema troca na hora, sem recarregar (mexe no <html> e grava o cookie, como
// o TrocaTema); o modo grava o cookie e pede a tela de novo ao servidor.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from './base'
import { EVENTO_TEMA, temaDe, type Tema } from './TrocaTema'
import { EVENTO_SOM, ligarSons, sonsLigados, tocar } from './sons'
import type { Modo } from '@/servidor/modo'

const doCookie = (): Tema | undefined => document.cookie.match(/(?:^|;\s*)tema=(claro|escuro|sistema)/)?.[1] as Tema | undefined

const Sol = ({ className }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </svg>
)
const Lua = ({ className }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </svg>
)

export function Preferencias({
  tema: inicial,
  modo,
  abre = 'baixo',
  tom = 'papel',
}: {
  /** O tema que o servidor carimbou; sem ele, lê do cookie. */
  tema?: Tema
  /** Dentro do sistema: mostra o Modo e os Sons. Fora (site, entrar), só o tema. */
  modo?: Modo
  /** Para onde o painel abre: embaixo do botão (cabeçalho) ou em cima (rodapé). */
  abre?: 'baixo' | 'cima'
  /** `lado`: sobre a barra lateral / a barra do celular. */
  tom?: 'papel' | 'lado'
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [tema, setTema] = useState<'claro' | 'escuro'>(temaDe(inicial))
  const [som, setSom] = useState(true)
  const [indo, comecar] = useTransition()
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (inicial === undefined) setTema(temaDe(doCookie()))
    setSom(sonsLigados())
    const doTema = (e: Event) => setTema(temaDe((e as CustomEvent<string>).detail))
    const doSom = () => setSom(sonsLigados())
    window.addEventListener(EVENTO_TEMA, doTema)
    window.addEventListener(EVENTO_SOM, doSom)
    return () => {
      window.removeEventListener(EVENTO_TEMA, doTema)
      window.removeEventListener(EVENTO_SOM, doSom)
    }
  }, [inicial])

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false)
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])

  function escolherTema(t: 'claro' | 'escuro') {
    setTema(t)
    document.documentElement.setAttribute('data-tema', t)
    // 1 ano; é preferência do aparelho, não sessão.
    document.cookie = `tema=${t}; path=/; max-age=31536000; samesite=lax`
    window.dispatchEvent(new CustomEvent(EVENTO_TEMA, { detail: t }))
  }

  function escolherModo(m: Modo) {
    if (m === modo) return
    document.cookie = `modo=${m}; path=/; max-age=31536000; samesite=lax`
    comecar(() => router.refresh())
  }

  function trocarSom() {
    const novo = !som
    ligarSons(novo)
    setSom(novo)
    if (novo) tocar('sucesso')
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        aria-label="Aparência: tema, modo e sons"
        title="Aparência"
        className={cx('prefs-botao botao-vivo grid size-9 place-items-center rounded-full', tom === 'lado' && 'prefs-botao-lado')}
      >
        {tema === 'escuro' ? <Lua className="size-[17px]" /> : <Sol className="size-[17px]" />}
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Aparência"
          className={cx(
            'prefs-caixa absolute z-50 flex w-[17.5rem] flex-col gap-3 rounded-2xl p-3',
            abre === 'baixo' ? 'top-full right-0 mt-2' : 'bottom-full left-0 mb-2',
          )}
        >
          <span className="px-1 text-[11.5px] font-bold tracking-[0.12em] text-tinta-3 uppercase">Aparência</span>

          {/* O tema em dois cartões com a miniatura da tela: escolher vendo. */}
          <div className="grid grid-cols-2 gap-2">
            {(['claro', 'escuro'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => escolherTema(t)}
                aria-pressed={tema === t}
                className="prefs-tema flex flex-col gap-1.5 rounded-xl p-1.5 text-left"
              >
                <span aria-hidden className={cx('prefs-mini flex h-12 gap-1 overflow-hidden rounded-lg p-1.5', t === 'escuro' ? 'prefs-mini-escuro' : 'prefs-mini-claro')}>
                  <span className="w-3 rounded-[3px] opacity-80" />
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="h-1.5 w-3/4 rounded-full" />
                    <span className="h-3.5 rounded-[3px]" />
                    <span className="h-1.5 w-1/2 rounded-full" />
                  </span>
                </span>
                <span className="flex items-center gap-1.5 px-0.5 text-[13px] font-bold text-tinta">
                  {t === 'escuro' ? <Lua className="size-3.5" /> : <Sol className="size-3.5" />}
                  {t === 'escuro' ? 'Escuro' : 'Claro'}
                </span>
              </button>
            ))}
          </div>

          {modo && (
            <div className="flex flex-col gap-1.5">
              <span className="px-1 text-xs font-semibold text-tinta-2">Modo da tela</span>
              <div className={cx('fichas grid grid-cols-2 gap-0.5 rounded-xl p-1', indo && 'opacity-60')} aria-busy={indo || undefined}>
                {(
                  [
                    ['simples', 'Simples', 'O essencial, botões grandes'],
                    ['avancado', 'Avançado', 'Todas as telas e gráficos'],
                  ] as const
                ).map(([m, nome, dica]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => escolherModo(m)}
                    aria-current={modo === m ? 'true' : undefined}
                    title={dica}
                    className="ficha rounded-lg px-2 py-1.5 text-[13px] font-bold"
                  >
                    {nome}
                  </button>
                ))}
              </div>
              <span className="px-1 text-[11.5px] text-tinta-3">{modo === 'simples' ? 'O essencial, com botões grandes. Ideal para o balcão.' : 'Todas as telas, gráficos e colunas.'}</span>
            </div>
          )}

          {modo && (
            <button type="button" onClick={trocarSom} role="switch" aria-checked={som} className="flex items-center justify-between gap-3 rounded-xl px-1 py-1 text-left">
              <span className="flex flex-col">
                <span className="text-[13px] font-bold text-tinta">Sons do sistema</span>
                <span className="text-[11.5px] text-tinta-3">Venda fechada, aviso, erro</span>
              </span>
              <span aria-hidden className={cx('prefs-chave relative h-6 w-10 shrink-0 rounded-full', som && 'prefs-chave-ligada')}>
                <span className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow" />
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
