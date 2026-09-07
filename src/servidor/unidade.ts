// Qual unidade a pessoa está olhando.
//
// Três regras que vêm do uso real:
//
// 1. Quem tem UMA loja não deve descobrir que existe o conceito de unidade.
//    O seletor some, o filtro some, e o sistema parece feito para ela.
//
// 2. Quem tem várias precisa dos dois: cada loja separada E o consolidado.
//    "Vendi bem?" e "a loja do shopping vendeu bem?" são perguntas diferentes,
//    e o dono faz as duas no mesmo minuto.
//
// 3. A escolha vive no ENDEREÇO (?unidade=...), não em cookie escondido.
//    Assim o gerente manda o link para o dono e os dois veem a mesma tela —
//    com cookie, cada um veria a sua e a conversa não fecha.

import { comoOrg } from './banco'
import { unidadesQuePodem, type Capacidade, type Sessao } from './permissao'
import { moduloLigado, type ComModulos } from './modulos'

export type UnidadeVisivel = { id: string; nome: string; ehDeposito: boolean }

/**
 * As unidades que esta pessoa pode ver, para esta capacidade.
 * O gerente da loja 3 recebe só a 3, mesmo que a empresa tenha oito.
 */
export async function unidadesVisiveis(
  sessao: Sessao,
  capacidade: Capacidade = 'venda.ver',
): Promise<UnidadeVisivel[]> {
  const permitidas = unidadesQuePodem(sessao, capacidade)
  if (Array.isArray(permitidas) && permitidas.length === 0) return []

  return comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({
      where: {
        ativa: true,
        ...(permitidas === 'todas' ? {} : { id: { in: permitidas } }),
      },
      orderBy: [{ ehDeposito: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true, ehDeposito: true },
    }),
  )
}

export type Escolha = {
  /** null = consolidado (todas as unidades visíveis). */
  unidadeId: string | null
  /** Sempre preenchido: é por onde as consultas filtram. */
  ids: string[]
  opcoes: UnidadeVisivel[]
  /** Falso quando não vale mostrar seletor: uma unidade só, ou módulo desligado. */
  mostrarSeletor: boolean
  titulo: string
}

/**
 * Resolve o que veio no endereço contra o que a pessoa pode ver.
 *
 * Unidade de outra empresa, ou unidade que esta pessoa não alcança, cai no
 * consolidado em vez de dar erro — endereço colado errado não deve virar tela
 * quebrada, e também não pode virar porta dos fundos.
 */
export async function escolherUnidade(
  sessao: Sessao,
  empresa: ComModulos,
  pedida: string | undefined,
  capacidade: Capacidade = 'venda.ver',
): Promise<Escolha> {
  const opcoes = await unidadesVisiveis(sessao, capacidade)
  const varias = opcoes.length > 1 && moduloLigado(empresa, 'multiUnidade')

  const valida = pedida && opcoes.some((u) => u.id === pedida) ? pedida : null
  const unidadeId = varias ? valida : (opcoes[0]?.id ?? null)

  return {
    unidadeId,
    ids: unidadeId ? [unidadeId] : opcoes.map((u) => u.id),
    opcoes,
    mostrarSeletor: varias,
    titulo: unidadeId ? (opcoes.find((u) => u.id === unidadeId)?.nome ?? '') : 'Todas as unidades',
  }
}
