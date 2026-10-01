// "Hoje na sua sorveteria": o pedaço do painel que tem a cara do ramo.
//
// ── por que isto existe, se modulos.ts diz que ramo não é caminho de código ──
// O ramo continua não mudando REGRA nenhuma: a venda, o estoque, o preço e a
// permissão são os mesmos para a loja de roupa e para a padaria. O que muda
// aqui é a PERGUNTA que o painel faz primeiro. A dona da loja de roupa abre o
// sistema querendo saber se acabou o M da peça que vende; o padeiro, quanto
// pão pôr no forno e que bolo sai hoje; o dono da mercearia, o que pedir ao
// fornecedor. As três respostas saem dos mesmos dados (venda, estoque,
// encomenda) — só a lente muda. Por isso são cinco FAMÍLIAS, e não dezenove
// telas: ramo novo escolhe uma família numa tabela, como em RAMOS.
//
// A quinta, AGENDA, é de quem vende hora marcada — o salão, a clínica, a
// escola. Ali a primeira pergunta do dia não é o estoque, é "quem vem hoje, e
// onde ainda cabe alguém?". Ela lê a agenda (quando o módulo está ligado), o
// ponto (quem já chegou) e o que entrou no caixa hoje.
//
// ── a regra de honestidade ───────────────────────────────────
// Cada número diz de onde veio. "Média das últimas 4 quartas" é média das
// últimas 4 quartas — e se a loja só existe há duas, diz "das últimas 2". Não
// há previsão inventada, não há dado que o banco não tem: tudo aqui é soma do
// que foi vendido, contado e anotado.
//
// ── a regra da loja ──────────────────────────────────────────
// O ramo é da LOJA (`Unidade.ramo`), e cai no da empresa quando a loja não tem
// o dela. A mesma empresa pode ter a loja de roupa e a sorveteria, e no
// consolidado ("Todas as unidades") cada ramo ganha o seu bloco, com as lojas
// dele — a sorveteria não aparece na grade quebrada da loja de roupa.
//
// As funções puras (sem banco) estão em cima e testadas em
// `tests/nicho.test.ts`. As que leem o banco ficam embaixo, cada uma com o seu
// `comoOrg`, uma consulta depois da outra (ver banco.ts: nada de Promise.all
// dentro da transação, nada de comoOrg dentro de comoOrg).

import type { Plano, SituacaoEncomenda } from '@prisma/client'
import { comoOrg } from './banco'
import { RAMOS, moduloLigado, type ComModulos, type Ramo } from './modulos'
import { pode, soAsQuePode, type Sessao } from './permissao'
import { liberado } from './planos'
import { previsaoDeRuptura, type SituacaoRuptura } from './ruptura'
import { diaEmSP, inicioDoDiaEmSP, somarDias } from './dia'
import { grupoDa, horaEmSP } from './encomenda'
import { listarAgenda, profissionaisDaLoja, horarioDaLoja, resumirDia, ROTULO_AGENDA, type SituacaoAgendamento } from './agenda'
import { trabalhandoAgora } from './ponto'
import { vocabularioDoRamo } from './vocabulario'
import { alunosAtivos, listarTurmas, quaseCheia } from './escola'
import { resumoMensalidades } from './mensalidades'

// ─────────────────────────────────────────────────────────────
// A TABELA
// ─────────────────────────────────────────────────────────────

/**
 * As cinco lentes.
 *
 * `grade`     quem vende tamanho e cor: o que dói é a grade quebrada.
 * `sabores`   quem vende sabor, a quilo: o que acaba hoje, o que mais saiu.
 * `producao`  quem produz no dia ou trabalha por encomenda: o que fazer hoje.
 * `reposicao` quem revende catálogo grande: o que pedir, o que mais gira.
 * `agenda`    quem atende com hora marcada: quem vem hoje, onde ainda cabe,
 *             quem faltou, o que já foi atendido e recebido.
 */
export type Familia = 'grade' | 'sabores' | 'producao' | 'reposicao' | 'agenda'

type Nicho = {
  familia: Familia
  /** Como a pessoa chama o próprio negócio: "Hoje na sua padaria". */
  nome: string
  plural: string
  /** "na sua" ou "no seu" — pet shop é masculino. */
  artigo: 'a' | 'o'
  /** Só na família produção: como se chama o que se prepara no dia. */
  producao?: string
}

export const NICHOS: Record<Ramo, Nicho> = {
  roupa: { familia: 'grade', nome: 'loja de roupas', plural: 'lojas de roupas', artigo: 'a' },
  calcados: { familia: 'grade', nome: 'loja de calçados', plural: 'lojas de calçados', artigo: 'a' },
  bijuteria: { familia: 'grade', nome: 'loja de bijuterias', plural: 'lojas de bijuterias', artigo: 'a' },
  sorveteria: { familia: 'sabores', nome: 'sorveteria', plural: 'sorveterias', artigo: 'a' },
  padaria: { familia: 'producao', nome: 'padaria', plural: 'padarias', artigo: 'a', producao: 'Produção do dia' },
  lanchonete: { familia: 'producao', nome: 'lanchonete', plural: 'lanchonetes', artigo: 'a', producao: 'Preparo do dia' },
  floricultura: { familia: 'producao', nome: 'floricultura', plural: 'floriculturas', artigo: 'a', producao: 'Para deixar pronto' },
  // Serviço não "produz" — mas a pergunta da manhã é a mesma: o que costuma
  // sair neste dia da semana, e o que está combinado para hoje.
  servico: { familia: 'producao', nome: 'negócio', plural: 'negócios', artigo: 'o', producao: 'O que costuma sair' },
  mercearia: { familia: 'reposicao', nome: 'mercearia', plural: 'mercearias', artigo: 'a' },
  distribuidora: { familia: 'reposicao', nome: 'distribuidora', plural: 'distribuidoras', artigo: 'a' },
  construcao: { familia: 'reposicao', nome: 'loja de material de construção', plural: 'lojas de material de construção', artigo: 'a' },
  autopecas: { familia: 'reposicao', nome: 'loja de autopeças', plural: 'lojas de autopeças', artigo: 'a' },
  petshop: { familia: 'reposicao', nome: 'pet shop', plural: 'pet shops', artigo: 'o' },
  papelaria: { familia: 'reposicao', nome: 'papelaria', plural: 'papelarias', artigo: 'a' },
  brinquedos: { familia: 'reposicao', nome: 'loja de brinquedos', plural: 'lojas de brinquedos', artigo: 'a' },
  outro: { familia: 'reposicao', nome: 'loja', plural: 'lojas', artigo: 'a' },
  beleza: { familia: 'agenda', nome: 'salão', plural: 'salões', artigo: 'o' },
  saude: { familia: 'agenda', nome: 'clínica', plural: 'clínicas', artigo: 'a' },
  // A escola nasce sem a Agenda ligada (o ramo sugere a Escola e o ponto): o
  // bloco mostra o que ela tem — os alunos, a mensalidade do mês e o atraso,
  // as turmas quase cheias, quem está trabalhando e o que entrou hoje — e a
  // agenda aparece no dia em que ela ligar o módulo.
  escola: { familia: 'agenda', nome: 'escola', plural: 'escolas', artigo: 'a' },
}

const ehRamo = (r: string | null | undefined): r is Ramo => !!r && Object.hasOwn(RAMOS, r)

/** O ramo que vale para a loja: o dela, senão o da empresa, senão "outro". */
export function ramoEfetivo(daLoja: string | null | undefined, daEmpresa: string | null | undefined): Ramo {
  if (ehRamo(daLoja)) return daLoja
  if (ehRamo(daEmpresa)) return daEmpresa
  return 'outro'
}

/** "Hoje na sua sorveteria", "Hoje no seu pet shop", "Hoje nas suas lojas de roupas". */
export function tituloDoNicho(ramo: Ramo, lojas: number): string {
  const n = NICHOS[ramo]
  if (lojas > 1) return `Hoje ${n.artigo === 'a' ? 'nas suas' : 'nos seus'} ${n.plural}`
  return `Hoje ${n.artigo === 'a' ? 'na sua' : 'no seu'} ${n.nome}`
}

export type LojaDoNicho = { id: string; nome: string; ramo: string | null; ehDeposito: boolean }
export type GrupoDoNicho = { ramo: Ramo; lojas: { id: string; nome: string }[] }

/**
 * As lojas agrupadas pelo ramo, para o consolidado.
 *
 * Depósito fica de fora: não vende, e "grade quebrada no depósito" é outra
 * conversa (a da transferência). O ramo com mais lojas vem primeiro, e são
 * três no máximo — a rede com cinco ramos diferentes escolhe a loja no
 * seletor; o painel não vira um catálogo de blocos.
 */
export function agruparPorRamo(lojas: LojaDoNicho[], ramoDaEmpresa: string | null, maximo = 3): GrupoDoNicho[] {
  const grupos = new Map<Ramo, { id: string; nome: string }[]>()
  for (const l of lojas) {
    if (l.ehDeposito) continue
    const r = ramoEfetivo(l.ramo, ramoDaEmpresa)
    const g = grupos.get(r) ?? []
    g.push({ id: l.id, nome: l.nome })
    grupos.set(r, g)
  }
  // Estável: empate no número de lojas mantém a ordem em que chegaram.
  return [...grupos.entries()]
    .map(([ramo, ls], i) => ({ ramo, lojas: ls, i }))
    .sort((a, b) => b.lojas.length - a.lojas.length || a.i - b.i)
    .slice(0, maximo)
    .map(({ ramo, lojas: ls }) => ({ ramo, lojas: ls }))
}

// ─────────────────────────────────────────────────────────────
// TEXTO
// ─────────────────────────────────────────────────────────────

/** "M", "M e G", "P, M e G". */
export function listaFalada(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? ''
  return `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`
}

const UNIDADE: Record<string, string> = { UN: 'un', KG: 'kg', G: 'g', L: 'l', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx' }

/**
 * Uma quantidade com a medida, do jeito que se fala no balcão.
 * Quilo e litro com casas (0,35 kg; 2,4 kg); o resto inteiro, porque "12,25
 * pães" não existe — a média arredonda, e quem lê sabe que é média.
 */
export function quantidadeFalada(q: number, medida: string): string {
  const un = UNIDADE[medida] ?? medida.toLowerCase()
  const fracao = medida === 'KG' || medida === 'L' || medida === 'M'
  const casas = !fracao ? 0 : Math.abs(q) < 1 ? 2 : Math.abs(q) < 10 ? 1 : 0
  const texto = q.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas })
  return `${texto} ${un}`
}

const DIAS = [
  { um: 'domingo', varios: 'domingos', artigo: 'o' },
  { um: 'segunda', varios: 'segundas', artigo: 'a' },
  { um: 'terça', varios: 'terças', artigo: 'a' },
  { um: 'quarta', varios: 'quartas', artigo: 'a' },
  { um: 'quinta', varios: 'quintas', artigo: 'a' },
  { um: 'sexta', varios: 'sextas', artigo: 'a' },
  { um: 'sábado', varios: 'sábados', artigo: 'o' },
] as const

/** O dia da semana de um dia escrito ('2026-09-23' → quarta). */
export function diaDaSemana(dia: string) {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]!
}

/** "das últimas 4 quartas", "dos últimos 2 sábados", "da última quarta". */
export function deQuantosDias(dia: string, n: number): string {
  const s = diaDaSemana(dia)
  if (n === 1) return s.artigo === 'a' ? `da última ${s.um}` : `do último ${s.um}`
  return s.artigo === 'a' ? `das últimas ${n} ${s.varios}` : `dos últimos ${n} ${s.varios}`
}

/** Os n mesmos dias da semana antes de hoje, do mais perto ao mais longe. */
export function mesmosDiasAntes(hoje: string, n = 4): string[] {
  return Array.from({ length: n }, (_, i) => somarDias(hoje, -7 * (i + 1)))
}

// ─────────────────────────────────────────────────────────────
// FAMÍLIA GRADE — roupa, calçado, bijuteria
// ─────────────────────────────────────────────────────────────

export type LinhaDaGrade = {
  produtoId: string
  produto: string
  /** A loja desta linha. Opcional só para a conta de uma loja só. */
  unidadeId?: string
  /** A variação — é por ela que se acha a mesma peça na outra loja. */
  variacaoId?: string
  /** "M · Preto" — as opções da variação, na ordem da grade. */
  rotulo: string
  saldo: number
  vendidos30: number
}

export type GradeQuebrada = {
  produtoId: string
  produto: string
  /** O que vendia (30 dias) e zerou — na ordem da grade. */
  acabou: string[]
  /** O que ainda tem saldo — na ordem da grade. */
  sobrou: string[]
  /** Quanto saía, em 30 dias, do que acabou: é o tamanho do problema. */
  vendiaNoMes: number
}

/**
 * Grade quebrada: a peça em que o que VENDE acabou e o resto sobrou.
 *
 * "Camiseta canelada: acabou M e G, sobrou PP e GG" é a frase mais cara da
 * loja de roupa — a cliente que veste M vai embora, e o PP e o GG ficam
 * parados. Entra só o que vendeu no último mês e zerou: variação zerada que
 * nunca vendeu é grade que nunca chegou, não grade que quebrou. E só quando
 * ainda sobra alguma coisa da peça — se acabou tudo, a peça inteira acabou, e
 * isso o "Precisa de você" já avisa.
 *
 * O que vendia mais vem primeiro: é o buraco que mais custa.
 */
export function gradeQuebrada(linhas: LinhaDaGrade[], limite = 5): GradeQuebrada[] {
  const por = new Map<string, { produto: string; linhas: LinhaDaGrade[] }>()
  for (const l of linhas) {
    const g = por.get(l.produtoId) ?? { produto: l.produto, linhas: [] }
    g.linhas.push(l)
    por.set(l.produtoId, g)
  }
  const saida: GradeQuebrada[] = []
  for (const [produtoId, g] of por) {
    if (g.linhas.length < 2) continue
    const acabaram = g.linhas.filter((l) => l.saldo <= 0 && l.vendidos30 > 0)
    const sobrou = g.linhas.filter((l) => l.saldo > 0).map((l) => l.rotulo)
    if (acabaram.length === 0 || sobrou.length === 0) continue
    saida.push({
      produtoId,
      produto: g.produto,
      acabou: acabaram.map((l) => l.rotulo),
      sobrou,
      vendiaNoMes: acabaram.reduce((s, l) => s + l.vendidos30, 0),
    })
  }
  return saida
    .sort((a, b) => b.vendiaNoMes - a.vendiaNoMes || a.produto.localeCompare(b.produto, 'pt-BR'))
    .slice(0, limite)
}

export type GradeQuebradaNaLoja = GradeQuebrada & {
  unidadeId: string
  unidadeNome: string
  /** As OUTRAS lojas que têm saldo de alguma das peças que acabaram aqui. */
  temEm: string[]
}

/**
 * A grade quebrada LOJA POR LOJA.
 *
 * Somar as lojas esconderia o problema: o M preto zerado no Centro com seis no
 * Shopping dá seis no total, e a soma diria que está tudo bem — mas a cliente
 * do Centro vai embora do mesmo jeito. Por isso a conta é por loja, e a outra
 * loja que TEM a peça aparece junto: é a transferência que resolve hoje, sem
 * esperar fornecedor.
 */
export function gradeQuebradaNasLojas(
  linhas: (LinhaDaGrade & { unidadeId: string; variacaoId: string })[],
  nomes: ReadonlyMap<string, string>,
  limite = 5,
): GradeQuebradaNaLoja[] {
  const porLoja = new Map<string, typeof linhas>()
  for (const l of linhas) {
    const g = porLoja.get(l.unidadeId) ?? []
    g.push(l)
    porLoja.set(l.unidadeId, g)
  }
  const saida: GradeQuebradaNaLoja[] = []
  for (const [unidadeId, doLoja] of porLoja) {
    for (const q of gradeQuebrada(doLoja, Number.POSITIVE_INFINITY)) {
      const faltam = new Set(
        doLoja.filter((l) => l.produtoId === q.produtoId && l.saldo <= 0 && l.vendidos30 > 0).map((l) => l.variacaoId),
      )
      const temEm = [
        ...new Set(
          linhas
            .filter((l) => l.unidadeId !== unidadeId && faltam.has(l.variacaoId) && l.saldo > 0)
            .map((l) => nomes.get(l.unidadeId) ?? ''),
        ),
      ].filter(Boolean)
      saida.push({ ...q, unidadeId, unidadeNome: nomes.get(unidadeId) ?? '', temEm })
    }
  }
  return saida
    .sort((a, b) => b.vendiaNoMes - a.vendiaNoMes || a.produto.localeCompare(b.produto, 'pt-BR') || a.unidadeNome.localeCompare(b.unidadeNome, 'pt-BR'))
    .slice(0, limite)
}

export type OpcaoVendida = { eixo: string; ehCor: boolean; valor: string; ordem: number; quantidade: number }
export type GradeVendida = {
  eixo: string
  total: number
  /** Na ordem da grade (PP, P, M…), e não do mais vendido: é a curva que diz o que comprar. */
  itens: { valor: string; quantidade: number; pct: number; maior: boolean }[]
}

/**
 * O que mais sai, por opção de um eixo — "o M é 34% do que vendeu".
 *
 * Um eixo só, para não misturar tamanho com cor. Vale o eixo principal do
 * ramo (o primeiro em RAMOS: Tamanho, Numeração, Cor) quando a empresa usa;
 * senão, o eixo que não é cor com mais peças vendidas — é o tamanho que
 * decide a compra, a cor vem depois.
 */
export function gradeMaisVendida(linhas: OpcaoVendida[], eixoPreferido?: string, limite = 8): GradeVendida | null {
  const vendidas = linhas.filter((l) => l.quantidade > 0)
  if (vendidas.length === 0) return null
  const totais = new Map<string, { total: number; ehCor: boolean }>()
  for (const l of vendidas) {
    const t = totais.get(l.eixo) ?? { total: 0, ehCor: l.ehCor }
    t.total += l.quantidade
    totais.set(l.eixo, t)
  }
  const preferido = eixoPreferido && totais.has(eixoPreferido) ? eixoPreferido : null
  const eixo =
    preferido ??
    [...totais.entries()].sort((a, b) => Number(a[1].ehCor) - Number(b[1].ehCor) || b[1].total - a[1].total)[0]![0]
  const doEixo = vendidas.filter((l) => l.eixo === eixo)
  const total = totais.get(eixo)!.total
  const maiorQtd = Math.max(...doEixo.map((l) => l.quantidade))
  // Com mais opções que o limite, ficam as que mais venderam — e voltam para
  // a ordem da grade.
  const escolhidas = [...doEixo].sort((a, b) => b.quantidade - a.quantidade).slice(0, limite)
  return {
    eixo,
    total,
    itens: escolhidas
      .sort((a, b) => a.ordem - b.ordem || a.valor.localeCompare(b.valor, 'pt-BR', { numeric: true }))
      .map((l) => ({
        valor: l.valor,
        quantidade: l.quantidade,
        pct: (l.quantidade / total) * 100,
        maior: l.quantidade === maiorQtd,
      })),
  }
}

// ─────────────────────────────────────────────────────────────
// FAMÍLIA SABORES — sorveteria e açaí
// ─────────────────────────────────────────────────────────────

export type LinhaDeSabor = {
  variacaoId: string
  /** O sabor ("Chocolate") ou, sem eixo, o nome do produto. */
  rotulo: string
  /** O produto, quando o rótulo é o sabor — "Massa", "Picolé". */
  produto: string | null
  medida: string
  saldo: number
  /** Soma dos mínimos das lojas; nulo quando nenhuma cadastrou. */
  minimo: number | null
  vendidosHoje: number
  vendidos7: number
  /** O item é da aba de complementos (granola, cobertura): não é sabor. */
  complemento?: boolean
}

/**
 * A aba dos complementos: "Complementos", "Coberturas", "Adicionais"… A mesma
 * regra do balcão (`ehComplemento`, em balcao/ramo.ts), repetida aqui porque
 * aquele arquivo vai para o navegador e este não pode ir.
 */
export function categoriaDeComplemento(nome: string | null | undefined): boolean {
  if (!nome) return false
  const n = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return /^(complemento|cobertura|adiciona(l|is)|acompanhamento|topping)s?$/.test(n)
}

export type SaborAcabando = LinhaDeSabor & { motivo: 'acabou' | 'acaba_hoje' | 'minimo' }

/**
 * Os sabores que acabaram ou acabam hoje.
 *
 * "Acaba hoje" é saldo menor que o que sai num dia MÉDIO da última semana —
 * conta simples, sem previsão: se ontem saíram 3 kg por dia e sobrou 2 kg,
 * não chega ao fim do dia. "No mínimo" é o mínimo que a própria loja
 * cadastrou. "Acabou" só entra se vendia (sete dias): pote vazio de sabor que
 * ninguém pede não é notícia.
 */
export function saboresAcabando(linhas: LinhaDeSabor[], limite = 5): SaborAcabando[] {
  const peso = { acabou: 0, acaba_hoje: 1, minimo: 2 } as const
  const saida: (SaborAcabando & { chave: number })[] = []
  for (const l of linhas) {
    const porDia = l.vendidos7 / 7
    if (l.saldo <= 0) {
      if (l.vendidos7 > 0) saida.push({ ...l, motivo: 'acabou', chave: -l.vendidos7 })
    } else if (porDia > 0 && l.saldo < porDia) {
      saida.push({ ...l, motivo: 'acaba_hoje', chave: l.saldo / porDia })
    } else if (l.minimo !== null && l.minimo > 0 && l.saldo <= l.minimo) {
      saida.push({ ...l, motivo: 'minimo', chave: l.saldo / l.minimo })
    }
  }
  return saida
    .sort((a, b) => peso[a.motivo] - peso[b.motivo] || a.chave - b.chave)
    .slice(0, limite)
    .map(({ chave: _c, ...s }) => s)
}

/** Os que mais saíram hoje, pela quantidade (quilo com quilo, unidade com unidade). */
export function saboresDoDia(linhas: LinhaDeSabor[], limite = 5): LinhaDeSabor[] {
  // O que vai a peso primeiro (é o sabor a granel, o coração da casa), e só
  // depois o que vai por unidade — comparar 1 picolé com 0,3 kg não diz qual
  // saiu mais. Complemento não é sabor: fica de fora.
  const pesa = (m: string) => (m === 'KG' || m === 'G' ? 0 : 1)
  const emKg = (l: LinhaDeSabor) => (l.medida === 'G' ? l.vendidosHoje / 1000 : l.vendidosHoje)
  return linhas
    .filter((l) => l.vendidosHoje > 0 && !l.complemento)
    .sort((a, b) => pesa(a.medida) - pesa(b.medida) || emKg(b) - emKg(a) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
    .slice(0, limite)
}

/** Quilos vendidos: KG soma direto, G entra dividido por mil. O resto não é peso. */
export function quilosVendidos(itens: { medida: string; quantidade: number }[]): number {
  return itens.reduce((s, i) => s + (i.medida === 'KG' ? i.quantidade : i.medida === 'G' ? i.quantidade / 1000 : 0), 0)
}

/** A hora com mais vendas. Empate fica com a mais cedo; dia sem venda, nulo. */
export function picoDoDia(porHora: number[]): { hora: number; vendas: number } | null {
  let melhor: { hora: number; vendas: number } | null = null
  for (let hora = 0; hora < porHora.length; hora++) {
    const v = porHora[hora] ?? 0
    if (v > 0 && (!melhor || v > melhor.vendas)) melhor = { hora, vendas: v }
  }
  return melhor
}

// ─────────────────────────────────────────────────────────────
// FAMÍLIA PRODUÇÃO — padaria, lanchonete, floricultura, serviço
// ─────────────────────────────────────────────────────────────

export type VendaDoDia = { chave: string; rotulo: string; medida: string; dia: string; quantidade: number }
export type ItemDaProducao = { chave: string; rotulo: string; medida: string; media: number; hoje: number }

/**
 * Quanto preparar hoje: a média do MESMO dia da semana.
 *
 * Quarta contra quarta, porque padaria tem semana — o sábado vende o dobro da
 * segunda, e média de todos os dias erraria os dois. Quatro semanas, porque é
 * um mês: menos que isso, um feriado vira regra; mais, a estação já mudou.
 *
 * O divisor é o número de quartas em que a loja JÁ VENDIA (`primeiroDia`):
 * a padaria que abriu há duas semanas tem média de duas quartas, e o título
 * diz isso. Dividir por quatro inventaria duas quartas de venda zero.
 */
export function producaoDoDia(
  vendas: VendaDoDia[],
  dias: string[],
  hoje: string,
  primeiroDia: string | null,
  limite = 6,
): { semanas: number; itens: ItemDaProducao[] } {
  const contados = primeiroDia ? dias.filter((d) => d >= primeiroDia) : []
  const semanas = contados.length
  if (semanas === 0) return { semanas: 0, itens: [] }
  const conta = new Set(contados)
  const por = new Map<string, ItemDaProducao & { soma: number }>()
  for (const v of vendas) {
    const noDia = v.dia === hoje
    if (!noDia && !conta.has(v.dia)) continue
    const it = por.get(v.chave) ?? { chave: v.chave, rotulo: v.rotulo, medida: v.medida, media: 0, hoje: 0, soma: 0 }
    if (noDia) it.hoje += v.quantidade
    else it.soma += v.quantidade
    por.set(v.chave, it)
  }
  const itens = [...por.values()]
    .filter((i) => i.soma > 0)
    .map(({ soma, ...i }) => ({ ...i, media: soma / semanas }))
    .sort((a, b) => b.media - a.media || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
    .slice(0, limite)
  return { semanas, itens }
}

export type HoraForte = { hora: number; media: number; item: string | null }

/**
 * As horas em que mais se vende neste dia da semana, e o que mais sai em cada
 * uma — é o que diz a que horas a fornada tem de estar pronta. Média em reais
 * pelos mesmos dias contados na produção; na ordem do relógio.
 */
export function horasFortes(
  totais: { hora: number; total: number }[],
  semanas: number,
  itens: { hora: number; rotulo: string; quantidade: number }[],
  limite = 3,
): HoraForte[] {
  if (semanas <= 0) return []
  const topo = new Map<number, { rotulo: string; quantidade: number }>()
  for (const i of itens) {
    const t = topo.get(i.hora)
    if (!t || i.quantidade > t.quantidade) topo.set(i.hora, i)
  }
  return totais
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total || a.hora - b.hora)
    .slice(0, limite)
    .map((t) => ({ hora: t.hora, media: t.total / semanas, item: topo.get(t.hora)?.rotulo ?? null }))
    .sort((a, b) => a.hora - b.hora)
}

export type EncomendaCurta = {
  id: string
  clienteNome: string
  descricao: string
  para: Date
  situacao: SituacaoEncomenda
  entrega: boolean
  unidadeNome: string
}

/**
 * As encomendas de perto: atrasadas, de hoje e de amanhã — as mesmas faixas
 * da tela de Encomendas (`grupoDa`), para as duas telas não discordarem.
 */
export function encomendasDePerto<T extends { para: Date; situacao: SituacaoEncomenda }>(
  lista: T[],
  agora: Date,
): { atrasadas: T[]; hoje: T[]; amanha: T[] } {
  const r = { atrasadas: [] as T[], hoje: [] as T[], amanha: [] as T[] }
  for (const e of [...lista].sort((a, b) => a.para.getTime() - b.para.getTime())) {
    if (e.situacao !== 'ABERTA' && e.situacao !== 'PRONTA') continue
    const g = grupoDa(e, agora)
    if (g === 'atrasadas' || g === 'hoje' || g === 'amanha') r[g].push(e)
  }
  return r
}

// ─────────────────────────────────────────────────────────────
// FAMÍLIA REPOSIÇÃO — mercearia, pet shop, papelaria, autopeças…
// ─────────────────────────────────────────────────────────────

export type LinhaDeGiro = { rotulo: string; medida: string; semana: number; anterior: number }
export type Giro = LinhaDeGiro & { variacao: number | null }

/**
 * O que mais saiu nos últimos 7 dias, com a comparação com os 7 anteriores.
 * Sem venda antes não há porcentagem — "novo" é mais honesto que "+∞%".
 */
export function giro(linhas: LinhaDeGiro[], limite = 5): Giro[] {
  return linhas
    .filter((l) => l.semana > 0)
    .sort((a, b) => b.semana - a.semana || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
    .slice(0, limite)
    .map((l) => ({ ...l, variacao: l.anterior > 0 ? ((l.semana - l.anterior) / l.anterior) * 100 : null }))
}

export type LinhaDoMinimo = { rotulo: string; medida: string; saldo: number; minimo: number }

/** No mínimo ou abaixo, do mais vazio (proporcionalmente) ao menos. */
export function abaixoDoMinimo(linhas: LinhaDoMinimo[], limite = 5): LinhaDoMinimo[] {
  return linhas
    .filter((l) => l.minimo > 0 && l.saldo <= l.minimo)
    .sort((a, b) => a.saldo / a.minimo - b.saldo / b.minimo || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
    .slice(0, limite)
}

// ─────────────────────────────────────────────────────────────
// O QUE A TELA RECEBE
// ─────────────────────────────────────────────────────────────

export type DadosGrade = {
  /** Nulo quando a pessoa não pode ver o estoque dessas lojas. */
  quebradas: GradeQuebradaNaLoja[] | null
  maisVendida: GradeVendida | null
}

export type DadosSabores = {
  kgHoje: number
  /** A loja vende algo a peso? Sem isso, "0 kg hoje" é ruído. */
  vendePeso: boolean
  vendasHoje: number
  pico: { hora: number; vendas: number } | null
  acabando: SaborAcabando[] | null
  doDia: LinhaDeSabor[]
}

export type DadosProducao = {
  /** Nulo quando o módulo Encomenda está desligado ou a pessoa não vê vendas. */
  encomendas: { atrasadas: EncomendaCurta[]; hoje: EncomendaCurta[]; amanha: EncomendaCurta[] } | null
  semanas: number
  /** "das últimas 4 quartas" */
  deQuando: string
  producao: ItemDaProducao[]
  horas: HoraForte[]
  tituloProducao: string
}

export type LinhaDeRepor = {
  rotulo: string
  medida: string
  saldo: number
  /** Com a previsão (plano que abre): até quando pedir. */
  situacao: SituacaoRuptura | 'minimo'
  pedirAte: Date | null
  minimo: number | null
}

export type DadosReposicao = {
  /** Nulo quando a pessoa não pode ver o estoque dessas lojas. */
  repor: LinhaDeRepor[] | null
  /** A lista veio da previsão de ruptura (ritmo × prazo), e não só do mínimo. */
  comPrevisao: boolean
  giro: Giro[]
}

export type HorarioCurto = {
  id: string
  hora: string
  fim: string
  cliente: string
  servico: string
  profissional: string
  situacao: SituacaoAgendamento
  rotulo: string
  unidadeNome: string
}

export type DadosAgenda = {
  /** Nulo quando a Agenda está desligada ou a pessoa não a vê. */
  agenda: {
    total: number
    confirmados: number
    atendidos: number
    faltas: number
    desmarcados: number
    proximos: HorarioCurto[]
    /** Só quando o bloco é de UMA loja: o horário livre depende do funcionamento dela. */
    livres: { nome: string; horarios: string[] }[] | null
  } | null
  /** O que entrou pelo balcão hoje, nas lojas do bloco. */
  recebido: { vendas: number; total: number }
  /** Nulo quando o Ponto está desligado ou a pessoa não vê as horas dos outros. */
  trabalhando: { nome: string; desde: string }[] | null
  /** "clientes", "pacientes", "alunos". */
  pessoas: string
  /** Nulo quando a Escola está desligada ou a pessoa não vê as turmas. */
  escola: DadosEscola | null
}

export type DadosEscola = {
  alunosAtivos: number
  /** Nulo quando a pessoa não vê as mensalidades (o balcão vê; o gerente, idem). */
  mensalidades: {
    mes: string
    aReceberMes: number
    abertasMes: number
    atraso: { quantas: number; total: number; alunos: number }
    vencemHoje: { quantas: number; total: number }
    recebidoHoje: number
    recebidoNoMes: number
  } | null
  /** As turmas com pouca vaga — onde a próxima matrícula pode não caber. */
  quaseCheias: { id: string; nome: string; ocupadas: number; capacidade: number }[]
}

export type BlocoDoNicho = {
  ramo: Ramo
  titulo: string
  lojas: { id: string; nome: string }[]
  /** A loja do bloco, quando é uma só — os links abrem nela. */
  unidadeId: string | null
} & (
  | { familia: 'grade'; dados: DadosGrade }
  | { familia: 'sabores'; dados: DadosSabores }
  | { familia: 'producao'; dados: DadosProducao }
  | { familia: 'reposicao'; dados: DadosReposicao }
  | { familia: 'agenda'; dados: DadosAgenda }
)

// ─────────────────────────────────────────────────────────────
// COM BANCO
// ─────────────────────────────────────────────────────────────

const n = (v: unknown) => Number(v ?? 0)
const DIA_MS = 864e5

/**
 * Os blocos do painel para as lojas que a pessoa está olhando.
 *
 * `unidadeIds` já vem filtrado por quem pode ler relatório (é a escolha do
 * painel). O que mostra ESTOQUE passa de novo pelo `estoque.ver`, e o que
 * mostra encomenda pelo `venda.ver` e pelo módulo — o contador lê o painel e
 * não vê o estoque, e aqui continua não vendo.
 */
export async function nichoDoPainel(
  sessao: Sessao,
  empresa: ComModulos,
  unidadeIds: string[],
  agora: Date = new Date(),
): Promise<BlocoDoNicho[]> {
  if (unidadeIds.length === 0) return []

  const base = await comoOrg(sessao.orgId, async (db) => {
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { ramo: true, plano: true } })
    const lojas = await db.unidade.findMany({
      where: { id: { in: unidadeIds }, ativa: true },
      orderBy: [{ ehDeposito: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true, ramo: true, ehDeposito: true },
    })
    return { org, lojas }
  })

  const grupos = agruparPorRamo(base.lojas, base.org.ramo)
  const blocos: BlocoDoNicho[] = []
  // Um grupo depois do outro: cada carregador abre o próprio comoOrg, e o
  // painel já dispara as consultas dele em paralelo — somar mais três
  // transações ao mesmo tempo seria disputar a mesma fila do pool.
  for (const g of grupos) blocos.push(await blocoDoGrupo(sessao, empresa, g, base.org.plano, agora))
  return blocos
}

/** O bloco de UM ramo, para as lojas dele. Separado para poder ser lido sozinho. */
export async function blocoDoGrupo(
  sessao: Sessao,
  empresa: ComModulos,
  g: GrupoDoNicho,
  plano: Plano,
  agora: Date = new Date(),
): Promise<BlocoDoNicho> {
  const ids = g.lojas.map((l) => l.id)
  const comum = {
    ramo: g.ramo,
    titulo: tituloDoNicho(g.ramo, g.lojas.length),
    lojas: g.lojas,
    unidadeId: g.lojas.length === 1 ? g.lojas[0]!.id : null,
  }
  const familia = NICHOS[g.ramo].familia
  if (familia === 'grade') return { ...comum, familia, dados: await dadosGrade(sessao, g.lojas, g.ramo, agora) }
  if (familia === 'sabores') return { ...comum, familia, dados: await dadosSabores(sessao, ids, agora) }
  if (familia === 'producao') return { ...comum, familia, dados: await dadosProducao(sessao, empresa, ids, g.ramo, agora) }
  if (familia === 'agenda') return { ...comum, familia, dados: await dadosAgenda(sessao, empresa, ids, g.ramo, agora) }
  return { ...comum, familia, dados: await dadosReposicao(sessao, ids, plano, agora) }
}

// "Vendido nesta loja" em SQL, escrito em cada consulta: lista vazia é em
// todas (ver catalogo-loja.ts) — `cardinality(p.vendido_em) = 0 or
// p.vendido_em && lojas`.

async function dadosGrade(
  sessao: Sessao,
  lojas: { id: string; nome: string }[],
  ramo: Ramo,
  agora: Date,
): Promise<DadosGrade> {
  const ids = lojas.map((l) => l.id)
  const nomes = new Map(lojas.map((l) => [l.id, l.nome]))
  const comEstoque = soAsQuePode(sessao, 'estoque.ver', ids)
  const corte30 = new Date(agora.getTime() - 30 * DIA_MS)
  const corte7 = inicioDoDiaEmSP(somarDias(diaEmSP(agora), -6))

  const { linhas, opcoes } = await comoOrg(sessao.orgId, async (db) => {
    const uni = ids
    const opcoes = await db.$queryRaw<
      { eixo: string; eh_cor: boolean; valor: string; ordem: number; quantidade: string }[]
    >`
      select ex.nome as eixo, ex.eh_cor, op.valor, min(op.ordem)::int as ordem, sum(i.quantidade) as quantidade
        from venda_itens i
        join vendas v on v.id = i.venda_id
        join variacao_opcoes vo on vo.variacao_id = i.variacao_id
        join opcoes op on op.id = vo.opcao_id
        join eixos ex on ex.id = op.eixo_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA'
         and v.criada_em >= ${corte7}
       group by ex.nome, ex.eh_cor, op.valor
    `
    if (comEstoque.length === 0) return { linhas: null, opcoes }

    const est = comEstoque
    // Uma linha por variação de produto que VARIA (mais de uma variação
    // ativa) e por LOJA, com o saldo, o vendido em 30 dias e as opções já em
    // texto na ordem da grade. Laterais separadas pelo mesmo motivo da
    // ruptura: juntar estoque e venda multiplicaria o saldo. A loja entra só
    // se vende o produto (lista vazia = todas).
    //
    // Somado em blocos (CTE) e juntado depois, e não com uma subconsulta por
    // linha: com o catálogo de uma loja de verdade (7 mil variações) a versão
    // por linha levava 0,4 s no banco aquecido e 5 s logo depois de uma
    // carga grande; esta, 0,07 s — e devolve as mesmas linhas, na mesma ordem.
    const linhas = await db.$queryRaw<
      {
        unidade_id: string
        produto_id: string
        variacao_id: string
        produto: string
        rotulo: string
        saldo: string | null
        vendidos: string | null
      }[]
    >`
      with variam as (
        select produto_id from variacoes where ativa group by produto_id having count(*) > 1
      ),
      rotulos as (
        select vo.variacao_id,
               string_agg(op.valor, ' · ' order by ex.eh_cor, ex.ordem, op.ordem) as rotulo,
               array_agg(op.ordem order by ex.eh_cor, ex.ordem, op.ordem) as chave
          from variacao_opcoes vo
          join opcoes op on op.id = vo.opcao_id
          join eixos ex on ex.id = op.eixo_id
         group by vo.variacao_id
      ),
      saldos as (
        select variacao_id, unidade_id, sum(quantidade) as saldo
          from estoque where unidade_id = any(${est}::text[])
         group by 1, 2
      ),
      vendidos as (
        select i.variacao_id, v.unidade_id, sum(i.quantidade) as vendidos
          from venda_itens i join vendas v on v.id = i.venda_id
         where v.unidade_id = any(${est}::text[]) and v.situacao = 'CONCLUIDA' and v.criada_em >= ${corte30}
           and i.variacao_id is not null
         group by 1, 2
      )
      select u.id as unidade_id, p.id as produto_id, vr.id as variacao_id, p.nome as produto,
             o.rotulo, e.saldo, s.vendidos
        from variacoes vr
        join variam vm on vm.produto_id = vr.produto_id
        join produtos p on p.id = vr.produto_id
        join rotulos o on o.variacao_id = vr.id
        cross join unnest(${est}::text[]) as u(id)
        left join saldos e on e.variacao_id = vr.id and e.unidade_id = u.id
        left join vendidos s on s.variacao_id = vr.id and s.unidade_id = u.id
       where vr.ativa and p.ativo and not p.servico
         and (cardinality(p.vendido_em) = 0 or u.id = any(p.vendido_em))
       order by p.nome, p.id, o.chave
    `
    return { linhas, opcoes }
  })

  return {
    quebradas: linhas
      ? gradeQuebradaNasLojas(
          linhas.map((l) => ({
            unidadeId: l.unidade_id,
            variacaoId: l.variacao_id,
            produtoId: l.produto_id,
            produto: l.produto,
            rotulo: l.rotulo,
            saldo: n(l.saldo),
            vendidos30: n(l.vendidos),
          })),
          nomes,
        )
      : null,
    maisVendida: gradeMaisVendida(
      opcoes.map((o) => ({ eixo: o.eixo, ehCor: o.eh_cor, valor: o.valor, ordem: n(o.ordem), quantidade: n(o.quantidade) })),
      RAMOS[ramo].eixos[0]?.nome,
    ),
  }
}

async function dadosSabores(sessao: Sessao, ids: string[], agora: Date): Promise<DadosSabores> {
  const comEstoque = soAsQuePode(sessao, 'estoque.ver', ids)
  const hoje = diaEmSP(agora)
  const inicioHoje = inicioDoDiaEmSP(hoje)
  const corte7 = inicioDoDiaEmSP(somarDias(hoje, -7))

  return comoOrg(sessao.orgId, async (db) => {
    const uni = ids
    const horas = await db.$queryRaw<{ hora: number; vendas: number }[]>`
      select extract(hour from (v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo'))::int as hora,
             count(*)::int as vendas
        from vendas v
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA' and v.criada_em >= ${inicioHoje}
       group by 1
    `
    const porMedida = await db.$queryRaw<{ medida: string; quantidade: string }[]>`
      select i.medida::text as medida, sum(i.quantidade) as quantidade
        from venda_itens i join vendas v on v.id = i.venda_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA' and v.criada_em >= ${inicioHoje}
       group by 1
    `
    const pesa = await db.produto.count({
      where: {
        ativo: true,
        medida: { in: ['KG', 'G'] },
        OR: [{ vendidoEm: { isEmpty: true } }, { vendidoEm: { hasSome: uni } }],
      },
    })
    // O sabor é a variação: o rótulo é a opção (Chocolate) e, sem opção, o
    // nome do produto (a loja que cadastrou cada sabor como produto). A venda
    // de hoje e da semana vem sempre; o saldo, só para quem vê o estoque.
    const est = comEstoque.length > 0 ? comEstoque : ['']
    const linhas = await db.$queryRaw<
      {
        variacao_id: string
        produto: string
        medida: string
        rotulo: string | null
        saldo: string | null
        minimo: string | null
        hoje: string | null
        semana: string | null
        categoria: string | null
      }[]
    >`
      select vr.id as variacao_id, p.nome as produto, p.medida::text as medida, o.rotulo,
             e.saldo, e.minimo, s.hoje, s.semana, c.nome as categoria
        from variacoes vr
        join produtos p on p.id = vr.produto_id
        left join categorias c on c.id = p.categoria_id
        left join lateral (
          select string_agg(op.valor, ' · ' order by ex.eh_cor, ex.ordem, op.ordem) as rotulo
            from variacao_opcoes vo
            join opcoes op on op.id = vo.opcao_id
            join eixos ex on ex.id = op.eixo_id
           where vo.variacao_id = vr.id
        ) o on true
        left join lateral (
          select sum(quantidade) as saldo, sum(minimo) as minimo from estoque
           where variacao_id = vr.id and unidade_id = any(${est})
        ) e on true
        left join lateral (
          select sum(i.quantidade) filter (where v.criada_em >= ${inicioHoje}) as hoje,
                 sum(i.quantidade) filter (where v.criada_em < ${inicioHoje}) as semana
            from venda_itens i join vendas v on v.id = i.venda_id
           where i.variacao_id = vr.id and v.unidade_id = any(${uni})
             and v.situacao = 'CONCLUIDA' and v.criada_em >= ${corte7}
        ) s on true
       where vr.ativa and p.ativo and not p.servico
         and (cardinality(p.vendido_em) = 0 or p.vendido_em && ${uni}::text[])
         and (coalesce(e.saldo, 0) > 0 or coalesce(s.hoje, 0) > 0 or coalesce(s.semana, 0) > 0)
    `

    const porHora = Array.from({ length: 24 }, () => 0)
    for (const h of horas) if (h.hora >= 0 && h.hora < 24) porHora[h.hora] = n(h.vendas)
    const sabores: LinhaDeSabor[] = linhas.map((l) => ({
      variacaoId: l.variacao_id,
      rotulo: l.rotulo ?? l.produto,
      produto: l.rotulo ? l.produto : null,
      medida: l.medida,
      saldo: n(l.saldo),
      minimo: l.minimo == null ? null : n(l.minimo),
      vendidosHoje: n(l.hoje),
      // Os sete dias ANTES de hoje: o dia pela metade puxaria a média para baixo.
      vendidos7: n(l.semana),
      complemento: categoriaDeComplemento(l.categoria),
    }))

    return {
      kgHoje: quilosVendidos(porMedida.map((m) => ({ medida: m.medida, quantidade: n(m.quantidade) }))),
      vendePeso: pesa > 0,
      vendasHoje: porHora.reduce((s, v) => s + v, 0),
      pico: picoDoDia(porHora),
      acabando: comEstoque.length > 0 ? saboresAcabando(sabores) : null,
      doDia: saboresDoDia(sabores),
    }
  })
}

async function dadosProducao(
  sessao: Sessao,
  empresa: ComModulos,
  ids: string[],
  ramo: Ramo,
  agora: Date,
): Promise<DadosProducao> {
  const hoje = diaEmSP(agora)
  const dias = mesmosDiasAntes(hoje, 4)
  const todos = [hoje, ...dias]
  const desde = inicioDoDiaEmSP(dias.at(-1)!)
  const lojasEnc = moduloLigado(empresa, 'encomenda') ? soAsQuePode(sessao, 'venda.ver', ids) : []

  const r = await comoOrg(sessao.orgId, async (db) => {
    const uni = ids
    const encomendas =
      lojasEnc.length > 0
        ? await db.encomenda.findMany({
            where: {
              unidadeId: { in: lojasEnc },
              situacao: { in: ['ABERTA', 'PRONTA'] },
              para: { lt: inicioDoDiaEmSP(somarDias(hoje, 2)) },
            },
            orderBy: { para: 'asc' },
            take: 60,
            select: {
              id: true, clienteNome: true, descricao: true, para: true, situacao: true, entrega: true,
              unidade: { select: { nome: true } },
            },
          })
        : null
    const primeira = await db.venda.aggregate({
      where: { unidadeId: { in: uni }, situacao: 'CONCLUIDA' },
      _min: { criadaEm: true },
    })
    // Quando a casa marcou o que é FEITO NO DIA, a produção é só isso: o
    // presunto e o refrigerante saem do balcão da padaria, mas ninguém os põe
    // no forno — "quanto preparar de refrigerante" é pergunta sem sentido.
    // Sem nada marcado (a lanchonete que nunca abriu a ficha), vale o que
    // vendeu, como sempre foi.
    const soDoDia = (await db.produto.count({ where: { feitoNoDia: true, ativo: true } })) > 0
    // Por produto e não por variação: o forno faz "pão francês", não "pão
    // francês — unidade". Item avulso (sem variação) fica de fora — não é
    // produção, é o conserto que alguém digitou.
    const vendas = await db.$queryRaw<
      { chave: string; rotulo: string; medida: string; dia: string; quantidade: string }[]
    >`
      select p.id as chave, p.nome as rotulo, p.medida::text as medida,
             to_char((v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as dia,
             sum(i.quantidade) as quantidade
        from venda_itens i
        join vendas v on v.id = i.venda_id
        join variacoes vr on vr.id = i.variacao_id
        join produtos p on p.id = vr.produto_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA' and v.criada_em >= ${desde}
         and (not ${soDoDia} or p.feito_no_dia)
         and to_char((v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') = any(${todos})
       group by 1, 2, 3, 4
    `
    const horas = await db.$queryRaw<{ hora: number; total: string }[]>`
      select extract(hour from (v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo'))::int as hora,
             sum(v.total) as total
        from vendas v
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA' and v.criada_em >= ${desde}
         and to_char((v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') = any(${dias})
       group by 1
    `
    const itensPorHora = await db.$queryRaw<{ hora: number; rotulo: string; quantidade: string }[]>`
      select extract(hour from (v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo'))::int as hora,
             p.nome as rotulo, sum(i.quantidade) as quantidade
        from venda_itens i
        join vendas v on v.id = i.venda_id
        join variacoes vr on vr.id = i.variacao_id
        join produtos p on p.id = vr.produto_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA' and v.criada_em >= ${desde}
         and (not ${soDoDia} or p.feito_no_dia)
         and to_char((v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') = any(${dias})
       group by 1, 2
    `
    return { encomendas, primeira: primeira._min.criadaEm, vendas, horas, itensPorHora }
  })

  const primeiroDia = r.primeira ? diaEmSP(r.primeira) : null
  const prod = producaoDoDia(
    r.vendas.map((v) => ({ ...v, quantidade: n(v.quantidade) })),
    dias,
    hoje,
    primeiroDia,
  )
  return {
    encomendas: r.encomendas
      ? encomendasDePerto(
          r.encomendas.map((e) => ({
            id: e.id,
            clienteNome: e.clienteNome,
            descricao: e.descricao,
            para: e.para,
            situacao: e.situacao,
            entrega: e.entrega,
            unidadeNome: e.unidade.nome,
          })),
          agora,
        )
      : null,
    semanas: prod.semanas,
    deQuando: prod.semanas > 0 ? deQuantosDias(hoje, prod.semanas) : '',
    producao: prod.itens,
    horas: horasFortes(
      r.horas.map((h) => ({ hora: h.hora, total: n(h.total) })),
      prod.semanas,
      r.itensPorHora.map((i) => ({ hora: i.hora, rotulo: i.rotulo, quantidade: n(i.quantidade) })),
    ),
    tituloProducao: NICHOS[ramo].producao ?? 'Produção do dia',
  }
}

async function dadosReposicao(sessao: Sessao, ids: string[], plano: Plano, agora: Date): Promise<DadosReposicao> {
  const comEstoque = soAsQuePode(sessao, 'estoque.ver', ids)
  const hoje = diaEmSP(agora)
  const semana = inicioDoDiaEmSP(somarDias(hoje, -6))
  const duas = inicioDoDiaEmSP(somarDias(hoje, -13))
  const comPrevisao = comEstoque.length > 0 && liberado(plano, 'ruptura.previsao')

  // A previsão abre o comoOrg dela — por isso vem ANTES, e fora, do nosso.
  const previsao = comPrevisao ? await previsaoDeRuptura(sessao, comEstoque) : null

  const r = await comoOrg(sessao.orgId, async (db) => {
    const uni = ids
    const giro = await db.$queryRaw<{ rotulo: string; medida: string; semana: string | null; anterior: string | null }[]>`
      select i.descricao as rotulo, i.medida::text as medida,
             sum(i.quantidade) filter (where v.criada_em >= ${semana}) as semana,
             sum(i.quantidade) filter (where v.criada_em < ${semana}) as anterior
        from venda_itens i join vendas v on v.id = i.venda_id
       where v.unidade_id = any(${uni}) and v.situacao = 'CONCLUIDA' and v.criada_em >= ${duas}
       group by 1, 2
       order by 3 desc nulls last
       limit 20
    `
    if (comPrevisao || comEstoque.length === 0) return { giro, minimo: null }
    const est = comEstoque
    const minimo = await db.$queryRaw<
      { nome: string; rotulo: string | null; medida: string; saldo: string; minimo: string }[]
    >`
      select p.nome, o.rotulo, p.medida::text as medida, e.saldo, e.minimo
        from (
          select variacao_id, sum(quantidade) as saldo, sum(minimo) as minimo
            from estoque where unidade_id = any(${est})
           group by 1
        ) e
        join variacoes vr on vr.id = e.variacao_id
        join produtos p on p.id = vr.produto_id
        left join lateral (
          select string_agg(op.valor, ' · ' order by ex.eh_cor, ex.ordem, op.ordem) as rotulo
            from variacao_opcoes vo
            join opcoes op on op.id = vo.opcao_id
            join eixos ex on ex.id = op.eixo_id
           where vo.variacao_id = vr.id
        ) o on true
       where vr.ativa and p.ativo and e.minimo > 0 and e.saldo <= e.minimo
       order by e.saldo / e.minimo asc
       limit 20
    `
    return { giro, minimo }
  })

  const URGENTE: SituacaoRuptura[] = ['ja_faltou', 'pedir_agora', 'atencao']
  const repor: LinhaDeRepor[] | null = previsao
    ? previsao
        .filter((l) => URGENTE.includes(l.previsao.situacao))
        .slice(0, 5)
        .map((l) => ({
          rotulo: l.opcoes ? `${l.nome} — ${l.opcoes}` : l.nome,
          // A previsão não traz a medida: a tela mostra a data, não o saldo.
          medida: '',
          saldo: l.saldo,
          situacao: l.previsao.situacao,
          pedirAte: l.previsao.pedirAte,
          minimo: null,
        }))
    : r.minimo
      ? abaixoDoMinimo(
          r.minimo.map((m) => ({
            rotulo: m.rotulo ? `${m.nome} — ${m.rotulo}` : m.nome,
            medida: m.medida,
            saldo: n(m.saldo),
            minimo: n(m.minimo),
          })),
        ).map((m) => ({ ...m, situacao: 'minimo' as const, pedirAte: null }))
      : null

  return {
    repor,
    comPrevisao,
    giro: giro(r.giro.map((g) => ({ rotulo: g.rotulo, medida: g.medida, semana: n(g.semana), anterior: n(g.anterior) }))),
  }
}

// ─────────────────────────────────────────────────────────────
// FAMÍLIA AGENDA — salão, clínica, escola
// ─────────────────────────────────────────────────────────────

/**
 * O dia de quem atende com hora marcada. Cada pedaço pede a SUA permissão e o
 * SEU módulo: a agenda pede `agenda.ver` e o módulo Agenda; quem está
 * trabalhando pede `ponto.ver` e o módulo Ponto. O recebido de hoje é número
 * de venda — quem abre o painel já pode ler relatório.
 *
 * Uma consulta depois da outra: cada função abaixo abre o próprio comoOrg.
 */
async function dadosAgenda(
  sessao: Sessao,
  empresa: ComModulos,
  ids: string[],
  ramo: Ramo,
  agora: Date,
): Promise<DadosAgenda> {
  const hoje = diaEmSP(agora)
  const inicioHoje = inicioDoDiaEmSP(hoje)
  const amanha = inicioDoDiaEmSP(somarDias(hoje, 1))

  let agenda: DadosAgenda['agenda'] = null
  const lojasAgenda = moduloLigado(empresa, 'agenda') ? soAsQuePode(sessao, 'agenda.ver', ids) : []
  if (lojasAgenda.length > 0) {
    const lista = await listarAgenda(sessao, { unidadeIds: lojasAgenda, de: inicioHoje, ate: amanha })
    // Os livres só fazem sentido numa loja: dependem do horário dela e de
    // quem atende nela.
    const uma = lojasAgenda.length === 1 ? lojasAgenda[0]! : null
    const profs = uma ? await profissionaisDaLoja(sessao, uma) : []
    const horario = uma ? (await horarioDaLoja(sessao, uma)).horario : null
    const r = resumirDia(lista, profs, horario, hoje, agora)
    agenda = {
      total: r.total,
      confirmados: r.confirmados,
      atendidos: r.atendidos,
      faltas: r.faltas,
      desmarcados: r.desmarcados,
      proximos: r.proximos.slice(0, 8).map((a) => ({
        id: a.id,
        hora: horaEmSP(a.inicio),
        fim: horaEmSP(a.fim),
        cliente: a.clienteNome,
        servico: a.servico,
        profissional: a.colaboradorNome,
        situacao: a.situacao,
        rotulo: ROTULO_AGENDA[a.situacao],
        unidadeNome: a.unidadeNome,
      })),
      livres: uma
        ? r.livres.filter((l) => l.horarios.length > 0).map((l) => ({ nome: l.nome, horarios: l.horarios.map(horaEmSP) }))
        : null,
    }
  }

  const recebido = await comoOrg(sessao.orgId, async (db) => {
    const v = await db.venda.aggregate({
      where: { unidadeId: { in: ids }, situacao: 'CONCLUIDA', criadaEm: { gte: inicioHoje } },
      _count: { _all: true },
      _sum: { total: true },
    })
    return { vendas: v._count._all, total: n(v._sum.total) }
  })

  const trabalhando =
    moduloLigado(empresa, 'ponto') && pode(sessao, 'ponto.ver')
      ? (await trabalhandoAgora(sessao, ids, agora)).map((t) => ({ nome: t.nome, desde: horaEmSP(t.desde) }))
      : null

  const escola = moduloLigado(empresa, 'escola') && pode(sessao, 'escola.ver') ? await dadosEscola(sessao, ids, agora) : null

  return { agenda, recebido, trabalhando, pessoas: vocabularioDoRamo(ramo).pessoas, escola }
}

/**
 * O pedaço da escola: quantos alunos estudam, o que falta receber no mês, quem
 * está em atraso (quantos e quanto), o que entrou, e as turmas quase cheias.
 * Cada consulta abre o seu comoOrg, uma depois da outra.
 */
async function dadosEscola(sessao: Sessao, ids: string[], agora: Date): Promise<DadosEscola> {
  const ativos = await alunosAtivos(sessao, ids)
  const turmas = await listarTurmas(sessao, { unidadeIds: ids })
  const quaseCheias = turmas
    .filter((t) => t.capacidade && quaseCheia(t.ocupadas, t.capacidade))
    .sort((a, b) => (a.vagas ?? 0) - (b.vagas ?? 0) || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, 5)
    .map((t) => ({ id: t.id, nome: t.nome, ocupadas: t.ocupadas, capacidade: t.capacidade! }))
  let mensalidades: DadosEscola['mensalidades'] = null
  const comMensalidade = soAsQuePode(sessao, 'mensalidade.ver', ids)
  if (comMensalidade.length > 0) {
    const r = await resumoMensalidades(sessao, comMensalidade, diaEmSP(agora).slice(0, 7), agora)
    mensalidades = {
      mes: r.mes,
      aReceberMes: r.doMes.aReceber,
      abertasMes: r.doMes.quantas - r.doMes.pagas,
      atraso: r.atraso,
      vencemHoje: r.vencemHoje,
      recebidoHoje: r.recebidoHoje,
      recebidoNoMes: r.recebidoNoMes,
    }
  }
  return { alunosAtivos: ativos, mensalidades, quaseCheias }
}
