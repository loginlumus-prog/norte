import { describe, it, expect } from 'vitest'
import {
  pode,
  exigir,
  unidadesQuePodem,
  podeConceder,
  SemPermissao,
  type Sessao,
  type Papel,
} from '../src/servidor/permissao'

const LOJA_3 = 'uni-3'
const LOJA_5 = 'uni-5'

const sessao = (nome: string, acessos: Sessao['acessos']): Sessao => ({
  orgId: 'org-1',
  usuarioId: `usr-${nome}`,
  nome,
  acessos,
})

const dono = sessao('Dono', [{ papel: 'DONO', unidadeId: null }])
const gerente3 = sessao('Gerente da 3', [{ papel: 'GERENTE', unidadeId: LOJA_3 }])
const balcao3 = sessao('Balcão da 3', [{ papel: 'BALCAO', unidadeId: LOJA_3 }])
const financeiro = sessao('Financeiro', [{ papel: 'FINANCEIRO', unidadeId: null }])
const contador = sessao('Contador', [{ papel: 'CONTADOR', unidadeId: null }])

describe('dono', () => {
  it('pode tudo, em qualquer unidade', () => {
    expect(pode(dono, 'empresa.configurar')).toBe(true)
    expect(pode(dono, 'caixa.operar', LOJA_3)).toBe(true)
    expect(pode(dono, 'caixa.operar', LOJA_5)).toBe(true)
    expect(pode(dono, 'agente.configurar', 'unidade-que-nem-existe')).toBe(true)
  })

  it('não precisa de filtro de unidade nas consultas', () => {
    expect(unidadesQuePodem(dono, 'venda.ver')).toBe('todas')
  })
})

describe('gerente é preso à unidade dele', () => {
  it('pode na loja 3', () => {
    expect(pode(gerente3, 'caixa.operar', LOJA_3)).toBe(true)
    expect(pode(gerente3, 'estoque.ajustar', LOJA_3)).toBe(true)
  })

  it('NÃO pode na loja 5', () => {
    expect(pode(gerente3, 'caixa.operar', LOJA_5)).toBe(false)
    expect(pode(gerente3, 'venda.ver', LOJA_5)).toBe(false)
  })

  it('não configura a empresa nem o agente', () => {
    expect(pode(gerente3, 'empresa.configurar', LOJA_3)).toBe(false)
    expect(pode(gerente3, 'agente.configurar', LOJA_3)).toBe(false)
  })

  it('vê o financeiro mas não lança', () => {
    expect(pode(gerente3, 'financeiro.ver', LOJA_3)).toBe(true)
    expect(pode(gerente3, 'financeiro.lancar', LOJA_3)).toBe(false)
  })

  it('as consultas dele saem filtradas pela unidade', () => {
    expect(unidadesQuePodem(gerente3, 'venda.ver')).toEqual([LOJA_3])
  })
})

describe('balcão vende e só', () => {
  it('vende e opera o caixa', () => {
    expect(pode(balcao3, 'venda.criar', LOJA_3)).toBe(true)
    expect(pode(balcao3, 'caixa.operar', LOJA_3)).toBe(true)
  })

  it('não mexe em preço nem ajusta estoque', () => {
    expect(pode(balcao3, 'produto.preco', LOJA_3)).toBe(false)
    expect(pode(balcao3, 'estoque.ajustar', LOJA_3)).toBe(false)
  })

  it('não vê o financeiro nem cancela venda', () => {
    expect(pode(balcao3, 'financeiro.ver', LOJA_3)).toBe(false)
    expect(pode(balcao3, 'venda.cancelar', LOJA_3)).toBe(false)
  })
})

describe('o quadro de tarefas', () => {
  it('quem trabalha na loja vê o quadro; quem manda nela cria tarefa', () => {
    expect(pode(balcao3, 'tarefa.ver', LOJA_3)).toBe(true)
    expect(pode(balcao3, 'tarefa.gerir', LOJA_3)).toBe(false)
    expect(pode(gerente3, 'tarefa.gerir', LOJA_3)).toBe(true)
    expect(pode(financeiro, 'tarefa.ver')).toBe(true)
    expect(pode(financeiro, 'tarefa.gerir')).toBe(false)
  })

  it('o contador não tem nada com o quadro', () => {
    expect(pode(contador, 'tarefa.ver')).toBe(false)
  })
})

describe('contador é convidado', () => {
  it('vê o financeiro e os relatórios', () => {
    expect(pode(contador, 'financeiro.ver')).toBe(true)
    expect(pode(contador, 'relatorio.ver')).toBe(true)
  })

  it('não escreve nada, em lugar nenhum', () => {
    expect(pode(contador, 'financeiro.lancar')).toBe(false)
    expect(pode(contador, 'produto.editar')).toBe(false)
    expect(pode(contador, 'venda.criar')).toBe(false)
    expect(pode(contador, 'equipe.gerir')).toBe(false)
  })

  it('não bisbilhota a operação', () => {
    expect(pode(contador, 'cliente.ver')).toBe(false)
    expect(pode(contador, 'venda.ver')).toBe(false)
  })
})

describe('financeiro', () => {
  it('lança e cobra', () => {
    expect(pode(financeiro, 'financeiro.lancar')).toBe(true)
    expect(pode(financeiro, 'crediario.cobrar')).toBe(true)
  })
  it('não vende nem mexe em produto', () => {
    expect(pode(financeiro, 'venda.criar')).toBe(false)
    expect(pode(financeiro, 'produto.editar')).toBe(false)
  })
})

describe('acesso de suporte tem prazo', () => {
  const ontem = new Date('2026-09-06T12:00:00Z')
  const hoje = new Date('2026-09-07T12:00:00Z')
  const amanha = new Date('2026-09-08T12:00:00Z')

  const suporte = (expiraEm: Date) =>
    sessao('Suporte', [{ papel: 'SUPORTE', unidadeId: null, expiraEm }])

  it('dentro do prazo, só lê', () => {
    const s = suporte(amanha)
    expect(pode(s, 'venda.ver', LOJA_3, hoje)).toBe(true)
    expect(pode(s, 'produto.ver', LOJA_3, hoje)).toBe(true)
    expect(pode(s, 'produto.editar', LOJA_3, hoje)).toBe(false)
    expect(pode(s, 'venda.criar', LOJA_3, hoje)).toBe(false)
    expect(pode(s, 'empresa.configurar', LOJA_3, hoje)).toBe(false)
  })

  it('vencido não pode NADA', () => {
    const s = suporte(ontem)
    expect(pode(s, 'venda.ver', LOJA_3, hoje)).toBe(false)
    expect(pode(s, 'produto.ver', undefined, hoje)).toBe(false)
    expect(unidadesQuePodem(s, 'venda.ver', hoje)).toEqual([])
  })
})

describe('duas unidades para a mesma pessoa', () => {
  const gerenteDuas = sessao('Gerente 3 e 5', [
    { papel: 'GERENTE', unidadeId: LOJA_3 },
    { papel: 'BALCAO', unidadeId: LOJA_5 },
  ])

  it('cada unidade com seu papel', () => {
    expect(pode(gerenteDuas, 'estoque.ajustar', LOJA_3)).toBe(true)
    expect(pode(gerenteDuas, 'estoque.ajustar', LOJA_5)).toBe(false)
    expect(pode(gerenteDuas, 'venda.criar', LOJA_5)).toBe(true)
  })

  it('lista só as unidades onde a capacidade vale', () => {
    expect(unidadesQuePodem(gerenteDuas, 'estoque.ajustar')).toEqual([LOJA_3])

    // quem chama precisa tratar o 'todas' — o teste faz o mesmo, de propósito
    const onde = unidadesQuePodem(gerenteDuas, 'venda.criar')
    expect(onde).not.toBe('todas')
    expect([...(onde as string[])].sort()).toEqual([LOJA_3, LOJA_5])
  })
})

describe('sem unidade, a pergunta é "em alguma?"', () => {
  it('serve para decidir o que aparece no menu', () => {
    expect(pode(gerente3, 'estoque.ajustar')).toBe(true)
    expect(pode(balcao3, 'estoque.ajustar')).toBe(false)
  })
})

describe('exigir', () => {
  it('passa em silêncio quando pode', () => {
    expect(() => exigir(dono, 'venda.criar', LOJA_3)).not.toThrow()
  })

  it('levanta SemPermissao quando não pode', () => {
    expect(() => exigir(balcao3, 'produto.preco', LOJA_3)).toThrow(SemPermissao)
  })

  it('o erro diz qual capacidade faltou', () => {
    try {
      exigir(balcao3, 'financeiro.lancar', LOJA_3)
      expect.unreachable('devia ter levantado')
    } catch (e) {
      expect(e).toBeInstanceOf(SemPermissao)
      expect((e as SemPermissao).capacidade).toBe('financeiro.lancar')
    }
  })
})

describe('sessão sem acesso nenhum', () => {
  it('não pode nada', () => {
    const ninguem = sessao('Ninguém', [])
    expect(pode(ninguem, 'venda.ver')).toBe(false)
    expect(pode(ninguem, 'produto.ver', LOJA_3)).toBe(false)
    expect(unidadesQuePodem(ninguem, 'venda.ver')).toEqual([])
  })
})

describe('conceder papel: ninguém dá o que não tem', () => {
  const gerente = sessao('Gerente', [{ papel: 'GERENTE', unidadeId: LOJA_3 }])

  it('o dono monta a equipe inteira', () => {
    for (const p of ['DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR'] as const) {
      expect(podeConceder(dono, p), `dono devia poder conceder ${p}`).toBe(true)
    }
  })

  it('o gerente contrata balconista', () => {
    expect(podeConceder(gerente, 'BALCAO', LOJA_3)).toBe(true)
  })

  it('mas NÃO se promove nem promove ninguém acima dele', () => {
    expect(podeConceder(gerente, 'DONO', LOJA_3)).toBe(false)
    expect(podeConceder(gerente, 'GERENTE', LOJA_3)).toBe(false)
    expect(podeConceder(gerente, 'FINANCEIRO', LOJA_3)).toBe(false)
  })

  it('e nem na loja que não é dele', () => {
    expect(podeConceder(gerente, 'BALCAO', LOJA_5)).toBe(false)
  })

  it('quem não gere equipe não concede nada', () => {
    expect(podeConceder(balcao3, 'BALCAO', LOJA_3)).toBe(false)
    expect(podeConceder(contador, 'CONTADOR')).toBe(false)
    expect(podeConceder(financeiro, 'BALCAO')).toBe(false)
  })

  it('SUPORTE não se concede pela tela do cliente — nem pelo dono', () => {
    expect(podeConceder(dono, 'SUPORTE')).toBe(false)
  })

  it('suporte vencido não concede nada', () => {
    const vencido = sessao('Suporte', [
      { papel: 'SUPORTE', unidadeId: null, expiraEm: new Date('2020-01-01') },
    ])
    expect(podeConceder(vencido, 'BALCAO')).toBe(false)
  })
})


// ─────────────────────────────────────────────────────────────
// DESCONTO — a capacidade que separa "abater" de "abater sem teto"
// ─────────────────────────────────────────────────────────────

describe('desconto acima do teto', () => {
  const com = (papel: Papel): Sessao => ({
    orgId: 'org-a',
    usuarioId: 'u1',
    nome: 'Fulano',
    acessos: [{ papel, unidadeId: null, expiraEm: null }],
  })

  it('o balcão NÃO passa do teto da empresa', () => {
    // Ele desconta até o limite que a dona configurou. Acima disso, chama
    // alguém — que é exatamente como funciona na loja de verdade.
    expect(pode(com('BALCAO'), 'venda.desconto')).toBe(false)
  })

  it('o gerente passa', () => {
    expect(pode(com('GERENTE'), 'venda.desconto')).toBe(true)
  })

  it('a dona passa', () => {
    expect(pode(com('DONO'), 'venda.desconto')).toBe(true)
  })

  it('quem não vende também não desconta', () => {
    expect(pode(com('CONTADOR'), 'venda.desconto')).toBe(false)
    expect(pode(com('FINANCEIRO'), 'venda.desconto')).toBe(false)
    expect(pode(com('SUPORTE'), 'venda.desconto')).toBe(false)
  })

  it('gerente de uma loja não desconta na loja do outro', () => {
    const preso: Sessao = {
      orgId: 'org-a',
      usuarioId: 'u2',
      nome: 'Gerente da 2',
      acessos: [{ papel: 'GERENTE', unidadeId: 'uni-a2', expiraEm: null }],
    }
    expect(pode(preso, 'venda.desconto', 'uni-a2')).toBe(true)
    expect(pode(preso, 'venda.desconto', 'uni-a1')).toBe(false)
  })
})
