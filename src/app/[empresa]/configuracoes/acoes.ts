'use server'

// SERVER ACTION É ENDEREÇO PÚBLICO — vale a mesma regra do resto: a checagem
// inteira acontece aqui, mesmo que a tela já tenha escondido o formulário.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { exigir } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { salvarConfigCrediario } from '@/servidor/crediario'
import { salvarTaxas, FORMAS_COM_TAXA } from '@/servidor/taxas'
import { doPlano, liberado, planoQueAbre } from '@/servidor/planos'
import { plural } from '@/ui/texto'
import { HORAS_DE_LEMBRETE } from '@/servidor/lembretes'

export type EstadoTaxas = { erro?: string; ok?: string }

export async function salvarTaxasAcao(_antes: EstadoTaxas, form: FormData): Promise<EstadoTaxas> {
  const slug = String(form.get('empresa') ?? '')
  const s = await exigirSessao(slug)
  const taxas = FORMAS_COM_TAXA.map((f) => {
    const bruto = String(form.get(`taxa-${f.forma}-${f.parcelas}`) ?? '').trim().replace(',', '.')
    const n = bruto === '' ? 0 : Number(bruto)
    return { forma: f.forma, parcelas: f.parcelas, percentual: n }
  })
  if (taxas.some((t) => !Number.isFinite(t.percentual) || t.percentual < 0)) {
    return { erro: 'Taxa é um número em porcento, zero ou mais. Ex.: 3,2' }
  }
  if (taxas.some((t) => t.percentual > 30)) {
    return { erro: 'Nenhuma maquininha cobra mais de 30%. Confira o número — é porcento, não reais.' }
  }
  await salvarTaxas(s, taxas)
  revalidatePath(`/${slug}/configuracoes`)
  revalidatePath(`/${slug}/financeiro`)
  return { ok: 'Taxas salvas. O resultado do mês já desconta.' }
}

export type EstadoCrediario = { erro?: string; ok?: string }

export async function salvarCrediario(
  _antes: EstadoCrediario,
  form: FormData,
): Promise<EstadoCrediario> {
  const slug = String(form.get('empresa') ?? '')
  const s = await exigirSessao(slug)
  const jurosMes = Number(String(form.get('jurosMes') ?? '').replace(',', '.'))
  const maxParcelas = Number(form.get('maxParcelas'))
  const diasEntre = Number(form.get('diasEntre'))
  if (!Number.isFinite(jurosMes) || jurosMes < 0) return { erro: 'O juro precisa ser um número, zero ou mais.' }
  if (!Number.isInteger(maxParcelas) || maxParcelas < 1) return { erro: 'Em quantas vezes? Pelo menos 1.' }
  if (!Number.isInteger(diasEntre) || diasEntre < 7) return { erro: 'O intervalo entre parcelas precisa ser de pelo menos 7 dias.' }

  const salvo = await salvarConfigCrediario(s, { jurosMes, maxParcelas, diasEntre })
  revalidatePath(`/${slug}/configuracoes`)
  revalidatePath(`/${slug}/balcao`)
  return { ok: `Crediário: ${salvo.jurosMes}% ao mês de atraso, até ${salvo.maxParcelas}×, a cada ${salvo.diasEntre} dias.` }
}

export type EstadoPontos = { erro?: string; ok?: string }

const numero = (v: FormDataEntryValue | null): number => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export async function salvarPontos(
  _antes: EstadoPontos,
  form: FormData,
): Promise<EstadoPontos> {
  const slug = String(form.get('empresa') ?? '')
  const s = await exigirSessao(slug)

  // Programa de fidelidade é compromisso financeiro da empresa. Quem mexe é
  // quem responde pelo dinheiro, não quem opera o caixa.
  exigir(s, 'empresa.configurar')

  const ativo = form.get('ativo') != null

  // O programa de pontos é dos planos pagos (`RECURSOS`). Desligar vale em
  // qualquer plano — quem desceu de plano precisa conseguir sair.
  if (ativo) {
    const plano = await comoOrg(s.orgId, (db) =>
      db.org.findUniqueOrThrow({ where: { id: s.orgId }, select: { plano: true } }),
    ).then((o) => o.plano)
    if (!liberado(plano, 'pontos.programa')) {
      return { erro: `O programa de pontos é ${doPlano(planoQueAbre('pontos.programa').codigo)} para cima.` }
    }
  }

  const porReal = numero(form.get('porReal'))
  const pontoVale = numero(form.get('pontoVale'))
  const minimo = Math.max(0, Math.floor(numero(form.get('minimo'))))

  // Só reclama quando o programa está ligado: desligar com os campos zerados
  // tem que funcionar, senão a pessoa fica presa dentro do que ligou.
  if (ativo) {
    if (porReal <= 0) return { erro: 'Quantos pontos cada real gera? Precisa ser maior que zero.' }
    if (pontoVale <= 0) return { erro: 'Quanto vale um ponto? Precisa ser maior que zero.' }

    // Teto duro. Não é preciosismo: a 1 ponto por real, R$ 1,00 o ponto
    // devolveria 100% da venda — a loja daria a mercadoria e ainda ficaria
    // devendo. Um zero a mais digitado sem querer faz exatamente isso.
    if (porReal * pontoVale > 0.5) {
      return {
        erro: `Isso devolveria ${(porReal * pontoVale * 100).toFixed(0)}% de cada venda. Confira os dois números.`,
      }
    }
  }

  await comoOrg(s.orgId, async (db) => {
    await db.org.update({
      where: { id: s.orgId },
      data: { pontosAtivo: ativo, pontosPorReal: porReal, pontoVale, pontosMinimo: minimo },
    })
    await db.auditoria.create({
      data: {
        orgId: s.orgId,
        usuarioId: s.usuarioId,
        quem: s.nome,
        acao: 'pontos.configurou',
        alvoTipo: 'empresa',
        alvoId: s.orgId,
        // O livro guarda o desenho do programa, não só "mexeu": é o que
        // permite responder depois por que o saldo de alguém rendeu diferente.
        motivo: ativo
          ? `${plural(porReal, 'ponto', 'pontos')}/R$, ponto vale R$ ${pontoVale}, mínimo ${minimo}`
          : 'desligou',
      },
    })
  })

  revalidatePath(`/${slug}/configuracoes`)
  return { ok: ativo ? 'Programa de pontos salvo.' : 'Programa de pontos desligado.' }
}

export type EstadoLembrete = { erro?: string; ok?: string }

/**
 * O lembrete do horário (lembretes.ts): liga, desliga e escolhe a
 * antecedência. Só com a Agenda ligada — sem ela não há horário a lembrar.
 */
export async function salvarLembreteAcao(_antes: EstadoLembrete, form: FormData): Promise<EstadoLembrete> {
  const slug = String(form.get('empresa') ?? '')
  const s = await exigirSessao(slug)
  exigir(s, 'empresa.configurar')
  const ativo = form.get('ativo') === 'on'
  const horas = Number(form.get('horas'))
  if (!(HORAS_DE_LEMBRETE as readonly number[]).includes(horas)) return { erro: 'Escolha quanto tempo antes.' }
  const r = await comoOrg(s.orgId, async (db) => {
    const org = await db.org.findUnique({ where: { id: s.orgId }, select: { modulos: true, lembreteAtivo: true, lembreteHoras: true } })
    if (!org?.modulos.includes('agenda')) return false
    await db.org.update({ where: { id: s.orgId }, data: { lembreteAtivo: ativo, lembreteHoras: horas } })
    await db.auditoria.create({
      data: {
        orgId: s.orgId,
        usuarioId: s.usuarioId,
        quem: s.nome,
        acao: 'empresa.lembrete',
        antes: { ativo: org.lembreteAtivo, horas: org.lembreteHoras },
        depois: { ativo, horas },
      },
    })
    return true
  })
  if (!r) return { erro: 'Ligue a Agenda antes: o lembrete é dos horários marcados nela.' }
  revalidatePath(`/${slug}/configuracoes`)
  return { ok: ativo ? `Lembrete ligado: sai ${horas === 24 ? 'um dia' : horas === 48 ? 'dois dias' : `${horas} horas`} antes do horário.` : 'Lembrete desligado.' }
}
