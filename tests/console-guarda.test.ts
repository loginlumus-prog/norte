// A porta do console do Norte (src/console/guarda.ts): o host, a chave de
// entrada, o cookie e o formulário. Tudo puro — a requisição entra como
// objeto, sem rede.

import { describe, it, expect } from 'vitest'
import {
  criarGuarda,
  conferirAcesso,
  conferirFormulario,
  cabecalhosDeSeguranca,
  iguais,
  lerCookies,
  type Pedido,
} from '../src/console/guarda'
import { esc } from '../src/console/telas'

const g = criarGuarda(4545)
const cookie = `${g.nomeCookie}=${encodeURIComponent(g.chave)}`
const ORIGEM = 'http://127.0.0.1:4545'
const base: Pedido = { metodo: 'GET', url: '/', host: '127.0.0.1:4545', cookie }
const form = (extra: Record<string, string> = {}) => new URLSearchParams({ csrf: g.csrf, acao: 'situacao', ...extra })
const post = (p: Partial<Pedido> = {}): Pedido => ({ ...base, metodo: 'POST', url: '/acao', origem: ORIGEM, site: 'same-origin', ...p })

describe('a guarda nasce com segredos fortes e próprios', () => {
  it('chave e csrf aleatórios, diferentes entre si e entre consoles', () => {
    const outra = criarGuarda(4545)
    expect(g.chave).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(g.csrf).not.toBe(g.chave)
    expect(outra.chave).not.toBe(g.chave)
    expect(criarGuarda(4646).nomeCookie).not.toBe(g.nomeCookie)
  })

  it('compara em tempo constante e nunca aceita vazio', () => {
    expect(iguais('abc', 'abc')).toBe(true)
    expect(iguais('abc', 'abd')).toBe(false)
    expect(iguais('', '')).toBe(false)
    expect(iguais(null, g.chave)).toBe(false)
    expect(iguais(undefined, undefined)).toBe(false)
  })

  it('lê cookies, e o primeiro de mesmo nome vale', () => {
    expect(lerCookies('a=1; b=x%20y; a=2')).toEqual({ a: '1', b: 'x y' })
    expect(lerCookies(undefined)).toEqual({})
  })
})

describe('conferirAcesso', () => {
  it('com o cookie certo, segue', () => {
    expect(conferirAcesso(g, base)).toEqual({ tipo: 'segue' })
    expect(conferirAcesso(g, { ...base, host: 'localhost:4545' })).toEqual({ tipo: 'segue' })
  })

  it('sem cookie, ou com cookie errado, 401', () => {
    expect(conferirAcesso(g, { ...base, cookie: null })).toMatchObject({ tipo: 'recusa', status: 401 })
    expect(conferirAcesso(g, { ...base, cookie: `${g.nomeCookie}=outra` })).toMatchObject({ tipo: 'recusa', status: 401 })
    // O cookie de OUTRO console (outra porta) não abre este.
    const outro = criarGuarda(4646)
    expect(conferirAcesso(g, { ...base, cookie: `${outro.nomeCookie}=${outro.chave}` })).toMatchObject({ status: 401 })
  })

  it('host estranho (DNS rebinding, outra porta, IP da rede) é 403 — mesmo com a chave', () => {
    for (const host of ['evil.example:4545', '127.0.0.1:3000', '192.168.0.10:4545', '', null]) {
      expect(conferirAcesso(g, { ...base, host })).toMatchObject({ tipo: 'recusa', status: 403 })
    }
  })

  it('a chave no endereço troca por cookie e SOME do endereço', () => {
    const v = conferirAcesso(g, { ...base, cookie: null, url: `/empresa/x?busca=a&t=${g.chave}` })
    expect(v).toMatchObject({ tipo: 'entrar', destino: '/empresa/x?busca=a' })
    if (v.tipo !== 'entrar') throw new Error()
    expect(v.setCookie).toContain(`${g.nomeCookie}=`)
    expect(v.setCookie).toMatch(/HttpOnly/)
    expect(v.setCookie).toMatch(/SameSite=Strict/)
    expect(v.setCookie).toMatch(/Path=\//)
  })

  it('chave errada no endereço, ou chave no endereço de um POST, recusa', () => {
    expect(conferirAcesso(g, { ...base, cookie: null, url: '/?t=errada' })).toMatchObject({ status: 401 })
    expect(conferirAcesso(g, { ...base, metodo: 'POST', cookie: null, url: `/acao?t=${g.chave}` })).toMatchObject({ status: 401 })
  })

  it('método que não é GET/POST/HEAD, 405', () => {
    expect(conferirAcesso(g, { ...base, metodo: 'PUT' })).toMatchObject({ status: 405 })
    expect(conferirAcesso(g, { ...base, metodo: 'DELETE' })).toMatchObject({ status: 405 })
  })
})

describe('conferirFormulario (CSRF)', () => {
  it('POST com cookie, Origin e csrf certos, segue', () => {
    expect(conferirFormulario(g, post(), form())).toEqual({ tipo: 'segue' })
    expect(conferirFormulario(g, post({ host: 'localhost:4545', origem: 'http://localhost:4545' }), form())).toEqual({ tipo: 'segue' })
  })

  it('sem o campo csrf, ou com o errado, 403', () => {
    expect(conferirFormulario(g, post(), new URLSearchParams({ acao: 'x' }))).toMatchObject({ status: 403 })
    expect(conferirFormulario(g, post(), form({ csrf: g.chave }))).toMatchObject({ status: 403 })
  })

  it('Origin ausente, de outro site, ou de outra porta, 403', () => {
    for (const origem of [null, 'https://evil.example', 'http://127.0.0.1:3000', 'null']) {
      expect(conferirFormulario(g, post({ origem }), form())).toMatchObject({ tipo: 'recusa', status: 403 })
    }
  })

  it('Sec-Fetch-Site de outro site, 403', () => {
    expect(conferirFormulario(g, post({ site: 'cross-site' }), form())).toMatchObject({ status: 403 })
    expect(conferirFormulario(g, post({ site: 'same-site' }), form())).toMatchObject({ status: 403 })
  })

  it('o formulário certo SEM o cookie não passa (o csrf sozinho não abre)', () => {
    expect(conferirFormulario(g, post({ cookie: null }), form())).toMatchObject({ status: 401 })
  })

  it('GET não muda dado, mesmo com tudo certo', () => {
    expect(conferirFormulario(g, { ...post(), metodo: 'GET' }, form())).toMatchObject({ status: 405 })
  })
})

describe('a página', () => {
  it('cabeçalhos: nada de fora, sem moldura, sem Referer, sem cache', () => {
    const h = cabecalhosDeSeguranca()
    expect(h['Content-Security-Policy']).toMatch(/default-src 'none'/)
    expect(h['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/)
    expect(h['Content-Security-Policy']).toMatch(/form-action 'self'/)
    expect(h['Content-Security-Policy']).not.toMatch(/unsafe-inline/)
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('no-referrer')
    expect(h['Cache-Control']).toBe('no-store')
  })

  it('todo texto do banco sai escapado', () => {
    expect(esc(`<script>alert("x")</script>&'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;')
    expect(esc(null)).toBe('')
  })
})
