// Um pedaço de SQL que várias listas de venda dividem. Mora sozinho porque
// quem usa (painel, cliente, farol, nicho) e encomenda.ts já se importam uns
// aos outros: pôr aqui evita o ciclo.

import { Prisma } from '@prisma/client'

/**
 * Para as listas de "mais vendidos": a linha do ACERTO de um pedido do
 * catálogo não é produto. É a taxa de entrega menos o sinal — sem produto
 * (`variacao_id` nulo), numa venda que recebeu encomenda com produtos do
 * cadastro. Ela entrava no topo da lista como "Encomenda ENC-…: pedido do
 * catálogo", com quantidade 1 e o valor do acerto.
 *
 * A encomenda de balcão (o bolo anotado à mão) continua: ali a linha É o
 * que se vendeu. Pede os apelidos `i` (venda_itens) e `v` (vendas).
 */
export const SEM_ACERTO_DE_CATALOGO = Prisma.sql`not (
  i.variacao_id is null and v.encomenda_id is not null
  and exists (select 1 from encomenda_itens ei
               where ei.encomenda_id = v.encomenda_id and ei.variacao_id is not null))`
