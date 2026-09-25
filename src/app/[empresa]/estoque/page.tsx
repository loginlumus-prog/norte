import { contaComoFalta } from '@/servidor/catalogo-loja'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
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
import type { Tema } from '@/ui/TrocaTema'
import type { TipoMovimento } from '@prisma/client'

type SituacaoItem = 'acabaram' | 'minimo' | 'ok'
import { Entrada } from './Entrada'
import { Corrigir } from './Corrigir'
import { Transferir } from './Transferir'

const TIPOS: TipoMovimento[] = ['ENTRADA', 'VENDA', 'DEVOLUCAO', 'AJUSTE', 'PERDA', 'TRANSFERENCIA', 'BALANCO']
const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)

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

const diaMes = (d: Date) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d)

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
  searchParams: Promise<{ unidade?: string; q?: string; situacao?: string; periodo?: string; tipo?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, q: qBruto, situacao: sitPedida, periodo: periodoPedido, tipo: tipoPedido } = await searchParams
  const q = (qBruto ?? '').trim()
  const situacao: SituacaoItem | null =
    sitPedida === 'acabaram' || sitPedida === 'minimo' || sitPedida === 'ok' ? sitPedida : null
  const tipo = TIPOS.find((t) => t === tipoPedido) ?? null
  const j = janela(lerPeriodo(periodoPedido))
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'estoque.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const onde = await escolherUnidade(sessao, empresa, pedida, 'estoque.ver')
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
  // Dar entrada é sempre EM UMA loja. Sem loja escolhida (consolidado), a
  // mercadoria não teria onde entrar — então a ação usa a primeira visível.
  const unidadeAlvo = onde.unidadeId ?? onde.opcoes[0]?.id ?? null

  const podeMexer = unidadeAlvo ? pode(sessao, 'estoque.ajustar', unidadeAlvo) : false
  const podeLancarConta = unidadeAlvo ? pode(sessao, 'financeiro.lancar', unidadeAlvo) : false

  const [linhas, categorias, divergencia] = await Promise.all([
    comoOrg(sessao.orgId, (db) =>
      db.estoque.findMany({
        where: { unidadeId: { in: onde.ids }, variacao: { ativa: true, produto: { ativo: true } } },
        select: {
          quantidade: true,
          minimo: true,
          unidadeId: true,
          unidade: { select: { ehDeposito: true } },
          variacao: {
            select: {
              id: true,
              codigo: true,
              produto: { select: { nome: true, medida: true, custo: true, vendidoEm: true } },
              opcoes: {
                select: {
                  opcao: {
                    select: { valor: true, hex: true, eixo: { select: { ordem: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    ),
    comoOrg(sessao.orgId, (db) =>
      db.categoriaFinanceira.findMany({
        where: { ativa: true, tipo: 'DESPESA' },
        orderBy: { ordem: 'asc' },
        select: { id: true, nome: true },
      }),
    ),
    // A conferência histórico × saldo. Ela é o que impede o estoque de virar
    // um número em que ninguém confia: se divergir, a tela diz na hora.
    pode(sessao, 'estoque.ajustar') ? conferirSaldos(sessao, onde.unidadeId ?? undefined) : null,
  ])

  // Consolidado soma as lojas; por loja, cada linha já é a da loja.
  const porVariacao = new Map<
    string,
    { id: string; codigo: string | null; nome: string; medida: string; custo: number; opcoes: { valor: string; hex: string | null; ordem: number }[]; saldo: number; minimo: number }
  >()
  for (const l of linhas) {
    const v = l.variacao
    // Linha zerada de produto que esta loja não vende não é "acabou" — é
    // sobra de transferência ou de balanço. A mesma régua do "Precisa de
    // você" do painel (ver `contaComoFalta`), senão o "Ver" levaria a uma
    // lista de tamanho diferente do número prometido.
    if (
      !contaComoFalta(
        { quantidade: Number(l.quantidade), unidadeId: l.unidadeId, ehDeposito: l.unidade.ehDeposito },
        v.produto.vendidoEm,
      )
    ) {
      continue
    }
    const atual = porVariacao.get(v.id)
    const saldo = Number(l.quantidade)
    if (atual) {
      atual.saldo += saldo
      atual.minimo = Math.max(atual.minimo, Number(l.minimo))
      continue
    }
    porVariacao.set(v.id, {
      id: v.id,
      codigo: v.codigo,
      nome: v.produto.nome,
      medida: v.produto.medida,
      custo: Number(v.produto.custo ?? 0),
      opcoes: v.opcoes.map((o) => ({
        valor: o.opcao.valor,
        hex: o.opcao.hex,
        ordem: o.opcao.eixo.ordem,
      })),
      saldo,
      minimo: Number(l.minimo),
    })
  }

  const itens = [...porVariacao.values()].sort((a, b) => a.nome.localeCompare(b.nome))
  const nivelDe = (i: { saldo: number; minimo: number }) =>
    i.saldo <= 0 ? ('critico' as const) : i.minimo > 0 && i.saldo <= i.minimo ? ('atencao' as const) : ('bom' as const)

  const acabaram = itens.filter((i) => nivelDe(i) === 'critico')
  const noMinimo = itens.filter((i) => nivelDe(i) === 'atencao')
  const valorParado = itens.reduce((s, i) => s + i.saldo * i.custo, 0)

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
    contar('ja_faltou') && `${contar('ja_faltou')} já faltaram`,
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
  // A busca casa com nome e com etiqueta — e é sem acento e sem caixa, porque
  // quem digita no balcão não vai parar para pôr o til em "açaí".
  const solto = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const termo = solto(q)
  const nivelPedido = situacao === 'acabaram' ? 'critico' : situacao === 'minimo' ? 'atencao' : situacao === 'ok' ? 'bom' : null
  const listados = itens.filter(
    (i) =>
      (!termo || solto(i.nome).includes(termo) || (i.codigo ?? '').toLowerCase() === termo) &&
      (!nivelPedido || nivelDe(i) === nivelPedido),
  )

  const atuais = { unidade: onde.unidadeId, q, situacao, periodo: periodoPedido ?? null, tipo }
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
          </span>
        </span>
      ),
    },
    {
      chave: 'minimo',
      titulo: 'Mínimo',
      numero: true,
      largura: '6rem',
      celula: (i: (typeof itens)[number]) => (
        <span className="numero text-xs text-tinta-3">{i.minimo > 0 ? i.minimo : '—'}</span>
      ),
    },
    {
      chave: 'saldo',
      titulo: 'Tem',
      numero: true,
      largura: '9rem',
      celula: (i: (typeof itens)[number]) => (
        <Situacao nivel={nivelDe(i)}>
          {i.saldo <= 0 ? 'acabou' : qtd(i.saldo, i.medida)}
        </Situacao>
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
          <a
            href={`/${slug}/estoque/exportar${onde.unidadeId ? `?unidade=${onde.unidadeId}` : ''}`}
            className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
            title="Baixar em planilha — a folha do balanço, com uma coluna para o contado"
          >
            Planilha
          </a>
        </span>
      }
    >
      <Tira
        itens={[
          { rotulo: 'acabaram', um: 'acabou', quantos: acabaram.length, nivel: 'critico' },
          { rotulo: 'no mínimo', quantos: noMinimo.length, nivel: 'atencao' },
          { rotulo: 'com estoque', quantos: itens.length - acabaram.length - noMinimo.length, nivel: 'bom' },
        ]}
      />

      {divergencia && divergencia.length > 0 && (
        <Aviso nivel="critico">
          {divergencia.length} {divergencia.length === 1 ? 'item' : 'itens'} com saldo diferente da soma do histórico. Isso é
          defeito, não erro de contagem — o saldo foi mexido por fora do sistema.
        </Aviso>
      )}

      {podeMexer && unidadeAlvo && (
        <Entrada
          slug={slug}
          unidadeId={unidadeAlvo}
          unidadeNome={onde.opcoes.find((u) => u.id === unidadeAlvo)?.nome ?? 'esta loja'}
          ambiguo={onde.unidadeId === null && onde.opcoes.length > 1}
          categorias={categorias}
          podeLancarConta={podeLancarConta}
        />
      )}

      {acabaram.length + noMinimo.length > 0 && (
        <Secao titulo="Precisa comprar">
          <Cartao
            titulo={onde.unidadeId ? onde.titulo : 'Somando as lojas'}
            acao={
              <span className="text-xs text-tinta-3">
                {acabaram.length} acabaram · {noMinimo.length} no mínimo
              </span>
            }
          >
            <Tabela
              colunas={colunas}
              linhas={[...acabaram, ...noMinimo]}
              chave={(i) => i.id}
              vazio="Nada faltando."
            />
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
          manter={{ unidade: onde.unidadeId, situacao }}
          limparEm={link({ q: null })}
        />
        <Cartao
          titulo={
            q || situacao
              ? `${listados.length} de ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`
              : `${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`
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
            <Vazio>
              Nenhum item com estoque nesta loja. Cadastre um produto e dê entrada nele.
            </Vazio>
          ) : listados.length === 0 ? (
            <Vazio>{q ? `Nada com “${q}”.` : 'Nada nessa situação.'}</Vazio>
          ) : (
            <Tabela colunas={colunas} linhas={listados} chave={(i) => i.id} vazio="Vazio." />
          )}
        </Cartao>
      </Secao>

      {/* ── MOVIMENTOS ──
          Todo movimento fica gravado desde o primeiro dia e não tinha onde
          ser lido. "Quem deu baixa de 30 na terça?" é o que decide se o
          estoque é confiável ou é só um número. */}
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
                    : m.tipo === 'AJUSTE' || m.tipo === 'BALANCO' ? 'atencao'
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
          linhas={movimentos}
          chave={(m) => m.id}
          vazio={q || tipo ? 'Nenhum movimento com esse filtro no período.' : 'Nenhum movimento no período.'}
        />
        {movimentos.length === 500 && (
          <p className="text-xs text-tinta-3">Mostrando os 500 mais recentes. Aperte o período ou o filtro.</p>
        )}
      </Secao>
    </Estrutura>
  )
}
