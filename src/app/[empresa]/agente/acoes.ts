'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// `salvarAgente` exige `agente.configurar` lá dentro, e filtra os poderes
// contra a lista fechada antes de gravar: o que chega do formulário vem do
// navegador, e o navegador é do usuário.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { salvarAgente, responderProposta } from '@/servidor/agente'
import { TODOS_PODERES } from '@/servidor/poderes'
import { centavos } from '@/servidor/dinheiro'
import { acharOrgPorSlug } from '@/servidor/banco'

export type EstadoAgente = { erro?: string; ok?: string }

const num = (f: FormData, k: string, padrao: number) => {
  const v = Number(String(f.get(k) ?? '').replace(',', '.'))
  return Number.isFinite(v) && v >= 0 ? v : padrao
}

export async function salvar(
  slug: string,
  _anterior: EstadoAgente,
  form: FormData,
): Promise<EstadoAgente> {
  const sessao = await exigirSessao(slug)

  const nome = String(form.get('nome') ?? '').trim()
  if (!nome) return { erro: 'O assistente precisa de um nome.' }
  if (nome.length > 40) return { erro: 'Um nome de até 40 letras.' }

  try {
    await salvarAgente(sessao, {
      nome,
      personalidade: String(form.get('personalidade') ?? ''),
      saudacao: String(form.get('saudacao') ?? ''),
      manual: String(form.get('manual') ?? ''),
      poderes: TODOS_PODERES.filter((p) => form.get(`poder_${p}`) === 'on'),
      descontoMaxPct: num(form, 'descontoMaxPct', 5),
      valorMaxCent: centavos(num(form, 'valorMax', 500)),
      gastoDiaCent: centavos(num(form, 'gastoDia', 10)),
      mensagensDia: Math.round(num(form, 'mensagensDia', 300)),
      ativo: form.get('ativo') === 'on',
    })
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não deu para salvar.' }
  }

  revalidatePath(`/${slug}/agente`)
  return { ok: 'Salvo.' }
}

/** Confirmar ou recusar uma proposta pela tela. Pelo WhatsApp é o mesmo caminho. */
export async function responder(slug: string, propostaId: string, aceita: boolean) {
  const sessao = await exigirSessao(slug)
  const empresa = await acharOrgPorSlug(slug)
  if (!empresa) return { ok: false as const, motivo: 'nao_existe' as const }

  const r = await responderProposta(sessao, empresa, propostaId, aceita)
  revalidatePath(`/${slug}/agente`)
  return r
}
