'use server'

// SERVER ACTION É ENDEREÇO PÚBLICO — a checagem inteira mora em `apagarTurno`.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { exigirQueNaoSejaSuporte, SemPermissao } from '@/servidor/permissao'
import { apagarTurno, TurnoNaoApaga } from '@/servidor/caixa'

export async function apagarTurnoAcao(slug: string, caixaId: string, motivo: string): Promise<{ erro?: string; ok?: true }> {
  const s = await exigirSessao(slug)
  try {
    exigirQueNaoSejaSuporte(s, 'apaga turno de caixa')
    await apagarTurno(s, caixaId, motivo)
  } catch (e) {
    if (e instanceof TurnoNaoApaga) return { erro: e.message }
    if (e instanceof SemPermissao) return { erro: 'Só o dono apaga turno de caixa.' }
    return { erro: recadoDoErro(e, 'Não deu para apagar o turno.') }
  }
  revalidatePath(`/${slug}/caixa`)
  return { ok: true }
}
