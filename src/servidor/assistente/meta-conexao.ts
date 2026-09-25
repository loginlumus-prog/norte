// O WhatsApp OFICIAL na tela: conectar pelo Cadastro incorporado da Meta,
// desconectar, recriar os modelos do Norte — e os modelos da própria loja
// (a tela Campanhas › Modelos).
//
// ── o caminho da conexão ─────────────────────────────────────
// 1. No navegador, a loja clica em "Conectar pelo WhatsApp oficial"; o SDK da
//    Meta abre a janela do cadastro (FB.login com o config_id). Ela entra na
//    conta do Facebook dela, escolhe (ou cria) a conta do WhatsApp Business e
//    o número.
// 2. A janela devolve dois recados: um CÓDIGO (no retorno do FB.login) e os
//    ids da conta e do número (num postMessage 'WA_EMBEDDED_SIGNUP').
// 3. A tela manda os dois para `conectarPelaMeta`, AQUI, no servidor, que:
//      a. troca o código pelo token da loja (vale 30 s: é o primeiro passo);
//      b. confere o número na Meta (o nome exibido, se já está na Cloud API);
//      c. inscreve o app do Norte na conta (sem isso nenhum webhook chega);
//      d. registra o número na Cloud API, se ainda não está (não na coexistência);
//      e. coexistência: pede a sincronização que a Meta exige em 24 h;
//      f. guarda ids + token CIFRADO, liga `canal = META`, e anota no livro;
//      g. cria os modelos do Norte (relatório e aviso) na conta da loja.
//    A chave do app (META_APP_SECRET) só existe no servidor.
//
// Nada disso é chamado de dentro de um `comoOrg`: rede lenta com transação
// aberta segura uma conexão do banco à toa. Lê antes, chama a Meta, grava depois.
//
// Toda função confere `agente.configurar` — a mesma capacidade da tela.
// Server Action é endereço público; o botão escondido não protege nada.

import { comoOrg } from '../banco'
import { exigir, type Sessao } from '../permissao'
import { cifrar, temCifra, SemChaveDeCifra } from '../cifra'
import { exigirCampanhasLiberadas } from '../campanhas/acesso'
import { contextoDoToken, linhaMeta, SELECT_LINHA } from './canal'
import {
  FORMATO_ID_META,
  IDIOMA_NORTE,
  MODELOS_NORTE,
  lerConfigMeta,
  mascararNumeroMeta,
  montarModelo,
  semSegredo,
  type ConfigMeta,
  type EntradaModelo,
  type ModeloNaConta,
} from './meta-regras'
import {
  Graph,
  apagarModelo,
  criarModelo,
  desinscreverApp,
  inscreverApp,
  lerNumero,
  listarModelos,
  numerosDaConta,
  registrarNumero,
  sincronizarCoexistencia,
  subirImagemDoModelo,
  trocarCodigo,
  type OpcoesGraph,
} from './meta'

// ─────────────────────────────────────────────────────────────
// O ESTADO (para a tela)
// ─────────────────────────────────────────────────────────────

export type EstadoMeta = {
  /** O servidor tem o app da Meta configurado. Sem isso, a tela só avisa. */
  disponivel: boolean
  /** O que o SDK precisa no navegador — nada disso é segredo. */
  appId: string | null
  configId: string | null
  versao: string | null
  /** A loja está conectada no oficial (canal META com número guardado). */
  ligado: boolean
  /** Há número guardado (mesmo com o canal em outro lugar). */
  guardado: boolean
  numero: string | null
  conectadoEm: string | null
  /** O token guardado abre com a chave deste servidor. */
  tokenAbre: boolean
  cifra: boolean
}

export async function estadoMeta(sessao: Sessao): Promise<EstadoMeta> {
  exigir(sessao, 'agente.configurar')
  const cfg = lerConfigMeta()
  const a = await comoOrg(sessao.orgId, (db) =>
    db.agente.findUnique({
      where: { orgId: sessao.orgId },
      select: { canal: true, metaNumeroExibicao: true, metaConectadoEm: true, ...SELECT_LINHA },
    }),
  )
  const guardado = !!a?.metaPhoneNumberId
  return {
    disponivel: cfg !== null,
    appId: cfg?.appId ?? null,
    configId: cfg?.configId ?? null,
    versao: cfg?.versao ?? null,
    ligado: guardado && a?.canal === 'META',
    guardado,
    numero: a?.metaNumeroExibicao ?? null,
    conectadoEm: a?.metaConectadoEm?.toISOString() ?? null,
    tokenAbre: guardado && linhaMeta(sessao.orgId, a) !== null,
    cifra: temCifra(),
  }
}

// ─────────────────────────────────────────────────────────────
// CONECTAR
// ─────────────────────────────────────────────────────────────

export type EntradaConexao = {
  code: string
  wabaId: string
  phoneNumberId: string | null
  /** O número já usa o app WhatsApp Business e continua nele (coexistência). */
  coexistencia: boolean
  /** PIN de verificação em duas etapas (6 dígitos) — só para registrar número novo na Cloud API. */
  pin?: string | null
}

export type ResultadoConexao = { ok: true; recado: string; avisos: string[] } | { ok: false; erro: string }

const DESLIGADA = 'A conexão oficial ainda não está ligada neste servidor. Fale com o suporte do Norte.'

export async function conectarPelaMeta(sessao: Sessao, e: EntradaConexao, o: OpcoesGraph = {}): Promise<ResultadoConexao> {
  exigir(sessao, 'agente.configurar')
  const cfg = lerConfigMeta()
  if (!cfg) return { ok: false, erro: DESLIGADA }
  if (!temCifra()) return { ok: false, erro: new SemChaveDeCifra().message }

  const code = String(e.code ?? '').trim()
  const wabaId = String(e.wabaId ?? '').trim()
  let phoneNumberId = e.phoneNumberId ? String(e.phoneNumberId).trim() : null
  const pin = e.pin ? String(e.pin).trim() : ''
  if (!code || code.length > 2048 || /\s/.test(code)) return { ok: false, erro: 'O cadastro da Meta não devolveu o código. Tente de novo.' }
  if (!FORMATO_ID_META.test(wabaId)) return { ok: false, erro: 'O cadastro da Meta não disse qual conta do WhatsApp Business foi escolhida. Tente de novo.' }
  if (phoneNumberId && !FORMATO_ID_META.test(phoneNumberId)) return { ok: false, erro: 'O id do número veio fora do formato. Tente de novo.' }
  if (pin && !/^\d{6}$/.test(pin)) return { ok: false, erro: 'O PIN tem 6 números.' }

  const agente = await comoOrg(sessao.orgId, (db) =>
    db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { id: true, nome: true, canal: true, metaPhoneNumberId: true } }),
  )
  if (!agente) return { ok: false, erro: 'Crie o assistente antes de conectar.' }

  // a. o código vale 30 segundos
  const troca = await trocarCodigo(cfg, code, o)
  if (!troca.ok) {
    console.error(`[meta] ${sessao.orgId}: a troca do código falhou: ${troca.erro.mensagem}`)
    return { ok: false, erro: `A Meta não confirmou a conexão. ${troca.erro.mensagem} Tente conectar de novo.` }
  }
  const token = troca.dados
  const g = new Graph(cfg.versao, token, o)
  const avisos: string[] = []

  // b. qual número (a coexistência às vezes não diz)
  if (!phoneNumberId) {
    const nums = await numerosDaConta(g, wabaId)
    if (!nums.ok || nums.dados.length === 0) {
      return { ok: false, erro: 'A conta do WhatsApp Business escolhida não tem número. Confira no painel da Meta e conecte de novo.' }
    }
    if (nums.dados.length > 1) avisos.push('A conta tem mais de um número; o Norte usou o primeiro. Para usar outro, conecte de novo escolhendo só ele.')
    phoneNumberId = nums.dados[0]!.id
  }
  const info = await lerNumero(g, phoneNumberId)
  if (!info.ok) return { ok: false, erro: `Não deu para ler o número na Meta. ${info.erro.mensagem}` }
  const numero = mascararNumeroMeta(info.dados.display_phone_number)
  const coexistencia = e.coexistencia || info.dados.is_on_biz_app === true

  // c. o webhook desta conta passa a vir para o Norte
  const inscricao = await inscreverApp(g, wabaId)
  if (!inscricao.ok) return { ok: false, erro: `A Meta não deixou o Norte receber as mensagens desta conta. ${inscricao.erro.mensagem}` }

  // d. registrar na Cloud API (número novo). Na coexistência ele já está no app.
  let registrou = false
  if (!coexistencia && info.dados.platform_type !== 'CLOUD_API') {
    if (!pin) {
      return {
        ok: false,
        erro: 'Para ligar este número na API oficial, escolha um PIN de 6 números (verificação em duas etapas) e conecte de novo. Se o número já tem PIN, use o mesmo.',
      }
    }
    const reg = await registrarNumero(g, phoneNumberId, pin)
    if (!reg.ok) return { ok: false, erro: `A Meta não registrou o número na API oficial. ${reg.erro.mensagem}` }
    registrou = true
  }

  // e. coexistência: a sincronização que a Meta exige em até 24 h
  if (coexistencia) {
    const s = await sincronizarCoexistencia(g, phoneNumberId)
    if (!s.contatos || !s.historico) {
      avisos.push('A Meta não confirmou a sincronização com o app WhatsApp Business. Se o número parar de funcionar amanhã, conecte de novo.')
    }
  }

  // f. guardar e ligar
  const cifrado = cifrar(token, contextoDoToken(sessao.orgId, 'meta_token'))
  try {
    await comoOrg(sessao.orgId, async (db) => {
      await db.agente.update({
        where: { id: agente.id },
        data: {
          metaWabaId: wabaId,
          metaPhoneNumberId: phoneNumberId,
          metaTokenCifrado: cifrado,
          metaNumeroExibicao: numero,
          metaConectadoEm: new Date(),
          canal: 'META',
        },
      })
      await db.auditoria.create({
        data: {
          orgId: sessao.orgId,
          usuarioId: sessao.usuarioId,
          quem: sessao.nome,
          acao: 'agente.meta.conectou',
          alvoTipo: 'agente',
          alvoId: agente.id,
          alvoNome: agente.nome,
          // Ids da conta e do número não são segredo; o token nunca entra.
          antes: { canal: agente.canal, tinhaNumero: !!agente.metaPhoneNumberId },
          depois: { canal: 'META', wabaId, phoneNumberId, final: numero ? numero.slice(-4) : null, coexistencia, registrou },
        },
      })
    })
  } catch (erro) {
    if (unicoViolado(erro)) {
      return { ok: false, erro: 'Este número já está conectado a outra conta do Norte. Desconecte lá antes.' }
    }
    throw erro
  }

  // g. os modelos do Norte (relatório e aviso). Falha aqui não desfaz a conexão.
  const m = await criarModelosDoNorte(g, wabaId)
  if (m.falhas.length) avisos.push(`Não deu para criar ${m.falhas.join(' e ')} agora. Use "Recriar modelos" daqui a pouco.`)

  return {
    ok: true,
    recado: `Conectado pelo WhatsApp oficial${numero ? `: ${numero}` : ''}. Os modelos de aviso do Norte foram enviados para aprovação da Meta (costuma levar minutos).`,
    avisos,
  }
}

function unicoViolado(e: unknown): boolean {
  const x = e as { code?: unknown; message?: unknown } | null
  return !!x && (x.code === 'P2002' || x.code === '23505' || String(x.message ?? '').includes('meta_phone_number_id'))
}

/**
 * Cria na conta os modelos que as rotinas usam fora da janela de 24 h. Os que
 * já existem (qualquer situação) ficam como estão — criar de novo daria erro,
 * e um modelo em análise não se apressa criando outro.
 */
export async function criarModelosDoNorte(g: Graph, wabaId: string): Promise<{ criados: string[]; jaExistiam: string[]; falhas: string[] }> {
  const saida = { criados: [] as string[], jaExistiam: [] as string[], falhas: [] as string[] }
  const existentes = await listarModelos(g, wabaId)
  const nomes = new Set(existentes.ok ? existentes.dados.filter((t) => t.idioma === IDIOMA_NORTE).map((t) => t.nome) : [])
  for (const modelo of MODELOS_NORTE) {
    if (nomes.has(modelo.name)) {
      saida.jaExistiam.push(modelo.name)
      continue
    }
    const r = await criarModelo(g, wabaId, JSON.parse(JSON.stringify(modelo)) as Record<string, unknown>)
    if (r.ok) saida.criados.push(modelo.name)
    else {
      console.error(`[meta] criar o modelo ${modelo.name} falhou: ${semSegredo(r.erro.mensagem)}`)
      saida.falhas.push(modelo.name)
    }
  }
  return saida
}

// ─────────────────────────────────────────────────────────────
// A LINHA GUARDADA, ABERTA
// ─────────────────────────────────────────────────────────────

type Aberta = { cfg: ConfigMeta; g: Graph; wabaId: string; phoneNumberId: string; token: string; agenteId: string; agenteNome: string }

/** A conexão oficial da empresa, pronta para chamar a Meta — ou a frase de por que não. */
async function abrir(orgId: string, o: OpcoesGraph = {}): Promise<Aberta | { erro: string }> {
  const cfg = lerConfigMeta()
  if (!cfg) return { erro: DESLIGADA }
  const a = await comoOrg(orgId, (db) =>
    db.agente.findUnique({ where: { orgId }, select: { id: true, nome: true, canal: true, ...SELECT_LINHA } }),
  )
  if (!a) return { erro: 'Crie o assistente antes.' }
  const linha = linhaMeta(orgId, a)
  if (!linha || !linha.wabaId) return { erro: 'Esta conta não está conectada pelo WhatsApp oficial.' }
  return {
    cfg,
    g: new Graph(cfg.versao, linha.token, o),
    wabaId: linha.wabaId,
    phoneNumberId: linha.phoneNumberId,
    token: linha.token,
    agenteId: a.id,
    agenteNome: a.nome,
  }
}

/** "Recriar modelos": manda de novo para aprovação os do Norte que não estão na conta. */
export async function recriarModelos(sessao: Sessao, o: OpcoesGraph = {}): Promise<{ ok: true; recado: string } | { ok: false; erro: string }> {
  exigir(sessao, 'agente.configurar')
  const x = await abrir(sessao.orgId, o)
  if ('erro' in x) return { ok: false, erro: x.erro }
  const r = await criarModelosDoNorte(x.g, x.wabaId)
  if (r.falhas.length && !r.criados.length) return { ok: false, erro: 'A Meta não aceitou criar os modelos agora. Tente de novo em alguns minutos.' }
  const partes = []
  if (r.criados.length) partes.push(`${r.criados.length} enviado(s) para aprovação`)
  if (r.jaExistiam.length) partes.push(`${r.jaExistiam.length} já estava(m) na conta`)
  if (r.falhas.length) partes.push(`${r.falhas.length} falhou(aram)`)
  return { ok: true, recado: `Modelos do Norte: ${partes.join(', ')}.` }
}

/**
 * "Desconectar": o Norte esquece a conta (ids e token) e para de usar o
 * número. O número CONTINUA na conta da loja na Meta — tirar de lá é no
 * WhatsApp Manager dela. Antes de esquecer, tenta desinscrever o app (para a
 * Meta parar de mandar o webhook); se não der, esquece do mesmo jeito.
 */
export async function desconectarMeta(sessao: Sessao, o: OpcoesGraph = {}): Promise<{ ok: true; aviso?: string } | { ok: false; erro: string }> {
  exigir(sessao, 'agente.configurar')
  const x = await abrir(sessao.orgId, o)
  let saiu = false
  if (!('erro' in x)) saiu = (await desinscreverApp(x.g, x.wabaId)).ok
  const agente = await comoOrg(sessao.orgId, (db) =>
    db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { id: true, nome: true, canal: true, metaPhoneNumberId: true } }),
  )
  if (!agente) return { ok: false, erro: 'Crie o assistente antes.' }
  if (!agente.metaPhoneNumberId && agente.canal !== 'META') return { ok: true }
  await comoOrg(sessao.orgId, async (db) => {
    await db.agente.update({
      where: { id: agente.id },
      data: {
        metaWabaId: null,
        metaPhoneNumberId: null,
        metaTokenCifrado: null,
        metaNumeroExibicao: null,
        metaConectadoEm: null,
        ...(agente.canal === 'META' ? { canal: 'NENHUM' as const } : {}),
      },
    })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.meta.desconectou',
        alvoTipo: 'agente',
        alvoId: agente.id,
        alvoNome: agente.nome,
        antes: { canal: agente.canal, phoneNumberId: agente.metaPhoneNumberId },
        depois: { canal: agente.canal === 'META' ? 'NENHUM' : agente.canal, metaConfirmou: saiu },
      },
    })
  })
  return saiu
    ? { ok: true }
    : { ok: true, aviso: 'O Norte esqueceu esta conta, mas a Meta não confirmou a saída do app. Se quiser, remova o Norte em Integrações no WhatsApp Manager.' }
}

// ─────────────────────────────────────────────────────────────
// OS MODELOS DA LOJA (Campanhas › Modelos)
// ─────────────────────────────────────────────────────────────

export type ModelosDaLoja =
  | { situacao: 'ok'; modelos: ModeloNaConta[] }
  | { situacao: 'indisponivel'; recado: string }
  | { situacao: 'erro'; recado: string }

/** A mesma régua das campanhas (plano, módulo, permissão) e a conexão oficial ligada. */
async function abrirParaModelos(sessao: Sessao, o: OpcoesGraph = {}): Promise<Aberta | { erro: string }> {
  exigir(sessao, 'agente.configurar')
  await exigirCampanhasLiberadas(sessao.orgId)
  const x = await abrir(sessao.orgId, o)
  if ('erro' in x) return x
  const canal = await comoOrg(sessao.orgId, (db) => db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { canal: true } }))
  if (canal?.canal !== 'META') return { erro: 'Esta conta tem o WhatsApp oficial guardado, mas ele não é o canal ligado agora.' }
  return x
}

export async function modelosDaLoja(sessao: Sessao, o: OpcoesGraph = {}): Promise<ModelosDaLoja> {
  const x = await abrirParaModelos(sessao, o)
  if ('erro' in x) return { situacao: 'indisponivel', recado: x.erro }
  const r = await listarModelos(x.g, x.wabaId)
  if (!r.ok) return { situacao: 'erro', recado: r.erro.mensagem }
  return { situacao: 'ok', modelos: r.dados.sort((a, b) => a.nome.localeCompare(b.nome)) }
}

/** Os aprovados, para o bloco de mensagem da campanha escolher. Nulo = a loja não está no oficial. */
export async function modelosAprovados(sessao: Sessao, o: OpcoesGraph = {}): Promise<{ nome: string; idioma: string; variaveis: number; corpo: string }[] | null> {
  const r = await modelosDaLoja(sessao, o).catch(() => null)
  if (!r || r.situacao !== 'ok') return null
  return r.modelos
    .filter((m) => m.status === 'APPROVED')
    .map((m) => ({ nome: m.nome, idioma: m.idioma, variaveis: m.variaveis, corpo: m.corpo }))
}

export type NovoModelo = Omit<EntradaModelo, 'cabecalhoImagem'> & { midiaId?: string | null }

export async function criarModeloDaLoja(sessao: Sessao, e: NovoModelo, o: OpcoesGraph = {}): Promise<{ ok: true; recado: string } | { ok: false; erro: string }> {
  const x = await abrirParaModelos(sessao, o)
  if ('erro' in x) return { ok: false, erro: x.erro }

  // A imagem do cabeçalho sai da biblioteca de mídia das campanhas: a Meta
  // quer os bytes (upload retomável), não um link.
  let cabecalhoImagem: string | null = null
  if (e.midiaId) {
    const midia = await comoOrg(sessao.orgId, (db) =>
      db.midia.findUnique({ where: { id: String(e.midiaId) }, select: { nome: true, mime: true, tipo: true, dados: true } }),
    )
    if (!midia || midia.tipo !== 'imagem' || !['image/jpeg', 'image/png'].includes(midia.mime)) {
      return { ok: false, erro: 'Para o cabeçalho, escolha uma imagem JPG ou PNG da biblioteca de mídia das campanhas.' }
    }
    const up = await subirImagemDoModelo(x.cfg, x.token, { nome: midia.nome, mime: midia.mime, bytes: new Uint8Array(midia.dados) }, o)
    if (!up.ok) return { ok: false, erro: `A Meta não aceitou a imagem. ${up.erro.mensagem}` }
    cabecalhoImagem = up.dados
  }

  const m = montarModelo({ ...e, cabecalhoImagem })
  if (!m.ok) return m
  const r = await criarModelo(x.g, x.wabaId, m.corpo)
  if (!r.ok) return { ok: false, erro: `A Meta recusou o modelo. ${r.erro.mensagem}` }
  await comoOrg(sessao.orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.modelo.criou',
        alvoTipo: 'agente',
        alvoId: x.agenteId,
        alvoNome: String(m.corpo.name),
        depois: { nome: String(m.corpo.name), categoria: String(m.corpo.category), situacao: r.dados?.status ?? null },
      },
    }),
  )
  return { ok: true, recado: `Modelo "${m.corpo.name}" enviado para aprovação da Meta${r.dados?.status === 'APPROVED' ? ' — e já aprovado' : ''}.` }
}

export async function apagarModeloDaLoja(sessao: Sessao, nome: string, o: OpcoesGraph = {}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const x = await abrirParaModelos(sessao, o)
  if ('erro' in x) return { ok: false, erro: x.erro }
  const n = String(nome ?? '').trim()
  if (!/^[a-z0-9_]{1,512}$/.test(n)) return { ok: false, erro: 'Nome de modelo inválido.' }
  if (n.startsWith('norte_')) {
    return { ok: false, erro: 'Este é um dos avisos automáticos do Norte (relatório e avisos para a equipe). Sem ele, as rotinas não chegam fora da janela de 24 horas.' }
  }
  const r = await apagarModelo(x.g, x.wabaId, n)
  if (!r.ok) return { ok: false, erro: `A Meta não apagou o modelo. ${r.erro.mensagem}` }
  await comoOrg(sessao.orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'agente.modelo.apagou',
        alvoTipo: 'agente',
        alvoId: x.agenteId,
        alvoNome: n,
      },
    }),
  )
  return { ok: true }
}
