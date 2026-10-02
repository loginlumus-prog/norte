// Como cada ramo fala da venda (servidor/vocabulario.ts, PalavrasDaVenda).
//
// Duas garantias. A primeira: a LOJA fala exatamente como sempre falou — o
// vocabulário novo existe para a clínica, e a loja de roupa que abrir o
// painel amanhã tem que ler "Vendido hoje · 15 vendas", palavra por palavra.
// A segunda: a clínica, o salão e a escola não leem mais o painel da loja.

import { describe, it, expect } from 'vitest'
import { vocabularioDoRamo, nomesNoGuia, nomeDoGrupo, type PalavrasDaVenda } from '../src/servidor/vocabulario'
import { RAMOS } from '../src/servidor/modulos'
import { montarPendencias } from '../src/servidor/pendencias'
import { concorda } from '../src/ui/texto'

/** O texto que a loja sempre escreveu. Mudar um destes é mudar a tela de toda loja. */
const DA_LOJA: PalavrasDaVenda = {
  grupoVender: 'Vender',
  Vendas: 'Vendas',
  Contagem: 'Vendas',
  venda: 'venda',
  vendas: 'vendas',
  Venda: 'Venda',
  vendaFeminina: true,
  aVenda: 'a venda',
  naVenda: 'na venda',
  daVenda: 'da venda',
  estaVenda: 'esta venda',
  destaVenda: 'desta venda',
  nestaVenda: 'nesta venda',
  umaVenda: 'uma venda',
  nenhumaVenda: 'Nenhuma venda',
  novaVenda: 'Nova venda',
  vendaConcluida: 'Venda concluída',
  Pedido: 'Pedido',
  vender: 'vender',
  Vender: 'Vender',
  vendeu: 'Vendeu',
  Vendedor: 'Vendedor',
  Vendido: 'Vendido',
  ticketMedio: 'Ticket médio',
  maisVendidos: 'Mais vendidos',
  quandoVende: 'Quando a loja vende',
  compra: 'compra',
  compras: 'compras',
  quemCompra: 'Quem está comprando?',
  compraram: 'compraram',
  produto: 'produto',
  produtos: 'produtos',
  produtoEhServico: false,
  novoProduto: 'Novo produto',
  resumoCadastro: 'Nome, preço e código.',
  mercadoria: 'mercadoria',
  aMercadoria: 'A mercadoria',
  umItemDeEstoque: 'um produto',
  itemDeEstoque: 'produto',
  itensDeEstoque: 'produtos',
  acabouNoEstoque: 'Sem saldo para vender — é venda indo para o vizinho.',
  foraDoTotal: null,
  naFicha: {
    Gastou: 'Gastou', Ultima: 'Última compra', Contagem: 'Compras',
    comprou: 'comprou', compraram: 'compraram', nunca: 'nunca comprou', nuncaPlural: 'nunca compraram',
    uma: 'compra', varias: 'compras',
  },
}

const SERVICO = ['saude', 'beleza', 'escola'] as const
const chaves = Object.keys(DA_LOJA) as (keyof PalavrasDaVenda)[]
const daVenda = (ramo: string | null) => Object.fromEntries(chaves.map((k) => [k, vocabularioDoRamo(ramo)[k]]))

describe('a loja fala como sempre falou', () => {
  it('todo ramo de comércio tem as palavras de sempre, uma por uma', () => {
    const comercio = Object.keys(RAMOS).filter((r) => !(SERVICO as readonly string[]).includes(r))
    // Pet shop entra aqui de propósito: ração é mercadoria e o banho é uma
    // linha do catálogo. Quem fala "serviço" nele é o próprio item (24×).
    expect(comercio).toContain('petshop')
    expect(comercio).toContain('roupa')
    for (const r of comercio) expect(daVenda(r), r).toEqual(DA_LOJA)
  })

  it('ramo vazio, desconhecido ou nome de propriedade de objeto também fala como loja', () => {
    for (const r of [null, undefined, '', 'nao-existe', 'toString', '__proto__']) expect(daVenda(r as string | null)).toEqual(DA_LOJA)
  })

  it('a loja também mantém balcão, produtos e cliente', () => {
    expect(vocabularioDoRamo('roupa')).toMatchObject({
      Balcao: 'Balcão', oBalcao: 'o balcão', noBalcao: 'no balcão', peloBalcao: 'pelo balcão',
      Produtos: 'Produtos', Pessoa: 'Cliente', pessoa: 'cliente',
    })
    expect(nomesNoGuia(vocabularioDoRamo('roupa'))).toEqual({})
    expect(nomeDoGrupo('Vender', vocabularioDoRamo('roupa'))).toBe('Vender')
  })

  it('o "Precisa de você" da loja continua falando de produto', () => {
    const [acabou, minimo] = montarPendencias({ acabaram: 2, noMinimo: 1 }, 'loja')
    expect(acabou!.frase).toBe('2 produtos acabaram')
    expect(acabou!.detalhe).toBe(DA_LOJA.acabouNoEstoque)
    expect(minimo!.frase).toBe('1 produto no mínimo')
    // Passar a palavra da loja dá o mesmo que não passar nada.
    expect(montarPendencias({ acabaram: 2, noMinimo: 1 }, 'loja', null, vocabularioDoRamo('roupa'))).toEqual(
      montarPendencias({ acabaram: 2, noMinimo: 1 }, 'loja'),
    )
  })
})

describe('quem atende não lê o painel da loja', () => {
  it('a clínica recebe atendimentos na recepção', () => {
    const v = vocabularioDoRamo('saude')
    expect(v).toMatchObject({
      grupoVender: 'Recepção',
      Vendas: 'Recebimentos',
      Contagem: 'Atendimentos',
      venda: 'atendimento',
      Vendido: 'Recebido',
      ticketMedio: 'Valor médio',
      maisVendidos: 'Mais procurados',
      Vender: 'Receber',
      vendeu: 'Atendeu',
      Vendedor: 'Quem atendeu',
      produto: 'serviço',
      produtoEhServico: true,
      novoProduto: 'Novo serviço ou material',
      resumoCadastro: 'Nome, preço e duração.',
      aMercadoria: 'O material',
      noBalcao: 'na recepção',
    })
  })

  it('"atendimento" é masculino: as contrações concordam', () => {
    const v = vocabularioDoRamo('beleza')
    expect(v).toMatchObject({
      vendaFeminina: false,
      aVenda: 'o atendimento',
      naVenda: 'no atendimento',
      estaVenda: 'este atendimento',
      destaVenda: 'deste atendimento',
      nestaVenda: 'neste atendimento',
      umaVenda: 'um atendimento',
      nenhumaVenda: 'Nenhum atendimento',
      novaVenda: 'Novo atendimento',
      vendaConcluida: 'Atendimento concluído',
      Pedido: 'Atendimento',
      novoProduto: 'Novo serviço ou produto',
    })
    expect(concorda(v, 'concluída', 'concluído')).toBe('concluído')
    expect(concorda(vocabularioDoRamo('roupa'), 'concluída', 'concluído')).toBe('concluída')
  })

  it('a escola recebe na secretaria, e o catálogo dela continua de produtos', () => {
    const v = vocabularioDoRamo('escola')
    expect(v).toMatchObject({
      grupoVender: 'Secretaria',
      Vendas: 'Recebimentos',
      venda: 'recebimento',
      Vendido: 'Recebido',
      Vender: 'Receber',
      oBalcao: 'a secretaria',
      produto: 'produto',
      produtoEhServico: false,
      Produtos: 'Produtos',
      mercadoria: 'material',
      // A mensalidade tem conta própria: o "Recebido hoje" da secretaria diz que não a soma.
      foraDoTotal: 'sem as mensalidades',
    })
    expect(vocabularioDoRamo('saude').foraDoTotal).toBeNull()
    expect(nomeDoGrupo('Vender', v)).toBe('Secretaria')
  })

  it('nenhum ramo de serviço escreve "venda" nem "vendido" nas palavras da tela', () => {
    for (const r of SERVICO) {
      const v = vocabularioDoRamo(r)
      const textos = chaves.filter((k) => k !== 'acabouNoEstoque').map((k) => v[k]).filter((x): x is string => typeof x === 'string')
      for (const t of textos) expect(t, `${r}: ${t}`).not.toMatch(/\bvend(a|as|ido|idos|er|eu|edor)\b/i)
    }
  })

  it('o guia e o assistente usam o nome do menu para a lista de vendas', () => {
    expect(nomesNoGuia(vocabularioDoRamo('saude')).vendas).toBe('Recebimentos')
    expect(nomesNoGuia(vocabularioDoRamo('escola')).vendas).toBe('Recebimentos')
  })

  it('o "Precisa de você" da clínica fala de material', () => {
    const [acabou, minimo] = montarPendencias({ acabaram: 1, noMinimo: 2 }, 'clinica', null, vocabularioDoRamo('saude'))
    expect(acabou!.frase).toBe('1 material acabou')
    expect(acabou!.detalhe).not.toMatch(/venda/)
    expect(minimo!.frase).toBe('2 materiais no mínimo')
  })
})
