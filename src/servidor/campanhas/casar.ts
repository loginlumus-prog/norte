// Quem entra em qual campanha — e quando a mensagem não é de campanha nenhuma.
//
// PURO. É aqui que mora a parte que decide se a loja fala ou cala, então é
// aqui que os testes batem mais forte (tests/campanhas-motor.test.ts).
//
// ── como uma mensagem acha a campanha ────────────────────────
//   1. O ANÚNCIO primeiro. Quem chegou pelo clique num anúncio de WhatsApp
//      chega com o id dele, e esse id é inequívoco — a frase não é.
//   2. Depois a FRASE MAIS LONGA contida na mensagem. "quero o catálogo de
//      verão" contém "catálogo" e "catálogo de verão": a mais longa é a mais
//      específica, e é a que a loja quis dizer.
//
// A comparação ignora acento, maiúscula e pontuação, e respeita a palavra
// inteira: "promo" não casa com "promoção", e "cat" não casa com "catálogo".
// Frase com menos de três letras é ignorada — "oi" casaria com metade das
// conversas da loja.

import {
  FRASE_MIN,
  REENTRADA_PADRAO,
  type Gatilho,
  type Reentrada,
} from './tipos'

/** "Catálogo, por favor!" → "catalogo por favor". */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A frase aparece na mensagem, como palavras inteiras? Ambas já normalizadas. */
export function contemFrase(mensagemNormalizada: string, fraseNormalizada: string): boolean {
  if (fraseNormalizada.length < FRASE_MIN) return false
  return ` ${mensagemNormalizada} `.includes(` ${fraseNormalizada} `)
}

/** As frases que valem: normalizadas, sem as curtas demais, sem repetição. */
export function frasesValidas(frases: string[]): string[] {
  const vistas = new Set<string>()
  for (const f of frases) {
    const n = normalizar(f)
    if (n.length >= FRASE_MIN) vistas.add(n)
  }
  return [...vistas]
}

export type CampanhaCasavel = { id: string; nome?: string; gatilho: Gatilho }

export type Casamento = { campanhaId: string; por: 'anuncio' | 'frase'; frase?: string }

/**
 * A campanha que esta mensagem abre, entre as ATIVAS. Nula quando nenhuma.
 *
 * Campanha 'manual' nunca entra por aqui: ela só existe para receber quem
 * vem de outra campanha ("Ir para outra campanha") ou do teste.
 */
export function acharCampanha(
  texto: string,
  anuncioId: string | null | undefined,
  campanhas: CampanhaCasavel[],
): Casamento | null {
  const candidatas = campanhas.filter((c) => c.gatilho.tipo === 'frase')

  const anuncio = (anuncioId ?? '').trim()
  if (anuncio) {
    const porAnuncio = candidatas.find((c) => c.gatilho.anuncioIds.some((a) => a.trim() === anuncio))
    if (porAnuncio) return { campanhaId: porAnuncio.id, por: 'anuncio' }
  }

  const msg = normalizar(texto)
  if (!msg) return null
  let melhor: Casamento | null = null
  for (const c of candidatas) {
    for (const f of frasesValidas(c.gatilho.frases)) {
      if (!contemFrase(msg, f)) continue
      // Empate de tamanho entre campanhas não acontece: a mesma frase não
      // pode estar em duas ativas (`conflitosDeGatilho`). Entre frases da
      // mesma campanha, tanto faz.
      if (!melhor || f.length > (melhor.frase?.length ?? 0)) {
        melhor = { campanhaId: c.id, por: 'frase', frase: f }
      }
    }
  }
  return melhor
}

// ─────────────────────────────────────────────────────────────
// PARAR
// ─────────────────────────────────────────────────────────────

/**
 * Palavras que, SOZINHAS, tiram a pessoa da campanha. "Não quero" no meio de
 * "não quero o azul, quero o preto" é resposta, não pedido de saída — por
 * isso vale só a mensagem inteira.
 *
 * Além de tirar da campanha, o pedido grava a saída PERMANENTE (lista de quem
 * não recebe oferta, ver ../ofertas.ts) — e isso é feito pela entrada
 * (entrada.ts), antes desta decisão. Sem campanha no meio, só as que não
 * deixam dúvida valem (PARADAS_INEQUIVOCAS, em ofertas.ts).
 */
export const PALAVRAS_DE_PARADA = ['parar', 'pare', 'sair', 'cancelar', 'nao quero', 'stop', 'descadastrar'] as const

export const ehPedidoDeParada = (texto: string): boolean =>
  (PALAVRAS_DE_PARADA as readonly string[]).includes(normalizar(texto))

// ─────────────────────────────────────────────────────────────
// REENTRADA
// ─────────────────────────────────────────────────────────────

/**
 * A pessoa pode entrar DE NOVO nesta campanha?
 *
 * `ultimaEntrada` é quando ela entrou pela última vez (fora de teste), ou
 * nula se nunca entrou. Reentrada desconhecida vira a padrão — o lado seguro.
 */
export function podeReentrar(
  g: Pick<Gatilho, 'reentrada' | 'reentradaDias'>,
  ultimaEntrada: Date | null,
  agora: Date,
): boolean {
  if (!ultimaEntrada) return true
  const regra: Reentrada = ['nunca', 'depois', 'sempre'].includes(g.reentrada) ? g.reentrada : REENTRADA_PADRAO
  if (regra === 'sempre') return true
  if (regra === 'nunca') return false
  const dias = Math.max(1, Math.floor(g.reentradaDias ?? 0) || 1)
  return agora.getTime() - ultimaEntrada.getTime() >= dias * 86_400_000
}

// ─────────────────────────────────────────────────────────────
// A DECISÃO
// ─────────────────────────────────────────────────────────────

export type Viva = { id: string; campanhaId: string; status: string }

export type Decisao =
  | { acao: 'ignorar' }
  | { acao: 'cancelar'; execucaoId: string }
  | { acao: 'iniciar'; campanhaId: string }
  | { acao: 'trocar'; execucaoId: string; campanhaId: string }
  | { acao: 'responder'; execucaoId: string }

/**
 * O que fazer com uma mensagem de cliente. Sem banco: recebe o que já foi
 * lido (a execução viva dela, as campanhas ativas, quando ela entrou pela
 * última vez em cada uma) e devolve a decisão.
 *
 *   • "parar" sozinho, com campanha viva → sai dela. Sem campanha → nada.
 *   • casou com OUTRA campanha e a reentrada dela deixa → troca de funil:
 *     encerra a atual ('outro_fluxo') e começa a nova. Não deixa → fica.
 *   • com campanha viva, o resto é resposta para ela.
 *   • sem campanha viva, casou e pode entrar → começa. Senão → nada.
 */
export function decidir(p: {
  texto: string
  anuncioId?: string | null
  viva: Viva | null
  ativas: CampanhaCasavel[]
  ultimaEntrada: (campanhaId: string) => Date | null
  agora: Date
}): Decisao {
  if (ehPedidoDeParada(p.texto)) {
    return p.viva ? { acao: 'cancelar', execucaoId: p.viva.id } : { acao: 'ignorar' }
  }

  const casou = acharCampanha(p.texto, p.anuncioId, p.ativas)
  const pode = (id: string) => {
    const c = p.ativas.find((a) => a.id === id)
    return !!c && podeReentrar(c.gatilho, p.ultimaEntrada(id), p.agora)
  }

  if (p.viva) {
    if (casou && casou.campanhaId !== p.viva.campanhaId && pode(casou.campanhaId)) {
      return { acao: 'trocar', execucaoId: p.viva.id, campanhaId: casou.campanhaId }
    }
    return { acao: 'responder', execucaoId: p.viva.id }
  }

  if (casou && pode(casou.campanhaId)) return { acao: 'iniciar', campanhaId: casou.campanhaId }
  return { acao: 'ignorar' }
}

// ─────────────────────────────────────────────────────────────
// CONFLITO ENTRE CAMPANHAS
// ─────────────────────────────────────────────────────────────

/**
 * Duas campanhas ATIVAS da mesma empresa não dividem frase nem anúncio.
 *
 * Se dividissem, qual delas a pessoa recebe dependeria da ordem em que o
 * banco devolveu as linhas — e a loja nunca saberia por que a cliente de
 * ontem recebeu o roteiro errado. Conferido ao salvar e ao ativar.
 *
 * Frase contida em outra ("catálogo" e "catálogo de verão") NÃO é conflito:
 * a mais longa ganha, e é isso que a loja espera.
 */
export function conflitosDeGatilho(
  minha: CampanhaCasavel,
  outrasAtivas: CampanhaCasavel[],
): string[] {
  if (minha.gatilho.tipo !== 'frase') return []
  const problemas: string[] = []
  const minhas = new Set(frasesValidas(minha.gatilho.frases))
  const meusAnuncios = new Set(minha.gatilho.anuncioIds.map((a) => a.trim()).filter(Boolean))
  for (const o of outrasAtivas) {
    if (o.id === minha.id || o.gatilho.tipo !== 'frase') continue
    for (const f of frasesValidas(o.gatilho.frases)) {
      if (minhas.has(f)) problemas.push(`A frase "${f}" já abre a campanha "${o.nome ?? 'outra'}".`)
    }
    for (const a of o.gatilho.anuncioIds) {
      if (meusAnuncios.has(a.trim())) problemas.push(`O anúncio ${a.trim()} já abre a campanha "${o.nome ?? 'outra'}".`)
    }
  }
  return problemas
}

/** Um gatilho que veio do navegador (ou do banco), com os campos no lugar. */
export function lerGatilho(bruto: unknown): Gatilho {
  const g = (bruto && typeof bruto === 'object' ? bruto : {}) as Partial<Gatilho>
  const lista = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 50) : []
  const reentrada: Reentrada = g.reentrada === 'depois' || g.reentrada === 'sempre' || g.reentrada === 'nunca' ? g.reentrada : REENTRADA_PADRAO
  const dias = Number(g.reentradaDias)
  return {
    tipo: g.tipo === 'manual' ? 'manual' : 'frase',
    frases: lista(g.frases).map((f) => f.slice(0, 80)),
    anuncioIds: lista(g.anuncioIds).map((a) => a.slice(0, 64)),
    reentrada,
    ...(reentrada === 'depois' ? { reentradaDias: Number.isFinite(dias) ? Math.min(365, Math.max(1, Math.round(dias))) : 7 } : {}),
  }
}
