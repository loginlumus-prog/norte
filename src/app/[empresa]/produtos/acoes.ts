'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// As capacidades (`produto.editar` e `produto.preco`, separadas) são exigidas
// dentro de `criarProduto`, `editarProduto` e `ajustarGrade`.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { criarProduto, editarProduto, ajustarGrade, type EixoEscolhido } from '@/servidor/produto'
import { SemPermissao, unidadesQuePodem, type Sessao } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { alcanceComum, normalizarVendidoEm, vendidoEmDoGerente } from '@/servidor/catalogo-loja'
import { palavra, plural } from '@/ui/texto'
import type { Medida } from '@prisma/client'

export type EstadoProduto = { erro?: string; ok?: string }

const MEDIDAS: Medida[] = ['UN', 'KG', 'G', 'L', 'ML', 'M', 'PAR', 'CX']

/** Vírgula é como se digita dinheiro aqui. Ponto também passa. */
const preco = (f: FormData, k: string): number | null => {
  const bruto = String(f.get(k) ?? '').trim()
  if (!bruto) return null
  const v = Number(bruto.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(v) && v >= 0 ? v : null
}

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
  const alcance = alcanceComum(unidadesQuePodem(sessao, 'produto.editar'), unidadesQuePodem(sessao, 'produto.preco'))
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

export async function criar(
  slug: string,
  eixosDaEmpresa: string[],
  _anterior: EstadoProduto,
  form: FormData,
): Promise<EstadoProduto> {
  const sessao = await exigirSessao(slug)

  const vista = preco(form, 'precoVista')
  if (vista == null || vista <= 0) return { erro: 'Informe o preço à vista.' }
  const reposicao = prazo(form)
  if ('erro' in reposicao) return { erro: reposicao.erro }
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
        descricao: String(form.get('descricao') ?? ''),
        categoriaId: String(form.get('categoriaId') ?? '') || null,
        medida,
        precoVista: vista,
        precoCartao: preco(form, 'precoCartao'),
        precoCrediario: preco(form, 'precoCrediario'),
        custo: preco(form, 'custo'),
        prazoReposicaoDias: reposicao.valor,
        vendidoEm: vendido.valor,
      },
      eixosDoFormulario(form, eixosDaEmpresa),
    )
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para cadastrar produto.' }
    return { erro: recadoDoErro(e, 'Não deu para cadastrar.') }
  }

  if (!r.ok) return { erro: r.motivo }

  revalidatePath(`/${slug}/produtos`)
  // Vai direto para a ficha: quem acabou de cadastrar quer conferir a grade
  // que nasceu, e é lá que ela está.
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

  const vista = preco(form, 'precoVista')
  if (vista == null || vista <= 0) return { erro: 'Informe o preço à vista.' }
  const reposicao = prazo(form)
  if ('erro' in reposicao) return { erro: reposicao.erro }
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
      descricao: String(form.get('descricao') ?? ''),
      categoriaId: String(form.get('categoriaId') ?? '') || null,
      medida,
      precoVista: vista,
      precoCartao: preco(form, 'precoCartao') ?? vista,
      precoCrediario: preco(form, 'precoCrediario') ?? vista,
      custo: preco(form, 'custo'),
      prazoReposicaoDias: reposicao.valor,
      vendidoEm: vendido.valor,
      ativo: form.get('ativo') === 'on',
    })
    if (!r.ok) return { erro: r.motivo }

    // Grade travada (produto de lojas que a pessoa não cuida): a tela mostra
    // as opções sem campo, e aí o formulário chegaria "sem nada marcado".
    // `ajustarGrade` recusaria de qualquer jeito; pular é não gritar à toa.
    const g =
      form.get('gradeTravada') === '1'
        ? { criadas: 0, reativadas: 0, desativadas: 0, apagadas: 0 }
        : await ajustarGrade(sessao, produtoId, eixosDoFormulario(form, eixosDaEmpresa))

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
    ].filter(Boolean)

    return { ok: partes.length > 0 ? `Salvo. ${partes.join(', ')}.` : 'Salvo.' }
  } catch (e) {
    if (e instanceof SemPermissao) {
      return { erro: 'Você não tem permissão para essa alteração. O preço exige permissão própria.' }
    }
    return { erro: recadoDoErro(e, 'Não deu para salvar.') }
  }
}
