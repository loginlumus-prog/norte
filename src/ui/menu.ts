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
  // O Painel mostra faturamento do dia, margem e ticket medio. Isso NAO e
  // coisa de quem opera o caixa: o dono nao quer que a balconista leia quanto
  // a loja fez hoje, e ate hoje ela lia. Exigia 'venda.ver', que o balcao tem
  // porque precisa ver a propria venda que acabou de fechar — uma capacidade
  // fazendo dois trabalhos. Agora exige 'relatorio.ver', que e o numero.
  { href: `/${slug}`, titulo: 'Painel', exige: 'relatorio.ver' },
  { href: `/${slug}/balcao`, titulo: 'Balcão', exige: 'venda.criar' },
  // Logo depois do balcão, porque é a segunda tela mais aberta de qualquer
  // loja: vender, e depois olhar o que vendeu.
  { href: `/${slug}/vendas`, titulo: 'Vendas', exige: 'venda.ver' },
  { href: `/${slug}/produtos`, titulo: 'Produtos', exige: 'produto.ver' },
  { href: `/${slug}/estoque`, titulo: 'Estoque', exige: 'estoque.ver' },
  { href: `/${slug}/clientes`, titulo: 'Clientes', exige: 'cliente.ver' },
  { href: `/${slug}/crediario`, titulo: 'Crediário', exige: 'crediario.ver', modulo: 'crediario', emBreve: true },
  { href: `/${slug}/financeiro`, titulo: 'Financeiro', exige: 'financeiro.ver' },
  { href: `/${slug}/equipe`, titulo: 'Equipe', exige: 'equipe.ver' },
  { href: `/${slug}/agente`, titulo: 'Assistente', exige: 'agente.configurar', modulo: 'agente' },
  { href: `/${slug}/assinatura`, titulo: 'Assinatura', exige: 'empresa.configurar' },
]
