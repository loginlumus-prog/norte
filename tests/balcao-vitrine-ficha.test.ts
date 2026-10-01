// O balcão simples e a ficha, sem banco: o código da etiqueta no cartão, o
// "tirar um" do clique direito, a contagem de peças e o texto do pagamento
// na linha do tempo da ficha.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { etiquetaDoProduto, tirarUmDoPedido } from '../src/app/[empresa]/balcao/vitrine'
import { contagemDoPedido, palavraDaContagem } from '../src/app/[empresa]/balcao/ramo'
import { faltaNoCadastro, parcelasDoPagamento } from '../src/servidor/cliente'

describe('o código da etiqueta no cartão', () => {
  it('a grade mostra a etiqueta comum, antes do hífen', () => {
    expect(etiquetaDoProduto(['005990-36', '005990-37', '005990-38'])).toBe('005990')
    expect(etiquetaDoProduto(['005943-G-BEGE', '005943-M-BEGE', '005943-GG-LARANJ'])).toBe('005943')
    expect(etiquetaDoProduto(['abc-1', 'ABC-2'])).toBe('ABC')
  })

  it('a peça única mostra o código dela, inteiro', () => {
    expect(etiquetaDoProduto(['005269'])).toBe('005269')
    expect(etiquetaDoProduto(['5029-34'])).toBe('5029-34')
  })

  it('códigos soltos não têm etiqueta comum: o cartão não inventa uma', () => {
    expect(etiquetaDoProduto(['SAP012', 'SAP013', 'SAP014'])).toBeNull()
    expect(etiquetaDoProduto(['005990-36', '006001-36'])).toBeNull()
  })

  it('variação sem código: nada', () => {
    expect(etiquetaDoProduto([])).toBeNull()
    expect(etiquetaDoProduto([null])).toBeNull()
    expect(etiquetaDoProduto(['005990-36', null])).toBeNull()
    expect(etiquetaDoProduto(['  '])).toBeNull()
  })
})

describe('tirar um do pedido (o clique direito)', () => {
  const l = (id: string, quantidade: number, medida = 'UN', extra: { encomendaId?: string } = {}) => ({ id, quantidade, medida, ...extra })

  it('tira uma unidade; com uma só, a linha sai', () => {
    expect(tirarUmDoPedido([l('a', 3)], ['a'])).toEqual([l('a', 2)])
    expect(tirarUmDoPedido([l('a', 1), l('b', 2)], ['a'])).toEqual([l('b', 2)])
  })

  it('com dois tamanhos do mesmo produto, sai o último que ENTROU', () => {
    // P entrou, depois M, depois mais um P: o último toque foi no P.
    const pedido = [l('p', 2), l('m', 1)]
    expect(tirarUmDoPedido(pedido, ['p', 'm'], ['p', 'm', 'p'])).toEqual([l('p', 1), l('m', 1)])
    // Último toque no M: sai o M.
    expect(tirarUmDoPedido(pedido, ['p', 'm'], ['p', 'p', 'm'])).toEqual([l('p', 2)])
  })

  it('sem a ordem dos toques (pedido recuperado), vale a última linha', () => {
    expect(tirarUmDoPedido([l('p', 2), l('m', 1)], ['p', 'm'])).toEqual([l('p', 2)])
  })

  it('peça a peso sai inteira', () => {
    expect(tirarUmDoPedido([l('acai', 0.35, 'KG')], ['acai'])).toEqual([])
    expect(tirarUmDoPedido([l('tecido', 2.5, 'M')], ['tecido'])).toEqual([])
  })

  it('o que não está no pedido não mexe em nada; a encomenda nunca sai por aqui', () => {
    expect(tirarUmDoPedido([l('a', 1)], ['x'])).toBeNull()
    expect(tirarUmDoPedido([l('enc', 1, 'UN', { encomendaId: 'e1' })], ['enc'])).toBeNull()
  })

  it('não muda o pedido que recebeu', () => {
    const pedido = [l('a', 2)]
    tirarUmDoPedido(pedido, ['a'])
    expect(pedido).toEqual([l('a', 2)])
  })
})

describe('a contagem do pedido', () => {
  it('na loja de roupa e de calçado conta peça; no resto, item', () => {
    expect(contagemDoPedido('roupa', 1)).toBe('1 peça')
    expect(contagemDoPedido('roupa', 3)).toBe('3 peças')
    expect(contagemDoPedido('calcados', 2)).toBe('2 peças')
    expect(contagemDoPedido('sorveteria', 2)).toBe('2 itens')
    expect(contagemDoPedido(null, 1)).toBe('1 item')
    expect(palavraDaContagem('bijuteria', 1)).toBe('peça')
  })
})

describe('a ficha no balcão, sem banco', () => {
  it('o que falta no cadastro', () => {
    expect(faltaNoCadastro({ telefone: null, documento: null, endereco: null })).toEqual(['CPF', 'telefone', 'endereço'])
    expect(faltaNoCadastro({ telefone: '71999990000', documento: '52998224725', endereco: 'Rua A' })).toEqual([])
  })

  it('o pagamento diz que parcelas abateu, agrupadas por compra', () => {
    expect(
      parcelasDoPagamento([
        { numero: 2, de: 5, vendaNumero: 41 },
        { numero: 3, de: 5, vendaNumero: 41 },
        { numero: 1, de: 2, vendaNumero: 7 },
        // a mesma parcela paga em duas formas (Pix + dinheiro) aparece uma vez
        { numero: 3, de: 5, vendaNumero: 41 },
      ]),
    ).toBe('parcelas 2/5, 3/5 da compra 41; parcela 1/2 da compra 7')
  })
})

describe('a versão que o balcão compara (aviso de versão nova)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('no desenvolvimento não há versão: o aviso nunca aparece', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { versaoDoBuild } = await import('../src/app/[empresa]/balcao/versaoDoBuild')
    expect(versaoDoBuild()).toBeNull()
  })

  it('em produção é o BUILD_ID do build (ou o commit, sem ele)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NORTE_COMMIT', 'abcdef1234567890')
    const { versaoDoBuild } = await import('../src/app/[empresa]/balcao/versaoDoBuild')
    const arquivo = join(process.cwd(), '.next', 'BUILD_ID')
    const esperado = existsSync(arquivo) ? readFileSync(arquivo, 'utf8').trim() : 'abcdef123456'
    expect(versaoDoBuild()).toBe(esperado)
  })
})
