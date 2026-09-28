// O fio entre a tela de erro e o log do servidor.
//
// A tela "Deu problema aqui do nosso lado" (src/app/error.tsx) mostra
// "código <digest>". O digest é o que o Next dá ao erro quando esconde a
// mensagem do navegador — e é ESTE gancho que recebe o mesmo digest do lado
// do servidor. Sem ele, o suporte teria o código e nada para procurar: o log
// padrão do Next imprime a pilha inteira, sem formato fixo, e às vezes com o
// endereço completo (`/exemplo/clientes?q=Rosa`) — busca com nome de cliente.
//
// Uma linha JSON por erro: `{"nivel":"erro","codigo":"<digest>",...}`. No
// painel da hospedagem, procurar pelo código que a pessoa ditou acha a linha.
// O que NÃO vai: a busca do endereço, cabeçalho, cookie, corpo, e a mensagem
// crua (ver src/servidor/registro.ts).

import type { Instrumentation } from 'next'

/**
 * Avisa no log quando a máquina não está no fuso de São Paulo.
 *
 * Não derruba nada: toda conta de "hoje" e "este mês" usa `servidor/dia.ts`,
 * que não depende do fuso da máquina. O aviso existe para quem for depurar
 * saber que um `new Date(ano, mes, dia)` ou um `getHours()` esquecido em
 * algum canto vai dar o dia de Londres aqui — na Vercel, o padrão é UTC.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone
  // Janeiro e julho: o mesmo deslocamento de São Paulo (-3h, sem horário de verão).
  const comoSP = [new Date(Date.UTC(2026, 0, 15)), new Date(Date.UTC(2026, 6, 15))].every(
    (d) => d.getTimezoneOffset() === 180,
  )
  if (!comoSP) {
    console.warn(
      JSON.stringify({
        nivel: 'aviso',
        recado: 'O servidor não está no fuso de São Paulo. As contas de dia e mês usam servidor/dia.ts e não dependem disto.',
        fuso,
      }),
    )
  }
}

export const onRequestError: Instrumentation.onRequestError = async (erro, pedido, contexto) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { resumoDoErro, semBusca } = await import('./servidor/registro')
  const digest =
    typeof erro === 'object' && erro !== null && 'digest' in erro ? String((erro as { digest: unknown }).digest) : undefined
  console.error(
    JSON.stringify({
      nivel: 'erro',
      codigo: digest ?? null,
      metodo: pedido.method,
      caminho: semBusca(pedido.path),
      rota: contexto.routePath,
      tipo: contexto.routeType,
      erro: resumoDoErro(erro),
    }),
  )
}
