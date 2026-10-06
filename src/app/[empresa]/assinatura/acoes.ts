'use server'

// SERVER ACTION É ENDEREÇO PÚBLICO — a checagem inteira acontece aqui, mesmo
// que a tela já tenha escondido o botão.

import { revalidatePath } from 'next/cache'
import type { Plano } from '@prisma/client'
import { exigirSessao } from '@/servidor/pagina'
import { exigir, exigirQueNaoSejaSuporte, podeVerPlanos, SemPermissao } from '@/servidor/permissao'
import { MODULOS, type Modulo } from '@/servidor/modulos'
import {
  trocarPlano,
  adicionarPacoteDeRespostas,
  SemCota,
  assinaturaDe,
  assinaturaLivre,
  registrarPedido,
} from '@/servidor/assinatura'
import { PACOTES, PLANOS, PRECOS, ehPacote, milhar, mudanca, rs, type Pacote } from '@/servidor/planos'
import { EMPRESA } from '@/servidor/legal'

const reais = rs

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

  // Fora da tabela (o Grátis, o plano de contrato) não se escolhe por clique:
  // o Grátis é onde a empresa cai quando o teste acaba, e o de contrato é o
  // combinado com os primeiros clientes. A tela nem oferece; isto é para quem
  // chama a ação direto.
  if (!PLANOS[alvo].aVenda) {
    return { erro: `O plano ${PLANOS[alvo].titulo} não está à venda. Fale com a gente em ${EMPRESA.email}.` }
  }

  exigir(s, 'empresa.configurar')
  const a = await assinaturaDe(s)

  // Quem está no plano de contrato troca falando com a gente: trocar por
  // clique desfaria o valor e as condições que foram combinados.
  if (!PLANOS[a.plano].aVenda && a.plano !== 'GRATIS') {
    return {
      erro: `O seu plano (${a.titulo}) é de contrato. Para mudar, fale com a gente em ${EMPRESA.email}.`,
    }
  }

  // Subir é pedido, enquanto não há cobrança automática: ver `assinaturaLivre`.
  // Em teste, QUALQUER escolha é pedido — inclusive a do plano que está sendo
  // testado e a de descer: o que a loja está dizendo é "quero assinar", e
  // assinar passa pelo pagamento. Descer na hora, em teste, só tiraria o
  // assistente de quem ainda não pagou nada.
  if (!assinaturaLivre()) {
    const previa = mudanca(a.plano, alvo, a.uso)
    if (previa.impedimentos.length > 0) return { erro: previa.impedimentos.join(' ') }
    if (previa.sentido === 'subir' || a.situacao === 'TESTE') {
      await registrarPedido(s, { tipo: 'plano', para: alvo })
      // A tela passa a mostrar "aguardando confirmação" (ver page.tsx).
      revalidatePath(`/${slug}/assinatura`)
      return {
        ok:
          a.situacao === 'TESTE'
            ? `Pedido do plano ${PLANOS[alvo].titulo} registrado. A gente confirma o pagamento com você e o ` +
              `teste vira assinatura, com tudo o que já foi lançado — ou fale direto em ${EMPRESA.email}.`
            : `Pedido do plano ${PLANOS[alvo].titulo} registrado. A gente confirma o pagamento com você ` +
                `e libera no mesmo dia — ou fale direto em ${EMPRESA.email}. Até lá, nada muda.`,
      }
    }
  }

  try {
    const m = await trocarPlano(s, alvo)
    revalidatePath(`/${slug}/assinatura`)
    if (m.de === 'BALCAO_AGENTE' && alvo === 'BALCAO') {
      return {
        ok:
          `Plano alterado para ${PLANOS.BALCAO.titulo}: o assistente passa a ser o básico (relatório, avisos e perguntas).` +
          (m.novoMensal !== null ? ` A conta passa a ${reais(m.novoMensal)} por mês.` : '') +
          (m.perde.length > 0 ? ` Módulos desligados: ${m.perde.map((x) => MODULOS[x as Modulo]?.titulo ?? x).join(', ')}.` : '') +
          ' Os dados ficam guardados para quando voltar.',
      }
    }
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
 * Mais respostas no mês: o pacote de +`PRECOS.pacoteRespostas`.
 *
 * Sem gateway, é PEDIDO — a equipe confirma o pagamento e o pacote entra no
 * mesmo dia (`adicionarPacoteDeRespostas`, pela ferramenta de operação). No
 * modo livre (banco local) entra na hora. Quando o gateway existir, esta
 * função cria a cobrança e o pacote cai no retorno do pagamento.
 */
export async function comprarPacote(
  slug: string,
  _antes: EstadoAssinatura,
  form: FormData,
): Promise<EstadoAssinatura> {
  const s = await exigirSessao(slug)
  exigir(s, 'empresa.configurar')
  // No modo livre o pacote entra sem pedido: a trava tem de estar aqui, e
  // não só em `registrarPedido`.
  exigirQueNaoSejaSuporte(s, 'mexe na Assinatura')
  const a = await assinaturaDe(s)
  // Dois tamanhos: o pequeno é o padrão; o grande sai mais barato por resposta.
  const qual: Pacote = ehPacote(form.get('pacote')) ? (form.get('pacote') as Pacote) : 'pequeno'
  const pac = PACOTES[qual]
  const pacote = `+${milhar(pac.respostas)} respostas`

  if (!a.respostas.total) {
    return { erro: 'O pacote é para quem tem o assistente no plano. Assine o Essencial ou o Profissional primeiro.' }
  }
  if (a.situacao === 'TESTE') {
    return { erro: 'No teste, o caminho é assinar: o mês passa a vir com as respostas do plano.' }
  }

  if (!assinaturaLivre()) {
    await registrarPedido(s, { tipo: 'respostas', pacote: qual })
    revalidatePath(`/${slug}/assinatura`)
    return {
      ok:
        `Pedido do pacote de ${pacote} (${rs(pac.preco)}) registrado. A gente confirma o ` +
        `pagamento com você e o pacote entra no mesmo dia — ou fale direto em ${EMPRESA.email}.`,
    }
  }

  const r = await adicionarPacoteDeRespostas(s.orgId, { quem: s.nome, autor: 'PESSOA', usuarioId: s.usuarioId, pacote: qual })
  revalidatePath(`/${slug}/assinatura`)
  return { ok: `Pacote de ${pacote} adicionado. Faltam ${milhar(r.restam ?? 0)} respostas este mês.` }
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
