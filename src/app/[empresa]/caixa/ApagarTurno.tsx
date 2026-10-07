'use client'

// "Apagar este turno" — só para o dono, só no turno fechado, com motivo. As
// regras (sem venda valendo, sem parcela recebida) moram em `apagarTurno`.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DicaDaAcao, IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { apagarTurnoAcao } from './acoes'

export function ApagarTurno({ slug, caixaId, voltar }: { slug: string; caixaId: string; voltar: string }) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('turno de teste')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={classeDaAcao({ tom: 'perigo' })} aria-label="Apagar este turno">
        <IconeDaAcao icone="excluir" />
        <DicaDaAcao>Apagar turno</DicaDaAcao>
      </button>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        aria-label="Por que apagar"
        className="w-40 rounded-[5px] border border-borda bg-superficie px-2 py-1 text-tinta"
      />
      <button
        type="button"
        disabled={indo}
        onClick={() =>
          comecar(async () => {
            const r = await apagarTurnoAcao(slug, caixaId, motivo)
            if (r.erro) setErro(r.erro)
            else router.push(voltar)
          })
        }
        className="rounded-[5px] bg-critico-vivo px-2.5 py-1 font-semibold text-white disabled:opacity-60"
      >
        {indo ? 'Apagando…' : 'Apagar de vez'}
      </button>
      <button type="button" onClick={() => { setAberto(false); setErro(null) }} className={classeDaAcao()} aria-label="Desistir de apagar">
        <IconeDaAcao icone="fechar" />
        <DicaDaAcao>Desistir</DicaDaAcao>
      </button>
      {erro && <span role="alert" className="w-full text-critico">{erro}</span>}
    </span>
  )
}
