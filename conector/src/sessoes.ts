// Uma conexão de WhatsApp por empresa, viva enquanto o conector estiver no ar.
//
// ── os estados, como a tela do Norte mostra ──────────────────
//   desconectado   nada ligado (nunca conectou, desistiu do QR, ou saiu)
//   aguardando_qr  há um QR na tela esperando o celular ler
//   conectando     abrindo (ou reabrindo) a conexão com a sessão guardada
//   conectado      pronto: recebe e manda
//   expulso        o celular desconectou o Norte (Aparelhos conectados ›
//                  Desconectar), ou o WhatsApp recusou o número. Só volta
//                  com QR novo.
//
// ── quando reconecta sozinho ─────────────────────────────────
// Queda de rede, reinício pedido pelo WhatsApp, servidor do WhatsApp fora:
// reconecta, com espera crescente (2 s, 4 s, ... até 1 min). Nunca sem
// credencial: um QR que ninguém leu expira e fica "desconectado" — quem quer
// outro clica de novo. E nunca quando o próprio celular expulsou.
//
// ── o que fica no disco ──────────────────────────────────────
// Só a LISTA de empresas conectadas (ids), para religar depois de reiniciar.
// Credencial nenhuma: a sessão mora cifrada no Norte (ver autenticacao.ts).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type AnyMessageContent,
  type WASocket,
} from '@whiskeysockets/baileys'
import { pino } from 'pino'
import QRCode from 'qrcode'
import { GuardaDaSessao } from './autenticacao'
import type { Config } from './config'
import { finalDoNumero, log, mascararNumero, resumoDoErro } from './log'
import type { ClienteNorte } from './norte'
import { ehLid, normalizar, telefoneDoJid, type MensagemBruta } from './normalizar'
import { Fila, Ritmo, tempoDigitando } from './ritmo'

export type Estado = 'desconectado' | 'aguardando_qr' | 'conectando' | 'conectado' | 'expulso'

export type Retrato = {
  estado: Estado
  /** O QR como imagem PNG (data URL), só em `aguardando_qr`. */
  qr: string | null
  /** O número conectado, mascarado: "(71) •••••-1234". */
  numero: string | null
  motivo: string | null
}

export type Midia = { tipo: 'imagem' | 'video' | 'audio'; url: string; legenda?: string; comoGravado?: boolean }
export type Conteudo = { texto: string } | { midia: Midia }

export type Envio = { ok: true; id: string | null } | { ok: false; motivo: string; status: number }

const silencioso = pino({ level: 'silent' })

// ─────────────────────────────────────────────────────────────
// A LISTA DE EMPRESAS (só ids)
// ─────────────────────────────────────────────────────────────

class ListaDeEmpresas {
  private ids = new Set<string>()
  private arquivo: string

  constructor(private readonly pasta: string) {
    this.arquivo = join(pasta, 'empresas.json')
  }

  async carregar(): Promise<string[]> {
    try {
      const v = JSON.parse(await readFile(this.arquivo, 'utf8')) as unknown
      if (Array.isArray(v)) for (const id of v) if (typeof id === 'string' && ID_EMPRESA.test(id)) this.ids.add(id)
    } catch {
      // primeira vez, ou arquivo perdido: começa vazia
    }
    return [...this.ids]
  }

  async incluir(id: string) {
    if (this.ids.has(id)) return
    this.ids.add(id)
    await this.salvar()
  }

  async tirar(id: string) {
    if (!this.ids.delete(id)) return
    await this.salvar()
  }

  private async salvar() {
    await mkdir(this.pasta, { recursive: true })
    const tmp = this.arquivo + '.tmp'
    await writeFile(tmp, JSON.stringify([...this.ids]), 'utf8')
    await rename(tmp, this.arquivo)
  }
}

/** Id de empresa do Norte (cuid, ou os ids curtos do exemplo local). */
export const ID_EMPRESA = /^[A-Za-z0-9_-]{1,64}$/

// ─────────────────────────────────────────────────────────────
// UMA EMPRESA
// ─────────────────────────────────────────────────────────────

/** Um conjunto que esquece os mais velhos: os ids que o conector mandou. */
class Lembrados {
  private s = new Set<string>()
  constructor(private readonly maximo = 5_000) {}
  add(id: string) {
    this.s.add(id)
    if (this.s.size > this.maximo) this.s.delete(this.s.values().next().value!)
  }
  has(id: string) {
    return this.s.has(id)
  }
}

class SessaoDaEmpresa {
  estado: Estado = 'desconectado'
  motivo: string | null = null
  private qrBruto: string | null = null
  private qrImagem: string | null = null
  private numero: string | null = null
  private sock: WASocket | null = null
  private guarda: GuardaDaSessao | null = null
  private tentativas = 0
  private religar: NodeJS.Timeout | null = null
  private abrindo: Promise<void> | null = null
  private parando = false
  private readonly ritmo: Ritmo
  private readonly fila: Fila
  private readonly enviadas = new Lembrados()
  private readonly existe = new Map<string, { jid: string | null; em: number }>()

  constructor(
    readonly orgId: string,
    private readonly cfg: Config,
    private readonly norte: ClienteNorte,
    private readonly lista: ListaDeEmpresas,
  ) {
    this.ritmo = new Ritmo(cfg.ritmo)
    this.fila = new Fila(cfg.filaMaxima)
  }

  get temQr(): boolean {
    return this.qrBruto !== null
  }

  async retrato(): Promise<Retrato> {
    if (this.estado === 'aguardando_qr' && this.qrBruto && !this.qrImagem) {
      this.qrImagem = await QRCode.toDataURL(this.qrBruto, { margin: 2, width: 360, errorCorrectionLevel: 'M' })
    }
    return {
      estado: this.estado,
      qr: this.estado === 'aguardando_qr' ? this.qrImagem : null,
      numero: this.estado === 'conectado' ? mascararNumero(this.numero) : null,
      motivo: this.motivo,
    }
  }

  /**
   * Liga (ou religa). `permitirQr` falso = só se já houver credencial: é o
   * religar automático, que nunca deve fazer aparecer QR sem ninguém pedir.
   */
  iniciar(permitirQr: boolean): Promise<void> {
    if (this.sock || this.abrindo) return this.abrindo ?? Promise.resolve()
    this.abrindo = this.abrir(permitirQr).finally(() => {
      this.abrindo = null
    })
    return this.abrindo
  }

  private async abrir(permitirQr: boolean) {
    this.parando = false
    this.motivo = null
    if (this.religar) clearTimeout(this.religar)
    this.religar = null
    try {
      this.guarda ??= await GuardaDaSessao.abrir(this.orgId, this.norte)
    } catch (e) {
      this.estado = 'desconectado'
      this.motivo = 'O conector não conseguiu ler a sessão guardada no Norte.'
      log.erro('sessao.ler_falhou', { orgId: this.orgId, erro: resumoDoErro(e) })
      return
    }
    if (!permitirQr && !this.guarda.temCredenciais) {
      this.estado = 'desconectado'
      return
    }
    this.estado = this.guarda.temCredenciais ? 'conectando' : 'aguardando_qr'
    await this.criarSocket()
  }

  private async criarSocket() {
    const guarda = this.guarda!
    // A versão do WhatsApp Web muda; com a velha, o WhatsApp recusa a conexão.
    const versao = await fetchLatestBaileysVersion()
      .then((v) => v.version)
      .catch(() => undefined)

    const sock = makeWASocket({
      ...(versao ? { version: versao } : {}),
      auth: { creds: guarda.estado.creds, keys: makeCacheableSignalKeyStore(guarda.estado.keys, silencioso) },
      logger: silencioso,
      // Como aparece no celular, em Aparelhos conectados.
      browser: Browsers.ubuntu('Norte'),
      // Sem "online" permanente: o celular da loja continua recebendo as
      // notificações, como se o computador estivesse fechado.
      markOnlineOnConnect: false,
      // O histórico antigo não interessa (e seria um caminhão de dados).
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    })
    this.sock = sock

    sock.ev.on('creds.update', () => guarda.marcar())

    sock.ev.on('connection.update', (u) => {
      if (this.sock !== sock) return
      if (u.qr) {
        this.estado = 'aguardando_qr'
        this.qrBruto = u.qr
        this.qrImagem = null
        log.info('sessao.qr', { orgId: this.orgId })
      }
      if (u.connection === 'connecting' && this.estado !== 'aguardando_qr') this.estado = 'conectando'
      if (u.connection === 'open') {
        this.estado = 'conectado'
        this.motivo = null
        this.qrBruto = null
        this.qrImagem = null
        this.tentativas = 0
        this.numero = telefoneDoJid(sock.user?.id) ?? null
        log.info('sessao.conectada', { orgId: this.orgId, numero: finalDoNumero(this.numero) })
        void guarda.gravarAgora()
        void this.lista.incluir(this.orgId).catch((e) => log.erro('lista.falhou', { erro: resumoDoErro(e) }))
      }
      if (u.connection === 'close') {
        const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
        void this.fechou(sock, codigo)
      }
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      // 'notify' = chegou agora. 'append' é o que o próprio conector mandou,
      // ou histórico — nada disso é conversa nova.
      if (type !== 'notify') return
      for (const m of messages) void this.recebeu(sock, m as MensagemBruta)
    })
  }

  private async fechou(sock: WASocket, codigo: number | undefined) {
    if (this.sock !== sock) return
    this.sock = null
    this.qrBruto = null
    this.qrImagem = null
    const guarda = this.guarda
    log.info('sessao.fechou', { orgId: this.orgId, codigo: codigo ?? null })
    if (this.parando) return

    if (codigo === DisconnectReason.loggedOut || codigo === DisconnectReason.forbidden) {
      // O celular tirou o Norte de Aparelhos conectados (ou o WhatsApp
      // recusou o número). A sessão não vale mais: apaga, e só QR novo.
      this.estado = 'expulso'
      this.motivo =
        codigo === DisconnectReason.forbidden
          ? 'O WhatsApp recusou este número. Confira o celular da loja.'
          : 'O celular desconectou o Norte (Aparelhos conectados). Conecte de novo pelo QR Code.'
      this.guarda = null
      this.numero = null
      await guarda?.apagar().catch((e) => log.erro('sessao.apagar_falhou', { orgId: this.orgId, erro: resumoDoErro(e) }))
      await this.lista.tirar(this.orgId).catch(() => undefined)
      return
    }

    if (codigo === DisconnectReason.connectionReplaced) {
      // Outra conexão com a MESMA sessão (dois conectores ligados?). Religar
      // aqui viraria briga de quem derruba quem; fica parado e avisa.
      this.estado = 'desconectado'
      this.motivo = 'Outra conexão assumiu este WhatsApp. Conecte de novo se foi engano.'
      log.aviso('sessao.substituida', { orgId: this.orgId })
      return
    }

    if (!guarda?.temCredenciais) {
      // O QR expirou sem ninguém ler. Quem quiser outro clica de novo.
      this.estado = 'desconectado'
      this.motivo = codigo === DisconnectReason.timedOut ? 'O QR Code expirou. Clique para gerar outro.' : null
      this.guarda = null
      return
    }

    // Queda comum, ou o reinício que o WhatsApp pede logo depois do QR:
    // religa, com espera crescente (o 515 religa na hora).
    this.estado = 'conectando'
    const espera = codigo === DisconnectReason.restartRequired ? 0 : Math.min(60_000, 2_000 * 2 ** Math.min(this.tentativas, 5))
    this.tentativas++
    this.religar = setTimeout(() => {
      this.religar = null
      if (!this.parando && !this.sock) void this.criarSocket().catch((e) => log.erro('sessao.religar_falhou', { orgId: this.orgId, erro: resumoDoErro(e) }))
    }, espera)
  }

  private async recebeu(sock: WASocket, m: MensagemBruta) {
    try {
      let telefoneDoLid: string | null = null
      const jid = m.key?.remoteJid
      if (ehLid(jid) && !telefoneDoJid(m.key?.remoteJidAlt)) {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(jid!).catch(() => null)
        telefoneDoLid = telefoneDoJid(pn) ?? (pn ? pn.split('@')[0]!.split(':')[0]! : null)
      }
      const n = normalizar(m, {
        agora: Date.now(),
        meuNumero: this.numero,
        enviadas: this.enviadas,
        idadeMaximaMs: this.cfg.idadeMaximaMs,
        telefoneDoLid,
      })
      if (n.tipo === 'ignorar') return
      // Três tentativas: o Norte pode estar reiniciando. A mensagem é gravada
      // pelo id lá dentro, então entregar duas vezes não duplica nada.
      for (let i = 0; i < 3; i++) {
        try {
          if (await this.norte.entregar(this.orgId, n)) return
        } catch {
          // tenta de novo
        }
        await dormir(1_000 * 3 ** i)
      }
      log.erro('mensagem.entrega_falhou', { orgId: this.orgId, de: finalDoNumero(n.telefone) })
    } catch (e) {
      log.erro('mensagem.falhou', { orgId: this.orgId, erro: resumoDoErro(e) })
    }
  }

  /** O JID de um número, conferindo que ele tem WhatsApp (cache de um dia). */
  private async jidDe(sock: WASocket, numero: string): Promise<string | null> {
    const c = this.existe.get(numero)
    if (c && Date.now() - c.em < 24 * 3_600_000) return c.jid
    const r = await sock.onWhatsApp(numero)
    const achado = r?.find((x) => x.exists)
    const jid = achado ? achado.jid : null
    this.existe.set(numero, { jid, em: Date.now() })
    return jid
  }

  async enviar(numero: string, conteudo: Conteudo): Promise<Envio> {
    if (this.estado !== 'conectado' || !this.sock) {
      return { ok: false, motivo: 'o WhatsApp desta empresa não está conectado', status: 409 }
    }
    const vez = this.fila.entrar(async (): Promise<Envio> => {
      // A vez de mandar: respeita o intervalo e os tetos (ver ritmo.ts).
      for (;;) {
        const v = this.ritmo.vez(numero)
        if (!v.ok) return { ok: false, motivo: 'limite diário de envios deste número', status: 429 }
        if (v.esperarMs <= 0) break
        await dormir(v.esperarMs)
      }
      const sock = this.sock
      if (!sock || this.estado !== 'conectado') return { ok: false, motivo: 'a conexão caiu antes do envio', status: 409 }

      const jid = await this.jidDe(sock, numero)
      if (!jid) return { ok: false, motivo: 'este número não tem WhatsApp', status: 422 }

      const mensagem = montar(conteudo)
      // "digitando…" (ou "gravando áudio…") pelo tempo que uma pessoa levaria.
      const gravando = 'midia' in conteudo && conteudo.midia.tipo === 'audio' && conteudo.midia.comoGravado
      const espera = 'texto' in conteudo ? tempoDigitando(conteudo.texto) : 2_000 + Math.round(Math.random() * 2_000)
      await sock.presenceSubscribe(jid).catch(() => undefined)
      await sock.sendPresenceUpdate(gravando ? 'recording' : 'composing', jid).catch(() => undefined)
      await dormir(espera)
      await sock.sendPresenceUpdate('paused', jid).catch(() => undefined)

      const r = await sock.sendMessage(jid, mensagem)
      this.ritmo.registrar(numero)
      const id = r?.key?.id ?? null
      if (id) this.enviadas.add(id)
      return { ok: true, id }
    })
    if (!vez) return { ok: false, motivo: 'fila de envio cheia; tente de novo em instantes', status: 429 }
    try {
      return await vez
    } catch (e) {
      log.erro('envio.falhou', { orgId: this.orgId, para: finalDoNumero(numero), erro: resumoDoErro(e) })
      return { ok: false, motivo: 'o WhatsApp não aceitou o envio', status: 502 }
    }
  }

  /** Sai de verdade: desconecta o aparelho no celular e apaga a sessão. */
  async sair(): Promise<void> {
    this.parando = true
    if (this.religar) clearTimeout(this.religar)
    this.religar = null
    const sock = this.sock
    const guarda = this.guarda
    this.sock = null
    this.guarda = null
    this.estado = 'desconectado'
    this.motivo = null
    this.numero = null
    this.qrBruto = null
    this.qrImagem = null
    if (sock) {
      await sock.logout().catch(() => undefined)
      await sock.end(undefined).catch(() => undefined)
    }
    // Apagar no Norte é garantia a mais: quem pediu a saída (o Norte) apaga do
    // lado dele também. Falhou aqui? Registra e segue — o aparelho já saiu.
    await (guarda ? guarda.apagar() : this.norte.apagarSessao(this.orgId)).catch((e) =>
      log.aviso('sessao.apagar_falhou', { orgId: this.orgId, erro: resumoDoErro(e) }),
    )
    await this.lista.tirar(this.orgId)
  }

  /** O conector vai desligar: grava a sessão e fecha, SEM desconectar o aparelho. */
  async encerrar(): Promise<void> {
    this.parando = true
    if (this.religar) clearTimeout(this.religar)
    const sock = this.sock
    this.sock = null
    await this.guarda?.encerrar()
    if (sock) await sock.end(undefined).catch(() => undefined)
  }

  /** Espera ficar conectado (ou desistir). */
  async esperarConectar(ms: number): Promise<boolean> {
    const ate = Date.now() + ms
    while (Date.now() < ate) {
      if (this.estado === 'conectado') return true
      if (this.estado === 'desconectado' || this.estado === 'expulso' || this.estado === 'aguardando_qr') return false
      await dormir(250)
    }
    return this.estado === 'conectado'
  }
}

function tipoDoAudio(url: string): string {
  const u = url.toLowerCase().split('?')[0]!
  if (u.endsWith('.ogg') || u.endsWith('.opus')) return 'audio/ogg; codecs=opus'
  if (u.endsWith('.mp3')) return 'audio/mpeg'
  return 'audio/mp4'
}

function montar(c: Conteudo): AnyMessageContent {
  if ('texto' in c) return { text: c.texto }
  const { tipo, url, legenda, comoGravado } = c.midia
  if (tipo === 'imagem') return { image: { url }, ...(legenda ? { caption: legenda } : {}) }
  if (tipo === 'video') return { video: { url }, ...(legenda ? { caption: legenda } : {}) }
  return { audio: { url }, mimetype: comoGravado ? 'audio/ogg; codecs=opus' : tipoDoAudio(url), ptt: !!comoGravado }
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ─────────────────────────────────────────────────────────────
// TODAS AS EMPRESAS
// ─────────────────────────────────────────────────────────────

export class Sessoes {
  private mapa = new Map<string, SessaoDaEmpresa>()
  private lista: ListaDeEmpresas

  constructor(
    private readonly cfg: Config,
    private readonly norte: ClienteNorte,
  ) {
    this.lista = new ListaDeEmpresas(cfg.pastaDados)
  }

  private da(orgId: string): SessaoDaEmpresa {
    let s = this.mapa.get(orgId)
    if (!s) {
      s = new SessaoDaEmpresa(orgId, this.cfg, this.norte, this.lista)
      this.mapa.set(orgId, s)
    }
    return s
  }

  /** Religa, uma a uma, as empresas que estavam conectadas antes de reiniciar. */
  async religarTodas(): Promise<void> {
    const ids = await this.lista.carregar()
    log.info('conector.religando', { empresas: ids.length })
    for (const id of ids) {
      await this.da(id).iniciar(false).catch((e) => log.erro('sessao.religar_falhou', { orgId: id, erro: resumoDoErro(e) }))
      await dormir(1_000)
    }
  }

  async iniciar(orgId: string): Promise<Retrato> {
    const s = this.da(orgId)
    await s.iniciar(true)
    // Dá um instante (até 5 s) para o primeiro QR aparecer, e a tela já
    // abrir com ele. Quem já tem sessão guardada volta em "conectando".
    for (let i = 0; i < 20 && s.estado === 'aguardando_qr' && !s.temQr; i++) await dormir(250)
    return s.retrato()
  }

  async retrato(orgId: string): Promise<Retrato> {
    const s = this.mapa.get(orgId)
    return s ? s.retrato() : { estado: 'desconectado', qr: null, numero: null, motivo: null }
  }

  async sair(orgId: string): Promise<Retrato> {
    await this.da(orgId).sair()
    this.mapa.delete(orgId)
    return { estado: 'desconectado', qr: null, numero: null, motivo: null }
  }

  async enviar(orgId: string, numero: string, conteudo: Conteudo): Promise<Envio> {
    const s = this.da(orgId)
    if (s.estado !== 'conectado') {
      // Conector reiniciado e esta empresa ainda não religou? Tenta religar
      // com a sessão guardada — nunca com QR.
      if (s.estado === 'desconectado') await s.iniciar(false)
      await s.esperarConectar(15_000)
    }
    return s.enviar(numero, conteudo)
  }

  contagem() {
    let conectadas = 0
    for (const s of this.mapa.values()) if (s.estado === 'conectado') conectadas++
    return { sessoes: this.mapa.size, conectadas }
  }

  async encerrarTodas(): Promise<void> {
    for (const s of this.mapa.values()) await s.encerrar().catch(() => undefined)
  }
}
