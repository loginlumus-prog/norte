// O quadro de tarefas da equipe.
//
// ── o que é ──────────────────────────────────────────────────
// A lista que a loja mantinha na parede do estoque: o que abrir, o que
// conferir, o que montar, quem faz e até quando. Um QUADRO é a parede; cada
// linha dele é uma TAREFA; os GRUPOS são as faixas de fita crepe que separam
// "Ao abrir" de "Ao fechar", ou "Esta semana" de "Próximo mês".
//
// ── duas regras de quem mexe ─────────────────────────────────
// 1. Quem GERE (dono, gerente) faz tudo: cria quadro, cria e atribui tarefa,
//    move de grupo, apaga.
// 2. Quem só VÊ (balcão, financeiro) dá baixa no que é dela: muda a situação
//    e o progresso de tarefa em que ela é a responsável — ou de tarefa sem
//    responsável, porque "ninguém" quer dizer "quem chegar primeiro". Não
//    toca em tarefa que é de outra pessoa: dar baixa no trabalho alheio é
//    exatamente o que faz o quadro deixar de valer.
//
// ── o plano entra aqui, e não só na tela ─────────────────────
// O Grátis tem um quadro e trinta tarefas em aberto; o responsável, o prazo e
// a prioridade abrem no Balcão; a linha do tempo e os modelos, no Assistente;
// a visão da rede, na Direção. A tela mostra tudo isso trancado, com nome de
// plano — mas quem BARRA é o servidor. Tela se contorna; servidor, não.
//
// Puro em cima (o que é atraso, o resumo, quem pode, o que cabe no plano, os
// modelos), banco embaixo. O puro é o que os testes exercitam à exaustão.

import type { Plano, SituacaoTarefa } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, SemPermissao, unidadesQuePodem, PODERES, type Papel, type Sessao } from './permissao'
import { liberado, PLANOS, TAREFAS_ABERTAS_NO_GRATIS } from './planos'
import { colunaDoDia, diaDaColuna, diaEmSP, inicioDoDiaEmSP, mostrarDiaDaColuna, primeiroDoMes } from './dia'

export type { SituacaoTarefa }

// ─────────────────────────────────────────────────────────────
// SITUAÇÃO
// ─────────────────────────────────────────────────────────────

export const SITUACOES: readonly SituacaoTarefa[] = ['A_FAZER', 'EM_ANDAMENTO', 'PARADO', 'FEITO']

export const ROTULO_SITUACAO: Record<SituacaoTarefa, string> = {
  A_FAZER: 'A fazer',
  EM_ANDAMENTO: 'Em andamento',
  PARADO: 'Parado',
  FEITO: 'Feito',
}

type Nivel = 'bom' | 'atencao' | 'critico' | 'neutro'

/**
 * A cor da pílula. Segue o mesmo dicionário do resto do sistema: verde é o
 * que concluiu, amarelo é o que está em curso e pede olho, vermelho é o que
 * travou e precisa de alguém. "A fazer" é neutro de propósito — é o estado
 * normal de uma lista, e pintar o normal ensina a ignorar a cor.
 */
export const NIVEL_SITUACAO: Record<SituacaoTarefa, Nivel> = {
  A_FAZER: 'neutro',
  EM_ANDAMENTO: 'atencao',
  PARADO: 'critico',
  FEITO: 'bom',
}

/**
 * O clique na pílula anda um passo: a fazer → em andamento → feito → a fazer.
 *
 * PARADO não entra no ciclo. Parar é uma decisão ("falta a peça", "esperando
 * o fornecedor"), não um passo natural — quem para escolhe "Parado" na lista.
 * E de parado o próximo clique volta ao trabalho, não ao começo.
 */
export const PROXIMA_SITUACAO: Record<SituacaoTarefa, SituacaoTarefa> = {
  A_FAZER: 'EM_ANDAMENTO',
  EM_ANDAMENTO: 'FEITO',
  FEITO: 'A_FAZER',
  PARADO: 'EM_ANDAMENTO',
}

export const situacaoValida = (s: unknown): s is SituacaoTarefa =>
  typeof s === 'string' && (SITUACOES as readonly string[]).includes(s)

// ─────────────────────────────────────────────────────────────
// DATAS SEM HORA
// ─────────────────────────────────────────────────────────────
//
// Prazo é "sexta", não "sexta às 14h07". Por isso as colunas são DATE e tudo
// aqui compara por DIA. As duas funções abaixo são o único lugar em que uma
// data vira texto e texto vira data — fora daqui, ninguém faz `split('-')`.

// ── o fuso ───────────────────────────────────────────────────
// Prazo e início são colunas `date`, e aqui elas vivem do jeito que o banco
// as devolve: meia-noite UTC do dia (ver `dia.ts`). Já foram meia-noite LOCAL
// da máquina — o que só dava certo com o servidor no fuso da loja: num
// servidor em UTC, às 22h30 de São Paulo o "hoje" local já era amanhã, e a
// tarefa para hoje aparecia atrasada ainda com a loja aberta. "Hoje" agora é
// sempre o dia de São Paulo (`diaEmSP`), e o dia de uma data sem hora é a
// parte de data dela em UTC. Nenhuma conta aqui lê o relógio da máquina.

/**
 * "2026-09-16" → o valor da coluna `date` desse dia. Qualquer outra coisa → null.
 *
 * A volta (dia igual ao pedido) é o que barra "2026-02-30", que o JavaScript
 * aceitaria calado como 2 de março.
 */
export function dataSemHora(texto: string | null | undefined): Date | null {
  if (!texto || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null
  const data = colunaDoDia(texto)
  if (Number.isNaN(data.getTime()) || diaDaColuna(data) !== texto) return null
  return data
}

/** A chave do dia de uma data sem hora, "2026-09-16". Compara como texto. */
export function chaveDoDia(d: Date): string {
  return diaDaColuna(d)
}

/** Uma coluna DATE lida pelo Prisma já está no formato do módulo. */
const doBanco = (d: Date | null): Date | null => d

/** "16/09" para a coluna de prazo. */
export function diaCurto(d: Date): string {
  return mostrarDiaDaColuna(d)
}

// ─────────────────────────────────────────────────────────────
// REGRAS PURAS
// ─────────────────────────────────────────────────────────────

/**
 * Atrasada = tem prazo, o prazo já passou, e não está feita.
 *
 * "Passou" é por dia: o prazo de hoje não está atrasado até virar amanhã —
 * a loja fecha às 19h e a tarefa "para hoje" ainda pode ser feita às 18h50.
 * Feita nunca é atrasada, mesmo que tenha sido feita depois: atraso é um
 * aviso para agir, e não há mais o que agir.
 */
export function atrasada(prazo: Date | null, situacao: SituacaoTarefa, hoje: Date): boolean {
  if (!prazo || situacao === 'FEITO') return false
  return chaveDoDia(prazo) < diaEmSP(hoje)
}

export type Resumo = {
  aFazer: number
  emAndamento: number
  paradas: number
  feitas: number
  atrasadas: number
}

/** As contagens da tira: "12 a fazer · 3 em andamento · 2 paradas · 20 feitas · 4 atrasadas". */
export function resumir(
  tarefas: { situacao: SituacaoTarefa; prazo: Date | null }[],
  hoje = new Date(),
): Resumo {
  const r: Resumo = { aFazer: 0, emAndamento: 0, paradas: 0, feitas: 0, atrasadas: 0 }
  for (const t of tarefas) {
    if (t.situacao === 'A_FAZER') r.aFazer++
    else if (t.situacao === 'EM_ANDAMENTO') r.emAndamento++
    else if (t.situacao === 'PARADO') r.paradas++
    else r.feitas++
    if (atrasada(t.prazo, t.situacao, hoje)) r.atrasadas++
  }
  return r
}

/**
 * Esta pessoa pode mudar a situação e o progresso DESTA tarefa?
 *
 * Quem gere pode sempre. Quem só vê pode na tarefa que é dela ou na que não
 * é de ninguém. `unidadeId` é a do QUADRO: nulo é quadro da empresa inteira,
 * e aí vale quem tem a capacidade em qualquer loja.
 */
export function podeMexerNaTarefa(
  sessao: Sessao,
  tarefa: { responsavelId: string | null },
  unidadeId: string | null,
): boolean {
  const onde = unidadeId ?? undefined
  if (pode(sessao, 'tarefa.gerir', onde)) return true
  if (!pode(sessao, 'tarefa.ver', onde)) return false
  return tarefa.responsavelId === null || tarefa.responsavelId === sessao.usuarioId
}

export type Veredito = { pode: true } | { pode: false; motivo: string }

/**
 * Cabe mais um quadro (ou mais uma tarefa em aberto) neste plano?
 *
 * Só o plano de um quadro só tem teto — a mesma escada de `tarefas.varios`:
 * quem pode ter vários quadros pode ter quantas tarefas quiser. O motivo sai
 * pronto para a tela, com o nome do plano e o que fazer, porque limite sem
 * explicação parece defeito.
 */
export function cabeNoPlano(
  plano: Plano,
  uso: { quadros: number; abertas: number },
  oQue: 'quadro' | 'tarefa',
): Veredito {
  if (liberado(plano, 'tarefas.varios')) return { pode: true }
  const nome = PLANOS[plano].titulo
  if (oQue === 'quadro') {
    if (uso.quadros < 1) return { pode: true }
    return {
      pode: false,
      motivo: `O plano ${nome} tem um quadro só. Para ter vários — um por loja, por exemplo —, veja os planos.`,
    }
  }
  if (uso.abertas < TAREFAS_ABERTAS_NO_GRATIS) return { pode: true }
  return {
    pode: false,
    motivo: `O plano ${nome} chega a ${TAREFAS_ABERTAS_NO_GRATIS} tarefas em aberto. Conclua algumas ou veja os planos.`,
  }
}

/** "Ana Paula Souza" → "AP". Para a bolinha do responsável. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  const primeira = partes[0]![0] ?? ''
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

/**
 * As cores que um quadro pode ter. É dado, não estilo: a cor identifica o
 * quadro como a fita colorida identificava a pasta — e por isso ela é uma
 * escolha da pessoa, gravada no banco, e não uma ficha do tema.
 */
export const CORES_DE_QUADRO: { hex: string; nome: string }[] = [
  { hex: '#1f4fd8', nome: 'Azul' },
  { hex: '#10b45f', nome: 'Verde' },
  { hex: '#ef7208', nome: 'Laranja' },
  { hex: '#c2287a', nome: 'Rosa' },
  { hex: '#7c3aed', nome: 'Roxo' },
  { hex: '#0e9aa7', nome: 'Petróleo' },
]

export const corValida = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)

const inteiroEntre = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max

export const prioridadeValida = (n: unknown): n is number => inteiroEntre(n, 0, 5)
export const progressoValido = (n: unknown): n is number => inteiroEntre(n, 0, 100)

const NOME_MAX = 80
const TITULO_MAX = 160
const DESCRICAO_MAX = 2000
const GRUPO_MAX = 40
const GRUPOS_MAX = 12

/** Tira espaço sobrando e corta no tamanho. Vazio vira ''. */
export function limparTexto(s: unknown, max: number): string {
  if (typeof s !== 'string') return ''
  return s.replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * Os grupos de um quadro, limpos: sem vazio, sem repetido, no máximo doze.
 * Doze faixas já é um quadro que ninguém rola até o fim.
 */
export function limparGrupos(lista: unknown): string[] {
  if (!Array.isArray(lista)) return []
  const vistos = new Set<string>()
  const limpos: string[] = []
  for (const g of lista) {
    const nome = limparTexto(g, GRUPO_MAX)
    if (!nome || vistos.has(nome)) continue
    vistos.add(nome)
    limpos.push(nome)
    if (limpos.length >= GRUPOS_MAX) break
  }
  return limpos
}

// ─────────────────────────────────────────────────────────────
// MODELOS — quadros prontos
// ─────────────────────────────────────────────────────────────
//
// Um quadro vazio pede que a pessoa imagine o que vai nele. Um quadro pronto
// com a lista de abertura da loja diz "é isto" no primeiro segundo — e é o
// que separa quem cria a primeira tarefa de quem fecha a aba.
//
// As tarefas são de loja de verdade, no imperativo curto que se escreve na
// parede. Sem prazo e sem responsável: isso é da loja, e o modelo não sabe.

export type Modelo = {
  titulo: string
  descricao: string
  cor: string
  grupos: string[]
  tarefas: { titulo: string; grupo: string; prioridade?: number; descricao?: string }[]
}

export const MODELOS = {
  abertura: {
    titulo: 'Abertura e fechamento da loja',
    descricao: 'A lista que a equipe confere todo dia: o que fazer ao abrir a porta e o que fazer antes de trancar.',
    cor: '#1f4fd8',
    grupos: ['Ao abrir', 'Ao fechar'],
    tarefas: [
      { titulo: 'Conferir o troco do caixa', grupo: 'Ao abrir', prioridade: 4, descricao: 'Contar o fundo de troco e anotar se faltou moeda.' },
      { titulo: 'Ligar a maquininha e testar uma passagem', grupo: 'Ao abrir', prioridade: 3 },
      { titulo: 'Acender as luzes e conferir a vitrine', grupo: 'Ao abrir', prioridade: 2 },
      { titulo: 'Repor as araras e prateleiras do que saiu ontem', grupo: 'Ao abrir', prioridade: 2 },
      { titulo: 'Fazer a sangria e guardar o dinheiro no cofre', grupo: 'Ao fechar', prioridade: 5 },
      { titulo: 'Fechar o caixa e conferir a diferença', grupo: 'Ao fechar', prioridade: 4 },
      { titulo: 'Anotar o que faltou para repor amanhã', grupo: 'Ao fechar', prioridade: 2 },
      { titulo: 'Desligar a maquininha e as luzes, trancar a porta', grupo: 'Ao fechar', prioridade: 3 },
    ],
  },
  inventario: {
    titulo: 'Inventário do mês',
    descricao: 'Contar tudo o que está na loja e acertar o sistema, sem parar de vender.',
    cor: '#10b45f',
    grupos: ['Antes de contar', 'Contagem', 'Depois'],
    tarefas: [
      { titulo: 'Imprimir a lista de contagem por categoria', grupo: 'Antes de contar', prioridade: 3 },
      { titulo: 'Separar o que está em troca ou reservado', grupo: 'Antes de contar', prioridade: 2 },
      { titulo: 'Contar a vitrine e o salão', grupo: 'Contagem', prioridade: 4 },
      { titulo: 'Contar o estoque de fundo', grupo: 'Contagem', prioridade: 4 },
      { titulo: 'Lançar os ajustes no sistema', grupo: 'Depois', prioridade: 5 },
      { titulo: 'Conferir o que sumiu e anotar o motivo', grupo: 'Depois', prioridade: 3 },
    ],
  },
  campanha: {
    titulo: 'Campanha e data comemorativa',
    descricao: 'Dia das Mães, Black Friday, Natal: o que preparar antes, o que fazer no dia, o que fechar depois.',
    cor: '#c2287a',
    grupos: ['Planejar', 'Preparar', 'No dia', 'Depois'],
    tarefas: [
      { titulo: 'Escolher as peças da campanha e o desconto', grupo: 'Planejar', prioridade: 5 },
      { titulo: 'Definir a meta de venda da campanha', grupo: 'Planejar', prioridade: 3 },
      { titulo: 'Conferir o estoque das peças em destaque', grupo: 'Preparar', prioridade: 4 },
      { titulo: 'Montar a vitrine temática', grupo: 'Preparar', prioridade: 3 },
      { titulo: 'Postar nas redes e avisar os clientes pelo WhatsApp', grupo: 'Preparar', prioridade: 3 },
      { titulo: 'Reforçar a equipe e o troco', grupo: 'No dia', prioridade: 4 },
      { titulo: 'Fechar o resultado e anotar o que aprendeu', grupo: 'Depois', prioridade: 2 },
    ],
  },
  mercadoria: {
    titulo: 'Chegada de mercadoria',
    descricao: 'Da caixa fechada até a peça na arara com preço: nada entra na loja sem passar por aqui.',
    cor: '#ef7208',
    grupos: ['Ao receber', 'Antes de vender'],
    tarefas: [
      { titulo: 'Conferir a nota contra o pedido', grupo: 'Ao receber', prioridade: 5 },
      { titulo: 'Contar as peças e separar as com defeito', grupo: 'Ao receber', prioridade: 4 },
      { titulo: 'Dar entrada no estoque', grupo: 'Ao receber', prioridade: 4 },
      { titulo: 'Etiquetar e colocar preço', grupo: 'Antes de vender', prioridade: 3 },
      { titulo: 'Fotografar as peças novas', grupo: 'Antes de vender', prioridade: 2 },
      { titulo: 'Expor na vitrine e nas araras', grupo: 'Antes de vender', prioridade: 3 },
    ],
  },
} as const satisfies Record<string, Modelo>

export type ChaveModelo = keyof typeof MODELOS

// `hasOwn`, não `in`: "toString" está `in` qualquer objeto, e viria do navegador.
export const modeloValido = (c: unknown): c is ChaveModelo => typeof c === 'string' && Object.hasOwn(MODELOS, c)

// ─────────────────────────────────────────────────────────────
// BANCO — o que a tela lê
// ─────────────────────────────────────────────────────────────

export type QuadroResumido = {
  id: string
  nome: string
  descricao: string | null
  cor: string | null
  unidadeId: string | null
  unidadeNome: string | null
  grupos: string[]
  /** Tarefas que não estão feitas. */
  abertas: number
}

export type TarefaDoQuadro = {
  id: string
  quadroId: string
  grupo: string
  titulo: string
  descricao: string | null
  responsavelId: string | null
  responsavelNome: string | null
  situacao: SituacaoTarefa
  prioridade: number
  progresso: number
  /** Meia-noite local do dia. */
  inicio: Date | null
  prazo: Date | null
  concluidaEm: Date | null
  ordem: number
}

export type QuadroCompleto = QuadroResumido & {
  tarefas: TarefaDoQuadro[]
}

/**
 * O filtro de escopo: quadros da empresa inteira (sem loja) mais os das lojas
 * que a pessoa alcança E que a tela pediu. Fora disso, o quadro não existe
 * para ela — nem por id.
 */
function escopo(sessao: Sessao, unidadeIds: string[]) {
  const permitidas = unidadesQuePodem(sessao, 'tarefa.ver')
  const ids = permitidas === 'todas' ? unidadeIds : unidadeIds.filter((u) => permitidas.includes(u))
  return { OR: [{ unidadeId: null }, { unidadeId: { in: ids } }] }
}

/** Os quadros vivos que esta pessoa vê, para as abas. */
export async function listarQuadros(sessao: Sessao, unidadeIds: string[]): Promise<QuadroResumido[]> {
  exigir(sessao, 'tarefa.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const quadros = await db.quadro.findMany({
      where: { arquivado: false, ...escopo(sessao, unidadeIds) },
      orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
      select: {
        id: true, nome: true, descricao: true, cor: true, unidadeId: true, grupos: true,
        unidade: { select: { nome: true } },
        _count: { select: { tarefas: { where: { situacao: { not: 'FEITO' } } } } },
      },
    })
    return quadros.map((q) => ({
      id: q.id,
      nome: q.nome,
      descricao: q.descricao,
      cor: q.cor,
      unidadeId: q.unidadeId,
      unidadeNome: q.unidade?.nome ?? null,
      grupos: q.grupos,
      abertas: q._count.tarefas,
    }))
  })
}

/**
 * Um quadro com as tarefas, na ordem em que aparecem na tela.
 *
 * Os grupos saem do quadro; um grupo que só existe em tarefa (o quadro foi
 * editado e o nome saiu da lista) entra no fim, para tarefa nenhuma sumir.
 * Devolve null se o quadro não é desta pessoa — a tela cai no primeiro que é.
 */
export async function quadroCompleto(sessao: Sessao, quadroId: string): Promise<QuadroCompleto | null> {
  exigir(sessao, 'tarefa.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const q = await db.quadro.findFirst({
      where: { id: quadroId, arquivado: false },
      select: {
        id: true, nome: true, descricao: true, cor: true, unidadeId: true, grupos: true,
        unidade: { select: { nome: true } },
      },
    })
    if (!q || !pode(sessao, 'tarefa.ver', q.unidadeId ?? undefined)) return null

    const tarefas = await db.tarefa.findMany({
      where: { quadroId: q.id },
      orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
      select: {
        id: true, quadroId: true, grupo: true, titulo: true, descricao: true, responsavelId: true,
        situacao: true, prioridade: true, progresso: true, inicio: true, prazo: true, concluidaEm: true, ordem: true,
        responsavel: { select: { nome: true } },
      },
    })

    const grupos = [...q.grupos]
    for (const t of tarefas) if (t.grupo && !grupos.includes(t.grupo)) grupos.push(t.grupo)

    return {
      id: q.id,
      nome: q.nome,
      descricao: q.descricao,
      cor: q.cor,
      unidadeId: q.unidadeId,
      unidadeNome: q.unidade?.nome ?? null,
      grupos,
      abertas: tarefas.filter((t) => t.situacao !== 'FEITO').length,
      tarefas: tarefas.map((t) => ({
        id: t.id,
        quadroId: t.quadroId,
        grupo: t.grupo,
        titulo: t.titulo,
        descricao: t.descricao,
        responsavelId: t.responsavelId,
        responsavelNome: t.responsavel?.nome ?? null,
        situacao: t.situacao,
        prioridade: t.prioridade,
        progresso: t.progresso,
        inicio: doBanco(t.inicio),
        prazo: doBanco(t.prazo),
        concluidaEm: t.concluidaEm,
        ordem: t.ordem,
      })),
    }
  })
}

export type Pessoa = { id: string; nome: string }

const PAPEIS_DO_QUADRO = (Object.keys(PODERES) as Papel[]).filter((p) => PODERES[p].includes('tarefa.ver'))

/**
 * Quem pode ser responsável por uma tarefa deste quadro: gente ativa, com um
 * papel que vê o quadro, e com acesso à loja do quadro ou à empresa inteira.
 * Quadro sem loja aceita qualquer pessoa da empresa.
 *
 * O contador fica de fora sozinho: o papel dele não vê tarefa, e atribuir
 * tarefa a quem não vai ver o quadro é tarefa que ninguém faz.
 */
export async function pessoasParaAtribuir(sessao: Sessao, unidadeId: string | null): Promise<Pessoa[]> {
  exigir(sessao, 'tarefa.ver', unidadeId ?? undefined)
  const agora = new Date()
  return comoOrg(sessao.orgId, (db) =>
    db.usuario.findMany({
      where: {
        ativo: true,
        acessos: {
          some: {
            papel: { in: PAPEIS_DO_QUADRO },
            ...(unidadeId ? { OR: [{ unidadeId: null }, { unidadeId }] } : {}),
            AND: [{ OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] }],
          },
        },
      },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    }),
  )
}

/** Para a bolinha do menu: o que é meu e está em aberto, e quanto disso venceu. */
export async function minhasPendencias(sessao: Sessao): Promise<{ abertas: number; atrasadas: number }> {
  if (!pode(sessao, 'tarefa.ver')) return { abertas: 0, atrasadas: 0 }
  const hoje = new Date()
  return comoOrg(sessao.orgId, async (db) => {
    const minhas = await db.tarefa.findMany({
      where: { responsavelId: sessao.usuarioId, situacao: { not: 'FEITO' }, quadro: { arquivado: false } },
      select: { prazo: true, situacao: true },
    })
    return {
      abertas: minhas.length,
      atrasadas: minhas.filter((t) => atrasada(doBanco(t.prazo), t.situacao, hoje)).length,
    }
  })
}

export type LojaNoQuadro = {
  /** null = os quadros da empresa inteira. */
  unidadeId: string | null
  nome: string
  aFazer: number
  emAndamento: number
  paradas: number
  atrasadas: number
  feitasNoMes: number
  /** As vencidas, para o dono ver o nome sem abrir loja por loja. */
  vencidas: { id: string; titulo: string; prazo: Date; quadroNome: string; responsavelNome: string | null }[]
}

/**
 * A rede, loja a loja: o que cada uma tem a fazer, o que venceu e o que fez
 * no mês. É a pergunta do dono de várias lojas — "qual delas está deixando
 * a lista acumular?" — respondida sem trocar de loja seis vezes.
 */
export async function tarefasDaRede(sessao: Sessao, unidadeIds: string[]): Promise<LojaNoQuadro[]> {
  exigir(sessao, 'tarefa.ver')
  const hoje = new Date()
  // "Feita no mês" é o mês de São Paulo, como o resto do módulo.
  const inicioDoMes = inicioDoDiaEmSP(primeiroDoMes(diaEmSP(hoje)))

  return comoOrg(sessao.orgId, async (db) => {
    const quadros = await db.quadro.findMany({
      where: { arquivado: false, ...escopo(sessao, unidadeIds) },
      select: { id: true, nome: true, unidadeId: true, unidade: { select: { nome: true } } },
    })
    const tarefas = await db.tarefa.findMany({
      where: { quadroId: { in: quadros.map((q) => q.id) } },
      select: {
        id: true, quadroId: true, titulo: true, situacao: true, prazo: true, concluidaEm: true,
        responsavel: { select: { nome: true } },
      },
    })

    const quadroDe = new Map(quadros.map((q) => [q.id, q]))
    const lojas = new Map<string | null, LojaNoQuadro>()
    for (const q of quadros) {
      if (!lojas.has(q.unidadeId)) {
        lojas.set(q.unidadeId, {
          unidadeId: q.unidadeId,
          nome: q.unidade?.nome ?? 'Empresa inteira',
          aFazer: 0, emAndamento: 0, paradas: 0, atrasadas: 0, feitasNoMes: 0, vencidas: [],
        })
      }
    }
    for (const t of tarefas) {
      const q = quadroDe.get(t.quadroId)!
      const loja = lojas.get(q.unidadeId)!
      const prazo = doBanco(t.prazo)
      if (t.situacao === 'A_FAZER') loja.aFazer++
      else if (t.situacao === 'EM_ANDAMENTO') loja.emAndamento++
      else if (t.situacao === 'PARADO') loja.paradas++
      else if (t.concluidaEm && t.concluidaEm >= inicioDoMes) loja.feitasNoMes++
      if (atrasada(prazo, t.situacao, hoje)) {
        loja.atrasadas++
        loja.vencidas.push({
          id: t.id, titulo: t.titulo, prazo: prazo!, quadroNome: q.nome, responsavelNome: t.responsavel?.nome ?? null,
        })
      }
    }
    for (const l of lojas.values()) l.vencidas.sort((a, b) => a.prazo.getTime() - b.prazo.getTime())

    // A empresa inteira primeiro, depois as lojas por nome.
    return [...lojas.values()].sort((a, b) =>
      a.unidadeId === null ? -1 : b.unidadeId === null ? 1 : a.nome.localeCompare(b.nome, 'pt-BR'),
    )
  })
}

// ─────────────────────────────────────────────────────────────
// BANCO — o que a tela escreve
// ─────────────────────────────────────────────────────────────
//
// Toda função aqui: exige a capacidade, valida o que veio (o navegador é do
// usuário), confere o plano DENTRO da mesma transação da escrita, e grava a
// linha de auditoria junto. O plano se lê aqui e não por `planoDaEmpresa`
// porque essa abre a própria transação — e `comoOrg` dentro de `comoOrg` trava.

const auditar = (
  db: BancoDaOrg,
  sessao: Sessao,
  dados: {
    acao: string
    unidadeId: string | null
    alvoTipo: 'quadro' | 'tarefa'
    alvoId: string
    alvoNome: string
    antes?: object
    depois?: object
    motivo?: string
  },
) =>
  db.auditoria.create({
    data: {
      orgId: sessao.orgId,
      unidadeId: dados.unidadeId,
      usuarioId: sessao.usuarioId,
      quem: sessao.nome,
      acao: dados.acao,
      alvoTipo: dados.alvoTipo,
      alvoId: dados.alvoId,
      alvoNome: dados.alvoNome,
      antes: dados.antes,
      depois: dados.depois,
      motivo: dados.motivo,
    },
  })

const planoDe = async (db: BancoDaOrg, orgId: string): Promise<Plano> =>
  (await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plano: true } })).plano

/** Um quadro vivo que esta pessoa pode GERIR. Lança se não existe ou não pode. */
async function quadroParaGerir(db: BancoDaOrg, sessao: Sessao, quadroId: string) {
  const q = await db.quadro.findFirst({
    where: { id: quadroId, arquivado: false },
    select: { id: true, nome: true, unidadeId: true, grupos: true, descricao: true, cor: true },
  })
  if (!q) throw new Error('Este quadro não existe mais.')
  exigir(sessao, 'tarefa.gerir', q.unidadeId ?? undefined)
  return q
}

/** Uma tarefa com o quadro dela. Lança se não existe. */
async function tarefaComQuadro(db: BancoDaOrg, tarefaId: string) {
  const t = await db.tarefa.findFirst({
    where: { id: tarefaId, quadro: { arquivado: false } },
    select: {
      id: true, titulo: true, descricao: true, grupo: true, responsavelId: true, situacao: true,
      prioridade: true, progresso: true, inicio: true, prazo: true, concluidaEm: true,
      quadro: { select: { id: true, nome: true, unidadeId: true, grupos: true } },
    },
  })
  if (!t) throw new Error('Esta tarefa não existe mais.')
  return t
}

const abertasDaEmpresa = (db: BancoDaOrg) =>
  db.tarefa.count({ where: { situacao: { not: 'FEITO' }, quadro: { arquivado: false } } })

const quadrosVivos = (db: BancoDaOrg) => db.quadro.count({ where: { arquivado: false } })

/** Só quem existe, está ativo e pode ver o quadro vira responsável. */
async function conferirResponsavel(db: BancoDaOrg, unidadeId: string | null, responsavelId: string | null) {
  if (responsavelId === null) return null
  const agora = new Date()
  const p = await db.usuario.findFirst({
    where: {
      id: responsavelId,
      ativo: true,
      acessos: {
        some: {
          papel: { in: PAPEIS_DO_QUADRO },
          ...(unidadeId ? { OR: [{ unidadeId: null }, { unidadeId }] } : {}),
          AND: [{ OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] }],
        },
      },
    },
    select: { id: true, nome: true },
  })
  if (!p) throw new Error('Essa pessoa não pode receber tarefa neste quadro.')
  return p
}

export type NovoQuadro = {
  nome: string
  descricao?: string | null
  cor?: string | null
  unidadeId?: string | null
  grupos?: string[]
}

/** Os grupos que um quadro novo nasce com, quando a pessoa não diz. */
export const GRUPOS_PADRAO = ['Esta semana', 'Este mês', 'Próximo mês']

export async function criarQuadro(sessao: Sessao, dados: NovoQuadro): Promise<{ id: string }> {
  const unidadeId = dados.unidadeId || null
  exigir(sessao, 'tarefa.gerir', unidadeId ?? undefined)

  const nome = limparTexto(dados.nome, NOME_MAX)
  if (!nome) throw new Error('Dê um nome ao quadro.')
  const descricao = limparTexto(dados.descricao, DESCRICAO_MAX) || null
  const cor = corValida(dados.cor) ? dados.cor.toLowerCase() : null
  const grupos = dados.grupos ? limparGrupos(dados.grupos) : GRUPOS_PADRAO

  return comoOrg(sessao.orgId, async (db) => {
    const plano = await planoDe(db, sessao.orgId)
    const cabe = cabeNoPlano(plano, { quadros: await quadrosVivos(db), abertas: 0 }, 'quadro')
    if (!cabe.pode) throw new Error(cabe.motivo)
    // Quadro POR LOJA é a mesma liberação de "vários quadros": no plano de um
    // quadro só, ele é da empresa inteira — não há o que separar.
    if (unidadeId && !liberado(plano, 'tarefas.varios')) {
      throw new Error(`Quadro por loja é ${PLANOS[plano].titulo === 'Grátis' ? 'do Balcão' : 'de outro plano'} para cima. Este quadro vale para a empresa inteira.`)
    }
    if (unidadeId) {
      const u = await db.unidade.findFirst({ where: { id: unidadeId, ativa: true }, select: { id: true } })
      if (!u) throw new Error('Essa loja não existe.')
    }

    const ultimo = await db.quadro.aggregate({ _max: { ordem: true } })
    const q = await db.quadro.create({
      data: {
        orgId: sessao.orgId,
        unidadeId,
        nome,
        descricao,
        cor,
        grupos,
        ordem: (ultimo._max.ordem ?? 0) + 1,
        quem: sessao.nome,
      },
      select: { id: true },
    })
    await auditar(db, sessao, {
      acao: 'quadro.criou', unidadeId, alvoTipo: 'quadro', alvoId: q.id, alvoNome: nome,
      depois: { nome, unidadeId, grupos },
    })
    return { id: q.id }
  })
}

export type AlteracaoDeQuadro = {
  nome?: string
  descricao?: string | null
  cor?: string | null
  grupos?: string[]
  unidadeId?: string | null
}

export async function alterarQuadro(sessao: Sessao, quadroId: string, dados: AlteracaoDeQuadro): Promise<void> {
  exigir(sessao, 'tarefa.gerir')
  await comoOrg(sessao.orgId, async (db) => {
    const q = await quadroParaGerir(db, sessao, quadroId)
    const novo: { nome?: string; descricao?: string | null; cor?: string | null; grupos?: string[]; unidadeId?: string | null } = {}

    if (dados.nome !== undefined) {
      const nome = limparTexto(dados.nome, NOME_MAX)
      if (!nome) throw new Error('O quadro precisa de um nome.')
      novo.nome = nome
    }
    if (dados.descricao !== undefined) novo.descricao = limparTexto(dados.descricao, DESCRICAO_MAX) || null
    if (dados.cor !== undefined) {
      if (dados.cor !== null && !corValida(dados.cor)) throw new Error('Cor inválida.')
      novo.cor = dados.cor ? dados.cor.toLowerCase() : null
    }
    if (dados.grupos !== undefined) novo.grupos = limparGrupos(dados.grupos)
    if (dados.unidadeId !== undefined && dados.unidadeId !== q.unidadeId) {
      const alvo = dados.unidadeId || null
      exigir(sessao, 'tarefa.gerir', alvo ?? undefined)
      if (alvo) {
        const plano = await planoDe(db, sessao.orgId)
        if (!liberado(plano, 'tarefas.varios')) throw new Error('Quadro por loja é do Balcão para cima.')
        const u = await db.unidade.findFirst({ where: { id: alvo, ativa: true }, select: { id: true } })
        if (!u) throw new Error('Essa loja não existe.')
      }
      novo.unidadeId = alvo
    }
    if (Object.keys(novo).length === 0) return

    await db.quadro.update({ where: { id: q.id }, data: novo })
    await auditar(db, sessao, {
      acao: 'quadro.alterou', unidadeId: q.unidadeId, alvoTipo: 'quadro', alvoId: q.id, alvoNome: novo.nome ?? q.nome,
      antes: { nome: q.nome, descricao: q.descricao, cor: q.cor, grupos: q.grupos, unidadeId: q.unidadeId },
      depois: novo,
    })
  })
}

/**
 * Renomear um grupo é mexer em dois lugares: na lista do quadro e no campo
 * `grupo` de cada tarefa dele. Juntos, na mesma transação, ou a faixa muda
 * de nome e as tarefas ficam órfãs num grupo que não existe mais.
 */
export async function renomearGrupo(sessao: Sessao, quadroId: string, de: string, para: string): Promise<void> {
  exigir(sessao, 'tarefa.gerir')
  const novo = limparTexto(para, GRUPO_MAX)
  if (!novo) throw new Error('O grupo precisa de um nome.')
  await comoOrg(sessao.orgId, async (db) => {
    const q = await quadroParaGerir(db, sessao, quadroId)
    if (q.grupos.includes(novo) && novo !== de) throw new Error('Já existe um grupo com esse nome.')
    const grupos = q.grupos.includes(de) ? q.grupos.map((g) => (g === de ? novo : g)) : [...q.grupos, novo]
    await db.quadro.update({ where: { id: q.id }, data: { grupos } })
    await db.tarefa.updateMany({ where: { quadroId: q.id, grupo: de }, data: { grupo: novo } })
    await auditar(db, sessao, {
      acao: 'quadro.alterou', unidadeId: q.unidadeId, alvoTipo: 'quadro', alvoId: q.id, alvoNome: q.nome,
      antes: { grupo: de }, depois: { grupo: novo },
    })
  })
}

/**
 * Arquivar, não apagar: o quadro sai da tela e as tarefas ficam no banco,
 * com o histórico de quem fez o quê. Lista de abertura de três anos é
 * memória da loja.
 */
export async function arquivarQuadro(sessao: Sessao, quadroId: string): Promise<void> {
  exigir(sessao, 'tarefa.gerir')
  await comoOrg(sessao.orgId, async (db) => {
    const q = await quadroParaGerir(db, sessao, quadroId)
    await db.quadro.update({ where: { id: q.id }, data: { arquivado: true } })
    await auditar(db, sessao, {
      acao: 'quadro.arquivou', unidadeId: q.unidadeId, alvoTipo: 'quadro', alvoId: q.id, alvoNome: q.nome,
    })
  })
}

export type NovaTarefa = {
  quadroId: string
  grupo: string
  titulo: string
  descricao?: string | null
  responsavelId?: string | null
  prioridade?: number
  inicio?: string | null
  prazo?: string | null
}

export async function criarTarefa(sessao: Sessao, dados: NovaTarefa): Promise<{ id: string }> {
  exigir(sessao, 'tarefa.gerir')
  const titulo = limparTexto(dados.titulo, TITULO_MAX)
  if (!titulo) throw new Error('Escreva o que é para fazer.')
  const descricao = limparTexto(dados.descricao, DESCRICAO_MAX) || null
  const grupo = limparTexto(dados.grupo, GRUPO_MAX)

  return comoOrg(sessao.orgId, async (db) => {
    const q = await quadroParaGerir(db, sessao, dados.quadroId)
    const plano = await planoDe(db, sessao.orgId)
    const cabe = cabeNoPlano(plano, { quadros: 1, abertas: await abertasDaEmpresa(db) }, 'tarefa')
    if (!cabe.pode) throw new Error(cabe.motivo)

    // No plano que não abre responsável, prazo e prioridade, o que vier é
    // IGNORADO em vez de recusado: a linha "+ Adicionar tarefa" manda só o
    // título, e o resto chega vazio de qualquer forma.
    const responsavel = liberado(plano, 'tarefas.responsavel')
      ? await conferirResponsavel(db, q.unidadeId, dados.responsavelId ?? null)
      : null
    const prioridade = liberado(plano, 'tarefas.prioridade') && prioridadeValida(dados.prioridade) ? dados.prioridade : 0
    const prazo = liberado(plano, 'tarefas.prazo') ? dataSemHora(dados.prazo) : null
    const inicio = liberado(plano, 'tarefas.linhaDoTempo') ? dataSemHora(dados.inicio) : null
    if (dados.prazo && liberado(plano, 'tarefas.prazo') && !prazo) throw new Error('Prazo inválido.')

    const ultimo = await db.tarefa.aggregate({ where: { quadroId: q.id }, _max: { ordem: true } })
    const t = await db.tarefa.create({
      data: {
        orgId: sessao.orgId,
        quadroId: q.id,
        grupo,
        titulo,
        descricao,
        responsavelId: responsavel?.id ?? null,
        prioridade,
        inicio,
        prazo,
        ordem: (ultimo._max.ordem ?? 0) + 1,
        quem: sessao.nome,
      },
      select: { id: true },
    })
    // Grupo novo digitado direto na linha entra na lista do quadro, senão a
    // tarefa aparece num grupo que o quadro não conhece.
    if (grupo && !q.grupos.includes(grupo)) {
      await db.quadro.update({ where: { id: q.id }, data: { grupos: [...q.grupos, grupo] } })
    }
    await auditar(db, sessao, {
      acao: 'tarefa.criou', unidadeId: q.unidadeId, alvoTipo: 'tarefa', alvoId: t.id, alvoNome: titulo,
      depois: { quadro: q.nome, grupo, responsavel: responsavel?.nome ?? null, prioridade, prazo: prazo ? chaveDoDia(prazo) : null },
    })
    return { id: t.id }
  })
}

export type AlteracaoDeTarefa = {
  titulo?: string
  descricao?: string | null
  grupo?: string
  responsavelId?: string | null
  prioridade?: number
  inicio?: string | null
  prazo?: string | null
}

/**
 * Editar os campos de uma tarefa — tudo menos situação e progresso, que têm
 * as próprias funções porque quem só vê também pode mexer nelas.
 *
 * Aqui o plano RECUSA em vez de ignorar: quem chegou a chamar isto com um
 * responsável no Grátis contornou a tela, e contornar merece um "não".
 */
export async function alterarTarefa(sessao: Sessao, tarefaId: string, dados: AlteracaoDeTarefa): Promise<void> {
  exigir(sessao, 'tarefa.gerir')
  await comoOrg(sessao.orgId, async (db) => {
    const t = await tarefaComQuadro(db, tarefaId)
    exigir(sessao, 'tarefa.gerir', t.quadro.unidadeId ?? undefined)
    const plano = await planoDe(db, sessao.orgId)

    const novo: {
      titulo?: string; descricao?: string | null; grupo?: string; responsavelId?: string | null
      prioridade?: number; inicio?: Date | null; prazo?: Date | null
    } = {}
    const legivel: Record<string, unknown> = {}

    if (dados.titulo !== undefined) {
      const titulo = limparTexto(dados.titulo, TITULO_MAX)
      if (!titulo) throw new Error('A tarefa precisa de um título.')
      novo.titulo = titulo
      legivel.titulo = titulo
    }
    if (dados.descricao !== undefined) {
      novo.descricao = limparTexto(dados.descricao, DESCRICAO_MAX) || null
      legivel.descricao = novo.descricao
    }
    if (dados.grupo !== undefined) {
      const grupo = limparTexto(dados.grupo, GRUPO_MAX)
      if (grupo && !t.quadro.grupos.includes(grupo)) throw new Error('Esse grupo não existe neste quadro.')
      novo.grupo = grupo
      legivel.grupo = grupo
    }
    if (dados.responsavelId !== undefined) {
      if (!liberado(plano, 'tarefas.responsavel')) throw new Error('Responsável pela tarefa é do Balcão para cima.')
      const p = await conferirResponsavel(db, t.quadro.unidadeId, dados.responsavelId || null)
      novo.responsavelId = p?.id ?? null
      legivel.responsavel = p?.nome ?? null
    }
    if (dados.prioridade !== undefined) {
      if (!liberado(plano, 'tarefas.prioridade')) throw new Error('Prioridade em estrelas é do Balcão para cima.')
      if (!prioridadeValida(dados.prioridade)) throw new Error('Prioridade vai de 0 a 5.')
      novo.prioridade = dados.prioridade
      legivel.prioridade = dados.prioridade
    }
    if (dados.prazo !== undefined) {
      if (!liberado(plano, 'tarefas.prazo')) throw new Error('Prazo da tarefa é do Balcão para cima.')
      if (dados.prazo && !dataSemHora(dados.prazo)) throw new Error('Prazo inválido.')
      novo.prazo = dataSemHora(dados.prazo)
      legivel.prazo = dados.prazo || null
    }
    if (dados.inicio !== undefined) {
      if (!liberado(plano, 'tarefas.linhaDoTempo')) throw new Error('Linha do tempo é do Assistente para cima.')
      if (dados.inicio && !dataSemHora(dados.inicio)) throw new Error('Data de início inválida.')
      novo.inicio = dataSemHora(dados.inicio)
      legivel.inicio = dados.inicio || null
    }
    if (Object.keys(novo).length === 0) return

    await db.tarefa.update({ where: { id: t.id }, data: novo })
    await auditar(db, sessao, {
      acao: 'tarefa.alterou', unidadeId: t.quadro.unidadeId, alvoTipo: 'tarefa', alvoId: t.id, alvoNome: novo.titulo ?? t.titulo,
      antes: {
        titulo: t.titulo, grupo: t.grupo, responsavelId: t.responsavelId, prioridade: t.prioridade,
        prazo: t.prazo ? chaveDoDia(doBanco(t.prazo)!) : null, inicio: t.inicio ? chaveDoDia(doBanco(t.inicio)!) : null,
      },
      depois: legivel,
    })
  })
}

/**
 * Mudar a situação. É a ação mais frequente do quadro — o clique na pílula —
 * e a que quem só vê também faz, na tarefa que é dela.
 *
 * FEITO carimba a hora e leva o progresso a 100: uma tarefa feita pela metade
 * não existe. Sair de FEITO apaga o carimbo, porque "entregou no prazo" se
 * mede pelo carimbo, e ele precisa ser da entrega que valeu.
 */
export async function moverTarefa(sessao: Sessao, tarefaId: string, situacao: SituacaoTarefa): Promise<void> {
  exigir(sessao, 'tarefa.ver')
  if (!situacaoValida(situacao)) throw new Error('Situação inválida.')
  await comoOrg(sessao.orgId, async (db) => {
    const t = await tarefaComQuadro(db, tarefaId)
    if (!podeMexerNaTarefa(sessao, t, t.quadro.unidadeId)) throw new SemPermissao('tarefa.gerir', t.quadro.unidadeId ?? undefined)
    if (t.situacao === situacao) return

    // Reabrir conta como tarefa em aberto de novo — e o teto do plano vale
    // para ela igual a uma tarefa nova.
    if (t.situacao === 'FEITO') {
      const plano = await planoDe(db, sessao.orgId)
      const cabe = cabeNoPlano(plano, { quadros: 1, abertas: await abertasDaEmpresa(db) }, 'tarefa')
      if (!cabe.pode) throw new Error(cabe.motivo)
    }

    const concluiu = situacao === 'FEITO'
    await db.tarefa.update({
      where: { id: t.id },
      data: {
        situacao,
        ...(concluiu ? { concluidaEm: new Date(), progresso: 100 } : {}),
        ...(t.situacao === 'FEITO' ? { concluidaEm: null } : {}),
      },
    })
    await auditar(db, sessao, {
      acao: concluiu ? 'tarefa.concluiu' : 'tarefa.moveu',
      unidadeId: t.quadro.unidadeId, alvoTipo: 'tarefa', alvoId: t.id, alvoNome: t.titulo,
      antes: { situacao: t.situacao }, depois: { situacao },
      motivo: t.quadro.nome,
    })
  })
}

/** O progresso da linha do tempo, de 0 a 100. Quem só vê também move o dela. */
export async function progredir(sessao: Sessao, tarefaId: string, progresso: number): Promise<void> {
  exigir(sessao, 'tarefa.ver')
  if (!progressoValido(progresso)) throw new Error('Progresso vai de 0 a 100.')
  await comoOrg(sessao.orgId, async (db) => {
    const t = await tarefaComQuadro(db, tarefaId)
    if (!podeMexerNaTarefa(sessao, t, t.quadro.unidadeId)) throw new SemPermissao('tarefa.gerir', t.quadro.unidadeId ?? undefined)
    const plano = await planoDe(db, sessao.orgId)
    if (!liberado(plano, 'tarefas.linhaDoTempo')) throw new Error('Linha do tempo é do Assistente para cima.')
    if (t.progresso === progresso) return
    await db.tarefa.update({ where: { id: t.id }, data: { progresso } })
    await auditar(db, sessao, {
      acao: 'tarefa.alterou', unidadeId: t.quadro.unidadeId, alvoTipo: 'tarefa', alvoId: t.id, alvoNome: t.titulo,
      antes: { progresso: t.progresso }, depois: { progresso },
    })
  })
}

export async function apagarTarefa(sessao: Sessao, tarefaId: string): Promise<void> {
  exigir(sessao, 'tarefa.gerir')
  await comoOrg(sessao.orgId, async (db) => {
    const t = await tarefaComQuadro(db, tarefaId)
    exigir(sessao, 'tarefa.gerir', t.quadro.unidadeId ?? undefined)
    await db.tarefa.delete({ where: { id: t.id } })
    await auditar(db, sessao, {
      acao: 'tarefa.apagou', unidadeId: t.quadro.unidadeId, alvoTipo: 'tarefa', alvoId: t.id, alvoNome: t.titulo,
      antes: { grupo: t.grupo, situacao: t.situacao, responsavelId: t.responsavelId },
      motivo: t.quadro.nome,
    })
  })
}

/**
 * Um quadro pronto, de uma vez: o quadro, os grupos e as tarefas, numa
 * transação só. Os modelos são do Assistente para cima — e como o Assistente
 * já tem vários quadros, o teto de um quadro nunca entra no caminho.
 */
export async function criarDeModelo(sessao: Sessao, chave: ChaveModelo, unidadeId: string | null): Promise<{ id: string }> {
  const onde = unidadeId || null
  exigir(sessao, 'tarefa.gerir', onde ?? undefined)
  if (!modeloValido(chave)) throw new Error('Esse modelo não existe.')
  const modelo: Modelo = MODELOS[chave]

  return comoOrg(sessao.orgId, async (db) => {
    const plano = await planoDe(db, sessao.orgId)
    if (!liberado(plano, 'tarefas.modelos')) throw new Error('Modelos de quadro são do Assistente para cima.')
    if (onde) {
      const u = await db.unidade.findFirst({ where: { id: onde, ativa: true }, select: { id: true } })
      if (!u) throw new Error('Essa loja não existe.')
    }
    const ultimo = await db.quadro.aggregate({ _max: { ordem: true } })
    const q = await db.quadro.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: onde,
        nome: modelo.titulo,
        descricao: modelo.descricao,
        cor: modelo.cor,
        grupos: [...modelo.grupos],
        ordem: (ultimo._max.ordem ?? 0) + 1,
        quem: sessao.nome,
      },
      select: { id: true },
    })
    await db.tarefa.createMany({
      data: modelo.tarefas.map((t, i) => ({
        orgId: sessao.orgId,
        quadroId: q.id,
        grupo: t.grupo,
        titulo: t.titulo,
        descricao: t.descricao ?? null,
        prioridade: liberado(plano, 'tarefas.prioridade') ? (t.prioridade ?? 0) : 0,
        ordem: i + 1,
        quem: sessao.nome,
      })),
    })
    await auditar(db, sessao, {
      acao: 'quadro.criou', unidadeId: onde, alvoTipo: 'quadro', alvoId: q.id, alvoNome: modelo.titulo,
      depois: { modelo: chave, grupos: modelo.grupos, tarefas: modelo.tarefas.length },
      motivo: `a partir do modelo "${modelo.titulo}"`,
    })
    return { id: q.id }
  })
}
