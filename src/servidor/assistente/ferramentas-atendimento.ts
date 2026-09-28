// As ferramentas do atendimento: agenda, pagamentos e ponto.
//
// A mesma regra de ferramentas.ts: LER chama os mesmos serviços que as telas
// chamam, com a sessão da PESSOA que está falando — o assistente enxerga o
// que ela enxergaria na tela, nem uma linha a mais. ESCREVER (marcar,
// desmarcar) só monta a proposta; quem executa é a pessoa que confirma, pelo
// mesmo serviço da tela (ver `executar` em agente.ts).
//
// E ninguém aqui fala com cliente: marcar um horário pelo assistente não
// avisa a pessoa marcada. Quem avisa é a loja.

import { comoOrg } from '../banco'
import { propor } from '../agente'
import { pode, type Sessao } from '../permissao'
import { moduloLigado, type ComModulos } from '../modulos'
import { mostrar } from '../dinheiro'
import { diaEmSP, inicioDoDiaEmSP, somarDias } from '../dia'
import {
  ROTULO_AGENDA,
  acharHorario,
  buscarClientesParaAgenda,
  dentroDoHorario,
  duracaoValida,
  horaEmSP,
  horarioDaLoja,
  horariosLivres,
  listarAgenda,
  ocupa,
  profissionaisDaLoja,
  servicosDaLoja,
  diaCurtoSP,
  type DadosHorario,
} from '../agenda'
import { deSP } from '../encomenda'
import { folhaDe, horas, listarColaboradores, meuColaborador, podeNoColaborador, trabalhandoAgora } from '../ponto'
import { unidadesVisiveis } from './contexto'
import type { ResultadoFerramenta } from './ferramentas'

const MAXIMO_RESULTADO = 6000
const json = (v: unknown): ResultadoFerramenta => ({ texto: JSON.stringify(v).slice(0, MAXIMO_RESULTADO) })
const falha = (texto: string): ResultadoFerramenta => ({ texto, erro: true })
const brl = (v: number) => mostrar(Math.round(v * 100))
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
const bate = (nome: string, pedido: string) => !pedido || norm(nome).includes(norm(pedido))
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// ─────────────────────────────────────────────────────────────
// AGENDA
// ─────────────────────────────────────────────────────────────

export async function consultarAgenda(sessao: Sessao, e: Record<string, unknown>, agora = new Date()): Promise<ResultadoFerramenta> {
  const unidades = await unidadesVisiveis(sessao, 'agenda.ver')
  if (unidades.length === 0) return falha('Nenhuma loja com agenda visível para esta pessoa.')
  const quando = e.quando === 'amanha' || e.quando === 'semana' ? e.quando : 'hoje'
  const hoje = diaEmSP(agora)
  const de = quando === 'amanha' ? somarDias(hoje, 1) : hoje
  const ate = quando === 'semana' ? somarDias(hoje, 7) : somarDias(de, 1)
  const profissional = str(e.profissional, 60)
  const cliente = str(e.cliente, 80)

  const lista = (await listarAgenda(sessao, { unidadeIds: unidades, de: inicioDoDiaEmSP(de), ate: inicioDoDiaEmSP(ate) })).filter(
    (a) => bate(a.colaboradorNome, profissional) && bate(a.clienteNome, cliente),
  )

  let livres: { loja: string; profissional: string; horarios: string[] }[] | undefined
  if (e.livres === true && quando !== 'semana') {
    livres = []
    for (const u of unidades) {
      const profs = (await profissionaisDaLoja(sessao, u)).filter((p) => bate(p.nome, profissional))
      const { horario } = await horarioDaLoja(sessao, u)
      const vivos = lista.filter((a) => a.unidadeId === u && ocupa(a.situacao))
      for (const p of profs) {
        const h = horariosLivres({ horario, dia: de, ocupados: vivos.filter((a) => a.colaboradorId === p.id), duracaoMin: 30 }, agora)
        livres.push({ loja: u, profissional: p.nome, horarios: h.slice(0, 12).map(horaEmSP) })
      }
    }
  }

  return json({
    periodo: quando,
    horarios: lista.slice(0, 40).map((a) => ({
      id: a.id,
      dia: diaCurtoSP(a.inicio),
      hora: `${horaEmSP(a.inicio)}–${horaEmSP(a.fim)}`,
      cliente: a.clienteNome,
      servico: a.servico,
      profissional: a.colaboradorNome,
      situacao: ROTULO_AGENDA[a.situacao],
      loja: unidades.length > 1 ? a.unidadeNome : undefined,
      cobrado: a.vendaId ? true : undefined,
    })),
    total: lista.length,
    livres,
  })
}

/** A loja da proposta: a única que a pessoa alcança, ou a que ela disse. */
async function lojaDaProposta(sessao: Sessao, pedida: string) {
  const ids = await unidadesVisiveis(sessao, 'agenda.marcar')
  const lojas = await comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({ where: { id: { in: ids }, ativa: true, ehDeposito: false }, select: { id: true, nome: true } }),
  )
  if (lojas.length === 1) return { loja: lojas[0]!, lojas }
  const achada = pedida ? lojas.find((l) => bate(l.nome, pedida)) : undefined
  return { loja: achada ?? null, lojas }
}

export async function proporMarcar(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
  agora = new Date(),
): Promise<ResultadoFerramenta> {
  const nomeCliente = str(e.cliente, 120)
  const profissional = str(e.profissional, 60)
  const dia = str(e.dia, 10)
  const hora = str(e.hora, 5)
  const servicoPedido = str(e.servico, 120)
  const telefone = str(e.telefone, 20)
  if (nomeCliente.length < 2) return falha('Falta dizer para quem é o horário.')
  if (!servicoPedido) return falha('Falta dizer qual é o serviço.')
  const inicio = deSP(dia, hora)
  if (!inicio) return falha('O dia precisa ser AAAA-MM-DD e a hora HH:MM.')
  if (inicio.getTime() < agora.getTime()) return falha('Esse horário já passou.')

  const { loja, lojas } = await lojaDaProposta(sessao, str(e.loja, 60))
  if (!loja) return falha(`Em qual loja? ${lojas.map((l) => l.nome).join(', ') || 'Nenhuma loja em que esta pessoa marca horário.'}`)

  const profs = await profissionaisDaLoja(sessao, loja.id)
  const achados = profs.filter((p) => bate(p.nome, profissional))
  if (achados.length !== 1) {
    return falha(
      achados.length === 0
        ? `Não achei "${profissional}" entre quem atende na ${loja.nome}: ${profs.map((p) => p.nome).join(', ') || 'ninguém cadastrado'}.`
        : `Quem, exatamente? ${achados.map((p) => p.nome).join(', ')}.`,
    )
  }
  const prof = achados[0]!

  const servicos = await servicosDaLoja(sessao, loja.id)
  const doCatalogo = servicos.find((s) => norm(s.nome) === norm(servicoPedido)) ?? servicos.find((s) => bate(s.nome, servicoPedido))
  const duracao = duracaoValida(typeof e.duracao === 'number' ? Math.round(e.duracao) : null, doCatalogo?.duracaoMin)
  if (duracao === null) return falha('A duração vai de 5 minutos a 12 horas.')
  const fim = new Date(inicio.getTime() + duracao * 60_000)

  // Olha a agenda AGORA, para a resposta já dizer se não cabe. A trava de
  // verdade é na hora de confirmar (marcarHorario confere de novo).
  const doDia = await listarAgenda(sessao, { unidadeIds: [loja.id], de: inicioDoDiaEmSP(dia), ate: inicioDoDiaEmSP(somarDias(dia, 1)), colaboradorId: prof.id })
  const choque = doDia.find((a) => ocupa(a.situacao) && a.inicio < fim && a.fim > inicio)
  if (choque) {
    return falha(`${prof.nome} já tem ${choque.clienteNome} das ${horaEmSP(choque.inicio)} às ${horaEmSP(choque.fim)}. Sugira outro horário (dá para consultar os livres).`)
  }

  let clienteId: string | null = null
  if (pode(sessao, 'cliente.ver')) {
    const cs = await buscarClientesParaAgenda(sessao, nomeCliente)
    const exato = cs.filter((c) => norm(c.nome) === norm(nomeCliente))
    if (exato.length === 1) clienteId = exato[0]!.id
  }

  const { horario, texto } = await horarioDaLoja(sessao, loja.id)
  const fora = !dentroDoHorario(horario, { inicio, fim })
  const dados: DadosHorario = {
    unidadeId: loja.id,
    colaboradorId: prof.id,
    clienteId,
    clienteNome: nomeCliente,
    telefone: telefone || null,
    produtoId: doCatalogo?.id ?? null,
    servico: doCatalogo ? doCatalogo.nome : servicoPedido,
    dia,
    hora,
    duracaoMin: duracao,
  }
  const resumo =
    `Marcar ${nomeCliente} com ${prof.nome}: ${doCatalogo?.nome ?? servicoPedido}, ${diaCurtoSP(inicio)} às ${horaEmSP(inicio)} (${duracao} min)` +
    `${lojas.length > 1 ? `, na ${loja.nome}` : ''}.${fora ? ` Atenção: fora do funcionamento da loja (${texto}).` : ''}`
  const proposta = await propor(orgId, empresa, { poder: 'agenda.marcar', resumo, dados: dados as unknown as Record<string, unknown> })
  return {
    texto: `Proposta criada, esperando uma pessoa da loja confirmar na tela do assistente: ${resumo} O horário ainda não está marcado, e o cliente não é avisado por aqui.`,
    propostaId: proposta.id,
  }
}

export async function proporDesmarcar(orgId: string, empresa: ComModulos, sessao: Sessao, e: Record<string, unknown>): Promise<ResultadoFerramenta> {
  const id = str(e.id, 64)
  const motivo = str(e.motivo, 200)
  if (!/^[\w-]{1,64}$/.test(id)) return falha('Falta o id do horário — consulte a agenda antes.')
  if (motivo.length < 3) return falha('Todo desmarcar precisa de motivo.')
  const a = await acharHorario(sessao, id)
  if (!a) return falha('Não achei esse horário.')
  if (!pode(sessao, 'agenda.marcar', a.unidadeId)) return falha('Esta pessoa não mexe na agenda dessa loja.')
  if (!ocupa(a.situacao) || a.situacao === 'ATENDIDO') return falha(`Esse horário já está ${ROTULO_AGENDA[a.situacao].toLowerCase()}.`)
  const resumo = `Desmarcar ${a.clienteNome} com ${a.colaboradorNome}, ${diaCurtoSP(a.inicio)} às ${horaEmSP(a.inicio)} (${a.servico}). Motivo: ${motivo}.`
  const proposta = await propor(orgId, empresa, { poder: 'agenda.desmarcar', resumo, dados: { id, motivo } })
  return {
    texto: `Proposta criada, esperando confirmação na tela do assistente: ${resumo} O horário ainda está de pé, e o cliente não é avisado por aqui.`,
    propostaId: proposta.id,
  }
}

// ─────────────────────────────────────────────────────────────
// PAGAMENTOS — "a Joana pagou?"
// ─────────────────────────────────────────────────────────────
//
// Cada FONTE diz de onde vem um pedaço da resposta, o que ela exige e o que
// ela lê. Hoje são duas: as vendas e o crediário. A escola (a próxima fase)
// acrescenta as mensalidades como mais uma fonte aqui — sem mexer nas outras.

type Fonte = {
  chave: string
  /** Esta pessoa, nesta empresa, pode ler esta fonte? */
  abre: (sessao: Sessao, empresa: ComModulos) => boolean
  ler: (sessao: Sessao, clienteId: string, agora: Date) => Promise<unknown>
}

export const FONTES_DE_PAGAMENTO: Fonte[] = [
  {
    chave: 'compras',
    abre: (s) => pode(s, 'venda.ver'),
    ler: async (s, clienteId, agora) => {
      const lojas = await unidadesVisiveis(s, 'venda.ver')
      const vs = await comoOrg(s.orgId, (db) =>
        db.venda.findMany({
          where: { clienteId, unidadeId: { in: lojas }, criadaEm: { gte: new Date(agora.getTime() - 90 * 864e5) } },
          orderBy: { criadaEm: 'desc' },
          take: 8,
          select: { numero: true, criadaEm: true, total: true, situacao: true, pagamentos: { select: { forma: true, valor: true } } },
        }),
      )
      return vs.map((v) => ({
        venda: v.numero,
        dia: diaCurtoSP(v.criadaEm),
        total: brl(Number(v.total)),
        situacao: v.situacao === 'CANCELADA' ? 'cancelada' : 'paga',
        formas: v.pagamentos.map((p) => `${p.forma.toLowerCase()} ${brl(Number(p.valor))}`),
      }))
    },
  },
  {
    chave: 'crediario',
    abre: (s, e) => moduloLigado(e, 'crediario') && pode(s, 'crediario.ver'),
    ler: async (s, clienteId, agora) => {
      const lojas = await unidadesVisiveis(s, 'crediario.ver')
      const ps = await comoOrg(s.orgId, (db) =>
        db.parcela.findMany({
          where: { clienteId, unidadeId: { in: lojas }, quitadaEm: null },
          orderBy: { vencimento: 'asc' },
          take: 24,
          select: { valor: true, pago: true, vencimento: true },
        }),
      )
      const hoje = diaEmSP(agora)
      let vencido = 0
      let aVencer = 0
      for (const p of ps) {
        const resto = Number(p.valor) - Number(p.pago)
        if (p.vencimento.toISOString().slice(0, 10) < hoje) vencido += resto
        else aVencer += resto
      }
      return { parcelasEmAberto: ps.length, vencido: brl(vencido), aVencer: brl(aVencer), proximoVencimento: ps[0] ? ps[0].vencimento.toISOString().slice(0, 10) : null }
    },
  },
]

export async function consultarPagamentos(sessao: Sessao, empresa: ComModulos, e: Record<string, unknown>, agora = new Date()): Promise<ResultadoFerramenta> {
  const nome = str(e.cliente, 80)
  if (nome.length < 2) return falha('Diga o nome da pessoa.')
  const fontes = FONTES_DE_PAGAMENTO.filter((f) => f.abre(sessao, empresa))
  if (fontes.length === 0) return falha('Esta pessoa não vê vendas nem crediário.')
  const achados = await comoOrg(sessao.orgId, (db) =>
    db.cliente.findMany({
      where: { ativo: true, anonimizadoEm: null, nome: { contains: nome, mode: 'insensitive' } },
      orderBy: { nome: 'asc' },
      take: 4,
      select: { id: true, nome: true },
    }),
  )
  if (achados.length === 0) return json({ achados: 0, recado: 'Ninguém com esse nome no cadastro.' })
  const pessoas = []
  for (const c of achados.slice(0, 3)) {
    const r: Record<string, unknown> = { nome: c.nome }
    for (const f of fontes) r[f.chave] = await f.ler(sessao, c.id, agora)
    pessoas.push(r)
  }
  return json({ achados: achados.length, pessoas, maisDeTres: achados.length > 3 || undefined })
}

// ─────────────────────────────────────────────────────────────
// PONTO
// ─────────────────────────────────────────────────────────────

export async function consultarPonto(sessao: Sessao, e: Record<string, unknown>, agora = new Date()): Promise<ResultadoFerramenta> {
  if (e.agora === true) {
    if (!pode(sessao, 'ponto.ver')) return falha('Esta pessoa só vê o próprio ponto.')
    const lojas = await unidadesVisiveis(sessao, 'ponto.ver')
    const t = await trabalhandoAgora(sessao, lojas, agora)
    return json({ trabalhandoAgora: t.map((x) => ({ nome: x.nome, desde: horaEmSP(x.desde) })) })
  }
  const hoje = diaEmSP(agora)
  const mes = e.mes === 'anterior' ? somarDias(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7) : hoje.slice(0, 7)
  const pedido = str(e.pessoa, 60)

  let alvo: string | null = null
  if (!pedido) {
    alvo = (await meuColaborador(sessao))?.id ?? null
    if (!alvo) return falha('A conta desta pessoa não está ligada a uma ficha de funcionário.')
  } else {
    const lojas = await unidadesVisiveis(sessao, pode(sessao, 'ponto.ver') ? 'ponto.ver' : 'ponto.proprio')
    const cs = (await listarColaboradores(sessao, { unidadeIds: lojas })).filter((c) => bate(c.nome, pedido))
    if (cs.length !== 1) return falha(cs.length === 0 ? `Não achei "${pedido}" entre quem trabalha aqui.` : `Quem, exatamente? ${cs.map((c) => c.nome).join(', ')}.`)
    const c = cs[0]!
    const propria = c.usuarioId === sessao.usuarioId
    if (!propria && !podeNoColaborador(sessao, 'ponto.ver', c)) return falha('Esta pessoa só vê o próprio ponto.')
    alvo = c.id
  }
  const f = await folhaDe(sessao, alvo, mes, agora)
  if (!f) return falha('Essa folha não abre para esta pessoa.')
  const t = f.folha.totais
  return json({
    pessoa: f.colaborador.nome,
    mes,
    trabalhadas: horas(t.trabalhado),
    combinadasAteHoje: t.previstoMes > 0 ? horas(t.previsto) : null,
    diferenca: t.previstoMes > 0 ? horas(t.diferenca) : null,
    extras: horas(t.extras),
    faltas: t.faltas,
    batidasAAjustar: t.pendencias,
    trabalhandoDesde: f.folha.aberto?.entrada ? horaEmSP(f.folha.aberto.entrada) : null,
    aviso: 'Controle interno da empresa, não é ponto certificado.',
  })
}
