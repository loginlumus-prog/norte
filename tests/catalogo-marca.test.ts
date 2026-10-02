import { describe, expect, it } from 'vitest'
import { corValida, estiloDaMarca, sigla, tomDe } from '../src/app/[empresa]/catalogo/[endereco]/marca'

// A cor e a sigla da vitrine pública: a cor vem de texto digitado e vai
// parar num `style`; a sigla é o que aparece no lugar da foto.

describe('cor da marca na vitrine', () => {
  it('só aceita #rrggbb', () => {
    expect(corValida('#D63A75')).toBe('#D63A75')
    expect(corValida('#abc')).toBeNull()
    expect(corValida('red')).toBeNull()
    expect(corValida('#123456;background:url(x)')).toBeNull()
    expect(corValida(null)).toBeNull()
  })

  it('cor inválida fica com a do sistema (não mexe em --marca)', () => {
    const e = estiloDaMarca('javascript:alert(1)') as Record<string, string>
    expect(e['--marca']).toBeUndefined()
    expect(e['--marca-suave']).toContain('var(--marca)')
  })

  it('escolhe a tinta com mais contraste sobre a cor', () => {
    expect((estiloDaMarca('#1f4fd8') as Record<string, string>)['--marca-tinta']).toBe('#ffffff')
    expect((estiloDaMarca('#ffd60a') as Record<string, string>)['--marca-tinta']).toBe('#14161a')
  })
})

describe('sigla do produto sem foto', () => {
  it('usa as iniciais das palavras que contam', () => {
    expect(sigla('Casca de casquinha')).toBe('CC')
    expect(sigla('Picolé (a partir de 20 un.)')).toBe('P')
    expect(sigla('açaí na tigela')).toBe('AT')
    expect(sigla('  ')).toBe('•')
  })

  it('o tom é fixo para a mesma categoria', () => {
    expect(tomDe('cat-1')).toBe(tomDe('cat-1'))
    expect([0, 1, 2, 3]).toContain(tomDe(null))
  })
})
