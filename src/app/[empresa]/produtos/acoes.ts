'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// As capacidades (`produto.editar` e `produto.preco`, separadas) são exigidas
// dentro de `criarProduto`, `editarProduto` e `ajustarGrade`.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirSessao } from '@/servidor/pagina'
import { criarProduto, editarProduto, ajustarGrade, type EixoEscolhido } from '@/servidor/produto'
import { SemPermissao } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { normalizarVendidoEm } from '@/servidor/catalogo-loja'
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
 * `undefined` = o formulário não tinha a pergunta (empresa de uma loja só) e
 * nada muda. O que veio marcado é conferido contra as lojas abertas DESTA
 * empresa — o nome do campo vem do navegador — e todas marcadas vira vazio,
 * que quer dizer "todas, inclusive as que abrirem depois".
 */
async function vendidoEmDo(
  form: FormData,
  orgId: string,
): Promise<{ valor?: string[]; erro?: string }> {
  if (form.get('temLojas') !== '1') return {}
  const marcadas = [...form.keys()]
    .filter((k) => k.startsWith('vendidoEm_'))
    .map((k) => k.slice('vendidoEm_'.length))
  if (marcadas.length === 0) return { erro: 'Marque pelo menos uma loja onde o produto é vendido.' }
  const lojas = await comoOrg(orgId, (db) =>
    db.unidade.findMany({ where: { ativa: true, ehDeposito: false }, select: { id: true } }),
  )
  return { valor: normalizarVendidoEm(marcadas, lojas.map((l) => l.id)) }
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
  const vendido = await vendidoEmDo(form, sessao.orgId)
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
    return { erro: e instanceof Error ? e.message : 'Não deu para cadastrar.' }
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
  const vendido = await vendidoEmDo(form, sessao.orgId)
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

    const g = await ajustarGrade(sessao, produtoId, eixosDoFormulario(form, eixosDaEmpresa))

    revalidatePath(`/${slug}/produtos`)
    revalidatePath(`/${slug}/produtos/${produtoId}`)

    // Diz o que MUDOU na grade, não "salvo com sucesso": mexer em eixo pode
    // criar dez variações sem a pessoa perceber, e desativar as que tinham
    // venda. Ela precisa ver o número.
    const partes = [
      g.criadas && `${g.criadas} variação(ões) nova(s)`,
      g.reativadas && `${g.reativadas} reativada(s)`,
      g.desativadas && `${g.desativadas} desativada(s) (tinham histórico)`,
      g.apagadas && `${g.apagadas} removida(s)`,
    ].filter(Boolean)

    return { ok: partes.length > 0 ? `Salvo. ${partes.join(', ')}.` : 'Salvo.' }
  } catch (e) {
    if (e instanceof SemPermissao) {
      return { erro: 'Você não tem permissão para essa alteração. O preço exige permissão própria.' }
    }
    return { erro: e instanceof Error ? e.message : 'Não deu para salvar.' }
  }
}
