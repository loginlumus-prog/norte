// O que o console do Norte LÊ — atravessando empresas, com a credencial de
// admin, no laptop de quem opera (como as listas de scripts/operacao.ts).
//
// ── o que entra e o que não entra ────────────────────────────
// Só dado da CONTA: a empresa, o plano, a situação, as lojas pelo nome, quem
// tem acesso (nome, e-mail, papel, último acesso), o crédito de IA e o livro
// do que a equipe do Norte fez. Nada do NEGÓCIO do cliente: nenhuma venda,
// nenhum cliente da loja, nenhum valor de caixa. Cada consulta escolhe as
// colunas a dedo, para que um `select` esquecido não traga o resto.
//
// Em sequência, nunca em Promise.all: no banco local o pool é de uma conexão.

import type { PrismaClient, Plano, Situacao, Papel } from '@prisma/client'
import { mensalidade } from '../servidor/planos'
import { contaDeRespostas, franquiaDeRespostas, mesEmSP, respostasDaReferencia, type Respostas } from '../servidor/assinatura'
import { diaEmSP } from '../servidor/dia'
import {
  ACOES_DE_PEDIDO,
  JANELA_PEDIDOS_DIAS,
  lerPedidos,
  pedidosAbertos,
  recargaComoEvento,
  type EventoPedido,
  type Pedido,
} from '../servidor/pedidos'

/** O primeiro instante do mês corrente em São Paulo (UTC−3, sem horário de verão desde 2019). */
export function inicioDoMesEmSP(agora = new Date()): Date {
  return new Date(`${diaEmSP(agora).slice(0, 7)}-01T03:00:00.000Z`)
}

/** As unidades que a conta cobra — a mesma régua de `assinaturaDaEmpresa`. */
export function contaDoMes(
  plano: Plano,
  modulos: string[],
  farolMarcas: number,
  unidades: { ativa: boolean; ehDeposito: boolean; ehFabrica: boolean }[],
) {
  const ativas = unidades.filter((u) => u.ativa)
  // Depósito não vende e não entra na conta — menos no Grátis, de uma só.
  const lojas = ativas.filter((u) => plano === 'GRATIS' || !u.ehDeposito).length
  const fabricas = ativas.filter((u) => u.ehFabrica).length
  const marcas = modulos.includes('farol') ? farolMarcas : 0
  return mensalidade(plano, lojas, fabricas, marcas)
}

export type LinhaEmpresa = {
  id: string
  nome: string
  slug: string
  plano: Plano
  situacao: Situacao
  testeAte: Date | null
  proximaCobranca: Date | null
  criadaEm: Date
  configurada: boolean
  dono: { nome: string; email: string; telefone: string | null } | null
  /** O e-mail do dono quando ele ainda não entrou (convite pendente). */
  emailDaEmpresa: string | null
  lojas: number
  depositos: number
  fabricas: number
  pessoas: number
  modulos: string[]
  farolMarcas: number
  mensalCent: number | null
  /** O cofre de IA (`Org.creditoIaCent`): a trava de custo por baixo das respostas. O cliente não lê como dinheiro. */
  creditoSaldoCent: number
  /** O que saiu do cofre no mês (`ConsumoIA.cobradoCent`). */
  creditoGastoMesCent: number
  /** O que a IA NOS custou no mês (`ConsumoIA.custoCent`) — a conta da margem. */
  custoIaMesCent: number
  /** As respostas do assistente no período, a mesma conta da tela da Assinatura (`respostasDoMes`). */
  respostas: Pick<Respostas, 'incluidas' | 'pacotes' | 'total' | 'usadas' | 'restam' | 'acabou' | 'baixo' | 'periodo'>
  /** O que caiu de crédito de plano/Farol neste mês (depósitos tipo PLANO). */
  creditoInclusoMesCent: number
  ultimaAtividade: Date | null
  pedidosAbertos: Pedido[]
  suportesAtivos: number
}

type Admin = PrismaClient

/** Os eventos de pedido de todas as empresas, em uma ida (as listas da operação). */
async function eventosDeTodas(db: Admin, agora: Date, orgId?: string) {
  const desde = new Date(agora.getTime() - JANELA_PEDIDOS_DIAS * 864e5)
  const livro = await db.auditoria.findMany({
    where: { acao: { in: [...ACOES_DE_PEDIDO] }, criadoEm: { gte: desde }, ...(orgId ? { orgId } : {}) },
    select: { id: true, orgId: true, acao: true, criadoEm: true, alvoNome: true, motivo: true, depois: true },
    orderBy: { criadoEm: 'asc' },
  })
  // O pacote de respostas também é recarga COMPRA, mas fecha o pedido DELE
  // (pela linha `respostas.adicionou`) — a mesma regra de `eventosDePedido`.
  const recargas = await db.recargaIA.findMany({
    where: { tipo: 'COMPRA', centavos: { gt: 0 }, criadoEm: { gte: desde }, origem: { not: 'pacote' }, ...(orgId ? { orgId } : {}) },
    select: { id: true, orgId: true, criadoEm: true },
  })
  const porEmpresa = new Map<string, EventoPedido[]>()
  const juntar = (o: string, e: EventoPedido) => {
    const lista = porEmpresa.get(o)
    if (lista) lista.push(e)
    else porEmpresa.set(o, [e])
  }
  for (const { orgId: o, ...e } of livro) juntar(o, e)
  for (const r of recargas) juntar(r.orgId, recargaComoEvento(r))
  return porEmpresa
}

/** A lista de empresas, com tudo que a tela inicial do console mostra. */
export async function listarEmpresas(db: Admin, agora = new Date()): Promise<LinhaEmpresa[]> {
  const mes = inicioDoMesEmSP(agora)
  const orgs = await db.org.findMany({
    orderBy: { criadaEm: 'asc' },
    select: {
      id: true, nome: true, slug: true, email: true, plano: true, situacao: true, testeAte: true,
      criadaEm: true, configuradaEm: true, modulos: true, farolMarcas: true, creditoIaCent: true,
    },
  })
  const cobrancas = await db.cobranca.findMany({ select: { orgId: true, proximaCobranca: true } })
  const unidades = await db.unidade.findMany({ select: { orgId: true, ativa: true, ehDeposito: true, ehFabrica: true } })
  // Gente da LOJA: conta ativa com acesso que não é o nosso suporte.
  const pessoas = await db.usuario.groupBy({
    by: ['orgId'],
    where: { ativo: true, acessos: { some: { papel: { not: 'SUPORTE' } } } },
    _count: { _all: true },
  })
  const donos = await db.acesso.findMany({
    where: { papel: 'DONO', usuario: { ativo: true } },
    orderBy: { criadoEm: 'asc' },
    select: { orgId: true, usuario: { select: { nome: true, email: true, telefone: true } } },
  })
  const presencas = await db.presenca.groupBy({ by: ['orgId'], _max: { ultimoSinal: true } })
  const logins = await db.usuario.groupBy({
    by: ['orgId'],
    where: { acessos: { some: { papel: { not: 'SUPORTE' } } } },
    _max: { ultimoLogin: true },
  })
  const gastos = await db.consumoIA.groupBy({
    by: ['orgId'],
    where: { criadoEm: { gte: mes } },
    _sum: { cobradoCent: true, custoCent: true },
  })
  // As respostas: no mês, desde o dia 1º; no TESTE, desde que a empresa
  // nasceu — ou seja, todas (ver `respostasDoMes` em assinatura.ts).
  const emTeste = orgs.filter((o) => o.situacao === 'TESTE').map((o) => o.id)
  const respostasMes = await db.mensagemAgente.groupBy({
    by: ['orgId'],
    where: { respostaIa: true, criadaEm: { gte: mes }, orgId: { notIn: emTeste } },
    _count: { _all: true },
  })
  const respostasTeste = emTeste.length
    ? await db.mensagemAgente.groupBy({ by: ['orgId'], where: { respostaIa: true, orgId: { in: emTeste } }, _count: { _all: true } })
    : []
  // Os pacotes do mês, com o tamanho de cada um na referência (há dois).
  const pacotes = await db.recargaIA.findMany({
    where: { origem: 'pacote', referencia: { startsWith: `respostas:${mesEmSP(agora)}` }, centavos: { gt: 0 } },
    select: { orgId: true, referencia: true },
  })
  const inclusos = await db.recargaIA.groupBy({
    by: ['orgId'],
    where: { tipo: 'PLANO', centavos: { gt: 0 }, criadoEm: { gte: mes } },
    _sum: { centavos: true },
  })
  const suportes = await db.acesso.groupBy({
    by: ['orgId'],
    where: { papel: 'SUPORTE', OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
    _count: { _all: true },
  })
  const eventos = await eventosDeTodas(db, agora)

  const proxima = new Map(cobrancas.map((c) => [c.orgId, c.proximaCobranca]))
  const pessoasDe = new Map(pessoas.map((p) => [p.orgId, p._count._all]))
  const donoDe = new Map<string, { nome: string; email: string; telefone: string | null }>()
  for (const d of donos) if (!donoDe.has(d.orgId)) donoDe.set(d.orgId, d.usuario)
  const sinalDe = new Map(presencas.map((p) => [p.orgId, p._max.ultimoSinal]))
  const loginDe = new Map(logins.map((l) => [l.orgId, l._max.ultimoLogin]))
  const gastoDe = new Map(gastos.map((g) => [g.orgId, g._sum.cobradoCent ?? 0]))
  const custoDe = new Map(gastos.map((g) => [g.orgId, g._sum.custoCent ?? 0]))
  const usadasDe = new Map([...respostasMes, ...respostasTeste].map((r) => [r.orgId, r._count._all]))
  const pacotesDe = new Map<string, { quantos: number; respostas: number }>()
  for (const p of pacotes) {
    const a = pacotesDe.get(p.orgId) ?? { quantos: 0, respostas: 0 }
    pacotesDe.set(p.orgId, { quantos: a.quantos + 1, respostas: a.respostas + respostasDaReferencia(p.referencia) })
  }
  const inclusoDe = new Map(inclusos.map((g) => [g.orgId, g._sum.centavos ?? 0]))
  const suporteDe = new Map(suportes.map((s) => [s.orgId, s._count._all]))
  const unidadesDe = new Map<string, typeof unidades>()
  for (const u of unidades) unidadesDe.set(u.orgId, [...(unidadesDe.get(u.orgId) ?? []), u])

  return orgs.map((o) => {
    const us = unidadesDe.get(o.id) ?? []
    const ativas = us.filter((u) => u.ativa)
    const conta = contaDoMes(o.plano, o.modulos, o.farolMarcas, us)
    const sinais = [sinalDe.get(o.id), loginDe.get(o.id)].filter((d): d is Date => !!d)
    return {
      id: o.id,
      nome: o.nome,
      slug: o.slug,
      plano: o.plano,
      situacao: o.situacao,
      testeAte: o.testeAte,
      proximaCobranca: proxima.get(o.id) ?? null,
      criadaEm: o.criadaEm,
      configurada: !!o.configuradaEm,
      dono: donoDe.get(o.id) ?? null,
      emailDaEmpresa: o.email,
      lojas: ativas.filter((u) => !u.ehDeposito).length,
      depositos: ativas.filter((u) => u.ehDeposito).length,
      fabricas: ativas.filter((u) => u.ehFabrica).length,
      pessoas: pessoasDe.get(o.id) ?? 0,
      modulos: o.modulos,
      farolMarcas: o.farolMarcas,
      mensalCent: conta.total === null ? null : Math.round(conta.total * 100),
      creditoSaldoCent: o.creditoIaCent,
      creditoGastoMesCent: gastoDe.get(o.id) ?? 0,
      custoIaMesCent: custoDe.get(o.id) ?? 0,
      respostas: {
        ...contaDeRespostas(
          franquiaDeRespostas(o.plano, o.situacao, ativas.filter((u) => !u.ehDeposito).length),
          pacotesDe.get(o.id)?.quantos ?? 0,
          usadasDe.get(o.id) ?? 0,
          pacotesDe.get(o.id)?.respostas ?? 0,
        ),
        periodo: o.situacao === 'TESTE' ? 'teste' : 'mes',
      },
      creditoInclusoMesCent: inclusoDe.get(o.id) ?? 0,
      ultimaAtividade: sinais.length ? new Date(Math.max(...sinais.map((d) => d.getTime()))) : null,
      pedidosAbertos: pedidosAbertos(eventos.get(o.id) ?? []),
      suportesAtivos: suporteDe.get(o.id) ?? 0,
    }
  })
}

export type Resumo = {
  total: number
  ativas: number
  emTeste: number
  suspensas: number
  /** Soma das mensalidades das ATIVAS e INADIMPLENTES (o Corporativo, sob contrato, fica fora). */
  mrrCent: number
  pedidosAbertos: number
  creditoGastoMesCent: number
  creditoInclusoMesCent: number
  custoIaMesCent: number
  respostasUsadas: number
  pacotesNoMes: number
}

export function resumir(linhas: readonly LinhaEmpresa[]): Resumo {
  const pagantes = linhas.filter((l) => l.situacao === 'ATIVA' || l.situacao === 'INADIMPLENTE')
  return {
    total: linhas.length,
    ativas: linhas.filter((l) => l.situacao === 'ATIVA').length,
    emTeste: linhas.filter((l) => l.situacao === 'TESTE').length,
    suspensas: linhas.filter((l) => l.situacao === 'SUSPENSA').length,
    mrrCent: pagantes.reduce((s, l) => s + (l.mensalCent ?? 0), 0),
    pedidosAbertos: linhas.reduce((s, l) => s + l.pedidosAbertos.length, 0),
    creditoGastoMesCent: linhas.reduce((s, l) => s + l.creditoGastoMesCent, 0),
    creditoInclusoMesCent: linhas.reduce((s, l) => s + l.creditoInclusoMesCent, 0),
    custoIaMesCent: linhas.reduce((s, l) => s + l.custoIaMesCent, 0),
    respostasUsadas: linhas.reduce((s, l) => s + l.respostas.usadas, 0),
    pacotesNoMes: linhas.reduce((s, l) => s + l.respostas.pacotes, 0),
  }
}

/** Filtro da tela inicial: busca por nome, endereço ou e-mail do dono; situação; plano. */
export function filtrar(
  linhas: readonly LinhaEmpresa[],
  f: { busca?: string | null; situacao?: string | null; plano?: string | null },
): LinhaEmpresa[] {
  const sem = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const busca = f.busca?.trim() ? sem(f.busca.trim()) : null
  return linhas.filter(
    (l) =>
      (!f.situacao || l.situacao === f.situacao) &&
      (!f.plano || l.plano === f.plano) &&
      (!busca ||
        [l.nome, l.slug, l.dono?.nome ?? '', l.dono?.email ?? '', l.emailDaEmpresa ?? ''].some((c) => sem(c).includes(busca))),
  )
}

// ─────────────────────────────────────────────────────────────
// UMA EMPRESA
// ─────────────────────────────────────────────────────────────

export type DetalheEmpresa = {
  linha: LinhaEmpresa
  org: {
    ramo: string | null
    telefone: string | null
    whatsapp: string | null
    suspensaEm: Date | null
    configuradaEm: Date | null
    creditoAvisoCent: number
  }
  unidades: { nome: string; ativa: boolean; ehDeposito: boolean; ehFabrica: boolean }[]
  equipe: {
    nome: string
    email: string
    ativo: boolean
    temSenha: boolean
    ultimoLogin: Date | null
    papeis: { papel: Papel; unidade: string | null; expiraEm: Date | null; suporteEdita: boolean }[]
  }[]
  convites: { email: string; papel: Papel; expiraEm: Date; aceitoEm: Date | null; criadoEm: Date }[]
  pedidos: Pedido[]
  recargas: { centavos: number; saldoDepois: number; tipo: string; motivo: string | null; quem: string; criadoEm: Date }[]
  livroDaEquipe: { acao: string; quem: string; alvoNome: string | null; motivo: string | null; criadoEm: Date }[]
  agente: { canal: string | null; ativo: boolean } | null
}

export async function detalheEmpresa(
  db: Admin,
  slug: string,
  agora = new Date(),
  /** A lista já lida nesta requisição, para não ler duas vezes. */
  jaLidas?: LinhaEmpresa[],
): Promise<DetalheEmpresa | null> {
  const linha = (jaLidas ?? (await listarEmpresas(db, agora))).find((l) => l.slug === slug)
  if (!linha) return null
  const orgId = linha.id
  const org = await db.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { ramo: true, telefone: true, whatsapp: true, suspensaEm: true, configuradaEm: true, creditoAvisoCent: true },
  })
  const unidades = await db.unidade.findMany({
    where: { orgId },
    orderBy: [{ ativa: 'desc' }, { nome: 'asc' }],
    select: { id: true, nome: true, ativa: true, ehDeposito: true, ehFabrica: true },
  })
  const usuarios = await db.usuario.findMany({
    where: { orgId },
    orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    select: { id: true, nome: true, email: true, ativo: true, senhaHash: true, ultimoLogin: true },
  })
  const acessos = await db.acesso.findMany({
    where: { orgId },
    select: { usuarioId: true, papel: true, unidadeId: true, expiraEm: true, suporteEdita: true },
  })
  const convites = await db.convite.findMany({
    where: { orgId },
    orderBy: { criadoEm: 'desc' },
    take: 10,
    select: { email: true, papel: true, expiraEm: true, aceitoEm: true, criadoEm: true },
  })
  const recargas = await db.recargaIA.findMany({
    where: { orgId },
    orderBy: { criadoEm: 'desc' },
    take: 12,
    select: { centavos: true, saldoDepois: true, tipo: true, motivo: true, quem: true, criadoEm: true },
  })
  const livroDaEquipe = await db.auditoria.findMany({
    // Sem `suporte.acessou`: o suporte assina "Equipe Norte (...)" também, e
    // uma linha por tela abafaria o que a equipe DECIDIU.
    where: { orgId, quem: { startsWith: 'Equipe Norte (' }, acao: { not: 'suporte.acessou' } },
    orderBy: { criadoEm: 'desc' },
    take: 40,
    select: { acao: true, quem: true, alvoNome: true, motivo: true, criadoEm: true },
  })
  const agente = await db.agente.findUnique({ where: { orgId }, select: { canal: true, ativo: true } })
  const eventos = (await eventosDeTodas(db, agora, orgId)).get(orgId) ?? []

  const nomeDaUnidade = new Map(unidades.map((u) => [u.id, u.nome]))
  return {
    linha,
    org,
    unidades: unidades.map(({ id: _id, ...u }) => u),
    equipe: usuarios.map((u) => ({
      nome: u.nome,
      email: u.email,
      ativo: u.ativo,
      temSenha: !!u.senhaHash,
      ultimoLogin: u.ultimoLogin,
      papeis: acessos
        .filter((a) => a.usuarioId === u.id)
        .map((a) => ({
          papel: a.papel,
          unidade: a.unidadeId ? (nomeDaUnidade.get(a.unidadeId) ?? '?') : null,
          expiraEm: a.expiraEm,
          suporteEdita: a.suporteEdita,
        })),
    })),
    convites,
    pedidos: lerPedidos(eventos).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime()),
    recargas,
    livroDaEquipe,
    agente: agente ? { canal: agente.canal ?? null, ativo: agente.ativo } : null,
  }
}

/** Todos os pedidos abertos, de todas as empresas, do mais antigo ao mais novo. */
export function pedidosAbertosDeTodas(linhas: readonly LinhaEmpresa[]) {
  return linhas
    .flatMap((l) => l.pedidosAbertos.map((p) => ({ empresa: l, pedido: p })))
    .sort((a, b) => a.pedido.criadoEm.getTime() - b.pedido.criadoEm.getTime())
}
