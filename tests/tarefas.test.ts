import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { subirBanco, semear, comoApp } from './banco'
import {
  atrasada,
  resumir,
  podeMexerNaTarefa,
  cabeNoPlano,
  ROTULO_SITUACAO,
  NIVEL_SITUACAO,
  PROXIMA_SITUACAO,
  SITUACOES,
  situacaoValida,
  dataSemHora,
  chaveDoDia,
  diaCurto,
  iniciais,
  limparGrupos,
  limparTexto,
  corValida,
  prioridadeValida,
  progressoValido,
  MODELOS,
  modeloValido,
  GRUPOS_PADRAO,
} from '../src/servidor/tarefas'
import type { Sessao } from '../src/servidor/permissao'
import { TAREFAS_ABERTAS_NO_GRATIS } from '../src/servidor/planos'

// O quadro é a tela que a equipe abre todo dia. As regras puras aqui são as
// que decidem o que a balconista pode tocar, o que o Grátis deixa criar e o
// que aparece em vermelho — e todas são baratas de testar até o fim.

const dia = (a: number, m: number, d: number) => new Date(a, m - 1, d)
const HOJE = dia(2026, 9, 16)

// ─────────────────────────────────────────────────────────────
// DATAS SEM HORA
// ─────────────────────────────────────────────────────────────

describe('data sem hora', () => {
  it('lê "AAAA-MM-DD" como meia-noite local', () => {
    const d = dataSemHora('2026-09-16')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(16)
    expect(d.getHours()).toBe(0)
  })

  it('recusa o que não é uma data de verdade', () => {
    expect(dataSemHora('2026-02-30')).toBeNull() // o JS aceitaria como 2 de março
    expect(dataSemHora('2026-13-01')).toBeNull()
    expect(dataSemHora('2026-00-10')).toBeNull()
    expect(dataSemHora('16/09/2026')).toBeNull()
    expect(dataSemHora('2026-9-6')).toBeNull()
    expect(dataSemHora('')).toBeNull()
    expect(dataSemHora(null)).toBeNull()
    expect(dataSemHora(undefined)).toBeNull()
    expect(dataSemHora('2026-09-16T10:00')).toBeNull()
  })

  it('aceita bissexto onde existe e recusa onde não', () => {
    expect(dataSemHora('2024-02-29')).not.toBeNull()
    expect(dataSemHora('2026-02-29')).toBeNull()
  })

  it('vai e volta sem perder o dia', () => {
    for (const s of ['2026-01-01', '2026-12-31', '2024-02-29', '2026-09-16']) {
      expect(chaveDoDia(dataSemHora(s)!)).toBe(s)
    }
  })

  it('a chave do dia ignora a hora e compara como texto', () => {
    expect(chaveDoDia(new Date(2026, 8, 16, 23, 59))).toBe('2026-09-16')
    expect(chaveDoDia(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect('2026-09-15' < '2026-09-16').toBe(true)
    expect('2026-12-31' < '2027-01-01').toBe(true)
  })

  it('dd/mm para a coluna', () => {
    expect(diaCurto(dia(2026, 9, 5))).toBe('05/09')
    expect(diaCurto(dia(2026, 12, 25))).toBe('25/12')
  })
})

// ─────────────────────────────────────────────────────────────
// ATRASO
// ─────────────────────────────────────────────────────────────

describe('atrasada', () => {
  it('prazo que passou e não está feita', () => {
    expect(atrasada(dia(2026, 9, 15), 'A_FAZER', HOJE)).toBe(true)
    expect(atrasada(dia(2026, 9, 15), 'EM_ANDAMENTO', HOJE)).toBe(true)
    expect(atrasada(dia(2026, 9, 15), 'PARADO', HOJE)).toBe(true)
  })

  it('o prazo de hoje ainda não é atraso — a loja fecha às 19h', () => {
    expect(atrasada(dia(2026, 9, 16), 'A_FAZER', HOJE)).toBe(false)
    // nem com a hora do dia já avançada
    expect(atrasada(dia(2026, 9, 16), 'A_FAZER', new Date(2026, 8, 16, 18, 50))).toBe(false)
  })

  it('vira atraso na virada do dia, não da hora', () => {
    expect(atrasada(dia(2026, 9, 16), 'A_FAZER', new Date(2026, 8, 17, 0, 1))).toBe(true)
  })

  it('prazo no futuro não é atraso', () => {
    expect(atrasada(dia(2026, 9, 17), 'A_FAZER', HOJE)).toBe(false)
    expect(atrasada(dia(2027, 1, 1), 'PARADO', HOJE)).toBe(false)
  })

  it('feita nunca é atrasada, mesmo entregue depois', () => {
    expect(atrasada(dia(2026, 1, 1), 'FEITO', HOJE)).toBe(false)
  })

  it('sem prazo não há atraso', () => {
    expect(atrasada(null, 'A_FAZER', HOJE)).toBe(false)
    expect(atrasada(null, 'PARADO', HOJE)).toBe(false)
  })

  it('compara por dia mesmo quando o prazo tem hora sobrando', () => {
    expect(atrasada(new Date(2026, 8, 16, 23, 0), 'A_FAZER', new Date(2026, 8, 16, 8, 0))).toBe(false)
    expect(atrasada(new Date(2026, 8, 15, 23, 59), 'A_FAZER', new Date(2026, 8, 16, 0, 0))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// RESUMO
// ─────────────────────────────────────────────────────────────

describe('resumir', () => {
  it('conta cada situação e o que venceu', () => {
    const r = resumir(
      [
        { situacao: 'A_FAZER', prazo: dia(2026, 9, 10) }, // atrasada
        { situacao: 'A_FAZER', prazo: null },
        { situacao: 'EM_ANDAMENTO', prazo: dia(2026, 9, 1) }, // atrasada
        { situacao: 'PARADO', prazo: dia(2026, 9, 20) },
        { situacao: 'FEITO', prazo: dia(2026, 9, 1) }, // feita: não conta atraso
        { situacao: 'FEITO', prazo: null },
      ],
      HOJE,
    )
    expect(r).toEqual({ aFazer: 2, emAndamento: 1, paradas: 1, feitas: 2, atrasadas: 2 })
  })

  it('lista vazia é tudo zero', () => {
    expect(resumir([], HOJE)).toEqual({ aFazer: 0, emAndamento: 0, paradas: 0, feitas: 0, atrasadas: 0 })
  })

  it('as quatro situações somam o total', () => {
    const lista = SITUACOES.flatMap((s) => [
      { situacao: s, prazo: null },
      { situacao: s, prazo: dia(2026, 1, 1) },
    ])
    const r = resumir(lista, HOJE)
    expect(r.aFazer + r.emAndamento + r.paradas + r.feitas).toBe(lista.length)
    // uma vencida por situação aberta; a feita não conta
    expect(r.atrasadas).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────
// QUEM PODE MEXER
// ─────────────────────────────────────────────────────────────

const sessao = (papel: Sessao['acessos'][number]['papel'], unidadeId: string | null = null): Sessao => ({
  orgId: 'org-a',
  usuarioId: `u-${papel}`,
  nome: papel,
  acessos: [{ papel, unidadeId }],
})

describe('podeMexerNaTarefa', () => {
  const dona = sessao('DONO')
  const gerenteDa1 = sessao('GERENTE', 'uni-1')
  const balcaoDa1 = sessao('BALCAO', 'uni-1')
  const contador = sessao('CONTADOR')

  it('quem gere mexe em qualquer tarefa do quadro', () => {
    expect(podeMexerNaTarefa(dona, { responsavelId: 'outra' }, 'uni-1')).toBe(true)
    expect(podeMexerNaTarefa(dona, { responsavelId: null }, null)).toBe(true)
    expect(podeMexerNaTarefa(gerenteDa1, { responsavelId: 'outra' }, 'uni-1')).toBe(true)
  })

  it('quem só vê mexe na tarefa que é dela', () => {
    expect(podeMexerNaTarefa(balcaoDa1, { responsavelId: 'u-BALCAO' }, 'uni-1')).toBe(true)
  })

  it('quem só vê mexe na tarefa de ninguém — "quem chegar primeiro"', () => {
    expect(podeMexerNaTarefa(balcaoDa1, { responsavelId: null }, 'uni-1')).toBe(true)
  })

  it('quem só vê NÃO mexe na tarefa de outra pessoa', () => {
    expect(podeMexerNaTarefa(balcaoDa1, { responsavelId: 'u-outra' }, 'uni-1')).toBe(false)
  })

  it('o gerente da loja 1 não mexe no quadro da loja 2', () => {
    expect(podeMexerNaTarefa(gerenteDa1, { responsavelId: null }, 'uni-2')).toBe(false)
    expect(podeMexerNaTarefa(balcaoDa1, { responsavelId: 'u-BALCAO' }, 'uni-2')).toBe(false)
  })

  it('quadro da empresa inteira (sem loja) aceita quem tem a capacidade em qualquer loja', () => {
    expect(podeMexerNaTarefa(gerenteDa1, { responsavelId: 'outra' }, null)).toBe(true)
    expect(podeMexerNaTarefa(balcaoDa1, { responsavelId: null }, null)).toBe(true)
    expect(podeMexerNaTarefa(balcaoDa1, { responsavelId: 'outra' }, null)).toBe(false)
  })

  it('quem não vê tarefa não mexe em nada, nem na sua', () => {
    expect(podeMexerNaTarefa(contador, { responsavelId: 'u-CONTADOR' }, null)).toBe(false)
    expect(podeMexerNaTarefa(contador, { responsavelId: null }, null)).toBe(false)
  })

  it('acesso vencido não vale', () => {
    const vencida: Sessao = {
      ...dona,
      acessos: [{ papel: 'DONO', unidadeId: null, expiraEm: new Date(2000, 0, 1) }],
    }
    expect(podeMexerNaTarefa(vencida, { responsavelId: null }, null)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// O TETO DO GRÁTIS
// ─────────────────────────────────────────────────────────────

describe('cabeNoPlano', () => {
  it('no Grátis cabe o primeiro quadro, e só ele', () => {
    expect(cabeNoPlano('GRATIS', { quadros: 0, abertas: 0 }, 'quadro')).toEqual({ pode: true })
    const r = cabeNoPlano('GRATIS', { quadros: 1, abertas: 0 }, 'quadro')
    expect(r.pode).toBe(false)
    if (!r.pode) {
      expect(r.motivo).toMatch(/Grátis/)
      expect(r.motivo).toMatch(/um quadro só/)
      expect(r.motivo).toMatch(/planos/)
    }
  })

  it('no Grátis as tarefas em aberto têm teto, e o motivo diz o que fazer', () => {
    expect(cabeNoPlano('GRATIS', { quadros: 1, abertas: TAREFAS_ABERTAS_NO_GRATIS - 1 }, 'tarefa')).toEqual({ pode: true })
    const r = cabeNoPlano('GRATIS', { quadros: 1, abertas: TAREFAS_ABERTAS_NO_GRATIS }, 'tarefa')
    expect(r.pode).toBe(false)
    if (!r.pode) {
      expect(r.motivo).toContain(`${TAREFAS_ABERTAS_NO_GRATIS} tarefas em aberto`)
      expect(r.motivo).toMatch(/Conclua algumas/)
    }
    expect(cabeNoPlano('GRATIS', { quadros: 1, abertas: 500 }, 'tarefa').pode).toBe(false)
  })

  it('do Balcão para cima não há teto nenhum', () => {
    for (const p of ['BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO'] as const) {
      expect(cabeNoPlano(p, { quadros: 40, abertas: 9999 }, 'quadro'), p).toEqual({ pode: true })
      expect(cabeNoPlano(p, { quadros: 40, abertas: 9999 }, 'tarefa'), p).toEqual({ pode: true })
    }
  })
})

// ─────────────────────────────────────────────────────────────
// SITUAÇÃO: rótulo, cor e o ciclo do clique
// ─────────────────────────────────────────────────────────────

describe('situação', () => {
  it('toda situação tem rótulo em português e uma cor', () => {
    for (const s of SITUACOES) {
      expect(ROTULO_SITUACAO[s]).toBeTruthy()
      expect(['bom', 'atencao', 'critico', 'neutro']).toContain(NIVEL_SITUACAO[s])
    }
  })

  it('as cores seguem o dicionário do sistema', () => {
    expect(NIVEL_SITUACAO.FEITO).toBe('bom')
    expect(NIVEL_SITUACAO.EM_ANDAMENTO).toBe('atencao')
    expect(NIVEL_SITUACAO.PARADO).toBe('critico')
    expect(NIVEL_SITUACAO.A_FAZER).toBe('neutro')
  })

  it('o clique anda a fazer → em andamento → feito → a fazer', () => {
    expect(PROXIMA_SITUACAO.A_FAZER).toBe('EM_ANDAMENTO')
    expect(PROXIMA_SITUACAO.EM_ANDAMENTO).toBe('FEITO')
    expect(PROXIMA_SITUACAO.FEITO).toBe('A_FAZER')
  })

  it('PARADO só por escolha: ninguém cai nele clicando, e dele se volta ao trabalho', () => {
    for (const s of SITUACOES) expect(PROXIMA_SITUACAO[s]).not.toBe('PARADO')
    expect(PROXIMA_SITUACAO.PARADO).toBe('EM_ANDAMENTO')
  })

  it('o ciclo não tem beco sem saída', () => {
    // De qualquer situação, em até quatro cliques a gente passa por FEITO.
    for (const inicio of SITUACOES) {
      let s = inicio
      let passouPorFeito = false
      for (let i = 0; i < 4; i++) {
        s = PROXIMA_SITUACAO[s]
        if (s === 'FEITO') passouPorFeito = true
      }
      expect(passouPorFeito, inicio).toBe(true)
    }
  })

  it('só aceita as quatro situações vindas do navegador', () => {
    expect(situacaoValida('FEITO')).toBe(true)
    expect(situacaoValida('feito')).toBe(false)
    expect(situacaoValida('CANCELADO')).toBe(false)
    expect(situacaoValida(null)).toBe(false)
    expect(situacaoValida(3)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// VALIDAÇÃO DO QUE VEM DO NAVEGADOR
// ─────────────────────────────────────────────────────────────

describe('validação', () => {
  it('prioridade vai de 0 a 5 estrelas, inteira', () => {
    for (const n of [0, 1, 5]) expect(prioridadeValida(n)).toBe(true)
    for (const n of [-1, 6, 2.5, NaN, '3', null]) expect(prioridadeValida(n), String(n)).toBe(false)
  })

  it('progresso vai de 0 a 100, inteiro', () => {
    for (const n of [0, 50, 100]) expect(progressoValido(n)).toBe(true)
    for (const n of [-10, 101, 33.3, Infinity, '50']) expect(progressoValido(n), String(n)).toBe(false)
  })

  it('cor é hex de seis dígitos', () => {
    expect(corValida('#1f4fd8')).toBe(true)
    expect(corValida('#ABCDEF')).toBe(true)
    expect(corValida('#fff')).toBe(false)
    expect(corValida('red')).toBe(false)
    expect(corValida('1f4fd8')).toBe(false)
    expect(corValida(null)).toBe(false)
  })

  it('texto perde espaço sobrando e é cortado no tamanho', () => {
    expect(limparTexto('  conferir   o  troco ', 100)).toBe('conferir o troco')
    expect(limparTexto('abcdef', 3)).toBe('abc')
    expect(limparTexto(42, 10)).toBe('')
    expect(limparTexto(undefined, 10)).toBe('')
  })

  it('grupos: sem vazio, sem repetido, no máximo doze', () => {
    expect(limparGrupos(['Ao abrir', ' Ao abrir ', '', '   ', 'Ao fechar'])).toEqual(['Ao abrir', 'Ao fechar'])
    expect(limparGrupos(Array.from({ length: 20 }, (_, i) => `G${i}`))).toHaveLength(12)
    expect(limparGrupos('não é lista')).toEqual([])
    expect(limparGrupos([1, null, 'ok'])).toEqual(['ok'])
  })

  it('os grupos padrão são os do Monday: esta semana, este mês, próximo mês', () => {
    expect(GRUPOS_PADRAO).toEqual(['Esta semana', 'Este mês', 'Próximo mês'])
    expect(limparGrupos(GRUPOS_PADRAO)).toEqual(GRUPOS_PADRAO)
  })

  it('iniciais para a bolinha do responsável', () => {
    expect(iniciais('Ana Paula Souza')).toBe('AS')
    expect(iniciais('Ana')).toBe('A')
    expect(iniciais('  josé   da silva ')).toBe('JS')
    expect(iniciais('')).toBe('?')
  })
})

// ─────────────────────────────────────────────────────────────
// MODELOS
// ─────────────────────────────────────────────────────────────

describe('modelos de quadro', () => {
  const chaves = Object.keys(MODELOS) as (keyof typeof MODELOS)[]

  it('são quatro, com os nomes que a página de planos promete', () => {
    expect(chaves).toHaveLength(4)
    const titulos = chaves.map((c) => MODELOS[c].titulo)
    expect(titulos).toContain('Abertura e fechamento da loja')
    expect(titulos).toContain('Inventário do mês')
    expect(titulos).toContain('Campanha e data comemorativa')
    expect(titulos).toContain('Chegada de mercadoria')
  })

  it('cada modelo tem pelo menos três tarefas, com títulos únicos', () => {
    for (const c of chaves) {
      const m = MODELOS[c]
      expect(m.tarefas.length, c).toBeGreaterThanOrEqual(3)
      const titulos = m.tarefas.map((t) => t.titulo)
      expect(new Set(titulos).size, c).toBe(titulos.length)
      for (const t of m.tarefas) expect(t.titulo.trim().length, c).toBeGreaterThan(0)
    }
  })

  it('toda tarefa aponta para um grupo que existe no modelo', () => {
    for (const c of chaves) {
      const m = MODELOS[c]
      const grupos: readonly string[] = m.grupos
      expect(grupos.length, c).toBeGreaterThan(0)
      expect(new Set(grupos).size, c).toBe(grupos.length)
      for (const t of m.tarefas) expect(grupos, `${c}: "${t.titulo}" → ${t.grupo}`).toContain(t.grupo)
    }
  })

  it('nenhum grupo fica vazio', () => {
    for (const c of chaves) {
      const m = MODELOS[c]
      for (const g of m.grupos) {
        expect(m.tarefas.some((t) => t.grupo === g), `${c}: ${g}`).toBe(true)
      }
    }
  })

  it('a abertura da loja tem "Ao abrir" e "Ao fechar", com as tarefas de loja de verdade', () => {
    const m = MODELOS.abertura
    expect([...m.grupos]).toEqual(['Ao abrir', 'Ao fechar'])
    expect(m.tarefas.length).toBeGreaterThanOrEqual(6)
    expect(m.tarefas.length).toBeLessThanOrEqual(8)
    const tudo = m.tarefas.map((t) => t.titulo.toLowerCase()).join(' | ')
    expect(tudo).toMatch(/troco/)
    expect(tudo).toMatch(/maquininha/)
    expect(tudo).toMatch(/vitrine/)
    expect(tudo).toMatch(/sangria/)
    expect(tudo).toMatch(/fechar o caixa/)
  })

  it('prioridade e cor dos modelos passam na própria validação', () => {
    for (const c of chaves) {
      const m = MODELOS[c]
      expect(corValida(m.cor), c).toBe(true)
      for (const t of m.tarefas) {
        if ('prioridade' in t && t.prioridade !== undefined) expect(prioridadeValida(t.prioridade), t.titulo).toBe(true)
      }
      expect(limparGrupos(m.grupos), c).toEqual([...m.grupos])
    }
  })

  it('só aceita chave de modelo que existe', () => {
    expect(modeloValido('abertura')).toBe(true)
    expect(modeloValido('toString')).toBe(false) // herança do Object não conta
    expect(modeloValido('')).toBe(false)
    expect(modeloValido(null)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// BANCO: a empresa A não enxerga o quadro da empresa B
// ─────────────────────────────────────────────────────────────

describe('isolamento de quadros e tarefas entre empresas', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await subirBanco()
    await semear(db)
    // Como dono, antes das travas valerem: um quadro com uma tarefa em cada
    // empresa, e os dois com nomes parecidos de propósito.
    await db.exec(`
      insert into quadros (id, org_id, unidade_id, nome, grupos, arquivado, ordem, quem, criado_em, atualizado_em) values
        ('qua-a1', 'org-a', 'uni-a1', 'Abertura da loja', array['Ao abrir','Ao fechar'], false, 1, 'Ana', now(), now()),
        ('qua-b1', 'org-b', null,     'Abertura da loja', array['Ao abrir'],             false, 1, 'Vizinho', now(), now());

      insert into tarefas (id, org_id, quadro_id, grupo, titulo, responsavel_id, situacao, prioridade, progresso, prazo, ordem, quem, criado_em, atualizado_em) values
        ('tar-a1', 'org-a', 'qua-a1', 'Ao abrir', 'Conferir o troco',    'usr-a1', 'A_FAZER', 3, 0,  date '2026-09-10', 1, 'Ana', now(), now()),
        ('tar-b1', 'org-b', 'qua-b1', 'Ao abrir', 'Conferir o troco',    'usr-b1', 'A_FAZER', 5, 0,  date '2026-09-10', 1, 'Vizinho', now(), now()),
        ('tar-b2', 'org-b', 'qua-b1', 'Ao abrir', 'Ligar a maquininha',  null,     'FEITO',   0, 100, null,             2, 'Vizinho', now(), now());
    `)
  }, 60_000)

  afterAll(async () => {
    await db?.close()
  })

  it('A lê só o próprio quadro, mesmo com nome igual', async () => {
    const r = await comoApp(db, 'org-a', (tx) => tx.query<{ id: string }>(`select id from quadros order by id`))
    expect(r.rows.map((q) => q.id)).toEqual(['qua-a1'])
  })

  it('A lê só as próprias tarefas — nem contando as de B', async () => {
    const lista = await comoApp(db, 'org-a', (tx) => tx.query<{ id: string }>(`select id from tarefas order by id`))
    expect(lista.rows.map((t) => t.id)).toEqual(['tar-a1'])

    const conta = await comoApp(db, 'org-a', (tx) =>
      tx.query<{ n: number }>(`select count(*)::int as n from tarefas where situacao <> 'FEITO'`),
    )
    // B tem uma em aberto também; ela não pode entrar no teto do plano de A
    expect(Number(conta.rows[0]!.n)).toBe(1)
  })

  it('A não alcança a tarefa de B nem pelo id exato, nem pelo quadro', async () => {
    const porId = await comoApp(db, 'org-a', (tx) => tx.query(`select id from tarefas where id = 'tar-b1'`))
    expect(porId.rows).toHaveLength(0)
    const porQuadro = await comoApp(db, 'org-a', (tx) => tx.query(`select id from tarefas where quadro_id = 'qua-b1'`))
    expect(porQuadro.rows).toHaveLength(0)
  })

  it('A não conclui a tarefa de B: o update não enxerga a linha', async () => {
    await comoApp(db, 'org-a', (tx) =>
      tx.query(`update tarefas set situacao = 'FEITO', progresso = 100 where id = 'tar-b1'`),
    )
    const r = await db.query<{ situacao: string; progresso: number }>(`select situacao, progresso from tarefas where id = 'tar-b1'`)
    expect(r.rows[0]).toEqual({ situacao: 'A_FAZER', progresso: 0 })
  })

  it('A não apaga nem arquiva o quadro de B', async () => {
    await comoApp(db, 'org-a', (tx) => tx.query(`update quadros set arquivado = true where id = 'qua-b1'`))
    await comoApp(db, 'org-a', (tx) => tx.query(`delete from quadros where id = 'qua-b1'`))
    const r = await db.query<{ arquivado: boolean }>(`select arquivado from quadros where id = 'qua-b1'`)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]!.arquivado).toBe(false)
  })

  it('A não consegue criar tarefa dentro do quadro de B', async () => {
    await expect(
      comoApp(db, 'org-a', (tx) =>
        tx.query(`insert into tarefas (id, org_id, quadro_id, grupo, titulo, situacao, prioridade, progresso, ordem, quem, criado_em, atualizado_em)
                  values ('invasora', 'org-b', 'qua-b1', '', 'Invasora', 'A_FAZER', 0, 0, 9, 'Ana', now(), now())`),
      ),
    ).rejects.toThrow(/row-level security|violates/i)
  })

  it('A não move a própria tarefa para dentro de B', async () => {
    await expect(
      comoApp(db, 'org-a', (tx) => tx.query(`update tarefas set org_id = 'org-b' where id = 'tar-a1'`)),
    ).rejects.toThrow(/row-level security|violates/i)
  })

  it('B, por sua vez, vê só o dele — e o que A vê mais o que B vê é o total', async () => {
    const b = await comoApp(db, 'org-b', (tx) => tx.query<{ id: string }>(`select id from tarefas order by id`))
    expect(b.rows.map((t) => t.id)).toEqual(['tar-b1', 'tar-b2'])
    const total = await db.query<{ n: number }>(`select count(*)::int as n from tarefas`)
    expect(1 + b.rows.length).toBe(total.rows[0]!.n)
  })

  it('a tarefa de A responde com prazo, responsável e quadro dela — o caminho que a tela usa', async () => {
    const r = await comoApp(db, 'org-a', (tx) =>
      tx.query<{ titulo: string; nome: string; quadro: string; prazo: string }>(`
        select t.titulo, u.nome, q.nome as quadro, to_char(t.prazo, 'YYYY-MM-DD') as prazo
          from tarefas t
          join quadros q on q.id = t.quadro_id
          left join usuarios u on u.id = t.responsavel_id
      `),
    )
    expect(r.rows).toEqual([{ titulo: 'Conferir o troco', nome: 'Ana', quadro: 'Abertura da loja', prazo: '2026-09-10' }])
  })
})
