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
 * As palavras de parada, na forma mais curta — o que a tela e o texto de
 * aceite ensinam. Quem decide se uma MENSAGEM é pedido de parada é
 * `lerParada`, abaixo, e é ela que todo caminho usa (a entrada das
 * campanhas, a lista de ofertas, a porta com o assistente desligado).
 */
export const PALAVRAS_DE_PARADA = ['parar', 'pare', 'sair', 'cancelar', 'nao quero', 'stop', 'descadastrar'] as const

/**
 * 'certa'       = não deixa dúvida: vale mesmo SEM campanha em andamento
 *                 ("parar", "quero sair", "pare de mandar", "sair da lista");
 * 'em_campanha' = só vale DENTRO de uma campanha ("cancelar", "não quero",
 *                 "para"): sozinhas, sem roteiro no meio, costumam ser sobre
 *                 outra coisa (cancelar a encomenda) — e a equipe está lendo;
 * null          = não é pedido de parada.
 */
export type Parada = 'certa' | 'em_campanha'

/** Os verbos que sozinhos já dizem "chega". */
const VERBOS_FORTES = new Set(['parar', 'pare', 'parem', 'sair', 'stop', 'descadastrar', 'descadastre', 'descadastra', 'descadastrem', 'unsubscribe'])
/** Os que dizem "chega" só dentro de campanha — ou com o objeto junto ("cancelar as mensagens"). */
const VERBOS_DE_CAMPANHA = new Set(['cancelar', 'cancela', 'cancele', 'para', 'chega'])
/** Os que só dizem "chega" com o objeto junto ("me tira da lista"); sozinhos, nada ("tira uma foto?"). */
const VERBOS_COM_OBJETO = new Set(['tirar', 'tira', 'tire', 'tirem', 'remover', 'remove', 'remova', 'removam', 'excluir', 'exclui', 'exclua', 'apagar', 'apaga', 'apague'])
/** O objeto que transforma "cancela"/"tira" em pedido de saída. */
const OBJETOS = new Set([
  'lista', 'listas', 'mensagem', 'mensagens', 'msg', 'msgs', 'oferta', 'ofertas', 'promocao', 'promocoes',
  'propaganda', 'propagandas', 'inscricao', 'cadastro', 'numero', 'contato', 'mandar', 'enviar', 'receber',
  'mandarem', 'enviarem', 'notificacoes', 'novidades', 'campanha', 'campanhas',
])
/** O que pode vir ANTES do verbo sem mudar o pedido: "bom dia, eu quero parar". */
const ANTES = new Set([
  'eu', 'quero', 'queria', 'gostaria', 'de', 'pode', 'podem', 'poderia', 'poderiam', 'favor', 'por', 'pfv', 'pf',
  'pls', 'ok', 'ta', 'so', 'me', 'agora', 'ja', 'oi', 'ola', 'bom', 'boa', 'dia', 'tarde', 'noite', 'entao', 'e',
  'vou', 'desejo', 'preciso', 'voces', 'vcs', 'vc', 'moca', 'moco',
])
/**
 * O que pode vir DEPOIS do verbo. Uma palavra fora destas listas e a mensagem
 * já é conversa, não pedido: "parar o carro aí?", "sair mais cedo hoje",
 * "não quero mais esse tamanho, tem o M?" — nada disso tira ninguém da lista.
 */
const DEPOIS = new Set([
  ...OBJETOS,
  'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'essa', 'esse', 'essas', 'esses', 'isso', 'isto', 'disso',
  'desse', 'dessa', 'desses', 'dessas', 'me', 'mim', 'meu', 'minha', 'com', 'por', 'favor', 'pfv', 'pf', 'pls',
  'obrigado', 'obrigada', 'obg', 'grato', 'grata', 'valeu', 'vlw', 'agora', 'ja', 'mais', 'tudo', 'aqui', 'whatsapp',
  'whats', 'zap', 'wpp', 'voces', 'vcs', 'sua', 'suas', 'seu', 'seus', 'e', 'pra', 'para', 'nunca', 'nada', 'ok',
  'grupo', 'vez', 'todas', 'todos',
])

/** Depois de "não quero...", o "não" do fim é só o jeito de falar: "não quero mais receber não". */
const DEPOIS_DO_NAO = new Set([...DEPOIS, 'nao'])

const soAs = (palavras: string[], permitidas: Set<string>) => palavras.every((p) => permitidas.has(p))

/**
 * A mensagem é um pedido para parar? A ÚNICA régua — a entrada das
 * campanhas, a lista de ofertas e a porta com o assistente desligado passam
 * todas por aqui.
 *
 * Conservadora de propósito. Tirar da lista quem não pediu custa pouco (a
 * pessoa manda VOLTAR); mandar a confirmação "você não recebe mais ofertas"
 * no meio de uma conversa de venda custa a venda. Por isso a mensagem inteira
 * precisa ser o pedido: o verbo, o que é educação ("por favor", "obrigada"),
 * o objeto ("as mensagens", "da lista") — e nada mais. Mensagem longa (mais
 * de 12 palavras) é conversa, e uma pessoa da loja lê.
 *
 *   "quero parar", "Parar por favor", "PARE DE MANDAR", "sair da lista",
 *   "não quero mais receber"                        → 'certa'
 *   "cancelar", "não quero", "não quero mais", "para" → 'em_campanha'
 *   "para amanhã?", "não quero mais esse tamanho, tem o M?",
 *   "não pare", "que horas vocês vão parar?"         → null
 */
export function lerParada(texto: string): Parada | null {
  const palavras = normalizar(texto).split(' ').filter(Boolean)
  if (palavras.length === 0 || palavras.length > 12) return null

  // "não quero (mais) ..." / "não me mande(m) mais ..."
  if (palavras[0] === 'nao' || (palavras[0] === 'eu' && palavras[1] === 'nao')) {
    const resto = palavras.slice(palavras[0] === 'eu' ? 2 : 1)
    if ((resto[0] === 'quero' || resto[0] === 'desejo') && soAs(resto.slice(1), DEPOIS_DO_NAO)) {
      // "não quero mais receber" tem o objeto: não deixa dúvida. "Não quero"
      // e "não quero mais" sozinhos respondem a uma pergunta — dentro de uma
      // campanha, a pergunta era dela; fora, é da loja.
      return resto.slice(1).some((p) => OBJETOS.has(p)) ? 'certa' : 'em_campanha'
    }
    if (resto[0] === 'me' && /^(mande|mandem|manda|envie|enviem|envia)$/.test(resto[1] ?? '') && soAs(resto.slice(2), DEPOIS_DO_NAO)) {
      return 'certa'
    }
    return null
  }

  // O verbo, depois do que pode vir antes dele.
  let i = 0
  while (i < palavras.length && ANTES.has(palavras[i]!) && !VERBOS_FORTES.has(palavras[i]!)) i++
  const verbo = palavras[i]
  if (!verbo) return null
  const resto = palavras.slice(i + 1)
  if (!soAs(resto, DEPOIS)) return null
  const temObjeto = resto.some((p) => OBJETOS.has(p))

  if (VERBOS_FORTES.has(verbo)) return 'certa'
  if (VERBOS_DE_CAMPANHA.has(verbo)) {
    // "para de mandar" é pedido; "para" sozinho pode ser o começo de "para
    // amanhã?" mandado pela metade — só dentro de campanha.
    return temObjeto ? 'certa' : 'em_campanha'
  }
  if (VERBOS_COM_OBJETO.has(verbo)) return temObjeto ? 'certa' : null
  return null
}

/** Pedido de parada que vale DENTRO de uma campanha (as 'certas' valem também). */
export const ehPedidoDeParada = (texto: string): boolean => lerParada(texto) !== null

/**
 * "VOLTAR" — o caminho de volta de quem está na lista. A mesma régua
 * conservadora: "quero voltar a receber" volta; "quero voltar ao menu" não.
 */
export function ehPedidoDeVolta(texto: string): boolean {
  const palavras = normalizar(texto).split(' ').filter(Boolean)
  let i = 0
  while (i < palavras.length && ANTES.has(palavras[i]!)) i++
  if (palavras[i] !== 'voltar' && palavras[i] !== 'volta' && palavras[i] !== 'volto') return false
  return soAs(palavras.slice(i + 1), new Set(['a', 'receber', 'as', 'os', 'ofertas', 'mensagens', 'novidades', 'por', 'favor', 'pfv', 'obrigado', 'obrigada', 'quero', 'pra', 'lista']))
}

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
