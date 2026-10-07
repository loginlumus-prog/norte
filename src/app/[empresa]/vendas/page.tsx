import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { lerModo } from '@/servidor/modo'
import { escolherUnidade } from '@/servidor/unidade'
import { listarVendas, resumoVendas } from '@/servidor/venda'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Vazio } from '@/ui/base'
import { Barras, Bloco, Numero, brl } from '@/ui/painel'
import { Rosca } from '@/ui/Graficos'
import { resumoDoPainel } from '@/servidor/painel'
import { Tabela } from '@/ui/Tabela'
import { SeletorPeriodo } from '@/ui/Periodo'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import type { Tema } from '@/ui/TrocaTema'
import type { FormaPagamento, SituacaoVenda } from '@prisma/client'
import { Busca, Fichas } from '@/ui/Busca'
import { AcoesDaLinha, BotaoDaLinha } from '@/ui/premium'
import { pode } from '@/servidor/permissao'
import { podeExportar } from '@/servidor/exportacao'
import { vocabularioDaEmpresa, vocabularioDoEndereco } from '@/servidor/vocabulario'
import { concorda, plural } from '@/ui/texto'
import { Paginas } from '@/ui/Paginas'
import { fatiar, lerPagina } from '@/ui/paginacao'

// "Recebimentos" na clínica, no salão e na escola — a mesma lista, no mesmo
// endereço (vocabulario.ts).
export async function generateMetadata({ params }: { params: Promise<{ empresa: string }> }): Promise<Metadata> {
  return { title: (await vocabularioDoEndereco((await params).empresa)).Vendas }
}

const FORMAS_FILTRO: FormaPagamento[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'CREDIARIO', 'VALE']

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
  VALE: 'Vale', TRANSFERENCIA: 'Transferência',
}

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d)

export default async function Vendas({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; periodo?: string; q?: string; situacao?: string; vendedor?: string; forma?: string; pagina?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, periodo: pedido, q, situacao: sit, vendedor: vendedorPedido, forma: formaPedida, pagina: paginaPedida } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'venda.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  // No simples a lista responde "o que vendi e quanto": número, hora,
  // cliente e total. Itens, forma de pagamento, quem vendeu, os filtros por
  // pessoa e a planilha são do avançado — e sem elas a tabela cabe inteira
  // num telefone, sem rolar de lado.
  const simples = (await lerModo()) === 'simples'
  const palavras = await vocabularioDaEmpresa(sessao.orgId)
  const g = (feminina: string, masculina: string) => concorda(palavras, feminina, masculina)

  const onde = await escolherUnidade(sessao, empresa, pedida, 'venda.ver')
  // Quem não vê o histórico (o balcão, por padrão) vê as vendas de HOJE, sem
  // período nem filtros — a tela do dia. A busca continua achando a venda de
  // outro dia nos últimos 30, que é o que a troca precisa.
  const veHistorico = onde.ids.length > 0 && onde.ids.every((u) => pode(sessao, 'venda.historico', u))
  const j = janela(veHistorico ? lerPeriodo(pedido) : q ? '30d' : 'hoje')
  // Só as duas que fazem sentido filtrar. ABERTA existe no enum e não existe
  // na prática — a venda nasce CONCLUIDA — e aceitar do endereço uma situação
  // que a lista nunca teria seria filtro que devolve vazio sem explicar.
  const situacao: SituacaoVenda | null =
    sit === 'CONCLUIDA' || sit === 'CANCELADA' ? sit : null
  const forma = FORMAS_FILTRO.find((f) => f === formaPedida) ?? null
  const vendedorId = vendedorPedido || null

  // Duas consultas: a lista filtrada e a base do período, de onde saem as
  // opções de vendedor e forma. Se as opções viessem da lista filtrada,
  // escolher "Carlos" faria "Ana" sumir do filtro — e não teria como voltar.
  const filtro = { unidadeIds: onde.ids, de: j.de, ate: j.ate, q, situacao, vendedorId, forma }
  // Quanto a loja vendeu no período é número de dono (ver o Painel em
  // ui/menu.ts): o total e o ticket médio só para quem vê relatório. Quem
  // opera o balcão continua achando e abrindo as vendas — só não lê o
  // faturamento da loja no alto da tela.
  const veReceita = onde.ids.some((u) => pode(sessao, 'relatorio.ver', u))
  const [vendas, base, resumo] = await Promise.all([
    listarVendas(sessao, filtro),
    vendedorId || forma
      ? listarVendas(sessao, { unidadeIds: onde.ids, de: j.de, ate: j.ate, q, situacao })
      : Promise.resolve(null),
    // Somado no banco, sem o teto de 500 da lista: com o teto, o "Vendido"
    // de um mês movimentado era o das 500 vendas mais recentes.
    resumoVendas(sessao, filtro),
  ])
  // Os gráficos do período (o mesmo resumo do Painel), só para quem lê o
  // faturamento e com mais de um dia na janela.
  const grafico = veReceita && veHistorico && j.temGrafico && !q ? await resumoDoPainel(sessao, onde.ids, j) : null
  const universo = base ?? vendas
  const vendedores = [...new Map(universo.filter((v) => v.vendedorId).map((v) => [v.vendedorId!, v.vendedor ?? '—'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
  const formasUsadas = FORMAS_FILTRO.filter((f) => universo.some((v) => v.formas.includes(f)))

  const total = resumo.total
  const ticket = resumo.concluidas > 0 ? total / resumo.concluidas : 0
  // O número da venda recomeça em cada loja: sem a loja escolhida, "venda 12"
  // pode ser duas — a coluna Loja diz qual é qual (inclusive na busca por
  // número, que traz a 12 de cada loja).
  const variasLojas = onde.unidadeId === null && onde.opcoes.length > 1
  const temFiltro = !!(q || situacao || vendedorId || forma)

  // Preserva o resto do endereço ao trocar um filtro.
  const link = (mudanca: Record<string, string | null>) => {
    const p = new URLSearchParams()
    if (onde.unidadeId) p.set('unidade', onde.unidadeId)
    p.set('periodo', j.chave)
    if (q) p.set('q', q)
    if (situacao) p.set('situacao', situacao)
    if (vendedorId) p.set('vendedor', vendedorId)
    if (forma) p.set('forma', forma)
    for (const [k, v] of Object.entries(mudanca)) v === null ? p.delete(k) : p.set(k, v)
    return `/${slug}/vendas?${p.toString()}`
  }
  const linkExportar = link({}).replace(`/${slug}/vendas?`, `/${slug}/vendas/exportar?`)
  // Cem por página das (até) 500 lidas: um mês de loja movimentada desenhava
  // trezentas linhas de uma vez (ver ui/paginacao.ts).
  const fatia = fatiar(vendas, lerPagina(paginaPedida), 100)
  // O título conta o que o banco somou, não o que a lista leu: com o teto de
  // 500 ele dizia "500 vendas" num período de 613.
  const contadas = resumo.concluidas + resumo.canceladas

  const todasAsColunas = [
    {
      chave: 'n',
      titulo: 'Nº',
      largura: '3.5rem',
      // O número já abre a venda. O "abrir" mora na última coluna, e no
      // celular a última coluna fica fora da tela: sem isto, abrir uma venda
      // pelo telefone era rolar a tabela de lado primeiro.
      celula: (v: (typeof vendas)[number]) => (
        <Link
          href={`/${slug}/vendas/${v.id}`}
          className="numero font-semibold text-marca underline-offset-2 hover:underline"
          aria-label={`Abrir ${palavras.aVenda} ${v.numero}`}
        >
          {v.numero}
        </Link>
      ),
    },
    ...(variasLojas
      ? [
          {
            chave: 'loja',
            titulo: 'Loja',
            largura: '8rem',
            celula: (v: (typeof vendas)[number]) => <span className="truncate text-tinta-2">{v.unidade}</span>,
          },
        ]
      : []),
    {
      chave: 'quando',
      titulo: 'Quando',
      largura: '8rem',
      celula: (v: (typeof vendas)[number]) => (
        <span className="numero whitespace-nowrap text-tinta-2">{quando(v.criadaEm)}</span>
      ),
    },
    {
      chave: 'cliente',
      titulo: palavras.Pessoa,
      celula: (v: (typeof vendas)[number]) => (
        <span className={v.cliente ? 'text-tinta' : 'whitespace-nowrap text-tinta-3'}>{v.cliente ?? 'sem cadastro'}</span>
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
      titulo: palavras.vendeu,
      celula: (v: (typeof vendas)[number]) => <span className="text-tinta-2">{v.vendedor ?? '—'}</span>,
    },
    {
      chave: 'total',
      titulo: 'Total',
      numero: true,
      largura: '7rem',
      // No cartão do celular, o total sobe para o lado do número da venda.
      destaque: true,
      celula: (v: (typeof vendas)[number]) =>
        v.situacao === 'CANCELADA' ? (
          <span className="flex items-center justify-end gap-2">
            <Situacao nivel="critico">{g('cancelada', 'cancelado')}</Situacao>
            <span className="numero text-tinta-3 line-through">{brl(v.total)}</span>
          </span>
        ) : v.devolvido > 0 ? (
          <span className="flex flex-col items-end">
            <span className="numero font-semibold text-tinta">{brl(v.total)}</span>
            <span className="numero text-xs text-atencao">− {brl(v.devolvido)} devolvido</span>
          </span>
        ) : (
          <span className="numero font-semibold text-tinta">{brl(v.total)}</span>
        ),
    },
    {
      // Reimprimir (e o carnê, se teve crediário) sem abrir a venda: "perdi o
      // cupom" é pedido de todo dia no balcão. Abre em outra aba, já
      // imprimindo, e a lista fica onde estava.
      chave: 'acoes',
      titulo: '',
      largura: '11rem',
      // Os ícones de apoio (reimprimir, carnê, trocar) com a dica ao passar o
      // mouse, e o "Abrir" em pílula no fim — sempre na mesma ordem, para a
      // mão aprender o lugar. Eram links de texto que quebravam linha.
      celula: (v: (typeof vendas)[number]) => {
        const valendo = v.situacao !== 'CANCELADA'
        return (
          <span className="flex justify-end">
            <AcoesDaLinha>
              {valendo && (
                <BotaoDaLinha
                  externo
                  href={`/${slug}/vendas/${v.id}/comprovante?imprimir=1`}
                  icone="imprimir"
                  rotulo="Reimprimir"
                  dica={`Reimprimir o comprovante ${palavras.daVenda} ${v.numero}`}
                />
              )}
              {valendo && v.formas.includes('CREDIARIO') && (
                <BotaoDaLinha
                  externo
                  href={`/${slug}/vendas/${v.id}/carne?imprimir=1`}
                  icone="carne"
                  rotulo="Carnê"
                  dica={`Reimprimir o carnê ${palavras.daVenda} ${v.numero}`}
                />
              )}
              {/* A troca numa tela só (troca/), já com esta compra aberta. */}
              {v.situacao === 'CONCLUIDA' && v.devolvido + 0.005 < v.total && pode(sessao, 'venda.criar') && (
                <BotaoDaLinha
                  href={`/${slug}/troca?venda=${v.id}`}
                  icone="trocar"
                  rotulo="Trocar"
                  dica={`Trocar peças ${palavras.daVenda} ${v.numero}`}
                />
              )}
              <BotaoDaLinha principal href={`/${slug}/vendas/${v.id}`} icone="abrir" rotulo="Abrir" dica={`Abrir ${palavras.aVenda} ${v.numero}`} />
            </AcoesDaLinha>
          </span>
        )
      },
    },
  ]
  const SO_NO_AVANCADO = ['itens', 'forma', 'quem']
  const colunas = simples ? todasAsColunas.filter((c) => !SO_NO_AVANCADO.includes(c.chave)) : todasAsColunas

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/vendas`}
      tema={tema}
      titulo={palavras.Vendas}
      acao={
        // Período antes da loja, como no Painel, no Caixa e na Auditoria: a
        // mesma chave no mesmo lugar em toda tela, senão a mão erra o clique.
        <span className="flex flex-wrap items-center justify-end gap-2">
          {veHistorico && <SeletorPeriodo atual={j.chave} />}
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
          {!simples && veHistorico && podeExportar(sessao, 'vendas') && (
            <a
              href={linkExportar}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
              title="Baixar em planilha: uma linha por item vendido, com os filtros desta tela"
            >
              Planilha
            </a>
          )}
        </span>
      }
    >
      {/* O número grande primeiro: é ele que a pessoa veio ver. */}
      <div className={veReceita ? 'grid gap-3 sm:grid-cols-3' : 'grid gap-3 sm:grid-cols-2'}>
        {veReceita ? (
          <>
            <Numero
              rotulo={`${palavras.Vendido} · ${j.rotulo.toLowerCase()}`}
              valor={brl(total)}
              detalhe={`${plural(resumo.concluidas, palavras.venda, palavras.vendas)}${palavras.foraDoTotal ? ` · ${palavras.foraDoTotal}` : ''}`}
              principal
            />
            <Numero rotulo={palavras.ticketMedio} valor={brl(ticket)} detalhe={`por ${palavras.venda}`} />
          </>
        ) : (
          <Numero
            rotulo={`${palavras.Contagem} · ${j.rotulo.toLowerCase()}`}
            valor={String(resumo.concluidas)}
            detalhe={resumo.concluidas === 1 ? g('concluída', 'concluído') : g('concluídas', 'concluídos')}
            principal
          />
        )}
        <Numero
          rotulo={g('Canceladas', 'Cancelados')}
          valor={String(resumo.canceladas)}
          detalhe={resumo.canceladas ? (veReceita ? brl(resumo.totalCanceladas) : 'no período') : g('nenhuma', 'nenhum')}
          nivel={resumo.canceladas > 0 ? 'atencao' : undefined}
        />
      </div>

      {/* O período desenhado: o dia a dia e como entrou o dinheiro. Para quem
          lê o faturamento (o balcão não vê número de dono) e só com mais de
          um dia — um dia só é o número grande, não um gráfico. */}
      {grafico && grafico.plano !== 'GRATIS' && grafico.porDia.some((d) => d.total > 0) && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Bloco titulo={`${palavras.Vendido} por dia`} detalhe={j.rotulo}>
            <Barras dados={grafico.porDia} titulo={`${palavras.Vendido} por dia`} />
          </Bloco>
          <Bloco titulo="Como receberam" detalhe="Por forma de pagamento">
            <Rosca fatias={grafico.porForma.map((f) => ({ rotulo: FORMA[f.forma] ?? f.forma, valor: f.total, detalhe: `${f.vendas}×` }))} />
          </Bloco>
        </div>
      )}

      {/* Busca e filtro no endereço. `q` aceita o número da venda, o nome do
          cliente, a peça, o código da etiqueta ou o valor ("189,90") — é o que
          a pessoa tem na mão quando a cliente volta para trocar (ver
          `ondeDasVendas`). */}
      <Busca
        valor={q}
        placeholder={`Número, nome ${palavras.daPessoa}, peça, código ou valor (189,90)`}
        rotulo={`Buscar ${palavras.venda}`}
        // Buscar não apaga os outros filtros: o formulário leva junto tudo o
        // que já estava escolhido no endereço.
        manter={{ periodo: j.chave, unidade: onde.unidadeId, situacao, vendedor: vendedorId, forma }}
        limparEm={link({ q: null })}
      />

      {/* Quem vendeu e como receberam: os dois recortes que a pergunta do dia
          usa ("o que a Maria vendeu no sábado", "quanto entrou no Pix"). */}
      {!veHistorico && (
        <p className="-mt-1 text-xs text-tinta-3">
          {q
            ? `Buscando nos últimos 30 dias.`
            : `Mostrando só as ${palavras.vendas} de hoje. Para achar outra, busque pelo número ou pelo nome ${palavras.daPessoa}.`}
        </p>
      )}

      {veHistorico && ((!simples && (vendedores.length > 1 || formasUsadas.length > 1)) || vendedorId || forma) && (
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          {((!simples && vendedores.length > 1) || vendedorId) && (
            <Fichas
              rotulo={`Quem ${palavras.vendeu.toLowerCase()}`}
              opcoes={[{ valor: null, rotulo: 'qualquer pessoa' }, ...vendedores.map(([id, nome]) => ({ valor: id, rotulo: nome }))]}
              atual={vendedorId}
              linkDe={(v) => link({ vendedor: v })}
            />
          )}
          {((!simples && formasUsadas.length > 1) || forma) && (
            <Fichas
              rotulo="Pagamento"
              opcoes={[{ valor: null, rotulo: 'qualquer' }, ...formasUsadas.map((f) => ({ valor: f, rotulo: FORMA[f] ?? f }))]}
              atual={forma}
              linkDe={(v) => link({ forma: v })}
            />
          )}
        </div>
      )}

      <Cartao
        titulo={q ? `Resultado de “${q}”` : plural(contadas, palavras.venda, palavras.vendas)}
        acao={
          <span className="flex gap-1 text-xs">
            {(
              [
                [null, g('todas', 'todos')],
                ['CONCLUIDA', g('concluídas', 'concluídos')],
                ['CANCELADA', g('canceladas', 'cancelados')],
              ] as [SituacaoVenda | null, string][]
            ).map(([valor, rotulo]) => (
              <Link
                key={rotulo}
                href={link({ situacao: valor })}
                aria-current={situacao === valor ? 'true' : undefined}
                className={
                  // O mesmo desenho das `Fichas` (ui/Busca.tsx): um só jeito
                  // de dizer "escolhido" nos filtros do sistema inteiro.
                  'rounded-full border px-3 py-1.5 font-semibold ' +
                  (situacao === valor
                    ? 'border-marca/40 bg-marca-suave text-marca'
                    : 'border-transparent text-tinta-2 hover:bg-superficie-2 hover:text-tinta')
                }
              >
                {rotulo}
              </Link>
            ))}
          </span>
        }
      >
        {vendas.length === 0 ? (
          <Vazio
            acao={
              temFiltro ? (
                // Nada com os filtros: o caminho é tirá-los, não vender.
                <Link
                  href={link({ q: null, situacao: null, vendedor: null, forma: null })}
                  className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
                >
                  Limpar filtros
                </Link>
              ) : (
                pode(sessao, 'venda.criar') && (
                  <Link href={`/${slug}/balcao`} className="botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta">
                    Abrir {palavras.oBalcao}
                  </Link>
                )
              )
            }
          >
            {q
              ? `${palavras.nenhumaVenda} com isso.`
              : temFiltro
                ? `${palavras.nenhumaVenda} com esses filtros ${j.naFrase}.`
                : `${palavras.nenhumaVenda} ${j.naFrase}.`}
          </Vazio>
        ) : (
          <>
            <Tabela colunas={colunas} linhas={fatia.itens} chave={(v) => v.id} />
            <Paginas p={fatia} linkDe={(n) => link({ pagina: String(n) })} rotulo={palavras.vendas} />
          </>
        )}
        {vendas.length >= 500 && (
          <p className="pt-3 text-xs text-tinta-3">
            Mostrando {g('as', 'os')} 500 mais recentes. Aperte o período ou use a busca.
          </p>
        )}
      </Cartao>
    </Estrutura>
  )
}
