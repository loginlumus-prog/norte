// O servidor do console do Norte: http puro do Node, só em 127.0.0.1.
//
// Quem sobe é scripts/console.ts (que escolhe o banco e cria a guarda). Aqui
// ficam as rotas: três telas que LEEM (com a credencial de admin, só dado de
// conta — ver leitura.ts) e um formulário que MUDA, sempre por uma função de
// src/servidor/operacao.ts ou assinatura.ts. Nenhuma escrita sai daqui com a
// credencial de admin: toda mudança vai pelo comoOrg da empresa, com RLS e a
// linha do livro assinada "Equipe Norte (<quem>)" na mesma transação.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { PrismaClient, Plano } from '@prisma/client'
import {
  cabecalhosDeSeguranca,
  conferirAcesso,
  conferirFormulario,
  lerCookies,
  type Guarda,
  type Pedido as PedidoHttp,
} from './guarda'
import { ESTILO } from './estilo'
import { SCRIPT } from './cliente'
import { detalheEmpresa, filtrar, listarEmpresas, pedidosAbertosDeTodas, resumir } from './leitura'
import { paginaDeErro, telaEmpresa, telaEmpresas, telaPedidos, dataHora, type Aviso, type Contexto } from './telas'
import * as op from '../servidor/operacao'
import { PLANOS, PRECOS, milhar } from '../servidor/planos'
import { quemDaEquipe, SemCota } from '../servidor/assinatura'
import { eventosDePedido, pedidoAberto, type TipoPedido } from '../servidor/pedidos'
import { mostrar } from '../servidor/dinheiro'

export type ConfigDoConsole = {
  guarda: Guarda
  /** A credencial que atravessa empresas — só para LER. */
  admin: PrismaClient
  producao: boolean
  /** NORTE_OPERADOR, quando definido: assina tudo, e a tela não troca. */
  operadorDoAmbiente: string | null
  /** O endereço público do sistema neste ambiente ('' = não sei). */
  base: string
  dominioDaEquipe: string | null
  /** Tira credencial de texto antes de ele ir para a tela ou o terminal. */
  limpar: (texto: string) => string
}

/** Um recado de uma vez só, entre o POST e a tela seguinte. */
type Recado = { aviso: Aviso; expira: number }

const TAMANHO_MAXIMO_DO_FORMULARIO = 32 * 1024

export function criarConsole(cfg: ConfigDoConsole): Server {
  const recados = new Map<string, Recado>()
  const cookieOperador = `norte_console_operador_${cfg.guarda.porta}`

  function guardarRecado(aviso: Aviso): string {
    const agora = Date.now()
    for (const [k, r] of recados) if (r.expira < agora) recados.delete(k)
    const id = randomBytes(9).toString('base64url')
    recados.set(id, { aviso, expira: agora + 10 * 60_000 })
    return id
  }
  function tirarRecado(id: string | null): Aviso | null {
    if (!id) return null
    const r = recados.get(id)
    recados.delete(id)
    return r && r.expira >= Date.now() ? r.aviso : null
  }

  function operador(req: IncomingMessage): string | null {
    const bruto = cfg.operadorDoAmbiente ?? lerCookies(req.headers.cookie)[cookieOperador] ?? ''
    try {
      return bruto ? quemDaEquipe(bruto) : null
    } catch {
      return null
    }
  }

  function enviar(res: ServerResponse, status: number, corpo: string, tipo = 'text/html; charset=utf-8', extra: Record<string, string | string[]> = {}) {
    res.writeHead(status, { ...cabecalhosDeSeguranca(), 'Content-Type': tipo, ...extra })
    res.end(corpo)
  }
  function redirecionar(res: ServerResponse, destino: string, extra: Record<string, string | string[]> = {}) {
    res.writeHead(303, { ...cabecalhosDeSeguranca(), Location: destino, ...extra })
    res.end()
  }

  function pedidoHttp(req: IncomingMessage): PedidoHttp {
    const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
    return {
      metodo: req.method ?? 'GET',
      url: req.url ?? '/',
      host: um(req.headers.host),
      origem: um(req.headers.origin),
      cookie: um(req.headers.cookie),
      site: um(req.headers['sec-fetch-site']),
    }
  }

  async function lerFormulario(req: IncomingMessage): Promise<URLSearchParams> {
    const tipo = String(req.headers['content-type'] ?? '')
    if (!tipo.startsWith('application/x-www-form-urlencoded')) throw new Error('Formulário em formato inesperado.')
    let tamanho = 0
    const pedacos: Buffer[] = []
    for await (const p of req) {
      tamanho += (p as Buffer).length
      if (tamanho > TAMANHO_MAXIMO_DO_FORMULARIO) throw new Error('Formulário grande demais.')
      pedacos.push(p as Buffer)
    }
    return new URLSearchParams(Buffer.concat(pedacos).toString('utf8'))
  }

  async function contexto(req: IncomingMessage, url: URL, pedidosAbertos: number): Promise<Contexto> {
    return {
      producao: cfg.producao,
      csrf: cfg.guarda.csrf,
      operador: operador(req),
      operadorFixo: !!cfg.operadorDoAmbiente,
      base: cfg.base,
      aviso: tirarRecado(url.searchParams.get('aviso')),
      pedidosAbertos,
      agora: new Date(),
    }
  }

  // ── as telas ───────────────────────────────────────────────

  async function telas(req: IncomingMessage, res: ServerResponse, url: URL) {
    const agora = new Date()
    const linhas = await listarEmpresas(cfg.admin, agora)
    const abertos = linhas.reduce((s, l) => s + l.pedidosAbertos.length, 0)
    const c = await contexto(req, url, abertos)

    if (url.pathname === '/') {
      const f = {
        busca: url.searchParams.get('busca') ?? '',
        situacao: url.searchParams.get('situacao') ?? '',
        plano: url.searchParams.get('plano') ?? '',
      }
      return enviar(res, 200, telaEmpresas(c, filtrar(linhas, f), resumir(linhas), f))
    }
    if (url.pathname === '/pedidos') return enviar(res, 200, telaPedidos(c, pedidosAbertosDeTodas(linhas)))
    const m = /^\/empresa\/([a-z0-9-]{1,60})$/.exec(url.pathname)
    if (m) {
      const d = await detalheEmpresa(cfg.admin, m[1]!, agora, linhas)
      if (!d) return enviar(res, 404, paginaDeErro(404, `Não existe empresa em /${m[1]}.`))
      return enviar(res, 200, telaEmpresa(c, d, cfg.dominioDaEquipe))
    }
    return enviar(res, 404, paginaDeErro(404, 'Página não encontrada.'))
  }

  // ── as ações ───────────────────────────────────────────────

  /** Os textos das regras falam com a linha de comando ("--motivo"); aqui é formulário. */
  const paraTela = (msg: string) => cfg.limpar(msg).replace(/--([a-z-]+)/g, '"$1"')

  function exigirMotivo(campos: URLSearchParams): string {
    const m = (campos.get('motivo') ?? '').trim().replace(/\s+/g, ' ')
    if (m.length < 5 || m.length > 300) throw new Error('Escreva o motivo (de 5 a 300 letras). Ele vai para o livro da empresa.')
    return m
  }

  /** O pedido que o formulário diz atender ainda é o aberto? (Outra pessoa pode ter respondido.) */
  async function pedidoConferido(orgId: string, tipo: TipoPedido, idDoForm: string | null): Promise<string | null> {
    const aberto = pedidoAberto(await eventosDePedido(orgId), tipo)
    if (!idDoForm) return null
    if (!aberto || aberto.id !== idDoForm) {
      throw new Error('Este pedido já foi respondido ou foi trocado por um mais novo. Recarregue a página.')
    }
    return aberto.id
  }

  async function executar(campos: URLSearchParams, quem: string): Promise<Aviso> {
    const slug = campos.get('slug') ?? ''
    const org = await cfg.admin.org.findUnique({ where: { slug }, select: { id: true, slug: true, nome: true, situacao: true } })
    if (!org) throw new Error(`Não existe empresa em /${slug}.`)
    if (cfg.producao && (campos.get('confirmacao') ?? '').trim() !== org.slug) {
      throw new Error(`Em produção, digite o endereço da empresa (${org.slug}) para aplicar. Nada foi feito.`)
    }
    const motivo = exigirMotivo(campos)
    const acao = campos.get('acao')

    switch (acao) {
      case 'situacao': {
        const para = (campos.get('para') ?? '') as op.SituacaoDaEquipe
        const r = await op.mudarSituacao(org.id, para, { motivo, quem })
        if (!r.mudou) return { tipo: 'info', texto: `/${org.slug} já estava ${para.toLowerCase()}. Nada mudou.` }
        return {
          tipo: 'ok',
          texto: `/${org.slug}: ${r.de.toLowerCase()} → ${r.para.toLowerCase()}.${r.sessoesCortadas ? ` ${r.sessoesCortadas} conta(s) com a sessão cortada.` : ''}`,
        }
      }
      case 'plano': {
        const para = (campos.get('para') ?? '') as Plano
        if (!(para in PLANOS)) throw new Error('Escolha o plano.')
        const pedidoId = await pedidoConferido(org.id, 'plano', campos.get('pedidoId'))
        const m = await op.trocarPlanoPelaEquipe(org.id, para, { motivo, quem, pedidoId })
        if (m.sentido === 'igual') return { tipo: 'info', texto: `/${org.slug} já estava no plano ${PLANOS[para].titulo}.` }
        return {
          tipo: 'ok',
          texto: `/${org.slug} está no plano ${PLANOS[para].titulo}.${m.perde.length ? ` Saíram: ${m.perde.join(', ')}.` : ''}${pedidoId ? ' O pedido foi atendido.' : ''}`,
        }
      }
      case 'credito': {
        const tipo = campos.get('tipo') === 'AJUSTE' ? 'AJUSTE' : 'COMPRA'
        const centavos = op.lerValorEmReais(campos.get('valor') ?? '')
        if (centavos === null || centavos === 0) throw new Error('Diga o valor em reais: 150, 150,50 ou 1.234,56.')
        let pedidoId = await pedidoConferido(org.id, 'credito', campos.get('pedidoId'))
        if (!pedidoId && campos.get('atendePedido') === '1') {
          pedidoId = pedidoAberto(await eventosDePedido(org.id), 'credito')?.id ?? null
        }
        const r = await op.recarregarComoEquipe(org.id, centavos, { tipo, motivo, quem, pedidoId })
        return {
          tipo: 'ok',
          texto: `${centavos > 0 ? '+' : ''}${mostrar(centavos)} em /${org.slug}. Saldo: ${mostrar(r.saldoAntes)} → ${mostrar(r.saldoDepois)}.${pedidoId ? ' O pedido foi atendido.' : ''}`,
        }
      }
      case 'respostas': {
        let pedidoId = await pedidoConferido(org.id, 'respostas', campos.get('pedidoId'))
        if (!pedidoId && campos.get('atendePedido') === '1') {
          pedidoId = pedidoAberto(await eventosDePedido(org.id), 'respostas')?.id ?? null
        }
        const r = await op.atenderPacoteDeRespostas(org.id, { motivo, quem, pedidoId })
        return {
          tipo: 'ok',
          texto:
            `Pacote de +${milhar(PRECOS.pacoteRespostas)} respostas em /${org.slug}.` +
            (r.total !== null ? ` Agora: ${milhar(r.usadas)} usadas de ${milhar(r.total)} no mês.` : '') +
            (pedidoId ? ' O pedido foi atendido.' : ''),
        }
      }
      case 'recusar': {
        // O tipo de verdade: antes, tudo que não era "credito" virava "plano",
        // e recusar um pedido de respostas recusava (ou não achava) o de plano.
        const tipo = op.lerTipoPedido(campos.get('tipo'))
        if (!tipo) throw new Error('Tipo de pedido desconhecido.')
        await pedidoConferido(org.id, tipo, campos.get('pedidoId'))
        const p = await op.recusarPedido(org.id, tipo, { motivo, quem })
        return { tipo: 'ok', texto: `Pedido de ${p.oQue} recusado. A loja vê o motivo na tela da Assinatura.` }
      }
      case 'modulo': {
        const modulo = campos.get('modulo') as op.ModuloDaEquipe
        const ligar = campos.get('ligar') === '1'
        const r = await op.definirModuloDaEquipe(org.id, modulo, ligar, { motivo, quem })
        return r.mudou
          ? { tipo: 'ok', texto: `${modulo === 'farol' ? 'Farol' : 'Fábrica'} ${ligar ? 'ligado' : 'desligado'} em /${org.slug}.` }
          : { tipo: 'info', texto: 'Já estava assim. Nada mudou.' }
      }
      case 'farol-marcas': {
        const marcas = Number(campos.get('marcas'))
        const r = await op.definirMarcasDoFarol(org.id, marcas, { motivo, quem })
        return r.mudou
          ? { tipo: 'ok', texto: `/${org.slug}: ${r.de} → ${r.para} marca(s) do Farol contratada(s).` }
          : { tipo: 'info', texto: `/${org.slug} já tinha ${r.para} marca(s). Nada mudou.` }
      }
      case 'suporte': {
        const email = op.validarEmail(campos.get('email'))
        const horas = op.validarHoras(campos.get('horas') ?? '')
        const edicao = campos.get('modo') === 'edicao'
        const r = await op.concederSuporte(
          org.id,
          { email, nome: campos.get('nome'), horas, motivo, quem, edicao },
          { dominioDaEquipe: cfg.dominioDaEquipe },
        )
        const entrada = `${cfg.base || ''}/${org.slug}/entrar`
        let senha = ''
        // O acesso JÁ foi dado: uma falha no e-mail daqui não pode virar "deu
        // erro" na tela, ou quem opera tenta de novo e estende sem querer.
        if (!r.temSenha) {
          senha = ' ' + (await linkDeSenha(org.id, email).catch((e: unknown) => {
            console.error(cfg.limpar(`  Link de senha para ${email} não saiu: ${e instanceof Error ? e.message : String(e)}`))
            return 'A conta ainda não tem senha e o e-mail com o link não saiu agora: a pessoa usa "Esqueci a senha" na entrada.'
          }))
        }
        const travada = org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA'
        return {
          tipo: 'ok',
          texto:
            `Suporte (${r.edicao ? 'edição' : 'só leitura'}) para ${email} até ${dataHora(r.expiraEm)}${r.criouConta ? ' (conta criada)' : ''}.` +
            `${r.sessoesCortadas ? ' O prazo encurtou: as sessões abertas desta conta foram cortadas.' : ''}` +
            senha +
            (travada ? ` Atenção: a empresa está ${org.situacao.toLowerCase()} — o login recusa todo mundo, suporte inclusive.` : ''),
          link: [{ rotulo: 'Entrada da empresa (com o e-mail e a senha da própria pessoa)', url: entrada }],
        }
      }
      case 'suporte-revogar': {
        const email = op.validarEmail(campos.get('email'))
        const r = await op.revogarSuporte(org.id, { email, quem, motivo })
        return r.revogou
          ? { tipo: 'ok', texto: `O acesso de suporte de ${email} em /${org.slug} terminou agora.` }
          : { tipo: 'info', texto: 'Não havia acesso de suporte valendo para este e-mail.' }
      }
      case 'reconvidar': {
        if (!cfg.base) throw new Error('Não sei o endereço público do sistema neste ambiente: ponha NORTE_URL no arquivo de ambiente.')
        const r = await op.reconvidarDono(org.id, { motivo, quem, email: campos.get('email') }, cfg.base)
        return {
          tipo: 'ok',
          texto: `Convite do dono refeito para ${r.email}, vale até ${dataHora(r.expiraEm)}. Mande o link abaixo: ele aparece só agora e serve uma vez.`,
          link: [{ rotulo: 'Convite do dono', url: r.link }],
        }
      }
      default:
        throw new Error('Ação desconhecida.')
    }
  }

  /** Igual à ferramenta de operação: o link de senha vai para o e-mail da pessoa, nunca para a tela. */
  async function linkDeSenha(orgId: string, email: string): Promise<string> {
    if (!cfg.base) return 'A conta ainda não tem senha: a pessoa abre a entrada da empresa e usa "Esqueci a senha".'
    const { enviarLinkDeSenha, VALE_SENHA_MIN } = await import('../servidor/conta')
    const desfecho = await enviarLinkDeSenha(orgId, email, cfg.base, null)
    if (desfecho === 'enviado') return `O link para definir a senha foi para ${email} (vale ${VALE_SENHA_MIN} min, uma vez só).`
    if (desfecho === 'nao_configurado') {
      return 'A conta ainda não tem senha e este ambiente não manda e-mail: a pessoa abre a entrada e usa "Esqueci a senha" onde o e-mail funcionar.'
    }
    return 'A conta ainda não tem senha e o e-mail com o link não saiu agora: a pessoa usa "Esqueci a senha" na entrada.'
  }

  /** Para onde voltar depois da ação: só caminhos nossos. */
  function destino(campos: URLSearchParams): string {
    const v = campos.get('voltar')
    if (v === '/pedidos' || v === '/') return v
    const slug = campos.get('slug') ?? ''
    return /^[a-z0-9-]{1,60}$/.test(slug) ? `/empresa/${slug}` : '/'
  }

  async function postar(req: IncomingMessage, res: ServerResponse, url: URL) {
    let campos: URLSearchParams
    try {
      campos = await lerFormulario(req)
    } catch (e) {
      return enviar(res, 400, paginaDeErro(400, (e as Error).message))
    }
    const v = conferirFormulario(cfg.guarda, pedidoHttp(req), campos)
    if (v.tipo === 'recusa') return enviar(res, v.status, paginaDeErro(v.status, v.motivo))

    if (url.pathname === '/operador') {
      if (cfg.operadorDoAmbiente) return redirecionar(res, '/')
      const nome = (campos.get('nome') ?? '').trim()
      if (!nome) return redirecionar(res, '/', { 'Set-Cookie': `${cookieOperador}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` })
      try {
        quemDaEquipe(nome)
      } catch {
        return redirecionar(res, `/?aviso=${guardarRecado({ tipo: 'erro', texto: 'Nome de 2 a 60 letras, sem e-mail.' })}`)
      }
      return redirecionar(res, '/', {
        'Set-Cookie': `${cookieOperador}=${encodeURIComponent(nome)}; HttpOnly; SameSite=Strict; Path=/`,
      })
    }

    if (url.pathname !== '/acao') return enviar(res, 404, paginaDeErro(404, 'Página não encontrada.'))
    const quem = operador(req)
    const volta = destino(campos)
    if (!quem) {
      return redirecionar(res, `${volta}?aviso=${guardarRecado({ tipo: 'erro', texto: 'Diga quem está operando (no alto da página) antes de mudar qualquer coisa.' })}`)
    }

    let aviso: Aviso
    const rotulo = `${campos.get('acao')} /${campos.get('slug')}`
    try {
      aviso = await executar(campos, quem)
      console.log(cfg.limpar(`  [${new Date().toLocaleTimeString('pt-BR')}] ${quem}: ${rotulo} — ${aviso.texto}`))
    } catch (e) {
      const msg =
        e instanceof SemCota
          ? `Não dá: ${e.motivo}`
          : // Só o Error simples é recado escrito para gente; TypeError, erro do
            // driver ou do Prisma é defeito, e o detalhe fica no terminal.
            e instanceof Error && e.constructor === Error && !('code' in e)
            ? paraTela(e.message)
            : 'Erro inesperado. O detalhe está no terminal do console.'
      console.error(cfg.limpar(`  [${new Date().toLocaleTimeString('pt-BR')}] ${quem}: ${rotulo} — FALHOU: ${e instanceof Error ? e.message : String(e)}`))
      aviso = { tipo: 'erro', texto: msg }
    }
    return redirecionar(res, `${volta}?aviso=${guardarRecado(aviso)}`)
  }

  return createServer((req, res) => {
    void (async () => {
      const p = pedidoHttp(req)
      const url = new URL(p.url, 'http://127.0.0.1')
      // A folha e o script não têm dado nenhum: abrem sem a chave (a página
      // de "abra pelo link" também precisa deles). O Host vale para tudo.
      if (url.pathname === '/estilo.css' || url.pathname === '/console.js' || url.pathname === '/favicon.ico') {
        const acesso = conferirAcesso(cfg.guarda, { ...p, url: '/', cookie: null })
        if (acesso.tipo === 'recusa' && acesso.status === 403) return enviar(res, 403, '', 'text/plain')
        if (url.pathname === '/favicon.ico') return enviar(res, 204, '', 'image/x-icon')
        return url.pathname === '/estilo.css'
          ? enviar(res, 200, ESTILO, 'text/css; charset=utf-8')
          : enviar(res, 200, SCRIPT, 'text/javascript; charset=utf-8')
      }

      const v = conferirAcesso(cfg.guarda, p)
      if (v.tipo === 'recusa') return enviar(res, v.status, paginaDeErro(v.status, v.motivo))
      if (v.tipo === 'entrar') return redirecionar(res, v.destino, { 'Set-Cookie': v.setCookie })

      if (p.metodo === 'POST') return postar(req, res, url)
      return telas(req, res, url)
    })().catch((e: unknown) => {
      console.error(cfg.limpar(`  Erro no console: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
      if (!res.headersSent) enviar(res, 500, paginaDeErro(500, 'Deu problema ao ler o banco. O detalhe está no terminal do console.'))
      else res.end()
    })
  })
}
