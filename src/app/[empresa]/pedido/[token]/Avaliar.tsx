'use client'

// "Como foi o seu pedido?" — as estrelas e um comentário, depois de entregue.
// Aparece no catálogo da loja, com o primeiro nome. Uma vez por pedido.

import { useState, useTransition } from 'react'
import { avaliarAcao } from './acoes'

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const ROTULOS = ['', 'Ruim', 'Poderia ser melhor', 'Bom', 'Muito bom', 'Perfeito!']

function Estrela({ cheia, tamanho = 34 }: { cheia: boolean; tamanho?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={tamanho} height={tamanho} aria-hidden>
      <path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z" fill={cheia ? '#f5a524' : 'var(--borda)'} />
    </svg>
  )
}

export function Avaliar({ slug, token, feita }: { slug: string; token: string; feita: { nota: number; texto: string | null } | null }) {
  const [nota, setNota] = useState(0)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviada, setEnviada] = useState<{ nota: number; texto: string | null } | null>(feita)
  const [indo, comecar] = useTransition()
  const cartao = 'rounded-[24px] border border-borda-suave bg-superficie p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]'

  if (enviada) {
    return (
      <section className={`${cartao} flex flex-col items-center gap-2 text-center`}>
        <p className="text-sm font-bold text-titulo">Obrigado pela avaliação!</p>
        <span className="flex gap-0.5" aria-label={`${enviada.nota} de 5 estrelas`} role="img">
          {[1, 2, 3, 4, 5].map((i) => <Estrela key={i} cheia={i <= enviada.nota} tamanho={22} />)}
        </span>
        {enviada.texto ? <p className="text-sm text-tinta-2">“{enviada.texto}”</p> : null}
      </section>
    )
  }

  return (
    <section className={`${cartao} flex flex-col gap-3`} aria-labelledby="avaliar-titulo">
      <div>
        <h2 id="avaliar-titulo" className="text-base font-extrabold text-titulo">Como foi o seu pedido?</h2>
        <p className="text-sm text-tinta-2">Sua avaliação aparece no catálogo da loja, só com o seu primeiro nome.</p>
      </div>
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Nota">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={nota === i}
            aria-label={`${i} ${i === 1 ? 'estrela' : 'estrelas'}`}
            onClick={() => setNota(i)}
            className={`rounded-lg p-0.5 transition-transform active:scale-90 ${FOCO}`}
          >
            <Estrela cheia={i <= nota} />
          </button>
        ))}
        {nota ? <span className="ml-2 text-sm font-semibold text-tinta-2">{ROTULOS[nota]}</span> : null}
      </div>
      {nota ? (
        <>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={400}
            rows={3}
            placeholder="Conte como foi (opcional)"
            className="w-full resize-none rounded-2xl border border-borda bg-superficie px-4 py-3 text-[15px] text-tinta outline-none placeholder:text-tinta-3 focus:border-marca"
          />
          {erro ? <p role="alert" className="text-sm font-medium text-critico">{erro}</p> : null}
          <button
            type="button"
            disabled={indo}
            onClick={() =>
              comecar(async () => {
                setErro(null)
                const r = await avaliarAcao(slug, token, nota, texto).catch(() => ({ ok: false as const, erro: 'Sem conexão. Tente de novo.' }))
                if (r.ok) setEnviada({ nota, texto: texto.trim() || null })
                else setErro(r.erro)
              })
            }
            className={`flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 text-[15px] font-bold text-marca-tinta disabled:opacity-60 ${FOCO}`}
          >
            {indo ? 'Enviando…' : 'Enviar avaliação'}
          </button>
        </>
      ) : null}
    </section>
  )
}
