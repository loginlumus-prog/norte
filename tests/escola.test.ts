// A escola, sem banco: as contas da mensalidade (bolsa, vencimento, multa,
// juro, pontualidade), a geração idempotente, o texto do aviso ao
// responsável, quem pode o quê, e a palavra "aluno".

import { describe, it, expect } from 'vitest'
import {
  abonoDeHoje,
  aGerarNoMes,
  contaDaMensalidade,
  descontoEmCentavos,
  encargosDeHoje,
  limparConfig,
  mesPorExtenso,
  mesesDaGeracao,
  situacaoDaMensalidade,
  vencimentoDaMensalidade,
} from '../src/servidor/mensalidades'
import { horarioDaTurma, quaseCheia, transicaoMatricula, validarResponsavel, validarTurma } from '../src/servidor/escola'
import { avisoApto, numeroAceitou, pedeAviso, textoDoAviso } from '../src/servidor/avisos-mensalidade'
import { pode, type Papel, type Sessao } from '../src/servidor/permissao'
import { vocabularioDoRamo } from '../src/servidor/vocabulario'
import { MENU } from '../src/ui/menu'
import { NICHOS } from '../src/servidor/nicho'
import { RAMOS } from '../src/servidor/modulos'
import { PLANOS, planoLibera } from '../src/servidor/planos'
import { ferramentasDe } from '../src/servidor/poderes'
import { textoDoRelatorio } from '../src/servidor/assistente/rotinas'

const dia = (d: string) => new Date(`${d}T00:00:00.000Z`)
const em = (d: string, h: string) => new Date(`${d}T${h}:00.000-03:00`)

describe('a bolsa e o vencimento', () => {
  it('bolsa em porcento mais valor fixo, nunca mais que a mensalidade', () => {
    expect(descontoEmCentavos(45000, 50, 0)).toBe(22500)
    expect(descontoEmCentavos(45000, 10, 5000)).toBe(9500)
    expect(descontoEmCentavos(45000, 100, 5000)).toBe(45000)
    expect(descontoEmCentavos(45000, 0, 0)).toBe(0)
    // 33,33% de 100,01 = 33,336… → arredonda para o mais perto
    expect(descontoEmCentavos(10001, 33.33, 0)).toBe(3333)
  })

  it('a primeira mensalidade não nasce vencida: quem entra dia 25 paga no dia 25', () => {
    expect(vencimentoDaMensalidade(10, '2026-09', '2026-09-25')).toBe('2026-09-25')
    expect(vencimentoDaMensalidade(10, '2026-09', '2026-09-05')).toBe('2026-09-10')
    expect(vencimentoDaMensalidade(10, '2026-10', '2026-09-25')).toBe('2026-10-10')
  })
})

describe('a geração é idempotente', () => {
  const m = (id: string, extra: Partial<{ situacao: string; inicio: string; fim: string | null }> = {}) => ({
    id,
    situacao: 'ATIVA',
    inicio: '2026-08-01',
    fim: null,
    diaVencimento: 10,
    ...extra,
  })

  it('só a ativa, só dentro do período da matrícula, e nunca a que já existe', () => {
    const ms = [
      m('a'),
      m('trancada', { situacao: 'TRANCADA' }),
      m('futura', { inicio: '2026-11-03' }),
      m('saiu', { situacao: 'ATIVA', fim: '2026-08-31' }),
    ]
    expect(aGerarNoMes(ms, new Set(), '2026-09').map((x) => x.matriculaId)).toEqual(['a'])
    expect(aGerarNoMes(ms, new Set(['a|2026-09']), '2026-09')).toEqual([])
    expect(aGerarNoMes(ms, new Set(), '2026-11').map((x) => x.matriculaId).sort()).toEqual(['a', 'futura'])
    expect(aGerarNoMes(ms, new Set(), 'lixo')).toEqual([])
  })

  it('o mês da geração é o de São Paulo: 22h do dia 30 ainda é setembro', () => {
    expect(mesesDaGeracao(new Date('2026-10-01T01:00:00.000Z'))).toEqual(['2026-09', '2026-10'])
    expect(mesesDaGeracao(new Date('2026-12-15T12:00:00.000Z'))).toEqual(['2026-12', '2027-01'])
  })
})

describe('multa e juro de atraso', () => {
  const regra = { multaPct: 2, jurosMes: 1 }

  it('em dia não tem encargo; no dia do vencimento ainda não é atraso', () => {
    expect(encargosDeHoje({ restaC: 45000, vencimento: dia('2026-09-10'), jurosAte: null, multaCobrada: false }, regra, em('2026-09-10', '18:00'))).toEqual({ dias: 0, diasJuros: 0, jurosC: 0, multaC: 0 })
  })

  it('atrasou 30 dias: multa de 2% uma vez e juro de 1% ao mês, por dia', () => {
    const e = encargosDeHoje({ restaC: 45000, vencimento: dia('2026-09-10'), jurosAte: null, multaCobrada: false }, regra, em('2026-10-10', '10:00'))
    expect(e.dias).toBe(30)
    expect(e.multaC).toBe(900)
    expect(e.jurosC).toBe(450)
  })

  it('pagou parte com multa e juro: a multa não volta, e o juro conta só os dias novos', () => {
    // Pagou R$ 200 no dia 10/10 (multa e juro de 30 dias sobre 450). Restam 250.
    const depois = encargosDeHoje(
      { restaC: 25000, vencimento: dia('2026-09-10'), jurosAte: dia('2026-10-10'), multaCobrada: true },
      regra,
      em('2026-10-20', '10:00'),
    )
    expect(depois.multaC).toBe(0)
    expect(depois.diasJuros).toBe(10)
    expect(depois.jurosC).toBe(Math.floor((25000 * 1 * 10) / 3000))
    expect(depois.dias).toBe(40)
  })

  it('o teto da lei vale mesmo que a empresa tenha escrito mais', () => {
    const e = encargosDeHoje({ restaC: 10000, vencimento: dia('2026-09-01'), jurosAte: null, multaCobrada: false }, { multaPct: 10, jurosMes: 5 }, em('2026-10-01', '10:00'))
    expect(e.multaC).toBe(200)
    expect(e.jurosC).toBe(100)
    const c = limparConfig({ multaPct: 10, jurosMes: 5, pontualidadePct: 90, avisoDias: 40, atrasoDias: -2 })
    expect(c).toMatchObject({ multaPct: 2, jurosMes: 1, pontualidadePct: 20, avisoDias: 10, atrasoDias: 0, avisoAtivo: false })
  })
})

describe('o desconto de pontualidade', () => {
  it('só até o vencimento e só para quem não pagou nada ainda', () => {
    const base = { devidoC: 40000, pagoC: 0, abonoC: 0, vencimento: dia('2026-09-10') }
    expect(abonoDeHoje(base, 5, em('2026-09-10', '19:00'))).toBe(2000)
    expect(abonoDeHoje(base, 5, em('2026-09-11', '08:00'))).toBe(0)
    expect(abonoDeHoje({ ...base, pagoC: 100 }, 5, em('2026-09-05', '08:00'))).toBe(0)
    expect(abonoDeHoje(base, 0, em('2026-09-05', '08:00'))).toBe(0)
  })

  it('a conta: devido = valor − bolsa; resta = devido − pago − abono', () => {
    const c = contaDaMensalidade({ valor: 450, desconto: 45, pago: 100, abono: 0 })
    expect(c).toEqual({ devidoC: 40500, pagoC: 10000, abonoC: 0, restaC: 30500 })
  })

  it('a situação: paga, em atraso, vence hoje, a receber, dispensada', () => {
    const agora = em('2026-09-10', '12:00')
    const s = (v: string, extra: Partial<{ quitadaEm: Date | null; canceladaEm: Date | null; restaC: number }> = {}) =>
      situacaoDaMensalidade({ quitadaEm: null, canceladaEm: null, vencimento: dia(v), restaC: 100, ...extra }, agora)
    expect(s('2026-09-09')).toBe('atrasada')
    expect(s('2026-09-10')).toBe('vence_hoje')
    expect(s('2026-09-11')).toBe('a_receber')
    expect(s('2026-09-09', { quitadaEm: agora })).toBe('paga')
    expect(s('2026-09-09', { canceladaEm: agora })).toBe('cancelada')
    expect(mesPorExtenso('2026-09')).toBe('setembro de 2026')
    expect(mesPorExtenso('2026-09', true)).toBe('set/2026')
  })
})

describe('turma, matrícula e responsável', () => {
  it('a turma confere o que importa, e o dia de vencimento vai até 28', () => {
    const ok = validarTurma({ unidadeId: 'u', nome: '1º ano A', mensalidade: 450, diaVencimento: 10, dias: [1, 3, 5, 9], horaInicio: '08:00', horaFim: '12:00', capacidade: 25 })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.limpo.dias).toEqual([1, 3, 5])
    expect(validarTurma({ unidadeId: 'u', nome: 'X', mensalidade: 450, diaVencimento: 10 }).ok).toBe(false)
    expect(validarTurma({ unidadeId: 'u', nome: 'Turma', mensalidade: 450, diaVencimento: 31 }).ok).toBe(false)
    expect(validarTurma({ unidadeId: 'u', nome: 'Turma', mensalidade: 450, diaVencimento: 10, horaInicio: '10:00', horaFim: '09:00' }).ok).toBe(false)
    expect(validarTurma({ unidadeId: 'u', nome: 'Turma', mensalidade: -1, diaVencimento: 10 }).ok).toBe(false)
    expect(horarioDaTurma({ dias: [5, 1, 3], horaInicio: '08:00', horaFim: '10:00' })).toBe('seg, qua e sex · 08:00–10:00')
  })

  it('quase cheia: a partir de 85%, ou faltando uma vaga', () => {
    expect(quaseCheia(17, 20)).toBe(true)
    expect(quaseCheia(4, 5)).toBe(true)
    expect(quaseCheia(10, 20)).toBe(false)
    expect(quaseCheia(10, null)).toBe(false)
  })

  it('cancelada e concluída não voltam; trancada volta', () => {
    expect(transicaoMatricula('ATIVA', 'TRANCADA')).toBe(true)
    expect(transicaoMatricula('TRANCADA', 'ATIVA')).toBe(true)
    expect(transicaoMatricula('CANCELADA', 'ATIVA')).toBe(false)
    expect(transicaoMatricula('CONCLUIDA', 'ATIVA')).toBe(false)
  })

  it('o responsável: o mínimo, e pelo menos um contato; CPF só se conferir', () => {
    expect(validarResponsavel({ nome: 'Maria', telefone: '(71) 99999-0000' }).ok).toBe(true)
    expect(validarResponsavel({ nome: 'Maria' }).ok).toBe(false)
    expect(validarResponsavel({ nome: 'Maria', telefone: '123' }).ok).toBe(false)
    expect(validarResponsavel({ nome: 'Maria', email: 'maria@x.com', documento: '111.111.111-11' }).ok).toBe(false)
  })
})

describe('o aviso da mensalidade ao responsável', () => {
  const m = { vencimento: dia('2026-09-10'), restaC: 45000, quitadaEm: null, canceladaEm: null, avisoEm: null, avisoAtrasoEm: null }

  it('texto fixo: valor, vencimento, como parar — e nada da vida escolar', () => {
    const t = textoDoAviso('antes', { responsavel: 'Maria Souza', aluno: 'Pedro Souza', escola: 'Escola Aprender', mes: '2026-09', vencimento: dia('2026-09-10'), valorCent: 45000 })
    expect(t).toMatch(/^Olá, Maria!/)
    expect(t).toMatch(/setembro de 2026 de Pedro na Escola Aprender vence em 10\/09/)
    expect(t).toMatch(/R\$\s?450,00/)
    expect(t).toMatch(/PARAR/)
    expect(t).not.toMatch(/Souza/)
    const a = textoDoAviso('atraso', { responsavel: null, aluno: 'Pedro', escola: 'Escola', mes: '2026-09', vencimento: dia('2026-09-10'), valorCent: 45000 })
    expect(a).toMatch(/^Olá!/)
    expect(a).toMatch(/venceu em 10\/09/)
  })

  it('antes: N dias antes até o dia; atraso: N dias depois, por uma semana; só de dia', () => {
    expect(pedeAviso(m, 3, 5, em('2026-09-07', '10:00'))).toBe('antes')
    expect(pedeAviso(m, 3, 5, em('2026-09-06', '10:00'))).toBe(null)
    expect(pedeAviso(m, 3, 5, em('2026-09-10', '10:00'))).toBe('antes')
    expect(pedeAviso(m, 3, 5, em('2026-09-08', '21:00'))).toBe(null)
    expect(pedeAviso(m, 3, 5, em('2026-09-15', '10:00'))).toBe('atraso')
    expect(pedeAviso(m, 3, 5, em('2026-09-23', '10:00'))).toBe(null)
    expect(pedeAviso(m, 3, 0, em('2026-09-15', '10:00'))).toBe(null)
    expect(pedeAviso({ ...m, avisoEm: new Date() }, 3, 5, em('2026-09-08', '10:00'))).toBe(null)
    expect(pedeAviso({ ...m, restaC: 0 }, 3, 5, em('2026-09-08', '10:00'))).toBe(null)
  })

  it('o número só recebe se TODOS os registros dele disseram sim', () => {
    expect(numeroAceitou(['SIM'])).toBe(true)
    expect(numeroAceitou(['SIM', 'SIM'])).toBe(true)
    expect(numeroAceitou(['SIM', 'NAO'])).toBe(false)
    expect(numeroAceitou(['SIM', 'NAO_PERGUNTADO'])).toBe(false)
    expect(numeroAceitou([])).toBe(false)
  })

  it('só a escola que ligou, com a Escola e o assistente no plano', () => {
    const o = { plano: 'BALCAO_AGENTE' as const, situacao: 'ATIVA' as const, modulos: ['escola', 'agente'], avisoMensalidadeAtivo: true }
    expect(avisoApto(o)).toBe(true)
    expect(avisoApto({ ...o, avisoMensalidadeAtivo: false })).toBe(false)
    expect(avisoApto({ ...o, plano: 'BALCAO' })).toBe(false)
    expect(avisoApto({ ...o, modulos: ['escola'] })).toBe(false)
    expect(avisoApto({ ...o, situacao: 'SUSPENSA' })).toBe(false)
  })
})

describe('quem pode o quê na escola', () => {
  const s = (papel: Papel): Sessao => ({ orgId: 'o', usuarioId: 'u', nome: papel, acessos: [{ papel, unidadeId: null }] })
  const tem = (papel: Papel) =>
    (['escola.ver', 'escola.matricular', 'escola.gerir', 'mensalidade.ver', 'mensalidade.receber', 'mensalidade.ajustar'] as const).filter((c) => pode(s(papel), c))

  it('dono e gerente: tudo', () => {
    expect(tem('DONO')).toHaveLength(6)
    expect(tem('GERENTE')).toHaveLength(6)
  })
  it('a secretaria (balcão) matricula e recebe; não mexe em preço nem dispensa', () => {
    expect(tem('BALCAO')).toEqual(['escola.ver', 'escola.matricular', 'mensalidade.ver', 'mensalidade.receber'])
  })
  it('o financeiro vê, recebe e dispensa; não matricula nem mexe na turma', () => {
    expect(tem('FINANCEIRO')).toEqual(['escola.ver', 'mensalidade.ver', 'mensalidade.receber', 'mensalidade.ajustar'])
  })
  it('o contador só lê as mensalidades; o suporte só lê', () => {
    expect(tem('CONTADOR')).toEqual(['mensalidade.ver'])
    expect(tem('SUPORTE')).toEqual(['escola.ver', 'mensalidade.ver'])
  })
  it('a secretaria presa à unidade 1 não recebe na unidade 2', () => {
    const sec: Sessao = { orgId: 'o', usuarioId: 'u', nome: 'Sec', acessos: [{ papel: 'BALCAO', unidadeId: 'u1' }] }
    expect(pode(sec, 'mensalidade.receber', 'u1')).toBe(true)
    expect(pode(sec, 'mensalidade.receber', 'u2')).toBe(false)
  })
})

describe('a escola no resto do sistema', () => {
  it('a palavra é "aluno", o painel é o da agenda, e o ramo sugere a Escola', () => {
    expect(vocabularioDoRamo('escola')).toMatchObject({ pessoa: 'aluno', Pessoas: 'Alunos', novo: 'Novo aluno' })
    expect(NICHOS.escola.familia).toBe('agenda')
    expect(RAMOS.escola.sugere).toContain('escola')
    const alunos = MENU('x').find((i) => i.href === '/x/clientes')
    expect(alunos?.vocabulario).toBe('Pessoas')
    const doModulo = MENU('x').filter((i) => i.modulo === 'escola').map((i) => i.titulo)
    expect(doModulo.sort()).toEqual(['Mensalidades', 'Turmas'])
  })

  it('a Escola é dos planos pagos, e o Grátis não tem', () => {
    expect(planoLibera('GRATIS', 'escola')).toBe(false)
    for (const p of ['BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO'] as const) expect(PLANOS[p].modulos).toContain('escola')
  })

  it('as ferramentas do assistente só existem com a Escola ligada', () => {
    const agente = { poderes: ['mensalidades.atrasadas', 'turmas.consultar', 'pagamentos.consultar'], descontoMaxPct: 5, valorMaxCent: 1000 }
    expect(ferramentasDe(agente, { modulos: ['escola'] })).toEqual(expect.arrayContaining(['mensalidades.atrasadas', 'turmas.consultar']))
    expect(ferramentasDe(agente, { modulos: [] })).not.toContain('mensalidades.atrasadas')
    expect(ferramentasDe(agente, { modulos: [] })).not.toContain('turmas.consultar')
  })

  it('o relatório da manhã traz o que vence hoje e o atraso', () => {
    const resumo = { atual: { vendas: 0, total: 0, ticket: 0 }, anterior: { vendas: 0, total: 0, ticket: 0 }, maisVendidos: [], porUnidade: [] }
    const t = textoDoRelatorio({
      nome: 'Ana',
      quando: 'manha',
      resumo: resumo as never,
      mensalidades: { vencemHoje: { quantas: 2, total: 900 }, atraso: { quantas: 3, total: 1350, alunos: 2 } },
    })
    expect(t).toMatch(/Mensalidades: 2 vencem hoje \(R\$\s?900,00\); 3 em atraso, R\$\s?1\.?350,00 de 2 alunos\./)
  })
})
