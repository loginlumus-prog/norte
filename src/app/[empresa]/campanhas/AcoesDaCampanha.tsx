'use client'

// Os botões de cada campanha na lista. Apagar pergunta antes (leva o
// histórico junto) e é recusado pelo servidor com gente dentro.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Botao } from '@/ui/base'
import { AcoesDaLinha, BotaoDaLinha, DicaDaAcao, IconeDaAcao, classeDaAcao } from '@/ui/premium'
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
      {!confirmar ? (
        // Apoio em ícones (duplicar, apagar), ligar/pausar em pílula com o
        // nome — é o estado da campanha — e o "Abrir" cheio no fim.
        <AcoesDaLinha>
          <button
            type="button"
            className={classeDaAcao({ jeito: 'pilula', tom: ativa ? 'neutro' : 'bom' })}
            disabled={indo}
            onClick={() => rodar(() => ativarAcao(slug, id, !ativa))}
          >
            <IconeDaAcao icone={ativa ? 'pausar' : 'retomar'} tamanho={15} />
            {ativa ? 'Pausar' : 'Ativar'}
          </button>
          <button
            type="button"
            className={classeDaAcao()}
            aria-label={`Duplicar a campanha ${nome}`}
            disabled={indo}
            onClick={() => rodar(() => duplicarAcao(slug, id))}
          >
            <IconeDaAcao icone="copiar" />
            <DicaDaAcao>Duplicar</DicaDaAcao>
          </button>
          <button
            type="button"
            className={classeDaAcao({ tom: 'perigo' })}
            aria-label={`Apagar a campanha ${nome}`}
            disabled={indo}
            onClick={() => (dentro > 0 ? setR({ erro: 'Há gente dentro desta campanha: tire em "Contatos dentro agora" antes de apagar.' }) : setConfirmar(true))}
          >
            <IconeDaAcao icone="excluir" />
            <DicaDaAcao>Apagar</DicaDaAcao>
          </button>
          <BotaoDaLinha principal href={`/${slug}/campanhas/${id}`} icone="abrir" rotulo="Abrir" dica={`Abrir a campanha ${nome}`} />
        </AcoesDaLinha>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <Botao tom="perigo" carregando={indo} onClick={() => rodar(() => apagarAcao(slug, id))}>
            Apagar &quot;{nome}&quot;
          </Botao>
          <Botao tom="discreto" onClick={() => setConfirmar(false)}>
            Não
          </Botao>
        </span>
      )}
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
