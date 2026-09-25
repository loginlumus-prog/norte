import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MENU } from '../src/ui/menu'
import { CAPACIDADES } from '../src/servidor/permissao'
import { LIBERACOES, PLANOS } from '../src/servidor/planos'
import {
  GUIA,
  buscarNoGuia,
  entradaDaTela,
  manualComoTexto,
  rotuloDoPlano,
  tokenizar,
} from '../src/servidor/guia'
import { temChaveIA, perguntar, RECADO_FALHA } from '../src/servidor/ia'

// O manual é a única parte do sistema que promete em texto o que o código
// faz. Estes testes não conferem se o texto está certo — isso é leitura —,
// mas conferem que toda tela tem manual, que todo manual aponta para uma
// tela que existe, e que a busca acha o que a loja pergunta.

const raiz = join(import.meta.dirname, '..', 'src', 'app', '[empresa]')

describe('toda tela do menu tem manual', () => {
  for (const item of MENU('x')) {
    const caminho = item.href.replace('/x', '')
    it(`${item.titulo} (${caminho || '/'})`, () => {
      const e = GUIA.find((g) => g.caminho === caminho)
      expect(e, `sem entrada para ${caminho}`).toBeDefined()
      expect(e!.comoFazer.length).toBeGreaterThanOrEqual(3)
      expect(e!.perguntas.length).toBeGreaterThanOrEqual(2)
    })
  }

  it('toda entrada aponta para uma página que existe', () => {
    for (const e of GUIA) {
      const seg = e.caminho.replace(/^\//, '')
      const arquivo = seg ? join(raiz, seg, 'page.tsx') : join(raiz, 'page.tsx')
      expect(existsSync(arquivo), `${e.titulo} → ${arquivo}`).toBe(true)
    }
  })

  it('cada tela tem de 3 a 7 como-fazer, cada um com 3 a 7 passos, e de 2 a 4 perguntas', () => {
    for (const e of GUIA) {
      expect(e.comoFazer.length, e.titulo).toBeGreaterThanOrEqual(3)
      expect(e.comoFazer.length, e.titulo).toBeLessThanOrEqual(7)
      expect(e.perguntas.length, e.titulo).toBeGreaterThanOrEqual(2)
      expect(e.perguntas.length, e.titulo).toBeLessThanOrEqual(4)
      for (const c of e.comoFazer) {
        expect(c.passos.length, `${e.titulo} › ${c.titulo}`).toBeGreaterThanOrEqual(3)
        expect(c.passos.length, `${e.titulo} › ${c.titulo}`).toBeLessThanOrEqual(7)
      }
    }
  })

  it('chaves e caminhos não se repetem', () => {
    expect(new Set(GUIA.map((e) => e.chave)).size).toBe(GUIA.length)
    expect(new Set(GUIA.map((e) => e.caminho)).size).toBe(GUIA.length)
  })

  it('toda capacidade e todo plano citados existem de verdade', () => {
    for (const e of GUIA) {
      for (const c of e.comoFazer) {
        if (c.capacidade) expect(CAPACIDADES, `${e.titulo} › ${c.titulo}`).toContain(c.capacidade)
        if (c.plano) {
          const existe = c.plano in LIBERACOES || c.plano in PLANOS
          expect(existe, `${e.titulo} › ${c.titulo}: ${c.plano}`).toBe(true)
        }
      }
    }
  })
})

describe('a tela atual', () => {
  it('acha o prefixo mais longo', () => {
    expect(entradaDaTela('/financeiro/fechamento')?.chave).toBe('fechamento')
    expect(entradaDaTela('/financeiro')?.chave).toBe('financeiro')
    expect(entradaDaTela('/financeiro/outra-coisa')?.chave).toBe('financeiro')
    expect(entradaDaTela('/produtos/abc123/etiquetas')?.chave).toBe('produtos')
    expect(entradaDaTela('/vendas/xyz')?.chave).toBe('vendas')
  })

  it("'' e '/' são o painel; caminho desconhecido não é nada", () => {
    expect(entradaDaTela('')?.chave).toBe('painel')
    expect(entradaDaTela('/')?.chave).toBe('painel')
    expect(entradaDaTela('/nao-existe')).toBeUndefined()
  })
})

describe('a busca', () => {
  it('"como abrir o caixa" traz Caixa ou Balcão em primeiro', () => {
    const r = buscarNoGuia('como abrir o caixa')
    expect(r.length).toBeGreaterThan(0)
    expect(['caixa', 'balcao']).toContain(r[0]!.entrada.chave)
    expect(r[0]!.passos.some((p) => /abrir/i.test(p.titulo))).toBe(true)
  })

  it('"vender fiado" traz o Crediário', () => {
    expect(buscarNoGuia('vender fiado')[0]!.entrada.chave).toBe('crediario')
  })

  it('"imprimir etiqueta" traz Produtos; "sangria" traz Caixa; "convidar funcionário" traz Equipe', () => {
    expect(buscarNoGuia('imprimir etiqueta')[0]!.entrada.chave).toBe('produtos')
    expect(buscarNoGuia('sangria')[0]!.entrada.chave).toBe('caixa')
    expect(buscarNoGuia('convidar funcionário')[0]!.entrada.chave).toBe('equipe')
  })

  it('ignora acento e caixa', () => {
    const a = buscarNoGuia('cadastrar produto')
    const b = buscarNoGuia('CADASTRAR PRODUTÓ')
    expect(a.map((r) => [r.entrada.chave, r.pontos])).toEqual(b.map((r) => [r.entrada.chave, r.pontos]))
    expect(a[0]!.entrada.chave).toBe('produtos')
  })

  it('ignora palavras vazias e curtas', () => {
    expect(tokenizar('como eu quero de o a')).toEqual([])
    expect(tokenizar('Como eu faço para abrir o caixa?')).toEqual(['abrir', 'caixa'])
    expect(buscarNoGuia('como eu quero')).toEqual([])
  })

  it('a tela atual ganha 2 pontos quando casa com algo', () => {
    const sem = buscarNoGuia('estoque').find((r) => r.entrada.chave === 'produtos')
    const com = buscarNoGuia('estoque', '/produtos').find((r) => r.entrada.chave === 'produtos')
    expect(sem).toBeDefined()
    expect(com!.pontos).toBe(sem!.pontos + 2)
  })

  it('a tela atual não aparece só por ser a atual', () => {
    const r = buscarNoGuia('sangria', '/clientes')
    expect(r.find((x) => x.entrada.chave === 'clientes')).toBeUndefined()
  })

  it('devolve no máximo cinco, em ordem de pontos', () => {
    const r = buscarNoGuia('venda cliente caixa produto estoque financeiro')
    expect(r.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < r.length; i++) expect(r[i - 1]!.pontos).toBeGreaterThanOrEqual(r[i]!.pontos)
  })
})

describe('o manual em texto', () => {
  it('contém o título de toda entrada e o nome das capacidades em palavras', () => {
    const t = manualComoTexto()
    for (const e of GUIA) expect(t).toContain(`## ${e.titulo}`)
    expect(t).toContain('quem pode: operar o caixa')
    expect(t).not.toContain('caixa.operar')
  })

  it('o plano vira frase com o artigo certo', () => {
    expect(rotuloDoPlano('precos.margem')).toBe('do Balcão para cima')
    expect(rotuloDoPlano('ruptura.previsao')).toBe('da Direção para cima')
    expect(rotuloDoPlano('REDE')).toBe('da Direção para cima')
    expect(rotuloDoPlano('GRATIS')).toBe('em todo plano')
  })
})

describe('a IA', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('temChaveIA reflete a variável de ambiente', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(temChaveIA()).toBe(false)
    vi.stubEnv('ANTHROPIC_API_KEY', '   ')
    expect(temChaveIA()).toBe(false)
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-teste')
    expect(temChaveIA()).toBe(true)
  })

  it('manda o pedido no formato da API e devolve texto e tokens', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-teste')
    const fetchFalso = vi.fn(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body))
      expect(corpo.model).toBe('claude-haiku-4-5-20251001')
      expect(corpo.system).toBe('manual')
      expect(corpo.messages).toEqual([{ role: 'user', content: 'oi' }])
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-teste')
      expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01')
      return new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'Olá.' }], usage: { input_tokens: 12, output_tokens: 3 } }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchFalso)
    const r = await perguntar({ sistema: 'manual', mensagens: [{ papel: 'usuario', texto: 'oi' }] })
    expect(r).toEqual({ texto: 'Olá.', entrada: 12, saida: 3 })
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('erro HTTP vira a frase amiga, sem o corpo', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-teste')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"segredo"}', { status: 429 })))
    await expect(perguntar({ sistema: 's', mensagens: [{ papel: 'usuario', texto: 'oi' }] })).rejects.toThrow(RECADO_FALHA)
  })

  it('sem chave, nem tenta', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const fetchFalso = vi.fn()
    vi.stubGlobal('fetch', fetchFalso)
    await expect(perguntar({ sistema: 's', mensagens: [] })).rejects.toThrow(RECADO_FALHA)
    expect(fetchFalso).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
// Auditoria de 25/09: a busca não manda ninguém para uma parede
// ─────────────────────────────────────────────────────────────

import { telaAbre, type QuemLe } from '../src/servidor/guia'
import { PODERES } from '../src/servidor/permissao'

describe('o guia só mostra as telas que a pessoa abre', () => {
  const BALCAO: QuemLe = { capacidades: PODERES.BALCAO, modulos: [] }
  const DONO: QuemLe = { capacidades: PODERES.DONO, modulos: ['crediario', 'encomenda', 'agente'] }

  it('toda tela com página própria diz quem a abre (menos painel e entrar, que são de todos)', () => {
    const semRegua = GUIA.filter((e) => !e.abre).map((e) => e.chave)
    expect(semRegua.sort()).toEqual(['entrar', 'painel'])
  })

  it('a balconista procura "planos" e não recebe Assinatura — ela cairia no "este endereço não abre"', () => {
    const achou = buscarNoGuia('planos assinatura mensalidade', undefined, BALCAO).map((r) => r.entrada.chave)
    expect(achou).not.toContain('assinatura')
    expect(buscarNoGuia('planos assinatura mensalidade', undefined, DONO).map((r) => r.entrada.chave)).toContain('assinatura')
  })

  it('nenhum resultado da balconista é tela que ela não abre', () => {
    for (const pergunta of ['caixa', 'preço', 'relatório', 'equipe', 'configurar', 'fiado', 'auditoria', 'financeiro']) {
      for (const r of buscarNoGuia(pergunta, undefined, BALCAO)) {
        expect(telaAbre(r.entrada, BALCAO), `${pergunta} → ${r.entrada.chave}`).toBe(true)
      }
    }
  })

  it('crediário desligado some da busca até para o dono', () => {
    const semFiado: QuemLe = { ...DONO, modulos: [] }
    expect(buscarNoGuia('fiado crediário', undefined, semFiado).map((r) => r.entrada.chave)).not.toContain('crediario')
    expect(buscarNoGuia('fiado crediário', undefined, DONO).map((r) => r.entrada.chave)).toContain('crediario')
  })

  it('assinatura abre também para o financeiro — a fatura é conta a pagar', () => {
    const assinatura = GUIA.find((e) => e.chave === 'assinatura')!
    expect(telaAbre(assinatura, { capacidades: PODERES.FINANCEIRO, modulos: [] })).toBe(true)
    expect(telaAbre(assinatura, { capacidades: PODERES.BALCAO, modulos: [] })).toBe(false)
  })
})
