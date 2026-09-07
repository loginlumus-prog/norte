// A PRIMEIRA PAREDE do isolamento.
//
// Nenhuma parte da aplicação fala com o banco direto. Tudo passa por `comoOrg`,
// que abre uma transação, troca para o papel sem privilégio e carimba a empresa
// da requisição. A partir daí o próprio Postgres se recusa a devolver linha de
// outra empresa (segunda parede: prisma/sql/rls.sql).
//
// Regra prática: se você escreveu `prisma.` fora deste arquivo, está errado.

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const PAPEL_APP = 'app_norte'

function url(nome: 'DATABASE_URL' | 'DATABASE_URL_ADMIN') {
  const v = process.env[nome]
  if (!v) throw new Error(`Falta ${nome} no .env. Rode "npm run preparar" para ver a sua.`)
  return v
}

/**
 * Conexão da aplicação. Usa o usuário SEM privilégio — é isso que faz o RLS
 * valer. Se um dia isto apontar para o dono das tabelas ou para um superusuário,
 * o isolamento do banco some sem avisar.
 */
const POOL_MAX = Number(process.env.POOL_MAX ?? 10)

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url('DATABASE_URL'), max: POOL_MAX }),
})

/** O que `comoOrg` entrega: um Prisma já preso a uma empresa. */
export type BancoDaOrg = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>

/**
 * Roda `fn` no contexto de uma empresa.
 *
 *   const unidades = await comoOrg(orgId, (db) => db.unidade.findMany())
 *
 * Tudo dentro do `fn` só enxerga dados dessa empresa — inclusive consulta que
 * esqueceu o filtro, porque o filtro não está no código, está no banco.
 */
export async function comoOrg<T>(
  orgId: string,
  fn: (db: BancoDaOrg) => Promise<T>,
): Promise<T> {
  if (!orgId) throw new Error('comoOrg exige uma empresa. Sem empresa, sem acesso.')

  return prisma.$transaction(async (tx) => {
    // papel sem privilégio: sem isso o RLS é ignorado
    await tx.$executeRawUnsafe(`set local role ${PAPEL_APP}`)
    // 'true' = vale só nesta transação, não vaza para a próxima requisição
    await tx.$queryRaw`select set_config('app.org_id', ${orgId}, true)`
    return fn(tx as unknown as BancoDaOrg)
  })
}

// ─────────────────────────────────────────────────────────────
// A ÚNICA EXCEÇÃO
// ─────────────────────────────────────────────────────────────

/**
 * Descobrir de que empresa é o endereço acessado — a única leitura que
 * legitimamente acontece antes de existir empresa no contexto.
 *
 * Por isso o login é sempre por empresa (norte.app/nome-da-empresa ou subdomínio):
 * assim nunca existe busca de usuário por e-mail atravessando empresas, que
 * seria um buraco pronto para enumerar cliente dos outros.
 *
 * Devolve só o que a tela de login precisa mostrar. Nada sensível.
 */
let admin: PrismaClient | undefined

export async function acharOrgPorSlug(slug: string) {
  admin ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: url('DATABASE_URL_ADMIN'), max: 1 }),
  })
  return admin.org.findUnique({
    where: { slug },
    select: { id: true, nome: true, slug: true, situacao: true, logoUrl: true, corMarca: true },
  })
}

export async function fechar() {
  await prisma.$disconnect()
  await admin?.$disconnect()
}
