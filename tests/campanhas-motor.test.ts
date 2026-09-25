import { describe, it, expect } from 'vitest'
import {
  acharCampanha,
  conflitosDeGatilho,
  contemFrase,
  decidir,
  ehPedidoDeParada,
  lerGatilho,
  normalizar,
  podeReentrar,
  type CampanhaCasavel,
} from '../src/servidor/campanhas/casar'
import {
  escolherRamo,
  escolherVariacao,
  grafoNovo,
  interpolar,
  lerGrafo,
  pendencias,
  rotearCondicao,
  temErro,
} from '../src/servidor/campanhas/grafo'
import { lerHorario, proximaAbertura } from '../src/servidor/campanhas/horario'
import { esperaMinima, lerAjustes, podeEnviar } from '../src/servidor/campanhas/freios'
import { conferirArquivo } from '../src/servidor/campanhas/midia-regras'
import { assinarMidia, conferirAssinatura } from '../src/servidor/campanhas/midia'
import { rodar, type Deps, type EstadoExecucao, type Envio } from '../src/servidor/campanhas/motor'
import { AJUSTES_PADRAO, GATILHO_NOVO, MAX_PASSOS, REENTRADA_PADRAO, type Gatilho, type Grafo } from '../src/servidor/campanhas/tipos'

// O motor das campanhas, sem banco e sem WhatsApp. É aqui que se prova a
// parte que decide se a loja fala ou cala: quem entra em qual campanha, a
// troca de funil, a reentrada, as palavras de parada, os caminhos da
// condição e do A/B, o freio de passos, as esperas que viram despertador e
// os freios contra banimento.

const g = (p: Partial<Gatilho> = {}): Gatilho => ({ ...GATILHO_NOVO, ...p })
const camp = (id: string, p: Partial<Gatilho> = {}): CampanhaCasavel => ({ id, nome: id, gatilho: g(p) })
const DIA = 86_400_000
const agora = new Date('2026-09-25T15:00:00Z') // sexta, 12h em São Paulo

// ─────────────────────────────────────────────────────────────
// ACHAR A CAMPANHA
// ─────────────────────────────────────────────────────────────

describe('achar a campanha pela mensagem', () => {
  it('ignora acento, maiúscula e pontuação', () => {
    expect(normalizar('Catálogo, POR FAVOR!!')).toBe('catalogo por favor')
    const r = acharCampanha('Oi! Quero o CATALOGO por favor', null, [camp('c1', { frases: ['quero o catálogo'] })])
    expect(r?.campanhaId).toBe('c1')
  })

  it('respeita a palavra inteira: "promo" não casa com "promoção"', () => {
    expect(contemFrase(normalizar('tem promoção?'), 'promo')).toBe(false)
    expect(contemFrase(normalizar('tem promo hoje?'), 'promo')).toBe(true)
    expect(acharCampanha('tem promoção?', null, [camp('c1', { frases: ['promo'] })])).toBeNull()
  })

  it('frase com menos de 3 letras é ignorada', () => {
    expect(acharCampanha('oi', null, [camp('c1', { frases: ['oi'] })])).toBeNull()
  })

  it('a frase MAIS LONGA ganha, entre campanhas diferentes', () => {
    const ativas = [camp('curta', { frases: ['catálogo'] }), camp('longa', { frases: ['catálogo de verão'] })]
    expect(acharCampanha('quero o catalogo de verao', null, ativas)?.campanhaId).toBe('longa')
    expect(acharCampanha('quero o catalogo', null, ativas)?.campanhaId).toBe('curta')
  })

  it('o anúncio vem antes da frase', () => {
    const ativas = [camp('frase', { frases: ['catálogo'] }), camp('anuncio', { anuncioIds: ['120210000000'] })]
    expect(acharCampanha('quero o catálogo', '120210000000', ativas)).toEqual({ campanhaId: 'anuncio', por: 'anuncio' })
    // Anúncio desconhecido: cai na frase.
    expect(acharCampanha('quero o catálogo', '999', ativas)?.campanhaId).toBe('frase')
  })

  it('campanha manual nunca entra por frase', () => {
    expect(acharCampanha('quero o catálogo', null, [camp('m', { tipo: 'manual', frases: ['catálogo'] })])).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// REENTRADA
// ─────────────────────────────────────────────────────────────

describe('reentrada', () => {
  it('o padrão de toda campanha nova é "nunca", numa constante só', () => {
    expect(REENTRADA_PADRAO).toBe('nunca')
    expect(GATILHO_NOVO.reentrada).toBe('nunca')
    expect(lerGatilho({}).reentrada).toBe('nunca')
    expect(lerGatilho({ reentrada: 'qualquer coisa' }).reentrada).toBe('nunca')
  })

  it('nunca / depois / sempre', () => {
    const ontem = new Date(agora.getTime() - DIA)
    expect(podeReentrar({ reentrada: 'nunca' }, null, agora)).toBe(true)
    expect(podeReentrar({ reentrada: 'nunca' }, ontem, agora)).toBe(false)
    expect(podeReentrar({ reentrada: 'sempre' }, ontem, agora)).toBe(true)
    expect(podeReentrar({ reentrada: 'depois', reentradaDias: 2 }, ontem, agora)).toBe(false)
    expect(podeReentrar({ reentrada: 'depois', reentradaDias: 1 }, ontem, agora)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// A DECISÃO
// ─────────────────────────────────────────────────────────────

describe('o que fazer com a mensagem', () => {
  const ativas = [camp('a', { frases: ['catálogo'] }), camp('b', { frases: ['aniversário'], reentrada: 'nunca' })]
  const nunca = () => null

  it('sem campanha viva e sem frase: ignora (é da loja)', () => {
    expect(decidir({ texto: 'bom dia, tudo bem?', viva: null, ativas, ultimaEntrada: nunca, agora })).toEqual({ acao: 'ignorar' })
  })

  it('casou e pode entrar: inicia', () => {
    expect(decidir({ texto: 'quero o catálogo', viva: null, ativas, ultimaEntrada: nunca, agora })).toEqual({ acao: 'iniciar', campanhaId: 'a' })
  })

  it('casou mas já passou por ela (reentrada nunca): ignora', () => {
    expect(decidir({ texto: 'quero o catálogo', viva: null, ativas, ultimaEntrada: () => new Date(agora.getTime() - 30 * DIA), agora })).toEqual({ acao: 'ignorar' })
  })

  it('com campanha viva, o resto é resposta para ela', () => {
    const viva = { id: 'x1', campanhaId: 'a', status: 'aguardando_resposta' }
    expect(decidir({ texto: 'sim', viva, ativas, ultimaEntrada: nunca, agora })).toEqual({ acao: 'responder', execucaoId: 'x1' })
    // A frase da PRÓPRIA campanha também é resposta — não recomeça.
    expect(decidir({ texto: 'catálogo', viva, ativas, ultimaEntrada: nunca, agora })).toEqual({ acao: 'responder', execucaoId: 'x1' })
  })

  it('troca de funil: a frase de OUTRA campanha encerra a atual e começa a nova', () => {
    const viva = { id: 'x1', campanhaId: 'a', status: 'esperando' }
    expect(decidir({ texto: 'e o cupom de aniversário?', viva, ativas, ultimaEntrada: nunca, agora })).toEqual({ acao: 'trocar', execucaoId: 'x1', campanhaId: 'b' })
  })

  it('troca de funil respeita a reentrada da nova: não pode, fica onde está', () => {
    const viva = { id: 'x1', campanhaId: 'a', status: 'esperando' }
    const ja = (id: string) => (id === 'b' ? new Date(agora.getTime() - DIA) : null)
    expect(decidir({ texto: 'aniversário', viva, ativas, ultimaEntrada: ja, agora })).toEqual({ acao: 'responder', execucaoId: 'x1' })
  })

  it('palavra de parada SOZINHA cancela; no meio da frase é resposta', () => {
    const viva = { id: 'x1', campanhaId: 'a', status: 'aguardando_resposta' }
    for (const t of ['parar', 'Sair', 'CANCELAR', 'não quero', 'Nao quero!']) {
      expect(ehPedidoDeParada(t), t).toBe(true)
      expect(decidir({ texto: t, viva, ativas, ultimaEntrada: nunca, agora })).toEqual({ acao: 'cancelar', execucaoId: 'x1' })
    }
    expect(decidir({ texto: 'não quero o azul, quero o preto', viva, ativas, ultimaEntrada: nunca, agora }).acao).toBe('responder')
    // Sem campanha viva, "parar" não é nada.
    expect(decidir({ texto: 'parar', viva: null, ativas, ultimaEntrada: nunca, agora })).toEqual({ acao: 'ignorar' })
  })
})

describe('duas campanhas ativas não dividem frase nem anúncio', () => {
  it('acusa a frase igual (com e sem acento) e o anúncio igual', () => {
    const minha = camp('eu', { frases: ['Catálogo'], anuncioIds: ['123'] })
    const outras = [camp('outra', { frases: ['catalogo'] }), camp('ads', { anuncioIds: ['123'] })]
    expect(conflitosDeGatilho(minha, outras)).toHaveLength(2)
  })
  it('frase contida em outra não é conflito (a mais longa ganha)', () => {
    expect(conflitosDeGatilho(camp('eu', { frases: ['catálogo'] }), [camp('o', { frases: ['catálogo de verão'] })])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// O DESENHO
// ─────────────────────────────────────────────────────────────

const no = (id: string, tipo: string, dados: object = {}) => ({ id, tipo, x: 0, y: 0, dados })
const liga = (de: string, para: string, saida = 'saida') => ({ id: `${de}-${saida}-${para}`, de, saida, para })

describe('o desenho que chega do navegador', () => {
  it('tira tipo desconhecido, ligação para bloco que não existe, saída inventada e ligação repetida', () => {
    const gr = lerGrafo({
      nodes: [no('inicio', 'inicio'), no('m', 'mensagem', { textos: ['oi'] }), no('x', 'script_malicioso'), { id: '<b>', tipo: 'fim' }],
      edges: [liga('inicio', 'm'), liga('inicio', 'fantasma'), liga('m', 'inicio'), liga('m', 'm', 'inventada'), { ...liga('inicio', 'm'), id: 'dup' }],
    })
    expect(gr.nodes.map((n) => n.id)).toEqual(['inicio', 'm'])
    expect(gr.edges).toEqual([liga('inicio', 'm')])
  })

  it('o desenho de uma campanha nova não tem pendência de desenho — só falta a frase', () => {
    const ps = pendencias(grafoNovo(), { tipoGatilho: 'frase', frases: [] })
    expect(ps.filter((p) => p.nivel === 'erro').map((p) => p.texto)).toEqual(['Diga a frase que faz a pessoa entrar (no bloco Início).'])
    expect(temErro(pendencias(grafoNovo(), { tipoGatilho: 'frase', frases: ['catálogo'] }))).toBe(false)
  })

  it('acusa bloco solto, mensagem vazia, condição sem regra, e ir para a própria campanha', () => {
    const gr = lerGrafo({
      nodes: [
        no('inicio', 'inicio'),
        no('m', 'mensagem', { textos: [''] }),
        no('solto', 'fim'),
        no('c', 'condicao', { regras: [] }),
        no('k', 'conectar', { campanhaId: 'eu' }),
      ],
      edges: [liga('inicio', 'm'), liga('m', 'c'), liga('c', 'k', 'outro')],
    })
    const textos = pendencias(gr, { campanhaId: 'eu', tipoGatilho: 'manual' }).filter((p) => p.nivel === 'erro').map((p) => p.texto)
    expect(textos).toContain('Mensagem vazia.')
    expect(textos).toContain('"Fim" está solto: nada chega nele.')
    expect(textos).toContain('A condição não tem nenhuma regra.')
    expect(textos).toContain('O bloco leva para a própria campanha: seria um laço.')
  })

  it('acusa círculo sem espera, e aceita círculo com espera', () => {
    const base = [no('inicio', 'inicio'), no('m', 'mensagem', { textos: ['oi'] }), no('c', 'condicao', { regras: [{ id: 'r1', rotulo: '', palavras: ['sim'] }] })]
    const semEspera = lerGrafo({ nodes: base, edges: [liga('inicio', 'm'), liga('m', 'c'), liga('c', 'm', 'outro')] })
    expect(pendencias(semEspera, { tipoGatilho: 'manual' }).some((p) => p.texto.includes('círculo'))).toBe(true)
    const comEspera = lerGrafo({
      nodes: [...base, no('w', 'aguardar_resposta', { quantidade: 1, unidade: 'h' })],
      edges: [liga('inicio', 'm'), liga('m', 'w'), liga('w', 'c', 'respondeu'), liga('c', 'm', 'outro')],
    })
    expect(pendencias(comEspera, { tipoGatilho: 'manual' }).some((p) => p.texto.includes('círculo'))).toBe(false)
  })
})

describe('caminhos e textos', () => {
  const regras = [
    { id: 'sim', palavras: ['sim', 'quero', '1'] },
    { id: 'nao', palavras: ['não', '2'] },
  ]

  it('condição: a primeira regra com a palavra decide; nenhuma, "outro"', () => {
    expect(rotearCondicao(regras, 'Sim, QUERO!')).toBe('sim')
    expect(rotearCondicao(regras, 'Nao obrigado')).toBe('nao')
    expect(rotearCondicao(regras, '1')).toBe('sim')
    expect(rotearCondicao(regras, 'talvez amanhã')).toBe('outro')
    // palavra inteira: "simples" não é "sim"
    expect(rotearCondicao(regras, 'simples')).toBe('outro')
  })

  it('A/B: a mesma pessoa cai sempre no mesmo caminho, e os pesos valem', () => {
    const ramos = [
      { id: 'a', peso: 70 },
      { id: 'b', peso: 30 },
    ]
    expect(escolherRamo(ramos, '7199990001', 'd1')).toBe(escolherRamo(ramos, '7199990001', 'd1'))
    let a = 0
    for (let i = 0; i < 2000; i++) if (escolherRamo(ramos, `71${String(i).padStart(8, '0')}`, 'd1') === 'a') a++
    expect(a / 2000).toBeGreaterThan(0.64)
    expect(a / 2000).toBeLessThan(0.76)
    expect(escolherRamo([{ id: 'a', peso: 0 }], 'x', 'd')).toBeNull()
  })

  it('variação: determinística por contato, e as vazias não contam', () => {
    const t = ['Oi', 'Olá', '', 'E aí']
    const v = escolherVariacao(t, '7199990001', 'm1')
    expect(escolherVariacao(t, '7199990001', 'm1')).toBe(v)
    expect(['Oi', 'Olá', 'E aí']).toContain(v)
    const vistas = new Set(Array.from({ length: 60 }, (_, i) => escolherVariacao(t, `71${i}`, 'm1')))
    expect(vistas.size).toBe(3)
  })

  it('coringas: {primeiro_nome}, {nome}, {resposta}; o que falta some sem sobrar vírgula', () => {
    expect(interpolar('Oi, {primeiro_nome}! Você disse "{resposta}".', { nome: 'Maria Souza', resposta: 'sim' })).toBe('Oi, Maria! Você disse "sim".')
    expect(interpolar('Oi, {primeiro_nome}!', { nome: null })).toBe('Oi!')
    expect(interpolar('{nome}', { nome: 'Maria Souza' })).toBe('Maria Souza')
  })
})

// ─────────────────────────────────────────────────────────────
// HORÁRIO DA LOJA
// ─────────────────────────────────────────────────────────────

describe('o horário da loja', () => {
  it('entende o jeito comum de escrever', () => {
    const h = lerHorario('Seg a sex 9h-18h, sáb 9h às 13h')!
    expect(h[1]).toEqual([[540, 1080]])
    expect(h[5]).toEqual([[540, 1080]])
    expect(h[6]).toEqual([[540, 780]])
    expect(h[0]).toBeUndefined()
    expect(lerHorario('Segunda a sexta das 08:30 às 17:30')![3]).toEqual([[510, 1050]])
    expect(lerHorario('todos os dias 10h-22h')![0]).toEqual([[600, 1320]])
    expect(lerHorario('seg a sex 9h-18h sab 9h-12h')![6]).toEqual([[540, 720]])
  })

  it('não entendeu: nulo (e a espera ignora o horário)', () => {
    expect(lerHorario('horário comercial')).toBeNull()
    expect(lerHorario('')).toBeNull()
    expect(lerHorario(null)).toBeNull()
  })

  it('a próxima abertura, no relógio de São Paulo', () => {
    const h = lerHorario('Seg a sex 9h-18h, sáb 9h-13h')!
    // sexta 12h SP: aberta, sai agora
    expect(proximaAbertura(agora, h)).toEqual(agora)
    // sexta 19h SP (22h UTC): abre sábado 9h SP (12h UTC)
    expect(proximaAbertura(new Date('2026-09-25T22:00:00Z'), h).toISOString()).toBe('2026-09-26T12:00:00.000Z')
    // sábado 14h SP: pula domingo, abre segunda 9h
    expect(proximaAbertura(new Date('2026-09-26T17:00:00Z'), h).toISOString()).toBe('2026-09-28T12:00:00.000Z')
    // madrugada de sexta: abre às 9h do mesmo dia
    expect(proximaAbertura(new Date('2026-09-25T06:00:00Z'), h).toISOString()).toBe('2026-09-25T12:00:00.000Z')
  })
})

// ─────────────────────────────────────────────────────────────
// FREIOS CONTRA BANIMENTO
// ─────────────────────────────────────────────────────────────

describe('os freios', () => {
  const base = {
    ajustes: { ...AJUSTES_PADRAO },
    enviadasHojeContato: 0,
    enviadasHojeEmpresa: 0,
    teste: false,
    iniciadaPeloContato: true,
    ultimaEntradaEm: agora,
    agora,
  }

  it('teto por contato e teto da empresa', () => {
    expect(podeEnviar(base)).toBe('ok')
    expect(podeEnviar({ ...base, enviadasHojeContato: AJUSTES_PADRAO.porContatoDia })).toBe('limite_contato')
    expect(podeEnviar({ ...base, enviadasHojeEmpresa: AJUSTES_PADRAO.porEmpresaDia })).toBe('limite_empresa')
  })

  it('a janela: só fala com quem escreveu primeiro, a não ser dentro da campanha que ele começou', () => {
    const velha = new Date(agora.getTime() - 25 * 3_600_000)
    expect(podeEnviar({ ...base, iniciadaPeloContato: false, ultimaEntradaEm: velha })).toBe('fora_da_janela')
    expect(podeEnviar({ ...base, iniciadaPeloContato: false, ultimaEntradaEm: null })).toBe('fora_da_janela')
    expect(podeEnviar({ ...base, iniciadaPeloContato: false, ultimaEntradaEm: new Date(agora.getTime() - 3_600_000) })).toBe('ok')
    expect(podeEnviar({ ...base, iniciadaPeloContato: true, ultimaEntradaEm: velha })).toBe('ok')
    expect(podeEnviar({ ...base, teste: true, iniciadaPeloContato: false, ultimaEntradaEm: null })).toBe('ok')
  })

  it('o ritmo entre duas mensagens para a mesma pessoa', () => {
    expect(esperaMinima(null, agora, 2)).toBe(0)
    expect(esperaMinima(new Date(agora.getTime() - 500), agora, 2)).toBe(1500)
    expect(esperaMinima(new Date(agora.getTime() - 5000), agora, 2)).toBe(0)
  })

  it('os limites da tela ficam dentro do que não derruba ninguém', () => {
    expect(lerAjustes({ porContatoDia: 9999, porEmpresaDia: 1, intervaloSeg: 'x' }, AJUSTES_PADRAO)).toEqual({ porContatoDia: 50, porEmpresaDia: 10, intervaloSeg: 2 })
  })
})

// ─────────────────────────────────────────────────────────────
// MÍDIA
// ─────────────────────────────────────────────────────────────

describe('mídia', () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
  it('tipo, tamanho e os primeiros bytes', () => {
    expect(conferirArquivo('image/jpeg', 1000, jpg)).toEqual({ ok: true, tipo: 'imagem' })
    expect(conferirArquivo('image/jpeg', 6 * 1024 * 1024, jpg).ok).toBe(false)
    expect(conferirArquivo('video/mp4', 15 * 1024 * 1024).ok).toBe(true)
    expect(conferirArquivo('application/pdf', 100).ok).toBe(false)
    expect(conferirArquivo('image/png', 1000, jpg).ok).toBe(false)
  })

  it('o endereço assinado: confere, e não abre trocado, vencido ou com prazo longo demais', () => {
    const k = Buffer.alloc(32, 3)
    const exp = agora.getTime() + 3_600_000
    const assinatura = assinarMidia('org-a', 'm1', exp, k)!
    const ok = { orgId: 'org-a', midiaId: 'm1', exp, assinatura }
    expect(conferirAssinatura(ok, agora, k)).toBe(true)
    expect(conferirAssinatura({ ...ok, orgId: 'org-b' }, agora, k)).toBe(false)
    expect(conferirAssinatura({ ...ok, midiaId: 'm2' }, agora, k)).toBe(false)
    expect(conferirAssinatura({ ...ok, exp: exp + 1 }, agora, k)).toBe(false)
    expect(conferirAssinatura(ok, new Date(exp + 1), k)).toBe(false)
    const longe = agora.getTime() + 30 * DIA
    expect(conferirAssinatura({ ...ok, exp: longe, assinatura: assinarMidia('org-a', 'm1', longe, k)! }, agora, k)).toBe(false)
    expect(conferirAssinatura(ok, agora, null)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// O MOTOR
// ─────────────────────────────────────────────────────────────

function motor(opcoes: { envio?: () => Envio; agora?: Date } = {}) {
  let relogio = opcoes.agora ?? agora
  const saiu: string[] = []
  const diario: { nodeId: string; saida?: string | null }[] = []
  const salvos: EstadoExecucao[] = []
  let dormiu = 0
  const deps: Deps = {
    agora: () => relogio,
    dormir: async (ms) => {
      dormiu += ms
    },
    enviarTexto: async (t) => {
      const r = opcoes.envio?.() ?? 'ok'
      if (r === 'ok') saiu.push(t)
      return r
    },
    enviarMidia: async (d, legenda) => {
      saiu.push(`[${d.tipo}] ${legenda}`)
      return 'ok'
    },
    passarParaPessoa: async () => 1,
    horario: null,
    registrar: async (p) => void diario.push(p),
    salvar: async (e) => {
      salvos.push(structuredClone(e))
      return true
    },
  }
  return {
    deps,
    saiu,
    diario,
    salvos,
    dormiu: () => dormiu,
    avancar: (ms: number) => {
      relogio = new Date(relogio.getTime() + ms)
    },
  }
}

const estado = (nodeId = 'inicio'): EstadoExecucao => ({
  id: 'x1',
  campanhaId: 'c1',
  nodeId,
  status: 'rodando',
  proximoEm: null,
  vars: { nome: 'Maria Souza' },
  teste: false,
  semente: '7199990001',
  motivoFim: null,
})

const roteiro: Grafo = lerGrafo({
  nodes: [
    no('inicio', 'inicio'),
    no('m1', 'mensagem', { textos: ['Oi, {primeiro_nome}! Quer o catálogo? Responda sim ou não.'], digitandoSeg: 2 }),
    no('w', 'aguardar_resposta', { quantidade: 2, unidade: 'h' }),
    no('c', 'condicao', { regras: [{ id: 'sim', rotulo: 'Sim', palavras: ['sim'] }] }),
    no('foto', 'midia', { midiaId: 'md1', tipo: 'imagem', legenda: 'Aqui, {primeiro_nome}', comoGravado: false }),
    no('pausa', 'intervalo', { quantidade: 1, unidade: 'd', soHorarioLoja: false, aoResponder: 'esperar' }),
    no('fim', 'fim', { texto: 'Obrigada!' }),
    no('tchau', 'fim', { texto: 'Tudo bem, até mais.' }),
    no('lembrete', 'mensagem', { textos: ['Ainda quer o catálogo?'], digitandoSeg: 0 }),
  ],
  edges: [
    liga('inicio', 'm1'),
    liga('m1', 'w'),
    liga('w', 'c', 'respondeu'),
    liga('w', 'lembrete', 'sem_resposta'),
    liga('c', 'foto', 'sim'),
    liga('c', 'tchau', 'outro'),
    liga('foto', 'pausa'),
    liga('pausa', 'fim'),
  ],
})

describe('o motor anda pelo roteiro', () => {
  it('manda, para na espera por resposta, e segue pelo caminho da resposta', async () => {
    const t = motor()
    let r = await rodar(roteiro, estado(), { tipo: 'iniciar' }, t.deps)
    expect(t.saiu).toEqual(['Oi, Maria! Quer o catálogo? Responda sim ou não.'])
    expect(t.dormiu()).toBe(2000) // "digitando" curto roda na hora
    expect(r.estado.status).toBe('aguardando_resposta')
    expect(r.estado.nodeId).toBe('w')
    expect(r.estado.proximoEm?.toISOString()).toBe(new Date(agora.getTime() + 2 * 3_600_000).toISOString())

    r = await rodar(roteiro, r.estado, { tipo: 'resposta', texto: 'Sim!' }, t.deps)
    expect(r.estado.vars.resposta).toBe('Sim!')
    expect(t.saiu.at(-1)).toBe('[imagem] Aqui, Maria')
    // A espera de um dia vira despertador, não sono.
    expect(r.estado.status).toBe('esperando')
    expect(r.estado.nodeId).toBe('pausa')
    expect(r.estado.proximoEm?.getTime()).toBe(agora.getTime() + DIA)
  })

  it('acordar antes da hora não faz nada; depois da hora, segue até o fim', async () => {
    const t = motor()
    let r = await rodar(roteiro, estado(), { tipo: 'iniciar' }, t.deps)
    r = await rodar(roteiro, r.estado, { tipo: 'resposta', texto: 'sim' }, t.deps)
    const antes = t.saiu.length
    t.avancar(DIA - 60_000)
    const cedo = await rodar(roteiro, r.estado, { tipo: 'acordar' }, t.deps)
    expect(cedo.andou).toBe(false)
    expect(t.saiu.length).toBe(antes)
    t.avancar(60_000)
    r = await rodar(roteiro, r.estado, { tipo: 'acordar' }, t.deps)
    expect(t.saiu.at(-1)).toBe('Obrigada!')
    expect(r.estado.status).toBe('concluida')
    expect(r.estado.motivoFim).toBe('fim')
  })

  it('resposta durante uma espera "continua esperando" não mexe em nada', async () => {
    const t = motor()
    let r = await rodar(roteiro, estado(), { tipo: 'iniciar' }, t.deps)
    r = await rodar(roteiro, r.estado, { tipo: 'resposta', texto: 'sim' }, t.deps)
    const outra = await rodar(roteiro, r.estado, { tipo: 'resposta', texto: 'e o preço?' }, t.deps)
    expect(outra.andou).toBe(false)
    expect(outra.estado.status).toBe('esperando')
  })

  it('espera com "segue quando responder": a resposta acorda na hora', async () => {
    const gr = lerGrafo({
      nodes: [no('inicio', 'inicio'), no('p', 'intervalo', { quantidade: 3, unidade: 'd', aoResponder: 'continuar' }), no('f', 'fim', { texto: 'Voltei!' })],
      edges: [liga('inicio', 'p'), liga('p', 'f')],
    })
    const t = motor()
    let r = await rodar(gr, estado(), { tipo: 'iniciar' }, t.deps)
    expect(r.estado.status).toBe('esperando')
    r = await rodar(gr, r.estado, { tipo: 'resposta', texto: 'oi?' }, t.deps)
    expect(t.saiu).toEqual(['Voltei!'])
    expect(r.estado.status).toBe('concluida')
  })

  it('sem resposta no prazo, sai por "não respondeu"; o roteiro acaba onde não há ligação', async () => {
    const t = motor()
    let r = await rodar(roteiro, estado(), { tipo: 'iniciar' }, t.deps)
    t.avancar(2 * 3_600_000)
    r = await rodar(roteiro, r.estado, { tipo: 'acordar' }, t.deps)
    expect(t.saiu.at(-1)).toBe('Ainda quer o catálogo?')
    expect(r.estado.status).toBe('concluida')
    expect(t.diario.some((d) => d.nodeId === 'w' && d.saida === 'sem_resposta')).toBe(true)
  })

  it('"digitando" longo vira despertador e, ao acordar, sai sem esperar de novo', async () => {
    const gr = lerGrafo({
      nodes: [no('inicio', 'inicio'), no('m', 'mensagem', { textos: ['devagar'], digitandoSeg: 10 })],
      edges: [liga('inicio', 'm')],
    })
    const t = motor()
    let r = await rodar(gr, estado(), { tipo: 'iniciar' }, t.deps)
    expect(t.saiu).toEqual([])
    expect(t.dormiu()).toBe(0)
    expect(r.estado.status).toBe('esperando')
    expect(r.estado.proximoEm?.getTime()).toBe(agora.getTime() + 10_000)
    t.avancar(10_000)
    r = await rodar(gr, r.estado, { tipo: 'acordar' }, t.deps)
    expect(t.saiu).toEqual(['devagar'])
    expect(t.dormiu()).toBe(0)
    expect(r.estado.status).toBe('concluida')
  })

  it('o freio de passos: laço sem espera para em MAX_PASSOS, com erro', async () => {
    const gr: Grafo = {
      nodes: [
        { id: 'inicio', tipo: 'inicio', x: 0, y: 0, dados: {} },
        { id: 'a', tipo: 'distribuidor', x: 0, y: 0, dados: { ramos: [{ id: 'r', rotulo: '', peso: 1 }] } },
        { id: 'b', tipo: 'distribuidor', x: 0, y: 0, dados: { ramos: [{ id: 'r', rotulo: '', peso: 1 }] } },
      ],
      edges: [liga('inicio', 'a'), liga('a', 'b', 'r'), liga('b', 'a', 'r')],
    }
    const t = motor()
    const r = await rodar(gr, estado(), { tipo: 'iniciar' }, t.deps)
    expect(r.passos).toBe(MAX_PASSOS)
    expect(r.estado.status).toBe('erro')
    expect(r.estado.motivoFim).toBe('passos')
  })

  it('teto de mensagens: a execução para com "limite"', async () => {
    const t = motor({ envio: () => 'limite' })
    const r = await rodar(roteiro, estado(), { tipo: 'iniciar' }, t.deps)
    expect(r.estado.status).toBe('erro')
    expect(r.estado.motivoFim).toBe('limite')
  })

  it('canal caiu: tenta de novo em dois minutos, no mesmo bloco; na terceira falha, desiste', async () => {
    const t = motor({ envio: () => 'falha' })
    let r = await rodar(roteiro, estado(), { tipo: 'iniciar' }, t.deps)
    expect(r.estado.status).toBe('esperando')
    expect(r.estado.nodeId).toBe('m1')
    t.avancar(120_000)
    r = await rodar(roteiro, r.estado, { tipo: 'acordar' }, t.deps)
    expect(r.estado.status).toBe('esperando')
    t.avancar(120_000)
    r = await rodar(roteiro, r.estado, { tipo: 'acordar' }, t.deps)
    expect(r.estado.status).toBe('erro')
    expect(r.estado.motivoFim).toBe('falha_envio')
    // O "digitando" só foi esperado uma vez.
    expect(t.dormiu()).toBe(2000)
  })

  it('passar para uma pessoa encerra com "humano"; ir para outra campanha devolve o destino', async () => {
    const gr = lerGrafo({
      nodes: [no('inicio', 'inicio'), no('p', 'passar_para_pessoa', { para: 'donos', mensagemContato: 'Já chamei alguém, {primeiro_nome}.' })],
      edges: [liga('inicio', 'p')],
    })
    const t = motor()
    const r = await rodar(gr, estado(), { tipo: 'iniciar' }, t.deps)
    expect(t.saiu).toEqual(['Já chamei alguém, Maria.'])
    expect(r.estado.motivoFim).toBe('humano')

    const gk = lerGrafo({ nodes: [no('inicio', 'inicio'), no('k', 'conectar', { campanhaId: 'outra' })], edges: [liga('inicio', 'k')] })
    const rk = await rodar(gk, estado(), { tipo: 'iniciar' }, motor().deps)
    expect(rk.conectarPara).toBe('outra')
    expect(rk.estado.motivoFim).toBe('conectou')
    // Pulo demais seguido é laço entre campanhas.
    const muito = await rodar(gk, { ...estado(), vars: { _saltos: 3 } }, { tipo: 'iniciar' }, motor().deps)
    expect(muito.conectarPara).toBeUndefined()
    expect(muito.estado.status).toBe('erro')
  })

  it('bloco apagado com a pessoa dentro: termina, sem mandar nada', async () => {
    const t = motor()
    const r = await rodar(roteiro, { ...estado('sumiu'), status: 'esperando', proximoEm: agora }, { tipo: 'acordar' }, t.deps)
    expect(r.estado.motivoFim).toBe('bloco_sumiu')
    expect(t.saiu).toEqual([])
  })

  it('perdeu a trava no meio (tiraram a pessoa): para na hora', async () => {
    const t = motor()
    let gravacoes = 0
    // A primeira gravação passa (depois do Início); a segunda já encontra a trava de outro.
    t.deps.salvar = async () => ++gravacoes === 1
    const r = await rodar(roteiro, estado(), { tipo: 'iniciar' }, t.deps)
    // Mandou a mensagem que estava rodando, e parou antes da espera.
    expect(t.saiu).toHaveLength(1)
    expect(r.estado.nodeId).toBe('m1')
    expect(r.estado.status).toBe('rodando')
  })
})
