// O assistente de exemplo, com o que ele já fez e o que está esperando.
//
// Existe para a tela do agente não abrir vazia. Tela vazia esconde tudo que
// importa nela: não dá para ver se o balanço soma certo, se a proposta
// aparece com o número, nem se o "esperando você" chama atenção.
//
// ── o que NÃO se semeia: recibo ──────────────────────────────
// Já houve aqui uma lista de recibos escritos à mão ("achou diferença no
// caixa de terça", "promoção da grade parada"), de tipos que o código nem
// sabe emitir. A tela do exemplo mostrava "Trouxe de volta" que empresa
// nenhuma de verdade jamais veria — demonstração de um produto que não existe.
//
// Agora o exemplo semeia o que ACONTECEU (uma reposição proposta e
// confirmada há 31 dias, com a mercadoria entrando depois) e deixa a conta
// do recibo para o código de verdade: `apurarRecibos` roda quando a tela do
// assistente abre e emite o recibo a partir das vendas do exemplo — o mesmo
// caminho de uma empresa real. Se a conta der zero, a tela mostra zero.

import type { Client } from 'pg'
import { cobrancaEmCentavos, custoEmCentavos } from '../src/servidor/custo-ia'

const PODERES = ['ver.resumo', 'ver.estoque', 'ver.contas', 'consultar.produto', 'lancar.despesa', 'pedir.compra']

/** A variação da reposição já confirmada: a Preto M, a que mais vende no exemplo. */
const REPOSTA = { variacao: 'var-cam-preto-m', nome: 'Camiseta canelada — Preto · M', codigo: 'CAM005', pedido: 30, saldoNoAviso: 4, custo: 22 }

const CONSUMO: { entrada: number; saida: number; diasAtras: number }[] = [
  { entrada: 48_000, saida: 3_200, diasAtras: 6 },
  { entrada: 61_000, saida: 4_100, diasAtras: 5 },
  { entrada: 39_000, saida: 2_800, diasAtras: 3 },
  { entrada: 72_000, saida: 5_400, diasAtras: 2 },
  { entrada: 25_000, saida: 1_900, diasAtras: 0 },
]

// As contas de `custo-ia.ts`, e não uma cópia: o custo (o que o fornecedor
// cobra) e o COBRADO (o que sai do crédito da loja). Só o custo era gravado,
// e o "Custou de IA" do exemplo aparecia R$ 0,00 — o balanço é quem lê o
// cobrado.
const MODELO = 'claude-sonnet-5'

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

  for (const [i, c] of CONSUMO.entries()) {
    await cliente.query(
      `insert into consumo_ia
         (id, org_id, agente_id, modelo, entrada_tokens, saida_tokens, custo_cent, cobrado_cent, criado_em)
       values ($1, $2, $3, $8, $4, $5, $6, $7, now() - ($9 || ' days')::interval)`,
      [
        `con-${orgId}-${i}`, orgId, agenteId, c.entrada, c.saida,
        custoEmCentavos(MODELO, c.entrada, c.saida), cobrancaEmCentavos(MODELO, c.entrada, c.saida),
        MODELO, c.diasAtras,
      ],
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
    // ── a reposição que já aconteceu ──
    // Proposta pela rotina de "vai faltar" há 31 dias, confirmada pela Ana, e
    // a mercadoria entrou dois dias depois. Com ela vão a conta a pagar que a
    // confirmação lançou e a ENTRADA no estoque (saldo e histórico juntos,
    // senão a conferência acusa divergência). O recibo NÃO: ele sai da conta
    // de `apurarRecibos` sobre as vendas do exemplo.
    const descricao = `Reposição: ${REPOSTA.pedido} × ${REPOSTA.nome} (cód. ${REPOSTA.codigo})`
    const valor = REPOSTA.pedido * REPOSTA.custo
    await cliente.query(
      `insert into propostas_agente
         (id, org_id, agente_id, poder, resumo, dados, valor, situacao, expira_em,
          respondida_em, quem_respondeu, criada_em)
       values ($1, $2, $3, 'pedir.compra', $4, $5::jsonb, $6, 'CONFIRMADA',
               now() - interval '30 days', now() - interval '31 days', 'Ana', now() - interval '31 days 2 hours')`,
      [
        `prop-${orgId}-reposta`,
        orgId,
        agenteId,
        `${descricao} — R$ ${valor.toFixed(2).replace('.', ',')} a custo.`,
        JSON.stringify({
          categoriaId: cat[0].id,
          unidadeId: null,
          descricao,
          valor,
          vencimento: new Date(Date.now() - 864e5).toISOString(),
          fornecedor: 'Distribuidora Norte',
          variacaoId: REPOSTA.variacao,
          quantidade: REPOSTA.pedido,
          saldoNaProposta: REPOSTA.saldoNoAviso,
          unidadeIds: ['uni-a1', 'uni-a2'],
        }),
        valor,
      ],
    )
    await cliente.query(
      `insert into lancamentos (id, org_id, unidade_id, categoria_id, tipo, descricao, valor,
                                vencimento, pago_em, fornecedor, quem, criado_em, atualizado_em)
       values ($1, $2, null, $3, 'DESPESA', $4, $5, (now() - interval '1 day')::date,
               (now() - interval '1 day')::date, 'Distribuidora Norte', 'Ana',
               now() - interval '31 days', now())`,
      [`lanc-${orgId}-reposta`, orgId, cat[0].id, descricao, valor],
    )
    await cliente.query(
      `update estoque set quantidade = quantidade + $1 where variacao_id = $2 and unidade_id = $3`,
      [REPOSTA.pedido, REPOSTA.variacao, uni[0].id],
    )
    await cliente.query(
      `insert into movimentos_estoque
         (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, motivo, quem, criado_em)
       select $1, $2, $3, $4, 'ENTRADA', $5, e.quantidade, 'Entrada — Distribuidora Norte', 'Ana',
              now() - interval '29 days'
         from estoque e where e.variacao_id = $3 and e.unidade_id = $4`,
      [`mov-${orgId}-reposta`, orgId, REPOSTA.variacao, uni[0].id, REPOSTA.pedido],
    )

    // ── e uma proposta esperando: é o estado que a tela precisa mostrar bem ──
    // Com o saldo e o ritmo que o exemplo tem de verdade, e com os dados que
    // a rotina grava — confirmada, ela segue o mesmo caminho da de cima.
    const { rows: pg } = await cliente.query<{ saldo: string; vendidos: string }>(
      `select coalesce((select sum(quantidade) from estoque where variacao_id = 'var-cam-preto-g'), 0) as saldo,
              coalesce((select sum(i.quantidade) from venda_itens i join vendas v on v.id = i.venda_id
                         where i.variacao_id = 'var-cam-preto-g' and v.situacao = 'CONCLUIDA'
                           and v.criada_em >= now() - interval '30 days'), 0) as vendidos`,
    )
    const saldo = Math.floor(Number(pg[0]?.saldo ?? 0))
    const porSemana = Math.round((Number(pg[0]?.vendidos ?? 0) / 30) * 7)
    await cliente.query(
      `insert into propostas_agente
         (id, org_id, agente_id, poder, resumo, dados, valor, situacao, expira_em, criada_em)
       values ($1, $2, $3, 'pedir.compra', $4, $5::jsonb, 448.00, 'AGUARDANDO', now() + interval '20 hours', now() - interval '2 hours')`,
      [
        `prop-${orgId}-1`,
        orgId,
        agenteId,
        `A Camiseta canelada Preto G tem ${saldo} peças e vende ${porSemana} por semana. Pedir 20 un x R$ 22,40 = R$ 448,00 na Distribuidora Norte, para 30 dias?`,
        JSON.stringify({
          categoriaId: cat[0].id,
          unidadeId: null,
          descricao: 'Reposição: 20 × Camiseta canelada — Preto · G (cód. CAM006)',
          valor: 448.0,
          vencimento: new Date(Date.now() + 30 * 864e5).toISOString(),
          fornecedor: 'Distribuidora Norte',
          variacaoId: 'var-cam-preto-g',
          quantidade: 20,
          saldoNaProposta: saldo,
          unidadeIds: ['uni-a1', 'uni-a2'],
        }),
      ],
    )
  }

  // 1 = o assistente nasceu agora (0 lá em cima = já existia).
  return 1
}
