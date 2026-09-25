'use client'

// Os botões de cada campanha na lista. Apagar pergunta antes (leva o
// histórico junto) e é recusado pelo servidor com gente dentro.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Botao } from '@/ui/base'
import { apagarAcao, ativarAcao, duplicarAcao, type Resposta } from './acoes'

export function AcoesDaCampanha({
  slug,
  id,
  nome,
  ativa,
  dentro,
}: {
  slug: string
  id: string
  nome: string
  ativa: boolean
  dentro: number
}) {
  const [indo, comecar] = useTransition()
  const [r, setR] = useState<Resposta>({})
  const [confirmar, setConfirmar] = useState(false)

  const rodar = (f: () => Promise<Resposta>) =>
    comecar(async () => {
      setR(await f())
    })

  return (
    <div className="flex flex-col items-start gap-2 lg:items-end">
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/${slug}/campanhas/${id}`}
          className="botao-marca inline-flex items-center rounded-norte px-3 py-2 text-sm font-semibold text-marca-tinta"
        >
          Abrir
        </Link>
        <Botao tom="secundario" disabled={indo} onClick={() => rodar(() => ativarAcao(slug, id, !ativa))}>
          {ativa ? 'Pausar' : 'Ativar'}
        </Botao>
        <Botao tom="secundario" disabled={indo} onClick={() => rodar(() => duplicarAcao(slug, id))}>
          Duplicar
        </Botao>
        {!confirmar ? (
          <Botao
            tom="discreto"
            disabled={indo}
            onClick={() => (dentro > 0 ? setR({ erro: 'Há gente dentro desta campanha: tire em "Contatos dentro agora" antes de apagar.' }) : setConfirmar(true))}
          >
            Apagar
          </Botao>
        ) : (
          <span className="flex items-center gap-2">
            <Botao tom="perigo" carregando={indo} onClick={() => rodar(() => apagarAcao(slug, id))}>
              Apagar &quot;{nome}&quot;
            </Botao>
            <Botao tom="discreto" onClick={() => setConfirmar(false)}>
              Não
            </Botao>
          </span>
        )}
      </div>
      {(r.erro || r.ok) && (
        <p role={r.erro ? 'alert' : 'status'} className={r.erro ? 'text-xs font-medium text-critico' : 'text-xs text-bom'}>
          {r.erro ?? r.ok}
          {r.pendencias && r.pendencias.some((p) => p.nivel === 'erro') && (
            <>
              {' '}
              <Link href={`/${slug}/campanhas/${id}`} className="underline">
                Ver pendências
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  )
}
