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

function url(nome: 'DATABASE_URL' | 'DATABASE_URL_PORTARIA') {
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

// UM cliente por processo, guardado no objeto global, e criado só no
// primeiro uso.
//
// O global existe porque o recarregamento do `next dev` recria o módulo a
// cada arquivo salvo, e cada cópia abriria o próprio pool — que nunca é
// fechado. Depois de algumas edições o banco recusa conexão e a tela morre
// com "Connection terminated unexpectedly", que parece bug de código e é só
// pool vazado. Em produção o módulo carrega uma vez e o global não muda nada.
//
// PREGUIÇOSO porque importar este arquivo não deveria exigir banco. Criar o
// cliente na hora do import fazia `import { criarProduto }` num teste de
// função pura estourar por falta de DATABASE_URL — e a alternativa virava
// espalhar as regras puras por arquivos separados só para fugir do import.
// Na aplicação não muda nada: a primeira consulta continua sendo a primeira
// oportunidade de descobrir que a variável falta.
const guardado = globalThis as unknown as { __prismaNorte?: PrismaClient }

function cliente(): PrismaClient {
  if (!guardado.__prismaNorte) {
    guardado.__prismaNorte = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url('DATABASE_URL'), max: POOL_MAX }),
    })
  }
  return guardado.__prismaNorte
}

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

  return cliente().$transaction(async (tx) => {
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
 * ── por que uma conexão só para isto ─────────────────────────
 * Isto já foi feito com a credencial de ADMIN, e essa era a maior fraqueza da
 * arquitetura: no Postgres do Supabase o papel `postgres` tem BYPASSRLS, ou
 * seja, ele passa por cima de TODA política de TODA tabela. Era uma chave
 * mestra viva no ambiente de produção, usada a cada tela de login, para
 * responder uma pergunta de portaria.
 *
 * Agora quem responde é `app_portaria`, que no banco só tem permissão de
 * SELECT em NOVE COLUNAS de UMA tabela. Se este segredo vazar, o que se ganha
 * é a fachada das empresas — nome, slug, logo, cor. Nem uma venda, nem um
 * cliente, nem um centavo.
 *
 * Devolve só o que a tela de login precisa mostrar. Nada sensível.
 */
let portaria: PrismaClient | undefined

export async function acharOrgPorSlug(slug: string) {
  portaria ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: url('DATABASE_URL_PORTARIA'), max: 1 }),
  })
  return portaria.org.findUnique({
    where: { slug },
    select: {
      id: true,
      nome: true,
      slug: true,
      situacao: true,
      logoUrl: true,
      corMarca: true,
      // decidem o que aparece na tela antes de existir sessão
      modulos: true,
      configuradaEm: true,
      agenteNome: true,
    },
  })
}

export async function fechar() {
  await guardado.__prismaNorte?.$disconnect()
  await portaria?.$disconnect()
}
