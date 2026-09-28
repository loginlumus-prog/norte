// "Lembrete do horário": a mensagem que sai sozinha antes do horário marcado.
//
// ── o que ele é, e o que ele NÃO é ───────────────────────────
// Um texto FIXO, escrito aqui e igual para toda empresa: o nome da loja, o
// dia e a hora, e como parar de receber. Sem IA, sem conversa. A resposta do
// cliente ("não vou poder ir") cai no WhatsApp da loja como qualquer
// mensagem de cliente — e mensagem de cliente o assistente não responde (ver
// assistente/conversa.ts): quem responde é uma pessoa da equipe. "PARAR"
// entra pela porta de sempre (campanhas/entrada.ts) e põe o número na lista
// de quem não recebe; o lembrete seguinte já não sai.
//
// O texto não diz o serviço nem a profissional, de propósito: na clínica,
// "seu horário de psiquiatria" num aviso de celular é dado de saúde exposto
// na tela de bloqueio. Loja, dia e hora bastam para lembrar.
//
// ── quem recebe ──────────────────────────────────────────────
// Só quem ACEITOU receber mensagem da loja no WhatsApp e não está na lista de
// quem pediu para sair — a MESMA pergunta das campanhas (`podeReceberOfertas`
// em ofertas.ts). Sem ficha com aceite, não sai. E a chave é da loja:
// desligado por padrão (`Org.lembreteAtivo`), ligado em Configurações.
//
// ── uma vez, nunca duas ──────────────────────────────────────
// O relógio das campanhas bate de minuto em minuto (/api/campanhas/tick), e
// pode bater duas vezes no mesmo minuto (cron + conector). Cada horário é
// REIVINDICADO antes de sair: um UPDATE que só acha a linha se `lembreteEm`
// ainda estiver vazio. Quem chega em segundo não acha, e não manda. Se o
// envio falhar depois da reivindicação, o horário fica marcado como "não
// saiu" — e não tenta de novo: lembrete repetido irrita mais do que lembrete
// que faltou.
//
// ── o WhatsApp oficial ───────────────────────────────────────
// Fora da janela de 24 horas, a Meta só entrega modelo aprovado. O lembrete
// tem o dele (`norte_lembrete_horario`, em meta-regras.ts), criado na conta
// junto com os outros modelos do Norte quando a loja conecta. Conta conectada
// antes deste modelo existir, ou modelo ainda não aprovado: o lembrete não
// sai, e a agenda mostra "não saiu". A tela de Configurações diz isso.

import { comoOrg } from './banco'
import { planoLibera } from './planos'
import { moduloLigado } from './modulos'
import { diaCurtoSP, horaEmSP } from './encomenda'
import { podeReceberOfertas } from './ofertas'
import { chaveTelefone, paraEnvio } from './assistente/telefone'
import { enviarOuModelo, type Canal } from './assistente/canal'
import { modeloDoLembrete } from './assistente/meta-regras'
import type { Plano, Situacao, SituacaoAgendamento } from '@prisma/client'

// ─────────────────────────────────────────────────────────────
// PURO
// ─────────────────────────────────────────────────────────────

/** As horas que a tela oferece. */
export const HORAS_DE_LEMBRETE = [2, 3, 6, 12, 24, 48] as const

/** Horário marcado há menos que isto antes de acontecer não ganha lembrete. */
const ANTECEDENCIA_MINIMA_H = 3
/** Nada sai na última hora: aí o lembrete chega tarde demais para servir. */
const ULTIMA_HORA_H = 1
/** O relógio da loja: de 8h às 20h. Lembrete às 3h da manhã acorda o cliente. */
const ABRE_H = 8
const FECHA_H = 20

/** O texto, igual para toda empresa. */
export function textoDoLembrete(p: { nome: string | null; loja: string; inicio: Date }): string {
  const primeiro = (p.nome ?? '').trim().split(/\s+/)[0] ?? ''
  const oi = primeiro && primeiro.length <= 30 ? `Olá, ${primeiro}!` : 'Olá!'
  return (
    `${oi} Lembrete do seu horário na ${p.loja}: ${diaCurtoSP(p.inicio)} às ${horaEmSP(p.inicio)}.\n` +
    'Se precisar remarcar, responda esta mensagem. Para não receber mais lembretes, responda PARAR.'
  )
}

const horaEmSPNumero = (d: Date) => Number(horaEmSP(d).slice(0, 2))

/**
 * Este horário pede lembrete AGORA?
 *
 *   • de pé (marcado ou confirmado) e sem lembrete ainda;
 *   • dentro da janela: de `horas` antes até uma hora antes;
 *   • marcado com pelo menos três horas de antecedência (quem marcou para
 *     daqui a pouco acabou de falar com a loja);
 *   • e o relógio da loja entre 8h e 20h.
 */
export function pedeLembrete(
  a: { inicio: Date; criadoEm: Date; situacao: SituacaoAgendamento; lembreteEm: Date | null },
  horas: number,
  agora: Date,
): boolean {
  if (a.lembreteEm) return false
  if (a.situacao !== 'MARCADO' && a.situacao !== 'CONFIRMADO') return false
  const t = a.inicio.getTime()
  if (agora.getTime() < t - horas * 3_600_000) return false
  if (agora.getTime() >= t - ULTIMA_HORA_H * 3_600_000) return false
  if (a.criadoEm.getTime() > t - ANTECEDENCIA_MINIMA_H * 3_600_000) return false
  const h = horaEmSPNumero(agora)
  return h >= ABRE_H && h < FECHA_H
}

export type OrgDoLembrete = { plano: Plano; situacao: Situacao; modulos: string[]; lembreteAtivo: boolean }

/** A empresa pode mandar lembrete? Plano, módulos, situação e a chave dela. */
export function lembreteApto(o: OrgDoLembrete): boolean {
  if (!o.lembreteAtivo) return false
  if (o.situacao === 'SUSPENSA' || o.situacao === 'CANCELADA') return false
  return planoLibera(o.plano, 'agenda') && planoLibera(o.plano, 'agente') && moduloLigado(o, 'agenda') && moduloLigado(o, 'agente')
}

// ─────────────────────────────────────────────────────────────
// O RELÓGIO
// ─────────────────────────────────────────────────────────────

export type BatidaLembretes = { empresas: number; enviados: number; semAceite: number; falhas: number }

/**
 * Uma batida: cada empresa apta, os horários que pedem lembrete agora, um de
 * cada vez. Nada sai de dentro de uma transação — reivindicar, mandar e
 * anotar o desfecho são três passos curtos (mandar leva segundos, e a
 * transação aberta seguraria uma conexão do pool).
 */
export async function tickLembretesCom(
  agora: Date,
  deps: {
    empresas: () => Promise<{ id: string; slug: string }[]>
    canalDe: (org: { id: string; slug: string }) => Promise<Canal | null>
  },
): Promise<BatidaLembretes> {
  const b: BatidaLembretes = { empresas: 0, enviados: 0, semAceite: 0, falhas: 0 }
  for (const org of await deps.empresas()) {
    try {
      const o = await comoOrg(org.id, (db) =>
        db.org.findUnique({
          where: { id: org.id },
          select: { nome: true, plano: true, situacao: true, modulos: true, lembreteAtivo: true, lembreteHoras: true },
        }),
      )
      if (!o || !lembreteApto(o)) continue
      const horas = Math.min(Math.max(o.lembreteHoras, 1), 72)
      const candidatos = await comoOrg(org.id, (db) =>
        db.agendamento.findMany({
          where: {
            lembreteEm: null,
            situacao: { in: ['MARCADO', 'CONFIRMADO'] },
            inicio: { gt: new Date(agora.getTime() + ULTIMA_HORA_H * 3_600_000), lte: new Date(agora.getTime() + horas * 3_600_000) },
          },
          orderBy: { inicio: 'asc' },
          take: 200,
          select: { id: true, inicio: true, criadoEm: true, situacao: true, lembreteEm: true, telefone: true, clienteNome: true, unidade: { select: { nome: true } } },
        }),
      )
      const devidos = candidatos.filter((a) => pedeLembrete(a, horas, agora))
      if (devidos.length === 0) continue
      const canal = await deps.canalDe(org)
      if (!canal) continue
      b.empresas++
      for (const a of devidos) {
        try {
          const r = await lembrarUm(org.id, o.nome, a, canal, agora)
          if (r === 'enviado') b.enviados++
          else if (r === 'sem_aceite' || r === 'sem_telefone') b.semAceite++
          else if (r === 'nao_saiu') b.falhas++
        } catch (e) {
          b.falhas++
          console.error(`[lembretes] horário ${a.id} falhou:`, e instanceof Error ? e.message : e)
        }
      }
    } catch (e) {
      b.falhas++
      console.error(`[lembretes] empresa ${org.id} falhou:`, e instanceof Error ? e.message : e)
    }
  }
  return b
}

type Desfecho = 'enviado' | 'sem_aceite' | 'sem_telefone' | 'nao_saiu' | 'ja_foi'

/**
 * Um horário: reivindica, confere o aceite, manda, anota. Exportada para o
 * teste provar o "nunca duas vezes".
 */
export async function lembrarUm(
  orgId: string,
  loja: string,
  a: { id: string; inicio: Date; telefone: string | null; clienteNome: string; unidade?: { nome: string } | null },
  canal: Canal,
  agora: Date,
): Promise<Desfecho> {
  // 1. a reivindicação: só um relógio passa daqui por horário.
  const tomou = await comoOrg(orgId, (db) =>
    db.agendamento.updateMany({
      where: { id: a.id, lembreteEm: null, situacao: { in: ['MARCADO', 'CONFIRMADO'] } },
      data: { lembreteEm: agora, lembrete: 'enviando' },
    }),
  )
  if (tomou.count === 0) return 'ja_foi'

  const anotar = (lembrete: Exclude<Desfecho, 'ja_foi'>) =>
    comoOrg(orgId, (db) => db.agendamento.update({ where: { id: a.id }, data: { lembrete } }))

  // 2. o aceite: a mesma pergunta das campanhas — aceitou e não saiu da lista.
  const chave = chaveTelefone(a.telefone)
  const numero = a.telefone ? paraEnvio(a.telefone) : null
  if (!chave || !numero) {
    await anotar('sem_telefone')
    return 'sem_telefone'
  }
  if (!(await podeReceberOfertas(orgId, a.telefone!))) {
    await anotar('sem_aceite')
    return 'sem_aceite'
  }

  // 3. manda. No oficial, fora da janela, vai o modelo aprovado.
  const nomeDaLoja = a.unidade?.nome && a.unidade.nome !== loja ? `${loja} (${a.unidade.nome})` : loja
  const texto = textoDoLembrete({ nome: a.clienteNome, loja: nomeDaLoja, inicio: a.inicio })
  const quando = `${diaCurtoSP(a.inicio)} às ${horaEmSP(a.inicio)}`
  const r = await enviarOuModelo(canal, numero, texto, modeloDoLembrete(a.clienteNome, nomeDaLoja, quando))
  await anotar(r.ok ? 'enviado' : 'nao_saiu')
  if (!r.ok) console.warn(`[lembretes] ${orgId}: horário ${a.id} não saiu (${r.codigo ?? 'falha'})`)
  return r.ok ? 'enviado' : 'nao_saiu'
}

/** O relógio de verdade: as mesmas empresas e o mesmo canal das campanhas. */
export async function tickLembretes(agora: Date = new Date()): Promise<BatidaLembretes> {
  const { empresasComAgente } = await import('./assistente/portaria')
  const { canalPara, temZapi } = await import('./assistente/canal')
  const semWhatsappNoServidor = !temZapi()
  return tickLembretesCom(agora, {
    empresas: empresasComAgente,
    canalDe: async (org) => {
      const canal = await canalPara(org)
      return canal.real || semWhatsappNoServidor ? canal : null
    },
  })
}

/** Rótulo do desfecho, para a agenda. */
export const ROTULO_LEMBRETE: Record<string, string> = {
  enviando: 'lembrete saindo',
  enviado: 'lembrete enviado',
  sem_aceite: 'sem lembrete (não aceitou mensagens)',
  sem_telefone: 'sem lembrete (sem telefone)',
  nao_saiu: 'lembrete não saiu',
}
