'use server'

// Trazer produtos de outro sistema: as ações da tela. Cada uma confere a
// sessão e chama o serviço (src/servidor/importacao.ts), que confere a
// permissão e o que veio — Server Action é endereço público, e o botão
// escondido não protege nada.

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import {
  conferirExistentes,
  importarLote,
  sugerirColunas,
  type ResultadoLote,
  type SeJaExiste,
} from '@/servidor/importacao'
import type { Campo } from '@/servidor/importacao-planilha'

/** A IA diz o que é cada coluna. Só a amostra sobe; sem IA, `ok: false` e a tela segue com o palpite. */
export async function sugerirColunasAcao(
  slug: string,
  amostra: string[][],
): Promise<{ ok: true; cabecalho: number | null; campos: Campo[] } | { ok: false }> {
  const sessao = await exigirSessao(slug)
  try {
    return await sugerirColunas(sessao, amostra)
  } catch {
    return { ok: false }
  }
}

/** Quais códigos e nomes da planilha o Norte já tem — para a prévia. */
export async function conferirExistentesAcao(
  slug: string,
  p: { codigos: string[]; nomes: string[] },
): Promise<{ codigos: string[]; nomes: string[] } | { erro: string }> {
  const sessao = await exigirSessao(slug)
  try {
    return await conferirExistentes(sessao, p)
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode ver os produtos.' }
    return { erro: recadoDoErro(e, 'Não deu para conferir o que já existe.') }
  }
}

/**
 * Um lote. Não revalida a tela a cada lote: cada revalidação redesenha a
 * página no servidor, e numa importação de 50 lotes isso é 50 telas
 * desenhadas para ninguém ver. O fim chama `terminarImportacaoAcao`.
 */
export async function importarLoteAcao(
  slug: string,
  e: { unidadeId: string | null; seJaExiste: SeJaExiste; itens: unknown[]; pin?: string | null },
): Promise<ResultadoLote> {
  const sessao = await exigirSessao(slug)
  try {
    return await importarLote(sessao, {
      unidadeId: e?.unidadeId ?? null,
      seJaExiste: e?.seJaExiste,
      itens: Array.isArray(e?.itens) ? e.itens : [],
      pin: e?.pin ? String(e.pin).replace(/\D/g, '') : null,
    })
  } catch (erro) {
    if (erro instanceof SemPermissao) {
      return {
        ok: false,
        erro: erro.capacidade === 'estoque.ajustar'
          ? 'Você não pode mexer no estoque desta loja. Escolha outra loja, ou tire a coluna de estoque.'
          : 'Você não pode cadastrar produto.',
      }
    }
    return { ok: false, erro: recadoDoErro(erro, 'Não deu para trazer este pedaço.') }
  }
}

/** O fim: as listas de produtos e de estoque passam a mostrar o que chegou. */
export async function terminarImportacaoAcao(slug: string): Promise<void> {
  await exigirSessao(slug)
  revalidatePath(`/${slug}/produtos`)
  revalidatePath(`/${slug}/estoque`)
  revalidatePath(`/${slug}`)
}
