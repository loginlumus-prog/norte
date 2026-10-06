'use client'

import { useEffect, useState, type InputHTMLAttributes } from 'react'

/** "23,99" ou "23.99" → 23.99; vazio ou lixo → 0. */
export function lerValor(texto: string): number {
  const t = texto.trim()
  // Com vírgula, o ponto é de milhar ("1.250,00"); sem vírgula, é o decimal.
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 23.99 → "23,99"; 100 → "100"; 0 → "" (o campo fica vazio, não com um 0 que não sai). */
export function mostrarValor(valor: number): string {
  if (!valor) return ''
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace('.', ',')
}

/**
 * Campo de valor em reais do pagamento.
 *
 * Era `type="number"` com `value={p.valor}`: apagar dava '', o '' virava 0, e
 * o 0 voltava para o campo — o caixa não conseguia deixar o campo vazio para
 * digitar o que o cliente entregou. Aqui o texto digitado é da pessoa (vazio,
 * "0,", "12,5" ficam como estão) e só o número vai para a venda.
 */
export function CampoValor({
  valor,
  aoMudar,
  ...resto
}: { valor: number; aoMudar: (valor: number) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
>) {
  const [texto, setTexto] = useState(() => mostrarValor(valor))

  // O valor muda por fora (tocou em outra forma, dividiu): o campo acompanha.
  // Se o texto já diz esse número, fica o texto — senão "12," viraria "12".
  useEffect(() => {
    setTexto((t) => (lerValor(t) === valor ? t : mostrarValor(valor)))
  }, [valor])

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0,00"
      onFocus={(e) => e.target.select()}
      {...resto}
      value={texto}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,]/g, '')
        setTexto(t)
        aoMudar(lerValor(t))
      }}
    />
  )
}
