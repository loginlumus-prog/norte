'use server'

// SERVER ACTION É ENDEREÇO PÚBLICO.
//
// Não é "a função que o meu botão chama": é um POST que qualquer pessoa
// autenticada consegue montar na mão, com os argumentos que ela quiser. Então
// cada uma destas funções repete a checagem inteira — sessão viva E capacidade
// E unidade — mesmo quando a tela que a chama já escondeu o botão.
//
// Esconder o botão é conforto. A trava é aqui.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { exigir } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { registrarVenda, type PagamentoDaVenda } from '@/servidor/venda'
import { abrirCaixa, fecharCaixa, movimentarCaixa } from '@/servidor/caixa'
import { listarClientes, criarCliente } from '@/servidor/cliente'
import type { FormaPagamento } from '@prisma/client'

export type Achado = {
  id: string
  codigo: string | null
  descricao: string
  medida: string
  preco: number
  saldo: number
}

/**
 * Busca do balcão: código de etiqueta, código de barras ou pedaço do nome.
 *
 * O código bate EXATO e vem primeiro na lista — quem leu a etiqueta com o
 * leitor quer aquele item, não uma lista de parecidos.
 */
export async function procurar(
  slug: string,
  unidadeId: string,
  termo: string,
): Promise<Achado[]> {
  const s = await exigirSessao(slug)

  // A unidade vem do navegador, e o navegador é do usuário. Sem estas duas
  // linhas, o contador (que só deveria ver o financeiro) lê o catálogo inteiro
  // com preço e custo, e o balconista da loja A lê o estoque da loja B — basta
  // trocar o `unidadeId` na chamada.
  exigir(s, 'produto.ver', unidadeId)
  exigir(s, 'estoque.ver', unidadeId)

  const t = termo.trim()
  if (t.length < 2) return []

  return comoOrg(s.orgId, async (db) => {
    const vs = await db.variacao.findMany({
      where: {
        ativa: true,
        produto: { ativo: true },
        OR: [
          { codigo: { equals: t, mode: 'insensitive' } },
          { codigoBarras: t },
          { produto: { nome: { contains: t, mode: 'insensitive' } } },
        ],
      },
      take: 12,
      select: {
        id: true,
        codigo: true,
        ajustePreco: true,
        produto: { select: { nome: true, medida: true, precoVista: true } },
        opcoes: { select: { opcao: { select: { valor: true } } } },
        estoques: { where: { unidadeId }, select: { quantidade: true } },
      },
    })

    const achados = vs.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      medida: v.produto.medida as string,
      descricao:
        v.opcoes.length > 0
          ? `${v.produto.nome} — ${v.opcoes.map((o) => o.opcao.valor).join(' · ')}`
          : v.produto.nome,
      preco: Number(v.produto.precoVista ?? 0) + Number(v.ajustePreco ?? 0),
      saldo: Number(v.estoques[0]?.quantidade ?? 0),
    }))

    // Código exato na frente: é o caso do leitor de código de barras.
    const exato = t.toUpperCase()
    return achados.sort((a, b) =>
      a.codigo?.toUpperCase() === exato ? -1 : b.codigo?.toUpperCase() === exato ? 1 : 0,
    )
  })
}

export type ItemEnviado = { variacaoId: string; quantidade: number; precoUnit: number }

export async function fecharVenda(
  slug: string,
  dados: {
    unidadeId: string
    caixaId: string | null
    itens: ItemEnviado[]
    pagamentos: { forma: string; valor: number }[]
    desconto: number
    clienteId?: string | null
    pontosUsar?: number
  },
) {
  const s = await exigirSessao(slug)

  const r = await registrarVenda(s, {
    unidadeId: dados.unidadeId,
    caixaId: dados.caixaId,
    itens: dados.itens,
    desconto: dados.desconto,
    clienteId: dados.clienteId ?? null,
    pontosUsar: dados.pontosUsar ?? 0,
    pagamentos: dados.pagamentos.map((p) => ({
      forma: p.forma as FormaPagamento,
      valor: p.valor,
    })) as PagamentoDaVenda[],
  })

  if (r.ok) revalidatePath(`/${slug}/balcao`)
  return r
}

export async function abrir(slug: string, unidadeId: string, saldo: number) {
  const s = await exigirSessao(slug)
  const r = await abrirCaixa(s, unidadeId, saldo)
  revalidatePath(`/${slug}/balcao`)
  return r
}

export async function fechar(slug: string, caixaId: string, contado: number, obs?: string) {
  const s = await exigirSessao(slug)
  const r = await fecharCaixa(s, caixaId, contado, obs)
  revalidatePath(`/${slug}/balcao`)
  return r
}

export async function movimentar(
  slug: string,
  caixaId: string,
  tipo: 'SANGRIA' | 'SUPRIMENTO',
  valor: number,
  motivo: string,
) {
  const s = await exigirSessao(slug)
  await movimentarCaixa(s, caixaId, tipo, valor, motivo)
  revalidatePath(`/${slug}/balcao`)
}

// ── o cliente da venda ───────────────────────────────────────
// Sem isto, o histórico do cliente é uma promessa que o balcão não cumpre: a
// ficha diz "escolha ela no balcão na próxima venda" e não existia onde
// escolher. Toda venda saía anônima, e a lista de clientes ficava sendo uma
// agenda de telefones.

export type ClienteNoBalcao = {
  id: string
  nome: string
  telefone: string | null
  compras: number
  gastou: number
  diasSemVir: number | null
  pontos: number
}

export async function procurarClientes(
  slug: string,
  termo: string,
): Promise<ClienteNoBalcao[]> {
  const s = await exigirSessao(slug)
  const t = termo.trim()
  if (t.length < 2) return []

  const achados = await listarClientes(s, t)
  return achados
    .filter((c) => c.ativo)
    .slice(0, 8)
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      telefone: c.telefone,
      compras: c.compras,
      gastou: c.gastou,
      pontos: c.pontos,
      diasSemVir: c.ultimaCompra
        ? Math.floor((Date.now() - c.ultimaCompra.getTime()) / 864e5)
        : null,
    }))
}

/**
 * Cadastro de uma linha só, feito com a pessoa na frente.
 *
 * Mandar a vendedora abrir outra tela para cadastrar, com a fila esperando, é
 * o mesmo que não ter cadastro: ela fecha a venda anônima e segue. Por isso
 * aqui só cabe nome e telefone — o resto se completa depois, na ficha.
 */
export async function cadastrarNoBalcao(
  slug: string,
  nome: string,
  telefone: string,
): Promise<{ ok: true; cliente: ClienteNoBalcao } | { ok: false; erro: string; jaExisteId?: string }> {
  const s = await exigirSessao(slug)

  const r = await criarCliente(s, { nome, telefone })
  if (!r.ok) {
    return {
      ok: false,
      erro: r.jaExiste
        ? `${r.jaExiste.nome} já usa esse telefone.`
        : r.motivo === 'documento_invalido'
          ? 'Esse CPF não confere.'
          : 'Falta o nome.',
      jaExisteId: r.jaExiste?.id,
    }
  }

  return {
    ok: true,
    cliente: {
      id: r.clienteId,
      nome: nome.trim(),
      telefone: telefone.trim() || null,
      compras: 0,
      gastou: 0,
      pontos: 0,
      diasSemVir: null,
    },
  }
}
