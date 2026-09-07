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
import { guardarSenha } from '../src/servidor/senha'
import { semearCatalogo } from './exemplo-catalogo'
import { semearVendas } from './exemplo-vendas'
import { semearFinanceiro } from './exemplo-financeiro'
import { semearAgente } from './exemplo-agente'
import { semearClientes } from './exemplo-clientes'
import { CATEGORIAS_PADRAO } from '../src/servidor/financeiro'

const raiz = join(import.meta.dirname, '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

const url =
  process.env.DATABASE_URL_ADMIN ??
  `postgresql://postgres:postgres@127.0.0.1:${process.env.PORTA_BANCO ?? 5433}/postgres`

const SENHA_APP = process.env.SENHA_APP ?? 'norte_dev'
const SENHA_EXEMPLO = 'exemplo-2026'

const cliente = new Client({ connectionString: url })
await cliente.connect()

const passo = (t: string) => console.log(`  ${t}`)

console.log(`\n  Preparando ${url.replace(/:[^:@]*@/, ':***@')}\n`)

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

// ── 4. exemplo ───────────────────────────────────────────────
const { rows } = await cliente.query<{ n: string }>('select count(*)::int as n from orgs')
if (Number(rows[0]!.n) === 0) {
  passo('duas empresas de exemplo...')
  await cliente.query(`
    insert into orgs (id, nome, slug, plano, situacao, cor_marca, ramo, modulos,
                      configurada_em, telefone, criada_em, atualizada_em) values
      -- A NAO usa crediario de proposito: e assim que se ve o menu encolher.
      ('org-exemplo-a', 'Comércio Exemplo', 'exemplo', 'BALCAO_AGENTE', 'ATIVA', '#0D4A57',
       'roupa', ARRAY['agente','metas','multiUnidade'], now(), '(71) 99999-0000', now(), now()),
      ('org-exemplo-b', 'Empresa Vizinha', 'vizinha', 'REDE', 'ATIVA', '#7A4B12',
       'alimentacao', ARRAY['crediario','notaFiscal','multiUnidade'], now(), null, now(), now());

    insert into unidades (id, org_id, nome, ativa, eh_deposito, criada_em, atualizada_em) values
      ('uni-a1', 'org-exemplo-a', 'Loja Centro',   true, false, now(), now()),
      ('uni-a2', 'org-exemplo-a', 'Loja Shopping', true, false, now(), now()),
      ('uni-b1', 'org-exemplo-b', 'Loja Sul', true, false, now(), now()),
      ('uni-b2', 'org-exemplo-b', 'Deposito',      true, true,  now(), now());

  `)

  // Senha de exemplo, igual para todo mundo. Só existe em banco local.
  const hash = await guardarSenha(SENHA_EXEMPLO)
  await cliente.query(
    `insert into usuarios (id, org_id, nome, email, senha_hash, ativo, criado_em, atualizado_em) values
      ('usr-a1', 'org-exemplo-a', 'Ana',   'ana@exemplo.com',   $1, true, now(), now()),
      ('usr-a2', 'org-exemplo-a', 'Carlos',   'carlos@exemplo.com',   $1, true, now(), now()),
      ('usr-a3', 'org-exemplo-a', 'Contador','contador@exemplo.com',$1, true, now(), now()),
      ('usr-a4', 'org-exemplo-a', 'Antiga',  'antiga@exemplo.com',  $1, false, now(), now()),
      ('usr-b1', 'org-exemplo-b', 'Vizinho', 'vizinho@exemplo.com', $1, true, now(), now())`,
    [hash],
  )

  await cliente.query(`
    insert into acessos (id, org_id, usuario_id, unidade_id, papel, criado_em) values
      ('acs-a1', 'org-exemplo-a', 'usr-a1', null,     'DONO',     now()),
      ('acs-a2', 'org-exemplo-a', 'usr-a2', 'uni-a1', 'BALCAO',   now()),
      ('acs-a3', 'org-exemplo-a', 'usr-a3', null,     'CONTADOR', now()),
      ('acs-b1', 'org-exemplo-b', 'usr-b1', null,     'DONO',     now());
  `)
  // 'usr-a4' fica de proposito SEM acesso: e o caso "conta existe, senha bate,
  // mas nao tem papel em lugar nenhum".
} else {
  passo('já tem empresa cadastrada — exemplo não foi tocado')
}

if (await semearCatalogo(cliente, 'org-exemplo-a', 'uni-a1')) {
  passo('catálogo de exemplo (camiseta com grade + sorvete por quilo)...')
  // A segunda loja começa com a mesma carga, para o filtro ter os dois lados.
  await cliente.query(`
    insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, minimo, atualizado_em)
    select 'est2-' || v.id, v.org_id, v.id, 'uni-a2', 40, 3, now()
      from variacoes v where v.org_id = 'org-exemplo-a';
    insert into movimentos_estoque
      (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, motivo, quem, criado_em)
    select 'mov2-' || v.id, v.org_id, v.id, 'uni-a2', 'ENTRADA', 40, 40,
           'Carga inicial do exemplo', 'sistema', now()
      from variacoes v where v.org_id = 'org-exemplo-a';
  `)
}

const nVendas = await semearVendas(cliente, 'org-exemplo-a', [
  { id: 'uni-a1', nome: 'Loja Centro', fatia: 3 },
  { id: 'uni-a2', nome: 'Loja Shopping', fatia: 2 },
])
if (nVendas) passo(`${nVendas} vendas de exemplo nos últimos 30 dias...`)

// Categorias e contas do financeiro. Toda empresa começa com estas — o dono
// renomeia e acrescenta, mas ninguém deveria ter que montar do zero.
const { rows: temCat } = await cliente.query<{ n: string }>(
  "select count(*)::int as n from categorias_financeiras where org_id = 'org-exemplo-a'",
)
if (Number(temCat[0]!.n) === 0) {
  for (const [i, c] of CATEGORIAS_PADRAO.entries()) {
    await cliente.query(
      `insert into categorias_financeiras (id, org_id, nome, tipo, grupo, ordem, ativa)
       values ($1,'org-exemplo-a',$2,$3,$4,$5,true)`,
      [`cat-fin-${i}`, c.nome, c.tipo, c.grupo, i],
    )
  }
  await cliente.query(`
    insert into contas_financeiras (id, org_id, nome, tipo, saldo_inicial, ativa) values
      ('conta-caixa', 'org-exemplo-a', 'Caixa da loja',  'CAIXA', 0, true),
      ('conta-banco', 'org-exemplo-a', 'Conta do banco', 'BANCO', 0, true);
  `)
  passo('categorias e contas do financeiro...')
}

const nLanc = await semearFinanceiro(cliente, 'org-exemplo-a', 'uni-a1')
if (nLanc) passo(`${nLanc} lançamentos de exemplo (2 meses + contas a pagar)...`)

// Depois das vendas: os clientes de exemplo se ligam a vendas que já existem.
const nCli = await semearClientes(cliente, 'org-exemplo-a')
if (nCli) passo(`${nCli} clientes de exemplo, com as compras deles...`)

// Depois do financeiro de propósito: a proposta de compra do agente aponta
// para uma categoria financeira, e ela precisa existir antes.
const nRec = await semearAgente(cliente, 'org-exemplo-a')
if (nRec) passo(`assistente "Aurora" com ${nRec} recibos e uma proposta esperando...`)

await cliente.end()

console.log(`
  Pronto.

  Entrar como:  ana@exemplo.com (dona) / carlos@exemplo.com (balcao)
                contador@exemplo.com (contador)   —   senha: ${SENHA_EXEMPLO}

  Ponha no .env:
    DATABASE_URL="postgresql://app_norte:${SENHA_APP}@127.0.0.1:${process.env.PORTA_BANCO ?? 5433}/postgres"
    DATABASE_URL_ADMIN="${url}"
`)

/** Escapa senha para dentro do SQL. */
function quote(s: string) {
  return `'${s.replace(/'/g, "''")}'`
}
