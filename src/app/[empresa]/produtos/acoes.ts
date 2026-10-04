'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// As capacidades (`produto.editar` e `produto.preco`, separadas) são exigidas
// dentro de `criarProduto`, `editarProduto` e `ajustarGrade`.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { criarProduto, editarProduto, excluirProduto, reativarProduto, ajustarGrade, criarOpcaoDoEixo, criarEixoDaEmpresa, definirPrecosDosItens, GradeRecusada, PrecoDoItemRecusado, type EixoEscolhido } from '@/servidor/produto'
import { SemPermissao, pode, unidadesQuePodem, type Sessao } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { alcanceComum, normalizarVendidoEm, vendidoEmDoGerente } from '@/servidor/catalogo-loja'
import { palavra, plural } from '@/ui/texto'
import { DINHEIRO_ILEGIVEL, lerDinheiro, lerNumero } from '@/servidor/dinheiro'
import type { Medida } from '@prisma/client'

export type EstadoProduto = {
  erro?: string
  ok?: string
  /** O cadastro pede a assinatura de quem cadastra: a tela mostra o campo do PIN. */
  precisaPin?: boolean
  /** O erro de cada campo, pelo `name` dele — a tela pinta o campo e diz o que houve. */
  campos?: Record<string, string>
}

const MEDIDAS: Medida[] = ['UN', 'KG', 'G', 'L', 'ML', 'M', 'PAR', 'CX']

const CAMPOS_DE_DINHEIRO = ['precoVista', 'precoCartao', 'precoCrediario', 'custo'] as const
type CampoDeDinheiro = (typeof CAMPOS_DE_DINHEIRO)[number]

/**
 * Os quatro campos de dinheiro da ficha, lidos por `lerDinheiro`.
 *
 * Vazio é "não informado" (nulo). O que tem texto e não se lê vira ERRO no
 * próprio campo — antes o custo ilegível virava vazio em silêncio, e o
 * preço "49.90" virava 4.990 reais porque todo ponto era jogado fora.
 * `undefined` = o campo nem veio no formulário (a tela não o mostrou).
 */
function precosDo(
  f: FormData,
): { valores: Record<CampoDeDinheiro, number | null | undefined> } | { campos: Record<string, string> } {
  const valores = {} as Record<CampoDeDinheiro, number | null | undefined>
  const campos: Record<string, string> = {}
  for (const k of CAMPOS_DE_DINHEIRO) {
    if (!f.has(k)) {
      valores[k] = undefined
      continue
    }
    const bruto = String(f.get(k) ?? '').trim()
    if (!bruto) {
      valores[k] = null
      continue
    }
    // O custo aceita quatro casas: o mililitro de calda custa R$ 0,0028, e
    // com duas ele virava zero. Preço continua em centavos.
    const v = k === 'custo' ? lerNumero(bruto.replace(/^R\$\s*/i, ''), 4) : lerDinheiro(bruto)
    if (v === null) campos[k] = DINHEIRO_ILEGIVEL
    valores[k] = v
  }
  if (!campos.precoVista && !(valores.precoVista! > 0)) {
    campos.precoVista = 'Informe o preço à vista, maior que zero.'
  }
  return Object.keys(campos).length > 0 ? { campos } : { valores }
}

/**
 * O preço de cada item da grade ("Casquinha recheada: 7,00").
 *
 * Os campos chegam como `precoItem_<variacaoId>` (o que está na tela agora) e
 * `precoItemAntes_<variacaoId>` (o que estava quando a ficha abriu). Só vai
 * quem mudou: mandar todos de volta "congelava" o preço de item que seguia o
 * do produto, e o item deixava de acompanhar quando o preço do produto subia.
 */
function precosDosItensDo(
  f: FormData,
): { itens: { variacaoId: string; preco: number }[] } | { campos: Record<string, string> } {
  const itens: { variacaoId: string; preco: number }[] = []
  const campos: Record<string, string> = {}
  for (const [chave, bruto] of f.entries()) {
    if (!chave.startsWith('precoItem_')) continue
    const id = chave.slice('precoItem_'.length)
    const texto = String(bruto ?? '').trim()
    if (!texto) continue
    const preco = lerDinheiro(texto)
    if (preco === null || !(preco > 0)) {
      campos[chave] = 'Informe um preço maior que zero, como 7,00.'
      continue
    }
    const antes = lerDinheiro(String(f.get(`precoItemAntes_${id}`) ?? '').trim())
    if (antes !== null && Math.round(antes * 100) === Math.round(preco * 100)) continue
    itens.push({ variacaoId: id, preco })
  }
  return Object.keys(campos).length > 0 ? { campos } : { itens }
}

/** O erro geral que acompanha os erros de campo: diz onde olhar. */
const ERRO_NOS_CAMPOS = 'Confira o campo marcado em vermelho.'

const PRAZO_MAXIMO_DIAS = 365

/**
 * O prazo de reposição: inteiro de 0 a 365 dias.
 *
 * Vazio é "não informado" (nulo), e é diferente de zero: zero quer dizer
 * "o fornecedor entrega no mesmo dia". Fora da faixa ou com letra, a ação
 * devolve erro em vez de gravar nulo em silêncio — a pessoa digitou alguma
 * coisa e merece saber que não entrou.
 */
const prazo = (f: FormData): { valor: number | null } | { erro: string } => {
  const bruto = String(f.get('prazoReposicaoDias') ?? '').trim()
  if (!bruto) return { valor: null }
  if (!/^\d+$/.test(bruto) || Number(bruto) > PRAZO_MAXIMO_DIAS) {
    return { erro: `O prazo de reposição é em dias inteiros, de 0 a ${PRAZO_MAXIMO_DIAS}.` }
  }
  return { valor: Number(bruto) }
}

/**
 * Serviço e duração. O campo marcador `servicoNaTela` diz que a tela mostrou
 * a pergunta — sem ele (tela antiga, formulário montado na mão), nada muda.
 * Duração em minutos inteiros, de 5 a 720; vazio = não informado.
 */
const servicoDo = (f: FormData): { servico?: boolean; duracaoMin?: number | null } | { erro: string } => {
  if (!f.has('servicoNaTela')) return {}
  const servico = f.get('servico') === 'on'
  const bruto = String(f.get('duracaoMin') ?? '').trim()
  if (!bruto) return { servico, duracaoMin: null }
  if (!/^\d+$/.test(bruto) || Number(bruto) < 5 || Number(bruto) > 720) {
    return { erro: 'A duração é em minutos inteiros, de 5 a 720.' }
  }
  return { servico, duracaoMin: Number(bruto) }
}

/**
 * Quais opções de quais eixos foram marcadas.
 *
 * Os campos chegam como `opcao_<eixoId>_<opcaoId>`. O servidor confere depois
 * se a opção pertence mesmo ao eixo — o navegador é do usuário e o nome do
 * campo é só uma sugestão dele.
 */
function eixosDoFormulario(form: FormData, eixosDaEmpresa: string[]): EixoEscolhido[] {
  const porEixo = new Map<string, string[]>(eixosDaEmpresa.map((e) => [e, []]))

  for (const [chave] of form.entries()) {
    if (!chave.startsWith('opcao_')) continue
    const resto = chave.slice('opcao_'.length)
    const corte = resto.indexOf('_')
    if (corte < 0) continue
    const eixoId = resto.slice(0, corte)
    const opcaoId = resto.slice(corte + 1)
    porEixo.get(eixoId)?.push(opcaoId)
  }

  return eixosDaEmpresa.map((eixoId) => ({ eixoId, opcaoIds: porEixo.get(eixoId) ?? [] }))
}

/**
 * As lojas marcadas em "Vendido em".
 *
 * `undefined` = nada muda. O que veio marcado é conferido contra as lojas
 * abertas DESTA empresa — o nome do campo vem do navegador — e todas
 * marcadas vira vazio, que quer dizer "todas, inclusive as que abrirem
 * depois".
 *
 * Para quem cuida só de algumas lojas (o gerente), a conta é outra: as lojas
 * fora do alcance dele ficam como estavam, e o resultado nunca vira vazio —
 * ver `vendidoEmDoGerente`. Na empresa de uma loja só a pergunta nem aparece
 * na tela, e o produto novo do gerente nasce na loja dele.
 *
 * `antes` nulo = produto novo.
 */
async function vendidoEmDo(
  form: FormData,
  sessao: Sessao,
  antes: string[] | null,
): Promise<{ valor?: string[]; erro?: string }> {
  // Produto novo: o alcance de quem CADASTRA (a vendedora, quando a empresa
  // deixa, cadastra só para a loja dela). Produto que já existe: o de quem
  // edita E mexe em preço, como sempre.
  const alcance =
    antes === null
      ? unidadesQuePodem(sessao, 'produto.cadastrar')
      : alcanceComum(unidadesQuePodem(sessao, 'produto.editar'), unidadesQuePodem(sessao, 'produto.preco'))
  const temPergunta = form.get('temLojas') === '1'
  if (!temPergunta && alcance === 'todas') return {}

  const lojas = (
    await comoOrg(sessao.orgId, (db) =>
      db.unidade.findMany({ where: { ativa: true, ehDeposito: false }, select: { id: true } }),
    )
  ).map((l) => l.id)

  const marcadas = temPergunta
    ? [...form.keys()].filter((k) => k.startsWith('vendidoEm_')).map((k) => k.slice('vendidoEm_'.length))
    : lojas // sem a pergunta na tela: "todas as que a pessoa alcança"

  if (alcance === 'todas') {
    if (marcadas.length === 0) return { erro: 'Marque pelo menos uma loja onde o produto é vendido.' }
    return { valor: normalizarVendidoEm(marcadas, lojas) }
  }

  // Sem a pergunta e com produto que já existe: o gerente não mexeu em loja.
  if (!temPergunta && antes !== null) return {}
  const valor = vendidoEmDoGerente(marcadas, antes, lojas, alcance)
  if (valor.length === 0) return { erro: 'Marque pelo menos uma das suas lojas onde o produto é vendido.' }
  return { valor }
}

/**
 * Material de uso e feito no dia. Mesmo desenho do serviço: o marcador
 * `marcasNaTela` diz que a tela mostrou as perguntas — sem ele, nada muda.
 */
const marcasDo = (f: FormData): { usoInterno?: boolean; feitoNoDia?: boolean } =>
  f.has('marcasNaTela') ? { usoInterno: f.get('usoInterno') === 'on', feitoNoDia: f.get('feitoNoDia') === 'on' } : {}

export async function criar(
  slug: string,
  eixosDaEmpresa: string[],
  _anterior: EstadoProduto,
  form: FormData,
): Promise<EstadoProduto> {
  const sessao = await exigirSessao(slug)

  const precos = precosDo(form)
  const reposicao = prazo(form)
  const comoServico = servicoDo(form)
  if ('campos' in precos || 'erro' in reposicao || 'erro' in comoServico) {
    return {
      erro: ERRO_NOS_CAMPOS,
      campos: {
        ...('campos' in precos ? precos.campos : {}),
        ...('erro' in reposicao ? { prazoReposicaoDias: reposicao.erro } : {}),
        ...('erro' in comoServico ? { duracaoMin: comoServico.erro } : {}),
      },
    }
  }
  const p = precos.valores
  const vendido = await vendidoEmDo(form, sessao, null)
  if (vendido.erro) return { erro: vendido.erro }

  const medidaBruta = String(form.get('medida') ?? 'UN') as Medida
  const medida = MEDIDAS.includes(medidaBruta) ? medidaBruta : 'UN'

  let r
  try {
    r = await criarProduto(
      sessao,
      {
        nome: String(form.get('nome') ?? ''),
        marca: String(form.get('marca') ?? ''),
        referencia: String(form.get('referencia') ?? ''),
        descricao: String(form.get('descricao') ?? ''),
        categoriaId: String(form.get('categoriaId') ?? '') || null,
        medida,
        precoVista: p.precoVista!,
        precoCartao: p.precoCartao ?? null,
        precoCrediario: p.precoCrediario ?? null,
        custo: p.custo ?? null,
        prazoReposicaoDias: reposicao.valor,
        ...comoServico,
        ...marcasDo(form),
        vendidoEm: vendido.valor,
      },
      eixosDoFormulario(form, eixosDaEmpresa),
      String(form.get('pin') ?? '').replace(/\D/g, '') || null,
    )
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para cadastrar produto.' }
    return { erro: recadoDoErro(e, 'Não deu para cadastrar.') }
  }

  if (!r.ok) return { erro: r.motivo, precisaPin: r.precisaPin }

  revalidatePath(`/${slug}/produtos`)
  // Vai direto para a ficha: quem acabou de cadastrar quer conferir a grade
  // que nasceu, e é lá que ela está. Quem cadastra sem editar (a vendedora,
  // ver EXTRAS_DO_BALCAO) não abre a ficha: volta à lista, já no produto.
  if (!pode(sessao, 'produto.editar')) {
    redirect(`/${slug}/produtos?q=${encodeURIComponent(String(form.get('nome') ?? '').trim().slice(0, 60))}`)
  }
  redirect(`/${slug}/produtos/${r.produtoId}`)
}

export async function editar(
  slug: string,
  produtoId: string,
  eixosDaEmpresa: string[],
  _anterior: EstadoProduto,
  form: FormData,
): Promise<EstadoProduto> {
  const sessao = await exigirSessao(slug)

  const precos = precosDo(form)
  const reposicao = prazo(form)
  const comoServico = servicoDo(form)
  if ('campos' in precos || 'erro' in reposicao || 'erro' in comoServico) {
    return {
      erro: ERRO_NOS_CAMPOS,
      campos: {
        ...('campos' in precos ? precos.campos : {}),
        ...('erro' in reposicao ? { prazoReposicaoDias: reposicao.erro } : {}),
        ...('erro' in comoServico ? { duracaoMin: comoServico.erro } : {}),
      },
    }
  }
  const p = precos.valores
  const vista = p.precoVista!
  const doItem = precosDosItensDo(form)
  if ('campos' in doItem) return { erro: ERRO_NOS_CAMPOS, campos: doItem.campos }
  const atual = await comoOrg(sessao.orgId, (db) =>
    db.produto.findUnique({ where: { id: produtoId }, select: { vendidoEm: true } }),
  )
  if (!atual) return { erro: 'Produto não encontrado.' }
  const vendido = await vendidoEmDo(form, sessao, atual.vendidoEm)
  if (vendido.erro) return { erro: vendido.erro }

  const medidaBruta = String(form.get('medida') ?? 'UN') as Medida
  const medida = MEDIDAS.includes(medidaBruta) ? medidaBruta : 'UN'

  try {
    const r = await editarProduto(sessao, produtoId, {
      nome: String(form.get('nome') ?? ''),
      marca: String(form.get('marca') ?? ''),
        referencia: String(form.get('referencia') ?? ''),
      descricao: String(form.get('descricao') ?? ''),
      categoriaId: String(form.get('categoriaId') ?? '') || null,
      medida,
      precoVista: vista,
      // Em branco fica igual ao à vista; fora do formulário, fica como está.
      precoCartao: p.precoCartao === undefined ? undefined : (p.precoCartao ?? vista),
      precoCrediario: p.precoCrediario === undefined ? undefined : (p.precoCrediario ?? vista),
      // Sem o campo na tela (quem não vê custo deste produto), nada muda.
      custo: p.custo,
      prazoReposicaoDias: reposicao.valor,
      ...comoServico,
      ...marcasDo(form),
      vendidoEm: vendido.valor,
      ativo: form.get('ativo') === 'on',
    })
    if (!r.ok) return { erro: r.motivo }

    // Grade travada (produto de lojas que a pessoa não cuida): a tela mostra
    // as opções sem campo, e aí o formulário chegaria "sem nada marcado".
    // `ajustarGrade` recusaria de qualquer jeito; pular é não gritar à toa.
    let g = { criadas: 0, reativadas: 0, desativadas: 0, apagadas: 0 }
    if (form.get('gradeTravada') !== '1') {
      try {
        g = await ajustarGrade(sessao, produtoId, eixosDoFormulario(form, eixosDaEmpresa))
      } catch (e) {
        // A ficha já foi gravada (outra transação): a tela precisa dizer que
        // o resto entrou e só a grade ficou como estava — senão a pessoa
        // redigita preço e nome achando que nada foi salvo.
        if (e instanceof GradeRecusada) {
          revalidatePath(`/${slug}/produtos/${produtoId}`)
          return { erro: `O resto da ficha foi salvo, mas a grade não mudou. ${e.message}` }
        }
        throw e
      }
    }

    // O preço de cada item vem DEPOIS do preço do produto: a diferença é
    // medida sobre o preço à vista que acabou de ser gravado.
    let precosMudaram = 0
    if (doItem.itens.length > 0) {
      try {
        precosMudaram = await definirPrecosDosItens(sessao, produtoId, doItem.itens)
      } catch (e) {
        if (e instanceof PrecoDoItemRecusado) {
          revalidatePath(`/${slug}/produtos/${produtoId}`)
          return { erro: `O resto da ficha foi salvo, mas o preço dos itens não mudou. ${e.message}` }
        }
        throw e
      }
    }

    revalidatePath(`/${slug}/produtos`)
    revalidatePath(`/${slug}/produtos/${produtoId}`)

    // Diz o que MUDOU na grade, não "salvo com sucesso": mexer em eixo pode
    // criar dez variações sem a pessoa perceber, e desativar as que tinham
    // venda. Ela precisa ver o número.
    const partes = [
      g.criadas && `${plural(g.criadas, 'variação nova', 'variações novas')}`,
      g.reativadas && `${plural(g.reativadas, 'reativada', 'reativadas')}`,
      g.desativadas && `${plural(g.desativadas, 'desativada', 'desativadas')} (${palavra(g.desativadas, 'tinha', 'tinham')} histórico)`,
      g.apagadas && `${plural(g.apagadas, 'removida', 'removidas')}`,
      precosMudaram > 0 && `${plural(precosMudaram, 'preço de item mudou', 'preços de itens mudaram')}`,
    ].filter(Boolean)

    return { ok: partes.length > 0 ? `Salvo. ${partes.join(', ')}.` : 'Salvo.' }
  } catch (e) {
    if (e instanceof SemPermissao) {
      return { erro: 'Você não tem permissão para essa alteração. O preço exige permissão própria.' }
    }
    return { erro: recadoDoErro(e, 'Não deu para salvar.') }
  }
}

/** O que a ficha recebe de volta ao criar um eixo ou uma opção na hora. */
export type EixoCriado = { id: string; nome: string; ehCor: boolean; opcoes: { id: string; valor: string; hex: string | null }[] }

/** "+ Novo sabor": cria a opção no eixo e devolve para a ficha já marcar. */
export async function novaOpcao(
  slug: string,
  eixoId: string,
  valor: string,
  hex?: string | null,
): Promise<{ opcao: { id: string; valor: string; hex: string | null } } | { erro: string }> {
  const sessao = await exigirSessao(slug)
  try {
    return { opcao: await criarOpcaoDoEixo(sessao, eixoId, valor, hex) }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para criar opções.' }
    return { erro: recadoDoErro(e, 'Não deu para criar a opção.') }
  }
}

/** "+ Novo eixo": cria Sabor, Tamanho, Cor… quando a empresa ainda não tem. */
export async function novoEixo(
  slug: string,
  nome: string,
  ehCor: boolean,
): Promise<{ eixo: EixoCriado } | { erro: string }> {
  const sessao = await exigirSessao(slug)
  try {
    return { eixo: await criarEixoDaEmpresa(sessao, nome, ehCor) }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para criar eixos.' }
    return { erro: recadoDoErro(e, 'Não deu para criar o eixo.') }
  }
}

/**
 * Pôr de volta à venda o produto que foi tirado. A regra inteira (quem
 * pode, em que lojas) é a de `editarProduto` — situação vale para toda loja
 * onde o produto é vendido.
 */
export async function voltarAVenda(slug: string, produtoId: string): Promise<EstadoProduto> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await reativarProduto(sessao, produtoId)
    if (!r.ok) return { erro: r.motivo }
    revalidatePath(`/${slug}/produtos`)
    revalidatePath(`/${slug}/produtos/${produtoId}`)
    return { ok: 'De volta à venda.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para mexer neste produto.' }
    return { erro: recadoDoErro(e, 'Não deu para pôr de volta à venda.') }
  }
}

/**
 * "Excluir produto". Não apaga nada do banco — ver `excluirProduto`. Dá certo,
 * volta à lista com o recado; dá errado, devolve a frase para a janela.
 */
export async function excluir(slug: string, produtoId: string): Promise<EstadoProduto> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await excluirProduto(sessao, produtoId)
    if (!r.ok) return { erro: r.motivo }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para excluir este produto.' }
    return { erro: recadoDoErro(e, 'Não deu para excluir.') }
  }
  revalidatePath(`/${slug}/produtos`)
  revalidatePath(`/${slug}/produtos/${produtoId}`)
  redirect(`/${slug}/produtos?excluido=1`)
}
