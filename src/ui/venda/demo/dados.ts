// Os dados de exemplo da página de venda: a loja que não existe.
//
// ── uma loja inteira, e não números soltos ───────────────────
// A vitrine do topo e o sistema por dentro leem daqui. Produto, estoque,
// venda, cliente, conta e tarefa são da MESMA loja fictícia — a camiseta que
// acaba no estoque é a que o assistente propõe repor e a que aparece no
// balcão. Número solto em cada tela é o que faz amostra parecer maquete.
//
// ── determinístico, sempre ───────────────────────────────────
// Nada de `Math.random` nem de `new Date()`: o servidor desenha a primeira
// tela e o navegador precisa chegar EXATAMENTE no mesmo HTML, senão o React
// acusa hidratação divergente e redesenha tudo. O sorteio é um gerador com
// semente fixa, e "hoje" é uma data escrita aqui.
//
// ── de loja nenhuma ──────────────────────────────────────────
// Os nomes são comuns de propósito, e nenhum é cliente nosso. Os números são
// plausíveis para uma loja de roupa e calçado de bairro, e só isso.

/* ═══════════════════════════════════════════════════════════
   O sorteio com semente
   ═══════════════════════════════════════════════════════════ */

/** mulberry32: pequeno, rápido e igual em qualquer máquina. */
function gerador(semente: number) {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const redondo = (v: number) => Math.round(v * 100) / 100

/* ═══════════════════════════════════════════════════════════
   O calendário da loja fictícia
   ═══════════════════════════════════════════════════════════ */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGOS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** "Hoje" na loja de exemplo: uma quinta-feira. Fixo, para o HTML bater. */
export const HOJE = { ano: 2026, mes: 8, dia: 24 } // 24 de setembro (mês 0-based)
export const HOJE_EXTENSO = 'quinta-feira, 24 de setembro'

/** O dia `n` dias depois (ou antes, se negativo) de hoje. UTC puro, sem fuso. */
export function dia(n: number) {
  const d = new Date(Date.UTC(HOJE.ano, HOJE.mes, HOJE.dia + n))
  return { dia: d.getUTCDate(), mes: d.getUTCMonth(), semana: d.getUTCDay() }
}

/** "26 set" */
export function dataCurta(n: number) {
  const d = dia(n)
  return `${d.dia} ${MESES[d.mes]}`
}

/** "sex, 26 set" */
export function dataComSemana(n: number) {
  const d = dia(n)
  return `${SEMANA[d.semana]}, ${d.dia} ${MESES[d.mes]}`
}

export const MES_ATUAL = MESES_LONGOS[HOJE.mes]!
export const MES_PASSADO = MESES_LONGOS[(HOJE.mes + 11) % 12]!

/* ═══════════════════════════════════════════════════════════
   Os produtos, com grade
   ═══════════════════════════════════════════════════════════ */

export type Produto = {
  id: string
  nome: string
  /** A variação: cor e tamanho, como o cadastro com grade mostra. */
  grade: string
  categoria: 'Roupas' | 'Calçados' | 'Acessórios'
  preco: number
  custo: number
  /** Saldo na Loja Centro. */
  estoque: number
  /** Abaixo disto, "acabando". */
  minimo: number
  /** Unidades por dia, no ritmo dos últimos 30 dias. */
  ritmo: number
  /** Dias que o fornecedor leva para repor. */
  prazo: number
  /** Duas letras para o cartão do balcão, no lugar de foto. */
  sigla: string
}

export const PRODUTOS: Produto[] = [
  { id: 'cam-pre-g', nome: 'Camiseta canelada', grade: 'Preto · G', categoria: 'Roupas', preco: 59.9, custo: 22.4, estoque: 2, minimo: 2, ritmo: 1.3, prazo: 7, sigla: 'CC' },
  { id: 'cam-pre-m', nome: 'Camiseta canelada', grade: 'Preto · M', categoria: 'Roupas', preco: 59.9, custo: 22.4, estoque: 11, minimo: 5, ritmo: 1.1, prazo: 7, sigla: 'CC' },
  { id: 'cam-bra-m', nome: 'Camiseta básica', grade: 'Branco · M', categoria: 'Roupas', preco: 39.9, custo: 14.1, estoque: 26, minimo: 8, ritmo: 1.6, prazo: 7, sigla: 'CB' },
  { id: 'cal-beg-38', nome: 'Calça wide leg', grade: 'Bege · 38', categoria: 'Roupas', preco: 149.9, custo: 61.3, estoque: 14, minimo: 4, ritmo: 0.45, prazo: 12, sigla: 'CW' },
  { id: 'cal-jea-40', nome: 'Calça jeans reta', grade: 'Azul · 40', categoria: 'Roupas', preco: 169.9, custo: 72.0, estoque: 6, minimo: 4, ritmo: 0.5, prazo: 15, sigla: 'CJ' },
  { id: 'ves-ver-m', nome: 'Vestido midi', grade: 'Verde · M', categoria: 'Roupas', preco: 189.9, custo: 78.5, estoque: 5, minimo: 3, ritmo: 0.3, prazo: 10, sigla: 'VM' },
  { id: 'sai-pre-p', nome: 'Saia plissada', grade: 'Preto · P', categoria: 'Roupas', preco: 119.9, custo: 46.0, estoque: 9, minimo: 3, ritmo: 0.2, prazo: 10, sigla: 'SP' },
  { id: 'blu-off-u', nome: 'Blusa de tricô', grade: 'Off-white · U', categoria: 'Roupas', preco: 99.9, custo: 38.9, estoque: 17, minimo: 4, ritmo: 0.35, prazo: 14, sigla: 'BT' },
  { id: 'jaq-jea-m', nome: 'Jaqueta jeans', grade: 'Azul · M', categoria: 'Roupas', preco: 239.9, custo: 104.0, estoque: 4, minimo: 2, ritmo: 0.12, prazo: 20, sigla: 'JJ' },
  { id: 'ber-caq-42', nome: 'Bermuda sarja', grade: 'Caqui · 42', categoria: 'Roupas', preco: 89.9, custo: 34.2, estoque: 0, minimo: 3, ritmo: 0.4, prazo: 10, sigla: 'BS' },
  { id: 'mol-cin-g', nome: 'Moletom com capuz', grade: 'Cinza · G', categoria: 'Roupas', preco: 179.9, custo: 70.0, estoque: 21, minimo: 4, ritmo: 0.08, prazo: 18, sigla: 'MC' },
  { id: 'reg-lis-m', nome: 'Regata listrada', grade: 'Marinho · M', categoria: 'Roupas', preco: 49.9, custo: 17.5, estoque: 13, minimo: 5, ritmo: 0.9, prazo: 7, sigla: 'RL' },
  { id: 'ten-bra-38', nome: 'Tênis casual', grade: 'Branco · 38', categoria: 'Calçados', preco: 229.9, custo: 98.0, estoque: 6, minimo: 3, ritmo: 0.65, prazo: 7, sigla: 'TC' },
  { id: 'ten-bra-37', nome: 'Tênis casual', grade: 'Branco · 37', categoria: 'Calçados', preco: 229.9, custo: 98.0, estoque: 9, minimo: 3, ritmo: 0.5, prazo: 7, sigla: 'TC' },
  { id: 'san-car-36', nome: 'Sandália rasteira', grade: 'Caramelo · 36', categoria: 'Calçados', preco: 79.9, custo: 29.0, estoque: 0, minimo: 3, ritmo: 0.7, prazo: 10, sigla: 'SR' },
  { id: 'san-car-35', nome: 'Sandália rasteira', grade: 'Caramelo · 35', categoria: 'Calçados', preco: 79.9, custo: 29.0, estoque: 3, minimo: 3, ritmo: 0.55, prazo: 10, sigla: 'SR' },
  { id: 'bot-pre-37', nome: 'Bota cano curto', grade: 'Preto · 37', categoria: 'Calçados', preco: 279.9, custo: 121.0, estoque: 7, minimo: 2, ritmo: 0.1, prazo: 25, sigla: 'BC' },
  { id: 'chi-pre-u', nome: 'Chinelo slide', grade: 'Preto · 38/39', categoria: 'Calçados', preco: 69.9, custo: 24.0, estoque: 15, minimo: 5, ritmo: 0.6, prazo: 10, sigla: 'CS' },
  { id: 'mei-bra-u', nome: 'Meia cano alto', grade: 'Branco · U', categoria: 'Acessórios', preco: 19.9, custo: 5.8, estoque: 48, minimo: 12, ritmo: 2.1, prazo: 5, sigla: 'MA' },
  { id: 'cin-mar-u', nome: 'Cinto de couro', grade: 'Marrom · U', categoria: 'Acessórios', preco: 89.9, custo: 31.0, estoque: 12, minimo: 3, ritmo: 0.15, prazo: 15, sigla: 'CI' },
  { id: 'bol-pre-u', nome: 'Bolsa tiracolo', grade: 'Preto · U', categoria: 'Acessórios', preco: 159.9, custo: 64.0, estoque: 2, minimo: 2, ritmo: 0.2, prazo: 20, sigla: 'BO' },
  { id: 'bon-pre-u', nome: 'Boné aba curva', grade: 'Preto · U', categoria: 'Acessórios', preco: 59.9, custo: 19.0, estoque: 19, minimo: 4, ritmo: 0.25, prazo: 12, sigla: 'BN' },
  { id: 'ecb-lis-u', nome: 'Ecobag de algodão', grade: 'Cru · U', categoria: 'Acessórios', preco: 34.9, custo: 11.0, estoque: 32, minimo: 6, ritmo: 0.3, prazo: 10, sigla: 'EC' },
  { id: 'ocu-tar-u', nome: 'Óculos de sol', grade: 'Tartaruga · U', categoria: 'Acessórios', preco: 129.9, custo: 45.0, estoque: 8, minimo: 2, ritmo: 0.05, prazo: 30, sigla: 'OS' },
]

export const produto = (id: string) => PRODUTOS.find((p) => p.id === id)!

export type Situacao = { tom: 'critico' | 'atencao' | 'bom' | 'neutro'; texto: string }

/** Quantos dias o saldo aguenta, no ritmo. */
export const dura = (p: Produto, estoque = p.estoque) => (estoque <= 0 ? 0 : Math.floor(estoque / p.ritmo))

/** Dias de folga até o último dia de pedir, a partir de hoje. */
export const folga = (p: Produto, estoque = p.estoque) => dura(p, estoque) - p.prazo

/** As situações da tela "Vai faltar", com as mesmas palavras dela. */
export function situacao(p: Produto, estoque = p.estoque): Situacao {
  if (estoque <= 0) return { tom: 'critico', texto: 'já faltou' }
  if (p.ritmo < 0.1) return { tom: 'neutro', texto: 'sem giro' }
  const f = folga(p, estoque)
  if (f <= 0) return { tom: 'critico', texto: 'pedir agora' }
  if (f <= 7) return { tom: 'atencao', texto: 'atenção' }
  return { tom: 'bom', texto: 'ok' }
}

export function pedirAte(p: Produto, estoque = p.estoque): string {
  if (estoque <= 0) return 'já faltou'
  const f = folga(p, estoque)
  if (f <= 0) return 'hoje'
  return dataCurta(f)
}

export const noMinimo = (p: Produto, estoque = p.estoque) => estoque > 0 && estoque <= p.minimo

/* ═══════════════════════════════════════════════════════════
   As vendas: 30 dias e o dia de hoje por hora
   ═══════════════════════════════════════════════════════════ */

export type DiaDeVenda = {
  /** Dias a partir de hoje: 0 é hoje, -29 é o primeiro. */
  n: number
  rotulo: string
  total: number
  vendas: number
  /** Custo das peças vendidas. */
  custo: number
}

// O peso de cada dia da semana (dom..sáb): sábado cheio, domingo meio.
const PESO_SEMANA = [0.45, 0.78, 0.84, 0.9, 1, 1.12, 1.42]

/**
 * Sessenta dias, e não trinta: o período de 30 dias se compara com os 30
 * anteriores, como na tela de verdade.
 */
export const DIAS: DiaDeVenda[] = (() => {
  const sorte = gerador(20260924)
  const dias: DiaDeVenda[] = []
  for (let n = -59; n <= 0; n++) {
    const d = dia(n)
    // Uma tendência leve de alta no mês, e o ruído de todo dia.
    const tendencia = 1 + (n + 59) * 0.004
    const ruido = 0.82 + sorte() * 0.36
    const vendas = Math.max(6, Math.round(24 * PESO_SEMANA[d.semana]! * tendencia * ruido))
    const ticket = 128 + sorte() * 36
    const total = redondo(vendas * ticket)
    const custo = redondo(total * (0.54 + sorte() * 0.06))
    dias.push({ n, rotulo: dataComSemana(n), total, vendas, custo })
  }
  return dias
})()

/** Os últimos 30 dias — o que os períodos da tela leem. */
export const TRINTA_DIAS = DIAS.slice(-30)

/** O movimento de hoje por hora, das 8h às 19h. `null` é hora que ainda não chegou. */
export const HORA_ABRE = 8
export const HORA_AGORA = 16
export type Hora = { hora: number; total: number | null; vendas: number | null; passada: number }
export const HORAS_HOJE: Hora[] = (() => {
  const sorte = gerador(924)
  const curva = [0.25, 0.45, 0.7, 0.95, 1.1, 0.9, 0.7, 0.8, 1.05, 1.3, 1.4, 1.0]
  return curva.map((c, i) => {
    const hora = HORA_ABRE + i
    // A mesma quinta da semana passada, hora a hora: a série cinza do gráfico.
    const passada = redondo(0.94 * (2.6 * c + sorte() * 1.3) * (124 + sorte() * 52))
    if (hora > HORA_AGORA) return { hora, total: null, vendas: null, passada }
    // A hora de agora acabou de começar: uma venda até aqui, e as da
    // vitrine do topo somam em cima dela (ver o fim do arquivo).
    const vendas = hora === HORA_AGORA ? 1 : Math.max(1, Math.round(2.6 * c + sorte() * 1.4))
    return { hora, total: redondo(vendas * (120 + sorte() * 60)), vendas, passada }
  })
})()

export type Resumo = {
  total: number
  vendas: number
  ticket: number
  margem: number
  /** O período anterior do mesmo tamanho. */
  anterior: number
  mediaDia: number
}

/** Os números dos últimos `dias` dias, contra os `dias` anteriores. */
export function resumo(dias: number): Resumo {
  const fatia = DIAS.slice(-dias)
  const total = redondo(fatia.reduce((s, d) => s + d.total, 0))
  const vendas = fatia.reduce((s, d) => s + d.vendas, 0)
  const custo = fatia.reduce((s, d) => s + d.custo, 0)
  let anterior: number
  if (dias === 1) {
    // Hoje contra a quinta passada ATÉ ESTA HORA — o dia não acabou.
    anterior = redondo(
      HORAS_HOJE.filter((h) => h.hora <= HORA_AGORA).reduce((s, h) => s + h.passada, 0),
    )
  } else {
    anterior = redondo(DIAS.slice(-dias * 2, -dias).reduce((s, d) => s + d.total, 0))
  }
  return {
    total,
    vendas,
    ticket: vendas ? redondo(total / vendas) : 0,
    margem: total ? Math.round(((total - custo) / total) * 1000) / 10 : 0,
    anterior,
    mediaDia: redondo(total / dias),
  }
}

/** Quem mais vendeu no período — a divisão é fixa, e soma o total. */
export const VENDEDORES = [
  { nome: 'Marina', iniciais: 'MC', parte: 0.38 },
  { nome: 'João', iniciais: 'JP', parte: 0.27 },
  { nome: 'Rafaela', iniciais: 'RA', parte: 0.21 },
  { nome: 'Carlos', iniciais: 'CS', parte: 0.14 },
]

/* ═══════════════════════════════════════════════════════════
   Clientes
   ═══════════════════════════════════════════════════════════ */

export type Cliente = {
  nome: string
  iniciais: string
  compras: number
  gasto: number
  /** Há quantos dias foi a última compra. */
  ultima: number
  pontos: number
  bairro: string
  telefone: string
  /** Mês do aniversário, 0-based. */
  aniversario: number
}

const NOMES_CLIENTES: [string, string][] = [
  ['Ana Souza', 'Centro'],
  ['Beatriz Lima', 'Jardim América'],
  ['Carla Mendes', 'Vila Nova'],
  ['Daniel Rocha', 'Centro'],
  ['Eduardo Alves', 'Boa Vista'],
  ['Fernanda Costa', 'São José'],
  ['Gabriel Martins', 'Centro'],
  ['Helena Duarte', 'Jardim América'],
  ['Igor Nogueira', 'Santa Cruz'],
  ['Juliana Pires', 'Vila Nova'],
  ['Karina Barros', 'Boa Vista'],
  ['Lucas Teixeira', 'Centro'],
  ['Mariana Freitas', 'São José'],
  ['Natália Gomes', 'Santa Cruz'],
  ['Otávio Ramos', 'Centro'],
  ['Paula Cardoso', 'Jardim América'],
  ['Renata Moraes', 'Vila Nova'],
  ['Sérgio Batista', 'Boa Vista'],
  ['Tatiane Farias', 'Centro'],
  ['Vítor Azevedo', 'São José'],
]

export const CLIENTES: Cliente[] = (() => {
  const sorte = gerador(7)
  return NOMES_CLIENTES.map(([nome, bairro], i) => {
    const compras = 1 + Math.floor(sorte() * (i < 4 ? 22 : 12))
    const gasto = redondo(compras * (95 + sorte() * 120))
    const iniciais = nome
      .split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
    // Telefone mascarado: número inventado inteiro poderia ser o de alguém.
    const fim = String(1000 + Math.floor(sorte() * 9000))
    return {
      nome,
      iniciais,
      compras,
      gasto,
      ultima: Math.floor(sorte() * (i % 5 === 4 ? 140 : 45)),
      pontos: Math.floor(gasto / 10),
      bairro,
      telefone: `(11) 9••••-${fim}`,
      // Um em cada quatro faz aniversário neste mês.
      aniversario: i % 4 === 1 ? HOJE.mes : (i * 5) % 12,
    }
  })
})()

/* ═══════════════════════════════════════════════════════════
   Contas a pagar
   ═══════════════════════════════════════════════════════════ */

export type Conta = {
  id: string
  descricao: string
  categoria: string
  valor: number
  /** Dias a partir de hoje. Negativo = venceu. */
  vence: number
}

export const CONTAS: Conta[] = [
  { id: 'aluguel', descricao: 'Aluguel da loja', categoria: 'Ocupação', valor: 3200, vence: -1 },
  { id: 'luz', descricao: 'Conta de luz', categoria: 'Ocupação', valor: 312.4, vence: 0 },
  { id: 'internet', descricao: 'Internet', categoria: 'Ocupação', valor: 129.9, vence: 3 },
  { id: 'malharia', descricao: 'Malharia · 40 camisetas', categoria: 'Mercadoria', valor: 896, vence: 6 },
  { id: 'contador', descricao: 'Contador', categoria: 'Serviços', valor: 450, vence: 9 },
  { id: 'maquininha', descricao: 'Aluguel da maquininha', categoria: 'Taxas', valor: 89.9, vence: 12 },
  { id: 'agua', descricao: 'Água', categoria: 'Ocupação', valor: 96.3, vence: 14 },
]

/** O resultado do mês passado, no formato do DRE. */
export const DRE: { rotulo: string; valor: number; tipo: 'soma' | 'tira' | 'total' }[] = [
  { rotulo: 'Vendas do mês', valor: 84230, tipo: 'soma' },
  { rotulo: 'Taxas de cartão e Pix', valor: -2106, tipo: 'tira' },
  { rotulo: 'Custo da mercadoria', valor: -41280, tipo: 'tira' },
  { rotulo: 'Despesas do mês', valor: -24910, tipo: 'tira' },
  { rotulo: 'Resultado', valor: 15934, tipo: 'total' },
]

/* ═══════════════════════════════════════════════════════════
   A vitrine do topo: as vendas que "acontecem"
   ═══════════════════════════════════════════════════════════
   Cada uma tira do estoque o que vendeu. A quarta leva a última peça folgada
   da camiseta, e é ela que acende o "Precisa de você" e a proposta. */

export type VendaAoVivo = {
  numero: number
  itens: { id: string; q: number }[]
  pagamento: string
  quem: string
}

export const VENDAS_AO_VIVO: VendaAoVivo[] = [
  { numero: 1285, itens: [{ id: 'cam-pre-g', q: 1 }, { id: 'mei-bra-u', q: 1 }], pagamento: 'Pix', quem: 'MC' },
  { numero: 1286, itens: [{ id: 'cal-beg-38', q: 1 }], pagamento: 'Crédito 2x', quem: 'JP' },
  { numero: 1287, itens: [{ id: 'ten-bra-38', q: 1 }], pagamento: 'Débito', quem: 'RA' },
  { numero: 1288, itens: [{ id: 'cam-pre-g', q: 1 }, { id: 'bon-pre-u', q: 1 }], pagamento: 'Dinheiro', quem: 'MC' },
  { numero: 1289, itens: [{ id: 'ves-ver-m', q: 1 }], pagamento: 'Pix', quem: 'JP' },
  { numero: 1290, itens: [{ id: 'reg-lis-m', q: 2 }], pagamento: 'Crédito', quem: 'RA' },
  { numero: 1291, itens: [{ id: 'bol-pre-u', q: 1 }, { id: 'mei-bra-u', q: 2 }], pagamento: 'Pix', quem: 'MC' },
]

/** As vendas que já estavam no feed quando a página abriu. */
export const VENDAS_ANTES: VendaAoVivo[] = [
  { numero: 1284, itens: [{ id: 'cam-bra-m', q: 2 }, { id: 'cal-beg-38', q: 1 }], pagamento: 'Pix + dinheiro', quem: 'MC' },
  { numero: 1283, itens: [{ id: 'san-car-35', q: 1 }], pagamento: 'Débito', quem: 'RA' },
  { numero: 1282, itens: [{ id: 'chi-pre-u', q: 1 }, { id: 'mei-bra-u', q: 1 }], pagamento: 'Pix', quem: 'JP' },
  { numero: 1281, itens: [{ id: 'jaq-jea-m', q: 1 }], pagamento: 'Crédito 3x', quem: 'MC' },
]

export const totalDaVenda = (v: VendaAoVivo) =>
  redondo(v.itens.reduce((s, i) => s + produto(i.id).preco * i.q, 0))

export const pecasDaVenda = (v: VendaAoVivo) => v.itens.reduce((s, i) => s + i.q, 0)

/* ═══════════════════════════════════════════════════════════
   O dia de hoje fecha a conta
   ═══════════════════════════════════════════════════════════
   As vendas ao vivo da vitrine acontecem na hora de agora. Somadas ao que já
   tinha entrado, dão o "hoje" que o sistema por dentro mostra — a vitrine
   termina exatamente no número em que o painel começa. */

export const HORA_AO_VIVO = HORAS_HOJE.find((h) => h.hora === HORA_AGORA)!
{
  HORA_AO_VIVO.total = redondo(
    (HORA_AO_VIVO.total ?? 0) + VENDAS_AO_VIVO.reduce((s, v) => s + totalDaVenda(v), 0),
  )
  HORA_AO_VIVO.vendas = (HORA_AO_VIVO.vendas ?? 0) + VENDAS_AO_VIVO.length
  const hoje = DIAS[DIAS.length - 1]!
  hoje.total = redondo(HORAS_HOJE.reduce((s, h) => s + (h.total ?? 0), 0))
  hoje.vendas = HORAS_HOJE.reduce((s, h) => s + (h.vendas ?? 0), 0)
  hoje.custo = redondo(hoje.total * 0.566)
}

/** "16:37" — a hora de cada venda ao vivo, três minutos uma da outra. */
export const horaDaVenda = (i: number) => `${HORA_AGORA}:${String(19 + i * 3).padStart(2, '0')}`

/* ═══════════════════════════════════════════════════════════
   Tarefas
   ═══════════════════════════════════════════════════════════ */

export type SituacaoTarefa = 'A fazer' | 'Em andamento' | 'Parado' | 'Feito'
export const SITUACOES: SituacaoTarefa[] = ['A fazer', 'Em andamento', 'Parado', 'Feito']

export type Tarefa = {
  id: string
  grupo: string
  nome: string
  quem: string
  situacao: SituacaoTarefa
  /** Dias a partir de hoje. */
  prazo: number
  /** Linha do tempo: começo e fim, em % da semana. */
  tempo: [number, number]
  prioridade: number
}

export const GRUPOS_TAREFA = ['Esta semana', 'Abertura e fechamento', 'Próxima coleção']

export const TAREFAS: Tarefa[] = [
  { id: 't1', grupo: 'Esta semana', nome: 'Montar a vitrine de primavera', quem: 'JP', situacao: 'Em andamento', prazo: 2, tempo: [10, 64], prioridade: 4 },
  { id: 't2', grupo: 'Esta semana', nome: 'Ligar para o fornecedor de sandálias', quem: 'RA', situacao: 'Parado', prazo: -1, tempo: [20, 45], prioridade: 5 },
  { id: 't3', grupo: 'Esta semana', nome: 'Etiquetar a mercadoria que chegou', quem: 'CS', situacao: 'A fazer', prazo: 5, tempo: [40, 86], prioridade: 3 },
  { id: 't4', grupo: 'Esta semana', nome: 'Conferir o balanço da seção de calçados', quem: 'MC', situacao: 'A fazer', prazo: -2, tempo: [5, 30], prioridade: 4 },
  { id: 't5', grupo: 'Abertura e fechamento', nome: 'Conferir troco e abrir o caixa', quem: 'MC', situacao: 'Feito', prazo: 0, tempo: [0, 12], prioridade: 5 },
  { id: 't6', grupo: 'Abertura e fechamento', nome: 'Repor a arara da entrada', quem: 'CS', situacao: 'Em andamento', prazo: 0, tempo: [0, 20], prioridade: 3 },
  { id: 't7', grupo: 'Abertura e fechamento', nome: 'Fechar o caixa conferindo a gaveta', quem: 'MC', situacao: 'A fazer', prazo: 0, tempo: [80, 100], prioridade: 5 },
  { id: 't8', grupo: 'Próxima coleção', nome: 'Escolher as peças de verão com o fornecedor', quem: 'MC', situacao: 'A fazer', prazo: 12, tempo: [55, 100], prioridade: 3 },
  { id: 't9', grupo: 'Próxima coleção', nome: 'Fotografar as novidades para o Instagram', quem: 'RA', situacao: 'A fazer', prazo: 9, tempo: [60, 90], prioridade: 2 },
]

/* ═══════════════════════════════════════════════════════════
   As propostas do assistente
   ═══════════════════════════════════════════════════════════
   Só os poderes de agir que existem hoje (`servidor/poderes.ts`, com
   `disponivel: true`): registrar compra, lançar conta e corrigir estoque. A
   chave aparece crua, como aparece na tela. */

export type Proposta = {
  id: string
  poder: 'pedir.compra' | 'lancar.despesa' | 'ajustar.estoque'
  resumo: string
  valor: number | null
  expira: number
  /** O que acontece no resto do exemplo quando alguém confirma. */
  efeito:
    | { tipo: 'conta'; conta: Conta }
    | { tipo: 'estoque'; id: string; q: number }
}

export const PROPOSTAS: Proposta[] = [
  {
    id: 'p1',
    poder: 'pedir.compra',
    resumo: 'Registrar a compra de 20 un. da Camiseta canelada Preto · G (20 × R$ 22,40), vencimento em 30 dias',
    valor: 448,
    expira: 21,
    efeito: {
      tipo: 'conta',
      conta: { id: 'compra-camiseta', descricao: 'Compra · Camiseta canelada Preto · G', categoria: 'Mercadoria', valor: 448, vence: 30 },
    },
  },
  {
    id: 'p2',
    poder: 'lancar.despesa',
    resumo: 'Lançar o frete da transportadora, vence 2 out',
    valor: 186.5,
    expira: 17,
    efeito: {
      tipo: 'conta',
      conta: { id: 'frete', descricao: 'Frete da transportadora', categoria: 'Mercadoria', valor: 186.5, vence: 8 },
    },
  },
  {
    id: 'p3',
    poder: 'ajustar.estoque',
    resumo: 'Somar 2 pares ao Tênis casual Branco · 37: apareceram na contagem de ontem',
    valor: null,
    expira: 9,
    efeito: { tipo: 'estoque', id: 'ten-bra-37', q: 2 },
  },
]

/** As lojas lado a lado, na Análise. */
export const LOJAS = [
  { nome: 'Centro', vendas: 84230, margem: 43.4, ticket: 146, parado: 3120 },
  { nome: 'Shopping', vendas: 97410, margem: 39.1, ticket: 171, parado: 5840 },
  { nome: 'Bairro', vendas: 41980, margem: 46.2, ticket: 98, parado: 1260 },
]
