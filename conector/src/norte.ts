// O conector falando com o Norte: entregar mensagem recebida, e ler/gravar a
// sessão cifrada. Todo pedido vai assinado (ver assinatura.ts).
//
// O Norte é quem tem a chave de cifra. O conector entrega o pacote da sessão
// em claro — por HTTPS — e recebe de volta em claro; no banco ele só existe
// cifrado. Assim o disco do conector nunca guarda credencial nenhuma, e o
// conector sozinho (roubado, copiado) não abre sessão de ninguém.

import { assinar, CABECALHO_ASSINATURA, CABECALHO_CARIMBO } from './assinatura'

export type RecebidaParaNorte = {
  tipo: 'mensagem'
  telefone: string
  nome: string | null
  texto: string
  id: string
  deMim: boolean
  anuncioId?: string
}

export class ClienteNorte {
  constructor(
    private readonly base: string,
    private readonly segredo: string,
    private readonly buscar: typeof fetch = fetch,
  ) {}

  private async pedir(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', caminho: string, corpo?: unknown, timeoutMs = 15_000) {
    const url = new URL(this.base + caminho)
    const bruto = corpo === undefined ? '' : JSON.stringify(corpo)
    const { carimbo, assinatura } = assinar(this.segredo, metodo, url.pathname, bruto)
    return this.buscar(url, {
      method: metodo,
      headers: {
        ...(bruto ? { 'content-type': 'application/json' } : {}),
        [CABECALHO_CARIMBO]: carimbo,
        [CABECALHO_ASSINATURA]: assinatura,
      },
      body: bruto || undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  /** Entrega uma mensagem recebida. Verdadeiro se o Norte aceitou. */
  async entregar(orgId: string, m: RecebidaParaNorte): Promise<boolean> {
    const r = await this.pedir('POST', `/api/whatsapp-proprio/${encodeURIComponent(orgId)}`, m)
    return r.ok
  }

  /** A sessão guardada, ou nulo se não há. Lança se o Norte não respondeu. */
  async lerSessao(orgId: string): Promise<{ dados: string; versao: number } | null> {
    const r = await this.pedir('GET', `/api/whatsapp-proprio/${encodeURIComponent(orgId)}/sessao`)
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`o Norte recusou a leitura da sessão (status ${r.status})`)
    const j = (await r.json()) as { dados?: unknown; versao?: unknown }
    if (typeof j.dados !== 'string' || typeof j.versao !== 'number') throw new Error('resposta da sessão fora do formato')
    return { dados: j.dados, versao: j.versao }
  }

  /** Grava a sessão. 'velha' = o Norte já tem uma mais nova (e está certo em recusar). */
  async gravarSessao(orgId: string, dados: string, versao: number): Promise<'ok' | 'velha'> {
    const r = await this.pedir('PUT', `/api/whatsapp-proprio/${encodeURIComponent(orgId)}/sessao`, { dados, versao }, 30_000)
    if (r.status === 409) return 'velha'
    if (!r.ok) throw new Error(`o Norte recusou a gravação da sessão (status ${r.status})`)
    return 'ok'
  }

  async apagarSessao(orgId: string): Promise<void> {
    const r = await this.pedir('DELETE', `/api/whatsapp-proprio/${encodeURIComponent(orgId)}/sessao`)
    if (!r.ok && r.status !== 404) throw new Error(`o Norte recusou apagar a sessão (status ${r.status})`)
  }
}
