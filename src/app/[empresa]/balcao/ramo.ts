// O que o RAMO da loja muda no balcão — sem tela, para os testes lerem direto.
//
// O balcão é um só (ver o topo de BalcaoSimples.tsx). O ramo não muda regra
// de venda nenhuma: muda os ATALHOS. A sorveteria pesa copo de 300 g o dia
// inteiro, a padaria pesa 250 g de pão; a moça do açaí vende o copo e, na
// mesma respiração, pergunta "vai granola?". Tudo aqui é sugestão de toque —
// o campo de peso continua aceitando qualquer número, e o complemento
// continua na aba dele.
//
// Puro, sem I/O: roda no navegador e no teste (tests/nicho.test.ts).

/** Uma tecla de peso: o que ela diz e o número que põe no campo (na medida do produto). */
export type TeclaDePeso = { rotulo: string; valor: number }

// Em quilo (ou litro, ou metro). Os valores são os tamanhos de venda de cada
// balcão: copo pequeno, médio, grande e o quilo cheio na sorveteria; o
// pãozinho de 100 g, o quarto de quilo, o meio e o quilo na padaria.
const EM_QUILO: Record<string, number[]> = {
  sorveteria: [0.2, 0.3, 0.5, 1],
  padaria: [0.1, 0.25, 0.5, 1],
}
const QUILO_PADRAO = [0.1, 0.25, 0.5, 1]
const LITRO = [0.3, 0.5, 1, 2]
const METRO = [0.5, 1, 2, 5]

const inteiro = (v: number) => Math.round(v * 1000) / 1000
const decimal = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3, useGrouping: false })

/**
 * As teclas prontas do "Quanto pesou?".
 *
 * Grama e mililitro recebem as mesmas teclas, convertidas: o produto
 * cadastrado em G quer "300" no campo, e não "0,3". Produto por unidade não
 * tem tecla — ele nem passa por aqui.
 */
export function teclasDePeso(ramo: string | null | undefined, medida: string): TeclaDePeso[] {
  const kg = (ramo && EM_QUILO[ramo]) || QUILO_PADRAO
  const falaPeso = (q: number) => (q < 1 ? `${Math.round(q * 1000)} g` : `${decimal(q)} kg`)
  const falaVolume = (q: number) => (q < 1 ? `${Math.round(q * 1000)} ml` : `${decimal(q)} l`)
  switch (medida) {
    case 'KG':
      return kg.map((q) => ({ rotulo: falaPeso(q), valor: q }))
    case 'G':
      return kg.map((q) => ({ rotulo: falaPeso(q), valor: Math.round(q * 1000) }))
    case 'L':
      return LITRO.map((q) => ({ rotulo: falaVolume(q), valor: q }))
    case 'ML':
      return LITRO.map((q) => ({ rotulo: falaVolume(q), valor: Math.round(q * 1000) }))
    case 'M':
      return METRO.map((q) => ({ rotulo: `${decimal(q)} m`, valor: q }))
    default:
      return []
  }
}

/** O peso lido (sempre em kg) escrito no campo, na medida do produto e com vírgula. */
export function pesoNoCampo(kg: number, medida: string): string {
  if (medida === 'G') return String(Math.round(kg * 1000))
  return decimal(inteiro(kg))
}

/** Um número qualquer (da tecla pronta) escrito no campo, com vírgula. */
export const numeroNoCampo = (v: number) => decimal(inteiro(v))

/**
 * O teclado grande do toque: o que uma tecla faz com o que já está escrito.
 *
 * Uma vírgula só, três casas no máximo (o grama do quilo), e zero à esquerda
 * some ("05" vira "5") — mas "0," continua, que é como se começa 0,350.
 */
export function digitarNoPeso(atual: string, tecla: string): string {
  if (tecla === 'apagar') return atual.slice(0, -1)
  if (tecla === ',') {
    if (atual.includes(',')) return atual
    return (atual === '' ? '0' : atual) + ','
  }
  if (!/^\d$/.test(tecla)) return atual
  const [, casas] = atual.split(',')
  if (casas !== undefined && casas.length >= 3) return atual
  if (atual.replace(',', '').length >= 7) return atual
  return (atual + tecla).replace(/^0+(?=\d)/, '')
}

// ─────────────────────────────────────────────────────────────
// A BALANÇA
// ─────────────────────────────────────────────────────────────

export type Leitura = { kg: number } | { instavel: true } | null

/** Acima disso não é pesagem de balcão: é quadro corrompido. */
const MAXIMO_KG = 600

/**
 * O peso ESTÁVEL no que a balança mandou pela porta serial.
 *
 * Dois formatos cobrem a maior parte das balanças de balcão ligadas por cabo
 * serial (ou adaptador USB-serial):
 *
 *   1. Toledo (protocolo P03) e Filizola: o computador manda ENQ (0x05) e a
 *      balança responde STX + cinco dígitos em GRAMAS + ETX — "00350" é
 *      0,350 kg. Com o prato mexendo, ela responde "IIIII" (instável); "NNNNN"
 *      é peso negativo e "SSSSS", sobrecarga. Algumas mandam o número já com
 *      ponto ("0.350"), e isso também vale.
 *   2. As que mandam linha de texto sem pedir, o formato "ST,GS,+  0.350kg":
 *      ST = estável, US = instável, OL = fora da escala; GS/NT = bruto/líquido.
 *
 * Vale a ÚLTIMA leitura do texto: se ela é instável, a resposta é instável,
 * mesmo que antes tenha passado um peso estável — o prato mudou depois.
 * Qualquer outra coisa (lixo, quadro pela metade, peso absurdo) é nulo: a tela
 * pede para digitar, e a venda segue.
 */
export function lerPeso(texto: string): Leitura {
  type Evento = { em: number; leitura: { kg: number } | { instavel: true } }
  const eventos: Evento[] = []

  const quadro = /\x02([^\x02\x03]*)\x03/g
  for (let m = quadro.exec(texto); m; m = quadro.exec(texto)) {
    const c = (m[1] ?? '').trim()
    if (/^[INS]{5,6}$/i.test(c)) {
      eventos.push({ em: m.index, leitura: { instavel: true } })
      continue
    }
    const gramas = /^\+?(\d{5,6})$/.exec(c)
    if (gramas) {
      eventos.push({ em: m.index, leitura: { kg: Number(gramas[1]) / 1000 } })
      continue
    }
    const decimalKg = /^\+?(\d+[.,]\d+)\s*(kg|g)?$/i.exec(c)
    if (decimalKg) {
      const v = Number(decimalKg[1]!.replace(',', '.'))
      eventos.push({ em: m.index, leitura: { kg: decimalKg[2]?.toLowerCase() === 'g' ? v / 1000 : v } })
      continue
    }
    if (c.startsWith('-')) eventos.push({ em: m.index, leitura: { instavel: true } })
  }

  const linha = /(ST|US|OL)\s*,\s*(?:(?:GS|NT|TR)\s*,?\s*)?([+-])?\s*(\d+(?:[.,]\d+)?)\s*(kg|g)?/gi
  for (let m = linha.exec(texto); m; m = linha.exec(texto)) {
    const estado = m[1]!.toUpperCase()
    if (estado !== 'ST' || m[2] === '-') {
      eventos.push({ em: m.index, leitura: { instavel: true } })
      continue
    }
    const v = Number(m[3]!.replace(',', '.'))
    eventos.push({ em: m.index, leitura: { kg: m[4]?.toLowerCase() === 'g' ? v / 1000 : v } })
  }

  const ultimo = eventos.sort((a, b) => a.em - b.em).at(-1)
  if (!ultimo) return null
  if ('instavel' in ultimo.leitura) return { instavel: true }
  const kg = inteiro(ultimo.leitura.kg)
  if (!Number.isFinite(kg) || kg < 0 || kg > MAXIMO_KG) return null
  return { kg }
}

// ─────────────────────────────────────────────────────────────
// COMPLEMENTOS
// ─────────────────────────────────────────────────────────────

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** A categoria dos complementos: "Complementos", "Coberturas", "Adicionais"… */
export function ehComplemento(categoria: string | null | undefined): boolean {
  if (!categoria) return false
  return /^(complemento|cobertura|adiciona(l|is)|acompanhamento|topping)s?$/.test(semAcento(categoria))
}

/**
 * Este item pede complemento?
 *
 * Só na sorveteria (o ramo que semeia a categoria "Complementos"), e só o que
 * vai em copo, pote ou taça: açaí, massa, sorvete a quilo, milk-shake. Picolé
 * não leva cobertura, e o próprio complemento não sugere outro — sugestão em
 * cima de sugestão vira propaganda.
 */
export function pedeComplemento(
  ramo: string | null | undefined,
  categoria: string | null | undefined,
  produto: string,
): boolean {
  if (ramo !== 'sorveteria') return false
  if (ehComplemento(categoria)) return false
  const texto = semAcento(`${categoria ?? ''} ${produto}`)
  if (/picole/.test(texto)) return false
  return /(acai|copo|taca|pote|massa|sorvete|milk|shake|sundae|casquinha|cascao|barca)/.test(texto)
}
