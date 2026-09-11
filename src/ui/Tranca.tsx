'use client'

// A tela tranca quando ninguém mexe.
//
// Trinta minutos parada e a tela pede a senha de novo — TRANCA, não desloga.
// A diferença é a venda em andamento: derrubar a sessão jogaria fora um
// carrinho pela metade numa tarde parada. Trancada, tudo fica onde estava, e
// ninguém passa atrás do balcão e mexe.
//
// Um minuto antes, o aviso: qualquer toque cancela. É o que evita a tranca
// cair no meio de quem estava só lendo um relatório.
//
// Os números vêm do servidor (presenca.ts), o mesmo lugar que decide quando
// a vaga da pessoa pode ser tomada por outra: a tela tranca aos 30, a vaga
// solta aos 10 — quem sai para almoçar volta e encontra a tela trancada,
// nunca a sessão de outra pessoa.

import { useEffect, useRef, useState, useTransition } from 'react'
import { destrancarAcao, sairAcao } from '@/app/[empresa]/acoes'
import { Botao, cx } from './base'

const TOQUES = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const

export function Tranca({
  slug,
  nome,
  trancaMin,
  avisoSeg,
}: {
  slug: string
  nome: string
  trancaMin: number
  avisoSeg: number
}) {
  const [estado, setEstado] = useState<'ativo' | 'aviso' | 'trancado'>('ativo')
  const [restante, setRestante] = useState(avisoSeg)
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [erros, setErros] = useState(0)
  const [indo, comecar] = useTransition()
  const ultimo = useRef(Date.now())
  const estadoRef = useRef(estado)
  estadoRef.current = estado

  useEffect(() => {
    const tocou = () => {
      if (estadoRef.current === 'trancado') return
      ultimo.current = Date.now()
      if (estadoRef.current === 'aviso') setEstado('ativo')
    }
    for (const t of TOQUES) window.addEventListener(t, tocou, { passive: true })

    const relogio = setInterval(() => {
      if (estadoRef.current === 'trancado') return
      const paradoSeg = (Date.now() - ultimo.current) / 1000
      const limite = trancaMin * 60
      if (paradoSeg >= limite) {
        setEstado('trancado')
      } else if (paradoSeg >= limite - avisoSeg) {
        setEstado('aviso')
        setRestante(Math.max(1, Math.ceil(limite - paradoSeg)))
      }
    }, 1000)

    return () => {
      for (const t of TOQUES) window.removeEventListener(t, tocou)
      clearInterval(relogio)
    }
  }, [trancaMin, avisoSeg])

  if (estado === 'ativo') return null

  if (estado === 'aviso') {
    return (
      <div
        role="status"
        className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-norte border border-atencao-borda bg-atencao-fundo px-4 py-3 text-sm font-medium text-atencao shadow-norte-alta"
      >
        <span aria-hidden className="respira size-2 rounded-full bg-atencao-vivo" />
        A tela vai trancar em <b className="numero">{restante}s</b>. Mexa em qualquer coisa para continuar.
      </div>
    )
  }

  function destrancar() {
    if (!senha) return
    comecar(async () => {
      const r = await destrancarAcao(slug, senha)
      if (r.ok) {
        ultimo.current = Date.now()
        setSenha('')
        setErro(null)
        setErros(0)
        setEstado('ativo')
        return
      }
      const n = erros + 1
      setErros(n)
      setSenha('')
      setErro(n >= 5 ? 'Cinco tentativas erradas. Saindo.' : 'Senha errada.')
      if (n >= 5) {
        const form = new FormData()
        form.set('empresa', slug)
        await sairAcao(form)
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tela trancada"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-nav/85 p-4 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-norte border border-borda bg-superficie p-6 shadow-norte-alta">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold text-tinta">Tela trancada</h2>
          <p className="text-sm text-tinta-2">
            Ninguém mexeu por {trancaMin} minutos. O que estava aberto continua aí — só digite sua senha,{' '}
            <b>{nome}</b>.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            destrancar()
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoFocus
            autoComplete="current-password"
            aria-label="Senha"
            placeholder="Sua senha"
            className={cx(
              'rounded-norte border bg-superficie px-3 py-2.5 text-base text-tinta placeholder:text-tinta-3',
              erro ? 'border-critico' : 'border-borda',
            )}
          />
          {erro && <p className="text-sm font-medium text-critico">{erro}</p>}
          <Botao type="submit" largo carregando={indo} disabled={!senha}>
            Destrancar
          </Botao>
        </form>
        <form action={sairAcao} className="text-center">
          <input type="hidden" name="empresa" value={slug} />
          <button type="submit" className="text-xs text-tinta-3 underline-offset-2 hover:text-tinta hover:underline">
            Não sou eu — entrar com outra pessoa
          </button>
        </form>
      </div>
    </div>
  )
}
