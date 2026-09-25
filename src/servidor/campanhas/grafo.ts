// O desenho da campanha: ler, conferir, e andar por ele.
//
// PURO. Serve ao editor (as "Pendências" que aparecem enquanto a loja
// desenha), ao servidor (que confere tudo de novo antes de gravar — o que
// chega do navegador é pedido, não ordem) e ao motor.

import {
  DIGITANDO_MAX_SEG,
  MS_UNIDADE,
  ROTULO_NO,
  type Aresta,
  type DadosPorTipo,
  type Grafo,
  type ModeloDoBloco,
  type No,
  type TipoNo,
  type UnidadeTempo,
  type Vars,
} from './tipos'
import { normalizar } from './casar'

export const TIPOS_NO: TipoNo[] = [
  'inicio',
  'mensagem',
  'midia',
  'intervalo',
  'aguardar_resposta',
  'condicao',
  'distribuidor',
  'passar_para_pessoa',
  'conectar',
  'fim',
]

// ─────────────────────────────────────────────────────────────
// SAÍDAS
// ─────────────────────────────────────────────────────────────

/** As saídas que um bloco oferece, na ordem em que a tela mostra. */
export function saidasDoNo(no: No): { id: string; rotulo: string }[] {
  switch (no.tipo) {
    case 'inicio':
    case 'mensagem':
    case 'midia':
    case 'intervalo':
      return [{ id: 'saida', rotulo: 'depois' }]
    case 'aguardar_resposta':
      return [
        { id: 'respondeu', rotulo: 'respondeu' },
        { id: 'sem_resposta', rotulo: 'não respondeu' },
      ]
    case 'condicao':
      return [
        ...no.dados.regras.map((r) => ({ id: r.id, rotulo: r.rotulo || r.palavras.join(', ') || 'regra' })),
        { id: 'outro', rotulo: 'qualquer outra coisa' },
      ]
    case 'distribuidor':
      return no.dados.ramos.map((r) => ({ id: r.id, rotulo: `${r.rotulo || r.id} (${r.peso})` }))
    case 'passar_para_pessoa':
    case 'conectar':
    case 'fim':
      return []
  }
}

/** O bloco ligado a esta saída — ou nulo, que é o fim do roteiro por ali. */
export function proximo(g: Grafo, de: string, saida: string): string | null {
  return g.edges.find((e) => e.de === de && e.saida === saida)?.para ?? null
}

export const acharNo = (g: Grafo, id: string): No | undefined => g.nodes.find((n) => n.id === id)
export const inicioDo = (g: Grafo): No | undefined => g.nodes.find((n) => n.tipo === 'inicio')

// ─────────────────────────────────────────────────────────────
// LER (o que veio do navegador ou do banco)
// ─────────────────────────────────────────────────────────────

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const numero = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao
}
const id = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null)
const unidade = (v: unknown): UnidadeTempo => (v === 'min' || v === 'h' || v === 'd' ? v : 'h')

/** Nome de modelo na Meta: minúsculas, números e sublinhado. */
export const FORMATO_NOME_MODELO = /^[a-z0-9_]{1,512}$/
/** Idioma de modelo: "pt_BR", "en_US", "es"... */
export const FORMATO_IDIOMA = /^[a-z]{2,3}(_[A-Z]{2})?$/

/** O modelo aprovado de um bloco de mensagem, limpo — ou nulo se não serve. */
export function lerModeloDoBloco(bruto: unknown): ModeloDoBloco | null {
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>
  const nome = typeof o.nome === 'string' ? o.nome.trim() : ''
  const idioma = typeof o.idioma === 'string' ? o.idioma.trim() : ''
  if (!FORMATO_NOME_MODELO.test(nome) || !FORMATO_IDIOMA.test(idioma)) return null
  const variaveis = Array.isArray(o.variaveis) ? o.variaveis.map((v) => texto(v, 200)).slice(0, 20) : []
  return { nome, idioma, variaveis }
}

/**
 * O que vai em cada variável do modelo para ESTA pessoa: os coringas
 * trocados pelo que o roteiro sabe dela.
 *
 * A Meta recusa variável vazia (o envio inteiro volta com erro). Então o que
 * ficou vazio vira uma palavra neutra: "cliente" quando a variável era o nome
 * da pessoa (o caso comum: "Oi, {primeiro_nome}!"), e um traço no resto.
 */
export function variaveisDoModelo(m: ModeloDoBloco, vars: Vars): string[] {
  return m.variaveis.map((v) => {
    const valor = interpolar(v, vars)
    if (valor) return valor
    return /\{(primeiro_nome|nome)\}/.test(v) ? 'cliente' : '-'
  })
}

/** Dados padrão de cada bloco — o que nasce quando a loja clica na paleta. */
export function dadosPadrao<T extends TipoNo>(tipo: T): DadosPorTipo[T] {
  const d: { [K in TipoNo]: DadosPorTipo[K] } = {
    inicio: {},
    mensagem: { textos: [''], digitandoSeg: 2 },
    midia: { midiaId: null, tipo: null, legenda: '', comoGravado: false },
    intervalo: { quantidade: 1, unidade: 'h', soHorarioLoja: false, aoResponder: 'esperar' },
    aguardar_resposta: { quantidade: 24, unidade: 'h' },
    condicao: { regras: [{ id: 'r1', rotulo: 'Sim', palavras: ['sim', 'quero'] }] },
    distribuidor: {
      ramos: [
        { id: 'a', rotulo: 'A', peso: 50 },
        { id: 'b', rotulo: 'B', peso: 50 },
      ],
    },
    passar_para_pessoa: { para: 'donos', usuarioIds: [], mensagemContato: '' },
    conectar: { campanhaId: null },
    fim: { texto: '' },
  }
  return structuredClone(d[tipo])
}

function lerDados(tipo: TipoNo, bruto: unknown): DadosPorTipo[TipoNo] {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  switch (tipo) {
    case 'inicio':
      return {}
    case 'mensagem': {
      const textos = Array.isArray(b.textos) ? b.textos.map((t) => texto(t, 4000)).slice(0, 5) : ['']
      const modelo = lerModeloDoBloco(b.modelo)
      return {
        textos: textos.length ? textos : [''],
        digitandoSeg: Math.round(numero(b.digitandoSeg, 0, DIGITANDO_MAX_SEG, 2)),
        // só aparece quando existe: desenho antigo continua igual, byte a byte
        ...(modelo ? { modelo } : {}),
      }
    }
    case 'midia': {
      const t = b.tipo === 'imagem' || b.tipo === 'video' || b.tipo === 'audio' ? b.tipo : null
      return {
        midiaId: id(b.midiaId) ?? null,
        tipo: t,
        ...(typeof b.nome === 'string' ? { nome: b.nome.slice(0, 120) } : {}),
        legenda: texto(b.legenda, 1000),
        comoGravado: b.comoGravado === true,
      }
    }
    case 'intervalo':
      return {
        quantidade: Math.round(numero(b.quantidade, 1, 999, 1)),
        unidade: unidade(b.unidade),
        soHorarioLoja: b.soHorarioLoja === true,
        aoResponder: b.aoResponder === 'continuar' ? 'continuar' : 'esperar',
      }
    case 'aguardar_resposta':
      return { quantidade: Math.round(numero(b.quantidade, 1, 999, 24)), unidade: unidade(b.unidade) }
    case 'condicao': {
      const regras = Array.isArray(b.regras) ? b.regras : []
      return {
        regras: regras.slice(0, 10).flatMap((r) => {
          const o = (r ?? {}) as Record<string, unknown>
          const rid = id(o.id)
          if (!rid) return []
          const palavras = Array.isArray(o.palavras)
            ? o.palavras.map((p) => texto(p, 60).trim()).filter(Boolean).slice(0, 20)
            : []
          return [{ id: rid, rotulo: texto(o.rotulo, 40), palavras }]
        }),
      }
    }
    case 'distribuidor': {
      const ramos = Array.isArray(b.ramos) ? b.ramos : []
      return {
        ramos: ramos.slice(0, 6).flatMap((r) => {
          const o = (r ?? {}) as Record<string, unknown>
          const rid = id(o.id)
          return rid ? [{ id: rid, rotulo: texto(o.rotulo, 30), peso: Math.round(numero(o.peso, 0, 100, 50)) }] : []
        }),
      }
    }
    case 'passar_para_pessoa':
      return {
        para: b.para === 'pessoas' ? 'pessoas' : 'donos',
        usuarioIds: Array.isArray(b.usuarioIds) ? b.usuarioIds.map(id).filter((x): x is string => !!x).slice(0, 10) : [],
        mensagemContato: texto(b.mensagemContato, 1000),
      }
    case 'conectar':
      return { campanhaId: id(b.campanhaId) }
    case 'fim':
      return { texto: texto(b.texto, 4000) }
  }
}

/**
 * O grafo, limpo: só tipos conhecidos, dados no formato certo, ligações que
 * apontam para blocos que existem e saem de saídas que existem, uma ligação
 * por saída. Nunca lança — o que não serve fica de fora.
 */
export function lerGrafo(bruto: unknown): Grafo {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as { nodes?: unknown; edges?: unknown }
  const nodes: No[] = []
  const ids = new Set<string>()
  for (const n of Array.isArray(b.nodes) ? b.nodes.slice(0, 200) : []) {
    const o = (n ?? {}) as Record<string, unknown>
    const nid = id(o.id)
    const tipo = TIPOS_NO.find((t) => t === o.tipo)
    if (!nid || !tipo || ids.has(nid)) continue
    ids.add(nid)
    nodes.push({
      id: nid,
      tipo,
      x: Math.round(numero(o.x, -100_000, 100_000, 0)),
      y: Math.round(numero(o.y, -100_000, 100_000, 0)),
      dados: lerDados(tipo, o.dados),
    } as No)
  }
  const porId = new Map(nodes.map((n) => [n.id, n]))
  const edges: Aresta[] = []
  const usadas = new Set<string>()
  for (const e of Array.isArray(b.edges) ? b.edges.slice(0, 400) : []) {
    const o = (e ?? {}) as Record<string, unknown>
    const eid = id(o.id)
    const de = typeof o.de === 'string' ? porId.get(o.de) : undefined
    const para = typeof o.para === 'string' ? porId.get(o.para) : undefined
    const saida = typeof o.saida === 'string' ? o.saida : ''
    if (!eid || !de || !para || para.tipo === 'inicio') continue
    if (!saidasDoNo(de).some((s) => s.id === saida)) continue
    const chave = `${de.id}:${saida}`
    if (usadas.has(chave)) continue
    usadas.add(chave)
    edges.push({ id: eid, de: de.id, saida, para: para.id })
  }
  return { nodes, edges }
}

/** O desenho de uma campanha nova: início → mensagem → fim. */
export function grafoNovo(): Grafo {
  return {
    nodes: [
      { id: 'inicio', tipo: 'inicio', x: 0, y: 0, dados: {} },
      { id: 'm1', tipo: 'mensagem', x: 0, y: 140, dados: { textos: ['Oi, {primeiro_nome}! Que bom falar com você.'], digitandoSeg: 2 } },
      { id: 'f1', tipo: 'fim', x: 0, y: 300, dados: { texto: '' } },
    ],
    edges: [
      { id: 'e1', de: 'inicio', saida: 'saida', para: 'm1' },
      { id: 'e2', de: 'm1', saida: 'saida', para: 'f1' },
    ],
  }
}

// ─────────────────────────────────────────────────────────────
// PENDÊNCIAS
// ─────────────────────────────────────────────────────────────

export type Pendencia = {
  /** 'erro' impede ativar; 'aviso' só avisa. */
  nivel: 'erro' | 'aviso'
  texto: string
  nodeId?: string
}

/**
 * O que está errado no desenho. Com um 'erro' que seja, a campanha não pode
 * ser ativada (nem testada): roteiro quebrado mandando mensagem para cliente
 * é pior que roteiro nenhum.
 */
export function pendencias(
  g: Grafo,
  ctx: {
    campanhaId?: string
    /** As outras campanhas da empresa, para conferir "Ir para outra campanha". */
    campanhas?: { id: string; nome: string }[]
    frases?: string[]
    tipoGatilho?: 'frase' | 'manual'
    anuncioIds?: string[]
    /** O horário da loja foi entendido? Nulo = não se sabe (o editor não carregou). */
    horarioEntendido?: boolean | null
  } = {},
): Pendencia[] {
  const p: Pendencia[] = []
  const nome = (n: No) => ROTULO_NO[n.tipo]
  const inicios = g.nodes.filter((n) => n.tipo === 'inicio')
  if (inicios.length !== 1) p.push({ nivel: 'erro', texto: 'O desenho precisa de exatamente um bloco de Início.' })

  if (ctx.tipoGatilho === 'frase' && (ctx.frases ?? []).length === 0 && (ctx.anuncioIds ?? []).length === 0) {
    p.push({ nivel: 'erro', texto: 'Diga a frase que faz a pessoa entrar (no bloco Início).', nodeId: inicios[0]?.id })
  }
  if (ctx.tipoGatilho === 'frase') {
    for (const f of ctx.frases ?? []) {
      if (normalizar(f).length < 3) p.push({ nivel: 'aviso', texto: `A frase "${f}" é curta demais e será ignorada.`, nodeId: inicios[0]?.id })
    }
  }

  // Alcançáveis a partir do início.
  const alcancados = new Set<string>()
  const fila = inicios.slice(0, 1).map((n) => n.id)
  while (fila.length) {
    const atual = fila.shift()!
    if (alcancados.has(atual)) continue
    alcancados.add(atual)
    for (const e of g.edges) if (e.de === atual) fila.push(e.para)
  }
  for (const n of g.nodes) {
    if (n.tipo !== 'inicio' && !alcancados.has(n.id)) {
      p.push({ nivel: 'erro', texto: `"${nome(n)}" está solto: nada chega nele.`, nodeId: n.id })
    }
  }
  const inicio = inicios[0]
  if (inicio && !proximo(g, inicio.id, 'saida')) {
    p.push({ nivel: 'erro', texto: 'Ligue o Início ao primeiro bloco.', nodeId: inicio.id })
  }

  for (const n of g.nodes) {
    switch (n.tipo) {
      case 'mensagem':
        if (!n.dados.textos[0]?.trim()) p.push({ nivel: 'erro', texto: 'Mensagem vazia.', nodeId: n.id })
        if (n.dados.textos.slice(1).some((t) => !t.trim())) p.push({ nivel: 'aviso', texto: 'Uma variação da mensagem está vazia e será ignorada.', nodeId: n.id })
        break
      case 'midia':
        if (!n.dados.midiaId) p.push({ nivel: 'erro', texto: 'Escolha o arquivo do bloco de foto, vídeo ou áudio.', nodeId: n.id })
        break
      case 'intervalo':
        if (n.dados.soHorarioLoja && ctx.horarioEntendido === false) {
          p.push({ nivel: 'aviso', texto: 'O horário da loja não foi entendido (Lojas › horário). A espera vai ignorar o horário.', nodeId: n.id })
        }
        break
      case 'condicao': {
        if (n.dados.regras.length === 0) p.push({ nivel: 'erro', texto: 'A condição não tem nenhuma regra.', nodeId: n.id })
        for (const r of n.dados.regras) {
          if (r.palavras.length === 0) p.push({ nivel: 'erro', texto: `A regra "${r.rotulo || r.id}" não tem palavra.`, nodeId: n.id })
        }
        if (!g.nodes.some((x) => x.tipo === 'aguardar_resposta')) {
          p.push({ nivel: 'aviso', texto: 'A condição olha a resposta da pessoa, mas o roteiro não tem "Esperar resposta" antes.', nodeId: n.id })
        }
        break
      }
      case 'distribuidor': {
        if (n.dados.ramos.length < 2) p.push({ nivel: 'erro', texto: 'Dividir precisa de pelo menos dois caminhos.', nodeId: n.id })
        if (n.dados.ramos.reduce((s, r) => s + r.peso, 0) <= 0) p.push({ nivel: 'erro', texto: 'Os pesos da divisão somam zero.', nodeId: n.id })
        break
      }
      case 'passar_para_pessoa':
        if (n.dados.para === 'pessoas' && n.dados.usuarioIds.length === 0) {
          p.push({ nivel: 'erro', texto: 'Escolha quem da equipe recebe o contato.', nodeId: n.id })
        }
        break
      case 'conectar': {
        const alvo = n.dados.campanhaId
        if (!alvo) p.push({ nivel: 'erro', texto: 'Escolha a campanha de destino.', nodeId: n.id })
        else if (alvo === ctx.campanhaId) p.push({ nivel: 'erro', texto: 'O bloco leva para a própria campanha: seria um laço.', nodeId: n.id })
        else if (ctx.campanhas && !ctx.campanhas.some((c) => c.id === alvo)) {
          p.push({ nivel: 'erro', texto: 'A campanha de destino não existe mais.', nodeId: n.id })
        }
        break
      }
      default:
        break
    }
    // Bloco com saídas mas nenhuma ligada: vira fim sem querer. Só avisa.
    const saidas = saidasDoNo(n)
    if (n.tipo !== 'inicio' && saidas.length > 0 && alcancados.has(n.id) && saidas.every((s) => !proximo(g, n.id, s.id))) {
      p.push({ nivel: 'aviso', texto: `Depois de "${nome(n)}" o roteiro acaba (nenhuma saída ligada).`, nodeId: n.id })
    }
  }

  // Laço sem espera: dá voltas mandando mensagem até o freio de passos.
  const lacos = lacoSemEspera(g)
  if (lacos) p.push({ nivel: 'erro', texto: 'Há um caminho em círculo sem nenhuma espera: a pessoa receberia mensagens sem parar.', nodeId: lacos })

  return p
}

const ESPERA: TipoNo[] = ['intervalo', 'aguardar_resposta']

/** Um bloco de um ciclo que não passa por nenhuma espera, ou nulo. */
function lacoSemEspera(g: Grafo): string | null {
  const semEspera = new Set(g.nodes.filter((n) => !ESPERA.includes(n.tipo)).map((n) => n.id))
  const cor = new Map<string, 0 | 1 | 2>()
  let achado: string | null = null
  const visitar = (id: string) => {
    if (achado) return
    cor.set(id, 1)
    for (const e of g.edges) {
      if (e.de !== id || !semEspera.has(e.para)) continue
      const c = cor.get(e.para) ?? 0
      if (c === 1) {
        achado = e.para
        return
      }
      if (c === 0) visitar(e.para)
    }
    cor.set(id, 2)
  }
  for (const id of semEspera) if (!cor.get(id)) visitar(id)
  return achado
}

export const temErro = (ps: Pendencia[]) => ps.some((x) => x.nivel === 'erro')

// ─────────────────────────────────────────────────────────────
// TEXTO, ESCOLHAS DETERMINÍSTICAS, REGRAS
// ─────────────────────────────────────────────────────────────

/** FNV-1a de 32 bits: rápido, puro, o mesmo em qualquer máquina. */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Qual variação da mensagem esta pessoa recebe. SEMPRE a mesma para o mesmo
 * contato no mesmo bloco — quem pergunta "de novo?" à loja precisa ouvir a
 * mesma coisa, e o dono que testa com o próprio número vê o que o cliente vê.
 */
export function escolherVariacao(textos: string[], semente: string, nodeId: string): string {
  const validos = textos.filter((t) => t.trim())
  if (validos.length === 0) return ''
  return validos[hash32(`${semente}:${nodeId}`) % validos.length]!
}

/** O caminho do divisor A/B para esta pessoa, pelos pesos. Determinístico. */
export function escolherRamo(ramos: { id: string; peso: number }[], semente: string, nodeId: string): string | null {
  const total = ramos.reduce((s, r) => s + Math.max(0, r.peso), 0)
  if (total <= 0) return null
  let alvo = hash32(`${semente}:${nodeId}:ab`) % total
  for (const r of ramos) {
    const p = Math.max(0, r.peso)
    if (alvo < p) return r.id
    alvo -= p
  }
  return null
}

/** A primeira regra cuja palavra aparece na resposta (palavra inteira, sem acento). Senão 'outro'. */
export function rotearCondicao(regras: { id: string; palavras: string[] }[], resposta: string): string {
  const msg = normalizar(resposta)
  for (const r of regras) {
    for (const p of r.palavras) {
      const n = normalizar(p)
      // Aqui uma palavra de 1 ou 2 letras vale ("1", "2", "ok", "s"): é
      // resposta a uma pergunta que a loja fez, não gatilho solto.
      if (n && ` ${msg} `.includes(` ${n} `)) return r.id
    }
  }
  return 'outro'
}

/** {primeiro_nome}, {nome}, {resposta}. O que falta some sem deixar vírgula sobrando. */
export function interpolar(modelo: string, vars: Vars): string {
  const nome = (vars.nome ?? '').trim()
  const primeiro = nome.split(/\s+/)[0] ?? ''
  const troca: Record<string, string> = {
    primeiro_nome: primeiro,
    nome,
    resposta: typeof vars.resposta === 'string' ? vars.resposta : '',
  }
  return modelo
    .replace(/\{(primeiro_nome|nome|resposta)\}/g, (_, k: string) => troca[k] ?? '')
    .replace(/[ \t]+,/g, ',')
    .replace(/,(\s*[!?.])/g, '$1')
    .replace(/[ \t]+([!?.])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Duração de uma espera, em milissegundos. */
export const duracaoMs = (quantidade: number, u: UnidadeTempo) => Math.max(1, quantidade) * MS_UNIDADE[u]
