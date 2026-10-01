// Qual versão do Norte este servidor está rodando — para o balcão saber que
// subiu uma nova (AvisoVersao.tsx).
//
// O balcão fica aberto o dia inteiro, e a página carregada às 8h continua
// com o código das 8h. Quando sobe uma versão nova às 14h, a tela velha
// continua "funcionando" até a primeira ação do servidor que mudou — e aí
// quebra no meio de uma venda. A tela compara a versão que veio com ela com a
// que o servidor diz agora, e avisa antes.
//
// A versão é o BUILD_ID que o `next build` escreve (muda a cada build, mesmo
// sem commit novo — e build novo é chave de ação nova); sem ele, o commit que
// a hospedagem informa. No desenvolvimento não há versão: o servidor de dev se
// recompila sozinho a cada arquivo salvo, e avisar "versão nova" a cada
// gravação seria ruído.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let lida: string | null | undefined

export function versaoDoBuild(): string | null {
  if (lida !== undefined) return lida
  if (process.env.NODE_ENV !== 'production') return (lida = null)
  try {
    lida = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || null
  } catch {
    lida = null
  }
  if (!lida) {
    const commit = (process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NORTE_COMMIT ?? '').trim()
    lida = commit ? commit.slice(0, 12) : null
  }
  return lida
}
