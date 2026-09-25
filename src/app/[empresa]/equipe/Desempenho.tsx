// A seção "Desempenho" da tela de equipe: as estrelas do mês, com a conta
// aberta linha a linha.
//
// Servidor puro: recebe as notas prontas e desenha. O plano decide quanto
// aparece aberto — e o que o plano não abre aparece TRANCADO, com amostra
// inventada por trás (ver ui/Cadeado.tsx). Nada aqui é dado real de plano
// que o cliente não pagou: as três pessoas da amostra são Ana, Carlos e Bia,
// e as notas delas saem da mesma conta, com insumos de mentira.

import Link from 'next/link'
import type { Plano } from '@prisma/client'
import { Tabela, type Coluna } from '@/ui/Tabela'
import { Tira } from '@/ui/painel'
import { Cartao, cx } from '@/ui/base'
import { Estrelas, formatarEstrelas } from '@/ui/Estrelas'
import { Trancado } from '@/ui/Cadeado'
import { liberado } from '@/servidor/planos'
import { MES_NOME } from '@/servidor/metas'
import {
  estrelas,
  NIVEL,
  semDados,
  type Insumos,
  type NotaDaLoja,
  type PessoaComNota,
  type Tendencia,
} from '@/servidor/desempenho'

const COR_TEXTO = { bom: 'text-bom', atencao: 'text-atencao', critico: 'text-critico' } as const
const COR_BARRA = { bom: 'bg-bom-vivo', atencao: 'bg-atencao-vivo', critico: 'bg-critico-vivo' } as const

/** "2026-09" → "set". */
const abrev = (mes: string) => (MES_NOME[Number(mes.slice(5)) - 1] ?? '').slice(0, 3)

/* ── as peças da linha ────────────────────────────────────── */

/** Uma medida de 0 a 1 com o texto em cima e a barrinha embaixo. */
function Medida({ nota, texto }: { nota: number | null; texto: string }) {
  if (nota === null) return <span className="text-xs whitespace-nowrap text-tinta-3">{texto}</span>
  // A cor da barra segue a mesma régua das estrelas: 0,8 é o que 4 estrelas
  // seriam nesta medida. Uma régua só, senão a linha discorda dela mesma.
  const nivel = NIVEL(nota * 5)
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <span className={cx('numero text-xs font-semibold', COR_TEXTO[nivel])}>{texto}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-superficie-2">
        <div className={cx('h-full rounded-full', COR_BARRA[nivel])} style={{ width: `${Math.max(nota * 100, 2)}%` }} />
      </div>
    </div>
  )
}

/** Três mini-barras, uma por mês: a trajetória num relance. */
function MiniBarras({ meses, valores }: { meses: string[]; valores: (number | null)[] }) {
  const fala = meses.map((m, i) => `${abrev(m)}: ${valores[i] === null || valores[i] === undefined ? 'sem dados' : formatarEstrelas(valores[i]!)}`).join(', ')
  return (
    <div className="flex items-end gap-1.5" role="img" aria-label={fala} title={fala}>
      {meses.map((m, i) => {
        const v = valores[i] ?? null
        return (
          <div key={m} className="flex flex-col items-center gap-0.5">
            <div className="flex h-6 w-2.5 items-end overflow-hidden rounded-sm bg-superficie-2">
              {v !== null && (
                <div className={cx('w-full rounded-sm', COR_BARRA[NIVEL(v)])} style={{ height: `${Math.max((v / 5) * 100, 8)}%` }} />
              )}
            </div>
            <span className="text-[9px] leading-none text-tinta-3">{abrev(m)}</span>
          </div>
        )
      })}
    </div>
  )
}

const textoMeta = (i: Insumos) => (i.meta === null ? 'sem meta' : `${Math.round(i.meta * 100)}%`)
const textoTarefas = (i: Insumos) => (i.tarefas ? `${i.tarefas.noPrazo}/${i.tarefas.atribuidas} no prazo` : 'sem tarefa')
const textoPresenca = (i: Insumos) => (i.presenca ? `${i.presenca.dias} de ${i.presenca.de} dias` : 'sem entrada')

/* ── o corpo: tira + tabela ───────────────────────────────── */

function Corpo({ pessoas, tendencia }: { pessoas: PessoaComNota[]; tendencia?: Tendencia | null }) {
  const comNota = pessoas.filter((p) => !semDados(p.nota))
  const quantos = (nivel: ReturnType<typeof NIVEL>) => comNota.filter((p) => NIVEL(p.nota.estrelas) === nivel).length

  const colunas: Coluna<PessoaComNota>[] = [
    {
      chave: 'pessoa',
      titulo: 'Pessoa',
      celula: (p) => <span className="font-semibold text-tinta">{p.nome}</span>,
    },
    {
      chave: 'estrelas',
      titulo: 'Estrelas',
      largura: '9rem',
      celula: (p) =>
        semDados(p.nota) ? <span className="text-xs whitespace-nowrap text-tinta-3">sem dados no mês</span> : <Estrelas valor={p.nota.estrelas} tamanho="sm" />,
    },
    { chave: 'meta', titulo: 'Meta', celula: (p) => <Medida nota={p.nota.notas.meta ?? null} texto={textoMeta(p.insumos)} /> },
    { chave: 'tarefas', titulo: 'Tarefas', celula: (p) => <Medida nota={p.nota.notas.tarefas ?? null} texto={textoTarefas(p.insumos)} /> },
    { chave: 'presenca', titulo: 'Presença', celula: (p) => <Medida nota={p.nota.notas.presenca ?? null} texto={textoPresenca(p.insumos)} /> },
    ...(tendencia
      ? [
          {
            chave: 'tendencia',
            titulo: '3 meses',
            celula: (p: PessoaComNota) => (
              <MiniBarras meses={tendencia.meses} valores={tendencia.porPessoa[p.usuarioId] ?? tendencia.meses.map(() => null)} />
            ),
          },
        ]
      : []),
    {
      chave: 'porque',
      titulo: 'Por quê',
      celula: (p) => <span className="block min-w-48 text-xs leading-relaxed text-tinta-2">{p.nota.motivos.join(' · ')}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <Tira
        itens={[
          { rotulo: 'com 4 estrelas ou mais', quantos: quantos('bom'), nivel: 'bom' },
          { rotulo: 'entre 2,5 e 4', quantos: quantos('atencao'), nivel: 'atencao' },
          { rotulo: 'abaixo de 2,5', quantos: quantos('critico'), nivel: 'critico' },
          { rotulo: 'sem dados no mês', quantos: pessoas.length - comNota.length, nivel: 'neutro' },
        ]}
      />
      <Tabela colunas={colunas} linhas={pessoas} chave={(p) => p.usuarioId} vazio="Ninguém com venda, meta ou tarefa neste mês." />
      <p className="text-xs text-tinta-3">
        Pesos: meta 50%, tarefas 30%, presença 20% — quem não tem meta ou tarefa divide o peso entre o que tem. Presença é dia em que a
        pessoa entrou no sistema, não ponto. Passar da meta não dá estrela a mais: isso é comissão.
      </p>
    </div>
  )
}

/* ── a amostra, para o que está trancado ──────────────────── */

const AMOSTRA: PessoaComNota[] = (
  [
    { usuarioId: 'amostra-ana', nome: 'Ana', insumos: { meta: 1.04, tarefas: { atribuidas: 9, feitas: 9, noPrazo: 8, atrasadasAbertas: 0 }, presenca: { dias: 20, de: 20 } } },
    { usuarioId: 'amostra-bia', nome: 'Bia', insumos: { meta: null, tarefas: { atribuidas: 5, feitas: 5, noPrazo: 5, atrasadasAbertas: 0 }, presenca: { dias: 19, de: 20 } } },
    { usuarioId: 'amostra-carlos', nome: 'Carlos', insumos: { meta: 0.72, tarefas: { atribuidas: 6, feitas: 4, noPrazo: 3, atrasadasAbertas: 1 }, presenca: { dias: 17, de: 20 } } },
  ] satisfies Omit<PessoaComNota, 'nota'>[]
).map((p) => ({ ...p, nota: estrelas(p.insumos) }))

const AMOSTRA_TENDENCIA: Tendencia = {
  meses: ['2026-07', '2026-08', '2026-09'],
  porPessoa: { 'amostra-ana': [3.5, 4, 4.5], 'amostra-bia': [4, 4.5, 4.5], 'amostra-carlos': [3, 2.5, 3] },
}

const AMOSTRA_LOJAS: NotaDaLoja[] = [
  { unidadeId: 'amostra-centro', nome: 'Centro', media: 4.5, pessoas: 3 },
  { unidadeId: 'amostra-shopping', nome: 'Shopping', media: 3.5, pessoas: 2 },
]

/* ── por loja ─────────────────────────────────────────────── */

function PorLoja({ lojas }: { lojas: NotaDaLoja[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {lojas.map((l) => (
        <li key={l.unidadeId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
          <span className="truncate font-medium text-tinta">{l.nome}</span>
          <span className="flex items-center gap-3">
            <span className="text-xs text-tinta-3">
              {l.pessoas} {l.pessoas === 1 ? 'pessoa' : 'pessoas'}
            </span>
            {l.media === null ? <span className="text-xs text-tinta-3">sem dados</span> : <Estrelas valor={l.media} tamanho="sm" />}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ── a seção ──────────────────────────────────────────────── */

/**
 * As setas de mês. As mesmas da seção de metas, para o `?mes=` andar junto.
 *
 * Com o NOME do mês ao lado da seta: "← ago" diz para onde vai; a seta
 * sozinha era um sinal solto no canto, que quem não é do ramo não lia como
 * botão. E com borda, que é como todo botão secundário do sistema se parece.
 */
export function SetasDoMes({ slug, anterior, seguinte }: { slug: string; anterior: string; seguinte: string }) {
  const botao = 'inline-flex items-center gap-1 rounded-norte border border-borda bg-superficie px-2.5 py-1.5 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta'
  return (
    <span className="flex items-center gap-2">
      <Link href={`/${slug}/equipe?mes=${anterior}`} aria-label={`Ver ${MES_NOME[Number(anterior.slice(5)) - 1]}`} className={botao}>
        <span aria-hidden>←</span> {abrev(anterior)}
      </Link>
      <Link href={`/${slug}/equipe?mes=${seguinte}`} aria-label={`Ver ${MES_NOME[Number(seguinte.slice(5)) - 1]}`} className={botao}>
        {abrev(seguinte)} <span aria-hidden>→</span>
      </Link>
    </span>
  )
}

export function Desempenho({
  slug,
  plano,
  pessoas,
  tendencia,
  lojas,
}: {
  slug: string
  plano: Plano
  pessoas: PessoaComNota[]
  /** Só chega quando o plano abre o completo. */
  tendencia: Tendencia | null
  /** Só chega quando o plano abre o completo E há mais de uma loja à vista. */
  lojas: NotaDaLoja[] | null
}) {
  if (!liberado(plano, 'desempenho.basico')) {
    return (
      <Trancado
        chave="desempenho.basico"
        plano={plano}
        slug={slug}
        resumo="Uma nota de 0 a 5 por pessoa, todo mês, com a conta aberta: meta batida, tarefa no prazo e dias presente."
      >
        <Corpo pessoas={AMOSTRA} />
      </Trancado>
    )
  }

  const completo = liberado(plano, 'desempenho.completo')

  return (
    <>
      <Corpo pessoas={pessoas} tendencia={completo ? tendencia : null} />

      {!completo && (
        <Trancado
          chave="desempenho.completo"
          plano={plano}
          slug={slug}
          resumo="Os três últimos meses de cada pessoa lado a lado, e a média de estrelas de cada loja da rede."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Cartao caixa titulo="Tendência de 3 meses">
              <ul className="flex flex-col gap-2">
                {AMOSTRA.map((p) => (
                  <li key={p.usuarioId} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-tinta">{p.nome}</span>
                    <MiniBarras meses={AMOSTRA_TENDENCIA.meses} valores={AMOSTRA_TENDENCIA.porPessoa[p.usuarioId] ?? []} />
                  </li>
                ))}
              </ul>
            </Cartao>
            <Cartao caixa titulo="Melhor loja">
              <PorLoja lojas={AMOSTRA_LOJAS} />
            </Cartao>
          </div>
        </Trancado>
      )}

      {completo && lojas && lojas.length > 1 && (
        <Cartao titulo="Por loja" acao={<span className="text-xs text-tinta-3">média de quem vendeu ou teve tarefa na loja</span>}>
          <PorLoja lojas={lojas} />
        </Cartao>
      )}
    </>
  )
}
