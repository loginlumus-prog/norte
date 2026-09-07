// Despesas de exemplo dos últimos dois meses.
//
// Existe para o DRE ter o que somar. Sem despesa, o relatório mostra lucro
// igual à receita — o que é bonito e mentira, e esconderia qualquer erro de
// conta que a gente cometesse.
//
// Os valores estão dimensionados para o faturamento do exemplo (~R$ 9 mil/mês).
// Não é detalhe: com despesa grande demais o relatório só mostra prejuízo, e
// aí não dá para ver se o verde da margem positiva funciona nem se a conta do
// lucro está certa. Exemplo tem que exercitar os dois lados.

import type { Client } from 'pg'

type Modelo = {
  categoria: string
  descricao: string
  valor: number
  dia: number
  fornecedor?: string
  /** Não paga: entra como conta a pagar, para a tela ter o que cobrar. */
  emAberto?: boolean
}

const TODO_MES: Modelo[] = [
  { categoria: 'Aluguel', descricao: 'Aluguel da loja', valor: 1200, dia: 5, fornecedor: 'Imobiliária Central' },
  { categoria: 'Salários e encargos', descricao: 'Folha da equipe', valor: 2100, dia: 5 },
  { categoria: 'Luz, água e internet', descricao: 'Energia', valor: 260, dia: 12, fornecedor: 'Coelba' },
  { categoria: 'Luz, água e internet', descricao: 'Internet', valor: 199, dia: 15, fornecedor: 'Vivo' },
  { categoria: 'Contabilidade', descricao: 'Honorários contábeis', valor: 420, dia: 10 },
  { categoria: 'Sistema e software', descricao: 'Mensalidade do sistema', valor: 697, dia: 10 },
  { categoria: 'Condomínio e IPTU', descricao: 'Condomínio', valor: 210, dia: 8 },
  { categoria: 'Embalagem e sacola', descricao: 'Sacolas e etiquetas', valor: 260, dia: 20 },
  { categoria: 'Anúncio e divulgação', descricao: 'Impulsionamento', valor: 180, dia: 18 },
  { categoria: 'Taxa de maquininha', descricao: 'Taxas do mês', valor: 190, dia: 28 },
  { categoria: 'Impostos sobre venda', descricao: 'Simples Nacional', valor: 340, dia: 20 },
  { categoria: 'Compra de mercadoria', descricao: 'Reposição de grade', valor: 5400, dia: 14, fornecedor: 'Distribuidora Norte' },
]

/** As deste mês que ainda não foram pagas — para a tela de contas a pagar. */
const EM_ABERTO: Modelo[] = [
  { categoria: 'Compra de mercadoria', descricao: 'Pedido de reposição', valor: 3200, dia: -3, fornecedor: 'Distribuidora Norte', emAberto: true },
  { categoria: 'Luz, água e internet', descricao: 'Água', valor: 145, dia: 0, fornecedor: 'Embasa', emAberto: true },
  { categoria: 'Outras despesas', descricao: 'Manutenção do ar-condicionado', valor: 380, dia: 6, emAberto: true },
]

export async function semearFinanceiro(cliente: Client, orgId: string, unidadeId: string) {
  const { rows: jaTem } = await cliente.query<{ n: string }>(
    'select count(*)::int as n from lancamentos where org_id = $1',
    [orgId],
  )
  if (Number(jaTem[0]!.n) > 0) return 0

  const { rows: cats } = await cliente.query<{ id: string; nome: string }>(
    'select id, nome from categorias_financeiras where org_id = $1',
    [orgId],
  )
  const idDe = new Map(cats.map((c) => [c.nome, c.id]))
  if (idDe.size === 0) return 0

  const { rows: contas } = await cliente.query<{ id: string }>(
    "select id from contas_financeiras where org_id = $1 and tipo = 'BANCO' limit 1",
    [orgId],
  )
  const contaId = contas[0]?.id ?? null

  const hoje = new Date()
  let n = 0

  // Dois meses fechados, tudo pago.
  for (const mesesAtras of [1, 0]) {
    for (const m of TODO_MES) {
      const cat = idDe.get(m.categoria)
      if (!cat) continue
      const venc = new Date(hoje.getFullYear(), hoje.getMonth() - mesesAtras, m.dia)
      // O mês corrente só conta o que já venceu.
      if (venc > hoje) continue

      await cliente.query(
        `insert into lancamentos (id, org_id, unidade_id, categoria_id, conta_id, tipo,
                                  descricao, valor, vencimento, pago_em, fornecedor, quem,
                                  criado_em, atualizado_em)
         values ($1,$2,$3,$4,$5,'DESPESA',$6,$7,$8,$8,$9,'sistema',now(),now())`,
        [`lanc-${orgId}-${mesesAtras}-${n}`, orgId, unidadeId, cat, contaId,
         m.descricao, m.valor, venc, m.fornecedor ?? null],
      )
      n++
    }
  }

  // O que ainda não foi pago, para a tela de contas a pagar ter conteúdo:
  // uma vencida, uma vencendo hoje, uma futura.
  for (const m of EM_ABERTO) {
    const cat = idDe.get(m.categoria)
    if (!cat) continue
    const venc = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + m.dia)
    await cliente.query(
      `insert into lancamentos (id, org_id, unidade_id, categoria_id, conta_id, tipo,
                                descricao, valor, vencimento, pago_em, fornecedor, quem,
                                criado_em, atualizado_em)
       values ($1,$2,$3,$4,$5,'DESPESA',$6,$7,$8,null,$9,'sistema',now(),now())`,
      [`lanc-aberto-${orgId}-${n}`, orgId, unidadeId, cat, contaId,
       m.descricao, m.valor, venc, m.fornecedor ?? null],
    )
    n++
  }

  return n
}
