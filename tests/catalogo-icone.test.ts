// O desenho do produto sem foto no catálogo, e o "Pedir foto no WhatsApp".

import { describe, it, expect } from 'vitest'
import { iconeDoProduto, linkPedirFoto, textoPedirFoto } from '../src/app/[empresa]/catalogo/[endereco]/icone'

describe('o desenho do produto sem foto', () => {
  it('pela categoria', () => {
    expect(iconeDoProduto('Modelo 2041', 'Blusas')).toBe('roupa')
    expect(iconeDoProduto('Modelo 2041', 'Calçados')).toBe('calcado')
    expect(iconeDoProduto('Item 7', 'Bijuteria')).toBe('acessorio')
    expect(iconeDoProduto('Lata', 'Bebidas')).toBe('bebida')
    expect(iconeDoProduto('Sabor do dia', 'Picolés')).toBe('sorvete')
    expect(iconeDoProduto('Fatia', 'Bolos')).toBe('doce')
    expect(iconeDoProduto('Pacote 1 kg', 'Mercearia')).toBe('mercearia')
    expect(iconeDoProduto('Cor 12', 'Esmaltes')).toBe('beleza')
    expect(iconeDoProduto('Saco 10 kg', 'Pet')).toBe('pet')
    expect(iconeDoProduto('Kit', 'Papelaria')).toBe('papelaria')
    expect(iconeDoProduto('Kit', 'Brinquedos')).toBe('brinquedo')
    expect(iconeDoProduto('Vaso P', 'Plantas')).toBe('flor')
  })

  it('sem pista na categoria, pelo nome (com ou sem acento)', () => {
    expect(iconeDoProduto('Calça jeans skinny', 'Novidades')).toBe('roupa')
    expect(iconeDoProduto('TENIS CASUAL BRANCO', null)).toBe('calcado')
    expect(iconeDoProduto('Sandália rasteira', null)).toBe('calcado')
    expect(iconeDoProduto('Bolsa transversal', null)).toBe('acessorio')
    expect(iconeDoProduto('Suco de laranja 500 ml', null)).toBe('bebida')
    expect(iconeDoProduto('Açaí 500', null)).toBe('sorvete')
    expect(iconeDoProduto('Ração para cães 1 kg', null)).toBe('pet')
    expect(iconeDoProduto('Buquê de flores', null)).toBe('flor')
  })

  it('a categoria manda: a sandália na categoria "Calçados" não vira roupa pelo nome', () => {
    expect(iconeDoProduto('Vestido sandália', 'Calçados')).toBe('calcado')
    // calçado e acessório antes da roupa no mesmo texto
    expect(iconeDoProduto('Bolsa jeans', null)).toBe('acessorio')
  })

  it('sem pista nenhuma, a etiqueta', () => {
    expect(iconeDoProduto('Produto 123', null)).toBe('etiqueta')
    expect(iconeDoProduto('', '')).toBe('etiqueta')
    // palavra que só contém o pedaço não engana ("blusão"? não; "pãozinho" também não)
    expect(iconeDoProduto('Brincadeira', null)).toBe('etiqueta')
  })
})

describe('pedir a foto no WhatsApp da loja', () => {
  it('o texto leva o produto e o preço, e nada da cliente', () => {
    expect(textoPedirFoto('Vestido Midi', 'R$ 89,90')).toBe('Olá! Vi no catálogo o produto *Vestido Midi* (R$ 89,90) e gostaria de ver uma foto. 😊')
  })

  it('o link vai para o número da loja, com o texto codificado', () => {
    const l = linkPedirFoto('5571999990000', 'Calça & Cia', 'R$ 10,00')!
    expect(l.startsWith('https://wa.me/5571999990000?text=')).toBe(true)
    expect(decodeURIComponent(l.split('?text=')[1]!)).toBe(textoPedirFoto('Calça & Cia', 'R$ 10,00'))
    expect(l).not.toContain(' ')
    expect(l).not.toContain('&C')
  })

  it('loja sem WhatsApp: sem botão', () => {
    expect(linkPedirFoto(null, 'X', 'R$ 1,00')).toBeNull()
    expect(linkPedirFoto('', 'X', 'R$ 1,00')).toBeNull()
  })
})
