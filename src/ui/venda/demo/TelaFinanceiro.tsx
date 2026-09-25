'use client'

// O Financeiro: as contas a pagar dos próximos 15 dias, com o "Paguei" de
// verdade — a conta sai da lista, os números de cima e o "Precisa de você"
// do painel acompanham. No avançado, o resultado do mês passado ao lado,
// no formato do demonstrativo. Rótulos da tela de verdade
// (`app/[empresa]/financeiro/page.tsx`).

import { Pilula, Rotulo, reais } from '../Pecas'
import { Cartao, Topo } from './pecas'
import { CONTAS, DRE, MES_PASSADO, dia } from './dados'
import { contasEmAberto, type Acao, type Estado } from './estado'

const venceEm = (n: number) => {
  const d = dia(n)
  return `${String(d.dia).padStart(2, '0')}/${String(d.mes + 1).padStart(2, '0')}`
}

function quando(n: number): { tom: 'critico' | 'atencao' | 'neutro'; texto: string } {
  if (n < 0) return { tom: 'critico', texto: `há ${-n} ${n === -1 ? 'dia' : 'dias'}` }
  if (n === 0) return { tom: 'atencao', texto: 'hoje' }
  return { tom: 'neutro', texto: `em ${n} ${n === 1 ? 'dia' : 'dias'}` }
}

export function TelaFinanceiro({ estado, fazer }: { estado: Estado; fazer: (a: Acao) => void }) {
  const abertas = contasEmAberto(estado)
  const quinze = abertas.filter((c) => c.vence <= 15).sort((a, b) => a.vence - b.vence)
  const vencidas = abertas.filter((c) => c.vence < 0)
  const hoje = abertas.filter((c) => c.vence === 0)
  const proximos = abertas.filter((c) => c.vence > 0 && c.vence <= 15)
  const soma = (xs: { valor: number }[]) => xs.reduce((s, c) => s + c.valor, 0)
  const pagas = [...CONTAS, ...estado.contasNovas].filter((c) => estado.pagas.includes(c.id))
  const depois = abertas.filter((c) => c.vence > 15)
  const avancado = estado.modo === 'avancado'

  return (
    <div className="flex flex-col gap-3.5">
      <Topo titulo="Financeiro" sub="Contas a pagar" />

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            [vencidas, 'vencidas', 'text-critico'],
            [hoje, 'vencem hoje', 'text-atencao'],
            [proximos, 'próximos 15 dias', 'text-tinta'],
          ] as const
        ).map(([xs, t, cor]) => (
          <Cartao key={t} className="!p-2.5">
            <p key={xs.length} className={'pousa numero font-display text-xl font-bold ' + cor}>{xs.length}</p>
            <p className="text-[11px] text-tinta-3">{t}</p>
            <p className="numero text-[11px] font-semibold text-tinta-2">{reais(soma(xs))}</p>
          </Cartao>
        ))}
      </div>

      {vencidas.length > 0 && (
        <p className="pulsa pulsa-critico rounded-lg border border-critico-borda bg-critico-fundo px-3 py-2 text-[12px] font-semibold text-critico">
          {vencidas.length} {vencidas.length === 1 ? 'conta vencida' : 'contas vencidas'}, somando{' '}
          {reais(soma(vencidas))}. Juro e multa correm enquanto ficam aqui.
        </p>
      )}

      <div className={'grid grid-cols-1 gap-3 ' + (avancado ? 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : '')}>
        <Cartao>
          <div className="flex items-baseline justify-between gap-2">
            <Rotulo>A vencer</Rotulo>
            <span className="numero text-[11px] text-tinta-3">{reais(soma(quinze))} em 15 dias</span>
          </div>
          {quinze.length === 0 ? (
            <p className="pousa py-8 text-center text-[12.5px] text-tinta-2">Nada vencendo nos próximos 15 dias.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col">
              {quinze.map((c) => {
                const q = quando(c.vence)
                return (
                  <li key={c.id} className="pousa flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-borda-suave py-2 first:border-t-0">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[12.5px] font-semibold text-tinta">{c.descricao}</span>
                      <span className="text-[10.5px] text-tinta-3">
                        vence {venceEm(c.vence)} · {c.categoria}
                      </span>
                    </span>
                    <Pilula tom={q.tom}>{q.texto}</Pilula>
                    <span className="numero w-[5.5rem] text-right text-[12.5px] font-semibold text-tinta">{reais(c.valor)}</span>
                    <button
                      type="button"
                      onClick={() => fazer({ tipo: 'pagar', id: c.id })}
                      className="rounded-md bg-bom-vivo px-2.5 py-1 text-[11.5px] font-bold text-white transition-[filter] hover:brightness-110"
                    >
                      Paguei<span className="sr-only"> {c.descricao}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {depois.length > 0 && (
            <p className="mt-1 border-t border-borda-suave pt-2 text-[11px] text-tinta-3">
              Depois de 15 dias: {depois.map((c) => `${c.descricao} (${venceEm(c.vence)})`).join(', ')}.
            </p>
          )}
          {pagas.length > 0 && (
            <div className="mt-2 rounded-lg bg-bom-fundo px-3 py-2 text-[11.5px] text-bom">
              <b>Pagas agora:</b> {pagas.map((c) => c.descricao).join(', ')} · {reais(soma(pagas))}
            </div>
          )}
        </Cartao>

        {avancado && (
          <Cartao className="tela-entra">
            <Rotulo>Resultado de {MES_PASSADO}</Rotulo>
            <ul className="mt-2 flex flex-col">
              {DRE.map((l) => (
                <li
                  key={l.rotulo}
                  className={
                    'flex items-baseline justify-between py-1.5 text-[12px] ' +
                    (l.tipo === 'total'
                      ? 'mt-1 border-t-2 border-tinta/15 pt-2 font-bold'
                      : 'border-t border-borda-suave first:border-t-0')
                  }
                >
                  <span className={l.tipo === 'tira' ? 'pl-2 text-tinta-2' : 'text-tinta'}>
                    {l.tipo === 'tira' ? '(−) ' : ''}
                    {l.rotulo}
                  </span>
                  <span
                    className={
                      'numero ' +
                      (l.tipo === 'total' ? 'font-display text-base text-bom' : l.tipo === 'tira' ? 'text-tinta-2' : 'font-semibold text-tinta')
                    }
                  >
                    {reais(Math.abs(l.valor), 0)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-snug text-tinta-3">
              Sobrou 18,9% do que vendeu. A taxa da maquininha e o custo de cada peça saem venda a venda.
            </p>
          </Cartao>
        )}
      </div>
    </div>
  )
}
