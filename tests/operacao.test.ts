// As regras puras da operação da equipe do Norte: o estado de um pedido
// deduzido do livro, a assinatura "Equipe Norte (...)", a leitura da linha
// de comando e o filtro que não deixa credencial chegar ao terminal.

import { describe, it, expect } from 'vitest'
import {
  lerPedidos,
  pedidosAbertos,
  pedidoAberto,
  pedidosParaTela,
  planoPeloTitulo,
  centavosDoTexto,
  recargaComoEvento,
  type EventoPedido,
} from '../src/servidor/pedidos'
import { quemDaEquipe } from '../src/servidor/assinatura'
import {
  lerArgumentos,
  limparSegredos,
  lerValorEmReais,
  validarHoras,
  validarMotivo,
  validarEmail,
  nomeDoCanal,
  impedimentoDoSuporte,
} from '../src/servidor/operacao'

const T0 = new Date('2026-09-20T12:00:00Z')
const dia = (n: number) => new Date(T0.getTime() + n * 864e5)

let seq = 0
const ev = (acao: string, quando: Date, extra: Partial<EventoPedido> = {}): EventoPedido => ({
  id: `ev-${++seq}`, acao, criadoEm: quando, alvoNome: null, motivo: null, depois: null, ...extra,
})
const pediuPlano = (plano: string, quando: Date) =>
  ev('plano.pediu', quando, { alvoNome: 'x', depois: { plano } })
const pediuCredito = (centavos: number, quando: Date) =>
  ev('credito.pediu', quando, { alvoNome: 'x', depois: { centavos } })

describe('o estado de um pedido, lido do livro', () => {
  it('pedido sem resposta está aberto', () => {
    const p = pediuPlano('REDE', dia(0))
    expect(pedidosAbertos([p])).toMatchObject([{ id: p.id, tipo: 'plano', plano: 'REDE', estado: 'aberto', oQue: 'plano Direção' }])
  })

  it('troca PARA o plano pedido atende; troca para outro, sem apontar, não', () => {
    const p = pediuPlano('REDE', dia(0))
    const outro = ev('plano.trocou', dia(1), { depois: { de: 'BALCAO_AGENTE', para: 'BALCAO' } })
    expect(pedidoAberto([p, outro], 'plano')?.id).toBe(p.id)
    const certo = ev('plano.trocou', dia(2), { depois: { de: 'BALCAO', para: 'REDE' } })
    expect(lerPedidos([p, outro, certo])[0]).toMatchObject({ estado: 'atendido', fechadoEm: dia(2) })
  })

  it('troca para outro plano atende quando a equipe aponta para o pedido', () => {
    const p = pediuPlano('REDE', dia(0))
    const t = ev('plano.trocou', dia(1), { depois: { para: 'BALCAO_AGENTE', pedidoId: p.id } })
    expect(lerPedidos([p, t])[0]!.estado).toBe('atendido')
  })

  it('linha antiga, sem `depois`: o título do plano basta', () => {
    const p = ev('plano.pediu', dia(0), { alvoNome: 'Direção' })
    const t = ev('plano.trocou', dia(1), { alvoNome: 'Direção' })
    expect(lerPedidos([p])[0]!.plano).toBe('REDE')
    expect(lerPedidos([p, t])[0]!.estado).toBe('atendido')
  })

  it('resposta ANTES do pedido não conta — a ordem de chegada não importa', () => {
    const t = ev('plano.trocou', dia(0), { depois: { para: 'REDE' } })
    const p = pediuPlano('REDE', dia(1))
    expect(pedidosAbertos([p, t]).map((x) => x.id)).toEqual([p.id])
  })

  it('pedido novo do mesmo tipo substitui o velho; tipos diferentes convivem', () => {
    const a = pediuPlano('BALCAO_AGENTE', dia(0))
    const b = pediuPlano('REDE', dia(1))
    const c = pediuCredito(20_000, dia(1))
    const todos = lerPedidos([a, b, c])
    expect(todos.find((x) => x.id === a.id)!.estado).toBe('substituido')
    expect(pedidosAbertos([a, b, c]).map((x) => x.id).sort()).toEqual([b.id, c.id].sort())
  })

  it('crédito: recarga COMPRA depois do pedido atende (é o que o gateway vai gravar)', () => {
    const p = pediuCredito(20_000, dia(0))
    const antes = recargaComoEvento({ id: 'r0', criadoEm: dia(-1) })
    expect(pedidoAberto([p, antes], 'credito')?.oQue).toBe('R$ 200,00 de crédito de IA')
    const depois = recargaComoEvento({ id: 'r1', criadoEm: dia(1) })
    expect(pedidoAberto([p, antes, depois], 'credito')).toBeNull()
  })

  it('crédito: `credito.recarregou` só atende o pedido para o qual aponta', () => {
    const p = pediuCredito(20_000, dia(0))
    const cortesia = ev('credito.recarregou', dia(1), { depois: { centavos: 500 } })
    expect(pedidoAberto([p, cortesia], 'credito')?.id).toBe(p.id)
    const atende = ev('credito.recarregou', dia(2), { depois: { centavos: 20_000, pedidoId: p.id } })
    expect(pedidoAberto([p, cortesia, atende], 'credito')).toBeNull()
  })

  it('recusa fecha só o tipo dela, e guarda o motivo', () => {
    const p = pediuPlano('REDE', dia(0))
    const c = pediuCredito(5_000, dia(0))
    const r = ev('pedido.recusou', dia(1), { motivo: 'Pagamento não confirmado.', depois: { tipo: 'plano', pedidoId: p.id } })
    const todos = lerPedidos([p, c, r])
    expect(todos.find((x) => x.id === p.id)).toMatchObject({ estado: 'recusado', motivoRecusa: 'Pagamento não confirmado.' })
    expect(todos.find((x) => x.id === c.id)!.estado).toBe('aberto')
  })

  it('recusa que aponta para OUTRO pedido (o velho, substituído) não fecha o novo', () => {
    const a = pediuPlano('BALCAO_AGENTE', dia(0))
    const b = pediuPlano('REDE', dia(1))
    const r = ev('pedido.recusou', dia(2), { depois: { tipo: 'plano', pedidoId: a.id } })
    expect(pedidoAberto([a, b, r], 'plano')?.id).toBe(b.id)
  })

  it('linha antiga de crédito: o valor sai do texto', () => {
    expect(centavosDoTexto('R$ 1234,56')).toBe(123456)
    expect(centavosDoTexto('Pediu R$ 50,00 de crédito')).toBe(5000)
    expect(centavosDoTexto('cinquenta')).toBeNull()
    expect(planoPeloTitulo('Assistente')).toBe('BALCAO_AGENTE')
    expect(planoPeloTitulo('Não existe')).toBeNull()
  })
})

describe('o que a tela da Assinatura mostra', () => {
  it('o aberto; a recusa recente; nada depois de atendido', () => {
    const p = pediuPlano('REDE', dia(0))
    expect(pedidosParaTela([p], dia(1)).plano?.estado).toBe('aberto')

    const r = ev('pedido.recusou', dia(1), { motivo: 'Sem pagamento.', depois: { tipo: 'plano', pedidoId: p.id } })
    expect(pedidosParaTela([p, r], dia(2)).plano).toMatchObject({ estado: 'recusado', motivoRecusa: 'Sem pagamento.' })
    // a recusa some depois de 30 dias
    expect(pedidosParaTela([p, r], dia(40)).plano).toBeUndefined()

    // pediu de novo e foi atendido: a recusa antiga não aparece mais
    const p2 = pediuPlano('REDE', dia(3))
    const t = ev('plano.trocou', dia(4), { depois: { para: 'REDE', pedidoId: p2.id } })
    expect(pedidosParaTela([p, r, p2, t], dia(5)).plano).toBeUndefined()
  })
})

describe('a assinatura da equipe no livro', () => {
  it('"Equipe Norte (nome)", e recusa o que não é nome', () => {
    expect(quemDaEquipe('  Rafa   Lima ')).toBe('Equipe Norte (Rafa Lima)')
    expect(quemDaEquipe('Equipe Norte (Rafa)')).toBe('Equipe Norte (Rafa)')
    expect(() => quemDaEquipe('')).toThrow(/--quem/)
    expect(() => quemDaEquipe('rafa@usenorte.com.br')).toThrow(/sem e-mail/)
    expect(() => quemDaEquipe('123')).toThrow()
    expect(() => quemDaEquipe('x'.repeat(61))).toThrow()
  })
})

describe('a linha de comando', () => {
  const SEM = ['confirmar', 'producao', 'sem-pedido']

  it('posicionais, opções com valor, e as que não levam valor não comem o próximo', () => {
    expect(lerArgumentos(['plano', '--confirmar', 'exemplo', 'REDE', '--quem', 'Ana Lima'], SEM)).toEqual({
      posicionais: ['plano', 'exemplo', 'REDE'],
      opcoes: { confirmar: true, quem: 'Ana Lima' },
    })
  })

  it('valor negativo é posicional; --x=y funciona; opção no fim vira verdadeiro', () => {
    expect(lerArgumentos(['credito', 'exemplo', '-50', '--tipo=AJUSTE', '--motivo'], SEM)).toEqual({
      posicionais: ['credito', 'exemplo', '-50'],
      opcoes: { tipo: 'AJUSTE', motivo: true },
    })
  })

  it('reais em centavos, sem ponto flutuante e sem adivinhar', () => {
    expect(lerValorEmReais('150')).toBe(15000)
    expect(lerValorEmReais('150,5')).toBe(15050)
    expect(lerValorEmReais('0.1')).toBe(10)
    expect(lerValorEmReais('1.234,56')).toBe(123456)
    expect(lerValorEmReais('R$ 200')).toBe(20000)
    expect(lerValorEmReais('-20,00')).toBe(-2000)
    expect(lerValorEmReais('1.234')).toBeNull()
    expect(lerValorEmReais('dez')).toBeNull()
  })

  it('horas de 1 a 72, motivo de verdade, e-mail normalizado', () => {
    expect(validarHoras('4')).toBe(4)
    for (const ruim of ['0', '73', '2.5', '', 'abc', '-1']) expect(() => validarHoras(ruim)).toThrow()
    expect(validarMotivo('  chamado   4412  ')).toBe('chamado 4412')
    expect(() => validarMotivo('ok')).toThrow(/--motivo/)
    expect(() => validarMotivo(true)).toThrow()
    expect(validarEmail(' Rafa@UseNorte.com.br ')).toBe('rafa@usenorte.com.br')
    expect(() => validarEmail('rafa')).toThrow()
  })

  it('o canal do WhatsApp como a equipe fala', () => {
    expect(['NENHUM', 'PROPRIO', 'META', 'ZAPI', undefined].map(nomeDoCanal)).toEqual(['nenhum', 'QR', 'Meta', 'Z-API', 'nenhum'])
  })
})

describe('o filtro de credencial', () => {
  it('senha de URL postgres vira ***, o resto da URL fica', () => {
    const t = 'falhou: postgresql://postgres.abc:S3nh@F0rte@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'
    const limpo = limparSegredos(t)
    expect(limpo).not.toContain('S3nh')
    expect(limpo).not.toContain('F0rte')
    expect(limpo).toBe('falhou: postgresql://postgres.abc:***@aws-0-sa-east-1.pooler.supabase.com:6543/postgres')
  })

  it('valor de variável com cara de segredo some onde aparecer; o resto não é tocado', () => {
    const amb = { SEGREDO_SESSAO: 'abcdef123456', SENHA_APP: 'curta', NORTE_OPERADOR: 'Rafa', DATABASE_URL_ADMIN: 'postgres://x' }
    expect(limparSegredos('token abcdef123456 e curta e Rafa', amb)).toBe('token *** e curta e Rafa')
  })
})

describe('quem pode receber acesso de suporte', () => {
  const base = { usuario: null, ehDaLoja: false, suporte: null }
  it('conta nova da equipe pode; gente da loja e conta desativada pela loja, não', () => {
    expect(impedimentoDoSuporte(base)).toBeNull()
    expect(impedimentoDoSuporte({ ...base, ehDaLoja: true })).toMatch(/empresa cliente/)
    expect(impedimentoDoSuporte({ ...base, usuario: { id: 'u', nome: 'S', ativo: false, temSenha: true } })).toMatch(/desativou/)
  })
  it('com domínio da equipe configurado, só e-mail dele', () => {
    expect(impedimentoDoSuporte(base, 'usenorte.com.br', 'rafa@gmail.com')).toMatch(/@usenorte/)
    expect(impedimentoDoSuporte(base, 'usenorte.com.br', 'rafa@usenorte.com.br')).toBeNull()
  })
})
