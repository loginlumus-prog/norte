'use client'

// Uma cena desenhada que respira.
//
// As artes do site são vídeos de fundo transparente (WebM/VP9 com alfa), feitos
// a partir dos mesmos PNGs que estavam aqui antes — ver scripts/recortar-video.mjs.
// Este componente é só o jeito HONESTO de colocá-los na tela.
//
// ── três coisas que ele resolve, e que um <video autoplay> não resolve ──
//
// 1. QUEM PEDIU MENOS MOVIMENTO. `prefers-reduced-motion: reduce` não é
//    preferência estética: tem gente que passa mal com movimento na tela. CSS
//    não pausa vídeo, então isso só se resolve aqui. Nesse caso o vídeo nunca
//    toca e fica o pôster — que é o PRIMEIRO QUADRO do próprio vídeo, então a
//    pessoa vê exatamente a mesma cena, parada. E a gente escuta a troca: quem
//    liga a preferência com a página aberta vê o movimento parar na hora.
//
// 2. VÍDEO QUE TOCA FORA DA TELA. São seis nesta página. Deixar os seis rodando
//    o tempo todo é ventoinha ligada e bateria indo embora para animar coisa
//    que ninguém está vendo. Só toca o que está à vista.
//
// 3. O PRIMEIRO INSTANTE. `preload="none"` faz o navegador não baixar nada até
//    a cena chegar perto — quem nunca rola a página não paga por cinco vídeos.
//    A do topo é a exceção: ela já está à vista quando a página abre.
//
// Se o navegador não souber tocar WebM com alfa, nada quebra: o <source> falha
// e o pôster continua na tela. É a página de antes, com uma imagem parada.

import { useEffect, useRef } from 'react'

export function CenaViva({
  nome,
  className,
  jaAVista = false,
}: {
  /** Nome do arquivo sem extensão, como sai do `npm run video`. */
  nome: string
  className?: string
  /** Verdadeiro só para a cena do topo, a única visível sem rolar. */
  jaAVista?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return

    const menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)')
    let olho: IntersectionObserver | undefined

    // `play()` devolve promessa e ela REJEITA em situação normal — aba escondida,
    // pausa disparada no mesmo quadro. Sem o catch isso vira erro no console de
    // quem só rolou a página rápido.
    const tocar = () => void video.play().catch(() => {})

    const ligar = () => {
      olho = new IntersectionObserver(
        ([entrada]) => (entrada?.isIntersecting ? tocar() : video.pause()),
        { threshold: 0.15 },
      )
      olho.observe(video)
    }

    const desligar = () => {
      olho?.disconnect()
      olho = undefined
      video.pause()
      video.currentTime = 0
    }

    const decidir = () => (menosMovimento.matches ? desligar() : ligar())

    decidir()
    menosMovimento.addEventListener('change', decidir)

    return () => {
      menosMovimento.removeEventListener('change', decidir)
      olho?.disconnect()
    }
  }, [])

  return (
    <video
      ref={ref}
      poster={`/video/${nome}-poster.webp`}
      muted
      loop
      playsInline
      preload={jaAVista ? 'auto' : 'none'}
      aria-hidden
      tabIndex={-1}
      className={className}
    >
      <source src={`/video/${nome}.webm`} type="video/webm" />
    </video>
  )
}
