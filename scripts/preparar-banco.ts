// Deixa o banco pronto para trabalhar: tabelas, papel da aplicação, travas de
// isolamento e duas empresas de exemplo.
//
// Roda contra QUALQUER Postgres — o local do `npm run banco`, ou um hospedado
// (Neon, Supabase) quando existir. É o mesmo caminho, de propósito.
//
//   npm run preparar
//
// Usa DATABASE_URL_ADMIN (dono das tabelas). A aplicação nunca usa essa URL.

import 'dotenv/config'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { semearExemplo, SENHA_EXEMPLO } from './exemplo-base'

const raiz = join(import.meta.dirname, '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

const url =
  process.env.DATABASE_URL_ADMIN ??
  `postgresql://postgres:postgres@127.0.0.1:${process.env.PORTA_BANCO ?? 5433}/postgres`

const SENHA_APP = process.env.SENHA_APP ?? 'norte_dev'

// ── o banco é daqui ou é de verdade? ─────────────────────────
// As duas empresas de exemplo (ana@exemplo.com e a Vizinha, com senha escrita
// no repositório) são ótimas no laptop e são um buraco em produção: e-mail
// conhecido, senha conhecida, dono de uma empresa que ninguém criou.
//
// A trava não é uma bandeira que alguém precisa lembrar de passar — quem
// esquece a bandeira é justamente quem não devia semear. Ela olha PARA ONDE
// está apontando: fora de 127.0.0.1, não semeia, e diz por quê. Quem quiser
// exemplo num banco remoto de propósito (uma demonstração, um ambiente de
// teste) pede na mão com `--com-exemplo`.
const local = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)
const pediuExemplo = process.argv.includes('--com-exemplo')
const semear = local || pediuExemplo

const cliente = new Client({ connectionString: url })
await cliente.connect()

const passo = (t: string) => console.log(`  ${t}`)

console.log(`\n  Preparando ${url.replace(/:[^:@]*@/, ':***@')}\n`)

if (!local) {
  console.log('  ⚠  Este banco NÃO é local.\n')
}

// ── 1. tabelas ───────────────────────────────────────────────
// O DDL gerado pelo Prisma não é idempotente (CREATE TYPE sem IF NOT EXISTS),
// então rodar duas vezes explodiria. Criar só quando ainda não existe deixa
// este script seguro de repetir — e repetir é o que a gente mais faz.
const ddl = ler('prisma/sql/tabelas.sql')

const { rows: existe } = await cliente.query<{ tem: boolean }>(
  "select to_regclass('public.orgs') is not null as tem",
)

if (!existe[0]!.tem) {
  passo('tabelas...')
  await cliente.query(ddl)
} else {
  // Banco já montado. Aqui mora uma armadilha: pular o DDL inteiro faz este
  // script mentir quando o schema ANDOU — tabela nova simplesmente não nasce,
  // e o erro só aparece muito depois, como "relation does not exist" no meio
  // de uma tela. Então em vez de pular calado, ele compara e reclama.
  const esperadas = [...ddl.matchAll(/create table "([^"]+)"/gi)].map((m) => m[1]!)
  const { rows: temAgora } = await cliente.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  )
  const presentes = new Set(temAgora.map((t) => t.tablename))
  const faltando = esperadas.filter((t) => !presentes.has(t))

  if (faltando.length === 0) {
    passo('tabelas já existem — pulando')
  } else {
    console.error(
      `
  O banco está ATRASADO em relação ao schema.
` +
        `  Falta(m): ${faltando.join(', ')}

` +
        `  No desenvolvimento: pare o 'npm run banco', apague a pasta .banco/ e suba de novo.
` +
        `  Em produção: 'prisma migrate deploy' — este script não migra banco com dado dentro.
`,
    )
    process.exit(1)
  }
}

// ── 2. o papel da aplicação ──────────────────────────────────
// Sem privilégio de sistema. Se a aplicação rodasse como dono ou superusuário,
// o RLS seria ignorado em silêncio e a segunda parede não existiria.
passo('papel da aplicação...')
await cliente.query(`
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'app_norte') then
      create role app_norte login password ${quote(SENHA_APP)};
    end if;
  end $$;

  grant usage on schema public to app_norte;
  grant select, insert, update, delete on all tables in schema public to app_norte;
  grant usage, select on all sequences in schema public to app_norte;
`)

// ── 3. as travas ─────────────────────────────────────────────
passo('travas de isolamento (RLS)...')
await cliente.query(ler('prisma/sql/rls.sql'))

if (semear) {
  await semearExemplo(cliente, passo)
} else {
  passo('empresas de exemplo: PULADAS (banco remoto)')
}

await cliente.end()

if (semear) {
  console.log(`
  Pronto.

  Entrar como:  ana@exemplo.com (dona) / carlos@exemplo.com (balcao)
                contador@exemplo.com (contador)   —   senha: ${SENHA_EXEMPLO}

  Ponha no .env:
    DATABASE_URL="postgresql://app_norte:${SENHA_APP}@127.0.0.1:${process.env.PORTA_BANCO ?? 5433}/postgres"
    DATABASE_URL_ADMIN="${url}"
`)
} else {
  // Sem exemplo, o banco está montado e VAZIO — que é o certo para produção, e
  // também quer dizer que ninguém entra nele ainda. A primeira empresa nasce
  // por fora; enquanto esse caminho não existe, este aviso é o lembrete.
  const alvo = new URL(url)
  console.log(`
  Pronto — tabelas, papel da aplicação e travas de isolamento.
  Nenhuma empresa foi criada: este banco não é local.

  A URL da aplicação (o papel SEM privilégio, o que faz o RLS valer):
    DATABASE_URL="postgresql://app_norte:<SENHA_APP>@${alvo.host}${alvo.pathname}"

  Para semear o exemplo aqui mesmo, de propósito:
    npm run preparar -- --com-exemplo
`)
}

/** Escapa senha para dentro do SQL. */
function quote(s: string) {
  return `'${s.replace(/'/g, "''")}'`
}
