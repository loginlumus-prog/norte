'use server'

// As regras do balcão e as maquininhas de cada loja. Mesma regra das outras
// ações daqui: a checagem inteira acontece no servidor (`salvarConfigDoBalcao`
// e `salvarMaquininhas` exigem `empresa.configurar`).

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { salvarConfigDoBalcao } from '@/servidor/venda'
import { salvarMaquininhas, type Maquininha } from '@/servidor/maquininhas'
import { lerNumero } from '@/servidor/dinheiro'
import { plural } from '@/ui/texto'

export type EstadoBalcao = { erro?: string; ok?: string }

export async function salvarBalcaoAcao(_antes: EstadoBalcao, form: FormData): Promise<EstadoBalcao> {
  const slug = String(form.get('empresa') ?? '')
  const s = await exigirSessao(slug)
  const max = Number(form.get('creditoMaxParcelas'))
  const jurosTexto = String(form.get('creditoJurosPct') ?? '').trim()
  const juros = jurosTexto === '' ? 0 : lerNumero(jurosTexto)
  if (!Number.isInteger(max) || max < 1 || max > 24) return { erro: 'Crédito em até quantas vezes? De 1 a 24.' }
  if (juros === null || juros < 0 || juros > 20) return { erro: 'O juro do parcelamento é um porcento de 0 a 20. Ex.: 2,5' }
  try {
    const c = await salvarConfigDoBalcao(s, {
      vendeSemEstoque: form.get('vendeSemEstoque') != null,
      valePorLoja: form.get('valePorLoja') != null,
      creditoMaxParcelas: max,
      creditoJurosPct: juros,
    })
    revalidatePath(`/${slug}/configuracoes`)
    revalidatePath(`/${slug}/balcao`)
    return {
      ok: [
        c.vendeSemEstoque ? 'Vende o que o sistema diz que acabou' : 'Trava o que o sistema diz que acabou',
        c.valePorLoja ? 'vale só na loja que emitiu' : 'vale em qualquer loja',
        `crédito em até ${c.creditoMaxParcelas}×${c.creditoJurosPct > 0 ? ` com ${String(c.creditoJurosPct).replace('.', ',')}% de juro` : ' sem juro'}`,
      ].join(' · ') + '.',
    }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para salvar agora.') }
  }
}

export async function salvarMaquininhasAcao(
  slug: string,
  unidadeId: string,
  lista: Maquininha[],
): Promise<{ erro?: string; ok?: string; lista?: Maquininha[] }> {
  try {
    const s = await exigirSessao(slug)
    if (!Array.isArray(lista)) return { erro: 'Lista inválida.' }
    if (lista.some((m) => !m?.nome?.trim())) return { erro: 'Toda maquininha precisa de um nome.' }
    if (lista.some((m) => !Array.isArray(m.formas) || m.formas.length === 0)) {
      return { erro: 'Marque em que formas cada maquininha entra (Pix, débito, crédito).' }
    }
    const salva = await salvarMaquininhas(s, unidadeId, lista)
    revalidatePath(`/${slug}/configuracoes`)
    revalidatePath(`/${slug}/balcao`)
    return {
      ok: salva.length === 0 ? 'Sem maquininha: o balcão não pergunta.' : `${plural(salva.length, 'maquininha salva', 'maquininhas salvas')}.`,
      lista: salva,
    }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para salvar agora.') }
  }
}
