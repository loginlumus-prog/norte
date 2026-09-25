import type { ReactNode } from 'react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { exigirEntrada, type Empresa } from '@/servidor/pagina'
import { pode, podeVerPlanos, type Capacidade, type Sessao } from '@/servidor/permissao'
import { escolherUnidade, type Escolha } from '@/servidor/unidade'
import { resumoDoPainel, resumoDeHoje } from '@/servidor/painel'
import { resumoCrediario } from '@/servidor/crediario'
import { metasDoMes, mesChave } from '@/servidor/metas'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { moduloLigado } from '@/servidor/modulos'
import { desempenhoDoMes, semDados } from '@/servidor/desempenho'
import { liberado, planoQueAbre } from '@/servidor/planos'
import { lerModo } from '@/servidor/modo'
import {
  nichoDoPainel,
  listaFalada,
  quantidadeFalada,
  diaDaSemana,
  type BlocoDoNicho,
  type DadosGrade,
  type DadosProducao,
  type DadosReposicao,
  type DadosSabores,
} from '@/servidor/nicho'
import { horaEmSP } from '@/servidor/encomenda'
import { diaEmSP } from '@/servidor/dia'
import {
  pendenciasDoDia,
  montarPendencias,
  noRelogio,
  saudacao,
  primeiroNome,
  diaPorExtenso,
  mesmoDiaPassado,
  horaMinuto,
  type Contagens,
} from '@/servidor/pendencias'
import { Estrutura, type ItemMenu } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Situacao, Aviso, Ponto, cx } from '@/ui/base'
import { Estrelas } from '@/ui/Estrelas'
import { Trancado } from '@/ui/Cadeado'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { SeletorPeriodo } from '@/ui/Periodo'
import {
  Numero,
  Barras,
  Ranque,
  Secao,
  Faixa,
  Bloco,
  Pendencias,
  PendenciasCurtas,
  brl,
} from '@/ui/painel'
import { Rosca, BarrasH, Linhas, Calor, BarrasMeses } from '@/ui/Graficos'
import { Atalhos, IrParaModo, type Atalho } from '@/ui/Atalhos'
import type { Tema } from '@/ui/TrocaTema'
import { palavra, plural } from '@/ui/texto'
import { IconeDoItem } from '@/ui/IconesMenu'

// O painel, em dois modos.
//
// ── SIMPLES ──────────────────────────────────────────────────
// A tela que qualquer pessoa entende em cinco segundos. Sempre HOJE, sem
// seletor de período: quem precisa escolher período já está no avançado.
// Quatro números, um gráfico, o que está esperando a pessoa agir, os botões
// do que ela faz todo dia e o que mais vende. Nada que precise de legenda
// para ser entendido.
//
// ── AVANÇADO ─────────────────────────────────────────────────
// O painel inteiro. A ordem das seções é a ordem das perguntas de quem abre
// o sistema de manhã: quanto vendi (e foi melhor ou pior?), quando e como
// vendi, o que vendeu, o que está parado ou acabando, quem comprou, quem
// vendeu. Cada seção tem o número grande e, embaixo, o gráfico que explica o
// número.
//
// O plano Grátis vê o simples INTEIRO — é o essencial, e o essencial não se
// cobra. No avançado ele vê quanto vendeu, o movimento por dia e o que mais
// vendeu, e vê ONDE está o resto, sem cinza nem cadeado. É o relatório
// simples que a tabela de planos promete, e é a melhor propaganda do de cima.
//
// O modo é do APARELHO (ver `servidor/modo.ts`), e nenhum dos dois tira
// permissão: é o que se vê primeiro, nunca o que se pode.

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Débito', CREDITO: 'Crédito',
  CREDIARIO: 'Crediário', VALE: 'Vale de troca', TRANSFERENCIA: 'Transferência',
}
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * As horas em que a loja vive: da primeira à última com venda, nunca menos
 * que das 8h às 20h — o gráfico de 24 colunas, vinte delas vazias, só diz
 * que a loja fecha à noite.
 */
function horasDaLoja(...porHora: number[][]): number[] {
  const comVenda = Array.from({ length: 24 }, (_, h) => h).filter((h) => porHora.some((p) => (p[h] ?? 0) > 0))
  const ini = Math.min(8, ...comVenda)
  const fim = Math.max(20, ...comVenda)
  return Array.from({ length: fim - ini + 1 }, (_, i) => ini + i)
}

type Base = { slug: string; empresa: Empresa; sessao: Sessao; tema: Tema; onde: Escolha }

export default async function Painel({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; periodo?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, periodo: pedido } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // Quem nao pode ler o resultado do mes nao para nesta tela: vai para onde
  // trabalha. Sem isto, o balconista entra e cai num 'nao encontrado' logo
  // depois do login, que parece defeito e nao regra. Vale nos dois modos.
  if (!pode(sessao, 'relatorio.ver')) {
    if (pode(sessao, 'venda.criar')) redirect(`/${slug}/balcao`)
    notFound()
  }

  // A unidade se escolhe pela capacidade de LER relatório, não de vender: o
  // contador lê o painel e não vende em loja nenhuma — com 'venda.ver' ele
  // caía em "sem acesso a nenhuma unidade" logo depois de entrar.
  const onde = await escolherUnidade(sessao, empresa, pedida, 'relatorio.ver')
  const base: Base = { slug, empresa, sessao, tema, onde }

  return (await lerModo()) === 'simples' ? <Simples {...base} /> : <Avancado {...base} pedido={pedido} />
}

/**
 * O menu avisa ANTES de a pessoa clicar. É a diferença entre descobrir que
 * acabou o estoque porque foi olhar, e ser avisado assim que entra.
 *
 * Os avisos saem das MESMAS contagens do "Precisa de você", nos dois modos:
 * a bolinha do menu e a linha da lista não podem discordar.
 */
function menuComAvisos(slug: string, c: Contagens, parados = 0): ItemMenu[] {
  const acabaram = c.acabaram ?? 0
  const noEstoque = acabaram + (c.noMinimo ?? 0)
  const aviso = (href: string): ItemMenu['aviso'] => {
    if (href === `/${slug}/estoque` && noEstoque > 0) {
      return {
        quantos: noEstoque,
        nivel: acabaram > 0 ? 'critico' : 'atencao',
        titulo: acabaram > 0 ? 'acabaram ou estão no mínimo' : 'no mínimo',
      }
    }
    if (href === `/${slug}/produtos` && parados > 0) {
      return { quantos: parados, nivel: 'atencao', titulo: palavra(parados, 'parado', 'parados') }
    }
    if (href === `/${slug}/crediario` && c.parcelasVencidas?.quantas) {
      return { quantos: c.parcelasVencidas.quantas, nivel: 'critico', titulo: palavra(c.parcelasVencidas.quantas, 'parcela vencida', 'parcelas vencidas') }
    }
    if (href === `/${slug}/financeiro` && c.contasVencidas?.quantas) {
      return { quantos: c.contasVencidas.quantas, nivel: 'critico', titulo: palavra(c.contasVencidas.quantas, 'conta vencida', 'contas vencidas') }
    }
    if (href === `/${slug}/tarefas` && c.tarefasMinhas) {
      return { quantos: c.tarefasMinhas, nivel: 'atencao', titulo: palavra(c.tarefasMinhas, 'tarefa sua atrasada', 'tarefas suas atrasadas') }
    }
    if (href === `/${slug}/agente` && c.propostas) {
      return { quantos: c.propostas, nivel: 'atencao', titulo: 'esperando você' }
    }
    return undefined
  }
  return MENU(slug).map((i) => {
    const a = aviso(i.href)
    return a ? { ...i, aviso: a } : i
  })
}

const SemUnidade = () => (
  <Aviso nivel="atencao">
    Você ainda não tem acesso a nenhuma unidade. Peça para quem responde pela empresa
    liberar o seu acesso.
  </Aviso>
)

/* ═══════════════════════════════════════════════════════════
   SIMPLES
   ═══════════════════════════════════════════════════════════ */

async function Simples({ slug, empresa, sessao, tema, onde }: Base) {
  const agora = new Date()
  const [d, contagens, nichos] = await Promise.all([
    resumoDeHoje(sessao, onde.ids, agora),
    pendenciasDoDia(sessao, empresa, onde.ids, agora),
    nichoSemDerrubar(sessao, empresa, onde.ids, agora),
  ])
  const pendencias = montarPendencias(contagens, slug, onde.unidadeId)
  const passada = mesmoDiaPassado(agora)

  // Até a MESMA hora da semana passada (ver `resumoDeHoje`). Sem venda
  // naquele trecho não existe porcentagem — "+∞%" seria pior que nada.
  const pct =
    d.semanaPassada.ateAgora > 0
      ? ((d.hoje.total - d.semanaPassada.ateAgora) / d.semanaPassada.ateAgora) * 100
      : NaN
  const horas = horasDaLoja(d.porHora, d.porHoraSemanaPassada)
  const semMovimento = d.hoje.total === 0 && d.semanaPassada.diaInteiro === 0

  // Um atalho só aparece para quem pode — e pode NAQUELA loja, quando há
  // uma escolhida. A loja vai junto no link, para o balcão e a entrada já
  // abrirem nela.
  const na = onde.unidadeId ?? undefined
  const comLoja = (href: string) => (onde.unidadeId ? `${href}?unidade=${onde.unidadeId}` : href)
  const atalhos: Atalho[] = (
    [
      ['venda.criar', { chave: 'vender', href: comLoja(`/${slug}/balcao`), titulo: 'Vender', resumo: 'Abrir o balcão e registrar uma venda.' }],
      ['estoque.ajustar', { chave: 'entrada', href: comLoja(`/${slug}/estoque`), titulo: 'Dar entrada', resumo: 'A mercadoria que chegou.' }],
      ['produto.editar', { chave: 'produto', href: `/${slug}/produtos/novo`, titulo: 'Cadastrar produto', resumo: 'Nome, preço e código.' }],
      ['financeiro.lancar', { chave: 'conta', href: comLoja(`/${slug}/financeiro`), titulo: 'Lançar conta', resumo: 'Boleto, aluguel, fornecedor.' }],
      ['tarefa.gerir', { chave: 'tarefa', href: comLoja(`/${slug}/tarefas`), titulo: 'Nova tarefa', resumo: 'Para alguém da equipe.' }],
    ] satisfies [Capacidade, Atalho][]
  )
    .filter(([c]) => pode(sessao, c, na))
    .map(([, a]) => a)

  const r = noRelogio(agora)
  const urgentes = pendencias.filter((p) => p.nivel === 'critico').length

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menuComAvisos(slug, contagens)}
      ativo={`/${slug}`}
      tema={tema}
      titulo="Painel"
      // Sem período: o simples é sempre hoje. A LOJA fica — o dono de três
      // lojas pergunta "e a do shopping?" no mesmo minuto em que pergunta
      // "quanto vendi?", e um seletor só não complica ninguém.
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} /> : undefined}
    >
      <div className="flex flex-col gap-6">
        {onde.opcoes.length === 0 && <SemUnidade />}

        <header className="flex flex-col gap-1">
          <h2 className="text-[26px] leading-tight font-bold tracking-[-0.03em] text-balance sm:text-[30px]">
            {saudacao(r.hora)}, {primeiroNome(sessao.nome)}
          </h2>
          <p className="text-sm text-tinta-2">
            {maiuscula(diaPorExtenso(agora))}
            {onde.mostrarSeletor && <> · {onde.titulo}</>}
          </p>
        </header>

        {/* Duas colunas no computador: o que aconteceu à esquerda, o que
            fazer à direita. No celular vira uma fila só, e a ORDEM muda —
            os números, depois o que precisa de você, os botões, e só então
            o gráfico: no telefone, o que fazer vem antes do detalhe do que
            já aconteceu. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="order-1 lg:order-none lg:col-span-2">
            <Faixa
              colunas={3}
              principal={
                <Numero
                  principal
                  rotulo="Vendido hoje"
                  valor={brl(d.hoje.total)}
                  detalhe={`${d.hoje.vendas} venda${d.hoje.vendas === 1 ? '' : 's'}`}
                  // "até esta hora" fica na ficha do lado, que mostra o
                  // número contra o qual a seta foi calculada.
                  comparacao={{ pct, contra: `vs ${passada}` }}
                />
              }
            >
              <Numero
                celula
                rotulo="Vendas"
                valor={d.hoje.vendas.toLocaleString('pt-BR')}
                detalhe={d.hoje.ultima ? `a última às ${horaMinuto(d.hoje.ultima)}` : 'nenhuma ainda'}
              />
              <Numero celula rotulo="Ticket médio" valor={brl(d.hoje.ticket)} detalhe="por venda" />
              <Numero
                celula
                rotulo={maiuscula(passada)}
                valor={brl(d.semanaPassada.ateAgora)}
                detalhe={`até esta hora · ${brl(d.semanaPassada.diaInteiro)} no dia`}
              />
            </Faixa>
          </div>

          {/* O bloco do ramo: no computador, a linha inteira logo abaixo dos
              números — é a pergunta da manhã de cada negócio. No celular,
              depois dos botões: o que fazer vem antes do que olhar. */}
          {nichos.map((b) => (
            <div key={b.ramo} className="order-4 min-w-0 lg:order-none lg:col-span-2">
              <BlocoDoRamo bloco={b} slug={slug} sessao={sessao} varias={onde.mostrarSeletor} />
            </div>
          ))}

          <Bloco className="order-4 lg:order-none" titulo="Hora a hora" detalhe={`Hoje contra ${passada}`}>
            {semMovimento ? (
              <p className="py-8 text-center text-sm text-tinta-3">
                Nenhuma venda hoje, nem {passada.endsWith('o') ? 'no' : 'na'} {passada}. O gráfico aparece com a primeira.
              </p>
            ) : (
              <BarrasMeses
                rotulos={horas.map((h) => `${h}h`)}
                series={[
                  { nome: 'Hoje', cor: 'var(--marca)', valores: horas.map((h) => d.porHora[h] ?? 0) },
                  {
                    nome: maiuscula(passada),
                    // A semana passada é a SOMBRA de hoje: mesma forma, sem
                    // disputar o olho. Mistura de ficha, não cor solta.
                    cor: 'color-mix(in srgb, var(--tinta-3) 45%, var(--superficie))',
                    valores: horas.map((h) => d.porHoraSemanaPassada[h] ?? 0),
                  },
                ]}
                altura={150}
              />
            )}
          </Bloco>

          <Bloco
            className="order-2 lg:order-none"
            titulo="Precisa de você"
            acao={
              pendencias.length > 0 ? (
                <Ponto
                  nivel={urgentes > 0 ? 'critico' : 'atencao'}
                  quantos={pendencias.length}
                  titulo={pendencias.length === 1 ? 'assunto' : 'assuntos'}
                />
              ) : undefined
            }
          >
            <Pendencias itens={pendencias} />
          </Bloco>

          <Bloco className="order-5 lg:order-none" titulo="Mais vendidos" detalhe="Últimos 7 dias">
            <Ranque
              vazio="Nenhuma venda nos últimos 7 dias."
              itens={d.maisVendidos.map((i) => ({
                rotulo: i.descricao,
                valor: i.total,
                detalhe: `${i.quantidade.toLocaleString('pt-BR')} un`,
              }))}
            />
          </Bloco>

          {atalhos.length > 0 && (
            <section aria-label="Atalhos" className="order-3 lg:order-none">
              <Atalhos itens={atalhos} />
            </section>
          )}
        </div>

        <footer className="flex justify-center border-t border-borda pt-4">
          <IrParaModo para="avancado">Ver o painel completo</IrParaModo>
        </footer>
      </div>
    </Estrutura>
  )
}

/* ═══════════════════════════════════════════════════════════
   AVANÇADO
   ═══════════════════════════════════════════════════════════ */

async function Avancado({ slug, empresa, sessao, tema, onde, pedido }: Base & { pedido?: string }) {
  const j = janela(lerPeriodo(pedido))
  const temCrediario = moduloLigado(empresa, 'crediario') && pode(sessao, 'crediario.ver')
  const verEquipe = moduloLigado(empresa, 'metas') && pode(sessao, 'equipe.ver')
  const [r, fiado, metas, contagens, nichos] = await Promise.all([
    resumoDoPainel(sessao, onde.ids, j),
    temCrediario ? resumoCrediario(sessao, onde.ids) : Promise.resolve(null),
    verEquipe ? metasDoMes(sessao, mesChave(new Date())) : Promise.resolve([]),
    pendenciasDoDia(sessao, empresa, onde.ids),
    nichoSemDerrubar(sessao, empresa, onde.ids, new Date()),
  ])
  const pendencias = montarPendencias(contagens, slug, onde.unidadeId)

  const completo = r.plano !== 'GRATIS'

  // As estrelas do mês reaproveitam as metas já lidas: o painel é a tela que
  // mais consulta o banco, e não vale ler a mesma coisa duas vezes. Fora do
  // Promise.all porque abre o próprio comoOrg depois do das metas.
  const verDesempenho = verEquipe && liberado(r.plano, 'desempenho.basico')
  const desempenho = verDesempenho
    ? await desempenhoDoMes(sessao, mesChave(new Date()), { metas: true, metasProntas: metas })
    : null
  const melhores = desempenho?.pessoas.filter((p) => !semDados(p.nota)).slice(0, 5) ?? []
  const temCartaoMeta = metas.some((m) => m.valor > 0)

  const verDinheiro = pode(sessao, 'financeiro.ver')
  const verEstoque = pode(sessao, 'estoque.ver')
  const acabou = r.acabando.filter((a) => a.saldo <= 0).length

  // A comparação é sempre contra a janela do MESMO tamanho logo antes: é o
  // que faz a seta querer dizer alguma coisa. Quando não houve movimento
  // antes, não existe porcentagem — e mostrar "+∞%" seria pior que não
  // mostrar nada.
  const pct =
    r.anterior.total > 0 ? ((r.atual.total - r.anterior.total) / r.anterior.total) * 100 : NaN
  const margem = r.atual.total > 0 ? ((r.atual.total - r.atual.custo) / r.atual.total) * 100 : 0

  // ── por hora do dia: somando os dias da semana ──────────
  const porHoraDia = Array.from({ length: 24 }, (_, h) => r.porHora.reduce((s, dia) => s + (dia[h] ?? 0), 0))
  const horas = horasDaLoja(porHoraDia)
  const semanaOrdem = [1, 2, 3, 4, 5, 6, 0] // segunda primeiro

  const identificadasPct = r.clientes.vendas > 0 ? (r.clientes.identificadas / r.clientes.vendas) * 100 : 0
  const recorte = j.rotulo.toLowerCase()

  const Bloqueado = ({ titulo, oQue }: { titulo: string; oQue: string }) => (
    <Bloco titulo={titulo}>
      <p className="py-4 text-center text-sm text-tinta-2">
        {oQue} faz parte do relatório completo, do plano Balcão para cima.{' '}
        <Link href={`/${slug}/assinatura`} className="font-semibold text-marca underline-offset-2 hover:underline">
          Ver planos
        </Link>
      </p>
    </Bloco>
  )

  const TudoCerto = ({ children }: { children: string }) => (
    <p className="flex items-center justify-center gap-2 py-6 text-center text-sm font-medium text-bom">
      <span aria-hidden className="size-2 rounded-full bg-bom-vivo" />
      {children}
    </p>
  )

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menuComAvisos(slug, contagens, r.parados.length)}
      ativo={`/${slug}`}
      tema={tema}
      titulo="Painel"
      acao={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SeletorPeriodo atual={j.chave} />
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
        </div>
      }
    >
      <div className="flex flex-col gap-10">
        {(onde.opcoes.length === 0 || pendencias.length > 0) && (
          <div className="flex flex-col gap-3">
            {onde.opcoes.length === 0 && <SemUnidade />}
            <PendenciasCurtas itens={pendencias} />
          </div>
        )}

        {/* ── VENDAS ── */}
        <Secao titulo={`${j.rotulo} · ${onde.titulo}`}>
          {/* O total do periodo e o numero que a pessoa abre o sistema para
              ver. Os outros sao apoio — sem essa diferenca, a faixa de
              fichas vira fileira e o olho nao sabe onde pousar. */}
          <Faixa
            colunas={verDinheiro ? 3 : 2}
            principal={
              <Numero
                principal
                rotulo={j.rotulo}
                valor={brl(r.atual.total)}
                detalhe={`${r.atual.vendas} venda${r.atual.vendas === 1 ? '' : 's'}${
                  r.devolucoes.valor > 0 ? ` · ${brl(r.devolucoes.valor)} devolvidos` : ''
                }`}
                comparacao={{ pct, contra: j.comparacao }}
              />
            }
          >
            <Numero
              celula
              rotulo="Média por dia"
              valor={brl(r.atual.total / j.dias)}
              detalhe={`em ${j.dias} dia${j.dias === 1 ? '' : 's'}`}
              nivel="bom"
            />
            <Numero celula rotulo="Ticket médio" valor={brl(r.atual.ticket)} detalhe="por venda" />
            {verDinheiro && (
              <Numero
                celula
                rotulo="Margem"
                valor={`${margem.toFixed(0)}%`}
                detalhe={`${brl(r.atual.total - r.atual.custo)} sobre o custo`}
                nivel={margem >= 40 ? 'bom' : margem >= 20 ? 'atencao' : 'critico'}
              />
            )}
          </Faixa>

          {/* Um dia so nao vira grafico de dias: seria uma barra sozinha. */}
          {j.temGrafico &&
            (completo ? (
              <Bloco titulo="Movimento" detalhe={`${j.rotulo} contra ${j.comparacao.replace('vs ', '')}`}>
                <Linhas
                  rotulos={r.porDia.map((d) => ddmm(d.dia))}
                  series={[
                    { nome: j.rotulo, cor: 'var(--bom-vivo)', valores: r.porDia.map((d) => d.total) },
                    { nome: maiuscula(j.comparacao.replace('vs ', '')), cor: 'var(--tinta-3)', valores: r.porDiaAnterior.map((d) => d.total) },
                  ]}
                  altura={150}
                />
              </Bloco>
            ) : (
              <Bloco titulo="Movimento" detalhe={j.rotulo}>
                <Barras dados={r.porDia} titulo="Vendas por dia" />
              </Bloco>
            ))}

          <div className="grid gap-4 lg:grid-cols-2">
            {completo ? (
              <Bloco titulo="Como receberam" detalhe="Por forma de pagamento">
                <Rosca
                  fatias={r.porForma.map((f) => ({
                    rotulo: FORMA[f.forma] ?? f.forma,
                    valor: f.total,
                    detalhe: `${f.vendas}×`,
                  }))}
                />
              </Bloco>
            ) : (
              <Bloqueado titulo="Como receberam" oQue="Como receberam, por forma de pagamento," />
            )}
            {completo ? (
              <Bloco titulo="Por hora do dia" detalhe={`Somando os dias · ${recorte}`}>
                <BarrasMeses
                  rotulos={horas.map((h) => `${h}h`)}
                  series={[{ nome: 'Vendido', cor: 'var(--marca)', valores: horas.map((h) => porHoraDia[h] ?? 0) }]}
                  altura={130}
                />
              </Bloco>
            ) : (
              <Bloqueado titulo="Por hora do dia" oQue="O movimento por hora do dia" />
            )}
          </div>

          {onde.mostrarSeletor && onde.unidadeId === null && (
            <Bloco titulo="Por unidade" detalhe={j.rotulo}>
              <Ranque
                itens={r.porUnidade.map((u) => ({
                  rotulo: u.nome,
                  valor: u.total,
                  detalhe: `${u.vendas} vendas`,
                }))}
              />
            </Bloco>
          )}
        </Secao>

        {/* ── O RAMO ──
            Depois das vendas do período, e sempre de HOJE: o título diz. É o
            que o dono da sorveteria e o da loja de roupa perguntam de
            maneiras diferentes — ver servidor/nicho.ts. */}
        {nichos.map((b) => (
          <BlocoDoRamo key={b.ramo} bloco={b} slug={slug} sessao={sessao} varias={onde.mostrarSeletor} secao />
        ))}

        {/* ── QUANDO ── */}
        {completo && j.dias >= 7 && r.atual.vendas > 0 && (
          <Secao
            titulo="Quando a loja vende"
            resumo="Dia da semana contra hora do dia. É o que decide a escala da equipe e o horário de abrir."
          >
            <Bloco>
              <Calor
                linhas={semanaOrdem.map((d) => SEMANA[d]!)}
                colunas={horas.map(String)}
                valores={semanaOrdem.map((d) => horas.map((h) => r.porHora[d]?.[h] ?? 0))}
              />
            </Bloco>
          </Secao>
        )}

        {/* ── PRODUTOS ── */}
        <Secao titulo="Produtos">
          <div className="grid gap-4 lg:grid-cols-2">
            <Bloco titulo="Mais vendidos" detalhe={j.rotulo}>
              <Ranque
                itens={r.maisVendidos.map((i) => ({
                  rotulo: i.descricao,
                  valor: i.total,
                  detalhe: `${i.quantidade.toLocaleString('pt-BR')} un`,
                }))}
              />
            </Bloco>

            {completo ? (
              <Bloco titulo="Por categoria" detalhe={j.rotulo}>
                <BarrasH
                  itens={r.porCategoria.map((c) => ({
                    rotulo: c.nome,
                    valor: c.total,
                    detalhe: `${c.quantidade.toLocaleString('pt-BR')} un`,
                  }))}
                />
              </Bloco>
            ) : (
              <Bloqueado titulo="Por categoria" oQue="A venda por categoria" />
            )}
          </div>

          <Bloco
            titulo="Parados há mais de 30 dias"
            detalhe="Com saldo e sem nenhuma venda no último mês"
            acao={r.parados.length > 0 ? <Ponto nivel="atencao" quantos={r.parados.length} titulo="parados" /> : undefined}
          >
            {r.parados.length === 0 ? (
              <TudoCerto>Tudo girou no último mês.</TudoCerto>
            ) : (
              <ul className="flex flex-col divide-y divide-borda-suave">
                {r.parados.map((p) => (
                  <li key={p.descricao} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="truncate text-sm text-tinta">{p.descricao}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="numero text-sm text-tinta-2">{p.saldo} un</span>
                      <Situacao nivel="atencao">
                        {p.desde == null ? 'nunca vendeu' : `${p.desde}d`}
                      </Situacao>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
        </Secao>

        {/* ── ESTOQUE ── */}
        {verEstoque && (
          <Secao titulo="Estoque">
            <Faixa colunas={verDinheiro ? 3 : 2}>
              <Numero celula rotulo="Itens diferentes" valor={r.estoque.itens.toLocaleString('pt-BR')} detalhe="com saldo" />
              <Numero celula rotulo="Peças em estoque" valor={r.estoque.unidades.toLocaleString('pt-BR')} detalhe="somando tudo" />
              {verDinheiro && (
                <Numero
                  celula
                  rotulo="Dinheiro parado"
                  valor={brl(r.estoque.valorCusto)}
                  detalhe="a preço de custo"
                  nivel="atencao"
                />
              )}
            </Faixa>

            <div className="grid gap-4 lg:grid-cols-2">
              <Bloco
                titulo="Acabando"
                detalhe="No mínimo cadastrado ou abaixo dele"
                acao={
                  r.acabando.length > 0 ? (
                    <Ponto nivel={acabou > 0 ? 'critico' : 'atencao'} quantos={r.acabando.length} titulo="itens" />
                  ) : undefined
                }
              >
                {r.acabando.length === 0 ? (
                  <TudoCerto>Nada abaixo do mínimo.</TudoCerto>
                ) : (
                  <ul className="flex flex-col divide-y divide-borda-suave">
                    {r.acabando.map((a) => (
                      <li key={a.descricao} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <span className="truncate text-sm text-tinta">{a.descricao}</span>
                        <Situacao nivel={a.saldo <= 0 ? 'critico' : 'atencao'}>
                          {a.saldo <= 0 ? 'acabou' : `${a.saldo} de ${a.minimo}`}
                        </Situacao>
                      </li>
                    ))}
                  </ul>
                )}
              </Bloco>

              {verDinheiro &&
                (completo ? (
                  <Bloco titulo="Dinheiro parado, por categoria" detalhe="Saldo × custo">
                    <BarrasH
                      itens={r.estoquePorCategoria.map((c) => ({ rotulo: c.nome, valor: c.valor }))}
                      cor="var(--atencao-vivo)"
                      vazio="Nada em estoque com custo cadastrado."
                    />
                  </Bloco>
                ) : (
                  <Bloqueado titulo="Dinheiro parado, por categoria" oQue="O dinheiro parado por categoria" />
                ))}
            </div>
          </Secao>
        )}

        {/* ── FIADO ── */}
        {fiado && (fiado.emAberto > 0 || fiado.vencido > 0) && (
          <Secao
            titulo="Crediário"
            acao={
              <Link href={`/${slug}/crediario`} className="text-sm font-medium text-marca underline-offset-2 hover:underline">
                Quem deve, quanto e desde quando →
              </Link>
            }
          >
            <Faixa colunas={3}>
              <Numero celula rotulo="Em aberto" valor={brl(fiado.emAberto)} detalhe={plural(fiado.clientesDevendo, 'cliente', 'clientes')} />
              <Numero
                celula
                rotulo="Vencido"
                valor={brl(fiado.vencido)}
                detalhe={fiado.parcelasVencidas ? `${plural(fiado.parcelasVencidas, 'parcela', 'parcelas')} · ${plural(fiado.clientesAtrasados, 'cliente', 'clientes')}` : 'ninguém atrasado'}
                nivel={fiado.vencido > 0 ? 'critico' : 'bom'}
              />
              <Numero celula rotulo="Vence em 7 dias" valor={brl(fiado.aVencer7)} detalhe="para lembrar antes" />
            </Faixa>
          </Secao>
        )}

        {/* ── EQUIPE ── */}
        {verEquipe && (
          <Secao titulo="Equipe">
            <div className={cx('grid gap-4 lg:grid-cols-2', temCartaoMeta && 'xl:grid-cols-3')}>
              <Bloco titulo="Quem mais vendeu" detalhe={j.rotulo}>
                <Ranque
                  itens={r.porVendedor.map((v) => ({
                    rotulo: v.nome,
                    valor: v.total,
                    detalhe: `${v.vendas} vendas`,
                  }))}
                />
              </Bloco>
              {temCartaoMeta && (
                <Bloco
                  titulo="Meta do mês"
                  acao={
                    <Link href={`/${slug}/equipe`} className="text-xs font-medium text-marca underline-offset-2 hover:underline">
                      metas e comissão
                    </Link>
                  }
                >
                  <ul className="flex flex-col gap-3">
                    {metas
                      .filter((m) => m.valor > 0)
                      .sort((a, b) => (b.progresso ?? 0) - (a.progresso ?? 0))
                      .map((m) => {
                        const p = m.progresso ?? 0
                        return (
                          <li key={m.usuarioId} className="flex flex-col gap-1">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="truncate text-tinta">{m.nome}</span>
                              <span className="flex shrink-0 items-baseline gap-2">
                                <span className="numero font-semibold text-tinta">{brl(m.liquido)}</span>
                                <span className="numero text-xs text-tinta-3">de {brl(m.valor)}</span>
                                <span className={'numero text-xs font-semibold ' + (p >= 1 ? 'text-bom' : p >= 0.7 ? 'text-atencao' : 'text-critico')}>
                                  {Math.round(p * 100)}%
                                </span>
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-superficie-2">
                              <div
                                className={'h-full rounded-full ' + (p >= 1 ? 'bg-bom-vivo' : p >= 0.7 ? 'bg-atencao-vivo' : 'bg-critico-vivo')}
                                style={{ width: `${Math.min(p, 1) * 100}%` }}
                              />
                            </div>
                          </li>
                        )
                      })}
                  </ul>
                </Bloco>
              )}
              <Bloco
                titulo="Desempenho do mês"
                acao={
                  <Link href={`/${slug}/equipe`} className="text-xs font-medium text-marca underline-offset-2 hover:underline">
                    ver a equipe
                  </Link>
                }
              >
                {verDesempenho ? (
                  melhores.length === 0 ? (
                    <p className="py-6 text-center text-sm text-tinta-3">Sem meta, tarefa ou entrada registrada neste mês ainda.</p>
                  ) : (
                    <ol className="flex flex-col gap-2">
                      {melhores.map((p) => (
                        <li key={p.usuarioId} className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate text-tinta">{p.nome}</span>
                          <Estrelas valor={p.nota.estrelas} tamanho="sm" />
                        </li>
                      ))}
                    </ol>
                  )
                ) : (
                  // Amostra inventada, nunca dado real: o plano não abre.
                  // A amostra tem altura mínima: o convite na frente tem
                  // botão, e amostra mais baixa que ele cortava o "Ver os
                  // planos" no pé do papel.
                  <Trancado
                    chave="desempenho.basico"
                    plano={r.plano}
                    slug={slug}
                    verPlanos={podeVerPlanos(sessao)}
                    resumo="Uma nota de 0 a 5 por pessoa, todo mês: meta, tarefas no prazo e presença."
                  >
                    <ol className="flex min-h-44 flex-col gap-2">
                      {[
                        ['Ana', 4.5],
                        ['Bia', 4],
                        ['Carlos', 3.5],
                        ['Duda', 3],
                        ['Edu', 2.5],
                      ].map(([nome, v]) => (
                        <li key={String(nome)} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-tinta">{nome}</span>
                          <Estrelas valor={Number(v)} tamanho="sm" />
                        </li>
                      ))}
                    </ol>
                  </Trancado>
                )}
              </Bloco>
            </div>
          </Secao>
        )}

        {/* ── CLIENTES ── */}
        {pode(sessao, 'cliente.ver') && (
          <Secao titulo="Clientes">
            <Faixa colunas={completo ? 4 : 2}>
              <Numero celula rotulo="Cadastrados" valor={r.clientes.total.toLocaleString('pt-BR')} detalhe="ativos" />
              <Numero
                celula
                rotulo="Novos no período"
                valor={r.clientes.novosNoPeriodo.toLocaleString('pt-BR')}
                detalhe={recorte}
                nivel={r.clientes.novosNoPeriodo > 0 ? 'bom' : undefined}
              />
              {completo && (
                <>
                  <Numero
                    celula
                    rotulo="Vendas com cliente"
                    valor={`${identificadasPct.toFixed(0)}%`}
                    detalhe={`${r.clientes.identificadas} de ${r.clientes.vendas}`}
                    nivel={identificadasPct >= 50 ? 'bom' : identificadasPct >= 20 ? 'atencao' : 'critico'}
                  />
                  <Numero
                    celula
                    rotulo="Voltaram no período"
                    valor={r.clientes.recorrentes.toLocaleString('pt-BR')}
                    detalhe={`de ${r.clientes.pessoas} pessoa${r.clientes.pessoas === 1 ? '' : 's'} que compraram`}
                  />
                </>
              )}
            </Faixa>
            {completo && identificadasPct < 50 && r.clientes.vendas > 5 && (
              <p className="text-xs text-tinta-3">
                Venda sem cliente escolhido é histórico que não existe. Quanto mais vendas com nome, mais o
                sistema consegue dizer quem sumiu e quem voltou.
              </p>
            )}
          </Secao>
        )}

        <footer className="flex justify-center border-t border-borda pt-4">
          <IrParaModo para="simples">Voltar ao simples</IrParaModo>
        </footer>
      </div>
    </Estrutura>
  )
}

/* ═══════════════════════════════════════════════════════════
   O RAMO — "Hoje na sua sorveteria"
   ═══════════════════════════════════════════════════════════ */

/**
 * O bloco do ramo nunca derruba o painel: se a conta dele falhar, o painel
 * abre sem ele (e o erro vai para o log). Ele é o complemento da manhã; o
 * "quanto vendi" e o "precisa de você" são o essencial, e não podem sumir por
 * causa dele.
 */
async function nichoSemDerrubar(sessao: Sessao, empresa: Empresa, ids: string[], agora: Date): Promise<BlocoDoNicho[]> {
  try {
    return await nichoDoPainel(sessao, empresa, ids, agora)
  } catch (e) {
    console.error('[painel] bloco do ramo falhou', e)
    return []
  }
}

const diaCurto = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d)

/** Um pedaço do bloco: título miúdo, a linha que explica o recorte, e a lista. */
function Peca({
  titulo,
  detalhe,
  icone,
  acao,
  children,
}: {
  titulo: string
  detalhe?: string
  /** Um endereço do menu, para o ícone da tela onde se age. */
  icone?: string
  acao?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {icone && <IconeDoItem href={icone} tamanho={16} className="mt-0.5 shrink-0 text-tinta-3" />}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h4 className="text-sm leading-snug font-bold text-tinta">{titulo}</h4>
            {detalhe && <p className="text-xs text-tinta-3">{detalhe}</p>}
          </div>
        </div>
        {acao}
      </header>
      {children}
    </section>
  )
}

/** Nada a fazer — em verde, como o "tudo em dia" do Precisa de você. */
function Calmo({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-norte bg-bom-fundo px-3 py-2.5 text-sm text-bom">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-bom-vivo" />
      {children}
    </p>
  )
}

/** Ainda não há dado para a conta — neutro, sem cor de alarme nem de festa. */
function SemDado({ children }: { children: ReactNode }) {
  return <p className="rounded-norte bg-superficie-2 px-3 py-2.5 text-sm text-tinta-3">{children}</p>
}

const linkMiudo = 'shrink-0 text-xs font-semibold text-marca underline-offset-2 hover:underline'

type NoEstoque = (q: string, unidadeId?: string | null) => string | null

function BlocoDoRamo({
  bloco,
  slug,
  sessao,
  varias,
  secao = false,
}: {
  bloco: BlocoDoNicho
  slug: string
  sessao: Sessao
  /** A empresa tem mais de uma loja: o bloco diz de qual (ou quais) é. */
  varias: boolean
  /** No avançado, o bloco é uma seção do painel, com o título grande. */
  secao?: boolean
}) {
  // O link leva para onde se age — e só aparece para quem pode abrir a tela,
  // NAQUELA loja. A loja vai no endereço, para a tela já abrir nela.
  const noEstoque: NoEstoque = (q, unidadeId = bloco.unidadeId) =>
    pode(sessao, 'estoque.ver', unidadeId ?? undefined)
      ? `/${slug}/estoque?${unidadeId ? `unidade=${unidadeId}&` : ''}q=${encodeURIComponent(q)}`
      : null
  const lojas = varias ? listaFalada(bloco.lojas.map((l) => l.nome)) : undefined
  const variasNoBloco = varias && bloco.lojas.length > 1

  const corpo =
    bloco.familia === 'grade' ? (
      <GradeDoRamo dados={bloco.dados} noEstoque={noEstoque} varias={variasNoBloco} />
    ) : bloco.familia === 'sabores' ? (
      <SaboresDoRamo dados={bloco.dados} noEstoque={noEstoque} />
    ) : bloco.familia === 'producao' ? (
      <ProducaoDoRamo
        dados={bloco.dados}
        encomendas={
          pode(sessao, 'venda.ver', bloco.unidadeId ?? undefined)
            ? `/${slug}/encomendas${bloco.unidadeId ? `?unidade=${bloco.unidadeId}` : ''}`
            : null
        }
        varias={variasNoBloco}
      />
    ) : (
      <ReposicaoDoRamo dados={bloco.dados} noEstoque={noEstoque} slug={slug} />
    )

  if (secao) {
    return (
      <Secao titulo={bloco.titulo} resumo={lojas}>
        <Bloco>{corpo}</Bloco>
      </Secao>
    )
  }
  return (
    <Bloco titulo={bloco.titulo} detalhe={lojas}>
      {corpo}
    </Bloco>
  )
}

/* ── roupa, calçado, bijuteria ── */

function GradeDoRamo({ dados, noEstoque, varias }: { dados: DadosGrade; noEstoque: NoEstoque; varias: boolean }) {
  const mv = dados.maisVendida
  return (
    <div className={cx('grid gap-6', dados.quebradas && 'md:grid-cols-2')}>
      {dados.quebradas && (
        <Peca titulo="Grade quebrada" detalhe="O que vende acabou, e o resto da grade sobrou" icone="/x/estoque">
          {dados.quebradas.length === 0 ? (
            <Calmo>Nenhuma grade quebrada: o que vende está na prateleira.</Calmo>
          ) : (
            <ul className="flex flex-col divide-y divide-borda-suave">
              {dados.quebradas.map((q) => {
                const href = noEstoque(q.produto, q.unidadeId)
                // Grade de dois eixos sobra muita coisa ("Azul · P, Azul · M…"):
                // as duas primeiras dizem o recado, o resto vira número.
                const sobrou =
                  q.sobrou.length > 3 ? `${q.sobrou.slice(0, 2).join(', ')} e mais ${q.sobrou.length - 2}` : listaFalada(q.sobrou)
                return (
                  <li key={`${q.unidadeId}-${q.produtoId}`} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-semibold text-tinta">
                        {q.produto}
                        {varias && <span className="font-normal text-tinta-3"> · {q.unidadeNome}</span>}
                      </span>
                      {href && (
                        <Link href={href} className={linkMiudo}>
                          Repor →
                        </Link>
                      )}
                    </div>
                    <p className="text-sm leading-snug text-tinta-2">
                      <span className="font-semibold text-critico">Acabou {listaFalada(q.acabou)}</span>
                      <span className="text-tinta-3"> · sobrou {sobrou}</span>
                    </p>
                    {q.temEm.length > 0 && (
                      <p className="text-xs text-tinta-3">
                        {listaFalada(q.temEm)} {q.temEm.length === 1 ? 'tem' : 'têm'}{' '}
                        {q.acabou.length === 1 ? 'essa peça' : 'dessas peças'} — dá para transferir.
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Peca>
      )}

      <Peca
        titulo={mv ? `${mv.eixo} que mais sai` : 'O que mais sai na grade'}
        detalhe={mv ? `Últimos 7 dias · ${plural(mv.total, 'peça', 'peças')}` : 'Últimos 7 dias'}
      >
        {!mv ? (
          <SemDado>Nenhuma peça com grade vendida nos últimos 7 dias.</SemDado>
        ) : (
          <ul className="flex flex-col gap-2">
            {mv.itens.map((i) => (
              <li key={i.valor} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                <span className={cx('truncate', i.maior ? 'font-bold text-tinta' : 'text-tinta-2')}>{i.valor}</span>
                <span className="h-2 overflow-hidden rounded-full bg-superficie-2">
                  <span
                    className={cx('block h-full rounded-full', i.maior ? 'bg-marca' : 'bg-marca/35')}
                    style={{ width: `${Math.max(i.pct, 3)}%` }}
                  />
                </span>
                <span className="numero text-xs text-tinta-2">
                  <span className="font-semibold text-tinta">{i.quantidade.toLocaleString('pt-BR')}</span> ·{' '}
                  {i.pct.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </Peca>
    </div>
  )
}

/* ── sorveteria ── */

function SaboresDoRamo({ dados, noEstoque }: { dados: DadosSabores; noEstoque: NoEstoque }) {
  const numeros: { rotulo: string; valor: string; detalhe?: string }[] = [
    ...(dados.vendePeso ? [{ rotulo: 'Saiu a quilo hoje', valor: quantidadeFalada(dados.kgHoje, 'KG') }] : []),
    { rotulo: 'Vendas hoje', valor: dados.vendasHoje.toLocaleString('pt-BR') },
    {
      rotulo: 'Pico de hoje',
      valor: dados.pico ? `${dados.pico.hora}h` : '—',
      detalhe: dados.pico ? plural(dados.pico.vendas, 'venda', 'vendas') : 'sem venda ainda',
    },
  ]
  return (
    <div className="flex flex-col gap-6">
      {/* Os números do dia numa régua só, dividida por fios — a mesma conta
          da `Faixa` do painel, em miúdo. */}
      <dl
        className={cx(
          'grid gap-px overflow-hidden rounded-norte border border-borda bg-borda',
          numeros.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2',
        )}
      >
        {numeros.map((n) => (
          <div key={n.rotulo} className="flex items-baseline justify-between gap-3 bg-superficie px-3.5 py-2.5 sm:flex-col sm:justify-start sm:gap-0.5">
            <dt className="text-xs font-medium text-tinta-3">{n.rotulo}</dt>
            <dd className="numero text-xl leading-tight font-bold text-tinta">
              {n.valor}
              {n.detalhe && <span className="ml-1.5 text-xs font-medium text-tinta-3">{n.detalhe}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <div className={cx('grid gap-6', dados.acabando && 'md:grid-cols-2')}>
        {dados.acabando && (
          <Peca titulo="O que está acabando" detalhe="Pelo que sai num dia e pelo mínimo da loja" icone="/x/estoque">
            {dados.acabando.length === 0 ? (
              <Calmo>Nada acabando.</Calmo>
            ) : (
              <ul className="flex flex-col divide-y divide-borda-suave">
                {dados.acabando.map((s) => {
                  const href = noEstoque(s.produto ?? s.rotulo)
                  return (
                    <li key={s.variacaoId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold text-tinta">{s.rotulo}</span>
                        {s.produto && <span className="truncate text-xs text-tinta-3">{s.produto}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Situacao nivel={s.motivo === 'acabou' ? 'critico' : 'atencao'}>
                          {s.motivo === 'acabou'
                            ? 'acabou'
                            : s.motivo === 'acaba_hoje'
                              ? `acaba hoje · ${quantidadeFalada(s.saldo, s.medida)}`
                              : `no mínimo · ${quantidadeFalada(s.saldo, s.medida)}`}
                        </Situacao>
                        {href && (
                          <Link href={href} className={linkMiudo} aria-label={`Ver ${s.rotulo} no estoque`}>
                            →
                          </Link>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Peca>
        )}

        <Peca titulo="Mais saíram hoje" detalhe="Pela quantidade, sabor por sabor">
          {dados.doDia.length === 0 ? (
            <SemDado>Nenhum sabor vendido hoje ainda.</SemDado>
          ) : (
            <ol className="flex flex-col divide-y divide-borda-suave">
              {dados.doDia.map((s, i) => (
                <li key={s.variacaoId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="numero w-4 shrink-0 text-xs font-bold text-tinta-3">{i + 1}</span>
                    <span className="truncate text-sm text-tinta">
                      {s.rotulo}
                      {s.produto && <span className="text-tinta-3"> · {s.produto}</span>}
                    </span>
                  </span>
                  <span className="numero shrink-0 text-sm font-semibold text-tinta">
                    {quantidadeFalada(s.vendidosHoje, s.medida)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Peca>
      </div>
    </div>
  )
}

/* ── padaria, lanchonete, floricultura, serviço ── */

function ProducaoDoRamo({
  dados,
  encomendas,
  varias,
}: {
  dados: DadosProducao
  /** O endereço da tela de encomendas, para quem pode abrir. */
  encomendas: string | null
  varias: boolean
}) {
  const e = dados.encomendas
  const grupos = e
    ? (
        [
          ['Atrasadas', e.atrasadas, true],
          ['Hoje', e.hoje, false],
          ['Amanhã', e.amanha, false],
        ] as const
      ).filter(([, l]) => l.length > 0)
    : []
  const dia = diaDaSemana(diaEmSP(new Date()))
  const hojeSP = diaEmSP(new Date())
  return (
    <div className={cx('grid gap-6', e ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2')}>
      {e && (
        <Peca
          titulo="Encomendas"
          detalhe="Para hoje e amanhã"
          icone="/x/encomendas"
          acao={
            encomendas ? (
              <Link href={encomendas} className={linkMiudo}>
                Ver todas →
              </Link>
            ) : undefined
          }
        >
          {grupos.length === 0 ? (
            <Calmo>Nada combinado para hoje nem amanhã.</Calmo>
          ) : (
            <div className="flex flex-col gap-3">
              {grupos.map(([titulo, lista, atraso]) => (
                <div key={titulo} className="flex flex-col gap-1.5">
                  <p
                    className={cx(
                      'text-[11px] font-bold tracking-[0.06em] uppercase',
                      atraso ? 'text-critico' : 'text-tinta-3',
                    )}
                  >
                    {titulo} · {lista.length}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {lista.slice(0, 4).map((x) => (
                      <li key={x.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 text-sm">
                        {/* Atrasada de outro dia mostra o DIA; a de hoje, a hora. */}
                        <span className={cx('numero font-bold', atraso ? 'text-critico' : 'text-tinta')}>
                          {diaEmSP(x.para) === hojeSP ? horaEmSP(x.para) : diaCurto(x.para)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-tinta">{x.descricao}</span>
                          <span className="block truncate text-xs text-tinta-3">
                            {x.clienteNome}
                            {x.situacao === 'PRONTA' && ' · pronta'}
                            {x.entrega && ' · entrega'}
                            {varias && ` · ${x.unidadeNome}`}
                          </span>
                        </span>
                      </li>
                    ))}
                    {lista.length > 4 && <li className="pl-14 text-xs text-tinta-3">e mais {lista.length - 4}</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Peca>
      )}

      <Peca
        titulo={dados.tituloProducao}
        detalhe={dados.semanas > 0 ? `Média ${dados.deQuando}, e o que já saiu hoje` : 'Média do mesmo dia da semana'}
      >
        {dados.semanas === 0 ? (
          <SemDado>
            A média aparece depois {dia.artigo === 'a' ? 'da primeira' : 'do primeiro'} {dia.um} com venda.
          </SemDado>
        ) : dados.producao.length === 0 ? (
          <SemDado>Nada vendido {dados.deQuando}.</SemDado>
        ) : (
          <ul className="flex flex-col divide-y divide-borda-suave">
            {dados.producao.map((p) => (
              <li key={p.chave} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0 truncate text-sm text-tinta">{p.rotulo}</span>
                <span className="flex shrink-0 flex-col items-end leading-tight">
                  <span className="numero text-sm font-bold text-tinta">≈ {quantidadeFalada(p.media, p.medida)}</span>
                  <span className="numero text-xs text-tinta-3">hoje {quantidadeFalada(p.hoje, p.medida)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Peca>

      <Peca titulo="Horas fortes" detalhe={dados.semanas > 0 ? `Nas ${dia.varios}, em média, e o que mais sai` : undefined}>
        {dados.horas.length === 0 ? (
          <SemDado>Ainda sem {dia.varios} com venda para comparar.</SemDado>
        ) : (
          <ul className="flex flex-col divide-y divide-borda-suave">
            {dados.horas.map((h) => (
              <li
                key={h.hora}
                className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-2 py-2 first:pt-0 last:pb-0"
              >
                <span className="numero text-sm font-bold text-tinta">{h.hora}h</span>
                <span className="truncate text-sm text-tinta-2">{h.item ?? '—'}</span>
                <span className="numero text-xs text-tinta-3">{brl(h.media)}</span>
              </li>
            ))}
          </ul>
        )}
      </Peca>
    </div>
  )
}

/* ── mercearia, pet shop, papelaria, autopeças… ── */

function ReposicaoDoRamo({ dados, noEstoque, slug }: { dados: DadosReposicao; noEstoque: NoEstoque; slug: string }) {
  const etiqueta = (r: NonNullable<DadosReposicao['repor']>[number]): { nivel: 'critico' | 'atencao'; texto: string } => {
    if (r.situacao === 'ja_faltou' || (r.situacao === 'minimo' && r.saldo <= 0)) return { nivel: 'critico', texto: 'acabou' }
    if (r.situacao === 'pedir_agora') return { nivel: 'critico', texto: 'pedir hoje' }
    if (r.situacao === 'atencao' && r.pedirAte) return { nivel: 'atencao', texto: `pedir até ${diaCurto(r.pedirAte)}` }
    if (r.situacao === 'minimo')
      return {
        nivel: 'atencao',
        texto: `${quantidadeFalada(r.saldo, r.medida)} de ${quantidadeFalada(r.minimo ?? 0, r.medida)}`,
      }
    return { nivel: 'atencao', texto: 'atenção' }
  }
  return (
    <div className={cx('grid gap-6', dados.repor && 'md:grid-cols-2')}>
      {dados.repor && (
        <Peca
          titulo="Repor logo"
          detalhe={dados.comPrevisao ? 'Pelo ritmo de venda e o prazo do fornecedor' : 'No mínimo que a loja cadastrou, ou abaixo'}
          icone="/x/estoque"
        >
          {dados.repor.length === 0 ? (
            <Calmo>{dados.comPrevisao ? 'Nada para pedir agora.' : 'Nada no mínimo.'}</Calmo>
          ) : (
            <ul className="flex flex-col divide-y divide-borda-suave">
              {dados.repor.map((r) => {
                const s = etiqueta(r)
                const href = noEstoque(r.rotulo.split(' — ')[0] ?? r.rotulo)
                return (
                  <li key={r.rotulo} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="min-w-0 truncate text-sm text-tinta">{r.rotulo}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Situacao nivel={s.nivel}>{s.texto}</Situacao>
                      {href && (
                        <Link href={href} className={linkMiudo} aria-label={`Ver ${r.rotulo} no estoque`}>
                          →
                        </Link>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {!dados.comPrevisao && (
            <p className="text-xs text-tinta-3">
              Dizer até quando pedir, pelo ritmo de venda e o prazo do fornecedor, é do plano{' '}
              {planoQueAbre('ruptura.previsao').titulo}.{' '}
              <Link href={`/${slug}/assinatura`} className="font-semibold text-marca underline-offset-2 hover:underline">
                Ver planos
              </Link>
            </p>
          )}
        </Peca>
      )}

      <Peca titulo="O que mais gira" detalhe="Últimos 7 dias, contra os 7 anteriores">
        {dados.giro.length === 0 ? (
          <SemDado>Nenhuma venda nos últimos 7 dias.</SemDado>
        ) : (
          <ol className="flex flex-col divide-y divide-borda-suave">
            {dados.giro.map((g, i) => (
              <li key={g.rotulo} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="numero w-4 shrink-0 text-xs font-bold text-tinta-3">{i + 1}</span>
                  <span className="truncate text-sm text-tinta">{g.rotulo}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="numero text-sm font-semibold text-tinta">{quantidadeFalada(g.semana, g.medida)}</span>
                  {/* seta E sinal: quem não distingue as cores lê o mesmo */}
                  <span
                    className={cx(
                      'numero w-14 text-right text-xs font-semibold',
                      g.variacao === null ? 'text-tinta-3' : g.variacao >= 0 ? 'text-bom' : 'text-critico',
                    )}
                  >
                    {g.variacao === null ? 'novo' : `${g.variacao >= 0 ? '▲' : '▼'} ${Math.abs(g.variacao).toFixed(0)}%`}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Peca>
    </div>
  )
}
