import Link from 'next/link'
import { brl } from '@/ui/painel'
import { plural } from '@/ui/texto'
import type { ReciboNaLista } from '@/servidor/recibos'

// A lista dos recibos de uma cliente — no Crediário (filtrado pela cliente)
// e na ficha dela. Cada linha leva ao papel, para reimprimir quando ela pedir
// ("perdi o recibo de setembro").

const quandoRecibo = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)

/** Os recibos da cliente, do mais novo, com o papel para reimprimir. */
export function ListaDeRecibos({ slug, recibos }: { slug: string; recibos: ReciboNaLista[] }) {
  return (
    <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda bg-superficie text-sm">
      {recibos.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="text-tinta">
              {r.externo ? 'Pago fora' : 'Recebido'} {brl(r.valor)}
              {r.abatido !== r.valor && <span className="text-tinta-3"> · abateu {brl(r.abatido)}</span>}
              <span className="text-tinta-3"> · {plural(r.parcelas, 'parcela', 'parcelas')}</span>
            </span>
            <span className="text-xs text-tinta-3">
              {quandoRecibo(r.criadoEm)} · {r.unidade} · {r.quem}
              {r.referencia ? ` · ${r.referencia}` : ''} · {r.saldoDepois > 0 ? `ficou devendo ${brl(r.saldoDepois)}` : 'quitou'}
            </span>
          </span>
          <Link href={`/${slug}/crediario/recibo/${r.id}`} className="text-xs font-semibold text-marca underline-offset-2 hover:underline">
            {r.codigo} · ver e imprimir
          </Link>
        </li>
      ))}
    </ul>
  )
}
