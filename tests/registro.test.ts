// O log de erro não carrega dado pessoal, e o código que a tela mostra é o
// mesmo que vai para o log. Ver src/servidor/registro.ts.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { mascarar, resumoDoErro, registrarErro, novoCodigo, semBusca } from '../src/servidor/registro'
import { recadoDoErro } from '../src/servidor/pagina'

afterEach(() => vi.restoreAllMocks())

// Como o Prisma escreve o erro de validação: a consulta inteira, com os valores.
function erroDeValidacao() {
  const e = new Error(
    [
      'Invalid `prisma.cliente.create()` invocation:',
      '',
      '{',
      '  data: {',
      '    nome: "Rosa Lima Teste",',
      '    telefone: "71999998888",',
      '    email: "rosa@exemplo.com",',
      '    documento: "123.456.789-09"',
      '  }',
      '}',
      '',
      'Argument `orgId` is missing.',
    ].join('\n'),
  )
  e.name = 'PrismaClientValidationError'
  return e
}

describe('mascarar', () => {
  it('tira e-mail, telefone, CPF e texto entre aspas', () => {
    const t = mascarar('ligar para +55 (71) 99999-8888, cpf 123.456.789-09, rosa@exemplo.com, nome "Rosa"')
    expect(t).not.toMatch(/9999|123\.456|rosa@|Rosa/)
    expect(t).toContain('[número]')
    expect(t).toContain('[email]')
  })

  it('deixa número curto, id e nome de campo entre crases', () => {
    expect(mascarar('venda 1234 da unidade clx9a8b7c6 falhou em `telefone`')).toBe('venda 1234 da unidade clx9a8b7c6 falhou em `telefone`')
  })
})

describe('resumoDoErro', () => {
  it('do erro de validação do Prisma sobra o QUE falhou, sem os valores', () => {
    const r = resumoDoErro(erroDeValidacao())
    expect(r).toContain('PrismaClientValidationError')
    expect(r).toContain('prisma.cliente.create()')
    expect(r).toContain('Argument `orgId` is missing.')
    for (const pessoal of ['Rosa', '71999998888', 'rosa@exemplo.com', '123.456.789-09']) expect(r).not.toContain(pessoal)
  })

  it('leva o código do Prisma', () => {
    const e = Object.assign(new Error('Unique constraint failed on the constraint: `usuarios_org_id_email_key`'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    })
    expect(resumoDoErro(e)).toBe('PrismaClientKnownRequestError P2002: Unique constraint failed on the constraint: `usuarios_org_id_email_key`')
  })

  it('valor que não é Error não vira o objeto inteiro no log', () => {
    expect(resumoDoErro({ telefone: '71999998888' })).toBe('valor não-Error (object)')
  })
})

describe('registrarErro e recadoDoErro', () => {
  it('uma linha JSON, com o código que volta para a tela', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const codigo = registrarErro('teste', erroDeValidacao())
    expect(log).toHaveBeenCalledTimes(1)
    const linha = JSON.parse(String(log.mock.calls[0]![0]))
    expect(linha).toMatchObject({ nivel: 'erro', codigo, onde: 'teste' })
    expect(JSON.stringify(linha)).not.toContain('Rosa')
  })

  it('erro de máquina vira a frase padrão + o código que está no log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const frase = recadoDoErro(erroDeValidacao(), 'Não deu para salvar.')
    const { codigo } = JSON.parse(String(log.mock.calls[0]![0]))
    expect(frase).toBe(`Não deu para salvar. (código ${codigo})`)
    expect(String(log.mock.calls[0]![0])).not.toContain('71999998888')
  })

  it('erro escrito por nós passa como está, sem log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(recadoDoErro(new Error('O caixa está fechado.'), 'x')).toBe('O caixa está fechado.')
    expect(log).not.toHaveBeenCalled()
  })

  it('o código se dita: oito letras, sem 0/O/1/l', () => {
    for (let i = 0; i < 50; i++) expect(novoCodigo()).toMatch(/^[a-hj-km-np-z2-9]{8}$/)
  })

  it('o caminho vai para o log sem a busca', () => {
    expect(semBusca('/exemplo/clientes?q=Rosa')).toBe('/exemplo/clientes')
  })
})

describe('onRequestError (src/instrumentation.ts)', () => {
  it('grava o MESMO código que a tela de erro mostra, sem a busca e sem os valores', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    const { onRequestError } = await import('../src/instrumentation')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const erro = Object.assign(erroDeValidacao(), { digest: '1234567890' })
    await onRequestError(
      erro,
      { path: '/exemplo/clientes?q=Rosa%20Lima', method: 'GET', headers: { cookie: 'norte_sessao_exemplo=segredo' } },
      { routerKind: 'App Router', routePath: '/[empresa]/clientes', routeType: 'render', renderSource: 'server-rendering', revalidateReason: undefined, renderType: 'dynamic' } as never,
    )
    const bruto = String(log.mock.calls[0]![0])
    const linha = JSON.parse(bruto)
    expect(linha).toMatchObject({ nivel: 'erro', codigo: '1234567890', caminho: '/exemplo/clientes', rota: '/[empresa]/clientes', tipo: 'render' })
    for (const nada of ['Rosa', 'segredo', '71999998888']) expect(bruto).not.toContain(nada)
  })
})
