import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { unidadesVisiveis } from '@/servidor/unidade'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { pode, podeVerPlanos } from '@/servidor/permissao'
import {
  compararLojas,
  curvaAbc,
  dinheiroParado,
  escala,
  PARADO_DIAS,
  planoDaEmpresa,
  temAnaliseAvancada,
} from '@/servidor/relatorios'
import { PLANOS } from '@/servidor/planos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Vazio } from '@/ui/base'
import { SeletorPeriodo } from '@/ui/Periodo'
import { Numero, Secao, Tira, brl } from '@/ui/painel'
import { Tabela, type Coluna } from '@/ui/Tabela'
import { BarrasH } from '@/ui/Graficos'
import type { Tema } from '@/ui/TrocaTema'
import { palavra, plural, quantidade } from '@/ui/texto'

// A análise.
//
// Três leituras que o painel não dá, e que só fazem pergunta depois que a loja
// já rodou alguns meses: qual loja puxa, o que sustenta a casa, e quem estava
// no balcão quando o dinheiro entrou.
//
// ── por que ela NÃO tem seletor de unidade ───────────────────
// Porque comparar lojas com uma loja escondida é o jeito mais rápido de tirar
// conclusão errada. A tela abre com tudo que a pessoa pode ver, sempre. O
// recorte que existe aqui é o de TEMPO, que é o que muda a pergunta.
//
// ── e por que o "parado" não segue o período ─────────────────
// Duas coisas diferentes usam a palavra parado. Na comparação entre lojas,
// parado é "não saiu no período que estou lendo" — é um recorte. Na lista de
// dinheiro parado, é "não sai há tanto tempo" — é uma propriedade do produto.
// Misturar os dois faria a lista dizer que a loja inteira está parada quando
// alguém escolhesse ver 7 dias.

const dataHora = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d)

const PARADO_LIMITE = 25
const ABC_LIMITE = 60

export default async function Analise({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ periodo?: string }>
}) {
  const { empresa: slug } = await params
  const { periodo: pedido } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'relatorio.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const j = janela(lerPeriodo(pedido))
  const plano = await planoDaEmpresa(sessao)
  const liberado = temAnaliseAvancada(plano)
  const unidades = await unidadesVisiveis(sessao, 'relatorio.ver')
  const ids = unidades.map((u) => u.id)

  // A escala pede `caixa.ver` além de `relatorio.ver` — o contador lê o
  // resultado da empresa e não precisa saber quem abriu a gaveta.
  const verEscala = pode(sessao, 'caixa.ver')
  // A ficha do produto exige editar produto. O contador e o financeiro leem
  // a análise e não abrem a ficha: para eles o nome vai sem link.
  const abreFicha = pode(sessao, 'produto.editar')

  const lojas = liberado ? await compararLojas(sessao, ids, j.de, j.ate) : []
  const abc = liberado ? await curvaAbc(sessao, ids, j.de, j.ate) : []
  const parado = liberado ? await dinheiroParado(sessao, ids) : []
  const turnos = liberado && verEscala ? await escala(sessao, ids, j.de, j.ate) : []

  const colunasLojas: Coluna<(typeof lojas)[number]>[] = [
    { chave: 'nome', titulo: 'Loja', celula: (l) => <span className="font-medium text-tinta">{l.nome}</span> },
    { chave: 'vendas', titulo: 'Vendas', numero: true, celula: (l) => l.vendas },
    { chave: 'receita', titulo: 'Entrou', numero: true, celula: (l) => brl(l.receita) },
    { chave: 'margem', titulo: 'Margem', numero: true, celula: (l) => brl(l.margem) },
    {
      chave: 'pct',
      titulo: '%',
      numero: true,
      celula: (l) =>
        l.margemPct === null ? (
          <span className="text-tinta-3">—</span>
        ) : (
          <Situacao nivel={l.margemPct >= 40 ? 'bom' : l.margemPct >= 25 ? 'atencao' : 'critico'}>
            {l.margemPct.toFixed(0)}%
          </Situacao>
        ),
    },
    { chave: 'ticket', titulo: 'Ticket', numero: true, celula: (l) => brl(l.ticket) },
    {
      chave: 'parado',
      titulo: 'Sem saída',
      numero: true,
      celula: (l) => (
        <span className={l.parado > 0 ? 'text-atencao' : 'text-tinta-3'}>{brl(l.parado)}</span>
      ),
    },
  ]

  const colunasAbc: Coluna<(typeof abc)[number]>[] = [
    {
      chave: 'classe',
      titulo: 'Classe',
      largura: '4.5rem',
      celula: (l) => (
        <Situacao nivel={l.classe === 'A' ? 'bom' : l.classe === 'B' ? 'atencao' : 'neutro'}>
          {l.classe}
        </Situacao>
      ),
    },
    {
      chave: 'nome',
      titulo: 'Produto',
      celula: (l) => <NomeDoProduto slug={slug} ficha={abreFicha} produtoId={l.produtoId} nome={l.nome} marca={l.marca} />,
    },
    // Com a medida: o sorvete sai em quilo e a camiseta em peça, e a coluna
    // somava os dois como se fossem a mesma coisa.
    { chave: 'qtd', titulo: 'Saiu', numero: true, celula: (l) => quantidade(l.quantidade, l.medida) },
    { chave: 'receita', titulo: 'Entrou', numero: true, celula: (l) => brl(l.receita) },
    { chave: 'margem', titulo: 'Margem', numero: true, celula: (l) => brl(l.margem) },
    {
      chave: 'fatia',
      titulo: 'Fatia',
      numero: true,
      celula: (l) => `${l.fatiaPct.toFixed(1)}%`,
    },
    {
      chave: 'acum',
      titulo: 'Acumulado',
      numero: true,
      celula: (l) => <span className="text-tinta-3">{l.acumuladoPct.toFixed(0)}%</span>,
    },
  ]

  const colunasParado: Coluna<(typeof parado)[number]>[] = [
    {
      chave: 'nome',
      titulo: 'Produto',
      celula: (l) => <NomeDoProduto slug={slug} ficha={abreFicha} produtoId={l.produtoId} nome={l.nome} marca={l.marca} />,
    },
    { chave: 'qtd', titulo: 'Tem', numero: true, celula: (l) => quantidade(l.quantidade, l.medida) },
    { chave: 'valor', titulo: 'Custou', numero: true, celula: (l) => brl(l.valor) },
    {
      chave: 'dias',
      titulo: 'Sem vender há',
      numero: true,
      celula: (l) =>
        l.diasParado === null ? (
          <Situacao nivel="critico">nunca vendeu</Situacao>
        ) : (
          <Situacao nivel={l.diasParado >= 90 ? 'critico' : l.diasParado >= 30 ? 'atencao' : 'neutro'}>
            {l.diasParado} dias
          </Situacao>
        ),
    },
  ]

  const colunasTurno: Coluna<(typeof turnos)[number]>[] = [
    { chave: 'quem', titulo: 'Quem abriu', celula: (t) => <span className="font-medium text-tinta">{t.quem}</span> },
    { chave: 'unidade', titulo: 'Loja', celula: (t) => t.unidade },
    { chave: 'abriu', titulo: 'Abriu', celula: (t) => dataHora(t.abriu) },
    {
      chave: 'horas',
      titulo: 'Ficou',
      numero: true,
      celula: (t) => (t.horas === null ? <Situacao nivel="atencao">aberto</Situacao> : `${t.horas.toFixed(1)} h`),
    },
    { chave: 'vendas', titulo: 'Vendas', numero: true, celula: (t) => t.vendas },
    { chave: 'total', titulo: 'Saiu no turno', numero: true, celula: (t) => brl(t.total) },
    {
      chave: 'dif',
      titulo: 'Faltou/sobrou',
      numero: true,
      celula: (t) =>
        t.diferenca === null ? (
          <span className="text-tinta-3">—</span>
        ) : t.diferenca === 0 ? (
          <Situacao nivel="bom">bateu</Situacao>
        ) : (
          <Situacao nivel={Math.abs(t.diferenca) >= 20 ? 'critico' : 'atencao'}>
            {t.diferenca > 0 ? '+' : ''}
            {brl(t.diferenca)}
          </Situacao>
        ),
    },
  ]

  const receitaTotal = lojas.reduce((s, l) => s + l.receita, 0)
  const margemTotal = lojas.reduce((s, l) => s + l.margem, 0)
  const paradoTotal = parado.reduce((s, l) => s + l.valor, 0)
  const paradoVelho = parado.filter((l) => l.diasParado === null || l.diasParado >= 90)
  const naClasse = (c: 'A' | 'B' | 'C') => abc.filter((l) => l.classe === c).length

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/analise`}
      tema={tema}
      titulo="Análise"
      acao={liberado ? <SeletorPeriodo atual={j.chave} /> : undefined}
    >
      {!liberado ? (
        <Cartao>
          <div className="flex flex-col gap-3 py-6 text-center">
            <p className="text-base font-semibold text-tinta">
              A análise é do plano {PLANOS.REDE.titulo} para cima.
            </p>
            <p className="mx-auto max-w-prose text-sm text-tinta-2">
              São três leituras que o painel não dá: as suas lojas lado a lado com venda, margem
              e estoque parado; a curva ABC, que separa o que sustenta a casa do que só ocupa
              prateleira; e a escala, que mostra quem abriu o caixa, por quanto tempo, e quanto
              saiu naquele turno.
            </p>
            <p className="text-sm text-tinta-3">
              Seu plano hoje é {PLANOS[plano].artigo} {PLANOS[plano].titulo}.
            </p>
            {podeVerPlanos(sessao) ? (
              <Link
                href={`/${slug}/assinatura`}
                className="botao-marca mx-auto rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta"
              >
                Ver planos
              </Link>
            ) : (
              <p className="text-xs text-tinta-3">Quem responde pela empresa troca de plano em Assinatura.</p>
            )}
          </div>
        </Cartao>
      ) : (
        <>
          <Tira
            itens={[
              { rotulo: `${palavra(naClasse('A'), 'produto', 'produtos')} classe A`, quantos: naClasse('A'), nivel: 'bom' },
              { rotulo: 'classe B', quantos: naClasse('B'), nivel: 'atencao' },
              { rotulo: 'classe C', quantos: naClasse('C'), nivel: 'neutro' },
              { rotulo: `${palavra(paradoVelho.length, 'parado', 'parados')} há 90+ dias`, quantos: paradoVelho.length, nivel: 'critico' },
            ]}
          />

          {/* ── entre as lojas ── */}
          <Secao
            titulo={`Entre as lojas · ${j.rotulo.toLowerCase()}`}
            resumo="A mesma régua para todas: o que entrou, o que sobrou depois do custo, e quanto de dinheiro está parado na prateleira de cada uma."
          >
            {unidades.length < 2 ? (
              <Cartao>
                <p className="py-6 text-center text-sm text-tinta-2">
                  Você tem uma loja só, então não há o que comparar ainda. Quando abrir a segunda,
                  as duas aparecem aqui lado a lado.
                </p>
              </Cartao>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Numero principal rotulo="Entrou no período" valor={brl(receitaTotal)} detalhe={`${lojas.reduce((s, l) => s + l.vendas, 0)} vendas somando as lojas`} />
                  <Numero
                    rotulo="Margem somada"
                    valor={brl(margemTotal)}
                    detalhe={receitaTotal > 0 ? `${((margemTotal / receitaTotal) * 100).toFixed(0)}% do que entrou` : 'sem venda no período'}
                    nivel="bom"
                  />
                  <Numero
                    rotulo="Sem saída no período"
                    valor={brl(lojas.reduce((s, l) => s + l.parado, 0))}
                    detalhe="custo do que não vendeu nenhuma vez no recorte de cima"
                    nivel="atencao"
                  />
                </div>
                <Cartao caixa titulo="Quem vendeu mais">
                  <BarrasH
                    itens={lojas
                      .slice()
                      .sort((a, b) => b.receita - a.receita)
                      .map((l) => ({
                        rotulo: l.nome,
                        valor: l.receita,
                        detalhe: `${l.vendas} vendas · margem ${l.margemPct === null ? '—' : `${l.margemPct.toFixed(0)}%`}`,
                      }))}
                  />
                </Cartao>
                <Tabela
                  colunas={colunasLojas}
                  linhas={lojas}
                  chave={(l) => l.unidadeId}
                  vazio="Nenhuma loja com movimento no período."
                />
              </>
            )}
          </Secao>

          {/* ── curva ABC ── */}
          <Secao
            titulo={`Curva ABC · ${j.rotulo.toLowerCase()}`}
            resumo="Os produtos ordenados pelo que trouxeram. A é o que forma os primeiros 80% do faturamento e nunca pode faltar. C é a cauda: cada um sozinho não paga a prateleira que ocupa."
          >
            {abc.length === 0 ? (
              <Vazio>
                Nenhuma venda de catálogo no período. A curva ignora item avulso de propósito:
                ele não tem produto e não se recompra.
              </Vazio>
            ) : (
              <Tabela
                colunas={colunasAbc}
                linhas={abc.slice(0, ABC_LIMITE)}
                chave={(l) => l.produtoId}
              />
            )}
            {abc.length > ABC_LIMITE && (
              <p className="text-xs text-tinta-3">
                Mostrando os {ABC_LIMITE} primeiros de {abc.length} produtos.
              </p>
            )}
          </Secao>

          {/* ── dinheiro parado ── */}
          <Secao
            titulo="Dinheiro parado"
            resumo={`Peças com estoque que não vendem há ${PARADO_DIAS} dias ou mais. Aqui o tempo não segue o filtro de cima de propósito: parado é uma característica do produto, não do recorte que você escolheu para ler.`}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Numero
                rotulo={`Parado há ${PARADO_DIAS}+ dias`}
                valor={brl(paradoTotal)}
                detalhe="o que a loja pagou pelo que não gira há um mês"
                nivel={paradoTotal > 0 ? 'atencao' : undefined}
              />
              <Numero
                rotulo="Sem vender há 90+ dias"
                valor={brl(paradoVelho.reduce((s, l) => s + l.valor, 0))}
                detalhe={`${plural(paradoVelho.length, 'produto', 'produtos')} — candidatos a promoção`}
                nivel={paradoVelho.length > 0 ? 'critico' : undefined}
              />
            </div>
            {parado.length === 0 ? (
              <Vazio>Nada parado: todo produto com estoque girou no último mês.</Vazio>
            ) : (
              <Tabela
                colunas={colunasParado}
                linhas={parado.slice(0, PARADO_LIMITE)}
                chave={(l) => l.produtoId}
              />
            )}
          </Secao>

          {/* ── turnos de caixa ──
              Não é "presença": ponto de quem não abre caixa não existe aqui
              (os dias em que cada um entrou estão no Desempenho, em Equipe). */}
          {verEscala && (
            <Secao
              titulo={`Turnos de caixa · ${j.rotulo.toLowerCase()}`}
              resumo="Cada turno de caixa: quem abriu, quanto tempo ficou, quanto saiu naquele turno e o que faltou ou sobrou na gaveta no fechamento."
            >
              {turnos.length === 0 ? (
                <Vazio>Nenhum caixa aberto no período.</Vazio>
              ) : (
                <Tabela colunas={colunasTurno} linhas={turnos} chave={(t) => t.caixaId} />
              )}
            </Secao>
          )}
        </>
      )}
    </Estrutura>
  )
}

/** O nome do produto: link para a ficha só para quem abre a ficha. */
function NomeDoProduto(p: { slug: string; ficha: boolean; produtoId: string; nome: string; marca: string }) {
  const conteudo = (
    <>
      {p.nome}
      {p.marca && <span className="ml-1.5 text-xs font-normal text-tinta-3">{p.marca}</span>}
    </>
  )
  return p.ficha ? (
    <Link href={`/${p.slug}/produtos/${p.produtoId}`} className="font-medium text-tinta hover:underline">
      {conteudo}
    </Link>
  ) : (
    <span className="font-medium text-tinta">{conteudo}</span>
  )
}
