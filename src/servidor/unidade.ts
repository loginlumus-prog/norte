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
// 3. A escolha vive no ENDEREÇO (?unidade=...) sempre que ele traz uma.
//    Assim o gerente manda o link para o dono e os dois veem a mesma tela.
//    Sem nada no endereço — o clique no menu, o "voltar à lista" —, vale a
//    última escolha feita no seletor, lembrada num cookie da empresa (ver
//    unidade-lembrada.ts). Antes disso, cada clique no menu voltava para
//    "Todas as unidades" e a loja escolhida se perdia.

import { cookies } from 'next/headers'
import { comoOrg } from './banco'
import { cookieDaUnidade, pedidaOuLembrada } from './unidade-lembrada'
import { unidadesQuePodem, type Capacidade, type Sessao } from './permissao'
import { moduloLigado, type ComModulos } from './modulos'

export type UnidadeVisivel = {
  id: string
  nome: string
  ehDeposito: boolean
  /** Para o cartão da troca de loja (TrocaDeLoja): onde ela fica e o que é. */
  ehFabrica?: boolean
  bairro?: string | null
  cidade?: string | null
}

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
      select: { id: true, nome: true, ehDeposito: true, ehFabrica: true, bairro: true, cidade: true },
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
 * A unidade lembrada neste aparelho para esta empresa, ou nada. Fora de uma
 * requisição (teste, rotina) não há cookie, e não há o que lembrar.
 */
async function unidadeLembrada(slug: string): Promise<string | undefined> {
  try {
    return (await cookies()).get(cookieDaUnidade(slug))?.value
  } catch {
    return undefined
  }
}

/**
 * Resolve o que veio no endereço contra o que a pessoa pode ver.
 *
 * Sem nada no endereço, tenta a última unidade escolhida (o cookie). As duas
 * passam pela mesma conferência: unidade de outra empresa, ou unidade que
 * esta pessoa não alcança, cai no consolidado em vez de dar erro — endereço
 * colado errado não deve virar tela quebrada, e cookie antigo (a pessoa
 * perdeu a loja, a loja fechou) também não pode virar porta dos fundos.
 *
 * `empresa.slug` é o que liga a lembrança; quem não passa (os testes) fica
 * só com o endereço.
 */
export async function escolherUnidade(
  sessao: Sessao,
  empresa: ComModulos & { slug?: string },
  pedida: string | undefined,
  capacidade: Capacidade = 'venda.ver',
): Promise<Escolha> {
  const opcoes = await unidadesVisiveis(sessao, capacidade)
  const varias = opcoes.length > 1 && moduloLigado(empresa, 'multiUnidade')

  // Só vale procurar o cookie quando há o que escolher: quem alcança uma
  // loja só fica sempre com ela, lembrada ou não.
  const alvo = varias
    ? pedidaOuLembrada(pedida, !pedida && empresa.slug ? await unidadeLembrada(empresa.slug) : undefined)
    : pedida
  const valida = alvo && opcoes.some((u) => u.id === alvo) ? alvo : null
  const unidadeId = varias ? valida : (opcoes[0]?.id ?? null)

  return {
    unidadeId,
    ids: unidadeId ? [unidadeId] : opcoes.map((u) => u.id),
    opcoes,
    mostrarSeletor: varias,
    titulo: unidadeId ? (opcoes.find((u) => u.id === unidadeId)?.nome ?? '') : 'Todas as unidades',
  }
}
