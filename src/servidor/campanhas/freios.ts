// Os freios contra banimento.
//
// Número de WhatsApp que manda demais, rápido demais, ou para quem não pediu,
// é denunciado — e o WhatsApp bane o número da LOJA, não a campanha. Um
// roteiro mal desenhado não pode custar o número. Três freios, conferidos a
// cada mensagem, antes de ela sair:
//
//   1. teto por CONTATO por dia (calendário de São Paulo);
//   2. teto da EMPRESA por dia, somando todo mundo;
//   3. a JANELA: só fala com quem escreveu primeiro. Quem está numa campanha
//      que ELE começou (escrevendo a frase, clicando no anúncio) está dentro;
//      fora disso, só se escreveu nas últimas 24 horas.
//
// E um ritmo: entre duas mensagens para a mesma pessoa, um intervalo mínimo.
//
// PURO. Quem conta as mensagens é o motor, no banco.

import { JANELA_HORAS, type Ajustes } from './tipos'

export type Veredito = 'ok' | 'limite_contato' | 'limite_empresa' | 'fora_da_janela'

export function podeEnviar(p: {
  ajustes: Ajustes
  enviadasHojeContato: number
  enviadasHojeEmpresa: number
  /** Teste do dono: o número é dele, e ele pediu. */
  teste: boolean
  /** A execução nasceu de uma mensagem da própria pessoa (ou de uma cadeia que nasceu assim). */
  iniciadaPeloContato: boolean
  ultimaEntradaEm: Date | null
  agora: Date
}): Veredito {
  if (!p.teste && !p.iniciadaPeloContato) {
    const dentro = p.ultimaEntradaEm && p.agora.getTime() - p.ultimaEntradaEm.getTime() < JANELA_HORAS * 3_600_000
    if (!dentro) return 'fora_da_janela'
  }
  if (p.enviadasHojeContato >= p.ajustes.porContatoDia) return 'limite_contato'
  if (p.enviadasHojeEmpresa >= p.ajustes.porEmpresaDia) return 'limite_empresa'
  return 'ok'
}

/** Quanto esperar antes da próxima mensagem para a mesma pessoa, em ms. Nunca negativo. */
export function esperaMinima(ultimoEnvioEm: Date | null, agora: Date, intervaloSeg: number): number {
  if (!ultimoEnvioEm) return 0
  const falta = ultimoEnvioEm.getTime() + intervaloSeg * 1000 - agora.getTime()
  return Math.max(0, Math.min(falta, intervaloSeg * 1000))
}

/** Os ajustes que vieram da tela, dentro de limites que não derrubam ninguém. */
export function lerAjustes(b: Partial<Record<keyof Ajustes, unknown>>, padrao: Ajustes): Ajustes {
  const n = (v: unknown, min: number, max: number, p: number) => {
    const x = Math.round(Number(v))
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : p
  }
  return {
    porContatoDia: n(b.porContatoDia, 1, 50, padrao.porContatoDia),
    porEmpresaDia: n(b.porEmpresaDia, 10, 20_000, padrao.porEmpresaDia),
    intervaloSeg: n(b.intervaloSeg, 1, 10, padrao.intervaloSeg),
  }
}
