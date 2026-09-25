// Ofertas no WhatsApp: quem aceitou, quem pediu para sair, e a pergunta única
// que toda mensagem de oferta COMEÇADA pela loja faz antes de sair.
//
// ── duas coisas diferentes, guardadas em dois lugares ────────
//   • o CONSENTIMENTO mora na ficha do cliente (`Cliente.ofertas*`): o que a
//     pessoa disse, quando, por qual caminho e quem da loja anotou. Só existe
//     para quem é cadastrado — e é a prova que a LGPD pede à loja (art. 8º,
//     § 2º);
//   • a SAÍDA mora na lista da empresa (`OptOutWhatsapp`), pela chave do
//     telefone: vale para quem é cadastrado e para quem nunca foi. É ela que
//     o "PARAR" grava, e é ela que impede qualquer campanha de começar.
//
// A regra que junta as duas é `podeReceberOfertas`: SIM na ficha E fora da
// lista. Na dúvida (duas fichas com o mesmo número, uma dizendo não), não.
//
// ── PARAR e VOLTAR ───────────────────────────────────────────
// "PARAR" sozinho numa mensagem grava a saída para SEMPRE — não só encerra a
// campanha em andamento — e manda UMA confirmação, que já diz como voltar.
// Quem está na lista não entra em campanha nenhuma, nem mandando a
// palavra-chave de novo: a palavra-chave pode estar num cartaz, num anúncio,
// numa mensagem encaminhada, e "mandou a palavra" não prova que a pessoa
// mudou de ideia. O caminho de volta é UM, explícito e dito na confirmação:
// mandar VOLTAR. Aí a saída some e o aceite fica gravado, pelo WhatsApp, com
// data e hora.
//
// E só a PESSOA desfaz o que a pessoa fez: a saída por "PARAR" (e a da
// anonimização) não se tira pela tela. A loja tira o que a loja anotou (o
// número que ela pôs na lista à mão, a ficha que ela marcou "não aceita").
//
// ── o que é "oferta começada pela loja" ──────────────────────
// A campanha que a PRÓPRIA pessoa abre (mandou a palavra-chave, clicou no
// anúncio) é resposta a um pedido dela: conversa de atendimento, dentro da
// janela de 24 horas. Não pede consentimento — pede só que ela não esteja na
// lista. O que pede consentimento é a mensagem que sai SEM a pessoa ter
// escrito agora: no WhatsApp oficial, o MODELO que sai fora da janela. Esse
// passa por `podeReceberOfertas` (ver campanhas/execucao.ts). Qualquer
// recurso futuro que dispare oferta por conta própria (lista de transmissão,
// aniversário, "cliente sumido" para o cliente) chama a mesma função.

import type { ConsentimentoOfertas } from '@prisma/client'
import { comoOrg, type BancoDaOrg } from './banco'
import { chaveTelefone } from './assistente/telefone'
import { normalizar } from './campanhas/casar'
import { STATUS_VIVOS } from './campanhas/tipos'
import { exigir, type Sessao } from './permissao'

// ─────────────────────────────────────────────────────────────
// OS TEXTOS
// ─────────────────────────────────────────────────────────────

/**
 * A versão do texto do aceite. Vai no livro junto de cada aceite: se o texto
 * mudar, o aceite antigo vale para o que ele dizia, não para o novo. Mudou o
 * texto abaixo, sobe a versão.
 */
export const VERSAO_TEXTO_OFERTAS = 'v1'

/**
 * O que o atendente pergunta — o texto-modelo de docs/juridico/
 * consentimento-ofertas.md, com os quatro pontos: quem (a loja), onde (o
 * WhatsApp), o quê (ofertas e novidades) e como sair (PARAR).
 */
export const perguntaDoAceite = (loja: string) =>
  `Quer receber as ofertas e novidades da ${loja} no seu WhatsApp? Para sair é só responder PARAR.`

/** O que fica marcado na ficha quando a resposta é sim. */
export const textoDoAceite = (loja: string) =>
  `Aceitou receber ofertas e novidades da ${loja} no WhatsApp, no número desta ficha, e sabe que pode parar a qualquer momento respondendo PARAR.`

/** A única mensagem que sai depois do "PARAR". */
export const RECADO_SAIU = 'Pronto, você não recebe mais ofertas por aqui. Se quiser voltar, é só mandar VOLTAR.'
/** A única mensagem que sai depois do "VOLTAR". */
export const RECADO_VOLTOU = 'Pronto, você voltou a receber as ofertas por aqui. Para parar, é só mandar PARAR.'

/** Por onde a pessoa aceitou (ou recusou). */
export const ORIGENS_ACEITE = {
  balcao: 'no balcão, de viva voz',
  ficha: 'na ficha em papel, assinada',
  site: 'no site ou formulário da loja',
  whatsapp: 'pelo WhatsApp',
  telefone: 'por telefone',
} as const
export type OrigemAceite = keyof typeof ORIGENS_ACEITE
export const ehOrigemAceite = (v: unknown): v is OrigemAceite => typeof v === 'string' && v in ORIGENS_ACEITE

/** Por que o número está na lista de quem não recebe. */
export const ORIGENS_SAIDA = {
  parar: 'mandou PARAR no WhatsApp',
  manual: 'a loja anotou o número',
  cliente: 'a ficha foi marcada "não aceita"',
  anonimizado: 'o cadastro foi anonimizado',
} as const
export type OrigemSaida = keyof typeof ORIGENS_SAIDA

/** Saídas que só a própria pessoa desfaz (mandando VOLTAR). */
export const SO_A_PESSOA_TIRA: readonly OrigemSaida[] = ['parar', 'anonimizado']

/**
 * A chave mascarada: "(71) ····-1234". A chave não tem o nono dígito (ver
 * telefone.ts), então a máscara mostra só o DDD e os quatro últimos — o
 * bastante para a loja reconhecer de quem se trata, pouco para virar agenda.
 */
export function mascararChave(chave: string): string {
  return `(${chave.slice(0, 2)}) ····-${chave.slice(-4)}`
}

/** Quem anotou, quando foi a própria pessoa pelo WhatsApp. */
export const PELO_PROPRIO_CLIENTE = 'o próprio cliente, pelo WhatsApp'

// ─────────────────────────────────────────────────────────────
// AS PALAVRAS
// ─────────────────────────────────────────────────────────────

/**
 * As palavras de parada que valem MESMO SEM campanha em andamento. "Cancelar"
 * e "não quero" ficam de fora: sozinhos, sem roteiro nenhum no meio, são
 * quase sempre sobre outra coisa ("cancelar" a encomenda) — e a equipe está
 * lendo a conversa. Dentro de uma campanha, todas as de
 * `PALAVRAS_DE_PARADA` (campanhas/casar.ts) valem.
 */
export const PARADAS_INEQUIVOCAS = ['parar', 'pare', 'sair', 'stop', 'descadastrar'] as const

export const ehParadaInequivoca = (texto: string): boolean =>
  (PARADAS_INEQUIVOCAS as readonly string[]).includes(normalizar(texto))

/** "VOLTAR", sozinho numa mensagem. */
export const ehPedidoDeVolta = (texto: string): boolean => normalizar(texto) === 'voltar'

// ─────────────────────────────────────────────────────────────
// A REGRA
// ─────────────────────────────────────────────────────────────

/**
 * A regra inteira, sem banco. `consentimentos` = o de cada ficha com este
 * telefone (normalmente uma; duas é cadastro repetido).
 *
 * Fora da lista, com algum SIM e nenhum NÃO. Ficha nenhuma = ninguém aceitou.
 */
export function podeReceberOfertasCom(p: { naLista: boolean; consentimentos: ConsentimentoOfertas[] }): boolean {
  if (p.naLista) return false
  return p.consentimentos.includes('SIM') && !p.consentimentos.includes('NAO')
}

/** As fichas com este telefone (pela chave), ativas ou não — mas não as anonimizadas. */
export async function fichasDoTelefone(
  db: BancoDaOrg,
  chave: string,
): Promise<{ id: string; nome: string; ofertas: ConsentimentoOfertas }[]> {
  // O filtro grosso no banco (termina com os 8 dígitos), o fino aqui — o
  // mesmo de acharInterlocutor.
  const linhas = await db.$queryRaw<{ id: string; nome: string; telefone: string; ofertas: ConsentimentoOfertas }[]>`
    select id, nome, telefone, ofertas_whatsapp::text as ofertas from clientes
     where telefone is not null and anonimizado_em is null
       and regexp_replace(telefone, '\\D', '', 'g') like ${'%' + chave.slice(-8)}
     limit 20
  `
  return linhas.filter((l) => chaveTelefone(l.telefone) === chave).map(({ id, nome, ofertas }) => ({ id, nome, ofertas }))
}

/**
 * A PERGUNTA. Toda mensagem de oferta que a loja começa — sem a pessoa ter
 * acabado de escrever — passa por aqui antes de sair.
 *
 * Abre o próprio `comoOrg`: não chame de dentro de outro.
 */
export async function podeReceberOfertas(orgId: string, telefone: string): Promise<boolean> {
  const chave = chaveTelefone(telefone)
  if (!chave) return false
  return comoOrg(orgId, async (db) => {
    const naLista = (await db.optOutWhatsapp.findUnique({ where: { orgId_telefone: { orgId, telefone: chave } }, select: { id: true } })) !== null
    if (naLista) return false
    const fichas = await fichasDoTelefone(db, chave)
    return podeReceberOfertasCom({ naLista, consentimentos: fichas.map((f) => f.ofertas) })
  })
}

/** Este telefone está na lista de quem não recebe? (a chave já calculada) */
export async function estaNaLista(orgId: string, chave: string): Promise<boolean> {
  const r = await comoOrg(orgId, (db) =>
    db.optOutWhatsapp.findUnique({ where: { orgId_telefone: { orgId, telefone: chave } }, select: { id: true } }),
  )
  return r !== null
}

// ─────────────────────────────────────────────────────────────
// GRAVAR E TIRAR (dentro da transação de quem chama)
// ─────────────────────────────────────────────────────────────

/**
 * Põe o número na lista, e tira ele de qualquer campanha viva — ninguém que
 * pediu para sair recebe o resto de um roteiro.
 *
 * Já estava na lista: a data e o motivo da primeira saída ficam (são a
 * prova), MENOS quando o motivo novo é mais forte. O que a loja anotou
 * ('manual', 'cliente') a loja pode tirar; o que a pessoa pediu ('parar') ou
 * a anonimização não. Se a loja marcou "não aceita" e depois a pessoa mandou
 * PARAR, a saída passa a ser da pessoa — senão a loja poderia tirar pela tela
 * um pedido que foi dela. `subiu` diz que isso aconteceu.
 *
 * Roda dentro do `comoOrg` de quem chama: é a mesma transação que grava a
 * ficha ou a linha do livro, e ou vai tudo, ou nada.
 */
export async function gravarSaida(
  db: BancoDaOrg,
  orgId: string,
  chave: string,
  origem: OrigemSaida,
  agora: Date,
): Promise<{ novo: boolean; subiu: boolean }> {
  const ja = await db.optOutWhatsapp.findUnique({ where: { orgId_telefone: { orgId, telefone: chave } }, select: { id: true, origem: true } })
  let subiu = false
  if (!ja) {
    // createMany + skipDuplicates: duas mensagens "PARAR" no mesmo segundo
    // não estouram o único — a segunda só não grava.
    await db.optOutWhatsapp.createMany({ data: [{ orgId, telefone: chave, origem, em: agora }], skipDuplicates: true })
  } else if (ehDaPessoa(origem) && !ehDaPessoa(ja.origem)) {
    await db.optOutWhatsapp.update({ where: { id: ja.id }, data: { origem, em: agora } })
    subiu = true
  }
  await db.campanhaExecucao.updateMany({
    where: { telefone: chave, teste: false, status: { in: [...STATUS_VIVOS] } },
    data: {
      status: 'cancelada',
      motivoFim: origem === 'parar' ? 'parou' : 'sem_ofertas',
      finalizadaEm: agora,
      proximoEm: null,
      trava: null,
      travaEm: null,
    },
  })
  return { novo: !ja, subiu }
}

const ehDaPessoa = (origem: string) => (SO_A_PESSOA_TIRA as readonly string[]).includes(origem)

/** Tira o número da lista. Devolve a origem que ele tinha, ou nula. */
export async function tirarSaida(db: BancoDaOrg, orgId: string, chave: string): Promise<OrigemSaida | null> {
  const ja = await db.optOutWhatsapp.findUnique({ where: { orgId_telefone: { orgId, telefone: chave } }, select: { id: true, origem: true } })
  if (!ja) return null
  await db.optOutWhatsapp.delete({ where: { id: ja.id } })
  return ja.origem as OrigemSaida
}

// ─────────────────────────────────────────────────────────────
// PELO WHATSAPP (a própria pessoa)
// ─────────────────────────────────────────────────────────────

/**
 * A pessoa mandou PARAR. Grava a saída, marca NÃO nas fichas dela (com o
 * caminho e a hora — a prova da revogação) e escreve no livro. `novo` diz se
 * o pedido é novo (não estava na lista, ou estava só por anotação da loja):
 * só então a confirmação sai, uma vez.
 */
export async function pararPeloWhatsapp(orgId: string, telefone: string, agora = new Date()): Promise<{ novo: boolean }> {
  const chave = chaveTelefone(telefone)
  if (!chave) return { novo: false }
  return comoOrg(orgId, async (db) => {
    const gravou = await gravarSaida(db, orgId, chave, 'parar', agora)
    // Já tinha saído pela loja ("não aceita", número anotado) e agora pediu
    // ela mesma: vale como pedido novo — confirmação, ficha e livro.
    const novo = gravou.novo || gravou.subiu
    if (!novo) return { novo }
    const fichas = await fichasDoTelefone(db, chave)
    for (const f of fichas) {
      await db.cliente.update({
        where: { id: f.id },
        data: { ofertasWhatsapp: 'NAO', ofertasEm: agora, ofertasOrigem: 'whatsapp', ofertasPor: PELO_PROPRIO_CLIENTE },
      })
    }
    await registrarNoLivro(db, orgId, {
      acao: fichas.length ? 'cliente.ofertas.recusou' : 'ofertas.parou',
      fichas,
      chave,
      depois: { origem: 'whatsapp', palavra: 'PARAR' },
      agora,
    })
    return { novo }
  })
}

/**
 * A pessoa mandou VOLTAR. Só vale para quem está na lista — fora dela,
 * "voltar" é resposta de roteiro ("voltar ao menu"), não pedido. Tira da
 * lista, marca SIM nas fichas dela (pelo WhatsApp, com data e hora) e
 * escreve no livro.
 */
export async function voltarPeloWhatsapp(orgId: string, telefone: string, agora = new Date()): Promise<{ voltou: boolean }> {
  const chave = chaveTelefone(telefone)
  if (!chave) return { voltou: false }
  return comoOrg(orgId, async (db) => {
    const tinha = await tirarSaida(db, orgId, chave)
    if (!tinha) return { voltou: false }
    const fichas = await fichasDoTelefone(db, chave)
    for (const f of fichas) {
      await db.cliente.update({
        where: { id: f.id },
        data: { ofertasWhatsapp: 'SIM', ofertasEm: agora, ofertasOrigem: 'whatsapp', ofertasPor: PELO_PROPRIO_CLIENTE },
      })
    }
    await registrarNoLivro(db, orgId, {
      acao: fichas.length ? 'cliente.ofertas.aceitou' : 'ofertas.voltou',
      fichas,
      chave,
      depois: { origem: 'whatsapp', palavra: 'VOLTAR', versao: VERSAO_TEXTO_OFERTAS, antes: tinha },
      agora,
    })
    return { voltou: true }
  })
}

/**
 * A linha do livro. Com ficha, o alvo é a ficha (e a anonimização dela limpa
 * a linha junto). Sem ficha, o alvo é o número MASCARADO — "(71) ····-1234"
 * diz à loja de quem se trata sem pôr o telefone inteiro num livro que não se
 * apaga.
 */
async function registrarNoLivro(
  db: BancoDaOrg,
  orgId: string,
  p: { acao: string; fichas: { id: string; nome: string }[]; chave: string; depois: object; agora: Date },
) {
  const base = { orgId, quem: PELO_PROPRIO_CLIENTE, autor: 'SISTEMA' as const, acao: p.acao, depois: p.depois, criadoEm: p.agora }
  if (p.fichas.length === 0) {
    await db.auditoria.create({ data: { ...base, alvoTipo: 'contato', alvoNome: mascararChave(p.chave) } })
    return
  }
  for (const f of p.fichas) {
    await db.auditoria.create({ data: { ...base, alvoTipo: 'cliente', alvoId: f.id, alvoNome: f.nome } })
  }
}

// ─────────────────────────────────────────────────────────────
// NA FICHA (a loja anota o que a pessoa disse)
// ─────────────────────────────────────────────────────────────

export type MudancaDeAceite = { ofertas: 'SIM' | 'NAO'; origem: OrigemAceite }

/**
 * Grava o que a pessoa respondeu, na ficha e no livro, dentro da transação de
 * quem salva a ficha. Devolve um recado quando não pode (e nada é gravado):
 *
 *   • SIM para quem mandou PARAR (ou foi anonimizado) → não. Só a pessoa
 *     desfaz, mandando VOLTAR. A loja marcar "aceitou" por cima de um PARAR
 *     é exatamente o que a lei e o WhatsApp proíbem.
 *   • SIM para quem a LOJA pôs na lista → tira da lista (a loja desfaz o
 *     que a loja fez).
 *   • NÃO → põe o número na lista ('cliente') e tira de campanha viva.
 */
export async function conferirAceite(
  db: BancoDaOrg,
  orgId: string,
  chave: string | null,
  mudanca: MudancaDeAceite,
): Promise<string | null> {
  if (mudanca.ofertas !== 'SIM' || !chave) return null
  const ja = await db.optOutWhatsapp.findUnique({ where: { orgId_telefone: { orgId, telefone: chave } }, select: { origem: true } })
  if (ja && (SO_A_PESSOA_TIRA as readonly string[]).includes(ja.origem)) {
    return 'Este número pediu para não receber ofertas (mandou PARAR). Só volta se a própria pessoa mandar VOLTAR para o WhatsApp da loja.'
  }
  return null
}

export async function gravarAceite(
  db: BancoDaOrg,
  sessao: Sessao,
  cliente: { id: string; nome: string },
  chave: string | null,
  mudanca: MudancaDeAceite,
  agora: Date,
) {
  const orgId = sessao.orgId
  await db.cliente.update({
    where: { id: cliente.id },
    data: { ofertasWhatsapp: mudanca.ofertas, ofertasEm: agora, ofertasOrigem: mudanca.origem, ofertasPor: sessao.nome },
  })
  if (chave) {
    if (mudanca.ofertas === 'NAO') await gravarSaida(db, orgId, chave, 'cliente', agora)
    else await tirarSaida(db, orgId, chave)
  }
  await db.auditoria.create({
    data: {
      orgId,
      usuarioId: sessao.usuarioId,
      quem: sessao.nome,
      acao: mudanca.ofertas === 'SIM' ? 'cliente.ofertas.aceitou' : 'cliente.ofertas.recusou',
      alvoTipo: 'cliente',
      alvoId: cliente.id,
      alvoNome: cliente.nome,
      depois: { origem: mudanca.origem, versao: VERSAO_TEXTO_OFERTAS },
      criadoEm: agora,
    },
  })
}

// ─────────────────────────────────────────────────────────────
// A LISTA NA TELA
// ─────────────────────────────────────────────────────────────

export type LinhaSemOfertas = {
  id: string
  telefone: string
  origem: OrigemSaida
  em: Date
  /** A loja pode tirar da lista? (só o que ela mesma pôs) */
  lojaTira: boolean
  cliente: { id: string; nome: string } | null
}

export async function listarSemOfertas(sessao: Sessao): Promise<LinhaSemOfertas[]> {
  exigir(sessao, 'cliente.ver')
  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.optOutWhatsapp.findMany({ orderBy: { em: 'desc' }, take: 500 })
    const saida: LinhaSemOfertas[] = []
    // Uma consulta por linha, em sequência: a lista é pequena (quem pediu para
    // sair), e Promise.all dentro da transação não ganha nada (ver banco.ts).
    for (const l of linhas) {
      const fichas = await fichasDoTelefone(db, l.telefone)
      saida.push({
        id: l.id,
        telefone: mascararChave(l.telefone),
        origem: l.origem as OrigemSaida,
        em: l.em,
        lojaTira: !(SO_A_PESSOA_TIRA as readonly string[]).includes(l.origem),
        cliente: fichas[0] ? { id: fichas[0].id, nome: fichas[0].nome } : null,
      })
    }
    return saida
  })
}

/** O número está na lista? Para a conferência da tela ("este número pode receber?"). */
export async function situacaoDoNumero(
  sessao: Sessao,
  telefone: string,
): Promise<{ valido: false } | { valido: true; naLista: false } | { valido: true; naLista: true; origem: OrigemSaida; em: Date }> {
  exigir(sessao, 'cliente.ver')
  const chave = chaveTelefone(telefone)
  if (!chave) return { valido: false }
  const l = await comoOrg(sessao.orgId, (db) =>
    db.optOutWhatsapp.findUnique({ where: { orgId_telefone: { orgId: sessao.orgId, telefone: chave } }, select: { origem: true, em: true } }),
  )
  return l ? { valido: true, naLista: true, origem: l.origem as OrigemSaida, em: l.em } : { valido: true, naLista: false }
}

/**
 * A loja anota um número que pediu para não receber — por telefone, no
 * balcão, por e-mail, com outras palavras. O cliente não precisa acertar a
 * palavra mágica: pedido de saída por qualquer caminho vale igual.
 */
export async function anotarSemOfertas(sessao: Sessao, telefone: string, agora = new Date()): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'cliente.editar')
  const chave = chaveTelefone(telefone)
  if (!chave) return { ok: false, erro: 'Esse número não parece um celular ou fixo do Brasil (DDD + número).' }
  return comoOrg(sessao.orgId, async (db) => {
    const { novo } = await gravarSaida(db, sessao.orgId, chave, 'manual', agora)
    if (!novo) return { ok: false as const, erro: 'Esse número já está na lista.' }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'ofertas.anotou',
        alvoTipo: 'contato',
        alvoNome: mascararChave(chave),
        criadoEm: agora,
      },
    })
    return { ok: true as const }
  })
}

/** Tira da lista o que a LOJA pôs. O "PARAR" da pessoa só sai com o VOLTAR dela. */
export async function tirarSemOfertas(sessao: Sessao, id: string, agora = new Date()): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'cliente.editar')
  return comoOrg(sessao.orgId, async (db) => {
    const l = await db.optOutWhatsapp.findUnique({ where: { id }, select: { id: true, telefone: true, origem: true } })
    if (!l) return { ok: false as const, erro: 'Esse número não está mais na lista.' }
    if ((SO_A_PESSOA_TIRA as readonly string[]).includes(l.origem)) {
      return { ok: false as const, erro: 'Quem pediu para sair só volta mandando VOLTAR para o WhatsApp da loja.' }
    }
    await db.optOutWhatsapp.delete({ where: { id: l.id } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'ofertas.tirou',
        alvoTipo: 'contato',
        alvoNome: mascararChave(l.telefone),
        antes: { origem: l.origem },
        criadoEm: agora,
      },
    })
    return { ok: true as const }
  })
}
