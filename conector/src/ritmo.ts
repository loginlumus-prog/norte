// O ritmo de envio: o que faz o número da loja parecer uma pessoa, e não um robô.
//
// O WhatsApp não publica a regra de bloqueio, mas o que derruba número é
// conhecido: rajada (dezenas de mensagens no mesmo segundo), volume diário
// fora do normal para o número, e mensagem para quem não pediu. A terceira é
// decisão do Norte (o assistente só responde a quem chamou, e as campanhas só
// seguem conversas que o cliente começou). As duas primeiras são daqui:
//
//   • entre dois envios do MESMO número, um intervalo sorteado (3 a 8 s por
//     padrão) — nunca dois envios colados;
//   • teto por minuto e teto por dia, por número conectado;
//   • teto por minuto para o MESMO contato — um laço de conversa com defeito
//     não vira metralhadora na mão de um cliente;
//   • fila por número, um envio de cada vez. Não existe envio em massa: a API
//     só aceita UM destino por pedido, e cada pedido entra na fila.
//
// PURO: relógio e sorteio entram por fora. É o que deixa o teste andar o
// tempo sem esperar de verdade.

export type ConfigRitmo = {
  /** Intervalo mínimo e máximo entre dois envios do mesmo número, em ms. */
  intervaloMinMs: number
  intervaloMaxMs: number
  /** Teto de envios por minuto, por número conectado. */
  porMinuto: number
  /** Teto de envios em 24 horas, por número conectado. */
  porDia: number
  /** Teto de envios por minuto para o MESMO contato. */
  porContatoMinuto: number
}

export const RITMO_PADRAO: ConfigRitmo = {
  intervaloMinMs: 3_000,
  intervaloMaxMs: 8_000,
  porMinuto: 12,
  porDia: 500,
  porContatoMinuto: 6,
}

const MINUTO = 60_000
const DIA = 24 * 60 * MINUTO

export type Vez =
  | { ok: true; esperarMs: number }
  | { ok: false; motivo: 'limite_diario' }

/**
 * A agenda de UM número conectado. Guarda só carimbos — nada do conteúdo,
 * nada do destino além da chave usada para contar.
 */
export class Ritmo {
  private envios: number[] = []
  private porContato = new Map<string, number[]>()
  private proximoLivre = 0

  constructor(
    private readonly cfg: ConfigRitmo = RITMO_PADRAO,
    private readonly relogio: () => number = Date.now,
    private readonly sorteio: () => number = Math.random,
  ) {}

  /**
   * Quanto esperar antes de mandar para `destino` — ou "não, hoje não".
   * Não reserva nada: quem manda chama `registrar` depois de mandar.
   */
  vez(destino: string): Vez {
    const agora = this.relogio()
    this.limpar(agora)
    if (this.envios.length >= this.cfg.porDia) return { ok: false, motivo: 'limite_diario' }

    let esperar = Math.max(0, this.proximoLivre - agora)

    // teto por minuto do número: espera o mais velho da janela sair dela
    const noMinuto = this.envios.filter((t) => t > agora - MINUTO)
    if (noMinuto.length >= this.cfg.porMinuto) {
      const sai = noMinuto[noMinuto.length - this.cfg.porMinuto]! + MINUTO
      esperar = Math.max(esperar, sai - agora)
    }

    // teto por minuto do contato
    const doContato = (this.porContato.get(destino) ?? []).filter((t) => t > agora - MINUTO)
    if (doContato.length >= this.cfg.porContatoMinuto) {
      const sai = doContato[doContato.length - this.cfg.porContatoMinuto]! + MINUTO
      esperar = Math.max(esperar, sai - agora)
    }

    return { ok: true, esperarMs: esperar }
  }

  /** Anota um envio feito agora e sorteia o intervalo até o próximo. */
  registrar(destino: string): void {
    const agora = this.relogio()
    this.envios.push(agora)
    const lista = this.porContato.get(destino) ?? []
    lista.push(agora)
    this.porContato.set(destino, lista)
    const { intervaloMinMs: min, intervaloMaxMs: max } = this.cfg
    this.proximoLivre = agora + min + Math.round(this.sorteio() * Math.max(0, max - min))
  }

  /** Quantos envios nas últimas 24 horas. */
  noDia(): number {
    this.limpar(this.relogio())
    return this.envios.length
  }

  private limpar(agora: number) {
    this.envios = this.envios.filter((t) => t > agora - DIA)
    for (const [k, v] of this.porContato) {
      const f = v.filter((t) => t > agora - MINUTO)
      if (f.length === 0) this.porContato.delete(k)
      else this.porContato.set(k, f)
    }
  }
}

/**
 * Quanto tempo o "digitando…" aparece antes da mensagem: uma pessoa digita
 * no celular algo como 6 a 8 letras por segundo, mas ninguém espera um minuto
 * por uma resposta longa. Entre 1,5 s e 8 s, com um pouco de sorteio.
 */
export function tempoDigitando(texto: string, sorteio: () => number = Math.random): number {
  const base = 1_500 + texto.length * 45
  const variacao = 0.8 + sorteio() * 0.4
  return Math.round(Math.min(8_000, Math.max(1_500, base * variacao)))
}

/**
 * Uma fila que roda UMA tarefa por vez, na ordem de chegada, com limite de
 * tamanho. Tarefa que falha não trava a fila.
 */
export class Fila {
  private cauda: Promise<unknown> = Promise.resolve()
  private tamanho = 0

  constructor(private readonly maximo = 50) {}

  get pendentes() {
    return this.tamanho
  }

  /** Nulo quando a fila está cheia — quem chamou responde "tente depois". */
  entrar<T>(tarefa: () => Promise<T>): Promise<T> | null {
    if (this.tamanho >= this.maximo) return null
    this.tamanho++
    const vez = this.cauda.then(tarefa, tarefa)
    this.cauda = vez.then(
      () => undefined,
      () => undefined,
    )
    return vez.finally(() => {
      this.tamanho--
    })
  }
}
