// A operação do dia a dia da equipe do Norte, do laptop.
//
//   npm run operacao -- empresas                       quem são, em que plano, como vão
//   npm run operacao -- pedidos                        pedidos de plano e de respostas esperando resposta
//   npm run operacao -- plano    <slug> <PLANO>        atende (ou faz) uma troca de plano
//   npm run operacao -- respostas <slug> --motivo "..." atende (ou dá) um pacote de +500 respostas
//   npm run operacao -- credito  <slug> <reais> --motivo "..."   (cofre de IA, modelo antigo)
//   npm run operacao -- recusar  <slug> plano|respostas|credito --motivo "..."
//   npm run operacao -- suporte-conceder <slug> --email <quem> --horas <1..72> --motivo "..." [--edicao]
//   npm run operacao -- suporte-revogar <slug> --email <quem>
//   npm run operacao -- situacao <slug> ATIVA|SUSPENSA|CANCELADA --motivo "..."
//   npm run operacao -- farol-marcas <slug> <quantas> --motivo "..."
//
//   ... --quem "Seu nome"   quem assina no livro da loja (ou NORTE_OPERADOR no .env)
//   ... --confirmar         sem isto, o que MUDA dado só mostra o que faria
//   ... --producao          lê .env.producao em vez do .env
//
// ── por que é script, e não tela ─────────────────────────────
// Um console de administração na web precisaria, NO SERVIDOR, de uma chave
// que atravessa empresas. Aí um furo em qualquer tela — uma Server Action
// sem checagem, um parâmetro a mais — vira acesso a todas as lojas. Aqui a
// chave mora no laptop de quem opera e em nenhum outro lugar.
//
// ── as duas credenciais ──────────────────────────────────────
// • As LISTAS (empresas, pedidos) atravessam empresas e por isso usam a de
//   ADMIN — só leitura, com as colunas escolhidas a dedo: nada de nome de
//   cliente, telefone, CPF ou e-mail.
// • Toda ESCRITA vai pela credencial da APLICAÇÃO, dentro do comoOrg da
//   empresa do endereço (src/servidor/operacao.ts e assinatura.ts): o RLS
//   prende a operação àquela empresa, e a linha do livro sai na mesma
//   transação, assinada "Equipe Norte (<quem>)".
//
// ── as travas ────────────────────────────────────────────────
// • Sem --confirmar, nada muda: o comando mostra o resumo e para.
// • Com --producao, além do --confirmar, é preciso DIGITAR o endereço da
//   empresa depois de ler o resumo. Sem terminal para digitar, recusa.
// • --producao com NODE_ENV=production (ou na Vercel) recusa: isto é
//   ferramenta de laptop, e a chave de admin não tem o que fazer num servidor.
// • Toda saída passa por `limparSegredos`: se um erro do driver trouxer a URL
//   do banco com a senha, a senha sai como ***.

import { inspect } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { carregarAmbiente, ehLocal } from './ambiente'

// ── antes de tudo: onde estamos ──────────────────────────────
const pedeProducao = process.argv.includes('--producao')
if (pedeProducao && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
  console.error(
    '\n  RECUSADO: --producao num ambiente de produção (NODE_ENV=production ou Vercel).\n\n' +
      '  A ferramenta de operação roda do laptop de quem opera, e só dali.\n',
  )
  process.exit(1)
}

const { producao, arquivo } = carregarAmbiente()

const { lerArgumentos, limparSegredos } = await import('../src/servidor/operacao')

// Toda escrita no terminal passa pelo filtro, inclusive a de biblioteca.
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

const { acharOrgPorSlug, fechar } = await import('../src/servidor/banco')
const { PACOTES, PLANOS, PRECOS, milhar, precoDoFarol } = await import('../src/servidor/planos')
const { mostrar } = await import('../src/servidor/dinheiro')
const { previaDeTroca, trocarPlanoComoEquipe, quemDaEquipe, respostasDoMes, SemCota } = await import('../src/servidor/assinatura')
const ped = await import('../src/servidor/pedidos')
const op = await import('../src/servidor/operacao')
type Plano = keyof typeof PLANOS
type PrismaAdmin = import('@prisma/client').PrismaClient

const SEM_VALOR = ['confirmar', 'producao', 'sem-pedido', 'edicao']
const { posicionais, opcoes } = lerArgumentos(process.argv.slice(2), SEM_VALOR)
const [comando, ...resto] = posicionais
const confirmar = opcoes.confirmar === true
const texto = (nome: string) => (typeof opcoes[nome] === 'string' ? (opcoes[nome] as string) : null)

// ── utilidades de tela ───────────────────────────────────────

class Parada extends Error {}
/** Para com recado (código 1). */
function parar(msg: string): never {
  throw new Parada(msg)
}

const dataHora = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(d)

const haQuanto = (d: Date, agora = new Date()) => {
  const min = Math.floor((agora.getTime() - d.getTime()) / 60_000)
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.floor(h / 24)} dias`
}

/** Tabela de texto, com colunas alinhadas. */
function tabela(cabecalho: string[], linhas: string[][]) {
  const largura = cabecalho.map((c, i) => Math.max(c.length, ...linhas.map((l) => (l[i] ?? '').length)))
  const linha = (l: string[]) => '  ' + l.map((c, i) => (c ?? '').padEnd(largura[i]!)).join('  ').trimEnd()
  console.log(linha(cabecalho))
  console.log('  ' + largura.map((n) => '─'.repeat(n)).join('  '))
  for (const l of linhas) console.log(linha(l))
}

function titulo(t: string) {
  console.log(`\n  ${t}   [banco: ${producao ? 'PRODUÇÃO (' + arquivo + ')' : 'local'}]\n`)
}

/** O resumo antes de aplicar: o que vai acontecer, com as palavras de gente. */
function resumo(linhas: [string, string][]) {
  const w = Math.max(...linhas.map(([k]) => k.length))
  for (const [k, v] of linhas) console.log(`    ${k.padEnd(w)}   ${v}`)
  console.log('')
}

/** Quem está rodando, validado. Só é exigido quando vai mudar alguma coisa. */
function operador(): string {
  const nome = texto('quem') ?? process.env.NORTE_OPERADOR ?? ''
  try {
    return quemDaEquipe(nome)
  } catch (e) {
    return parar((e as Error).message + ' Ou ponha NORTE_OPERADOR="Seu nome" no ' + arquivo + '.')
  }
}

/**
 * A última porta antes de mudar dado. Devolve `false` quando é só prévia.
 *
 * Em produção, além do --confirmar, a pessoa digita o endereço da empresa:
 * é a diferença entre "rodei o comando errado do histórico" e "li o resumo".
 */
async function porta(slug: string): Promise<boolean> {
  if (!confirmar) {
    console.log('  Nada foi feito. Confira o resumo e rode de novo com --confirmar.\n')
    return false
  }
  if (!producao) return true
  if (!process.stdin.isTTY) parar('Em produção a confirmação é digitada. Rode num terminal.')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const digitado = (await rl.question(`  PRODUÇÃO. Digite o endereço da empresa (${slug}) para aplicar: `)).trim()
    if (digitado !== slug) parar('Não confere. Nada foi feito.')
  } finally {
    rl.close()
  }
  return true
}

async function empresaDo(slug: string | undefined) {
  if (!slug) parar('Falta o endereço da empresa (o slug, como em /exemplo).')
  const org = await acharOrgPorSlug(slug)
  if (!org) parar(`Não existe empresa em /${slug}.`)
  return org
}

// ── a conexão de admin, só para as listas ────────────────────

let admin: PrismaAdmin | undefined
async function adminDb(): Promise<PrismaAdmin> {
  if (admin) return admin
  const url = process.env.DATABASE_URL_ADMIN
  if (!url) parar(`Falta DATABASE_URL_ADMIN em ${arquivo}.`)
  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) })
  return admin
}

// ─────────────────────────────────────────────────────────────
// OS COMANDOS
// ─────────────────────────────────────────────────────────────

async function empresas() {
  const db = await adminDb()
  const agora = new Date()
  // Em sequência: o banco local é um Postgres de uma conexão.
  const orgs = await db.org.findMany({
    orderBy: { criadaEm: 'asc' },
    select: {
      id: true, slug: true, plano: true, situacao: true, testeAte: true, creditoIaCent: true,
      agente: { select: { canal: true, ativo: true } },
      _count: {
        select: {
          unidades: { where: { ativa: true } },
          // Gente da LOJA: conta ativa com acesso que não é o nosso suporte.
          usuarios: { where: { ativo: true, acessos: { some: { papel: { not: 'SUPORTE' } } } } },
        },
      },
    },
  })
  const ultima = await db.auditoria.groupBy({ by: ['orgId'], _max: { criadoEm: true } })
  const suporte = await db.acesso.groupBy({
    by: ['orgId'],
    where: { papel: 'SUPORTE', OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
    _count: { _all: true },
  })
  const ultimaDe = new Map(ultima.map((u) => [u.orgId, u._max.criadoEm]))
  const suporteDe = new Map(suporte.map((s) => [s.orgId, s._count._all]))

  titulo(`${orgs.length} empresa(s)`)
  tabela(
    ['endereço', 'plano', 'situação', 'lojas', 'pessoas', 'última atividade', 'crédito IA', 'WhatsApp', 'suporte'],
    orgs.map((o) => {
      const u = ultimaDe.get(o.id)
      const canal = op.nomeDoCanal(o.agente?.canal)
      return [
        o.slug,
        PLANOS[o.plano].titulo,
        o.situacao === 'TESTE' && o.testeAte
          ? `teste ${o.testeAte > agora ? 'até' : 'venceu em'} ${dataHora(o.testeAte).slice(0, 8)}`
          : o.situacao.toLowerCase(),
        String(o._count.unidades),
        String(o._count.usuarios),
        u ? `${dataHora(u)} (${haQuanto(u, agora)})` : '—',
        mostrar(o.creditoIaCent),
        canal === 'nenhum' || o.agente?.ativo ? canal : `${canal} (assistente desligado)`,
        suporteDe.get(o.id) ? `${suporteDe.get(o.id)} ativo(s)` : '—',
      ]
    }),
  )
  console.log('')
}

async function pedidos() {
  const db = await adminDb()
  const agora = new Date()
  const desde = new Date(agora.getTime() - ped.JANELA_PEDIDOS_DIAS * 864e5)
  const livro = await db.auditoria.findMany({
    where: { acao: { in: [...ped.ACOES_DE_PEDIDO] }, criadoEm: { gte: desde } },
    select: { id: true, orgId: true, acao: true, criadoEm: true, alvoNome: true, motivo: true, depois: true },
  })
  // O pacote de respostas fecha o pedido DELE, não um de crédito (pedidos.ts).
  const recargas = await db.recargaIA.findMany({
    where: { tipo: 'COMPRA', centavos: { gt: 0 }, criadoEm: { gte: desde }, origem: { not: 'pacote' } },
    select: { id: true, orgId: true, criadoEm: true },
  })

  const porEmpresa = new Map<string, import('../src/servidor/pedidos').EventoPedido[]>()
  const juntar = (orgId: string, e: import('../src/servidor/pedidos').EventoPedido) =>
    porEmpresa.set(orgId, [...(porEmpresa.get(orgId) ?? []), e])
  for (const { orgId, ...e } of livro) juntar(orgId, e)
  for (const r of recargas) juntar(r.orgId, ped.recargaComoEvento(r))

  const abertos = [...porEmpresa].flatMap(([orgId, eventos]) =>
    ped.pedidosAbertos(eventos).map((p) => ({ orgId, p })),
  )
  const orgs = await db.org.findMany({
    where: { id: { in: [...new Set(abertos.map((a) => a.orgId))] } },
    select: { id: true, slug: true, plano: true, situacao: true, creditoIaCent: true },
  })
  const org = new Map(orgs.map((o) => [o.id, o]))

  titulo(abertos.length === 0 ? 'Nenhum pedido esperando resposta.' : `${abertos.length} pedido(s) esperando resposta`)
  if (abertos.length === 0) return

  abertos.sort((a, b) => a.p.criadoEm.getTime() - b.p.criadoEm.getTime())
  tabela(
    ['endereço', 'pedido em', 'pediu', 'plano hoje', 'crédito hoje', 'situação'],
    abertos.map(({ orgId, p }) => {
      const o = org.get(orgId)!
      return [
        o.slug,
        `${dataHora(p.criadoEm)} (${haQuanto(p.criadoEm, agora)})`,
        p.oQue,
        PLANOS[o.plano].titulo,
        mostrar(o.creditoIaCent),
        o.situacao.toLowerCase(),
      ]
    }),
  )
  console.log(
    '\n  Para atender:  npm run operacao -- plano <endereço> <PLANO> --quem "Seu nome" --confirmar' +
      '\n                 npm run operacao -- respostas <endereço> --motivo "..." --quem "Seu nome" --confirmar' +
      '\n                 npm run operacao -- credito <endereço> <reais> --motivo "..." --quem "Seu nome" --confirmar' +
      '\n  Para recusar:  npm run operacao -- recusar <endereço> plano|respostas|credito --motivo "..." --quem "Seu nome" --confirmar' +
      `\n\n  Planos: ${(Object.keys(PLANOS) as Plano[]).map((k) => `${k} (${PLANOS[k].titulo})`).join(', ')}\n`,
  )
}

async function plano() {
  const [slug, alvoBruto] = resto
  const alvo = (alvoBruto ?? '').toUpperCase() as Plano
  if (!(alvo in PLANOS)) {
    parar(`Diga o plano: ${(Object.keys(PLANOS) as Plano[]).map((k) => `${k} (${PLANOS[k].titulo})`).join(', ')}.`)
  }
  const org = await empresaDo(slug)
  const m = await previaDeTroca(org.id, alvo)
  const pedido = ped.pedidoAberto(await ped.eventosDePedido(org.id), 'plano')

  titulo(`Trocar o plano de /${org.slug}`)
  resumo([
    ['Empresa', `${org.nome} (${org.situacao.toLowerCase()})`],
    ['Plano', `${PLANOS[m.de].titulo} → ${PLANOS[alvo].titulo} (${m.sentido})`],
    ['Mensalidade', m.novoMensal === null ? 'sob contrato' : `${mostrar(Math.round(m.novoMensal * 100))}${m.diferenca ? ` (${m.diferenca > 0 ? '+' : ''}${mostrar(Math.round(m.diferenca * 100))})` : ''}`],
    ['Ganha', m.ganha.length ? m.ganha.join(', ') : '—'],
    ['Perde', m.perde.length ? `${m.perde.join(', ')} (os módulos saem da empresa)` : '—'],
    ['Pedido', pedido ? `atende o pedido do ${pedido.oQue}, de ${dataHora(pedido.criadoEm)}` : 'nenhum aberto — troca por decisão da equipe'],
  ])
  if (m.impedimentos.length > 0) parar(`Não dá para trocar: ${m.impedimentos.join(' ')}`)
  if (m.sentido === 'igual') parar(`/${org.slug} já está no plano ${PLANOS[alvo].titulo}.`)

  const quem = confirmar ? operador() : null
  if (!(await porta(org.slug))) return
  try {
    await trocarPlanoComoEquipe(org.id, alvo, quem!, { pedidoId: pedido?.id })
  } catch (e) {
    if (e instanceof SemCota) parar(`Não dá para trocar: ${e.motivo}`)
    throw e
  }
  console.log(`  Feito. /${org.slug} está no plano ${PLANOS[alvo].titulo}. No livro da loja: ${quem}.\n`)
}

async function credito() {
  const [slug, valorBruto] = resto
  const tipo = (texto('tipo') ?? 'COMPRA').toUpperCase()
  if (tipo !== 'COMPRA' && tipo !== 'AJUSTE') parar('--tipo é COMPRA (o pedido pago) ou AJUSTE (cortesia, correção).')
  const centavos = valorBruto ? op.lerValorEmReais(valorBruto) : null
  if (centavos === null || centavos === 0) parar('Diga o valor em reais: 150, 150,50 ou 1.234,56 (negativo só com --tipo AJUSTE).')
  const motivo = op.validarMotivo(texto('motivo'))
  const org = await empresaDo(slug)
  const saldo = await op.saldoDeCredito(org.id)
  const pedido = opcoes['sem-pedido'] ? null : ped.pedidoAberto(await ped.eventosDePedido(org.id), 'credito')

  titulo(`Crédito de IA em /${org.slug}`)
  resumo([
    ['Empresa', `${org.nome} (${org.situacao.toLowerCase()})`],
    ['Lançamento', `${centavos > 0 ? '+' : ''}${mostrar(centavos)} (${tipo})`],
    ['Saldo', `${mostrar(saldo)} → ${mostrar(saldo + centavos)}`],
    ['Motivo', `"${motivo}" — a loja lê isto no extrato do crédito`],
    ['Pedido', pedido ? `atende o pedido de ${pedido.oQue}, de ${dataHora(pedido.criadoEm)}` : 'nenhum'],
  ])
  if (saldo + centavos < 0) parar('O saldo ficaria negativo.')

  const quem = confirmar ? operador() : null
  if (!(await porta(org.slug))) return
  const r = await op.recarregarComoEquipe(org.id, centavos, {
    tipo: tipo as 'COMPRA' | 'AJUSTE',
    motivo,
    quem: quem!,
    pedidoId: pedido?.id,
  })
  console.log(`  Feito. Saldo de crédito de IA de /${org.slug}: ${mostrar(r.saldoDepois)}.\n`)
}

async function respostas() {
  const [slug] = resto
  const motivo = op.validarMotivo(texto('motivo'))
  const org = await empresaDo(slug)
  const agora = await respostasDoMes(org.id)
  const pedido = opcoes['sem-pedido'] ? null : ped.pedidoAberto(await ped.eventosDePedido(org.id), 'respostas')

  titulo(`Pacote de respostas em /${org.slug}`)
  resumo([
    ['Empresa', `${org.nome} (${org.situacao.toLowerCase()})`],
    ['Pacote', `${pedido?.pacote === 'grande' ? `+${milhar(PACOTES.grande.respostas)}` : `+${milhar(PACOTES.pequeno.respostas)}`} respostas neste mês (${mostrar(Math.round(PACOTES[pedido?.pacote ?? 'pequeno'].preco * 100))})`],
    ['Respostas', agora.total === null ? 'sob contrato' : `${milhar(agora.usadas)} usadas de ${milhar(agora.total)} → de ${milhar(agora.total + PACOTES[pedido?.pacote ?? 'pequeno'].respostas)}`],
    ['Motivo', `"${motivo}" — vai para o livro da loja`],
    ['Pedido', pedido ? `atende o pedido de ${pedido.oQue}, de ${dataHora(pedido.criadoEm)}` : 'nenhum aberto — pacote por decisão da equipe'],
  ])
  if (agora.total === null) parar('Plano sob contrato: as respostas são as do contrato, não de pacote.')
  if (agora.total === 0 && agora.incluidas === 0) parar('O plano desta empresa não tem o assistente: pacote não entra.')

  const quem = confirmar ? operador() : null
  if (!(await porta(org.slug))) return
  const r = await op.atenderPacoteDeRespostas(org.id, { motivo, quem: quem!, pedidoId: pedido?.id })
  console.log(`  Feito. /${org.slug}: ${milhar(r.usadas)} usadas de ${r.total === null ? '—' : milhar(r.total)} no mês. No livro da loja: ${quem}.\n`)
}

async function recusar() {
  const [slug, tipoBruto] = resto
  const tipo = op.lerTipoPedido(tipoBruto) ?? parar('Diga o que recusar: plano, respostas ou credito.')
  const motivo = op.validarMotivo(texto('motivo'))
  const org = await empresaDo(slug)
  const pedido = ped.pedidoAberto(await ped.eventosDePedido(org.id), tipo)
  if (!pedido) parar(`/${org.slug} não tem pedido de ${op.NOME_DO_TIPO[tipo]} aberto.`)

  titulo(`Recusar um pedido de /${org.slug}`)
  resumo([
    ['Empresa', `${org.nome} (${org.situacao.toLowerCase()})`],
    ['Pedido', `${pedido.oQue}, de ${dataHora(pedido.criadoEm)}`],
    ['Motivo', `"${motivo}" — a loja lê isto na tela da Assinatura`],
  ])

  const quem = confirmar ? operador() : null
  if (!(await porta(org.slug))) return
  await op.recusarPedido(org.id, tipo, { motivo, quem: quem! })
  console.log('  Feito. O pedido saiu da lista, e a loja vê a recusa com o motivo.\n')
}

/** O endereço público do Norte neste ambiente ('' = não sei). */
const basePublica = () =>
  (process.env.NORTE_URL ?? process.env.URL_BASE ?? (ehLocal(process.env.DATABASE_URL_ADMIN) ? 'http://localhost:3000' : ''))
    .trim()
    .replace(/\/+$/, '')

/** Onde a pessoa entra: a entrada normal da empresa. */
const enderecoDeEntrada = (slug: string) => `${basePublica()}/${slug}/entrar`

async function suporte() {
  const [slug] = resto
  const email = op.validarEmail(texto('email'))
  const horas = op.validarHoras(texto('horas') ?? '')
  const motivo = op.validarMotivo(texto('motivo'))
  const edicao = opcoes.edicao === true
  const org = await empresaDo(slug)
  const e = await op.estadoDoSuporte(org.id, email)
  const dominio = process.env.NORTE_EQUIPE_DOMINIO ?? null
  const impede = op.impedimentoDoSuporte(e, dominio, email)
  const agora = new Date()
  const ate = new Date(agora.getTime() + horas * 3_600_000)
  if (impede) parar(impede)

  titulo(`Acesso de suporte em /${org.slug}`)
  resumo([
    ['Empresa', `${org.nome} (${org.situacao.toLowerCase()})`],
    ['Conta', e.usuario ? `já existe nesta empresa${e.usuario.temSenha ? '' : ' (ainda sem senha)'}` : 'será criada agora, sem senha'],
    ...(e.usuario?.temSenha ? [] : [['Senha', `ninguém daqui escolhe: o link de "Esqueci a senha" vai para ${email}`] as [string, string]]),
    ['Prazo', `${e.suporte?.expiraEm ? (e.suporte.expiraEm > agora ? `vale até ${dataHora(e.suporte.expiraEm)}` : `venceu em ${dataHora(e.suporte.expiraEm)}`) + ' → ' : ''}até ${dataHora(ate)} (${horas} h)`],
    ['Modo', `${e.suporte && e.suporte.edicao !== edicao ? `${e.suporte.edicao ? 'edição' : 'só leitura'} → ` : ''}${edicao
      ? 'EDIÇÃO — arruma produto, preço, estoque, catálogo, Configurações, convites, encomendas; nunca vende, nem caixa, dinheiro ou Assinatura'
      : 'só leitura (para editar, rode com --edicao)'}`],
    ['Livro', 'cada tela aberta vira linha no livro da loja; cada mudança sai assinada "Equipe Norte (nome)"'],
    ['Motivo', `"${motivo}" — a loja lê isto em cada linha do livro`],
  ])
  if (org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') {
    console.log('  Atenção: a empresa está ' + org.situacao.toLowerCase() + ' — o login recusa todo mundo, suporte inclusive.\n')
  }

  const quem = confirmar ? operador() : null
  if (!(await porta(org.slug))) return
  const r = await op.concederSuporte(
    org.id,
    { email, nome: texto('nome'), horas, motivo, quem: quem!, edicao },
    { dominioDaEquipe: dominio },
  )
  console.log(`  Feito. Acesso de suporte (${r.edicao ? 'edição' : 'só leitura'}) até ${dataHora(r.expiraEm)}.${r.criouConta ? ' A conta foi criada.' : ''}`)
  if (r.sessoesCortadas) console.log('  O prazo encurtou: as sessões abertas desta conta foram cortadas.')
  console.log(`\n  Como entrar: ${enderecoDeEntrada(org.slug)} — com o e-mail ${email} e a SENHA DA PRÓPRIA PESSOA.`)
  if (!r.temSenha) console.log(await linkDeSenha(org.id, org.slug, email))
  console.log('')
}

/**
 * A conta de suporte nasce sem senha, e ninguém daqui escolhe a senha de
 * ninguém. O caminho é o "Esqueci a senha" de qualquer pessoa
 * (src/servidor/conta.ts): o link de uso único vai para a CAIXA DE E-MAIL de
 * quem vai entrar — ele não aparece aqui, não passa pelo terminal nem pelo
 * histórico. Sem e-mail configurado neste ambiente, a pessoa pede ela mesma
 * pela tela, onde o e-mail funcionar.
 */
async function linkDeSenha(orgId: string, slug: string, email: string): Promise<string> {
  const pelaTela =
    `  Quem vai entrar abre ${enderecoDeEntrada(slug)}, clica em "Esqueci a senha" e informa\n` +
    `  ${email}: o link para definir a senha chega nesse e-mail.`
  const base = basePublica()
  if (!base) return `  A conta ainda não tem senha, e não sei o endereço público (NORTE_URL em ${arquivo}).\n${pelaTela}`
  const { enviarLinkDeSenha, VALE_SENHA_MIN } = await import('../src/servidor/conta')
  const desfecho = await enviarLinkDeSenha(orgId, email, base, null)
  if (desfecho === 'enviado') {
    return `  A conta ainda não tem senha: o link para definir a senha foi para ${email} (vale ${VALE_SENHA_MIN} min, uma vez só).`
  }
  if (desfecho === 'nao_configurado') {
    return (
      `  A conta ainda não tem senha, e este ambiente não manda e-mail (${arquivo} sem a chave de e-mail):\n` +
      '  o link não tem como chegar daqui. Onde o e-mail estiver ligado:\n' +
      pelaTela
    )
  }
  return `  A conta ainda não tem senha, e o e-mail com o link não saiu agora.\n${pelaTela}`
}

async function suporteRevogar() {
  const [slug] = resto
  const email = op.validarEmail(texto('email'))
  const motivo = texto('motivo')
  const org = await empresaDo(slug)
  const e = await op.estadoDoSuporte(org.id, email)
  const agora = new Date()
  const vale = e.suporte && (e.suporte.expiraEm === null || e.suporte.expiraEm > agora)
  if (!e.usuario || !e.suporte) parar(`Não há acesso de suporte para ${email} em /${org.slug}.`)
  if (!vale) parar(`O acesso de suporte de ${email} em /${org.slug} já venceu (${dataHora(e.suporte.expiraEm!)}). Nada a fazer.`)

  titulo(`Encerrar o acesso de suporte em /${org.slug}`)
  resumo([
    ['Empresa', `${org.nome} (${org.situacao.toLowerCase()})`],
    ['Conta', email],
    ['Prazo', `${e.suporte.expiraEm ? `vale até ${dataHora(e.suporte.expiraEm)}` : 'sem prazo (!)'} → agora`],
    ['Sessões', 'as abertas são cortadas na próxima tela'],
  ])

  const quem = confirmar ? operador() : null
  if (!(await porta(org.slug))) return
  await op.revogarSuporte(org.id, { email, quem: quem!, motivo })
  console.log('  Feito. O acesso de suporte terminou agora.\n')
}

async function situacao() {
  const [slug, paraBruto] = resto
  const para = (paraBruto ?? '').toUpperCase() as (typeof op.SITUACOES_DA_EQUIPE)[number]
  if (!op.SITUACOES_DA_EQUIPE.includes(para)) parar(`Diga a situação: ${op.SITUACOES_DA_EQUIPE.join(', ')}.`)
  const motivo = op.validarMotivo(texto('motivo'))
  const org = await empresaDo(slug)
  if (org.situacao === para) parar(`/${org.slug} já está ${para.toLowerCase()}.`)
  const trava = para === 'SUSPENSA' || para === 'CANCELADA'

  titulo(`Situação de /${org.slug}`)
  resumo([
    ['Empresa', org.nome],
    ['Situação', `${org.situacao.toLowerCase()} → ${para.toLowerCase()}`],
    ['Efeito', trava
      ? 'login recusado ("acesso suspenso"), sessões abertas cortadas, assistente e campanhas param, crédito do mês não cai'
      : 'o login volta a funcionar; o assistente e as campanhas voltam a mandar mensagem'],
    ['Motivo', `"${motivo}" — vai para o livro da loja`],
  ])

  const quem = confirmar ? operador() : null
  if (!(await porta(org.slug))) return
  const r = await op.mudarSituacao(org.id, para, { motivo, quem: quem! })
  console.log(
    `  Feito. /${org.slug}: ${r.de.toLowerCase()} → ${r.para.toLowerCase()}` +
      (trava ? `; ${r.sessoesCortadas} conta(s) com a sessão cortada.` : '.') + '\n',
  )
}

/** Liga ou desliga um módulo vendido à parte (fábrica, Farol): o mesmo da tela do console. */
async function modulo() {
  const [slug, qual, acao] = resto
  if (!slug || !qual || !['ligar', 'desligar'].includes(acao ?? '')) {
    parar('Uso: operacao modulo <empresa> <fabrica|farol> <ligar|desligar> --motivo "..." [--confirmar]')
  }
  const motivo = op.validarMotivo(texto('motivo'))
  const org = await empresaDo(slug)
  const ligar = acao === 'ligar'
  const ligado = org.modulos.includes(qual!)

  titulo(`Módulo ${qual} de /${org.slug}`)
  resumo([
    ['Empresa', `${org.nome} (${org.situacao.toLowerCase()})`],
    ['Módulo', `${qual}: ${ligado ? 'ligado' : 'desligado'} → ${ligar ? 'ligado' : 'desligado'}`],
    ['Motivo', `"${motivo}" — vai para o livro da loja`],
  ])
  if (ligado === ligar) parar(`/${org.slug} já está com ${qual} ${ligar ? 'ligado' : 'desligado'}.`)

  const quem = confirmar ? operador() : null
  if (!(await porta(org.slug))) return
  const r = await op.definirModuloDaEquipe(org.id, qual as never, ligar, { motivo, quem: quem! })
  console.log(`  Feito. /${org.slug}: módulos agora: ${r.modulos.join(', ') || '(nenhum)'}. No livro da loja: ${quem}.
`)
}

async function farolMarcas() {
  const [slug, quantasBruto] = resto
  const quantas = Number(quantasBruto)
  if (!quantasBruto || !Number.isInteger(quantas) || quantas < 1 || quantas > op.FAROL_MARCAS_MAX) {
    parar(`Diga quantas marcas do Farol a empresa contratou: um número de 1 a ${op.FAROL_MARCAS_MAX}.`)
  }
  const motivo = op.validarMotivo(texto('motivo'))
  const org = await empresaDo(slug)
  const { contratadas: agora, ativas } = await op.marcasDoFarol(org.id)
  const ligado = org.modulos.includes('farol')

  titulo(`Marcas do Farol de /${org.slug}`)
  resumo([
    ['Empresa', `${org.nome} (${org.situacao.toLowerCase()})`],
    ['Marcas', `${agora} → ${quantas} (ativas no Farol hoje: ${ativas})`],
    ['Na conta', ligado
      ? `${mostrar(Math.round(precoDoFarol(agora) * 100))} → ${mostrar(Math.round(precoDoFarol(quantas) * 100))} por mês`
      : 'o módulo Farol está desligado: não entra na conta até ligar'],
    ['Motivo', `"${motivo}" — vai para o livro da loja`],
  ])
  if (agora === quantas) parar(`/${org.slug} já tem ${quantas} marca(s) do Farol contratada(s).`)
  if (ativas > quantas) {
    console.log(`  Atenção: há ${ativas} marcas ativas e o contrato passa a ${quantas}. A loja precisa desativar as que sobram.
`)
  }

  const quem = confirmar ? operador() : null
  if (!(await porta(org.slug))) return
  const r = await op.definirMarcasDoFarol(org.id, quantas, { motivo, quem: quem! })
  console.log(`  Feito. /${org.slug}: ${r.de} → ${r.para} marca(s) do Farol. No livro da loja: ${quem}.
`)
}

function ajuda() {
  console.log(`
  Operação do Norte — rode do laptop, nunca de um servidor.

    npm run operacao -- empresas
    npm run operacao -- pedidos
    npm run operacao -- plano    <endereço> <PLANO>
    npm run operacao -- respostas <endereço> --motivo "..." [--sem-pedido]
    npm run operacao -- credito  <endereço> <reais> --motivo "..." [--tipo COMPRA|AJUSTE] [--sem-pedido]
    npm run operacao -- recusar  <endereço> plano|respostas|credito --motivo "..."
    npm run operacao -- suporte-conceder <endereço> --email <e-mail> --horas <1..72> --motivo "..." [--edicao] [--nome "..."]
                        (o mesmo que "suporte"; sem --edicao é só leitura)
    npm run operacao -- suporte-revogar <endereço> --email <e-mail> [--motivo "..."]
    npm run operacao -- situacao <endereço> ATIVA|SUSPENSA|CANCELADA --motivo "..."
    npm run operacao -- farol-marcas <endereço> <quantas> --motivo "..."

  O que muda dado só mostra o resumo, a não ser com --confirmar.
  --quem "Seu nome" (ou NORTE_OPERADOR no .env) assina no livro da loja.
  --producao lê .env.producao; lá, além do --confirmar, você digita o endereço.
`)
}

// ─────────────────────────────────────────────────────────────

const COMANDOS: Record<string, () => Promise<void> | void> = {
  empresas,
  pedidos,
  plano,
  respostas,
  credito,
  recusar,
  suporte,
  'suporte-conceder': suporte,
  'suporte-revogar': suporteRevogar,
  situacao,
  'farol-marcas': farolMarcas,
  modulo,
  ajuda,
}

let codigo = 0
try {
  const fazer = COMANDOS[comando ?? 'ajuda']
  if (!fazer) {
    ajuda()
    parar(`Comando "${comando}" não existe.`)
  }
  await fazer()
} catch (e) {
  codigo = 1
  if (e instanceof Parada) console.error(`\n  ${e.message}\n`)
  else if (e instanceof Error && !('code' in e) && !e.name.startsWith('Prisma')) console.error(`\n  ${e.message}\n`)
  else console.error('\n  Erro inesperado:', e instanceof Error ? e.message : inspect(e), '\n')
} finally {
  await fechar()
  await admin?.$disconnect()
}
process.exit(codigo)
