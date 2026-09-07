// O que cada empresa usa.
//
// Quem não vende fiado não vê Crediário. Não é menu escondido: é o módulo
// desligado, e ele some do menu, dos relatórios e do que o agente sabe fazer.
// A chave para ligar depois mora em Configurações — some da vista de quem não
// usa, continua existindo para quando o negócio mudar.
//
// ── por que só seis ──────────────────────────────────────────
// Cada chave dobra as combinações possíveis do sistema. Com seis são 64
// configurações, que ainda dá para raciocinar. Com trinta seriam mais de um
// bilhão, e aí ninguém consegue afirmar que o sistema funciona — porque
// ninguém testou a combinação do cliente.
//
// Então módulo é GROSSO. Preferência miúda ("mostrar coluna de custo") é
// configuração de tela, não módulo.

export const MODULOS = {
  crediario: {
    titulo: 'Crediário',
    resumo: 'Vender fiado, com parcelas, juros e cobrança automática.',
    pergunta: 'Você vende fiado (crediário próprio)?',
  },
  notaFiscal: {
    titulo: 'Nota fiscal',
    resumo: 'Emitir NFC-e no balcão e NF-e.',
    pergunta: 'Você emite nota fiscal?',
  },
  multiUnidade: {
    titulo: 'Mais de uma unidade',
    resumo: 'Lojas, filiais e depósitos, cada um com seu estoque.',
    pergunta: 'Você tem mais de uma loja ou depósito?',
  },
  agente: {
    titulo: 'Agente no WhatsApp',
    resumo: 'Perguntar pelo WhatsApp e receber relatório sozinho.',
    pergunta: 'Quer um assistente atendendo pelo WhatsApp?',
  },
  metas: {
    titulo: 'Metas e comissão',
    resumo: 'Meta por vendedor, ranking e comissão.',
    pergunta: 'Você paga comissão ou acompanha meta de vendedor?',
  },
  encomenda: {
    titulo: 'Encomenda',
    resumo: 'Pedido que a pessoa retira ou recebe depois.',
    pergunta: 'Você trabalha com encomenda ou entrega?',
  },
} as const

export type Modulo = keyof typeof MODULOS

export const TODOS = Object.keys(MODULOS) as Modulo[]

/** Empresa desta requisição — só o que decide visibilidade. */
export type ComModulos = { modulos: string[] }

export function moduloLigado(empresa: ComModulos, modulo: Modulo): boolean {
  return empresa.modulos.includes(modulo)
}

/**
 * O que o ramo já deixa pronto.
 *
 * IMPORTANTE: o ramo escolhe o que é SEMEADO, nunca o caminho do código. Não
 * existe "tela de estoque de sorveteria" — existe uma tela de estoque que
 * mostra quilo porque o produto está em quilo, e mostra Sabor porque a empresa
 * criou o eixo Sabor. Se o ramo virasse um `if` no código, o primeiro cliente
 * misto (loja de roupa com cafeteria dentro) quebraria o sistema.
 *
 * Por isso tudo aqui é sugestão inicial, e o dono muda depois sem ficar preso.
 */
export const RAMOS = {
  roupa: {
    titulo: 'Roupas e acessórios',
    eixos: [
      { nome: 'Tamanho', ehCor: false, opcoes: ['PP', 'P', 'M', 'G', 'GG'] },
      { nome: 'Cor', ehCor: true, opcoes: ['Preto', 'Branco', 'Azul', 'Bege'] },
    ],
    medida: 'UN',
    sugere: ['crediario', 'metas'],
  },
  calcados: {
    titulo: 'Calçados',
    eixos: [{ nome: 'Numeração', ehCor: false, opcoes: ['34', '35', '36', '37', '38', '39', '40'] }],
    medida: 'PAR',
    sugere: ['crediario', 'metas'],
  },
  bijuteria: {
    titulo: 'Bijuteria e acessórios',
    eixos: [{ nome: 'Cor', ehCor: true, opcoes: ['Dourado', 'Prateado', 'Rosé'] }],
    medida: 'UN',
    sugere: [],
  },
  alimentacao: {
    titulo: 'Sorveteria, padaria, alimentação',
    eixos: [{ nome: 'Sabor', ehCor: false, opcoes: [] }],
    medida: 'KG',
    sugere: ['encomenda'],
  },
  mercearia: {
    titulo: 'Mercearia e conveniência',
    eixos: [],
    medida: 'UN',
    sugere: ['notaFiscal'],
  },
  servico: {
    titulo: 'Serviços',
    eixos: [],
    medida: 'UN',
    sugere: ['encomenda'],
  },
  outro: {
    titulo: 'Outro',
    eixos: [],
    medida: 'UN',
    sugere: [],
  },
} as const

export type Ramo = keyof typeof RAMOS
