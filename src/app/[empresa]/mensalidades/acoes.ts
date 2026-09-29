'use server'

// Server Action é endereço público — ver `balcao/acoes.ts`. Aqui se lê o que
// veio (o navegador é do usuário) com a régua de todo campo de dinheiro, e se
// traduz a recusa para uma frase; o resto é de `servidor/mensalidades.ts`.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { DINHEIRO_ILEGIVEL, lerDinheiro } from '@/servidor/dinheiro'
import { dispensarMensalidade, FORMAS_DE_MENSALIDADE, receberMensalidade, RECUSA_RECEBIMENTO } from '@/servidor/mensalidades'
import { registrarErro } from '@/servidor/registro'

export type EstadoRecebimento = { erro?: string; ok?: string; pagamentoId?: string; mensalidadeId?: string }

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export async function receberMensalidadeAcao(_anterior: EstadoRecebimento, form: FormData): Promise<EstadoRecebimento> {
  const slug = texto(form.get('empresa'), 80)
  const mensalidadeId = texto(form.get('mensalidade'), 64)
  if (!idValido(mensalidadeId)) return { erro: 'Mensalidade inválida.' }
  const valor = lerDinheiro(texto(form.get('valor'), 20))
  if (valor === null) return { erro: `Valor recebido: ${DINHEIRO_ILEGIVEL}` }
  const jurosBruto = texto(form.get('juros'), 20).trim()
  const juros = jurosBruto ? lerDinheiro(jurosBruto) : 0
  if (juros === null) return { erro: `Juros: ${DINHEIRO_ILEGIVEL}` }
  const multaBruta = texto(form.get('multa'), 20).trim()
  const multa = multaBruta ? lerDinheiro(multaBruta) : 0
  if (multa === null) return { erro: `Multa: ${DINHEIRO_ILEGIVEL}` }
  const forma = FORMAS_DE_MENSALIDADE.find((f) => f === texto(form.get('forma'), 20))
  if (!forma) return { erro: 'Escolha como recebeu.' }

  const sessao = await exigirSessao(slug)
  try {
    const r = await receberMensalidade(sessao, {
      mensalidadeId,
      valor,
      juros,
      multa,
      forma,
      pontualidade: form.get('pontualidade') === 'on',
    })
    if (!r.ok) return { erro: RECUSA_RECEBIMENTO[r.motivo] }
    revalidatePath(`/${slug}/mensalidades`)
    revalidatePath(`/${slug}/balcao`)
    return {
      pagamentoId: r.pagamentoId,
      mensalidadeId,
      ok: r.quitada
        ? `Paga${r.abono > 0 ? `, com ${brl(r.abono)} de pontualidade` : ''}${r.juros + r.multa > 0 ? `, com ${brl(r.juros + r.multa)} de juro e multa` : ''}.`
        : `Recebido. Ainda restam ${brl(r.restante)} desta mensalidade.`,
    }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não recebe mensalidade nesta unidade.' }
    return { erro: `Não deu para receber. Nada foi registrado. (código ${registrarErro('mensalidade.receber', e)})` }
  }
}

export async function dispensarMensalidadeAcao(slug: string, id: string, motivo: string): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(id)) return { erro: 'Mensalidade inválida.' }
  try {
    const r = await dispensarMensalidade(sessao, id, texto(motivo, 200))
    if (!r.ok) return { erro: r.erro }
    revalidatePath(`/${slug}/mensalidades`)
    return { ok: 'Dispensada.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Dispensar mensalidade é com quem cuida do financeiro da escola.' }
    return { erro: `Não deu. Tente de novo. (código ${registrarErro('mensalidade.dispensar', e)})` }
  }
}
