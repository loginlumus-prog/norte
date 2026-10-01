// "Vendido sem estoque — conferir": o que o balcão vendeu sem o sistema ter.
//
// Só aparece na loja que liga "vender o que o sistema diz que acabou" (ver
// Configurações) e só quando há o que conferir. Cada linha é uma pergunta: a
// peça estava mesmo na loja (o estoque é que estava errado — conte a
// prateleira e corrija o saldo na lista abaixo) ou saiu a peça de outro
// código? Conferido, sai da lista, com quem e quando no livro.

import Link from 'next/link'
import { listarParaConferir } from '@/servidor/estoque'
import { pode, type Sessao } from '@/servidor/permissao'
import { plural } from '@/ui/texto'
import { Secao } from '@/ui/painel'
import { JaConferi } from './JaConferi'

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)

const qtd = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace('.', ','))

export async function VendidoSemEstoque({ slug, sessao, unidadeIds }: { slug: string; sessao: Sessao; unidadeIds: string[] }) {
  const itens = await listarParaConferir(sessao, unidadeIds)
  if (itens.length === 0) return null
  const variasLojas = new Set(itens.map((i) => i.unidadeId)).size > 1
  return (
    <Secao
      titulo="Vendido sem estoque — conferir"
      resumo="O balcão vendeu e o sistema dizia que não havia. Conte a prateleira: se o estoque estava errado, corrija o saldo na lista de baixo; depois marque como conferido."
      acao={<span className="text-xs text-tinta-3">{plural(itens.length, 'item para conferir', 'itens para conferir')}</span>}
    >
      <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda bg-superficie">
        {itens.map((i) => (
          <li key={i.vendaItemId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold text-tinta">
                {i.descricao}
                {i.codigo && <span className="ml-2 font-mono text-xs font-normal text-tinta-3">{i.codigo}</span>}
              </span>
              <span className="text-xs text-tinta-2">
                Vendeu <b className="numero">{qtd(i.vendido)}</b>, o sistema tinha <b className="numero">{qtd(i.tinha)}</b> · saldo agora{' '}
                <b className={i.saldoAgora < 0 ? 'numero text-critico' : 'numero'}>{qtd(i.saldoAgora)}</b>
              </span>
              <span className="text-xs text-tinta-3">
                <Link href={`/${slug}/vendas/${i.vendaId}`} className="underline-offset-2 hover:underline">
                  Venda {i.vendaNumero}
                </Link>{' '}
                · {quando(i.vendidaEm)}
                {i.vendedor && ` · ${i.vendedor}`}
                {variasLojas && ` · ${i.unidade}`}
              </span>
            </span>
            {pode(sessao, 'estoque.ajustar', i.unidadeId) && <JaConferi slug={slug} vendaItemId={i.vendaItemId} />}
          </li>
        ))}
      </ul>
    </Secao>
  )
}
