'use server'

// SERVER ACTION É ENDEREÇO PÚBLICO — a checagem inteira acontece aqui, mesmo
// que a tela já tenha escondido o botão.

import { revalidatePath } from 'next/cache'
import type { Plano } from '@prisma/client'
import { exigirSessao } from '@/servidor/pagina'
import { exigir } from '@/servidor/permissao'
import { trocarPlano, recarregarCredito, SemCota, assinaturaDe } from '@/servidor/assinatura'
import { PLANOS } from '@/servidor/planos'
import { centavos, mostrar } from '@/servidor/dinheiro'

export type EstadoAssinatura = { erro?: string; ok?: string }

export async function trocar(
  slug: string,
  _antes: EstadoAssinatura,
  form: FormData,
): Promise<EstadoAssinatura> {
  const s = await exigirSessao(slug)
  const alvo = String(form.get('plano') ?? '') as Plano

  if (!(alvo in PLANOS)) return { erro: 'Plano desconhecido.' }

  // O Corporativo não é comprado por clique: ele é um acordo, com escopo e
  // preço definidos caso a caso. Deixar trocar sozinho criaria uma empresa
  // sem preço combinado e com tudo liberado.
  if (PLANOS[alvo].mensal === null) {
    return { erro: 'O plano Corporativo é fechado por conversa. Use o botão de contato.' }
  }

  try {
    const m = await trocarPlano(s, alvo)
    revalidatePath(`/${slug}/assinatura`)
    return {
      ok:
        m.sentido === 'descer'
          ? `Plano alterado para ${PLANOS[alvo].titulo}.` +
            (m.perde.length > 0 ? ` Módulos desligados: ${m.perde.join(', ')}.` : '')
          : `Plano alterado para ${PLANOS[alvo].titulo}.`,
    }
  } catch (e) {
    if (e instanceof SemCota) return { erro: e.motivo }
    throw e
  }
}

/**
 * Recarga de crédito de IA.
 *
 * Hoje ela credita direto: não há gateway ainda, e quem opera é quem responde
 * pela empresa. Quando o gateway entrar, esta função passa a criar a cobrança
 * e o crédito só cai no retorno do pagamento — o resto do sistema não muda,
 * porque ninguém além daqui sabe de onde o crédito veio.
 */
export async function recarregar(
  slug: string,
  _antes: EstadoAssinatura,
  form: FormData,
): Promise<EstadoAssinatura> {
  const s = await exigirSessao(slug)
  exigir(s, 'empresa.configurar')

  const valor = String(form.get('valor') ?? '').replace(',', '.')
  const cent = centavos(valor || 0)

  if (cent <= 0) return { erro: 'Diga quanto quer colocar de crédito.' }
  // Teto de segurança: um zero a mais numa recarga manual é dinheiro que
  // ninguém consegue explicar depois.
  if (cent > 500_000) return { erro: 'Recarga acima de R$ 5.000 precisa passar pelo suporte.' }

  const saldo = await recarregarCredito(s.orgId, cent, {
    tipo: 'COMPRA',
    quem: s.nome,
    origem: 'manual',
    motivo: 'Recarga pela tela',
  })

  revalidatePath(`/${slug}/assinatura`)
  return { ok: `Crédito adicionado. Saldo agora: ${mostrar(saldo)}.` }
}

/** O que a tela precisa saber depois de uma ação, sem recarregar tudo. */
export async function situacao(slug: string) {
  const s = await exigirSessao(slug)
  return assinaturaDe(s)
}
