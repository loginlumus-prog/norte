// Como o negócio chama quem ele atende.
//
// A loja tem CLIENTE; a clínica tem PACIENTE; a escola tem ALUNO. É a mesma
// ficha (`Cliente`), com o mesmo histórico, a mesma LGPD e as mesmas regras —
// o que muda é a palavra na tela. Quem trabalha numa clínica e lê "Clientes"
// no menu sente que o sistema não é para ela; a palavra certa é o que faz a
// tela parecer feita para o lugar.
//
// ── a regra de modulos.ts continua valendo ───────────────────
// O ramo escolhe o que é SEMEADO e o que se ESCREVE, nunca o caminho do
// código. Não existe "tela de paciente": existe a tela de clientes, que diz
// "Pacientes" porque a empresa é uma clínica. Por isso o vocabulário mora
// aqui, num lugar só, e as telas pedem a palavra em vez de perguntar o ramo.
//
// ── e as telas ───────────────────────────────────────────────
// O mesmo vale para o nome de duas telas. Na clínica, quem cobra a consulta
// fica na RECEPÇÃO, não no "balcão"; na escola, na SECRETARIA. E o catálogo
// da clínica é de serviços e materiais, não de "produtos". A tela continua
// uma só (o balcão de sempre, o cadastro de sempre); muda o que o menu, o
// título e o guia escrevem.
//
// Puro em cima (as palavras); a leitura do ramo da empresa, embaixo.

import { cache } from 'react'
import { acharOrgPorSlug, comoOrg } from './banco'
import type { Ramo } from './modulos'

export type ChaveVocabulario = 'clientes' | 'pacientes' | 'alunos'

export type Vocabulario = {
  chave: ChaveVocabulario
  /** "cliente" */
  pessoa: string
  /** "clientes" */
  pessoas: string
  /** "Cliente" — começo de frase, rótulo de campo. */
  Pessoa: string
  /** "Clientes" — menu, título. */
  Pessoas: string
  /** "Novo cliente" — o botão e o título do cadastro. */
  novo: string
  /** "do cliente" — "Nome do paciente", "Ficha do aluno". */
  daPessoa: string
  /**
   * A frase do campo de observação da agenda, quando o ramo pede cuidado. Na
   * clínica ela diz com todas as letras que informação de saúde não entra ali
   * — o Norte não guarda prontuário, e anotação clínica num campo de agenda é
   * dado sensível espalhado onde não devia (LGPD, art. 11).
   */
  avisoObservacao: string | null
}

/** O nome das telas que mudam com o ramo — menu, título da tela e guia. */
export type NomesDasTelas = {
  /** "Balcão", "Recepção", "Secretaria". */
  Balcao: string
  /** "Produtos", "Serviços e materiais". */
  Produtos: string
}

/** As palavras do ramo: quem é atendido e como as telas se chamam. */
export type VocabularioDoRamo = Vocabulario & NomesDasTelas

const VOCABULARIOS: Record<ChaveVocabulario, Vocabulario> = {
  clientes: {
    chave: 'clientes',
    pessoa: 'cliente',
    pessoas: 'clientes',
    Pessoa: 'Cliente',
    Pessoas: 'Clientes',
    novo: 'Novo cliente',
    daPessoa: 'do cliente',
    avisoObservacao: null,
  },
  pacientes: {
    chave: 'pacientes',
    pessoa: 'paciente',
    pessoas: 'pacientes',
    Pessoa: 'Paciente',
    Pessoas: 'Pacientes',
    novo: 'Novo paciente',
    daPessoa: 'do paciente',
    avisoObservacao:
      'Só combinados de atendimento (chega mais cedo, prefere a sala térrea). Não escreva sintoma, diagnóstico, exame ou remédio: informação de saúde não mora aqui.',
  },
  alunos: {
    chave: 'alunos',
    pessoa: 'aluno',
    pessoas: 'alunos',
    Pessoa: 'Aluno',
    Pessoas: 'Alunos',
    novo: 'Novo aluno',
    daPessoa: 'do aluno',
    avisoObservacao: null,
  },
}

const TELAS_PADRAO: NomesDasTelas = { Balcao: 'Balcão', Produtos: 'Produtos' }

/**
 * Os ramos que chamam as telas de outro jeito. O resto usa o padrão.
 *
 * O salão e a clínica recebem na RECEPÇÃO; a escola, na SECRETARIA. O
 * catálogo da clínica é quase todo serviço (consulta, sessão) mais o material
 * de uso — "Produtos" ali soa a farmácia; o do salão é serviço e o produto de
 * revenda. A escola vende material e uniforme: "Produtos" serve.
 */
const TELAS: Partial<Record<Ramo, Partial<NomesDasTelas>>> = {
  beleza: { Balcao: 'Recepção', Produtos: 'Serviços e produtos' },
  saude: { Balcao: 'Recepção', Produtos: 'Serviços e materiais' },
  escola: { Balcao: 'Secretaria' },
}

/** Os ramos que não chamam de cliente. O resto (a maioria) chama. */
const QUEM_ATENDE: Partial<Record<Ramo, ChaveVocabulario>> = {
  saude: 'pacientes',
  escola: 'alunos',
}

/** As palavras de um ramo. Ramo desconhecido ou vazio fala "cliente" e "Balcão". */
export function vocabularioDoRamo(ramo: string | null | undefined): VocabularioDoRamo {
  const chave = ramo && Object.hasOwn(QUEM_ATENDE, ramo) ? QUEM_ATENDE[ramo as Ramo]! : 'clientes'
  const telas = ramo && Object.hasOwn(TELAS, ramo) ? TELAS[ramo as Ramo] : undefined
  return { ...VOCABULARIOS[chave], ...TELAS_PADRAO, ...telas }
}

/** O que o menu troca pela palavra do ramo: a chave do vocabulário. */
export type PalavraDoMenu = 'Pessoas' | 'Balcao' | 'Produtos'

/**
 * Os nomes das telas desta empresa que não são os do manual, pela chave da
 * entrada do guia (`guia.ts`): { balcao: 'Recepção', clientes: 'Pacientes' }.
 * Vazio para a loja de roupa — o guia fala como sempre falou.
 */
export function nomesNoGuia(v: VocabularioDoRamo): Record<string, string> {
  const nomes: Record<string, string> = {}
  if (v.Balcao !== TELAS_PADRAO.Balcao) nomes.balcao = v.Balcao
  if (v.Produtos !== TELAS_PADRAO.Produtos) nomes.produtos = v.Produtos
  if (v.Pessoas !== VOCABULARIOS.clientes.Pessoas) nomes.clientes = v.Pessoas
  return nomes
}

// ─────────────────────────────────────────────────────────────
// COM BANCO
// ─────────────────────────────────────────────────────────────

/**
 * O vocabulário da empresa, pelo ramo DELA (o do cadastro). O menu e as telas
 * de clientes são da empresa inteira, então vale o ramo da empresa — a loja
 * com ramo próprio muda o painel dela, não o nome do cadastro.
 *
 * Guardado por requisição: o menu, o título e a tela perguntam, o banco
 * responde uma vez.
 */
export const vocabularioDaEmpresa = cache(async (orgId: string): Promise<VocabularioDoRamo> => {
  try {
    const org = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { ramo: true } }))
    return vocabularioDoRamo(org?.ramo)
  } catch {
    // Palavra é enfeite: banco fora não derruba a tela por causa dela.
    return vocabularioDoRamo(null)
  }
})

/**
 * O mesmo, a partir do endereço — para o título da aba, que é montado antes
 * de existir sessão. Lê só o ramo da empresa do endereço.
 */
export const vocabularioDoEndereco = cache(async (slug: string): Promise<VocabularioDoRamo> => {
  try {
    const org = await acharOrgPorSlug(slug)
    return org ? await vocabularioDaEmpresa(org.id) : vocabularioDoRamo(null)
  } catch {
    return vocabularioDoRamo(null)
  }
})
