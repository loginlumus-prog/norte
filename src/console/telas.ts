// As três telas do console do Norte, em HTML montado no servidor.
//
// Todo texto que vem do banco passa por `esc` — nome de empresa e motivo são
// digitados por gente, e um `<script>` num nome de loja não pode virar código
// rodando na página que segura a chave de todas as empresas.

import type { Plano, Situacao } from '@prisma/client'
import { PLANOS, ORDEM, PRECOS, milhar, precoDoFarol } from '../servidor/planos'
import { MODULOS } from '../servidor/modulos'
import { mostrar } from '../servidor/dinheiro'
import {
  SITUACOES_DA_EQUIPE,
  SUPORTE_MAX_HORAS,
  TETO_RECARGA_CENT,
  FAROL_MARCAS_MAX,
} from '../servidor/operacao'
import { contaDoMes, type DetalheEmpresa, type LinhaEmpresa, type Resumo } from './leitura'
import type { Pedido } from '../servidor/pedidos'


export type Aviso = { tipo: 'ok' | 'erro' | 'info'; texto: string; link?: { rotulo: string; url: string }[] }

export type Contexto = {
  producao: boolean
  csrf: string
  /** "Equipe Norte (Fulano)" — null enquanto ninguém disse quem é. */
  operador: string | null
  /** Veio de NORTE_OPERADOR: não se troca pela tela. */
  operadorFixo: boolean
  /** O endereço público do sistema ('' = não sei). */
  base: string
  aviso: Aviso | null
  pedidosAbertos: number
  agora: Date
}

// ── texto ────────────────────────────────────────────────────

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...o })
const fData = fmt({ day: '2-digit', month: '2-digit', year: '2-digit' })
const fDataHora = fmt({ day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
export const data = (d: Date | null | undefined) => (d ? fData.format(d) : '—')
export const dataHora = (d: Date | null | undefined) => (d ? fDataHora.format(d) : '—')

export function haQuanto(d: Date | null | undefined, agora = new Date()): string {
  if (!d) return 'nunca'
  const min = Math.floor((agora.getTime() - d.getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `há ${h} h`
  const dias = Math.floor(h / 24)
  return dias < 60 ? `há ${dias} dias` : `há ${Math.floor(dias / 30)} meses`
}

/** "em 12 dias" / "venceu há 3 dias". */
function prazo(d: Date, agora: Date): string {
  const dias = Math.ceil((d.getTime() - agora.getTime()) / 864e5)
  if (dias > 1) return `em ${dias} dias`
  if (dias === 1) return 'amanhã'
  if (dias === 0) return 'hoje'
  return `venceu há ${-dias} dia${dias === -1 ? '' : 's'}`
}

/** Os nomes dos tipos de pedido nas pílulas. */
const ROTULO_PEDIDO: Record<Pedido['tipo'], string> = {
  plano: 'Plano',
  respostas: 'Pacote de respostas',
  credito: 'Crédito',
}

/** "320 / 1.000" — as respostas do período; "sob contrato" no Corporativo, "—" sem assistente. */
function respostasTxt(r: LinhaEmpresa['respostas']): string {
  if (r.total === null) return `${milhar(r.usadas)} · sob contrato`
  if (r.total === 0) return '—'
  return `${milhar(r.usadas)} / ${milhar(r.total)}`
}

/** A margem do mês, estimada: a mensalidade mais os pacotes, menos o que a IA nos custou. */
function margemCent(l: Pick<LinhaEmpresa, 'mensalCent' | 'respostas' | 'custoIaMesCent'>): number | null {
  if (l.mensalCent === null) return null
  return l.mensalCent + l.respostas.pacotes * PRECOS.pacotePreco * 100 - l.custoIaMesCent
}

const chip = (s: Situacao) => `<span class="chip ${s}">${s}</span>`
const tituloPlano = (p: Plano) => PLANOS[p].titulo
const reais = (cent: number | null) => (cent === null ? 'sob contrato' : mostrar(cent))

function aParte(l: Pick<LinhaEmpresa, 'modulos' | 'farolMarcas' | 'fabricas'>): string {
  const partes: string[] = []
  if (l.modulos.includes('fabrica')) partes.push(`<span class="pilula">Fábrica${l.fabricas ? ` · ${l.fabricas}` : ''}</span>`)
  if (l.modulos.includes('farol')) partes.push(`<span class="pilula">Farol · ${l.farolMarcas} marca${l.farolMarcas === 1 ? '' : 's'}</span>`)
  return partes.length ? partes.join(' ') : '<span class="mini">—</span>'
}

function barra(gasto: number, incluso: number): string {
  if (incluso <= 0) return ''
  const pct = Math.min(100, Math.round((gasto / incluso) * 100))
  return `<div class="barra"><b class="p${Math.round(pct / 5) * 5}${gasto > incluso ? ' passou' : ''}"></b></div>`
}

// ── moldura ──────────────────────────────────────────────────

function campoCsrf(c: Contexto) {
  return `<input type="hidden" name="csrf" value="${esc(c.csrf)}">`
}

export function pagina(c: Contexto, titulo: string, ativo: 'empresas' | 'pedidos' | null, corpo: string): string {
  const quem = c.operador ? c.operador.replace(/^Equipe Norte \((.*)\)$/, '$1') : null
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(titulo)} · Console do Norte${c.producao ? ' · PRODUÇÃO' : ''}</title>
<link rel="stylesheet" href="/estilo.css"><script src="/console.js" defer></script></head>
<body>
${c.producao ? '<div class="faixa-prod">PRODUÇÃO — cada ação muda a conta de um cliente de verdade</div>' : ''}
<header class="topo"><div class="dentro">
  <a class="marca" href="/"><i></i>Norte <small>console</small></a>
  <nav>
    <a href="/" class="${ativo === 'empresas' ? 'ativo' : ''}">Empresas</a>
    <a href="/pedidos" class="${ativo === 'pedidos' ? 'ativo' : ''}">Pedidos${c.pedidosAbertos ? `<span class="bolha">${c.pedidosAbertos}</span>` : ''}</a>
  </nav>
  <div class="dir">
    ${quem ? `<span class="quem">Assina como <b>${esc(quem)}</b>${c.operadorFixo ? '' : `<form method="post" action="/operador">${campoCsrf(c)}<input type="hidden" name="nome" value=""><button type="submit" title="Trocar quem assina">trocar</button></form>`}</span>` : ''}
    <span class="ambiente ${c.producao ? 'prod' : 'local'}">${c.producao ? 'PRODUÇÃO' : 'BANCO LOCAL'}</span>
  </div>
</div></header>
<main>
${c.operador ? '' : formOperador(c)}
${c.aviso ? avisoHtml(c.aviso) : ''}
${corpo}
</main></body></html>`
}

function formOperador(c: Contexto) {
  return `<div class="operador"><b>Quem está operando?</b>
  <span class="mini">O nome assina cada mudança no livro da loja como "Equipe Norte (nome)". Sem ele, nenhuma ação roda.</span>
  <form method="post" action="/operador">${campoCsrf(c)}
    <input name="nome" required minlength="2" maxlength="60" placeholder="Seu nome" autocomplete="name">
    <button type="submit">Usar este nome</button>
  </form></div>`
}

function avisoHtml(a: Aviso) {
  const links = (a.link ?? [])
    .map(
      (l, i) =>
        `<div class="link-aviso"><b>${esc(l.rotulo)}</b><br><span class="copiar" id="lk${i}">${esc(l.url)}</span> <button class="sec" type="button" data-copiar="lk${i}">Copiar</button></div>`,
    )
    .join('')
  return `<div class="aviso ${a.tipo}">${esc(a.texto)}${links ? `<div>${links}</div>` : ''}</div>`
}

export function paginaDeErro(status: number, motivo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Console do Norte</title><link rel="stylesheet" href="/estilo.css"></head><body>
<div class="erro-pagina"><h1>Console do Norte</h1><p class="sub">${status}</p><p>${esc(motivo)}</p>
<p class="mini">O console só abre pelo link que o terminal imprimiu ao subir (<code>npm run console</code>).</p></div></body></html>`
}

// ── 1. EMPRESAS ──────────────────────────────────────────────

export function telaEmpresas(
  c: Contexto,
  linhas: LinhaEmpresa[],
  resumo: Resumo,
  f: { busca: string; situacao: string; plano: string },
): string {
  const opcoes = (valores: readonly string[], atual: string, rot: (v: string) => string) =>
    valores.map((v) => `<option value="${esc(v)}"${v === atual ? ' selected' : ''}>${esc(rot(v))}</option>`).join('')
  const situacoes: Situacao[] = ['TESTE', 'ATIVA', 'INADIMPLENTE', 'SUSPENSA', 'CANCELADA']
  const pctIa = resumo.creditoInclusoMesCent > 0 ? Math.round((resumo.creditoGastoMesCent / resumo.creditoInclusoMesCent) * 100) : null

  const cartoes = `<div class="cartoes">
    <div class="cartao"><div class="rot">Empresas ativas</div><div class="num">${resumo.ativas}</div><div class="det">de ${resumo.total} no total${resumo.suspensas ? ` · ${resumo.suspensas} suspensa(s)` : ''}</div></div>
    <div class="cartao"><div class="rot">Em teste</div><div class="num">${resumo.emTeste}</div><div class="det">${linhas.filter((l) => l.situacao === 'TESTE' && l.testeAte && l.testeAte > c.agora && l.testeAte.getTime() - c.agora.getTime() < 5 * 864e5).length} acabando em 5 dias</div></div>
    <div class="cartao"><div class="rot">MRR estimado</div><div class="num">${mostrar(resumo.mrrCent)}</div><div class="det">ativas e inadimplentes, pela tabela</div></div>
    <div class="cartao"><div class="rot">Pedidos abertos</div><div class="num">${resumo.pedidosAbertos}</div><div class="det">${resumo.pedidosAbertos ? '<a href="/pedidos">responder agora →</a>' : 'nada esperando'}</div></div>
    <div class="cartao"><div class="rot">Respostas no mês</div><div class="num">${milhar(resumo.respostasUsadas)}</div>
      <div class="det">${resumo.pacotesNoMes ? `${resumo.pacotesNoMes} pacote(s) vendido(s) · ` : ''}custo de IA ${mostrar(resumo.custoIaMesCent)}</div></div>
    <div class="cartao"><div class="rot">Cofre de IA no mês</div><div class="num">${mostrar(resumo.creditoGastoMesCent)}</div>
      <div class="det">gasto · ${mostrar(resumo.creditoInclusoMesCent)} posto${pctIa !== null ? ` (${pctIa}%)` : ''} — a trava de custo, que o cliente não vê</div>${barra(resumo.creditoGastoMesCent, resumo.creditoInclusoMesCent)}</div>
  </div>`

  const filtros = `<form class="filtros" method="get" action="/">
    <input type="search" name="busca" value="${esc(f.busca)}" placeholder="Buscar nome, endereço ou e-mail do dono">
    <select name="situacao"><option value="">Toda situação</option>${opcoes(situacoes, f.situacao, (v) => v.toLowerCase())}</select>
    <select name="plano"><option value="">Todo plano</option>${opcoes(ORDEM, f.plano, (v) => tituloPlano(v as Plano))}</select>
    <button type="submit">Filtrar</button>${f.busca || f.situacao || f.plano ? '<a class="botao sec" href="/">Limpar</a>' : ''}
    <span class="mini empurra">${linhas.length} empresa(s)</span>
  </form>`

  const corpoTabela = linhas.length
    ? linhas
        .map((l) => {
          const dono = l.dono
            ? `<div>${esc(l.dono.nome)}</div><div class="mini">${esc(l.dono.email)}${l.dono.telefone ? ` · ${esc(l.dono.telefone)}` : ''}</div>`
            : `<div class="mini">ainda não entrou</div><div class="mini">${esc(l.emailDaEmpresa ?? '')}</div>`
          const quando =
            l.situacao === 'TESTE' && l.testeAte
              ? `<div class="mini">teste até ${data(l.testeAte)} (${prazo(l.testeAte, c.agora)})</div>`
              : l.proximaCobranca
                ? `<div class="mini">cobra em ${data(l.proximaCobranca)}</div>`
                : ''
          return `<tr>
            <td><a class="nome" href="/empresa/${esc(l.slug)}">${esc(l.nome)}</a><div class="mini">/${esc(l.slug)}${l.configurada ? '' : ' · cadastro inicial pendente'}</div></td>
            <td>${dono}</td>
            <td><span class="pilula ${l.plano === 'GRATIS' ? 'cinza' : ''}">${esc(tituloPlano(l.plano))}</span></td>
            <td>${chip(l.situacao)}${quando}</td>
            <td class="n">${l.lojas}${l.depositos ? `<div class="mini">+${l.depositos} dep.</div>` : ''}</td>
            <td class="n">${l.pessoas}${l.suportesAtivos ? `<div class="mini">${l.suportesAtivos} suporte</div>` : ''}</td>
            <td>${aParte(l)}</td>
            <td class="n">${reais(l.mensalCent)}</td>
            <td class="n">${respostasTxt(l.respostas)}${l.respostas.acabou ? ' <span class="pilula vermelho">acabou</span>' : l.respostas.baixo ? ' <span class="pilula ambar">baixo</span>' : ''}<div class="mini">cofre ${mostrar(l.creditoSaldoCent)} · custo IA ${mostrar(l.custoIaMesCent)}</div></td>
            <td>${l.ultimaAtividade ? `${haQuanto(l.ultimaAtividade, c.agora)}<div class="mini">${dataHora(l.ultimaAtividade)}</div>` : '<span class="mini">nunca</span>'}</td>
            <td>${l.pedidosAbertos.length ? l.pedidosAbertos.map((p) => `<span class="pilula ambar">${esc(ROTULO_PEDIDO[p.tipo])}</span>`).join(' ') : '<span class="mini">—</span>'}</td>
          </tr>`
        })
        .join('')
    : `<tr><td colspan="11" class="vazio">Nenhuma empresa com esse filtro.</td></tr>`

  return pagina(
    c,
    'Empresas',
    'empresas',
    `<div class="linha-titulo"><h1>Empresas</h1><span class="sub">a conta de cada cliente — nunca o negócio dele</span></div>
    ${cartoes}${filtros}
    <div class="tabela-caixa"><table>
      <thead><tr><th>Empresa</th><th>Dono</th><th>Plano</th><th>Situação</th><th class="n">Lojas</th><th class="n">Pessoas</th><th>À parte</th><th class="n">Mensalidade</th><th class="n">Respostas (mês)</th><th>Última atividade</th><th>Pedidos</th></tr></thead>
      <tbody>${corpoTabela}</tbody>
    </table></div>`,
  )
}

// ── formulários de ação ──────────────────────────────────────

const campoMotivo = (ph = 'Motivo — vai para o livro da loja') =>
  `<input name="motivo" required minlength="5" maxlength="300" placeholder="${esc(ph)}">`

function confirmacaoProd(c: Contexto, slug: string) {
  return c.producao
    ? `<label>Digite o endereço (${esc(slug)}) para aplicar<input name="confirmacao" required autocomplete="off"></label>`
    : ''
}

function form(c: Contexto, slug: string, acao: string, confirmar: string, dentro: string, botao: string, classe = '') {
  return `<form class="f" method="post" action="/acao" data-confirmar="${esc(confirmar)}">
    ${campoCsrf(c)}<input type="hidden" name="acao" value="${esc(acao)}"><input type="hidden" name="slug" value="${esc(slug)}">
    ${dentro}${confirmacaoProd(c, slug)}
    <button type="submit" class="${classe}"${c.operador ? '' : ' disabled title="Diga quem está operando, no alto da página"'}>${esc(botao)}</button>
  </form>`
}

function formsDePedido(c: Contexto, slug: string, p: Pedido, compacto: boolean): string {
  const atender =
    p.tipo === 'plano' && p.plano
      ? form(
          c, slug, 'plano',
          `Trocar /${slug} para o plano ${tituloPlano(p.plano)}, atendendo o pedido de ${dataHora(p.criadoEm)}?`,
          `<input type="hidden" name="para" value="${esc(p.plano)}"><input type="hidden" name="pedidoId" value="${esc(p.id)}">${campoMotivo('Motivo (ex.: pagamento confirmado)')}`,
          `Atender: ${tituloPlano(p.plano)}`, 'ok',
        )
      : p.tipo === 'credito' && p.centavos
        ? form(
            c, slug, 'credito',
            `Pôr ${mostrar(p.centavos)} de crédito de IA em /${slug}, atendendo o pedido de ${dataHora(p.criadoEm)}?`,
            `<input type="hidden" name="valor" value="${esc((p.centavos / 100).toFixed(2).replace('.', ','))}"><input type="hidden" name="tipo" value="COMPRA"><input type="hidden" name="pedidoId" value="${esc(p.id)}">${campoMotivo('Motivo — a loja lê no extrato')}`,
            `Atender: ${mostrar(p.centavos)}`, 'ok',
          )
        : p.tipo === 'respostas'
          ? form(
              c, slug, 'respostas',
              `Pôr um pacote de +${milhar(PRECOS.pacoteRespostas)} respostas em /${slug}, atendendo o pedido de ${dataHora(p.criadoEm)}?`,
              `<input type="hidden" name="pedidoId" value="${esc(p.id)}">${campoMotivo('Motivo (ex.: Pix confirmado)')}`,
              `Atender: +${milhar(PRECOS.pacoteRespostas)} respostas`, 'ok',
            )
          : '<p class="dica">Pedido sem valor legível: atenda pelo formulário de plano ou crédito.</p>'
  const recusar = form(
    c, slug, 'recusar',
    `Recusar o pedido de ${p.oQue} de /${slug}? A loja lê o motivo na tela da Assinatura.`,
    `<input type="hidden" name="tipo" value="${p.tipo}"><input type="hidden" name="pedidoId" value="${esc(p.id)}">${campoMotivo('Motivo da recusa — a loja lê')}`,
    'Recusar', 'perigo',
  )
  return compacto ? `<div class="lado">${atender}${recusar}</div>` : `${atender}<hr>${recusar}`
}

// ── 2. UMA EMPRESA ───────────────────────────────────────────

export function telaEmpresa(c: Contexto, d: DetalheEmpresa, dominioDaEquipe: string | null): string {
  const l = d.linha
  const slug = l.slug
  const conta = contaDoMes(l.plano, l.modulos, l.farolMarcas, d.unidades)
  // A fábrica sai da conta por diferença: a forma de cobrar a fábrica (por
  // unidade ou uma vez) é de planos.ts, e o console não repete a regra.
  const fabricaReais = conta.total === null || conta.base === null ? 0 : conta.total - conta.base - conta.extras * (conta.porExtra ?? 0) - conta.farol
  const entrada = c.base ? `${c.base}/${slug}/entrar` : `/${slug}/entrar`
  const donoPendente = !l.dono

  const cardConta = `<div class="cartao"><h2>Mensalidade</h2><dl class="pares">
      <dt>Plano</dt><dd>${esc(tituloPlano(l.plano))}</dd>
      ${conta.base !== null ? `<dt>Base (1 loja)</dt><dd>${mostrar(Math.round(conta.base * 100))}</dd>` : ''}
      ${conta.extras ? `<dt>${conta.extras} loja(s) a mais</dt><dd>${mostrar(Math.round(conta.extras * (conta.porExtra ?? 0) * 100))}</dd>` : ''}
      ${fabricaReais > 0 ? `<dt>Fábrica (${conta.fabricas} unidade(s))</dt><dd>${mostrar(Math.round(fabricaReais * 100))}</dd>` : ''}
      ${conta.farolMarcas ? `<dt>Farol · ${conta.farolMarcas} marca(s)</dt><dd>${mostrar(Math.round(conta.farol * 100))}</dd>` : ''}
      <dt class="total">Total</dt><dd class="total">${conta.total === null ? 'sob contrato' : mostrar(Math.round(conta.total * 100))}</dd>
    </dl>
    <p class="dica">${l.situacao === 'TESTE' && l.testeAte ? `Teste até ${dataHora(l.testeAte)} (${prazo(l.testeAte, c.agora)}).` : l.proximaCobranca ? `Próxima cobrança: ${data(l.proximaCobranca)}.` : 'Sem cobrança automática (gateway ainda desligado).'}${d.org.suspensaEm ? ` Suspensa desde ${dataHora(d.org.suspensaEm)}.` : ''}</p></div>`

  const r = l.respostas
  const margem = margemCent(l)
  const cardCredito = `<div class="cartao"><h2>Assistente e IA</h2><dl class="pares">
      <dt>Respostas ${r.periodo === 'teste' ? 'no teste' : 'no mês'}</dt><dd>${r.total === null ? `${milhar(r.usadas)} (sob contrato)` : r.total === 0 ? 'sem assistente no plano' : `${milhar(r.usadas)} usadas / ${milhar(r.total)} incluídas`}</dd>
      ${r.pacotes ? `<dt>Pacotes no mês</dt><dd>${r.pacotes} × ${milhar(PRECOS.pacoteRespostas)} (${mostrar(r.pacotes * PRECOS.pacotePreco * 100)})</dd>` : ''}
      <dt>Cofre de IA (trava)</dt><dd>${mostrar(l.creditoSaldoCent)}</dd>
      <dt>Saiu do cofre no mês</dt><dd>${mostrar(l.creditoGastoMesCent)} de ${mostrar(l.creditoInclusoMesCent)} posto</dd>
      <dt>Custo de IA no mês</dt><dd>${mostrar(l.custoIaMesCent)}</dd>
      <dt>Margem do mês (estim.)</dt><dd>${margem === null ? 'sob contrato' : mostrar(margem)}</dd>
    </dl>${r.total ? barra(r.usadas, r.total) : barra(l.creditoGastoMesCent, l.creditoInclusoMesCent)}
    <p class="dica">O cliente lê respostas; o cofre em R$ é a nossa trava de custo, que ele não vê. Margem = mensalidade + pacotes − custo de IA.</p>
    <p class="dica">Assistente: ${d.agente ? `${esc(d.agente.canal === 'NENHUM' ? 'sem canal' : d.agente.canal)}${d.agente.ativo ? '' : ' (desligado)'}` : 'não configurado'}</p></div>`

  const conviteDono = d.convites.find((cv) => cv.papel === 'DONO' && !cv.aceitoEm)
  const cardDono = `<div class="cartao"><h2>Dono</h2>${
    l.dono
      ? `<dl class="pares"><dt>Nome</dt><dd>${esc(l.dono.nome)}</dd><dt>E-mail</dt><dd>${esc(l.dono.email)}</dd><dt>Telefone</dt><dd>${esc(l.dono.telefone ?? d.org.telefone ?? '—')}</dd></dl>`
      : `<p><b>Ainda não entrou.</b></p><dl class="pares"><dt>E-mail da venda</dt><dd>${esc(l.emailDaEmpresa ?? '—')}</dd>
         <dt>Convite</dt><dd>${conviteDono ? (conviteDono.expiraEm > c.agora ? `vale até ${dataHora(conviteDono.expiraEm)}` : `<span class="pilula vermelho">venceu ${data(conviteDono.expiraEm)}</span>`) : 'nenhum'}</dd></dl>`
  }
    <p class="dica">Criada em ${data(l.criadaEm)}${d.org.ramo ? ` · ramo ${esc(d.org.ramo)}` : ''}${l.configurada ? '' : ' · cadastro inicial pendente'}</p></div>`

  const tabelaLojas = d.unidades.length
    ? `<div class="tabela-caixa"><table><thead><tr><th>Unidade</th><th>Tipo</th><th>Situação</th></tr></thead><tbody>${d.unidades
        .map(
          (u) =>
            `<tr><td class="nome">${esc(u.nome)}</td><td>${u.ehDeposito ? '<span class="pilula cinza">depósito</span>' : '<span class="pilula">loja</span>'} ${u.ehFabrica ? '<span class="pilula ambar">fábrica</span>' : ''}</td><td>${u.ativa ? '<span class="pilula verde">ativa</span>' : '<span class="pilula cinza">desativada</span>'}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="vazio">Nenhuma unidade ainda.</div>'

  const papelTxt = (p: DetalheEmpresa['equipe'][number]['papeis'][number]) =>
    `${p.papel.toLowerCase()}${p.papel === 'SUPORTE' ? ` · ${p.suporteEdita ? 'edição' : 'só leitura'}` : ''}${p.unidade ? ` · ${esc(p.unidade)}` : ''}${p.expiraEm ? ` · ${p.expiraEm > c.agora ? 'até' : 'venceu'} ${dataHora(p.expiraEm)}` : ''}`
  const tabelaEquipe = d.equipe.length
    ? `<div class="tabela-caixa"><table><thead><tr><th>Pessoa</th><th>Papel</th><th>Conta</th><th>Último acesso</th></tr></thead><tbody>${d.equipe
        .map((u) => {
          const suporte = u.papeis.some((p) => p.papel === 'SUPORTE')
          return `<tr><td><div class="nome">${esc(u.nome)}${suporte ? ' <span class="pilula">suporte Norte</span>' : ''}</div><div class="mini">${esc(u.email)}</div></td>
            <td>${u.papeis.map(papelTxt).join('<br>') || '<span class="mini">sem acesso</span>'}</td>
            <td>${u.ativo ? '<span class="pilula verde">ativa</span>' : '<span class="pilula cinza">desativada</span>'}${u.temSenha ? '' : ' <span class="pilula ambar">sem senha</span>'}</td>
            <td>${u.ultimoLogin ? `${haQuanto(u.ultimoLogin, c.agora)}<div class="mini">${dataHora(u.ultimoLogin)}</div>` : '<span class="mini">nunca</span>'}</td></tr>`
        })
        .join('')}</tbody></table></div>`
    : '<div class="vazio">Ninguém entrou ainda.</div>'

  const estadoPedido: Record<Pedido['estado'], string> = {
    aberto: '<span class="pilula ambar">aberto</span>',
    atendido: '<span class="pilula verde">atendido</span>',
    recusado: '<span class="pilula vermelho">recusado</span>',
    substituido: '<span class="pilula cinza">substituído</span>',
  }
  const tabelaPedidos = d.pedidos.length
    ? `<div class="tabela-caixa"><table><thead><tr><th>Pedido em</th><th>Pediu</th><th>Estado</th><th>Resposta</th></tr></thead><tbody>${d.pedidos
        .map(
          (p) =>
            `<tr><td>${dataHora(p.criadoEm)}<div class="mini">${haQuanto(p.criadoEm, c.agora)}</div></td><td>${esc(p.oQue)}</td><td>${estadoPedido[p.estado]}</td><td class="mini">${p.fechadoEm ? dataHora(p.fechadoEm) : ''}${p.motivoRecusa ? ` — ${esc(p.motivoRecusa)}` : ''}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="vazio">Nenhum pedido nos últimos 180 dias.</div>'

  const tabelaRecargas = d.recargas.length
    ? `<div class="tabela-caixa"><table><thead><tr><th>Quando</th><th>Tipo</th><th class="n">Valor</th><th class="n">Saldo</th><th>Motivo / quem</th></tr></thead><tbody>${d.recargas
        .map(
          (r) =>
            `<tr><td>${dataHora(r.criadoEm)}</td><td><span class="pilula cinza">${esc(r.tipo.toLowerCase())}</span></td><td class="n">${r.centavos > 0 ? '+' : ''}${mostrar(r.centavos)}</td><td class="n">${mostrar(r.saldoDepois)}</td><td class="mini">${esc(r.motivo ?? '')}<br>${esc(r.quem)}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="vazio">Nenhum lançamento de crédito.</div>'

  const livro = d.livroDaEquipe.length
    ? `<ul class="livro">${d.livroDaEquipe
        .map(
          (a) =>
            `<li><span class="acao">${esc(a.acao)}</span> · <b>${esc(a.alvoNome ?? '')}</b> <span class="mini">— ${esc(a.quem)}, ${dataHora(a.criadoEm)}</span>${a.motivo ? `<div class="mini">${esc(a.motivo)}</div>` : ''}</li>`,
        )
        .join('')}</ul>`
    : '<div class="vazio">A equipe do Norte ainda não mexeu nesta empresa.</div>'

  const secao = (titulo: string, extra: string, corpo: string) =>
    `<section class="secao"><header><h2>${titulo}</h2><span class="mini">${extra}</span></header>${corpo}</section>`

  // ── as ações ──
  const abertos = l.pedidosAbertos
  const suportes = d.equipe.filter((u) => u.papeis.some((p) => p.papel === 'SUPORTE' && (p.expiraEm === null || p.expiraEm > c.agora)))
  const outrasSituacoes = SITUACOES_DA_EQUIPE.filter((s) => s !== l.situacao)
  const efeitoSituacao: Record<string, string> = {
    ATIVA: 'o login volta, o assistente e as campanhas voltam a mandar mensagem',
    SUSPENSA: 'login recusado, sessões abertas cortadas, assistente e campanhas param',
    CANCELADA: 'como suspensa, e marcada como cancelada',
  }
  const temFarol = l.modulos.includes('farol')
  const temFabrica = l.modulos.includes('fabrica')
  const acoes = `<aside class="acoes"><h2>Ações</h2>
    ${abertos.length ? `<details class="acao" open><summary>Pedidos abertos <span class="pilula ambar">${abertos.length}</span></summary><div class="corpo">${abertos
      .map((p) => `<p class="dica"><b>${esc(p.oQue)}</b> — pedido em ${dataHora(p.criadoEm)}</p>${formsDePedido(c, slug, p, false)}`)
      .join('<hr>')}</div></details>` : ''}
    <details class="acao"><summary>Situação <span class="mini">${esc(l.situacao.toLowerCase())}</span></summary><div class="corpo">
      ${outrasSituacoes
        .map((s) =>
          form(
            c, slug, 'situacao',
            `Mudar /${slug} de ${l.situacao.toLowerCase()} para ${s.toLowerCase()}? Efeito: ${efeitoSituacao[s]}.`,
            `<input type="hidden" name="para" value="${s}"><p class="dica">${esc(efeitoSituacao[s])}.</p>${campoMotivo()}`,
            s === 'ATIVA' ? (l.situacao === 'TESTE' ? 'Ativar' : 'Reativar') : s === 'SUSPENSA' ? 'Suspender' : 'Cancelar',
            s === 'ATIVA' ? 'ok' : 'perigo',
          ),
        )
        .join('<hr>')}
    </div></details>
    <details class="acao"><summary>Plano <span class="mini">${esc(tituloPlano(l.plano))}</span></summary><div class="corpo">
      ${form(
        c, slug, 'plano',
        `Trocar o plano de /${slug}? Os módulos que o plano novo não cobre saem da empresa.`,
        `<label>Plano novo<select name="para" required>${ORDEM.filter((p) => p !== l.plano)
          .map((p) => `<option value="${p}">${esc(tituloPlano(p))}${PLANOS[p].mensal !== null ? ` — R$ ${PLANOS[p].mensal}/mês base` : ''}</option>`)
          .join('')}</select></label>
         <p class="dica">Mesmas travas da tela da loja. Plano pago em empresa em teste encerra o teste (vira ATIVA).</p>${campoMotivo()}`,
        'Trocar plano',
      )}
    </div></details>
    <details class="acao"><summary>Módulos à parte <span class="mini">${[temFabrica ? 'Fábrica' : '', temFarol ? `Farol ${l.farolMarcas}` : ''].filter(Boolean).join(' · ') || 'nenhum'}</span></summary><div class="corpo">
      ${(['fabrica', 'farol'] as const)
        .map((m) => {
          const ligado = l.modulos.includes(m)
          return form(
            c, slug, 'modulo',
            `${ligado ? 'Desligar' : 'Ligar'} ${MODULOS[m].titulo} em /${slug}?`,
            `<input type="hidden" name="modulo" value="${m}"><input type="hidden" name="ligar" value="${ligado ? '0' : '1'}">
             <p class="dica"><b>${esc(MODULOS[m].titulo)}</b> — ${ligado ? 'ligado' : 'desligado'}. ${m === 'farol' ? `Cobra ${mostrar(precoDoFarol(l.farolMarcas) * 100)}/mês pelas ${l.farolMarcas} marca(s).` : 'Cobra por unidade marcada como fábrica.'}</p>${campoMotivo()}`,
            `${ligado ? 'Desligar' : 'Ligar'} ${MODULOS[m].titulo}`,
            ligado ? 'sec' : '',
          )
        })
        .join('<hr>')}
      <hr>
      ${form(
        c, slug, 'farol-marcas',
        `Mudar as marcas do Farol contratadas por /${slug}?`,
        `<label>Marcas do Farol contratadas<input type="number" name="marcas" min="1" max="${FAROL_MARCAS_MAX}" value="${l.farolMarcas}" required></label>
         <p class="dica">Teto de marcas ativas e linha do Farol na conta.${temFarol ? '' : ' O Farol está desligado: não cobra até ligar.'}</p>${campoMotivo()}`,
        'Salvar marcas',
        'sec',
      )}
    </div></details>
    <details class="acao"><summary>Pacote de respostas <span class="mini">${respostasTxt(l.respostas)}</span></summary><div class="corpo">
      ${form(
        c, slug, 'respostas',
        `Pôr um pacote de +${milhar(PRECOS.pacoteRespostas)} respostas em /${slug}? Vale para este mês.`,
        `${abertos.some((p) => p.tipo === 'respostas') ? '<label class="marcar"><input type="checkbox" name="atendePedido" value="1" checked> Atende o pedido de respostas aberto</label>' : ''}
         <p class="dica">+${milhar(PRECOS.pacoteRespostas)} respostas no mês e o teto de IA delas no cofre. O mesmo caminho do pagamento.</p>${campoMotivo()}`,
        `Pôr +${milhar(PRECOS.pacoteRespostas)} respostas`,
      )}
    </div></details>
    <details class="acao"><summary>Cofre de IA (modelo antigo) <span class="mini">${mostrar(l.creditoSaldoCent)}</span></summary><div class="corpo">
      ${form(
        c, slug, 'credito',
        `Lançar crédito de IA em /${slug}? A loja lê o motivo no extrato.`,
        `<div class="lado"><label>Valor (R$)<input name="valor" required inputmode="decimal" placeholder="150,00"></label>
         <label>Tipo<select name="tipo"><option value="COMPRA">Compra (pago)</option><option value="AJUSTE">Ajuste (cortesia/correção)</option></select></label></div>
         ${abertos.some((p) => p.tipo === 'credito') ? '<label class="marcar"><input type="checkbox" name="atendePedido" value="1" checked> Atende o pedido de crédito aberto</label>' : ''}
         <p class="dica">Até ${mostrar(TETO_RECARGA_CENT)} por lançamento. Ajuste aceita negativo, nunca deixando o saldo abaixo de zero.</p>${campoMotivo('Motivo — a loja lê no extrato')}`,
        'Lançar crédito',
      )}
    </div></details>
    <details class="acao"><summary>Acesso de suporte <span class="mini">${suportes.length ? `${suportes.length} ativo(s)` : 'nenhum'}</span></summary><div class="corpo">
      ${suportes
        .map((u) =>
          form(
            c, slug, 'suporte-revogar',
            `Encerrar agora o acesso de suporte de ${u.email} em /${slug}?`,
            `<input type="hidden" name="email" value="${esc(u.email)}"><p class="dica"><b>${esc(u.nome)}</b> · ${esc(u.email)}<br>${u.papeis.filter((p) => p.papel === 'SUPORTE').map(papelTxt).join('')}</p>${campoMotivo('Motivo do encerramento')}`,
            'Revogar agora', 'perigo',
          ),
        )
        .join('<hr>')}${suportes.length ? '<hr>' : ''}
      ${form(
        c, slug, 'suporte',
        `Dar acesso de SUPORTE em /${slug}, no modo escolhido? Cada tela aberta vira linha no livro da loja, com este motivo, e cada mudança sai assinada "Equipe Norte".`,
        `<label>E-mail de quem vai entrar${dominioDaEquipe ? ` (@${esc(dominioDaEquipe)})` : ''}<input type="email" name="email" required placeholder="voce@gestornorte.com"></label>
         <div class="lado"><label>Horas (1 a ${SUPORTE_MAX_HORAS})<input type="number" name="horas" min="1" max="${SUPORTE_MAX_HORAS}" value="4" required></label>
         <label>Nome (opcional)<input name="nome" maxlength="80" placeholder="Suporte do Norte"></label></div>
         <label>Modo<select name="modo"><option value="leitura">Só leitura</option><option value="edicao">Edição — arruma produto, preço, estoque, catálogo, Configurações, convites, encomendas</option></select></label>
         <p class="dica">Edição nunca vende, não mexe no caixa, no dinheiro nem na Assinatura, não apaga dado e não troca o dono. A dona vê "Suporte do Norte · edição" na Equipe e pode cortar.</p>
         <p class="dica">A conta nasce sem senha; o link de definir senha vai para o e-mail da pessoa. Depois, entra por <b>${esc(entrada)}</b>.</p>${campoMotivo('Motivo — a loja lê em cada tela aberta')}`,
        'Conceder suporte',
      )}
    </div></details>
    <details class="acao"><summary>Convite do dono <span class="mini">${donoPendente ? 'pendente' : 'já entrou'}</span></summary><div class="corpo">
      ${donoPendente
        ? form(
            c, slug, 'reconvidar',
            `Refazer o convite do dono de /${slug}? O link anterior para de abrir.`,
            `<label>E-mail do dono (vazio = ${esc(l.emailDaEmpresa ?? 'o da venda')})<input type="email" name="email" placeholder="${esc(l.emailDaEmpresa ?? '')}"></label>
             <p class="dica">O link aparece UMA vez, aqui, depois de aplicar. Vale 7 dias e serve uma vez.</p>${campoMotivo()}`,
            'Refazer convite',
          )
        : '<p class="dica">O dono já entrou. Convite novo de outra pessoa sai pela tela de Equipe da própria empresa.</p>'}
    </div></details>
  </aside>`

  return pagina(
    c,
    l.nome,
    'empresas',
    `<p class="mini"><a href="/">← Empresas</a></p>
    <div class="linha-titulo"><h1>${esc(l.nome)}</h1>${chip(l.situacao)}<span class="pilula">${esc(tituloPlano(l.plano))}</span>${temFabrica || temFarol ? aParte(l) : ''}</div>
    <div class="sub">/${esc(slug)} · ${l.lojas} loja(s)${l.depositos ? `, ${l.depositos} depósito(s)` : ''} · ${l.pessoas} pessoa(s) · última atividade ${l.ultimaAtividade ? `${haQuanto(l.ultimaAtividade, c.agora)} (${dataHora(l.ultimaAtividade)})` : 'nunca'} · entrada: <span class="copiar">${esc(entrada)}</span></div>
    <div class="grade"><div class="coluna">
      <div class="tres">${cardConta}${cardCredito}${cardDono}</div>
      ${secao('Lojas e depósitos', `${d.unidades.filter((u) => u.ativa).length} ativa(s)`, tabelaLojas)}
      ${secao('Equipe', 'só dados de conta', tabelaEquipe)}
      ${secao('Pedidos de plano e de respostas', 'últimos 180 dias', tabelaPedidos)}
      ${secao('Extrato do cofre de IA', 'últimos 12 lançamentos', tabelaRecargas)}
      ${secao('O que a equipe do Norte fez aqui', 'livro da loja, linhas "Equipe Norte (...)"', livro)}
    </div>${acoes}</div>`,
  )
}

// ── 3. PEDIDOS ───────────────────────────────────────────────

export function telaPedidos(c: Contexto, itens: { empresa: LinhaEmpresa; pedido: Pedido }[]): string {
  const corpo = itens.length
    ? `<div class="tabela-caixa"><table><thead><tr><th>Empresa</th><th>Pedido em</th><th>Pediu</th><th>Hoje</th><th>Atender</th><th>Recusar</th></tr></thead><tbody>${itens
        .map(({ empresa: l, pedido: p }) => {
          const atender =
            p.tipo === 'plano' && p.plano
              ? form(c, l.slug, 'plano', `Trocar /${l.slug} para o plano ${tituloPlano(p.plano)}, atendendo o pedido?`,
                  `<input type="hidden" name="para" value="${esc(p.plano)}"><input type="hidden" name="pedidoId" value="${esc(p.id)}"><input type="hidden" name="voltar" value="/pedidos">${campoMotivo('Motivo (ex.: Pix confirmado)')}`,
                  `Trocar para ${tituloPlano(p.plano)}`, 'ok')
              : p.tipo === 'credito' && p.centavos
                ? form(c, l.slug, 'credito', `Pôr ${mostrar(p.centavos)} de crédito de IA em /${l.slug}, atendendo o pedido?`,
                    `<input type="hidden" name="valor" value="${esc((p.centavos / 100).toFixed(2).replace('.', ','))}"><input type="hidden" name="tipo" value="COMPRA"><input type="hidden" name="pedidoId" value="${esc(p.id)}"><input type="hidden" name="voltar" value="/pedidos">${campoMotivo('Motivo — a loja lê no extrato')}`,
                    `Pôr ${mostrar(p.centavos)}`, 'ok')
                : p.tipo === 'respostas'
                  ? form(c, l.slug, 'respostas', `Pôr um pacote de +${milhar(PRECOS.pacoteRespostas)} respostas em /${l.slug}, atendendo o pedido?`,
                      `<input type="hidden" name="pedidoId" value="${esc(p.id)}"><input type="hidden" name="voltar" value="/pedidos">${campoMotivo('Motivo (ex.: Pix confirmado)')}`,
                      `Pôr +${milhar(PRECOS.pacoteRespostas)} respostas`, 'ok')
                  : `<a href="/empresa/${esc(l.slug)}">abrir a empresa</a>`
          const recusar = form(c, l.slug, 'recusar', `Recusar o pedido de ${p.oQue} de /${l.slug}?`,
            `<input type="hidden" name="tipo" value="${p.tipo}"><input type="hidden" name="pedidoId" value="${esc(p.id)}"><input type="hidden" name="voltar" value="/pedidos">${campoMotivo('Motivo da recusa — a loja lê')}`,
            'Recusar', 'perigo')
          return `<tr>
            <td><a class="nome" href="/empresa/${esc(l.slug)}">${esc(l.nome)}</a><div class="mini">/${esc(l.slug)}</div></td>
            <td>${dataHora(p.criadoEm)}<div class="mini">${haQuanto(p.criadoEm, c.agora)}</div></td>
            <td><span class="pilula ambar">${esc(ROTULO_PEDIDO[p.tipo])}</span><div><b>${esc(p.oQue)}</b></div></td>
            <td>${chip(l.situacao)}<div class="mini">${esc(tituloPlano(l.plano))} · respostas ${respostasTxt(l.respostas)}</div></td>
            <td>${atender}</td><td>${recusar}</td></tr>`
        })
        .join('')}</tbody></table></div>`
    : '<div class="tabela-caixa"><div class="vazio">Nenhum pedido esperando resposta.</div></div>'
  return pagina(
    c,
    'Pedidos',
    'pedidos',
    `<div class="linha-titulo"><h1>Pedidos</h1><span class="sub">planos e pacotes de respostas que as lojas pediram na tela da Assinatura e esperam resposta</span></div>
    <p class="dica abaixo">O pedido fecha pela própria resposta: a troca de plano, o pacote de respostas ou a recarga apontam para ele, e a recusa leva o motivo que a loja lê.</p>
    ${corpo}`,
  )
}
