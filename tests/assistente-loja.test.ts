// As partes puras de tocar a loja pelo WhatsApp: achar o produto que a
// pessoa disse, ler o "sim" e o ACEITAR, o texto dos avisos, a transcrição
// (sem chave, com chave de mentira, com o serviço fora do ar) e o áudio que
// chega pelo conector e pelo Z-API. O caminho inteiro, com banco, está em
// assistente-loja-whatsapp.test.ts.

import { describe, it, expect, vi } from 'vitest'
import {
  converter,
  escolherProduto,
  medidaDoTexto,
  type Candidato,
} from '../src/servidor/assistente/ferramentas-loja'
import { fraseDaResposta, lerAtalhoEncomenda, lerRespostaCurta } from '../src/servidor/assistente/respostas'
import { codigoDaProposta } from '../src/servidor/assistente/propostas'
import { finalDoCodigo, horaFalada, itensEmTexto, primeiroNome } from '../src/servidor/assistente/encomenda-texto'
import { textoDoPedidoNovo, textoParaCliente } from '../src/servidor/assistente/avisos-encomenda'
import {
  ecoDoAudio,
  enderecoBaixavel,
  lerConfigTranscricao,
  MAXIMO_AUDIO_BYTES,
  ouvir,
  transcrever,
  URL_PADRAO,
} from '../src/servidor/assistente/transcricao'
import { lerDoConector } from '../src/servidor/assistente/proprio'
import { audioDoZapi, lerZapi } from '../src/servidor/assistente/webhook'
import { audioDa, normalizar, type MensagemBruta } from '../conector/src/normalizar'

// ─────────────────────────────────────────────────────────────

const c = (nome: string, codigo: string, extra: Partial<Candidato> = {}): Candidato => ({
  variacaoId: `var-${codigo}`,
  codigo,
  codigoBarras: null,
  nome,
  opcoes: null,
  medida: 'KG',
  vendidoEm: [],
  ...extra,
})
const CADASTRO = [
  c('Picanha', 'PIC001'),
  c('Picanha suína', 'PIC002'),
  c('Linguiça toscana', 'LIN001'),
  c('Linguiça calabresa', 'LIN002'),
  c('Camiseta básica', 'CAM001', { opcoes: 'P · Azul', medida: 'UN' }),
  c('Camiseta básica', 'CAM002', { opcoes: 'M · Azul', medida: 'UN', codigoBarras: '7890000000017' }),
]

describe('achar o produto que a pessoa disse', () => {
  it('o código da etiqueta ou o de barras decide, sem olhar o nome', () => {
    expect(escolherProduto('pic002', CADASTRO)).toMatchObject({ tipo: 'um', produto: { codigo: 'PIC002' } })
    expect(escolherProduto('7890000000017', CADASTRO)).toMatchObject({ tipo: 'um', produto: { codigo: 'CAM002' } })
  })

  it('o nome exato ganha dos parecidos: "picanha" é a Picanha, não a suína', () => {
    expect(escolherProduto('picanha', CADASTRO)).toMatchObject({ tipo: 'um', produto: { codigo: 'PIC001' } })
    expect(escolherProduto('PICANHA SUINA', CADASTRO)).toMatchObject({ tipo: 'um', produto: { codigo: 'PIC002' } })
  })

  it('dois que servem viram pergunta — nunca chute', () => {
    const a = escolherProduto('linguiça', CADASTRO)
    expect(a.tipo).toBe('varios')
    expect(a.tipo === 'varios' && a.candidatos.map((x) => x.codigo)).toEqual(['LIN001', 'LIN002'])
    // a grade também pergunta: qual tamanho?
    expect(escolherProduto('camiseta', CADASTRO).tipo).toBe('varios')
  })

  it('palavra pela metade e plural acham; a grade dita acha a variação', () => {
    expect(escolherProduto('linguica tosc', CADASTRO)).toMatchObject({ tipo: 'um', produto: { codigo: 'LIN001' } })
    expect(escolherProduto('linguiças calabresas', CADASTRO)).toMatchObject({ tipo: 'um', produto: { codigo: 'LIN002' } })
    expect(escolherProduto('camiseta básica m azul', CADASTRO)).toMatchObject({ tipo: 'um', produto: { codigo: 'CAM002' } })
  })

  it('o que não existe é "nenhum", e texto vazio também', () => {
    expect(escolherProduto('alcatra', CADASTRO)).toEqual({ tipo: 'nenhum' })
    expect(escolherProduto('  ', CADASTRO)).toEqual({ tipo: 'nenhum' })
  })

  it('a medida dita, em palavras de gente', () => {
    expect(medidaDoTexto('quilos')).toBe('KG')
    expect(medidaDoTexto('Kg')).toBe('KG')
    expect(medidaDoTexto('gramas')).toBe('G')
    expect(medidaDoTexto('litro')).toBe('L')
    expect(medidaDoTexto('caixas')).toBe('CX')
    expect(medidaDoTexto('unidades')).toBe('UN')
    expect(medidaDoTexto('')).toBeNull()
    expect(medidaDoTexto('arroba')).toBeNull()
  })

  it('a quantidade vai para a medida do cadastro — e o que não converte volta nulo', () => {
    expect(converter(500, 'G', 'KG')).toBe(0.5)
    expect(converter(2, 'L', 'ML')).toBe(2000)
    expect(converter(10, null, 'KG')).toBe(10)
    expect(converter(10, 'KG', 'KG')).toBe(10)
    expect(converter(3, 'KG', 'UN')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────

describe('o "sim" e o "não" na conversa', () => {
  it('a mensagem inteira é o sim (com pontuação, acento e emoji)', () => {
    for (const t of ['sim', 'Sim!', 'SIM.', 'confirmo', 'Confirma', 'Pode lançar']) {
      expect(lerRespostaCurta(t), t).toEqual({ aceita: true, codigo: null, numero: null, frouxa: false })
    }
    // o sim frouxo: também responde a outras perguntas (só vale logo depois da proposta)
    for (const t of ['pode', 'ok', 'Ok 👍', 'isso', 'isso mesmo']) {
      expect(lerRespostaCurta(t), t).toEqual({ aceita: true, codigo: null, numero: null, frouxa: true })
    }
    for (const t of ['não', 'Nao', 'cancela', 'Cancelar']) {
      expect(lerRespostaCurta(t), t).toEqual({ aceita: false, codigo: null, numero: null, frouxa: true })
    }
  })

  it('com o código da proposta: "sim KP42", "SIM kp-42", "não KP42"; o número da lista antiga é lido, mas não escolhe', () => {
    expect(lerRespostaCurta('sim KP42')).toEqual({ aceita: true, codigo: 'KP42', numero: null, frouxa: false })
    expect(lerRespostaCurta('SIM kp-42')).toEqual({ aceita: true, codigo: 'KP42', numero: null, frouxa: false })
    expect(lerRespostaCurta('não KP42')).toMatchObject({ aceita: false, codigo: 'KP42' })
    expect(lerRespostaCurta('ok KP42')).toMatchObject({ aceita: true, codigo: 'KP42', frouxa: true })
    expect(lerRespostaCurta('sim 2')).toEqual({ aceita: true, codigo: null, numero: 2, frouxa: false })
    expect(lerRespostaCurta('Sim, a 2')).toMatchObject({ numero: 2 })
    expect(lerRespostaCurta('não 1')).toMatchObject({ aceita: false, numero: 1 })
  })

  it('o código é fixo para a proposta, curto, e sem letra que se confunde com número', () => {
    const c1 = codigoDaProposta('cmabc123')
    expect(c1).toMatch(/^[A-HJKMNP-Z]{2}\d{2}$/)
    expect(codigoDaProposta('cmabc123')).toBe(c1)
    const muitos = new Set(Array.from({ length: 50 }, (_, i) => codigoDaProposta(`prop-${i}`)))
    expect(muitos.size).toBeGreaterThan(45)
  })

  it('frase com mais coisa não é sim: vai para o modelo', () => {
    for (const t of ['sim, mas muda a data', 'pode ser amanhã?', 'ok obrigado', 'simples', 'CONFIRMAR 123456', '']) {
      expect(lerRespostaCurta(t), t).toBeNull()
    }
  })

  it('ACEITAR e PRONTO, com código ou número opcionais', () => {
    expect(lerAtalhoEncomenda('ACEITAR')).toEqual({ acao: 'aceitar', codigo: null, numero: null })
    expect(lerAtalhoEncomenda('aceito ENC-A1B2C3')).toEqual({ acao: 'aceitar', codigo: 'a1b2c3', numero: null })
    expect(lerAtalhoEncomenda('Pronto!')).toEqual({ acao: 'pronta', codigo: null, numero: null })
    expect(lerAtalhoEncomenda('tá pronto 2')).toEqual({ acao: 'pronta', codigo: null, numero: 2 })
    // sem o ENC, a palavra seguinte não vira código
    expect(lerAtalhoEncomenda('aceito cartao')).toBeNull()
    expect(lerAtalhoEncomenda('aceita pix?')).toBeNull()
    expect(lerAtalhoEncomenda('pronto, e agora o que eu faço?')).toBeNull()
  })

  it('a frase depois do sim: o que foi feito, ou a recusa em palavras de gente', () => {
    expect(fraseDaResposta({ ok: true, feito: 'entrada de 10 kg de Picanha lançada.' }, true, 'x')).toBe('Feito: entrada de 10 kg de Picanha lançada.')
    expect(fraseDaResposta({ ok: true }, false, 'Entrada de tal')).toBe('Certo, cancelei. Nada foi feito: Entrada de tal')
    expect(fraseDaResposta({ ok: false, motivo: 'sem_permissao' }, true, 'x')).toMatch(/não é do seu acesso/)
    expect(fraseDaResposta({ ok: false, motivo: 'expirada' }, true, 'x')).toMatch(/venceu/)
    expect(fraseDaResposta({ ok: false, motivo: 'falhou', recado: 'Esta encomenda já está entregue.' }, true, 'x')).toBe(
      'Não deu: Esta encomenda já está entregue.',
    )
    // erro de máquina (sem recado) não vaza o detalhe
    expect(fraseDaResposta({ ok: false, motivo: 'falhou', detalhe: 'PrismaClientKnownRequestError: P2002 ...' }, true, 'x')).not.toMatch(/Prisma/)
  })
})

// ─────────────────────────────────────────────────────────────

describe('a encomenda em texto', () => {
  const agora = new Date('2026-10-02T15:00:00Z') // sex 02/10, 12h em SP
  const pedido = {
    id: 'ckxyz00000abc123',
    clienteNome: 'Maria Exemplo Souza',
    descricao: 'Pedido do catálogo',
    valor: 38,
    para: new Date('2026-10-02T18:00:00Z'), // hoje, 15h em SP
    entrega: false,
    itens: [
      { descricao: 'Picolé de morango', quantidade: 2 },
      { descricao: 'Pote 1L', quantidade: 1 },
    ],
  }

  it('o aviso à equipe: código, itens, total, retirada e hora, e como responder', () => {
    expect(textoDoPedidoNovo(pedido, agora)).toBe(
      'Pedido novo pelo catálogo (ENC-ABC123): 2x Picolé de morango, 1x Pote 1L. Total R$ 38,00 — retirada hoje às 15h. Responda ACEITAR, PRONTO ou abra Encomendas.',
    )
    expect(textoDoPedidoNovo({ ...pedido, entrega: true, para: new Date('2026-10-04T13:30:00Z') }, agora, 'Loja Praia')).toMatch(
      /^Pedido novo pelo catálogo \(ENC-ABC123\), Loja Praia: .* — entrega dom 04\/10 às 10h30\./,
    )
  })

  it('o aviso à cliente: o primeiro nome, o código e o link', () => {
    const link = 'https://norte.exemplo/loja/pedido/tok'
    expect(textoParaCliente(pedido, 'ACEITA', 'Loja Exemplo', link, agora)).toBe(
      `Oi, Maria! A Loja Exemplo recebeu seu pedido ENC-ABC123 — retirada hoje às 15h. Acompanhe por aqui: ${link}`,
    )
    expect(textoParaCliente({ ...pedido, entrega: true }, 'PRONTA', 'Loja Exemplo', null, agora)).toBe(
      'Oi, Maria! Seu pedido ENC-ABC123 está pronto e sai para a entrega.',
    )
    expect(textoParaCliente(pedido, 'CANCELADA', 'Loja Exemplo', null, agora)).toMatch(/foi cancelado/)
  })

  it('as peças pequenas', () => {
    expect(primeiroNome('  Maria Exemplo ')).toBe('Maria')
    expect(primeiroNome(null)).toBe('')
    expect(horaFalada(new Date('2026-10-02T18:30:00Z'))).toBe('15h30')
    expect(itensEmTexto([], 'Bolo de chocolate 2 kg')).toBe('Bolo de chocolate 2 kg')
    expect(itensEmTexto([{ descricao: 'Pote', quantidade: 1.5 }], '')).toBe('1,5x Pote')
    expect(finalDoCodigo('ENC-A1B2C3')).toBe('a1b2c3')
    expect(finalDoCodigo('a1b2c3')).toBe('a1b2c3')
    expect(finalDoCodigo('aceitar')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────

describe('a transcrição', () => {
  const AUDIO = new Uint8Array([79, 103, 103, 83, 1, 2, 3])
  const servico = (resposta: Response | (() => never)) => {
    const chamadas: { url: string; init: RequestInit }[] = []
    const buscar = (async (url: string, init: RequestInit) => {
      chamadas.push({ url: String(url), init })
      if (typeof resposta === 'function') resposta()
      return (resposta as Response).clone()
    }) as unknown as typeof fetch
    return { buscar, chamadas }
  }
  const COM_CHAVE = { TRANSCRICAO_CHAVE: 'chave-de-teste' }

  it('sem a chave no servidor: nulo, e nada é chamado', async () => {
    const s = servico(new Response('{}'))
    expect(lerConfigTranscricao({})).toBeNull()
    expect(await transcrever(AUDIO, 'audio/ogg', s.buscar, {})).toBeNull()
    expect(await ouvir({ base64: 'T2dnUw==', mime: 'audio/ogg' }, s.buscar, {})).toBeNull()
    expect(s.chamadas).toHaveLength(0)
  })

  it('com a chave: manda o arquivo, o modelo e o português, e devolve o texto', async () => {
    const s = servico(new Response(JSON.stringify({ text: '  comprei 10 kg de picanha  ' }), { status: 200 }))
    expect(await transcrever(AUDIO, 'audio/ogg; codecs=opus', s.buscar, COM_CHAVE)).toBe('comprei 10 kg de picanha')
    expect(s.chamadas[0]!.url).toBe(URL_PADRAO)
    expect((s.chamadas[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer chave-de-teste')
    const form = s.chamadas[0]!.init.body as FormData
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('language')).toBe('pt')
    expect((form.get('file') as File).name).toBe('audio.ogg')
  })

  it('o endereço e o modelo vêm do ambiente; endereço em http fora da máquina é recusado', () => {
    expect(lerConfigTranscricao({ ...COM_CHAVE, TRANSCRICAO_URL: 'https://outro.exemplo/v1/t', TRANSCRICAO_MODELO: 'whisper-1' })).toEqual({
      url: 'https://outro.exemplo/v1/t',
      chave: 'chave-de-teste',
      modelo: 'whisper-1',
    })
    expect(lerConfigTranscricao({ ...COM_CHAVE, TRANSCRICAO_URL: 'http://outro.exemplo/t' })).toBeNull()
  })

  it('serviço fora do ar, recusa ou resposta vazia: nulo, sem lançar', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await transcrever(AUDIO, 'audio/ogg', servico(new Response('erro', { status: 500 })).buscar, COM_CHAVE)).toBeNull()
    expect(await transcrever(AUDIO, 'audio/ogg', servico(new Response(JSON.stringify({ text: '' }))).buscar, COM_CHAVE)).toBeNull()
    const caiu = servico(() => {
      throw new TypeError('fetch failed')
    })
    expect(await transcrever(AUDIO, 'audio/ogg', caiu.buscar, COM_CHAVE)).toBeNull()
    vi.restoreAllMocks()
  })

  it('áudio grande demais nem sai', async () => {
    const s = servico(new Response(JSON.stringify({ text: 'x' })))
    expect(await transcrever(new Uint8Array(MAXIMO_AUDIO_BYTES + 1), 'audio/ogg', s.buscar, COM_CHAVE)).toBeNull()
    expect(s.chamadas).toHaveLength(0)
  })

  it('o link do Z-API é baixado (só https e de fora de casa) e transcrito', async () => {
    const chamadas: string[] = []
    const buscar = (async (url: string) => {
      chamadas.push(String(url))
      if (String(url).startsWith('https://arquivos.exemplo')) {
        return new Response(AUDIO, { status: 200, headers: { 'content-type': 'audio/ogg' } })
      }
      return new Response(JSON.stringify({ text: 'chegaram 12 caixas de leite' }))
    }) as unknown as typeof fetch
    expect(await ouvir({ url: 'https://arquivos.exemplo/a.ogg', mime: null, segundos: 8 }, buscar, COM_CHAVE)).toBe('chegaram 12 caixas de leite')
    expect(chamadas).toEqual(['https://arquivos.exemplo/a.ogg', URL_PADRAO])

    for (const u of ['http://arquivos.exemplo/a.ogg', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.5/a', 'https://192.168.0.2/a', 'https://[::1]/a']) {
      expect(enderecoBaixavel(u), u).toBe(false)
    }
    expect(await ouvir({ url: 'https://arquivos.exemplo/a.ogg', mime: null, segundos: 600 }, buscar, COM_CHAVE)).toBeNull()
  })

  it('o eco: o que ouviu, entre aspas, e encurtado quando é longo', () => {
    expect(ecoDoAudio('sim')).toBe('Ouvi: “sim”')
    expect(ecoDoAudio('a'.repeat(400)).length).toBeLessThan(240)
  })
})

// ─────────────────────────────────────────────────────────────

describe('o áudio na entrada: conector e Z-API', () => {
  const corpo = { tipo: 'mensagem', telefone: '5571999990001', nome: 'Ana', texto: '(a pessoa mandou um áudio...)', id: 'W1', deMim: false }

  it('o conector novo manda o áudio junto; o antigo, sem ele, continua valendo', () => {
    const audio = { base64: 'T2dnUw==', mime: 'audio/ogg; codecs=opus' }
    expect(lerDoConector({ ...corpo, audio })).toMatchObject({ tipo: 'mensagem', audio })
    const antigo = lerDoConector(corpo)
    expect(antigo).toMatchObject({ tipo: 'mensagem', texto: corpo.texto })
    expect('audio' in antigo).toBe(false)
  })

  it('áudio fora do formato é ignorado, e a mensagem segue com o aviso', () => {
    for (const audio of [{ base64: 'não é base64!', mime: 'audio/ogg' }, { base64: 'T2dnUw==', mime: 'image/png' }, 'texto']) {
      const r = lerDoConector({ ...corpo, audio })
      expect(r.tipo).toBe('mensagem')
      expect('audio' in r).toBe(false)
    }
  })

  it('o Z-API manda o link: vai junto, só https e até três minutos', () => {
    const base = { type: 'ReceivedCallback', phone: '5571999990001', messageId: 'Z1' }
    expect(lerZapi({ ...base, audio: { audioUrl: 'https://arquivos.exemplo/a.ogg', mimeType: 'audio/ogg', seconds: 9, ptt: true } })).toMatchObject({
      tipo: 'mensagem',
      texto: expect.stringContaining('um áudio'),
      audio: { url: 'https://arquivos.exemplo/a.ogg', mime: 'audio/ogg', segundos: 9 },
    })
    expect(audioDoZapi({ audioUrl: 'http://arquivos.exemplo/a.ogg' })).toBeNull()
    expect(audioDoZapi({ audioUrl: 'https://arquivos.exemplo/a.ogg', seconds: 600 })).toBeNull()
  })

  it('o conector marca a nota de voz para baixar — e a longa demais fica só com o aviso', () => {
    const agora = Date.now()
    const m = (message: Record<string, unknown>): MensagemBruta => ({
      key: { remoteJid: '5571999991234@s.whatsapp.net', fromMe: false, id: 'M1' },
      messageTimestamp: Math.floor(agora / 1000) - 5,
      message,
    })
    const ctx = { agora, meuNumero: null, enviadas: new Set<string>(), idadeMaximaMs: 3_600_000 }
    expect(normalizar(m({ audioMessage: { seconds: 8, mimetype: 'audio/ogg; codecs=opus', ptt: true } }), ctx)).toMatchObject({
      texto: expect.stringContaining('um áudio'),
      audioParaBaixar: { mime: 'audio/ogg; codecs=opus', segundos: 8 },
    })
    expect(normalizar(m({ audioMessage: { seconds: 900 } }), ctx)).not.toHaveProperty('audioParaBaixar')
    expect(audioDa({ audioMessage: { fileLength: 10 * 1024 * 1024 } })).toBeNull()
    expect(normalizar(m({ imageMessage: {} }), ctx)).not.toHaveProperty('audioParaBaixar')
  })
})
