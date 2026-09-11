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
import { Devolver, type ItemDevolvivel } from './Devolver'
import { restante } from '@/servidor/devolucao'

// A ficha de uma venda.
//
// Quem abre isto está com o cliente na frente ("essa peça foi daqui?") ou
// conferindo o dia. As duas perguntas se respondem com a mesma tela: o que
// saiu, por quanto, como foi pago, quem vendeu — e, embaixo e separado, o
// caminho para desfazer.

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Cartão de débito', CREDITO: 'Cartão de crédito',
  CREDIARIO: 'Crediário', VALE: 'Vale de troca', TRANSFERENCIA: 'Transferência',
}
const DESTINO: Record<string, string> = {
  VALE: 'virou vale de troca', DINHEIRO: 'devolvido em dinheiro', ESTORNO: 'estornado por fora',
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
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'venda.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const v = await acharVenda(sessao, id)
  if (!v) notFound()

  const cancelada = v.situacao === 'CANCELADA'
  const podeCancelar = !cancelada && pode(sessao, 'venda.cancelar', v.unidadeId)
  const podeDevolver = !cancelada && pode(sessao, 'venda.criar', v.unidadeId)

  const subtotal = Number(v.subtotal)
  const desconto = Number(v.desconto)
  const pontosCent = Number(v.descontoPontos)
  const total = Number(v.total)
  const devolvido = v.devolucoes.reduce((s, d) => s + Number(d.valor), 0)

  // Quanto de cada item já voltou, e quanto ainda pode voltar.
  const voltouDe = (i: (typeof v.itens)[number]) =>
    i.devolucoes.reduce((s, d) => s + Number(d.quantidade), 0)
  const devolviveis: ItemDevolvivel[] = v.itens
    .map((i) => ({
      id: i.id,
      descricao: i.descricao,
      medida: i.medida,
      restante: restante(Number(i.quantidade), voltouDe(i)),
      precoUnit: Number(i.precoUnit),
    }))
    .filter((i) => i.restante > 0)
  const temDevolucao = v.devolucoes.length > 0

  type Item = (typeof v.itens)[number]
  const colunas = [
    {
      chave: 'item',
      titulo: 'Item',
      celula: (i: Item) => (
        <span className="flex flex-col">
          <span className="text-tinta">{i.descricao}</span>
          {i.codigo ? (
            <span className="font-mono text-xs text-tinta-3">{i.codigo}</span>
          ) : !i.variacaoId ? (
            <span className="text-xs text-tinta-3">item avulso</span>
          ) : null}
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
    ...(temDevolucao
      ? [
          {
            chave: 'voltou',
            titulo: 'Voltou',
            numero: true,
            largura: '6rem',
            celula: (i: Item) => {
              const q = voltouDe(i)
              return q > 0 ? <span className="numero text-atencao">{qtd(q, i.medida)}</span> : null
            },
          },
        ]
      : []),
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
        <span className="flex flex-wrap items-center gap-3">
          <Link href={`/${slug}/vendas`} className="text-sm font-medium text-tinta-2 hover:text-tinta">
            ← todas as vendas
          </Link>
          <Link
            href={`/${slug}/vendas/${v.id}/comprovante`}
            className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            Comprovante
          </Link>
          {v.cliente?.telefone && (
            <a
              href={`https://wa.me/55${v.cliente.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(
                `Olá, ${v.cliente.nome.split(' ')[0]}! Aqui é da ${empresa.nome}. Segue o resumo da sua compra nº ${v.numero}: ${v.itens
                  .map((i) => `${qtd(i.quantidade, i.medida)} ${i.descricao}`)
                  .join(', ')}. Total ${brl(total)}. Obrigado pela preferência!`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
            >
              Mandar pelo WhatsApp
            </a>
          )}
        </span>
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
          {devolvido > 0 && (
            <>
              <div className="flex justify-between text-atencao">
                <dt>Devolvido</dt>
                <dd className="numero">− {brl(devolvido)}</dd>
              </div>
              <div className="flex justify-between text-sm font-semibold text-tinta">
                <dt>Ficou</dt>
                <dd className="numero">{brl(total - devolvido)}</dd>
              </div>
            </>
          )}
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
                {p.vale ? (
                  <span className="font-mono text-tinta-3"> · {p.vale.codigo}</span>
                ) : (
                  p.referencia && <span className="text-tinta-3"> · {p.referencia}</span>
                )}
              </span>
              <span className="numero font-semibold text-tinta">{brl(Number(p.valor))}</span>
            </li>
          ))}
        </ul>
        {v.observacoes && (
          <p className="mt-3 border-t border-borda-suave pt-3 text-[13px] text-tinta-2">{v.observacoes}</p>
        )}
      </Cartao>

      {v.parcelas.length > 0 && (
        <Cartao titulo={`Crediário · ${v.parcelas.length} parcela${v.parcelas.length === 1 ? '' : 's'}`}>
          <ul className="flex flex-col divide-y divide-borda-suave text-sm">
            {v.parcelas.map((p) => {
              const resta = Number(p.valor) - Number(p.pago)
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-tinta">
                    {p.numero}/{p.de} · vence{' '}
                    {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(p.vencimento)}
                  </span>
                  <span className="flex items-center gap-3">
                    {p.quitadaEm ? (
                      <Situacao nivel="bom">quitada</Situacao>
                    ) : p.vencimento < new Date() ? (
                      <Situacao nivel="critico">vencida</Situacao>
                    ) : (
                      <Situacao nivel="neutro">em aberto</Situacao>
                    )}
                    <span className="numero font-semibold text-tinta">{brl(p.quitadaEm ? Number(p.valor) : resta)}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-xs text-tinta-3">
            Receber é em{' '}
            <Link href={`/${slug}/crediario?q=${v.numero}`} className="font-medium text-marca underline-offset-2 hover:underline">
              Crediário
            </Link>
            .
          </p>
        </Cartao>
      )}

      {temDevolucao && (
        <Cartao titulo={`${v.devolucoes.length === 1 ? 'Devolução' : 'Devoluções'}`}>
          <ul className="flex flex-col divide-y divide-borda-suave text-sm">
            {v.devolucoes.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-tinta">
                    {quando(d.criadaEm)} · {d.quem} — {DESTINO[d.destino] ?? d.destino}
                  </span>
                  <span className="numero font-semibold text-atencao">− {brl(Number(d.valor))}</span>
                </div>
                <span className="text-xs text-tinta-2">
                  {d.itens
                    .map((di) => {
                      const item = v.itens.find((i) => i.id === di.vendaItemId)
                      return `${qtd(di.quantidade, item?.medida ?? 'UN')} ${item?.descricao ?? ''}`
                    })
                    .join(' · ')}
                  {' — '}
                  {d.motivo}
                </span>
                {d.vale && (
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="numero rounded border border-borda bg-superficie-2 px-2 py-0.5 font-mono font-bold text-tinta">
                      {d.vale.codigo}
                    </span>
                    <span className="text-tinta-2">
                      {Number(d.vale.saldo) > 0 ? `saldo ${brl(Number(d.vale.saldo))}` : 'vale já usado'}
                      {d.vale.validade &&
                        ` · vale até ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d.vale.validade)}`}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {/* Devolver primeiro, cancelar por último: devolver é o gesto do dia
          seguinte, cancelar é o do engano — e o do engano fica mais longe. */}
      {(podeDevolver && devolviveis.length > 0) || podeCancelar ? (
        <div className="flex flex-col gap-3 pt-2">
          {podeDevolver && devolviveis.length > 0 && (
            <Devolver
              slug={slug}
              vendaId={v.id}
              numero={v.numero}
              itens={devolviveis}
              podeDinheiro={pode(sessao, 'venda.cancelar', v.unidadeId)}
            />
          )}
          {podeCancelar && <Cancelar slug={slug} vendaId={v.id} numero={v.numero} />}
        </div>
      ) : null}
    </Estrutura>
  )
}
