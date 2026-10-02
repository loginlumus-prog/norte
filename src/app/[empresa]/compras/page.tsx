import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { moduloLigado } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { diaEmSP, mostrarDiaDaColuna } from '@/servidor/dia'
import { mostrarTelefone } from '@/servidor/cliente'
import { NIVEL_COMPRA, ROTULO_COMPRA, listarFornecedores, listarPedidos, type SituacaoCompra } from '@/servidor/compras'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Fichas, enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { brl } from '@/ui/painel'
import { Cartao, Situacao, Vazio } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { NovoPedido } from './NovoPedido'
import { NovoFornecedor } from './Fornecedor'

export const metadata: Metadata = { title: 'Compras' }

// Compras: o que se pediu ao fornecedor, o que chegou e o que custou.
//
// A lista abre pelos pedidos em aberto (rascunho, mandado, chegou em parte):
// é o que ainda pede alguém. Receber é na tela do pedido, e dá entrada no
// estoque pelo mesmo caminho da entrada de mercadoria. Os fornecedores moram
// embaixo — cadastro curto, porque o que importa é o pedido.

const FILTROS: Record<string, SituacaoCompra | 'todos'> = {
  rascunho: 'RASCUNHO',
  enviado: 'ENVIADO',
  parcial: 'PARCIAL',
  recebido: 'RECEBIDO',
  cancelado: 'CANCELADO',
  todos: 'todos',
}

export default async function Compras({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; situacao?: string }>
}) {
  const { empresa: slug } = await params
  const q = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'compra.ver' })
  if (!moduloLigado(empresa, 'compras')) semAcesso(slug, 'modulo-compras')
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const onde = await escolherUnidade(sessao, empresa, q.unidade, 'compra.ver')
  const chave = q.situacao && Object.hasOwn(FILTROS, q.situacao) ? q.situacao : null
  const pedidos = await listarPedidos(sessao, { unidadeIds: onde.ids, situacao: chave ? FILTROS[chave] : 'abertos' })
  const fornecedores = await listarFornecedores(sessao)
  const lojasParaPedir = onde.opcoes.filter((u) => (onde.unidadeId ? u.id === onde.unidadeId : true)).filter((u) => pode(sessao, 'compra.gerir', u.id))
  const podeGerir = pode(sessao, 'compra.gerir')
  const link = (m: Record<string, string | null>) => enderecoCom(`/${slug}/compras`, { unidade: onde.unidadeId, situacao: chave }, m)
  const materialUsado = pode(sessao, 'estoque.consumir')

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/compras`}
      tema={tema}
      titulo="Compras"
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} /> : undefined}
    >
      <div className="flex flex-wrap items-center gap-3">
        {lojasParaPedir.length > 0 && (
          <NovoPedido
            slug={slug}
            lojas={lojasParaPedir.map((u) => ({ id: u.id, nome: u.nome }))}
            lojaAtual={onde.unidadeId}
            fornecedores={fornecedores.filter((f) => f.ativo).map((f) => ({ id: f.id, nome: f.nome }))}
            hoje={diaEmSP()}
          />
        )}
        {materialUsado && (
          <Link href={`/${slug}/compras/consumo${onde.unidadeId ? `?unidade=${onde.unidadeId}` : ''}`} className="text-sm font-semibold text-marca underline-offset-2 hover:underline">
            Anotar material usado →
          </Link>
        )}
      </div>

      <Fichas
        opcoes={[
          { valor: null, rotulo: 'em aberto' },
          { valor: 'rascunho', rotulo: 'rascunhos' },
          { valor: 'enviado', rotulo: 'mandados' },
          { valor: 'parcial', rotulo: 'chegou em parte' },
          { valor: 'recebido', rotulo: 'recebidos' },
          { valor: 'cancelado', rotulo: 'cancelados' },
          { valor: 'todos', rotulo: 'todos' },
        ]}
        atual={chave}
        linkDe={(v) => link({ situacao: v })}
      />

      {pedidos.length === 0 ? (
        <Vazio>
          {chave
            ? 'Nenhum pedido com esse filtro.'
            : 'Nenhum pedido em aberto. Quando for comprar do fornecedor, monte o pedido aqui — ao chegar, um toque dá entrada no estoque e, se quiser, lança a conta a pagar.'}
        </Vazio>
      ) : (
        <ul className="flex flex-col gap-2">
          {pedidos.map((p) => (
            <li key={p.id}>
              <Link
                href={`/${slug}/compras/${p.id}`}
                className="flex flex-col gap-1 rounded-norte border border-borda bg-superficie p-3 hover:bg-superficie-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-tinta-3">{p.codigo}</span>
                    <span className="font-semibold text-tinta">{p.fornecedorNome ?? 'Sem fornecedor'}</span>
                    <Situacao nivel={NIVEL_COMPRA[p.situacao]}>{ROTULO_COMPRA[p.situacao]}</Situacao>
                  </span>
                  <span className="text-xs text-tinta-3">
                    {p.itens} {p.itens === 1 ? 'item' : 'itens'} · {p.unidadeNome}
                    {p.previsto && ` · previsto para ${mostrarDiaDaColuna(p.previsto)}`} · por {p.quem}
                  </span>
                </span>
                <span className="numero text-sm font-bold text-tinta">{brl(p.valor)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Cartao titulo="Fornecedores" acao={podeGerir ? <NovoFornecedor slug={slug} /> : undefined}>
        {fornecedores.length === 0 ? (
          <p className="text-sm text-tinta-3">Nenhum fornecedor cadastrado. Dá para pedir sem — mas com ele, o pedido e a conta a pagar levam o nome.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {fornecedores.map((f) => (
              <li key={f.id} className="flex flex-col rounded-norte border border-borda-suave px-3 py-2">
                <span className="font-semibold text-tinta">{f.nome}</span>
                <span className="text-xs text-tinta-3">
                  {[f.telefone ? mostrarTelefone(f.telefone) : null, `${f.pedidos} ${f.pedidos === 1 ? 'pedido' : 'pedidos'}`, f.observacao].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </Estrutura>
  )
}
