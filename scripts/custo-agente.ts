// Quanto custa manter o assistente de uma loja no ar.
//
//   npx tsx scripts/custo-agente.ts
//
// Não é estimativa de escritório: parte de um número MEDIDO em produção, num
// assistente do mesmo tipo já rodando — R$ 120 a R$ 150 de crédito durando de
// quatro a seis dias. Isso é R$ 25 a R$ 30 por dia numa loja só.
//
// O script existe porque o custo do agente é a única variável que pode
// inviabilizar o produto, e ela não se descobre pensando: se descobre
// multiplicando. Mexa nas premissas do topo e rode de novo.

import { custoEmCentavos, MARGEM } from '../src/servidor/custo-ia'

const brl = (cent: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cent / 100)

// ── as premissas ─────────────────────────────────────────────
// Um TURNO é uma mensagem do cliente mais a resposta do assistente.
const CONTEXTO = 30_000 // instrução + catálogo + regras + histórico, por turno
const NOVO = 2_000 // o que muda de um turno para o outro
const RESPOSTA = 400 // tokens de saída
const MODELO = 'claude-sonnet-5'
const MODELO_BARATO = 'claude-haiku-4-5-20251001'

// Quantos turnos por dia. O medido em produção calibra este número.
const MOVIMENTO = {
  'loja parada': 8,
  'loja normal': 20,
  'loja movimentada': 50,
  'loja como a que já roda': 90,
}

const cenarios = [
  {
    nome: 'hoje: sem cache, tudo no modelo grande',
    porTurno: custoEmCentavos(MODELO, { entrada: CONTEXTO + NOVO, saida: RESPOSTA }),
  },
  {
    nome: 'com cache do contexto',
    porTurno: custoEmCentavos(MODELO, {
      entrada: NOVO,
      saida: RESPOSTA,
      cacheLeitura: CONTEXTO,
    }),
  },
  {
    nome: 'com cache + modelo barato no que é rotina',
    // Nem toda mensagem precisa do modelo grande. "Qual o horário?", "tem no
    // tamanho G?" e "quanto custa?" são a maior parte do movimento, e o modelo
    // barato responde igual. A regra prática que sobra: 3 de cada 4 turnos.
    porTurno: Math.round(
      0.75 *
        custoEmCentavos(MODELO_BARATO, {
          entrada: NOVO,
          saida: RESPOSTA,
          cacheLeitura: CONTEXTO,
        }) +
        0.25 *
          custoEmCentavos(MODELO, {
            entrada: NOVO,
            saida: RESPOSTA,
            cacheLeitura: CONTEXTO,
          }),
    ),
  },
]

console.log('\n  CUSTO BRUTO DO ASSISTENTE (o que o fornecedor cobra da gente)')
console.log(`  contexto ${CONTEXTO.toLocaleString('pt-BR')} tk · novo ${NOVO.toLocaleString('pt-BR')} tk · resposta ${RESPOSTA} tk\n`)

const larg = Math.max(...cenarios.map((c) => c.nome.length))
const cab = ['turno'.padStart(9), ...Object.keys(MOVIMENTO).map((m) => m.padStart(20))].join('')
console.log(`  ${''.padEnd(larg)}${cab}   (por mês)`)

for (const c of cenarios) {
  const colunas = Object.values(MOVIMENTO).map((turnos) =>
    brl(c.porTurno * turnos * 30).padStart(20),
  )
  console.log(`  ${c.nome.padEnd(larg)}${brl(c.porTurno).padStart(9)}${colunas.join('')}`)
}

console.log(`\n  E o que a loja PAGA, com a margem de ${MARGEM}x:\n`)
for (const c of cenarios) {
  const colunas = Object.values(MOVIMENTO).map((turnos) =>
    brl(c.porTurno * turnos * 30 * MARGEM).padStart(20),
  )
  console.log(`  ${c.nome.padEnd(larg)}${''.padStart(9)}${colunas.join('')}`)
}

const semCache = cenarios[0]!.porTurno
const comTudo = cenarios[2]!.porTurno
console.log(
  `\n  O cache mais o modelo barato dividem o custo por ${(semCache / comTudo).toFixed(1)}.`,
)
console.log(
  `  Numa loja movimentada isso e a diferenca entre ${brl(semCache * 50 * 30)} e ${brl(comTudo * 50 * 30)} por mes.\n`,
)
