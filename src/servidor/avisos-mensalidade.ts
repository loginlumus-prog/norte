// O aviso da mensalidade ao RESPONSÁVEL, no WhatsApp.
//
// ── o que ele é, e o que ele NÃO é ───────────────────────────
// O mesmo desenho do lembrete do horário (lembretes.ts): um texto FIXO,
// escrito aqui e igual para toda escola, sem IA e sem conversa. A resposta
// ("já paguei", "posso pagar sexta?") cai no WhatsApp da escola como qualquer
// mensagem — e quem responde é uma pessoa da equipe, nunca o assistente.
// "PARAR" entra pela porta de sempre (campanhas/entrada.ts), põe o número na
// lista de quem não recebe, e o aviso seguinte já não sai.
//
// Diz o valor e o vencimento, de propósito: é aviso de cobrança, e cobrança
// sem valor obriga o responsável a ligar para perguntar. Não diz a turma nem
// nada da vida escolar — só o primeiro nome do aluno, porque quem tem dois
// filhos na escola precisa saber de qual é.
//
// ── quem recebe ──────────────────────────────────────────────
// SÓ o responsável (a ficha `Responsavel` do aluno), NUNCA o aluno: aluno é,
// quase sempre, criança. E só com o aceite DELE — anotado na ficha do aluno,
// com data, caminho e quem anotou —, fora da lista de quem pediu para parar.
// Irmãos: se o mesmo número é responsável por dois alunos, os dois registros
// precisam ter aceitado; um "não" em qualquer um vale para o número.
//
// ── quando ───────────────────────────────────────────────────
// Desligado até a escola decidir (`Org.avisoMensalidadeAtivo`). Ligado: um
// aviso N dias antes do vencimento e, se a escola quiser, um de atraso N dias
// depois (`avisoAtrasoDias`, zero = não). Cada um UMA vez por mensalidade,
// reivindicado antes de sair — a batida repetida não avisa duas vezes, e o
// que falhou não tenta de novo (aviso repetido irrita mais que aviso que
// faltou). Só das 8h às 20h de São Paulo.
//
// O aviso de atraso tem janela de uma semana: a escola que liga o aviso hoje
// não dispara, de uma vez, cobrança de tudo que venceu no semestre.
//
// ── o WhatsApp oficial ───────────────────────────────────────
// Fora da janela de 24 horas a Meta só entrega modelo aprovado, e o aviso de
// mensalidade ainda não tem o seu (é categoria "utilidade" na Meta). Até ter,
// no oficial ele só sai se o responsável escreveu nas últimas 24 horas; fora
// disso fica "não saiu" na mensalidade — e não tenta de novo.

import type { Plano, Situacao } from '@prisma/client'
import { comoOrg } from './banco'
import { planoLibera } from './planos'
import { moduloLigado } from './modulos'
import { mostrar } from './dinheiro'
import { colunaDoDia, diaDaColuna, diaEmSP, diasEntre, mostrarDiaDaColuna, somarDias } from './dia'
import { estaNaLista } from './ofertas'
import { chaveTelefone, paraEnvio } from './assistente/telefone'
import { enviarOuModelo, type Canal } from './assistente/canal'
import { contaDaMensalidade, mesPorExtenso } from './mensalidades'

// ─────────────────────────────────────────────────────────────
// PURO
// ─────────────────────────────────────────────────────────────

const ABRE_H = 8
const FECHA_H = 20
/** O aviso de atraso sai até uma semana depois do dia marcado; depois, não. */
const JANELA_ATRASO_DIAS = 7

const primeiro = (nome: string | null | undefined) => {
  const p = (nome ?? '').trim().split(/\s+/)[0] ?? ''
  return p.length > 0 && p.length <= 30 ? p : ''
}

export type TipoAviso = 'antes' | 'atraso'

/** O texto, igual para toda escola. */
export function textoDoAviso(
  tipo: TipoAviso,
  p: { responsavel: string | null; aluno: string; escola: string; mes: string; vencimento: Date; valorCent: number },
): string {
  const oi = primeiro(p.responsavel) ? `Olá, ${primeiro(p.responsavel)}!` : 'Olá!'
  const aluno = primeiro(p.aluno) || 'do aluno'
  const de = primeiro(p.aluno) ? `de ${aluno}` : aluno
  const mes = mesPorExtenso(p.mes)
  const dia = mostrarDiaDaColuna(p.vencimento)
  const valor = mostrar(p.valorCent)
  const parar = 'Para não receber mais estes avisos, responda PARAR.'
  return tipo === 'antes'
    ? `${oi} A mensalidade de ${mes} ${de} na ${p.escola} vence em ${dia}: ${valor}. Se já pagou, desconsidere.\n${parar}`
    : `${oi} A mensalidade de ${mes} ${de} na ${p.escola}, de ${valor}, venceu em ${dia} e ainda não consta como paga. Se já pagou, desconsidere; para combinar, responda esta mensagem.\n${parar}`
}

/**
 * Esta mensalidade pede aviso AGORA? E qual.
 *
 *   • em aberto (nem paga, nem dispensada, e ainda resta);
 *   • das 8h às 20h de São Paulo;
 *   • 'antes': de `diasAntes` dias antes do vencimento até o próprio dia;
 *   • 'atraso': `diasDepois` dias depois do vencimento, por uma semana.
 */
export function pedeAviso(
  m: { vencimento: Date; restaC: number; quitadaEm: Date | null; canceladaEm: Date | null; avisoEm: Date | null; avisoAtrasoEm: Date | null },
  diasAntes: number,
  diasDepois: number,
  agora: Date,
): TipoAviso | null {
  if (m.quitadaEm || m.canceladaEm || m.restaC <= 0) return null
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora))
  if (h < ABRE_H || h >= FECHA_H) return null
  const faltam = diasEntre(diaEmSP(agora), diaDaColuna(m.vencimento))
  if (!m.avisoEm && faltam >= 0 && faltam <= diasAntes) return 'antes'
  if (diasDepois > 0 && !m.avisoAtrasoEm && -faltam >= diasDepois && -faltam <= diasDepois + JANELA_ATRASO_DIAS) return 'atraso'
  return null
}

export type OrgDoAviso = { plano: Plano; situacao: Situacao; modulos: string[]; avisoMensalidadeAtivo: boolean }

/** A escola pode avisar? A chave dela, o plano, os módulos e a situação. */
export function avisoApto(o: OrgDoAviso): boolean {
  if (!o.avisoMensalidadeAtivo) return false
  if (o.situacao === 'SUSPENSA' || o.situacao === 'CANCELADA') return false
  return planoLibera(o.plano, 'escola') && planoLibera(o.plano, 'agente') && moduloLigado(o, 'escola') && moduloLigado(o, 'agente')
}

/**
 * O aceite do NÚMERO: todos os registros de responsável com esta chave
 * precisam ter dito sim, e nenhum não. Nenhum registro = ninguém aceitou.
 */
export function numeroAceitou(aceites: ('SIM' | 'NAO' | 'NAO_PERGUNTADO')[]): boolean {
  return aceites.length > 0 && aceites.every((a) => a === 'SIM')
}

// ─────────────────────────────────────────────────────────────
// O RELÓGIO
// ─────────────────────────────────────────────────────────────

export type BatidaAvisos = { empresas: number; enviados: number; semAceite: number; falhas: number }

type Desfecho = 'enviado' | 'sem_aceite' | 'sem_telefone' | 'nao_saiu' | 'ja_foi'

export async function tickAvisosMensalidadeCom(
  agora: Date,
  deps: {
    empresas: () => Promise<{ id: string; slug: string }[]>
    canalDe: (org: { id: string; slug: string }) => Promise<Canal | null>
  },
): Promise<BatidaAvisos> {
  const b: BatidaAvisos = { empresas: 0, enviados: 0, semAceite: 0, falhas: 0 }
  for (const org of await deps.empresas()) {
    try {
      const o = await comoOrg(org.id, (db) =>
        db.org.findUnique({
          where: { id: org.id },
          select: { nome: true, plano: true, situacao: true, modulos: true, avisoMensalidadeAtivo: true, avisoMensalidadeDias: true, avisoAtrasoDias: true },
        }),
      )
      if (!o || !avisoApto(o)) continue
      const antes = Math.min(Math.max(o.avisoMensalidadeDias, 1), 10)
      const depois = Math.min(Math.max(o.avisoAtrasoDias, 0), 30)
      const hoje = diaEmSP(agora)
      const candidatos = await comoOrg(org.id, (db) =>
        db.mensalidade.findMany({
          where: {
            quitadaEm: null,
            canceladaEm: null,
            OR: [{ avisoEm: null }, ...(depois > 0 ? [{ avisoAtrasoEm: null }] : [])],
            // Do que vence daqui a `antes` dias até o que venceu há `depois` + uma semana.
            vencimento: {
              gte: colunaDoDia(somarDias(hoje, -(depois + JANELA_ATRASO_DIAS))),
              lte: colunaDoDia(somarDias(hoje, antes)),
            },
          },
          orderBy: { vencimento: 'asc' },
          take: 300,
          select: {
            id: true, mes: true, vencimento: true, valor: true, desconto: true, pago: true, abono: true,
            quitadaEm: true, canceladaEm: true, avisoEm: true, avisoAtrasoEm: true,
            aluno: { select: { nome: true, responsavel: { select: { nome: true, telefone: true } } } },
          },
        }),
      )
      const devidos = candidatos
        .map((m) => ({ m, tipo: pedeAviso({ ...m, restaC: contaDaMensalidade(m).restaC }, antes, depois, agora) }))
        .filter((x): x is { m: (typeof candidatos)[number]; tipo: TipoAviso } => x.tipo !== null)
      if (devidos.length === 0) continue
      const canal = await deps.canalDe(org)
      if (!canal) continue
      b.empresas++
      for (const { m, tipo } of devidos) {
        try {
          const r = await avisarUm(org.id, o.nome, m, tipo, canal, agora)
          if (r === 'enviado') b.enviados++
          else if (r === 'sem_aceite' || r === 'sem_telefone') b.semAceite++
          else if (r === 'nao_saiu') b.falhas++
        } catch (e) {
          b.falhas++
          console.error(`[avisos] mensalidade ${m.id} falhou:`, e instanceof Error ? e.message : e)
        }
      }
    } catch (e) {
      b.falhas++
      console.error(`[avisos] empresa ${org.id} falhou:`, e instanceof Error ? e.message : e)
    }
  }
  return b
}

/**
 * Uma mensalidade, um aviso: reivindica, confere o aceite, manda, anota.
 * Exportada para o teste provar o "nunca duas vezes" e o "nunca o aluno".
 */
export async function avisarUm(
  orgId: string,
  escola: string,
  m: {
    id: string
    mes: string
    vencimento: Date
    valor: unknown
    desconto: unknown
    pago: unknown
    abono: unknown
    aluno: { nome: string; responsavel: { nome: string; telefone: string | null } | null }
  },
  tipo: TipoAviso,
  canal: Canal,
  agora: Date,
): Promise<Desfecho> {
  const campo = tipo === 'antes' ? { em: 'avisoEm', desfecho: 'aviso' } : { em: 'avisoAtrasoEm', desfecho: 'avisoAtraso' }
  // 1. a reivindicação: só uma batida passa daqui por mensalidade e tipo.
  const tomou = await comoOrg(orgId, (db) =>
    db.mensalidade.updateMany({
      where: { id: m.id, [campo.em]: null, quitadaEm: null, canceladaEm: null },
      data: { [campo.em]: agora, [campo.desfecho]: 'enviando' },
    }),
  )
  if (tomou.count === 0) return 'ja_foi'
  const anotar = (d: Exclude<Desfecho, 'ja_foi'>) =>
    comoOrg(orgId, (db) => db.mensalidade.update({ where: { id: m.id }, data: { [campo.desfecho]: d } }))

  // 2. para quem: o RESPONSÁVEL. Sem responsável, não sai — nunca o aluno.
  const r = m.aluno.responsavel
  const chave = chaveTelefone(r?.telefone ?? null)
  const numero = r?.telefone ? paraEnvio(r.telefone) : null
  if (!r || !chave || !numero) {
    await anotar('sem_telefone')
    return 'sem_telefone'
  }

  // 3. o aceite do número: fora da lista, e todos os registros dele disseram sim.
  const aceitou = await comoOrg(orgId, async (db) => {
    const doNumero = await db.responsavel.findMany({
      where: { telefone: { endsWith: chave.slice(-8) } },
      select: { telefone: true, avisosWhatsapp: true },
    })
    return numeroAceitou(doNumero.filter((x) => chaveTelefone(x.telefone) === chave).map((x) => x.avisosWhatsapp))
  })
  if (!aceitou || (await estaNaLista(orgId, chave))) {
    await anotar('sem_aceite')
    return 'sem_aceite'
  }

  // 4. manda.
  const texto = textoDoAviso(tipo, {
    responsavel: r.nome,
    aluno: m.aluno.nome,
    escola,
    mes: m.mes,
    vencimento: m.vencimento,
    valorCent: contaDaMensalidade(m).restaC,
  })
  const e = await enviarOuModelo(canal, numero, texto, null)
  await anotar(e.ok ? 'enviado' : 'nao_saiu')
  if (!e.ok) console.warn(`[avisos] ${orgId}: mensalidade ${m.id} não saiu (${e.codigo ?? 'falha'})`)
  return e.ok ? 'enviado' : 'nao_saiu'
}

/** O relógio de verdade: as empresas com o assistente, e o canal de cada uma. */
export async function tickAvisosMensalidade(agora: Date = new Date()): Promise<BatidaAvisos> {
  const { empresasComAgente } = await import('./assistente/portaria')
  const { canalPara, temZapi } = await import('./assistente/canal')
  const semWhatsappNoServidor = !temZapi()
  return tickAvisosMensalidadeCom(agora, {
    empresas: empresasComAgente,
    canalDe: async (org) => {
      const canal = await canalPara(org)
      return canal.real || semWhatsappNoServidor ? canal : null
    },
  })
}

/** Rótulo do desfecho, para a tela. */
export const ROTULO_AVISO: Record<string, string> = {
  enviando: 'aviso saindo',
  enviado: 'aviso enviado ao responsável',
  sem_aceite: 'sem aviso (responsável não aceitou)',
  sem_telefone: 'sem aviso (sem telefone do responsável)',
  nao_saiu: 'aviso não saiu',
}
