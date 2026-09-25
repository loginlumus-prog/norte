// A sessão do WhatsApp de uma empresa, guardada no Norte — nunca no disco.
//
// O Baileys precisa de dois guardados: as CREDENCIAIS (quem é este aparelho
// conectado) e as CHAVES do Signal (uma por contato com quem já se falou, e
// um estoque de pré-chaves). Perder as chaves é pior do que parece: a
// mensagem sai, mas o outro lado não consegue abrir. Por isso toda mudança é
// gravada — só que não a cada mudança, que viriam dezenas por segundo numa
// conversa movimentada:
//
//   • a sessão inteira mora em memória, e é a memória que o Baileys consulta;
//   • a cada mudança, marca "sujo" e agenda uma gravação para daqui a 3 s,
//     juntando tudo o que mudar nesse meio tempo (no máximo 10 s de atraso);
//   • a gravação manda o pacote inteiro — JSON do jeito do Baileys, em gzip,
//     em base64 — para o Norte, que cifra com a chave dele e guarda;
//   • o Norte falhou? Fica sujo, e tenta de novo, com espera crescente;
//   • desligando o conector: grava o que estiver sujo antes de sair.
//
// Cada pacote leva uma VERSÃO (carimbo em ms, sempre crescente). O Norte
// recusa versão mais velha que a guardada: um pedido repetido ou atrasado não
// volta a sessão para trás.

import { gunzipSync, gzipSync } from 'node:zlib'
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys'
import type { ClienteNorte } from './norte'
import { log, resumoDoErro } from './log'

type Chaves = { [T in keyof SignalDataTypeMap]?: Record<string, SignalDataTypeMap[T]> }

type Pacote = { creds: AuthenticationCreds; chaves: Chaves }

export function empacotar(p: Pacote): string {
  return gzipSync(Buffer.from(JSON.stringify(p, BufferJSON.replacer), 'utf8')).toString('base64')
}

export function desempacotar(dados: string): Pacote {
  const p = JSON.parse(gunzipSync(Buffer.from(dados, 'base64')).toString('utf8'), BufferJSON.reviver) as Partial<Pacote>
  if (!p || typeof p !== 'object' || !p.creds) throw new Error('pacote de sessão sem credenciais')
  return { creds: p.creds, chaves: p.chaves ?? {} }
}

const ESPERA_MS = 3_000
const ATRASO_MAXIMO_MS = 10_000

export class GuardaDaSessao {
  private sujo = false
  private primeiroSujoEm = 0
  private timer: NodeJS.Timeout | null = null
  private gravando: Promise<void> | null = null
  private falhas = 0
  private encerrada = false

  private constructor(
    private readonly orgId: string,
    private readonly norte: ClienteNorte,
    readonly creds: AuthenticationCreds,
    private readonly chaves: Chaves,
    private versao: number,
  ) {}

  /** Lê a sessão do Norte; sem nenhuma, começa uma nova (que vai pedir QR). */
  static async abrir(orgId: string, norte: ClienteNorte): Promise<GuardaDaSessao> {
    const guardada = await norte.lerSessao(orgId)
    if (!guardada) return new GuardaDaSessao(orgId, norte, initAuthCreds(), {}, 0)
    const p = desempacotar(guardada.dados)
    return new GuardaDaSessao(orgId, norte, p.creds, p.chaves, guardada.versao)
  }

  /** Já leu um QR alguma vez: dá para reconectar sem pedir outro. */
  get temCredenciais(): boolean {
    return !!this.creds.me?.id
  }

  /** O que se entrega ao `makeWASocket`. */
  get estado(): AuthenticationState {
    return {
      creds: this.creds,
      keys: {
        get: async (tipo, ids) => {
          const cat = (this.chaves[tipo] ?? {}) as Record<string, unknown>
          const r: Record<string, unknown> = {}
          for (const id of ids) {
            let v = cat[id]
            if (v === undefined || v === null) continue
            if (tipo === 'app-state-sync-key') v = proto.Message.AppStateSyncKeyData.fromObject(v as object)
            r[id] = v
          }
          return r as { [id: string]: SignalDataTypeMap[typeof tipo] }
        },
        set: async (dados: SignalDataSet) => {
          for (const tipo of Object.keys(dados) as (keyof SignalDataTypeMap)[]) {
            const novos = dados[tipo]
            if (!novos) continue
            const cat = ((this.chaves[tipo] as Record<string, unknown> | undefined) ??= {}) as Record<string, unknown>
            for (const [id, v] of Object.entries(novos)) {
              if (v === null || v === undefined) delete cat[id]
              else cat[id] = v
            }
          }
          this.marcar()
        },
      },
    }
  }

  /** Algo mudou: agenda a gravação, juntando as próximas mudanças. */
  marcar(): void {
    if (this.encerrada) return
    const agora = Date.now()
    if (!this.sujo) this.primeiroSujoEm = agora
    this.sujo = true
    if (this.timer) clearTimeout(this.timer)
    const atraso = Math.max(0, Math.min(ESPERA_MS, this.primeiroSujoEm + ATRASO_MAXIMO_MS - agora))
    this.timer = setTimeout(() => void this.gravarAgora(), atraso)
  }

  /** Grava já o que estiver pendente (e espera a gravação em curso). */
  async gravarAgora(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.gravando) await this.gravando
    if (!this.sujo) return
    // Antes de alguém ler o QR, a sessão é só um rascunho: não vale guardar
    // (e o Norte não precisa de lixo de quem clicou e desistiu). No momento
    // da leitura as credenciais ganham o `me`, e o pacote inteiro — com as
    // chaves geradas antes — vai de uma vez.
    if (!this.temCredenciais) return
    this.sujo = false
    this.gravando = this.gravar().finally(() => {
      this.gravando = null
    })
    await this.gravando
  }

  private async gravar() {
    this.versao = Math.max(Date.now(), this.versao + 1)
    try {
      const r = await this.norte.gravarSessao(this.orgId, empacotar({ creds: this.creds, chaves: this.chaves }), this.versao)
      if (r === 'velha') log.aviso('sessao.versao_velha', { orgId: this.orgId })
      this.falhas = 0
    } catch (e) {
      // Não perde a mudança: volta a ficar sujo e tenta de novo mais tarde.
      this.falhas++
      this.sujo = true
      this.primeiroSujoEm = Date.now()
      const espera = Math.min(60_000, 5_000 * 2 ** Math.min(this.falhas - 1, 4))
      log.erro('sessao.gravar_falhou', { orgId: this.orgId, erro: resumoDoErro(e), tentarEmMs: espera })
      if (!this.encerrada) {
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.gravarAgora(), espera)
      }
    }
  }

  /** Esquece a sessão: no Norte e na memória. Depois disto, só com QR novo. */
  async apagar(): Promise<void> {
    this.encerrada = true
    this.sujo = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.gravando) await this.gravando.catch(() => undefined)
    await this.norte.apagarSessao(this.orgId)
  }

  /** Para de agendar (o conector vai desligar); grava o pendente antes. */
  async encerrar(): Promise<void> {
    await this.gravarAgora().catch(() => undefined)
    this.encerrada = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
