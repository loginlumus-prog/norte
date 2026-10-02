import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ACOES } from '../src/servidor/auditoria'

// Toda ação que o código grava no livro precisa de um nome em português.
//
// Sem rótulo, a tela da auditoria mostrava a chave crua — "fabrica.pedido.
// recebeu", "catalogo.abriu" — para o dono, que não tem por que saber que
// aquilo é código. Este teste varre o código atrás de cada `acao:` e confere
// que o valor está em `ACOES`. Ação nova sem rótulo quebra aqui, e não na
// frente do cliente.
//
// O que ele entende do valor de `acao:`:
//   - texto fixo, também dentro de ternário ('a.b' : 'a.c');
//   - `MAPA[x]`, com `const MAPA = { ... }` no mesmo arquivo — lê os valores;
//   - modelo `prefixo.${x}`: exige ao menos um rótulo com aquele prefixo.

const RAIZ = join(__dirname, '..')

function arquivos(dir: string): string[] {
  const saida: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) saida.push(...arquivos(p))
    else if (/\.(ts|tsx|mts)$/.test(e.name)) saida.push(p)
  }
  return saida
}

/** O texto da expressão depois de `acao:`, até a vírgula ou o fecho do objeto. */
function expressao(fonte: string, inicio: number): string {
  let fundo = 0
  let i = inicio
  for (; i < fonte.length; i++) {
    const c = fonte[i]
    if (c === '(' || c === '[' || c === '{') fundo++
    else if (c === ')' || c === ']' || c === '}') {
      if (fundo === 0) break
      fundo--
    } else if (c === ',' && fundo === 0) break
    else if (c === '\n' && fundo === 0 && /^\n\s*[\w']+\s*:/.test(fonte.slice(i, i + 80))) break
  }
  return fonte.slice(inicio, i)
}

const CHAVE = /^[a-z_]+(?:\.[a-z_-]+)+$/
const literais = (txt: string) =>
  [...txt.matchAll(/'([^'\n]*)'/g)].map((m) => m[1] ?? '').filter((s) => CHAVE.test(s))

function acoesUsadas() {
  const fixas = new Map<string, string>()
  const prefixos = new Map<string, string>()
  const arqs = [...arquivos(join(RAIZ, 'src')), ...arquivos(join(RAIZ, 'scripts'))].filter(
    (f) => !f.endsWith(join('servidor', 'auditoria.ts')),
  )
  for (const f of arqs) {
    const fonte = readFileSync(f, 'utf8')
    const onde = relative(RAIZ, f)
    for (const m of fonte.matchAll(/(?<![\w.])acao\s*:/g)) {
      const ex = expressao(fonte, m.index! + m[0].length).trim()
      for (const a of literais(ex)) fixas.set(a, onde)
      const modelo = ex.match(/^`([a-z_.]+\.)\$\{/)
      if (modelo) prefixos.set(modelo[1]!, onde)
      const mapa = ex.match(/^([A-Z_]+)\[/)
      if (mapa) {
        const def = fonte.match(new RegExp(`const ${mapa[1]!}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`))
        if (def) for (const a of literais(def[1]!)) fixas.set(a, onde)
      }
    }
  }
  return { fixas, prefixos }
}

describe('rótulos da auditoria', () => {
  const { fixas, prefixos } = acoesUsadas()

  it('acha as ações (o varredor não está cego)', () => {
    // Algumas que existem com certeza, de jeitos diferentes de gravar.
    expect(fixas.has('venda.registrou')).toBe(true)
    expect(fixas.has('catalogo.abriu')).toBe(true) // ternário
    expect(fixas.has('agenda.desmarcou')).toBe(true) // mapa
    expect(prefixos.has('exportou.')).toBe(true) // modelo
  })

  it('toda ação gravada tem nome em português', () => {
    const sem = [...fixas].filter(([a]) => !(a in ACOES)).map(([a, onde]) => `${a}  (${onde})`)
    expect(sem).toEqual([])
  })

  it('todo prefixo montado em modelo tem rótulos', () => {
    const sem = [...prefixos.keys()].filter((p) => !Object.keys(ACOES).some((k) => k.startsWith(p)))
    expect(sem).toEqual([])
  })
})
