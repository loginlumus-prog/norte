// O Farol: o direcionamento digital da empresa, por marca.
//
// ── o que ele faz, e o que NÃO faz ───────────────────────────
// Escreve: o diagnóstico da marca, o calendário do mês, roteiro de Reels,
// carrossel, legenda, comentários para a pessoa fazer em conteúdo do nicho,
// o roteiro de uma campanha no WhatsApp e o texto de anúncio. Tudo nasce
// RASCUNHO; quem edita, aprova e publica é gente.
//
// Não publica sozinho e não comenta sozinho no perfil dos outros. Instagram e
// TikTok proíbem automação de comentário em conteúdo alheio e derrubam o
// perfil que faz — seria o perfil do cliente a cair, e por nossa causa. O
// Farol escreve o comentário e diz onde vale comentar; a pessoa comenta.
//
// ── o que a IA sabe ──────────────────────────────────────────
// A ficha da marca (o que ela é, para quem fala, o tom) e o negócio em
// NÚMEROS AGREGADOS: o que mais vende, o ticket médio, o dia e a hora que
// lotam, as lojas e os bairros. Nunca nome, telefone ou compra de cliente:
// isso não é necessário para escrever um Reels, e sai do nosso servidor para
// o fornecedor da IA.
//
// ── quanto custa ─────────────────────────────────────────────
// Cada peça sai da carteira de crédito da empresa — a MESMA do assistente
// (custo-ia.ts: custo do fornecedor × margem). Cada marca CONTRATADA deposita
// `PRECOS.creditoDoFarol` por mês (`garantirCreditoDoFarol`). Acabou o
// crédito, o Farol para de escrever até recarregar; o resto do sistema segue.
//
// ── marcas contratadas ───────────────────────────────────────
// O Farol se vende por marca (`Org.farolMarcas`, que a equipe acerta pelo
// contrato). É o teto de marcas ativas, de crédito por mês e da linha do
// Farol na mensalidade. Antes a marca era livre: contratava uma, cadastrava
// cinco, e recebia o crédito de IA de cinco — na mesma carteira do assistente.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import { perguntar, temChaveIA } from './ia'
import { registrarConsumo } from './agente'
import { PRECOS } from './planos'
import { diaEmSP } from './dia'
import { moduloLigado } from './modulos'
import type { TipoPecaFarol, SituacaoPecaFarol } from '@prisma/client'

export class FarolRecusou extends Error {}

/** O modelo que escreve. O mesmo do assistente: texto bom em português, custo medido. */
export const MODELO_DO_FAROL = 'claude-sonnet-5'

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const limpo = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null

// ─────────────────────────────────────────────────────────────
// A MARCA
// ─────────────────────────────────────────────────────────────

export type DadosDaMarca = {
  nome: string
  nicho?: string | null
  cidade?: string | null
  instagram?: string | null
  tiktok?: string | null
  publico?: string | null
  tom?: string | null
  diferenciais?: string | null
  objetivos?: string | null
  unidadeIds?: string[]
}

async function exigirFarol(db: BancoDaOrg, orgId: string): Promise<{ contratadas: number }> {
  const org = await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { modulos: true, farolMarcas: true } })
  if (!moduloLigado(org, 'farol')) throw new FarolRecusou('O Farol não está contratado nesta empresa. Fale com a gente para ligar.')
  return { contratadas: Math.max(0, org.farolMarcas) }
}

/** As marcas contratadas desta empresa: zero sem o módulo. */
export const marcasContratadas = (org: { modulos: string[]; farolMarcas: number }) =>
  moduloLigado(org, 'farol') ? Math.max(0, org.farolMarcas) : 0

export async function listarMarcas(sessao: Sessao) {
  exigir(sessao, 'agente.configurar')
  return comoOrg(sessao.orgId, (db) =>
    db.marcaFarol.findMany({
      where: { ativa: true },
      orderBy: { criadaEm: 'asc' },
      select: {
        id: true, nome: true, nicho: true, cidade: true, instagram: true, tiktok: true, publico: true, tom: true,
        diferenciais: true, objetivos: true, unidadeIds: true, criadaEm: true,
        _count: { select: { pecas: true } },
      },
    }),
  )
}

export async function salvarMarca(sessao: Sessao, id: string | null, d: DadosDaMarca): Promise<{ id: string }> {
  exigir(sessao, 'agente.configurar')
  const nome = limpo(d.nome, 80)
  if (!nome || nome.length < 2) throw new FarolRecusou('Dê o nome da marca (como aparece no perfil).')
  const dados = {
    nome,
    nicho: limpo(d.nicho, 120),
    cidade: limpo(d.cidade, 120),
    instagram: limpo(d.instagram, 80)?.replace(/^@/, '') ?? null,
    tiktok: limpo(d.tiktok, 80)?.replace(/^@/, '') ?? null,
    publico: limpo(d.publico, 600),
    tom: limpo(d.tom, 300),
    diferenciais: limpo(d.diferenciais, 600),
    objetivos: limpo(d.objetivos, 600),
    unidadeIds: [...new Set((d.unidadeIds ?? []).map(String))].slice(0, 100),
  }
  return comoOrg(sessao.orgId, async (db) => {
    const { contratadas } = await exigirFarol(db, sessao.orgId)
    if (!id) {
      // A trava por empresa: dois cliques em "Criar" não passam os dois
      // pela contagem antes de um gravar.
      await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`farol:marcas:${sessao.orgId}`}))`
      const ativas = await db.marcaFarol.count({ where: { ativa: true } })
      if (ativas >= contratadas) {
        throw new FarolRecusou(
          `O contrato do Farol é de ${contratadas === 1 ? '1 marca' : `${contratadas} marcas`}, e ${ativas === 1 ? 'ela já está cadastrada' : 'elas já estão cadastradas'}. ` +
            'Para mais uma, fale com a gente — ou arquive uma que não usa mais.',
        )
      }
    }
    if (dados.unidadeIds.length) {
      const achadas = await db.unidade.count({ where: { id: { in: dados.unidadeIds } } })
      if (achadas !== dados.unidadeIds.length) throw new FarolRecusou('Loja não encontrada nesta empresa.')
    }
    const marca = id
      ? await db.marcaFarol.update({ where: { id }, data: dados, select: { id: true } })
      : await db.marcaFarol.create({ data: { orgId: sessao.orgId, ...dados }, select: { id: true } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome,
        acao: id ? 'farol.marca.alterou' : 'farol.marca.criou', alvoTipo: 'marca', alvoId: marca.id, alvoNome: nome,
      },
    })
    return marca
  })
}

export async function arquivarMarca(sessao: Sessao, id: string) {
  exigir(sessao, 'agente.configurar')
  await comoOrg(sessao.orgId, async (db) => {
    const r = await db.marcaFarol.updateMany({ where: { id, ativa: true }, data: { ativa: false } })
    if (r.count === 0) throw new FarolRecusou('Marca não encontrada.')
    await db.auditoria.create({
      data: { orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome, acao: 'farol.marca.arquivou', alvoTipo: 'marca', alvoId: id },
    })
  })
}

// ─────────────────────────────────────────────────────────────
// O CRÉDITO DO MÊS
// ─────────────────────────────────────────────────────────────

/**
 * Deposita o crédito do Farol do mês, uma vez: `PRECOS.creditoDoFarol` por
 * marca ativa, até as contratadas. A trava e a referência `farol:AAAA-MM` são as mesmas do
 * crédito do plano (assinatura.ts): duas chamadas ao mesmo tempo não depositam
 * duas vezes. Marca criada no meio do mês entra no mês seguinte.
 */
export async function garantirCreditoDoFarol(orgId: string, agora = new Date()): Promise<number> {
  const mes = diaEmSP(agora).slice(0, 7)
  const referencia = `farol:${mes}`
  return comoOrg(orgId, async (db) => {
    await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`credito-farol:${orgId}`}))`
    const org = await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { modulos: true, situacao: true, farolMarcas: true } })
    if (!moduloLigado(org, 'farol') || org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA') return 0
    if (await db.recargaIA.findFirst({ where: { tipo: 'PLANO', referencia }, select: { id: true } })) return 0
    // As ativas, até o contratado: marca a mais (de antes da trava, ou
    // gravada à mão) não traz crédito que ninguém paga.
    const marcas = Math.min(await db.marcaFarol.count({ where: { ativa: true } }), marcasContratadas(org))
    if (marcas === 0) return 0
    const centavos = marcas * PRECOS.creditoDoFarol * 100
    const depois = await db.org.update({ where: { id: orgId }, data: { creditoIaCent: { increment: centavos } }, select: { creditoIaCent: true } })
    const [ano, m] = mes.split('-')
    await db.recargaIA.create({
      data: {
        orgId, centavos, saldoDepois: depois.creditoIaCent, tipo: 'PLANO', origem: 'farol', referencia,
        motivo: `Crédito do Farol (${marcas} ${marcas === 1 ? 'marca' : 'marcas'}) — ${m}/${ano}`, quem: 'Norte',
      },
    })
    return centavos
  })
}

// ─────────────────────────────────────────────────────────────
// O QUE A IA SABE DO NEGÓCIO — só agregados
// ─────────────────────────────────────────────────────────────

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** O retrato do negócio dos últimos 60 dias, em números. Sem cliente nenhum. */
export async function retratoDoNegocio(db: BancoDaOrg, unidadeIds: string[]): Promise<string> {
  const desde = new Date(Date.now() - 60 * 864e5)
  const lojas = await db.unidade.findMany({
    where: { ativa: true, ehDeposito: false, ...(unidadeIds.length ? { id: { in: unidadeIds } } : {}) },
    select: { id: true, nome: true, bairro: true, cidade: true, horario: true, ramo: true },
  })
  const ids = lojas.map((l) => l.id)
  if (ids.length === 0) return 'Sem lojas abertas cadastradas.'
  const top = await db.$queryRaw<{ nome: string; q: string; total: string }[]>`
    select i.descricao nome, sum(i.quantidade) q, sum(i.total) total
      from venda_itens i join vendas v on v.id = i.venda_id
     where v.situacao = 'CONCLUIDA' and v.criada_em >= ${desde} and v.unidade_id = any(${ids})
     group by 1 order by 3 desc limit 12`
  const [r] = await db.$queryRaw<{ vendas: number; total: string }[]>`
    select count(*)::int vendas, coalesce(sum(total), 0) total from vendas
     where situacao = 'CONCLUIDA' and criada_em >= ${desde} and unidade_id = any(${ids})`
  const picos = await db.$queryRaw<{ dow: number; hora: number; n: number }[]>`
    select extract(dow from criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::int dow,
           extract(hour from criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo')::int hora,
           count(*)::int n
      from vendas where situacao = 'CONCLUIDA' and criada_em >= ${desde} and unidade_id = any(${ids})
     group by 1, 2 order by 3 desc limit 4`
  const categorias = await db.categoria.findMany({ orderBy: { ordem: 'asc' }, select: { nome: true }, take: 20 })
  const vendas = r?.vendas ?? 0
  const ticket = vendas ? n(r?.total) / vendas : 0
  const reais = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
  return [
    `Lojas (${lojas.length}): ${lojas.map((l) => [l.nome, l.bairro, l.cidade].filter(Boolean).join(', ') + (l.horario ? ` — ${l.horario}` : '')).join('; ')}.`,
    `Gavetas do catálogo: ${categorias.map((c) => c.nome).join(', ') || '—'}.`,
    vendas
      ? `Últimos 60 dias: ${vendas} vendas, ticket médio ${reais(ticket)}.`
      : 'Ainda sem vendas registradas no sistema (empresa começando a usar).',
    top.length ? `O que mais vende (por faturamento): ${top.map((t) => `${t.nome} (${Math.round(n(t.q))})`).join(', ')}.` : '',
    picos.length ? `Horários de mais movimento: ${picos.map((p) => `${DIAS[p.dow]} às ${p.hora}h`).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// ─────────────────────────────────────────────────────────────
// AS PEÇAS
// ─────────────────────────────────────────────────────────────

export const TIPOS: Record<TipoPecaFarol, { titulo: string; resumo: string; instrucao: string; maxTokens: number }> = {
  DIAGNOSTICO: {
    titulo: 'Diagnóstico da marca',
    resumo: 'Posicionamento, público, pilares de conteúdo, frequência e o que medir.',
    maxTokens: 2500,
    instrucao: `Escreva o DIAGNÓSTICO DIGITAL desta marca, prático e específico para o nicho e a cidade dela:
1. Posicionamento em uma frase, e o que a diferencia dos concorrentes típicos do nicho.
2. Público: 2 ou 3 perfis de cliente, com o que cada um procura e quando.
3. Pilares de conteúdo (4 ou 5), cada um com 3 ideias concretas de post.
4. Frequência realista por semana (Reels, carrossel, stories), pensando em quem toca a loja e grava pelo celular.
5. Ofertas e datas que funcionam no nicho (sazonalidade, datas comemorativas, clima).
6. O que medir toda semana (no máximo 4 números) e o que fazer se não melhorar.
Use os números do negócio quando ajudarem (o que mais vende, os horários de pico).`,
  },
  CALENDARIO: {
    titulo: 'Calendário do mês',
    resumo: '30 dias de conteúdo: formato, tema, gancho e chamada.',
    maxTokens: 3500,
    instrucao: `Monte o CALENDÁRIO DE CONTEÚDO dos próximos 30 dias como uma tabela em Markdown com as colunas: Dia | Formato (Reels, Carrossel, Story, Post) | Tema | Gancho (primeira frase ou primeiros 3 segundos) | Chamada para ação.
Distribua os formatos de um jeito que caiba na rotina de uma loja pequena (não precisa postar todo dia). Aproveite datas comemorativas e o clima do período, os produtos que mais vendem e os horários de pico. Depois da tabela, 3 dicas curtas para gravar com o celular.`,
  },
  ROTEIRO: {
    titulo: 'Roteiro de Reels',
    resumo: 'Gancho, cenas, falas, texto na tela, legenda e hashtags.',
    maxTokens: 1800,
    instrucao: `Escreva um ROTEIRO DE REELS de 15 a 40 segundos:
- Gancho dos 3 primeiros segundos (o que aparece e o que se fala).
- Cenas numeradas: o que filmar (com o celular, sem equipamento), a fala, e o texto na tela.
- Sugestão de áudio (tipo de música em alta, sem citar nome de faixa com direito autoral).
- A legenda pronta e de 5 a 10 hashtags (misture do nicho e da cidade).
Dê também uma variação do gancho para testar.`,
  },
  CARROSSEL: {
    titulo: 'Carrossel',
    resumo: 'De 6 a 10 telas com o texto de cada uma, e a legenda.',
    maxTokens: 1800,
    instrucao: `Escreva um CARROSSEL de 6 a 10 telas. Para cada tela: o título curto (o que vai grande) e o texto de apoio (no máximo 2 linhas), e uma sugestão do que mostrar de imagem (foto do produto, da loja, de alguém). A primeira tela tem de fazer a pessoa passar para a próxima; a última traz a chamada para ação. Depois, a legenda pronta e as hashtags.`,
  },
  LEGENDA: {
    titulo: 'Legendas',
    resumo: 'Três opções de legenda com hashtags, para um post.',
    maxTokens: 1200,
    instrucao: `Escreva TRÊS opções de legenda para o post pedido, cada uma com um jeito diferente (uma curta e direta, uma contando uma pequena história, uma com pergunta para gerar comentário). Cada uma com chamada para ação e de 5 a 10 hashtags.`,
  },
  COMENTARIOS: {
    titulo: 'Comentários para fazer',
    resumo: 'Onde comentar e 10 comentários prontos — você publica, o Farol não.',
    maxTokens: 1500,
    instrucao: `A marca quer aparecer comentando em conteúdo de outras pessoas do nicho e da cidade (perfis de bairro, criadores locais, posts de quem fala do assunto). Escreva:
1. Onde procurar: hashtags e tipos de perfil da cidade e do nicho que valem a pena (sem inventar perfis com @).
2. DEZ comentários prontos, genuínos e diferentes entre si, que acrescentam algo à conversa (nada de "visite nosso perfil", nada de spam). Cada um em uma linha, com o tipo de post em que ele cabe.
3. Uma regra de ouro curta: comentar como pessoa, poucos por dia, sempre à mão — o Instagram e o TikTok derrubam perfil que comenta por automação.`,
  },
  WHATSAPP: {
    titulo: 'Campanha no WhatsApp',
    resumo: 'Roteiro de mensagens curtas, com começo, meio e fim.',
    maxTokens: 1500,
    instrucao: `Escreva o ROTEIRO DE UMA CAMPANHA NO WHATSAPP para clientes que ACEITARAM receber ofertas: de 2 a 4 mensagens curtas (dia e horário sugeridos para cada uma), no tom da marca, com a oferta, o prazo e o que a pessoa responde para aproveitar. Toda mensagem termina lembrando que quem não quiser mais receber é só responder PARAR. Nada de pressão nem de promessa que a loja não cumpre.`,
  },
  ANUNCIO: {
    titulo: 'Anúncio (Facebook e Instagram)',
    resumo: 'Três versões de anúncio, público, orçamento e o que testar.',
    maxTokens: 1800,
    instrucao: `Escreva o ANÚNCIO para Facebook e Instagram:
- Três versões, cada uma com texto principal, título curto e botão de chamada.
- O público sugerido (região em km ao redor das lojas, idade, interesses).
- Um orçamento diário inicial realista para um pequeno negócio e por quantos dias rodar antes de decidir.
- O que testar entre as versões e o número que decide qual fica.`,
  },
}

function sistemaDoFarol(marca: Record<string, unknown>, retrato: string): string {
  const linha = (rotulo: string, v: unknown) => (v ? `${rotulo}: ${v}` : '')
  return [
    'Você é o Farol, o estrategista de marketing digital de pequenos negócios brasileiros dentro do sistema Norte.',
    'Escreva em português do Brasil, para o dono de uma loja pequena: claro, prático, sem jargão de agência, pronto para usar.',
    'Use Markdown simples (títulos curtos, listas, tabelas quando pedido). Não invente números, prêmios, depoimentos, perfis com @ nem promoções que a marca não citou.',
    'Nunca sugira comprar seguidores, automatizar comentários ou mensagens, nem nada que viole as regras do Instagram, do TikTok, do WhatsApp ou do Código de Defesa do Consumidor.',
    '',
    'A MARCA',
    linha('Nome', marca.nome),
    linha('Nicho', marca.nicho),
    linha('Cidade', marca.cidade),
    linha('Instagram', marca.instagram ? `@${marca.instagram}` : ''),
    linha('TikTok', marca.tiktok ? `@${marca.tiktok}` : ''),
    linha('Público', marca.publico),
    linha('Tom de voz', marca.tom),
    linha('Diferenciais', marca.diferenciais),
    linha('Objetivos', marca.objetivos),
    '',
    'O NEGÓCIO (números do sistema, sem dados de clientes)',
    retrato,
    '',
    `Hoje é ${diaEmSP(new Date())}.`,
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export type PecaGerada = { id: string; titulo: string; conteudo: string; custoCent: number }

/**
 * Escreve uma peça e guarda como rascunho, cobrando da carteira.
 *
 * A trava de saldo é a do assistente (crédito zerado = não escreve), mas sem
 * exigir o plano com assistente: o Farol é contratado à parte, por marca.
 */
export async function gerarPeca(
  sessao: Sessao,
  d: { marcaId: string; tipo: TipoPecaFarol; pedido?: string | null; para?: string | null },
): Promise<PecaGerada> {
  exigir(sessao, 'agente.configurar')
  const tipo = TIPOS[d.tipo]
  if (!tipo) throw new FarolRecusou('Tipo de conteúdo desconhecido.')
  if (!temChaveIA()) throw new FarolRecusou('A inteligência artificial não está ligada neste servidor.')
  if (d.para && !/^\d{4}-\d{2}-\d{2}$/.test(d.para)) throw new FarolRecusou('Data inválida.')
  const pedido = limpo(d.pedido, 800)

  await garantirCreditoDoFarol(sessao.orgId)
  const preparo = await comoOrg(sessao.orgId, async (db) => {
    await exigirFarol(db, sessao.orgId)
    const marca = await db.marcaFarol.findFirst({ where: { id: d.marcaId, ativa: true } })
    if (!marca) throw new FarolRecusou('Marca não encontrada.')
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { creditoIaCent: true, agenteNome: true, nome: true } })
    if (org.creditoIaCent <= 0) throw new FarolRecusou('O crédito de IA acabou. Recarregue em Assinatura para o Farol voltar a escrever.')
    // O consumo de IA é anotado no agente da empresa (a carteira é uma só).
    // Empresa só com o Farol ainda não tem agente: nasce um, desligado.
    const agente =
      (await db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { id: true } })) ??
      (await db.agente.create({ data: { orgId: sessao.orgId, nome: org.agenteNome ?? org.nome, ativo: false, canal: 'NENHUM' }, select: { id: true } }))
    const retrato = await retratoDoNegocio(db, marca.unidadeIds)
    return { marca, agenteId: agente.id, retrato }
  })

  const r = await perguntar({
    sistema: sistemaDoFarol(preparo.marca, preparo.retrato),
    mensagens: [{ papel: 'usuario', texto: `${tipo.instrucao}${pedido ? `\n\nO pedido da loja: ${pedido}` : ''}` }],
    modelo: MODELO_DO_FAROL,
    maxTokens: tipo.maxTokens,
    timeoutMs: 120_000,
  })
  const { cobradoCent } = await registrarConsumo(sessao.orgId, preparo.agenteId, MODELO_DO_FAROL, r.entrada, r.saida)

  const titulo = `${tipo.titulo}${pedido ? ` — ${pedido.slice(0, 60)}${pedido.length > 60 ? '…' : ''}` : ''}`
  const peca = await comoOrg(sessao.orgId, async (db) => {
    const p = await db.pecaFarol.create({
      data: {
        orgId: sessao.orgId, marcaId: d.marcaId, tipo: d.tipo, titulo, pedido, conteudo: r.texto,
        para: d.para ? new Date(`${d.para}T12:00:00Z`) : null, custoCent: cobradoCent, quem: sessao.nome, usuarioId: sessao.usuarioId,
      },
      select: { id: true },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId, usuarioId: sessao.usuarioId, quem: sessao.nome, autor: 'AGENTE',
        acao: 'farol.peca.gerou', alvoTipo: 'peca', alvoId: p.id, alvoNome: titulo, valor: cobradoCent / 100,
      },
    })
    return p
  })
  return { id: peca.id, titulo, conteudo: r.texto, custoCent: cobradoCent }
}

export async function listarPecas(sessao: Sessao, marcaId: string, filtro: { tipo?: TipoPecaFarol; limite?: number } = {}) {
  exigir(sessao, 'agente.configurar')
  return comoOrg(sessao.orgId, (db) =>
    db.pecaFarol.findMany({
      where: { marcaId, situacao: { not: 'ARQUIVADA' }, ...(filtro.tipo ? { tipo: filtro.tipo } : {}) },
      orderBy: { criadaEm: 'desc' },
      take: filtro.limite ?? 60,
      select: { id: true, tipo: true, titulo: true, pedido: true, conteudo: true, situacao: true, para: true, custoCent: true, quem: true, criadaEm: true },
    }),
  )
}

export async function atualizarPeca(
  sessao: Sessao,
  id: string,
  d: { conteudo?: string; situacao?: SituacaoPecaFarol; para?: string | null; titulo?: string },
) {
  exigir(sessao, 'agente.configurar')
  if (d.para && !/^\d{4}-\d{2}-\d{2}$/.test(d.para)) throw new FarolRecusou('Data inválida.')
  await comoOrg(sessao.orgId, async (db) => {
    const r = await db.pecaFarol.updateMany({
      where: { id },
      data: {
        ...(d.conteudo !== undefined ? { conteudo: String(d.conteudo).slice(0, 40_000) } : {}),
        ...(d.titulo !== undefined ? { titulo: limpo(d.titulo, 160) ?? 'Sem título' } : {}),
        ...(d.situacao ? { situacao: d.situacao } : {}),
        ...(d.para !== undefined ? { para: d.para ? new Date(`${d.para}T12:00:00Z`) : null } : {}),
      },
    })
    if (r.count === 0) throw new FarolRecusou('Conteúdo não encontrado.')
  })
}
