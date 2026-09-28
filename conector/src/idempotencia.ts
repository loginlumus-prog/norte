// O mesmo envio, pedido duas vezes, sai uma vez só.
//
// O Norte espera até 120 s pela resposta de um envio (a vez na fila, o
// "digitando…"). Se a resposta não chega a tempo — a rede piscou, a fila
// estava longa —, o Norte não sabe se a mensagem saiu, e a campanha tenta de
// novo dois minutos depois. Sem isto, a cliente recebia a mesma mensagem duas
// vezes. Com isto, cada pedido de envio traz uma CHAVE (a execução da
// campanha e o número da mensagem dela), e a mesma chave:
//
//   • ainda na fila ou mandando → espera o primeiro e devolve o resultado dele;
//   • já mandada                 → devolve o mesmo resultado, sem mandar;
//   • recusada com CERTEZA (não conectado, limite, sem WhatsApp) → libera a
//     chave, e a nova tentativa manda de verdade;
//   • falhou no meio do envio (o WhatsApp não confirmou) → a chave fica: pode
//     ter saído, e repetir seria em dobro.
//
// A memória é do processo, por um dia, e esquece as mais velhas: reiniciar o
// conector perde as chaves (o que está na fila também se perde, então não
// sobra envio para duplicar).
//
// PURO: o relógio entra por fora.

export class Idempotencia<T> {
  private readonly mapa = new Map<string, { em: number; resultado: Promise<T> }>()

  constructor(
    private readonly liberar: (r: T) => boolean,
    private readonly validadeMs = 24 * 3_600_000,
    private readonly maximo = 5_000,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Roda `fazer` uma vez por chave. Sem chave, roda sempre (o pedido antigo, sem chave). */
  async uma(chave: string | null | undefined, fazer: () => Promise<T>): Promise<T> {
    if (!chave) return fazer()
    this.limpar()
    const ja = this.mapa.get(chave)
    if (ja) return ja.resultado
    const resultado = fazer()
    this.mapa.set(chave, { em: this.agora(), resultado })
    // Se `fazer` estourar, a chave fica: não dá para saber se saiu.
    const r = await resultado
    if (this.liberar(r)) this.mapa.delete(chave)
    return r
  }

  get tamanho() {
    return this.mapa.size
  }

  private limpar() {
    const corte = this.agora() - this.validadeMs
    for (const [k, v] of this.mapa) {
      if (v.em >= corte && this.mapa.size <= this.maximo) break
      this.mapa.delete(k)
    }
  }
}

/** A chave que o Norte manda: curta, sem espaço, sem nada que vire caminho. */
export const CHAVE_ENVIO = /^[A-Za-z0-9_.:-]{1,128}$/
