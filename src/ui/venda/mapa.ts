// O mapa do produto: o que o painel "Produto" da barra mostra, e o que o
// rodapé repete.
//
// ── os grupos são os do menu de verdade ──────────────────────
// Vender, Catálogo, Pessoas e Dinheiro são os grupos de `ui/menu.ts`, na
// ordem em que a pessoa vai encontrá-los quando entrar. O quinto é o
// Assistente — lá dentro ele mora no grupo Empresa, mas aqui ele é o
// diferencial e ganha coluna própria, junto com o livro de auditoria e a
// ajuda, que são as peças que fazem dele algo confiável.
//
// Nome de tela que não existe no menu não entra: o painel é o mapa do que a
// pessoa vai achar lá dentro. E cada linha diz o que a tela FAZ, não o nome
// dela de novo com outras palavras.
//
// ── para onde cada item leva ─────────────────────────────────
// Para o lugar da página que mostra aquela tela. `#tela-…` é o item do menu
// do exemplo clicável em "O sistema por dentro" (`demo/SistemaPorDentro`): o
// navegador rola até ele sozinho, e o exemplo lê o endereço e abre a tela
// certa. Sem JavaScript o clique ainda rola até a seção — só não troca a tela.

import type { ComponentType } from 'react'
import {
  IconeAssistente,
  IconeCatalogo,
  IconeDinheiro,
  IconePessoas,
  IconeVender,
} from '../Icones'

export type ItemMapa = { nome: string; linha: string; href: string }

export type GrupoMapa = {
  nome: string
  Icone: ComponentType<{ tamanho?: number; className?: string }>
  itens: ItemMapa[]
}

export const MAPA: GrupoMapa[] = [
  {
    nome: 'Vender',
    Icone: IconeVender,
    itens: [
      { nome: 'Balcão', linha: 'Bipa a etiqueta ou toca no botão, e o troco aparece grande', href: '#tela-balcao' },
      { nome: 'Caixa', linha: 'Abre, sangra e fecha conferindo a gaveta', href: '#tela-balcao' },
      { nome: 'Crediário', linha: 'Fiado com parcelas, juros de atraso e a lista de quem deve', href: '#resolve' },
      { nome: 'Encomendas', linha: 'O pedido que o cliente retira depois', href: '#ramos' },
    ],
  },
  {
    nome: 'Catálogo',
    Icone: IconeCatalogo,
    itens: [
      { nome: 'Produtos', linha: 'Grade de cor e tamanho, e três preços', href: '#ramos' },
      { nome: 'Estoque', linha: 'Por loja, com transferência e o que vai faltar', href: '#tela-estoque' },
      { nome: 'Preços', linha: 'Margem, markup e o preço sugerido', href: '#resolve' },
    ],
  },
  {
    nome: 'Pessoas',
    Icone: IconePessoas,
    itens: [
      { nome: 'Clientes', linha: 'Histórico de compra e programa de pontos', href: '#tela-clientes' },
      { nome: 'Equipe', linha: 'Cada pessoa com o seu papel e a sua loja, meta, comissão e estrelas', href: '#tela-tarefas' },
      { nome: 'Tarefas', linha: 'O quadro da loja: quem está com o quê', href: '#tela-tarefas' },
    ],
  },
  {
    nome: 'Dinheiro',
    Icone: IconeDinheiro,
    itens: [
      { nome: 'Financeiro', linha: 'Contas a pagar e o resultado do mês', href: '#tela-financeiro' },
      { nome: 'Fechamento', linha: 'O mês conferido item a item, guiado', href: '#tela-financeiro' },
      { nome: 'Análise', linha: 'Lojas lado a lado, curva ABC, dinheiro parado', href: '#tela-analise' },
    ],
  },
  {
    nome: 'Assistente',
    Icone: IconeAssistente,
    itens: [
      { nome: 'Assistente', linha: 'Ele propõe, uma pessoa confirma', href: '#assistente' },
      { nome: 'Auditoria', linha: 'O livro de tudo que mexeu, que ninguém edita nem apaga', href: '#seguranca' },
      { nome: 'Guia do Norte', linha: 'A ajuda que sabe o sistema, em toda tela', href: '#modos' },
    ],
  },
]

/** Os links soltos da barra, depois do "Produto". */
export const LINKS_BARRA: { nome: string; href: string }[] = [
  { nome: 'Para quem é', href: '#ramos' },
  { nome: 'Planos', href: '#planos' },
  { nome: 'Dúvidas', href: '#duvidas' },
]

/**
 * Para onde vai "Começar grátis".
 *
 * Não existe cadastro sozinho ainda: toda empresa nasce com a gente montando
 * o ambiente junto (ver o fechamento da página). Um botão que prometesse
 * "crie sua conta" e abrisse um e-mail seria a primeira mentira da página;
 * então ele leva para o fim, onde o texto diz exatamente o que acontece.
 */
export const COMECAR = '#comecar'
export const ENTRAR = '/exemplo/entrar'
export const EMAIL = 'contato@usenorte.com.br'

export const mailto = (assunto: string) =>
  `mailto:${EMAIL}?subject=${encodeURIComponent(assunto)}`
