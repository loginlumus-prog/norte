'use client'

// Metas e comissão, uma linha por pessoa.
//
// Quem gere a equipe digita a meta e a porcentagem na própria linha e salva;
// quem só vê acompanha a barra. O "herdada" avisa que aquele número veio de
// um mês anterior — dá para deixar, ou mudar.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao, Situacao, cx } from '@/ui/base'
import { salvarMetaAcao } from './acoes'

export type MetaNaTela = {
  usuarioId: string
  nome: string
  valor: number
  comissaoPct: number
  herdada: boolean
  vendido: number
  devolvido: number
  liquido: number
  comissao: number
  progresso: number | null
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function Linha({ slug, mes, m, podeGerir }: { slug: string; mes: string; m: MetaNaTela; podeGerir: boolean }) {
  const [valor, setValor] = useState(m.valor ? String(m.valor).replace('.', ',') : '')
  const [pct, setPct] = useState(m.comissaoPct ? String(m.comissaoPct).replace('.', ',') : '')
  const [recado, setRecado] = useState<{ erro?: string; ok?: string } | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const p = m.progresso
  const nivel = p === null ? 'neutro' : p >= 1 ? 'bom' : p >= 0.7 ? 'atencao' : 'critico'

  return (
    <li className="flex flex-col gap-2 border-b border-borda-suave py-3 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-tinta">{m.nome}</span>
          {m.herdada && (
            <span className="text-[11px] text-tinta-3" title="Este número veio de um mês anterior">
              meta herdada
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-3 text-sm">
          <span className="numero font-semibold text-tinta">{brl(m.liquido)}</span>
          {m.valor > 0 && <span className="numero text-tinta-3">de {brl(m.valor)}</span>}
          {p !== null && (
            <Situacao nivel={nivel}>
              {Math.round(p * 100)}%{p >= 1 ? ' · bateu' : ''}
            </Situacao>
          )}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-superficie-2">
        <div
          className={cx('h-full rounded-full', nivel === 'bom' ? 'bg-bom-vivo' : nivel === 'atencao' ? 'bg-atencao-vivo' : nivel === 'critico' ? 'bg-critico-vivo' : 'bg-tinta-3')}
          style={{ width: `${p === null ? 0 : Math.min(p, 1) * 100}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-2">
        {m.devolvido > 0 && <span>devolvido {brl(m.devolvido)}</span>}
        <span>
          comissão <b className="numero text-tinta">{brl(m.comissao)}</b>
          {m.comissaoPct > 0 && <span className="text-tinta-3"> ({m.comissaoPct.toLocaleString('pt-BR')}%)</span>}
        </span>
        {podeGerir && (
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1">
              meta
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                aria-label={`Meta de ${m.nome}`}
                className="numero w-24 rounded border border-borda bg-superficie px-1.5 py-1 text-tinta"
              />
            </label>
            <label className="flex items-center gap-1">
              comissão %
              <input
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                aria-label={`Comissão de ${m.nome}`}
                className="numero w-14 rounded border border-borda bg-superficie px-1.5 py-1 text-tinta"
              />
            </label>
            <Botao
              tom="secundario"
              carregando={indo}
              className="py-1 text-xs"
              onClick={() =>
                comecar(async () => {
                  const r = await salvarMetaAcao(slug, {
                    usuarioId: m.usuarioId,
                    mes,
                    valor: Number(valor.replace(',', '.')) || 0,
                    comissaoPct: Number(pct.replace(',', '.')) || 0,
                  })
                  setRecado(r)
                  if (r.ok) router.refresh()
                })
              }
            >
              Salvar
            </Botao>
            {recado?.erro && <span className="font-medium text-critico">{recado.erro}</span>}
            {recado?.ok && <span className="font-medium text-bom">{recado.ok}</span>}
          </span>
        )}
      </div>
    </li>
  )
}

export function Metas({ slug, mes, metas, podeGerir }: { slug: string; mes: string; metas: MetaNaTela[]; podeGerir: boolean }) {
  if (metas.length === 0) {
    return <p className="py-6 text-center text-sm text-tinta-3">Ninguém com acesso de venda ainda.</p>
  }
  return (
    <ul className="flex flex-col">
      {metas.map((m) => (
        <Linha key={m.usuarioId} slug={slug} mes={mes} m={m} podeGerir={podeGerir} />
      ))}
    </ul>
  )
}
