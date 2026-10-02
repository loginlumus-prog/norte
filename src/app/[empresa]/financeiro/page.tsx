import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { escolherUnidade } from '@/servidor/unidade'
import {
  aVencer, janelaDoMes, lerMes, listarLancamentos, mesDeAgora, montarDRE, outroMes, prepararFinanceiro, resultadoPorMes,
} from '@/servidor/financeiro'
import { diaEmSP } from '@/servidor/dia'
import { garantirRecorrentes, listarRecorrentes, situacaoDoVencimento } from '@/servidor/recorrentes'
import { BarrasMeses, Rosca } from '@/ui/Graficos'
import Link from 'next/link'
import { Tabela } from '@/ui/Tabela'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import type { TipoLancamento } from '@prisma/client'
import { comoOrg } from '@/servidor/banco'
import { pode, podeNoAlcance, unidadesQuePodem } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Aviso, Ponto, cx } from '@/ui/base'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Numero, Secao, Tira, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { DesfazerPagamento, Lancar, Pagar } from './Lancar'
import { Recorrentes } from './Recorrentes'
import { palavra, plural } from '@/ui/texto'
import { registrarErro } from '@/servidor/registro'

export const metadata: Metadata = { title: 'Financeiro' }

// Vencimento e pagamento são colunas DATE, que chegam como meia-noite UTC do
// dia. Formatar no fuso do servidor (Brasil, UTC-3) mostrava o dia ANTERIOR —
// a conta do dia 10 aparecia "09/09". Em UTC, o dia é o dia.
const dia = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d)

const MES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** Porcentagem com vírgula, do jeito brasileiro: "-47,5%". */
const pct = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

export default async function Financeiro({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{
    unidade?: string
    mes?: string
    q?: string
    tipo?: string
    situacao?: string
    categoria?: string
  }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, mes: mesBruto, q: qBruto, tipo: tipoPedido, situacao: sitPedida, categoria: catBruta } =
    await searchParams
  // O mês vem do endereço. `?mes=lixo`, `?mes=2026-13` ou o parâmetro repetido
  // viravam "Invalid Date" no DRE e a tela de erro no lugar do financeiro;
  // fora do formato, vale o mês corrente.
  const mes = lerMes(mesBruto) ?? undefined
  const q = (typeof qBruto === 'string' ? qBruto : '').trim()
  // `?categoria=a&categoria=b` chega como LISTA, e a lista ia direto para o
  // Prisma — tela de erro. Só texto com cara de id passa; o resto é "todas".
  const catPedida = typeof catBruta === 'string' && /^[\w-]{1,64}$/.test(catBruta) ? catBruta : null
  const tipo: TipoLancamento | null = tipoPedido === 'DESPESA' || tipoPedido === 'RECEITA' ? tipoPedido : null
  const situacaoL: 'aberto' | 'pago' | null = sitPedida === 'aberto' || sitPedida === 'pago' ? sitPedida : null
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'financeiro.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const onde = await escolherUnidade(sessao, empresa, pedida, 'financeiro.ver')
  const podeLancar = pode(sessao, 'financeiro.lancar')
  // Configurações só abre para quem configura a empresa. Para o financeiro e
  // o contador, o nome da tela vai como texto: link que cai em "este endereço
  // não abre" parece sistema quebrado.
  const podeConfigurar = pode(sessao, 'empresa.configurar')
  const configuracoes = podeConfigurar ? (
    <Link href={`/${slug}/configuracoes`} className="font-medium text-marca underline-offset-2 hover:underline">
      Configurações
    </Link>
  ) : (
    <b className="font-medium text-tinta-2">Configurações</b>
  )

  // Mês do relatório: o corrente EM SÃO PAULO, ou o que veio no endereço.
  // Era o relógio da máquina, e num servidor em UTC às 22h do dia 30 a tela
  // já abria no mês seguinte, vazio. O fim do DRE é o último milissegundo do
  // mês — o `23:59:59` de antes deixava de fora a venda do último segundo.
  const mesOlhado = mes ?? mesDeAgora()
  const [ano, mesNum] = mesOlhado.split('-').map(Number) as [number, number]
  const { de, ate: inicioDoSeguinte } = janelaDoMes(mesOlhado)
  const ate = new Date(inicioDoSeguinte.getTime() - 1)
  const nomeDoMes = MES[mesNum - 1]!
  const hoje = diaEmSP()

  // Antes de ler: empresa sem categoria nenhuma ganha as padrão (sem elas não
  // dá para lançar nem cadastrar conta recorrente — o cadastro inicial não as
  // cria), e as contas recorrentes do mês, do seguinte e do mês olhado (se
  // futuro) nascem se faltarem. Um de cada vez e FORA do Promise.all: cada um
  // abre a própria transação e escreve; e nenhum deles pode derrubar a tela.
  // Só para quem lança: abrir a tela para LER (contador, suporte, gerente que
  // só vê) não escreve nada no banco.
  if (podeLancar) {
    await prepararFinanceiro(sessao).catch((e) => registrarErro('financeiro.preparar', e))
    await garantirRecorrentes(sessao, mesOlhado).catch((e) => registrarErro('financeiro.recorrentes', e))
  }

  const [contas, dre, categorias, unidades, lancamentos, meses, recorrentes] = await Promise.all([
    aVencer(sessao, onde.ids),
    montarDRE(sessao, onde.ids, de, ate),
    comoOrg(sessao.orgId, (db) =>
      db.categoriaFinanceira.findMany({
        where: { ativa: true },
        orderBy: [{ tipo: 'asc' }, { ordem: 'asc' }],
        select: { id: true, nome: true, tipo: true },
      }),
    ),
    comoOrg(sessao.orgId, (db) =>
      db.contaFinanceira.findMany({
        where: { ativa: true },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true },
      }),
    ),
    listarLancamentos(sessao, {
      unidadeIds: onde.ids,
      ano,
      mes: mesNum,
      tipo,
      situacao: situacaoL,
      categoriaId: catPedida,
      q,
    }),
    resultadoPorMes(sessao, onde.ids, 6),
    listarRecorrentes(sessao, onde.ids),
  ])

  // "Para onde foi o dinheiro": as linhas negativas do DRE que não são
  // total nem informativa — CMV, cada grupo de despesa, financeiras. O que
  // abate a receita (devolução, vale de troca sem a compra, desconto no
  // crediário) não é dinheiro que saiu: é venda que não houve.
  const ABATEM_RECEITA = ['devolucoes', 'semCompra', 'descontoCred']
  const saidas = dre.linhas
    .filter((l) => !l.total && !l.fora && l.valor < 0 && !ABATEM_RECEITA.includes(l.chave))
    .map((l) => ({ rotulo: l.rotulo.replace('(−) ', ''), valor: -l.valor }))

  const categoriaL = categorias.some((c) => c.id === catPedida) ? catPedida : null
  const atuais = {
    unidade: onde.unidadeId,
    mes: mes ?? null,
    q,
    tipo,
    situacao: situacaoL,
    categoria: categoriaL,
  }
  const linkL = (mudanca: Record<string, string | null>) =>
    enderecoCom(`/${slug}/financeiro`, atuais, mudanca)

  const somaL = (t: TipoLancamento) =>
    lancamentos.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0)
  const abertos = lancamentos.filter((l) => !l.pagoEm)
  const nomeDaLoja = new Map(onde.opcoes.map((u) => [u.id, u.nome]))
  const menu = MENU(slug).map((i) =>
    i.href === `/${slug}/financeiro` && contas.vencidas.length > 0
      ? {
          ...i,
          aviso: { quantos: contas.vencidas.length, nivel: 'critico' as const, titulo: palavra(contas.vencidas.length, 'vencida', 'vencidas') },
        }
      : i,
  )

  const link = (m: string) =>
    `/${slug}/financeiro?mes=${m}` + (onde.unidadeId ? `&unidade=${onde.unidadeId}` : '')

  // Onde o lançamento novo cai. Olhando uma loja, nela. Olhando o conjunto,
  // "sem loja" é da empresa inteira — e isso só lança quem alcança a empresa
  // inteira; os outros escolhem uma das lojas em que lançam.
  const lojasDeLancar =
    podeLancar && onde.unidadeId === null && !podeNoAlcance(sessao, 'financeiro.lancar', null)
      ? onde.opcoes.filter((u) => pode(sessao, 'financeiro.lancar', u.id)).map((u) => ({ id: u.id, nome: u.nome }))
      : undefined
  // Baixa e "desfazer" só aparecem onde a pessoa pode mexer: na conta da
  // empresa inteira, só quem lança na empresa inteira.
  const lancaNaEmpresa = unidadesQuePodem(sessao, 'financeiro.lancar') === 'todas'
  const podeMexer = (unidadeId: string | null) =>
    podeLancar && (unidadeId === null ? lancaNaEmpresa : pode(sessao, 'financeiro.lancar', unidadeId))

  // Uma conta a pagar, na lista das vencidas ou das a vencer.
  //
  // No celular a conta ocupa a linha inteira e a etiqueta, o valor e o
  // "Paguei" descem para baixo dela. Lado a lado, sobravam 90px para o nome:
  // "Pedido de…", "Manutenç…" — e a pessoa pagava sem ler o quê.
  const linhaDeConta = (c: Omit<(typeof contas.vencidas)[number], 'dias'> & { nivel: 'critico' | 'atencao' | 'neutro'; quando: string }) => (
    <li
      key={c.id}
      className="flex flex-col gap-2 border-b border-borda-suave py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-2"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-tinta sm:truncate">{c.descricao}</span>
        <span className="text-xs text-tinta-3">vence {dia(c.vencimento)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Situacao nivel={c.nivel}>{c.quando}</Situacao>
        <span className="numero ml-auto text-sm font-semibold text-tinta sm:ml-0 sm:w-24 sm:text-right">
          {brl(c.valor)}
        </span>
        {podeMexer(c.unidadeId) && <Pagar slug={slug} id={c.id} hoje={hoje} />}
      </span>
    </li>
  )

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}/financeiro`}
      tema={tema}
      titulo="Financeiro"
      acao={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* O fechamento fica AQUI, e não no menu: ele é a última coisa que
              se faz no financeiro, uma vez por mês. Item de menu para algo
              mensal ocupa espaço todo dia para servir num. */}
          <Link
            href={`/${slug}/financeiro/fechamento`}
            className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
            title="A lista do que conferir antes de dar o mês por fechado"
          >
            Fechar o mês
          </Link>
          <a
            href={`/${slug}/financeiro/exportar?${new URLSearchParams(
              Object.entries({ mes: mesOlhado, tipo, situacao: situacaoL, categoria: categoriaL, q, unidade: onde.unidadeId }).filter(
                (par): par is [string, string] => typeof par[1] === 'string' && par[1] !== '',
              ),
            )}`}
            className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
            title="Baixar em planilha os lançamentos deste mês, com os filtros desta tela"
          >
            Planilha
          </a>
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
        </div>
      }
    >
      {/* ── A PAGAR ── */}
      <Secao titulo="Contas a pagar">
        <Tira
          itens={[
            // As vencidas não entram: o aviso vermelho logo abaixo já conta
            // quantas são e quanto somam — na tira, era o mesmo número duas vezes.
            { rotulo: 'vencem hoje', um: 'vence hoje', quantos: contas.hoje.length, nivel: 'atencao' },
            { rotulo: 'vencem nos próximos 15 dias', um: 'vence nos próximos 15 dias', quantos: contas.proximas.length, nivel: 'neutro' },
          ]}
        />

        {/* Pulsa: juro corre enquanto a conta fica aqui. E o unico aviso
            desta tela que piora sozinho com o tempo. */}
        {contas.vencidas.length > 0 && (
          <Aviso nivel="critico" pulsa>
            {contas.vencidas.length} conta{contas.vencidas.length === 1 ? '' : 's'} vencida
            {contas.vencidas.length === 1 ? '' : 's'}, somando {brl(contas.totalVencido)}. Juro e
            multa correm enquanto ficam aqui.
          </Aviso>
        )}

        {/* VENCIDAS e A VENCER em cartões separados: "A vencer" com conta
            "há 23 dias" era o título dizendo uma coisa e a linha outra. */}
        {contas.vencidas.length > 0 && (
          <Cartao titulo="Vencidas" acao={<Ponto nivel="critico" quantos={contas.vencidas.length} titulo="vencidas" />}>
            <ul className="flex flex-col">
              {contas.vencidas.map((c) =>
                linhaDeConta({ ...c, nivel: 'critico' as const, quando: `há ${plural(c.dias, 'dia', 'dias')}` }),
              )}
            </ul>
          </Cartao>
        )}

        <Cartao titulo="A vencer">
          {contas.hoje.length + contas.proximas.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm font-medium text-bom">
              <span aria-hidden className="size-2 rounded-full bg-bom-vivo" />
              Nada vencendo nos próximos 15 dias.
            </p>
          ) : (
            <ul className="flex flex-col">
              {[
                ...contas.hoje.map((c) => ({ ...c, nivel: 'atencao' as const, quando: 'hoje' })),
                ...contas.proximas.map((c) => ({ ...c, nivel: 'neutro' as const, quando: `em ${plural(c.dias, 'dia', 'dias')}` })),
              ].map(linhaDeConta)}
            </ul>
          )}
        </Cartao>

        {podeLancar && (
          <Lancar
            slug={slug}
            categorias={categorias}
            contas={unidades}
            unidadeId={onde.unidadeId}
            lojas={lojasDeLancar}
            hoje={hoje}
          />
        )}
      </Secao>

      {/* ── RECORRENTES ──
          O que se paga todo mês sem ninguém precisar lembrar. Fica logo
          depois das contas a pagar porque é de onde boa parte delas vem. */}
      <Secao
        titulo="Contas que se repetem"
        resumo="Cadastre uma vez; o lançamento de cada mês nasce sozinho."
      >
        <Recorrentes
          slug={slug}
          lista={recorrentes.map((r) => ({
            ...r,
            unidadeNome: r.unidadeId ? (nomeDaLoja.get(r.unidadeId) ?? null) : null,
            editavel: podeMexer(r.unidadeId),
          }))}
          categorias={categorias}
          lojas={onde.opcoes.filter((u) => pode(sessao, 'financeiro.lancar', u.id)).map((u) => ({ id: u.id, nome: u.nome }))}
          lojaAtual={onde.unidadeId}
          podeLancar={podeLancar}
          empresaInteira={lancaNaEmpresa}
        />
      </Secao>

      {/* ── LANÇAMENTOS ──
          O DRE agrega; isto é a prova dele. "Quanto paguei de fornecedor em
          agosto" e "esse R$ 1.200 é o quê" não tinham onde ser olhados. */}
      <Secao
        titulo={`Lançamentos de ${nomeDoMes}`}
        resumo="Tudo que vence neste mês, pago ou não."
        acao={
          <Fichas
            opcoes={[
              { valor: null, rotulo: 'tudo', quantos: lancamentos.length },
              { valor: 'aberto', rotulo: 'em aberto', quantos: abertos.length },
              { valor: 'pago', rotulo: 'pagos', quantos: lancamentos.length - abertos.length },
            ]}
            atual={situacaoL}
            linkDe={(v) => linkL({ situacao: v })}
          />
        }
      >
        <div className="flex flex-col gap-2">
          <Busca
            valor={q}
            placeholder="Descrição, fornecedor ou número do documento"
            rotulo="Buscar lançamento"
            manter={{ unidade: onde.unidadeId, mes: mes ?? null, tipo, situacao: situacaoL, categoria: categoriaL }}
            limparEm={linkL({ q: null })}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Fichas
              opcoes={[
                { valor: null, rotulo: 'despesas e receitas' },
                { valor: 'DESPESA', rotulo: 'só despesas' },
                { valor: 'RECEITA', rotulo: 'só receitas' },
              ]}
              atual={tipo}
              linkDe={(v) => linkL({ tipo: v })}
            />
            {/* Vinte categorias em fichas soltas eram uma parede de 300px
                antes da tabela. Fechadas num "Categoria: …", elas ficam a um
                toque — e sem JavaScript, que <details> abre sozinho. Com uma
                categoria escolhida, nasce aberto: filtro ativo não se esconde. */}
            <details open={!!categoriaL} className="group w-full">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-borda px-3 py-1.5 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta [&::-webkit-details-marker]:hidden">
                Categoria:{' '}
                <span className="text-tinta">{categorias.find((c) => c.id === categoriaL)?.nome ?? 'todas'}</span>
                <span aria-hidden className="text-tinta-3 transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="pt-2">
                <Fichas
                  opcoes={[
                    { valor: null, rotulo: 'todas as categorias' },
                    ...categorias
                      .filter((c) => !tipo || c.tipo === tipo)
                      .map((c) => ({ valor: c.id, rotulo: c.nome })),
                  ]}
                  atual={categoriaL}
                  linkDe={(v) => linkL({ categoria: v })}
                />
              </div>
            </details>
          </div>
        </div>

        <Cartao
          titulo={`${lancamentos.length} lançamento${lancamentos.length === 1 ? '' : 's'}`}
          acao={
            <span className="flex gap-4 text-xs text-tinta-3">
              <span>
                despesas <b className="numero text-tinta-2">{brl(somaL('DESPESA'))}</b>
              </span>
              <span>
                receitas <b className="numero text-tinta-2">{brl(somaL('RECEITA'))}</b>
              </span>
            </span>
          }
        >
          <Tabela
            colunas={[
              {
                chave: 'venc',
                titulo: 'Vence',
                celula: (l: (typeof lancamentos)[number]) => (
                  <span className="numero text-tinta-2">{dia(l.vencimento)}</span>
                ),
              },
              {
                chave: 'desc',
                titulo: 'Lançamento',
                // No cartão do celular, o lançamento é o título e a data
                // desce para uma linha "Vence".
                tituloDoCartao: true,
                celula: (l: (typeof lancamentos)[number]) => (
                  // O nome quebra em até duas linhas em vez de esticar a
                  // tabela: esticada, ela empurrava o VALOR para fora da tela
                  // do celular. E no celular a situação vem aqui dentro, já
                  // que a coluna dela some (`escondeNoCelular`).
                  <span className="flex min-w-40 flex-col gap-0.5">
                    <span className="line-clamp-2 text-tinta">{l.descricao}</span>
                    <span className="sm:hidden">
                      {l.pagoEm ? (
                        <Situacao nivel="bom">pago {dia(l.pagoEm)}</Situacao>
                      ) : situacaoDoVencimento(l.vencimento) === 'vencida' ? (
                        <Situacao nivel="critico">vencido</Situacao>
                      ) : (
                        <Situacao nivel="neutro">em aberto</Situacao>
                      )}
                    </span>
                    <span className="text-xs text-tinta-3">
                      {/* Etiqueta com texto, não só o símbolo: "↻" sozinho
                          ninguém sabe o que é. */}
                      {l.recorrente && (
                        <span className="mr-1.5 inline-flex items-center gap-1 rounded-full border border-borda px-1.5 py-px font-semibold text-tinta-2">
                          <span aria-hidden>↻</span> recorrente
                        </span>
                      )}
                      {l.categoria}
                      {l.fornecedor ? ` · ${l.fornecedor}` : ''}
                      {l.documento ? ` · ${l.documento}` : ''}
                    </span>
                  </span>
                ),
              },
              {
                chave: 'sit',
                titulo: '',
                largura: '7rem',
                escondeNoCelular: true,
                celula: (l: (typeof lancamentos)[number]) =>
                  l.pagoEm ? (
                    <Situacao nivel="bom">pago {dia(l.pagoEm)}</Situacao>
                  ) : situacaoDoVencimento(l.vencimento) === 'vencida' ? (
                    <Situacao nivel="critico">vencido</Situacao>
                  ) : (
                    <Situacao nivel="neutro">em aberto</Situacao>
                  ),
              },
              {
                chave: 'valor',
                titulo: 'Valor',
                numero: true,
                destaque: true,
                celula: (l: (typeof lancamentos)[number]) => (
                  <span className={'numero font-semibold whitespace-nowrap ' + (l.tipo === 'RECEITA' ? 'text-bom' : 'text-tinta')}>
                    {l.tipo === 'RECEITA' ? '+ ' : ''}
                    {brl(l.valor)}
                  </span>
                ),
              },
              ...(podeLancar
                ? [
                    {
                      chave: 'acao',
                      titulo: '',
                      largura: '6rem',
                      // O "Pagar" fica ao lado do valor, à vista no cartão.
                      destaque: true,
                      celula: (l: (typeof lancamentos)[number]) =>
                        !podeMexer(l.unidadeId) ? null : l.pagoEm ? (
                          <DesfazerPagamento slug={slug} id={l.id} />
                        ) : (
                          <Pagar slug={slug} id={l.id} hoje={hoje} />
                        ),
                    },
                  ]
                : []),
            ]}
            linhas={lancamentos}
            chave={(l) => l.id}
            vazio={q || tipo || situacaoL || categoriaL ? 'Nada com esse filtro.' : 'Nada lançado neste mês.'}
          />
        </Cartao>
      </Secao>

      {/* ── DRE ── */}
      <Secao titulo="Resultado do mês" resumo="Pelo dia em que foi pago: a conta paga no mês seguinte entra no seguinte.">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <a href={link(outroMes(mesOlhado, -1))} className="rounded px-2 py-1 text-tinta-2 hover:bg-superficie-2">
              ←
            </a>
            <span className="font-semibold text-tinta">
              {nomeDoMes} de {ano}
            </span>
            <a href={link(outroMes(mesOlhado, 1))} className="rounded px-2 py-1 text-tinta-2 hover:bg-superficie-2">
              →
            </a>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Numero
            rotulo="Resultado do mês"
            valor={brl(dre.resultado)}
            detalhe={dre.resultado >= 0 ? 'sobrou' : 'faltou'}
            nivel={dre.resultado >= 0 ? 'bom' : 'critico'}
          />
          <Numero
            rotulo="Margem líquida"
            valor={pct(dre.margem)}
            detalhe="sobra sobre o que entrou"
            nivel={dre.margem >= 15 ? 'bom' : dre.margem >= 5 ? 'atencao' : 'critico'}
          />
        </div>

        <Cartao titulo="Demonstrativo">
          <div className="flex flex-col">
            {dre.linhas.map((l) => (
              <div key={l.chave}>
                <div
                  className={cx(
                    'flex items-baseline justify-between gap-4 py-2',
                    l.fora
                      ? 'mt-3 rounded-norte bg-superficie-2 px-2 text-tinta-2'
                      : l.total
                        ? 'border-t border-borda font-bold text-tinta'
                        : 'border-b border-borda-suave text-tinta-2',
                  )}
                >
                  <span className="text-sm">{l.rotulo}</span>
                  <span
                    className={cx(
                      'numero text-sm',
                      l.total && l.valor < 0 && 'text-critico',
                      l.total && l.valor > 0 && l.chave === 'resultado' && 'text-bom',
                    )}
                  >
                    {brl(l.valor)}
                  </span>
                </div>
                {l.itens && l.itens.length > 1 && (
                  <ul className="mb-1 flex flex-col gap-0.5 pl-4">
                    {l.itens.map((i) => (
                      <li key={i.nome} className="flex justify-between gap-4 text-xs text-tinta-3">
                        <span>{i.nome}</span>
                        <span className="numero">{brl(i.valor)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-tinta-3">
            As despesas contam pelo que foi <b>pago</b> no mês, não pelo que venceu — é o que
            bate com o extrato. A mercadoria é a exceção: comprar não é despesa, vira custo
            quando a peça vende (a linha do CMV). Por isso a compra aparece separada, fora
            da conta do resultado.
            {dre.linhas.some((l) => l.chave === 'empresa') && (
              <>
                {' '}As contas da empresa inteira (sem loja) entram no resultado de &ldquo;Todas as
                unidades&rdquo;; olhando uma loja, aparecem à parte, para não pesarem em cada loja.
              </>
            )}
            {dre.taxasCalculadas > 0 ? (
              <>
                {' '}As taxas de cartão e Pix ({brl(dre.taxasCalculadas)}) são calculadas venda a venda
                com o que está em {configuracoes}.
              </>
            ) : (
              <>
                {' '}A taxa da maquininha ainda não entra: {podeConfigurar ? 'escreva as suas' : 'quem configura a empresa escreve as taxas'} em{' '}
                {configuracoes} e o resultado passa a descontá-la sozinho.
              </>
            )}
          </p>
        </Cartao>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Cartao caixa titulo="Entrou × saiu, nos últimos 6 meses">
            <BarrasMeses
              rotulos={meses.map((m) => m.rotulo)}
              series={[
                { nome: 'Receita', cor: 'var(--bom-vivo)', valores: meses.map((m) => m.receita) },
                { nome: 'Saiu (mercadoria, impostos, despesas, taxas)', cor: 'var(--critico-vivo)', valores: meses.map((m) => m.cmv + m.despesas + m.taxas) },
              ]}
            />
            <ul className="mt-3 grid grid-cols-3 gap-1 text-xs sm:grid-cols-6">
              {meses.map((m) => (
                <li key={m.mes} className="flex flex-col items-center rounded bg-superficie-2 px-1 py-1">
                  <span className="text-tinta-3">{m.rotulo}</span>
                  <span className={cx('numero font-semibold', m.resultado < 0 ? 'text-critico' : 'text-bom')}>
                    {m.resultado < 0 ? '−' : ''}
                    {brl(Math.abs(m.resultado)).replace('R$ ', '')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-tinta-3">
              Embaixo de cada mês, o resultado: o que sobrou ou faltou. É a mesma conta do quadro acima, mês a mês.
            </p>
          </Cartao>
          <Cartao caixa titulo={`Para onde foi o dinheiro em ${nomeDoMes}`}>
            <Rosca fatias={saidas} vazio="Nada saiu neste mês." />
          </Cartao>
        </div>
      </Secao>
    </Estrutura>
  )
}
