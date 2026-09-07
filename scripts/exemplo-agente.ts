// O assistente de exemplo, com o que ele já fez e o que está esperando.
//
// Existe para a tela do agente não abrir vazia. Tela vazia esconde tudo que
// importa nela: não dá para ver se o balanço soma certo, se a proposta
// aparece com o número, nem se o "esperando você" chama atenção.
//
// A escolha dos números não é decorativa. O balanço tem que dar POSITIVO com
// folga (é o argumento de renovação), e o custo de IA tem que ser pequeno
// perto do que ele trouxe — porque é assim na vida real, e se o exemplo
// mostrasse o contrário a gente estaria demonstrando um produto que não vale.

import type { Client } from 'pg'

const PODERES = ['ver.resumo', 'ver.estoque', 'ver.contas', 'consultar.produto', 'lancar.despesa', 'pedir.compra']

// Os dias contam para trás a partir de HOJE, e o balanço da tela é do mês
// corrente. Por isso nenhum passa de 6: num dia 3, um recibo de "12 dias
// atrás" cai no mês passado e some da tela — e aí o exemplo mostra um
// assistente que não fez nada, que é o oposto do que ele precisa mostrar.
const RECIBOS: { tipo: string; valor: number; descricao: string; diasAtras: number }[] = [
  { tipo: 'RUPTURA_EVITADA', valor: 448.0, descricao: 'Avisou que a Camiseta canelada Preto G acabava quinta; reposição chegou antes', diasAtras: 6 },
  { tipo: 'ESTOQUE_DESTRAVADO', valor: 299.4, descricao: 'Sugeriu promoção da grade parada há 60 dias — saíram 6 peças', diasAtras: 4 },
  { tipo: 'DIVERGENCIA_ACHADA', valor: 87.5, descricao: 'Achou diferença no fechamento do caixa de terça', diasAtras: 3 },
  { tipo: 'RUPTURA_EVITADA', valor: 224.0, descricao: 'Repôs a grade Azul M antes de zerar', diasAtras: 1 },
]

const CONSUMO: { entrada: number; saida: number; diasAtras: number }[] = [
  { entrada: 48_000, saida: 3_200, diasAtras: 6 },
  { entrada: 61_000, saida: 4_100, diasAtras: 5 },
  { entrada: 39_000, saida: 2_800, diasAtras: 3 },
  { entrada: 72_000, saida: 5_400, diasAtras: 2 },
  { entrada: 25_000, saida: 1_900, diasAtras: 0 },
]

/** Mesma conta de `custo-ia.ts`, em SQL-land: sonnet a 1800/9000 por milhão. */
const custoCent = (entrada: number, saida: number) =>
  Math.ceil((entrada * 1800 + saida * 9000) / 1_000_000)

export async function semearAgente(cliente: Client, orgId: string) {
  const { rows: jaTem } = await cliente.query<{ n: string }>(
    'select count(*)::int as n from agentes where org_id = $1',
    [orgId],
  )
  if (Number(jaTem[0]!.n) > 0) return 0

  const agenteId = `agt-${orgId}`

  await cliente.query(
    `insert into agentes
       (id, org_id, nome, personalidade, saudacao, manual, ativo, canal, modelo,
        poderes, desconto_max_pct, valor_max_cent, gasto_dia_cent, mensagens_dia,
        criado_em, atualizado_em)
     values ($1, $2, 'Aurora',
       'Direta, educada e sem enrolação. Trata todo mundo por você e não usa emoji.',
       'Oi! Aqui é a Aurora, da loja. Em que posso ajudar?',
       'Abrimos de segunda a sábado, das 9h às 18h.
Troca em até 7 dias com a etiqueta e o comprovante.
Aceitamos Pix, cartão e dinheiro.
Quando não souber responder, avise que alguém da loja responde em seguida.',
       true, 'NENHUM', 'claude-sonnet-5',
       $3, 5, 50000, 1000, 300, now(), now())`,
    [agenteId, orgId, PODERES],
  )

  // Gatilhos: os dois que não dependem de módulo nenhum.
  await cliente.query(
    `insert into gatilhos_agente (id, org_id, agente_id, tipo, ativo, horario, dias, criado_em) values
       ($1, $2, $3, 'RELATORIO', true, '08:00', null, now()),
       ($4, $2, $3, 'RUPTURA',   true, null,    7,    now())`,
    [`gat-${orgId}-rel`, orgId, agenteId, `gat-${orgId}-rup`],
  )

  for (const [i, r] of RECIBOS.entries()) {
    await cliente.query(
      `insert into recibos_agente (id, org_id, agente_id, tipo, valor, descricao, criado_em)
       values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' days')::interval)`,
      [`rec-${orgId}-${i}`, orgId, agenteId, r.tipo, r.valor, r.descricao, r.diasAtras],
    )
  }

  for (const [i, c] of CONSUMO.entries()) {
    await cliente.query(
      `insert into consumo_ia
         (id, org_id, agente_id, modelo, entrada_tokens, saida_tokens, custo_cent, criado_em)
       values ($1, $2, $3, 'claude-sonnet-5', $4, $5, $6, now() - ($7 || ' days')::interval)`,
      [`con-${orgId}-${i}`, orgId, agenteId, c.entrada, c.saida, custoCent(c.entrada, c.saida), c.diasAtras],
    )
  }

  // Uma proposta esperando: é o estado que a tela precisa mostrar bem.
  // Categoria de mercadoria, para ela cair na linha certa do DRE se for aceita.
  const { rows: cat } = await cliente.query<{ id: string }>(
    `select id from categorias_financeiras where org_id = $1 and nome = 'Compra de mercadoria' limit 1`,
    [orgId],
  )
  const { rows: uni } = await cliente.query<{ id: string }>(
    `select id from unidades where org_id = $1 order by criada_em limit 1`,
    [orgId],
  )

  if (cat[0] && uni[0]) {
    await cliente.query(
      `insert into propostas_agente
         (id, org_id, agente_id, poder, resumo, dados, valor, situacao, expira_em, criada_em)
       values ($1, $2, $3, 'pedir.compra',
         'A Camiseta canelada Preto G tem 2 peças e vende 9 por semana. Pedir 20 un x R$ 22,40 = R$ 448,00 na Distribuidora Norte, para 30 dias?',
         $4::jsonb, 448.00, 'AGUARDANDO', now() + interval '20 hours', now() - interval '2 hours')`,
      [
        `prop-${orgId}-1`,
        orgId,
        agenteId,
        JSON.stringify({
          categoriaId: cat[0].id,
          unidadeId: uni[0].id,
          descricao: 'Reposição — Camiseta canelada Preto G',
          valor: 448.0,
          vencimento: new Date(Date.now() + 30 * 864e5).toISOString(),
          fornecedor: 'Distribuidora Norte',
        }),
      ],
    )
  }

  return RECIBOS.length
}
