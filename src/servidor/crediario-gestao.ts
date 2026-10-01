// A gestão do crediário, por cliente — o lado da gerente.
//
// Receber (recibos.ts) é o balcão: a cliente na frente, o dinheiro na mão. Aqui
// é o resto da conversa de cobrança, que a gerente faz com o carnê aberto:
//
//   • QUITOU TUDO: o acordo fechado (ou o pagamento feito no outro sistema)
//     dá baixa no carnê inteiro desta loja de uma vez — pela baixa externa de
//     recibos.ts, fora do caixa e do resultado.
//   • PAUSAR A COBRANÇA desta pessoa (acordo em andamento, advogado, doença):
//     a dívida continua, o chamado de cobrar para — ver `COBRAVEL`.
//   • LANÇAR DÍVIDA NA MÃO: o caderno antigo, a dívida que nunca passou por
//     sistema nenhum. Vira uma venda SALDO_IMPORTADO com as parcelas, como o
//     carnê trazido do sistema anterior: fora da receita, do estoque e das
//     metas (tudo isso só soma CONCLUIDA), e não se cancela nem se devolve.
//   • ANOTAR NA FICHA: "ligou, vai pagar dia 10". As anotações se acumulam na
//     ficha (Cliente.observacoes), com o dia e quem anotou — a próxima pessoa
//     que ligar sabe o que foi combinado.
//   • JUNTAR FICHAS: a mesma pessoa cadastrada duas vezes (uma com CPF, outra
//     sem) deve em duas fichas, e uma delas ninguém cobra. Juntar leva tudo
//     para a que fica — vendas, parcelas, recibos, vales, pontos, encomendas,
//     horários — e a outra fica inativa, apontando para a que ficou. Mexe na
//     dívida de uma pessoa de verdade: assina SEMPRE, com o PIN de quem junta,
//     e só junta quem negocia o crediário em TODAS as lojas em que as duas
//     fichas têm história.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, pode, unidadesQuePodem, type Sessao } from './permissao'
import { centavos, reais } from './dinheiro'
import { colunaDoDia, diaEmSP, diasEntre } from './dia'
import { agendaDoCrediario } from './crediario-agenda'
import { assinarExcecao } from './autorizacao'
import { motivoServe } from './excecoes'
import { chaveTelefone, chavesParaBuscar } from './assistente/telefone'
import { gravarSaida } from './ofertas'
import type { ConsentimentoOfertas, Prisma } from '@prisma/client'

/** O começo do texto da venda que é dívida lançada à mão (a ficha da venda a reconhece por ele). */
export const MARCA_DIVIDA = 'Dívida lançada à mão'

/**
 * Quem entra na COBRANÇA: o chamado de "fiado vencido" do painel, o "quem
 * cobrar primeiro" do Crediário — e a cobrança pelo assistente, quando ela
 * existir. Quem tem a cobrança pausada fica de fora; a dívida dela não.
 */
export const COBRAVEL = { cobrancaPausadaEm: null } as const satisfies Prisma.ClienteWhereInput

const limpar = (s: string | null | undefined, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const diaBR = (d: string) => d.split('-').reverse().join('/')

// ─────────────────────────────────────────────────────────────
// AS ANOTAÇÕES DA FICHA
// ─────────────────────────────────────────────────────────────

/** Quantas linhas a ficha guarda: as mais antigas saem quando passa disto. */
export const MAX_LINHAS_DE_NOTA = 80

export type Nota = { dia: string | null; quem: string | null; texto: string }

/**
 * As anotações, da mais nova para a mais antiga. A linha anotada por aqui é
 * "01/10/2026 · Ana: ligou, vai pagar dia 10"; o que foi escrito à mão no
 * cadastro (sem esse começo) aparece como está.
 */
export function lerNotas(observacoes: string | null | undefined): Nota[] {
  return String(observacoes ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(\d{2}\/\d{2}\/\d{4}) · ([^:]{1,60}): (.*)$/.exec(l)
      return m ? { dia: m[1]!, quem: m[2]!, texto: m[3]! } : { dia: null, quem: null, texto: l }
    })
    .reverse()
}

/** A ficha com mais uma linha no fim (e as mais antigas fora, se passar do teto). */
export function comNota(observacoes: string | null | undefined, linha: string): string {
  const linhas = String(observacoes ?? '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
  linhas.push(linha)
  return linhas.slice(-MAX_LINHAS_DE_NOTA).join('\n')
}

const linhaDeNota = (agora: Date, quem: string, texto: string) => `${diaBR(diaEmSP(agora))} · ${limpar(quem, 60).replace(/:/g, '')}: ${limpar(texto, 300)}`

// ─────────────────────────────────────────────────────────────
// LER
// ─────────────────────────────────────────────────────────────

export type FichaDeGestao = {
  cliente: { id: string; nome: string; telefone: string | null; documento: string | null; ativo: boolean; anonimizada: boolean }
  /** A ficha foi juntada em outra: o id e o nome da que ficou. */
  juntadaNa: { id: string; nome: string } | null
  pausa: { desde: Date; por: string | null; motivo: string | null } | null
  notas: Nota[]
  /** O que ela deve em cada loja que a pessoa enxerga. */
  lojas: { unidadeId: string; nome: string; devendoC: number; vencidoC: number; parcelas: number }[]
  /** Fichas parecidas (mesmo CPF, telefone ou nome) — candidatas a juntar. */
  parecidas: { id: string; nome: string; telefone: string | null; por: 'CPF' | 'telefone' | 'nome'; devendoC: number }[]
  pode: { cobrar: boolean; anotar: boolean; juntar: boolean }
}

export async function fichaDeGestao(sessao: Sessao, clienteId: string, agora = new Date()): Promise<FichaDeGestao | null> {
  exigir(sessao, 'crediario.ver')
  const vis = unidadesQuePodem(sessao, 'crediario.ver')
  const hoje = colunaDoDia(diaEmSP(agora))
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.cliente.findUnique({
      where: { id: clienteId },
      select: {
        id: true, nome: true, telefone: true, documento: true, ativo: true, anonimizadoEm: true, observacoes: true,
        cobrancaPausadaEm: true, cobrancaPausadaPor: true, cobrancaPausadaMotivo: true, juntadaNaId: true,
      },
    })
    if (!c) return null
    const juntadaNa = c.juntadaNaId
      ? await db.cliente.findUnique({ where: { id: c.juntadaNaId }, select: { id: true, nome: true } })
      : null
    const todas = vis === 'todas'
    const lojas = await db.$queryRaw<{ unidade_id: string; nome: string; devendo: string; vencido: string; parcelas: number }[]>`
      select p.unidade_id, u.nome,
             sum(p.valor - p.pago - p.desconto) as devendo,
             coalesce(sum(p.valor - p.pago - p.desconto) filter (where p.vencimento < ${hoje}), 0) as vencido,
             count(*)::int as parcelas
        from parcelas p join unidades u on u.id = p.unidade_id
       where p.cliente_id = ${clienteId} and p.quitada_em is null
         and (${todas} or p.unidade_id = any(${todas ? ['-'] : vis}))
       group by 1, 2
      having sum(p.valor - p.pago - p.desconto) > 0
       order by 2`
    const parecidas = c.anonimizadoEm ? [] : await fichasParecidas(db, c)
    return {
      cliente: {
        id: c.id, nome: c.nome, telefone: c.telefone, documento: c.documento, ativo: c.ativo, anonimizada: !!c.anonimizadoEm,
      },
      juntadaNa,
      pausa: c.cobrancaPausadaEm ? { desde: c.cobrancaPausadaEm, por: c.cobrancaPausadaPor, motivo: c.cobrancaPausadaMotivo } : null,
      notas: lerNotas(c.observacoes),
      lojas: lojas.map((l) => ({
        unidadeId: l.unidade_id,
        nome: l.nome,
        devendoC: centavos(l.devendo),
        vencidoC: centavos(l.vencido),
        parcelas: Number(l.parcelas),
      })),
      parecidas,
      pode: {
        cobrar: pode(sessao, 'crediario.cobrar'),
        anotar: pode(sessao, 'cliente.editar'),
        juntar: pode(sessao, 'crediario.cobrar') && pode(sessao, 'cliente.editar'),
      },
    }
  })
}

/**
 * Outras fichas ATIVAS que parecem a mesma pessoa: mesmo CPF, mesmo telefone
 * (pela chave — com ou sem o 9, com ou sem DDI) ou o mesmo nome escrito igual.
 * É só sugestão: quem junta confere.
 */
async function fichasParecidas(
  db: BancoDaOrg,
  c: { id: string; nome: string; telefone: string | null; documento: string | null },
): Promise<FichaDeGestao['parecidas']> {
  const cpf = (c.documento ?? '').replace(/\D/g, '')
  const chave = chaveTelefone(c.telefone)
  const fim = chave ? chave.slice(-8) : null
  const nome = c.nome.replace(/\s+/g, ' ').trim()
  const candidatas = await db.cliente.findMany({
    where: {
      id: { not: c.id },
      ativo: true,
      anonimizadoEm: null,
      OR: [
        { nome: { equals: nome, mode: 'insensitive' } },
        ...(cpf.length === 11 ? [{ documento: { contains: cpf.slice(-6) } }] : []),
        ...(fim ? [{ telefone: { contains: fim.slice(-4) } }] : []),
      ],
    },
    take: 30,
    select: { id: true, nome: true, telefone: true, documento: true },
  })
  const achadas: FichaDeGestao['parecidas'] = []
  for (const x of candidatas) {
    const por =
      cpf.length === 11 && (x.documento ?? '').replace(/\D/g, '') === cpf
        ? ('CPF' as const)
        : chave && chaveTelefone(x.telefone) === chave
          ? ('telefone' as const)
          : x.nome.replace(/\s+/g, ' ').trim().toLowerCase() === nome.toLowerCase()
            ? ('nome' as const)
            : null
    if (por) achadas.push({ id: x.id, nome: x.nome, telefone: x.telefone, por, devendoC: 0 })
  }
  if (achadas.length > 0) {
    const devendo = await db.parcela.groupBy({
      by: ['clienteId'],
      where: { clienteId: { in: achadas.map((a) => a.id) }, quitadaEm: null },
      _sum: { valor: true, pago: true, desconto: true },
    })
    for (const d of devendo) {
      const a = achadas.find((x) => x.id === d.clienteId)
      if (a) a.devendoC = centavos(d._sum.valor ?? 0) - centavos(d._sum.pago ?? 0) - centavos(d._sum.desconto ?? 0)
    }
  }
  const ordem = { CPF: 0, telefone: 1, nome: 2 }
  return achadas.sort((a, b) => ordem[a.por] - ordem[b.por]).slice(0, 5)
}

/** Procurar a outra ficha para juntar: nome, telefone ou CPF. Só ativas, nunca a própria. */
export async function procurarFichas(
  sessao: Sessao,
  termo: string,
  excetoId: string,
): Promise<{ id: string; nome: string; telefone: string | null; documento: string | null }[]> {
  exigir(sessao, 'cliente.ver')
  const t = limpar(termo, 60)
  if (t.length < 2) return []
  const digitos = t.replace(/\D/g, '')
  return comoOrg(sessao.orgId, (db) =>
    db.cliente.findMany({
      where: {
        id: { not: excetoId },
        ativo: true,
        anonimizadoEm: null,
        OR: [
          { nome: { contains: t, mode: 'insensitive' } },
          ...(digitos.length >= 4 ? [{ telefone: { contains: digitos } }, { documento: { contains: digitos } }] : []),
        ],
      },
      orderBy: { nome: 'asc' },
      take: 10,
      select: { id: true, nome: true, telefone: true, documento: true },
    }),
  )
}

// ─────────────────────────────────────────────────────────────
// PAUSAR A COBRANÇA · ANOTAR
// ─────────────────────────────────────────────────────────────

type Feito = { ok: true } | { ok: false; erro: string }

/**
 * Pausa (ou retoma) a cobrança desta pessoa. É da pessoa, não da loja: a
 * cliente em acordo não recebe cobrança de loja nenhuma da empresa.
 */
export async function pausarCobranca(
  sessao: Sessao,
  clienteId: string,
  pausar: boolean,
  motivo: string,
  agora = new Date(),
): Promise<Feito> {
  exigir(sessao, 'crediario.cobrar')
  const texto = limpar(motivo)
  if (pausar && !motivoServe(texto)) return { ok: false, erro: 'Diga por que a cobrança para (fica na ficha e no livro).' }
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.cliente.findUnique({
      where: { id: clienteId },
      select: { id: true, nome: true, observacoes: true, anonimizadoEm: true, cobrancaPausadaEm: true },
    })
    if (!c) return { ok: false as const, erro: 'Cliente não encontrado.' }
    if (c.anonimizadoEm) return { ok: false as const, erro: 'Este cadastro foi anonimizado e não se edita mais.' }
    if (pausar === !!c.cobrancaPausadaEm) return { ok: true as const }
    await db.cliente.update({
      where: { id: c.id },
      data: {
        cobrancaPausadaEm: pausar ? agora : null,
        cobrancaPausadaPor: pausar ? sessao.nome : null,
        cobrancaPausadaMotivo: pausar ? texto : null,
        observacoes: comNota(
          c.observacoes,
          linhaDeNota(agora, sessao.nome, pausar ? `pausou a cobrança — ${texto}` : `retomou a cobrança${texto ? ` — ${texto}` : ''}`),
        ),
      },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: pausar ? 'crediario.pausou' : 'crediario.retomou',
        alvoTipo: 'cliente',
        alvoId: c.id,
        alvoNome: c.nome,
        motivo: texto || null,
      },
    })
    return { ok: true as const }
  })
}

/** Uma linha a mais nas anotações da ficha, com o dia e quem anotou. */
export async function anotarNaFicha(sessao: Sessao, clienteId: string, texto: string, agora = new Date()): Promise<Feito> {
  exigir(sessao, 'cliente.editar')
  const t = limpar(texto, 300)
  if (t.length < 2) return { ok: false, erro: 'Escreva a anotação.' }
  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.cliente.findUnique({ where: { id: clienteId }, select: { id: true, nome: true, observacoes: true, anonimizadoEm: true } })
    if (!c) return { ok: false as const, erro: 'Cliente não encontrado.' }
    if (c.anonimizadoEm) return { ok: false as const, erro: 'Este cadastro foi anonimizado e não se edita mais.' }
    await db.cliente.update({ where: { id: c.id }, data: { observacoes: comNota(c.observacoes, linhaDeNota(agora, sessao.nome, t)) } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'cliente.anotou',
        alvoTipo: 'cliente',
        alvoId: c.id,
        alvoNome: c.nome,
      },
    })
    return { ok: true as const }
  })
}

// ─────────────────────────────────────────────────────────────
// LANÇAR DÍVIDA NA MÃO
// ─────────────────────────────────────────────────────────────

export type PedidoDeDivida = {
  clienteId: string
  unidadeId: string
  /** O total da dívida, em R$. */
  valor: number
  parcelas: number
  /** "AAAA-MM-DD" do 1º vencimento — pode ser no passado (a dívida do caderno já venceu). */
  primeiroVencimento: string
  /** O que é: "caderno de 2025", "conserto do vestido". */
  descricao: string
  motivo: string
}

export const DIVIDA_MAX_PARCELAS = 24

export async function lancarDivida(
  sessao: Sessao,
  p: PedidoDeDivida,
  agora = new Date(),
): Promise<{ ok: true; vendaId: string; numero: number } | { ok: false; erro: string }> {
  exigir(sessao, 'crediario.cobrar', p.unidadeId)
  if (!Number.isFinite(p.valor) || p.valor <= 0) return { ok: false, erro: 'Diga quanto ela deve.' }
  if (p.valor > 1_000_000) return { ok: false, erro: 'Valor alto demais. Confira o número.' }
  const n = Math.floor(Number(p.parcelas))
  if (!(n >= 1 && n <= DIVIDA_MAX_PARCELAS)) return { ok: false, erro: `Em quantas vezes? De 1 a ${DIVIDA_MAX_PARCELAS}.` }
  const hoje = diaEmSP(agora)
  const venc = String(p.primeiroVencimento ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || Number.isNaN(Date.parse(`${venc}T12:00:00Z`))) return { ok: false, erro: 'Escolha o 1º vencimento.' }
  if (Math.abs(diasEntre(hoje, venc)) > 3 * 366) return { ok: false, erro: 'O 1º vencimento está longe demais. Confira o ano.' }
  const descricao = limpar(p.descricao, 120)
  const motivo = limpar(p.motivo)
  if (!motivoServe(motivo)) return { ok: false, erro: 'Diga de onde vem a dívida (fica na venda e no livro).' }
  const totalC = centavos(p.valor)

  return comoOrg(sessao.orgId, async (db) => {
    const c = await db.cliente.findUnique({ where: { id: p.clienteId }, select: { id: true, nome: true, ativo: true, anonimizadoEm: true } })
    if (!c || !c.ativo || c.anonimizadoEm) return { ok: false as const, erro: 'Cliente não encontrado (ou ficha inativa).' }
    const loja = await db.unidade.findUnique({ where: { id: p.unidadeId }, select: { id: true, ehDeposito: true } })
    if (!loja || loja.ehDeposito) return { ok: false as const, erro: 'Escolha a loja a quem ela deve.' }
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { crediarioDiasEntre: true } })
    const agenda = agendaDoCrediario({ totalCent: totalC, parcelas: n, primeiroVencimento: venc, diasEntre: org.crediarioDiasEntre })
    if (agenda.length !== n) return { ok: false as const, erro: 'Não deu para montar as parcelas. Confira o valor e o vencimento.' }

    // O número vem do mesmo contador das vendas da loja: a dívida tem um
    // "nº" para a cliente e o carnê, como qualquer compra.
    const linhas = await db.$queryRaw<{ numero: number }[]>`
      update unidades set proxima_venda = proxima_venda + 1 where id = ${p.unidadeId}
      returning proxima_venda - 1 as numero`
    const numero = linhas[0]!.numero
    const texto = `${MARCA_DIVIDA} por ${sessao.nome}: ${motivo}.`
    const venda = await db.venda.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: p.unidadeId,
        caixaId: null,
        numero,
        clienteId: c.id,
        situacao: 'SALDO_IMPORTADO',
        subtotal: reais(totalC),
        total: reais(totalC),
        observacoes: texto,
        criadaEm: agora,
        itens: {
          create: [{
            orgId: sessao.orgId,
            variacaoId: null,
            descricao: `${MARCA_DIVIDA}${descricao ? ` — ${descricao}` : ''}`,
            quantidade: 1,
            precoUnit: reais(totalC),
            total: reais(totalC),
          }],
        },
        pagamentos: { create: [{ orgId: sessao.orgId, forma: 'CREDIARIO', valor: reais(totalC), parcelas: n }] },
      },
      select: { id: true, numero: true },
    })
    await db.parcela.createMany({
      data: agenda.map((x) => ({
        orgId: sessao.orgId,
        vendaId: venda.id,
        clienteId: c.id,
        unidadeId: p.unidadeId,
        numero: x.numero,
        de: x.de,
        vencimento: x.vencimento,
        valor: reais(x.valorCent),
      })),
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: p.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'crediario.lancou_divida',
        alvoTipo: 'cliente',
        alvoId: c.id,
        alvoNome: c.nome,
        valor: reais(totalC),
        motivo: `${n}× a partir de ${diaBR(venc)} · ${descricao ? `${descricao} · ` : ''}${motivo} · nº ${venda.numero}`.slice(0, 300),
        depois: { vendaId: venda.id, parcelas: n },
      },
    })
    return { ok: true as const, vendaId: venda.id, numero: venda.numero }
  })
}

// ─────────────────────────────────────────────────────────────
// JUNTAR FICHAS
// ─────────────────────────────────────────────────────────────

export type Juntou =
  | { ok: true; fica: string; movidos: Record<string, number> }
  | { ok: false; erro: string; precisaPin?: true }

const CONSENTIMENTO_PESO: Record<ConsentimentoOfertas, number> = { NAO: 2, SIM: 1, NAO_PERGUNTADO: 0 }

/**
 * Junta a ficha `saiId` na `ficaId`. Ver o topo do arquivo: assina SEMPRE, e
 * só quem negocia o crediário (e edita cliente) em toda loja onde as duas
 * fichas têm história. Uma transação: ou vai tudo para a que fica, ou nada.
 */
export async function juntarFichas(
  sessao: Sessao,
  p: { ficaId: string; saiId: string; motivo: string; pin?: string | null },
  agora = new Date(),
): Promise<Juntou> {
  exigir(sessao, 'crediario.cobrar')
  exigir(sessao, 'cliente.editar')
  if (!p.ficaId || !p.saiId || p.ficaId === p.saiId) return { ok: false, erro: 'Escolha duas fichas diferentes.' }
  const motivo = limpar(p.motivo)
  if (!motivoServe(motivo)) return { ok: false, erro: 'Diga por que são a mesma pessoa (fica no livro).' }

  // As lojas em que as duas fichas têm história — antes do PIN, para não
  // gastar a tentativa de quem nem pode juntar estas duas.
  const lojas = await comoOrg(sessao.orgId, async (db) => {
    const achadas = await db.cliente.findMany({ where: { id: { in: [p.ficaId, p.saiId] } }, select: { id: true } })
    if (achadas.length !== 2) return null
    const r = await db.$queryRaw<{ unidade_id: string }[]>`
      select unidade_id from vendas where cliente_id in (${p.ficaId}, ${p.saiId})
      union select unidade_id from parcelas where cliente_id in (${p.ficaId}, ${p.saiId})
      union select unidade_id from recibos_crediario where cliente_id in (${p.ficaId}, ${p.saiId})
      union select unidade_id from vales where cliente_id in (${p.ficaId}, ${p.saiId}) and unidade_id is not null`
    return r.map((x) => x.unidade_id)
  })
  // O RLS esconde a ficha de outra empresa: id alheio é "não achei", e nada se move.
  if (!lojas) return { ok: false, erro: 'Uma das fichas não foi encontrada.' }
  if (lojas.some((u) => !pode(sessao, 'crediario.cobrar', u) || !pode(sessao, 'cliente.editar', u))) {
    return { ok: false, erro: 'Uma das fichas tem compras ou crediário numa loja que você não cuida. Quem junta é quem responde por todas elas.' }
  }

  const assinatura = await assinarExcecao(sessao, { pin: p.pin, sempre: true })
  if (!assinatura.ok) return { ok: false, erro: assinatura.erro, precisaPin: true }

  return comoOrg(sessao.orgId, async (db) => {
    // As duas travadas, na mesma ordem para todo mundo (duas juntas cruzadas
    // não se prendem uma na outra).
    for (const id of [p.ficaId, p.saiId].sort()) await db.$queryRaw`select id from clientes where id = ${id} for update`
    const campos = {
      id: true, nome: true, documento: true, telefone: true, email: true, nascimento: true,
      endereco: true, numero: true, bairro: true, cidade: true, estado: true, cep: true,
      observacoes: true, ativo: true, pontos: true, anonimizadoEm: true, juntadaNaId: true,
      ofertasWhatsapp: true, ofertasEm: true, ofertasOrigem: true, ofertasPor: true,
      cobrancaPausadaEm: true, cobrancaPausadaPor: true, cobrancaPausadaMotivo: true,
    } as const
    const fica = await db.cliente.findUnique({ where: { id: p.ficaId }, select: campos })
    const sai = await db.cliente.findUnique({ where: { id: p.saiId }, select: campos })
    if (!fica || !sai) return { ok: false as const, erro: 'Uma das fichas não foi encontrada.' }
    if (fica.anonimizadoEm || sai.anonimizadoEm) return { ok: false as const, erro: 'Ficha anonimizada não se junta: o pedido do titular vale.' }
    if (sai.juntadaNaId || fica.juntadaNaId || !fica.ativo) return { ok: false as const, erro: 'Uma das fichas já foi juntada (ou está inativa). Recarregue a tela.' }
    // Aluno é outra conversa (matrícula, responsável, mensalidade): fica fora.
    const escola =
      (await db.responsavel.count({ where: { alunoId: sai.id } })) +
      (await db.matricula.count({ where: { alunoId: sai.id } })) +
      (await db.mensalidade.count({ where: { alunoId: sai.id } }))
    if (escola > 0) return { ok: false as const, erro: 'A ficha que sai é de aluno (matrícula ou mensalidade): essa não se junta por aqui.' }

    const de = { clienteId: sai.id }
    const para = { clienteId: fica.id }
    const movidos: Record<string, number> = {
      vendas: (await db.venda.updateMany({ where: de, data: para })).count,
      parcelas: (await db.parcela.updateMany({ where: de, data: para })).count,
      recibos: (await db.reciboCrediario.updateMany({ where: de, data: para })).count,
      vales: (await db.vale.updateMany({ where: de, data: para })).count,
      pontos: (await db.movimentoPontos.updateMany({ where: de, data: para })).count,
      encomendas: (await db.encomenda.updateMany({ where: de, data: para })).count,
      horarios: (await db.agendamento.updateMany({ where: de, data: para })).count,
      conversas: (await db.conversaAgente.updateMany({ where: de, data: para })).count,
    }

    // O dado que faltava numa ficha pode estar na outra: fica o que existir.
    const vazio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())
    const preencher: Prisma.ClienteUpdateInput = {}
    for (const k of ['documento', 'telefone', 'email', 'nascimento', 'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep'] as const) {
      if (vazio(fica[k]) && !vazio(sai[k])) (preencher as Record<string, unknown>)[k] = sai[k]
    }
    // Ofertas: a resposta mais restritiva vale para a pessoa. Quem disse NÃO
    // numa ficha não passa a receber oferta porque disse sim na outra.
    const dona = CONSENTIMENTO_PESO[sai.ofertasWhatsapp] > CONSENTIMENTO_PESO[fica.ofertasWhatsapp] ? sai : fica
    const ofertas = {
      ofertasWhatsapp: dona.ofertasWhatsapp,
      ofertasEm: dona.ofertasEm,
      ofertasOrigem: dona.ofertasOrigem,
      ofertasPor: dona.ofertasPor,
    }
    // Cobrança: pausada em qualquer das duas, segue pausada.
    const pausa = fica.cobrancaPausadaEm ? null : sai.cobrancaPausadaEm
      ? { cobrancaPausadaEm: sai.cobrancaPausadaEm, cobrancaPausadaPor: sai.cobrancaPausadaPor, cobrancaPausadaMotivo: sai.cobrancaPausadaMotivo }
      : null
    const telefoneFinal = (preencher.telefone as string | undefined) ?? fica.telefone
    const outrosContatos = [
      sai.telefone && sai.telefone !== telefoneFinal ? `telefone ${sai.telefone}` : null,
      sai.documento && !vazio(fica.documento) && sai.documento !== fica.documento ? `CPF ${sai.documento}` : null,
    ].filter(Boolean)
    let notas = String(fica.observacoes ?? '')
    for (const l of String(sai.observacoes ?? '').split(/\r?\n/).filter((x) => x.trim())) notas = comNota(notas, l.trim())
    notas = comNota(
      notas,
      linhaDeNota(agora, sessao.nome, `juntou a ficha "${sai.nome}" nesta — ${motivo}${outrosContatos.length ? ` (${outrosContatos.join(', ')})` : ''}`),
    )

    await db.cliente.update({
      where: { id: fica.id },
      data: {
        ...preencher,
        ...ofertas,
        ...(pausa ?? {}),
        pontos: { increment: sai.pontos },
        observacoes: notas,
      },
    })
    // A que sai fica, inativa e vazia de contato (o telefone e o CPF agora
    // são da que ficou — e telefone repetido trava a edição da outra), com o
    // ponteiro para a que ficou.
    await db.cliente.update({
      where: { id: sai.id },
      data: {
        ativo: false,
        juntadaNaId: fica.id,
        juntadaEm: agora,
        pontos: 0,
        telefone: null,
        documento: null,
        email: null,
        observacoes: comNota(sai.observacoes, linhaDeNota(agora, sessao.nome, `ficha juntada na de "${fica.nome}" — não use esta`)),
      },
    })

    // A lista de quem não recebe oferta é pelo TELEFONE: se qualquer dos dois
    // números da pessoa pediu para sair, o que ficou na ficha sai também.
    const chaves = [chaveTelefone(fica.telefone), chaveTelefone(sai.telefone)].filter((k): k is string => !!k)
    const chaveFinal = chaveTelefone(telefoneFinal)
    if (chaveFinal) {
      const naLista = chaves.length
        ? (await db.optOutWhatsapp.count({ where: { telefone: { in: chaves.flatMap(chavesParaBuscar) } } })) > 0
        : false
      if (naLista || ofertas.ofertasWhatsapp === 'NAO') await gravarSaida(db, sessao.orgId, chaveFinal, 'cliente', agora)
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'cliente.juntou',
        alvoTipo: 'cliente',
        alvoId: fica.id,
        alvoNome: fica.nome,
        motivo: `juntou "${sai.nome}" nesta · ${motivo}`.slice(0, 300),
        antes: { saiu: sai.id, pontosSaiu: sai.pontos, pontosFica: fica.pontos },
        depois: { ...movidos, fica: fica.id },
        assinado: assinatura.assinou,
      },
    })
    return { ok: true as const, fica: fica.id, movidos }
  })
}
