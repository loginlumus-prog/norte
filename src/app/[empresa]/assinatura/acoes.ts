'use server'

// SERVER ACTION É ENDEREÇO PÚBLICO — a checagem inteira acontece aqui, mesmo
// que a tela já tenha escondido o botão.

import { revalidatePath } from 'next/cache'
import type { Plano } from '@prisma/client'
import { exigirSessao } from '@/servidor/pagina'
import { exigir, podeVerPlanos, SemPermissao } from '@/servidor/permissao'
import { MODULOS, type Modulo } from '@/servidor/modulos'
import {
  trocarPlano,
  recarregarCredito,
  SemCota,
  assinaturaDe,
  assinaturaLivre,
  registrarPedido,
} from '@/servidor/assinatura'
import { PLANOS, mudanca } from '@/servidor/planos'
import { EMPRESA } from '@/servidor/legal'
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

  // Subir é pedido, enquanto não há cobrança automática: ver `assinaturaLivre`.
  if (!assinaturaLivre()) {
    exigir(s, 'empresa.configurar')
    const a = await assinaturaDe(s)
    const previa = mudanca(a.plano, alvo, a.uso)
    if (previa.impedimentos.length > 0) return { erro: previa.impedimentos.join(' ') }
    if (previa.sentido === 'subir') {
      await registrarPedido(s, { tipo: 'plano', para: alvo })
      // A tela passa a mostrar "aguardando confirmação" (ver page.tsx).
      revalidatePath(`/${slug}/assinatura`)
      return {
        ok:
          `Pedido do plano ${PLANOS[alvo].titulo} registrado. A gente confirma o pagamento com você ` +
          `e libera no mesmo dia — ou fale direto em ${EMPRESA.email}. Até lá, nada muda.`,
      }
    }
  }

  try {
    const m = await trocarPlano(s, alvo)
    revalidatePath(`/${slug}/assinatura`)
    return {
      ok:
        m.sentido === 'descer'
          ? `Plano alterado para ${PLANOS[alvo].titulo}.` +
            (m.perde.length > 0
              ? ` Módulos desligados: ${m.perde.map((x) => MODULOS[x as Modulo]?.titulo ?? x).join(', ')}.`
              : '')
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

  if (!assinaturaLivre()) {
    await registrarPedido(s, { tipo: 'credito', centavos: cent })
    revalidatePath(`/${slug}/assinatura`)
    return {
      ok:
        `Pedido de ${mostrar(cent)} de crédito registrado. A gente confirma o pagamento com você ` +
        `e o crédito cai no mesmo dia — ou fale direto em ${EMPRESA.email}.`,
    }
  }

  const saldo = await recarregarCredito(s.orgId, cent, {
    tipo: 'COMPRA',
    quem: s.nome,
    origem: 'manual',
    motivo: 'Recarga pela tela',
  })

  revalidatePath(`/${slug}/assinatura`)
  return { ok: `Crédito adicionado. Saldo agora: ${mostrar(saldo)}.` }
}

/**
 * O que a tela precisa saber depois de uma ação, sem recarregar tudo.
 *
 * É endereço público: sem a checagem, qualquer pessoa logada — a balconista
 * — lia o plano, a mensalidade e o saldo de crédito chamando a ação direto.
 * A mesma régua da tela de Assinatura.
 */
export async function situacao(slug: string) {
  const s = await exigirSessao(slug)
  if (!podeVerPlanos(s)) throw new SemPermissao('empresa.configurar')
  return assinaturaDe(s)
}
