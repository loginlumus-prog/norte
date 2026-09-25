// O WhatsApp OFICIAL (Meta, Cloud API): as regras, sem rede e sem banco.
//
// Tudo o que dá para decidir olhando só para os dados mora aqui — e por isso
// é o que os testes provam sem internet: a assinatura do webhook, o desafio da
// verificação, a leitura do que a Meta entrega, a janela de 24 horas, o que vai
// em cada variável de um modelo, e a tradução dos erros da Graph API para uma
// frase de loja. A parte que fala com a Meta (e com o banco) é ./meta.ts.
//
// ── o interruptor ────────────────────────────────────────────
// A conexão oficial só existe quando o servidor tem o app da Meta configurado:
//
//   META_APP_ID                o id do app (painel da Meta › Configurações do app › Básico)
//   META_APP_SECRET            a chave secreta do app — assina o webhook e troca o código
//   META_CONFIG_ID             o id da configuração do "Cadastro incorporado"
//                              (Facebook Login for Business › Configurações)
//   META_WEBHOOK_VERIFY_TOKEN  o texto que a Meta devolve ao verificar o webhook
//   META_GRAPH_VERSION         opcional; padrão abaixo (VERSAO_PADRAO)
//
// Faltou uma das quatro, a tela diz "A conexão oficial ainda não está ligada
// neste servidor" e nada mais muda: nenhum botão chama a Meta, o webhook
// responde 404, e a escolha do canal (./canal.ts) pula a Meta.
//
// ── segredo nunca sai ────────────────────────────────────────
// O token da loja e a chave do app não vão para log, nem para a tela, nem para
// o livro de auditoria. Erro da Meta vira frase nossa com o código numérico da
// Meta — nunca o corpo da resposta, que não é nosso e pode ecoar o pedido.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CodigoFalha, ModeloParaEnvio, MidiaParaEnvio } from './canal'
import { mascarar } from './telefone'

// ─────────────────────────────────────────────────────────────
// A CONFIGURAÇÃO
// ─────────────────────────────────────────────────────────────

/**
 * A versão da Graph API quando META_GRAPH_VERSION não diz outra. É a que os
 * exemplos da documentação do WhatsApp usam em setembro de 2026 (a v26.0 já
 * saiu no changelog e funciona; a v25.0 vale até 07/2028). Trocar de versão é
 * trocar a variável — o código não depende de nada da v25 em particular.
 */
export const VERSAO_PADRAO = 'v25.0'
const FORMATO_VERSAO = /^v\d{1,3}\.\d$/

export type ConfigMeta = {
  appId: string
  appSecret: string
  configId: string
  verifyToken: string
  versao: string
}

/** A configuração do app da Meta, ou nulo se falta alguma peça. */
export function lerConfigMeta(env: Record<string, string | undefined> = process.env): ConfigMeta | null {
  const appId = (env.META_APP_ID ?? '').trim()
  const appSecret = (env.META_APP_SECRET ?? '').trim()
  const configId = (env.META_CONFIG_ID ?? '').trim()
  const verifyToken = (env.META_WEBHOOK_VERIFY_TOKEN ?? '').trim()
  const pedida = (env.META_GRAPH_VERSION ?? '').trim()
  if (!/^\d{5,32}$/.test(appId) || appSecret.length < 16 || !/^\d{5,32}$/.test(configId) || verifyToken.length < 16) {
    return null
  }
  return { appId, appSecret, configId, verifyToken, versao: FORMATO_VERSAO.test(pedida) ? pedida : VERSAO_PADRAO }
}

export const metaLigada = () => lerConfigMeta() !== null

export const GRAPH = 'https://graph.facebook.com'

/** Id de conta, de número, de negócio na Meta: só dígitos. */
export { FORMATO_ID_META } from './meta-cadastro'
import { FORMATO_ID_META } from './meta-cadastro'

// ─────────────────────────────────────────────────────────────
// O WEBHOOK: a verificação e a assinatura
// ─────────────────────────────────────────────────────────────

/**
 * A verificação do endereço (GET): a Meta manda `hub.mode=subscribe`,
 * `hub.verify_token` e `hub.challenge`, e espera o desafio de volta. Devolve o
 * desafio quando o token confere (tempo constante), nulo quando não.
 */
export function respostaDoDesafio(params: URLSearchParams, verifyToken: string | null | undefined): string | null {
  const esperado = (verifyToken ?? '').trim()
  if (!esperado) return null
  if (params.get('hub.mode') !== 'subscribe') return null
  const veio = params.get('hub.verify_token') ?? ''
  const a = Buffer.from(esperado)
  const b = Buffer.from(veio)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const desafio = params.get('hub.challenge') ?? ''
  // O desafio é um número; qualquer outra coisa não volta ecoada na nossa resposta.
  return /^[A-Za-z0-9_-]{1,128}$/.test(desafio) ? desafio : null
}

/**
 * `X-Hub-Signature-256: sha256=<hex>` — o HMAC-SHA256 do corpo CRU com a chave
 * secreta do app. Tem de ser o corpo exatamente como chegou: reparsear e
 * reserializar o JSON muda espaço e ordem, e a assinatura não bate mais.
 * Comparação em tempo constante; cabeçalho ausente ou fora do formato é "não".
 */
export function assinaturaConfere(bruto: string | Buffer, cabecalho: string | null | undefined, segredo: string | null | undefined): boolean {
  const chave = (segredo ?? '').trim()
  if (!chave || typeof cabecalho !== 'string') return false
  const m = /^sha256=([0-9a-f]{64})$/i.exec(cabecalho.trim())
  if (!m) return false
  const esperado = createHmac('sha256', chave).update(bruto).digest()
  const veio = Buffer.from(m[1]!.toLowerCase(), 'hex')
  return veio.length === esperado.length && timingSafeEqual(veio, esperado)
}

// ─────────────────────────────────────────────────────────────
// O WEBHOOK: o que a Meta entrega
// ─────────────────────────────────────────────────────────────

export type EventoMeta =
  | {
      tipo: 'mensagem'
      phoneNumberId: string
      telefone: string
      nome: string | null
      texto: string
      idExterno: string
      /** O anúncio "clique para o WhatsApp" de onde a pessoa veio. */
      anuncioId: string | null
    }
  /** A loja escreveu pelo app WhatsApp Business (coexistência): o recado e as campanhas calam. */
  | { tipo: 'humano'; phoneNumberId: string; telefone: string; idExterno: string }
  | {
      tipo: 'status'
      phoneNumberId: string
      idExterno: string
      status: 'sent' | 'delivered' | 'read' | 'failed' | 'played' | 'outro'
      /** O número de quem recebeu, mascarado — para o log. */
      destino: string
      erro: { codigo: number | null; titulo: string } | null
    }
  | { tipo: 'modelo'; wabaId: string | null; nome: string; idioma: string | null; evento: string; motivo: string | null }
  | { tipo: 'conta'; wabaId: string | null; evento: string }
  | { tipo: 'ignorar'; motivo: string }

const MIDIA_NOME: Record<string, string> = {
  image: 'uma imagem',
  audio: 'um áudio',
  video: 'um vídeo',
  document: 'um documento',
  sticker: 'uma figurinha',
  location: 'uma localização',
  contacts: 'um contato',
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const txt = (v: unknown): string => (typeof v === 'string' ? v : '')
const digitos = (v: unknown): string => txt(v).replace(/\D/g, '')

/**
 * O id do anúncio de clique para o WhatsApp, do `referral` da mensagem.
 * `source_type` "ad" (ou ausente) e o id no formato que as campanhas guardam —
 * o mesmo corte do Z-API (`anuncioDoZapi`) e do conector.
 */
export function anuncioDaMeta(referral: unknown): string | null {
  const r = obj(referral)
  if (!r) return null
  const tipo = typeof r.source_type === 'string' ? r.source_type.toLowerCase() : null
  const id = txt(r.source_id).trim()
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) && (tipo === null || tipo === 'ad') ? id : null
}

/** O texto de uma mensagem recebida, qualquer que seja o tipo — ou nulo se não é conversa. */
function textoDaMensagem(m: Record<string, unknown>): string | null {
  const tipo = txt(m.type)
  if (tipo === 'text') return txt(obj(m.text)?.body).trim() || null
  // Resposta a botão de modelo ("Quero", "Parar"): vale o que a pessoa leu no botão.
  if (tipo === 'button') {
    const b = obj(m.button)
    return (txt(b?.text) || txt(b?.payload)).trim() || null
  }
  if (tipo === 'interactive') {
    const i = obj(m.interactive)
    const escolha = obj(i?.button_reply) ?? obj(i?.list_reply)
    return (txt(escolha?.title) || txt(escolha?.id)).trim() || null
  }
  const desc = MIDIA_NOME[tipo]
  if (desc) {
    const legenda = txt(obj(m[tipo])?.caption).trim()
    const nota = `(mídia: a pessoa mandou ${desc}, que o assistente ainda não consegue abrir — peça para escrever)`
    return legenda ? `${legenda}\n${nota}` : nota
  }
  // reação, sistema, pedido de ligação, "não suportado": não é conversa.
  return null
}

/**
 * O corpo do webhook, reduzido a uma lista de eventos — um por mensagem,
 * status ou aviso. Nunca lança: o que não se entende vira 'ignorar' e sai do
 * caminho (a Meta manda até mil atualizações por POST, e uma estragada não
 * pode levar as outras junto).
 */
export function lerWebhookMeta(corpo: unknown): EventoMeta[] {
  const c = obj(corpo)
  if (!c || c.object !== 'whatsapp_business_account') return [{ tipo: 'ignorar', motivo: 'não é do WhatsApp Business' }]
  const eventos: EventoMeta[] = []
  for (const entrada of lista(c.entry).slice(0, 1000)) {
    const e = obj(entrada)
    if (!e) continue
    const wabaId = FORMATO_ID_META.test(txt(e.id)) ? txt(e.id) : null
    for (const mudanca of lista(e.changes)) {
      const ch = obj(mudanca)
      const campo = txt(ch?.field)
      const v = obj(ch?.value)
      if (!v) continue
      const phoneNumberId = txt(obj(v.metadata)?.phone_number_id)
      const numeroOk = FORMATO_ID_META.test(phoneNumberId)

      if (campo === 'messages') {
        if (!numeroOk) {
          eventos.push({ tipo: 'ignorar', motivo: 'sem id do número' })
          continue
        }
        const nomes = new Map<string, string>()
        for (const ct of lista(v.contacts)) {
          const o = obj(ct)
          const nome = txt(obj(o?.profile)?.name).trim()
          if (o && nome) nomes.set(digitos(o.wa_id), nome)
        }
        for (const bruto of lista(v.messages)) {
          const m = obj(bruto)
          if (!m) continue
          const idExterno = txt(m.id)
          // Sem o número (só o id por empresa, "BR.xxxx", de quem usa nome de
          // usuário e nunca falou com a loja), não há como casar com equipe,
          // cliente ou conversa. Fica de fora, e o log diz.
          const telefone = digitos(m.from)
          if (!idExterno || telefone.length < 10 || telefone.length > 15) {
            eventos.push({ tipo: 'ignorar', motivo: 'sem telefone ou id' })
            continue
          }
          const texto = textoDaMensagem(m)
          if (!texto) {
            eventos.push({ tipo: 'ignorar', motivo: `tipo ${txt(m.type) || '?'} não tratado` })
            continue
          }
          eventos.push({
            tipo: 'mensagem',
            phoneNumberId,
            telefone,
            nome: nomes.get(telefone) ?? null,
            texto,
            idExterno,
            anuncioId: anuncioDaMeta(m.referral),
          })
        }
        for (const bruto of lista(v.statuses)) {
          const s = obj(bruto)
          if (!s) continue
          const st = txt(s.status)
          const erro0 = obj(lista(s.errors)[0])
          eventos.push({
            tipo: 'status',
            phoneNumberId,
            idExterno: txt(s.id),
            status: (['sent', 'delivered', 'read', 'failed', 'played'] as const).find((x) => x === st) ?? 'outro',
            destino: digitos(s.recipient_id) ? mascarar(digitos(s.recipient_id)) : '····',
            erro: erro0
              ? { codigo: typeof erro0.code === 'number' ? erro0.code : null, titulo: txt(erro0.title).slice(0, 120) }
              : null,
          })
        }
        continue
      }

      if (campo === 'smb_message_echoes') {
        // O que a loja mandou pelo app WhatsApp Business, no número que ela
        // também conectou aqui (coexistência). `to` é o cliente.
        if (!numeroOk) continue
        for (const bruto of lista(v.message_echoes)) {
          const m = obj(bruto)
          const telefone = digitos(m?.to)
          if (!m || telefone.length < 10 || telefone.length > 15) continue
          eventos.push({ tipo: 'humano', phoneNumberId, telefone, idExterno: txt(m.id) })
        }
        continue
      }

      if (campo === 'message_template_status_update') {
        eventos.push({
          tipo: 'modelo',
          wabaId,
          nome: txt(v.message_template_name).slice(0, 512),
          idioma: txt(v.message_template_language) || null,
          evento: txt(v.event) || '?',
          motivo: txt(v.reason) && v.reason !== 'NONE' ? txt(v.reason) : null,
        })
        continue
      }

      if (campo === 'account_update') {
        eventos.push({ tipo: 'conta', wabaId, evento: txt(v.event) || '?' })
        continue
      }

      // history, smb_app_state_sync (a sincronização da coexistência) e o
      // resto: o Norte não importa histórico nem agenda de contatos.
      eventos.push({ tipo: 'ignorar', motivo: `campo ${campo || '?'}` })
    }
  }
  return eventos
}

// ─────────────────────────────────────────────────────────────
// A JANELA DE 24 HORAS
// ─────────────────────────────────────────────────────────────

/**
 * A janela de atendimento da Meta: 24 horas desde a ÚLTIMA mensagem que a
 * pessoa mandou para a loja. Dentro dela, texto livre (e grátis); fora, só
 * modelo aprovado. Quem nunca escreveu está fora.
 */
export const JANELA_ATENDIMENTO_MS = 24 * 3_600_000

export function janelaAberta(ultimaEntrada: Date | null | undefined, agora: Date = new Date()): boolean {
  if (!ultimaEntrada) return false
  const passou = agora.getTime() - ultimaEntrada.getTime()
  // Uma folga de um minuto: o nosso relógio de gravação vem DEPOIS do da Meta,
  // e na beirada é melhor usar o modelo do que ver o texto recusado.
  return passou >= -60_000 && passou < JANELA_ATENDIMENTO_MS - 60_000
}

// ─────────────────────────────────────────────────────────────
// OS MODELOS DO NORTE (utilidade, criados na conta da loja ao conectar)
// ─────────────────────────────────────────────────────────────

/**
 * O que cabe numa variável de modelo: sem quebra de linha, sem tabulação, sem
 * mais de quatro espaços seguidos (a Meta recusa o envio inteiro), e curto.
 * As linhas do relatório viram " · ".
 */
export function paraVariavel(texto: string, max = 900): string {
  const limpo = (texto ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' · ')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  if (limpo.length <= max) return limpo || '-'
  return limpo.slice(0, max - 1).trimEnd() + '…'
}

export const NOME_MODELO_RELATORIO = 'norte_relatorio_dia'
export const NOME_MODELO_AVISO = 'norte_aviso'
export const IDIOMA_NORTE = 'pt_BR'

/**
 * Os dois modelos que as rotinas usam quando a dona não escreve há mais de 24
 * horas (o caso comum: o relatório das 8h). Categoria UTILIDADE: é informação
 * da própria conta dela, não propaganda — e utilidade dentro da janela sai de
 * graça. O corpo não começa nem termina com variável (a Meta recusa).
 */
export const MODELOS_NORTE = [
  {
    name: NOME_MODELO_RELATORIO,
    category: 'UTILITY',
    language: IDIOMA_NORTE,
    components: [
      {
        type: 'BODY',
        text:
          'Olá, {{1}}! O resumo de vendas de {{2}} da sua loja está pronto: {{3}}\n\n' +
          'Responda esta mensagem para ver os detalhes com o assistente do Norte.',
        example: {
          body_text: [['Ana', 'ontem', 'R$ 1.250,00 em 14 vendas (+8% sobre anteontem) · Ticket médio: R$ 89,29']],
        },
      },
    ],
  },
  {
    name: NOME_MODELO_AVISO,
    category: 'UTILITY',
    language: IDIOMA_NORTE,
    components: [
      {
        type: 'BODY',
        text: 'Aviso do assistente da {{1}}: {{2}}\n\nResponda esta mensagem para continuar a conversa.',
        example: {
          body_text: [['Loja Centro', '3 peças vão faltar pelo ritmo de venda. A proposta de reposição está na tela do assistente.']],
        },
      },
    ],
  },
] as const

/** O relatório das 8h/20h como modelo: a primeira linha ("Bom dia, Ana…") vira as variáveis 1 e 2. */
export function modeloDoRelatorio(nome: string, quando: 'manha' | 'noite', texto: string): ModeloParaEnvio {
  const corpo = texto.split('\n').slice(1).join('\n')
  return {
    nome: NOME_MODELO_RELATORIO,
    idioma: IDIOMA_NORTE,
    variaveis: [paraVariavel(nome.split(' ')[0] ?? '', 60), quando === 'manha' ? 'ontem' : 'hoje', paraVariavel(corpo)],
  }
}

/** Qualquer aviso para a equipe (vai faltar, cliente sumido, contato pedindo pessoa, teste). */
export function modeloDeAviso(loja: string, texto: string): ModeloParaEnvio {
  return { nome: NOME_MODELO_AVISO, idioma: IDIOMA_NORTE, variaveis: [paraVariavel(loja, 60), paraVariavel(texto)] }
}

// ─────────────────────────────────────────────────────────────
// O CORPO DO QUE SAI (a Cloud API)
// ─────────────────────────────────────────────────────────────

const LIMITE_TEXTO = 4096

export function corpoDeTexto(para: string, texto: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'text',
    text: { preview_url: true, body: texto.slice(0, LIMITE_TEXTO) },
  }
}

/**
 * Mídia POR LINK: o endereço assinado do Norte (/api/midia/..., ver
 * campanhas/midia.ts), que a Meta busca sozinha. Áudio não tem legenda na
 * Cloud API — quem chama manda a legenda como texto à parte.
 *
 * A "nota de voz" (`voice: true`) só vale para OGG/OPUS; o arquivo da loja
 * pode ser MP3, e a Meta recusaria. Sai como áudio comum.
 */
export function corpoDeMidia(para: string, m: MidiaParaEnvio) {
  const tipo = m.tipo === 'imagem' ? 'image' : m.tipo === 'video' ? 'video' : 'audio'
  const midia: Record<string, unknown> = { link: m.url }
  if (tipo !== 'audio' && m.legenda) midia.caption = m.legenda.slice(0, 1024)
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: tipo, [tipo]: midia }
}

/** Um modelo, com as variáveis do corpo na ordem ({{1}}, {{2}}...). */
export function corpoDeModelo(para: string, m: ModeloParaEnvio) {
  const parametros = m.variaveis.map((v) => ({ type: 'text', text: paraVariavel(v, 1024) }))
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'template',
    template: {
      name: m.nome,
      language: { code: m.idioma },
      ...(parametros.length ? { components: [{ type: 'body', parameters: parametros }] } : {}),
    },
  }
}

// ─────────────────────────────────────────────────────────────
// OS ERROS DA GRAPH API
// ─────────────────────────────────────────────────────────────

export type ErroGraph = {
  codigo: CodigoFalha
  /** A frase para a tela e o log. Sem token, sem corpo da Meta — só o código numérico. */
  mensagem: string
  /** Vale tentar de novo daqui a pouco (limite de ritmo, Meta fora do ar). */
  repetir: boolean
  status: number
  codigoMeta: number | null
}

const FRASE_ERRO: Record<number, [CodigoFalha, string, boolean]> = {
  131047: ['janela_fechada', 'A pessoa não escreve para a loja há mais de 24 horas: fora dessa janela o WhatsApp só entrega modelo aprovado.', false],
  131026: ['numero', 'O WhatsApp não entregou para este número (pode não ter WhatsApp, estar numa versão antiga ou não aceitar mensagens da loja).', false],
  131049: ['limite', 'O WhatsApp segurou esta mensagem de marketing: a pessoa já recebeu muitas de empresas hoje.', false],
  131050: ['numero', 'A pessoa pediu para não receber mensagens de marketing desta loja.', false],
  131056: ['limite', 'Mensagens demais para o mesmo número em pouco tempo. Tente de novo em alguns minutos.', true],
  130429: ['limite', 'O WhatsApp está segurando o ritmo de envio desta conta. Tente de novo em instantes.', true],
  131048: ['fornecedor', 'A Meta limitou esta conta por qualidade (muita gente bloqueando ou denunciando).', false],
  132000: ['modelo', 'O número de variáveis não bate com o do modelo aprovado.', false],
  132001: ['modelo', 'O modelo não existe nesse idioma, ou ainda não foi aprovado.', false],
  132005: ['modelo', 'O texto do modelo com as variáveis passou do tamanho que o WhatsApp aceita.', false],
  132007: ['modelo', 'O conteúdo das variáveis fere as regras do WhatsApp.', false],
  132012: ['modelo', 'Alguma variável do modelo está no formato errado.', false],
  132015: ['modelo', 'Este modelo foi pausado pela Meta (baixa qualidade).', false],
  132016: ['modelo', 'Este modelo foi desativado pela Meta.', false],
  133010: ['numero', 'O número da loja ainda não está registrado na Cloud API.', false],
  131031: ['credencial', 'A conta do WhatsApp Business está bloqueada, ou o PIN de verificação em duas etapas não confere.', false],
  131042: ['fornecedor', 'Há um problema de pagamento na conta do WhatsApp Business (no painel da Meta).', false],
  368: ['fornecedor', 'A Meta restringiu esta conta por violar as políticas do WhatsApp.', false],
  190: ['credencial', 'O acesso à conta da Meta expirou ou foi revogado. Conecte de novo pelo WhatsApp oficial.', false],
  200: ['credencial', 'O Norte perdeu a permissão nesta conta da Meta. Conecte de novo pelo WhatsApp oficial.', false],
  10: ['credencial', 'O Norte perdeu a permissão nesta conta da Meta. Conecte de novo pelo WhatsApp oficial.', false],
  3: ['credencial', 'O app do Norte ainda não tem essa permissão na Meta.', false],
  0: ['credencial', 'A Meta não aceitou o acesso guardado. Conecte de novo pelo WhatsApp oficial.', false],
  4: ['limite', 'A Meta está segurando o ritmo de pedidos do Norte. Tente de novo em instantes.', true],
  80007: ['limite', 'A conta do WhatsApp Business chegou ao limite de pedidos. Tente de novo em instantes.', true],
  100: ['fornecedor', 'A Meta recusou o pedido (algum dado fora do formato).', false],
}

/**
 * A resposta de erro da Graph API (`{ error: { code, error_subcode, ... } }`)
 * como a loja entende. A frase é SEMPRE nossa; da Meta só entra o número do
 * código — o `message` dela fica de fora porque não é nosso e não serve à
 * loja (e, se um dia ecoar o pedido, o pedido tem token).
 */
export function lerErroGraph(status: number, corpo: unknown): ErroGraph {
  const e = obj(obj(corpo)?.error)
  const codigoMeta = typeof e?.code === 'number' ? e.code : null
  const conhecido = codigoMeta !== null ? FRASE_ERRO[codigoMeta] : undefined
  if (conhecido) {
    const [codigo, frase, repetir] = conhecido
    return { codigo, mensagem: `${frase} (código ${codigoMeta})`, repetir, status, codigoMeta }
  }
  if (status === 429) {
    return { codigo: 'limite', mensagem: 'A Meta pediu para ir mais devagar. Tente de novo em instantes.', repetir: true, status, codigoMeta }
  }
  if (status === 401 || status === 403) {
    return { codigo: 'credencial', mensagem: `A Meta recusou o acesso guardado (status ${status}). Conecte de novo pelo WhatsApp oficial.`, repetir: false, status, codigoMeta }
  }
  if (status >= 500 || status === 0) {
    return {
      codigo: 'fornecedor',
      mensagem: status === 0 ? 'A Meta não respondeu a tempo.' : `A Meta está com problema agora (status ${status}). Tente de novo em instantes.`,
      repetir: true,
      status,
      codigoMeta,
    }
  }
  return {
    codigo: 'fornecedor',
    mensagem: `A Meta recusou o pedido (status ${status}${codigoMeta !== null ? `, código ${codigoMeta}` : ''}).`,
    repetir: false,
    status,
    codigoMeta,
  }
}

/**
 * Última barreira antes de um log: apaga qualquer coisa com cara de token.
 * O código não loga resposta da Meta nem endereço com segredo — isto existe
 * para o dia em que alguém esquecer.
 */
export function semSegredo(texto: string): string {
  return String(texto ?? '')
    .replace(/(access_token|client_secret|code|input_token)=[^&\s"']+/gi, '$1=[oculto]')
    .replace(/(Bearer|OAuth)\s+[A-Za-z0-9._-]+/g, '$1 [oculto]')
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, '[oculto]')
}

// ─────────────────────────────────────────────────────────────
// O CADASTRO INCORPORADO (Embedded Signup v4)
// ─────────────────────────────────────────────────────────────

// O recado do fim do cadastro é lido também no navegador: mora em
// ./meta-cadastro.ts, que não importa nada do Node.
export { lerFimDoCadastro, origemDaMeta, type FimDoCadastro } from './meta-cadastro'

/** "+55 71 99999-0001" → "(71) 9····-0001". */
export const mascararNumeroMeta = (exibicao: string | null | undefined): string | null =>
  exibicao && exibicao.replace(/\D/g, '').length >= 8 ? mascarar(exibicao) : null

// ─────────────────────────────────────────────────────────────
// OS MODELOS DA LOJA (a tela Campanhas › Modelos)
// ─────────────────────────────────────────────────────────────

export type EntradaModelo = {
  nome: string
  categoria: string
  corpo: string
  /** Um exemplo por variável, na ordem ({{1}}, {{2}}...). */
  exemplos: string[]
  cabecalhoTexto?: string
  /** O "handle" da imagem já enviada à Meta (upload retomável). */
  cabecalhoImagem?: string | null
  rodape?: string
  botoes: string[]
}

/** As variáveis que o texto usa, na ordem em que aparecem ({{1}} → 1). */
export function variaveisDoTexto(texto: string): number[] {
  return [...texto.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)].map((m) => Number(m[1]))
}

/**
 * O pedido de criação de um modelo, conferido antes de ir à Meta: nome no
 * formato dela, variáveis {{1}}..{{n}} em sequência e com exemplo, corpo que
 * não começa nem termina em variável, tamanhos da Meta. O que sai daqui é o
 * corpo pronto do POST /<WABA>/message_templates.
 */
export function montarModelo(e: EntradaModelo): { ok: true; corpo: Record<string, unknown> } | { ok: false; erro: string } {
  const nome = e.nome.trim().toLowerCase().replace(/\s+/g, '_')
  if (!/^[a-z0-9_]{1,512}$/.test(nome)) {
    return { ok: false, erro: 'O nome do modelo só pode ter letras minúsculas sem acento, números e sublinhado (ex.: oferta_de_verao).' }
  }
  if (nome.startsWith('norte_')) return { ok: false, erro: 'Nomes que começam com "norte_" são dos avisos automáticos do Norte. Escolha outro.' }
  const categoria = e.categoria === 'UTILITY' ? 'UTILITY' : e.categoria === 'MARKETING' ? 'MARKETING' : null
  if (!categoria) return { ok: false, erro: 'Escolha a categoria: marketing ou utilidade.' }

  const corpo = e.corpo.replace(/\r/g, '').trim()
  if (!corpo) return { ok: false, erro: 'Escreva o texto da mensagem.' }
  if (corpo.length > 1024) return { ok: false, erro: 'O texto passa de 1.024 letras, o máximo do WhatsApp.' }
  const vars = variaveisDoTexto(corpo)
  const unicas = [...new Set(vars)].sort((a, b) => a - b)
  if (unicas.some((n, i) => n !== i + 1)) {
    return { ok: false, erro: 'As variáveis precisam ser {{1}}, {{2}}, {{3}}... em sequência, sem pular número.' }
  }
  if (/^\{\{\s*\d+\s*\}\}/.test(corpo) || /\{\{\s*\d+\s*\}\}[.!?\s]*$/.test(corpo)) {
    return { ok: false, erro: 'O texto não pode começar nem terminar com uma variável — a Meta recusa. Ponha uma palavra antes ou depois.' }
  }
  const exemplos = e.exemplos.slice(0, unicas.length).map((x) => x.replace(/\s+/g, ' ').trim())
  if (exemplos.length < unicas.length || exemplos.some((x) => !x)) {
    return { ok: false, erro: 'Dê um exemplo para cada variável ({{1}} = "Ana", por exemplo). A Meta usa os exemplos para aprovar.' }
  }

  const componentes: Record<string, unknown>[] = []
  const cabecalhoTexto = (e.cabecalhoTexto ?? '').trim()
  if (e.cabecalhoImagem) {
    componentes.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [e.cabecalhoImagem] } })
  } else if (cabecalhoTexto) {
    if (cabecalhoTexto.length > 60) return { ok: false, erro: 'O título passa de 60 letras.' }
    if (variaveisDoTexto(cabecalhoTexto).length) return { ok: false, erro: 'O título não aceita variável nesta tela.' }
    componentes.push({ type: 'HEADER', format: 'TEXT', text: cabecalhoTexto })
  }
  componentes.push({ type: 'BODY', text: corpo, ...(unicas.length ? { example: { body_text: [exemplos] } } : {}) })
  const rodape = (e.rodape ?? '').trim()
  if (rodape) {
    if (rodape.length > 60) return { ok: false, erro: 'O rodapé passa de 60 letras.' }
    componentes.push({ type: 'FOOTER', text: rodape })
  }
  const botoes = e.botoes.map((b) => b.trim()).filter(Boolean)
  if (botoes.length > 3) return { ok: false, erro: 'No máximo 3 botões de resposta rápida.' }
  if (botoes.some((b) => b.length > 25)) return { ok: false, erro: 'Cada botão tem no máximo 25 letras.' }
  if (new Set(botoes).size !== botoes.length) return { ok: false, erro: 'Dois botões com o mesmo texto.' }
  if (botoes.length) componentes.push({ type: 'BUTTONS', buttons: botoes.map((text) => ({ type: 'QUICK_REPLY', text })) })

  return { ok: true, corpo: { name: nome, category: categoria, language: IDIOMA_NORTE, parameter_format: 'POSITIONAL', components: componentes } }
}

export type ModeloNaConta = {
  id: string
  nome: string
  idioma: string
  categoria: string
  status: string
  motivo: string | null
  corpo: string
  variaveis: number
  cabecalho: string | null
  botoes: string[]
}

/** Um item de GET /<WABA>/message_templates, só com o que a tela usa. */
export function lerModeloDaConta(bruto: unknown): ModeloNaConta | null {
  const t = obj(bruto)
  if (!t) return null
  const nome = txt(t.name)
  if (!nome) return null
  const comps = lista(t.components).map(obj).filter((x): x is Record<string, unknown> => !!x)
  const corpo = txt(comps.find((c) => c.type === 'BODY')?.text)
  const cab = comps.find((c) => c.type === 'HEADER')
  const botoes = lista(comps.find((c) => c.type === 'BUTTONS')?.buttons)
    .map((b) => txt(obj(b)?.text))
    .filter(Boolean)
  const motivo = txt(t.rejected_reason)
  return {
    id: txt(t.id),
    nome,
    idioma: txt(t.language),
    categoria: txt(t.category),
    status: txt(t.status) || '?',
    motivo: motivo && motivo !== 'NONE' ? motivo : null,
    corpo,
    variaveis: new Set(variaveisDoTexto(corpo)).size,
    cabecalho: cab ? (cab.format === 'TEXT' ? txt(cab.text) : `(${txt(cab.format).toLowerCase() || 'mídia'})`) : null,
    botoes,
  }
}

/** Os motivos de recusa da Meta, em português. */
export const MOTIVO_RECUSA: Record<string, string> = {
  INVALID_FORMAT: 'formato inválido',
  PROMOTIONAL: 'conteúdo promocional numa categoria que não é marketing',
  ABUSIVE_CONTENT: 'conteúdo abusivo',
  INCORRECT_CATEGORY: 'categoria errada',
  SCAM: 'parece golpe',
  TAG_CONTENT_MISMATCH: 'o texto não combina com a categoria',
  CATEGORY_NOT_AVAILABLE: 'categoria indisponível',
}
