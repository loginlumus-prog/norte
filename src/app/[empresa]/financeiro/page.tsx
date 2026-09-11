import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { escolherUnidade } from '@/servidor/unidade'
import { aVencer, montarDRE, listarLancamentos, resultadoPorMes } from '@/servidor/financeiro'
import { BarrasMeses, Rosca } from '@/ui/Graficos'
import Link from 'next/link'
import { Tabela } from '@/ui/Tabela'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import type { TipoLancamento } from '@prisma/client'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Aviso, Ponto, cx } from '@/ui/base'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Numero, Secao, Tira, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Lancar, Pagar } from './Lancar'

const dia = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d)

const MES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

export default async function Financeiro({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{
    unidade?: string
    mes?: string
    q?: string
    tipo?: string
    situacao?: string
    categoria?: string
  }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, mes, q: qBruto, tipo: tipoPedido, situacao: sitPedida, categoria: catPedida } =
    await searchParams
  const q = (qBruto ?? '').trim()
  const tipo: TipoLancamento | null = tipoPedido === 'DESPESA' || tipoPedido === 'RECEITA' ? tipoPedido : null
  const situacaoL: 'aberto' | 'pago' | null = sitPedida === 'aberto' || sitPedida === 'pago' ? sitPedida : null
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'financeiro.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const onde = await escolherUnidade(sessao, empresa, pedida, 'financeiro.ver')

  // Mês do relatório: o corrente, ou o que veio no endereço (YYYY-MM).
  const agora = new Date()
  const [ano, mesNum] = (mes ?? `${agora.getFullYear()}-${agora.getMonth() + 1}`)
    .split('-')
    .map(Number)
  const de = new Date(ano!, mesNum! - 1, 1)
  const ate = new Date(ano!, mesNum!, 0, 23, 59, 59)

  const [contas, dre, categorias, unidades, lancamentos, meses] = await Promise.all([
    aVencer(sessao, onde.ids),
    montarDRE(sessao, onde.ids, de, ate),
    comoOrg(sessao.orgId, (db) =>
      db.categoriaFinanceira.findMany({
        where: { ativa: true },
        orderBy: [{ tipo: 'asc' }, { ordem: 'asc' }],
        select: { id: true, nome: true, tipo: true },
      }),
    ),
    comoOrg(sessao.orgId, (db) =>
      db.contaFinanceira.findMany({
        where: { ativa: true },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true },
      }),
    ),
    listarLancamentos(sessao, {
      unidadeIds: onde.ids,
      ano: ano!,
      mes: mesNum!,
      tipo,
      situacao: situacaoL,
      categoriaId: catPedida ?? null,
      q,
    }),
    resultadoPorMes(sessao, onde.ids, 6),
  ])

  // "Para onde foi o dinheiro": as linhas negativas do DRE que não são
  // total nem informativa — CMV, cada grupo de despesa, financeiras.
  const saidas = dre.linhas
    .filter((l) => !l.total && !l.fora && l.valor < 0 && l.chave !== 'devolucoes')
    .map((l) => ({ rotulo: l.rotulo.replace('(−) ', ''), valor: -l.valor }))

  const categoriaL = categorias.some((c) => c.id === catPedida) ? catPedida! : null
  const atuais = {
    unidade: onde.unidadeId,
    mes: mes ?? null,
    q,
    tipo,
    situacao: situacaoL,
    categoria: categoriaL,
  }
  const linkL = (mudanca: Record<string, string | null>) =>
    enderecoCom(`/${slug}/financeiro`, atuais, mudanca)

  const somaL = (t: TipoLancamento) =>
    lancamentos.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0)
  const abertos = lancamentos.filter((l) => !l.pagoEm)
  const hojeZero = new Date(new Date().toDateString())

  const podeLancar = pode(sessao, 'financeiro.lancar')
  const menu = MENU(slug).map((i) =>
    i.href === `/${slug}/financeiro` && contas.vencidas.length > 0
      ? {
          ...i,
          aviso: { quantos: contas.vencidas.length, nivel: 'critico' as const, titulo: 'vencida(s)' },
        }
      : i,
  )

  const mesAnterior = new Date(ano!, mesNum! - 2, 1)
  const mesSeguinte = new Date(ano!, mesNum!, 1)
  const link = (d: Date) =>
    `/${slug}/financeiro?mes=${d.getFullYear()}-${d.getMonth() + 1}` +
    (onde.unidadeId ? `&unidade=${onde.unidadeId}` : '')

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}/financeiro`}
      tema={tema}
      titulo="Financeiro"
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} /> : undefined}
    >
      {/* ── A PAGAR ── */}
      <Secao titulo="Contas a pagar">
        <Tira
          itens={[
            { rotulo: 'vencidas', quantos: contas.vencidas.length, nivel: 'critico' },
            { rotulo: 'vencem hoje', quantos: contas.hoje.length, nivel: 'atencao' },
            { rotulo: 'próximos 15 dias', quantos: contas.proximas.length, nivel: 'neutro' },
          ]}
        />

        {/* Pulsa: juro corre enquanto a conta fica aqui. E o unico aviso
            desta tela que piora sozinho com o tempo. */}
        {contas.vencidas.length > 0 && (
          <Aviso nivel="critico" pulsa>
            {contas.vencidas.length} conta{contas.vencidas.length === 1 ? '' : 's'} vencida
            {contas.vencidas.length === 1 ? '' : 's'}, somando {brl(contas.totalVencido)}. Juro e
            multa correm enquanto ficam aqui.
          </Aviso>
        )}

        <Cartao
          titulo="A vencer"
          acao={
            contas.vencidas.length > 0 ? (
              <Ponto nivel="critico" quantos={contas.vencidas.length} titulo="vencidas" />
            ) : undefined
          }
        >
          {contas.vencidas.length + contas.hoje.length + contas.proximas.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm font-medium text-bom">
              <span aria-hidden className="size-2 rounded-full bg-bom-vivo" />
              Nada vencendo nos próximos 15 dias.
            </p>
          ) : (
            <ul className="flex flex-col">
              {[
                ...contas.vencidas.map((c) => ({ ...c, nivel: 'critico' as const, quando: `${c.dias}d atrás` })),
                ...contas.hoje.map((c) => ({ ...c, nivel: 'atencao' as const, quando: 'hoje' })),
                ...contas.proximas.map((c) => ({ ...c, nivel: 'neutro' as const, quando: `em ${c.dias}d` })),
              ].map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 border-b border-borda-suave py-2 last:border-0"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-tinta">{c.descricao}</span>
                    <span className="text-xs text-tinta-3">{dia(c.vencimento)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Situacao nivel={c.nivel}>{c.quando}</Situacao>
                    <span className="numero w-24 text-sm font-semibold text-tinta">
                      {brl(c.valor)}
                    </span>
                    {podeLancar && <Pagar slug={slug} id={c.id} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        {podeLancar && (
          <Lancar
            slug={slug}
            categorias={categorias}
            contas={unidades}
            unidadeId={onde.unidadeId}
          />
        )}
      </Secao>

      {/* ── LANÇAMENTOS ──
          O DRE agrega; isto é a prova dele. "Quanto paguei de fornecedor em
          agosto" e "esse R$ 1.200 é o quê" não tinham onde ser olhados. */}
      <Secao
        titulo={`Lançamentos de ${MES[de.getMonth()]}`}
        resumo="Tudo que foi lançado com vencimento neste mês. É daqui que sai o resultado logo abaixo."
        acao={
          <Fichas
            opcoes={[
              { valor: null, rotulo: 'tudo', quantos: lancamentos.length },
              { valor: 'aberto', rotulo: 'em aberto', quantos: abertos.length },
              { valor: 'pago', rotulo: 'pagos', quantos: lancamentos.length - abertos.length },
            ]}
            atual={situacaoL}
            linkDe={(v) => linkL({ situacao: v })}
          />
        }
      >
        <div className="flex flex-col gap-2">
          <Busca
            valor={q}
            placeholder="Descrição, fornecedor ou número do documento"
            rotulo="Buscar lançamento"
            manter={{ unidade: onde.unidadeId, mes: mes ?? null, tipo, situacao: situacaoL, categoria: categoriaL }}
            limparEm={linkL({ q: null })}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Fichas
              opcoes={[
                { valor: null, rotulo: 'despesas e receitas' },
                { valor: 'DESPESA', rotulo: 'só despesas' },
                { valor: 'RECEITA', rotulo: 'só receitas' },
              ]}
              atual={tipo}
              linkDe={(v) => linkL({ tipo: v })}
            />
            <Fichas
              opcoes={[
                { valor: null, rotulo: 'todas as categorias' },
                ...categorias
                  .filter((c) => !tipo || c.tipo === tipo)
                  .map((c) => ({ valor: c.id, rotulo: c.nome })),
              ]}
              atual={categoriaL}
              linkDe={(v) => linkL({ categoria: v })}
            />
          </div>
        </div>

        <Cartao
          titulo={`${lancamentos.length} lançamento${lancamentos.length === 1 ? '' : 's'}`}
          acao={
            <span className="flex gap-4 text-xs text-tinta-3">
              <span>
                despesas <b className="numero text-tinta-2">{brl(somaL('DESPESA'))}</b>
              </span>
              <span>
                receitas <b className="numero text-tinta-2">{brl(somaL('RECEITA'))}</b>
              </span>
            </span>
          }
        >
          <Tabela
            colunas={[
              {
                chave: 'venc',
                titulo: 'Vence',
                largura: '5rem',
                celula: (l: (typeof lancamentos)[number]) => (
                  <span className="numero text-tinta-2">{dia(l.vencimento)}</span>
                ),
              },
              {
                chave: 'desc',
                titulo: 'Lançamento',
                celula: (l: (typeof lancamentos)[number]) => (
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-tinta">{l.descricao}</span>
                    <span className="text-xs text-tinta-3">
                      {l.categoria}
                      {l.fornecedor ? ` · ${l.fornecedor}` : ''}
                      {l.documento ? ` · ${l.documento}` : ''}
                    </span>
                  </span>
                ),
              },
              {
                chave: 'sit',
                titulo: '',
                largura: '7rem',
                celula: (l: (typeof lancamentos)[number]) =>
                  l.pagoEm ? (
                    <Situacao nivel="bom">pago {dia(l.pagoEm)}</Situacao>
                  ) : l.vencimento < hojeZero ? (
                    <Situacao nivel="critico">vencido</Situacao>
                  ) : (
                    <Situacao nivel="neutro">em aberto</Situacao>
                  ),
              },
              {
                chave: 'valor',
                titulo: 'Valor',
                numero: true,
                largura: '8rem',
                celula: (l: (typeof lancamentos)[number]) => (
                  <span className={'numero font-semibold ' + (l.tipo === 'RECEITA' ? 'text-bom' : 'text-tinta')}>
                    {l.tipo === 'RECEITA' ? '+ ' : ''}
                    {brl(l.valor)}
                  </span>
                ),
              },
              ...(podeLancar
                ? [
                    {
                      chave: 'acao',
                      titulo: '',
                      largura: '6rem',
                      celula: (l: (typeof lancamentos)[number]) =>
                        l.pagoEm ? null : <Pagar slug={slug} id={l.id} />,
                    },
                  ]
                : []),
            ]}
            linhas={lancamentos}
            chave={(l) => l.id}
            vazio={q || tipo || situacaoL || categoriaL ? 'Nada com esse filtro.' : 'Nada lançado neste mês.'}
          />
        </Cartao>
      </Secao>

      {/* ── DRE ── */}
      <Secao titulo="Resultado do mês">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <a href={link(mesAnterior)} className="rounded px-2 py-1 text-tinta-2 hover:bg-superficie-2">
              ←
            </a>
            <span className="font-semibold text-tinta">
              {MES[de.getMonth()]} de {de.getFullYear()}
            </span>
            <a href={link(mesSeguinte)} className="rounded px-2 py-1 text-tinta-2 hover:bg-superficie-2">
              →
            </a>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Numero
            rotulo="Resultado do mês"
            valor={brl(dre.resultado)}
            detalhe={dre.resultado >= 0 ? 'sobrou' : 'faltou'}
            nivel={dre.resultado >= 0 ? 'bom' : 'critico'}
          />
          <Numero
            rotulo="Margem"
            valor={`${dre.margem.toFixed(1)}%`}
            detalhe="do que entrou, quanto ficou"
            nivel={dre.margem >= 15 ? 'bom' : dre.margem >= 5 ? 'atencao' : 'critico'}
          />
        </div>

        <Cartao titulo="Demonstrativo">
          <div className="flex flex-col">
            {dre.linhas.map((l) => (
              <div key={l.chave}>
                <div
                  className={cx(
                    'flex items-baseline justify-between gap-4 py-2',
                    l.fora
                      ? 'mt-3 rounded-norte bg-superficie-2 px-2 text-tinta-2'
                      : l.total
                        ? 'border-t border-borda font-bold text-tinta'
                        : 'border-b border-borda-suave text-tinta-2',
                  )}
                >
                  <span className="text-sm">{l.rotulo}</span>
                  <span
                    className={cx(
                      'numero text-sm',
                      l.total && l.valor < 0 && 'text-critico',
                      l.total && l.valor > 0 && l.chave === 'resultado' && 'text-bom',
                    )}
                  >
                    {brl(l.valor)}
                  </span>
                </div>
                {l.itens && l.itens.length > 1 && (
                  <ul className="mb-1 flex flex-col gap-0.5 pl-4">
                    {l.itens.map((i) => (
                      <li key={i.nome} className="flex justify-between gap-4 text-xs text-tinta-3">
                        <span>{i.nome}</span>
                        <span className="numero">{brl(i.valor)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-tinta-3">
            As despesas contam pelo que foi <b>pago</b> no mês, não pelo que venceu — é o que
            bate com o extrato. A mercadoria é a exceção: comprar não é despesa, vira custo
            quando a peça vende (a linha do CMV). Por isso a compra aparece separada, fora
            da conta do resultado.
            {dre.taxasCalculadas > 0 ? (
              <>
                {' '}As taxas de cartão e Pix ({brl(dre.taxasCalculadas)}) são calculadas venda a venda
                com o que está em{' '}
                <Link href={`/${slug}/configuracoes`} className="font-medium text-marca underline-offset-2 hover:underline">
                  Configurações
                </Link>
                .
              </>
            ) : (
              <>
                {' '}A taxa da maquininha ainda não entra: escreva as suas em{' '}
                <Link href={`/${slug}/configuracoes`} className="font-medium text-marca underline-offset-2 hover:underline">
                  Configurações
                </Link>{' '}
                e o resultado passa a descontá-la sozinho.
              </>
            )}
          </p>
        </Cartao>

        <div className="grid gap-3 lg:grid-cols-2">
          <Cartao caixa titulo="Entrou × saiu, nos últimos 6 meses">
            <BarrasMeses
              rotulos={meses.map((m) => m.rotulo)}
              series={[
                { nome: 'Receita', cor: 'var(--bom-vivo)', valores: meses.map((m) => m.receita) },
                { nome: 'Saiu (mercadoria, despesas, taxas)', cor: 'var(--critico-vivo)', valores: meses.map((m) => m.cmv + m.despesas + m.taxas) },
              ]}
            />
            <ul className="mt-3 grid grid-cols-3 gap-1 text-xs sm:grid-cols-6">
              {meses.map((m) => (
                <li key={m.mes} className="flex flex-col items-center rounded bg-superficie-2 px-1 py-1">
                  <span className="text-tinta-3">{m.rotulo}</span>
                  <span className={cx('numero font-semibold', m.resultado < 0 ? 'text-critico' : 'text-bom')}>
                    {m.resultado < 0 ? '−' : ''}
                    {brl(Math.abs(m.resultado)).replace('R$ ', '')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-tinta-3">Embaixo de cada mês, o resultado: o que sobrou ou faltou.</p>
          </Cartao>
          <Cartao caixa titulo={`Para onde foi o dinheiro em ${MES[de.getMonth()]}`}>
            <Rosca fatias={saidas} vazio="Nada saiu neste mês." />
          </Cartao>
        </div>
      </Secao>
    </Estrutura>
  )
}
