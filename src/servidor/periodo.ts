// O período que o painel está olhando.
//
// Sem I/O: é conta de calendário, e conta de calendário é onde painel mente.
// Os erros clássicos são três, e todos aparecem só depois de meses no ar:
//
//   1. Comparar 30 dias com "o mês passado" — janelas de tamanhos diferentes,
//      e a seta de porcentagem vira ficção.
//   2. Fechar a janela com `<=` no fim do dia de hoje. Venda das 23h50 entra
//      ou não conforme a hora em que a tela foi aberta.
//   3. Somar 30 × 24h para achar "trinta dias atrás". No dia da virada do
//      horário de verão isso dá 29 dias e 23 horas, e um dia inteiro some ou
//      duplica no gráfico. Aqui só se mexe em dia de calendário.
//
// A regra é uma: toda janela é [de, ate) — começa às 00:00 do primeiro dia e
// termina às 00:00 do dia seguinte ao último. E a janela de comparação tem
// exatamente o MESMO tamanho, encostada imediatamente antes.

import { diaEmSP, diasEntre, inicioDoDiaEmSP, primeiroDoMes, somarDias } from './dia'

export type PeriodoFixo = 'hoje' | 'ontem' | '7d' | '30d' | '90d' | 'mes' | 'mes-passado'
/**
 * Os dias escolhidos no calendário: `dias:2026-10-05` (um dia) ou
 * `dias:2026-10-01:2026-10-05` (do primeiro ao último, os dois inclusos).
 * Vai no endereço como os outros: o link continua sendo a pergunta inteira.
 */
export type PeriodoEscolhido = `dias:${string}`
export type Periodo = PeriodoFixo | PeriodoEscolhido

export type Janela = {
  chave: Periodo
  /** O título da seção. */
  rotulo: string
  /**
   * O período no meio de uma frase: "hoje", "nos últimos 7 dias", "neste
   * mês". O rótulo em minúscula dava "Nenhuma venda últimos 7 dias".
   */
  naFrase: string
  /** O texto do botão. */
  curto: string
  /** Como chamar a comparação: "vs ontem", "vs 30 dias antes". */
  comparacao: string
  de: Date
  /** Exclusivo: a venda de 23h59 do último dia entra, a do dia seguinte não. */
  ate: Date
  deAnterior: Date
  ateAnterior: Date
  /** Quantos dias de calendário a janela cobre. */
  dias: number
  /** Se o gráfico por dia faz sentido. Num dia só, não faz. */
  temGrafico: boolean
}

export const PERIODOS: { chave: PeriodoFixo; curto: string }[] = [
  { chave: 'hoje', curto: 'Hoje' },
  { chave: 'ontem', curto: 'Ontem' },
  { chave: '7d', curto: '7 dias' },
  { chave: '30d', curto: '30 dias' },
  { chave: '90d', curto: '90 dias' },
  { chave: 'mes', curto: 'Este mês' },
  { chave: 'mes-passado', curto: 'Mês passado' },
]

const VALIDOS = new Set<string>(PERIODOS.map((p) => p.chave))

/**
 * Lê o que veio do endereço. Endereço é do usuário: qualquer coisa pode chegar
 * aqui, e o padrão precisa ser um período útil, não um erro.
 */
export function lerPeriodo(v: string | undefined | null): Periodo {
  if (v && VALIDOS.has(v)) return v as Periodo
  const d = diasEscolhidos(v)
  return d ? (`dias:${d.de}${d.ate !== d.de ? `:${d.ate}` : ''}` as PeriodoEscolhido) : '30d'
}

/** No máximo um ano de cada vez: a tela e a planilha não aguentam mais que isso. */
const MAXIMO_DE_DIAS = 366

const diaValido = (t: string | undefined) => {
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return false
  const d = new Date(`${t}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t
}

/**
 * Os dias de `dias:…`, conferidos: data que existe, em ordem (invertidos, a
 * gente desinverte) e no máximo um ano. Fora disso, nulo.
 */
export function diasEscolhidos(v: string | undefined | null): { de: string; ate: string } | null {
  if (!v?.startsWith('dias:')) return null
  const [a, b] = v.slice(5).split(':')
  if (!diaValido(a) || (b !== undefined && !diaValido(b))) return null
  const [de, ate] = b && b < a! ? [b, a!] : [a!, b ?? a!]
  if (diasEntre(de, somarDias(ate, 1)) > MAXIMO_DE_DIAS) return null
  return { de, ate }
}

/** "05/10" ou "05/10/2025" quando não é deste ano. */
function mostrarDia(dia: string, hoje: string) {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}${dia.slice(0, 4) !== hoje.slice(0, 4) ? `/${dia.slice(0, 4)}` : ''}`
}

// ── o fuso ───────────────────────────────────────────────────
// "Hoje" é o dia em São Paulo, e a meia-noite é a de São Paulo — nunca a da
// máquina. Esta conta já foi feita com `new Date(ano, mes, dia)`, que é a
// meia-noite do fuso do SERVIDOR: na Vercel (UTC) o "hoje" do painel começava
// às 21h da véspera, e às 22h30 do dia 30 o "este mês" já era o mês seguinte,
// vazio. Aqui toda conta é de dia escrito ('AAAA-MM-DD', ver `dia.ts`) e só
// no fim vira instante, pela meia-noite de São Paulo.

/** O primeiro dia do mês anterior ao de `dia`. */
const inicioDoMesAnterior = (dia: string) => primeiroDoMes(somarDias(primeiroDoMes(dia), -1))

export function janela(chave: Periodo, agora: Date = new Date()): Janela {
  const hoje = diaEmSP(agora)
  // `amanha` é o fim exclusivo de qualquer janela que inclua hoje.
  const amanha = somarDias(hoje, 1)
  const inst = inicioDoDiaEmSP

  const montar = (de: string, ate: string, rotulo: string, comparacao: string, naFrase: string): Janela => {
    const dias = diasEntre(de, ate)
    return {
      chave,
      rotulo,
      naFrase,
      curto: PERIODOS.find((p) => p.chave === chave)?.curto ?? rotulo,
      comparacao,
      de: inst(de),
      ate: inst(ate),
      // Encostada logo antes, do mesmo tamanho. É isso que faz a seta de
      // porcentagem querer dizer alguma coisa.
      deAnterior: inst(somarDias(de, -dias)),
      ateAnterior: inst(de),
      dias,
      temGrafico: dias > 1,
    }
  }

  const escolhidos = diasEscolhidos(chave)
  if (escolhidos) {
    const { de, ate } = escolhidos
    if (de === ate) {
      const r = mostrarDia(de, hoje)
      return montar(de, somarDias(de, 1), r, 'vs o dia anterior', `em ${r}`)
    }
    const r = `${mostrarDia(de, hoje)} a ${mostrarDia(ate, hoje)}`
    return montar(de, somarDias(ate, 1), r, 'vs os dias antes', `de ${r}`)
  }

  switch (chave) {
    case 'hoje':
      return montar(hoje, amanha, 'Hoje', 'vs ontem', 'hoje')

    case 'ontem':
      return montar(somarDias(hoje, -1), hoje, 'Ontem', 'vs anteontem', 'ontem')

    case '7d':
      return montar(somarDias(hoje, -6), amanha, 'Últimos 7 dias', 'vs 7 dias antes', 'nos últimos 7 dias')

    case '30d':
      return montar(somarDias(hoje, -29), amanha, 'Últimos 30 dias', 'vs 30 dias antes', 'nos últimos 30 dias')

    case '90d':
      return montar(somarDias(hoje, -89), amanha, 'Últimos 90 dias', 'vs 90 dias antes', 'nos últimos 90 dias')

    case 'mes': {
      const inicio = primeiroDoMes(hoje)
      // O mês em curso termina HOJE, não no dia 31: comparar 7 dias corridos
      // com um mês inteiro faria o painel anunciar queda todo dia 2.
      const j = montar(inicio, amanha, 'Este mês', 'vs mesmo tempo do mês passado', 'neste mês')
      // E a comparação anda para o mês anterior, no mesmo dia — não 30 dias
      // para trás, que cairia no meio de outro mês. No dia 31 de março o
      // pedaço de fevereiro para no fim de fevereiro.
      const inicioAnterior = inicioDoMesAnterior(hoje)
      const tamanhoAnterior = diasEntre(inicioAnterior, inicio)
      return {
        ...j,
        deAnterior: inst(inicioAnterior),
        ateAnterior: inst(somarDias(inicioAnterior, Math.min(Number(hoje.slice(8, 10)), tamanhoAnterior))),
      }
    }

    case 'mes-passado': {
      const inicio = inicioDoMesAnterior(hoje)
      const j = montar(inicio, primeiroDoMes(hoje), 'Mês passado', 'vs o mês anterior', 'no mês passado')
      return { ...j, deAnterior: inst(inicioDoMesAnterior(inicio)), ateAnterior: inst(inicio) }
    }
  }
  // `dias:` que não confere (o endereço é do usuário): os 30 dias de sempre.
  return janela('30d', agora)
}
