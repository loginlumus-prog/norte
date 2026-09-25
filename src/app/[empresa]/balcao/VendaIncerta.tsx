'use client'

// A tela voltou com uma venda que estava no meio do "concluir".
//
// O servidor pode ter gravado a venda antes de a tela cair (a luz piscou, o
// navegador fechou, a rede sumiu na volta). Se o balcão simplesmente mostrasse
// o pedido de novo, a pessoa tocaria em "Concluir" e cobraria duas vezes. Então
// ele diz o que pode ter acontecido, leva a Vendas para conferir, e deixa
// jogar o pedido fora num toque. Nada aqui decide: quem confere é a pessoa.

import { Aviso } from '@/ui/base'

export function VendaIncerta({ slug, aoLimpar }: { slug: string; aoLimpar: () => void }) {
  return (
    <Aviso nivel="critico">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Esta venda estava sendo concluída quando a tela recarregou. Ela pode já ter entrado —
          confira antes de concluir de novo.
        </span>
        <a
          href={`/${slug}/vendas`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline underline-offset-2"
        >
          Conferir em Vendas
        </a>
        <button type="button" onClick={aoLimpar} className="font-semibold underline underline-offset-2">
          Já entrou — começar do zero
        </button>
      </span>
    </Aviso>
  )
}

/**
 * O aviso que fica até ser lido: "saiu do pedido tal item". Com o ✕ para
 * dispensar — some sozinho só o que não mudou o pedido.
 */
export function AvisoFixo({ texto, aoFechar }: { texto: string; aoFechar: () => void }) {
  return (
    <Aviso nivel="atencao">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{texto}</span>
        <button type="button" onClick={aoFechar} className="font-semibold underline underline-offset-2">
          Entendi
        </button>
      </span>
    </Aviso>
  )
}
