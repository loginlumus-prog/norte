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

/** Os ramos que não chamam de cliente. O resto (a maioria) chama. */
const QUEM_ATENDE: Partial<Record<Ramo, ChaveVocabulario>> = {
  saude: 'pacientes',
  escola: 'alunos',
}

/** As palavras de um ramo. Ramo desconhecido ou vazio fala "cliente". */
export function vocabularioDoRamo(ramo: string | null | undefined): Vocabulario {
  const chave = ramo && Object.hasOwn(QUEM_ATENDE, ramo) ? QUEM_ATENDE[ramo as Ramo]! : 'clientes'
  return VOCABULARIOS[chave]
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
export const vocabularioDaEmpresa = cache(async (orgId: string): Promise<Vocabulario> => {
  try {
    const org = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { ramo: true } }))
    return vocabularioDoRamo(org?.ramo)
  } catch {
    // Palavra é enfeite: banco fora não derruba a tela por causa dela.
    return VOCABULARIOS.clientes
  }
})

/**
 * O mesmo, a partir do endereço — para o título da aba, que é montado antes
 * de existir sessão. Lê só o ramo da empresa do endereço.
 */
export const vocabularioDoEndereco = cache(async (slug: string): Promise<Vocabulario> => {
  try {
    const org = await acharOrgPorSlug(slug)
    return org ? await vocabularioDaEmpresa(org.id) : VOCABULARIOS.clientes
  } catch {
    return VOCABULARIOS.clientes
  }
})
