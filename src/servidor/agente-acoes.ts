// O SIM do dono, para os poderes de cadastro, estoque, dinheiro, encomenda e
// crediário — o pedaço de `executar` (agente.ts) que cresceu quando o
// assistente passou a ajudar em "tudo, menos lançar venda".
//
// A regra é a mesma de lá, e é a que importa: cada poder chama o MESMO
// serviço que a tela chama, com a sessão de QUEM CONFIRMA (o dono). Não existe
// aqui uma linha que escreva no banco por conta própria — cadastro, preço,
// saldo e lançamento passam pelas recusas da tela (CPF que não confere,
// medida com saldo, produto com estoque, loja que não vende, conta já paga).
//
// Os `dados` vêm da proposta, que o NOSSO servidor montou (ver
// assistente/ferramentas-cadastro.ts e ferramentas-operacao.ts) — mas moram
// num Json no banco, então cada campo é lido de novo com o tipo conferido.
//
// Cada função devolve a frase do que foi feito ("ficha de Maria Souza
// criada."), que volta no WhatsApp depois do SIM; a recusa sobe como `Error`
// com a frase do serviço, que `responderProposta` repassa à pessoa.

import type { FormaPagamento, Medida, TipoLancamento } from '@prisma/client'
import { comoOrg } from './banco'
import { type Sessao } from './permissao'
import { criarCliente, editarCliente, type DadosCliente } from './cliente'
import { criarProduto, editarProduto, type DadosProduto } from './produto'
import { definirMinimo } from './entrada'
import { corrigirPeloContado, lancarPerda, transferir } from './estoque'
import { lancar, marcarPago } from './financeiro'
import { codigoEncomenda, criarEncomenda, formaSinalValida } from './encomenda'
import { parcelasEmAberto, receberParcela } from './crediario'
import { codigoCompra, criarPedido as criarPedidoDeCompra } from './compras'
import { criarPedido as criarPedidoAFabrica, FabricaPedePin } from './fabrica'
import { criarPostagem } from './vitrine'
import { salvarCatalogo } from './catalogo'
import { colunaDoDia, mostrarDiaDaColuna } from './dia'
import { mostrar } from './dinheiro'
import { quantidade as comMedida } from './texto'

type Dados = Record<string, unknown>

const txt = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const txtOuNulo = (v: unknown, max = 300) => txt(v, max) || null
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)
const numOuNulo = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const dia = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const MEDIDAS: readonly Medida[] = ['UN', 'KG', 'G', 'L', 'ML', 'M', 'PAR', 'CX']
const medida = (v: unknown): Medida => (MEDIDAS.includes(v as Medida) ? (v as Medida) : 'UN')
const brl = (v: number) => mostrar(Math.round(v * 100))

/** A frase de quando o serviço pede o PIN de quem faz: pelo WhatsApp não há PIN. */
const PEDE_PIN = (tela: string) =>
  `Esta empresa pede a assinatura (o PIN) de quem faz isso, e pelo WhatsApp não tem como assinar. Faça pela tela de ${tela}.`

// ─────────────────────────────────────────────────────────────
// CLIENTE
// ─────────────────────────────────────────────────────────────

/** Os campos da ficha que a proposta carrega — os mesmos do formulário da tela. */
const CAMPOS_CLIENTE = ['nome', 'telefone', 'documento', 'email', 'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep', 'observacoes'] as const

function fichaDosDados(c: Dados): DadosCliente {
  const nasc = dia(c.nascimento)
  return {
    nome: txt(c.nome, 120),
    telefone: txtOuNulo(c.telefone, 20),
    documento: txtOuNulo(c.documento, 20),
    email: txtOuNulo(c.email, 120),
    // 'T12:00' como a tela: a data dita é a gravada, sem pular dia por fuso.
    nascimento: nasc ? new Date(`${nasc}T12:00:00`) : null,
    endereco: txtOuNulo(c.endereco, 200),
    numero: txtOuNulo(c.numero, 20),
    bairro: txtOuNulo(c.bairro, 80),
    cidade: txtOuNulo(c.cidade, 80),
    estado: txtOuNulo(c.estado, 2),
    cep: txtOuNulo(c.cep, 10),
    observacoes: txtOuNulo(c.observacoes, 1000),
  }
}

export async function executarCadastroDeCliente(sessao: Sessao, dados: Dados): Promise<string> {
  const ficha = fichaDosDados((dados.cliente ?? {}) as Dados)
  const r = await criarCliente(sessao, ficha)
  if (!r.ok) throw new Error(r.jaExiste ? `${r.motivo} (${r.jaExiste.nome}). Nada foi cadastrado.` : r.motivo)
  return `ficha de ${ficha.nome} criada.`
}

/**
 * Editar é por cima do que está gravado AGORA: `editarCliente` grava a ficha
 * inteira (é o formulário da tela), então o que a pessoa não pediu para mudar
 * sai do banco, e só o que ela pediu entra por cima. Ler na hora do sim — e
 * não na hora do pedido — é o que impede a proposta de desfazer o telefone
 * que alguém corrigiu na tela entre uma coisa e outra.
 */
export async function executarEdicaoDeCliente(sessao: Sessao, dados: Dados): Promise<string> {
  const clienteId = txt(dados.clienteId, 64)
  const mudancas = (dados.mudancas ?? {}) as Dados
  const atual = await comoOrg(sessao.orgId, (db) =>
    db.cliente.findUnique({
      where: { id: clienteId },
      select: {
        nome: true, telefone: true, documento: true, email: true, nascimento: true, endereco: true, numero: true,
        bairro: true, cidade: true, estado: true, cep: true, observacoes: true, ativo: true,
      },
    }),
  )
  if (!atual) throw new Error('Esse cliente não foi encontrado.')
  const base: Dados = {
    ...Object.fromEntries(CAMPOS_CLIENTE.map((k) => [k, atual[k]])),
    nascimento: atual.nascimento ? atual.nascimento.toISOString().slice(0, 10) : null,
  }
  for (const k of [...CAMPOS_CLIENTE, 'nascimento'] as const) {
    if (k in mudancas) base[k] = mudancas[k]
  }
  const ficha = fichaDosDados(base)
  const ativo = typeof mudancas.ativo === 'boolean' ? mudancas.ativo : undefined
  const r = await editarCliente(sessao, clienteId, { ...ficha, ...(ativo !== undefined ? { ativo } : {}) })
  if (!r.ok) throw new Error(r.jaExiste ? `${r.motivo} (${r.jaExiste.nome}). Nada mudou.` : r.motivo)
  return ativo === false && atual.ativo
    ? `ficha de ${ficha.nome} desativada.`
    : `ficha de ${ficha.nome} atualizada.`
}

// ─────────────────────────────────────────────────────────────
// PRODUTO
// ─────────────────────────────────────────────────────────────

const lojasDosDados = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export async function executarCadastroDeProduto(sessao: Sessao, dados: Dados): Promise<string> {
  const p: DadosProduto = {
    nome: txt(dados.nome, 120),
    medida: medida(dados.medida),
    precoVista: num(dados.precoVista),
    precoCartao: numOuNulo(dados.precoCartao),
    custo: numOuNulo(dados.custo),
    categoriaId: txtOuNulo(dados.categoriaId, 64),
    marca: txtOuNulo(dados.marca, 80),
    vendidoEm: lojasDosDados(dados.vendidoEm),
  }
  const r = await criarProduto(sessao, p)
  if (!r.ok) throw new Error(r.precisaPin ? PEDE_PIN('Produtos') : r.motivo)
  const v = await comoOrg(sessao.orgId, (db) =>
    db.variacao.findFirst({ where: { produtoId: r.produtoId }, orderBy: { codigo: 'asc' }, select: { codigo: true } }),
  )
  return `produto ${p.nome} cadastrado${v?.codigo ? ` (cód. ${v.codigo})` : ''}.`
}

/** Só o que a proposta mudou entra em `editarProduto` — o resto da ficha fica como está. */
const CAMPOS_PRODUTO = ['nome', 'precoVista', 'precoCartao', 'custo', 'categoriaId', 'ativo', 'vendidoEm'] as const

export async function executarEdicaoDeProduto(sessao: Sessao, dados: Dados): Promise<string> {
  const produtoId = txt(dados.produtoId, 64)
  const m = (dados.mudancas ?? {}) as Dados
  const mudancas: Partial<DadosProduto> & { ativo?: boolean } = {}
  for (const k of CAMPOS_PRODUTO) {
    if (!(k in m)) continue
    if (k === 'nome') mudancas.nome = txt(m.nome, 120)
    else if (k === 'ativo') mudancas.ativo = m.ativo === true
    else if (k === 'categoriaId') mudancas.categoriaId = txtOuNulo(m.categoriaId, 64)
    else if (k === 'vendidoEm') mudancas.vendidoEm = lojasDosDados(m.vendidoEm)
    else if (k === 'precoVista') mudancas.precoVista = num(m.precoVista)
    else mudancas[k] = numOuNulo(m[k])
  }
  const nome = mudancas.nome || txt(dados.nome, 120) || 'o produto'
  const feito: string[] = []
  if (Object.keys(mudancas).length > 0) {
    const r = await editarProduto(sessao, produtoId, mudancas)
    if (!r.ok) throw new Error(r.precisaPin ? PEDE_PIN('Produtos') : r.motivo)
    feito.push(mudancas.ativo === false ? `${nome} saiu de venda` : mudancas.ativo === true ? `${nome} voltou a vender` : `ficha de ${nome} atualizada`)
  }
  const minimo = dados.minimo as Dados | undefined
  if (minimo && typeof minimo === 'object') {
    const q = num(minimo.quantidade)
    try {
      await definirMinimo(sessao, txt(minimo.variacaoId, 64), txt(minimo.unidadeId, 64), q)
    } catch (e) {
      // A ficha já foi salva: a frase diz o que ficou e o que não.
      const porque = e instanceof Error && e.name !== 'SemPermissao' ? e.message : 'isso não é do seu acesso nessa loja'
      if (feito.length > 0) throw new Error(`${feito.join('; ')}, mas o estoque mínimo não mudou: ${porque}`)
      throw e
    }
    feito.push(`estoque mínimo de ${nome}${txt(minimo.loja, 80) ? ` na ${txt(minimo.loja, 80)}` : ''}: ${comMedida(q, medida(minimo.medida))}`)
  }
  if (feito.length === 0) throw new Error('A proposta não tinha nada para mudar.')
  return `${feito.join('; ')}.`
}

// ─────────────────────────────────────────────────────────────
// ESTOQUE
// ─────────────────────────────────────────────────────────────

/** "3 un de Picolé de morango" — o item como o resumo da proposta escreveu. */
const item = (dados: Dados, q: number) => `${comMedida(q, medida(dados.medida))} de ${txt(dados.nome, 160) || 'item'}`

export async function executarPerda(sessao: Sessao, dados: Dados): Promise<string> {
  const quantidade = num(dados.quantidade)
  const r = await lancarPerda(sessao, {
    variacaoId: txt(dados.variacaoId, 64),
    unidadeId: txt(dados.unidadeId, 64),
    quantidade,
    motivo: txt(dados.motivo, 200),
  })
  if (!r.ok) throw new Error(r.motivo === 'assinatura' ? PEDE_PIN('Estoque') : r.erro)
  const loja = txt(dados.loja, 80)
  return `perda de ${item(dados, quantidade)} lançada${loja ? ` na ${loja}` : ''}. Saldo agora: ${comMedida(r.saldo, medida(dados.medida))}.`
}

export async function executarContagem(sessao: Sessao, dados: Dados): Promise<string> {
  const contado = num(dados.contado)
  const visto = numOuNulo(dados.saldoVisto)
  const r = await corrigirPeloContado(sessao, {
    variacaoId: txt(dados.variacaoId, 64),
    unidadeId: txt(dados.unidadeId, 64),
    contado,
    motivo: txt(dados.motivo, 200),
    // O saldo que a proposta mostrou: se uma venda mexeu depois, a correção
    // por cima apagaria essa venda do estoque — o serviço recusa e diz o novo.
    saldoVisto: visto,
  })
  if (!r.ok) throw new Error(r.motivo === 'assinatura' ? PEDE_PIN('Estoque') : `${r.erro.replace(/ Confira a prateleira e mande de novo\.$/, '')} Peça a contagem de novo.`)
  const m = medida(dados.medida)
  const loja = txt(dados.loja, 80)
  return `estoque de ${txt(dados.nome, 160)}${loja ? ` na ${loja}` : ''} corrigido: era ${comMedida(r.antes, m)}, agora ${comMedida(r.saldo, m)}.`
}

export async function executarTransferencia(sessao: Sessao, dados: Dados): Promise<string> {
  const quantidade = num(dados.quantidade)
  const de = txt(dados.de, 80)
  const para = txt(dados.para, 80)
  const r = await transferir(sessao, {
    variacaoId: txt(dados.variacaoId, 64),
    deUnidadeId: txt(dados.deUnidadeId, 64),
    paraUnidadeId: txt(dados.paraUnidadeId, 64),
    quantidade,
    motivo: txtOuNulo(dados.motivo, 200) ?? undefined,
  })
  if (!r.ok) {
    const m = medida(dados.medida)
    throw new Error(
      r.motivo === 'assinatura'
        ? PEDE_PIN('Estoque')
        : r.motivo === 'sem_saldo'
          ? `Só tem ${comMedida(r.saldo ?? 0, m)} na ${de || 'loja de origem'} — não dá para mandar ${comMedida(quantidade, m)}.`
          : r.motivo === 'mesma_unidade'
            ? 'A loja de origem e a de destino são a mesma.'
            : 'A quantidade da transferência não serve.',
    )
  }
  const m = medida(dados.medida)
  return (
    `${item(dados, quantidade)} transferido${quantidade === 1 ? '' : 's'} da ${de} para a ${para}. ` +
    `Saldos agora: ${de} ${comMedida(r.saldoOrigem, m)}, ${para} ${comMedida(r.saldoDestino, m)}.`
  )
}

// ─────────────────────────────────────────────────────────────
// DINHEIRO
// ─────────────────────────────────────────────────────────────

/**
 * Receita (e, por baixo, o mesmo `lancar` da despesa). Já recebida, entra
 * com o dia em que o dinheiro chegou — a régua do DRE é o dia, não a hora.
 */
export async function executarReceita(sessao: Sessao, dados: Dados): Promise<string> {
  const recebidoEm = dia(dados.recebidoEm)
  const valor = num(dados.valor)
  await lancar(sessao, {
    categoriaId: txt(dados.categoriaId, 64),
    unidadeId: txtOuNulo(dados.unidadeId, 64),
    tipo: 'RECEITA',
    descricao: txt(dados.descricao, 200) || 'Lançado pelo assistente',
    valor,
    vencimento: new Date(String(dados.vencimento)),
    pagoEm: recebidoEm ? colunaDoDia(recebidoEm) : null,
    fornecedor: txt(dados.fornecedor, 120),
  })
  return `receita "${txt(dados.descricao, 200)}" de ${brl(valor)} lançada${recebidoEm ? ` como recebida em ${mostrarDiaDaColuna(colunaDoDia(recebidoEm), 'longo')}` : ' a receber'}.`
}

/**
 * Dar baixa. `marcarPago` também DESFAZ e REMARCA (o dia é escolhido): sem
 * esta conferência, a proposta de ontem para a conta que alguém já pagou
 * pela tela trocaria o dia do pagamento — e o mês em que ela entra no DRE.
 */
export async function executarBaixa(sessao: Sessao, dados: Dados): Promise<string> {
  const id = txt(dados.lancamentoId, 64)
  const quando = dia(dados.dia)
  if (!quando) throw new Error('A proposta veio sem o dia do pagamento.')
  const atual = await comoOrg(sessao.orgId, (db) =>
    db.lancamento.findUnique({ where: { id }, select: { descricao: true, tipo: true, valor: true, pagoEm: true } }),
  )
  if (!atual) throw new Error('Essa conta não existe mais.')
  const verbo = (t: TipoLancamento) => (t === 'RECEITA' ? 'recebida' : 'paga')
  if (atual.pagoEm) throw new Error(`Essa conta já está ${verbo(atual.tipo)} (em ${mostrarDiaDaColuna(atual.pagoEm, 'longo')}). Nada mudou.`)
  await marcarPago(sessao, id, colunaDoDia(quando))
  return `${atual.descricao} (${brl(Number(atual.valor))}) marcada como ${verbo(atual.tipo)} em ${mostrarDiaDaColuna(colunaDoDia(quando), 'longo')}.`
}

// ─────────────────────────────────────────────────────────────
// ENCOMENDA E CREDIÁRIO
// ─────────────────────────────────────────────────────────────

export async function executarNovaEncomenda(sessao: Sessao, dados: Dados): Promise<string> {
  const sinal = numOuNulo(dados.sinal) ?? 0
  const forma = formaSinalValida(dados.sinalForma) ? dados.sinalForma : null
  const r = await criarEncomenda(sessao, {
    unidadeId: txt(dados.unidadeId, 64),
    clienteNome: txt(dados.clienteNome, 120),
    telefone: txtOuNulo(dados.telefone, 20),
    descricao: txt(dados.descricao, 500),
    valor: num(dados.valor),
    sinal,
    sinalForma: sinal > 0 ? forma : null,
    dia: txt(dados.dia, 10),
    hora: txt(dados.hora, 5),
    entrega: dados.entrega === true,
    endereco: txtOuNulo(dados.endereco, 300),
    observacao: txtOuNulo(dados.observacao, 1000),
  })
  if (!r.ok) throw new Error(r.erro)
  return `encomenda ${codigoEncomenda(r.id)} anotada para ${txt(dados.clienteNome, 120)}.`
}

/**
 * Receber a parcela. O atraso é conferido DE NOVO, com a conta de hoje: a
 * proposta vale 24 horas, e o juro da parcela vencida anda um dia nesse meio
 * tempo. Receber com o atraso de ontem seria cobrar menos do que a regra —
 * um perdão que ninguém autorizou (e que `receberParcela` recusaria sem dizer
 * por quê). Aqui a frase diz, e o pedido se refaz com o número de hoje.
 */
export async function executarRecebimento(sessao: Sessao, dados: Dados): Promise<string> {
  const parcelaId = txt(dados.parcelaId, 64)
  const valor = num(dados.valor)
  const juros = num(dados.juros)
  const forma = txt(dados.forma, 20) as FormaPagamento
  const abertas = await parcelasEmAberto(sessao, txt(dados.clienteId, 64), [txt(dados.unidadeId, 64)])
  const p = abertas.find((x) => x.id === parcelaId)
  if (!p) throw new Error('Essa parcela não está mais em aberto (ou não é do seu acesso). Nada foi recebido.')
  if (Math.round(juros * 100) !== p.atrasoC) {
    throw new Error(
      `O atraso desta parcela mudou desde o pedido: era ${brl(juros)}, hoje é ${mostrar(p.atrasoC)}. Nada foi recebido — peça de novo para eu montar com o valor de hoje.`,
    )
  }
  const r = await receberParcela(sessao, { parcelaId, valor, juros, forma })
  if (!r.ok) {
    throw new Error(
      r.erro ??
        (r.motivo === 'ja_quitada'
          ? 'Essa parcela já está quitada.'
          : r.motivo === 'passa_do_resto'
            ? 'O valor passa do que falta nesta parcela.'
            : 'Não deu para receber essa parcela.'),
    )
  }
  const cliente = txt(dados.cliente, 120)
  return (
    `recebi ${brl(valor)} de ${cliente} (parcela ${p.numero}/${p.de}). ` +
    (r.quitada ? 'Parcela quitada.' : `Ainda falta ${brl(r.restante)} nesta parcela.`)
  )
}

// ─────────────────────────────────────────────────────────────
// PEDIDOS E CATÁLOGO
// ─────────────────────────────────────────────────────────────

type ItemPedido = { variacaoId: string; quantidade: number; custoUnit?: number | null }

function itensDoPedido(v: unknown): ItemPedido[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((b): ItemPedido[] => {
    if (!b || typeof b !== 'object') return []
    const i = b as Dados
    return [{ variacaoId: txt(i.variacaoId, 64), quantidade: num(i.quantidade), custoUnit: numOuNulo(i.custoUnit) }]
  })
}

/** O pedido de compra nasce rascunho, como na tela — mandar é outro passo. */
export async function executarPedidoDeCompra(sessao: Sessao, dados: Dados): Promise<string> {
  const r = await criarPedidoDeCompra(sessao, {
    unidadeId: txt(dados.unidadeId, 64),
    fornecedorId: txtOuNulo(dados.fornecedorId, 64),
    previsto: dia(dados.previsto),
    observacao: txtOuNulo(dados.observacao, 500),
    itens: itensDoPedido(dados.itens),
  })
  if (!r.ok) throw new Error(r.erro)
  return `pedido de compra ${codigoCompra(r.id)} montado (rascunho). Para mandar ao fornecedor, abra a tela de Compras.`
}

export async function executarPedidoAFabrica(sessao: Sessao, dados: Dados): Promise<string> {
  try {
    const p = await criarPedidoAFabrica(sessao, {
      lojaId: txt(dados.lojaId, 64),
      fabricaId: txtOuNulo(dados.fabricaId, 64),
      observacao: txtOuNulo(dados.observacao, 500),
      itens: itensDoPedido(dados.itens).map((i) => ({ variacaoId: i.variacaoId, quantidade: i.quantidade })),
    })
    return `pedido nº ${p.numero} feito à ${txt(dados.fabrica, 80) || 'fábrica'}.`
  } catch (e) {
    if (e instanceof FabricaPedePin) throw new Error(PEDE_PIN('Fábrica'))
    throw e
  }
}

export async function executarPostagem(sessao: Sessao, dados: Dados): Promise<string> {
  const stories = dados.stories === 'dia' || dados.stories === 'sempre' ? dados.stories : 'nao'
  const titulo = txt(dados.titulo, 80)
  await criarPostagem(sessao, txt(dados.unidadeId, 64), {
    titulo,
    texto: txtOuNulo(dados.texto, 400),
    produtoId: txtOuNulo(dados.produtoId, 64),
    stories,
    foto: null,
  })
  return `postagem "${titulo}" publicada no catálogo da ${txt(dados.loja, 80) || 'loja'}.`
}

/**
 * O ajuste do catálogo por cima do que está gravado AGORA: `salvarCatalogo`
 * grava o formulário inteiro (link, WhatsApp, Pix...), então o que a proposta
 * não mexe sai do banco e volta igual.
 */
export async function executarAjusteDoCatalogo(sessao: Sessao, dados: Dados): Promise<string> {
  const unidadeId = txt(dados.unidadeId, 64)
  const m = (dados.mudancas ?? {}) as Dados
  const atual = await comoOrg(sessao.orgId, (db) => db.catalogoLoja.findUnique({ where: { unidadeId } }))
  if (!atual) throw new Error('Essa loja não tem mais catálogo. Crie o link pela tela de Catálogo.')
  const bool = (k: string, antes: boolean) => (typeof m[k] === 'boolean' ? (m[k] as boolean) : antes)
  const valor = (k: string, antes: unknown) => (k in m ? num(m[k]) : antes == null ? null : Number(antes))
  const r = await salvarCatalogo(sessao, unidadeId, {
    ativo: bool('ativo', atual.ativo),
    endereco: atual.endereco,
    whatsapp: atual.whatsapp,
    recado: atual.recado,
    retirada: bool('retirada', atual.retirada),
    entrega: bool('entrega', atual.entrega),
    taxaEntrega: valor('taxaEntrega', atual.taxaEntrega),
    pedidoMinimo: valor('pedidoMinimo', atual.pedidoMinimo),
    chavePix: atual.chavePix,
    mostrarEsgotado: atual.mostrarEsgotado,
  })
  if (!r.ok) throw new Error(r.erro)
  return `catálogo da ${txt(dados.loja, 80) || 'loja'} ajustado.`
}
