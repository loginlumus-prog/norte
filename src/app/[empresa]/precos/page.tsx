import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { podeVerPlanos } from '@/servidor/permissao'
import { planoDaEmpresa } from '@/servidor/relatorios'
import { liberado } from '@/servidor/planos'
import {
  ALVO_MAX,
  ALVO_MIN,
  JANELA_VENDAS_DIAS,
  analisarCatalogo,
  analisarPreco,
  lerAlvo,
  ordenarPorUrgenciaDePreco,
  resumirPrecos,
  vendidos30,
  type AnalisePreco,
  type LinhaPreco,
} from '@/servidor/precificacao'
import { mostrar } from '@/servidor/dinheiro'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Situacao, Vazio } from '@/ui/base'
import { Numero, Secao, Tira } from '@/ui/painel'
import { Tabela, type Coluna } from '@/ui/Tabela'
import { Cadeado, Trancado } from '@/ui/Cadeado'
import type { Tema } from '@/ui/TrocaTema'
import { Alvo } from './Alvo'
import { Paginas } from '@/ui/Paginas'
import { fatiar, lerPagina } from '@/ui/paginacao'
import { enderecoCom } from '@/ui/Busca'

export const metadata: Metadata = { title: 'Preços' }

// A tela de preços.
//
// Ela responde uma pergunta só: "de tudo que eu vendo, o que está dando menos
// do que devia?" — e responde produto a produto, na ordem do prejuízo. Quem
// abre a tela vê primeiro o que perde dinheiro em cada venda, depois o que
// ganha menos que o alvo, depois o que ninguém sabe (sem custo), e por último
// o que está bem.
//
// ── ela NÃO muda preço ───────────────────────────────────────
// De propósito. Mudar preço é na ficha do produto, que tem a permissão certa
// e grava quem mudou e quando. Aqui é leitura e link: a pessoa vê o número,
// clica no nome, muda lá. Uma tela que lista 300 produtos com campo de preço
// em cada linha é onde o dedo escorrega e a loja vende a metade sem saber.
//
// ── o que cada plano abre ────────────────────────────────────
//   Grátis      tudo trancado, com amostra por trás
//   Balcão+     margem, markup e a comparação com o alvo
//   Assistente+ mais o preço sugerido para bater o alvo

/**
 * A amostra do plano Grátis. Dado inventado, e é isso que a tranca exige:
 * a forma inteira, sem nenhum número que o plano não pagou.
 */
const AMOSTRA: (Omit<LinhaPreco, 'analise'> & { saiu: number })[] = [
  { produtoId: 'amostra-1', nome: 'Meia cano alto', marca: '', categoria: 'Acessórios', custoCent: 900, precoCent: 800, saiu: 51 },
  { produtoId: 'amostra-2', nome: 'Camiseta canelada', marca: 'Básica', categoria: 'Blusas', custoCent: 2600, precoCent: 3990, saiu: 38 },
  { produtoId: 'amostra-3', nome: 'Calça jogger', marca: '', categoria: 'Calças', custoCent: 5800, precoCent: 8990, saiu: 12 },
  { produtoId: 'amostra-4', nome: 'Boné aba reta', marca: '', categoria: 'Acessórios', custoCent: null, precoCent: 5990, saiu: 7 },
  { produtoId: 'amostra-5', nome: 'Jaqueta corta-vento', marca: 'Norte', categoria: 'Casacos', custoCent: 12000, precoCent: 21990, saiu: 4 },
]

/** "59%", "12,5%" — porcentagem com vírgula, como o resto do sistema. */
const porcento = (v: number, casas = 0) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`

function Margem({ a }: { a: AnalisePreco }) {
  if (a.situacao === 'sem_custo') return <Situacao nivel="neutro">sem custo</Situacao>
  // Preço zero com custo: não há margem para calcular, mas há prejuízo.
  const pct = a.margemPct === null ? 'sem preço' : porcento(a.margemPct)
  // Cor E palavra em cada uma: 39% amarelo e 41% verde só pela cor seria
  // pedir para quem não distingue as duas adivinhar.
  if (a.situacao === 'abaixo_do_custo') return <Situacao nivel="critico">{pct} · prejuízo</Situacao>
  if (a.situacao === 'abaixo_do_alvo') return <Situacao nivel="atencao">{pct} · abaixo</Situacao>
  return <Situacao nivel="bom">{pct} · no alvo</Situacao>
}

export default async function Precos({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ alvo?: string; pagina?: string }>
}) {
  const { empresa: slug } = await params
  const { alvo: alvoPedido, pagina: paginaPedida } = (await searchParams) as { alvo?: unknown; pagina?: unknown }
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'produto.preco' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const alvo = lerAlvo(alvoPedido)

  // Uma chamada, fora de qualquer outra transação — `planoDaEmpresa` abre a
  // sua própria.
  const plano = await planoDaEmpresa(sessao)
  const temMargem = liberado(plano, 'precos.margem')
  const temSugestao = liberado(plano, 'precos.sugestao')

  // No Grátis nada do catálogo real é lido: a tranca mostra amostra, e ler o
  // dado de verdade para embaçar depois seria pagar a consulta à toa — e
  // deixar o número real a um "inspecionar elemento" de distância.
  const linhas: LinhaPreco[] = temMargem
    ? await analisarCatalogo(sessao, alvo)
    : ordenarPorUrgenciaDePreco(
        AMOSTRA.map(({ saiu: _saiu, ...a }) => ({
          ...a,
          analise: analisarPreco({ custoCent: a.custoCent, precoCent: a.precoCent, alvoPct: alvo }),
        })),
      )
  const saiu = temMargem ? await vendidos30(sessao) : new Map(AMOSTRA.map((a) => [a.produtoId, a.saiu]))

  const resumo = resumirPrecos(linhas)
  // Cem por página: a ordem já põe o que perde dinheiro primeiro, e o
  // catálogo inteiro numa tabela só pesava megabytes (ver ui/paginacao.ts).
  const fatia = fatiar(linhas, lerPagina(paginaPedida), 100)
  const linkDaPagina = (n: number) =>
    enderecoCom(`/${slug}/precos`, { alvo: typeof alvoPedido === 'string' ? alvoPedido : null }, { pagina: String(n) })

  const colunas: Coluna<LinhaPreco>[] = [
    {
      chave: 'produto',
      titulo: 'Produto',
      celula: (l) => (
        <span className="flex min-w-0 flex-col">
          <Link href={`/${slug}/produtos/${l.produtoId}`} className="truncate font-medium text-tinta hover:underline">
            {l.nome}
            {l.marca && <span className="ml-1.5 text-xs font-normal text-tinta-3">{l.marca}</span>}
          </Link>
          {l.categoria && <span className="text-xs text-tinta-3">{l.categoria}</span>}
        </span>
      ),
    },
    {
      chave: 'custo',
      titulo: 'Custo',
      numero: true,
      largura: '7rem',
      celula: (l) => (l.custoCent === null ? <span className="text-tinta-3">—</span> : mostrar(l.custoCent)),
    },
    { chave: 'preco', titulo: 'Preço', numero: true, largura: '7rem', celula: (l) => mostrar(l.precoCent) },
    { chave: 'margem', titulo: 'Margem bruta', numero: true, largura: '9rem', celula: (l) => <Margem a={l.analise} /> },
    {
      chave: 'markup',
      titulo: 'Markup',
      numero: true,
      largura: '6rem',
      celula: (l) =>
        l.analise.markupPct === null ? (
          <span className="text-tinta-3">—</span>
        ) : (
          <span className="text-tinta-2">{porcento(l.analise.markupPct)}</span>
        ),
    },
    {
      chave: 'saiu',
      titulo: `Saiu ${JANELA_VENDAS_DIAS}d`,
      numero: true,
      largura: '6rem',
      celula: (l) => {
        const q = saiu.get(l.produtoId) ?? 0
        return <span className={q > 0 ? 'text-tinta' : 'text-tinta-3'}>{q.toLocaleString('pt-BR')}</span>
      },
    },
    {
      chave: 'sugerido',
      titulo: 'Para bater o alvo',
      numero: true,
      largura: '10rem',
      celula: (l) => {
        // A coluna existe em todo plano — trancada, ela mostra que existe.
        // O cadeado com o nome do plano fica no cabeçalho da seção, porque
        // o título de coluna da Tabela é texto.
        if (!temSugestao || l.analise.sugeridoCent === null || l.analise.diferencaCent === null) {
          return <span className="text-tinta-3">—</span>
        }
        // Só sugere para o que está ABAIXO do alvo. Para o que já bate, o
        // preço "do alvo" é MENOR que o de hoje, e a coluna mostrava
        // "R$ 1,12 − R$ 0,88" num item de R$ 2,00 — lido como conselho de
        // baixar o preço, quando a margem de hoje é melhor que a pedida.
        if (l.analise.situacao === 'no_alvo') return <span className="text-xs text-tinta-3">já bate</span>
        const d = l.analise.diferencaCent
        return (
          <span className="flex flex-col items-end">
            <span className="text-tinta">subir para {mostrar(l.analise.sugeridoCent)}</span>
            {d > 0 && <span className="text-xs text-atencao">+ {mostrar(d)} no preço</span>}
          </span>
        )
      },
    },
  ]

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/precos`}
      tema={tema}
      titulo="Preços"
      acao={<Alvo atual={alvo} min={ALVO_MIN} max={ALVO_MAX} />}
    >
      <p className="text-sm text-tinta-2">
        Margem é o que sobra do preço; markup é o quanto se põe em cima do custo. O alvo é
        de margem, porque é ela que paga aluguel, gente e imposto.
      </p>

      <Trancado
        chave="precos.margem"
        plano={plano}
        slug={slug}
        verPlanos={podeVerPlanos(sessao)}
        resumo="Cada produto com margem, markup e a distância até o alvo — para acertar o preço antes de o mês fechar no vermelho."
      >
        <div className="flex flex-col gap-6">
          <Tira
            itens={[
              { rotulo: 'abaixo do custo', quantos: resumo.abaixoDoCusto, nivel: 'critico' },
              { rotulo: 'abaixo do alvo', quantos: resumo.abaixoDoAlvo, nivel: 'atencao' },
              { rotulo: 'sem custo', quantos: resumo.semCusto, nivel: 'neutro' },
              { rotulo: 'no alvo', quantos: resumo.noAlvo, nivel: 'bom' },
            ]}
          />

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Numero
              principal
              rotulo="Margem bruta"
              valor={resumo.margemMedia === null ? '—' : porcento(resumo.margemMedia, 1)}
              detalhe={
                resumo.margemMedia === null
                  ? 'nenhum produto com custo preenchido'
                  : `média ponderada pelo preço da tabela · alvo ${alvo}%`
              }
            />
            <Numero
              rotulo="Abaixo do alvo"
              valor={String(resumo.abaixoDoAlvo)}
              detalhe={`com margem menor que ${alvo}%`}
              nivel={resumo.abaixoDoAlvo > 0 ? 'atencao' : undefined}
            />
            <Numero
              rotulo="Abaixo do custo"
              valor={String(resumo.abaixoDoCusto)}
              detalhe={`${resumo.abaixoDoCusto === 1 ? 'perde' : 'perdem'} dinheiro em cada venda`}
              nivel={resumo.abaixoDoCusto > 0 ? 'critico' : undefined}
            />
            <Numero
              rotulo="Sem custo"
              valor={String(resumo.semCusto)}
              detalhe="sem custo na ficha, sem margem para calcular"
            />
          </div>

          <Secao
            titulo="Produto a produto"
            resumo="Do que perde dinheiro para o que está bem. Dentro de cada grupo, a maior diferença primeiro."
            acao={
              temSugestao ? undefined : (
                <span className="flex items-center gap-2 text-xs text-tinta-3">
                  preço sugerido
                  <Cadeado chave="precos.sugestao" slug={slug} verPlanos={podeVerPlanos(sessao)} />
                </span>
              )
            }
          >
            {linhas.length === 0 ? (
              <Vazio
                acao={
                  <Link href={`/${slug}/produtos/novo`} className="botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta">
                    Cadastrar um produto
                  </Link>
                }
              >
                Nenhum produto ativo. Cadastre o primeiro em Produtos e ele aparece aqui com a
                margem calculada.
              </Vazio>
            ) : (
              <>
                <Tabela colunas={colunas} linhas={fatia.itens} chave={(l) => l.produtoId} />
                <Paginas p={fatia} linkDe={linkDaPagina} rotulo="produtos" />
              </>
            )}
            <p className="text-xs text-tinta-3">
              Preço se muda na ficha do produto: clique no nome, ou vá em{' '}
              <Link href={`/${slug}/produtos`} className="font-medium text-marca underline-offset-2 hover:underline">
                Produtos
              </Link>
              .
            </p>
          </Secao>
        </div>
      </Trancado>
    </Estrutura>
  )
}
