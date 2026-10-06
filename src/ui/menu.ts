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
import { pode, type Sessao } from '../servidor/permissao'
import { moduloLigado } from '../servidor/modulos'

export const MENU = (slug: string): ItemMenu[] => [
  // O Painel mostra faturamento do dia, margem e ticket medio. Isso NAO e
  // coisa de quem opera o caixa: o dono nao quer que a balconista leia quanto
  // a loja fez hoje. Exige 'relatorio.ver', que e o numero.
  { href: `/${slug}`, titulo: 'Painel', exige: 'relatorio.ver' },

  // ── vender ──
  // "Recepção" no salão e na clínica, "Secretaria" na escola — o item e o
  // título do grupo (vocabulario.ts, `nomeDoGrupo`).
  { grupo: 'Vender', href: `/${slug}/balcao`, titulo: 'Balcão', exige: 'venda.criar', vocabulario: 'Balcao' },
  // Logo depois do balcão, porque é a segunda tela mais aberta de qualquer
  // loja: vender, e depois olhar o que vendeu. "Recebimentos" na clínica, no
  // salão e na escola; o endereço é o mesmo.
  { grupo: 'Vender', href: `/${slug}/vendas`, titulo: 'Vendas', exige: 'venda.ver', vocabulario: 'Vendas' },
  // O histórico dos turnos: quem abriu, quem fechou, e quanto faltou ou
  // sobrou. Sem esta tela a diferença do caixa ia para o livro e ninguém lia.
  { grupo: 'Vender', href: `/${slug}/caixa`, titulo: 'Caixa', exige: 'caixa.ver', avancado: true },
  { grupo: 'Vender', href: `/${slug}/crediario`, titulo: 'Crediário', exige: 'crediario.ver', modulo: 'crediario' },
  // O pedido que sai depois: bolo para sábado, buquê para as 16h, a peça que o
  // cliente paga metade hoje e busca na semana que vem. Só existe para quem
  // ligou o módulo — quem vende e entrega na hora nunca vê.
  { grupo: 'Vender', href: `/${slug}/encomendas`, titulo: 'Encomendas', exige: 'venda.ver', modulo: 'encomenda' },
  // O link que a loja manda para a cliente ver o que tem e pedir. Para todo
  // mundo: é o jeito mais curto de vender pelo WhatsApp e pelo Instagram. O
  // pedido que chega vira encomenda (abrir o catálogo liga as Encomendas).
  { grupo: 'Vender', href: `/${slug}/catalogo`, titulo: 'Catálogo', exige: 'venda.ver' },
  // A mensalidade da escola: o mês, quem pagou, quem está em atraso, e
  // receber. Ao lado do Crediário porque é a mesma conversa — dinheiro que
  // entra com a pessoa na frente —, e a secretaria abre as duas.
  { grupo: 'Vender', href: `/${slug}/mensalidades`, titulo: 'Mensalidades', exige: 'mensalidade.ver', modulo: 'escola' },

  // ── atendimento ──
  // Quem vende hora marcada (salão, clínica, escola) vive nesta tela: a
  // recepção abre a Agenda antes do Balcão.
  { grupo: 'Atendimento', href: `/${slug}/agenda`, titulo: 'Agenda', exige: 'agenda.ver', modulo: 'agenda' },
  // Quem trabalha aqui, com ou sem login. Existe com o Ponto (as horas) OU
  // com a Agenda (a lista de profissionais) — ver modulos.ts. Aparece para
  // quem bate o próprio ponto: cada um vê o seu, e só quem pode vê as horas
  // dos outros.
  { grupo: 'Atendimento', href: `/${slug}/funcionarios`, titulo: 'Funcionários', exige: 'ponto.proprio', ouExige: ['ponto.ver', 'equipe.ver'], modulos: ['ponto', 'agenda'] },
  // As turmas da escola: quem estuda em cada uma, quantas vagas sobram, e
  // matricular. Os alunos são a tela de Clientes, com a palavra "Alunos".
  { grupo: 'Atendimento', href: `/${slug}/turmas`, titulo: 'Turmas', exige: 'escola.ver', modulo: 'escola' },

  // ── catálogo ──
  // "Serviços e materiais" na clínica (vocabulario.ts).
  { grupo: 'Catálogo', href: `/${slug}/produtos`, titulo: 'Produtos', exige: 'produto.ver', vocabulario: 'Produtos' },
  { grupo: 'Catálogo', href: `/${slug}/estoque`, titulo: 'Estoque', exige: 'estoque.ver' },
  // A fábrica: ficha técnica, ordem de produção com lote e o pedido das
  // lojas. Exige só ver o estoque — produzir e mandar é mexer no estoque DA
  // fábrica, e isso a própria tela confere por unidade (servidor/fabrica.ts).
  { grupo: 'Catálogo', href: `/${slug}/fabrica`, titulo: 'Fábrica', exige: 'fabrica.ver', modulo: 'fabrica' },
  // O pedido ao fornecedor, com o custo. Receber é dar entrada no estoque.
  { grupo: 'Catálogo', href: `/${slug}/compras`, titulo: 'Compras', exige: 'compra.ver', modulo: 'compras' },
  // O esmalte, a luva, o algodão: quem atende anota o que gastou. Item
  // próprio porque quem anota (a recepção) não vê as compras.
  { grupo: 'Catálogo', href: `/${slug}/compras/consumo`, titulo: 'Material usado', exige: 'estoque.consumir', modulo: 'compras' },
  // Margem, markup e o preço que a margem alvo pede. Exige mexer em preço, e
  // não só ver produto: quem não pode mudar o preço não precisa ver o custo.
  { grupo: 'Catálogo', href: `/${slug}/precos`, titulo: 'Preços', exige: 'produto.preco', avancado: true },

  // ── pessoas ──
  // O nome muda com o ramo: "Pacientes" na clínica, "Alunos" na escola (ver
  // servidor/vocabulario.ts). A tela é a mesma.
  { grupo: 'Pessoas', href: `/${slug}/clientes`, titulo: 'Clientes', exige: 'cliente.ver', vocabulario: 'Pessoas' },
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
  // O roteiro de WhatsApp para CLIENTES (frase → mensagens → fim). Ao lado do
  // Assistente porque sai pelo mesmo número e pede o mesmo módulo; o plano
  // sem campanhas vê a tela trancada, com o plano que abre.
  // As campanhas são do Farol (o direcionamento digital, contratado à parte);
  // saem pelo número do assistente, que o servidor também exige (campanhas/acesso.ts).
  { grupo: 'Empresa', href: `/${slug}/farol`, titulo: 'Farol', exige: 'agente.configurar', modulo: 'farol' },
  { grupo: 'Empresa', href: `/${slug}/campanhas`, titulo: 'Campanhas', exige: 'agente.configurar', modulo: 'farol' },
  // O livro de tudo que mexeu. Ele é escrito por todo canto do sistema desde
  // o primeiro dia e não tinha onde ser lido — o que é o mesmo que não ter.
  { grupo: 'Empresa', href: `/${slug}/auditoria`, titulo: 'Auditoria', exige: 'auditoria.ver', avancado: true },
  // Abrir, editar e fechar loja. Aparece mesmo para quem tem uma só: é onde
  // mora o endereço, o horário e o ramo dela — e onde a segunda nasce.
  { grupo: 'Empresa', href: `/${slug}/lojas`, titulo: 'Lojas', exige: 'empresa.configurar' },
  { grupo: 'Empresa', href: `/${slug}/assinatura`, titulo: 'Assinatura', exige: 'empresa.configurar' },
  // O programa de parceiros do lado do cliente: o dono indica o Norte e
  // recebe a comissão no Pix (src/servidor/parceiros.ts).
  { grupo: 'Empresa', href: `/${slug}/indique`, titulo: 'Indique e ganhe', exige: 'empresa.configurar' },
  { grupo: 'Empresa', href: `/${slug}/configuracoes`, titulo: 'Configurações', exige: 'empresa.configurar' },
]

/** A pessoa abre o item? A capacidade dele, ou qualquer uma das alternativas. */
export function podeVerItem(sessao: Sessao, i: Pick<ItemMenu, 'exige' | 'ouExige'>): boolean {
  return pode(sessao, i.exige) || !!i.ouExige?.some((c) => pode(sessao, c))
}

/** O item existe nesta empresa? Módulo único, ou qualquer um da lista. */
export function itemNaEmpresa(i: Pick<ItemMenu, 'modulo' | 'modulos'>, empresa: { modulos: string[] }): boolean {
  if (i.modulo && !moduloLigado(empresa, i.modulo)) return false
  if (i.modulos && !i.modulos.some((m) => moduloLigado(empresa, m))) return false
  return true
}

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
