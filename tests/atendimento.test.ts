// O atendimento, sem banco: o vocabulário de cada ramo, a conta do ponto, a
// agenda (sobreposição, livres, funcionamento), o recebimento da compra, o
// lembrete e quem pode o quê. As partes com banco estão em
// atendimento-banco.test.ts.

import { describe, it, expect } from 'vitest'
import { vocabularioDoRamo } from '../src/servidor/vocabulario'
import { folhaDoMes, lerJornada, montarTurnos, proximaBatida, horas, diasDoMes, type Batida } from '../src/servidor/ponto'
import { dentroDoHorario, duracaoValida, horariosLivres, resumirDia, sobrepoe, transicaoAgenda, validarHorario } from '../src/servidor/agenda'
import { conferirRecebimento, falta, situacaoDepois, valorDoPedido } from '../src/servidor/compras'
import { lembreteApto, pedeLembrete, textoDoLembrete } from '../src/servidor/lembretes'
import { lerHorario } from '../src/servidor/campanhas/horario'
import { PODERES, pode, type Papel, type Sessao } from '../src/servidor/permissao'
import { MODULOS, RAMOS, TODOS } from '../src/servidor/modulos'
import { NICHOS, tituloDoNicho } from '../src/servidor/nicho'
import { PLANOS } from '../src/servidor/planos'
import { deSP } from '../src/servidor/encomenda'

const em = (dia: string, hora: string) => deSP(dia, hora)!
const b = (id: string, tipo: 'ENTRADA' | 'SAIDA', dia: string, hora: string): Batida => ({ id, tipo, em: em(dia, hora) })

// ─────────────────────────────────────────────────────────────
describe('o vocabulário de cada ramo', () => {
  it('clínica fala paciente, escola fala aluno, o resto fala cliente', () => {
    expect(vocabularioDoRamo('saude').Pessoas).toBe('Pacientes')
    expect(vocabularioDoRamo('saude').novo).toBe('Novo paciente')
    expect(vocabularioDoRamo('escola').Pessoas).toBe('Alunos')
    expect(vocabularioDoRamo('beleza').Pessoas).toBe('Clientes')
    expect(vocabularioDoRamo('roupa').pessoa).toBe('cliente')
    expect(vocabularioDoRamo(null).Pessoas).toBe('Clientes')
    expect(vocabularioDoRamo('nao-existe').Pessoas).toBe('Clientes')
    // "toString" é propriedade de todo objeto: não pode virar ramo.
    expect(vocabularioDoRamo('toString').Pessoas).toBe('Clientes')
  })

  it('só a clínica leva o aviso de que informação de saúde não entra na observação', () => {
    expect(vocabularioDoRamo('saude').avisoObservacao).toMatch(/saúde/)
    expect(vocabularioDoRamo('beleza').avisoObservacao).toBeNull()
    expect(vocabularioDoRamo('escola').avisoObservacao).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
describe('os ramos de serviço', () => {
  it('os três existem, com família agenda no painel', () => {
    for (const r of ['beleza', 'saude', 'escola'] as const) {
      expect(RAMOS[r].titulo.length).toBeGreaterThan(3)
      expect(NICHOS[r].familia).toBe('agenda')
    }
    expect(tituloDoNicho('beleza', 1)).toBe('Hoje no seu salão')
    expect(tituloDoNicho('saude', 1)).toBe('Hoje na sua clínica')
    expect(tituloDoNicho('saude', 2)).toBe('Hoje nas suas clínicas')
  })

  it('cada ramo sugere os módulos certos — e só módulos que existem', () => {
    expect([...RAMOS.beleza.sugere].sort()).toEqual(['agenda', 'compras'])
    expect([...RAMOS.saude.sugere].sort()).toEqual(['agenda', 'compras', 'ponto'])
    // O assistente: é ele que manda o aviso da mensalidade no WhatsApp.
    expect([...RAMOS.escola.sugere].sort()).toEqual(['agente', 'escola', 'ponto'])
    for (const r of Object.values(RAMOS)) for (const m of r.sugere) expect(TODOS).toContain(m)
  })

  it('o manual da clínica proíbe orientação médica e prontuário', () => {
    expect(RAMOS.saude.manual).toMatch(/NUNCA dá orientação médica/)
    expect(RAMOS.saude.manual).toMatch(/prontuário/)
  })

  // Tabela de 06/10/2026: o ponto vem nos dois planos; agenda e compras, do Profissional para cima.
  it('os módulos novos têm pergunta para o cadastro e entram nos planos pagos certos', () => {
    for (const m of ['agenda', 'ponto', 'compras'] as const) {
      expect(MODULOS[m].pergunta.endsWith('?')).toBe(true)
      expect(PLANOS.GRATIS.modulos).not.toContain(m)
      for (const p of ['BALCAO_AGENTE', 'REDE', 'CORPORATIVO'] as const) expect(PLANOS[p].modulos).toContain(m)
    }
    expect(PLANOS.BALCAO.modulos).toContain('ponto')
    expect(PLANOS.BALCAO.modulos).not.toContain('agenda')
    expect(PLANOS.BALCAO.modulos).not.toContain('compras')
  })
})

// ─────────────────────────────────────────────────────────────
describe('a conta do ponto', () => {
  const agora = em('2026-09-24', '12:00') // quinta
  const jornada = [0, 480, 480, 480, 480, 480, 240] // seg a sex 8h, sáb 4h

  it('entrada e saída viram um turno fechado com os minutos', () => {
    const t = montarTurnos([b('1', 'ENTRADA', '2026-09-21', '09:00'), b('2', 'SAIDA', '2026-09-21', '17:30')], agora)
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ situacao: 'fechado', minutos: 510, dia: '2026-09-21' })
  })

  it('o turno que passa da meia-noite é do dia em que começou', () => {
    const t = montarTurnos([b('1', 'ENTRADA', '2026-09-22', '22:00'), b('2', 'SAIDA', '2026-09-23', '06:00')], agora)
    expect(t[0]).toMatchObject({ situacao: 'fechado', minutos: 480, dia: '2026-09-22' })
    const f = folhaDoMes([b('1', 'ENTRADA', '2026-09-22', '22:00'), b('2', 'SAIDA', '2026-09-23', '06:00')], jornada, '2026-09', agora)
    expect(f.dias.find((d) => d.dia === '2026-09-22')!.trabalhado).toBe(480)
    expect(f.dias.find((d) => d.dia === '2026-09-23')!.trabalhado).toBe(0)
  })

  it('o turno que começou no mês anterior não entra neste mês', () => {
    const f = folhaDoMes([b('1', 'ENTRADA', '2026-08-31', '22:00'), b('2', 'SAIDA', '2026-09-01', '06:00')], [], '2026-09', agora)
    expect(f.totais.trabalhado).toBe(0)
  })

  it('entrada recente sem saída é "trabalhando agora"; antiga é "sem saída" e fica pendente', () => {
    const aberto = montarTurnos([b('1', 'ENTRADA', '2026-09-24', '08:00')], agora)
    expect(aberto[0]!.situacao).toBe('aberto')
    expect(proximaBatida([b('1', 'ENTRADA', '2026-09-24', '08:00')], agora)).toBe('SAIDA')

    const esquecida = montarTurnos([b('1', 'ENTRADA', '2026-09-22', '08:00')], agora)
    expect(esquecida[0]!.situacao).toBe('sem_saida')
    expect(proximaBatida([b('1', 'ENTRADA', '2026-09-22', '08:00')], agora)).toBe('ENTRADA')

    const f = folhaDoMes([b('1', 'ENTRADA', '2026-09-22', '08:00')], jornada, '2026-09', agora)
    expect(f.dias.find((d) => d.dia === '2026-09-22')).toMatchObject({ pendente: true, trabalhado: 0, falta: false })
    expect(f.totais.pendencias).toBe(1)
  })

  it('duas entradas seguidas: a primeira fica sem saída, a segunda abre o turno', () => {
    const t = montarTurnos([b('1', 'ENTRADA', '2026-09-24', '08:00'), b('2', 'ENTRADA', '2026-09-24', '09:00')], agora)
    expect(t.map((x) => x.situacao)).toEqual(['sem_saida', 'aberto'])
  })

  it('o AJUSTE (a saída lançada depois) fecha o turno; a batida anulada não entra na conta', () => {
    // A anulação é filtrada antes (folhaDe manda só as válidas): aqui a
    // saída errada das 23h foi anulada e a certa, das 17h, entrou por ajuste.
    const validas = [b('1', 'ENTRADA', '2026-09-21', '09:00'), b('ajuste', 'SAIDA', '2026-09-21', '17:00')]
    const f = folhaDoMes(validas, jornada, '2026-09', agora)
    expect(f.dias.find((d) => d.dia === '2026-09-21')).toMatchObject({ trabalhado: 480, extra: 0, pendente: false })
  })

  it('extras por dia, faltas só em dia de trabalho que já acabou, diferença contra o combinado até hoje', () => {
    const batidas = [
      b('1', 'ENTRADA', '2026-09-21', '08:00'), b('2', 'SAIDA', '2026-09-21', '18:00'), // seg: 10h (2h extra)
      b('3', 'ENTRADA', '2026-09-22', '09:00'), b('4', 'SAIDA', '2026-09-22', '13:00'), // ter: 4h
      // qua 23: nada → falta
      b('5', 'ENTRADA', '2026-09-24', '08:00'), // qui: aberto, hoje
    ]
    const f = folhaDoMes(batidas, jornada, '2026-09', agora)
    const d = (dia: string) => f.dias.find((x) => x.dia === dia)!
    expect(d('2026-09-21')).toMatchObject({ trabalhado: 600, extra: 120 })
    expect(d('2026-09-23').falta).toBe(true)
    expect(d('2026-09-24').falta).toBe(false) // hoje ainda não acabou
    expect(d('2026-09-20').falta).toBe(false) // domingo é folga
    expect(f.aberto).not.toBeNull()
    expect(f.totais.extras).toBe(120)
    // 1..24 de setembro: dias úteis e sábados até hoje, inclusive
    expect(f.totais.previsto).toBe(diasDoMes('2026-09').filter((x) => x <= '2026-09-24').reduce((s, x) => s + jornada[new Date(`${x}T12:00:00Z`).getUTCDay()]!, 0))
    expect(f.totais.diferenca).toBe(f.totais.trabalhado - f.totais.previsto)
  })

  it('antes de a ficha existir não há jornada nem falta', () => {
    const f = folhaDoMes([], jornada, '2026-09', agora, '2026-09-22')
    expect(f.totais.faltas).toBe(2) // terça 22 e quarta 23; a quinta 24 é hoje e ainda não acabou
    expect(f.dias.find((d) => d.dia === '2026-09-21')).toMatchObject({ previsto: 0, falta: false })
  })

  it('sem jornada não há extra nem falta: só as horas', () => {
    const f = folhaDoMes([b('1', 'ENTRADA', '2026-09-21', '08:00'), b('2', 'SAIDA', '2026-09-21', '20:00')], [], '2026-09', agora)
    expect(f.totais).toMatchObject({ trabalhado: 720, extras: 0, faltas: 0, previstoMes: 0 })
  })

  it('a jornada da tela, em horas, vira minutos; lixo e excesso são recusados', () => {
    expect(lerJornada(['', '8', '8', '8', '8', '8', '4,5'])).toEqual({ ok: true, jornada: [0, 480, 480, 480, 480, 480, 270] })
    expect(lerJornada(['', '', '', '', '', '', ''])).toEqual({ ok: true, jornada: [] })
    expect(lerJornada(['', '17', '', '', '', '', '']).ok).toBe(false)
    expect(lerJornada(['', 'oito', '', '', '', '', '']).ok).toBe(false)
    expect(lerJornada(['8']).ok).toBe(false)
  })

  it('as horas se escrevem como na folha', () => {
    expect(horas(510)).toBe('8h30')
    expect(horas(480)).toBe('8h')
    expect(horas(45)).toBe('45 min')
    expect(horas(-90)).toBe('−1h30')
  })
})

// ─────────────────────────────────────────────────────────────
describe('a agenda', () => {
  const h = lerHorario('Seg a sex 9h-18h, sáb 9h-13h')
  const agora = em('2026-09-24', '07:00') // quinta cedo

  it('encostar não é sobrepor', () => {
    const a = { inicio: em('2026-09-24', '09:00'), fim: em('2026-09-24', '10:00') }
    expect(sobrepoe(a, { inicio: em('2026-09-24', '10:00'), fim: em('2026-09-24', '11:00') })).toBe(false)
    expect(sobrepoe(a, { inicio: em('2026-09-24', '09:30'), fim: em('2026-09-24', '10:30') })).toBe(true)
    expect(sobrepoe(a, { inicio: em('2026-09-24', '08:00'), fim: em('2026-09-24', '12:00') })).toBe(true)
  })

  it('dentro do funcionamento da loja — e horário ilegível não trava', () => {
    expect(dentroDoHorario(h, { inicio: em('2026-09-24', '17:00'), fim: em('2026-09-24', '18:00') })).toBe(true)
    expect(dentroDoHorario(h, { inicio: em('2026-09-24', '17:30'), fim: em('2026-09-24', '18:30') })).toBe(false)
    expect(dentroDoHorario(h, { inicio: em('2026-09-27', '10:00'), fim: em('2026-09-27', '11:00') })).toBe(false) // domingo
    expect(dentroDoHorario(null, { inicio: em('2026-09-27', '03:00'), fim: em('2026-09-27', '04:00') })).toBe(true)
  })

  it('os livres pulam o que está ocupado, o que já passou e o fim do expediente', () => {
    const ocupados = [{ inicio: em('2026-09-24', '10:00'), fim: em('2026-09-24', '11:00') }]
    const livres = horariosLivres({ horario: h, dia: '2026-09-24', ocupados, duracaoMin: 60, passoMin: 60 }, em('2026-09-24', '09:10'))
    const horasLivres = livres.map((d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d))
    expect(horasLivres).toEqual(['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'])
  })

  it('a duração vem do serviço quando não é informada; fora de 5 min a 12 h é recusada', () => {
    expect(duracaoValida(null, 45)).toBe(45)
    expect(duracaoValida(90, 45)).toBe(90)
    expect(duracaoValida(null, null)).toBe(30)
    expect(duracaoValida(2, null)).toBeNull()
    expect(duracaoValida(13 * 60, null)).toBeNull()
  })

  it('o que vem da tela: quem, para quem, o quê e quando', () => {
    const base = { unidadeId: 'u', colaboradorId: 'c', clienteNome: 'Joana', servico: 'Manicure', dia: '2026-09-25', hora: '15:00' }
    expect(validarHorario(base).ok).toBe(true)
    expect(validarHorario({ ...base, clienteNome: '' }).ok).toBe(false)
    expect(validarHorario({ ...base, servico: '' }).ok).toBe(false)
    expect(validarHorario({ ...base, dia: '2026-02-30' }).ok).toBe(false)
    expect(validarHorario({ ...base, telefone: '123' }).ok).toBe(false)
  })

  it('atendido, faltou e desmarcado não voltam; confirmado volta para marcado', () => {
    expect(transicaoAgenda('MARCADO', 'CONFIRMADO')).toBe(true)
    expect(transicaoAgenda('CONFIRMADO', 'MARCADO')).toBe(true)
    expect(transicaoAgenda('ATENDIDO', 'MARCADO')).toBe(false)
    expect(transicaoAgenda('FALTOU', 'ATENDIDO')).toBe(false)
    expect(transicaoAgenda('CANCELADO', 'MARCADO')).toBe(false)
  })

  it('o resumo do dia conta cada situação e só oferece livre onde cabe', () => {
    const lista = [
      { situacao: 'CONFIRMADO', inicio: em('2026-09-24', '09:00'), fim: em('2026-09-24', '10:00'), colaboradorId: 'bia' },
      { situacao: 'FALTOU', inicio: em('2026-09-24', '10:00'), fim: em('2026-09-24', '11:00'), colaboradorId: 'bia' },
      { situacao: 'CANCELADO', inicio: em('2026-09-24', '11:00'), fim: em('2026-09-24', '12:00'), colaboradorId: 'bia' },
    ].map((a, i) => ({ id: String(i), unidadeId: 'u', unidadeNome: 'L', colaboradorNome: 'Bia', clienteId: null, clienteNome: 'X', telefone: null, produtoId: null, servico: 's', observacao: null, motivo: null, vendaId: null, lembrete: null, quem: 'q', ...a })) as Parameters<typeof resumirDia>[0]
    const r = resumirDia(lista, [{ id: 'bia', nome: 'Bia', cargo: null }], h, '2026-09-24', agora)
    expect(r).toMatchObject({ total: 1, confirmados: 1, faltas: 1, desmarcados: 1, atendidos: 0 })
    // o horário da falta e o do desmarcado voltaram a ficar livres
    const livres = r.livres[0]!.horarios.map((d) => d.getTime())
    expect(livres).toContain(em('2026-09-24', '10:00').getTime())
    expect(livres).not.toContain(em('2026-09-24', '09:00').getTime())
  })
})

// ─────────────────────────────────────────────────────────────
describe('o recebimento da compra', () => {
  const itens = [
    { id: 'i1', descricao: 'Esmalte vermelho', quantidade: 10, recebido: 4, custoUnit: 5 },
    { id: 'i2', descricao: 'Acetona', quantidade: 2, recebido: 0, custoUnit: null },
  ]

  it('não recebe mais do que falta', () => {
    expect(falta(itens[0]!)).toBe(6)
    const r = conferirRecebimento(itens, [{ itemId: 'i1', quantidade: 7 }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/faltava chegar 6/)
  })

  it('o custo que não veio fica o combinado; item de outro pedido e item repetido são recusados', () => {
    const r = conferirRecebimento(itens, [{ itemId: 'i1', quantidade: 6 }, { itemId: 'i2', quantidade: 0 }])
    expect(r).toEqual({ ok: true, linhas: [{ itemId: 'i1', quantidade: 6, custoUnit: 5 }] })
    expect(conferirRecebimento(itens, [{ itemId: 'outro', quantidade: 1 }]).ok).toBe(false)
    expect(conferirRecebimento(itens, [{ itemId: 'i2', quantidade: 1 }, { itemId: 'i2', quantidade: 1 }]).ok).toBe(false)
    expect(conferirRecebimento(itens, [{ itemId: 'i2', quantidade: 0 }]).ok).toBe(false)
  })

  it('chegou tudo é RECEBIDO; faltou alguma coisa é PARCIAL; o valor soma só o que tem custo', () => {
    expect(situacaoDepois([{ quantidade: 10, recebido: 10 }, { quantidade: 2, recebido: 2 }])).toBe('RECEBIDO')
    expect(situacaoDepois([{ quantidade: 10, recebido: 10 }, { quantidade: 2, recebido: 1 }])).toBe('PARCIAL')
    expect(valorDoPedido(itens)).toBe(5000)
  })
})

// ─────────────────────────────────────────────────────────────
describe('o lembrete do horário', () => {
  const inicio = em('2026-09-25', '15:00')
  const base = { inicio, criadoEm: em('2026-09-20', '10:00'), situacao: 'MARCADO' as const, lembreteEm: null }

  it('sai dentro da janela, entre 8h e 20h, uma vez, e só para horário de pé', () => {
    expect(pedeLembrete(base, 24, em('2026-09-24', '15:30'))).toBe(true)
    expect(pedeLembrete(base, 24, em('2026-09-24', '14:00'))).toBe(false) // antes da janela
    expect(pedeLembrete(base, 24, em('2026-09-25', '14:30'))).toBe(false) // última hora
    expect(pedeLembrete({ ...base, lembreteEm: em('2026-09-24', '15:30') }, 24, em('2026-09-24', '16:00'))).toBe(false)
    expect(pedeLembrete({ ...base, situacao: 'CANCELADO' }, 24, em('2026-09-24', '16:00'))).toBe(false)
    expect(pedeLembrete(base, 48, em('2026-09-24', '03:00'))).toBe(false) // madrugada
  })

  it('horário marcado em cima da hora não ganha lembrete', () => {
    expect(pedeLembrete({ ...base, criadoEm: em('2026-09-25', '13:00') }, 24, em('2026-09-25', '13:05'))).toBe(false)
  })

  it('o texto é fixo: loja, dia, hora e o PARAR — nunca o serviço', () => {
    const t = textoDoLembrete({ nome: 'Joana Lima', loja: 'Clínica Exemplo', inicio })
    expect(t).toMatch(/^Olá, Joana! Lembrete do seu horário na Clínica Exemplo: sex 25\/09 às 15:00\./)
    expect(t).toMatch(/responda PARAR/)
  })

  it('só com a chave ligada, a Agenda e o assistente no plano e ligados', () => {
    const org = { plano: 'BALCAO_AGENTE' as const, situacao: 'ATIVA' as const, modulos: ['agenda', 'agente'], lembreteAtivo: true }
    expect(lembreteApto(org)).toBe(true)
    expect(lembreteApto({ ...org, lembreteAtivo: false })).toBe(false)
    expect(lembreteApto({ ...org, modulos: ['agenda'] })).toBe(false)
    expect(lembreteApto({ ...org, plano: 'BALCAO' })).toBe(false) // o Balcão não tem assistente
    expect(lembreteApto({ ...org, situacao: 'SUSPENSA' })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
describe('quem pode o quê no atendimento', () => {
  const s = (papel: Papel): Sessao => ({ orgId: 'o', usuarioId: 'u', nome: papel, acessos: [{ papel, unidadeId: null }] })

  it('a recepção (balcão) marca, bate o próprio ponto e anota material — sem ver horas alheias nem custo de compra', () => {
    const balcao = s('BALCAO')
    for (const c of ['agenda.ver', 'agenda.marcar', 'ponto.proprio', 'estoque.consumir'] as const) expect(pode(balcao, c), c).toBe(true)
    for (const c of ['ponto.ver', 'ponto.gerir', 'compra.ver', 'compra.gerir'] as const) expect(pode(balcao, c), c).toBe(false)
  })

  it('o contador lê compras e horas, e não escreve nada', () => {
    const c = s('CONTADOR')
    expect(pode(c, 'compra.ver')).toBe(true)
    expect(pode(c, 'ponto.ver')).toBe(true)
    for (const x of ['compra.gerir', 'ponto.gerir', 'ponto.proprio', 'agenda.marcar', 'estoque.consumir'] as const) expect(pode(c, x), x).toBe(false)
  })

  it('gerente e dono tocam tudo; o financeiro vê compras e horas sem mexer', () => {
    for (const p of ['DONO', 'GERENTE'] as Papel[]) {
      for (const x of ['agenda.marcar', 'ponto.gerir', 'compra.gerir', 'estoque.consumir'] as const) expect(pode(s(p), x), `${p} ${x}`).toBe(true)
    }
    const f = s('FINANCEIRO')
    expect(pode(f, 'compra.ver') && pode(f, 'ponto.ver')).toBe(true)
    expect(pode(f, 'compra.gerir') || pode(f, 'ponto.gerir') || pode(f, 'agenda.marcar')).toBe(false)
  })

  it('o suporte só lê', () => {
    const sup = PODERES.SUPORTE
    expect(sup).toContain('agenda.ver')
    expect(sup).not.toContain('agenda.marcar')
    expect(sup).not.toContain('compra.gerir')
  })
})
