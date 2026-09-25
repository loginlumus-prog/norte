import { mostrarDiaDaColuna } from '@/servidor/dia'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { moduloLigado } from '@/servidor/modulos'
import { escolherUnidade } from '@/servidor/unidade'
import { listarParcelas, resumoCrediario, configCrediario, type ParcelaNaLista, type SituacaoParcela } from '@/servidor/crediario'
import { mostrarTelefone } from '@/servidor/cliente'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Tabela } from '@/ui/Tabela'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Numero, Secao, Tira, brl } from '@/ui/painel'
import { Situacao, cx } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { Receber } from './Receber'

// O crediário: quem deve, quanto, desde quando — e receber.
//
// A tela abre nas parcelas EM ABERTO, vencidas primeiro, porque é essa a
// pergunta de quem abre: "quem eu preciso cobrar hoje?". Quitadas ficam num
// filtro, para conferir depois.

// Vencimento é coluna `date` (meia-noite UTC): formatada no fuso do servidor
// mostrava o dia ANTERIOR — "vence 09/10" para a parcela do dia 10.
const dia = (d: Date) => mostrarDiaDaColuna(d, 'curto')

export default async function CrediarioPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; q?: string; situacao?: string; cliente?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, q: qBruto, situacao: sitPedida, cliente: clienteId } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  if (!moduloLigado(empresa, 'crediario') || !pode(sessao, 'crediario.ver')) notFound()

  const onde = await escolherUnidade(sessao, empresa, pedida, 'crediario.ver')
  const q = (qBruto ?? '').trim()
  // Sem filtro no endereço, mostra o que está em aberto. "todas" precisa ser
  // pedido — quitadas de dois anos atrás não são o que a pessoa veio ver.
  const situacao: SituacaoParcela | 'todas' =
    sitPedida === 'vencida' || sitPedida === 'quitada' || sitPedida === 'todas' ? sitPedida : 'aberta'

  const [parcelas, resumo, config] = await Promise.all([
    listarParcelas(sessao, {
      unidadeIds: onde.ids,
      situacao: situacao === 'todas' ? null : situacao,
      q,
      clienteId: clienteId ?? null,
    }),
    resumoCrediario(sessao, onde.ids),
    configCrediario(sessao),
  ])

  const podeReceber = pode(sessao, 'crediario.receber')
  const atuais = { unidade: onde.unidadeId, q, situacao: sitPedida ?? null, cliente: clienteId ?? null }
  const link = (m: Record<string, string | null>) => enderecoCom(`/${slug}/crediario`, atuais, m)

  // Quem deve mais, para a conversa de cobrança começar pelo maior.
  const porCliente = new Map<string, { id: string; nome: string; resta: number; vencido: number }>()
  for (const p of parcelas) {
    if (p.situacao === 'quitada') continue
    const c = porCliente.get(p.clienteId) ?? { id: p.clienteId, nome: p.cliente, resta: 0, vencido: 0 }
    c.resta += p.resta
    if (p.situacao === 'vencida') c.vencido += p.resta
    porCliente.set(p.clienteId, c)
  }
  const devedores = [...porCliente.values()].sort((a, b) => b.vencido - a.vencido || b.resta - a.resta).slice(0, 6)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/crediario`}
      tema={tema}
      titulo="Crediário"
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} /> : undefined}
    >
      <Secao titulo={`Fiado · ${onde.titulo}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            principal
            rotulo="Em aberto"
            valor={brl(resumo.emAberto)}
            detalhe={`${resumo.clientesDevendo} cliente${resumo.clientesDevendo === 1 ? '' : 's'} devendo`}
          />
          <Numero
            rotulo="Vencido"
            valor={brl(resumo.vencido)}
            detalhe={
              resumo.parcelasVencidas
                ? `${resumo.parcelasVencidas} parcela${resumo.parcelasVencidas === 1 ? '' : 's'} · ${resumo.clientesAtrasados} cliente${resumo.clientesAtrasados === 1 ? '' : 's'}`
                : 'ninguém atrasado'
            }
            nivel={resumo.vencido > 0 ? 'critico' : 'bom'}
          />
          <Numero rotulo="Vence em 7 dias" valor={brl(resumo.aVencer7)} detalhe="para lembrar antes" nivel={resumo.aVencer7 > 0 ? 'atencao' : undefined} />
          <Numero
            rotulo="Regra da loja"
            valor={`${config.jurosMes.toLocaleString('pt-BR')}% ao mês`}
            detalhe={`de atraso · até ${config.maxParcelas}× · a cada ${config.diasEntre} dias`}
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
                  {p.juros > 0 && <span className="text-xs text-tinta-3">juros {brl(p.juros)}</span>}
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
                  <span className={cx('numero font-bold', p.situacao === 'vencida' ? 'text-critico' : 'text-tinta')}>
                    {brl(p.resta)}
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
                        <Receber
                          slug={slug}
                          parcelaId={p.id}
                          resta={p.resta}
                          jurosHoje={p.jurosHoje}
                          diasAtraso={p.diasAtraso}
                        />
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

        <Tira
          itens={[
            { rotulo: 'parcelas na lista', um: 'parcela na lista', quantos: parcelas.length, nivel: 'neutro' },
            { rotulo: 'vencidas', um: 'vencida', quantos: parcelas.filter((p) => p.situacao === 'vencida').length, nivel: 'critico' },
            { rotulo: 'quitadas', um: 'quitada', quantos: parcelas.filter((p) => p.situacao === 'quitada').length, nivel: 'bom' },
          ]}
        />
      </Secao>
    </Estrutura>
  )
}
