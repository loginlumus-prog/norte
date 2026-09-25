// O que o assistente faz sem ninguém pedir.
//
// Um cron externo (Render) chama POST /api/rotinas de hora em hora, sempre no
// minuto zero. Esta função olha o relógio DE SÃO PAULO — não o do servidor,
// que pode estar em UTC — e decide o que cabe naquela hora:
//
//   08h  relatório de ONTEM, para o dono começar o dia sabendo
//   09h  vai faltar: o que está acabando pelo ritmo de venda, e a proposta
//        de reposição para ele confirmar
//   10h  (segunda) cliente sumido: quem comprava quase todo mês e parou
//   20h  relatório de HOJE, com o dia fechando
//
// ── por que texto pronto, e não o modelo escrevendo ──────────
// Relatório e aviso são número: saem do banco direto para a mensagem, sem
// IA no meio. Não custa crédito, não inventa, e é igual todo dia — que é o
// que se quer de relatório. A IA entra quando a pessoa RESPONDE ("e ontem?",
// "quem são esses clientes?"), pelo laço da conversa, com as ferramentas.
//
// ── por que não roda duas vezes ──────────────────────────────
// Cron repete: reinício de máquina, nova tentativa depois de timeout, duas
// instâncias. Cada rotina "reivindica" a hora no GatilhoAgente da empresa
// (`ultimoDisparo`) com um UPDATE condicional — quem chegar em segundo não
// acha linha para atualizar e sai sem mandar nada.
//
// ── e cada empresa, a sua ────────────────────────────────────
// A lista de empresas vem da portaria (id e slug, nada mais). Todo o resto é
// lido empresa por empresa, dentro do `comoOrg` dela, com a sessão do DONO
// dela. Não existe consulta aqui que enxergue duas empresas ao mesmo tempo.

import { timingSafeEqual } from 'node:crypto'
import type { TipoGatilho } from '@prisma/client'
import { comoOrg } from '../banco'
import { propor, AcimaDoTeto, PoderNegado } from '../agente'
import { resumoDoPainel, type Resumo } from '../painel'
import { janela } from '../periodo'
import { previsaoDeRuptura, type LinhaRuptura } from '../ruptura'
import { aVencer } from '../financeiro'
import { mostrar } from '../dinheiro'
import { pode, type Sessao } from '../permissao'
import type { Canal } from './canal'
import {
  abrirConversa,
  carregarContexto,
  donosComTelefone,
  empresaApta,
  enviarEGravar,
  unidadesVisiveis,
  type Destinatario,
} from './contexto'
import { empresasComAgente } from './portaria'
import { mostrarTelefone } from '../cliente'

export type Rotina = 'relatorio_manha' | 'ruptura' | 'cliente_sumido' | 'relatorio_noite'

const GATILHO: Record<Rotina, TipoGatilho> = {
  relatorio_manha: 'RELATORIO',
  relatorio_noite: 'RELATORIO',
  ruptura: 'RUPTURA',
  cliente_sumido: 'CLIENTE_SUMIDO',
}

// ─────────────────────────────────────────────────────────────
// O RELÓGIO (puro)
// ─────────────────────────────────────────────────────────────

/** Hora e dia da semana em São Paulo, independente do TZ do servidor. */
export function relogioSP(agora: Date): { hora: number; diaSemana: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(agora)
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? 0)
  const dia = partes.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const diaSemana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dia)
  return { hora, diaSemana }
}

/** O que roda nesta hora. Puro: é aqui que "só no horário certo" é provado. */
export function rotinasDaHora(agora: Date): Rotina[] {
  const { hora, diaSemana } = relogioSP(agora)
  const r: Rotina[] = []
  if (hora === 8) r.push('relatorio_manha')
  if (hora === 9) r.push('ruptura')
  if (hora === 10 && diaSemana === 1) r.push('cliente_sumido')
  if (hora === 20) r.push('relatorio_noite')
  return r
}

/** Início da hora cheia. A reivindicação vale para a hora, não para o minuto. */
const inicioDaHora = (agora: Date) => new Date(Math.floor(agora.getTime() / 3600_000) * 3600_000)

/**
 * `Authorization: Bearer <segredo>` confere? Tempo constante, e segredo
 * curto não vale — um segredo de oito letras se adivinha.
 */
export function autorizado(cabecalho: string | null, segredo: string | undefined): boolean {
  const s = (segredo ?? '').trim()
  if (s.length < 32 || !cabecalho) return false
  const esperado = Buffer.from(`Bearer ${s}`)
  const veio = Buffer.from(cabecalho.trim())
  return esperado.length === veio.length && timingSafeEqual(esperado, veio)
}

// ─────────────────────────────────────────────────────────────
// O TEXTO (puro)
// ─────────────────────────────────────────────────────────────

const brl = (v: number) => mostrar(Math.round(v * 100))

export function textoDoRelatorio(p: {
  nome: string
  quando: 'manha' | 'noite'
  resumo: Pick<Resumo, 'atual' | 'anterior' | 'maisVendidos' | 'porUnidade'>
  contas?: { vencidas: number; totalVencido: number; hoje: number }
  vaiFaltar?: number
  /** Só convida a perguntar se ele tem a ferramenta para responder. */
  respondeResumo?: boolean
}): string {
  const r = p.resumo
  const primeiro = p.nome.split(' ')[0]
  const linhas: string[] = []
  linhas.push(
    p.quando === 'manha'
      ? `Bom dia, ${primeiro}. Como foi *ontem*:`
      : `Boa noite, ${primeiro}. Como foi *hoje* até agora:`,
  )
  if (r.atual.vendas === 0) {
    linhas.push('Nenhuma venda registrada.')
  } else {
    let comparacao = ''
    if (r.anterior.total > 0) {
      const pct = Math.round(((r.atual.total - r.anterior.total) / r.anterior.total) * 100)
      comparacao = ` (${pct >= 0 ? '+' : ''}${pct}% sobre ${p.quando === 'manha' ? 'anteontem' : 'ontem'})`
    }
    linhas.push(`${brl(r.atual.total)} em ${r.atual.vendas} venda${r.atual.vendas === 1 ? '' : 's'}${comparacao}.`)
    linhas.push(`Ticket médio: ${brl(r.atual.ticket)}.`)
    if (r.porUnidade.length > 1) {
      linhas.push(r.porUnidade.map((u) => `${u.nome}: ${brl(u.total)}`).join(' · '))
    }
    const top = r.maisVendidos.slice(0, 3)
    if (top.length > 0) linhas.push(`Mais vendidos: ${top.map((m) => `${m.descricao} (${m.quantidade})`).join(', ')}.`)
  }
  if (p.contas && (p.contas.vencidas > 0 || p.contas.hoje > 0)) {
    const partes = []
    if (p.contas.vencidas > 0) partes.push(`${p.contas.vencidas} vencida(s), ${brl(p.contas.totalVencido)}`)
    if (p.contas.hoje > 0) partes.push(`${p.contas.hoje} vencendo hoje`)
    linhas.push(`Contas: ${partes.join('; ')}.`)
  }
  if (p.vaiFaltar && p.vaiFaltar > 0) {
    linhas.push(`${p.vaiFaltar} peça(s) vão faltar pelo ritmo de venda.`)
  }
  if (p.respondeResumo) linhas.push('Quer detalhe de alguma coisa? É só perguntar aqui.')
  return linhas.join('\n')
}

// ─────────────────────────────────────────────────────────────
// RODAR
// ─────────────────────────────────────────────────────────────

export type DependenciasRotina = {
  canal: Canal
  /** Quem visitar. Padrão: a portaria. Os testes passam a lista pronta. */
  empresas?: () => Promise<{ id: string }[]>
}

export type Execucao = {
  hora: number
  rotinas: Rotina[]
  empresas: number
  enviadas: number
  propostas: number
  falhas: number
}

export async function rodarRotinas(agora: Date, deps: DependenciasRotina): Promise<Execucao> {
  const rotinas = rotinasDaHora(agora)
  const saida: Execucao = { hora: relogioSP(agora).hora, rotinas, empresas: 0, enviadas: 0, propostas: 0, falhas: 0 }
  if (rotinas.length === 0) return saida

  const empresas = await (deps.empresas ?? empresasComAgente)()
  for (const e of empresas) {
    // Uma empresa que quebra não leva as outras junto: cada uma no seu try,
    // e o erro vai para o log com o id — nunca com dado dela.
    try {
      const r = await rodarNaEmpresa(e.id, rotinas, agora, deps.canal)
      if (r.rodou) saida.empresas++
      saida.enviadas += r.enviadas
      saida.propostas += r.propostas
    } catch (erro) {
      saida.falhas++
      console.error(`[rotinas] empresa ${e.id} falhou:`, erro instanceof Error ? erro.message : erro)
    }
  }
  return saida
}

type NaEmpresa = { rodou: boolean; enviadas: number; propostas: number }

export async function rodarNaEmpresa(
  orgId: string,
  rotinas: Rotina[],
  agora: Date,
  canal: Canal,
): Promise<NaEmpresa> {
  const saida: NaEmpresa = { rodou: false, enviadas: 0, propostas: 0 }
  const ctx = await carregarContexto(orgId)
  if (!ctx || !empresaApta(ctx)) return saida
  const agente = ctx.agente

  const donos = await donosComTelefone(orgId)
  if (donos.length === 0) return saida

  for (const rotina of rotinas) {
    if (!(await reivindicar(orgId, agente.id, GATILHO[rotina], agora))) continue
    saida.rodou = true

    const mensagens: { para: Destinatario; texto: string }[] = []
    if (rotina === 'relatorio_manha' || rotina === 'relatorio_noite') {
      for (const d of donos) {
        const texto = await relatorio(d, rotina === 'relatorio_manha' ? 'manha' : 'noite', agora, agente.poderes.includes('ver.resumo'))
        if (texto) mensagens.push({ para: d, texto })
      }
    } else if (rotina === 'ruptura') {
      const r = await ruptura(orgId, ctx.org, agente.poderes, donos[0]!.sessao)
      saida.propostas += r.propostas
      if (r.texto) for (const d of donos) mensagens.push({ para: d, texto: r.texto })
    } else if (rotina === 'cliente_sumido') {
      const texto = await clienteSumido(orgId, donos[0]!.sessao, await diasDoGatilho(orgId, agente.id))
      if (texto) for (const d of donos) mensagens.push({ para: d, texto })
    }

    for (const m of mensagens) {
      const conversa = await abrirConversa(orgId, agente.id, m.para.telefone, { nome: m.para.nome, daEquipe: true })
      const s = await enviarEGravar(canal, agente, conversa, m.texto)
      if (s.enviada) saida.enviadas++
    }
  }
  return saida
}

/**
 * Esta rotina, nesta empresa, nesta hora: é minha?
 *
 * Gatilho desligado pela loja: não. Já disparado nesta hora: não. Os dois
 * casos são o mesmo "não", e nenhum levanta erro — erro dentro da transação
 * a inutilizaria.
 *
 * Empresa que nunca mexeu nos gatilhos não tem linha nenhuma, e isso quer
 * dizer LIGADO: é o que o plano vende ("relatório sozinho"), e é o padrão da
 * coluna `ativo`. A linha nasce aqui, no primeiro disparo.
 */
async function reivindicar(orgId: string, agenteId: string, tipo: TipoGatilho, agora: Date): Promise<boolean> {
  const hora = inicioDaHora(agora)
  try {
    return await comoOrg(orgId, async (db) => {
      const g = await db.gatilhoAgente.findUnique({ where: { agenteId_tipo: { agenteId, tipo } } })
      if (g && !g.ativo) return false
      if (!g) {
        await db.gatilhoAgente.create({ data: { orgId, agenteId, tipo, ultimoDisparo: agora } })
        return true
      }
      const r = await db.gatilhoAgente.updateMany({
        where: { id: g.id, OR: [{ ultimoDisparo: null }, { ultimoDisparo: { lt: hora } }] },
        data: { ultimoDisparo: agora },
      })
      return r.count === 1
    })
  } catch {
    // Duas execuções criando a mesma linha ao mesmo tempo: o índice único
    // barra a segunda, e a segunda é exatamente quem não deve rodar.
    return false
  }
}

async function diasDoGatilho(orgId: string, agenteId: string): Promise<number> {
  const g = await comoOrg(orgId, (db) =>
    db.gatilhoAgente.findUnique({ where: { agenteId_tipo: { agenteId, tipo: 'CLIENTE_SUMIDO' } }, select: { dias: true } }),
  )
  return g?.dias && g.dias >= 7 ? g.dias : DIAS_SUMIDO
}

// ── relatório ────────────────────────────────────────────────

async function relatorio(
  d: Destinatario,
  quando: 'manha' | 'noite',
  agora: Date,
  respondeResumo: boolean,
): Promise<string | null> {
  if (!pode(d.sessao, 'relatorio.ver')) return null
  const unidades = await unidadesVisiveis(d.sessao, 'relatorio.ver')
  const base = quando === 'manha' ? new Date(agora.getTime() - 864e5) : agora
  const resumo = await resumoDoPainel(d.sessao, unidades, janela('hoje', base))

  let contas: { vencidas: number; totalVencido: number; hoje: number } | undefined
  if (pode(d.sessao, 'financeiro.ver')) {
    const a = await aVencer(d.sessao, await unidadesVisiveis(d.sessao, 'financeiro.ver'), 0)
    contas = { vencidas: a.vencidas.length, totalVencido: a.totalVencido, hoje: a.hoje.length }
  }
  let vaiFaltar: number | undefined
  if (quando === 'noite' && pode(d.sessao, 'estoque.ver')) {
    const linhas = await previsaoDeRuptura(d.sessao, await unidadesVisiveis(d.sessao, 'estoque.ver'))
    vaiFaltar = linhas.filter((l) => l.previsao.situacao === 'pedir_agora').length
  }
  return textoDoRelatorio({ nome: d.nome, quando, resumo, contas, vaiFaltar, respondeResumo })
}

// ── vai faltar, e a reposição ────────────────────────────────

/** Quantos dias de venda a reposição cobre, além do prazo do fornecedor. */
const COBERTURA_DIAS = 30
/** Propostas de reposição por dia. Mais que isso ninguém confirma — vira fila parada. */
const MAXIMO_PROPOSTAS = 5

/** Quanto pedir: o que o ritmo consome no prazo + um mês, menos o que tem. Puro. */
export function quantoRepor(l: Pick<LinhaRuptura, 'saldo' | 'previsao'>): number {
  const precisa = Math.ceil(l.previsao.ritmoDia * (l.previsao.prazo + COBERTURA_DIAS))
  return Math.max(1, precisa - Math.max(0, Math.floor(l.saldo)))
}

async function ruptura(
  orgId: string,
  empresa: { modulos: string[] },
  poderes: string[],
  sessao: Sessao,
): Promise<{ texto: string | null; propostas: number }> {
  if (!pode(sessao, 'estoque.ver')) return { texto: null, propostas: 0 }
  const linhas = await previsaoDeRuptura(sessao, await unidadesVisiveis(sessao, 'estoque.ver'))
  // "Já faltou" só entra se vendia: peça sem giro que zerou não é urgência.
  const urgentes = linhas.filter(
    (l) => l.previsao.situacao === 'pedir_agora' || (l.previsao.situacao === 'ja_faltou' && l.vendidos30 > 0),
  )
  if (urgentes.length === 0) return { texto: null, propostas: 0 }

  const peca = (l: LinhaRuptura) => [l.nome, l.opcoes].filter(Boolean).join(' — ')
  const linhasTexto = urgentes.slice(0, 8).map((l) =>
    l.previsao.situacao === 'ja_faltou'
      ? `• ${peca(l)}: *acabou* (vendia ${l.vendidos30} por mês)`
      : `• ${peca(l)}: ${l.saldo} na prateleira, dura ~${Math.floor(l.previsao.duraDias ?? 0)} dia(s), entrega leva ${l.previsao.prazo}`,
  )

  // A reposição só é proposta se a loja deu esse poder a ele. O teto é
  // conferido dentro de `propor`: proposta acima do teto nem chega a existir.
  const feitas: string[] = []
  const acimaDoTeto: string[] = []
  if (poderes.includes('pedir.compra') && pode(sessao, 'financeiro.lancar')) {
    const r = await proporReposicoes(orgId, empresa, urgentes)
    feitas.push(...r.feitas)
    acimaDoTeto.push(...r.acimaDoTeto)
  }

  const partes = [`*Vai faltar* (${urgentes.length}):`, ...linhasTexto]
  if (urgentes.length > 8) partes.push(`…e mais ${urgentes.length - 8} na tela Estoque.`)
  if (feitas.length > 0) {
    partes.push('', `Deixei ${feitas.length} proposta(s) de reposição para você confirmar na tela do assistente:`, ...feitas.map((f) => `• ${f}`))
  }
  if (acimaDoTeto.length > 0) {
    partes.push('', `Não propus (passa do teto que você deu): ${acimaDoTeto.join(', ')}.`)
  }
  return { texto: partes.join('\n'), propostas: feitas.length }
}

async function proporReposicoes(
  orgId: string,
  empresa: { modulos: string[] },
  urgentes: LinhaRuptura[],
): Promise<{ feitas: string[]; acimaDoTeto: string[] }> {
  const agora = new Date()
  const { custos, abertas, categoria } = await comoOrg(orgId, async (db) => {
    const custos = await db.variacao.findMany({
      where: { id: { in: urgentes.map((u) => u.variacaoId) } },
      select: { id: true, produto: { select: { custo: true } } },
    })
    const abertas = await db.propostaAgente.findMany({
      where: { poder: 'pedir.compra', situacao: 'AGUARDANDO', expiraEm: { gt: agora } },
      select: { dados: true },
    })
    const categoria = await db.categoriaFinanceira.findFirst({
      where: { tipo: 'DESPESA', grupo: 'MERCADORIA' },
      orderBy: { ordem: 'asc' },
      select: { id: true },
    })
    return { custos, abertas, categoria }
  })
  if (!categoria) return { feitas: [], acimaDoTeto: [] }

  const custoDe = new Map(custos.map((c) => [c.id, c.produto.custo == null ? null : Number(c.produto.custo)]))
  // Proposta de ontem ainda esperando: não duplica. Uma fila com a mesma
  // peça três vezes ensina a pessoa a ignorar a fila.
  const jaProposta = new Set(
    abertas.map((a) => (a.dados as { variacaoId?: string } | null)?.variacaoId).filter(Boolean),
  )

  const feitas: string[] = []
  const acimaDoTeto: string[] = []
  const vencimento = new Date(agora.getTime() + 30 * 864e5)
  for (const l of urgentes) {
    if (feitas.length >= MAXIMO_PROPOSTAS) break
    if (jaProposta.has(l.variacaoId)) continue
    const custo = custoDe.get(l.variacaoId)
    if (!custo || custo <= 0) continue // sem custo não há valor honesto para propor

    const qtd = quantoRepor(l)
    const valor = Math.round(qtd * custo * 100) / 100
    const nome = [l.nome, l.opcoes].filter(Boolean).join(' — ')
    const descricao = `Reposição: ${qtd} × ${nome}${l.codigo ? ` (cód. ${l.codigo})` : ''}`
    const resumo = `${descricao} — ${brl(valor)} a custo, conta a pagar para ${vencimento.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`
    try {
      await propor(orgId, empresa, {
        poder: 'pedir.compra',
        resumo,
        valor,
        dados: {
          categoriaId: categoria.id,
          unidadeId: null,
          descricao,
          valor,
          vencimento: vencimento.toISOString(),
          fornecedor: '',
          variacaoId: l.variacaoId,
          quantidade: qtd,
        },
      })
      feitas.push(`${qtd} × ${nome} — ${brl(valor)}`)
    } catch (e) {
      if (e instanceof AcimaDoTeto) acimaDoTeto.push(nome)
      else if (!(e instanceof PoderNegado)) throw e
    }
  }
  return { feitas, acimaDoTeto }
}

// ── cliente sumido ───────────────────────────────────────────

/** Sem comprar há quantos dias já é sumido, se a loja não disser. */
export const DIAS_SUMIDO = 45

/**
 * Quem comprava quase todo mês e parou.
 *
 * "Quase todo mês" = comprou em pelo menos 3 meses diferentes nos últimos 8.
 * Cliente de uma compra só não "some" — ele nunca voltou, que é outra
 * conversa. E a lista vem ordenada pelo que a pessoa gastava: é a ordem em
 * que vale a pena ligar.
 */
async function clienteSumido(orgId: string, sessao: Sessao, dias: number): Promise<string | null> {
  if (!pode(sessao, 'cliente.ver') || !pode(sessao, 'venda.ver')) return null
  const corte = new Date(Date.now() - dias * 864e5)
  const inicio = new Date(Date.now() - 240 * 864e5)
  const linhas = await comoOrg(orgId, (db) =>
    db.$queryRaw<{ nome: string; telefone: string | null; ultima: Date; meses: number; total: string }[]>`
      select cl.nome, cl.telefone, c.ultima, c.meses, c.total
        from (select v.cliente_id,
                     count(distinct date_trunc('month', v.criada_em))::int as meses,
                     max(v.criada_em) as ultima,
                     sum(v.total) as total
                from vendas v
               where v.cliente_id is not null and v.situacao = 'CONCLUIDA'
                 and v.criada_em >= ${inicio}
               group by v.cliente_id) c
        join clientes cl on cl.id = c.cliente_id
       where cl.ativo and c.meses >= 3 and c.ultima < ${corte}
       order by c.total desc
       limit 10
    `,
  )
  if (linhas.length === 0) return null
  const data = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return [
    `*Clientes sumidos* — compravam quase todo mês e não voltam há mais de ${dias} dias:`,
    ...linhas.map(
      (l) =>
        `• ${l.nome}${l.telefone ? ` ${mostrarTelefone(l.telefone)}` : ''}: última compra ${data(l.ultima)}, ${brl(Number(l.total))} nos últimos meses`,
    ),
    'Uma mensagem sua costuma trazer de volta.',
  ].join('\n')
}
