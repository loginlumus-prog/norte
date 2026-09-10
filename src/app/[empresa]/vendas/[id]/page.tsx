import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { acharVenda } from '@/servidor/venda'
import { pode } from '@/servidor/permissao'
import { mostrarTelefone } from '@/servidor/cliente'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao } from '@/ui/base'
import { Numero, brl } from '@/ui/painel'
import { Tabela } from '@/ui/Tabela'
import type { Tema } from '@/ui/TrocaTema'
import { Cancelar } from './Cancelar'

// A ficha de uma venda.
//
// Quem abre isto está com o cliente na frente ("essa peça foi daqui?") ou
// conferindo o dia. As duas perguntas se respondem com a mesma tela: o que
// saiu, por quanto, como foi pago, quem vendeu — e, embaixo e separado, o
// caminho para desfazer.

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Cartão de débito', CREDITO: 'Cartão de crédito', CREDIARIO: 'Crediário',
}
const MEDIDA: Record<string, string> = {
  UN: 'un', KG: 'kg', G: 'g', L: 'L', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx',
}

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(d)

const qtd = (v: unknown, medida: string) => {
  const n = Number(v)
  const t = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace('.', ',')
  return `${t} ${MEDIDA[medida] ?? ''}`
}

export default async function FichaVenda({
  params,
}: {
  params: Promise<{ empresa: string; id: string }>
}) {
  const { empresa: slug, id } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const v = await acharVenda(sessao, id)
  if (!v) notFound()

  const cancelada = v.situacao === 'CANCELADA'
  const podeCancelar = !cancelada && pode(sessao, 'venda.cancelar', v.unidadeId)

  const subtotal = Number(v.subtotal)
  const desconto = Number(v.desconto)
  const pontosCent = Number(v.descontoPontos)
  const total = Number(v.total)

  type Item = (typeof v.itens)[number]
  const colunas = [
    {
      chave: 'item',
      titulo: 'Item',
      celula: (i: Item) => (
        <span className="flex flex-col">
          <span className="text-tinta">{i.descricao}</span>
          {i.codigo && <span className="font-mono text-xs text-tinta-3">{i.codigo}</span>}
        </span>
      ),
    },
    {
      chave: 'qtd',
      titulo: 'Qtd',
      numero: true,
      largura: '6rem',
      celula: (i: Item) => <span className="numero">{qtd(i.quantidade, i.medida)}</span>,
    },
    {
      chave: 'unit',
      titulo: 'Unitário',
      numero: true,
      largura: '7rem',
      celula: (i: Item) => <span className="numero text-tinta-2">{brl(Number(i.precoUnit))}</span>,
    },
    {
      chave: 'total',
      titulo: 'Total',
      numero: true,
      largura: '7rem',
      celula: (i: Item) => <span className="numero font-semibold text-tinta">{brl(Number(i.total))}</span>,
    },
  ]

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/vendas`}
      tema={tema}
      titulo={`Venda ${v.numero}`}
      acao={
        <Link href={`/${slug}/vendas`} className="text-sm font-medium text-tinta-2 hover:text-tinta">
          ← todas as vendas
        </Link>
      }
    >
      {cancelada && (
        <div className="flex flex-col gap-1 rounded-norte border border-critico-borda bg-critico-fundo px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-critico">
            <Situacao nivel="critico">cancelada</Situacao>
            {v.canceladaEm && <span className="font-normal text-tinta-2">em {quando(v.canceladaEm)}</span>}
          </p>
          {v.motivoCancelamento && (
            <p className="text-[13px] text-tinta-2">Motivo: {v.motivoCancelamento}</p>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Numero rotulo="Total" valor={brl(total)} detalhe={quando(v.criadaEm)} principal={!cancelada} />
        <Numero
          rotulo="Cliente"
          valor={v.cliente?.nome ?? 'Sem cadastro'}
          detalhe={v.cliente?.telefone ? mostrarTelefone(v.cliente.telefone) : 'venda avulsa'}
        />
        <Numero rotulo="Vendeu" valor={v.vendedorNome ?? '—'} detalhe={v.unidade.nome} />
      </div>

      <Cartao titulo={`${v.itens.length} ${v.itens.length === 1 ? 'item' : 'itens'}`}>
        <Tabela colunas={colunas} linhas={v.itens} chave={(i) => i.id} />

        {/* A conta de baixo para cima, como no comprovante. Cada linha só
            aparece se mexeu no total — subtotal igual ao total é ruído. */}
        <dl className="ml-auto mt-3 flex w-full max-w-xs flex-col gap-1 text-sm">
          {(desconto > 0 || pontosCent > 0) && (
            <div className="flex justify-between text-tinta-2">
              <dt>Subtotal</dt>
              <dd className="numero">{brl(subtotal)}</dd>
            </div>
          )}
          {desconto > 0 && (
            <div className="flex justify-between text-tinta-2">
              <dt>Desconto</dt>
              <dd className="numero">− {brl(desconto)}</dd>
            </div>
          )}
          {pontosCent > 0 && (
            <div className="flex justify-between text-tinta-2">
              <dt>Pontos ({v.pontosUsados})</dt>
              <dd className="numero">− {brl(pontosCent)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-borda pt-1.5 font-bold text-tinta">
            <dt>Total</dt>
            <dd className="numero">{brl(total)}</dd>
          </div>
          {v.pontosGanhos > 0 && (
            <div className="flex justify-between text-xs text-bom">
              <dt>Ganhou</dt>
              <dd className="numero">{v.pontosGanhos} pontos</dd>
            </div>
          )}
        </dl>
      </Cartao>

      <Cartao titulo="Pagamento">
        <ul className="flex flex-col gap-1.5 text-sm">
          {v.pagamentos.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-3">
              <span className="text-tinta">
                {FORMA[p.forma] ?? p.forma}
                {p.parcelas > 1 && <span className="text-tinta-3"> · {p.parcelas}×</span>}
                {p.referencia && <span className="text-tinta-3"> · {p.referencia}</span>}
              </span>
              <span className="numero font-semibold text-tinta">{brl(Number(p.valor))}</span>
            </li>
          ))}
        </ul>
        {v.observacoes && (
          <p className="mt-3 border-t border-borda-suave pt-3 text-[13px] text-tinta-2">{v.observacoes}</p>
        )}
      </Cartao>

      {podeCancelar && (
        <div className="pt-2">
          <Cancelar slug={slug} vendaId={v.id} numero={v.numero} />
        </div>
      )}
    </Estrutura>
  )
}
