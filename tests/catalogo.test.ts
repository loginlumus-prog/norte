// As regras puras do catálogo da loja: o link, o telefone, o pedido que a
// cliente manda e o que a página de acompanhar diz.

import { describe, it, expect } from 'vitest'
import {
  conferirPedido,
  disponivelNoCatalogo,
  ENDERECO,
  limparTelefone,
  limparWhatsapp,
  mensagemDoPedido,
  resumoDosItens,
  situacaoParaCliente,
  sugerirEndereco,
  tipoDaImagem,
} from '../src/servidor/catalogo'

describe('o endereço do link', () => {
  it('nasce do nome da loja, sem acento nem espaço', () => {
    expect(sugerirEndereco('Itinga (SESI)')).toBe('itinga-sesi')
    expect(sugerirEndereco('São Cristóvão')).toBe('sao-cristovao')
    expect(sugerirEndereco('  ')).toBe('loja')
  })
  it('aceita só letras, números e hífen', () => {
    expect(ENDERECO.test('centro')).toBe(true)
    expect(ENDERECO.test('loja-2')).toBe(true)
    expect(ENDERECO.test('-loja')).toBe(false)
    expect(ENDERECO.test('Loja')).toBe(false)
    expect(ENDERECO.test('a/b')).toBe(false)
  })
})

describe('telefones', () => {
  it('o WhatsApp da loja ganha o 55', () => {
    expect(limparWhatsapp('(71) 99999-0000')).toBe('5571999990000')
    expect(limparWhatsapp('+55 71 99999-0000')).toBe('5571999990000')
    expect(limparWhatsapp('123')).toBeNull()
  })
  it('o da cliente fica com DDD, sem o 55', () => {
    expect(limparTelefone('(71) 99999-0000')).toBe('71999990000')
    expect(limparTelefone('5571999990000')).toBe('71999990000')
    expect(limparTelefone('9999-0000')).toBeNull()
  })
})

describe('o pedido que chega da página', () => {
  const base = {
    nome: '  Ana   Souza ',
    telefone: '(71) 98888-7777',
    entrega: false,
    forma: 'PIX' as const,
    itens: [{ variacaoId: 'v-1', quantidade: 2 }],
  }
  it('limpa o nome e junta o mesmo item mandado duas vezes', () => {
    const r = conferirPedido({ ...base, itens: [{ variacaoId: 'v-1', quantidade: 2 }, { variacaoId: 'v-1', quantidade: 1 }] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.limpo.nome).toBe('Ana Souza')
      expect(r.limpo.itens).toEqual([{ variacaoId: 'v-1', quantidade: 3, observacao: null, precoVisto: null }])
      expect(r.limpo.paraData).toBeNull()
    }
  })
  it('recusa o que não serve', () => {
    expect(conferirPedido({ ...base, nome: 'A' }).ok).toBe(false)
    expect(conferirPedido({ ...base, telefone: '123' }).ok).toBe(false)
    expect(conferirPedido({ ...base, itens: [] }).ok).toBe(false)
    expect(conferirPedido({ ...base, itens: [{ variacaoId: 'v-1', quantidade: -1 }] }).ok).toBe(false)
    expect(conferirPedido({ ...base, itens: [{ variacaoId: "x'; drop", quantidade: 1 }] }).ok).toBe(false)
    expect(conferirPedido({ ...base, forma: 'CREDIARIO' as never }).ok).toBe(false)
    expect(conferirPedido({ ...base, entrega: true, endereco: 'rua' }).ok).toBe(false)
  })
  it('horário no passado não vale; troco só com dinheiro', () => {
    const agora = new Date('2026-10-02T15:00:00Z')
    expect(conferirPedido({ ...base, para: '2026-10-02T12:00:00Z' }, agora).ok).toBe(false)
    const r = conferirPedido({ ...base, forma: 'PIX', trocoPara: 50 }, agora)
    expect(r.ok && r.limpo.trocoPara).toBe(null)
    const d = conferirPedido({ ...base, forma: 'DINHEIRO', trocoPara: 50 }, agora)
    expect(d.ok && d.limpo.trocoPara).toBe(50)
  })
})

describe('o que aparece como disponível', () => {
  const sem = { servico: false, feitoNoDia: false }
  it('com estoque lançado, só se tem', () => {
    expect(disponivelNoCatalogo(sem, [{ quantidade: 3 }], false)).toBe(true)
    expect(disponivelNoCatalogo(sem, [{ quantidade: 0 }], false)).toBe(false)
  })
  it('sem estoque lançado, serviço, feito no dia ou vende sem estoque: aparece', () => {
    expect(disponivelNoCatalogo(sem, [], false)).toBe(true)
    expect(disponivelNoCatalogo({ servico: true, feitoNoDia: false }, [{ quantidade: 0 }], false)).toBe(true)
    expect(disponivelNoCatalogo({ servico: false, feitoNoDia: true }, [{ quantidade: 0 }], false)).toBe(true)
    expect(disponivelNoCatalogo(sem, [{ quantidade: 0 }], true)).toBe(true)
  })
})

describe('textos', () => {
  it('o resumo da encomenda e a mensagem para o WhatsApp', () => {
    expect(resumoDosItens([{ descricao: 'Picolé', quantidade: 2 }, { descricao: 'Pote 1 L', quantidade: 1 }])).toBe('2× Picolé, 1× Pote 1 L')
    const m = mensagemDoPedido({
      codigo: 'ENC-ABC123',
      nome: 'Ana',
      itens: [{ descricao: 'Picolé', quantidade: 2, totalC: 1000 }],
      totalC: 1500,
      taxaC: 500,
      entrega: true,
      endereco: 'Rua A, 10',
      forma: 'Pix',
      link: 'https://x/y',
    })
    expect(m).toContain('ENC-ABC123')
    expect(m).toContain('Entrega')
    expect(m).toContain('Rua A, 10')
    expect(m).toContain('https://x/y')
  })
  it('a situação para a cliente', () => {
    expect(situacaoParaCliente({ situacao: 'ABERTA', vistaEm: null, entrega: false }).passo).toBe(0)
    expect(situacaoParaCliente({ situacao: 'ABERTA', vistaEm: new Date(), entrega: false }).titulo).toBe('Pedido aceito')
    expect(situacaoParaCliente({ situacao: 'PRONTA', vistaEm: null, entrega: true }).titulo).toBe('Saiu para entrega')
    expect(situacaoParaCliente({ situacao: 'CANCELADA', vistaEm: null, entrega: false }).cancelado).toBe(true)
  })
})

describe('a foto', () => {
  it('o tipo vem do conteúdo, não do nome', () => {
    expect(tipoDaImagem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg')
    expect(tipoDaImagem(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png')
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')
    expect(tipoDaImagem(webp)).toBe('image/webp')
    expect(tipoDaImagem(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
  })
})
