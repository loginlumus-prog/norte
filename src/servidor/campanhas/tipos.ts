// O vocabulário das campanhas: o gatilho, os blocos, as ligações, os status.
//
// PURO: sem banco, sem I/O. É importado pelo editor (no navegador), pelo
// motor e pelos testes — e por isso não pode puxar nada do servidor.
//
// ── o desenho é um grafo, guardado inteiro em JSON ───────────
// `nodes` são os blocos; `edges` ligam a SAÍDA de um bloco à entrada de
// outro. Cada bloco declara as saídas que tem (ver `saidasDoNo` em grafo.ts):
// a mensagem tem uma ("saida"), a espera por resposta tem duas ("respondeu",
// "sem_resposta"), a condição tem uma por regra e mais "outro". Uma saída sem
// ligação é o fim do roteiro por ali.

// ─────────────────────────────────────────────────────────────
// O GATILHO
// ─────────────────────────────────────────────────────────────

export type Reentrada = 'nunca' | 'depois' | 'sempre'

/**
 * O padrão de TODA campanha nova: quem já passou por ela não entra de novo.
 *
 * Uma constante só, porque o padrão errado aqui é caro: "sempre" faria a
 * pessoa que escreve "quero o catálogo" pela terceira vez receber o roteiro
 * inteiro pela terceira vez — e é assim que um número de WhatsApp é
 * denunciado e banido.
 */
export const REENTRADA_PADRAO: Reentrada = 'nunca'

export type Gatilho = {
  /** 'frase': entra quem escreve a frase (ou clica no anúncio). 'manual': só por "Conectar" ou teste. */
  tipo: 'frase' | 'manual'
  frases: string[]
  /** O id do anúncio de clique para WhatsApp (Meta), quando o fornecedor informa. */
  anuncioIds: string[]
  reentrada: Reentrada
  /** Só com reentrada 'depois': quantos dias desde a última entrada. */
  reentradaDias?: number
}

export const GATILHO_NOVO: Gatilho = {
  tipo: 'frase',
  frases: [],
  anuncioIds: [],
  reentrada: REENTRADA_PADRAO,
}

// ─────────────────────────────────────────────────────────────
// OS BLOCOS
// ─────────────────────────────────────────────────────────────

export type TipoNo =
  | 'inicio'
  | 'mensagem'
  | 'midia'
  | 'intervalo'
  | 'aguardar_resposta'
  | 'condicao'
  | 'distribuidor'
  | 'passar_para_pessoa'
  | 'conectar'
  | 'fim'

export type UnidadeTempo = 'min' | 'h' | 'd'

export type DadosInicio = Record<string, never>
export type DadosMensagem = {
  /** O primeiro é o texto; os outros, variações. Cada contato recebe SEMPRE a mesma. */
  textos: string[]
  /** "digitando..." antes de mandar, de 0 a 15 segundos. */
  digitandoSeg: number
  /**
   * Só vale no WhatsApp OFICIAL (Meta): o modelo aprovado que sai no lugar do
   * texto quando a janela de 24 horas com a pessoa já fechou. Sem ele, fora
   * da janela a execução termina ('janela_fechada') — a Meta recusa texto
   * livre para quem não escreveu nas últimas 24 horas.
   */
  modelo?: ModeloDoBloco | null
}

/**
 * Um modelo aprovado na conta da Meta, e o que vai em cada variável dele.
 * `variaveis[0]` é o {{1}} do corpo, e assim por diante; cada uma aceita os
 * coringas do texto ({primeiro_nome}, {nome}, {resposta}).
 */
export type ModeloDoBloco = {
  nome: string
  /** "pt_BR" — o idioma com que o modelo foi aprovado. */
  idioma: string
  variaveis: string[]
}
export type TipoMidia = 'imagem' | 'video' | 'audio'
export type DadosMidia = {
  midiaId: string | null
  /** Copiado da mídia escolhida: o motor não precisa abrir a mídia para saber o que é. */
  tipo: TipoMidia | null
  nome?: string
  legenda: string
  /** Áudio como se tivesse sido gravado agora (nota de voz), e não arquivo anexado. */
  comoGravado: boolean
}
export type DadosIntervalo = {
  quantidade: number
  unidade: UnidadeTempo
  /** Só acorda com a loja aberta (horário da loja, quando dá para entender). */
  soHorarioLoja: boolean
  /** A pessoa escreveu durante a espera: segue esperando, ou continua já. */
  aoResponder: 'esperar' | 'continuar'
}
export type DadosAguardar = {
  /** Prazo para responder. Passou, sai por "sem_resposta". */
  quantidade: number
  unidade: UnidadeTempo
}
export type Regra = { id: string; rotulo: string; palavras: string[] }
export type DadosCondicao = { regras: Regra[] }
export type Ramo = { id: string; rotulo: string; peso: number }
export type DadosDistribuidor = { ramos: Ramo[] }
export type DadosPassar = {
  /** 'donos' = os donos com telefone. Ou a lista de pessoas da equipe. */
  para: 'donos' | 'pessoas'
  usuarioIds: string[]
  /** O que o CONTATO recebe antes (opcional): "Já chamei alguém da loja". */
  mensagemContato: string
}
export type DadosConectar = { campanhaId: string | null }
export type DadosFim = { texto: string }

export type DadosPorTipo = {
  inicio: DadosInicio
  mensagem: DadosMensagem
  midia: DadosMidia
  intervalo: DadosIntervalo
  aguardar_resposta: DadosAguardar
  condicao: DadosCondicao
  distribuidor: DadosDistribuidor
  passar_para_pessoa: DadosPassar
  conectar: DadosConectar
  fim: DadosFim
}

export type No<T extends TipoNo = TipoNo> = {
  [K in T]: { id: string; tipo: K; x: number; y: number; dados: DadosPorTipo[K] }
}[T]

export type Aresta = {
  id: string
  /** O bloco de onde sai. */
  de: string
  /** Qual saída dele: "saida", "respondeu", o id da regra... */
  saida: string
  /** O bloco para onde vai. */
  para: string
}

export type Grafo = { nodes: No[]; edges: Aresta[] }

// ─────────────────────────────────────────────────────────────
// A EXECUÇÃO
// ─────────────────────────────────────────────────────────────

export const STATUS_VIVOS = ['rodando', 'esperando', 'aguardando_resposta'] as const
export const STATUS_FINAIS = ['concluida', 'cancelada', 'erro'] as const
export type StatusVivo = (typeof STATUS_VIVOS)[number]
export type StatusFinal = (typeof STATUS_FINAIS)[number]
export type Status = StatusVivo | StatusFinal

export const ehViva = (s: string): s is StatusVivo => (STATUS_VIVOS as readonly string[]).includes(s)

export type MotivoFim =
  | 'fim' // chegou ao fim do roteiro
  | 'humano' // passou para uma pessoa da loja
  | 'humano_assumiu' // alguém da loja começou a conversar com a pessoa
  | 'conectou' // pulou para outra campanha
  | 'outro_fluxo' // a pessoa escreveu a frase de outra campanha
  | 'parou' // a pessoa pediu para parar
  | 'sem_ofertas' // o número entrou na lista de quem não recebe oferta (ficha "não aceita", a loja anotou, anonimização)
  | 'removido' // alguém da loja tirou da campanha
  | 'pausada' // a campanha foi pausada com a pessoa dentro
  | 'teste' // um teste novo no mesmo número
  | 'bloco_sumiu' // o bloco em que ela estava foi apagado do desenho
  | 'passos' // passou do teto de passos sem esperar nada (laço)
  | 'limite' // teto de mensagens do dia
  | 'falha_envio' // o canal recusou
  | 'janela_fechada' // WhatsApp oficial: passou das 24 h sem a pessoa escrever, e o bloco não tinha modelo aprovado

/** O que o roteiro guarda de cada pessoa. `_` na frente = uso interno do motor. */
export type Vars = {
  nome?: string | null
  resposta?: string
  /** A última mensagem que ela mandou, qualquer que seja. */
  ultima?: string
  /** A mensagem cujo "digitando" já foi esperado: ao acordar, sai sem esperar de novo. */
  _digitado?: string
  /** Quantas vezes já pulou de campanha nesta cadeia (freio de laço). */
  _saltos?: number
  [k: string]: unknown
}

// ─────────────────────────────────────────────────────────────
// OS NÚMEROS DO MOTOR
// ─────────────────────────────────────────────────────────────

/** Passos por rodada. Quarenta blocos sem uma espera no meio é laço, não roteiro. */
export const MAX_PASSOS = 40
/** "digitando" até isto roda na hora; acima disto vira despertador. */
export const DIGITANDO_EM_LINHA_SEG = 4
/** Teto do "digitando" que o editor aceita. */
export const DIGITANDO_MAX_SEG = 15
/** Quantos pulos de "Conectar" seguidos, no máximo. */
export const MAX_SALTOS = 3
/** Frase de gatilho mais curta que isto é ignorada: "oi" casaria com metade das mensagens. */
export const FRASE_MIN = 3
/** A trava de uma execução vence sozinha depois disto (processo que morreu no meio). */
export const TRAVA_VENCE_SEG = 120
/** A janela do WhatsApp: sem a pessoa ter escrito nisto, ninguém escreve para ela. */
export const JANELA_HORAS = 24

export const AJUSTES_PADRAO = {
  porContatoDia: 15,
  porEmpresaDia: 1000,
  intervaloSeg: 2,
} as const
export type Ajustes = { porContatoDia: number; porEmpresaDia: number; intervaloSeg: number }

// ─────────────────────────────────────────────────────────────
// OS NOMES NA TELA
// ─────────────────────────────────────────────────────────────

export const ROTULO_NO: Record<TipoNo, string> = {
  inicio: 'Início',
  mensagem: 'Mensagem',
  midia: 'Foto, vídeo ou áudio',
  intervalo: 'Esperar um tempo',
  aguardar_resposta: 'Esperar resposta',
  condicao: 'Se a resposta tiver…',
  distribuidor: 'Dividir (A/B)',
  passar_para_pessoa: 'Passar para uma pessoa',
  conectar: 'Ir para outra campanha',
  fim: 'Fim',
}

export const ROTULO_SAIDA: Record<string, string> = {
  saida: 'depois',
  respondeu: 'respondeu',
  sem_resposta: 'não respondeu',
  outro: 'qualquer outra coisa',
}

export const ROTULO_STATUS: Record<Status, string> = {
  rodando: 'andando',
  esperando: 'esperando o tempo',
  aguardando_resposta: 'esperando resposta',
  concluida: 'concluiu',
  cancelada: 'saiu',
  erro: 'parou com erro',
}

export const ROTULO_MOTIVO: Record<MotivoFim, string> = {
  fim: 'chegou ao fim',
  humano: 'passou para uma pessoa',
  humano_assumiu: 'alguém da loja assumiu a conversa',
  conectou: 'foi para outra campanha',
  outro_fluxo: 'entrou em outra campanha',
  parou: 'pediu para parar',
  sem_ofertas: 'não recebe mais ofertas',
  removido: 'tirado pela loja',
  pausada: 'campanha pausada',
  teste: 'teste substituído',
  bloco_sumiu: 'o bloco foi apagado',
  passos: 'roteiro em laço',
  limite: 'teto de mensagens do dia',
  falha_envio: 'o WhatsApp recusou',
  janela_fechada: 'passou da janela de 24 horas',
}

export const MS_UNIDADE: Record<UnidadeTempo, number> = {
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}
