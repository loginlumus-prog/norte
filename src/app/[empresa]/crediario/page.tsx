import type { Metadata } from 'next'
import { mostrarDiaDaColuna } from '@/servidor/dia'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { moduloLigado } from '@/servidor/modulos'
import { escolherUnidade } from '@/servidor/unidade'
import { contarParcelas, listarParcelas, maioresDevedores, resumoCrediario, configCrediario, type ParcelaNaLista, type SituacaoParcela } from '@/servidor/crediario'
import { mostrarTelefone } from '@/servidor/cliente'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Tabela } from '@/ui/Tabela'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Numero, Secao, brl } from '@/ui/painel'
import { Paginas } from '@/ui/Paginas'
import { plural } from '@/ui/texto'
import { lerPagina, paginar } from '@/ui/paginacao'
import { Situacao, cx } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { recibosDoCliente, type ReciboNaLista } from '@/servidor/recibos'
import { BotaoReceber } from './BotaoReceber'
import { RegraDoAtraso } from './RegraDoAtraso'
import { ListaDeRecibos } from './Recibos'

export const metadata: Metadata = { title: 'Crediário' }

// O crediário: quem deve, quanto, desde quando — e receber.
//
// A tela abre nas parcelas EM ABERTO, vencidas primeiro, porque é essa a
// pergunta de quem abre: "quem eu preciso cobrar hoje?". Quitadas ficam num
// filtro, para conferir depois.

// Vencimento é coluna `date` (meia-noite UTC): formatada no fuso do servidor
// mostrava o dia ANTERIOR — "vence 09/10" para a parcela do dia 10.
const dia = (d: Date) => mostrarDiaDaColuna(d, 'curto')

/** Parcelas por página. Cada linha tem o botão de receber. */
const POR_PAGINA = 100

export default async function CrediarioPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; q?: string; situacao?: string; cliente?: string; pagina?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, q: qBruto, situacao: sitPedida, cliente: clienteId, pagina: paginaPedida } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  if (!moduloLigado(empresa, 'crediario') || !pode(sessao, 'crediario.ver')) notFound()

  const onde = await escolherUnidade(sessao, empresa, pedida, 'crediario.ver')
  const q = (qBruto ?? '').trim()
  // Sem filtro no endereço, mostra o que está em aberto. "todas" precisa ser
  // pedido — quitadas de dois anos atrás não são o que a pessoa veio ver.
  const situacao: SituacaoParcela | 'todas' =
    sitPedida === 'vencida' || sitPedida === 'quitada' || sitPedida === 'todas' ? sitPedida : 'aberta'

  const filtro = {
    unidadeIds: onde.ids,
    situacao: situacao === 'todas' ? null : situacao,
    q,
    clienteId: clienteId ?? null,
  }
  // A página é pedida ao banco (com a contagem para saber quantas são): o
  // carnê de uma loja de verdade passa de oito mil parcelas, e o teto antigo
  // de 500 cortava a lista sem avisar. Ver ui/paginacao.ts.
  const total = await contarParcelas(sessao, filtro)
  const pag = paginar(total, lerPagina(paginaPedida), POR_PAGINA)
  const [parcelas, resumo, config, maiores, recibos] = await Promise.all([
    listarParcelas(sessao, { ...filtro, pagina: pag.pagina, porPagina: POR_PAGINA }),
    resumoCrediario(sessao, onde.ids),
    configCrediario(sessao),
    maioresDevedores(sessao, onde.ids, 6),
    clienteId ? recibosDoCliente(sessao, clienteId, 20) : Promise.resolve([] as ReciboNaLista[]),
  ])

  // Receber é por LOJA (cada loja é um credor, com o caixa dela): o botão de
  // cada linha abre na loja da parcela.
  const podeReceberEm = (u: string) => pode(sessao, 'crediario.receber', u)
  const podeReceber = onde.ids.some(podeReceberEm)
  const podeConfigurar = pode(sessao, 'empresa.configurar')
  const nomeDoCliente = clienteId ? parcelas.find((p) => p.clienteId === clienteId)?.cliente ?? null : null
  const atuais = { unidade: onde.unidadeId, q, situacao: sitPedida ?? null, cliente: clienteId ?? null }
  const link = (m: Record<string, string | null>) => enderecoCom(`/${slug}/crediario`, atuais, m)

  // Quem deve mais, para a conversa de cobrança começar pelo maior — somado
  // no banco sobre o carnê inteiro, não sobre a página que está na tela.
  const devedores = maiores

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/crediario`}
      tema={tema}
      titulo="Crediário"
      acao={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* "Veio só pagar": procura a cliente e recebe. Precisa da loja
              escolhida — o dinheiro entra no caixa dela. */}
          {onde.unidadeId && podeReceberEm(onde.unidadeId) && (
            <BotaoReceber slug={slug} unidadeId={onde.unidadeId} clienteId={clienteId ?? null} tom="confirmar">
              Receber parcela
            </BotaoReceber>
          )}
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
        </div>
      }
    >
      <Secao titulo={`Fiado · ${onde.titulo}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            principal
            rotulo="Em aberto"
            valor={brl(resumo.emAberto)}
            detalhe={`${plural(resumo.clientesDevendo, 'cliente', 'clientes')} devendo`}
          />
          <Numero
            rotulo="Vencido"
            valor={brl(resumo.vencido)}
            detalhe={
              resumo.parcelasVencidas
                ? `${plural(resumo.parcelasVencidas, 'parcela', 'parcelas')} · ${plural(resumo.clientesAtrasados, 'cliente', 'clientes')}`
                : 'ninguém atrasado'
            }
            nivel={resumo.vencido > 0 ? 'critico' : 'bom'}
          />
          <Numero rotulo="Vence em 7 dias" valor={brl(resumo.aVencer7)} detalhe="para lembrar antes" nivel={resumo.aVencer7 > 0 ? 'atencao' : undefined} />
          <Numero
            rotulo="Regra do atraso"
            valor={`${config.multaPct.toLocaleString('pt-BR')}% + ${config.jurosMes.toLocaleString('pt-BR')}% ao mês`}
            detalhe={`multa uma vez + juro por dia${config.carenciaDias ? ` · ${plural(config.carenciaDias, 'dia', 'dias')} de carência` : ''} · até ${config.maxParcelas}×`}
          />
        </div>

        {devedores.length > 0 && (situacao === 'aberta' || situacao === 'vencida') && !clienteId && (
          <div className="flex flex-wrap gap-1.5">
            {devedores.map((d) => (
              <Link
                key={d.id}
                href={link({ cliente: d.id })}
                className={cx(
                  'flex items-baseline gap-2 rounded-full border px-3 py-1 text-xs',
                  d.vencido > 0 ? 'border-critico-borda bg-critico-fundo text-critico' : 'border-borda bg-superficie text-tinta-2',
                )}
              >
                <span className="font-semibold">{d.nome}</span>
                <span className="numero">{brl(d.resta)}</span>
              </Link>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Busca
            valor={q}
            placeholder="Nome do cliente ou número da venda"
            rotulo="Buscar no crediário"
            manter={{ unidade: onde.unidadeId, situacao: sitPedida ?? null }}
            limparEm={link({ q: null, cliente: null })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Fichas
              opcoes={[
                { valor: null, rotulo: 'em aberto' },
                { valor: 'vencida', rotulo: 'vencidas' },
                { valor: 'quitada', rotulo: 'quitadas' },
                { valor: 'todas', rotulo: 'todas' },
              ]}
              atual={sitPedida === 'vencida' || sitPedida === 'quitada' || sitPedida === 'todas' ? sitPedida : null}
              linkDe={(v) => link({ situacao: v })}
            />
            {clienteId && (
              <Link href={link({ cliente: null })} className="text-xs text-tinta-3 underline-offset-2 hover:underline">
                ver todos os clientes
              </Link>
            )}
          </div>
        </div>

        <Tabela
          colunas={[
            {
              chave: 'cliente',
              titulo: 'Cliente',
              celula: (p: ParcelaNaLista) => (
                <span className="flex flex-col">
                  <Link href={`/${slug}/clientes/${p.clienteId}`} className="font-medium text-tinta underline-offset-2 hover:underline">
                    {p.cliente}
                  </Link>
                  <span className="text-xs text-tinta-3">{mostrarTelefone(p.telefone) || 'sem telefone'}</span>
                </span>
              ),
            },
            {
              chave: 'venda',
              titulo: 'Venda',
              largura: '7rem',
              celula: (p: ParcelaNaLista) => (
                <Link href={`/${slug}/vendas/${p.vendaId}`} className="flex flex-col text-xs text-tinta-2 underline-offset-2 hover:underline">
                  <span className="numero text-sm text-tinta">nº {p.vendaNumero}</span>
                  <span>
                    parcela {p.numero}/{p.de}
                  </span>
                </Link>
              ),
            },
            {
              chave: 'venc',
              titulo: 'Vence',
              largura: '8rem',
              celula: (p: ParcelaNaLista) => (
                <span className="flex flex-col">
                  <span className="numero text-tinta">{dia(p.vencimento)}</span>
                  {p.situacao === 'vencida' ? (
                    <Situacao nivel="critico">
                      {p.diasAtraso} dia{p.diasAtraso === 1 ? '' : 's'} atrasada
                    </Situacao>
                  ) : p.situacao === 'quitada' ? (
                    <Situacao nivel="bom">quitada</Situacao>
                  ) : (
                    <Situacao nivel="neutro">em dia</Situacao>
                  )}
                </span>
              ),
            },
            {
              chave: 'valor',
              titulo: 'Valor',
              numero: true,
              largura: '7rem',
              celula: (p: ParcelaNaLista) => (
                <span className="flex flex-col items-end">
                  <span className="numero text-tinta">{brl(p.valor)}</span>
                  {p.pago > 0 && <span className="text-xs text-tinta-3">pago {brl(p.pago)}</span>}
                  {p.desconto > 0 && <span className="text-xs text-tinta-3">desconto {brl(p.desconto)}</span>}
                  {p.juros + p.multa > 0 && <span className="text-xs text-tinta-3">atraso pago {brl(p.juros + p.multa)}</span>}
                </span>
              ),
            },
            {
              chave: 'resta',
              titulo: 'Resta',
              numero: true,
              largura: '7rem',
              celula: (p: ParcelaNaLista) =>
                p.situacao === 'quitada' ? (
                  <span className="numero text-tinta-3">—</span>
                ) : (
                  <span className="flex flex-col items-end">
                    <span className={cx('numero font-bold', p.situacao === 'vencida' ? 'text-critico' : 'text-tinta')}>
                      {brl(p.resta)}
                    </span>
                    {p.multaHoje + p.jurosHoje > 0 && (
                      <span className="numero text-xs text-critico">+ {brl(p.multaHoje + p.jurosHoje)} atraso</span>
                    )}
                  </span>
                ),
            },
            ...(podeReceber
              ? [
                  {
                    chave: 'receber',
                    titulo: '',
                    largura: '8rem',
                    celula: (p: ParcelaNaLista) =>
                      p.situacao === 'quitada' ? null : (
                        podeReceberEm(p.unidadeId) ? (
                          <BotaoReceber slug={slug} unidadeId={p.unidadeId} clienteId={p.clienteId} marcar={[p.id]} className="py-1 text-xs">
                            Receber
                          </BotaoReceber>
                        ) : null
                      ),
                  },
                ]
              : []),
          ]}
          linhas={parcelas}
          chave={(p) => p.id}
          vazio={
            q || clienteId
              ? 'Nada com esse filtro.'
              : situacao === 'vencida'
                ? 'Ninguém atrasado. Bom sinal.'
                : situacao === 'quitada'
                  ? 'Nenhuma parcela quitada ainda.'
                  : 'Nenhuma parcela em aberto. Vender no crediário é escolher a forma no balcão.'
          }
        />

        <Paginas p={pag} linkDe={(n) => link({ pagina: String(n) })} rotulo={pag.total === 1 ? 'parcela' : 'parcelas'} />
      </Secao>

      {clienteId && recibos.length > 0 && (
        <Secao titulo={`Recibos${nomeDoCliente ? ` · ${nomeDoCliente}` : ''}`} resumo="O que foi pago junto, em cada vez. Reimprima o recibo quando ela pedir.">
          <ListaDeRecibos slug={slug} recibos={recibos} />
        </Secao>
      )}

      {podeConfigurar && (
        <Secao titulo="Regra do atraso" resumo="Vale para toda a empresa, a partir do próximo recebimento.">
          <RegraDoAtraso slug={slug} inicial={config} />
        </Secao>
      )}
    </Estrutura>
  )
}

