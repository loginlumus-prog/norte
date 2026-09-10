import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { escolherUnidade } from '@/servidor/unidade'
import { listarVendas } from '@/servidor/venda'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Vazio } from '@/ui/base'
import { Tira, Numero, brl } from '@/ui/painel'
import { Tabela } from '@/ui/Tabela'
import { SeletorPeriodo } from '@/ui/Periodo'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import type { Tema } from '@/ui/TrocaTema'
import type { SituacaoVenda } from '@prisma/client'

// As vendas que já aconteceram.
//
// Esta tela não existia, e a falta dela era a maior do sistema: dava para
// vender e não dava para achar o que foi vendido. Quem opera loja abre isto o
// dia inteiro — para conferir o dia, para achar a venda de um cliente que
// voltou, para ver o que a Maria vendeu no sábado.
//
// A pergunta que ela responde primeiro é "quanto saiu no período?", em
// número grande. A lista vem depois, e o filtro é de endereço, não de estado
// escondido: o link do sábado pode ser mandado para alguém e abre igual.

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Débito', CREDITO: 'Crédito', CREDIARIO: 'Crediário',
}

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d)

export default async function Vendas({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; periodo?: string; q?: string; situacao?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, periodo: pedido, q, situacao: sit } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const onde = await escolherUnidade(sessao, empresa, pedida, 'venda.ver')
  const j = janela(lerPeriodo(pedido))
  // Só as duas que fazem sentido filtrar. ABERTA existe no enum e não existe
  // na prática — a venda nasce CONCLUIDA — e aceitar do endereço uma situação
  // que a lista nunca teria seria filtro que devolve vazio sem explicar.
  const situacao: SituacaoVenda | null =
    sit === 'CONCLUIDA' || sit === 'CANCELADA' ? sit : null

  const vendas = await listarVendas(sessao, { unidadeIds: onde.ids, de: j.de, ate: j.ate, q, situacao })

  const concluidas = vendas.filter((v) => v.situacao === 'CONCLUIDA')
  const canceladas = vendas.filter((v) => v.situacao === 'CANCELADA')
  const total = concluidas.reduce((s, v) => s + v.total, 0)
  const ticket = concluidas.length > 0 ? total / concluidas.length : 0

  // Preserva o resto do endereço ao trocar um filtro.
  const link = (mudanca: Record<string, string | null>) => {
    const p = new URLSearchParams()
    if (onde.unidadeId) p.set('unidade', onde.unidadeId)
    p.set('periodo', j.chave)
    if (q) p.set('q', q)
    if (situacao) p.set('situacao', situacao)
    for (const [k, v] of Object.entries(mudanca)) v === null ? p.delete(k) : p.set(k, v)
    return `/${slug}/vendas?${p.toString()}`
  }

  const colunas = [
    {
      chave: 'n',
      titulo: 'Nº',
      largura: '5rem',
      celula: (v: (typeof vendas)[number]) => (
        <span className="numero font-semibold text-tinta">{v.numero}</span>
      ),
    },
    {
      chave: 'quando',
      titulo: 'Quando',
      largura: '8rem',
      celula: (v: (typeof vendas)[number]) => (
        <span className="numero text-tinta-2">{quando(v.criadaEm)}</span>
      ),
    },
    {
      chave: 'cliente',
      titulo: 'Cliente',
      celula: (v: (typeof vendas)[number]) => (
        <span className={v.cliente ? 'text-tinta' : 'text-tinta-3'}>{v.cliente ?? 'sem cadastro'}</span>
      ),
    },
    {
      chave: 'itens',
      titulo: 'Itens',
      numero: true,
      largura: '4rem',
      celula: (v: (typeof vendas)[number]) => <span className="numero">{v.itens}</span>,
    },
    {
      chave: 'forma',
      titulo: 'Pagamento',
      celula: (v: (typeof vendas)[number]) => (
        <span className="text-tinta-2">{v.formas.map((f) => FORMA[f] ?? f).join(' + ') || '—'}</span>
      ),
    },
    {
      chave: 'quem',
      titulo: 'Vendeu',
      celula: (v: (typeof vendas)[number]) => <span className="text-tinta-2">{v.vendedor ?? '—'}</span>,
    },
    {
      chave: 'total',
      titulo: 'Total',
      numero: true,
      largura: '7rem',
      celula: (v: (typeof vendas)[number]) =>
        v.situacao === 'CANCELADA' ? (
          <span className="flex items-center justify-end gap-2">
            <Situacao nivel="critico">cancelada</Situacao>
            <span className="numero text-tinta-3 line-through">{brl(v.total)}</span>
          </span>
        ) : (
          <span className="numero font-semibold text-tinta">{brl(v.total)}</span>
        ),
    },
    {
      chave: 'abrir',
      titulo: '',
      largura: '4rem',
      celula: (v: (typeof vendas)[number]) => (
        <Link
          href={`/${slug}/vendas/${v.id}`}
          className="text-xs font-semibold text-marca hover:underline"
        >
          abrir
        </Link>
      ),
    },
  ]

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/vendas`}
      tema={tema}
      titulo="Vendas"
      acao={
        <span className="flex items-center gap-2">
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
          <SeletorPeriodo atual={j.chave} />
        </span>
      }
    >
      {/* O número grande primeiro: é ele que a pessoa veio ver. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Numero
          rotulo={`Vendido · ${j.rotulo.toLowerCase()}`}
          valor={brl(total)}
          detalhe={`${concluidas.length} venda${concluidas.length === 1 ? '' : 's'}`}
          principal
        />
        <Numero rotulo="Ticket médio" valor={brl(ticket)} detalhe="por venda" />
        <Numero
          rotulo="Canceladas"
          valor={String(canceladas.length)}
          detalhe={canceladas.length ? brl(canceladas.reduce((s, v) => s + v.total, 0)) : 'nenhuma'}
          nivel={canceladas.length > 0 ? 'atencao' : undefined}
        />
      </div>

      {/* Busca e filtro no endereço. `q` aceita número da venda ou nome do
          cliente — é o que a pessoa tem na mão quando vem procurar. */}
      <form className="flex flex-wrap gap-2">
        <input type="hidden" name="periodo" value={j.chave} />
        {onde.unidadeId && <input type="hidden" name="unidade" value={onde.unidadeId} />}
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Número da venda ou nome do cliente"
          aria-label="Buscar venda"
          className="min-w-[16rem] flex-1 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
        />
        <button
          type="submit"
          className="rounded-norte border border-borda bg-superficie px-4 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
        >
          Buscar
        </button>
        {q && (
          <Link href={link({ q: null })} className="flex items-center px-2 text-sm text-tinta-3 hover:text-tinta">
            limpar
          </Link>
        )}
      </form>

      <Tira
        itens={[
          { rotulo: 'concluídas', quantos: concluidas.length, nivel: 'bom' },
          { rotulo: 'canceladas', quantos: canceladas.length, nivel: canceladas.length ? 'critico' : 'neutro' },
        ]}
      />

      <Cartao
        titulo={q ? `Resultado de “${q}”` : `${vendas.length} venda${vendas.length === 1 ? '' : 's'}`}
        acao={
          <span className="flex gap-1 text-xs">
            {(
              [
                [null, 'todas'],
                ['CONCLUIDA', 'concluídas'],
                ['CANCELADA', 'canceladas'],
              ] as [SituacaoVenda | null, string][]
            ).map(([valor, rotulo]) => (
              <Link
                key={rotulo}
                href={link({ situacao: valor })}
                className={
                  'rounded-full px-2.5 py-1 font-semibold ' +
                  (situacao === valor ? 'bg-tinta text-superficie' : 'text-tinta-2 hover:bg-superficie-2')
                }
              >
                {rotulo}
              </Link>
            ))}
          </span>
        }
      >
        {vendas.length === 0 ? (
          <Vazio>
            {q ? 'Nenhuma venda com isso.' : `Nenhuma venda ${j.rotulo.toLowerCase()}.`}
          </Vazio>
        ) : (
          <Tabela colunas={colunas} linhas={vendas} chave={(v) => v.id} />
        )}
        {vendas.length >= 500 && (
          <p className="pt-3 text-xs text-tinta-3">
            Mostrando as 500 mais recentes. Aperte o período ou use a busca.
          </p>
        )}
      </Cartao>
    </Estrutura>
  )
}
