// As correções de 27/09 nas campanhas e no WhatsApp, sem banco:
//
//   • a régua do PARAR (uma só, para todos os caminhos), com frases de
//     verdade — as que devem tirar e as que NÃO podem tirar ninguém;
//   • a chave do telefone: fixo e celular não viram a mesma pessoa, e a
//     chave antiga continua achada;
//   • o horário da loja: trecho sem dia herda os dias do anterior; e a regra
//     da noite no "Esperar resposta" e nas novas tentativas;
//   • o motor: a chave de cada envio, o 'incerto' que não repete, a trava
//     perdida que para na hora, a lista que encerra;
//   • o freio da janela de 24 horas com aceite de ofertas;
//   • o conector: a mesma chave não sai duas vezes; e CONECTOR_URL em http
//     só em localhost, em produção.

import { describe, it, expect } from 'vitest'
import { ehPedidoDeParada, ehPedidoDeVolta, lerParada } from '../src/servidor/campanhas/casar'
import { lerGrafo } from '../src/servidor/campanhas/grafo'
import { ehParadaInequivoca, ehPedidoDeVolta as voltaDaLista } from '../src/servidor/ofertas'
import { chaveTelefone, chavesParaBuscar, mesmoTelefone } from '../src/servidor/assistente/telefone'
import { lerHorario, proximoHorarioDeFalar } from '../src/servidor/campanhas/horario'
import { podeEnviar } from '../src/servidor/campanhas/freios'
import { rodar, type Deps, type Envio, type EstadoExecucao } from '../src/servidor/campanhas/motor'
import { AJUSTES_PADRAO, type Grafo } from '../src/servidor/campanhas/tipos'
import { lerConfigConector } from '../src/servidor/assistente/conector'
import { antesDeSair } from '../src/servidor/assistente/canal'
import { Idempotencia, CHAVE_ENVIO } from '../conector/src/idempotencia'

// ─────────────────────────────────────────────────────────────
// A RÉGUA DO PARAR
// ─────────────────────────────────────────────────────────────

describe('lerParada: uma régua só, conservadora', () => {
  it('tira da lista mesmo sem campanha (certa)', () => {
    for (const t of [
      'parar',
      'PARAR',
      'quero parar',
      'Parar por favor',
      'parar, obrigada',
      'PARE DE MANDAR',
      'pare de me mandar mensagem',
      'Parem de enviar essas mensagens!',
      'para de mandar',
      'sair',
      'Sair!',
      'quero sair',
      'sair da lista',
      'me tira da lista',
      'me remove da lista por favor',
      'bom dia, quero sair da lista',
      'stop',
      'descadastrar',
      'não quero mais receber',
      'Não quero mais receber mensagens',
      'não quero mais receber não',
      'não me mande mais mensagem',
      'cancelar as mensagens',
      'pode parar de mandar',
      'eu quero parar de receber ofertas',
    ]) {
      expect(lerParada(t), t).toBe('certa')
      expect(ehParadaInequivoca(t), t).toBe(true)
      expect(ehPedidoDeParada(t), t).toBe(true)
    }
  })

  it('só dentro de uma campanha (em_campanha)', () => {
    for (const t of ['cancelar', 'CANCELAR', 'não quero', 'Nao quero!', 'não quero mais', 'para', 'Para!', 'chega']) {
      expect(lerParada(t), t).toBe('em_campanha')
      expect(ehPedidoDeParada(t), t).toBe(true)
      expect(ehParadaInequivoca(t), t).toBe(false)
    }
  })

  it('conversa de verdade NUNCA tira ninguém', () => {
    for (const t of [
      'para amanhã?',
      'Para amanhã tem?',
      'para mim serve o M',
      'não quero mais esse tamanho, tem o M?',
      'não quero o azul, quero o preto',
      'não pare',
      'nao quero parar',
      'que horas vocês vão parar?',
      'vou parar aí na loja amanhã',
      'onde posso parar o carro?',
      'quero sair mais cedo hoje',
      'cancelar o pedido',
      'quero cancelar a encomenda 123',
      'tira uma foto do vestido?',
      'oi',
      'ok',
      'sim',
      'bom dia',
      '',
      'Oi! Quero o catálogo',
      'parar ' + 'mensagens '.repeat(12),
    ]) {
      expect(lerParada(t), t).toBeNull()
    }
  })

  it('VOLTAR: curto e sem conversa', () => {
    for (const t of ['voltar', 'VOLTAR', 'Voltar!', 'quero voltar', 'quero voltar a receber', 'voltar a receber as ofertas']) {
      expect(ehPedidoDeVolta(t), t).toBe(true)
      expect(voltaDaLista(t), t).toBe(true)
    }
    for (const t of ['quero voltar ao menu', 'voltar para o início', 'volto amanhã na loja', 'vou voltar lá']) {
      expect(ehPedidoDeVolta(t), t).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────
// A CHAVE DO TELEFONE
// ─────────────────────────────────────────────────────────────

describe('chave do telefone: o nono dígito só dobra em celular', () => {
  it('fixo (11) 3333-4444 e celular (11) 9 3333-4444 são pessoas diferentes', () => {
    expect(chaveTelefone('(11) 3333-4444')).toBe('1133334444')
    expect(chaveTelefone('(11) 93333-4444')).toBe('11933334444')
    expect(chaveTelefone('5511933334444')).toBe('11933334444')
    expect(mesmoTelefone('(11) 3333-4444', '5511933334444')).toBe(false)
    expect(mesmoTelefone('551133334444', '(11) 93333-4444')).toBe(false)
  })

  it('o celular antigo (9 + 6 a 9) continua com e sem o nove', () => {
    expect(mesmoTelefone('5571999990001', '557199990001')).toBe(true)
    expect(mesmoTelefone('(71) 98888-1111', '557188881111')).toBe(true)
    expect(mesmoTelefone('(11) 96000-0001', '(11) 6000-0001')).toBe(true)
    expect(chaveTelefone('5571999990001')).toBe('7199990001')
  })

  it('a chave é estável: recalcular a chave dá a própria chave', () => {
    for (const k of ['1133334444', '11933334444', '7199990001', '7188881111']) expect(chaveTelefone(k)).toBe(k)
  })

  it('para procurar no que já estava guardado: a chave nova e a antiga', () => {
    expect(chavesParaBuscar('11933334444')).toEqual(['11933334444', '1133334444'])
    expect(chavesParaBuscar('7199990001')).toEqual(['7199990001'])
    expect(chavesParaBuscar('1133334444')).toEqual(['1133334444'])
  })
})

// ─────────────────────────────────────────────────────────────
// O HORÁRIO E A NOITE
// ─────────────────────────────────────────────────────────────

describe('o horário da loja', () => {
  it('trecho sem dia herda os dias do anterior (e não vale para sábado e domingo)', () => {
    const h = lerHorario('Seg a sex 9h-12h e 14h-18h')!
    for (const d of [1, 2, 3, 4, 5]) expect(h[d], `dia ${d}`).toEqual([[540, 720], [840, 1080]])
    expect(h[0]).toBeUndefined()
    expect(h[6]).toBeUndefined()
  })

  it('o trecho seguinte com dia próprio continua valendo; sem dia nenhum, todos', () => {
    const h = lerHorario('Seg a sex 9h-12h e 14h-18h, sáb 9h-13h')!
    expect(h[6]).toEqual([[540, 780]])
    expect(h[5]).toEqual([[540, 720], [840, 1080]])
    expect(lerHorario('9h às 18h')![0]).toEqual([[540, 1080]])
  })

  it('a noite: sem horário da loja, só das 8h às 21h de São Paulo', () => {
    const meiaNoite = new Date('2026-09-26T03:00:00Z') // 00h em SP
    expect(proximoHorarioDeFalar(meiaNoite, null).toISOString()).toBe('2026-09-26T11:00:00.000Z') // 8h SP
    const tarde = new Date('2026-09-25T18:00:00Z') // 15h SP
    expect(proximoHorarioDeFalar(tarde, null)).toEqual(tarde)
    const h = lerHorario('Seg a sex 9h-18h')!
    // sexta 22h SP → segunda 9h SP
    expect(proximoHorarioDeFalar(new Date('2026-09-26T01:00:00Z'), h).toISOString()).toBe('2026-09-28T12:00:00.000Z')
  })
})

// ─────────────────────────────────────────────────────────────
// O FREIO DA JANELA
// ─────────────────────────────────────────────────────────────

describe('a janela de 24 horas, com aceite', () => {
  const agora = new Date('2026-09-25T15:00:00Z')
  const base = {
    ajustes: { ...AJUSTES_PADRAO },
    enviadasHojeContato: 0,
    enviadasHojeEmpresa: 0,
    teste: false,
    iniciadaPeloContato: false,
    agora,
  }
  it('passou de 24 h: só com aceite; dentro, sempre; teste, sempre', () => {
    const velha = new Date(agora.getTime() - 3 * 86_400_000)
    expect(podeEnviar({ ...base, ultimaEntradaEm: velha })).toBe('fora_da_janela')
    expect(podeEnviar({ ...base, ultimaEntradaEm: velha, aceitaOfertas: false })).toBe('fora_da_janela')
    expect(podeEnviar({ ...base, ultimaEntradaEm: velha, aceitaOfertas: true })).toBe('ok')
    expect(podeEnviar({ ...base, ultimaEntradaEm: new Date(agora.getTime() - 3_600_000) })).toBe('ok')
    expect(podeEnviar({ ...base, teste: true, ultimaEntradaEm: null })).toBe('ok')
  })
})

// ─────────────────────────────────────────────────────────────
// O MOTOR
// ─────────────────────────────────────────────────────────────

const no = (id: string, tipo: string, dados: object = {}) => ({ id, tipo, x: 0, y: 0, dados })
const liga = (de: string, para: string, saida = 'saida') => ({ id: `${de}-${saida}-${para}`, de, saida, para })

const DUAS: Grafo = lerGrafo({
  nodes: [
    no('inicio', 'inicio'),
    no('m1', 'mensagem', { textos: ['primeira'], digitandoSeg: 0 }),
    no('m2', 'mensagem', { textos: ['segunda'], digitandoSeg: 0 }),
  ],
  edges: [liga('inicio', 'm1'), liga('m1', 'm2')],
})

const PERGUNTA: Grafo = lerGrafo({
  nodes: [
    no('inicio', 'inicio'),
    no('m1', 'mensagem', { textos: ['Quer o catálogo?'], digitandoSeg: 0 }),
    no('w', 'aguardar_resposta', { quantidade: 2, unidade: 'h' }),
    no('lembrete', 'mensagem', { textos: ['Ainda está aí?'], digitandoSeg: 0 }),
  ],
  edges: [liga('inicio', 'm1'), liga('m1', 'w'), liga('w', 'lembrete', 'sem_resposta')],
})

const estado = (): EstadoExecucao => ({
  id: 'x1',
  campanhaId: 'c1',
  nodeId: 'inicio',
  status: 'rodando',
  proximoEm: null,
  vars: { nome: 'Maria' },
  teste: false,
  semente: '7199990001',
  motivoFim: null,
})

function motor(envio: (texto: string, chave?: string) => Envio, inicio = new Date('2026-09-25T15:00:00Z')) {
  let relogio = inicio
  const saiu: { texto: string; chave?: string }[] = []
  const diario: { nodeId: string; saida?: string | null }[] = []
  let salvos = 0
  const deps: Deps = {
    agora: () => relogio,
    dormir: async () => {},
    enviarTexto: async (t, _m, chave) => {
      const r = envio(t, chave)
      if (r === 'ok' || r === 'incerto') saiu.push({ texto: t, chave })
      return r
    },
    enviarMidia: async () => 'ok',
    passarParaPessoa: async () => 0,
    horario: null,
    registrar: async (p) => void diario.push({ nodeId: p.nodeId, saida: p.saida }),
    salvar: async () => {
      salvos++
      return true
    },
  }
  return { deps, saiu, diario, salvos: () => salvos, avancar: (ms: number) => (relogio = new Date(relogio.getTime() + ms)), ir: (d: Date) => (relogio = d) }
}

describe('o motor e os envios', () => {
  it('cada mensagem tem a sua chave; a nova tentativa usa a MESMA', async () => {
    let falhar = true
    const chaves: (string | undefined)[] = []
    const t = motor((_t, chave) => {
      chaves.push(chave)
      if (falhar) {
        falhar = false
        return 'falha'
      }
      return 'ok'
    })
    let r = await rodar(DUAS, estado(), { tipo: 'iniciar' }, t.deps)
    expect(r.estado.status).toBe('esperando')
    t.avancar(120_000)
    r = await rodar(DUAS, r.estado, { tipo: 'acordar' }, t.deps)
    expect(r.estado.status).toBe('concluida')
    // falhou com x1.0, repetiu com x1.0, a segunda mensagem é x1.1
    expect(chaves).toEqual(['x1.0', 'x1.0', 'x1.1'])
    expect(t.saiu.map((s) => s.texto)).toEqual(['primeira', 'segunda'])
  })

  it('"incerto" (pode ter saído, o canal não sabe deduplicar): não repete, e o roteiro segue', async () => {
    let n = 0
    const t = motor(() => (n++ === 0 ? 'incerto' : 'ok'))
    const r = await rodar(DUAS, estado(), { tipo: 'iniciar' }, t.deps)
    expect(t.saiu.map((s) => s.texto)).toEqual(['primeira', 'segunda'])
    expect(r.estado.status).toBe('concluida')
    expect(t.diario).toContainEqual({ nodeId: 'm1', saida: 'incerto' })
  })

  it('a trava perdida antes de um envio (PARAR, "Tirar"): para na hora, sem mandar e sem gravar', async () => {
    let n = 0
    const t = motor(() => (n++ === 0 ? 'ok' : 'perdida'))
    const r = await rodar(DUAS, estado(), { tipo: 'iniciar' }, t.deps)
    expect(t.saiu.map((s) => s.texto)).toEqual(['primeira'])
    expect(r.estado.status).toBe('rodando')
    const salvosAntes = t.salvos()
    // nada gravado depois da perda: a última gravação foi a do bloco m1
    expect(salvosAntes).toBe(2)
  })

  it('o número entrou na lista no meio: a execução sai (sem_ofertas), e a segunda mensagem não vai', async () => {
    let n = 0
    const t = motor(() => (n++ === 0 ? 'ok' : 'na_lista'))
    const r = await rodar(DUAS, estado(), { tipo: 'iniciar' }, t.deps)
    expect(t.saiu.map((s) => s.texto)).toEqual(['primeira'])
    expect(r.estado).toMatchObject({ status: 'cancelada', motivoFim: 'sem_ofertas' })
  })

  it('a noite: o prazo do "Esperar resposta" que vence à meia-noite pula para as 8h', async () => {
    // 22h em São Paulo (01h UTC do dia seguinte)
    const t = motor(() => 'ok', new Date('2026-09-26T01:00:00Z'))
    let r = await rodar(PERGUNTA, estado(), { tipo: 'iniciar' }, t.deps)
    expect(r.estado.status).toBe('aguardando_resposta')
    t.avancar(2 * 3_600_000) // meia-noite em SP
    r = await rodar(PERGUNTA, r.estado, { tipo: 'acordar' }, t.deps)
    expect(r.andou).toBe(false)
    expect(t.saiu.map((s) => s.texto)).toEqual(['Quer o catálogo?'])
    expect(r.estado.status).toBe('aguardando_resposta')
    expect(r.estado.proximoEm?.toISOString()).toBe('2026-09-26T11:00:00.000Z') // 8h SP
    t.ir(new Date('2026-09-26T11:00:00Z'))
    r = await rodar(PERGUNTA, r.estado, { tipo: 'acordar' }, t.deps)
    expect(t.saiu.at(-1)?.texto).toBe('Ainda está aí?')
    expect(r.estado.status).toBe('concluida')
  })

  it('a noite vale para a nova tentativa depois de falha; a resposta da pessoa anda na hora, a qualquer hora', async () => {
    let falhar = true
    const t = motor(() => {
      if (falhar) {
        falhar = false
        return 'falha'
      }
      return 'ok'
    }, new Date('2026-09-26T00:59:00Z')) // 21h59 SP
    let r = await rodar(DUAS, estado(), { tipo: 'iniciar' }, t.deps)
    t.avancar(120_000) // 22h01: já é noite
    r = await rodar(DUAS, r.estado, { tipo: 'acordar' }, t.deps)
    expect(t.saiu).toEqual([])
    expect(r.estado.proximoEm?.toISOString()).toBe('2026-09-26T11:00:00.000Z')

    // a resposta de quem escreveu às 23h não espera a manhã
    const p = motor(() => 'ok', new Date('2026-09-26T02:00:00Z'))
    const g: Grafo = lerGrafo({
      nodes: [no('inicio', 'inicio'), no('w', 'aguardar_resposta', { quantidade: 1, unidade: 'h' }), no('m', 'mensagem', { textos: ['Anotado!'], digitandoSeg: 0 })],
      edges: [liga('inicio', 'w'), liga('w', 'm', 'respondeu')],
    })
    let q = await rodar(g, estado(), { tipo: 'iniciar' }, p.deps)
    q = await rodar(g, q.estado, { tipo: 'resposta', texto: 'sim' }, p.deps)
    expect(p.saiu.map((s) => s.texto)).toEqual(['Anotado!'])
  })
})

// ─────────────────────────────────────────────────────────────
// O CONECTOR
// ─────────────────────────────────────────────────────────────

describe('a chave de envio no conector', () => {
  type R = { ok: true; id: string } | { ok: false; status: number }
  const idem = () => new Idempotencia<R>((r) => !r.ok && r.status !== 502)

  it('a mesma chave, em voo ou já mandada, sai UMA vez', async () => {
    const i = idem()
    let mandou = 0
    let soltar: () => void = () => {}
    const fazer = () =>
      new Promise<R>((res) => {
        mandou++
        soltar = () => res({ ok: true, id: 'WA-1' })
      })
    const a = i.uma('org:x1.0', fazer)
    const b = i.uma('org:x1.0', fazer) // chegou enquanto a primeira estava na fila
    soltar()
    expect(await a).toEqual({ ok: true, id: 'WA-1' })
    expect(await b).toEqual({ ok: true, id: 'WA-1' })
    expect(await i.uma('org:x1.0', fazer)).toEqual({ ok: true, id: 'WA-1' }) // dois minutos depois
    expect(mandou).toBe(1)
    // outra chave manda
    const c = i.uma('org:x1.1', fazer)
    soltar()
    await c
    expect(mandou).toBe(2)
  })

  it('recusa certa libera a chave; falha no meio do envio (502) não', async () => {
    const i = idem()
    let n = 0
    expect(await i.uma('k1', async () => (n++, { ok: false, status: 409 }))).toMatchObject({ ok: false })
    expect(await i.uma('k1', async () => (n++, { ok: true, id: 'a' }))).toMatchObject({ ok: true })
    expect(n).toBe(2)
    expect(await i.uma('k2', async () => (n++, { ok: false, status: 502 }))).toMatchObject({ status: 502 })
    expect(await i.uma('k2', async () => (n++, { ok: true, id: 'b' }))).toMatchObject({ status: 502 })
    expect(n).toBe(3)
  })

  it('sem chave, sempre manda; a memória esquece depois de um dia', async () => {
    let agora = 0
    const i = new Idempotencia<R>(() => false, 86_400_000, 5_000, () => agora)
    let n = 0
    await i.uma(null, async () => (n++, { ok: true, id: 'a' }))
    await i.uma(undefined, async () => (n++, { ok: true, id: 'a' }))
    await i.uma('k', async () => (n++, { ok: true, id: 'a' }))
    agora = 86_400_001
    await i.uma('k', async () => (n++, { ok: true, id: 'a' }))
    expect(n).toBe(4)
    expect(CHAVE_ENVIO.test('cmg123.4')).toBe(true)
    expect(CHAVE_ENVIO.test('../x y')).toBe(false)
  })
})

describe('CONECTOR_URL', () => {
  const S = 'x'.repeat(40)
  it('em produção, http só em localhost', () => {
    expect(lerConfigConector({ NODE_ENV: 'production', CONECTOR_URL: 'http://10.0.0.5:3200', CONECTOR_SEGREDO: S })).toBeNull()
    expect(lerConfigConector({ NODE_ENV: 'production', CONECTOR_URL: 'http://conector.norte.app', CONECTOR_SEGREDO: S })).toBeNull()
    expect(lerConfigConector({ NODE_ENV: 'production', CONECTOR_URL: 'https://conector.norte.app', CONECTOR_SEGREDO: S })).not.toBeNull()
    expect(lerConfigConector({ NODE_ENV: 'production', CONECTOR_URL: 'http://localhost:3200', CONECTOR_SEGREDO: S })).not.toBeNull()
    expect(lerConfigConector({ NODE_ENV: 'production', CONECTOR_URL: 'http://127.0.0.1:3200', CONECTOR_SEGREDO: S })).not.toBeNull()
  })
  it('fora de produção (o laptop, os testes), http vale', () => {
    expect(lerConfigConector({ NODE_ENV: 'development', CONECTOR_URL: 'http://conector.interno:3200', CONECTOR_SEGREDO: S })).not.toBeNull()
  })
})

describe('o Z-API que não respondeu', () => {
  it('conexão recusada é falha certa (pode repetir); o resto é incerto', () => {
    expect(antesDeSair(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toBe(true)
    expect(antesDeSair(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toBe(true)
    expect(antesDeSair(new DOMException('timeout', 'TimeoutError'))).toBe(false)
    expect(antesDeSair(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe(false)
  })
})
