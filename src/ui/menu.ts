// O menu do sistema, em um lugar só.
//
// Cada item declara a capacidade que exige. A Estrutura filtra pela sessão,
// então quem não pode nem vê o item — e acrescentar uma tela nova é uma linha
// aqui, não uma caça a `if` espalhado pelas páginas.
//
// ── por que tem grupo ────────────────────────────────────────
// Onze itens numa fileira só é uma lista telefônica: a pessoa lê de cima a
// baixo toda vez que procura alguma coisa. Agrupado pelo que a pessoa está
// FAZENDO — vendendo, cuidando do catálogo, cuidando de gente, cuidando do
// dinheiro, cuidando da empresa — o olho pula direto para o pedaço certo.
// O Painel fica fora de grupo, no topo: é a porta de entrada, não um assunto.
//
// `emBreve` marca o que está no plano e ainda não foi construído. Ele existe
// porque a alternativa era pior: item que leva a 404 faz o sistema parecer
// QUEBRADO, e a pessoa que clicou não tem como saber se o problema é ela.
// Tirar o `emBreve` é o último passo de cada fase.

import type { ItemMenu } from './Estrutura'
import type { Modo } from '@/servidor/modo'

export const MENU = (slug: string): ItemMenu[] => [
  // O Painel mostra faturamento do dia, margem e ticket medio. Isso NAO e
  // coisa de quem opera o caixa: o dono nao quer que a balconista leia quanto
  // a loja fez hoje. Exige 'relatorio.ver', que e o numero.
  { href: `/${slug}`, titulo: 'Painel', exige: 'relatorio.ver' },

  // ── vender ──
  { grupo: 'Vender', href: `/${slug}/balcao`, titulo: 'Balcão', exige: 'venda.criar' },
  // Logo depois do balcão, porque é a segunda tela mais aberta de qualquer
  // loja: vender, e depois olhar o que vendeu.
  { grupo: 'Vender', href: `/${slug}/vendas`, titulo: 'Vendas', exige: 'venda.ver' },
  // O histórico dos turnos: quem abriu, quem fechou, e quanto faltou ou
  // sobrou. Sem esta tela a diferença do caixa ia para o livro e ninguém lia.
  { grupo: 'Vender', href: `/${slug}/caixa`, titulo: 'Caixa', exige: 'caixa.ver', avancado: true },
  { grupo: 'Vender', href: `/${slug}/crediario`, titulo: 'Crediário', exige: 'crediario.ver', modulo: 'crediario' },
  // O pedido que sai depois: bolo para sábado, buquê para as 16h, a peça que o
  // cliente paga metade hoje e busca na semana que vem. Só existe para quem
  // ligou o módulo — quem vende e entrega na hora nunca vê.
  { grupo: 'Vender', href: `/${slug}/encomendas`, titulo: 'Encomendas', exige: 'venda.ver', modulo: 'encomenda' },

  // ── catálogo ──
  { grupo: 'Catálogo', href: `/${slug}/produtos`, titulo: 'Produtos', exige: 'produto.ver' },
  { grupo: 'Catálogo', href: `/${slug}/estoque`, titulo: 'Estoque', exige: 'estoque.ver' },
  // Margem, markup e o preço que a margem alvo pede. Exige mexer em preço, e
  // não só ver produto: quem não pode mudar o preço não precisa ver o custo.
  { grupo: 'Catálogo', href: `/${slug}/precos`, titulo: 'Preços', exige: 'produto.preco', avancado: true },

  // ── pessoas ──
  { grupo: 'Pessoas', href: `/${slug}/clientes`, titulo: 'Clientes', exige: 'cliente.ver' },
  { grupo: 'Pessoas', href: `/${slug}/equipe`, titulo: 'Equipe', exige: 'equipe.ver' },
  // O quadro da equipe: o que abrir, conferir, montar e ligar. Aparece para
  // quem trabalha na loja, não só para quem manda — a balconista vê a lista
  // de abertura e dá baixa no que é dela.
  { grupo: 'Pessoas', href: `/${slug}/tarefas`, titulo: 'Tarefas', exige: 'tarefa.ver' },

  // ── dinheiro ──
  { grupo: 'Dinheiro', href: `/${slug}/financeiro`, titulo: 'Financeiro', exige: 'financeiro.ver' },
  // As três leituras que o painel não dá: lojas lado a lado, curva ABC e a
  // escala dos turnos. O item aparece para quem lê relatório em qualquer
  // plano — quem não tem o Rede encontra lá dentro o que ele faz, e não um
  // item apagado no menu, que só ensina que existe algo escondido.
  { grupo: 'Dinheiro', href: `/${slug}/analise`, titulo: 'Análise', exige: 'relatorio.ver', avancado: true },

  // ── empresa ──
  { grupo: 'Empresa', href: `/${slug}/agente`, titulo: 'Assistente', exige: 'agente.configurar', modulo: 'agente' },
  // O livro de tudo que mexeu. Ele é escrito por todo canto do sistema desde
  // o primeiro dia e não tinha onde ser lido — o que é o mesmo que não ter.
  { grupo: 'Empresa', href: `/${slug}/auditoria`, titulo: 'Auditoria', exige: 'auditoria.ver', avancado: true },
  { grupo: 'Empresa', href: `/${slug}/assinatura`, titulo: 'Assinatura', exige: 'empresa.configurar' },
  { grupo: 'Empresa', href: `/${slug}/configuracoes`, titulo: 'Configurações', exige: 'empresa.configurar' },
]

/**
 * O que o menu mostra neste modo.
 *
 * No simples, as telas de análise saem do menu — mas a tela ABERTA agora
 * nunca sai: quem chegou nela por um link precisa ver onde está.
 */
export function noModo(itens: ItemMenu[], modo: Modo, ativo?: string): ItemMenu[] {
  if (modo === 'avancado') return itens
  return itens.filter((i) => !i.avancado || i.href === ativo)
}
