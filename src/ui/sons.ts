'use client'

// Os sons do sistema: curtos, baixos e feitos na hora pelo próprio navegador
// (Web Audio) — nenhum arquivo para baixar, nada para carregar.
//
//   clique   — um toque seco: escolher, trocar, marcar
//   sucesso  — duas notas subindo: salvou, deu certo
//   venda    — o "plim" da venda fechada: três notas, a última longa
//   aviso    — o sino: chegou coisa nova (encomenda, pedido da fábrica)
//   erro     — uma nota descendo, grave: não deu
//
// Ligado por padrão; a pessoa desliga no cabeçalho (ChaveDeSom). A escolha
// fica neste aparelho. O navegador só deixa tocar depois do primeiro toque na
// página — antes disso, o som simplesmente não sai (e não dá erro).

export type Som = 'clique' | 'sucesso' | 'venda' | 'aviso' | 'erro'

const CHAVE = 'norte:sons'
export const EVENTO_SOM = 'norte:sons-mudou'

export function sonsLigados(): boolean {
  try {
    return localStorage.getItem(CHAVE) !== 'desligado'
  } catch {
    return true
  }
}

export function ligarSons(ligado: boolean) {
  try {
    localStorage.setItem(CHAVE, ligado ? 'ligado' : 'desligado')
  } catch {
    // sem armazenamento: vale até recarregar
  }
  window.dispatchEvent(new Event(EVENTO_SOM))
}

let contexto: AudioContext | null = null
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    contexto ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (contexto.state === 'suspended') void contexto.resume()
    return contexto
  } catch {
    return null
  }
}

/** Uma nota: frequência, quando começa (s), quanto dura (s), volume e timbre. */
function nota(ctx: AudioContext, freq: number, inicio: number, dur: number, volume = 0.06, tipo: OscillatorType = 'sine') {
  const t = ctx.currentTime + inicio
  const osc = ctx.createOscillator()
  const ganho = ctx.createGain()
  osc.type = tipo
  osc.frequency.setValueAtTime(freq, t)
  ganho.gain.setValueAtTime(0.0001, t)
  ganho.gain.exponentialRampToValueAtTime(volume, t + 0.012)
  ganho.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(ganho).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

export function tocar(som: Som) {
  if (!sonsLigados()) return
  const ctx = audio()
  if (!ctx) return
  switch (som) {
    case 'clique':
      nota(ctx, 880, 0, 0.05, 0.025, 'triangle')
      break
    case 'sucesso':
      nota(ctx, 660, 0, 0.12, 0.05)
      nota(ctx, 990, 0.09, 0.22, 0.05)
      break
    case 'venda':
      nota(ctx, 784, 0, 0.12, 0.06)
      nota(ctx, 988, 0.08, 0.12, 0.06)
      nota(ctx, 1319, 0.16, 0.5, 0.07)
      nota(ctx, 2637, 0.16, 0.35, 0.012)
      break
    case 'aviso':
      nota(ctx, 1047, 0, 0.6, 0.05)
      nota(ctx, 1568, 0, 0.45, 0.02)
      nota(ctx, 1319, 0.18, 0.7, 0.04)
      break
    case 'erro':
      nota(ctx, 330, 0, 0.16, 0.05, 'triangle')
      nota(ctx, 220, 0.12, 0.26, 0.05, 'triangle')
      break
  }
}
