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
//
// ── o que é do navegador e o que é do servidor ───────────────
// A TRANCA em si mora só aqui, no navegador: quem abre as ferramentas do
// navegador e apaga este quadro volta a mexer na tela. É uma escolha, não um
// esquecimento. Trancar pelo servidor — recusar ação de quem está parado —
// derrubaria a venda de quem passou meia hora montando um carrinho sem
// salvar nada, justo na hora de cobrar. O que é segurança de verdade está no
// servidor: a senha para destrancar passa pelo freio do login
// (`destrancarAcao`), a vaga tomada por outra pessoa derruba a sessão, e
// "Sair" mata o cookie no servidor.
//
// ── o F5 não destranca ───────────────────────────────────────
// O relógio daqui nascia de novo a cada carregamento: trancada, bastava
// apertar F5 ou abrir outra aba e a tela voltava aberta. Agora, enquanto
// alguém mexe, esta tela manda um "ainda estou aqui" (`/<empresa>/sinal`, no
// máximo um por minuto), que grava o último toque num cookie do aparelho. Ao
// abrir, a moldura lê esse cookie e manda `trancadaAoAbrir` — parada há
// TRANCA_MIN, a tela já nasce trancada. O mesmo sinal mantém a vaga da pessoa
// viva enquanto ela lê sem trocar de tela.

import { useEffect, useRef, useState, useTransition } from 'react'
import { destrancarAcao, sairAcao } from '@/app/[empresa]/acoes'
import { Botao, cx } from './base'

const TOQUES = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const

/** Um "ainda estou aqui" por minuto basta: a régua da tranca é de meia hora. */
const SINAL_MS = 60_000

// Fora do componente: a moldura (e a tranca com ela) monta de novo a cada
// tela, e o minuto entre um sinal e outro vale para a aba inteira.
let enviadoEm = 0

export function Tranca({
  slug,
  nome,
  trancaMin,
  avisoSeg,
  trancadaAoAbrir = false,
}: {
  slug: string
  nome: string
  trancaMin: number
  avisoSeg: number
  /** Ninguém mexe neste aparelho há trancaMin: já abre pedindo a senha. */
  trancadaAoAbrir?: boolean
}) {
  // Só vale ao montar: depois disso, quem decide é o relógio daqui.
  const [estado, setEstado] = useState<'ativo' | 'aviso' | 'trancado'>(trancadaAoAbrir ? 'trancado' : 'ativo')
  const [restante, setRestante] = useState(avisoSeg)
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [erros, setErros] = useState(0)
  const [indo, comecar] = useTransition()
  const ultimo = useRef(Date.now())
  const estadoRef = useRef(estado)
  estadoRef.current = estado

  // "Ainda estou aqui." Sem esperar resposta, e sem reclamar se falhar (sem
  // internet, o balcão continua vendendo): no pior caso, o próximo F5 pede a
  // senha antes da hora. `keepalive` deixa o pedido sair mesmo se a pessoa
  // estiver trocando de tela naquele instante.
  const avisar = useRef((forcar = false) => {
    const agora = Date.now()
    if (!forcar && agora - enviadoEm < SINAL_MS) return
    enviadoEm = agora
    fetch(`/${slug}/sinal`, { method: 'POST', keepalive: true, credentials: 'same-origin' }).catch(() => {
      enviadoEm = 0
    })
  })

  // Sem internet, a tela só pode ser a cópia do balcão guardada no aparelho
  // (public/sw.js) — e, se a cópia foi guardada trancada, a senha não tem
  // como ser conferida: o balcão ficaria preso até a internet voltar, que é
  // justamente quando ele mais precisa vender pela fila. Nesse caso abre.
  useEffect(() => {
    if (trancadaAoAbrir && !navigator.onLine) setEstado('ativo')
  }, []) // só ao montar: depois disso, quem decide é o relógio daqui

  useEffect(() => {
    const tocou = () => {
      if (estadoRef.current === 'trancado') return
      ultimo.current = Date.now()
      avisar.current()
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
        className="fixed right-4 bottom-20 z-50 flex items-center gap-3 rounded-norte border border-atencao-borda bg-atencao-fundo px-4 py-3 text-sm font-medium text-atencao shadow-norte-alta"
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
        // Destrancou: o cookie do toque anda JÁ, senão um F5 logo em seguida
        // pediria a senha de novo.
        avisar.current(true)
        setSenha('')
        setErro(null)
        setErros(0)
        setEstado('ativo')
        return
      }
      const n = erros + 1
      setErros(n)
      setSenha('')
      // O servidor manda sair quando a sessão acabou (a vaga foi usada por
      // outra pessoa) ou quando o freio de tentativas segurou a conta.
      const sair = r.sair || n >= 5
      setErro(r.sair ? (r.erro ?? 'Saindo.') : n >= 5 ? 'Cinco tentativas erradas. Saindo.' : (r.erro ?? 'Senha errada.'))
      if (sair) {
        if (r.sair) await new Promise((fim) => setTimeout(fim, 2500))
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
