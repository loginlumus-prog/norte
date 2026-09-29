'use server'

// A regra das mensalidades (Escola). SERVER ACTION É ENDEREÇO PÚBLICO: a
// permissão é conferida em `salvarConfigMensalidade`, e os tetos (multa até
// 2%, juro até 1% ao mês) em `limparConfig` — o formulário é do navegador.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { lerNumero } from '@/servidor/dinheiro'
import { JUROS_MAXIMO, MULTA_MAXIMA, PONTUALIDADE_MAXIMA, salvarConfigMensalidade } from '@/servidor/mensalidades'

export type EstadoMensalidades = { erro?: string; ok?: string }

const numero = (v: FormDataEntryValue | null): number | null => {
  const t = String(v ?? '').trim()
  return t ? lerNumero(t, 2) : 0
}

export async function salvarMensalidadesAcao(_antes: EstadoMensalidades, form: FormData): Promise<EstadoMensalidades> {
  const slug = String(form.get('empresa') ?? '')
  const s = await exigirSessao(slug)
  const multaPct = numero(form.get('multaPct'))
  const jurosMes = numero(form.get('jurosMes'))
  const pontualidadePct = numero(form.get('pontualidadePct'))
  if (multaPct === null || jurosMes === null || pontualidadePct === null) return { erro: 'Não deu para ler um dos números. Escreva assim: 2 ou 1,5.' }
  if (multaPct > MULTA_MAXIMA) return { erro: `A multa vai até ${MULTA_MAXIMA}% — é o teto do Código de Defesa do Consumidor.` }
  if (jurosMes > JUROS_MAXIMO) return { erro: `O juro vai até ${JUROS_MAXIMO}% ao mês.` }
  if (pontualidadePct > PONTUALIDADE_MAXIMA) return { erro: `O desconto de pontualidade vai até ${PONTUALIDADE_MAXIMA}%.` }
  try {
    const c = await salvarConfigMensalidade(s, {
      multaPct,
      jurosMes,
      pontualidadePct,
      avisoAtivo: form.get('avisoAtivo') === 'on',
      avisoDias: Number(form.get('avisoDias')),
      atrasoDias: Number(form.get('atrasoDias')),
    })
    revalidatePath(`/${slug}/configuracoes`)
    revalidatePath(`/${slug}/mensalidades`)
    return {
      ok:
        `Mensalidades: multa de ${String(c.multaPct).replace('.', ',')}%, juro de ${String(c.jurosMes).replace('.', ',')}% ao mês` +
        `${c.pontualidadePct > 0 ? `, ${String(c.pontualidadePct).replace('.', ',')}% para quem paga em dia` : ''}` +
        `${c.avisoAtivo ? `; aviso ${c.avisoDias} ${c.avisoDias === 1 ? 'dia' : 'dias'} antes${c.atrasoDias > 0 ? ` e ${c.atrasoDias} depois` : ''}` : '; aviso desligado'}.`,
    }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Só quem responde pela empresa muda isto.' }
    throw e
  }
}
