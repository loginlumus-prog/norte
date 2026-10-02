// O PIN de autorizar, contra o chute.
//
// Três furos fechados: o acerto de um PIN zerava a conta de erros da LOJA
// (o PIN da gerente digitado certo no meio dos chutes liberava mais cinco);
// a recusa "duas pessoas usam esse PIN" contava que aquele número é o PIN de
// alguém; e o PIN de quatro números (10 mil combinações) se criava à vontade.
// Agora: conta por quem pede além da conta da loja, o acerto não zera a da
// loja, uma recusa só e o PIN repetido é barrado ao criar. O tamanho voltou a
// ser de 4 a 6 (decisão do dono: o PIN é digitado em toda venda) — quem segura
// o chute é o freio, e o PIN que todo mundo chuta (1234, 0000) é recusado.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { subirBanco } from './banco'
import type { Sessao, Papel } from '../src/servidor/permissao'

let db: PGlite
let servidor: PGLiteSocketServer
let m: {
  autorizacao: typeof import('../src/servidor/autorizacao')
  senha: typeof import('../src/servidor/senha')
  banco: typeof import('../src/servidor/banco')
}

const sessao = (usuarioId: string, nome: string, acessos: { papel: Papel; unidadeId: string | null }[]): Sessao => ({
  orgId: 'org-p',
  usuarioId,
  nome,
  acessos: acessos.map((a) => ({ ...a, expiraEm: null })),
})
const GER1 = sessao('usr-g1', 'Gerente Um', [{ papel: 'GERENTE', unidadeId: 'u-1' }])
const GER2 = sessao('usr-g2', 'Gerente Dois', [{ papel: 'GERENTE', unidadeId: 'u-1' }])
const GER3 = sessao('usr-g3', 'Gerente Três', [{ papel: 'GERENTE', unidadeId: 'u-3' }])

const SENHA = 'senha-boa-123'
const PIN_G1 = '583920'

const SEMENTE = `
  insert into orgs (id, nome, slug, plano, situacao, modulos, atualizada_em, configurada_em) values
    ('org-p', 'Loja P', 'loja-p', 'REDE', 'ATIVA', '{multiUnidade}', now(), now());
  insert into unidades (id, org_id, nome, atualizada_em) values
    ('u-1', 'org-p', 'Centro', now()), ('u-2', 'org-p', 'Praia', now()), ('u-3', 'org-p', 'Bairro', now());
  insert into usuarios (id, org_id, nome, email, atualizado_em) values
    ('usr-g1', 'org-p', 'Gerente Um', 'g1@p.com', now()),
    ('usr-g2', 'org-p', 'Gerente Dois', 'g2@p.com', now()),
    ('usr-g3', 'org-p', 'Gerente Três', 'g3@p.com', now()),
    ('usr-b1', 'org-p', 'Balcão Um', 'b1@p.com', now()),
    ('usr-b2', 'org-p', 'Balcão Dois', 'b2@p.com', now());
  insert into acessos (id, org_id, usuario_id, unidade_id, papel) values
    ('a-g1', 'org-p', 'usr-g1', 'u-1', 'GERENTE'),
    ('a-g2', 'org-p', 'usr-g2', 'u-1', 'GERENTE'),
    ('a-g3', 'org-p', 'usr-g3', 'u-3', 'GERENTE'),
    ('a-b1', 'org-p', 'usr-b1', 'u-1', 'BALCAO'),
    ('a-b2', 'org-p', 'usr-b2', 'u-1', 'BALCAO');
`

beforeAll(async () => {
  process.env.POOL_MAX = '1'
  process.env.POOL_PORTARIA = '1'
  db = await subirBanco()
  await db.exec(SEMENTE)
  const porta = 44000 + Math.floor(Math.random() * 2000)
  servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1', maxConnections: 10 })
  await servidor.start()
  const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`
  process.env.DATABASE_URL = url
  process.env.DATABASE_URL_PORTARIA = url
  m = {
    autorizacao: await import('../src/servidor/autorizacao'),
    senha: await import('../src/servidor/senha'),
    banco: await import('../src/servidor/banco'),
  }
  await db.query(`update usuarios set senha_hash = $1`, [await m.senha.guardarSenha(SENHA)])
  expect(await m.autorizacao.definirMeuPin(GER1, SENHA, PIN_G1)).toEqual({ ok: true })
}, 60_000)

afterAll(async () => {
  await m?.banco.fechar()
  delete (globalThis as { __prismaNorte?: unknown }).__prismaNorte
  await servidor?.stop()
  await db?.close()
})

const pedir = (pin: string, quem = 'usr-b1', unidadeId = 'u-1') =>
  m.autorizacao.autorizarComPin({
    orgId: 'org-p',
    unidadeId,
    pin,
    capacidade: 'venda.desconto',
    motivo: 'teste',
    quemPediu: { usuarioId: quem, nome: quem },
  })

describe('criar o PIN', () => {
  it('o PIN novo pode ter 4 números — mas não o que todo mundo chuta, nem fora de 4 a 6', async () => {
    expect(await m.autorizacao.definirMeuPin(GER3, SENHA, '1234')).toMatchObject({ ok: false, erro: /Sequência/ })
    expect(await m.autorizacao.definirMeuPin(GER3, SENHA, '0000')).toMatchObject({ ok: false, erro: /repetido/ })
    expect(await m.autorizacao.definirMeuPin(GER3, SENHA, '582')).toMatchObject({ ok: false, erro: /de 4 a 6/ })
    expect(await m.autorizacao.definirMeuPin(GER3, SENHA, '5829461')).toMatchObject({ ok: false, erro: /de 4 a 6/ })
    expect(await m.autorizacao.definirMeuPin(GER3, SENHA, '5829')).toEqual({ ok: true })
    // Volta ao estado do resto do arquivo: a GER3 sem PIN.
    await db.query(`update usuarios set pin_hash = null where id = 'usr-g3'`)
  })

  it('o mesmo PIN de outra pessoa da mesma loja é recusado — sem dizer de quem', async () => {
    expect(await m.autorizacao.definirMeuPin(GER2, SENHA, PIN_G1)).toEqual({ ok: false, erro: 'Esse PIN não pode ser usado. Escolha outro.' })
    expect(await m.autorizacao.meuPin(GER2)).toMatchObject({ tem: false })
    // De outra loja, que não divide balcão com a dona dele, pode.
    expect(await m.autorizacao.definirMeuPin(GER3, SENHA, PIN_G1)).toEqual({ ok: true })
  })

  it('o PIN de quatro números de antes continua autorizando', async () => {
    const antigo = await m.senha.guardarSenha('pin:usr-g2:7391')
    await db.query(`update usuarios set pin_hash = $1 where id = 'usr-g2'`, [antigo])
    expect(await pedir('7391', 'usr-b2')).toMatchObject({ ok: true, autorizador: { usuarioId: 'usr-g2' } })
  })
})

describe('autorizar: a recusa e o freio', () => {
  it('PIN errado e PIN repetido de duas pessoas dão a MESMA recusa', async () => {
    const errado = await pedir('111222', 'usr-b2', 'u-2')
    // Duas gerentes com o mesmo PIN (de antes da regra): nenhuma autoriza, e a frase não conta.
    const repetido = await m.senha.guardarSenha(`pin:usr-g2:${PIN_G1}`)
    await db.query(`update usuarios set pin_hash = $1 where id = 'usr-g2'`, [repetido])
    const dois = await pedir(PIN_G1, 'usr-b2')
    expect(dois).toEqual(errado)
    expect(dois).toEqual({ ok: false, erro: 'O PIN não confere, ou é de quem não pode autorizar isto nesta loja.' })
    await db.query(`update usuarios set pin_hash = null where id = 'usr-g2'`)
  })

  it('o acerto não zera a conta da LOJA: os chutes de antes continuam contando', async () => {
    await db.exec(`delete from tentativas_login`)
    // Quatro chutes de vendedoras diferentes, um acerto da gerente, mais um chute: travou.
    for (const quem of ['usr-b1', 'usr-b2', 'usr-b1', 'usr-b2']) expect((await pedir('400100', quem)).ok).toBe(false)
    expect((await pedir(PIN_G1, 'usr-b1')).ok).toBe(true)
    expect((await pedir('400101', 'usr-b2')).ok).toBe(false)
    expect(await pedir(PIN_G1, 'usr-b1')).toMatchObject({ ok: false, erro: /muitas vezes nesta loja.*Espere/ })
  })

  it('quem pede tem a própria conta: cinco erros dela a travam, sem travar a loja vizinha', async () => {
    await db.exec(`delete from tentativas_login`)
    for (let i = 0; i < 5; i++) expect((await pedir(`50010${i}`, 'usr-b1', 'u-3')).ok).toBe(false)
    expect(await pedir(PIN_G1, 'usr-b1', 'u-3')).toMatchObject({ ok: false, erro: /muitas vezes/ })
    expect((await pedir(PIN_G1, 'usr-b1', 'u-1')).ok).toBe(true)
  })
})
