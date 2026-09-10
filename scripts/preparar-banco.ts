// Deixa o banco pronto para trabalhar: tabelas, papel da aplicação, travas de
// isolamento e duas empresas de exemplo.
//
// Roda contra QUALQUER Postgres — o local do `npm run banco`, ou um hospedado
// (Neon, Supabase) quando existir. É o mesmo caminho, de propósito.
//
//   npm run preparar                 → usa o .env (o laptop)
//   npm run preparar -- --producao   → usa o .env.producao (o banco hospedado)
//
// Usa DATABASE_URL_ADMIN (dono das tabelas). A aplicação nunca usa essa URL.
//
// As empresas de exemplo só nascem em banco local. Ver a trava mais abaixo.

import { carregarAmbiente, ehLocal } from './ambiente'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { semearExemplo, SENHA_EXEMPLO } from './exemplo-base'

const { arquivo } = carregarAmbiente()

const raiz = join(import.meta.dirname, '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

const url =
  process.env.DATABASE_URL_ADMIN ??
  `postgresql://postgres:postgres@127.0.0.1:${process.env.PORTA_BANCO ?? 5433}/postgres`

// ── a senha do papel da aplicação ────────────────────────────
// O padrão `norte_dev` existe para o laptop não precisar de configuração
// nenhuma, e isso é bom — mas ele quase virou a senha do banco de produção.
// Aconteceu: o SENHA_APP sumiu do .env.producao numa reescrita do arquivo, o
// script não reclamou, e o papel nasceu com a senha que está escrita AQUI,
// neste arquivo, no repositório.
//
// Não deu erro em lugar nenhum. O banco subiu, o RLS aplicou, tudo parecia
// certo — e a aplicação tinha uma credencial pública.
//
// Fora do laptop, agora, é obrigatório: sem SENHA_APP, o script para.
const SENHA_APP = process.env.SENHA_APP ?? (ehLocal(url) ? 'norte_dev' : '')
const SENHA_PORTARIA = process.env.SENHA_PORTARIA ?? (ehLocal(url) ? 'portaria_dev' : '')

if (!SENHA_APP || !SENHA_PORTARIA) {
  const faltando = [!SENHA_APP && 'SENHA_APP', !SENHA_PORTARIA && 'SENHA_PORTARIA']
    .filter(Boolean)
    .join(' e ')
  console.error(
    `\n  RECUSADO: falta ${faltando} em ${arquivo}.\n\n` +
      `  Este banco não é o do laptop, e os padrões do script estão escritos no\n` +
      `  repositório. Criar os papéis com eles seria pôr senha pública no banco\n` +
      `  de produção — já aconteceu uma vez, sem dar erro nenhum.\n\n` +
      `  Gere as que faltam:\n` +
      `    node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"\n`,
  )
  process.exit(1)
}

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
const local = ehLocal(url)
const pediuExemplo = process.argv.includes('--com-exemplo')
const semear = local || pediuExemplo

const cliente = new Client({ connectionString: url })
await cliente.connect()

const passo = (t: string) => console.log(`  ${t}`)

console.log(
  `\n  Preparando ${url.replace(/:[^:@]*@/, ':***@')}\n  credenciais de ${arquivo}\n`,
)

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

  -- O 'on all tables' acima é largo de propósito: tabela nova entra sozinha, e
  -- é isso que evita o esquecimento. Mas ele pega tudo que estiver em public —
  -- inclusive o que não é nosso. A tabela de controle das migrações guarda o
  -- histórico do schema; a aplicação não tem o que fazer com ela, e não é ela
  -- que deve poder reescrever esse histórico.
  do $$
  begin
    if to_regclass('public._prisma_migrations') is not null then
      revoke all on public._prisma_migrations from app_norte;
    end if;
  end $$;
`)

// ── 2.1 a portaria ───────────────────────────────────────────
// Um papel que só sabe responder "de que empresa é este endereço", que é a
// única leitura legítima antes de existir empresa no contexto.
//
// O limite dele não está na política de RLS — está no GRANT por COLUNA. Ele
// enxerga a fachada da empresa (nome, slug, logo, cor, o que a tela de login
// precisa) e mais nada: nem documento, nem telefone, nem crédito de IA, nem o
// teto de desconto do assistente.
//
// Antes quem fazia isso era o admin, que no Postgres do Supabase tem
// BYPASSRLS — uma credencial que lê o banco inteiro, viva no ambiente de
// produção, usada a cada login.
passo('portaria (o papel que só abre a porta)...')
await cliente.query(`
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'app_portaria') then
      create role app_portaria login password ${quote(SENHA_PORTARIA)};
    end if;
  end $$;

  grant usage on schema public to app_portaria;

  -- nada em bloco: só esta tabela, e só estas colunas
  revoke all on all tables in schema public from app_portaria;
  grant select (
    id, nome, slug, situacao, logo_url, cor_marca,
    modulos, configurada_em, agente_nome
  ) on public.orgs to app_portaria;
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
