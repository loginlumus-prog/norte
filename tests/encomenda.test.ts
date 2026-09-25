import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { subirBanco, semear, comoApp } from './banco'
import {
  agrupar,
  deSP,
  diaEmSP,
  ehFinal,
  faltaPagar,
  grupoDa,
  horaEmSP,
  linkWhatsApp,
  resumirEncomendas,
  somarDias,
  transicaoPermitida,
  validarEncomenda,
  SITUACOES_ENCOMENDA,
  type DadosEncomenda,
  type SituacaoEncomenda,
} from '../src/servidor/encomenda'

// A encomenda é a promessa com hora marcada. Estes testes conferem as três
// coisas que, erradas, fazem o bolo sair no dia errado ou o dinheiro contar
// duas vezes: o fuso, a conta do que falta e as portas que não voltam.

// Quinta-feira, 24/09/2026, 14:00 em São Paulo (17:00 UTC).
const AGORA = new Date('2026-09-24T17:00:00.000Z')

const em = (dia: string, hora: string) => deSP(dia, hora)!

describe('a hora é a da loja, não a do servidor', () => {
  it('15:00 em São Paulo é 18:00 em UTC, e volta igual', () => {
    const d = em('2026-09-26', '15:00')
    expect(d.toISOString()).toBe('2026-09-26T18:00:00.000Z')
    expect(diaEmSP(d)).toBe('2026-09-26')
    expect(horaEmSP(d)).toBe('15:00')
  })

  it('22:30 em São Paulo já é o dia seguinte em UTC — e continua sendo o mesmo dia na loja', () => {
    const d = em('2026-09-24', '22:30')
    expect(d.toISOString()).toBe('2026-09-25T01:30:00.000Z')
    expect(diaEmSP(d)).toBe('2026-09-24')
  })

  it('data ou hora que não existem viram null', () => {
    expect(deSP('2026-02-30', '10:00')).toBeNull()
    expect(deSP('2026-09-24', '25:00')).toBeNull()
    expect(deSP('24/09/2026', '10:00')).toBeNull()
    expect(deSP('2026-09-24', '')).toBeNull()
  })

  it('somar dias atravessa o mês e o ano', () => {
    expect(somarDias('2026-09-30', 1)).toBe('2026-10-01')
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01')
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('as faixas da lista, no fuso de São Paulo', () => {
  const aberta = (dia: string, hora: string, situacao: SituacaoEncomenda = 'ABERTA') => ({
    para: em(dia, hora),
    situacao,
  })

  it('passou da hora e não saiu: atrasada — mesmo sendo de hoje', () => {
    expect(grupoDa(aberta('2026-09-24', '10:00'), AGORA)).toBe('atrasadas')
    expect(grupoDa(aberta('2026-09-20', '10:00', 'PRONTA'), AGORA)).toBe('atrasadas')
  })

  it('hoje mais tarde é Hoje; 23:30 de hoje ainda é hoje (em UTC já seria amanhã)', () => {
    expect(grupoDa(aberta('2026-09-24', '16:00'), AGORA)).toBe('hoje')
    expect(grupoDa(aberta('2026-09-24', '23:30'), AGORA)).toBe('hoje')
  })

  it('amanhã, esta semana (até o sexto dia) e depois', () => {
    expect(grupoDa(aberta('2026-09-25', '00:15'), AGORA)).toBe('amanha')
    expect(grupoDa(aberta('2026-09-26', '09:00'), AGORA)).toBe('semana')
    expect(grupoDa(aberta('2026-09-30', '18:00'), AGORA)).toBe('semana')
    expect(grupoDa(aberta('2026-10-01', '08:00'), AGORA)).toBe('depois')
  })

  it('entregue e cancelada nunca atrasam', () => {
    expect(grupoDa(aberta('2026-09-24', '10:00', 'ENTREGUE'), AGORA)).toBe('passadas')
    expect(grupoDa(aberta('2026-09-20', '10:00', 'CANCELADA'), AGORA)).toBe('passadas')
    expect(grupoDa(aberta('2026-09-26', '10:00', 'ENTREGUE'), AGORA)).toBe('semana')
  })

  it('agrupa na ordem de urgência, cada faixa pelo que vence primeiro', () => {
    const lista = [
      { id: 'depois', ...aberta('2026-10-10', '10:00') },
      { id: 'hoje-2', ...aberta('2026-09-24', '18:00') },
      { id: 'atrasada', ...aberta('2026-09-23', '09:00') },
      { id: 'hoje-1', ...aberta('2026-09-24', '15:00') },
      { id: 'amanha', ...aberta('2026-09-25', '10:00') },
    ]
    const g = agrupar(lista, AGORA)
    expect(g.map((x) => x.titulo)).toEqual(['Atrasadas', 'Hoje', 'Amanhã', 'Depois'])
    expect(g[1]!.itens.map((i) => i.id)).toEqual(['hoje-1', 'hoje-2'])
  })

  it('o resumo conta só o que está em aberto e soma o que falta receber', () => {
    const r = resumirEncomendas(
      [
        { ...aberta('2026-09-23', '09:00'), valor: 100, sinal: 30 },
        { ...aberta('2026-09-24', '18:00'), valor: 80, sinal: 80 },
        { ...aberta('2026-09-25', '10:00', 'PRONTA'), valor: 50.1, sinal: 0.2 },
        { ...aberta('2026-09-28', '10:00'), valor: 10, sinal: 0 },
        { ...aberta('2026-09-25', '10:00', 'ENTREGUE'), valor: 999, sinal: 0 },
      ],
      AGORA,
    )
    expect(r).toEqual({ atrasadas: 1, hoje: 1, semana: 2, aReceber: 129.9, comSaldo: 3 })
  })
})

describe('o que falta pagar', () => {
  it('valor menos sinal, em centavos exatos', () => {
    expect(faltaPagar(120, 50)).toBe(70)
    expect(faltaPagar('44.90', '0.30')).toBe(44.6)
    expect(faltaPagar(0.3, 0.1)).toBe(0.2)
  })
  it('nunca negativo, e zero quando o sinal cobre tudo', () => {
    expect(faltaPagar(80, 80)).toBe(0)
    expect(faltaPagar(80, 90)).toBe(0)
  })
})

describe('validações', () => {
  const base: DadosEncomenda = {
    unidadeId: 'uni-a1',
    clienteNome: 'Maria Souza',
    telefone: '(71) 99999-0000',
    descricao: 'Bolo de chocolate 2 kg',
    valor: 120,
    sinal: 50,
    dia: '2026-09-26',
    hora: '15:00',
    entrega: false,
  }
  const erro = (d: Partial<DadosEncomenda>) => {
    const r = validarEncomenda({ ...base, ...d }, AGORA)
    return r.ok ? null : r.erro
  }

  it('o caso comum passa, com a hora convertida e o telefone só em dígitos', () => {
    const r = validarEncomenda(base, AGORA)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.limpo.para.toISOString()).toBe('2026-09-26T18:00:00.000Z')
    expect(r.limpo.telefone).toBe('71999990000')
    expect(r.limpo.valorC).toBe(12000)
    expect(r.limpo.sinalC).toBe(5000)
  })

  it('sinal maior que o valor é recusado; igual passa', () => {
    expect(erro({ sinal: 120.01 })).toMatch(/sinal não pode ser maior/)
    expect(erro({ sinal: 120 })).toBeNull()
  })

  it('valores negativos ou que não são número são recusados; zero passa', () => {
    expect(erro({ valor: -1 })).toMatch(/valor/)
    expect(erro({ sinal: -5 })).toMatch(/sinal/)
    expect(erro({ valor: Number.NaN })).toMatch(/valor/)
    expect(erro({ valor: 0, sinal: 0 })).toBeNull()
  })

  it('data no passado só com confirmação explícita', () => {
    const r = validarEncomenda({ ...base, dia: '2026-09-24', hora: '10:00' }, AGORA)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.pedeConfirmacao).toBe(true)
    expect(validarEncomenda({ ...base, dia: '2026-09-24', hora: '10:00', confirmarPassado: true }, AGORA).ok).toBe(true)
  })

  it('na edição, manter a data que já estava não pede confirmação de novo', () => {
    const antiga = em('2026-09-20', '10:00')
    expect(validarEncomenda({ ...base, dia: '2026-09-20', hora: '10:00' }, AGORA, antiga).ok).toBe(true)
    expect(validarEncomenda({ ...base, dia: '2026-09-21', hora: '10:00' }, AGORA, antiga).ok).toBe(false)
  })

  it('pede para quem, o quê, um dia que existe, e endereço quando é entrega', () => {
    expect(erro({ clienteNome: '  ', clienteId: null })).toMatch(/Para quem/)
    expect(erro({ clienteNome: '', clienteId: 'cli-1' })).toBeNull()
    expect(erro({ descricao: ' ' })).toMatch(/Descreva/)
    expect(erro({ dia: '2026-02-30' })).toMatch(/dia e uma hora/)
    expect(erro({ entrega: true, endereco: '' })).toMatch(/endereço/)
    expect(erro({ entrega: true, endereco: 'Rua A, 10' })).toBeNull()
  })

  it('telefone sem DDD é recusado; vazio passa', () => {
    expect(erro({ telefone: '99999-0000' })).toMatch(/DDD/)
    expect(erro({ telefone: '' })).toBeNull()
  })

  it('o link do WhatsApp leva o 55 do Brasil', () => {
    expect(linkWhatsApp('(71) 99999-0000')).toBe('https://wa.me/5571999990000')
    expect(linkWhatsApp('5571999990000')).toBe('https://wa.me/5571999990000')
    expect(linkWhatsApp(null)).toBeNull()
    expect(linkWhatsApp('123')).toBeNull()
  })
})

describe('as portas da situação', () => {
  it('entregue e cancelada são finais: não saem para lugar nenhum', () => {
    for (const para of SITUACOES_ENCOMENDA) {
      expect(transicaoPermitida('ENTREGUE', para), `ENTREGUE → ${para}`).toBe(false)
      expect(transicaoPermitida('CANCELADA', para), `CANCELADA → ${para}`).toBe(false)
    }
    expect(ehFinal('ENTREGUE')).toBe(true)
    expect(ehFinal('CANCELADA')).toBe(true)
    expect(ehFinal('PRONTA')).toBe(false)
  })

  it('a fazer vai para pronta, entregue ou cancelada', () => {
    expect(transicaoPermitida('ABERTA', 'PRONTA')).toBe(true)
    expect(transicaoPermitida('ABERTA', 'ENTREGUE')).toBe(true)
    expect(transicaoPermitida('ABERTA', 'CANCELADA')).toBe(true)
    expect(transicaoPermitida('ABERTA', 'ABERTA')).toBe(false)
  })

  it('pronta volta para a fazer (clique errado), e segue para entregue ou cancelada', () => {
    expect(transicaoPermitida('PRONTA', 'ABERTA')).toBe(true)
    expect(transicaoPermitida('PRONTA', 'ENTREGUE')).toBe(true)
    expect(transicaoPermitida('PRONTA', 'CANCELADA')).toBe(true)
    expect(transicaoPermitida('PRONTA', 'PRONTA')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// ISOLAMENTO — a encomenda de uma empresa não existe para a outra
// ─────────────────────────────────────────────────────────────

describe('isolamento entre empresas (Postgres de verdade, com RLS)', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await subirBanco()
    await semear(db)
    await db.exec(`
      insert into encomendas (id, org_id, unidade_id, cliente_nome, descricao, valor, sinal, para, quem, atualizada_em) values
        ('enc-a1', 'org-a', 'uni-a1', 'Maria',  'Bolo 2 kg',       120, 50, now() + interval '2 days', 'Ana',     now()),
        ('enc-b1', 'org-b', 'uni-b1', 'Joana',  'Torta de limão',   90,  0, now() + interval '1 day',  'Vizinho', now());
    `)
  }, 60_000)

  afterAll(async () => {
    await db?.close()
  })

  it('A lê só as encomendas de A — nem contando as de B', async () => {
    const r = await comoApp(db, 'org-a', (tx) => tx.query<{ id: string }>(`select id from encomendas order by id`))
    expect(r.rows.map((x) => x.id)).toEqual(['enc-a1'])
    const n = await comoApp(db, 'org-a', (tx) =>
      tx.query<{ n: number }>(`select count(*)::int as n from encomendas where org_id = 'org-b'`),
    )
    expect(n.rows[0]!.n).toBe(0)
  })

  it('A não lê a encomenda de B nem pelo id', async () => {
    const r = await comoApp(db, 'org-a', (tx) => tx.query(`select id from encomendas where id = 'enc-b1'`))
    expect(r.rows).toHaveLength(0)
  })

  it('A não altera nem cancela a encomenda de B', async () => {
    const r = await comoApp(db, 'org-a', (tx) =>
      tx.query(`update encomendas set situacao = 'CANCELADA', valor = 0 where id = 'enc-b1'`),
    )
    expect(r.affectedRows ?? 0).toBe(0)
    const b = await comoApp(db, 'org-b', (tx) =>
      tx.query<{ situacao: string; valor: string }>(`select situacao, valor::text from encomendas where id = 'enc-b1'`),
    )
    expect(b.rows[0]).toEqual({ situacao: 'ABERTA', valor: '90.00' })
  })

  it('A não apaga a encomenda de B', async () => {
    const r = await comoApp(db, 'org-a', (tx) => tx.query(`delete from encomendas where id = 'enc-b1'`))
    expect(r.affectedRows ?? 0).toBe(0)
    const b = await comoApp(db, 'org-b', (tx) => tx.query(`select id from encomendas where id = 'enc-b1'`))
    expect(b.rows).toHaveLength(1)
  })

  it('A não anota encomenda em nome de B', async () => {
    await expect(
      comoApp(db, 'org-a', (tx) =>
        tx.query(
          `insert into encomendas (id, org_id, unidade_id, cliente_nome, descricao, para, quem, atualizada_em)
           values ('enc-x', 'org-b', 'uni-b1', 'Intrusa', 'Nada', now(), 'Ana', now())`,
        ),
      ),
    ).rejects.toThrow()
  })

  it('sem empresa na requisição, nenhuma encomenda aparece', async () => {
    const r = await comoApp(db, null, (tx) => tx.query(`select id from encomendas`))
    expect(r.rows).toHaveLength(0)
  })
})
