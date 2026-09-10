// As perguntas do cadastro inicial que não são dado de identificação.
//
// Cinco respostas, e nenhuma é curiosidade. O ganho não é o formulário: é que
// UMA resposta alimenta três coisas ao mesmo tempo — o que aparece no sistema,
// o que o painel destaca, e o que o assistente já sabe da loja no primeiro dia.
//
// ── por que as opções moram aqui, e não na tela ──────────────
// A tela desenha e o servidor confere, e os dois precisam da MESMA lista. Duas
// cópias divergem no dia em que alguém acrescenta uma opção só de um lado: a
// tela oferece, o servidor recusa em silêncio, e o campo simplesmente não
// salva. Aqui é uma lista só, e a tela e a conferência leem dela.
//
// ── o que NÃO se pergunta, e não é esquecimento ──────────────
// Faturamento, conta bancária, cartão: nada disso entra. Dado financeiro que
// não existe aqui não vaza daqui, e quem precisa dele para cobrar é o meio de
// pagamento, na hora de cobrar. Está escrito na política de privacidade, e é
// promessa que o cadastro precisa cumprir.

import type { Porte, Dor, Catalogo } from '@prisma/client'

export type Opcao<T extends string> = {
  valor: T
  titulo: string
  /** A frase que explica a opção quando o título sozinho não basta. */
  resumo?: string
}

/** Quanta gente mexe no sistema. Decide cota de plano e o peso dos papéis. */
export const PORTES: Opcao<Porte>[] = [
  { valor: 'SO_EU', titulo: 'Só eu' },
  { valor: 'ATE_5', titulo: 'De 2 a 5 pessoas' },
  { valor: 'ATE_20', titulo: 'De 6 a 20 pessoas' },
  { valor: 'MAIS_DE_20', titulo: 'Mais de 20' },
]

/**
 * Por onde a venda acontece hoje. Vale marcar mais de uma — quase todo comércio
 * faz mais de uma, e forçar escolher uma daria a resposta errada.
 *
 * Não é enum no banco porque a lista cresce com o mercado (marketplace, loja
 * no Instagram) e cada valor novo num enum é uma migração. Aqui é texto numa
 * lista conferida no servidor, que dá na mesma e não custa migração.
 */
export const CANAIS = [
  { valor: 'BALCAO', titulo: 'No balcão', resumo: 'A pessoa entra na loja.' },
  { valor: 'WHATSAPP', titulo: 'Pelo WhatsApp', resumo: 'Conversa, foto do produto, combina e busca.' },
  { valor: 'ENTREGA', titulo: 'Com entrega', resumo: 'Sai da loja para o endereço do cliente.' },
  { valor: 'ONLINE', titulo: 'Loja online', resumo: 'Site próprio ou marketplace.' },
] as const

export type Canal = (typeof CANAIS)[number]['valor']

export const CANAIS_VALIDOS: readonly string[] = CANAIS.map((c) => c.valor)

/**
 * A pergunta mais valiosa do cadastro.
 *
 * Uma escolha só, quatro opções. Pergunta com dez alternativas vira formulário,
 * e formulário ninguém responde de verdade — responde o que for mais rápido de
 * clicar. Quatro cabem na tela de uma vez e cada uma é uma dor que a pessoa
 * reconhece antes de terminar de ler.
 */
export const DORES: Opcao<Dor>[] = [
  {
    valor: 'ESTOQUE',
    titulo: 'O estoque nunca bate',
    resumo: 'O sistema diz que tem, a prateleira diz que não.',
  },
  {
    valor: 'LUCRO',
    titulo: 'Não sei quanto sobra',
    resumo: 'Sei quanto vendi. Quanto realmente ficou é outra história.',
  },
  {
    valor: 'COBRANCA',
    titulo: 'Esqueço de cobrar',
    resumo: 'Quem está atrasado só aparece quando eu lembro.',
  },
  {
    valor: 'ATENDIMENTO',
    titulo: 'Não dou conta de responder',
    resumo: 'Mensagem demais, e responder é sempre a mesma coisa.',
  },
]

/**
 * Tamanho do catálogo, por faixa — ninguém sabe o número exato, e perguntar o
 * número exato faria a pessoa parar para contar ou chutar.
 *
 * Serve para uma decisão só, e ela vale muito: oferecer importação por planilha
 * ANTES de a pessoa desistir de digitar o milésimo produto.
 */
export const CATALOGOS: Opcao<Catalogo>[] = [
  { valor: 'ATE_50', titulo: 'Até 50 produtos' },
  { valor: 'ATE_500', titulo: 'De 50 a 500' },
  { valor: 'ATE_5000', titulo: 'De 500 a 5 mil' },
  { valor: 'MAIS_DE_5000', titulo: 'Mais de 5 mil' },
]

/** A partir de quantos produtos vale oferecer importar por planilha. */
export const IMPORTAR_VALE_A_PENA: readonly Catalogo[] = ['ATE_5000', 'MAIS_DE_5000']

/**
 * Confere um valor que veio do navegador contra a lista de verdade.
 *
 * O que chega do formulário é do navegador, e o navegador é da pessoa. Valor
 * fora da lista vira nulo em vez de erro: é campo opcional, e barrar o cadastro
 * inteiro por causa de um campo que ninguém é obrigado a responder seria trocar
 * um problema pequeno por um grande.
 */
export function daLista<T extends string>(
  valor: FormDataEntryValue | null,
  lista: readonly { valor: T }[],
): T | null {
  const v = String(valor ?? '')
  return lista.some((o) => o.valor === v) ? (v as T) : null
}
