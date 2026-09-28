// Os freios contra banimento.
//
// Número de WhatsApp que manda demais, rápido demais, ou para quem não pediu,
// é denunciado — e o WhatsApp bane o número da LOJA, não a campanha. Um
// roteiro mal desenhado não pode custar o número. Três freios, conferidos a
// cada mensagem, antes de ela sair:
//
//   1. teto por CONTATO por dia (calendário de São Paulo);
//   2. teto da EMPRESA por dia, somando todo mundo;
//   3. a JANELA: só fala com quem escreveu nas últimas 24 horas. Passou
//      disso — a espera de três dias, a campanha que ficou pausada —, a
//      mensagem já é oferta começada pela loja, e só sai para quem ACEITOU
//      ofertas. Até 27/09 a campanha que a pessoa começou contava como
//      "dentro" para sempre, e o freio nunca disparava.
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
  /**
   * Fora da janela, só com o ACEITE de ofertas (ficha SIM, fora da lista —
   * ver ../ofertas.ts): passadas 24 horas sem a pessoa escrever, a mensagem
   * já não é resposta ao pedido dela, é oferta começada pela loja.
   */
  aceitaOfertas?: boolean
}): Veredito {
  if (!p.teste && !p.iniciadaPeloContato && !p.aceitaOfertas) {
    if (!dentroDaJanela(p.ultimaEntradaEm, p.agora)) return 'fora_da_janela'
  }
  if (p.enviadasHojeContato >= p.ajustes.porContatoDia) return 'limite_contato'
  if (p.enviadasHojeEmpresa >= p.ajustes.porEmpresaDia) return 'limite_empresa'
  return 'ok'
}

/** A pessoa escreveu nas últimas 24 horas? */
export function dentroDaJanela(ultimaEntradaEm: Date | null, agora: Date): boolean {
  return !!ultimaEntradaEm && agora.getTime() - ultimaEntradaEm.getTime() < JANELA_HORAS * 3_600_000
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
