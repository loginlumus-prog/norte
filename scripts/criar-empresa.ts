// A empresa nasce aqui.
//
//   npm run empresa -- --nome "Sorveteria da Praça" --slug sorveteria-praca \
//                      --email dono@sorveteria.com.br
//
//   npm run empresa -- ... --producao --url https://usenorte.com.br
//
// Cria a empresa e o convite do DONO. Devolve um link. Quem abre o link
// escolhe nome e senha, a conta nasce, e ele cai no cadastro inicial que já
// existe — onde escolhe ramo, módulos e batiza o assistente.
//
// ── por que isto é script, e não tela ────────────────────────
// Um dia vai ser tela: a pessoa assina, escolhe o endereço e entra sozinha.
// Enquanto não existe cobrança nem contrato, quem cria empresa é quem vende —
// e são poucos. Tela de auto-cadastro antes disso é porta aberta para encher o
// banco de empresa que ninguém pediu.
//
// ── e por que ele usa a credencial de admin ──────────────────
// Criar empresa é a segunda operação que legitimamente acontece FORA de uma
// empresa (a primeira é a portaria, que responde "de que empresa é este
// endereço"). Não existe `comoOrg` possível: a empresa é justamente o que
// ainda não existe.
//
// Aqui isso é aceitável porque é script de operador, rodado da máquina de
// quem vende, e não caminho de requisição. Quando virar tela, NÃO pode ser
// assim: vai precisar de um papel próprio, com permissão de inserir em `orgs`
// e `convites` e mais nada — do mesmo jeito que a portaria só lê nove colunas.

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes } from 'node:crypto'
import { carregarAmbiente, ehLocal } from './ambiente'
import { resumirToken, VALE_DIAS } from '../src/servidor/convite'
import { normalizar } from '../src/servidor/autenticacao'
import { PLANOS } from '../src/servidor/planos'
import type { Plano } from '@prisma/client'

const { arquivo } = carregarAmbiente()

// ── endereços que a empresa não pode ter ─────────────────────
// O endereço da empresa é o primeiro pedaço da URL (norte.app/<slug>), então
// ele disputa espaço com as páginas do próprio site. `usenorte.com.br/termos`
// precisa ser os termos, não a loja de alguém que se cadastrou como "termos".
//
// A lista é maior do que as páginas de hoje de propósito: tirar um nome de
// alguém que já está usando é muito pior do que reservar um nome a mais.
const RESERVADOS = new Set([
  // o que existe
  'fontes', 'img', 'video', 'arte', 'icon.svg', 'favicon.ico', 'robots.txt', 'sitemap.xml',
  // o que o Next usa
  '_next', 'api', 'static',
  // páginas do site, as de hoje e as próximas
  'termos', 'privacidade', 'contrato', 'planos', 'precos', 'ajuda', 'suporte',
  'sobre', 'contato', 'blog', 'status', 'seguranca', 'lgpd',
  // o que confunde com o sistema
  'admin', 'app', 'painel', 'entrar', 'sair', 'conta', 'assinatura', 'convite',
  'cadastro', 'criar', 'nova', 'novo', 'norte', 'www', 'mail', 'email',
])

function argumento(nome: string) {
  const i = process.argv.indexOf(`--${nome}`)
  if (i === -1) return null
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : null
}

const recusar = (motivo: string, ajuda?: string) => {
  console.error(`\n  RECUSADO: ${motivo}\n${ajuda ? `\n  ${ajuda}\n` : ''}`)
  process.exit(1)
}

// ── o que veio da linha de comando ───────────────────────────
const nome = argumento('nome')?.trim()
const slug = argumento('slug')?.trim().toLowerCase()
const email = argumento('email')?.trim()
const plano = (argumento('plano') ?? 'BALCAO_AGENTE') as Plano
const dias = Number(argumento('dias') ?? 14)
const reconvidar = process.argv.includes('--reconvidar')

const base =
  argumento('url') ??
  process.env.URL_BASE ??
  (ehLocal(process.env.DATABASE_URL_ADMIN ?? '') ? 'http://localhost:3000' : null)

if (!nome || !slug || !email) {
  recusar(
    'faltou --nome, --slug ou --email.',
    'npm run empresa -- --nome "Sorveteria da Praça" --slug sorveteria-praca --email dono@sorveteria.com.br',
  )
}

if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug!) || slug!.length < 3 || slug!.length > 40) {
  recusar(
    `"${slug}" não serve como endereço.`,
    'De 3 a 40 letras minúsculas, números e hífen. Não pode começar nem terminar com hífen.',
  )
}

if (RESERVADOS.has(slug!)) {
  recusar(`"${slug}" é um endereço reservado do sistema.`, 'Escolha outro.')
}

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email!)) {
  recusar(`"${email}" não parece um e-mail.`)
}

if (!(plano in PLANOS)) {
  recusar(`plano "${plano}" não existe.`, `Os que existem: ${Object.keys(PLANOS).join(', ')}.`)
}

if (!Number.isInteger(dias) || dias < 0 || dias > 365) {
  recusar('--dias precisa ser um número inteiro de 0 a 365.')
}

if (!base) {
  recusar(
    'não sei em que endereço o sistema está no ar, então não sei montar o link do convite.',
    'Passe --url https://... (ou ponha URL_BASE no ' + arquivo + ').',
  )
}

const url = process.env.DATABASE_URL_ADMIN
if (!url) recusar(`falta DATABASE_URL_ADMIN em ${arquivo}.`)

// ── mãos à obra ──────────────────────────────────────────────
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 1 }) })

const jaExiste = await db.org.findUnique({
  where: { slug: slug! },
  select: { id: true, nome: true, _count: { select: { usuarios: true } } },
})

if (jaExiste && !reconvidar) {
  recusar(
    `o endereço "${slug}" já é de "${jaExiste.nome}".`,
    'Para mandar um convite novo (o link venceu, o dono perdeu), rode de novo com --reconvidar.',
  )
}

if (reconvidar && !jaExiste) {
  recusar(`não existe empresa em "${slug}" para reconvidar.`, 'Rode sem --reconvidar para criar.')
}

// Reconvidar só vale enquanto NINGUÉM entrou. Depois que existe gente lá
// dentro, convite se manda pela tela de Equipe, por alguém com papel — e não
// por um script que passa por cima de toda permissão.
if (reconvidar && jaExiste!._count.usuarios > 0) {
  recusar(
    `"${jaExiste!.nome}" já tem ${jaExiste!._count.usuarios} pessoa(s) dentro.`,
    'Convite novo se manda pela tela de Equipe, por quem tem papel para isso.',
  )
}

const org =
  jaExiste ??
  (await db.org.create({
    data: {
      nome: nome!,
      slug: slug!,
      email: normalizar(email!),
      plano,
      situacao: 'TESTE',
      testeAte: dias > 0 ? new Date(Date.now() + dias * 864e5) : null,
    },
    select: { id: true, nome: true, _count: { select: { usuarios: true } } },
  }))

// O token vai no link; no banco fica só o resumo. Mesmo esquema do convite
// normal — ver src/servidor/convite.ts.
const token = randomBytes(32).toString('base64url')
const expiraEm = new Date(Date.now() + VALE_DIAS * 864e5)

await db.convite.deleteMany({ where: { orgId: org.id, aceitoEm: null } })
await db.convite.create({
  data: {
    orgId: org.id,
    email: normalizar(email!),
    papel: 'DONO',
    token: resumirToken(token),
    expiraEm,
  },
})

await db.auditoria.create({
  data: {
    orgId: org.id,
    quem: 'script',
    acao: jaExiste ? 'empresa.reconvidou' : 'empresa.criou',
    alvoTipo: 'org',
    alvoId: org.id,
    alvoNome: nome!,
    depois: { plano, dias, email: normalizar(email!) },
  },
})

await db.$disconnect()

const dia = (d: Date) => d.toLocaleDateString('pt-BR')
const link = `${base!.replace(/\/$/, '')}/${slug}/convite/${token}`

console.log(`
  ${jaExiste ? 'Convite refeito' : 'Empresa criada'}.

    Nome       ${org.nome}
    Endereço   /${slug}
    Plano      ${plano}${dias > 0 ? `, em teste até ${dia(new Date(Date.now() + dias * 864e5))}` : ''}
    Dono       ${normalizar(email!)}

  Mande este link para o dono. Vale até ${dia(expiraEm)}, serve UMA vez, e não
  dá para recuperar depois — o banco só guarda o resumo dele.

    ${link}

  Quando ele abrir: escolhe o nome e a senha, a conta nasce como DONO, e ele
  cai no cadastro inicial — ramo, módulos e o nome do assistente.
`)
