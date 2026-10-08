// As ferramentas de cadastro pelo WhatsApp: a ficha do cliente e o produto.
//
// A mesma regra de ferramentas.ts: ESCREVER só monta a proposta; quem executa
// é o dono que confirma, pelos MESMOS serviços da tela (`criarCliente`,
// `editarCliente`, `criarProduto`, `editarProduto`, `definirMinimo` — ver
// agente-acoes.ts). O que a tela recusaria, o sim recusa também, com a frase
// da tela.
//
// ── o que volta para quem pede ───────────────────────────────
// Quem pede pode ser a balconista, que não abre a lista de clientes nem o
// custo dos produtos pela tela (ver `sessaoDoPedido` em poderes.ts). Por isso
// a ferramenta devolve SÓ o que monta o pedido: o nome do cadastro que ela
// achou (e, para escolher entre dois, o final do telefone ou o código da
// etiqueta) e o resumo. CPF vai mascarado, custo vai só o novo.
//
// ── achar, sem chutar ────────────────────────────────────────
// "Maria" com três Marias volta como pergunta, e o modelo pergunta qual —
// editar a ficha errada é o telefone da Maria Souza na ficha da Maria Lima
// depois do sim. O nome exato (sem acento, sem caixa) vence o pedaço de nome.

import type { Medida } from '@prisma/client'
import { comoOrg } from '../banco'
import { propor } from '../agente'
import type { Sessao } from '../permissao'
import type { ComModulos } from '../modulos'
import { cpfValido, mostrarTelefone, soDigitos } from '../cliente'
import { mostrar } from '../dinheiro'
import { diaEmSP } from '../dia'
import { normalizarVendidoEm } from '../catalogo-loja'
import { quantidade as comMedida } from '../texto'
import { unidadesVisiveis } from './contexto'
import { candidatosDe, escolherLoja, medidaDoTexto, normalizar, palavrasDe } from './ferramentas-loja'
import { aposentarAnteriores, RECADO_DO_FECHO } from './propostas'
import type { ResultadoFerramenta } from './ferramentas'

const MAXIMO_RESULTADO = 6000
const json = (v: unknown): ResultadoFerramenta => ({ texto: JSON.stringify(v).slice(0, MAXIMO_RESULTADO) })
const falha = (texto: string): ResultadoFerramenta => ({ texto, erro: true })
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)
const brl = (v: number) => mostrar(Math.round(v * 100))
const temCampo = (e: Record<string, unknown>, k: string) => e[k] !== undefined && e[k] !== null

// O banco compara sem acento do mesmo jeito que `normalizar`.
const COM_ACENTO = 'áàâãäéèêëíìîïóòôõöúùûüçñ'
const SEM_ACENTO = 'aaaaaeeeeiiiiooooouuuucn'

/** "AAAA-MM-DD" que existe e não está no futuro — a data de nascimento. */
function nascimentoValido(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T12:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  if (s > diaEmSP() || s < '1900-01-01') return null
  return s
}
const dataBR = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`

/** O CPF no resumo: só o final. Ele vai para o WhatsApp do dono e de quem pediu. */
const cpfNoResumo = (d: string) => `CPF final ${d.slice(-2)}`

// ─────────────────────────────────────────────────────────────
// CLIENTE
// ─────────────────────────────────────────────────────────────

/** Os campos de texto da ficha, com o teto de cada um e o rótulo do resumo. */
const TEXTOS_DA_FICHA = [
  ['email', 120, 'e-mail'],
  ['endereco', 200, 'endereço'],
  ['numero', 20, 'número'],
  ['bairro', 80, 'bairro'],
  ['cidade', 80, 'cidade'],
  ['estado', 2, 'UF'],
  ['cep', 10, 'CEP'],
  ['observacoes', 1000, 'observações'],
] as const

type Ficha = Record<string, string | null>

/**
 * Lê da conversa os campos da ficha que vieram, já conferidos (telefone com
 * DDD, CPF que confere, data que existe). Devolve a ficha parcial e as linhas
 * do resumo — ou a recusa em frase.
 */
function lerFicha(e: Record<string, unknown>): { ficha: Ficha; linhas: string[] } | { erro: string } {
  const ficha: Ficha = {}
  const linhas: string[] = []
  if (temCampo(e, 'telefone')) {
    const t = soDigitos(str(e.telefone, 30)).replace(/^55(?=\d{10,11}$)/, '')
    if (t && (t.length < 10 || t.length > 11)) return { erro: 'O telefone precisa do DDD: 10 ou 11 números, como (71) 99999-0000.' }
    ficha.telefone = t || null
    linhas.push(t ? `telefone ${mostrarTelefone(t)}` : 'sem telefone')
  }
  if (temCampo(e, 'cpf')) {
    const d = soDigitos(str(e.cpf, 30))
    if (d && !cpfValido(d)) return { erro: 'Esse CPF não confere. Confira os números com a pessoa.' }
    ficha.documento = d || null
    linhas.push(d ? cpfNoResumo(d) : 'sem CPF')
  }
  if (temCampo(e, 'nascimento')) {
    const bruto = str(e.nascimento, 10)
    const n = bruto ? nascimentoValido(bruto) : null
    if (bruto && !n) return { erro: 'A data de nascimento precisa ser AAAA-MM-DD, e não pode ser no futuro.' }
    ficha.nascimento = n
    linhas.push(n ? `nascimento ${dataBR(n)}` : 'sem data de nascimento')
  }
  for (const [k, max, rotulo] of TEXTOS_DA_FICHA) {
    if (!temCampo(e, k)) continue
    const v = str(e[k], max) || null
    ficha[k] = v
    linhas.push(v ? `${rotulo}: ${k === 'observacoes' && v.length > 80 ? `${v.slice(0, 79)}…` : v}` : `sem ${rotulo}`)
  }
  return { ficha, linhas }
}

export type ClienteAchado = { id: string; nome: string; telefone: string | null; ativo: boolean }

/**
 * O cliente pelo telefone (os 8 últimos dígitos) ou pelo nome — sem acento,
 * sem caixa, todas as palavras. Anonimizado não volta: aquela ficha não se
 * edita mais (ver `editarCliente`).
 */
export async function acharClientes(orgId: string, pedido: string): Promise<ClienteAchado[]> {
  const digitos = soDigitos(pedido)
  if (digitos.length >= 8) {
    return comoOrg(orgId, (db) =>
      db.cliente.findMany({
        where: { telefone: { endsWith: digitos.slice(-8) }, anonimizadoEm: null },
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
        take: 10,
        select: { id: true, nome: true, telefone: true, ativo: true },
      }),
    )
  }
  const palavras = palavrasDe(pedido)
  if (palavras.length === 0) return []
  const termos = palavras.map((w) => `%${w}%`)
  const linhas = await comoOrg(orgId, (db) =>
    db.$queryRaw<ClienteAchado[]>`
      select id, nome, telefone, ativo from clientes
       where anonimizado_em is null
         and translate(lower(nome), ${COM_ACENTO}, ${SEM_ACENTO}) like all(${termos})
       order by ativo desc, nome
       limit 10
    `,
  )
  // O nome inteiro, exato, vence quem só o contém ("Ana" não é "Ana Paula").
  const exatos = linhas.filter((c) => normalizar(c.nome) === normalizar(pedido))
  return exatos.length > 0 ? exatos : linhas
}

/** A lista para a pessoa escolher: o nome e o final do telefone — nada além. */
export const paraEscolher = (cs: ClienteAchado[]) =>
  cs.map((c) => ({ cliente: c.nome, telefoneFinal: c.telefone ? c.telefone.slice(-4) : null, ...(c.ativo ? {} : { desativado: true }) }))

export async function proporCadastroDeCliente(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const nome = str(e.nome, 120)
  if (nome.length < 2) return falha('Falta o nome do cliente.')
  const lido = lerFicha(e)
  if ('erro' in lido) return falha(lido.erro)
  const { ficha, linhas } = lido

  // Telefone repetido é o mesmo cliente duas vezes (ver cliente.ts): melhor
  // perguntar agora do que o sim do dono ser recusado.
  if (ficha.telefone) {
    const igual = await comoOrg(orgId, (db) =>
      db.cliente.findFirst({ where: { telefone: ficha.telefone! }, select: { nome: true } }),
    )
    if (igual) return falha(`Já existe cliente com esse telefone: ${igual.nome}. Pergunte se é para corrigir essa ficha (cliente_editar).`)
  }

  const resumo = `Cadastrar cliente: ${nome}${linhas.length > 0 ? ` — ${linhas.join('; ')}` : ''}.`
  const chave = normalizar(nome)
  const proposta = await propor(orgId, empresa, {
    poder: 'cliente.cadastrar',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { chave, cliente: { ...ficha, nome } },
  })
  // A correção do MESMO cadastro ("não, o telefone é outro") vence a anterior.
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'cliente.cadastrar', novaId: proposta.id, mesmoAlvo: { campo: 'chave', valor: chave } })
  return { texto: `Proposta criada — a ficha ainda não existe: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

export async function proporEdicaoDeCliente(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const pedido = str(e.cliente, 120)
  if (pedido.length < 2) return falha('Diga o nome ou o telefone do cliente.')
  const achados = await acharClientes(orgId, pedido)
  if (achados.length === 0) return falha(`Não achei cliente com "${pedido}". Confira o nome, ou cadastre (cliente_cadastrar).`)
  if (achados.length > 1) {
    return json({
      propostaCriada: false,
      escolherEntre: paraEscolher(achados),
      recado: 'Há mais de um cliente assim: pergunte qual é e chame de novo com o telefone dele.',
    })
  }
  const c = achados[0]!

  const lido = lerFicha(e)
  if ('erro' in lido) return falha(lido.erro)
  const mudancas: Record<string, unknown> = { ...lido.ficha }
  const linhas = [...lido.linhas]
  const nomeNovo = str(e.nome, 120)
  if (nomeNovo && nomeNovo !== c.nome) {
    if (nomeNovo.length < 2) return falha('O nome novo ficou curto demais.')
    mudancas.nome = nomeNovo
    linhas.unshift(`nome → ${nomeNovo}`)
  }
  if (typeof e.ativo === 'boolean' && e.ativo !== c.ativo) {
    mudancas.ativo = e.ativo
    linhas.push(e.ativo ? 'reativar a ficha' : 'desativar a ficha')
  }
  if (Object.keys(mudancas).length === 0) return falha(`Nada a mudar na ficha de ${c.nome}: diga o que muda.`)

  if (typeof mudancas.telefone === 'string' && mudancas.telefone !== c.telefone) {
    const igual = await comoOrg(orgId, (db) =>
      db.cliente.findFirst({ where: { telefone: mudancas.telefone as string, id: { not: c.id } }, select: { nome: true } }),
    )
    if (igual) return falha(`Outro cliente já usa esse telefone: ${igual.nome}.`)
  }

  const resumo = `Corrigir a ficha de ${c.nome}: ${linhas.join('; ')}.`
  const proposta = await propor(orgId, empresa, {
    poder: 'cliente.editar',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { clienteId: c.id, nome: c.nome, mudancas },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'cliente.editar', novaId: proposta.id, mesmoAlvo: { campo: 'clienteId', valor: c.id } })
  return { texto: `Proposta criada — a ficha ainda não mudou: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

// ─────────────────────────────────────────────────────────────
// PRODUTO
// ─────────────────────────────────────────────────────────────

/** A categoria do cadastro pelo nome: exata, ou o pedaço que só uma tem. */
async function acharCategoriaDeProduto(orgId: string, pedida: string): Promise<{ id: string; nome: string } | { erro: string }> {
  const todas = await comoOrg(orgId, (db) =>
    db.categoria.findMany({ orderBy: [{ ordem: 'asc' }, { nome: 'asc' }], select: { id: true, nome: true } }),
  )
  const achada = escolherLoja(todas, pedida)
  if (achada) return achada
  return {
    erro:
      todas.length === 0
        ? 'Esta empresa ainda não tem categorias de produto: cadastre sem categoria, ou crie a categoria na tela de Produtos.'
        : `Não achei a categoria "${pedida}". As que existem: ${todas.slice(0, 20).map((c) => c.nome).join(', ')}.`,
  }
}

/**
 * "Vendido em" pelos nomes das lojas. A lista é de TODAS as lojas abertas da
 * empresa (não só as de quem pede): quem decide é o dono, e o serviço da tela
 * confere o alcance dele no sim. Todas marcadas grava vazio (= todas).
 */
async function lojasDoProduto(orgId: string, pedidas: unknown): Promise<{ ids: string[]; nomes: string } | { erro: string }> {
  const lista = Array.isArray(pedidas) ? pedidas.map((x) => str(x, 60)).filter(Boolean) : []
  if (lista.length === 0 || lista.some((l) => normalizar(l) === 'todas')) return { ids: [], nomes: 'todas as lojas' }
  const lojas = await comoOrg(orgId, (db) =>
    db.unidade.findMany({ where: { ativa: true, ehDeposito: false }, orderBy: { criadaEm: 'asc' }, select: { id: true, nome: true } }),
  )
  const ids: string[] = []
  for (const l of lista) {
    const achada = escolherLoja(lojas, l)
    if (!achada) return { erro: `Não achei a loja "${l}". As lojas: ${lojas.map((x) => x.nome).join(', ')}.` }
    ids.push(achada.id)
  }
  const gravar = normalizarVendidoEm(ids, lojas.map((x) => x.id))
  return {
    ids: gravar,
    nomes: gravar.length === 0 ? 'todas as lojas' : lojas.filter((x) => gravar.includes(x.id)).map((x) => x.nome).join(', '),
  }
}

export async function proporCadastroDeProduto(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const nome = str(e.nome, 120)
  const precoVista = numero(e.precoVista)
  const precoCartao = temCampo(e, 'precoCartao') ? numero(e.precoCartao) : null
  const custo = temCampo(e, 'custo') ? numero(e.custo) : null
  if (nome.length < 2) return falha('Falta o nome do produto.')
  if (!(precoVista > 0)) return falha('Falta o preço de venda à vista (maior que zero). Pergunte à pessoa.')
  if (precoCartao !== null && !(precoCartao > 0)) return falha('O preço no cartão precisa ser maior que zero.')
  if (custo !== null && !(custo >= 0)) return falha('O custo não pode ser negativo.')
  const medidaDita = str(e.medida, 20)
  const medida: Medida | null = medidaDita ? medidaDoTexto(medidaDita) : 'UN'
  if (!medida) return falha(`Não entendi a medida "${medidaDita}". Use un, kg, g, l, ml, m, par ou cx.`)

  // Já existe com esse nome? Cadastrar de novo é o produto duplicado no
  // balcão (e o estoque dividido em dois). Melhor perguntar se é para editar.
  const existentes = (await candidatosDe(orgId, [nome])).filter((c) => normalizar(c.nome) === normalizar(nome))
  if (existentes.length > 0) {
    return falha(`Já existe "${existentes[0]!.nome}"${existentes[0]!.codigo ? ` (cód. ${existentes[0]!.codigo})` : ''}. Para mudar preço ou ficha, use produto_editar.`)
  }

  let categoria: { id: string; nome: string } | null = null
  const catPedida = str(e.categoria, 60)
  if (catPedida) {
    const c = await acharCategoriaDeProduto(orgId, catPedida)
    if ('erro' in c) return falha(c.erro)
    categoria = c
  }
  const lojas = await lojasDoProduto(orgId, e.lojas)
  if ('erro' in lojas) return falha(lojas.erro)
  const marca = str(e.marca, 80) || null

  const un = comMedida(1, medida).split(' ')[1] ?? 'un'
  const resumo =
    `Cadastrar produto: ${nome} — ${brl(precoVista)}/${un} à vista` +
    (precoCartao !== null && precoCartao !== precoVista ? `, ${brl(precoCartao)} no cartão` : '') +
    (custo !== null ? `, custo ${brl(custo)}` : '') +
    (categoria ? `, categoria ${categoria.nome}` : '') +
    (marca ? `, marca ${marca}` : '') +
    `, vendido em ${lojas.nomes}.`
  const chave = normalizar(nome)
  const proposta = await propor(orgId, empresa, {
    poder: 'produto.cadastrar',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { chave, nome, medida, precoVista, precoCartao, custo, categoriaId: categoria?.id ?? null, marca, vendidoEm: lojas.ids },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'produto.cadastrar', novaId: proposta.id, mesmoAlvo: { campo: 'chave', valor: chave } })
  return { texto: `Proposta criada — o produto ainda não existe: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}

type ProdutoAchado = {
  id: string
  nome: string
  medida: Medida
  precoVista: string | null
  precoCartao: string | null
  ativo: boolean
  vendidoEm: string[] | null
  variacoes: { id: string; codigo: string | null }[]
}

/**
 * O produto (não a variação) pelo código de uma etiqueta ou pelo nome — os
 * mesmos degraus de `escolherProduto` (código, nome exato, todas as palavras),
 * com os tirados de venda junto: "volta a vender o picolé" precisa achá-lo.
 */
async function acharProduto(orgId: string, pedido: string): Promise<{ um: ProdutoAchado } | { varios: ProdutoAchado[] } | null> {
  const cru = pedido.trim().toLowerCase()
  const termos = palavrasDe(pedido).map((w) => `%${w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w}%`)
  const linhas = await comoOrg(orgId, (db) =>
    db.$queryRaw<(Omit<ProdutoAchado, 'variacoes'> & { codigos: { id: string; codigo: string | null }[] | null; peloCodigo: boolean })[]>`
      select p.id, p.nome, p.medida, p.preco_vista::text as "precoVista", p.preco_cartao::text as "precoCartao",
             p.ativo, p.vendido_em as "vendidoEm",
             (select json_agg(json_build_object('id', v.id, 'codigo', v.codigo) order by v.codigo)
                from variacoes v where v.produto_id = p.id and v.ativa) as codigos,
             exists (select 1 from variacoes v where v.produto_id = p.id
                      and (lower(v.codigo) = ${cru} or v.codigo_barras = ${pedido.trim()})) as "peloCodigo"
        from produtos p
       where exists (select 1 from variacoes v where v.produto_id = p.id
                      and (lower(v.codigo) = ${cru} or v.codigo_barras = ${pedido.trim()}))
          or (${termos.length > 0} and translate(lower(p.nome), ${COM_ACENTO}, ${SEM_ACENTO}) like all(${termos.length > 0 ? termos : ['%']}))
       order by p.ativo desc, p.nome
       limit 40
    `,
  )
  const todos = linhas.map(({ codigos, peloCodigo, ...p }) => ({ ...p, variacoes: codigos ?? [], peloCodigo }))
  const decide = (l: typeof todos) => (l.length === 1 ? { um: l[0]! } : l.length > 1 ? { varios: l.slice(0, 8) } : null)
  const p = normalizar(pedido)
  return (
    decide(todos.filter((x) => x.peloCodigo)) ??
    decide(todos.filter((x) => normalizar(x.nome) === p)) ??
    decide(
      todos.filter((x) => {
        const doCadastro = normalizar(x.nome).split(' ')
        return palavrasDe(pedido).every((w) => doCadastro.some((d) => d === w || d.startsWith(w) || d.replace(/s$/, '') === w.replace(/s$/, '')))
      }),
    )
  )
}

export async function proporEdicaoDeProduto(
  orgId: string,
  empresa: ComModulos,
  sessao: Sessao,
  e: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  const pedido = str(e.produto, 120)
  if (pedido.length < 2) return falha('Diga o nome ou o código do produto.')
  const achado = await acharProduto(orgId, pedido)
  if (!achado) return falha(`Não achei "${pedido}" no cadastro. Se for produto novo, use produto_cadastrar.`)
  if ('varios' in achado) {
    return json({
      propostaCriada: false,
      escolherEntre: achado.varios.map((p) => ({ produto: p.nome, codigo: p.variacoes[0]?.codigo ?? null, ...(p.ativo ? {} : { foraDeVenda: true }) })),
      recado: 'Há mais de um produto assim: pergunte qual é e chame de novo com o código.',
    })
  }
  const p = achado.um
  const mudancas: Record<string, unknown> = {}
  const linhas: string[] = []
  const atualVista = p.precoVista === null ? null : Number(p.precoVista)
  const atualCartao = p.precoCartao === null ? null : Number(p.precoCartao)

  const nomeNovo = str(e.nome, 120)
  if (nomeNovo && nomeNovo !== p.nome) {
    mudancas.nome = nomeNovo
    linhas.push(`nome → ${nomeNovo}`)
  }
  if (temCampo(e, 'precoVista')) {
    const v = numero(e.precoVista)
    if (!(v > 0)) return falha('O preço à vista precisa ser maior que zero.')
    if (v !== atualVista) {
      mudancas.precoVista = v
      linhas.push(`à vista ${atualVista !== null ? `${brl(atualVista)} → ` : ''}${brl(v)}`)
    }
  }
  if (temCampo(e, 'precoCartao')) {
    const v = numero(e.precoCartao)
    if (!(v > 0)) return falha('O preço no cartão precisa ser maior que zero.')
    if (v !== atualCartao) {
      mudancas.precoCartao = v
      linhas.push(`no cartão ${atualCartao !== null ? `${brl(atualCartao)} → ` : ''}${brl(v)}`)
    }
  }
  if (temCampo(e, 'custo')) {
    const v = numero(e.custo)
    if (!(v >= 0)) return falha('O custo não pode ser negativo.')
    // Só o custo NOVO no resumo: o de hoje é dado que quem pede pode não ver.
    mudancas.custo = v
    linhas.push(`custo → ${brl(v)}`)
  }
  const catPedida = str(e.categoria, 60)
  if (catPedida) {
    const c = await acharCategoriaDeProduto(orgId, catPedida)
    if ('erro' in c) return falha(c.erro)
    mudancas.categoriaId = c.id
    linhas.push(`categoria → ${c.nome}`)
  }
  if (Array.isArray(e.lojas)) {
    const l = await lojasDoProduto(orgId, e.lojas)
    if ('erro' in l) return falha(l.erro)
    mudancas.vendidoEm = l.ids
    linhas.push(`vendido em ${l.nomes}`)
  }
  if (typeof e.ativo === 'boolean' && e.ativo !== p.ativo) {
    mudancas.ativo = e.ativo
    linhas.push(e.ativo ? 'voltar a vender' : 'tirar de venda')
  }

  // O mínimo é por item e por loja (ver `definirMinimo`): produto com grade
  // precisa do código do item; a loja é a de quem pede, ou a que ela disse.
  let minimo: Record<string, unknown> | undefined
  if (temCampo(e, 'estoqueMinimo')) {
    const q = numero(e.estoqueMinimo)
    if (!(q >= 0)) return falha('O estoque mínimo precisa ser zero ou mais.')
    const cru = pedido.trim().toLowerCase()
    const variacao =
      p.variacoes.length === 1 ? p.variacoes[0]! : p.variacoes.find((v) => v.codigo?.toLowerCase() === cru)
    if (!variacao) {
      return falha(`${p.nome} tem ${p.variacoes.length} itens na grade: o mínimo é de um item. Pergunte qual (códigos: ${p.variacoes.map((v) => v.codigo).filter(Boolean).slice(0, 12).join(', ')}).`)
    }
    const ids = await unidadesVisiveis(sessao, 'estoque.ajustar')
    const lojas = await comoOrg(orgId, (db) =>
      db.unidade.findMany({ where: { id: { in: ids }, ativa: true }, orderBy: { criadaEm: 'asc' }, select: { id: true, nome: true } }),
    )
    const pedida = str(e.loja, 60)
    const loja = pedida ? escolherLoja(lojas, pedida) : lojas.length === 1 ? lojas[0]! : null
    if (!loja) return falha(`O estoque mínimo é de qual loja? ${lojas.map((l) => l.nome).join(', ') || 'Nenhuma loja permitida.'}`)
    minimo = { variacaoId: variacao.id, unidadeId: loja.id, quantidade: q, loja: loja.nome, medida: p.medida }
    linhas.push(`estoque mínimo na ${loja.nome}: ${comMedida(q, p.medida)}`)
  }

  if (linhas.length === 0) return falha(`Nada a mudar em ${p.nome}: diga o que muda (preço, custo, lojas, mínimo...).`)
  const resumo = `Mudar o produto ${p.nome}${p.variacoes[0]?.codigo ? ` (cód. ${p.variacoes[0].codigo})` : ''}: ${linhas.join('; ')}.`
  const proposta = await propor(orgId, empresa, {
    poder: 'produto.editar',
    resumo,
    usuarioId: sessao.usuarioId,
    dados: { produtoId: p.id, nome: p.nome, mudancas, ...(minimo ? { minimo } : {}) },
  })
  await aposentarAnteriores(orgId, { usuarioId: sessao.usuarioId, poder: 'produto.editar', novaId: proposta.id, mesmoAlvo: { campo: 'produtoId', valor: p.id } })
  return { texto: `Proposta criada — nada mudou ainda: ${resumo} ${RECADO_DO_FECHO}`, propostaId: proposta.id }
}
