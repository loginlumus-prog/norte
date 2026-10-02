import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { vocabularioDaEmpresa } from '@/servidor/vocabulario'
import { comoOrg } from '@/servidor/banco'
import { pode, podeVerPlanos, textoDaBusca, unidadesQuePodem } from '@/servidor/permissao'
import { saldoNaVista } from '@/servidor/produto'
import { plural } from '@/ui/texto'
import { escolherUnidade } from '@/servidor/unidade'
import { conferirSaldos, listarMovimentos, ROTULO_MOVIMENTO, type MovimentoNaLista } from '@/servidor/estoque'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { moduloLigado } from '@/servidor/modulos'
import { planoDaEmpresa } from '@/servidor/relatorios'
import { liberado } from '@/servidor/planos'
import { previsaoDeRuptura, preverRuptura, JANELA_DIAS, type LinhaRuptura } from '@/servidor/ruptura'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Vazio, Aviso, cx } from '@/ui/base'
import { Tira, Secao } from '@/ui/painel'
import { Tabela, type Coluna } from '@/ui/Tabela'
import { Trancado } from '@/ui/Cadeado'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { SeletorPeriodo } from '@/ui/Periodo'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import { Paginas } from '@/ui/Paginas'
import { codigoBate } from '@/servidor/etiqueta'
import { fatiar, lerPagina } from '@/ui/paginacao'
import type { Tema } from '@/ui/TrocaTema'
import type { TipoMovimento } from '@prisma/client'

type SituacaoItem = 'acabaram' | 'minimo' | 'ok'
import { Entrada } from './Entrada'
import { Corrigir } from './Corrigir'
import { Minimo } from './Minimo'
import { Transferir } from './Transferir'
import { VendidoSemEstoque } from './VendidoSemEstoque'

export const metadata: Metadata = { title: 'Estoque' }

/** Linhas por página nas listas da tela, e o teto do "Precisa comprar". */
const POR_PAGINA = 100
const PRECISA_MAX = 40

const TIPOS: TipoMovimento[] = ['ENTRADA', 'VENDA', 'DEVOLUCAO', 'AJUSTE', 'PERDA', 'TRANSFERENCIA', 'BALANCO', 'CONSUMO']
const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)

// A tela do estoque.
//
// Ela abre pelo que PRECISA DE AÇÃO, não pela lista inteira: o que acabou e o
// que está no mínimo vêm primeiro, e a lista completa fica embaixo. Lista de
// 800 itens em ordem alfabética é bonita e não serve para nada — ninguém rola
// até o fim para descobrir o que falta comprar.

const MEDIDA: Record<string, string> = {
  UN: 'un', KG: 'kg', G: 'g', L: 'L', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx',
}

const qtd = (v: number, medida: string) => {
  const texto = Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace('.', ',')
  return `${texto} ${MEDIDA[medida] ?? ''}`
}

// ── vai faltar ───────────────────────────────────────────────

const diaMes = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d)

/**
 * A amostra do plano sem previsão. Inventada, e é isso que a tranca exige:
 * a forma inteira, sem nenhum número que o plano não pagou.
 */
function amostraRuptura(): LinhaRuptura[] {
  const hoje = new Date()
  const base = [
    { variacaoId: 'amostra-1', nome: 'Camiseta canelada', codigo: 'CAM002', opcoes: 'Preto · M', saldo: 0, vendidos30: 24, prazoDias: 10 },
    { variacaoId: 'amostra-2', nome: 'Meia cano alto', codigo: 'MEI001', opcoes: '', saldo: 6, vendidos30: 51, prazoDias: null },
    { variacaoId: 'amostra-3', nome: 'Calça jogger', codigo: 'CAL003', opcoes: 'Cinza · 42', saldo: 4, vendidos30: 12, prazoDias: 15 },
    { variacaoId: 'amostra-4', nome: 'Boné aba reta', codigo: 'BON001', opcoes: 'Azul', saldo: 9, vendidos30: 18, prazoDias: null },
    { variacaoId: 'amostra-5', nome: 'Jaqueta corta-vento', codigo: 'JAQ001', opcoes: 'G', saldo: 7, vendidos30: 8, prazoDias: 20 },
  ]
  return base.map((b) => ({
    ...b,
    previsao: preverRuptura({ saldo: b.saldo, vendidos30: b.vendidos30, prazoDias: b.prazoDias, hoje }),
  }))
}

const URGENTES: LinhaRuptura['previsao']['situacao'][] = ['ja_faltou', 'pedir_agora', 'atencao']

function SituacaoRuptura({ s }: { s: LinhaRuptura['previsao']['situacao'] }) {
  switch (s) {
    case 'ja_faltou': return <Situacao nivel="critico">já faltou</Situacao>
    case 'pedir_agora': return <Situacao nivel="critico">pedir agora</Situacao>
    case 'atencao': return <Situacao nivel="atencao">atenção</Situacao>
    case 'ok': return <Situacao nivel="bom">ok</Situacao>
    case 'sem_giro': return <Situacao nivel="neutro">sem giro</Situacao>
  }
}

export default async function TelaEstoque({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; q?: string; situacao?: string; periodo?: string; tipo?: string; pagina?: string; mov?: string }>
}) {
  const { empresa: slug } = await params
  const bruto = await searchParams
  // O endereço é do usuário: `?q=a&q=b` chega como LISTA e derrubava a tela
  // no `.trim()`. Só texto passa daqui; ver `textoDaBusca`.
  const texto = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const pedida = texto(bruto.unidade)
  const sitPedida = texto(bruto.situacao)
  const periodoPedido = texto(bruto.periodo)
  const tipoPedido = texto(bruto.tipo)
  const q = textoDaBusca(bruto.q)
  const situacao: SituacaoItem | null =
    sitPedida === 'acabaram' || sitPedida === 'minimo' || sitPedida === 'ok' ? sitPedida : null
  const tipo = TIPOS.find((t) => t === tipoPedido) ?? null
  const j = janela(lerPeriodo(periodoPedido))
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'estoque.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const onde = await escolherUnidade(sessao, empresa, pedida, 'estoque.ver')
  // O que chega do fornecedor: "mercadoria" na loja, "material" na clínica.
  const vocab = await vocabularioDaEmpresa(sessao.orgId)
  const movimentos = await listarMovimentos(sessao, {
    unidadeIds: onde.ids,
    de: j.de,
    ate: j.ate,
    tipos: tipo ? [tipo] : null,
    q,
  })
  // Transferir só faz sentido com mais de uma loja E com uma loja escolhida:
  // no consolidado não se sabe de onde a peça sairia.
  const destinos =
    moduloLigado(empresa, 'multiUnidade') && onde.unidadeId
      ? onde.opcoes.filter((u) => u.id !== onde.unidadeId && pode(sessao, 'estoque.ajustar', u.id))
      : []
  // Dar entrada é sempre EM UMA loja. Com a loja escolhida no alto, é ela;
  // no consolidado ("Todas as unidades"), a pessoa escolhe no próprio
  // formulário, sem nenhuma marcada — antes a mercadoria ia em silêncio para
  // a primeira loja da lista, e a outra loja só descobria no balanço.
  const lojasDaEntrada = onde.opcoes
    .filter((u) => (onde.unidadeId ? u.id === onde.unidadeId : onde.ids.includes(u.id)))
    .filter((u) => pode(sessao, 'estoque.ajustar', u.id))
    .map((u) => ({ id: u.id, nome: u.nome, conta: pode(sessao, 'financeiro.lancar', u.id) }))

  // Corrigir, mínimo e transferir são da loja escolhida no alto.
  const podeMexer = onde.unidadeId ? pode(sessao, 'estoque.ajustar', onde.unidadeId) : false

  const [variacoes, categorias, divergencia] = await Promise.all([
    // Por VARIAÇÃO, e não por linha de saldo: o item que nunca teve entrada
    // não tem linha nenhuma, e antes sumia daqui enquanto a tela de Produtos
    // o contava como "acabou". Agora as duas contam por `saldoNaVista`.
    // Três consultas, uma depois da outra, e não um `select` com produto,
    // opções e saldos lado a lado: relações irmãs o Prisma busca AO MESMO
    // TEMPO, e dentro do comoOrg a conexão é uma só — o `pg` avisa e, no
    // pg@9, quebra.
    comoOrg(sessao.orgId, async (db) => {
      // Serviço não tem estoque (a manicure, a consulta): na lista ele
      // aparecia com saldo zero, como "acabou", e o filtro de falta o
      // contava — o mesmo corte que o "Precisa de você" já fazia.
      const daLista = { ativa: true, produto: { ativo: true, servico: false } }
      const base = await db.variacao.findMany({
        where: daLista,
        select: {
          id: true,
          codigo: true,
          produto: { select: { nome: true, referencia: true, medida: true, custo: true, vendidoEm: true, usoInterno: true, feitoNoDia: true } },
        },
      })
      const opcoes = await db.variacaoOpcao.findMany({
        where: { variacao: daLista },
        select: {
          variacaoId: true,
          opcao: { select: { valor: true, hex: true, eixo: { select: { ordem: true } } } },
        },
      })
      const estoques = await db.estoque.findMany({
        where: { unidadeId: { in: onde.ids }, variacao: daLista },
        select: { variacaoId: true, quantidade: true, minimo: true, unidadeId: true },
      })
      const agrupar = <T extends { variacaoId: string }>(xs: T[]) => {
        const m = new Map<string, Omit<T, 'variacaoId'>[]>()
        for (const { variacaoId, ...resto } of xs) {
          const l = m.get(variacaoId)
          if (l) l.push(resto)
          else m.set(variacaoId, [resto])
        }
        return m
      }
      const opcoesDe = agrupar(opcoes)
      const estoquesDe = agrupar(estoques)
      return base.map((v) => ({ ...v, opcoes: opcoesDe.get(v.id) ?? [], estoques: estoquesDe.get(v.id) ?? [] }))
    }),
    comoOrg(sessao.orgId, (db) =>
      db.categoriaFinanceira.findMany({
        where: { ativa: true, tipo: 'DESPESA' },
        orderBy: { ordem: 'asc' },
        select: { id: true, nome: true },
      }),
    ),
    // A conferência histórico × saldo. Ela é o que impede o estoque de virar
    // um número em que ninguém confia: se divergir, a tela diz na hora.
    // Só as lojas da vista: o gerente de duas lojas, no "Todas as unidades",
    // não recebe o aviso (nem a conta) do estoque das outras.
    pode(sessao, 'estoque.ajustar') ? conferirSaldos(sessao, onde.ids) : null,
  ])

  // Consolidado soma as lojas; por loja, é o saldo da loja. Linha zerada de
  // produto que a loja não vende não é "acabou" — é sobra de transferência
  // ou de balanço. A conta é `saldoNaVista`, a mesma da tela de Produtos e
  // a mesma régua do "Precisa de você" do painel (`contaComoFalta`).
  const lojasDaVista = onde.opcoes.filter((u) => onde.ids.includes(u.id))
  const vistaInteira = onde.unidadeId === null && unidadesQuePodem(sessao, 'estoque.ver') === 'todas'
  const itens = variacoes
    .map((v) => {
      const na = saldoNaVista(
        v.produto.vendidoEm,
        v.estoques.map((e) => ({ unidadeId: e.unidadeId, quantidade: Number(e.quantidade), minimo: e.minimo === null ? null : Number(e.minimo) })),
        lojasDaVista,
        vistaInteira,
        v.produto.feitoNoDia,
      )
      return {
        id: v.id,
        codigo: v.codigo,
        nome: v.produto.nome,
        referencia: v.produto.referencia,
        medida: v.produto.medida,
        custo: Number(v.produto.custo ?? 0),
        opcoes: v.opcoes.map((o) => ({
          valor: o.opcao.valor,
          hex: o.opcao.hex,
          ordem: o.opcao.eixo.ordem,
        })),
        aparece: na.aparece,
        saldo: na.saldo,
        minimo: na.minimo,
        nivel: na.nivel,
        doDia: na.doDia === true,
        semLancamento: na.semLancamento === true,
        usoInterno: v.produto.usoInterno,
      }
    })
    .filter((i) => i.aparece)
    .sort((a, b) => a.nome.localeCompare(b.nome))
  const nivelDe = (i: { nivel: 'critico' | 'atencao' | 'bom' }) => i.nivel

  const acabaram = itens.filter((i) => nivelDe(i) === 'critico')
  const noMinimo = itens.filter((i) => nivelDe(i) === 'atencao')
  // Sem linha de estoque nenhuma: a loja ainda não deu entrada nem contou.
  const semLancamento = itens.filter((i) => i.semLancamento)
  // Dinheiro parado a preço de CUSTO é custo — a mesma regra da planilha
  // (`estoque/exportar`): só quem mexe em preço ou vê o financeiro. Antes
  // aparecia para qualquer um com `estoque.ver`, inclusive o balcão.
  const verCusto = pode(sessao, 'produto.preco') || pode(sessao, 'financeiro.ver')
  const valorParado = verCusto ? itens.reduce((s, i) => s + Math.max(i.saldo, 0) * i.custo, 0) : 0

  // ── vai faltar ───────────────────────────────────────────
  // Plano e previsão em sequência, cada um na própria transação. No plano
  // sem previsão nada do estoque real é lido para isto: a tranca mostra
  // amostra, e o dado real ficaria a um "inspecionar elemento" de distância.
  const plano = await planoDaEmpresa(sessao)
  const temPrevisao = liberado(plano, 'ruptura.previsao')
  const ruptura = temPrevisao ? await previsaoDeRuptura(sessao, onde.ids) : amostraRuptura()
  const vaiFaltar = ruptura.filter((l) => URGENTES.includes(l.previsao.situacao))
  const contar = (s: LinhaRuptura['previsao']['situacao']) => vaiFaltar.filter((l) => l.previsao.situacao === s).length
  const resumoRuptura = [
    contar('ja_faltou') && `${contar('ja_faltou')} já ${contar('ja_faltou') === 1 ? 'faltou' : 'faltaram'}`,
    contar('pedir_agora') && `${contar('pedir_agora')} para pedir agora`,
    contar('atencao') && `${contar('atencao')} em atenção`,
  ]
    .filter(Boolean)
    .join(' · ')

  const colunasRuptura: Coluna<LinhaRuptura>[] = [
    {
      chave: 'item',
      titulo: 'Item',
      celula: (l) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-tinta">{l.nome}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-tinta-3">
            <span className="font-mono">{l.codigo ?? '—'}</span>
            {l.opcoes && <span>{l.opcoes}</span>}
          </span>
        </span>
      ),
    },
    {
      chave: 'saldo',
      titulo: 'Saldo',
      numero: true,
      largura: '5rem',
      destaque: true,
      celula: (l) => (
        <span className={cx('numero', l.saldo <= 0 ? 'font-semibold text-critico' : 'text-tinta')}>
          {l.saldo.toLocaleString('pt-BR')}
        </span>
      ),
    },
    {
      chave: 'ritmo',
      titulo: 'Ritmo/dia',
      numero: true,
      largura: '6rem',
      celula: (l) =>
        l.previsao.ritmoDia > 0 ? (
          <span className="text-tinta-2">{l.previsao.ritmoDia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>
        ) : (
          <span className="text-tinta-3">—</span>
        ),
    },
    {
      chave: 'dura',
      titulo: 'Dura (dias)',
      numero: true,
      largura: '6rem',
      celula: (l) =>
        l.previsao.duraDias === null ? (
          <span className="text-tinta-3">—</span>
        ) : (
          // Chão, não arredondamento: "dura 6" quando dura 6,9 erra para o
          // lado que não deixa faltar.
          <span className="font-semibold text-tinta">{Math.floor(l.previsao.duraDias)}</span>
        ),
    },
    {
      chave: 'prazo',
      titulo: 'Reposição (dias)',
      numero: true,
      largura: '8rem',
      celula: (l) =>
        l.previsao.prazoInformado ? (
          <span className="text-tinta">{l.previsao.prazo}</span>
        ) : (
          <span className="text-tinta-3" title="A ficha do produto não tem prazo de reposição; a conta usa o padrão.">
            {l.previsao.prazo} (padrão)
          </span>
        ),
    },
    {
      chave: 'pedirAte',
      titulo: 'Pedir até',
      largura: '6rem',
      celula: (l) =>
        l.previsao.pedirAte === null ? (
          <span className="text-tinta-3">—</span>
        ) : l.previsao.situacao === 'pedir_agora' ? (
          <span className="font-semibold text-critico">hoje</span>
        ) : (
          <span className="numero text-tinta">{diaMes(l.previsao.pedirAte)}</span>
        ),
    },
    {
      chave: 'situacao',
      titulo: 'Situação',
      largura: '8rem',
      celula: (l) => <SituacaoRuptura s={l.previsao.situacao} />,
    },
  ]

  // ── o que a pessoa pediu ─────────────────────────────────
  // Filtrado DEPOIS de somar, de propósito: a tira de cima e o "precisa
  // comprar" continuam falando do estoque inteiro; só a lista de baixo
  // obedece ao filtro. Se filtrasse antes, buscar "camiseta" faria a tira
  // dizer que só existe camiseta na loja.
  //
  // A busca casa com nome, referência do fornecedor e etiqueta (inteira ou
  // um pedaço dela, como no balcão) — e é sem acento e sem caixa, porque
  // quem digita no balcão não vai parar para pôr o til em "açaí".
  const solto = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const termo = solto(q)
  const nivelPedido = situacao === 'acabaram' ? 'critico' : situacao === 'minimo' ? 'atencao' : situacao === 'ok' ? 'bom' : null
  const listados = itens.filter(
    (i) =>
      (!termo || solto(i.nome).includes(termo) || solto(i.referencia ?? '').includes(termo) || codigoBate(i.codigo, q)) &&
      (!nivelPedido || (nivelDe(i) === nivelPedido && !(nivelPedido === 'bom' && i.semLancamento))),
  )

  // Uma página por vez — a lista inteira, com as ações de cada linha, fazia a
  // tela pesar 40 MB num catálogo de 7 mil variações (ver ui/paginacao.ts).
  // A conta de cima continua sobre tudo.
  const fatia = fatiar(listados, lerPagina(bruto.pagina), POR_PAGINA)
  const fatiaMov = fatiar(movimentos, lerPagina(bruto.mov), POR_PAGINA)
  // "Precisa comprar" mostra os primeiros: na loja de roupa e de calçado, o
  // tamanho esgotado é a regra (a grade inteira de cada peça), e milhares de
  // linhas aqui enterravam o resto da tela. O resto está na lista de baixo,
  // filtrado, com páginas.
  const precisa = [...acabaram, ...noMinimo]
  const precisaVisiveis = precisa.slice(0, PRECISA_MAX)

  const atuais = { unidade: onde.unidadeId, q, situacao, periodo: periodoPedido ?? null, tipo }
  // A busca leva escondido TODO filtro da tela menos o próprio `q` — antes
  // buscar apagava o período e o tipo de movimento escolhidos.
  const { q: _q, ...manterNaBusca } = atuais
  const link = (mudanca: Record<string, string | null>) =>
    enderecoCom(`/${slug}/estoque`, atuais, mudanca)

  const colunas = [
    {
      chave: 'item',
      titulo: 'Item',
      celula: (i: (typeof itens)[number]) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-tinta">{i.nome}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-tinta-3">
            <span className="font-mono">{i.codigo ?? '—'}</span>
            {[...i.opcoes]
              .sort((a, b) => a.ordem - b.ordem)
              .map((o, n) => (
                <span key={n} className="inline-flex items-center gap-1">
                  {o.hex && (
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full border border-borda"
                      style={{ background: o.hex }}
                    />
                  )}
                  <span>{o.valor}</span>
                </span>
              ))}
            {i.usoInterno && <span className="text-tinta-3">· material de uso</span>}
          </span>
        </span>
      ),
    },
    {
      chave: 'minimo',
      titulo: 'Mínimo',
      numero: true,
      largura: '6rem',
      // Com loja escolhida e permissão, o mínimo se define ali mesmo: ele é o
      // que decide o "no mínimo" e o "precisa comprar", e não tinha tela.
      // No consolidado ele é o MAIOR entre as lojas, e só se lê.
      celula: (i: (typeof itens)[number]) =>
        podeMexer && onde.unidadeId ? (
          <Minimo slug={slug} variacaoId={i.id} unidadeId={onde.unidadeId} minimo={i.minimo} medida={i.medida} />
        ) : (
          <span className="numero text-xs text-tinta-3">{i.minimo > 0 ? qtd(i.minimo, i.medida) : '—'}</span>
        ),
    },
    {
      chave: 'saldo',
      titulo: 'Tem',
      numero: true,
      largura: '9rem',
      // No cartão do celular, o "tem" sobe para o lado do nome.
      destaque: true,
      celula: (i: (typeof itens)[number]) => (
        i.doDia ? (
          // Feito no dia e zerado: a sobra saiu ao fechar. Não é falta.
          <Situacao nivel="neutro">feito no dia</Situacao>
        ) : i.semLancamento ? (
          // Nunca teve entrada nem contagem nesta vista: ainda não é controlado.
          <Situacao nivel="neutro">sem estoque lançado</Situacao>
        ) : (
          <Situacao nivel={nivelDe(i)}>
            {i.saldo <= 0 ? 'acabou' : qtd(i.saldo, i.medida)}
          </Situacao>
        )
      ),
    },
    // Corrigir só existe COM loja escolhida. No consolidado a coluna "Tem"
    // é a SOMA das lojas, e corrigir por ela gravaria o total de todas no
    // saldo de uma só. O erro passaria despercebido até o balanço.
    ...(podeMexer && onde.unidadeId
      ? [
          {
            chave: 'acao',
            titulo: '',
            largura: '17rem',
            celula: (i: (typeof itens)[number]) => (
              <div className="flex flex-col gap-1">
                <Corrigir slug={slug} variacaoId={i.id} unidadeId={onde.unidadeId!} saldo={i.saldo} />
                {destinos.length > 0 && (
                  <Transferir
                    slug={slug}
                    variacaoId={i.id}
                    deUnidadeId={onde.unidadeId!}
                    destinos={destinos.map((d) => ({ id: d.id, nome: d.nome }))}
                    saldo={i.saldo}
                  />
                )}
              </div>
            ),
          },
        ]
      : []),
  ]

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/estoque`}
      tema={tema}
      titulo="Estoque"
      acao={
        <span className="flex items-center gap-2">
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
          {/* Com fábrica, a loja repõe pedindo a ela — e é aqui, no estoque,
              que a gerente percebe que está acabando. A tela de pedir confere
              em que loja a pessoa pode pedir. */}
          {moduloLigado(empresa, 'fabrica') && pode(sessao, 'estoque.ajustar') && (
            <Link
              href={`/${slug}/fabrica/pedir${onde.unidadeId ? `?loja=${onde.unidadeId}` : ''}`}
              className="botao-marca rounded-norte px-3 py-1.5 text-sm font-semibold text-marca-tinta"
            >
              Pedir à fábrica
            </Link>
          )}
          <a
            href={`/${slug}/estoque/exportar${onde.unidadeId ? `?unidade=${onde.unidadeId}` : ''}`}
            className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
            title="Baixar em planilha — a folha do balanço, com uma coluna para o contado"
          >
            Planilha
          </a>
          {pode(sessao, 'estoque.ajustar') && (
            <Link
              href={`/${slug}/produtos/rapida${onde.unidadeId ? `?unidade=${onde.unidadeId}` : ''}`}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
              title="Digitar o estoque contado de vários produtos numa tabela"
            >
              Editar em planilha
            </Link>
          )}
        </span>
      }
    >
      <Tira
        itens={[
          { rotulo: 'acabaram', um: 'acabou', quantos: acabaram.length, nivel: 'critico' },
          { rotulo: 'no mínimo', quantos: noMinimo.length, nivel: 'atencao' },
          { rotulo: 'com estoque', quantos: itens.length - acabaram.length - noMinimo.length - semLancamento.length, nivel: 'bom' },
          { rotulo: 'sem estoque lançado', quantos: semLancamento.length, nivel: 'neutro' },
        ]}
      />

      {divergencia && divergencia.length > 0 && (
        <Aviso nivel="critico">
          {divergencia.length} {divergencia.length === 1 ? 'item' : 'itens'} com saldo diferente da soma do histórico. Isso é
          defeito, não erro de contagem — o saldo foi mexido por fora do sistema.
        </Aviso>
      )}

      {lojasDaEntrada.length > 0 && (
        <Entrada
          slug={slug}
          lojas={lojasDaEntrada}
          // Uma só possível (a escolhida no alto, ou a única que a pessoa
          // alcança): já vem marcada. Mais de uma: a pessoa escolhe.
          unidadeId={lojasDaEntrada.length === 1 ? lojasDaEntrada[0]!.id : null}
          categorias={categorias}
          mercadoria={vocab.mercadoria}
          aMercadoria={vocab.aMercadoria}
        />
      )}

      {/* O que o balcão vendeu sem o sistema ter: pendência da gerente,
          antes da lista de compras (o saldo errado engana as duas). */}
      <VendidoSemEstoque slug={slug} sessao={sessao} unidadeIds={onde.ids} />

      {acabaram.length + noMinimo.length > 0 && (
        <Secao titulo="Precisa comprar">
          <Cartao
            titulo={onde.unidadeId ? onde.titulo : 'Somando as lojas'}
            acao={
              <span className="text-xs text-tinta-3">
                {acabaram.length.toLocaleString('pt-BR')} {acabaram.length === 1 ? 'acabou' : 'acabaram'} · {noMinimo.length.toLocaleString('pt-BR')} no mínimo
              </span>
            }
          >
            <Tabela
              colunas={colunas}
              linhas={precisaVisiveis}
              chave={(i) => i.id}
              vazio="Nada faltando."
            />
            {precisa.length > precisaVisiveis.length && (
              <p className="flex flex-wrap gap-x-3 text-xs text-tinta-3">
                <span>
                  Mostrando {precisaVisiveis.length.toLocaleString('pt-BR')} de {precisa.length.toLocaleString('pt-BR')}.
                </span>
                {acabaram.length > 0 && (
                  <Link href={`${link({ situacao: 'acabaram' })}#tudo`} className="font-semibold text-marca underline-offset-2 hover:underline">
                    {acabaram.length === 1 ? 'ver o que acabou' : `ver os ${acabaram.length.toLocaleString('pt-BR')} que acabaram`}
                  </Link>
                )}
                {noMinimo.length > 0 && (
                  <Link href={`${link({ situacao: 'minimo' })}#tudo`} className="font-semibold text-marca underline-offset-2 hover:underline">
                    {noMinimo.length === 1 ? 'ver o que está no mínimo' : `ver os ${noMinimo.length.toLocaleString('pt-BR')} no mínimo`}
                  </Link>
                )}
              </p>
            )}
          </Cartao>
        </Secao>
      )}

      {/* ── VAI FALTAR ──
          "No mínimo" é um número parado. Aqui o número anda: no ritmo dos
          últimos 30 dias, quantos dias o saldo aguenta — e, com o prazo do
          fornecedor, até quando dá para pedir. */}
      <Secao
        titulo="Vai faltar"
        resumo={`No ritmo dos últimos ${JANELA_DIAS} dias, quantos dias cada saldo aguenta, e até quando pedir para a peça chegar antes de acabar.`}
        acao={
          temPrevisao && resumoRuptura ? <span className="text-xs text-tinta-3">{resumoRuptura}</span> : undefined
        }
      >
        <Trancado
          chave="ruptura.previsao"
          plano={plano}
          slug={slug}
          verPlanos={podeVerPlanos(sessao)}
          resumo="Diz quantos dias o saldo aguenta no ritmo de venda, e quando pedir para a peça não faltar."
        >
          {vaiFaltar.length === 0 ? (
            <Vazio>
              Nada vai faltar por enquanto: no ritmo atual, todo item que gira dura mais que o
              dobro do prazo de reposição.
            </Vazio>
          ) : (
            <Tabela colunas={colunasRuptura} linhas={vaiFaltar} chave={(l) => l.variacaoId} />
          )}
        </Trancado>
      </Secao>

      <span id="tudo" />
      <Secao
        titulo="Tudo que tem"
        acao={
          <Fichas
            opcoes={[
              { valor: null, rotulo: 'tudo', quantos: itens.length },
              { valor: 'acabaram', rotulo: 'acabaram', quantos: acabaram.length },
              { valor: 'minimo', rotulo: 'no mínimo', quantos: noMinimo.length },
              { valor: 'ok', rotulo: 'com estoque', quantos: itens.length - acabaram.length - noMinimo.length },
            ]}
            atual={situacao}
            linkDe={(v) => link({ situacao: v })}
          />
        }
      >
        <Busca
          valor={q}
          placeholder="Nome ou etiqueta"
          rotulo="Buscar no estoque"
          manter={manterNaBusca}
          limparEm={link({ q: null })}
        />
        <Cartao
          titulo={
            q || situacao
              ? `${listados.length} de ${plural(itens.length, 'item', 'itens')}`
              : plural(itens.length, 'item', 'itens')
          }
          acao={
            valorParado > 0 ? (
              <span className="text-xs text-tinta-3">
                <b className="numero text-tinta-2">
                  {valorParado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </b>{' '}
                parados na prateleira, a preço de custo
              </span>
            ) : undefined
          }
        >
          {itens.length === 0 ? (
            <Vazio
              acao={
                pode(sessao, 'produto.editar') && (
                  <Link href={`/${slug}/produtos/novo`} className="botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta">
                    Cadastrar {vocab.umItemDeEstoque}
                  </Link>
                )
              }
            >
              Nenhum item com estoque nesta loja. Cadastre {vocab.umItemDeEstoque} e dê entrada nele.
            </Vazio>
          ) : listados.length === 0 ? (
            <Vazio
              acao={
                <Link href={link({ q: null, situacao: null })} className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2">
                  Ver tudo
                </Link>
              }
            >
              {q ? `Nada com “${q}”.` : 'Nada nessa situação.'}
            </Vazio>
          ) : (
            <Tabela colunas={colunas} linhas={fatia.itens} chave={(i) => i.id} vazio="Vazio." />
          )}
          <Paginas p={fatia} linkDe={(n) => `${link({ pagina: String(n) })}#tudo`} />
        </Cartao>
      </Secao>

      {/* ── MOVIMENTOS ──
          Todo movimento fica gravado desde o primeiro dia e não tinha onde
          ser lido. "Quem deu baixa de 30 na terça?" é o que decide se o
          estoque é confiável ou é só um número. */}
      <span id="movimentos" />
      <Secao
        titulo="Movimentos"
        resumo="Tudo que entrou, saiu, foi corrigido ou transferido — com quem e quando."
        acao={<SeletorPeriodo atual={j.chave} />}
      >
        <Fichas
          opcoes={[
            { valor: null, rotulo: 'todos', quantos: movimentos.length },
            ...TIPOS.map((t) => ({ valor: t, rotulo: ROTULO_MOVIMENTO[t].toLowerCase() })),
          ]}
          atual={tipo}
          linkDe={(v) => link({ tipo: v })}
        />
        <Tabela
          colunas={[
            {
              chave: 'quando',
              titulo: 'Quando',
              largura: '7rem',
              celula: (m: MovimentoNaLista) => <span className="numero whitespace-nowrap text-tinta-2">{quando(m.criadoEm)}</span>,
            },
            {
              chave: 'item',
              titulo: 'Item',
              tituloDoCartao: true,
              celula: (m: MovimentoNaLista) => (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-tinta">{m.descricao}</span>
                  <span className="text-xs text-tinta-3">
                    {m.codigo ? <span className="font-mono">{m.codigo} · </span> : null}
                    {m.motivo ?? ROTULO_MOVIMENTO[m.tipo]}
                    {m.referencia && m.tipo === 'VENDA' ? (
                      <>
                        {' · '}
                        <Link href={`/${slug}/vendas/${m.referencia}`} className="text-marca underline-offset-2 hover:underline">
                          ver venda
                        </Link>
                      </>
                    ) : null}
                  </span>
                </span>
              ),
            },
            {
              chave: 'tipo',
              titulo: 'Tipo',
              largura: '8rem',
              celula: (m: MovimentoNaLista) => (
                <Situacao
                  nivel={
                    m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCAO' ? 'bom'
                    : m.tipo === 'PERDA' ? 'critico'
                    : m.tipo === 'AJUSTE' || m.tipo === 'BALANCO' || m.tipo === 'CONSUMO' ? 'atencao'
                    : 'neutro'
                  }
                >
                  {ROTULO_MOVIMENTO[m.tipo]}
                </Situacao>
              ),
            },
            ...(onde.unidadeId === null && onde.opcoes.length > 1
              ? [{ chave: 'loja', titulo: 'Loja', largura: '8rem', celula: (m: MovimentoNaLista) => <span className="text-tinta-2">{m.unidade}</span> }]
              : []),
            {
              chave: 'qtd',
              titulo: 'Quantidade',
              numero: true,
              largura: '7rem',
              destaque: true,
              celula: (m: MovimentoNaLista) => (
                <span className={cx('numero font-semibold', m.quantidade < 0 ? 'text-critico' : 'text-bom')}>
                  {m.quantidade > 0 ? '+' : ''}
                  {qtd(m.quantidade, m.medida)}
                </span>
              ),
            },
            {
              chave: 'saldo',
              titulo: 'Ficou',
              numero: true,
              largura: '6rem',
              celula: (m: MovimentoNaLista) => <span className="numero text-tinta-2">{qtd(m.saldoDepois, m.medida)}</span>,
            },
            {
              chave: 'quem',
              titulo: 'Quem',
              largura: '8rem',
              celula: (m: MovimentoNaLista) => <span className="truncate text-xs text-tinta-2">{m.quem}</span>,
            },
          ]}
          linhas={fatiaMov.itens}
          chave={(m) => m.id}
          vazio={q || tipo ? 'Nenhum movimento com esse filtro no período.' : 'Nenhum movimento no período.'}
        />
        <Paginas p={fatiaMov} linkDe={(n) => `${link({ mov: String(n) })}#movimentos`} rotulo="movimentos" />
        {movimentos.length === 500 && (
          <p className="text-xs text-tinta-3">Mostrando os 500 mais recentes. Aperte o período ou o filtro.</p>
        )}
      </Secao>
    </Estrutura>
  )
}
