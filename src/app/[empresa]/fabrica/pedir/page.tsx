import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { moduloLigado } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { catalogoParaPedir, fabricasParaPedir, listarPedidos, unidadesDaFabrica } from '@/servidor/fabrica'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Fichas } from '@/ui/Busca'
import { Aviso, Cartao } from '@/ui/base'
import { Secao } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { FabricaDesligada } from '../Desligada'
import { CabecalhoDoPedido, ItensDoPedido } from '../Pedido'
import { FazerPedido } from './FazerPedido'
import { CancelarPedido, Conferir } from './Conferir'

export const metadata: Metadata = { title: 'Pedir à fábrica' }

// A tela DA LOJA: pedir à fábrica e conferir o que chegou.
//
// Separada da tela da fábrica de propósito. A gerente da loja abre aqui pelo
// Estoque ("Pedir à fábrica"), vê o que a loja dela vende e o que vendeu na
// semana, pede, e embaixo acompanha os pedidos da loja: o que está esperando,
// o que já saiu (conferir) e o que já chegou.

export default async function PedirAFabrica({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ loja?: string | string[] }>
}) {
  const { empresa: slug } = await params
  const q = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'fabrica.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const moldura = { empresa, sessao, itens: MENU(slug), ativo: `/${slug}/fabrica`, tema, titulo: 'Pedir à fábrica' }

  if (!moduloLigado(empresa, 'fabrica')) {
    return (
      <Estrutura {...moldura}>
        <FabricaDesligada slug={slug} podeLigar={pode(sessao, 'empresa.configurar')} />
      </Estrutura>
    )
  }

  const unidades = await unidadesDaFabrica(sessao)
  // Para onde pedir: TODAS as fábricas abertas, e não só as que a pessoa vê
  // no estoque — a gerente presa à loja dela não enxerga a fábrica, e a tela
  // dizia que a empresa não tinha fábrica.
  const fabricas = await fabricasParaPedir(sessao)
  // A fábrica não pede para ela mesma. As lojas em que a pessoa pode pedir vêm
  // primeiro; as outras que ela enxerga ficam para acompanhar.
  const lojas = unidades
    .filter((u) => !u.ehFabrica)
    .sort((a, b) => Number(pode(sessao, 'fabrica.pedir', b.id)) - Number(pode(sessao, 'fabrica.pedir', a.id)))
  const pedida = typeof q.loja === 'string' ? q.loja : undefined
  const loja = lojas.find((l) => l.id === pedida) ?? lojas[0]

  return (
    <Estrutura
      {...moldura}
      acao={
        <Link href={`/${slug}/estoque`} className="text-sm text-tinta-2 hover:text-tinta">
          ← Estoque
        </Link>
      }
    >
      {!loja ? (
        <Aviso nivel="neutro">Nenhuma loja para pedir: as unidades que você enxerga são só a fábrica.</Aviso>
      ) : (
        <Corpo slug={slug} lojas={lojas} loja={loja} fabricas={fabricas} sessao={sessao} />
      )}
    </Estrutura>
  )
}

async function Corpo({
  slug,
  lojas,
  loja,
  fabricas,
  sessao,
}: {
  slug: string
  lojas: { id: string; nome: string }[]
  loja: { id: string; nome: string }
  fabricas: { id: string; nome: string }[]
  sessao: Parameters<typeof listarPedidos>[0]
}) {
  const podePedir = pode(sessao, 'fabrica.pedir', loja.id)
  const catalogo = await catalogoParaPedir(sessao, loja.id)
  const pedidos = (await listarPedidos(sessao, { limite: 100 })).filter((p) => p.lojaId === loja.id).slice(0, 20)
  const abertos = pedidos.filter((p) => p.situacao === 'ABERTO')
  const aCaminho = pedidos.filter((p) => p.situacao === 'ENVIADO')
  const fechados = pedidos.filter((p) => p.situacao === 'RECEBIDO' || p.situacao === 'CANCELADO')

  return (
    <div className="flex flex-col gap-8">
      {lojas.length > 1 && (
        <Fichas
          rotulo="Loja"
          opcoes={lojas.map((l) => ({ valor: l.id, rotulo: l.nome }))}
          atual={loja.id}
          linkDe={(v) => `/${slug}/fabrica/pedir${v ? `?loja=${v}` : ''}`}
        />
      )}

      {aCaminho.length > 0 && (
        <Secao titulo="Chegando" resumo="A fábrica já mandou. Confira quando a caixa chegar.">
          <ul className="flex flex-col gap-4">
            {aCaminho.map((p) => (
              <li key={p.id}>
                <Cartao caixa>
                  <div className="flex flex-col gap-3">
                    <CabecalhoDoPedido p={p} />
                    {podePedir ? <Conferir slug={slug} pedido={p} /> : <ItensDoPedido p={p} />}
                  </div>
                </Cartao>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <Secao titulo={`O que ${loja.nome} quer`} resumo="O que a loja vende, com o que tem e o que vendeu na última semana.">
        {fabricas.length === 0 ? (
          <Aviso nivel="atencao">Esta empresa ainda não tem fábrica. Em Lojas, marque a unidade que produz como &ldquo;É fábrica&rdquo;.</Aviso>
        ) : podePedir ? (
          <FazerPedido slug={slug} lojaId={loja.id} fabricas={fabricas} itens={catalogo} />
        ) : (
          <Aviso nivel="neutro">Quem mexe no estoque de {loja.nome} é quem faz o pedido.</Aviso>
        )}
      </Secao>

      {(abertos.length > 0 || fechados.length > 0) && (
        <Secao titulo="Pedidos da loja">
          <ul className="flex flex-col gap-4">
            {[...abertos, ...fechados].map((p) => (
              <li key={p.id} className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
                <CabecalhoDoPedido p={p} acao={p.situacao === 'ABERTO' && podePedir && !p.itens.some((i) => (i.enviada ?? 0) > 0) ? <CancelarPedido slug={slug} pedidoId={p.id} /> : undefined} />
                {p.situacao !== 'CANCELADO' && <ItensDoPedido p={p} />}
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  )
}
