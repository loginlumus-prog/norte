'use server'

import { redirect } from 'next/navigation'
import { fecharSessao } from '@/servidor/sessao'
import { sessaoViva, exigirSessao } from '@/servidor/pagina'
import { liberarVaga, sinal } from '@/servidor/presenca'
import { acharOrgPorSlug, comoOrg } from '@/servidor/banco'
import { conferirSenha } from '@/servidor/senha'
import { pode, CAPACIDADES } from '@/servidor/permissao'
import {
  buscarNoGuia,
  entradaDaTela,
  manualComoTexto,
  NOME_DA_CAPACIDADE,
  NOME_DO_PAPEL,
  type ResultadoBusca,
} from '@/servidor/guia'
import { perguntar, temChaveIA } from '@/servidor/ia'

/**
 * Destrancar a tela: a senha de quem já está dentro, de novo.
 *
 * Não é login — a sessão continua a mesma. Só confere que quem está na
 * frente da tela é quem entrou. Erro espera meio segundo, para não dar
 * para testar senhas em série; e a tela sai sozinha na quinta errada.
 */
export async function destrancarAcao(slug: string, senha: string): Promise<{ ok: boolean }> {
  const sessao = await sessaoViva(slug)
  if (!sessao || !senha) return { ok: false }

  const u = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { senhaHash: true } }),
  )
  if (!u?.senhaHash || !(await conferirSenha(senha, u.senhaHash))) {
    await new Promise((r) => setTimeout(r, 600))
    return { ok: false }
  }
  void sinal(sessao.orgId, sessao.usuarioId).catch(() => {})
  return { ok: true }
}

// Sair é Server Action, não rota POST: numa rota, o redirect() sai como 307 e
// o navegador REPETE o POST no destino, que não aceita POST. A Server Action
// já resolve o redirecionamento no protocolo dela.
export async function sairAcao(form: FormData) {
  const empresa = String(form.get('empresa') ?? '')

  // A vaga é liberada ANTES do cookie morrer, porque depois disso não dá mais
  // para saber quem estava saindo. Sair é o caminho limpo: quem clica aqui
  // devolve a vaga na hora, sem esperar os dez minutos de inatividade.
  const sessao = await sessaoViva(empresa)
  if (sessao) await liberarVaga(sessao.orgId, sessao.usuarioId)

  await fecharSessao(empresa)
  redirect(`/${empresa}/entrar`)
}

// ─────────────────────────────────────────────────────────────
// O GUIA
// ─────────────────────────────────────────────────────────────

export type RespostaDoGuia =
  /** Sem chave de IA: as telas e passos do manual que casam com a pergunta. */
  | { modo: 'manual'; respostas: ResultadoBusca[] }
  | { modo: 'ia'; texto: string }
  | { modo: 'erro'; texto: string }

/**
 * Perguntas por empresa por dia. É custo NOSSO, não do cliente — o crédito
 * de IA da carteira dele paga o assistente, não a ajuda do sistema. Por isso
 * o freio é em memória e generoso: duzentas perguntas cobre um dia de loja
 * curiosa, e barra o laço de quem deixou o dedo na tecla.
 *
 * Em memória, e não no banco, de propósito: o teto reinicia com o servidor,
 * e isso é aceitável para um número que existe só para não estourar a conta.
 */
const TETO_POR_DIA = 200
const perguntasDoDia = new Map<string, number>()

function contarPergunta(orgId: string): boolean {
  const dia = new Date().toISOString().slice(0, 10)
  // Limpa os dias anteriores de vez em quando; o mapa não cresce sem fim.
  if (perguntasDoDia.size > 500) {
    for (const k of perguntasDoDia.keys()) if (!k.endsWith(dia)) perguntasDoDia.delete(k)
  }
  const chave = `${orgId}:${dia}`
  const n = (perguntasDoDia.get(chave) ?? 0) + 1
  perguntasDoDia.set(chave, n)
  return n <= TETO_POR_DIA
}

/**
 * A pergunta livre do Guia.
 *
 * Sem chave no servidor, responde pelo manual — a mesma busca que a tela já
 * faz sozinha, devolvida como dado. Com chave, manda o MANUAL e a pergunta;
 * nunca dado do banco. O que a IA sabe da pessoa é a tela em que ela está e
 * o que o papel dela pode fazer, em palavras — o suficiente para não ensinar
 * a balconista a trocar de plano.
 */
export async function perguntarAoGuiaAcao(
  slug: string,
  pergunta: string,
  telaAtual: string,
): Promise<RespostaDoGuia> {
  const sessao = await exigirSessao(slug)

  const p = String(pergunta ?? '').trim()
  if (p.length < 2) return { modo: 'erro', texto: 'Escreva a pergunta com um pouco mais de palavras.' }
  if (p.length > 500) return { modo: 'erro', texto: 'Pergunta longa demais. Resuma em até 500 letras.' }
  const tela = String(telaAtual ?? '').slice(0, 120)

  // Pelo manual, só as telas que esta pessoa abre — a mesma régua da busca
  // do navegador (ver `telaAbre`). A empresa vem da portaria: os módulos
  // ligados decidem se Crediário e Encomendas existem para ela.
  if (!temChaveIA()) {
    const empresa = await acharOrgPorSlug(slug)
    const quem = { capacidades: CAPACIDADES.filter((c) => pode(sessao, c)), modulos: empresa?.modulos ?? [] }
    return { modo: 'manual', respostas: buscarNoGuia(p, tela, quem) }
  }

  if (!contarPergunta(sessao.orgId)) {
    return { modo: 'erro', texto: 'O guia já respondeu muitas perguntas hoje. Use a busca ao lado — ela funciona sempre.' }
  }

  const entrada = entradaDaTela(tela)
  const papeis = [...new Set(sessao.acessos.map((a) => NOME_DO_PAPEL[a.papel]))].join(', ')
  const capacidades = CAPACIDADES.filter((c) => pode(sessao, c)).map((c) => NOME_DA_CAPACIDADE[c])

  const sistema = [
    'Você é o Guia do Norte, a ajuda dentro do sistema Norte — um sistema de gestão para comércio (balcão, estoque, caixa, clientes, financeiro, equipe).',
    'Responda em português do Brasil, curto e direto. Quando a pergunta for "como faço", responda em passos numerados, com o nome exato dos botões e telas.',
    'Use SOMENTE o manual abaixo. Se o manual não cobre a pergunta, diga que não sabe e indique a tela mais próxima. Nunca invente função, botão ou tela.',
    'Não peça nem cite dados da empresa: você não tem acesso a vendas, saldos ou nomes — só ao manual.',
    `A pessoa está na tela "${entrada?.titulo ?? (tela || 'início')}" e tem o papel de ${papeis || 'sem papel'}.`,
    `O que ela pode fazer: ${capacidades.length ? capacidades.join('; ') : 'nada além de ver'}. Se ela pergunta por algo que o papel dela não permite, diga quem pode.`,
    '',
    manualComoTexto(),
  ].join('\n')

  try {
    const r = await perguntar({ sistema, mensagens: [{ papel: 'usuario', texto: p }] })
    return { modo: 'ia', texto: r.texto }
  } catch (e) {
    return { modo: 'erro', texto: e instanceof Error ? e.message : 'O guia não conseguiu responder agora.' }
  }
}
