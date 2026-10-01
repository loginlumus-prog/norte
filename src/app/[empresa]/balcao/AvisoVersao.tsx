'use client'

// "Tem versão nova — recarregar", no balcão.
//
// O balcão fica aberto o dia todo: a página das 8h não sabe da versão que
// subiu às 14h, e a primeira ação que mudou quebra no meio de uma venda. A
// tela pergunta ao servidor a versão de agora (balcao/versao) a cada poucos
// minutos e quando a aba volta a aparecer; se não é a mesma com que ela
// carregou, avisa. Quem decide a hora é a vendedora: com a cliente pagando,
// ela termina e recarrega depois. Nada se perde — o pedido montado já fica
// guardado no aparelho (guardar.ts) e volta sozinho.

import { useEffect, useState } from 'react'

const A_CADA_MS = 4 * 60_000

export function AvisoVersao({ slug, versao }: { slug: string; versao: string | null }) {
  const [nova, setNova] = useState(false)

  useEffect(() => {
    // Sem versão (servidor de desenvolvimento): não há o que comparar.
    if (!versao || nova) return
    let vivo = true
    const conferir = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const r = await fetch(`/${slug}/balcao/versao`, { cache: 'no-store' })
        if (!r.ok) return
        const { versao: agora } = (await r.json()) as { versao: string | null }
        if (vivo && agora && agora !== versao) setNova(true)
      } catch {
        // Sem internet agora: pergunta de novo na próxima volta.
      }
    }
    const t = setInterval(conferir, A_CADA_MS)
    const voltou = () => {
      if (document.visibilityState === 'visible') void conferir()
    }
    document.addEventListener('visibilitychange', voltou)
    window.addEventListener('focus', voltou)
    return () => {
      vivo = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', voltou)
      window.removeEventListener('focus', voltou)
    }
  }, [slug, versao, nova])

  if (!nova) return null
  return (
    // Por cima de tudo do balcão (folhas 45, receber 46), abaixo da tranca
    // de inatividade (60) — e no alto, longe do "Concluir" e da barra do
    // pedido no celular.
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[47] flex justify-center px-3">
      <div
        role="status"
        className="realce-alto pointer-events-auto flex max-w-xl flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-marca/40 bg-superficie px-4 py-3 text-sm shadow-norte-alta"
      >
        <span className="text-tinta">
          <b className="font-semibold">Tem versão nova do sistema.</b>{' '}
          <span className="text-tinta-2">Recarregue quando puder — o pedido montado não se perde.</span>
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="botao-marca min-h-10 rounded-xl px-4 text-sm font-semibold text-marca-tinta"
          >
            Recarregar
          </button>
          <button
            type="button"
            onClick={() => setNova(false)}
            className="min-h-10 rounded-xl px-3 text-sm font-semibold text-tinta-3 hover:bg-superficie-2 hover:text-tinta"
          >
            Depois
          </button>
        </span>
      </div>
    </div>
  )
}
