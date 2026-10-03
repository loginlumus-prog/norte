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
import { AsyncLocalStorage } from 'node:async_hooks'

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

/**
 * Quanto se espera para ABRIR uma conexão antes de desistir.
 *
 * O padrão do `pg` é zero, que quer dizer "para sempre": com o banco
 * inalcançável (rede caída, pooler engasgado, pacote sumindo no caminho), a
 * espera dura o tempo que o sistema operacional leva para desistir do TCP —
 * 21 s no Windows, uns 2 min no Linux. Medido: `findUnique` da portaria contra
 * um endereço que não responde levou 21.287 ms para falhar; com este prazo,
 * 5.012 ms. E TODA tela começa pela portaria (`acharOrgPorSlug`), então sem
 * prazo o balcão fica olhando tela branca em vez de ver "Deu problema aqui do
 * nosso lado" com o código para o suporte.
 *
 * Cinco segundos é folga para o pooler acordar (o Supabase grátis dorme) e
 * ainda é menos do que alguém espera antes de apertar F5.
 */
export const PRAZO_CONEXAO_MS = Number(process.env.PRAZO_CONEXAO_MS ?? 5_000)

/** As opções do pool, num lugar só — as duas conexões (app e portaria) seguem a mesma régua. */
export function opcoesDoPool(connectionString: string, max: number) {
  return {
    connectionString,
    max,
    connectionTimeoutMillis: PRAZO_CONEXAO_MS,
    // Conexão parada devolve a vaga ao pooler do Supabase, que tem teto por
    // projeto; o padrão do pg (10 s) já é isso, fica escrito para não mudar.
    idleTimeoutMillis: 10_000,
  }
}

function cliente(): PrismaClient {
  if (!guardado.__prismaNorte) {
    guardado.__prismaNorte = new PrismaClient({
      adapter: new PrismaPg(opcoesDoPool(url('DATABASE_URL'), POOL_MAX)),
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
// Qual empresa está carimbada na transação deste caminho de execução. Serve
// só para o aviso logo abaixo — ver `comoOrg`.
const emTransacao = new AsyncLocalStorage<string>()

export async function comoOrg<T>(
  orgId: string,
  fn: (db: BancoDaOrg) => Promise<T>,
): Promise<T> {
  if (!orgId) throw new Error('comoOrg exige uma empresa. Sem empresa, sem acesso.')

  // ── comoOrg dentro de comoOrg ────────────────────────────
  // Isto TRAVA, e trava mentindo. A transação de fora está segurando uma
  // conexão do pool; a de dentro pede outra e espera. Quando o pool é
  // pequeno — e no banco local ele é de um — ninguém devolve nada, o Prisma
  // conta até dois segundos e desiste com "Unable to start a transaction in
  // the given time". Essa frase não diz nada sobre a causa, e o caminho até
  // ela é longo: já custou o cadastro inicial de TODA empresa nova, porque a
  // conferência de cota da primeira unidade abria a segunda transação.
  //
  // E, se as empresas fossem diferentes, o estrago seria pior que travar:
  // seria ler dado carimbado com a empresa errada.
  //
  // O conserto é sempre o mesmo, e por isso ele está escrito no erro.
  const jaCarimbada = emTransacao.getStore()
  if (jaCarimbada) {
    throw new Error(
      `comoOrg foi chamado DENTRO de outro comoOrg (${jaCarimbada}` +
        (jaCarimbada === orgId ? '' : ` → ${orgId}, e são empresas DIFERENTES`) +
        `).

` +
        `  A transação de fora segura a conexão que a de dentro precisa, e ninguém sai do lugar.
` +
        `  Conserto: tire a chamada de dentro da transação. Leia ANTES, e passe o
` +
        `  resultado para dentro do comoOrg.`,
    )
  }

  return emTransacao.run(orgId, () => cliente().$transaction(async (tx) => {
    // papel sem privilégio: sem isso o RLS é ignorado
    await tx.$executeRawUnsafe(`set local role ${PAPEL_APP}`)
    // 'true' = vale só nesta transação, não vaza para a próxima requisição
    await tx.$queryRaw`select set_config('app.org_id', ${orgId}, true)`
    return fn(tx as unknown as BancoDaOrg)
  }, TEMPO_DA_TRANSACAO))
}

/**
 * O prazo de uma transação por empresa.
 *
 * O padrão do Prisma é 5 s para a transação inteira e 2 s para conseguir uma
 * conexão — e a transação morre com "Transaction already closed", que na tela
 * vira "Deu problema aqui do nosso lado". Com o banco do lado do servidor (o
 * laptop) isso nunca aparecia. Com o servidor longe do banco (a VPS nos
 * Estados Unidos e o Supabase em São Paulo, ~150 ms por consulta), uma tela
 * com 40 consultas em fila leva 6 s só de ida e volta, e estoura. F5 passava
 * porque a segunda vez o caminho estava quente. Esperar mais é a rede de
 * segurança; o conserto de verdade é o servidor perto do banco e menos
 * consultas por tela.
 */
const TEMPO_DA_TRANSACAO = { maxWait: 10_000, timeout: 30_000 } as const

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
// Poucas conexões, e de propósito: a portaria responde uma pergunta de uma
// linha, em milissegundos. Uma conexão só aguenta centenas de logins por
// segundo; duas é folga para o dia em que a resposta demorar. Passa a ser
// gargalo antes de qualquer outra coisa? Não: o que cresce com a base é o
// pool da aplicação (POOL_MAX), e é ele que se ajusta por instância.
//
// No global, pelo mesmo motivo do cliente da aplicação (ver `guardado` lá em
// cima): cada recarga do `next dev` abria um pool novo da portaria e largava
// o antigo aberto.
const guardadoPortaria = globalThis as unknown as { __prismaPortaria?: PrismaClient }

// Exportada para a outra pergunta de portaria que é FUNÇÃO do banco:
// `criar_empresa_cadastro` (prisma/sql/rls.sql), chamada por autocadastro.ts.
export function clientePortaria(): PrismaClient {
  guardadoPortaria.__prismaPortaria ??= new PrismaClient({
    adapter: new PrismaPg(opcoesDoPool(url('DATABASE_URL_PORTARIA'), Number(process.env.POOL_PORTARIA ?? 2))),
  })
  return guardadoPortaria.__prismaPortaria
}

export async function acharOrgPorSlug(slug: string) {
  return clientePortaria().org.findUnique({
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

/**
 * O banco responde? Para o /saude — e só para ele.
 *
 * Vai pela PORTARIA de propósito: é o papel com menos poder que existe
 * (`select 1` não lê tabela nenhuma), não carimba empresa e não ocupa vaga do
 * pool da aplicação, que é o que as telas usam. Devolve quanto demorou, ou o
 * motivo curto da falha — sem a mensagem crua, que pode trazer o endereço do
 * banco.
 */
export async function pingBanco(prazoMs = 2_000): Promise<{ ok: true; ms: number } | { ok: false; ms: number; motivo: 'prazo' | 'erro' }> {
  const inicio = Date.now()
  let relogio: ReturnType<typeof setTimeout> | undefined
  const prazo = new Promise<'prazo'>((r) => {
    relogio = setTimeout(() => r('prazo'), prazoMs)
  })
  try {
    const r = await Promise.race([clientePortaria().$queryRaw`select 1`.then(() => 'ok' as const), prazo])
    return r === 'ok' ? { ok: true, ms: Date.now() - inicio } : { ok: false, ms: Date.now() - inicio, motivo: 'prazo' }
  } catch {
    return { ok: false, ms: Date.now() - inicio, motivo: 'erro' }
  } finally {
    clearTimeout(relogio)
  }
}

export async function fechar() {
  await guardado.__prismaNorte?.$disconnect()
  await guardadoPortaria.__prismaPortaria?.$disconnect()
  // Esquece os dois: quem chamar de novo (o próximo arquivo de teste, com
  // outro banco em outra porta) ganha cliente novo, e não o desligado.
  delete guardado.__prismaNorte
  delete guardadoPortaria.__prismaPortaria
}
