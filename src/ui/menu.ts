// O menu do sistema, em um lugar só.
//
// Cada item declara a capacidade que exige. A Estrutura filtra pela sessão,
// então quem não pode nem vê o item — e acrescentar uma tela nova é uma linha
// aqui, não uma caça a `if` espalhado pelas páginas.

import type { ItemMenu } from './Estrutura'

export const MENU = (slug: string): ItemMenu[] => [
  { href: `/${slug}`, titulo: 'Painel', exige: 'venda.ver' },
  { href: `/${slug}/balcao`, titulo: 'Balcão', exige: 'venda.criar' },
  { href: `/${slug}/produtos`, titulo: 'Produtos', exige: 'produto.ver' },
  { href: `/${slug}/estoque`, titulo: 'Estoque', exige: 'estoque.ver' },
  { href: `/${slug}/clientes`, titulo: 'Clientes', exige: 'cliente.ver' },
  { href: `/${slug}/crediario`, titulo: 'Crediário', exige: 'crediario.ver' },
  { href: `/${slug}/financeiro`, titulo: 'Financeiro', exige: 'financeiro.ver' },
  { href: `/${slug}/equipe`, titulo: 'Equipe', exige: 'equipe.ver' },
  { href: `/${slug}/agente`, titulo: 'Agente', exige: 'agente.configurar' },
]
