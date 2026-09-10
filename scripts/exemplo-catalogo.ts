// Catálogo de exemplo. Serve para duas coisas:
//
// 1. dar o que olhar nas telas durante o desenvolvimento;
// 2. exercitar os DOIS formatos de produto que o modelo precisa aguentar —
//    um que varia em dois eixos (camiseta: cor × tamanho) e outro que não
//    varia e é vendido por peso (sorvete a granel). Se algum dia o modelo
//    voltar a assumir "cor e tamanho", o sorvete quebra primeiro.

import type { Client } from 'pg'

export async function semearCatalogo(cliente: Client, orgId: string, unidadeId: string) {
  const { rows } = await cliente.query<{ n: string }>(
    'select count(*)::int as n from produtos where org_id = $1',
    [orgId],
  )
  if (Number(rows[0]!.n) > 0) return false

  // ── eixos que esta empresa usa ──────────────────────────────
  await cliente.query(
    `insert into eixos (id, org_id, nome, ordem, eh_cor) values
       ('eixo-cor',     $1, 'Cor',     0, true),
       ('eixo-tamanho', $1, 'Tamanho', 1, false)`,
    [orgId],
  )

  await cliente.query(
    `insert into opcoes (id, org_id, eixo_id, valor, ordem, hex) values
       ('op-azul',  $1, 'eixo-cor', 'Azul',  0, '#2B5C8A'),
       ('op-preto', $1, 'eixo-cor', 'Preto', 1, '#1B1B1B'),
       ('op-p', $1, 'eixo-tamanho', 'P', 0, null),
       ('op-m', $1, 'eixo-tamanho', 'M', 1, null),
       ('op-g', $1, 'eixo-tamanho', 'G', 2, null)`,
    [orgId],
  )

  // ── as gavetas do catálogo ──────────────────────────────────
  // Duas, uma por produto. Existem para a grade do balcão ter abas: sem
  // categoria, os botões aparecem todos juntos — o que serve para dez itens e
  // não serve para cem.
  await cliente.query(
    `insert into categorias (id, org_id, nome, ordem, criada_em) values
       ('cat-camisetas', $1, 'Camisetas', 0, now()),
       ('cat-sorvetes',  $1, 'Sorvetes',  1, now())`,
    [orgId],
  )

  // ── produto que varia em dois eixos ─────────────────────────
  await cliente.query(
    `insert into produtos (id, org_id, nome, marca, medida, categoria_id, preco_vista, preco_cartao,
                           preco_crediario, custo, ativo, criado_em, atualizado_em)
     values ('prod-camiseta', $1, 'Camiseta canelada', 'Básica', 'UN', 'cat-camisetas',
             49.90, 54.90, 59.90, 22.00, true, now(), now())`,
    [orgId],
  )
  await cliente.query(
    `insert into produto_eixos (id, org_id, produto_id, eixo_id, ordem) values
       ('pe-1', $1, 'prod-camiseta', 'eixo-cor', 0),
       ('pe-2', $1, 'prod-camiseta', 'eixo-tamanho', 1)`,
    [orgId],
  )

  // 2 cores x 3 tamanhos = 6 variações, cada uma com seu código de etiqueta
  const cores = [
    ['azul', 'op-azul'],
    ['preto', 'op-preto'],
  ]
  const tamanhos = [
    ['p', 'op-p'],
    ['m', 'op-m'],
    ['g', 'op-g'],
  ]
  let n = 1
  for (const [cor, opCor] of cores) {
    for (const [tam, opTam] of tamanhos) {
      const id = `var-cam-${cor}-${tam}`
      await cliente.query(
        `insert into variacoes (id, org_id, produto_id, codigo, padrao, ativa, criada_em)
         values ($1, $2, 'prod-camiseta', $3, false, true, now())`,
        [id, orgId, `CAM${String(n).padStart(3, '0')}`],
      )
      await cliente.query(
        `insert into variacao_opcoes (id, org_id, variacao_id, opcao_id) values
           ($1, $2, $3, $4), ($5, $2, $3, $6)`,
        [`vo-${n}a`, orgId, id, opCor, `vo-${n}b`, opTam],
      )
      // Saldo inicial COM o movimento que o justifica. Gravar saldo sem
      // movimento faria a conferência histórico-vs-saldo acusar divergência
      // no primeiro uso — e uma conferência que grita à toa vira ruído que
      // todo mundo aprende a ignorar.
      const q = [70, 120, 40, 90, 25, 60][n - 1]!
      await cliente.query(
        `insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, minimo, atualizado_em)
         values ($1, $2, $3, $4, $5, 3, now())`,
        [`est-${n}`, orgId, id, unidadeId, q],
      )
      await cliente.query(
        `insert into movimentos_estoque
           (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, motivo, quem, criado_em)
         values ($1, $2, $3, $4, 'ENTRADA', $5, $5, 'Carga inicial do exemplo', 'sistema', now())`,
        [`mov-${n}`, orgId, id, unidadeId, q],
      )
      n++
    }
  }

  // ── produto que NÃO varia e é vendido por peso ──────────────
  // Aqui está a prova de que o modelo não assume roupa: uma variação só,
  // marcada como padrão, medida em quilo, saldo com casas decimais.
  await cliente.query(
    `insert into produtos (id, org_id, nome, medida, categoria_id, preco_vista, preco_cartao,
                           preco_crediario, custo, ativo, criado_em, atualizado_em)
     values ('prod-sorvete', $1, 'Sorvete a granel', 'KG', 'cat-sorvetes',
             44.90, 47.90, 47.90, 18.50, true, now(), now())`,
    [orgId],
  )
  await cliente.query(
    `insert into variacoes (id, org_id, produto_id, codigo, padrao, ativa, criada_em)
     values ('var-sorvete', $1, 'prod-sorvete', 'SOR001', true, true, now())`,
    [orgId],
  )
  await cliente.query(
    `insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, minimo, atualizado_em)
     values ('est-sorvete', $1, 'var-sorvete', $2, 180.000, 5, now())`,
    [orgId, unidadeId],
  )
  await cliente.query(
    `insert into movimentos_estoque
       (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, motivo, quem, criado_em)
     values ('mov-sorvete', $1, 'var-sorvete', $2, 'ENTRADA', 180.000, 180.000,
             'Carga inicial do exemplo', 'sistema', now())`,
    [orgId, unidadeId],
  )

  return true
}
