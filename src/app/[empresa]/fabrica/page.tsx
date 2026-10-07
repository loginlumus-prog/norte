import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { moduloLigado } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { diaEmSP } from '@/servidor/dia'
import {
  catalogoDaFabrica,
  listarOrdens,
  listarPedidos,
  listarReceitas,
  unidadesDaFabrica,
  type PedidoNaTela,
} from '@/servidor/fabrica'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Fichas, enderecoCom } from '@/ui/Busca'
import { Aviso, Cartao } from '@/ui/base'
import { Secao, Tira, brl } from '@/ui/painel'
import { BotaoDaLinha } from '@/ui/premium'
import { quantidade } from '@/ui/texto'
import type { Tema } from '@/ui/TrocaTema'
import { NovaOrdem } from './NovaOrdem'
import { OrdensAbertas } from './OrdensAbertas'
import { FichasTecnicas } from './FichasTecnicas'
import { MandarPedido } from './MandarPedido'
import { CabecalhoDoPedido, ItensDoPedido } from './Pedido'
import { FabricaDesligada } from './Desligada'
import { diaBR, quando, sigla } from './formato'

export const metadata: Metadata = { title: 'Fábrica' }

// A fábrica: a unidade que faz o que as lojas vendem.
//
// Três abas, na ordem do dia de quem trabalha lá:
//   · PRODUÇÃO — o que está no fogo (ordens abertas) e o que saiu (encerradas,
//     com o lote e a etiqueta). É a aba que abre: é o que pede alguém agora;
//   · FICHAS TÉCNICAS — o que entra numa batelada e quanto ela rende. Feita
//     uma vez, é o que dá o previsto da ordem e o custo de cada picolé;
//   · PEDIDOS DAS LOJAS — o que as lojas pediram, para separar e mandar.
//
// A loja pede pela outra tela (/fabrica/pedir): quem está no balcão da loja
// não precisa ver a produção, e quem está na fábrica não precisa do catálogo
// de cada loja.

type Aba = 'producao' | 'fichas' | 'pedidos'
const ABAS: Record<string, Aba> = { fichas: 'fichas', pedidos: 'pedidos' }

export default async function TelaFabrica({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ aba?: string | string[] }>
}) {
  const { empresa: slug } = await params
  const q = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'fabrica.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  // O item aceso é o da aba (o menu da fábrica tem uma entrada por aba).
  const abaPedida = typeof q.aba === 'string' && ABAS[q.aba] ? q.aba : null
  const moldura = {
    empresa,
    sessao,
    itens: MENU(slug),
    ativo: `/${slug}/fabrica${abaPedida ? `?aba=${abaPedida}` : ''}`,
    tema,
    titulo: abaPedida === 'fichas' ? 'Fichas técnicas' : abaPedida === 'pedidos' ? 'Pedidos das lojas' : 'Produção',
  }

  if (!moduloLigado(empresa, 'fabrica')) {
    return (
      <Estrutura {...moldura}>
        <FabricaDesligada slug={slug} podeLigar={pode(sessao, 'empresa.configurar')} />
      </Estrutura>
    )
  }

  const aba: Aba = (typeof q.aba === 'string' && ABAS[q.aba]) || 'producao'
  const link = (v: Aba | null) => enderecoCom(`/${slug}/fabrica`, {}, { aba: v && v !== 'producao' ? v : null })

  // Uma consulta de cada vez: cada uma abre a própria transação, e a regra da
  // casa é não paralelizar o que fala com o banco.
  const unidades = await unidadesDaFabrica(sessao)
  const fabricas = unidades.filter((u) => u.ehFabrica)
  const fabricasQuePode = fabricas.filter((f) => pode(sessao, 'estoque.ajustar', f.id))
  const lojasQuePedem = unidades.filter((u) => !u.ehFabrica && pode(sessao, 'fabrica.pedir', u.id))
  const abertas = await listarOrdens(sessao, { situacao: 'ABERTA', limite: 100 })
  const pedidosAbertos = await listarPedidos(sessao, { abertos: true, limite: 100 })
  const esperando = pedidosAbertos.filter((p) => p.situacao === 'ABERTO')
  const verFichas = pode(sessao, 'produto.ver')
  const verCusto = pode(sessao, 'produto.preco') || pode(sessao, 'financeiro.ver')
  const hoje = diaEmSP()

  return (
    <Estrutura
      {...moldura}
      acao={
        lojasQuePedem.length > 0 ? (
          <Link
            href={`/${slug}/fabrica/pedir`}
            className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
            title="A tela da loja: pedir à fábrica e conferir o que chegou"
          >
            Pedir pela loja
          </Link>
        ) : undefined
      }
    >
      {fabricas.length === 0 && (
        <Aviso nivel="atencao">
          Nenhuma unidade está marcada como fábrica.{' '}
          {pode(sessao, 'empresa.configurar') ? (
            <>
              Em{' '}
              <Link href={`/${slug}/lojas`} className="font-semibold underline underline-offset-2">
                Lojas
              </Link>
              , abra a unidade onde se produz, clique em Editar e marque &ldquo;É fábrica&rdquo;.
            </>
          ) : (
            'Quem configura a empresa marca a fábrica em Lojas.'
          )}{' '}
          As fichas técnicas já dá para montar.
        </Aviso>
      )}

      <Tira
        itens={[
          { rotulo: 'ordens em produção', um: 'ordem em produção', quantos: abertas.length, nivel: 'atencao' },
          { rotulo: 'pedidos esperando a fábrica', um: 'pedido esperando a fábrica', quantos: esperando.length, nivel: 'critico' },
          {
            rotulo: 'pedidos a caminho das lojas',
            um: 'pedido a caminho da loja',
            quantos: pedidosAbertos.length - esperando.length,
            nivel: 'neutro',
          },
        ]}
      />

      <Fichas<Aba>
        opcoes={[
          { valor: null, rotulo: 'Produção', quantos: abertas.length || undefined },
          ...(verFichas ? [{ valor: 'fichas' as const, rotulo: 'Fichas técnicas' }] : []),
          { valor: 'pedidos', rotulo: 'Pedidos das lojas', quantos: esperando.length || undefined },
        ]}
        atual={aba === 'producao' ? null : aba}
        linkDe={link}
      />

      {aba === 'producao' && (
        <Producao
          slug={slug}
          abertas={abertas}
          fabricasQuePode={fabricasQuePode}
          verFichas={verFichas}
          verCusto={verCusto}
          hoje={hoje}
          sessao={sessao}
        />
      )}
      {aba === 'fichas' &&
        (verFichas ? (
          <FichasTecnicas
            slug={slug}
            receitas={await listarReceitas(sessao)}
            catalogo={await catalogoDaFabrica(sessao)}
            podeEditar={pode(sessao, 'produto.editar')}
            verCusto={verCusto}
          />
        ) : (
          <Aviso nivel="neutro">As fichas técnicas são de quem vê os produtos.</Aviso>
        ))}
      {aba === 'pedidos' && <PedidosDasLojas slug={slug} abertos={pedidosAbertos} recentes={await listarPedidos(sessao, { limite: 30 })} sessao={sessao} />}
    </Estrutura>
  )
}

async function Producao({
  slug,
  abertas,
  fabricasQuePode,
  verFichas,
  verCusto,
  hoje,
  sessao,
}: {
  slug: string
  abertas: Awaited<ReturnType<typeof listarOrdens>>
  fabricasQuePode: { id: string; nome: string }[]
  verFichas: boolean
  verCusto: boolean
  hoje: string
  sessao: Parameters<typeof listarOrdens>[0]
}) {
  const catalogo = await catalogoDaFabrica(sessao)
  const receitas = verFichas ? await listarReceitas(sessao) : []
  const encerradas = await listarOrdens(sessao, { situacao: 'ENCERRADA', limite: 20 })
  // Os prontos (não material de uso), os que têm ficha primeiro.
  const prontos = catalogo.filter((i) => !i.usoInterno).sort((a, b) => Number(b.temReceita) - Number(a.temReceita))
  const rendimentos = Object.fromEntries(receitas.map((r) => [r.variacaoId, r.rendimento]))
  const validadeDias = Object.fromEntries(receitas.filter((r) => r.validadeDias).map((r) => [r.variacaoId, r.validadeDias!]))
  // Encerrar e cancelar é de quem mexe no estoque DA FÁBRICA daquela ordem.
  const podeEm = abertas.filter((o) => pode(sessao, 'estoque.ajustar', o.unidadeId)).map((o) => o.id)

  return (
    <div className="flex flex-col gap-8">
      {fabricasQuePode.length > 0 && (
        <NovaOrdem slug={slug} fabricas={fabricasQuePode} produtos={prontos} rendimentos={rendimentos} />
      )}

      <Secao titulo="Em produção" resumo="Ao encerrar, o que foi usado sai do estoque da fábrica e o que saiu entra, com lote e validade.">
        <OrdensAbertas slug={slug} ordens={abertas} podeEm={podeEm} validadeDias={validadeDias} hoje={hoje} verCusto={verCusto} />
      </Secao>

      <Secao titulo="Últimas produções">
        {encerradas.length === 0 ? (
          <p className="text-sm text-tinta-3">Nenhuma produção encerrada ainda.</p>
        ) : (
          // `empilha`: no celular cada produção vira um cartão (globals.css),
          // em vez de esconder o lote e as etiquetas atrás da rolagem.
          <div className="empilha overflow-x-auto rounded-norte border border-borda bg-superficie">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="border-b border-borda bg-superficie-2 text-left text-xs text-tinta-3">
                <tr>
                  <th className="px-3 py-2 font-medium">OP</th>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 text-right font-medium">Saiu</th>
                  <th className="px-3 py-2 font-medium">Lote</th>
                  <th className="px-3 py-2 font-medium">Validade</th>
                  {verCusto && <th className="px-3 py-2 text-right font-medium">Custo</th>}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borda-suave">
                {encerradas.map((o) => (
                  <tr key={o.id}>
                    <td data-rotulo="OP" className="px-3 py-2 font-mono text-xs text-tinta-3">{o.numero}</td>
                    <td data-titulo className="px-3 py-2 text-tinta">
                      {o.produto}
                      <span className="block text-xs text-tinta-3">
                        {o.encerradaEm ? `${quando(o.encerradaEm)} · ` : ''}
                        {o.quem}
                      </span>
                    </td>
                    <td data-destaque className="numero px-3 py-2 text-right text-tinta">
                      {o.produzida != null ? quantidade(o.produzida, o.medida) : '—'}
                      {o.produzida != null && o.produzida < o.prevista && (
                        <span className="block text-xs text-tinta-3">previsto {quantidade(o.prevista, o.medida)}</span>
                      )}
                    </td>
                    <td data-rotulo="Lote" className="px-3 py-2 font-mono text-xs whitespace-nowrap text-tinta">{o.lote}</td>
                    <td data-rotulo="Validade" className="px-3 py-2 whitespace-nowrap text-tinta-2">{diaBR(o.validade)}</td>
                    {verCusto && (
                      <td data-rotulo="Custo" className="numero px-3 py-2 text-right text-tinta">
                        {o.custoUnitario != null ? (
                          <>
                            {brl(o.custoUnitario)}
                            <span className="text-xs text-tinta-3">/{sigla(o.medida)}</span>
                          </>
                        ) : (
                          <span className="text-xs text-tinta-3" title="Sem ficha técnica, ou faltou o custo de algum insumo">
                            —
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <BotaoDaLinha
                        comRotulo
                        href={`/${slug}/fabrica/ordens/${o.id}/etiqueta`}
                        icone="etiqueta"
                        rotulo="Etiquetas"
                        dica={`Imprimir as etiquetas do lote ${o.lote}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </div>
  )
}

function PedidosDasLojas({
  slug,
  abertos,
  recentes,
  sessao,
}: {
  slug: string
  abertos: PedidoNaTela[]
  recentes: PedidoNaTela[]
  sessao: Parameters<typeof listarOrdens>[0]
}) {
  const esperando = abertos.filter((p) => p.situacao === 'ABERTO')
  const aCaminho = abertos.filter((p) => p.situacao === 'ENVIADO')
  const jaListados = new Set(abertos.map((p) => p.id))
  const fechados = recentes.filter((p) => !jaListados.has(p.id))

  return (
    <div className="flex flex-col gap-8">
      <Secao titulo="Para separar" resumo="O que as lojas pediram. Confira com o saldo da fábrica, ajuste o que não vai dar e mande.">
        {esperando.length === 0 ? (
          <p className="text-sm text-tinta-3">Nenhum pedido esperando. Quando uma loja pedir, aparece aqui.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {esperando.map((p) => (
              <li key={p.id}>
                <Cartao caixa>
                  <div className="flex flex-col gap-3">
                    <CabecalhoDoPedido p={p} />
                    {pode(sessao, 'estoque.ajustar', p.fabricaId) ? (
                      <MandarPedido slug={slug} pedido={p} />
                    ) : (
                      <>
                        <ItensDoPedido p={p} />
                        <p className="text-xs text-tinta-3">Quem mexe no estoque de {p.fabrica} é quem manda.</p>
                      </>
                    )}
                  </div>
                </Cartao>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {aCaminho.length > 0 && (
        <Secao titulo="A caminho" resumo="Já saíram da fábrica. A loja confere quando chegar.">
          <ul className="flex flex-col gap-4">
            {aCaminho.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
                <CabecalhoDoPedido p={p} />
                <ItensDoPedido p={p} />
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {fechados.length > 0 && (
        <Secao titulo="Recentes">
          <ul className="flex flex-col gap-4">
            {fechados.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
                <CabecalhoDoPedido p={p} />
                {p.situacao !== 'CANCELADO' && <ItensDoPedido p={p} />}
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  )
}
