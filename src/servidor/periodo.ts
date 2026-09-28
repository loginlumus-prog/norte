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

export type Periodo = 'hoje' | '7d' | '30d' | '90d' | 'mes' | 'mes-passado'

export type Janela = {
  chave: Periodo
  /** O título da seção. */
  rotulo: string
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

export const PERIODOS: { chave: Periodo; curto: string }[] = [
  { chave: 'hoje', curto: 'Hoje' },
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
  return v && VALIDOS.has(v) ? (v as Periodo) : '30d'
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

  const montar = (de: string, ate: string, rotulo: string, comparacao: string): Janela => {
    const dias = diasEntre(de, ate)
    return {
      chave,
      rotulo,
      curto: PERIODOS.find((p) => p.chave === chave)!.curto,
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

  switch (chave) {
    case 'hoje':
      return montar(hoje, amanha, 'Hoje', 'vs ontem')

    case '7d':
      return montar(somarDias(hoje, -6), amanha, 'Últimos 7 dias', 'vs 7 dias antes')

    case '30d':
      return montar(somarDias(hoje, -29), amanha, 'Últimos 30 dias', 'vs 30 dias antes')

    case '90d':
      return montar(somarDias(hoje, -89), amanha, 'Últimos 90 dias', 'vs 90 dias antes')

    case 'mes': {
      const inicio = primeiroDoMes(hoje)
      // O mês em curso termina HOJE, não no dia 31: comparar 7 dias corridos
      // com um mês inteiro faria o painel anunciar queda todo dia 2.
      const j = montar(inicio, amanha, 'Este mês', 'vs mesmo tempo do mês passado')
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
      const j = montar(inicio, primeiroDoMes(hoje), 'Mês passado', 'vs o mês anterior')
      return { ...j, deAnterior: inst(inicioDoMesAnterior(inicio)), ateAnterior: inst(inicio) }
    }
  }
}
