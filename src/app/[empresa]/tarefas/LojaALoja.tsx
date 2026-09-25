// A rede, loja a loja. Componente de servidor: só lê e desenha.
//
// É a pergunta do dono de várias lojas — "qual delas está deixando a lista
// acumular?" — respondida numa olhada, sem trocar de loja seis vezes. Cada
// loja é uma linha com as contagens e, embaixo, as que venceram, com nome.
//
// A AMOSTRA é o que aparece embaçado para quem ainda não tem a Direção: três
// lojas inventadas, com números inventados. Nunca dado real — o plano não
// pagou por ele.

import Link from 'next/link'
import { Situacao } from '@/ui/base'
import { Tira } from '@/ui/painel'
import { diaCurto, type LojaNoQuadro } from '@/servidor/tarefas'

export function LojaALoja({ lojas, slug }: { lojas: LojaNoQuadro[]; slug: string }) {
  if (lojas.length === 0) {
    return <p className="py-6 text-center text-sm text-tinta-3">Nenhum quadro nas lojas que você vê.</p>
  }
  return (
    <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda bg-superficie">
      {lojas.map((l) => (
        <li key={l.unidadeId ?? '__empresa'} className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            {l.unidadeId ? (
              <Link href={`/${slug}/tarefas?unidade=${l.unidadeId}`} className="text-sm font-semibold text-tinta hover:underline">
                {l.nome}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-tinta">{l.nome}</span>
            )}
            <Tira
              itens={[
                { rotulo: 'a fazer', quantos: l.aFazer, nivel: 'neutro' },
                { rotulo: 'em andamento', quantos: l.emAndamento, nivel: 'atencao' },
                { rotulo: 'paradas', um: 'parada', quantos: l.paradas, nivel: 'critico' },
                { rotulo: 'atrasadas', um: 'atrasada', quantos: l.atrasadas, nivel: 'critico' },
                { rotulo: 'feitas no mês', um: 'feita no mês', quantos: l.feitasNoMes, nivel: 'bom' },
              ]}
            />
            {l.aFazer + l.emAndamento + l.paradas + l.atrasadas + l.feitasNoMes === 0 && (
              <span className="text-xs text-tinta-3">nada por aqui</span>
            )}
          </div>
          {l.vencidas.length > 0 && (
            <ul className="flex flex-col gap-1">
              {l.vencidas.slice(0, 5).map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <Situacao nivel="critico">venceu {diaCurto(v.prazo)}</Situacao>
                  <span className="text-tinta">{v.titulo}</span>
                  <span className="text-tinta-3">
                    · {v.quadroNome}
                    {v.responsavelNome ? ` · ${v.responsavelNome}` : ' · sem responsável'}
                  </span>
                </li>
              ))}
              {l.vencidas.length > 5 && <li className="text-xs text-tinta-3">e mais {l.vencidas.length - 5} vencidas</li>}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Três lojas que não existem, para a pessoa ver a forma antes de assinar. */
export const AMOSTRA_DA_REDE: LojaNoQuadro[] = [
  {
    unidadeId: 'amostra-1', nome: 'Loja Centro', aFazer: 6, emAndamento: 2, paradas: 0, atrasadas: 1, feitasNoMes: 23,
    vencidas: [{ id: 'a1', titulo: 'Trocar a vitrine de inverno', prazo: new Date("2026-09-12T15:00:00Z"), quadroNome: 'Campanha', responsavelNome: 'Carla' }],
  },
  {
    unidadeId: 'amostra-2', nome: 'Loja Shopping', aFazer: 4, emAndamento: 3, paradas: 1, atrasadas: 0, feitasNoMes: 31, vencidas: [],
  },
  {
    unidadeId: 'amostra-3', nome: 'Loja Bairro', aFazer: 9, emAndamento: 1, paradas: 2, atrasadas: 3, feitasNoMes: 8,
    vencidas: [
      { id: 'a2', titulo: 'Contar o estoque de fundo', prazo: new Date("2026-09-05T15:00:00Z"), quadroNome: 'Inventário do mês', responsavelNome: null },
      { id: 'a3', titulo: 'Etiquetar a mercadoria nova', prazo: new Date("2026-09-09T15:00:00Z"), quadroNome: 'Chegada de mercadoria', responsavelNome: 'Marcos' },
    ],
  },
]
