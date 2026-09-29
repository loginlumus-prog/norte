// A lista de empresas que a rotina percorre — a segunda pergunta de portaria.
//
// A rotina de hora em hora não chega com sessão nem com endereço de empresa:
// ela precisa saber QUAIS empresas existem para visitar uma a uma. Isso é uma
// leitura que atravessa empresas, e por isso ela NÃO passa pelo `comoOrg`
// (que só enxerga uma) nem pelo admin (que enxerga tudo, de tudo).
//
// Quem responde é o mesmo papel da tela de login, `app_portaria`, que no
// banco só lê NOVE colunas de UMA tabela (ver scripts/preparar-banco.ts). O
// que sai daqui é id e slug — a fachada, que a tela de login de qualquer
// empresa já mostra. Tudo o mais (se o agente está ligado, o plano, os
// donos, as vendas) é lido depois, empresa por empresa, dentro do `comoOrg`
// dela.
//
// ── por que este arquivo existe, em vez de uma função em banco.ts ──
// banco.ts é o único lugar que deveria abrir cliente do Prisma, e esta
// função é da mesma família de `acharOrgPorSlug`. Ela mora aqui só porque
// banco.ts não é deste trabalho; o lugar dela é lá, ao lado da irmã, usando a
// MESMA conexão da portaria. Até a mudança, é uma segunda conexão da portaria
// com uma conexão só no pool.

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { opcoesDoPool } from '../banco'
import { vencerTesteSeAcabou } from '../assinatura'

const guardado = globalThis as unknown as { __portariaRotinas?: PrismaClient }

function portaria(): PrismaClient {
  const url = process.env.DATABASE_URL_PORTARIA
  if (!url) throw new Error('Falta DATABASE_URL_PORTARIA no .env.')
  guardado.__portariaRotinas ??= new PrismaClient({
    // O mesmo prazo de conexão das outras (ver PRAZO_CONEXAO_MS em banco.ts):
    // a rotina de hora em hora não pode ficar pendurada no banco mudo.
    adapter: new PrismaPg(opcoesDoPool(url, 1)),
  })
  return guardado.__portariaRotinas
}

/**
 * Empresas que LIGARAM o módulo do agente e não estão fora do ar.
 *
 * É um corte grosso, de propósito: plano, agente ligado e donos são
 * conferidos lá dentro, com o carimbo da empresa (o teste vencido também:
 * ver abaixo). A portaria não enxerga
 * essas colunas — e é bom que não enxergue.
 */
export async function empresasComAgente(): Promise<{ id: string; slug: string }[]> {
  const orgs = await portaria().org.findMany({
    where: { modulos: { has: 'agente' }, situacao: { in: ['TESTE', 'ATIVA', 'INADIMPLENTE'] } },
    select: { id: true, slug: true, situacao: true },
    orderBy: { slug: 'asc' },
  })
  // O teste que venceu não entra. A portaria não enxerga a data do teste (e
  // não deve), então cada empresa em TESTE é conferida dentro dela: vencido,
  // desce para o Grátis ali mesmo (`vencerTesteSeAcabou`, que tira o módulo)
  // e sai da lista. Sem isto, a empresa cujo teste acabou num domingo seguia
  // recebendo relatório, campanha e lembrete até alguém abrir uma tela.
  const saida: { id: string; slug: string }[] = []
  for (const o of orgs) {
    if (o.situacao === 'TESTE' && (await vencerTesteSeAcabou(o.id))) continue
    saida.push({ id: o.id, slug: o.slug })
  }
  return saida
}

/**
 * Empresas que LIGARAM a Escola (turmas e mensalidades) e não estão fora do
 * ar — para a rotina de hora em hora gerar a mensalidade do mês de quem
 * ninguém abriu a tela no dia 1º. Mesmo corte grosso de `empresasComAgente`:
 * o plano é conferido lá dentro, com o carimbo da empresa. Não depende do
 * assistente: a mensalidade nasce com ou sem WhatsApp.
 */
export async function empresasComEscola(): Promise<{ id: string; slug: string }[]> {
  const orgs = await portaria().org.findMany({
    where: { modulos: { has: 'escola' }, situacao: { in: ['TESTE', 'ATIVA', 'INADIMPLENTE'] } },
    select: { id: true, slug: true, situacao: true },
    orderBy: { slug: 'asc' },
  })
  const saida: { id: string; slug: string }[] = []
  for (const o of orgs) {
    if (o.situacao === 'TESTE' && (await vencerTesteSeAcabou(o.id))) continue
    saida.push({ id: o.id, slug: o.slug })
  }
  return saida
}

/**
 * A empresa dona deste número no WhatsApp oficial (o `phone_number_id` que a
 * Meta manda no webhook) — id e slug, e nada mais.
 *
 * Não é leitura de tabela: a portaria não enxerga `agentes`, e é bom que não
 * enxergue (poderia listar os números de todo mundo). Quem responde é a função
 * `org_do_numero_meta` do banco (prisma/sql/rls.sql), SECURITY DEFINER, que só
 * aceita o id exato e só a portaria pode chamar. O `app_norte` continua sem
 * nenhuma leitura entre empresas.
 */
export async function empresaDoNumeroMeta(phoneNumberId: string): Promise<{ id: string; slug: string } | null> {
  if (!/^\d{1,32}$/.test(phoneNumberId)) return null
  const linhas = await portaria().$queryRaw<{ org_id: string; org_slug: string }[]>`
    select org_id, org_slug from public.org_do_numero_meta(${phoneNumberId})
  `
  const l = linhas[0]
  return l ? { id: l.org_id, slug: l.org_slug } : null
}

export async function fecharPortariaRotinas() {
  await guardado.__portariaRotinas?.$disconnect()
  delete guardado.__portariaRotinas
}
