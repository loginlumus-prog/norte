// O menu do sistema, em um lugar só.
//
// Cada item declara a capacidade que exige. A Estrutura filtra pela sessão,
// então quem não pode nem vê o item — e acrescentar uma tela nova é uma linha
// aqui, não uma caça a `if` espalhado pelas páginas.
//
// `emBreve` marca o que está no plano e ainda não foi construído. Ele existe
// porque a alternativa era pior: item que leva a 404 faz o sistema parecer
// QUEBRADO, e a pessoa que clicou não tem como saber se o problema é ela.
// Marcado, o item continua contando a história do produto sem prometer tela
// que não abre. Tirar o `emBreve` é o último passo de cada fase.

import type { ItemMenu } from './Estrutura'

export const MENU = (slug: string): ItemMenu[] => [
  { href: `/${slug}`, titulo: 'Painel', exige: 'venda.ver' },
  { href: `/${slug}/balcao`, titulo: 'Balcão', exige: 'venda.criar' },
  { href: `/${slug}/produtos`, titulo: 'Produtos', exige: 'produto.ver' },
  { href: `/${slug}/estoque`, titulo: 'Estoque', exige: 'estoque.ver' },
  { href: `/${slug}/clientes`, titulo: 'Clientes', exige: 'cliente.ver', emBreve: true },
  { href: `/${slug}/crediario`, titulo: 'Crediário', exige: 'crediario.ver', modulo: 'crediario', emBreve: true },
  { href: `/${slug}/financeiro`, titulo: 'Financeiro', exige: 'financeiro.ver' },
  { href: `/${slug}/equipe`, titulo: 'Equipe', exige: 'equipe.ver', emBreve: true },
  { href: `/${slug}/agente`, titulo: 'Assistente', exige: 'agente.configurar', modulo: 'agente' },
]
