// Clientes de exemplo, e as vendas ligadas a eles.
//
// Ligar as vendas é o ponto: cliente sem histórico é uma agenda, e agenda não
// mostra nada do que a tela precisa provar — quanto a pessoa gastou, qual o
// ticket dela, e há quanto tempo ela sumiu.
//
// A distribuição é de propósito: alguns compram muito e há pouco tempo,
// outros sumiram faz meses, e um nunca comprou. Sem o sumido, não dá para
// ver o âmbar da tela nem testar a rotina de "cliente sumido" do assistente.

import type { Client } from 'pg'

const PESSOAS: { nome: string; telefone: string; obs?: string; fatia: number }[] = [
  { nome: 'Marta Nascimento', telefone: '71988810001', obs: 'Usa 38. Prefere ser avisada de manhã.', fatia: 6 },
  { nome: 'Rita Alves', telefone: '71988810002', obs: 'Sempre leva conjunto.', fatia: 5 },
  { nome: 'Cleide Souza', telefone: '71988810003', fatia: 4 },
  { nome: 'Val Ribeiro', telefone: '71988810004', obs: 'Só vem no fim do mês.', fatia: 3 },
  { nome: 'Nina Barros', telefone: '71988810005', fatia: 2 },
  { nome: 'Dona Zefa', telefone: '71988810006', obs: 'Compra para as netas. Não usa WhatsApp direito.', fatia: 1 },
  { nome: 'Silvana Matos', telefone: '71988810007', fatia: 1 },
  // Cadastrada e nunca comprou: é o caso que a tira de cima precisa contar.
  { nome: 'Joelma Pinto', telefone: '71988810008', obs: 'Cadastrada na fila do provador.', fatia: 0 },
]

export async function semearClientes(cliente: Client, orgId: string) {
  const { rows: jaTem } = await cliente.query<{ n: string }>(
    'select count(*)::int as n from clientes where org_id = $1',
    [orgId],
  )
  if (Number(jaTem[0]!.n) > 0) return 0

  const ids: { id: string; fatia: number }[] = []
  for (const [i, p] of PESSOAS.entries()) {
    const id = `cli-${orgId}-${i}`
    await cliente.query(
      `insert into clientes (id, org_id, nome, telefone, observacoes, ativo, criado_em, atualizado_em)
       values ($1, $2, $3, $4, $5, true, now(), now())`,
      [id, orgId, p.nome, p.telefone, p.obs ?? null],
    )
    ids.push({ id, fatia: p.fatia })
  }

  // Distribui as vendas já existentes entre eles, por fatia. As mais ANTIGAS
  // vão para quem tem fatia menor, para nascer alguém "sumido há meses" sem
  // precisar inventar data.
  const { rows: vendas } = await cliente.query<{ id: string }>(
    `select id from vendas where org_id = $1 and situacao = 'CONCLUIDA' order by criada_em asc`,
    [orgId],
  )

  const sorteio: string[] = []
  for (const { id, fatia } of ids) for (let i = 0; i < fatia; i++) sorteio.push(id)
  if (sorteio.length === 0) return ids.length

  // Só metade das vendas ganha cliente. Venda sem cliente é o caso mais comum
  // no balcão de verdade, e a tela precisa aguentar os dois.
  let n = 0
  for (const [i, v] of vendas.entries()) {
    if (i % 2 === 1) continue
    const dono = sorteio[n % sorteio.length]!
    await cliente.query('update vendas set cliente_id = $1 where id = $2', [dono, v.id])
    n++
  }

  // ── os pontos das compras que acabaram de ser ligadas ──────
  // Nasce do historico de verdade, uma linha por venda, com o saldo andando.
  // Semear so o saldo final deixaria a ficha com um numero que a propria tela
  // nao consegue explicar — e explicar o saldo e metade do que o extrato faz.
  const { rows: prog } = await cliente.query<{ ativo: boolean; por_real: string }>(
    'select pontos_ativo as ativo, pontos_por_real as por_real from orgs where id = $1',
    [orgId],
  )
  if (prog[0]?.ativo) {
    const porReal = Number(prog[0].por_real)
    for (const { id } of ids) {
      const { rows: compras } = await cliente.query<{ id: string; total: string; criada_em: Date }>(
        `select id, total, criada_em from vendas
          where cliente_id = $1 and situacao = 'CONCLUIDA' order by criada_em asc`,
        [id],
      )
      let saldo = 0
      for (const v of compras) {
        const ganhou = Math.floor((Math.round(Number(v.total) * 100) * porReal) / 100)
        if (ganhou <= 0) continue
        saldo += ganhou
        await cliente.query(
          `insert into movimentos_pontos
             (id, org_id, cliente_id, tipo, pontos, saldo_depois, venda_id, motivo, quem, criado_em)
           values ($1, $2, $3, 'GANHOU', $4, $5, $6, 'Compra no balcão', 'sistema', $7)`,
          [`mp-${v.id}`, orgId, id, ganhou, saldo, v.id, v.criada_em],
        )
      }
      if (saldo > 0) await cliente.query('update clientes set pontos = $1 where id = $2', [saldo, id])
    }
  }

  return ids.length
}
