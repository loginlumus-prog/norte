// As ferramentas da operação pelo WhatsApp: a perda, a contagem e a
// transferência de estoque; a baixa de uma conta; a encomenda nova; a parcela
// do crediário recebida.
//
// A mesma regra de ferramentas.ts: ESCREVER só monta a proposta; quem executa
// é o dono que confirma, pelos MESMOS serviços da tela (`lancarPerda`,
// `corrigirPeloContado`, `transferir`, `marcarPago`, `criarEncomenda`,
// `receberParcela` — ver agente-acoes.ts).
//
// As recusas que a tela faria são feitas AQUI também, antes de propor — tirar
// mais do que tem, transferir para a loja que não vende, encomenda com a data
// que passou, pagamento que não cobre o atraso. Não é a trava (a trava é o
// serviço, no sim); é para o dono não receber um pedido que vai falhar.
//
// E o que volta a quem pede é só o que monta o pedido: o saldo da peça que
// ela mesma vai mexer, a conta que ela disse, a parcela da cliente que pagou.

import type { FormaPagamento } from '@prisma/client'
import { comoOrg } from '../banco'
import { propor } from '../agente'
import { pode, unidadesQuePodem, type Capacidade, type Sessao } from '../permissao'
import type { ComModulos } from '../modulos'
import { mostrar } from '../dinheiro'
import { diaEmSP, mostrarDiaDaColuna } from '../dia'
import { quantidade as comMedida } from '../texto'
import { vendidoNaLoja } from '../catalogo-loja'
import { faltaPagar, ROTULO_FORMA_SINAL, validarEncomenda, type FormaSinal } from '../encomenda'
import { mostrarTelefone } from '../cliente'
import { parcelasEmAberto } from '../crediario'
import { unidadesVisiveis } from './contexto'
import {
  candidatosDe,
  converter,
  escolherLoja,
  escolherProduto,
  medidaDoTexto,
  nomeCompleto,
  normalizar,
  type Candidato,
} from './ferramentas-loja'
import { acharClientes, paraEscolher } from './ferramentas-cadastro'
import { aposentarAnteriores, RECADO_DO_FECHO } from './propostas'
import type { ResultadoFerramenta } from './ferramentas'

const MAXIMO_RESULTADO = 6000
const json = (v: unknown): ResultadoFerramenta => ({ texto: JSON.stringify(v).slice(0, MAXIMO_RESULTADO) })
const falha = (texto: string): ResultadoFerramenta => ({ texto, erro: true })
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)
const brl = (v: number) => mostrar(Math.round(v * 100))
const brlC = (c: number) => mostrar(Math.round(c))
const dataBR = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
const ehDia = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime())

type Loja = { id: string; nome: string; ehDeposito: boolean }

/** As lojas abertas em que a pessoa pode isso — com ou sem depósito. */
async function lojasQuePode(sessao: Sessao, cap: Capacidade, comDeposito: boolean): Promise<Loja[]> {
  const ids = await unidadesVisiveis(sessao, cap)
  return comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({
      where: { id: { in: ids }, ativa: true, ...(comDeposito ? {} : { ehDeposito: false, ehFabrica: false }) },
      orderBy: { criadaEm: 'asc' },
      select: { id: true, nome: true, ehDeposito: true },
    }),
  )
}

/**
 * A loja que a pessoa disse, dentre as dela; sem dizer, a única de venda que
 * ela alcança (o depósito só se for a única coisa). Nula = pergunta.
 */
function lojaDita(lojas: Loja[], pedida: string): Loja | null {
  if (pedida) return escolherLoja(lojas, pedida)
  const deVenda = lojas.filter((l) => !l.ehDeposito)
  if (deVenda.length === 1) return deVenda[0]!
  return lojas.length === 1 ? lojas[0]! : null
}

const perguntaDaLoja = (lojas: Loja[], oQue: string) =>
  lojas.length === 0 ? `Esta pessoa não ${oQue} em loja nenhuma.` : `Em qual loja? ${lojas.map((l) => l.nome).join(', ')}.`

/**
 * A peça pelo código ou pelo nome — a busca da entrada de compra
 * (`escolherProduto`), sem chutar: dois que servem viram pergunta.
 */
async function acharItem(orgId: string, pedido: string): Promise<{ item: Candidato } | { resultado: ResultadoFerramenta }> {
  if (pedido.length < 2) return { resultado: falha('Diga o nome ou o código da peça.') }
  const a = escolherProduto(pedido, await candidatosDe(orgId, [pedido]))
  if (a.tipo === 'um') return { item: a.produto }
  if (a.tipo === 'varios') {
    return {
      resultado: json({
        propostaCriada: false,
        escolherEntre: a.candidatos.map((c) => ({ produto: nomeCompleto(c), codigo: c.codigo })),
        recado: 'Há mais de um produto assim: pergunte qual é e chame de novo com o código.',
      }),
    }
  }
  return { resultado: falha(`Não achei "${pedido}" no cadastro (de produto que tem estoque).`) }
}

/** A quantidade dita, na medida do cadastro ("500 g" de produto em kg = 0,5). */
function naMedida(q: number, unidade: string, item: Candidato): number | string {
  const dita = unidade ? medidaDoTexto(unidade) : null
  if (unidade && !dita) return `Não entendi a unidade "${unidade}".`
  const r = converter(q, dita, item.medida)
  return r === null ? `${nomeCompleto(item)} é contado em ${comMedida(1, item.medida).split(' ')[1]}: pergunte quanto é nessa medida.` : r
}

async function saldoNa(orgId: string, variacaoId: string, unidadeId: string): Promise<number> {
  const e = await comoOrg(orgId, (db) =>
    db.estoque.findUnique({ where: { variacaoId_unidadeId: { variacaoId, unidadeId } }, select: { quantidade: true } }),
  )
  return Number(e?.quantidade ?? 0)
}

const etiqueta = (c: Candidato) => `${nomeCompleto(c)}${c.codigo ? ` (cód. ${c.codigo})` : ''}`

// ─────────────────────────────────────────────────────────────
// ESTOQUE
// ─────────────────────────────────────────────────────────────

export async function proporPerda(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const quantidadeDita = numero(e.quantidade)
  const motivo = str(e.motivo, 200)
  if (!(quantidadeDita > 0)) return falha('Diga quanto se perdeu: um número maior que zero.')
  if (motivo.length < 3) return falha('Toda perda precisa do motivo (quebrou, venceu, derreteu…). Pergunte à pessoa.')
  const achado = await acharItem(orgId, str(e.produto, 120))
  if ('resultado' in achado) return achado.resultado
  const item = achado.item
  const q = naMedida(quantidadeDita, str(e.unidade, 20), item)
  if (typeof q === 'string') return falha(q)

  // `estoque.perda` ou `estoque.ajustar`: a mesma régua de `podeLancarPerda`.
  const lojas = await lojasQuePode(sessao, pode(sessao, 'estoque.perda') ? 'estoque.perda' : 'estoque.ajustar', true)
  const loja = lojaDita(lojas, str(e.loja, 60))
  if (!loja) return falha(perguntaDaLoja(lojas, 'lança perda'))
  const saldo = await saldoNa(orgId, item.variacaoId, loja.id)
  if (q > saldo) return falha(`Só tem ${comMedida(saldo, item.medida)} de ${nomeCompleto(item)} na ${loja.nome} — não dá para tirar ${comMedida(q, item.medida)}. Confira com a pessoa.`)

  const resumo =
    `Lançar perda de ${comMedida(q, item.medida)} de ${etiqueta(item)} na ${loja.nome}. Motivo: ${motivo}. ` +
    `Saldo hoje: ${comMedida(saldo, item.medida)}.`
  const proposta = await propor(orgId, empresa, {
    poder: 'estoque.perda',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { variacaoId: item.variacaoId, unidadeId: loja.id, quantidade: q, motivo, nome: nomeCompleto(item), medida: item.medida, loja: loja.nome },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'estoque.perda', novaId: proposta.id, mesmoAlvo: { campo: 'variacaoId', valor: item.variacaoId } })
  return { texto: `Proposta criada — o estoque ainda não mudou: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

export async function proporContagem(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const contadoDito = numero(e.contado)
  if (!(contadoDito >= 0) || contadoDito > 1_000_000) return falha('Diga quanto foi contado: zero ou mais.')
  const achado = await acharItem(orgId, str(e.produto, 120))
  if ('resultado' in achado) return achado.resultado
  const item = achado.item
  const contado = naMedida(contadoDito, str(e.unidade, 20), item)
  if (typeof contado === 'string') return falha(contado)

  const lojas = await lojasQuePode(sessao, 'estoque.ajustar', true)
  const loja = lojaDita(lojas, str(e.loja, 60))
  if (!loja) return falha(perguntaDaLoja(lojas, 'corrige estoque'))
  const saldo = await saldoNa(orgId, item.variacaoId, loja.id)
  if (contado === saldo) return falha(`O sistema já diz ${comMedida(saldo, item.medida)} de ${nomeCompleto(item)} na ${loja.nome}: nada a corrigir.`)
  const motivo = str(e.motivo, 200) || 'Contagem informada pelo assistente'
  const dif = contado - saldo
  const difTexto = `${dif > 0 ? '+' : '−'}${comMedida(Math.abs(Math.round(dif * 1000) / 1000), item.medida)}`

  const resumo =
    `Corrigir o estoque de ${etiqueta(item)} na ${loja.nome} pelo contado: o sistema diz ${comMedida(saldo, item.medida)}, ` +
    `contado ${comMedida(contado, item.medida)} (${difTexto}). Motivo: ${motivo}.`
  const proposta = await propor(orgId, empresa, {
    poder: 'estoque.contagem',
    resumo,
    usuarioId: sessao.usuarioId,
    // `saldoVisto`: se uma venda mexer antes do sim, a correção é recusada
    // (ver `corrigirPeloContado`) em vez de apagar a venda do estoque.
    dados: { variacaoId: item.variacaoId, unidadeId: loja.id, contado, saldoVisto: saldo, motivo, nome: nomeCompleto(item), medida: item.medida, loja: loja.nome },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'estoque.contagem', novaId: proposta.id, mesmoAlvo: { campo: 'variacaoId', valor: item.variacaoId } })
  return { texto: `Proposta criada — o estoque ainda não mudou: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

export async function proporTransferencia(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const quantidadeDita = numero(e.quantidade)
  if (!(quantidadeDita > 0)) return falha('Diga quanto vai: um número maior que zero.')
  const achado = await acharItem(orgId, str(e.produto, 120))
  if ('resultado' in achado) return achado.resultado
  const item = achado.item
  const q = naMedida(quantidadeDita, str(e.unidade, 20), item)
  if (typeof q === 'string') return falha(q)

  // De onde sai: as lojas de quem pede. Para onde vai: qualquer loja aberta
  // da empresa — quem decide é o dono, e o serviço confere as duas no sim.
  const minhas = await lojasQuePode(sessao, 'estoque.ajustar', true)
  const de = lojaDita(minhas, str(e.de, 60))
  if (!de) return falha(minhas.length === 0 ? 'Esta pessoa não mexe no estoque de loja nenhuma.' : `De qual loja sai? ${minhas.map((l) => l.nome).join(', ')}.`)
  const todas = (
    await comoOrg(orgId, (db) =>
      db.unidade.findMany({ where: { ativa: true, ehFabrica: false }, orderBy: { criadaEm: 'asc' }, select: { id: true, nome: true, ehDeposito: true } }),
    )
  ).filter((l) => l.id !== de.id)
  const pedidaPara = str(e.para, 60)
  const para = pedidaPara ? escolherLoja(todas, pedidaPara) : null
  if (!para) return falha(`Para qual loja vai? ${todas.map((l) => l.nome).join(', ') || 'Não há outra loja aberta.'}`)
  if (!para.ehDeposito && !vendidoNaLoja(item.vendidoEm, para.id)) {
    return falha(`A ${para.nome} não vende ${nomeCompleto(item)} (está na ficha do produto, em "Vendido em"). Mande para um depósito, ou peça para marcar a loja no produto.`)
  }
  const saldo = await saldoNa(orgId, item.variacaoId, de.id)
  if (q > saldo) return falha(`Só tem ${comMedida(saldo, item.medida)} de ${nomeCompleto(item)} na ${de.nome} — não dá para mandar ${comMedida(q, item.medida)}.`)
  const motivo = str(e.motivo, 200)

  const resumo =
    `Transferir ${comMedida(q, item.medida)} de ${etiqueta(item)} da ${de.nome} para a ${para.nome}` +
    `${motivo ? ` (${motivo})` : ''}. Saldo hoje na ${de.nome}: ${comMedida(saldo, item.medida)}.`
  const proposta = await propor(orgId, empresa, {
    poder: 'estoque.transferir',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: {
      variacaoId: item.variacaoId, deUnidadeId: de.id, paraUnidadeId: para.id, quantidade: q,
      nome: nomeCompleto(item), medida: item.medida, de: de.nome, para: para.nome, ...(motivo ? { motivo } : {}),
    },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'estoque.transferir', novaId: proposta.id, mesmoAlvo: { campo: 'variacaoId', valor: item.variacaoId } })
  return { texto: `Proposta criada — nada mudou de loja ainda: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

// ─────────────────────────────────────────────────────────────
// A BAIXA DE UMA CONTA
// ─────────────────────────────────────────────────────────────

/**
 * Acha a conta EM ABERTO pela descrição ou pelo fornecedor, nas lojas em que
 * quem pede lança (a da empresa inteira, só para quem lança na empresa
 * inteira — a régua de `podeNoAlcance`). Valor e vencimento ditos estreitam.
 */
export async function proporBaixa(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const termo = str(e.conta, 80)
  if (termo.length < 2) return falha('Diga qual conta: a descrição ou o fornecedor.')
  const valor = e.valor == null ? null : numero(e.valor)
  const venc = str(e.vencimento, 10)
  const pagoEm = str(e.pagoEm, 10) || diaEmSP()
  if (!ehDia(pagoEm)) return falha('O dia do pagamento precisa ser AAAA-MM-DD.')
  if (pagoEm > diaEmSP()) return falha('O dia do pagamento não pode ser depois de hoje (isso é agendar, não pagar).')

  const alcance = unidadesQuePodem(sessao, 'financeiro.lancar')
  if (alcance !== 'todas' && alcance.length === 0) return falha('Esta pessoa não lança no financeiro de loja nenhuma.')
  const contas = await comoOrg(orgId, (db) =>
    db.lancamento.findMany({
      where: {
        pagoEm: null,
        ...(alcance === 'todas' ? {} : { unidadeId: { in: alcance } }),
        OR: [
          { descricao: { contains: termo, mode: 'insensitive' } },
          { fornecedor: { contains: termo, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ vencimento: 'asc' }, { criadoEm: 'asc' }],
      take: 40,
      select: { id: true, tipo: true, descricao: true, valor: true, vencimento: true, unidade: { select: { nome: true } } },
    }),
  )
  const servem = contas.filter(
    (c) =>
      (valor === null || Number.isNaN(valor) || Math.round(Number(c.valor) * 100) === Math.round(valor * 100)) &&
      (!ehDia(venc) || c.vencimento.toISOString().slice(0, 10) === venc),
  )
  if (servem.length === 0) return falha(`Não achei conta em aberto com "${termo}"${valor ? ` de ${brl(valor)}` : ''}. Pode já estar paga, ou com outro nome.`)
  if (servem.length > 1) {
    return json({
      propostaCriada: false,
      escolherEntre: servem.slice(0, 8).map((c) => ({
        conta: c.descricao,
        valor: brl(Number(c.valor)),
        vence: mostrarDiaDaColuna(c.vencimento, 'longo'),
        ...(c.unidade ? { loja: c.unidade.nome } : {}),
      })),
      recado: 'Há mais de uma conta assim: pergunte qual é (pelo valor ou pelo vencimento) e chame de novo com eles.',
    })
  }
  const c = servem[0]!
  const v = Number(c.valor)
  const verbo = c.tipo === 'RECEITA' ? 'recebida' : 'paga'
  const resumo =
    `Dar baixa: "${c.descricao}" — ${brl(v)}, vencimento ${mostrarDiaDaColuna(c.vencimento, 'longo')}` +
    `${c.unidade ? `, da ${c.unidade.nome}` : ''} — ${verbo} em ${dataBR(pagoEm)}.`
  const proposta = await propor(orgId, empresa, {
    poder: 'conta.pagar',
    resumo,
    valor: v,
    usuarioId: sessao.usuarioId,
    dados: { lancamentoId: c.id, dia: pagoEm, descricao: c.descricao, tipo: c.tipo },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'conta.pagar', novaId: proposta.id, mesmoAlvo: { campo: 'lancamentoId', valor: c.id } })
  return { texto: `Proposta criada — a conta continua em aberto: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

// ─────────────────────────────────────────────────────────────
// A ENCOMENDA NOVA
// ─────────────────────────────────────────────────────────────

const FORMAS: Record<string, FormaSinal> = {
  dinheiro: 'DINHEIRO',
  pix: 'PIX',
  debito: 'DEBITO',
  credito: 'CREDITO',
  transferencia: 'TRANSFERENCIA',
}
const formaDita = (v: unknown): FormaSinal | null => FORMAS[normalizar(str(v, 20))] ?? null

export async function proporEncomenda(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
  agora = new Date(),
): Promise<ResultadoFerramenta> {
  const lojas = await lojasQuePode(sessao, 'venda.criar', false)
  const loja = lojaDita(lojas, str(e.loja, 60))
  if (!loja) return falha(perguntaDaLoja(lojas, 'anota encomenda'))
  const sinal = e.sinal == null ? 0 : numero(e.sinal)
  const forma = formaDita(e.formaSinal)
  if (sinal > 0 && !forma) return falha('Como a pessoa pagou o sinal? Dinheiro, Pix, débito, crédito ou transferência.')

  const dados = {
    unidadeId: loja.id,
    clienteNome: str(e.cliente, 120),
    telefone: str(e.telefone, 20) || null,
    descricao: str(e.descricao, 500),
    valor: numero(e.valor),
    sinal: Number.isFinite(sinal) ? sinal : Number.NaN,
    sinalForma: sinal > 0 ? forma : null,
    dia: str(e.dia, 10),
    hora: str(e.hora, 5),
    entrega: e.entrega === true,
    endereco: str(e.endereco, 300) || null,
    observacao: str(e.observacao, 1000) || null,
  }
  // A MESMA conferência da tela (`validarEncomenda`), agora: o dono não
  // recebe para aprovar uma encomenda que o sim recusaria.
  const v = validarEncomenda(dados, agora)
  if (!v.ok) {
    return falha(v.pedeConfirmacao ? 'Essa data e hora já passaram: confira o dia com a pessoa.' : v.erro)
  }
  const l = v.limpo
  const dia = dados.dia
  const quando = `${l.entrega ? 'entrega' : 'retirada'} em ${dataBR(dia)} às ${dados.hora}${l.entrega && l.endereco ? ` (${l.endereco})` : ''}`
  const resumo =
    `Anotar encomenda na ${loja.nome} para ${l.clienteNome}${l.telefone ? ` (${mostrarTelefone(l.telefone)})` : ''}: ` +
    `${l.descricao} — ${brlC(l.valorC)}` +
    (l.sinalC > 0 ? `, sinal de ${brlC(l.sinalC)} em ${ROTULO_FORMA_SINAL[l.sinalForma!]} (falta ${brl(faltaPagar(l.valorC / 100, l.sinalC / 100))})` : ', sem sinal') +
    `, ${quando}.`
  const chave = normalizar(l.clienteNome)
  const proposta = await propor(orgId, empresa, {
    poder: 'encomenda.criar',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { ...dados, clienteNome: l.clienteNome, telefone: l.telefone, chave },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'encomenda.criar', novaId: proposta.id, mesmoAlvo: { campo: 'chave', valor: chave } })
  return { texto: `Proposta criada — a encomenda ainda não foi anotada: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

// ─────────────────────────────────────────────────────────────
// A PARCELA DO CREDIÁRIO
// ─────────────────────────────────────────────────────────────

const FORMAS_DE_RECEBER: Record<string, FormaPagamento> = FORMAS
const ROTULO_RECEBER: Record<string, string> = ROTULO_FORMA_SINAL

/**
 * "A Joana pagou a parcela no Pix": a parcela mais antiga em aberto da
 * cliente, nas lojas em que quem pede recebe crediário, com o atraso de HOJE
 * (multa e juro pela regra da empresa — `parcelasEmAberto`). O valor dito
 * paga primeiro o atraso, e o resto abate a parcela; sem valor, a parcela
 * inteira. Uma parcela por pedido: quem paga várias recebe pela tela, onde o
 * recibo junta todas.
 */
export async function proporRecebimento(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const pedido = str(e.cliente, 120)
  if (pedido.length < 2) return falha('Diga o nome ou o telefone de quem pagou.')
  const forma = FORMAS_DE_RECEBER[normalizar(str(e.forma, 20))]
  if (!forma) return falha('Como a pessoa pagou? Dinheiro, Pix, débito, crédito ou transferência.')

  const todas = await lojasQuePode(sessao, 'crediario.receber', false)
  const pedidaLoja = str(e.loja, 60)
  const lojas = pedidaLoja ? todas.filter((l) => l.id === escolherLoja(todas, pedidaLoja)?.id) : todas
  if (lojas.length === 0) return falha(pedidaLoja ? perguntaDaLoja(todas, 'recebe crediário') : 'Esta pessoa não recebe crediário em loja nenhuma.')

  const clientes = await acharClientes(orgId, pedido)
  if (clientes.length === 0) return falha(`Não achei cliente com "${pedido}".`)
  const comParcela: { cliente: (typeof clientes)[number]; parcelas: Awaited<ReturnType<typeof parcelasEmAberto>> }[] = []
  for (const c of clientes) {
    const parcelas = await parcelasEmAberto(sessao, c.id, lojas.map((l) => l.id))
    if (parcelas.length > 0) comParcela.push({ cliente: c, parcelas })
  }
  if (comParcela.length === 0) return falha(`${clientes.length === 1 ? clientes[0]!.nome : `Nenhum cliente com "${pedido}"`} não tem parcela em aberto${lojas.length < todas.length ? ' nessa loja' : ''}.`)
  if (comParcela.length > 1) {
    return json({
      propostaCriada: false,
      escolherEntre: paraEscolher(comParcela.map((x) => x.cliente)),
      recado: 'Mais de um cliente com esse nome deve no crediário: pergunte qual é e chame de novo com o telefone.',
    })
  }
  const { cliente, parcelas } = comParcela[0]!
  const p = parcelas[0]!
  const totalC = p.restaC + p.atrasoC
  const valorC = e.valor == null ? totalC : Math.round(numero(e.valor) * 100)
  if (!(valorC > 0)) return falha('O valor pago precisa ser maior que zero.')
  const vence = mostrarDiaDaColuna(p.vencimento, 'longo')
  const daParcela = `parcela ${p.numero}/${p.de} da ${p.unidade}, ${p.diasAtraso > 0 ? `venceu ${vence}` : `vence ${vence}`}`
  if (valorC <= p.atrasoC) {
    return falha(`${brlC(valorC)} não cobre nem o atraso de hoje (${brlC(p.atrasoC)}) da ${daParcela}. Negociar o atraso é pela tela do Crediário.`)
  }
  if (valorC > totalC) {
    return falha(
      `${brlC(valorC)} passa do que falta na parcela mais antiga (${daParcela}: ${brlC(totalC)}` +
        `${p.atrasoC > 0 ? `, com ${brlC(p.atrasoC)} de atraso` : ''}). Para pagar mais de uma parcela, receba pela tela do Crediário — ou uma de cada vez.`,
    )
  }
  const sobraC = totalC - valorC
  const resumo =
    `Receber ${brlC(valorC)} de ${cliente.nome} em ${ROTULO_RECEBER[forma]}: ${daParcela}` +
    (p.atrasoC > 0 ? ` — inclui ${brlC(p.atrasoC)} de multa e juro (${p.diasAtraso} dias de atraso)` : '') +
    (sobraC === 0 ? '. Quita a parcela.' : `. Fica faltando ${brlC(sobraC)} nesta parcela.`)
  const proposta = await propor(orgId, empresa, {
    poder: 'crediario.receber',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { parcelaId: p.id, clienteId: cliente.id, unidadeId: p.unidadeId, valor: valorC / 100, juros: p.atrasoC / 100, forma, cliente: cliente.nome },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'crediario.receber', novaId: proposta.id, mesmoAlvo: { campo: 'parcelaId', valor: p.id } })
  return { texto: `Proposta criada — nada foi recebido ainda: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}
