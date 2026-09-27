'use client'

// O botão que pergunta antes de fazer o que não tem volta (ou dá trabalho
// desfazer): marcar conta como paga, fechar uma loja, tirar alguém da lista
// de quem não recebe ofertas.
//
// Cada tela tinha a própria confirmação — e várias não tinham nenhuma: um
// toque em "Paguei" no tablet, rolando a lista com o dedo, marcava a conta
// como paga, e a tela não tem "desfazer". Aqui é um só jeito, no mesmo lugar
// do botão (sem janela por cima, que no celular cobre o que está sendo
// confirmado): o botão vira a pergunta, com "sim" e "não" lado a lado.
//
// A ação corre dentro de uma transição: o "sim" gira e fica desligado até a
// resposta (dois toques não viram duas ações). Se ela devolver `{ erro }` ou
// estourar, a frase aparece ali mesmo — em vez da tela de erro inteira no
// lugar da lista.

import { useState, useTransition, type ReactNode } from 'react'
import { Botao, cx } from './base'

type Tom = 'principal' | 'confirmar' | 'secundario' | 'discreto' | 'perigo'

export function Confirmar({
  children,
  pergunta,
  sim,
  nao = 'Não',
  tom = 'discreto',
  tomSim = 'perigo',
  aoConfirmar,
  className,
  title,
}: {
  /** O rótulo do botão, antes de perguntar. */
  children: ReactNode
  pergunta: ReactNode
  /** O rótulo do "sim" — o verbo, não "OK": "Sim, paguei". */
  sim: ReactNode
  nao?: ReactNode
  tom?: Tom
  tomSim?: Tom
  aoConfirmar: () => Promise<{ erro?: string } | void | unknown> | void
  className?: string
  title?: string
}) {
  const [perguntando, setPerguntando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()

  if (!perguntando) {
    return (
      <Botao
        tom={tom}
        title={title}
        className={className}
        onClick={() => {
          setErro(null)
          setPerguntando(true)
        }}
      >
        {children}
      </Botao>
    )
  }

  return (
    <span className="inline-flex flex-col items-end gap-1" role="group" aria-label="Confirmar">
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
        <span className="text-xs font-medium text-tinta-2">{pergunta}</span>
        <Botao
          tom={tomSim}
          carregando={indo}
          autoFocus
          className={cx(className)}
          onClick={() =>
            comecar(async () => {
              try {
                const r = await aoConfirmar()
                const e = r && typeof r === 'object' && 'erro' in r ? (r as { erro?: string }).erro : undefined
                if (e) setErro(e)
                else setPerguntando(false)
              } catch {
                setErro('Não deu certo. Tente de novo em alguns segundos.')
              }
            })
          }
        >
          {sim}
        </Botao>
        <Botao tom="discreto" disabled={indo} className={cx(className)} onClick={() => setPerguntando(false)}>
          {nao}
        </Botao>
      </span>
      {erro && (
        <span role="alert" className="text-xs text-critico">
          {erro}
        </span>
      )}
    </span>
  )
}
