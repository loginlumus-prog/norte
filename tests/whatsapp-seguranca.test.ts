// O WhatsApp contra quem não é o WhatsApp: as travas puras da porta, do
// conector e do áudio.
//
//   • o callback do Z-API de OUTRA instância (ou sem instância, quando a
//     empresa tem uma) é ignorado — com o endereço vazado, alguém montaria o
//     corpo à mão como se fosse o dono;
//   • o Bearer que o Norte manda ao conector e a chave com que o conector
//     assina o que manda de volta são segredos diferentes (o antigo, um só,
//     vale de reserva);
//   • o áudio só é baixado de endereço que RESOLVE para fora de casa, e o
//     tamanho vale mesmo sem Content-Length;
//   • o código de confirmação do telefone não tem segredo fixo em produção.

import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { lerZapi } from '../src/servidor/assistente/webhook'
import { conferirAssinatura, lerConfigConector } from '../src/servidor/assistente/conector'
import { custoDaTranscricaoCent, ipInterno, MAXIMO_AUDIO_BYTES, ouvirMedindo } from '../src/servidor/assistente/transcricao'
import { segredoDoCodigo } from '../src/servidor/assistente/confirmacao'
import { lerConfig } from '../conector/src/config'

const base = {
  type: 'ReceivedCallback',
  phone: '5571999990001',
  messageId: 'M1',
  instanceId: 'INST-A',
  text: { message: 'oi' },
}

describe('Z-API: a instância da empresa', () => {
  it('a da empresa passa; outra, ou nenhuma, é ignorada', () => {
    expect(lerZapi(base, 'INST-A')).toMatchObject({ tipo: 'mensagem', texto: 'oi' })
    expect(lerZapi({ ...base, instanceId: 'INST-B' }, 'INST-A')).toEqual({ tipo: 'ignorar', motivo: 'outra instância' })
    const { instanceId: _, ...semInstancia } = base
    expect(lerZapi(semInstancia, 'INST-A')).toEqual({ tipo: 'ignorar', motivo: 'sem instância' })
    expect(lerZapi({ ...base, instanceId: 42 }, 'INST-A')).toEqual({ tipo: 'ignorar', motivo: 'sem instância' })
  })

  it('sem instância configurada (nem na empresa, nem no ambiente), não há o que conferir', () => {
    const { instanceId: _, ...semInstancia } = base
    expect(lerZapi(semInstancia, null)).toMatchObject({ tipo: 'mensagem' })
  })
})

describe('conector: um segredo para cada mão', () => {
  const T = 't'.repeat(32)
  const A = 'a'.repeat(32)
  const S = 's'.repeat(32)
  const assinado = (chave: string, agora: number) => {
    const carimbo = String(Math.floor(agora / 1000))
    const assinatura = 'v1=' + createHmac('sha256', chave).update(`${carimbo}.POST./api/x.{}`).digest('hex')
    return { metodo: 'POST', caminho: '/api/x', corpo: '{}', carimbo, assinatura }
  }

  it('o Norte manda o CONECTOR_TOKEN; o antigo vale de reserva, com aviso', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(lerConfigConector({ CONECTOR_URL: 'http://localhost:3200', CONECTOR_TOKEN: T, CONECTOR_SEGREDO: S })).toEqual({ url: 'http://localhost:3200', segredo: T })
    expect(lerConfigConector({ CONECTOR_URL: 'http://localhost:3200', CONECTOR_SEGREDO: S })).toEqual({ url: 'http://localhost:3200', segredo: S })
    expect(aviso).toHaveBeenCalledWith(expect.stringMatching(/CONECTOR_TOKEN não configurado/))
    // token curto não cai no antigo: é erro de quem configurou
    expect(lerConfigConector({ CONECTOR_URL: 'http://localhost:3200', CONECTOR_TOKEN: 'curto', CONECTOR_SEGREDO: S })).toBeNull()
    aviso.mockRestore()
  })

  it('o que chega do conector se confere com CONECTOR_ASSINATURA — o token não assina', () => {
    const antes = { ...process.env }
    const agora = Date.now()
    process.env.CONECTOR_TOKEN = T
    process.env.CONECTOR_ASSINATURA = A
    delete process.env.CONECTOR_SEGREDO
    try {
      expect(conferirAssinatura(assinado(A, agora), undefined, agora)).toBe(true)
      expect(conferirAssinatura(assinado(T, agora), undefined, agora)).toBe(false)
    } finally {
      process.env = antes
    }
  })

  it('o conector lê os mesmos dois, com o antigo de reserva', () => {
    const r = lerConfig({ CONECTOR_TOKEN: T, CONECTOR_ASSINATURA: A, NORTE_URL: 'https://norte.app' })
    expect(r.ok && [r.config.segredo, r.config.segredoAssinatura]).toEqual([T, A])
    const antigo = lerConfig({ CONECTOR_SEGREDO: S, NORTE_URL: 'https://norte.app' })
    expect(antigo.ok && [antigo.config.segredo, antigo.config.segredoAssinatura]).toEqual([S, S])
    expect(lerConfig({ CONECTOR_TOKEN: T, NORTE_URL: 'https://norte.app' }).ok).toBe(false)
  })
})

describe('o áudio: de onde baixa, e quanto', () => {
  const COM_CHAVE = { TRANSCRICAO_CHAVE: 'chave' }
  const transcreve = new Response(JSON.stringify({ text: 'chegou picanha' }), { headers: { 'content-type': 'application/json' } })

  it('endereço interno, pelo número que o DNS devolve', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.0.9', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(ipInterno(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) expect(ipInterno(ip), ip).toBe(false)
  })

  it('nome de fora que aponta para dentro não é baixado', async () => {
    const buscar = vi.fn(async () => new Response(new Uint8Array(10))) as unknown as typeof fetch
    const r = await ouvirMedindo({ url: 'https://arquivos.exemplo/a.ogg', mime: null }, buscar, COM_CHAVE, async () => ['10.1.2.3'])
    expect(r).toBeNull()
    expect(buscar).not.toHaveBeenCalled()
  })

  it('sem Content-Length, o teto vale para o que chega', async () => {
    let chamadas = 0
    const buscar = (async () => {
      chamadas++
      // um corpo maior que o teto, sem dizer o tamanho
      const corpo = new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new Uint8Array(512 * 1024))
          if (chamadas++ > 20) c.close()
        },
      })
      return new Response(corpo)
    }) as unknown as typeof fetch
    expect(await ouvirMedindo({ url: 'https://arquivos.exemplo/a.ogg', mime: null }, buscar, COM_CHAVE, async () => ['8.8.8.8'])).toBeNull()
    expect(MAXIMO_AUDIO_BYTES).toBeLessThan(21 * 512 * 1024)
  })

  it('de fora e do tamanho certo: transcreve e diz quanto durou (para a conta)', async () => {
    const buscar = vi.fn(async (url: string) =>
      String(url).startsWith('https://arquivos') ? new Response(new Uint8Array(4000)) : transcreve.clone(),
    ) as unknown as typeof fetch
    const r = await ouvirMedindo({ url: 'https://arquivos.exemplo/a.ogg', mime: null, segundos: 75 }, buscar, COM_CHAVE, async () => ['8.8.8.8'])
    expect(r).toEqual({ texto: 'chegou picanha', segundos: 75 })
    expect(custoDaTranscricaoCent(75, {})).toBe(2) // dois minutos começados, um centavo cada
    expect(custoDaTranscricaoCent(10, { TRANSCRICAO_CENT_POR_MINUTO: '3' })).toBe(3)
  })
})

describe('o código de confirmação do telefone', () => {
  it('em produção, sem segredo nem cifra, para — o fixo do laptop está no código-fonte', () => {
    expect(() => segredoDoCodigo({ NODE_ENV: 'production' })).toThrow(/NORTE_CODIGO_SEGREDO/)
    expect(segredoDoCodigo({ NODE_ENV: 'production', NORTE_CODIGO_SEGREDO: 'x'.repeat(40) })).toBe('x'.repeat(40))
    expect(segredoDoCodigo({ NODE_ENV: 'development' })).toBe('norte-laptop-codigo-telefone')
  })
})
