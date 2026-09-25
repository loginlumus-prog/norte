// O conector do Norte: o WhatsApp de cada loja, conectado por QR Code.
//
// Um serviço separado, sempre ligado, porque o WhatsApp Web é uma conexão
// ABERTA o tempo todo — coisa que o Norte (que pode dormir, escalar, reiniciar
// a cada deploy) não segura. Ver README.md, seção "Conector do WhatsApp".
//
// ── a API (interna; todo pedido com Authorization: Bearer <CONECTOR_SEGREDO>)
//   POST /sessoes/:orgId/iniciar   liga (ou retoma) — devolve o estado
//   GET  /sessoes/:orgId           o estado; com o QR (PNG em data URL) quando
//                                  aguardando_qr; o número mascarado
//   POST /sessoes/:orgId/sair      desconecta o aparelho e apaga a sessão
//   POST /sessoes/:orgId/enviar    { numero, texto } ou { numero, midia }
//   GET  /saude                    está vivo? quantas conectadas?
//
// NÃO existe envio em massa, e é de propósito: um destino por pedido, e cada
// pedido na fila do número, no ritmo de uma pessoa (ver ritmo.ts).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { conferirPortador } from './assinatura'
import { lerConfig } from './config'
import { log, resumoDoErro } from './log'
import { ClienteNorte } from './norte'
import { ID_EMPRESA, Sessoes, type Conteudo, type Midia } from './sessoes'
import { ligarRelogio, type Relogio } from './relogio'

const lido = lerConfig(process.env)
if (!lido.ok) {
  for (const e of lido.erros) log.erro('config.invalida', { problema: e })
  process.exit(1)
}
const cfg = lido.config
const norte = new ClienteNorte(cfg.norteUrl, cfg.segredo)
const sessoes = new Sessoes(cfg, norte)

const MAXIMO_CORPO = 64 * 1024
const MAXIMO_TEXTO = 4_000

function responder(res: ServerResponse, status: number, corpo: unknown) {
  const bruto = JSON.stringify(corpo)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(bruto)
}

async function lerCorpo(req: IncomingMessage): Promise<unknown> {
  const pedacos: Buffer[] = []
  let total = 0
  for await (const p of req) {
    total += (p as Buffer).length
    if (total > MAXIMO_CORPO) throw new Error('corpo grande demais')
    pedacos.push(p as Buffer)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(pedacos).toString('utf8'))
}

/** O que o Norte pediu para mandar, conferido campo a campo. */
function lerEnvio(c: unknown): { numero: string; conteudo: Conteudo } | { erro: string } {
  if (!c || typeof c !== 'object') return { erro: 'corpo vazio' }
  const o = c as Record<string, unknown>
  const numero = typeof o.numero === 'string' ? o.numero.replace(/\D/g, '') : ''
  if (numero.length < 10 || numero.length > 15) return { erro: 'número inválido' }
  if (typeof o.texto === 'string') {
    const texto = o.texto.trim()
    if (!texto) return { erro: 'texto vazio' }
    return { numero, conteudo: { texto: texto.slice(0, MAXIMO_TEXTO) } }
  }
  const m = o.midia as Record<string, unknown> | undefined
  if (m && typeof m === 'object') {
    const tipo = m.tipo
    if (tipo !== 'imagem' && tipo !== 'video' && tipo !== 'audio') return { erro: 'tipo de mídia inválido' }
    let url: URL
    try {
      url = new URL(String(m.url ?? ''))
    } catch {
      return { erro: 'endereço da mídia inválido' }
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { erro: 'endereço da mídia inválido' }
    const midia: Midia = {
      tipo,
      url: url.toString(),
      ...(typeof m.legenda === 'string' && m.legenda.trim() ? { legenda: m.legenda.trim().slice(0, 1_000) } : {}),
      ...(m.comoGravado === true ? { comoGravado: true } : {}),
    }
    return { numero, conteudo: { midia } }
  }
  return { erro: 'mande texto ou mídia' }
}

const servidor = createServer(async (req, res) => {
  const inicio = Date.now()
  const url = new URL(req.url ?? '/', 'http://conector')
  const partes = url.pathname.split('/').filter(Boolean)
  let status = 500
  try {
    // Todo pedido, inclusive a saúde: o conector não conversa com estranho.
    if (!conferirPortador(cfg.segredo, req.headers.authorization)) {
      status = 401
      return responder(res, 401, { ok: false })
    }

    if (req.method === 'GET' && url.pathname === '/saude') {
      status = 200
      return responder(res, 200, { ok: true, ...sessoes.contagem() })
    }

    if (partes[0] === 'sessoes' && partes[1] && ID_EMPRESA.test(partes[1])) {
      const orgId = partes[1]
      const acao = partes[2] ?? null

      if (req.method === 'GET' && acao === null) {
        status = 200
        return responder(res, 200, await sessoes.retrato(orgId))
      }
      if (req.method === 'POST' && acao === 'iniciar') {
        status = 200
        return responder(res, 200, await sessoes.iniciar(orgId))
      }
      if (req.method === 'POST' && acao === 'sair') {
        status = 200
        return responder(res, 200, await sessoes.sair(orgId))
      }
      if (req.method === 'POST' && acao === 'enviar') {
        const pedido = lerEnvio(await lerCorpo(req))
        if ('erro' in pedido) {
          status = 400
          return responder(res, 400, { ok: false, motivo: pedido.erro })
        }
        const r = await sessoes.enviar(orgId, pedido.numero, pedido.conteudo)
        status = r.ok ? 200 : r.status
        return responder(res, status, r.ok ? { ok: true, id: r.id } : { ok: false, motivo: r.motivo })
      }
    }
    status = 404
    return responder(res, 404, { ok: false })
  } catch (e) {
    status = e instanceof SyntaxError || (e instanceof Error && e.message === 'corpo grande demais') ? 400 : 500
    log.erro('http.falhou', { rota: rotaParaLog(partes), erro: resumoDoErro(e) })
    if (!res.headersSent) responder(res, status, { ok: false })
  } finally {
    // Sem corpo, sem cabeçalho, sem número: método, rota, status e tempo.
    if (url.pathname !== '/saude') log.info('http', { metodo: req.method, rota: rotaParaLog(partes), status, ms: Date.now() - inicio })
  }
})

/** "/sessoes/<id>/enviar" — o id da empresa é nosso, e ajuda o suporte. */
const rotaParaLog = (partes: string[]) => '/' + partes.slice(0, 3).join('/')

servidor.requestTimeout = 180_000
// O relógio das campanhas (minuto a minuto) e das rotinas (de hora em hora).
// Ver relogio.ts — sem ROTINAS_SEGREDO, fica desligado.
let relogio: Relogio | null = null
servidor.listen(cfg.porta, cfg.host, () => {
  log.info('conector.no_ar', { porta: cfg.porta, host: cfg.host })
  void sessoes.religarTodas()
  relogio = ligarRelogio(cfg.norteUrl, process.env.ROTINAS_SEGREDO)
})

// ── desligar sem perder sessão ───────────────────────────────
// O deploy (ou o systemd) manda SIGTERM. Antes de sair: para de aceitar
// pedido, grava a sessão de cada empresa no Norte, e fecha as conexões SEM
// desconectar o aparelho — na volta, religa sem QR.
let desligando = false
async function desligar(sinal: string) {
  if (desligando) return
  desligando = true
  log.info('conector.desligando', { sinal })
  const limite = setTimeout(() => {
    log.aviso('conector.desligou_na_marra', {})
    process.exit(1)
  }, 15_000)
  relogio?.parar()
  servidor.close()
  await sessoes.encerrarTodas()
  clearTimeout(limite)
  log.info('conector.desligado', {})
  process.exit(0)
}
process.on('SIGTERM', () => void desligar('SIGTERM'))
process.on('SIGINT', () => void desligar('SIGINT'))
process.on('unhandledRejection', (e) => log.erro('promessa.sem_dono', { erro: resumoDoErro(e) }))
