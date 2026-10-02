// Markdown pequeno, para o texto que a IA escreve (o Farol).
//
// Só o que a IA usa: títulos (#, ##, ###), listas (- e 1.), **negrito**,
// tabelas (| a | b |) e parágrafos. Vira elemento React, nunca HTML cru: o
// texto vem de um modelo, e modelo pode devolver "<script>" — aqui ele aparece
// como texto, não roda.

import type { ReactNode } from 'react'

function emLinha(texto: string, chave: string): ReactNode[] {
  // **negrito** e `código`; o resto como veio.
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return partes.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={`${chave}-${i}`}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={`${chave}-${i}`} className="rounded bg-superficie-2 px-1 font-mono text-[0.9em]">{p.slice(1, -1)}</code>
    return p
  })
}

const celulas = (linha: string) =>
  linha
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

export function Markdown({ texto, className }: { texto: string; className?: string }) {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n')
  const blocos: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < linhas.length) {
    const l = linhas[i]!
    const chave = `b${k++}`
    if (!l.trim()) {
      i++
      continue
    }
    const titulo = /^(#{1,3})\s+(.*)$/.exec(l)
    if (titulo) {
      const nivel = titulo[1]!.length
      const cls = nivel === 1 ? 'text-lg font-bold' : nivel === 2 ? 'text-base font-bold' : 'text-sm font-bold'
      blocos.push(<p key={chave} className={`${cls} mt-3 text-tinta first:mt-0`}>{emLinha(titulo[2]!, chave)}</p>)
      i++
      continue
    }
    // Tabela: linha com | seguida da linha de traços.
    if (l.includes('|') && i + 1 < linhas.length && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1]!)) {
      const cabeca = celulas(l)
      i += 2
      const corpo: string[][] = []
      while (i < linhas.length && linhas[i]!.includes('|')) corpo.push(celulas(linhas[i++]!))
      blocos.push(
        <div key={chave} className="my-2 overflow-x-auto rounded-norte border border-borda">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-superficie-2 text-left">
                {cabeca.map((c, j) => (
                  <th key={j} className="px-2 py-1.5 text-xs font-bold text-tinta-2">{emLinha(c, `${chave}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corpo.map((r, ri) => (
                <tr key={ri} className="border-t border-borda-suave align-top">
                  {r.map((c, j) => (
                    <td key={j} className="px-2 py-1.5 text-tinta">{emLinha(c, `${chave}c${ri}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    // Listas: juntam as linhas seguidas do mesmo tipo.
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const numerada = /^\s*\d+[.)]\s+/.test(l)
      const itens: string[] = []
      while (i < linhas.length && /^\s*([-*•]|\d+[.)])\s+/.test(linhas[i]!)) {
        itens.push(linhas[i]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))
        i++
      }
      const Lista = numerada ? 'ol' : 'ul'
      blocos.push(
        <Lista key={chave} className={`my-1.5 flex flex-col gap-1 pl-5 ${numerada ? 'list-decimal' : 'list-disc'}`}>
          {itens.map((t, j) => (
            <li key={j}>{emLinha(t, `${chave}${j}`)}</li>
          ))}
        </Lista>,
      )
      continue
    }
    // Parágrafo: junta as linhas até a próxima em branco ou bloco.
    const par: string[] = []
    while (i < linhas.length && linhas[i]!.trim() && !/^(#{1,3}\s|\s*([-*•]|\d+[.)])\s+)/.test(linhas[i]!) && !(linhas[i]!.includes('|') && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1] ?? ''))) {
      par.push(linhas[i]!)
      i++
    }
    blocos.push(<p key={chave} className="my-1.5">{emLinha(par.join(' '), chave)}</p>)
  }
  return <div className={`text-sm leading-relaxed text-tinta ${className ?? ''}`}>{blocos}</div>
}
