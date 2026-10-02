import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { moduloLigado } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { diaEmSP, mostrarDiaDaColuna } from '@/servidor/dia'
import { NIVEL_COMPRA, ROTULO_COMPRA, acharPedido, categoriasDeDespesa, falta } from '@/servidor/compras'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { brl } from '@/ui/painel'
import { Cartao, Situacao } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { AcoesDoPedido, Receber } from './Receber'
import { EditarItens } from './EditarItens'

export const metadata: Metadata = { title: 'Pedido de compra' }

// Um pedido: os itens, o que já chegou de cada um, os recebimentos, e as
// ações do momento — mandar, receber (tudo ou parte), encerrar, cancelar.

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)

export default async function PedidoDeCompra({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  const { empresa: slug, id } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'compra.ver' })
  if (!moduloLigado(empresa, 'compras')) semAcesso(slug, 'modulo-compras')
  if (!/^[\w-]{1,64}$/.test(id)) notFound()
  const p = await acharPedido(sessao, id)
  if (!p) notFound()
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const podeGerir = pode(sessao, 'compra.gerir', p.unidadeId)
  const podeReceber = podeGerir && pode(sessao, 'estoque.ajustar', p.unidadeId) && ['RASCUNHO', 'ENVIADO', 'PARCIAL'].includes(p.situacao)
  const categorias = podeReceber && pode(sessao, 'financeiro.lancar', p.unidadeId) ? await categoriasDeDespesa(sessao) : []
  const pendentes = p.itensLista.filter((i) => falta(i) > 0)

  return (
    <Estrutura empresa={empresa} sessao={sessao} itens={MENU(slug)} ativo={`/${slug}/compras`} tema={tema} titulo={`Pedido ${p.codigo}`}>
      <Link href={`/${slug}/compras`} className="w-fit text-sm text-tinta-2 hover:text-tinta">
        ← Compras
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-tinta">{p.fornecedorNome ?? 'Sem fornecedor'}</h2>
            <Situacao nivel={NIVEL_COMPRA[p.situacao]}>{ROTULO_COMPRA[p.situacao]}</Situacao>
          </span>
          <span className="text-sm text-tinta-3">
            {p.unidadeNome} · feito por {p.quem} em {quando(p.criadoEm)}
            {p.previsto && ` · previsto para ${mostrarDiaDaColuna(p.previsto)}`}
          </span>
          {p.observacao && <span className="text-sm text-tinta-2">{p.observacao}</span>}
          {p.motivoCancelamento && <span className="text-sm text-tinta-2">Cancelado: {p.motivoCancelamento}</span>}
        </div>
        <span className="numero text-xl font-bold text-tinta">{brl(p.valor)}</span>
      </div>

      {podeGerir && <AcoesDoPedido slug={slug} pedidoId={p.id} situacao={p.situacao} />}

      {/* Rascunho ainda é do lojista: dá para mudar os itens antes de mandar. */}
      {podeGerir && p.situacao === 'RASCUNHO' && (
        <EditarItens
          slug={slug}
          pedidoId={p.id}
          unidadeId={p.unidadeId}
          itens={p.itensLista.map((i) => ({
            variacaoId: i.variacaoId,
            descricao: i.descricao,
            medida: i.medida,
            quantidade: i.quantidade,
            custoUnit: i.custoUnit,
          }))}
        />
      )}

      <Cartao titulo="Itens">
        <ul className="flex flex-col divide-y divide-borda-suave">
          {p.itensLista.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 font-medium text-tinta">{i.descricao}</span>
              <span className="numero flex flex-wrap gap-x-4 text-tinta-2">
                <span>
                  pedido {i.quantidade.toLocaleString('pt-BR')} {i.medida.toLowerCase()}
                </span>
                <span className={falta(i) > 0 ? 'text-atencao' : 'text-bom'}>chegou {i.recebido.toLocaleString('pt-BR')}</span>
                <span>{i.custoUnit != null ? `${brl(i.custoUnit)} cada` : 'sem custo'}</span>
              </span>
            </li>
          ))}
        </ul>
      </Cartao>

      {podeReceber && pendentes.length > 0 && (
        <Receber
          slug={slug}
          pedidoId={p.id}
          hoje={diaEmSP()}
          categorias={categorias}
          itens={pendentes.map((i) => ({ id: i.id, descricao: i.descricao, medida: i.medida, falta: falta(i), custoUnit: i.custoUnit }))}
        />
      )}

      {p.recebimentos.length > 0 && (
        <Cartao titulo="Recebimentos">
          <ul className="flex flex-col divide-y divide-borda-suave">
            {p.recebimentos.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-tinta">
                  {quando(r.criadoEm)} · {r.itens} {r.itens === 1 ? 'item' : 'itens'} · por {r.quem}
                  {r.contaLancada && <span className="text-tinta-3"> · conta lançada no Financeiro</span>}
                </span>
                <span className="numero font-semibold text-tinta">{brl(r.total)}</span>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <p className="text-xs text-tinta-3">
        Receber dá entrada no estoque pela mesma entrada de mercadoria da tela de Estoque: o saldo sobe, o custo passa a ser o desta
        compra e, se marcado, a conta a pagar vai para o Financeiro. O mesmo recebimento enviado duas vezes entra uma vez só.
      </p>
    </Estrutura>
  )
}
