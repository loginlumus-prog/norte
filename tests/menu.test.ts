import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MENU } from '../src/ui/menu'
import { pode, type Sessao, type Papel } from '../src/servidor/permissao'
import { moduloLigado, TODOS } from '../src/servidor/modulos'

// O menu é a primeira coisa que cada perfil vê. Este teste é a lista do que
// cada um DEVE ver — e, mais importante, do que NÃO deve. O balconista que
// enxerga "Financeiro" no menu já sabe que existe um número que não é dele.

const sessao = (papel: Papel): Sessao => ({
  orgId: 'org', usuarioId: `u-${papel}`, nome: papel, acessos: [{ papel, unidadeId: null }],
})

const visiveis = (papel: Papel, modulos: string[] = TODOS) =>
  MENU('x')
    .filter((i) => pode(sessao(papel), i.exige) && (!i.modulo || moduloLigado({ modulos }, i.modulo)))
    .map((i) => i.titulo)

describe('o que cada perfil vê no menu', () => {
  it('o dono vê tudo', () => {
    expect(visiveis('DONO')).toEqual([
      'Painel', 'Balcão', 'Vendas', 'Caixa', 'Crediário', 'Produtos', 'Estoque', 'Preços', 'Clientes', 'Equipe',
      'Tarefas', 'Financeiro', 'Análise', 'Assistente', 'Auditoria', 'Assinatura', 'Configurações',
    ])
  })

  it('o balcão vê só o que é dele — e nada de dinheiro', () => {
    const v = visiveis('BALCAO')
    // Tarefas entra: a lista de abertura da loja é trabalho de quem abre a
    // loja, e ela dá baixa no que é dela. Preços não: quem não mexe em preço
    // não precisa ver o custo.
    expect(v).toEqual(['Balcão', 'Vendas', 'Caixa', 'Crediário', 'Produtos', 'Estoque', 'Clientes', 'Tarefas'])
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
  })

  it('o contador só olha o dinheiro', () => {
    // A Análise entra porque ela é leitura de resultado, que é o trabalho
    // dele. Lá dentro a escala dos turnos não aparece: aquela parte pede
    // `caixa.ver`, e quem fecha o mês não precisa saber quem abriu a gaveta.
    expect(visiveis('CONTADOR')).toEqual(['Painel', 'Financeiro', 'Análise'])
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
    expect(visiveis('BALCAO', [])).not.toContain('Crediário')
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
