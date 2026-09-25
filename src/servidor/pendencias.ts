// "Precisa de você": o que está esperando uma pessoa agir, hoje.
//
// ── por que existe ───────────────────────────────────────────
// O painel responde "como estou indo?". Esta lista responde a outra pergunta,
// a que o dono faz antes de qualquer gráfico: "tem alguma coisa pegando fogo?"
// Produto que acabou, conta que venceu, fiado atrasado, caixa que ninguém
// fechou ontem. Cada uma dessas mora numa tela diferente, e quem precisava
// abrir as seis para descobrir que estava tudo bem acabava não abrindo
// nenhuma.
//
// ── as duas metades ──────────────────────────────────────────
// `pendenciasDoDia` CONTA — uma transação só, uma consulta por assunto, e
// cada assunto só se a pessoa pode ver aquilo. `montarPendencias` ESCREVE —
// frase, nível e link — e é pura, para os testes fixarem o texto e a ordem
// sem banco.
//
// Assunto que a pessoa não pode ver volta `undefined`, e não zero. É a
// diferença entre "nenhuma conta vencida" e "não é da sua conta": a lista
// não pode dizer "tudo em dia" para o contador sobre o estoque que ele nunca
// viu.
//
// ── o dia ────────────────────────────────────────────────────
// Prazo de tarefa, vencimento de conta e de parcela são colunas DATE. Elas
// se comparam com o dia de HOJE escrito como texto ("2026-09-24"::date), e
// não com uma meia-noite em JavaScript: a meia-noite de São Paulo é 3h da
// manhã em UTC, e comparar a data do banco (meia-noite UTC) com ela faz a
// conta que vence hoje aparecer como vencida desde a primeira hora do dia.

import { comoOrg } from './banco'
import { exigir, pode, type Capacidade, type Sessao } from './permissao'
import { moduloLigado, type ComModulos } from './modulos'
import { diaEmSP } from './dia'

const HORA = 36e5

/** Caixa aberto há mais que isso foi esquecido: nenhum turno dura 12 horas. */
export const CAIXA_ESQUECIDO_HORAS = 12

// ─────────────────────────────────────────────────────────────
// A PARTE PURA
// ─────────────────────────────────────────────────────────────

export type NivelPendencia = 'critico' | 'atencao'

export type ChavePendencia =
  | 'acabaram'
  | 'contasVencidas'
  | 'parcelasVencidas'
  | 'contasHoje'
  | 'caixasEsquecidos'
  | 'propostas'
  | 'tarefasMinhas'
  | 'tarefasEquipe'
  | 'noMinimo'

/** O que foi contado. `undefined` = a pessoa não vê esse assunto. */
export type Contagens = {
  acabaram?: number
  noMinimo?: number
  contasVencidas?: { quantas: number; valor: number }
  contasHoje?: { quantas: number; valor: number }
  parcelasVencidas?: { quantas: number; valor: number; clientes: number }
  tarefasMinhas?: number
  /** As atrasadas dos quadros da loja que NÃO são desta pessoa. */
  tarefasEquipe?: number
  caixasEsquecidos?: { quantos: number; horas: number }
  propostas?: number
}

export type Pendencia = {
  chave: ChavePendencia
  nivel: NivelPendencia
  /** A frase inteira, com o número: "3 produtos acabaram". */
  frase: string
  /** Uma linha de apoio: quanto, desde quando, o que fazer. */
  detalhe: string
  href: string
}

/** "1 produto" / "3 produtos". O número vai junto, sempre. */
export function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * A ordem da lista. Primeiro o que já custa dinheiro — venda perdida por
 * falta de produto, juro de conta, fiado que envelhece —, depois o que ainda
 * dá tempo. Dentro de cada nível a ordem é FIXA, e não por tamanho: a pessoa
 * aprende onde cada coisa aparece, e lista que troca de lugar todo dia
 * precisa ser lida de novo todo dia.
 */
const ORDEM: ChavePendencia[] = [
  'acabaram',
  'contasVencidas',
  'parcelasVencidas',
  'contasHoje',
  'caixasEsquecidos',
  'propostas',
  'tarefasMinhas',
  'tarefasEquipe',
  'noMinimo',
]

/**
 * Transforma as contagens na lista da tela.
 *
 * Só entra o que tem número maior que zero: "0 contas vencidas" em vermelho
 * é ruído, e ruído ensina a ignorar a cor. Lista vazia é o "tudo em dia", e
 * quem desenha isso é a tela.
 */
export function montarPendencias(c: Contagens, slug: string, unidadeId: string | null = null): Pendencia[] {
  // A loja escolhida vai junto no link: quem olhava a loja do shopping e
  // clicou em "Ver" quer a lista da loja do shopping, não a da rede.
  const link = (tela: string, busca: Record<string, string> = {}) => {
    const p = new URLSearchParams(busca)
    if (unidadeId) p.set('unidade', unidadeId)
    const q = p.toString()
    return `/${slug}/${tela}${q ? `?${q}` : ''}`
  }

  const saida: Pendencia[] = []
  const por = (p: Pendencia) => saida.push(p)

  if (c.acabaram) {
    por({
      chave: 'acabaram',
      nivel: 'critico',
      frase: `${plural(c.acabaram, 'produto', 'produtos')} ${c.acabaram === 1 ? 'acabou' : 'acabaram'}`,
      detalhe: 'Sem saldo para vender — é venda indo para o vizinho.',
      href: link('estoque', { situacao: 'acabaram' }),
    })
  }
  if (c.noMinimo) {
    por({
      chave: 'noMinimo',
      nivel: 'atencao',
      frase: `${plural(c.noMinimo, 'produto', 'produtos')} no mínimo`,
      detalhe: 'Ainda tem, mas já é hora de pedir.',
      href: link('estoque', { situacao: 'minimo' }),
    })
  }
  if (c.contasVencidas?.quantas) {
    por({
      chave: 'contasVencidas',
      nivel: 'critico',
      frase: plural(c.contasVencidas.quantas, 'conta vencida', 'contas vencidas'),
      detalhe: `${brl(c.contasVencidas.valor)} em atraso, com juro correndo.`,
      href: link('financeiro'),
    })
  }
  if (c.contasHoje?.quantas) {
    por({
      chave: 'contasHoje',
      nivel: 'atencao',
      frase: `${plural(c.contasHoje.quantas, 'conta vence', 'contas vencem')} hoje`,
      detalhe: `${brl(c.contasHoje.valor)} para pagar até o fim do dia.`,
      href: link('financeiro'),
    })
  }
  if (c.parcelasVencidas?.quantas) {
    const p = c.parcelasVencidas
    por({
      chave: 'parcelasVencidas',
      nivel: 'critico',
      frase: `${plural(p.quantas, 'parcela', 'parcelas')} de fiado ${p.quantas === 1 ? 'vencida' : 'vencidas'}`,
      detalhe: `${brl(p.valor)} de ${plural(p.clientes, 'cliente', 'clientes')}. Cobre enquanto é recente.`,
      href: link('crediario', { situacao: 'vencida' }),
    })
  }
  if (c.tarefasMinhas) {
    por({
      chave: 'tarefasMinhas',
      nivel: 'atencao',
      frase: plural(c.tarefasMinhas, 'tarefa sua atrasada', 'tarefas suas atrasadas'),
      detalhe: 'O prazo já passou e ainda não estão feitas.',
      href: link('tarefas', { minhas: '1' }),
    })
  }
  if (c.tarefasEquipe) {
    por({
      chave: 'tarefasEquipe',
      nivel: 'atencao',
      frase: plural(c.tarefasEquipe, 'tarefa da equipe atrasada', 'tarefas da equipe atrasadas'),
      detalhe: 'De outras pessoas ou sem ninguém responsável.',
      href: link('tarefas'),
    })
  }
  if (c.caixasEsquecidos?.quantos) {
    const k = c.caixasEsquecidos
    por({
      chave: 'caixasEsquecidos',
      nivel: 'atencao',
      frase:
        k.quantos === 1
          ? `Caixa aberto há ${plural(k.horas, 'hora', 'horas')}`
          : `${plural(k.quantos, 'caixa', 'caixas')} abertos há mais de ${CAIXA_ESQUECIDO_HORAS} horas`,
      detalhe: 'Alguém esqueceu de fechar — e a gaveta fica sem conferência.',
      href: link('caixa'),
    })
  }
  if (c.propostas) {
    por({
      chave: 'propostas',
      nivel: 'atencao',
      frase: `${plural(c.propostas, 'proposta', 'propostas')} do assistente esperando você`,
      detalhe: 'Valem por 24 horas. Depois disso, o assistente desiste.',
      href: link('agente'),
    })
  }

  return saida.sort((a, b) => ORDEM.indexOf(a.chave) - ORDEM.indexOf(b.chave))
}

// ─────────────────────────────────────────────────────────────
// O CABEÇALHO DO DIA
// ─────────────────────────────────────────────────────────────
//
// "Bom dia, Ana · quarta, 24 de setembro". Calculado no fuso de São Paulo, e
// não no do servidor: a saudação é a primeira coisa que a pessoa lê, e "boa
// noite" às 9h da manhã desacredita todo número que vem depois dela.

const FUSO = 'America/Sao_Paulo'
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const

/** Hora, dia da semana, dia e mês de um instante, no relógio de São Paulo. */
export function noRelogio(agora: Date): { hora: number; semana: number; dia: number; mes: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(agora)
  const de = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(de('weekday'))
  return { hora: Number(de('hour')) % 24, semana, dia: Number(de('day')), mes: Number(de('month')) - 1 }
}

/** "Bom dia" das 5h às 11h59, "Boa tarde" até 17h59, "Boa noite" no resto. */
export function saudacao(hora: number): string {
  return hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite'
}

/** Só o primeiro nome: "Ana Paula Souza" vira "Ana". */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? ''
}

/** "quarta, 24 de setembro" */
export function diaPorExtenso(agora: Date): string {
  const r = noRelogio(agora)
  return `${DIAS[r.semana]}, ${r.dia} de ${MESES[r.mes]}`
}

/** "14:32", no relógio de São Paulo. */
export function horaMinuto(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
}

/**
 * "quarta passada", "sábado passado". O gênero vem do nome do dia —
 * sábado e domingo são os dois masculinos da semana.
 */
export function mesmoDiaPassado(agora: Date): string {
  const s = noRelogio(agora).semana
  return `${DIAS[s]} ${s === 0 || s === 6 ? 'passado' : 'passada'}`
}

// ─────────────────────────────────────────────────────────────
// A CONTAGEM
// ─────────────────────────────────────────────────────────────


const n = (v: unknown) => Number(v ?? 0)

/**
 * Conta tudo que entra na lista, na unidade (ou unidades) que a pessoa está
 * olhando. Cada assunto só é lido se a pessoa pode vê-lo NAQUELA unidade —
 * o gerente da loja 3 não fica sabendo do caixa esquecido na loja 5.
 */
export async function pendenciasDoDia(
  sessao: Sessao,
  empresa: ComModulos,
  unidadeIds: string[],
  agora: Date = new Date(),
): Promise<Contagens> {
  exigir(sessao, 'relatorio.ver')

  const onde = (c: Capacidade) => unidadeIds.filter((u) => pode(sessao, c, u))
  const doEstoque = onde('estoque.ver')
  const doDinheiro = onde('financeiro.ver')
  const doFiado = moduloLigado(empresa, 'crediario') ? onde('crediario.ver') : []
  const doCaixa = onde('caixa.ver')
  const verTarefas = pode(sessao, 'tarefa.ver')
  const gerirTarefas = pode(sessao, 'tarefa.gerir')
  const verPropostas = moduloLigado(empresa, 'agente') && pode(sessao, 'agente.configurar')

  // O dia de HOJE no calendário de São Paulo, e não no relógio do servidor:
  // num servidor em UTC, a partir das 21h a conta que vence amanhã já
  // aparecia como "vence hoje", e a de hoje como vencida. Ver `dia.ts`.
  const hoje = diaEmSP(agora)
  const esquecidoDesde = new Date(agora.getTime() - CAIXA_ESQUECIDO_HORAS * HORA)
  const c: Contagens = {}

  // Uma transação, uma consulta por assunto, uma DEPOIS da outra: dentro do
  // comoOrg é uma conexão só, e o Postgres executaria em fila de qualquer
  // jeito (ver a nota do `pg` sobre query em paralelo na mesma conexão).
  await comoOrg(sessao.orgId, async (db) => {
    if (doEstoque.length > 0) {
      // A mesma régua da tela de Estoque: saldo somado das lojas olhadas,
      // mínimo = o maior entre elas. Acabou é saldo zero ou menos, com ou
      // sem mínimo cadastrado — produto zerado é zerado. Sem isso, o número
      // daqui e o filtro "acabaram" de lá discordariam, e o "Ver" levaria a
      // uma lista de tamanho diferente do prometido.
      //
      // Linha ZERADA de produto que a loja não vende não entra: a sorveteria
      // que mandou de volta as camisetas do engano ficava com "12 produtos
      // acabaram" para sempre, avisando falta do que ela nem vende. A mesma
      // régua vale na tela de Estoque (`contaComoFalta`). Depósito conta
      // sempre: ele não vende, mas é de onde as lojas repõem.
      const [e] = await db.$queryRaw<{ acabaram: number; minimo: number }[]>`
        select count(*) filter (where s.saldo <= 0)::int as acabaram,
               count(*) filter (where s.saldo > 0 and s.minimo > 0 and s.saldo <= s.minimo)::int as minimo
          from (select e.variacao_id,
                       sum(e.quantidade) as saldo,
                       max(coalesce(e.minimo, 0)) as minimo
                  from estoque e
                  join variacoes va on va.id = e.variacao_id
                  join produtos p on p.id = va.produto_id
                  join unidades u on u.id = e.unidade_id
                 where e.unidade_id = any(${doEstoque}) and va.ativa and p.ativo
                   and (e.quantidade > 0 or u.eh_deposito
                        or cardinality(p.vendido_em) = 0 or e.unidade_id = any(p.vendido_em))
                 group by e.variacao_id) s
      `
      c.acabaram = n(e?.acabaram)
      c.noMinimo = n(e?.minimo)
    }

    if (doDinheiro.length > 0) {
      // Conta sem unidade é da empresa inteira (contador, aluguel do
      // escritório) — entra em qualquer recorte, como na tela do Financeiro.
      const [f] = await db.$queryRaw<{ vencidas: number; valorVencido: string; hoje: number; valorHoje: string }[]>`
        select count(*) filter (where l.vencimento < ${hoje}::date)::int as vencidas,
               coalesce(sum(l.valor) filter (where l.vencimento < ${hoje}::date), 0) as "valorVencido",
               count(*) filter (where l.vencimento = ${hoje}::date)::int as hoje,
               coalesce(sum(l.valor) filter (where l.vencimento = ${hoje}::date), 0) as "valorHoje"
          from lancamentos l
         where l.tipo = 'DESPESA' and l.pago_em is null
           and l.vencimento <= ${hoje}::date
           and (l.unidade_id = any(${doDinheiro}) or l.unidade_id is null)
      `
      c.contasVencidas = { quantas: n(f?.vencidas), valor: n(f?.valorVencido) }
      c.contasHoje = { quantas: n(f?.hoje), valor: n(f?.valorHoje) }
    }

    if (doFiado.length > 0) {
      // Só o que ainda resta: parcela paga pela metade é meia dívida.
      const [p] = await db.$queryRaw<{ quantas: number; valor: string; clientes: number }[]>`
        select count(*)::int as quantas,
               coalesce(sum(p.valor - p.pago), 0) as valor,
               count(distinct p.cliente_id)::int as clientes
          from parcelas p
         where p.unidade_id = any(${doFiado}) and p.quitada_em is null
           and p.vencimento < ${hoje}::date and p.valor > p.pago
      `
      c.parcelasVencidas = { quantas: n(p?.quantas), valor: n(p?.valor), clientes: n(p?.clientes) }
    }

    if (verTarefas) {
      // As minhas valem em qualquer quadro: tarefa atribuída a mim é minha
      // mesmo que o quadro seja de outra loja.
      const [m] = await db.$queryRaw<{ n: number }[]>`
        select count(*)::int as n
          from tarefas t join quadros q on q.id = t.quadro_id
         where t.responsavel_id = ${sessao.usuarioId} and t.situacao <> 'FEITO'
           and t.prazo < ${hoje}::date and not q.arquivado
      `
      c.tarefasMinhas = n(m?.n)
    }

    if (gerirTarefas) {
      // As da equipe só para quem cobra a equipe. Tira as minhas, que já
      // estão na linha de cima — contar duas vezes faria a lista mentir.
      const [t] = await db.$queryRaw<{ n: number }[]>`
        select count(*)::int as n
          from tarefas t join quadros q on q.id = t.quadro_id
         where (q.unidade_id = any(${unidadeIds}) or q.unidade_id is null) and not q.arquivado
           and t.situacao <> 'FEITO' and t.prazo < ${hoje}::date
           and (t.responsavel_id is null or t.responsavel_id <> ${sessao.usuarioId})
      `
      c.tarefasEquipe = n(t?.n)
    }

    if (doCaixa.length > 0) {
      const [k] = await db.$queryRaw<{ quantos: number; desde: Date | null }[]>`
        select count(*)::int as quantos, min(k.aberto_em) as desde
          from caixas k
         where k.unidade_id = any(${doCaixa}) and k.aberto and k.aberto_em < ${esquecidoDesde}
      `
      c.caixasEsquecidos = {
        quantos: n(k?.quantos),
        horas: k?.desde ? Math.floor((agora.getTime() - new Date(k.desde).getTime()) / HORA) : 0,
      }
    }

    if (verPropostas) {
      c.propostas = await db.propostaAgente.count({
        where: { situacao: 'AGUARDANDO', expiraEm: { gt: agora } },
      })
    }
  })

  return c
}
