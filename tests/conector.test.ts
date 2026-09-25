// As partes puras do conector (pasta conector/): o ritmo de envio, a
// leitura das mensagens do WhatsApp, o id do anúncio, as máscaras e a config.
//
// Nada aqui abre conexão nem importa o Baileys: os módulos testados trabalham
// sobre a FORMA das mensagens, justamente para dar para testar da raiz sem
// instalar o conector.

import { describe, it, expect } from 'vitest'
import { Fila, Ritmo, tempoDigitando, type ConfigRitmo } from '../conector/src/ritmo'
import { anuncioDa, desembrulhar, ehConversaColetiva, normalizar, telefoneDoJid, type MensagemBruta } from '../conector/src/normalizar'
import { finalDoNumero, mascararNumero } from '../conector/src/log'
import { conferirPortador } from '../conector/src/assinatura'
import { lerConfig } from '../conector/src/config'

// ─────────────────────────────────────────────────────────────
// O RITMO
// ─────────────────────────────────────────────────────────────

describe('o ritmo de envio', () => {
  const cfg: ConfigRitmo = { intervaloMinMs: 3_000, intervaloMaxMs: 8_000, porMinuto: 5, porDia: 8, porContatoMinuto: 3 }
  const relogio = () => {
    let t = 1_000_000
    return { agora: () => t, andar: (ms: number) => (t += ms) }
  }

  it('o primeiro envio sai na hora; o seguinte espera o intervalo sorteado (3 a 8 s)', () => {
    const r = relogio()
    const sorteios = [0, 1, 0.5]
    const ritmo = new Ritmo(cfg, r.agora, () => sorteios.shift() ?? 0)
    expect(ritmo.vez('A')).toEqual({ ok: true, esperarMs: 0 })
    ritmo.registrar('A') // sorteio 0 → 3 s
    expect(ritmo.vez('B')).toEqual({ ok: true, esperarMs: 3_000 })
    r.andar(3_000)
    expect(ritmo.vez('B')).toEqual({ ok: true, esperarMs: 0 })
    ritmo.registrar('B') // sorteio 1 → 8 s
    expect(ritmo.vez('C')).toEqual({ ok: true, esperarMs: 8_000 })
  })

  it('nunca dois envios colados, qualquer que seja o sorteio', () => {
    const r = relogio()
    const ritmo = new Ritmo(cfg, r.agora, Math.random)
    for (let i = 0; i < 4; i++) {
      ritmo.registrar(`n${i}`)
      const v = ritmo.vez('outro')
      expect(v.ok && v.esperarMs >= 3_000 && v.esperarMs <= 8_000).toBe(true)
      r.andar(v.ok ? v.esperarMs : 0)
    }
  })

  it('teto por minuto do número: espera o mais velho sair da janela', () => {
    const r = relogio()
    const ritmo = new Ritmo({ ...cfg, intervaloMinMs: 1_000, intervaloMaxMs: 1_000 }, r.agora, () => 0)
    for (let i = 0; i < 5; i++) {
      ritmo.registrar(`n${i}`)
      r.andar(1_000)
    }
    // 5 no último minuto (o primeiro há 5 s): espera até ele fazer 60 s
    expect(ritmo.vez('n9')).toEqual({ ok: true, esperarMs: 55_000 })
  })

  it('teto por minuto do MESMO contato', () => {
    const r = relogio()
    const ritmo = new Ritmo({ ...cfg, intervaloMinMs: 1_000, intervaloMaxMs: 1_000 }, r.agora, () => 0)
    for (let i = 0; i < 3; i++) {
      ritmo.registrar('mesmo')
      r.andar(2_000)
    }
    const v = ritmo.vez('mesmo')
    expect(v.ok && v.esperarMs).toBe(54_000)
    // outro contato não espera por isso
    expect(ritmo.vez('outro')).toEqual({ ok: true, esperarMs: 0 })
  })

  it('teto diário: recusa, e volta a aceitar 24 h depois', () => {
    const r = relogio()
    const ritmo = new Ritmo({ ...cfg, porMinuto: 100, porContatoMinuto: 100 }, r.agora, () => 0)
    for (let i = 0; i < 8; i++) {
      ritmo.registrar(`n${i}`)
      r.andar(10_000)
    }
    expect(ritmo.vez('n9')).toEqual({ ok: false, motivo: 'limite_diario' })
    expect(ritmo.noDia()).toBe(8)
    r.andar(24 * 3_600_000)
    expect(ritmo.vez('n9').ok).toBe(true)
  })

  it('"digitando…" proporcional ao texto, entre 1,5 s e 8 s', () => {
    expect(tempoDigitando('oi', () => 0.5)).toBe(1_590)
    expect(tempoDigitando('x'.repeat(2_000), () => 1)).toBe(8_000)
    expect(tempoDigitando('', () => 0)).toBe(1_500)
    const medio = tempoDigitando('x'.repeat(60), () => 0.5)
    expect(medio).toBeGreaterThan(3_000)
    expect(medio).toBeLessThan(5_000)
  })
})

describe('a fila por número', () => {
  it('um de cada vez, na ordem; falha não trava; cheia recusa', async () => {
    const fila = new Fila(3)
    const ordem: string[] = []
    let soltar!: () => void
    const primeira = fila.entrar(
      () =>
        new Promise<string>((r) => {
          ordem.push('1-começou')
          soltar = () => r('1')
        }),
    )!
    const segunda = fila.entrar(async () => {
      ordem.push('2-começou')
      throw new Error('falhou')
    })!
    const terceira = fila.entrar(async () => {
      ordem.push('3-começou')
      return '3'
    })!
    expect(fila.entrar(async () => 'x')).toBeNull()
    expect(fila.pendentes).toBe(3)
    await Promise.resolve()
    expect(ordem).toEqual(['1-começou'])
    soltar()
    expect(await primeira).toBe('1')
    await expect(segunda).rejects.toThrow('falhou')
    expect(await terceira).toBe('3')
    expect(ordem).toEqual(['1-começou', '2-começou', '3-começou'])
    expect(fila.pendentes).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
// AS MENSAGENS
// ─────────────────────────────────────────────────────────────

describe('a leitura das mensagens do WhatsApp', () => {
  const agora = 1_780_000_000_000
  const ctx = (extra: Partial<Parameters<typeof normalizar>[1]> = {}) => ({
    agora,
    meuNumero: '5571988887777',
    enviadas: new Set(['ENVIADA-1']),
    idadeMaximaMs: 6 * 3_600_000,
    ...extra,
  })
  const m = (message: Record<string, unknown>, key: Partial<NonNullable<MensagemBruta['key']>> = {}, extra: Partial<MensagemBruta> = {}): MensagemBruta => ({
    key: { remoteJid: '5571999991234@s.whatsapp.net', fromMe: false, id: 'M1', ...key },
    pushName: 'Maria',
    messageTimestamp: Math.floor(agora / 1000) - 5,
    message,
    ...extra,
  })

  it('texto simples e texto estendido', () => {
    expect(normalizar(m({ conversation: 'oi' }), ctx())).toEqual({
      tipo: 'mensagem',
      telefone: '5571999991234',
      nome: 'Maria',
      texto: 'oi',
      id: 'M1',
      deMim: false,
    })
    expect(normalizar(m({ extendedTextMessage: { text: 'tem P?' } }), ctx())).toMatchObject({ texto: 'tem P?' })
  })

  it('mensagem temporária e de visualização única: tira o envelope', () => {
    const efemera = { ephemeralMessage: { message: { extendedTextMessage: { text: 'sumirá' } } } }
    expect(normalizar(m(efemera), ctx())).toMatchObject({ tipo: 'mensagem', texto: 'sumirá' })
    expect(desembrulhar({ viewOnceMessageV2: { message: { imageMessage: { caption: 'foto' } } } })).toEqual({ imageMessage: { caption: 'foto' } })
  })

  it('foto com legenda vira texto; áudio vira aviso para pedir que escreva', () => {
    expect(normalizar(m({ imageMessage: { caption: 'quanto custa?' } }), ctx())).toMatchObject({ texto: 'quanto custa?' })
    expect(normalizar(m({ audioMessage: { seconds: 8 } }), ctx())).toMatchObject({ texto: expect.stringContaining('um áudio') })
  })

  it('grupo, status, transmissão, canal: fora', () => {
    for (const jid of ['1203630@g.us', 'status@broadcast', '12345@broadcast', '1203@newsletter']) {
      expect(normalizar(m({ conversation: 'oi' }, { remoteJid: jid }), ctx()).tipo).toBe('ignorar')
      expect(ehConversaColetiva(jid)).toBe(true)
    }
  })

  it('reação e mensagem de controle: fora', () => {
    expect(normalizar(m({ reactionMessage: { text: '👍' } }), ctx()).tipo).toBe('ignorar')
    expect(normalizar(m({ protocolMessage: { type: 0 } }), ctx()).tipo).toBe('ignorar')
  })

  it('a conversa do dono consigo mesmo: fora', () => {
    expect(normalizar(m({ conversation: 'lembrete' }, { remoteJid: '5571988887777@s.whatsapp.net', fromMe: true }), ctx()).tipo).toBe('ignorar')
  })

  it('o que o conector mandou (eco): fora; o que a loja mandou pelo celular: "humano", sem o texto', () => {
    expect(normalizar(m({ conversation: 'resposta do assistente' }, { fromMe: true, id: 'ENVIADA-1' }), ctx()).tipo).toBe('ignorar')
    expect(normalizar(m({ conversation: 'deixa que eu respondo' }, { fromMe: true, id: 'DO-CELULAR' }), ctx())).toEqual({
      tipo: 'mensagem',
      telefone: '5571999991234',
      nome: null,
      texto: '',
      id: 'DO-CELULAR',
      deMim: true,
    })
  })

  it('mensagem velha (a sessão ficou fora do ar): fora', () => {
    const velha = m({ conversation: 'oi' }, {}, { messageTimestamp: Math.floor(agora / 1000) - 7 * 3_600 })
    expect(normalizar(velha, ctx())).toEqual({ tipo: 'ignorar', motivo: 'mensagem velha' })
    expect(normalizar({ ...velha, messageTimestamp: { toNumber: () => Math.floor(agora / 1000) } }, ctx()).tipo).toBe('mensagem')
  })

  it('o WhatsApp novo esconde o número atrás de um "@lid": usa o alternativo, ou o resolvido', () => {
    const lid = { remoteJid: '123456789012345@lid' }
    expect(normalizar(m({ conversation: 'oi' }, { ...lid, remoteJidAlt: '5571999991234@s.whatsapp.net' }), ctx())).toMatchObject({ telefone: '5571999991234' })
    expect(normalizar(m({ conversation: 'oi' }, lid), ctx({ telefoneDoLid: '5571999995555' }))).toMatchObject({ telefone: '5571999995555' })
    expect(normalizar(m({ conversation: 'oi' }, lid), ctx()).tipo).toBe('ignorar')
  })

  it('JID de telefone, com e sem o número do aparelho', () => {
    expect(telefoneDoJid('5571999991234@s.whatsapp.net')).toBe('5571999991234')
    expect(telefoneDoJid('5571999991234:12@s.whatsapp.net')).toBe('5571999991234')
    expect(telefoneDoJid('123@lid')).toBeNull()
    expect(telefoneDoJid(undefined)).toBeNull()
  })
})

describe('o anúncio de onde a pessoa veio', () => {
  const comAnuncio = (ad: Record<string, unknown>) => ({
    extendedTextMessage: { text: 'Olá! Tenho interesse', contextInfo: { externalAdReply: ad } },
  })

  it('clique para o WhatsApp: o id do anúncio vai junto', () => {
    const conteudo = comAnuncio({ sourceType: 'ad', sourceId: '120212345678900123', sourceUrl: 'https://fb.me/abc' })
    expect(anuncioDa(conteudo)).toBe('120212345678900123')
    expect(
      normalizar(
        { key: { remoteJid: '5571999991234@s.whatsapp.net', id: 'AD1' }, message: conteudo },
        { agora: Date.now(), meuNumero: null, enviadas: new Set(), idadeMaximaMs: 1e9 },
      ),
    ).toMatchObject({ anuncioId: '120212345678900123', texto: 'Olá! Tenho interesse' })
  })

  it('também em foto com contexto; sem tipo, aceita; tipo que não é anúncio, não', () => {
    expect(anuncioDa({ imageMessage: { contextInfo: { externalAdReply: { sourceId: '999' } } } })).toBe('999')
    expect(anuncioDa(comAnuncio({ sourceType: 'post', sourceId: '999' }))).toBeNull()
    expect(anuncioDa(comAnuncio({ sourceType: 'ad', sourceId: 'id com espaço' }))).toBeNull()
    expect(anuncioDa({ conversation: 'oi' })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// MÁSCARAS, PORTEIRO E CONFIG
// ─────────────────────────────────────────────────────────────

describe('o que pode aparecer', () => {
  it('número mascarado: só DDD e os 4 últimos', () => {
    expect(mascararNumero('5571999991234')).toBe('(71) •••••-1234')
    expect(mascararNumero('557133331234')).toBe('(71) ••••-1234')
    expect(mascararNumero('14155550100')).toBe('••••0100')
    expect(mascararNumero('123')).toBeNull()
    expect(finalDoNumero('5571999991234')).toBe('…1234')
  })

  it('o portador: só com o segredo inteiro, e segredo curto não vale', () => {
    const s = 'x'.repeat(40)
    expect(conferirPortador(s, `Bearer ${s}`)).toBe(true)
    expect(conferirPortador(s, `bearer ${s}`)).toBe(true)
    expect(conferirPortador(s, `Bearer ${s}y`)).toBe(false)
    expect(conferirPortador(s, s)).toBe(false)
    expect(conferirPortador(s, undefined)).toBe(false)
    expect(conferirPortador('curto', 'Bearer curto')).toBe(false)
  })

  it('config: exige segredo longo e NORTE_URL https (http só local); o ritmo tem teto', () => {
    const bom = { CONECTOR_SEGREDO: 'y'.repeat(32), NORTE_URL: 'https://norte.app/' }
    const r = lerConfig(bom)
    expect(r.ok && r.config.norteUrl).toBe('https://norte.app')
    expect(r.ok && r.config.porta).toBe(3200)
    expect(lerConfig({ ...bom, CONECTOR_SEGREDO: 'curto' }).ok).toBe(false)
    expect(lerConfig({ ...bom, NORTE_URL: 'http://norte.app' }).ok).toBe(false)
    expect(lerConfig({ ...bom, NORTE_URL: 'http://localhost:3000' }).ok).toBe(true)
    const rapido = lerConfig({ ...bom, RITMO_INTERVALO_MIN_MS: '10', RITMO_POR_MINUTO: '9999' })
    expect(rapido.ok && rapido.config.ritmo.intervaloMinMs).toBe(1_000)
    expect(rapido.ok && rapido.config.ritmo.porMinuto).toBe(60)
  })
})

describe('o relógio do conector', () => {
  it('acorda no minuto cheio seguinte, com 2 s de folga', async () => {
    const { ateOProximoMinuto } = await import('../conector/src/relogio')
    expect(ateOProximoMinuto(Date.UTC(2026, 8, 25, 12, 0, 30))).toBe(32_000)
    expect(ateOProximoMinuto(Date.UTC(2026, 8, 25, 12, 0, 0))).toBe(62_000)
  })
  it('as rotinas batem uma vez por hora, no minuto 1', async () => {
    const { horaDasRotinas } = await import('../conector/src/relogio')
    expect(horaDasRotinas(new Date(Date.UTC(2026, 8, 25, 11, 1)))).toBe(true)
    expect(horaDasRotinas(new Date(Date.UTC(2026, 8, 25, 11, 0)))).toBe(false)
    expect(horaDasRotinas(new Date(Date.UTC(2026, 8, 25, 11, 2)))).toBe(false)
  })
})
