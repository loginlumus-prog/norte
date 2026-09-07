'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// As capacidades (`produto.editar` e `produto.preco`, separadas) são exigidas
// dentro de `criarProduto`, `editarProduto` e `ajustarGrade`.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirSessao } from '@/servidor/pagina'
import { criarProduto, editarProduto, ajustarGrade, type EixoEscolhido } from '@/servidor/produto'
import { SemPermissao } from '@/servidor/permissao'
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

export async function criar(
  slug: string,
  eixosDaEmpresa: string[],
  _anterior: EstadoProduto,
  form: FormData,
): Promise<EstadoProduto> {
  const sessao = await exigirSessao(slug)

  const vista = preco(form, 'precoVista')
  if (vista == null || vista <= 0) return { erro: 'Informe o preço à vista.' }

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
