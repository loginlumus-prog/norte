// O que a tela do assistente mostra e faz sobre a CONEXÃO: se ele está de
// fato ligado ao mundo, o WhatsApp conectado pelo QR Code (o caminho
// principal), a linha própria no Z-API, o endereço do webhook, a mensagem de
// teste, as rotinas e as últimas conversas.
//
// ── segredo entra e não sai ──────────────────────────────────
// O dono cola aqui o token da instância e o Client-Token do painel do Z-API.
// Eles entram, são cifrados (src/servidor/cifra.ts) e NUNCA voltam para o
// navegador: a tela recebe só "guardado, termina em …ab12". Nem o livro de
// auditoria recebe o token — recebe que foi trocado, por quem e quando.
//
// Toda função aqui começa conferindo `agente.configurar`: é a mesma
// capacidade que abre a tela, e Server Action é endereço público — o botão
// escondido não protege nada.

import type { TipoGatilho } from '@prisma/client'
import { comoOrg } from '../banco'
import { exigir, type Sessao } from '../permissao'
import { temChaveIA } from '../ia'
import { cifrar, decifrar, temCifra, SemChaveDeCifra } from '../cifra'
import { escolherCanal, contextoDoToken, SELECT_LINHA, type OrigemCanal } from './canal'
import {
  iniciarNoConector,
  lerConfigConector,
  retratoNoConector,
  sairNoConector,
  temConector,
  type EstadoQr,
} from './conector'
import { apagarSessaoWhatsapp } from './proprio'
import { montarEnderecoDoWebhook, novoTokenDoWebhook, temSegredoWebhook } from './webhook'
import { abrirConversa, enviarEGravar } from './contexto'
import { modeloDeAviso } from './meta-regras'
import { chaveTelefone, mascarar } from './telefone'
import { DIAS_SUMIDO } from './rotinas'

// ─────────────────────────────────────────────────────────────
// O ESTADO
// ─────────────────────────────────────────────────────────────

/** Um token guardado, como a tela pode ver: se existe, e os 4 últimos. */
export type CredencialNaTela =
  | { guardado: false }
  /** `final` nulo: está guardado, mas não abre com a chave deste servidor. */
  | { guardado: true; final: string | null }

export type EstadoConexao = {
  /** A frase de cima: o que falta, na ordem em que se resolve. */
  situacao: 'sem_agente' | 'sem_chave' | 'sem_canal' | 'desconectado' | 'sem_webhook' | 'desligado' | 'pronto'
  chaveIA: boolean
  canalReal: boolean
  /** De onde sai a mensagem: a linha própria, a global (piloto) ou nenhuma. */
  origemCanal: OrigemCanal
  /** O servidor tem a chave de cifra: dá para guardar a linha própria. */
  cifra: boolean
  /** A linha própria como está guardada — sem token nenhum. */
  linha: { instancia: string | null; token: CredencialNaTela; clientToken: CredencialNaTela }
  /** Há um endereço de entrada que abre: o próprio, ou o antigo que ainda vale. */
  segredoWebhook: boolean
  /** A empresa já gerou o endereço próprio (e o antigo não abre mais). */
  enderecoProprio: boolean
  rotinasSegredo: boolean
  conectado: boolean
  ativo: boolean
  /** O telefone de quem está vendo, mascarado; nulo se não cadastrou. */
  meuTelefone: string | null
  /** O WhatsApp pelo QR Code: o servidor tem o conector? a empresa está nele? */
  qr: { disponivel: boolean; ligado: boolean }
  /** Por onde a porta de entrada está aberta hoje (o `canal` do Agente). */
  canalLigado: 'NENHUM' | 'ZAPI' | 'META' | 'PROPRIO' | null
}

/** Os 4 últimos, e só se abrir: o bastante para conferir, pouco para usar. */
function naTela(orgId: string, cifrado: string | null, campo: 'zapi_token' | 'zapi_client_token'): CredencialNaTela {
  if (!cifrado) return { guardado: false }
  const aberto = decifrar(cifrado, contextoDoToken(orgId, campo))
  return { guardado: true, final: aberto && aberto.length >= 8 ? aberto.slice(-4) : null }
}

export async function estadoDaConexao(sessao: Sessao): Promise<EstadoConexao> {
  exigir(sessao, 'agente.configurar')
  const { agente, eu, slug } = await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({
      where: { orgId: sessao.orgId },
      select: { canal: true, ativo: true, webhookTokenHash: true, ...SELECT_LINHA },
    })
    const eu = await db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { telefone: true } })
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { slug: true } })
    return { agente, eu, slug: org.slug }
  })

  const chaveIA = temChaveIA()
  const { canal, origem } = escolherCanal({ id: sessao.orgId, slug }, agente)
  const canalReal = canal.real
  const enderecoProprio = !!agente?.webhookTokenHash
  const segredoWebhook = enderecoProprio || temSegredoWebhook()
  const noQr = agente?.canal === 'PROPRIO'
  const naMeta = agente?.canal === 'META'
  const conectado = agente?.canal === 'ZAPI' || noQr || naMeta
  const situacao: EstadoConexao['situacao'] = !agente
    ? 'sem_agente'
    : !chaveIA
      ? 'sem_chave'
      : !canalReal
        ? 'sem_canal'
        : !conectado
          ? 'desconectado'
          : // o endereço do webhook só conta no Z-API; o QR entra assinado pelo
            // conector, e a Meta assinada com a chave do app
            agente.canal === 'ZAPI' && !segredoWebhook
            ? 'sem_webhook'
            : !agente.ativo
              ? 'desligado'
              : 'pronto'

  return {
    situacao,
    chaveIA,
    canalReal,
    origemCanal: origem,
    cifra: temCifra(),
    linha: {
      instancia: agente?.zapiInstancia ?? null,
      token: naTela(sessao.orgId, agente?.zapiTokenCifrado ?? null, 'zapi_token'),
      clientToken: naTela(sessao.orgId, agente?.zapiClientTokenCifrado ?? null, 'zapi_client_token'),
    },
    segredoWebhook,
    enderecoProprio,
    rotinasSegredo: (process.env.ROTINAS_SEGREDO ?? '').trim().length >= 32,
    conectado,
    ativo: agente?.ativo ?? false,
    meuTelefone: eu?.telefone && chaveTelefone(eu.telefone) ? mascarar(eu.telefone) : null,
    qr: { disponivel: temConector(), ligado: noQr },
    canalLigado: agente?.canal ?? null,
  }
}

// ─────────────────────────────────────────────────────────────
// O WHATSAPP PELO QR CODE
// ─────────────────────────────────────────────────────────────
//
// O caminho principal: o dono clica, o conector (pasta conector/) gera o QR,
// a tela mostra, o celular lê — e o WhatsApp da loja passa a falar pelo
// Norte, sem Z-API. A tela pergunta o estado a cada 2–3 s enquanto espera.
//
// O `canal` do Agente só vira PROPRIO quando o celular DE FATO conectou (a
// primeira consulta que vê "conectado"). Pedir um QR e desistir não derruba
// o que a loja já tinha ligado (o Z-API, por exemplo).
//
// Nada de segredo passa por aqui: o QR é uma imagem que vale um minuto e só
// serve a quem está com o celular da loja na mão; o número volta mascarado.

export type QrNaTela = {
  estado: EstadoQr | 'sem_conector' | 'fora_do_ar' | 'sem_agente'
  /** PNG em data URL, só em `aguardando_qr`. */
  imagem: string | null
  /** "(71) •••••-1234", só em `conectado`. */
  numero: string | null
  motivo: string | null
  /** O Agente está no QR (canal PROPRIO). */
  ligado: boolean
  /** O canal mudou nesta consulta: a página recarrega o resto. */
  mudou: boolean
}

const semRetrato = (estado: QrNaTela['estado'], ligado: boolean): QrNaTela => ({
  estado,
  imagem: null,
  numero: null,
  motivo: null,
  ligado,
  mudou: false,
})

type AgenteDoQr = { id: string; nome: string; canal: 'NENHUM' | 'ZAPI' | 'META' | 'PROPRIO' }

async function agenteDoQr(orgId: string): Promise<AgenteDoQr | null> {
  return comoOrg(orgId, (db) => db.agente.findUnique({ where: { orgId }, select: { id: true, nome: true, canal: true } }))
}

/** "Conectar pelo QR Code": pede ao conector para ligar (ou retomar) e devolve o primeiro QR. */
export async function conectarPeloQr(sessao: Sessao): Promise<QrNaTela> {
  exigir(sessao, 'agente.configurar')
  const cfg = lerConfigConector()
  const agente = await agenteDoQr(sessao.orgId)
  if (!agente) return semRetrato('sem_agente', false)
  if (!cfg) return semRetrato('sem_conector', agente.canal === 'PROPRIO')
  // Fora do comoOrg: a chamada ao conector pode levar segundos, e transação
  // aberta esperando rede segura uma conexão do banco à toa.
  const r = await iniciarNoConector(cfg, sessao.orgId)
  if (!r) return semRetrato('fora_do_ar', agente.canal === 'PROPRIO')
  return acompanhar(sessao, agente, r)
}

/** A consulta de 2–3 s da tela. Liga o canal no instante em que o celular conectou. */
export async function acompanharQr(sessao: Sessao): Promise<QrNaTela> {
  exigir(sessao, 'agente.configurar')
  const cfg = lerConfigConector()
  const agente = await agenteDoQr(sessao.orgId)
  if (!agente) return semRetrato('sem_agente', false)
  if (!cfg) return semRetrato('sem_conector', agente.canal === 'PROPRIO')
  const r = await retratoNoConector(cfg, sessao.orgId)
  if (!r) return semRetrato('fora_do_ar', agente.canal === 'PROPRIO')
  return acompanhar(sessao, agente, r)
}

async function acompanhar(
  sessao: Sessao,
  agente: AgenteDoQr,
  r: { estado: EstadoQr; qr: string | null; numero: string | null; motivo: string | null },
): Promise<QrNaTela> {
  let ligado = agente.canal === 'PROPRIO'
  let mudou = false
  if (r.estado === 'conectado' && !ligado) {
    await comoOrg(sessao.orgId, async (db) => {
      await db.agente.update({ where: { id: agente.id }, data: { canal: 'PROPRIO' } })
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'agente.proprio.conectou',
          alvoTipo: 'agente',
          alvoId: agente.id,
          alvoNome: agente.nome,
          // Só os 4 últimos do número: o bastante para saber QUAL celular.
          antes: { canal: agente.canal },
          depois: { canal: 'PROPRIO', final: r.numero ? r.numero.slice(-4) : null },
        },
      })
    })
    ligado = true
    mudou = true
  }
  return {
    estado: r.estado,
    imagem: r.estado === 'aguardando_qr' ? r.qr : null,
    numero: r.estado === 'conectado' ? r.numero : null,
    motivo: r.motivo,
    ligado,
    mudou,
  }
}

/**
 * "Desconectar": o conector tira o Norte de Aparelhos conectados e apaga a
 * sessão; o Agente sai do QR. Com o conector fora do ar, a porta fecha do
 * mesmo jeito (o assistente para de usar o número) e a tela pede para
 * remover o aparelho pelo celular.
 */
export async function desconectarPeloQr(sessao: Sessao): Promise<{ ok: true; aviso?: string } | { ok: false; erro: string }> {
  exigir(sessao, 'agente.configurar')
  const agente = await agenteDoQr(sessao.orgId)
  if (!agente) return { ok: false, erro: 'Crie o assistente antes.' }
  const cfg = lerConfigConector()
  const saiu = cfg ? await sairNoConector(cfg, sessao.orgId) : false
  // A sessão guardada some de qualquer jeito: sem ela, ninguém religa.
  await apagarSessaoWhatsapp(sessao.orgId)
  if (agente.canal === 'PROPRIO') {
    await comoOrg(sessao.orgId, async (db) => {
      await db.agente.update({ where: { id: agente.id }, data: { canal: 'NENHUM' } })
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'agente.proprio.desconectou',
          alvoTipo: 'agente',
          alvoId: agente.id,
          alvoNome: agente.nome,
          antes: { canal: 'PROPRIO' },
          depois: { canal: 'NENHUM', conectorConfirmou: saiu },
        },
      })
    })
  }
  return saiu
    ? { ok: true }
    : {
        ok: true,
        aviso:
          'O assistente parou de usar este WhatsApp, mas o conector não respondeu. No celular, confira em Aparelhos conectados e remova o Norte, se ainda aparecer.',
      }
}

// ─────────────────────────────────────────────────────────────
// A LINHA PRÓPRIA NO Z-API
// ─────────────────────────────────────────────────────────────

/**
 * O que o painel do Z-API mostra é letra, número, hífen e sublinhado. Barra,
 * interrogação e espaço não entram: instância e token vão no CAMINHO da URL
 * de envio, e caractere de URL ali dentro muda para onde a chamada vai.
 */
const FORMATO_CREDENCIAL = /^[A-Za-z0-9_-]{6,128}$/

export type EntradaLinha = { instancia: string; token: string; clientToken: string }

/**
 * Guarda a linha própria. Campo de token vazio = manter o que já está
 * guardado (a tela nunca tem o token para devolver preenchido).
 */
export async function salvarLinhaZapi(
  sessao: Sessao,
  entrada: EntradaLinha,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'agente.configurar')
  if (!temCifra()) return { ok: false, erro: new SemChaveDeCifra().message }

  const instancia = entrada.instancia.trim()
  const token = entrada.token.trim()
  const clientToken = entrada.clientToken.trim()
  if (!instancia) return { ok: false, erro: 'Cole o ID da instância, do painel do Z-API.' }
  for (const [nome, v] of [
    ['O ID da instância', instancia],
    ['O token da instância', token],
    ['O Client-Token', clientToken],
  ] as const) {
    if (v && !FORMATO_CREDENCIAL.test(v)) {
      return { ok: false, erro: `${nome} não parece certo: só letras, números, hífen e sublinhado. Copie de novo do painel do Z-API.` }
    }
  }

  return comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({
      where: { orgId: sessao.orgId },
      select: { id: true, nome: true, ...SELECT_LINHA },
    })
    if (!agente) return { ok: false as const, erro: 'Crie o assistente antes de ligar a linha.' }
    if (!token && !agente.zapiTokenCifrado) {
      return { ok: false as const, erro: 'Cole o token da instância, do painel do Z-API.' }
    }

    await db.agente.update({
      where: { id: agente.id },
      data: {
        zapiInstancia: instancia,
        ...(token ? { zapiTokenCifrado: cifrar(token, contextoDoToken(sessao.orgId, 'zapi_token')) } : {}),
        ...(clientToken
          ? { zapiClientTokenCifrado: cifrar(clientToken, contextoDoToken(sessao.orgId, 'zapi_client_token')) }
          : {}),
      },
    })
    // No livro: QUE mudou, não O QUE é. A instância não é segredo (sozinha
    // não manda nada); os tokens são, e deles fica só "trocado".
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.zapi.salvou',
        alvoTipo: 'agente',
        alvoId: agente.id,
        alvoNome: agente.nome,
        antes: {
          instancia: agente.zapiInstancia,
          token: !!agente.zapiTokenCifrado,
          clientToken: !!agente.zapiClientTokenCifrado,
        },
        depois: {
          instancia,
          tokenTrocado: !!token,
          clientTokenTrocado: !!clientToken,
        },
      },
    })
    return { ok: true as const }
  })
}

/** Esquece a linha própria. A empresa volta ao canal de mentira (ou à global, se for a do piloto). */
export async function apagarLinhaZapi(sessao: Sessao) {
  exigir(sessao, 'agente.configurar')
  await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({
      where: { orgId: sessao.orgId },
      select: { id: true, nome: true, zapiInstancia: true, zapiTokenCifrado: true },
    })
    if (!agente || (!agente.zapiInstancia && !agente.zapiTokenCifrado)) return
    await db.agente.update({
      where: { id: agente.id },
      data: { zapiInstancia: null, zapiTokenCifrado: null, zapiClientTokenCifrado: null },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.zapi.apagou',
        alvoTipo: 'agente',
        alvoId: agente.id,
        alvoNome: agente.nome,
        antes: { instancia: agente.zapiInstancia },
      },
    })
  })
}

// ─────────────────────────────────────────────────────────────
// CONECTAR E DESCONECTAR
// ─────────────────────────────────────────────────────────────

/**
 * Gera (ou TROCA) o endereço próprio do webhook, liga o canal, e devolve o
 * endereço para colar no Z-API.
 *
 * O endereço aparece UMA vez, como resposta desta ação — como o link de
 * convite. O banco guarda só o resumo, então ninguém (nem o suporte) consegue
 * mostrar de novo: perdeu, gera outro. Gerar outro derruba o anterior NA
 * HORA — inclusive o antigo, derivado do slug —, e é isso que faz "trocar"
 * valer alguma coisa quando o endereço vazou.
 */
export async function gerarEnderecoDoWebhook(
  sessao: Sessao,
  base: string,
): Promise<{ ok: true; endereco: string; trocou: boolean } | { ok: false; erro: string }> {
  exigir(sessao, 'agente.configurar')
  const { token, resumo } = novoTokenDoWebhook()

  const r = await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({
      where: { orgId: sessao.orgId },
      select: { id: true, nome: true, canal: true, webhookTokenHash: true },
    })
    if (!agente) return null
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { slug: true } })
    await db.agente.update({ where: { id: agente.id }, data: { webhookTokenHash: resumo, canal: 'ZAPI' } })
    const trocou = !!agente.webhookTokenHash
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: trocou ? 'agente.webhook.trocou' : 'agente.webhook.gerou',
        alvoTipo: 'agente',
        alvoId: agente.id,
        alvoNome: agente.nome,
        // Nem o resumo entra: o livro diz que mudou, e isso basta.
        antes: { canal: agente.canal, enderecoProprio: trocou },
        depois: { canal: 'ZAPI', enderecoProprio: true },
      },
    })
    return { slug: org.slug, trocou }
  })
  if (!r) return { ok: false, erro: 'Crie o assistente antes de conectar.' }
  return { ok: true, endereco: montarEnderecoDoWebhook(base, r.slug, token), trocou: r.trocou }
}

/**
 * Reabre a porta com o endereço que já está colado no Z-API — depois de um
 * "Desconectar". Não mostra endereço nenhum: o próprio não dá para mostrar, e
 * quem quer um endereço usa `gerarEnderecoDoWebhook`.
 */
export async function conectarCanal(sessao: Sessao): Promise<{ ok: true } | { ok: false; erro: string }> {
  exigir(sessao, 'agente.configurar')
  return comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({
      where: { orgId: sessao.orgId },
      select: { id: true, nome: true, canal: true, webhookTokenHash: true },
    })
    if (!agente) return { ok: false as const, erro: 'Crie o assistente antes de conectar.' }
    if (!agente.webhookTokenHash && !temSegredoWebhook()) {
      return { ok: false as const, erro: 'Ainda não há endereço de entrada. Gere o endereço e cole no Z-API.' }
    }
    if (agente.canal === 'ZAPI') return { ok: true as const }
    await db.agente.update({ where: { id: agente.id }, data: { canal: 'ZAPI' } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.canal.conectou',
        alvoTipo: 'agente',
        alvoId: agente.id,
        alvoNome: agente.nome,
        antes: { canal: agente.canal },
        depois: { canal: 'ZAPI' },
      },
    })
    return { ok: true as const }
  })
}

/** Fecha a porta desta empresa: o webhook passa a descartar tudo. */
export async function desconectarCanal(sessao: Sessao) {
  exigir(sessao, 'agente.configurar')
  await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { id: true, nome: true, canal: true } })
    if (!agente || agente.canal === 'NENHUM') return
    await db.agente.update({ where: { id: agente.id }, data: { canal: 'NENHUM' } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.canal.desconectou',
        alvoTipo: 'agente',
        alvoId: agente.id,
        alvoNome: agente.nome,
        antes: { canal: agente.canal },
        depois: { canal: 'NENHUM' },
      },
    })
  })
}

// ─────────────────────────────────────────────────────────────
// A MENSAGEM DE TESTE
// ─────────────────────────────────────────────────────────────

/**
 * Manda "estou aqui" para o telefone de QUEM clicou — e só para ele.
 *
 * Não aceita número digitado: um botão que manda mensagem para qualquer
 * número vira ferramenta de spam com o WhatsApp da loja.
 */
export async function mensagemDeTeste(sessao: Sessao): Promise<{ ok: true; recado: string } | { ok: false; erro: string }> {
  exigir(sessao, 'agente.configurar')
  const { agente, eu, slug, loja } = await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({ where: { orgId: sessao.orgId } })
    const eu = await db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { telefone: true, nome: true } })
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { slug: true, nome: true } })
    return { agente, eu, slug: org.slug, loja: org.nome }
  })
  if (!agente) return { ok: false, erro: 'Crie o assistente antes de testar.' }
  if (!eu?.telefone || !chaveTelefone(eu.telefone)) {
    return { ok: false, erro: 'Cadastre o seu telefone (com DDD) na tela Equipe para receber o teste.' }
  }

  // Pelo canal DESTA empresa — a linha própria, se ela tem; é justamente o
  // que o botão existe para provar.
  const { canal, origem } = escolherCanal({ id: sessao.orgId, slug }, agente)
  const conversa = await abrirConversa(sessao.orgId, agente.id, eu.telefone, { nome: eu.nome, daEquipe: true })
  const texto = `Oi, ${eu.nome.split(' ')[0]}! Aqui é ${agente.nome}, o assistente da loja. Se esta mensagem chegou, a conexão está funcionando.`
  // No WhatsApp oficial, se você não escreveu para o número da loja nas
  // últimas 24 horas, o teste sai pelo modelo `norte_aviso` — que é também o
  // que prova que os modelos do Norte já foram aprovados.
  const s = await enviarEGravar(canal, agente, conversa, texto, modeloDeAviso(loja, texto))
  if (!s.enviada) {
    return {
      ok: false,
      erro:
        s.motivo === 'teto_mensagens'
          ? 'Ele já mandou o máximo de mensagens de hoje.'
          : origem === 'meta'
            ? `O WhatsApp oficial não mandou. ${s.detalhe ?? ''} Se o modelo "norte_aviso" ainda está em análise na Meta, mande um "oi" do seu WhatsApp para o número da loja e teste de novo — dentro das 24 horas não precisa de modelo.`.replace(/\s+/g, ' ')
            : origem === 'qr'
              ? 'O WhatsApp conectado pelo QR Code não conseguiu mandar. Confira se ele aparece como conectado aqui em cima.'
              : 'O canal recusou o envio. Confira a instância no Z-API.',
    }
  }
  return {
    ok: true,
    recado: canal.real
      ? `Mensagem enviada para ${mascarar(eu.telefone)}${
          origem === 'meta'
            ? `, pelo WhatsApp oficial${s.porModelo ? ' (como modelo aprovado, porque a janela de 24 horas com você estava fechada)' : ''}`
            : origem === 'qr'
              ? ', pelo WhatsApp conectado por QR Code'
              : origem === 'propria'
                ? ', pela linha desta loja'
                : ''
        }.`
      : 'Esta conta ainda não tem linha do WhatsApp: a mensagem ficou só no histórico abaixo, nada saiu de verdade.',
  }
}

// ─────────────────────────────────────────────────────────────
// AS ROTINAS
// ─────────────────────────────────────────────────────────────

/** As rotinas que existem de verdade. As outras do enum ainda não têm código. */
export const ROTINAS_NA_TELA: { tipo: TipoGatilho; titulo: string; resumo: string }[] = [
  { tipo: 'RELATORIO', titulo: 'Relatório de manhã e à noite', resumo: 'Às 8h, como foi ontem. Às 20h, como foi hoje. Para os donos com telefone cadastrado.' },
  { tipo: 'RUPTURA', titulo: 'Aviso de que vai faltar peça', resumo: 'Às 9h, o que acaba antes de a reposição chegar — e a proposta de compra, se ele tiver esse poder.' },
  { tipo: 'CLIENTE_SUMIDO', titulo: 'Cliente sumido', resumo: 'Segunda, às 10h: quem comprava quase todo mês e parou de vir.' },
]

export type GatilhoNaTela = { tipo: TipoGatilho; ativo: boolean; dias: number | null; ultimoDisparo: string | null }

export async function gatilhosDaTela(sessao: Sessao): Promise<GatilhoNaTela[]> {
  exigir(sessao, 'agente.configurar')
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.gatilhoAgente.findMany({ select: { tipo: true, ativo: true, dias: true, ultimoDisparo: true } }),
  )
  return ROTINAS_NA_TELA.map((r) => {
    const g = linhas.find((l) => l.tipo === r.tipo)
    return {
      tipo: r.tipo,
      // Sem linha = ligado. É o padrão da coluna e o que o plano vende.
      ativo: g?.ativo ?? true,
      dias: g?.dias ?? (r.tipo === 'CLIENTE_SUMIDO' ? DIAS_SUMIDO : null),
      ultimoDisparo: g?.ultimoDisparo?.toISOString() ?? null,
    }
  })
}

export async function salvarGatilhos(
  sessao: Sessao,
  escolha: { tipo: TipoGatilho; ativo: boolean; dias?: number | null }[],
) {
  exigir(sessao, 'agente.configurar')
  const validos = new Set(ROTINAS_NA_TELA.map((r) => r.tipo))
  await comoOrg(sessao.orgId, async (db) => {
    const agente = await db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { id: true } })
    if (!agente) throw new Error('Crie o assistente antes de ligar rotinas.')
    for (const g of escolha) {
      if (!validos.has(g.tipo)) continue
      const dias = g.dias != null && Number.isFinite(g.dias) ? Math.min(365, Math.max(7, Math.round(g.dias))) : null
      await db.gatilhoAgente.upsert({
        where: { agenteId_tipo: { agenteId: agente.id, tipo: g.tipo } },
        create: { orgId: sessao.orgId, agenteId: agente.id, tipo: g.tipo, ativo: g.ativo, dias },
        update: { ativo: g.ativo, dias },
      })
    }
    // Ligar e desligar rotina muda o que o assistente manda sozinho para a
    // equipe e para os clientes — é configuração, e configuração vai para o
    // livro, como as outras do assistente.
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.rotinas',
        alvoTipo: 'agente',
        alvoId: agente.id,
        depois: escolha.filter((g) => validos.has(g.tipo)).map((g) => ({ tipo: g.tipo, ativo: g.ativo, dias: g.dias ?? null })),
      },
    })
  })
}

// ─────────────────────────────────────────────────────────────
// AS ÚLTIMAS CONVERSAS
// ─────────────────────────────────────────────────────────────

export type ConversaNaTela = {
  id: string
  quem: string
  telefone: string
  daEquipe: boolean
  ultimaEm: string
  mensagens: { de: 'PESSOA' | 'AGENTE' | 'SISTEMA'; texto: string; em: string }[]
}

/**
 * As últimas conversas, com as últimas mensagens de cada uma.
 *
 * O telefone sai mascarado: a tela serve para conferir o que ELE disse, não
 * para virar agenda de contatos de quem só configura o assistente.
 */
export async function conversasRecentes(sessao: Sessao, quantas = 8): Promise<ConversaNaTela[]> {
  exigir(sessao, 'agente.configurar')
  const linhas = await comoOrg(sessao.orgId, (db) =>
    db.conversaAgente.findMany({
      orderBy: { ultimaEm: 'desc' },
      take: quantas,
      select: {
        id: true,
        nome: true,
        telefone: true,
        daEquipe: true,
        ultimaEm: true,
        mensagens: { orderBy: { criadaEm: 'desc' }, take: 6, select: { de: true, texto: true, criadaEm: true } },
      },
    }),
  )
  return linhas.map((c) => ({
    id: c.id,
    quem: c.nome ?? 'sem nome',
    telefone: mascarar(c.telefone),
    daEquipe: c.daEquipe,
    ultimaEm: c.ultimaEm.toISOString(),
    mensagens: c.mensagens
      .reverse()
      .map((m) => ({ de: m.de, texto: m.texto.slice(0, 600), em: m.criadaEm.toISOString() })),
  }))
}
