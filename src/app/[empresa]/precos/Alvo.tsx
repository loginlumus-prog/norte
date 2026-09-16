'use client'

// O campo de margem alvo.
//
// ── por que vive no endereço ─────────────────────────────────
// `?alvo=35` é a pergunta inteira. Quem manda o link para o sócio manda o
// alvo junto, e os dois olham a mesma lista pintada do mesmo jeito. Em estado
// escondido, cada um veria a sua e a conversa não fecharia. E o botão de
// voltar desfaz a escolha, que é o que qualquer pessoa espera dele.
//
// ── por que só no Enter e ao sair do campo ───────────────────
// Cada navegação é uma passada no catálogo inteiro, e "4" a caminho de "45"
// não é um alvo que alguém queira ver pintado. A pessoa termina de digitar,
// a tela responde uma vez.

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export function Alvo({ atual, min, max }: { atual: number; min: number; max: number }) {
  const router = useRouter()
  const caminho = usePathname()
  const busca = useSearchParams()

  const irPara = (texto: string) => {
    const n = Math.round(Number(texto))
    if (!Number.isFinite(n)) return
    // A mesma borda que o servidor aplica em `lerAlvo` — aqui só para o
    // endereço já nascer limpo; quem decide é o servidor.
    const alvo = Math.min(max, Math.max(min, n))
    if (alvo === atual) return
    const q = new URLSearchParams(busca.toString())
    q.set('alvo', String(alvo))
    router.push(`${caminho}?${q.toString()}`)
  }

  return (
    <label className="flex items-center gap-2 text-sm text-tinta-2">
      Margem alvo
      <span className="flex items-center rounded-norte border border-borda bg-superficie focus-within:border-marca/60">
        <input
          // A chave troca com o alvo: quando a página volta com outro valor,
          // o campo nasce de novo com ele, em vez de segurar o que estava.
          key={atual}
          type="number"
          name="alvo"
          min={min}
          max={max}
          step={1}
          inputMode="numeric"
          defaultValue={atual}
          aria-label="Margem alvo, em porcento"
          className="numero w-16 bg-transparent px-2 py-1.5 text-right text-sm font-semibold text-tinta outline-none"
          onBlur={(e) => irPara(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              irPara(e.currentTarget.value)
            }
          }}
        />
        <span className="pr-2 text-tinta-3">%</span>
      </span>
    </label>
  )
}
