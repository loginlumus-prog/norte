// O console do Norte: o painel de todas as empresas, NO SEU COMPUTADOR.
//
//   npm run console                       banco local (.env)
//   npm run console -- --producao         produção (.env.producao)
//   npm run console -- --porta 4646       outra porta (padrão 4545)
//
// Sobe uma página em http://127.0.0.1:<porta> e imprime o link de entrada,
// com uma chave que nasce agora e morre quando o console fecha (Ctrl+C).
//
// ── por que no laptop, e não no sistema hospedado ────────────
// O console lê TODAS as empresas, e para isso precisa da credencial de admin
// (DATABASE_URL_ADMIN), a que atravessa o isolamento entre empresas. Essa
// chave NÃO vai para o servidor hospedado, nunca: lá, um furo em qualquer
// tela viraria acesso a todas as lojas. Aqui ela fica no processo deste
// script — o mesmo lugar onde a ferramenta de operação (scripts/operacao.ts)
// já a guarda —, e a página só responde em 127.0.0.1, a quem tem a chave.
// As travas da porta estão em src/console/guarda.ts.
//
// ── o que muda dado ──────────────────────────────────────────
// Toda ação passa por src/servidor/operacao.ts (e `trocarPlanoComoEquipe`):
// credencial da aplicação, comoOrg da empresa, RLS, e a linha no livro da
// loja assinada "Equipe Norte (<quem>)", na mesma transação. Toda ação pede
// motivo; em produção, pede também que se digite o endereço da empresa.

import { carregarAmbiente, ehLocal } from './ambiente'

const pedeProducao = process.argv.includes('--producao')
if (pedeProducao && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
  console.error(
    '\n  RECUSADO: o console com --producao num ambiente de produção (NODE_ENV=production ou Vercel).\n\n' +
      '  O console roda do laptop de quem opera, e só dali.\n',
  )
  process.exit(1)
}

const { producao, arquivo } = carregarAmbiente()
const { limparSegredos, lerArgumentos } = await import('../src/servidor/operacao')

// Toda escrita no terminal passa pelo filtro, inclusive a de biblioteca: um
// erro do driver pode trazer a URL do banco com a senha.
for (const saida of [process.stdout, process.stderr]) {
  const escrever = saida.write.bind(saida) as (...a: unknown[]) => boolean
  saida.write = ((pedaco: unknown, ...resto: unknown[]) =>
    escrever(
      typeof pedaco === 'string'
        ? limparSegredos(pedaco, process.env)
        : Buffer.isBuffer(pedaco)
          ? limparSegredos(pedaco.toString('utf8'), process.env)
          : pedaco,
      ...resto,
    )) as typeof saida.write
}

const { opcoes } = lerArgumentos(process.argv.slice(2), ['producao'])
const porta = Number(typeof opcoes.porta === 'string' ? opcoes.porta : 4545)
if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) {
  console.error('\n  --porta precisa ser um número de 1024 a 65535.\n')
  process.exit(1)
}

const urlAdmin = process.env.DATABASE_URL_ADMIN
if (!urlAdmin) {
  console.error(`\n  Falta DATABASE_URL_ADMIN em ${arquivo}.\n`)
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error(`\n  Falta DATABASE_URL em ${arquivo} (as mudanças vão pela credencial da aplicação).\n`)
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const { fechar } = await import('../src/servidor/banco')
const { quemDaEquipe } = await import('../src/servidor/assinatura')
const { criarGuarda } = await import('../src/console/guarda')
const { criarConsole } = await import('../src/console/servidor')

const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: urlAdmin, max: 1 }) })

let operadorDoAmbiente: string | null = null
if (process.env.NORTE_OPERADOR) {
  try {
    operadorDoAmbiente = quemDaEquipe(process.env.NORTE_OPERADOR)
  } catch {
    console.error(`\n  NORTE_OPERADOR em ${arquivo} não serve como nome (2 a 60 letras, sem e-mail). A página vai perguntar.\n`)
  }
}

/** O endereço público do Norte neste ambiente ('' = não sei) — a mesma regra da ferramenta de operação. */
const base = (process.env.NORTE_URL ?? process.env.URL_BASE ?? (ehLocal(urlAdmin) ? 'http://localhost:3000' : ''))
  .trim()
  .replace(/\/+$/, '')

const guarda = criarGuarda(porta)
const servidor = criarConsole({
  guarda,
  admin,
  producao,
  operadorDoAmbiente,
  base,
  dominioDaEquipe: process.env.NORTE_EQUIPE_DOMINIO ?? null,
  limpar: (t) => limparSegredos(t, process.env),
})

servidor.on('error', (e: NodeJS.ErrnoException) => {
  console.error(
    e.code === 'EADDRINUSE'
      ? `\n  A porta ${porta} já está em uso. Rode com --porta <outra>.\n`
      : `\n  O console não subiu: ${e.message}\n`,
  )
  process.exit(1)
})

// SÓ 127.0.0.1: nem a rede da casa, nem a do café, enxerga esta porta.
servidor.listen(porta, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${porta}/?t=${guarda.chave}`
  console.log(`
  Console do Norte   [banco: ${producao ? `PRODUÇÃO (${arquivo})` : 'local'}]
${producao ? '\n  ATENÇÃO: PRODUÇÃO. Cada ação muda a conta de um cliente de verdade.\n' : ''}
  Abra no navegador (o link tem a chave desta sessão — não compartilhe):

    ${link}

  Só responde em 127.0.0.1. A chave morre quando o console fecha (Ctrl+C).
  ${operadorDoAmbiente ? `Assina como ${operadorDoAmbiente} (NORTE_OPERADOR).` : 'A página pergunta quem está operando antes da primeira ação.'}
`)
})

let saindo = false
async function sair() {
  if (saindo) return
  saindo = true
  console.log('\n  Console fechado. A chave desta sessão não vale mais.\n')
  servidor.close()
  servidor.closeAllConnections?.()
  await fechar().catch(() => {})
  await admin.$disconnect().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', sair)
process.on('SIGTERM', sair)
