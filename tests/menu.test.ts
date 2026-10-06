import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MENU, itemNaEmpresa, noModo, podeVerItem } from '../src/ui/menu'
import { type Sessao, type Papel } from '../src/servidor/permissao'
import { TODOS } from '../src/servidor/modulos'
import { nomeDoGrupo, vocabularioDoRamo } from '../src/servidor/vocabulario'

// O menu é a primeira coisa que cada perfil vê. Este teste é a lista do que
// cada um DEVE ver — e, mais importante, do que NÃO deve. O balconista que
// enxerga "Financeiro" no menu já sabe que existe um número que não é dele.

const sessao = (papel: Papel): Sessao => ({
  orgId: 'org', usuarioId: `u-${papel}`, nome: papel, acessos: [{ papel, unidadeId: null }],
})

const visiveis = (papel: Papel, modulos: string[] = TODOS) =>
  MENU('x')
    .filter((i) => podeVerItem(sessao(papel), i) && itemNaEmpresa(i, { modulos }))
    .map((i) => i.titulo)

describe('o que cada perfil vê no menu', () => {
  it('o dono vê tudo', () => {
    expect(visiveis('DONO')).toEqual([
      'Painel', 'Balcão', 'Vendas', 'Caixa', 'Crediário', 'Encomendas', 'Catálogo', 'Mensalidades', 'Agenda', 'Funcionários', 'Turmas',
      'Produtos', 'Estoque', 'Fábrica', 'Compras', 'Material usado', 'Preços', 'Clientes', 'Equipe', 'Tarefas', 'Financeiro', 'Análise', 'Assistente',
      'Farol', 'Campanhas', 'Auditoria', 'Lojas', 'Assinatura', 'Indique e ganhe', 'Configurações',
    ])
  })

  it('o balcão vê só o que é dele — e nada de dinheiro', () => {
    const v = visiveis('BALCAO')
    // Tarefas entra: a lista de abertura da loja é trabalho de quem abre a
    // loja, e ela dá baixa no que é dela. Preços não: quem não mexe em preço
    // não precisa ver o custo.
    // Agenda, Funcionários (o próprio ponto) e Material usado entram: na
    // recepção do salão é ela quem marca, bate o ponto e anota o esmalte.
    // Compras não: é onde mora o CUSTO do que se compra.
    // Mensalidades e Turmas entram: na escola o balcão é a secretaria, que
    // matricula e recebe a mensalidade com o pai na frente.
    // Fábrica não: ver o estoque (que o balcão precisa para vender) não
    // abre a produção nem os pedidos — isso é `fabrica.ver`, do gerente.
    expect(v).toEqual([
      'Balcão', 'Vendas', 'Caixa', 'Crediário', 'Encomendas', 'Catálogo', 'Mensalidades', 'Agenda', 'Funcionários', 'Turmas',
      'Produtos', 'Estoque', 'Material usado', 'Clientes', 'Tarefas',
    ])
    expect(v).not.toContain('Fábrica')
    expect(v).not.toContain('Compras')
    expect(v).not.toContain('Preços')
    expect(v).not.toContain('Painel')
    expect(v).not.toContain('Financeiro')
    expect(v).not.toContain('Assinatura')
  })

  it('o gerente toca a operação, sem assinatura, configurações nem assistente', () => {
    const v = visiveis('GERENTE')
    expect(v).toContain('Painel')
    expect(v).toContain('Equipe')
    expect(v).toContain('Tarefas')
    expect(v).toContain('Preços')
    expect(v).toContain('Auditoria')
    expect(v).not.toContain('Assinatura')
    expect(v).not.toContain('Configurações')
    expect(v).not.toContain('Assistente')
    expect(v).not.toContain('Campanhas')
  })

  it('o contador só olha o dinheiro', () => {
    // A Análise entra porque ela é leitura de resultado, que é o trabalho
    // dele. Lá dentro a escala dos turnos não aparece: aquela parte pede
    // `caixa.ver`, e quem fecha o mês não precisa saber quem abriu a gaveta.
    //
    // Funcionários e Compras também são dinheiro: as horas do mês são a folha
    // de pagamento (que costuma ser ele quem fecha) e a compra é conta a
    // pagar. Ele LÊ as duas — não bate ponto de ninguém, não pede nada.
    // As mensalidades também: são a receita da escola. As turmas não.
    expect(visiveis('CONTADOR')).toEqual(['Painel', 'Mensalidades', 'Funcionários', 'Compras', 'Financeiro', 'Análise'])
  })

  it('o financeiro vê vendas e caixa, e não vende', () => {
    const v = visiveis('FINANCEIRO')
    expect(v).toContain('Financeiro')
    expect(v).toContain('Caixa')
    expect(v).not.toContain('Balcão')
    expect(v).not.toContain('Produtos')
  })

  it('módulo desligado some do menu de todo mundo', () => {
    expect(visiveis('DONO', [])).not.toContain('Crediário')
    expect(visiveis('DONO', [])).not.toContain('Assistente')
    // Campanha sai pelo número do assistente: sem o módulo, some junto.
    expect(visiveis('DONO', [])).not.toContain('Campanhas')
    expect(visiveis('BALCAO', [])).not.toContain('Crediário')
    expect(visiveis('DONO', [])).not.toContain('Encomendas')
  })
})

describe('o atendimento no menu', () => {
  it('Funcionários existe com o Ponto OU com a Agenda — é a lista de quem atende', () => {
    expect(visiveis('DONO', ['agenda'])).toContain('Funcionários')
    expect(visiveis('DONO', ['ponto'])).toContain('Funcionários')
    expect(visiveis('DONO', ['compras'])).not.toContain('Funcionários')
    expect(visiveis('DONO', ['ponto'])).not.toContain('Agenda')
  })

  it('clientes, balcão, vendas e produtos levam a palavra do ramo ("Pacientes", "Recepção", "Recebimentos", "Serviços e materiais")', () => {
    const por = (href: string) => MENU('x').find((i) => i.href === href)!
    expect(por('/x/clientes').vocabulario).toBe('Pessoas')
    expect(por('/x/balcao').vocabulario).toBe('Balcao')
    expect(por('/x/vendas').vocabulario).toBe('Vendas')
    expect(por('/x/produtos').vocabulario).toBe('Produtos')
    expect(MENU('x').filter((i) => i.vocabulario)).toHaveLength(4)
  })

  it('o título de cada item com vocabulário é a palavra da LOJA — a do ramo entra na Estrutura', () => {
    // O menu cru é o da loja: quem lê MENU() sem empresa (testes, guia) vê
    // "Balcão" e "Vendas", e a troca acontece num lugar só.
    const loja = vocabularioDoRamo('roupa')
    for (const i of MENU('x').filter((x) => x.vocabulario)) expect(i.titulo).toBe(loja[i.vocabulario!])
  })

  it('o grupo "Vender" vira "Recepção" na clínica e "Secretaria" na escola; os outros grupos não mudam', () => {
    const grupos = (ramo: string) => [...new Set(MENU('x').map((i) => i.grupo && nomeDoGrupo(i.grupo, vocabularioDoRamo(ramo))).filter(Boolean))]
    expect(grupos('roupa')).toEqual(['Vender', 'Atendimento', 'Catálogo', 'Pessoas', 'Dinheiro', 'Empresa'])
    expect(grupos('saude')).toEqual(['Recepção', 'Atendimento', 'Catálogo', 'Pessoas', 'Dinheiro', 'Empresa'])
    expect(grupos('beleza')[0]).toBe('Recepção')
    expect(grupos('escola')[0]).toBe('Secretaria')
    expect(grupos('petshop')[0]).toBe('Vender')
  })

  it('sem o módulo, nada do atendimento aparece', () => {
    for (const papel of ['DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR'] as Papel[]) {
      const v = visiveis(papel, [])
      for (const t of ['Agenda', 'Funcionários', 'Compras', 'Material usado']) expect(v, papel).not.toContain(t)
    }
  })
})

describe('o menu não leva a lugar nenhum que não exista', () => {
  it('toda tela do menu tem arquivo de página', () => {
    const raiz = join(import.meta.dirname, '..', 'src', 'app', '[empresa]')
    for (const item of MENU('x')) {
      if (item.emBreve) continue
      const seg = item.href.replace('/x', '').replace(/^\//, '')
      const arquivo = seg ? join(raiz, seg, 'page.tsx') : join(raiz, 'page.tsx')
      expect(existsSync(arquivo), `${item.titulo} → ${arquivo}`).toBe(true)
    }
  })

  it('nada mais está marcado como "em breve"', () => {
    expect(MENU('x').filter((i) => i.emBreve)).toEqual([])
  })
})

describe('o modo simples', () => {
  const titulos = (itens: ReturnType<typeof MENU>) => itens.map((i) => i.titulo)

  it('esconde as telas de análise e mantém o dia a dia', () => {
    const v = titulos(noModo(MENU('x'), 'simples'))
    for (const t of ['Caixa', 'Preços', 'Análise', 'Auditoria']) expect(v).not.toContain(t)
    for (const t of ['Painel', 'Balcão', 'Vendas', 'Produtos', 'Estoque', 'Financeiro']) expect(v).toContain(t)
  })

  it('o avançado mostra tudo', () => {
    expect(noModo(MENU('x'), 'avancado')).toEqual(MENU('x'))
  })

  // Quem chegou na Análise por um link precisa ver onde está, mesmo no
  // simples: some do menu o que não está aberto, nunca a tela aberta.
  it('a tela aberta nunca some do menu', () => {
    expect(titulos(noModo(MENU('x'), 'simples', '/x/analise'))).toContain('Análise')
  })

  it('o que é avançado é só leitura de análise — nada de vender some', () => {
    for (const i of MENU('x').filter((i) => i.avancado)) {
      expect(i.exige, i.titulo).not.toBe('venda.criar')
    }
  })
})
