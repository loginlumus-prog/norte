// O diário do conector: uma linha JSON por acontecimento, e nada que não
// devesse estar num log.
//
// NUNCA entra aqui: texto de mensagem, número de telefone inteiro, QR Code,
// credencial, segredo, cabeçalho de autorização. O número aparece mascarado
// (os 4 últimos), a empresa aparece pelo id (que é nosso, e não diz nada a
// quem ler o log). É o que deixa mandar o log para o suporte sem pensar duas
// vezes.

type Nivel = 'info' | 'aviso' | 'erro'

/** "5571999991234" → "(71) •••••-1234"; estrangeiro → "••••1234". */
export function mascararNumero(bruto: string | null | undefined): string | null {
  const d = (bruto ?? '').replace(/\D/g, '')
  if (d.length < 8) return null
  const br = /^55(\d{2})(\d{8,9})$/.exec(d)
  if (br) return `(${br[1]}) ${'•'.repeat(br[2]!.length - 4)}-${d.slice(-4)}`
  return `••••${d.slice(-4)}`
}

/** Para o log: só os 4 últimos, sem DDD. */
export const finalDoNumero = (bruto: string | null | undefined) => {
  const d = (bruto ?? '').replace(/\D/g, '')
  return d.length >= 4 ? `…${d.slice(-4)}` : '…'
}

/** Erro vira nome + mensagem curta. Pilha e corpo de resposta ficam fora. */
export function resumoDoErro(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 200)
  return String(e).slice(0, 200)
}

function escrever(nivel: Nivel, evento: string, dados: Record<string, unknown> = {}) {
  const linha = JSON.stringify({ em: new Date().toISOString(), nivel, evento, ...dados })
  if (nivel === 'erro') console.error(linha)
  else console.log(linha)
}

export const log = {
  info: (evento: string, dados?: Record<string, unknown>) => escrever('info', evento, dados),
  aviso: (evento: string, dados?: Record<string, unknown>) => escrever('aviso', evento, dados),
  erro: (evento: string, dados?: Record<string, unknown>) => escrever('erro', evento, dados),
}
