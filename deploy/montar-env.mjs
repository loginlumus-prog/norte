// Monta o arquivo de ambiente do servidor — RODA NO LAPTOP, na raiz do repositório:
//
//   node deploy/montar-env.mjs --simular     (só confere; não escreve nada)
//   node deploy/montar-env.mjs               (escreve deploy/.env.servidor)
//
// Por que existe: os segredos moram no seu laptop (.env.producao e
// .video/demo.env) e não podem passar por chat nem por repositório. Este
// programa lê os dois arquivos, copia SÓ as variáveis da lista abaixo e grava
// um arquivo pronto para enviar à VPS por scp (LEIA-ME.md, passo 5).
//
// ── o que ele garante ────────────────────────────────────────
// - LISTA FECHADA: só entra o que está em PERMITIDAS. Qualquer outra variável
//   é ignorada — em especial DATABASE_URL_ADMIN (dona das tabelas, ignora o
//   RLS), que nunca vai para o servidor.
// - NORTE_URL é fixada no endereço público; NORTE_ORIGENS e
//   NORTE_ASSINATURA_LIVRE (coisas da demonstração/laptop) são descartadas.
// - NÃO gera nada novo para o que precisa continuar IGUAL (NORTE_CIFRA,
//   SEGREDO_SESSAO, WEBHOOK_SEGREDO, ROTINAS_SEGREDO, NORTE_CODIGO_SEGREDO,
//   as URLs do banco): se faltar, avisa FALTA e para.
// - Só CONECTOR_TOKEN e CONECTOR_ASSINATURA são gerados, se não existirem
//   (são novos: a demonstração usava um segredo só).
// - Imprime só NOMES e ok/FALTA. Nunca um valor.
//
// Um terceiro arquivo opcional, deploy/.env.extras (também fora do git), serve
// para o que ainda não está em nenhum dos dois: RESEND_API_KEY,
// EMAIL_REMETENTE, TRANSCRICAO_CHAVE, META_*... no formato NOME=valor.

import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { parse } from 'dotenv'

const SIMULAR = process.argv.includes('--simular')
const DOMINIO_ARG = process.argv.find((a) => a.startsWith('--dominio='))
const NORTE_URL = DOMINIO_ARG ? DOMINIO_ARG.slice('--dominio='.length).replace(/\/+$/, '') : 'https://gestornorte.com'

const SAIDA = 'deploy/.env.servidor'
// Ordem de prioridade: o último vence (a demonstração rodava com demo.env por
// cima do .env.producao; os extras por cima de tudo).
const FONTES = ['.env.producao', '.video/demo.env', 'deploy/.env.extras']

// ── a lista fechada ──────────────────────────────────────────
// obrigatória: sem ela o site (ou o assistente) não funciona direito.
const PERMITIDAS = [
  // banco
  { nome: 'DATABASE_URL', obrigatoria: true },
  { nome: 'DATABASE_URL_PORTARIA', obrigatoria: true },
  { nome: 'POOL_MAX' },
  { nome: 'POOL_PORTARIA' },
  // segredos que NÃO podem mudar
  { nome: 'SEGREDO_SESSAO', obrigatoria: true },
  { nome: 'NORTE_CIFRA', obrigatoria: true },
  { nome: 'NORTE_CODIGO_SEGREDO', obrigatoria: true },
  { nome: 'WEBHOOK_SEGREDO', obrigatoria: true },
  { nome: 'ROTINAS_SEGREDO', obrigatoria: true },
  // conector (novos; gerados se faltarem)
  { nome: 'CONECTOR_TOKEN', gerar: true },
  { nome: 'CONECTOR_ASSINATURA', gerar: true },
  // e-mail
  { nome: 'RESEND_API_KEY' },
  { nome: 'EMAIL_REMETENTE' },
  { nome: 'CADASTRO_ABERTO' },
  { nome: 'NORTE_WHATSAPP' },
  // IA e áudio
  { nome: 'ANTHROPIC_API_KEY', obrigatoria: true },
  { nome: 'TRANSCRICAO_CHAVE' },
  { nome: 'TRANSCRICAO_URL' },
  { nome: 'TRANSCRICAO_MODELO' },
  { nome: 'TRANSCRICAO_CENT_POR_MINUTO' },
  // Z-API e Meta
  { nome: 'ZAPI_EMPRESA' },
  { nome: 'ZAPI_INSTANCIA' },
  { nome: 'ZAPI_TOKEN' },
  { nome: 'ZAPI_CLIENT_TOKEN' },
  { nome: 'ZAPI_URL' },
  { nome: 'META_APP_ID' },
  { nome: 'META_APP_SECRET' },
  { nome: 'META_CONFIG_ID' },
  { nome: 'META_WEBHOOK_VERIFY_TOKEN' },
  { nome: 'META_GRAPH_VERSION' },
]
const FIXAS = ['NORTE_URL', 'TZ']
// Nomes que, se aparecerem nas fontes, são ignorados de propósito (só o nome é dito).
const BANIDAS = ['DATABASE_URL_ADMIN', 'NORTE_ORIGENS', 'NORTE_ASSINATURA_LIVRE', 'CONECTOR_SEGREDO', 'SENHA_APP', 'SENHA_PORTARIA']

const erros = []
const avisos = []

// ── lê as fontes ─────────────────────────────────────────────
const valores = new Map() // nome -> { valor, origem }
let admin = null
console.log(SIMULAR ? 'Simulação (nada será escrito)\n' : 'Montando o ambiente do servidor\n')
for (const arq of FONTES) {
  if (!existsSync(arq)) {
    console.log(`  fonte      ${arq}: ${arq === 'deploy/.env.extras' ? 'não existe (opcional)' : 'NÃO ENCONTRADA'}`)
    if (arq !== 'deploy/.env.extras') erros.push(`arquivo ${arq} não encontrado (rode na raiz do repositório)`)
    continue
  }
  const lido = parse(readFileSync(arq))
  console.log(`  fonte      ${arq}: ${Object.keys(lido).length} variáveis lidas`)
  for (const [nome, valor] of Object.entries(lido)) {
    if (nome === 'DATABASE_URL_ADMIN') admin = valor
    if (PERMITIDAS.some((p) => p.nome === nome) && String(valor).trim() !== '') {
      valores.set(nome, { valor: String(valor).trim(), origem: arq })
    }
  }
  const banidas = BANIDAS.filter((n) => n in lido)
  if (banidas.length) console.log(`  ignoradas  ${banidas.join(', ')}  (nunca vão para o servidor)`)
}

// Reaproveita o que já foi gerado numa rodada anterior, para não trocar o
// token a cada execução.
if (existsSync(SAIDA)) {
  const anterior = parse(readFileSync(SAIDA))
  for (const n of ['CONECTOR_TOKEN', 'CONECTOR_ASSINATURA']) {
    if (!valores.has(n) && anterior[n]) valores.set(n, { valor: anterior[n], origem: `${SAIDA} (anterior)` })
  }
}

// ── confere e gera ───────────────────────────────────────────
const saida = []
console.log('')
for (const p of PERMITIDAS) {
  let item = valores.get(p.nome)
  if (!item && p.gerar) {
    item = { valor: randomBytes(32).toString('base64url'), origem: 'GERADO agora' }
    valores.set(p.nome, item)
  }
  if (!item) {
    if (p.obrigatoria) {
      console.log(`  FALTA      ${p.nome}  (obrigatória — NÃO gerar: tem de ser o valor atual)`)
      erros.push(`${p.nome} falta`)
    } else {
      console.log(`  ausente    ${p.nome}  (opcional)`)
    }
    continue
  }
  if (/['\r\n]/.test(item.valor)) {
    console.log(`  ERRO       ${p.nome}  tem aspas simples ou quebra de linha: não cabe no formato`)
    erros.push(`${p.nome} com caractere não suportado`)
    continue
  }
  console.log(`  ok         ${p.nome.padEnd(30)} ${item.origem}`)
  saida.push([p.nome, item.valor])
}
for (const f of FIXAS) console.log(`  fixa       ${f}`)

// ── conferências cruzadas (sem mostrar valor) ────────────────
const v = (n) => valores.get(n)?.valor
if (v('CONECTOR_TOKEN') && v('CONECTOR_TOKEN') === v('CONECTOR_ASSINATURA')) {
  erros.push('CONECTOR_TOKEN e CONECTOR_ASSINATURA são iguais (precisam ser diferentes)')
}
for (const n of ['SEGREDO_SESSAO', 'WEBHOOK_SEGREDO', 'ROTINAS_SEGREDO', 'CONECTOR_TOKEN', 'CONECTOR_ASSINATURA']) {
  if (v(n) && v(n).length < 32) erros.push(`${n} tem menos de 32 caracteres`)
}
if (v('DATABASE_URL') && admin && v('DATABASE_URL') === admin) {
  erros.push('DATABASE_URL é IGUAL à DATABASE_URL_ADMIN: o servidor não pode usar a conexão dona das tabelas')
}
if (v('DATABASE_URL')) {
  try {
    const u = new URL(v('DATABASE_URL'))
    if (!decodeURIComponent(u.username).startsWith('app_norte')) {
      avisos.push('o usuário da DATABASE_URL não começa com "app_norte" — confira que NÃO é o postgres/admin')
    }
  } catch {
    erros.push('DATABASE_URL não é um endereço válido')
  }
}
if (v('DATABASE_URL_PORTARIA')) {
  try {
    new URL(v('DATABASE_URL_PORTARIA'))
  } catch {
    erros.push('DATABASE_URL_PORTARIA não é um endereço válido')
  }
}
if (!v('RESEND_API_KEY') || !v('EMAIL_REMETENTE')) {
  avisos.push('RESEND_API_KEY/EMAIL_REMETENTE ausentes: o e-mail (convite, esqueci a senha) fica desligado. Ponha em deploy/.env.extras e rode de novo, ou adicione na VPS depois')
}

// ── escreve ──────────────────────────────────────────────────
console.log('')
for (const a of avisos) console.log(`  AVISO      ${a}`)
if (erros.length) {
  console.log('')
  for (const e of erros) console.log(`  ERRO       ${e}`)
  console.log('\nNada foi escrito. Corrija e rode de novo.')
  process.exit(1)
}

const linhas = [
  '# Gerado por deploy/montar-env.mjs. SEGREDOS — não commitar, não colar em chat.',
  ...saida.map(([n, val]) => `${n}='${val}'`),
  `NORTE_URL='${NORTE_URL}'`,
  `TZ='America/Sao_Paulo'`,
  '',
]
if (SIMULAR) {
  console.log(`\nSimulação ok: ${saida.length + FIXAS.length} variáveis iriam para ${SAIDA}. Nada foi escrito.`)
} else {
  writeFileSync(SAIDA, linhas.join('\n'), { mode: 0o600 })
  try {
    chmodSync(SAIDA, 0o600)
  } catch {}
  console.log(`\nEscrito ${SAIDA} com ${saida.length + FIXAS.length} variáveis.`)
  console.log('Próximo: scp para a VPS (LEIA-ME.md, passo 5) e depois APAGUE este arquivo do laptop.')
}
