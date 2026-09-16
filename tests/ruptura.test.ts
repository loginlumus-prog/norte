// A previsão de ruptura.
//
// "Está no mínimo" é um número parado. "Dura 6 dias e a entrega leva 10" é
// um número que anda — e é o que decide se a compra é hoje ou semana que
// vem. Estes testes fixam cada situação e a data até a qual dá para pedir.

import { describe, it, expect } from 'vitest'
import { preverRuptura, ordenarPorUrgencia, PRAZO_PADRAO, type Previsao } from '../src/servidor/ruptura'

// Um dia fixo, ao meio-dia, para a soma de dias não tropeçar em horário.
const HOJE = new Date(2026, 8, 16, 12, 0, 0)
const dias = (n: number) => new Date(HOJE.getTime() + n * 86400000)

describe('preverRuptura — o ritmo', () => {
  it('ritmo é vendidos em 30 dias dividido por 30', () => {
    expect(preverRuptura({ saldo: 10, vendidos30: 60, prazoDias: 7, hoje: HOJE }).ritmoDia).toBeCloseTo(2, 9)
    expect(preverRuptura({ saldo: 10, vendidos30: 1, prazoDias: 7, hoje: HOJE }).ritmoDia).toBeCloseTo(1 / 30, 9)
  })

  it('dura é saldo dividido pelo ritmo', () => {
    // 2 por dia, 10 no saldo → 5 dias
    expect(preverRuptura({ saldo: 10, vendidos30: 60, prazoDias: 7, hoje: HOJE }).duraDias).toBeCloseTo(5, 9)
  })
})

describe('preverRuptura — cada situação', () => {
  it('saldo zero já faltou, seja qual for o ritmo', () => {
    const p = preverRuptura({ saldo: 0, vendidos30: 30, prazoDias: 7, hoje: HOJE })
    expect(p.situacao).toBe('ja_faltou')
    expect(p.duraDias).toBe(0)
    expect(p.pedirAte).toBeNull()
  })

  it('saldo negativo também já faltou', () => {
    // Venda que passou do saldo: a prateleira está vazia e o número está
    // errado — mas o que a pessoa precisa saber é que falta.
    const p = preverRuptura({ saldo: -3, vendidos30: 30, prazoDias: 7, hoje: HOJE })
    expect(p.situacao).toBe('ja_faltou')
  })

  it('saldo zero sem ritmo: já faltou, e a duração é nula', () => {
    const p = preverRuptura({ saldo: 0, vendidos30: 0, prazoDias: null, hoje: HOJE })
    expect(p.situacao).toBe('ja_faltou')
    expect(p.duraDias).toBeNull()
  })

  it('tem saldo e não vende: sem giro, não "ok"', () => {
    const p = preverRuptura({ saldo: 12, vendidos30: 0, prazoDias: 7, hoje: HOJE })
    expect(p.situacao).toBe('sem_giro')
    expect(p.ritmoDia).toBe(0)
    expect(p.duraDias).toBeNull()
    expect(p.pedirAte).toBeNull()
  })

  it('dura menos que o prazo: pedir agora', () => {
    // 2 por dia, saldo 10 → dura 5; entrega leva 7 → já é tarde
    const p = preverRuptura({ saldo: 10, vendidos30: 60, prazoDias: 7, hoje: HOJE })
    expect(p.situacao).toBe('pedir_agora')
  })

  it('dura exatamente o prazo ainda é pedir agora', () => {
    // 1 por dia, saldo 7, prazo 7
    expect(preverRuptura({ saldo: 7, vendidos30: 30, prazoDias: 7, hoje: HOJE }).situacao).toBe('pedir_agora')
  })

  it('dura até o dobro do prazo: atenção', () => {
    // 1 por dia, saldo 10, prazo 7 → dura 10, entre 7 e 14
    expect(preverRuptura({ saldo: 10, vendidos30: 30, prazoDias: 7, hoje: HOJE }).situacao).toBe('atencao')
    // no limite exato do dobro ainda é atenção
    expect(preverRuptura({ saldo: 14, vendidos30: 30, prazoDias: 7, hoje: HOJE }).situacao).toBe('atencao')
  })

  it('dura mais que o dobro do prazo: ok', () => {
    expect(preverRuptura({ saldo: 15, vendidos30: 30, prazoDias: 7, hoje: HOJE }).situacao).toBe('ok')
    expect(preverRuptura({ saldo: 300, vendidos30: 30, prazoDias: 7, hoje: HOJE }).situacao).toBe('ok')
  })
})

describe('preverRuptura — o prazo', () => {
  it('sem prazo informado usa o padrão e diz que é padrão', () => {
    const p = preverRuptura({ saldo: 10, vendidos30: 30, prazoDias: null, hoje: HOJE })
    expect(p.prazo).toBe(PRAZO_PADRAO)
    expect(p.prazoInformado).toBe(false)
  })

  it('prazo informado vale, inclusive zero', () => {
    const p = preverRuptura({ saldo: 10, vendidos30: 30, prazoDias: 21, hoje: HOJE })
    expect(p.prazo).toBe(21)
    expect(p.prazoInformado).toBe(true)
    // entrega no mesmo dia: só falta quando acabar
    const z = preverRuptura({ saldo: 1, vendidos30: 30, prazoDias: 0, hoje: HOJE })
    expect(z.prazo).toBe(0)
    expect(z.prazoInformado).toBe(true)
    expect(z.situacao).toBe('ok')
  })

  it('o mesmo saldo muda de situação conforme o prazo do fornecedor', () => {
    // 1 por dia, saldo 10: com 3 dias de entrega está ok; com 10, pedir agora
    expect(preverRuptura({ saldo: 10, vendidos30: 30, prazoDias: 3, hoje: HOJE }).situacao).toBe('ok')
    expect(preverRuptura({ saldo: 10, vendidos30: 30, prazoDias: 6, hoje: HOJE }).situacao).toBe('atencao')
    expect(preverRuptura({ saldo: 10, vendidos30: 30, prazoDias: 10, hoje: HOJE }).situacao).toBe('pedir_agora')
  })
})

describe('preverRuptura — pedir até', () => {
  it('é hoje mais (dura − prazo) dias', () => {
    // 1 por dia, saldo 20, prazo 7 → dura 20 → pedir até daqui a 13 dias
    const p = preverRuptura({ saldo: 20, vendidos30: 30, prazoDias: 7, hoje: HOJE })
    expect(p.pedirAte).toEqual(dias(13))
  })

  it('arredonda para o chão: pedir um dia antes não custa nada', () => {
    // 2 por dia, saldo 45, prazo 7 → dura 22,5 → folga 15,5 → 15 dias
    const p = preverRuptura({ saldo: 45, vendidos30: 60, prazoDias: 7, hoje: HOJE })
    expect(p.pedirAte).toEqual(dias(15))
  })

  it('quando a data já passou, vem hoje — o melhor dia que sobrou', () => {
    // dura 5, prazo 7: a data seria anteontem
    const p = preverRuptura({ saldo: 10, vendidos30: 60, prazoDias: 7, hoje: HOJE })
    expect(p.situacao).toBe('pedir_agora')
    expect(p.pedirAte).toEqual(HOJE)
  })

  it('já faltou e sem giro não têm data', () => {
    expect(preverRuptura({ saldo: 0, vendidos30: 30, prazoDias: 7, hoje: HOJE }).pedirAte).toBeNull()
    expect(preverRuptura({ saldo: 9, vendidos30: 0, prazoDias: 7, hoje: HOJE }).pedirAte).toBeNull()
  })

  it('não mexe no "hoje" que recebeu', () => {
    const h = new Date(HOJE)
    preverRuptura({ saldo: 20, vendidos30: 30, prazoDias: 7, hoje: h })
    expect(h).toEqual(HOJE)
  })
})

describe('ordenarPorUrgencia', () => {
  const com = (nome: string, saldo: number, vendidos30: number, prazoDias: number | null = 7) => ({
    nome,
    previsao: preverRuptura({ saldo, vendidos30, prazoDias, hoje: HOJE }),
  })

  it('já faltou, pedir agora, atenção, ok, sem giro — nessa ordem', () => {
    const r = ordenarPorUrgencia([
      com('sem giro', 10, 0),
      com('ok', 300, 30),
      com('atencao', 10, 30),
      com('pedir agora', 3, 30),
      com('ja faltou', 0, 30),
    ])
    expect(r.map((l) => l.nome)).toEqual(['ja faltou', 'pedir agora', 'atencao', 'ok', 'sem giro'])
    expect(r.map((l) => l.previsao.situacao)).toEqual(['ja_faltou', 'pedir_agora', 'atencao', 'ok', 'sem_giro'])
  })

  it('dentro do grupo, o que dura menos vem antes', () => {
    const r = ordenarPorUrgencia([com('dura 6', 6, 30), com('dura 2', 2, 30), com('dura 4', 4, 30)])
    expect(r.map((l) => l.nome)).toEqual(['dura 2', 'dura 4', 'dura 6'])
  })

  it('entre os que já faltaram, o que vendia mais vem antes', () => {
    // é a falta que mais custa
    const r = ordenarPorUrgencia([com('vendia 5', 0, 150), com('vendia 40', 0, 1200), com('vendia 1', 0, 30)])
    expect(r.map((l) => l.nome)).toEqual(['vendia 40', 'vendia 5', 'vendia 1'])
  })

  it('não mexe na lista original', () => {
    const original = [com('b', 300, 30), com('a', 0, 30)]
    ordenarPorUrgencia(original)
    expect(original[0]!.nome).toBe('b')
  })

  it('aceita qualquer linha que carregue a previsão', () => {
    const p: Previsao = preverRuptura({ saldo: 1, vendidos30: 30, prazoDias: null, hoje: HOJE })
    expect(ordenarPorUrgencia([{ previsao: p, qualquerCoisa: 1 }])).toHaveLength(1)
  })
})
