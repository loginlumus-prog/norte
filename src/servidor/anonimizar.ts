// Anonimizar um cliente — o direito do titular (LGPD art. 18, IV e VI).
//
// ── por que anonimizar, e não apagar a linha ─────────────────
// A ficha do cliente segura venda, parcela, vale e pontos. Venda é registro
// fiscal, e a loja tem de guardar pelo prazo da lei (art. 16, I: cumprimento
// de obrigação legal). Apagar a linha levaria as vendas junto — ou deixaria
// vendas apontando para o nada. Então a ficha FICA, mas deixa de ser de
// alguém: nome vira "Cliente anonimizado", e telefone, e-mail, CPF,
// endereço, aniversário e observações somem. As vendas continuam lá, com
// valor, itens e data, penduradas numa ficha que não identifica ninguém.
//
// ── o que some junto ─────────────────────────────────────────
//   • as conversas do WhatsApp com aquele número (e as mensagens delas);
//   • as execuções de campanha daquele número (e o diário delas), que
//     guardam o nome e as respostas da pessoa;
//   • nas encomendas dela, o nome, o telefone e o endereço de entrega (a
//     encomenda — o que foi, quanto, quando — fica, é venda);
//   • nos lançamentos do financeiro que o sinal da encomenda gerou, o nome
//     no meio da descrição;
//   • no livro de auditoria, o nome e os dados pessoais das linhas sobre ela
//     (a função `anonimizar_auditoria` do rls.sql — o único jeito de tocar no
//     livro, e só nisso).
//
// ── o que fica, e por quê ────────────────────────────────────
//   • a CHAVE do telefone na lista de quem não recebe oferta (ver
//     ../ofertas.ts): é o mínimo para não escrever de novo a quem pediu para
//     ser esquecido. Sem ela, a próxima campanha trataria o número como novo;
//   • vendas, parcelas, vales e pontos, sem nome — registro fiscal e
//     financeiro;
//   • a linha nova do livro ("anonimizou um cliente"), SEM dado pessoal: diz
//     quem fez, quando e o que foi apagado, em números.
//
// ── quando NÃO dá ────────────────────────────────────────────
// Com parcela do crediário em aberto, ou encomenda por entregar. Apagar o
// contato de quem deve (ou de quem a loja deve uma entrega) não some com a
// dívida — só com o jeito de resolvê-la; a lei deixa guardar para isso
// (art. 16 e art. 7º, VI). Quita, entrega ou cancela, e aí anonimiza.
//
// ── quem pode ────────────────────────────────────────────────
// Na tela, quem configura a empresa (o dono): é irreversível e apaga
// conversa, coisa que nem o gerente apaga. E o NOSSO suporte, quando o
// pedido chega por e-mail (/exclusao-de-dados), pelo script
// scripts/anonimizar-cliente.ts — as duas portas chamam a mesma função.

import { comoOrg, type BancoDaOrg } from './banco'
import { chaveTelefone } from './assistente/telefone'
import { exigir, type Sessao } from './permissao'
import { codigoEncomenda } from './encomenda'
import { gravarSaida } from './ofertas'

/** O nome que fica no lugar do nome. */
export const NOME_ANONIMO = 'Cliente anonimizado'

/** A palavra que a tela pede para digitar antes de apagar. */
export const PALAVRA_CONFIRMA = 'ANONIMIZAR'

/** Quem pediu e por onde. Vai para o livro — por isso é escolha, e não texto livre com nome dentro. */
export type Pedido =
  | { por: 'loja'; sessao: Sessao }
  | { por: 'suporte'; atendente: string; protocolo: string }

export type Apagado = {
  conversas: number
  mensagens: number
  execucoes: number
  encomendas: number
  lancamentos: number
  linhasDoLivro: number
  foraDasOfertas: boolean
}

export type ResultadoAnonimizacao = { ok: true; apagado: Apagado } | { ok: false; erro: string }

/**
 * O protocolo do suporte vai para o livro, então ele não pode carregar dado
 * pessoal. Por isso tem FORMA fixa — "LGPD-2026-0042" (ano e número do
 * pedido na caixa de e-mail do suporte) — e não texto livre: texto livre
 * vira "pedido da Maria (71) 9...", e o livro não se apaga.
 */
export const protocoloValido = (p: string): boolean => /^LGPD-\d{4}-\d{1,6}$/.test(p.trim())

/** A tela: confere a permissão e a palavra digitada, e anonimiza. */
export async function anonimizarCliente(
  sessao: Sessao,
  clienteId: string,
  confirmacao: string,
  agora = new Date(),
): Promise<ResultadoAnonimizacao> {
  // Irreversível, e apaga conversa: é de quem configura a empresa.
  exigir(sessao, 'empresa.configurar')
  if (confirmacao.trim().toUpperCase() !== PALAVRA_CONFIRMA) {
    return { ok: false, erro: `Para anonimizar, digite ${PALAVRA_CONFIRMA}.` }
  }
  return anonimizarNaEmpresa(sessao.orgId, clienteId, { por: 'loja', sessao }, agora)
}

/**
 * O suporte do Norte, atendendo pedido que chegou por e-mail. Acha a ficha
 * pelo telefone ou pelo CPF (o que o titular informou) dentro da empresa, e
 * anonimiza cada uma que bater. Devolve quantas.
 */
export async function anonimizarPorPedidoAoSuporte(
  orgId: string,
  busca: { telefone?: string | null; documento?: string | null; clienteId?: string | null },
  pedido: { atendente: string; protocolo: string },
  agora = new Date(),
): Promise<{ ok: true; fichas: number; apagado: Apagado[] } | { ok: false; erro: string }> {
  if (!pedido.atendente.trim()) return { ok: false, erro: 'Falta quem do suporte atendeu.' }
  if (!protocoloValido(pedido.protocolo)) {
    return { ok: false, erro: 'Protocolo inválido: use LGPD-<ano>-<número>, como LGPD-2026-0042 (nunca nome ou telefone do titular).' }
  }
  const ids = await fichasDoPedido(orgId, busca)
  if (ids.length === 0) return { ok: false, erro: 'Nenhuma ficha com esse telefone ou CPF nesta empresa.' }
  const apagado: Apagado[] = []
  for (const id of ids) {
    const r = await anonimizarNaEmpresa(orgId, id, { por: 'suporte', atendente: pedido.atendente.trim(), protocolo: pedido.protocolo.trim() }, agora)
    if (!r.ok) return r
    apagado.push(r.apagado)
  }
  return { ok: true, fichas: ids.length, apagado }
}

/** As fichas (não anonimizadas) que batem com o que o titular informou. */
export async function fichasDoPedido(
  orgId: string,
  busca: { telefone?: string | null; documento?: string | null; clienteId?: string | null },
): Promise<string[]> {
  const chave = chaveTelefone(busca.telefone ?? null)
  const cpf = (busca.documento ?? '').replace(/\D/g, '')
  return comoOrg(orgId, async (db) => {
    const achados = new Set<string>()
    if (busca.clienteId) {
      const c = await db.cliente.findFirst({ where: { id: busca.clienteId, anonimizadoEm: null }, select: { id: true } })
      if (c) achados.add(c.id)
    }
    if (cpf.length === 11) {
      for (const c of await db.cliente.findMany({ where: { documento: cpf, anonimizadoEm: null }, select: { id: true } })) achados.add(c.id)
    }
    if (chave) {
      const candidatos = await db.cliente.findMany({
        where: { telefone: { endsWith: chave.slice(-8) }, anonimizadoEm: null },
        select: { id: true, telefone: true },
      })
      for (const c of candidatos) if (chaveTelefone(c.telefone) === chave) achados.add(c.id)
    }
    return [...achados]
  })
}

/** O trabalho, numa transação só: ou apaga tudo, ou nada. */
export async function anonimizarNaEmpresa(
  orgId: string,
  clienteId: string,
  pedido: Pedido,
  agora = new Date(),
): Promise<ResultadoAnonimizacao> {
  return comoOrg(orgId, async (db) => {
    const c = await db.cliente.findUnique({
      where: { id: clienteId },
      select: { id: true, nome: true, telefone: true, anonimizadoEm: true },
    })
    if (!c) return { ok: false as const, erro: 'Cliente não encontrado.' }
    if (c.anonimizadoEm) return { ok: false as const, erro: 'Este cadastro já foi anonimizado.' }

    const devendo = await db.parcela.count({ where: { clienteId, quitadaEm: null } })
    if (devendo > 0) {
      return {
        ok: false as const,
        erro: `Tem ${devendo === 1 ? 'uma parcela' : `${devendo} parcelas`} do crediário em aberto. Receba ou renegocie antes: sem o contato, a dívida continua e ninguém consegue resolver.`,
      }
    }
    const porEntregar = await db.encomenda.count({ where: { clienteId, situacao: { in: ['ABERTA', 'PRONTA'] } } })
    if (porEntregar > 0) {
      return { ok: false as const, erro: 'Tem encomenda por entregar para esta pessoa. Entregue ou cancele antes de anonimizar.' }
    }

    const chave = chaveTelefone(c.telefone)
    const apagado = await apagarRastros(db, orgId, c, chave, agora)

    await db.cliente.update({
      where: { id: clienteId },
      data: {
        nome: NOME_ANONIMO,
        documento: null,
        telefone: null,
        email: null,
        nascimento: null,
        endereco: null,
        numero: null,
        bairro: null,
        cidade: null,
        estado: null,
        cep: null,
        observacoes: null,
        ativo: false,
        // O consentimento era DELA; a ficha anônima não aceita nem recusa
        // nada. Quem garante que ela não recebe mais é a lista.
        ofertasWhatsapp: 'NAO_PERGUNTADO',
        ofertasEm: null,
        ofertasOrigem: null,
        ofertasPor: null,
        anonimizadoEm: agora,
      },
    })

    // A linha do livro: quem fez, quando, e o que foi apagado — em NÚMEROS.
    // Nem o nome, nem o telefone, nem o CPF da pessoa entram aqui.
    await db.auditoria.create({
      data: {
        orgId,
        usuarioId: pedido.por === 'loja' ? pedido.sessao.usuarioId : null,
        quem: pedido.por === 'loja' ? pedido.sessao.nome : `Suporte do Norte (${pedido.atendente})`,
        autor: pedido.por === 'loja' ? 'PESSOA' : 'SISTEMA',
        acao: 'cliente.anonimizou',
        alvoTipo: 'cliente',
        alvoId: clienteId,
        alvoNome: NOME_ANONIMO,
        motivo: pedido.por === 'loja' ? 'pedido do titular, atendido pela loja' : `pedido do titular ao Norte · ${pedido.protocolo}`,
        depois: apagado,
        criadoEm: agora,
      },
    })
    return { ok: true as const, apagado }
  })
}

async function apagarRastros(
  db: BancoDaOrg,
  orgId: string,
  c: { id: string; nome: string },
  chave: string | null,
  agora: Date,
): Promise<Apagado> {
  const final = chave?.slice(-8)

  // ── conversas do WhatsApp ─────────────────────────────────
  // As ligadas à ficha E as do número (a conversa pode ter começado antes
  // do cadastro, sem ficha ligada). Apagar a conversa leva as mensagens.
  const conversas = (
    await db.conversaAgente.findMany({
      where: { OR: [{ clienteId: c.id }, ...(final ? [{ telefone: { endsWith: final } }] : [])] },
      select: { id: true, telefone: true, clienteId: true, daEquipe: true },
    })
  ).filter((x) => x.clienteId === c.id || (!!chave && chaveTelefone(x.telefone) === chave && !x.daEquipe))
  const idsConversa = conversas.map((x) => x.id)
  const mensagens = idsConversa.length ? await db.mensagemAgente.count({ where: { conversaId: { in: idsConversa } } }) : 0
  if (idsConversa.length) await db.conversaAgente.deleteMany({ where: { id: { in: idsConversa } } })

  // ── campanhas ─────────────────────────────────────────────
  // A execução guarda nome, número e as respostas; o diário vai junto.
  const execucoes = chave ? (await db.campanhaExecucao.deleteMany({ where: { telefone: chave } })).count : 0

  // ── encomendas: some quem, fica o quê ─────────────────────
  const encomendas = (
    await db.encomenda.findMany({
      where: { OR: [{ clienteId: c.id }, ...(final ? [{ telefone: { endsWith: final } }] : [])] },
      select: { id: true, clienteId: true, clienteNome: true, telefone: true },
    })
  ).filter((e) => e.clienteId === c.id || (!!chave && chaveTelefone(e.telefone) === chave))
  const idsEncomenda = encomendas.map((e) => e.id)
  if (idsEncomenda.length) {
    await db.encomenda.updateMany({
      where: { id: { in: idsEncomenda } },
      data: { clienteNome: NOME_ANONIMO, telefone: null, endereco: null },
    })
  }

  // ── o sinal da encomenda no financeiro ────────────────────
  // A descrição é "Sinal da encomenda — Maria: bolo...": o lançamento fica
  // (é dinheiro), o nome sai. Acha pelo código da encomenda no documento.
  const nomes = [...new Set([c.nome, ...encomendas.map((e) => e.clienteNome)].filter((n) => n && n.length >= 3))]
  const lancamentos = idsEncomenda.length
    ? await db.lancamento.findMany({
        where: { documento: { in: idsEncomenda.map(codigoEncomenda) } },
        select: { id: true, descricao: true },
      })
    : []
  const idsLancamento: string[] = []
  for (const l of lancamentos) {
    let d = l.descricao
    for (const n of nomes) d = d.split(n).join(NOME_ANONIMO)
    if (d !== l.descricao) {
      await db.lancamento.update({ where: { id: l.id }, data: { descricao: d } })
      idsLancamento.push(l.id)
    }
  }

  // ── o livro ───────────────────────────────────────────────
  // Uma chamada por nome (o da ficha e o que ficou gravado na encomenda, que
  // pode ser diferente: "Dona Maria"). A função só troca o nome pela frase
  // fixa e tira as chaves pessoais — ver rls.sql.
  const alvos = [c.id, ...idsEncomenda, ...idsLancamento]
  let linhasDoLivro = 0
  for (const nome of nomes.length ? nomes : ['']) {
    const r = await db.$queryRaw<{ n: number }[]>`select public.anonimizar_auditoria(${alvos}::text[], ${nome}) as n`
    linhasDoLivro = Math.max(linhasDoLivro, Number(r[0]?.n ?? 0))
  }

  // ── a lista de quem não recebe oferta ─────────────────────
  if (chave) await gravarSaida(db, orgId, chave, 'anonimizado', agora)

  return {
    conversas: idsConversa.length,
    mensagens,
    execucoes,
    encomendas: idsEncomenda.length,
    lancamentos: idsLancamento.length,
    linhasDoLivro,
    foraDasOfertas: !!chave,
  }
}
