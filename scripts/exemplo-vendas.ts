// Histórico de vendas de exemplo, espalhado nos últimos 30 dias.
//
// Existe porque painel sem venda é painel de zeros: não dá para ver se "o que
// mais vende" está certo, se o filtro por unidade funciona, se o gráfico do
// mês tem a forma que deveria. Aqui as vendas saem por SQL direto (e não por
// registrarVenda) só por um motivo: precisamos de datas no passado, e a venda
// de verdade sempre acontece agora.
//
// Cada venda gera também o movimento de estoque correspondente — senão a
// conferência histórico-vs-saldo acusaria divergência.

import type { Client } from 'pg'

type Peca = { variacao: string; descricao: string; codigo: string; preco: number; peso?: boolean }

const CATALOGO: Peca[] = [
  { variacao: 'var-cam-azul-p', descricao: 'Camiseta canelada — Azul · P', codigo: 'CAM001', preco: 49.9 },
  { variacao: 'var-cam-azul-m', descricao: 'Camiseta canelada — Azul · M', codigo: 'CAM002', preco: 49.9 },
  { variacao: 'var-cam-azul-g', descricao: 'Camiseta canelada — Azul · G', codigo: 'CAM003', preco: 49.9 },
  { variacao: 'var-cam-preto-p', descricao: 'Camiseta canelada — Preto · P', codigo: 'CAM004', preco: 49.9 },
  { variacao: 'var-cam-preto-m', descricao: 'Camiseta canelada — Preto · M', codigo: 'CAM005', preco: 49.9 },
  { variacao: 'var-cam-preto-g', descricao: 'Camiseta canelada — Preto · G', codigo: 'CAM006', preco: 49.9 },
  { variacao: 'var-sorvete', descricao: 'Sorvete a granel', codigo: 'SOR001', preco: 44.9, peso: true },
]

// Peso na sorte: o M preto vende muito mais que o P azul, para o "mais
// vendido" ter o que ordenar em vez de sair tudo empatado.
const PESO = [1, 4, 2, 1, 6, 3, 5]

const VENDEDORES = [
  { id: 'usr-a1', nome: 'Ana' },
  { id: 'usr-a2', nome: 'Carlos' },
]

const FORMAS = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'PIX', 'DINHEIRO', 'CREDITO']

/** Sorteio com semente fixa: o exemplo é sempre o mesmo, e dá para comparar. */
function sorteio(semente: number) {
  let x = semente
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    return x / 0x7fffffff
  }
}

const cent = (v: number) => Math.round(v * 100)

export async function semearVendas(
  cliente: Client,
  orgId: string,
  unidades: { id: string; nome: string; fatia: number }[],
) {
  const { rows } = await cliente.query<{ n: string }>(
    'select count(*)::int as n from vendas where org_id = $1',
    [orgId],
  )
  if (Number(rows[0]!.n) > 0) return 0

  const dado = sorteio(20260907)
  const escolher = <T>(lista: T[], pesos?: number[]): T => {
    if (!pesos) return lista[Math.floor(dado() * lista.length)]!
    const total = pesos.reduce((a, b) => a + b, 0)
    let r = dado() * total
    for (let i = 0; i < lista.length; i++) {
      r -= pesos[i]!
      if (r <= 0) return lista[i]!
    }
    return lista[lista.length - 1]!
  }

  let feitas = 0
  const contador = new Map<string, number>()

  for (let diasAtras = 29; diasAtras >= 0; diasAtras--) {
    // Sábado vende mais; domingo quase nada. Dá forma ao gráfico.
    const data = new Date()
    data.setDate(data.getDate() - diasAtras)
    const diaSemana = data.getDay()
    const base = diaSemana === 0 ? 0 : diaSemana === 6 ? 6 : 3
    const quantas = base + Math.floor(dado() * 3)

    for (let k = 0; k < quantas; k++) {
      const unidade = escolher(unidades, unidades.map((u) => u.fatia))
      const vendedor = escolher(VENDEDORES)
      const hora = 9 + Math.floor(dado() * 10)
      const quando = new Date(data)
      quando.setHours(hora, Math.floor(dado() * 60), 0, 0)

      const numero = (contador.get(unidade.id) ?? 0) + 1
      contador.set(unidade.id, numero)

      const quantosItens = 1 + Math.floor(dado() * 2)
      const itens: { peca: Peca; qtd: number; totalCent: number }[] = []
      for (let j = 0; j < quantosItens; j++) {
        const peca = escolher(CATALOGO, PESO)
        const qtd = peca.peso ? Math.round((0.2 + dado() * 0.8) * 1000) / 1000 : 1 + Math.floor(dado() * 2)

        // O exemplo respeita o saldo, igual à venda de verdade. Descontar por
        // fora deixaria o estoque negativo — e um exemplo que só existe em
        // estado impossível não serve para conferir coisa nenhuma.
        const { rows: saldo } = await cliente.query<{ q: string }>(
          'select quantidade as q from estoque where variacao_id = $1 and unidade_id = $2',
          [peca.variacao, unidade.id],
        )
        if (Number(saldo[0]?.q ?? 0) < qtd) continue

        itens.push({ peca, qtd, totalCent: Math.round(cent(peca.preco) * qtd) })
      }

      if (itens.length === 0) continue

      const totalCent = itens.reduce((s, i) => s + i.totalCent, 0)
      const vendaId = `venda-${orgId}-${unidade.id}-${numero}`

      await cliente.query(
        `insert into vendas (id, org_id, unidade_id, numero, vendedor_id, vendedor_nome,
                             situacao, subtotal, desconto, total, criada_em, concluida_em)
         values ($1,$2,$3,$4,$5,$6,'CONCLUIDA',$7,0,$7,$8,$8)`,
        [vendaId, orgId, unidade.id, numero, vendedor.id, vendedor.nome, totalCent / 100, quando],
      )

      for (const [j, it] of itens.entries()) {
        await cliente.query(
          `insert into venda_itens (id, org_id, venda_id, variacao_id, descricao, codigo,
                                    medida, quantidade, preco_unit, desconto, total, custo_unit)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11)`,
          [
            `${vendaId}-i${j}`, orgId, vendaId, it.peca.variacao, it.peca.descricao, it.peca.codigo,
            it.peca.peso ? 'KG' : 'UN', it.qtd, it.peca.preco, it.totalCent / 100,
            it.peca.peso ? 18.5 : 22.0,
          ],
        )

        // estoque acompanha a venda, senão a conferência acusa divergência
        await cliente.query(
          `update estoque set quantidade = quantidade - $1
            where variacao_id = $2 and unidade_id = $3`,
          [it.qtd, it.peca.variacao, unidade.id],
        )
        await cliente.query(
          `insert into movimentos_estoque
             (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois,
              motivo, referencia, quem, criado_em)
           select $1,$2,$3,$4,'VENDA',$5, coalesce(e.quantidade,0), $6, $7, $8, $9
             from estoque e where e.variacao_id = $3 and e.unidade_id = $4`,
          [
            `${vendaId}-m${j}`, orgId, it.peca.variacao, unidade.id, -it.qtd,
            `Venda ${numero}`, vendaId, vendedor.nome, quando,
          ],
        )
      }

      await cliente.query(
        `insert into pagamentos (id, org_id, venda_id, forma, valor, parcelas, criado_em)
         values ($1,$2,$3,$4,$5,1,$6)`,
        [`${vendaId}-p`, orgId, vendaId, escolher(FORMAS), totalCent / 100, quando],
      )

      feitas++
    }
  }

  // O contador da unidade precisa continuar de onde o exemplo parou, senão a
  // primeira venda de verdade repetiria um número já usado.
  for (const [unidadeId, ultimo] of contador) {
    await cliente.query('update unidades set proxima_venda = $1 where id = $2', [
      ultimo + 1,
      unidadeId,
    ])
  }

  return feitas
}
