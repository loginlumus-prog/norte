import type { Metadata } from 'next'
import { diaDaColuna, diaEmSP, mostrarDiaDaColuna } from '@/servidor/dia'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { acharVenda } from '@/servidor/venda'
import { codigoEncomenda } from '@/servidor/encomenda'
import { pode } from '@/servidor/permissao'
import { mostrarTelefone } from '@/servidor/cliente'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao } from '@/ui/base'
import { Numero, brl } from '@/ui/painel'
import { Tabela } from '@/ui/Tabela'
import type { Tema } from '@/ui/TrocaTema'
import { Cancelar } from './Cancelar'
import { CorrigirData } from './CorrigirData'
import { Devolver, type ItemDevolvivel } from './Devolver'
import { pedeInteiro, restante } from '@/servidor/devolucao'
import { concorda, plural } from '@/ui/texto'
import { vocabularioDaEmpresa, vocabularioDoEndereco } from '@/servidor/vocabulario'

// "Atendimento" na clínica, "Recebimento" na escola (vocabulario.ts).
export async function generateMetadata({ params }: { params: Promise<{ empresa: string }> }): Promise<Metadata> {
  return { title: (await vocabularioDoEndereco((await params).empresa)).Venda }
}

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
    timeZone: 'America/Sao_Paulo',
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
  const palavras = await vocabularioDaEmpresa(sessao.orgId)
  const g = (feminina: string, masculina: string) => concorda(palavras, feminina, masculina)

  const cancelada = v.situacao === 'CANCELADA'
  // O saldo de crediário trazido do sistema anterior: não se cancela nem se
  // devolve (o servidor recusa também), e a tela diz o que ele é.
  const importado = v.situacao === 'SALDO_IMPORTADO'
  const podeCancelar = !cancelada && !importado && pode(sessao, 'venda.cancelar', v.unidadeId)
  const podeDevolver = !cancelada && !importado && pode(sessao, 'venda.criar', v.unidadeId)

  const subtotal = Number(v.subtotal)
  const desconto = Number(v.desconto)
  const pontosCent = Number(v.descontoPontos)
  const acrescimo = Number(v.acrescimo)
  // O juro do crédito parcelado já está dentro do total e do pagamento.
  const juros = v.pagamentos.reduce((s, p) => s + Number(p.juros), 0)
  const total = Number(v.total)
  // O dinheiro gravado é o que ficou na gaveta; o entregue é ele mais o troco.
  const dinheiro = v.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + Number(p.valor), 0)
  const devolvido = v.devolucoes.reduce((s, d) => s + Number(d.valor), 0)

  // Quanto de cada item já voltou, e quanto ainda pode voltar.
  const voltouDe = (i: (typeof v.itens)[number]) =>
    i.devolucoes.reduce((s, d) => s + Number(d.quantidade), 0)
  const devolviveis: ItemDevolvivel[] = v.itens
    .map((i) => ({
      id: i.id,
      descricao: i.descricao,
      medida: i.medida,
      inteiro: pedeInteiro(i.medida),
      restante: restante(Number(i.quantidade), voltouDe(i)),
      precoUnit: Number(i.precoUnit),
    }))
    .filter((i) => i.restante > 0)
  const temDevolucao = v.devolucoes.length > 0
  // Vencida é o dia do vencimento JÁ PASSADO, no calendário de São Paulo —
  // a mesma régua do Crediário (`diasDeAtraso`). Comparar a coluna `date`
  // (meia-noite UTC) com o instante de agora chamava de vencida, desde as 21h
  // da véspera, a parcela que o Crediário mostrava em dia.
  const hoje = diaEmSP()

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
      celula: (i: Item) => (
        <span className="numero">
          {i.variacao?.produto.servico ? `${Number(i.quantidade).toLocaleString('pt-BR')}×` : qtd(i.quantidade, i.medida)}
        </span>
      ),
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
      titulo={`${palavras.Venda} ${v.numero}`}
      acao={
        <span className="flex flex-wrap items-center gap-3">
          <Link href={`/${slug}/vendas`} className="text-sm font-medium text-tinta-2 hover:text-tinta">
            ← {g('todas as', 'todos os')} {palavras.vendas}
          </Link>
          {/* <a>: página de impressão abre inteira — ver comprovante/page.tsx. */}
          <a
            href={`/${slug}/vendas/${v.id}/comprovante`}
            className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            Comprovante
          </a>
          {/* A troca numa tela só (troca/): a peça volta e a nova sai juntas. */}
          {podeDevolver && devolviveis.length > 0 && v.situacao === 'CONCLUIDA' && (
            <Link
              href={`/${slug}/troca?venda=${v.id}`}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
            >
              ⇄ Trocar
            </Link>
          )}
          {/* No crediário, o carnê: o papel que a cliente assina (vendas/[id]/carne). */}
          {v.parcelas.length > 0 && (
            <a
              href={`/${slug}/vendas/${v.id}/carne`}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
            >
              Carnê
            </a>
          )}
          {v.cliente?.telefone && (
            <a
              href={`https://wa.me/55${v.cliente.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(
                `Olá, ${v.cliente.nome.split(' ')[0]}! Aqui é da ${empresa.nome}. Segue o resumo ${g('da sua', 'do seu')} ${palavras.compra} nº ${v.numero}: ${v.itens
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
            <Situacao nivel="critico">{g('cancelada', 'cancelado')}</Situacao>
            {v.canceladaEm && <span className="font-normal text-tinta-2">em {quando(v.canceladaEm)}</span>}
          </p>
          {v.motivoCancelamento && (
            <p className="text-[13px] text-tinta-2">Motivo: {v.motivoCancelamento}</p>
          )}
        </div>
      )}

      {importado && (
        <div className="flex flex-col gap-1 rounded-norte border border-borda bg-superficie-2 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-tinta">
            <Situacao nivel="neutro">saldo importado</Situacao>
          </p>
          <p className="text-[13px] text-tinta-2">
            {v.observacoes?.startsWith('Dívida lançada')
              ? `${v.observacoes} Não entra como venda nem como receita do mês.`
              : 'Crediário trazido do sistema anterior: a compra foi feita lá, e aqui ficam só as parcelas que estavam em aberto. Não entra como venda nem como receita do mês.'}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Numero rotulo="Total" valor={brl(total)} detalhe={quando(v.criadaEm)} principal={!cancelada} />
        <Numero
          rotulo={palavras.Pessoa}
          valor={v.cliente?.nome ?? 'Sem cadastro'}
          detalhe={v.cliente?.telefone ? mostrarTelefone(v.cliente.telefone) : `${palavras.venda} ${g('avulsa', 'avulso')}`}
        />
        <Numero rotulo={palavras.vendeu} valor={v.vendedorNome ?? '—'} detalhe={v.unidade.nome} />
      </div>

      {/* A data corrigida (venda-data.ts): a de antes, quem e por quê. */}
      {v.dataOriginal && (
        <p className="text-[13px] text-tinta-2">
          Data corrigida{v.dataCorrigidaPor ? ` por ${v.dataCorrigidaPor}` : ''}
          {v.dataCorrigidaEm ? ` em ${quando(v.dataCorrigidaEm)}` : ''} — foi lançada em {quando(v.dataOriginal)}
          {v.dataCorrigidaMotivo ? `. Motivo: ${v.dataCorrigidaMotivo}` : ''}.
        </p>
      )}
      {v.situacao === 'CONCLUIDA' && pode(sessao, 'venda.cancelar', v.unidadeId) && (
        <CorrigirData slug={slug} vendaId={v.id} dia={diaEmSP(v.criadaEm)} hoje={diaEmSP()} />
      )}

      <Cartao titulo={`${v.itens.length} ${v.itens.length === 1 ? 'item' : 'itens'}`}>
        <Tabela colunas={colunas} linhas={v.itens} chave={(i) => i.id} />

        {/* A conta de baixo para cima, como no comprovante. Cada linha só
            aparece se mexeu no total — subtotal igual ao total é ruído. */}
        <dl className="ml-auto mt-3 flex w-full max-w-xs flex-col gap-1 text-sm">
          {(desconto > 0 || pontosCent > 0 || acrescimo > 0 || juros > 0) && (
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
          {acrescimo > 0 && (
            <div className="flex justify-between text-tinta-2">
              <dt>Acréscimo</dt>
              <dd className="numero">+ {brl(acrescimo)}</dd>
            </div>
          )}
          {pontosCent > 0 && (
            <div className="flex justify-between text-tinta-2">
              <dt>Pontos ({v.pontosUsados})</dt>
              <dd className="numero">− {brl(pontosCent)}</dd>
            </div>
          )}
          {juros > 0 && (
            <div className="flex justify-between text-tinta-2">
              <dt>Juro do parcelamento</dt>
              <dd className="numero">+ {brl(juros)}</dd>
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
              <dd className="numero">{plural(v.pontosGanhos, 'ponto', 'pontos')}</dd>
            </div>
          )}
        </dl>
      </Cartao>

      <Cartao titulo="Pagamento">
        <ul className="flex flex-col gap-1.5 text-sm">
          {v.pagamentos.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-tinta">
                  {FORMA[p.forma] ?? p.forma}
                  {p.parcelas > 1 && <span className="text-tinta-3"> · {p.parcelas}×</span>}
                  {p.maquininha && <span className="text-tinta-3"> · {p.maquininha}</span>}
                  {p.vale ? (
                    <span className="font-mono text-tinta-3"> · {p.vale.codigo}</span>
                  ) : (
                    p.referencia && <span className="text-tinta-3"> · {p.referencia}</span>
                  )}
                </span>
                {p.forma === 'CREDITO' && p.parcelas > 1 && (
                  <span className="numero text-xs text-tinta-3">
                    {p.parcelas}× de {brl(Math.ceil((Number(p.valor) * 100) / p.parcelas) / 100)}
                    {Number(p.juros) > 0 ? ` · juro ${brl(Number(p.juros))}` : ' · sem juro'}
                  </span>
                )}
              </span>
              <span className="numero font-semibold text-tinta">{brl(Number(p.valor))}</span>
            </li>
          ))}
          {/* O troco que o balcão deu (guardado no livro da venda). */}
          {v.troco > 0 && (
            <li className="flex items-baseline justify-between gap-3 border-t border-borda-suave pt-1.5 text-tinta-2">
              <span>
                Recebeu <span className="numero">{brl(dinheiro + v.troco)}</span> em dinheiro · troco
              </span>
              <span className="numero font-semibold text-tinta">{brl(v.troco)}</span>
            </li>
          )}
        </ul>
        {v.autorizadoPor && (
          <p className="mt-3 border-t border-borda-suave pt-3 text-[13px] text-tinta-2">
            Autorizado com o PIN de <b className="font-semibold text-tinta">{v.autorizadoPor}</b> (desconto acima do teto ou item fora do cadastro).
          </p>
        )}
        {v.encomenda && (
          <p className="mt-3 border-t border-borda-suave pt-3 text-[13px] text-tinta-2">
            Recebeu o que faltava da{' '}
            <Link
              href={`/${slug}/encomendas?situacao=entregue&q=${encodeURIComponent(v.encomenda.descricao.slice(0, 80))}`}
              className="font-semibold text-marca hover:underline"
            >
              encomenda {codigoEncomenda(v.encomenda.id)}
            </Link>
            : {v.encomenda.descricao}
          </p>
        )}
        {v.observacoes && (
          <p className="mt-3 border-t border-borda-suave pt-3 text-[13px] text-tinta-2">{v.observacoes}</p>
        )}
      </Cartao>

      {v.parcelas.length > 0 && (
        <Cartao titulo={`Crediário · ${v.parcelas.length} parcela${v.parcelas.length === 1 ? '' : 's'}`}>
          <ul className="flex flex-col divide-y divide-borda-suave text-sm">
            {v.parcelas.map((p) => {
              // O desconto autorizado abate sem dinheiro: resta = valor − pago − desconto.
              const resta = Number(p.valor) - Number(p.pago) - Number(p.desconto)
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-tinta">
                    {p.numero}/{p.de} · vence{' '}
                    {mostrarDiaDaColuna(p.vencimento, 'curto')}
                  </span>
                  <span className="flex items-center gap-3">
                    {p.quitadaEm ? (
                      <Situacao nivel="bom">quitada</Situacao>
                    ) : diaDaColuna(p.vencimento) < hoje ? (
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
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tinta-3">
            {/* O carnê: o papel que a cliente assina e leva (vendas/[id]/carne). */}
            <a href={`/${slug}/vendas/${v.id}/carne`} className="font-semibold text-marca underline-offset-2 hover:underline">
              Imprimir o carnê
            </a>
            <span>
              Receber é em{' '}
              <Link href={`/${slug}/crediario?q=${v.numero}`} className="font-medium text-marca underline-offset-2 hover:underline">
                Crediário
              </Link>
              .
            </span>
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
                        ` · vale até ${mostrarDiaDaColuna(d.vale.validade, 'longo')}`}
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
              palavras={{ destaVenda: palavras.destaVenda, daVenda: palavras.daVenda }}
            />
          )}
          {podeCancelar && (
            <Cancelar
              slug={slug}
              vendaId={v.id}
              numero={v.numero}
              // "Cancelar este atendimento" na clínica.
              palavras={{ estaVenda: palavras.estaVenda, aVenda: palavras.aVenda, pessoa: palavras.pessoa }}
            />
          )}
        </div>
      ) : null}
    </Estrutura>
  )
}
