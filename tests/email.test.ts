// O e-mail sem rede: a porta para o fornecedor (Resend) com o fetch de
// mentira, e os modelos. O que importa provar:
//
//   • sem configuração, nada sai e nada quebra — e o log diz isso, com o
//     endereço mascarado;
//   • configurado, o pedido ao fornecedor é o certo (chave no cabeçalho,
//     remetente, destinatário, HTML e texto);
//   • recusa e queda do fornecedor viram resultado, não exceção, e o log não
//     leva o endereço inteiro nem a mensagem do fornecedor;
//   • o nome digitado por alguém sai escapado no HTML, e o rodapé leva a
//     identidade de legal.ts.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { emailConfigurado, enviarEmail, mascararEmail } from '../src/servidor/email'
import {
  emailConfirmarCadastro,
  emailConvite,
  emailRedefinirSenha,
  emailSenhaAlterada,
} from '../src/servidor/email-modelos'
import { EMPRESA } from '../src/servidor/legal'

const CFG = { RESEND_API_KEY: 're_teste_123', EMAIL_REMETENTE: 'Norte <nao-responda@gestornorte.com>' }
const MSG = { para: 'Ana.Souza@Exemplo.com.br', assunto: 'Oi', texto: 'texto', html: '<p>html</p>' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('configuração', () => {
  it('precisa da chave E de um remetente com forma de e-mail', () => {
    expect(emailConfigurado({})).toBe(false)
    expect(emailConfigurado({ RESEND_API_KEY: 'x' })).toBe(false)
    expect(emailConfigurado({ ...CFG, EMAIL_REMETENTE: 'Norte' })).toBe(false)
    expect(emailConfigurado({ ...CFG, EMAIL_REMETENTE: 'Norte <a@b.co>\r\nBcc: x@y.z' })).toBe(false)
    expect(emailConfigurado(CFG)).toBe(true)
    expect(emailConfigurado({ ...CFG, EMAIL_REMETENTE: 'nao-responda@gestornorte.com' })).toBe(true)
  })

  it('mascara o endereço: dá para reconhecer, não dá para colher', () => {
    expect(mascararEmail('ana.souza@exemplo.com.br')).toBe('a***@e***.com.br')
    expect(mascararEmail('x@y')).toBe('x***@y***')
    expect(mascararEmail('lixo')).toBe('***')
  })
})

describe('enviar', () => {
  it('sem configuração: não chama ninguém, responde nao_configurado e o log mascara', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const r = await enviarEmail(MSG, {})
    expect(r).toEqual({ ok: false, motivo: 'nao_configurado' })
    expect(f).not.toHaveBeenCalled()
    const linha = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(linha).toContain('e-mail não configurado')
    expect(linha).toContain('a***@e***.com.br')
    expect(linha.toLowerCase()).not.toContain('ana.souza@exemplo.com.br')
  })

  it('configurado: um POST ao Resend, com a chave no cabeçalho e o destinatário em minúsculas', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const r = await enviarEmail({ ...MSG, assunto: 'Linha 1\r\nBcc: alguem@x.com' }, CFG)
    expect(r).toEqual({ ok: true, id: 'em_1' })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_teste_123')
    const corpo = JSON.parse(String(init.body))
    expect(corpo).toMatchObject({
      from: CFG.EMAIL_REMETENTE,
      to: ['ana.souza@exemplo.com.br'],
      html: '<p>html</p>',
      text: 'texto',
    })
    // quebra de linha no assunto não vira cabeçalho novo
    expect(corpo.subject).toBe('Linha 1 Bcc: alguem@x.com')
    // a chave nunca vai para o log
    expect(log.mock.calls.flat().join(' ')).not.toContain('re_teste_123')
  })

  it('recusa do fornecedor vira resultado; o log leva o código e o nome, não a mensagem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ name: 'validation_error', message: 'ana.souza@exemplo.com.br is invalid' }), { status: 422 }),
      ),
    )
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await enviarEmail(MSG, CFG)
    expect(r).toEqual({ ok: false, motivo: 'recusado' })
    const linha = log.mock.calls.flat().join(' ')
    expect(linha).toContain('422')
    expect(linha).toContain('validation_error')
    expect(linha.toLowerCase()).not.toContain('ana.souza@exemplo.com.br')
  })

  it('fornecedor fora do ar ou rede caída: falhou, sem lançar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 })))
    expect(await enviarEmail(MSG, CFG)).toEqual({ ok: false, motivo: 'falhou' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await enviarEmail(MSG, CFG)).toEqual({ ok: false, motivo: 'falhou' })
  })
})

describe('os modelos', () => {
  const link = 'https://gestornorte.com/loja/redefinir-senha?t=abc'

  it('nome digitado sai escapado no HTML; o link vai no HTML e no texto', () => {
    const m = emailRedefinirSenha({
      para: 'a@b.com',
      nome: '<img/src=x/onerror=alert(1)> Ana',
      empresa: 'Loja "<b>" & Cia',
      link,
      validadeMin: 30,
    })
    expect(m.html).not.toContain('<img/src=x')
    expect(m.html).toContain('&lt;img')
    expect(m.html).toContain('Loja &quot;&lt;b&gt;&quot; &amp; Cia')
    expect(m.html).toContain(link)
    expect(m.texto).toContain(link)
    expect(m.texto).toContain('30 minutos')
    expect(m.assunto).toContain('Redefinir a senha')
  })

  it('todo e-mail leva o rodapé com quem manda e o contato', () => {
    const todos = [
      emailRedefinirSenha({ para: 'a@b.com', nome: 'Ana', empresa: 'Loja', link, validadeMin: 30 }),
      emailSenhaAlterada({ para: 'a@b.com', nome: 'Ana', empresa: 'Loja', quando: new Date(), linkEntrar: link }),
      emailConfirmarCadastro({ para: 'a@b.com', nome: 'Ana', empresa: 'Loja', link, validadeHoras: 48 }),
      emailConvite({ para: 'a@b.com', empresa: 'Loja', quemConvidou: 'Carla Dona', papel: 'Balcão', link, validadeDias: 7 }),
    ]
    for (const m of todos) {
      expect(m.html).toContain(EMPRESA.email)
      expect(m.texto).toContain(EMPRESA.email)
      expect(m.html).toContain(EMPRESA.razaoSocial ?? 'Norte')
      // sem imagem nenhuma: a marca é texto
      expect(m.html).not.toMatch(/<img/i)
    }
  })
})
