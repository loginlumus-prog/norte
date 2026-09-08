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

/** 00:00 do dia de `d`, sem mexer em fuso. */
const meiaNoite = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Soma dias de CALENDÁRIO — não 24h. Sobrevive a horário de verão. */
const maisDias = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

const maisMeses = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth() + n, 1)

/** Diferença em dias de calendário entre duas meia-noites. */
const emDias = (de: Date, ate: Date) => Math.round((ate.getTime() - de.getTime()) / 864e5)

export function janela(chave: Periodo, agora: Date = new Date()): Janela {
  const hoje = meiaNoite(agora)
  // `amanha` é o fim exclusivo de qualquer janela que inclua hoje.
  const amanha = maisDias(hoje, 1)

  const montar = (de: Date, ate: Date, rotulo: string, comparacao: string): Janela => {
    const dias = emDias(de, ate)
    return {
      chave,
      rotulo,
      curto: PERIODOS.find((p) => p.chave === chave)!.curto,
      comparacao,
      de,
      ate,
      // Encostada logo antes, do mesmo tamanho. É isso que faz a seta de
      // porcentagem querer dizer alguma coisa.
      deAnterior: maisDias(de, -dias),
      ateAnterior: de,
      dias,
      temGrafico: dias > 1,
    }
  }

  switch (chave) {
    case 'hoje':
      return montar(hoje, amanha, 'Hoje', 'vs ontem')

    case '7d':
      return montar(maisDias(hoje, -6), amanha, 'Últimos 7 dias', 'vs 7 dias antes')

    case '30d':
      return montar(maisDias(hoje, -29), amanha, 'Últimos 30 dias', 'vs 30 dias antes')

    case '90d':
      return montar(maisDias(hoje, -89), amanha, 'Últimos 90 dias', 'vs 90 dias antes')

    case 'mes': {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      // O mês em curso termina HOJE, não no dia 31: comparar 7 dias corridos
      // com um mês inteiro faria o painel anunciar queda todo dia 2.
      const j = montar(inicio, amanha, 'Este mês', 'vs mesmo tempo do mês passado')
      // E a comparação anda para o mês anterior, no mesmo dia — não 30 dias
      // para trás, que cairia no meio de outro mês.
      const inicioAnterior = maisMeses(inicio, -1)
      return {
        ...j,
        deAnterior: inicioAnterior,
        ateAnterior: new Date(
          inicioAnterior.getFullYear(),
          inicioAnterior.getMonth(),
          Math.min(hoje.getDate() + 1, emDias(inicioAnterior, maisMeses(inicio, 0)) + 1),
        ),
      }
    }

    case 'mes-passado': {
      const inicio = maisMeses(hoje, -1)
      const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      const j = montar(inicio, fim, 'Mês passado', 'vs o mês anterior')
      return { ...j, deAnterior: maisMeses(inicio, -1), ateAnterior: inicio }
    }
  }
}
