// O que aparece NO INSTANTE do clique, enquanto a tela seguinte é montada no
// servidor.
//
// Sem isto, clicar em "Estoque" não fazia nada visível por um a dois
// segundos (a tela consulta saldo, histórico e previsão antes de responder):
// a pessoa clicava de novo, e de novo. Com isto, a moldura do sistema troca
// na hora e o miolo pulsa até os números chegarem.
//
// Tem a forma da Estrutura (lateral, cabeçalho, miolo) para a troca não
// pular. Sem texto inventado e sem número de mentira: só blocos.

import { cx } from './base'

const bloco = 'rounded-norte bg-superficie-2 motion-safe:animate-pulse'

export function Esqueleto({ recolhida = false }: { recolhida?: boolean }) {
  return (
    <div className={cx('flex', recolhida ? 'h-dvh overflow-hidden' : 'min-h-dvh')} role="status" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <aside
        aria-hidden
        className={cx(
          'sticky top-0 hidden h-dvh shrink-0 flex-col gap-2 border-r border-lado-borda bg-lado md:flex',
          recolhida ? 'w-[68px] px-2 py-3' : 'w-60 p-2.5',
        )}
      >
        {Array.from({ length: recolhida ? 9 : 12 }, (_, i) => (
          <span
            key={i}
            className={cx('rounded-norte bg-lado-2 motion-safe:animate-pulse', recolhida ? 'mx-auto size-10' : 'h-8 w-full')}
          />
        ))}
      </aside>
      <div aria-hidden className="flex min-w-0 flex-1 flex-col">
        <div className="h-11 border-b border-lado-borda bg-lado md:hidden" />
        <div className="flex items-center justify-between gap-4 border-b border-borda bg-superficie px-4 py-3 md:px-6">
          <span className={cx(bloco, 'h-5 w-32')} />
          <span className={cx(bloco, 'h-7 w-40')} />
        </div>
        <div className="flex flex-1 flex-col gap-5 p-4 md:p-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className={cx(bloco, 'h-20')} />
            ))}
          </div>
          <span className={cx(bloco, 'h-64')} />
        </div>
      </div>
    </div>
  )
}
