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
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { exigir, pode, SemPermissao } from '@/servidor/permissao'
import { horarioParaCobrar } from '@/servidor/agenda'
import { comoOrg, type BancoDaOrg } from '@/servidor/banco'
import {
  registrarVenda,
  EstoqueSumiu,
  PontosDisputados,
  ValeDisputado,
  type PagamentoDaVenda,
  type ResultadoVenda,
} from '@/servidor/venda'
import { abrirCaixa, fecharCaixa, movimentarCaixa } from '@/servidor/caixa'
import { PinNecessario } from '@/servidor/autorizacao'
import {
  listarClientes,
  cadastroRapido,
  editarNoBalcao,
  faltaNoCadastro,
  fichaNoBalcao as fichaCompleta,
  type FichaNoBalcao,
} from '@/servidor/cliente'
import { escada, type Tabela } from '@/servidor/preco'
import { consultarVale, valesParaUsarEm, type ValeNoBalcao } from '@/servidor/devolucao'
import { situacaoDosClientes } from '@/servidor/crediario'
import { diaEmSP } from '@/servidor/dia'
import type { FormaPagamento } from '@prisma/client'
import type { OpcaoDaVariacao, ProdutoNaVitrine } from './vitrine'
import { aVendaNaLoja, soDaLoja } from '@/servidor/catalogo-loja'
import { ondeOCodigo, pedacoDeCodigo, proximidade } from '@/servidor/etiqueta'

export type Achado = {
  id: string
  codigo: string | null
  descricao: string
  medida: string
  /** O preço à vista. É o que a grade e a busca mostram. */
  preco: number
  /**
   * Os três preços, já com o ajuste da variação e já preenchidos (cartão
   * vazio vale à vista, etc.). A forma de pagamento escolhe qual vale — ver
   * preco.ts. A tela mostra a escada; o servidor decide de novo ao fechar.
   */
  precos: Record<Tabela, number>
  saldo: number
  /**
   * As lojas que vendem este produto; vazio = todas (ver catalogo-loja.ts).
   * Vai junto para a linha do pedido: se a pessoa troca de loja com o pedido
   * montado, a tela sabe dizer o que a loja nova não vende.
   */
  vendidoEm?: string[]
  /**
   * O código existe, mas o produto não é vendido NESTA loja. Só vem na busca,
   * e só por código exato: é o bipe de uma etiqueta da outra loja, que a tela
   * explica em vez de lançar.
   */
  foraDaLoja?: boolean
  /**
   * É serviço (a manicure, a consulta): não tem estoque. O saldo vem com um
   * número de folga (SALDO_DE_SERVICO) para nenhuma conta da tela dizer
   * "acabou", e a tela mostra "serviço" no lugar do número.
   */
  servico?: boolean
  /**
   * Nunca teve estoque lançado NESTA loja (nenhuma linha de estoque): a loja
   * ainda não contou nem deu entrada. Zerado assim não é "acabou" — é "ainda
   * não controlo". A tela não pinta de vermelho; a venda segue a mesma régua
   * de sempre (vender sem estoque é chave da empresa).
   */
  semLancamento?: boolean
  /**
   * Só na busca: de que produto a variação é, e as opções dela. A tela junta
   * os tamanhos do mesmo produto num cartão só ("Bermuda Cargo · 7 opções")
   * e abre a escolha de tamanho, como na vitrine — e não sete cartões soltos.
   */
  grade?: { produtoId: string; nome: string; categoriaId: string | null; opcoes: OpcaoDaVariacao[] }
}

/** O saldo que o serviço leva para a tela: grande o bastante para nunca "acabar". */
const SALDO_DE_SERVICO = 999_999

type VariacaoLida = {
  id: string
  codigo: string | null
  ajustePreco: { toString(): string } | null
  produto: {
    nome: string
    medida: string
    precoVista: { toString(): string } | null
    precoCartao: { toString(): string } | null
    precoCrediario: { toString(): string } | null
    vendidoEm?: string[]
    servico?: boolean
  }
  opcoes: { opcao: { valor: string; ordem?: number; hex?: string | null; eixo?: { nome: string; ordem: number } } }[]
  estoques: { quantidade: { toString(): string } }[]
}

const SELECAO_DA_VARIACAO = {
  id: true,
  codigo: true,
  ajustePreco: true,
  produto: {
    select: {
      id: true, nome: true, medida: true, categoriaId: true,
      precoVista: true, precoCartao: true, precoCrediario: true, vendidoEm: true, servico: true,
    },
  },
  // Com o eixo e a ordem: a busca agrupa os tamanhos do mesmo produto num
  // cartão só, e a folha de escolha precisa saber o que é tamanho e o que é cor.
  opcoes: {
    select: { opcao: { select: { valor: true, ordem: true, hex: true, eixo: { select: { nome: true, ordem: true } } } } },
  },
} as const

/** Uma variação do banco vira o que o balcão precisa. Um lugar só, para a busca e a grade concordarem. */
function montarAchado(v: VariacaoLida): Achado {
  const ajuste = Number(v.ajustePreco ?? 0)
  const e = escada({
    vista: Number(v.produto.precoVista ?? 0),
    cartao: v.produto.precoCartao != null ? Number(v.produto.precoCartao) : null,
    crediario: v.produto.precoCrediario != null ? Number(v.produto.precoCrediario) : null,
  })
  return {
    id: v.id,
    codigo: v.codigo,
    medida: v.produto.medida,
    descricao:
      v.opcoes.length > 0
        ? `${v.produto.nome} — ${v.opcoes.map((o) => o.opcao.valor).join(' · ')}`
        : v.produto.nome,
    preco: e.vista + ajuste,
    precos: { vista: e.vista + ajuste, cartao: e.cartao + ajuste, crediario: e.crediario + ajuste },
    saldo: v.produto.servico ? SALDO_DE_SERVICO : Number(v.estoques[0]?.quantidade ?? 0),
    vendidoEm: v.produto.vendidoEm ?? [],
    ...(v.produto.servico ? { servico: true } : {}),
    ...(!v.produto.servico && v.estoques.length === 0 ? { semLancamento: true } : {}),
  }
}

/** O achado da busca, com o produto e as opções — para a tela agrupar a grade. */
function montarAchadoDaBusca(v: VariacaoLida & { produto: { id?: string; categoriaId?: string | null } }): Achado {
  return {
    ...montarAchado(v),
    ...(v.produto.id
      ? {
          grade: {
            produtoId: v.produto.id,
            nome: v.produto.nome,
            categoriaId: v.produto.categoriaId ?? null,
            opcoes: v.opcoes.map((o) => ({
              eixo: o.opcao.eixo?.nome ?? '',
              eixoOrdem: o.opcao.eixo?.ordem ?? 0,
              valor: o.opcao.valor,
              ordem: o.opcao.ordem ?? 0,
              hex: o.opcao.hex ?? null,
            })),
          },
        }
      : {}),
  }
}

/**
 * Busca do balcão: código de etiqueta, código de barras ou pedaço do nome.
 *
 * O código bate EXATO e vem primeiro na lista — quem leu a etiqueta com o
 * leitor quer aquele item, não uma lista de parecidos. A etiqueta do PRODUTO
 * (um número para a grade inteira, ver etiqueta.ts) traz a grade dele.
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
    const selecao = {
      ...SELECAO_DA_VARIACAO,
      estoques: { where: { unidadeId }, select: { quantidade: true } },
    }
    // Primeiro pelo CÓDIGO: o exato, o de barras e a etiqueta do produto
    // (005990 acha 005990-36, 005990-37... — ver etiqueta.ts). Separado do
    // nome e com teto maior, porque a grade de uma sandália passa fácil de
    // doze variações, e cortar a grade no meio esconde o número que a pessoa
    // tem na mão. Só o que ESTA loja vende: a sorveteria não acha camisa.
    const exatos = await db.variacao.findMany({
      where: {
        ativa: true,
        produto: { ativo: true, ...aVendaNaLoja(unidadeId) },
        OR: ondeOCodigo(t, true),
      },
      orderBy: { codigo: 'asc' },
      take: 60,
      select: selecao,
    })
    // Depois o PEDAÇO: "56522" acha 0056522, como no balcão de onde a loja
    // veio. Numa segunda passada, para nunca empurrar para fora o código
    // inteiro que a pessoa digitou.
    const pedacos = pedacoDeCodigo(t)
      ? await db.variacao.findMany({
          where: {
            ativa: true,
            id: { notIn: exatos.map((v) => v.id) },
            produto: { ativo: true, ...aVendaNaLoja(unidadeId) },
            OR: ondeOCodigo(t),
          },
          orderBy: { codigo: 'asc' },
          take: 40,
          select: selecao,
        })
      : []
    const porCodigo = [...exatos, ...pedacos]
    // Uma depois da outra, e não em Promise.all: dentro de comoOrg é uma
    // conexão só (ver `grade`).
    const porNome = await db.variacao.findMany({
      where: {
        ativa: true,
        id: { notIn: porCodigo.map((v) => v.id) },
        produto: { ativo: true, ...aVendaNaLoja(unidadeId) },
        OR: [
          { produto: { nome: { contains: t, mode: 'insensitive' } } },
          { produto: { marca: { contains: t, mode: 'insensitive' } } },
          // A referência do fornecedor, que está na caixa da peça.
          { produto: { referencia: { contains: t, mode: 'insensitive' } } },
        ],
      },
      take: 12,
      select: selecao,
    })

    // Código exato na frente: é o caso do leitor de código de barras. Depois
    // a grade da etiqueta, em ordem de código, e por último o que achou pelo nome.
    const perto = (c: string | null) => proximidade(c, t) ?? 9
    const achados = [...porCodigo.map(montarAchadoDaBusca)].sort((a, b) => perto(a.codigo) - perto(b.codigo))
    achados.push(...porNome.map(montarAchadoDaBusca))
    if (porCodigo.length > 0) return achados

    // Nenhum código desta loja bateu. Se o código existe no catálogo de OUTRA
    // loja, ele volta marcado — é a etiqueta do picolé bipada na loja de
    // roupa, e a pessoa precisa ouvir "isto não é vendido aqui", não "não
    // achei". Por nome, não: a sorveteria digitando "cam" não quer saber que
    // a loja do lado vende camisa.
    const deFora = await db.variacao.findFirst({
      where: {
        ativa: true,
        produto: { ativo: true, usoInterno: false, NOT: soDaLoja(unidadeId) },
        OR: ondeOCodigo(t, true),
      },
      select: selecao,
    })
    return deFora ? [{ ...montarAchado(deFora), foraDaLoja: true }, ...achados] : achados
  })
}

export type Grade = {
  categorias: { id: string; nome: string; quantos: number }[]
  itens: Achado[]
  /** Passou do teto de botões: a tela avisa para usar a busca. */
  cortou: boolean
}

/**
 * A grade de botões do balcão: os itens de uma categoria, para tocar em vez de
 * digitar.
 *
 * ── por que existe, se a busca já existe ─────────────────────
 * A busca serve para loja com etiqueta e leitor: bipa, Enter, próximo. Uma
 * sorveteria não tem etiqueta em picolé, nem uma lanchonete no X-salada — e
 * digitar "pic" a cada venda, com fila, é o que faz a pessoa voltar para o
 * caderno. Ali a venda é apertar um botão com o nome e o preço, que é como
 * todo sistema de balcão de alimentação funciona há vinte anos.
 *
 * As mesmas travas da busca: sessão, capacidade e unidade — o endereço é
 * público, e o botão escondido não é trava.
 */
export async function grade(
  slug: string,
  unidadeId: string,
  categoriaId: string | null,
): Promise<Grade> {
  const s = await exigirSessao(slug)
  exigir(s, 'produto.ver', unidadeId)
  exigir(s, 'estoque.ver', unidadeId)

  // Umas 120 por tela é o que cabe sem virar parede. Acima disso, a categoria
  // está grande demais para botão e a busca é o caminho.
  const TETO = 120

  return comoOrg(s.orgId, async (db) => {
    // Uma depois da outra, e não em Promise.all: dentro de comoOrg é UMA
    // conexão numa transação, o Postgres executa em fila de qualquer jeito, e
    // o driver `pg` já avisa que consulta em paralelo no mesmo cliente vai
    // deixar de funcionar na versão 9.
    const categorias = await categoriasComProduto(db, unidadeId)
    const vs = await db.variacao.findMany({
      where: {
        ativa: true,
        produto: { ativo: true, ...aVendaNaLoja(unidadeId), ...(categoriaId ? { categoriaId } : {}) },
      },
      orderBy: [{ produto: { nome: 'asc' } }, { codigo: 'asc' }],
      take: TETO + 1,
      select: {
        ...SELECAO_DA_VARIACAO,
        estoques: { where: { unidadeId }, select: { quantidade: true } },
      },
    })

    return {
      categorias,
      itens: vs.slice(0, TETO).map(montarAchado),
      cortou: vs.length > TETO,
    }
  })
}

type Db = BancoDaOrg

/**
 * As categorias que têm produto ativo VENDIDO NESTA LOJA, na ordem da empresa.
 * Categoria vazia vira aba que não leva a nada — e, na sorveteria, a aba
 * "Camisetas" com zero dentro.
 */
async function categoriasComProduto(db: Db, unidadeId: string) {
  const cs = await db.categoria.findMany({
    orderBy: { ordem: 'asc' },
    select: {
      id: true,
      nome: true,
      _count: { select: { produtos: { where: { ativo: true, ...aVendaNaLoja(unidadeId) } } } },
    },
  })
  return cs
    .filter((c) => c._count.produtos > 0)
    .map((c) => ({ id: c.id, nome: c.nome, quantos: c._count.produtos }))
}

export type Vitrine = {
  /** Só vem na primeira página; as seguintes reaproveitam as da tela. */
  categorias: { id: string; nome: string; quantos: number }[] | null
  produtos: ProdutoNaVitrine[]
  /** Tem mais produto depois destes: a tela mostra "Mostrar mais". */
  mais: boolean
}

/**
 * A vitrine do balcão simples: os PRODUTOS de uma categoria, cada um com as
 * suas variações dentro — ver vitrine.ts para o porquê de não ser variação
 * solta como na grade.
 *
 * ── e por que página, e não tudo de uma vez ──────────────────
 * Sorveteria tem trinta produtos e cabe numa tela. Loja de roupa pode ter
 * quatrocentos, com seis variações cada: mandar tudo seria uma resposta de
 * megabytes para a pessoa rolar uma parede. Vem de 36 em 36 (quatro telas de
 * tablet, mais ou menos), e o resto chega pelo "Mostrar mais" — ou, o que é
 * mais rápido nessa loja, pela busca, que continua em cima de tudo. Não
 * virtualizamos a lista: com 36 cartões por vez não há o que ganhar, e
 * virtualizar quebra o Tab e o "achar na página" do navegador.
 *
 * As mesmas travas da busca e da grade.
 */
export async function vitrine(
  slug: string,
  unidadeId: string,
  categoriaId: string | null,
  pular = 0,
): Promise<Vitrine> {
  const s = await exigirSessao(slug)
  exigir(s, 'produto.ver', unidadeId)
  exigir(s, 'estoque.ver', unidadeId)

  const POR_PAGINA = 36
  const desde = Math.max(0, Math.floor(Number(pular) || 0))

  return comoOrg(s.orgId, async (db) => {
    const categorias = desde === 0 ? await categoriasComProduto(db, unidadeId) : null
    const ps = await db.produto.findMany({
      where: {
        ativo: true,
        ...aVendaNaLoja(unidadeId),
        variacoes: { some: { ativa: true } },
        ...(categoriaId ? { categoriaId } : {}),
      },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      skip: desde,
      take: POR_PAGINA + 1,
      select: {
        id: true,
        nome: true,
        medida: true,
        precoVista: true,
        precoCartao: true,
        precoCrediario: true,
        vendidoEm: true,
        servico: true,
        categoriaId: true,
        variacoes: {
          where: { ativa: true },
          orderBy: [{ padrao: 'desc' }, { codigo: 'asc' }],
          select: {
            id: true,
            codigo: true,
            ajustePreco: true,
            opcoes: {
              select: {
                opcao: {
                  select: { valor: true, ordem: true, hex: true, eixo: { select: { nome: true, ordem: true } } },
                },
              },
            },
            estoques: { where: { unidadeId }, select: { quantidade: true } },
          },
        },
      },
    })

    return {
      categorias,
      mais: ps.length > POR_PAGINA,
      produtos: ps.slice(0, POR_PAGINA).map((p) => ({
        id: p.id,
        nome: p.nome,
        medida: p.medida,
        categoriaId: p.categoriaId,
        variacoes: p.variacoes.map((v) => ({
          // O mesmo montarAchado da busca e da grade: o preço que o cartão
          // mostra é o mesmo que a linha do pedido vai cobrar.
          ...montarAchado({ ...v, produto: p }),
          opcoes: v.opcoes.map((o) => ({
            eixo: o.opcao.eixo.nome,
            eixoOrdem: o.opcao.eixo.ordem,
            valor: o.opcao.valor,
            ordem: o.opcao.ordem,
            hex: o.opcao.hex,
          })),
        })),
      })),
    }
  })
}

export type ItemEnviado = {
  /** Nulo = avulso. */
  variacaoId: string | null
  quantidade: number
  precoUnit: number
  avulso?: { descricao: string; precoUnit: number }
}

export async function fecharVenda(
  slug: string,
  dados: {
    unidadeId: string
    caixaId: string | null
    itens: ItemEnviado[]
    pagamentos: {
      forma: string
      valor: number
      referencia?: string
      parcelas?: number
      maquininha?: string | null
      primeiroVencimento?: string | null
    }[]
    desconto: number
    /** A etiqueta velha da peça que saiu da promoção. Ver venda.ts. */
    acrescimo?: number
    /**
     * O PIN de quem autoriza (desconto acima do teto, avulso). Só vem depois
     * de o servidor pedir, e não fica guardado em lugar nenhum da tela.
     */
    pin?: string | null
    /** O CPF que a cliente ditou no crediário, para a ficha sem CPF. */
    clienteCpf?: string | null
    clienteId?: string | null
    vendedorId?: string | null
    pontosUsar?: number
    /** "Entregar às 15h", "retira a mãe". Vai para a venda como está, aparado. */
    observacoes?: string
    /** O horário da agenda que esta venda cobra ("Atender e cobrar"). */
    agendamentoId?: string | null
    /** A encomenda que esta venda recebe. O valor dela o servidor lê sozinho. */
    encomendaId?: string | null
    /** O troco devolvido em dinheiro. Não é pagamento — vai para o papel. */
    troco?: number
    /** A chave que esta tela gerou para a venda: mandar de novo não duplica. */
    chave?: string | null
    /** A venda foi feita sem internet: a hora (ms) em que aconteceu. Ver venda.ts. */
    offline?: { quando: number } | null
  },
): Promise<ResultadoVenda | { ok: false; motivo: 'recusa'; recado: string; soltar?: 'vale' | 'pontos' }> {
  const s = await exigirSessao(slug)
  const obs = dados.observacoes?.trim().slice(0, 500)

  // A venda que estoura no meio — a última peça levada por outro caixa, o
  // vale ou os pontos gastos no mesmo segundo em outra máquina — desfaz tudo
  // e LANÇA. Lançado de uma Server Action, o erro chega à tela sem a frase, e
  // a tela, sem saber se a venda entrou, dizia "a conexão caiu, confira em
  // Vendas". Aqui ele vira resposta: nada foi gravado, e a tela diz por quê.
  let r: ResultadoVenda
  try {
    r = await registrarVendaDoBalcao(slug, s, dados, obs)
  } catch (e) {
    if (e instanceof EstoqueSumiu) {
      return { ok: false, motivo: 'recusa', recado: `${e.message} Confira o estoque do pedido e conclua de novo.` }
    }
    if (e instanceof ValeDisputado) return { ok: false, motivo: 'recusa', recado: e.message, soltar: 'vale' }
    if (e instanceof PontosDisputados) return { ok: false, motivo: 'recusa', recado: e.message, soltar: 'pontos' }
    if (e instanceof SemPermissao) {
      return { ok: false, motivo: 'recusa', recado: 'Você não pode vender nesta loja. Nada foi gravado.' }
    }
    return {
      ok: false,
      motivo: 'recusa',
      recado: recadoDoErro(e, 'Não deu para fechar a venda, e nada foi gravado. Tente de novo.'),
    }
  }

  if (r.ok && dados.encomendaId) revalidatePath(`/${slug}/encomendas`)
  return r
}

/** A chamada da venda em si. Separada só para o `try` de cima caber inteiro. */
async function registrarVendaDoBalcao(
  slug: string,
  s: Awaited<ReturnType<typeof exigirSessao>>,
  dados: Parameters<typeof fecharVenda>[1],
  obs: string | undefined,
): Promise<ResultadoVenda> {
  const r = await registrarVenda(s, {
    encomendaId: typeof dados.encomendaId === 'string' && /^[\w-]{1,64}$/.test(dados.encomendaId) ? dados.encomendaId : null,
    unidadeId: dados.unidadeId,
    caixaId: dados.caixaId,
    itens: dados.itens.map((i) =>
      i.variacaoId
        ? { variacaoId: i.variacaoId, quantidade: i.quantidade, precoUnit: i.precoUnit }
        : { variacaoId: null, quantidade: i.quantidade, avulso: i.avulso },
    ),
    desconto: dados.desconto,
    acrescimo: Number(dados.acrescimo) || 0,
    autorizacao: typeof dados.pin === 'string' && dados.pin.trim() ? { pin: dados.pin.trim().slice(0, 12) } : null,
    clienteCpf: typeof dados.clienteCpf === 'string' && dados.clienteCpf.trim() ? dados.clienteCpf.trim().slice(0, 20) : null,
    clienteId: dados.clienteId ?? null,
    vendedorId: dados.vendedorId ?? null,
    pontosUsar: dados.pontosUsar ?? 0,
    observacoes: obs || undefined,
    troco: Number(dados.troco) || 0,
    chave: typeof dados.chave === 'string' ? dados.chave : null,
    offline: dados.offline && Number.isFinite(Number(dados.offline.quando)) ? { quando: new Date(Number(dados.offline.quando)) } : null,
    agendamentoId: typeof dados.agendamentoId === 'string' && /^[\w-]{1,64}$/.test(dados.agendamentoId) ? dados.agendamentoId : null,
    pagamentos: dados.pagamentos.map((p) => ({
      forma: p.forma as FormaPagamento,
      valor: p.valor,
      referencia: p.referencia,
      parcelas: p.parcelas,
      maquininha: typeof p.maquininha === 'string' ? p.maquininha.slice(0, 60) : null,
      primeiroVencimento:
        typeof p.primeiroVencimento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.primeiroVencimento) ? p.primeiroVencimento : null,
    })) as PagamentoDaVenda[],
  })

  if (r.ok) {
    revalidatePath(`/${slug}/balcao`)
    if (dados.agendamentoId) revalidatePath(`/${slug}/agenda`)
  }
  return r
}

// ── "Atender e cobrar", vindo da Agenda ──────────────────────

export type InicialDoBalcao = {
  agendamentoId: string
  /** "Joana — Manicure com Bia, sex 26/09 às 15:00" */
  rotulo: string
  cliente: ClienteNoBalcao | null
  itens: Achado[]
}

/**
 * O balcão aberto pela Agenda: o serviço do horário já lançado e o cliente
 * já escolhido. É a MESMA venda de sempre — a pessoa pode mudar tudo, somar
 * um esmalte, dar o desconto que pode. A venda, quando fecha, carimba o
 * horário (ver venda.ts). Chamada pela página do balcão, no servidor.
 */
export async function paraCobrarHorario(slug: string, agendamentoId: string, unidadeId: string): Promise<InicialDoBalcao | null> {
  const s = await exigirSessao(slug)
  exigir(s, 'venda.criar', unidadeId)
  if (!/^[\w-]{1,64}$/.test(agendamentoId)) return null
  const h = await horarioParaCobrar(s, agendamentoId)
  if (!h || h.unidadeId !== unidadeId) return null

  const itens: Achado[] = []
  if (h.variacaoId && pode(s, 'produto.ver', unidadeId)) {
    const v = await comoOrg(s.orgId, (db) =>
      db.variacao.findFirst({
        where: { id: h.variacaoId!, ativa: true, produto: { ativo: true, ...aVendaNaLoja(unidadeId) } },
        select: { ...SELECAO_DA_VARIACAO, estoques: { where: { unidadeId }, select: { quantidade: true } } },
      }),
    )
    if (v) itens.push(montarAchado(v))
  }

  let cliente: ClienteNoBalcao | null = null
  if (h.clienteId && pode(s, 'cliente.ver')) {
    const c = await comoOrg(s.orgId, async (db) => {
      const ficha = await db.cliente.findUnique({
        where: { id: h.clienteId! },
        select: { id: true, nome: true, telefone: true, pontos: true, ativo: true, anonimizadoEm: true },
      })
      if (!ficha || !ficha.ativo || ficha.anonimizadoEm) return null
      const compras = await db.venda.aggregate({
        where: { clienteId: ficha.id, situacao: 'CONCLUIDA' },
        _count: { _all: true },
        _sum: { total: true },
        _max: { criadaEm: true },
        _min: { criadaEm: true },
      })
      // As trazidas do sistema anterior: ela não é cliente nova (ver ClienteNoBalcao).
      const trazidas = await db.venda.aggregate({
        where: { clienteId: ficha.id, situacao: 'SALDO_IMPORTADO' },
        _count: { _all: true },
        _min: { criadaEm: true },
      })
      const sit = await situacaoDosClientes(db, [ficha.id])
      return { ficha, compras, trazidas, sit: sit.get(ficha.id) }
    })
    if (c) {
      cliente = {
        id: c.ficha.id,
        nome: c.ficha.nome,
        telefone: c.ficha.telefone,
        compras: c.compras._count._all,
        gastou: Number(c.compras._sum.total ?? 0),
        pontos: c.ficha.pontos,
        diasSemVir: c.compras._max.criadaEm ? Math.floor((Date.now() - c.compras._max.criadaEm.getTime()) / 864e5) : null,
        devendo: c.sit?.devendo ?? 0,
        vencido: c.sit?.vencido ?? 0,
        anteriores: c.trazidas._count._all,
        desde: maisAntiga(c.compras._min.criadaEm, c.trazidas._min.criadaEm),
      }
    }
  }
  return { agendamentoId: h.id, rotulo: h.rotulo, cliente, itens }
}

// ── o caixa ──────────────────────────────────────────────────
// As três DEVOLVEM o erro em vez de lançar. Erro lançado por Server Action
// chega ao navegador, em produção, sem a frase (o Next troca por um texto
// genérico em inglês, para não vazar detalhe) — e o "O valor precisa ser
// maior que zero" virava "An error occurred in the Server Components
// render". Pior no fechamento: o erro subia para a tela de erro inteira e o
// valor contado na gaveta, já digitado, sumia. Caso real: dois tablets na
// mesma loja, um fecha o caixa, o outro tenta fechar em seguida.

export async function abrir(slug: string, unidadeId: string, saldo: number) {
  try {
    const s = await exigirSessao(slug)
    const r = await abrirCaixa(s, unidadeId, saldo)
    revalidatePath(`/${slug}/balcao`)
    return r
  } catch (e) {
    return { ok: false as const, erro: recadoDoErro(e, 'Não deu para abrir o caixa. Tente de novo.') }
  }
}

export async function fechar(slug: string, caixaId: string, contado: number, obs?: string) {
  try {
    const s = await exigirSessao(slug)
    const r = await fecharCaixa(s, caixaId, contado, obs)
    revalidatePath(`/${slug}/balcao`)
    return { ok: true as const, ...r }
  } catch (e) {
    return { ok: false as const, erro: recadoDoErro(e, 'Não deu para fechar o caixa. Tente de novo.') }
  }
}

export async function movimentar(
  slug: string,
  caixaId: string,
  tipo: 'SANGRIA' | 'SUPRIMENTO',
  valor: number,
  motivo: string,
  /** O PIN de quem tira ou põe, quando a empresa pede assinatura nas exceções. */
  pin?: string | null,
): Promise<{ erro?: string; precisaPin?: boolean }> {
  try {
    const s = await exigirSessao(slug)
    await movimentarCaixa(s, caixaId, tipo, valor, motivo, pin)
    revalidatePath(`/${slug}/balcao`)
    return {}
  } catch (e) {
    if (e instanceof PinNecessario) return { erro: e.message, precisaPin: true }
    return { erro: recadoDoErro(e, 'Não deu para registrar. Tente de novo.') }
  }
}

// ── o vale de troca ──────────────────────────────────────────
// O balcão pergunta antes de aceitar: a pessoa digita o código do papel, a
// tela mostra o saldo e de quem é, e só então o vale entra como pagamento.
// Ao fechar, o servidor confere de novo e desconta — o que a tela viu é só
// para a conversa não travar.
export async function consultarValeAcao(slug: string, codigo: string, unidadeId?: string) {
  const s = await exigirSessao(slug)
  return consultarVale(s, codigo, unidadeId)
}

/**
 * O que o balcão precisa saber da cliente escolhida e a busca não traz: se a
 * ficha tem CPF (o crediário pergunta quando falta) e os vales que ela pode
 * gastar AQUI — que aparecem sozinhos no pagamento, sem ninguém digitar o
 * código do papel.
 */
export async function fichaNoBalcao(
  slug: string,
  clienteId: string,
  unidadeId: string,
): Promise<{ temCpf: boolean; vales: ValeNoBalcao[]; falta: string[] }> {
  const s = await exigirSessao(slug)
  exigir(s, 'venda.criar', unidadeId)
  if (!/^[\w-]{1,64}$/.test(clienteId)) return { temCpf: false, vales: [], falta: [] }
  return comoOrg(s.orgId, async (db) => {
    const c = await db.cliente.findUnique({
      where: { id: clienteId },
      select: { documento: true, telefone: true, endereco: true, anonimizadoEm: true },
    })
    if (!c) return { temCpf: false, vales: [], falta: [] }
    const org = await db.org.findUnique({ where: { id: s.orgId }, select: { valePorLoja: true } })
    return {
      temCpf: !!c.documento,
      vales: await valesParaUsarEm(db, clienteId, unidadeId, !!org?.valePorLoja),
      // "Cadastro incompleto — falta CPF": o balcão avisa e abre a ficha
      // para completar com a pessoa na frente (FichaDaCliente.tsx).
      falta: c.anonimizadoEm ? [] : faltaNoCadastro(c),
    }
  })
}

// ── a ficha da cliente, em tela cheia no balcão ──────────────
// Ver servidor/cliente.ts, `fichaNoBalcao`. A capacidade (`cliente.ver`, e o
// alcance de venda e de crediário por loja) é conferida lá.

export async function fichaDaClienteAcao(slug: string, clienteId: string): Promise<FichaNoBalcao | null> {
  const s = await exigirSessao(slug)
  if (!/^[\w-]{1,64}$/.test(clienteId)) return null
  return fichaCompleta(s, clienteId)
}

export type DadosDaFicha = {
  nome: string
  telefone: string
  documento: string
  email: string
  /** 'AAAA-MM-DD', ou ''. */
  nascimento: string
  endereco: string
  numero: string
  bairro: string
  cidade: string
  estado: string
  cep: string
}

/** Completar a ficha no balcão. Devolve o erro em vez de lançar (ver "o caixa", embaixo). */
export async function salvarDadosDaCliente(
  slug: string,
  clienteId: string,
  d: DadosDaFicha,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const s = await exigirSessao(slug)
    if (!/^[\w-]{1,64}$/.test(clienteId)) return { ok: false, erro: 'Cliente não encontrado.' }
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 200) : null)
    const nascimento = typeof d.nascimento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.nascimento) ? d.nascimento : null
    const r = await editarNoBalcao(s, clienteId, {
      nome: String(d.nome ?? '').slice(0, 200),
      telefone: texto(d.telefone),
      documento: texto(d.documento),
      email: texto(d.email),
      // 'T12:00' evita o pulo de dia por fuso: a data digitada é a gravada.
      nascimento: nascimento ? new Date(`${nascimento}T12:00:00`) : null,
      endereco: texto(d.endereco),
      numero: texto(d.numero),
      bairro: texto(d.bairro),
      cidade: texto(d.cidade),
      estado: texto(d.estado),
      cep: texto(d.cep),
    })
    if (!r.ok) return { ok: false, erro: r.jaExiste ? `${r.motivo} (${r.jaExiste.nome})` : r.motivo }
    revalidatePath(`/${slug}/clientes/${clienteId}`)
    return { ok: true }
  } catch (e) {
    if (e instanceof SemPermissao) return { ok: false, erro: 'Você não tem permissão para mudar o cadastro.' }
    return { ok: false, erro: recadoDoErro(e, 'Não deu para salvar. Tente de novo.') }
  }
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
  /** Quanto deve no crediário, e quanto disso está vencido. Zero quando nada. */
  devendo: number
  vencido: number
  /**
   * As compras trazidas do sistema anterior (o carnê importado). Não somam
   * em `compras` nem em `gastou`, mas dizem que ela não é cliente nova.
   * Opcional: a venda guardada no aparelho antes disto não tem o campo.
   */
  anteriores?: number
  /** O mês da compra mais antiga que se conhece ('AAAA-MM'), contando as trazidas. */
  desde?: string | null
}

/** O mês ('AAAA-MM', em São Paulo) da data mais antiga das que vierem. */
function maisAntiga(...datas: (Date | null | undefined)[]): string | null {
  const ok = datas.filter((d): d is Date => !!d)
  if (ok.length === 0) return null
  return diaEmSP(new Date(Math.min(...ok.map((d) => d.getTime())))).slice(0, 7)
}

export async function procurarClientes(
  slug: string,
  termo: string,
): Promise<ClienteNoBalcao[]> {
  const s = await exigirSessao(slug)
  const t = termo.trim()
  if (t.length < 2) return []

  const achados = (await listarClientes(s, t)).filter((c) => c.ativo).slice(0, 8)
  // "EM DIA" ou "ATRASADO" na hora de escolher a pessoa: é o que muda a
  // conversa antes de a venda começar, não depois.
  const situacao = await comoOrg(s.orgId, (db) =>
    situacaoDosClientes(db, achados.map((c) => c.id)),
  )
  return achados.map((c) => ({
    id: c.id,
    nome: c.nome,
    telefone: c.telefone,
    compras: c.compras,
    gastou: c.gastou,
    pontos: c.pontos,
    diasSemVir: c.ultimaCompra
      ? Math.floor((Date.now() - c.ultimaCompra.getTime()) / 864e5)
      : null,
    devendo: situacao.get(c.id)?.devendo ?? 0,
    vencido: situacao.get(c.id)?.vencido ?? 0,
    anteriores: c.anteriores,
    desde: c.primeiraCompra ? diaEmSP(c.primeiraCompra).slice(0, 7) : null,
  }))
}

/**
 * Cadastro de uma linha só, feito com a pessoa na frente.
 *
 * Mandar a vendedora abrir outra tela para cadastrar, com a fila esperando, é
 * o mesmo que não ter cadastro: ela fecha a venda anônima e segue. Por isso
 * aqui só cabe nome, telefone e o CPF (perguntado, nunca exigido) — o resto
 * se completa depois, na ficha.
 *
 * CPF que já está numa ficha não cria outra: a resposta aponta a ficha que
 * existe, e a tela oferece usar ela. Duas fichas da mesma pessoa são duas
 * dívidas que ninguém soma.
 */
export async function cadastrarNoBalcao(
  slug: string,
  nome: string,
  telefone: string,
  cpf = '',
): Promise<{ ok: true; cliente: ClienteNoBalcao } | { ok: false; erro: string; jaExiste?: ClienteNoBalcao }> {
  const s = await exigirSessao(slug)
  // A regra (CPF conferido, CPF e telefone que já têm ficha) mora em
  // servidor/cliente.ts, `cadastroRapido` — com teste.
  const r = await cadastroRapido(s, String(nome ?? ''), String(telefone ?? ''), String(cpf ?? ''))
  if (!r.ok) {
    if (!r.jaExiste) return { ok: false, erro: r.erro }
    // A ficha que já existe vem com a situação do crediário: escolher a
    // pessoa por aqui tem de avisar "deve · atrasado" igual à busca.
    const fiado = await comoOrg(s.orgId, (db) => situacaoDosClientes(db, [r.jaExiste!.id]))
    return {
      ok: false,
      erro: r.erro,
      jaExiste: {
        ...r.jaExiste,
        compras: 0,
        gastou: 0,
        diasSemVir: null,
        devendo: fiado.get(r.jaExiste.id)?.devendo ?? 0,
        vencido: fiado.get(r.jaExiste.id)?.vencido ?? 0,
      },
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
      devendo: 0,
      vencido: 0,
    },
  }
}
