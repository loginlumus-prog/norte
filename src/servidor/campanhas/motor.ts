// O motor: anda com uma pessoa pelo roteiro, bloco por bloco.
//
// Sem banco e sem relógio próprio. Tudo que toca o mundo — mandar mensagem,
// gravar o diário, salvar onde a pessoa parou, esperar dois segundos — chega
// pronto em `Deps`. É isso que deixa os testes andarem um roteiro inteiro
// (e provar o freio de passos, as esperas, as saídas da condição) sem banco e
// sem WhatsApp. Quem liga o motor ao banco é execucao.ts.
//
// ── ninguém dorme dentro de uma requisição ───────────────────
// Uma espera de uma hora não pode ser um `sleep` de uma hora: a requisição
// morre, a máquina reinicia, e a pessoa nunca recebe o resto. Toda espera vira
// DESPERTADOR — o status fica 'esperando' com `proximoEm`, e o relógio
// (`tickCampanhas`, uma vez por minuto) acorda quem venceu. Dentro da
// requisição só cabem os segundos do "digitando" curto e o ritmo mínimo
// entre duas mensagens.
//
// ── o freio de passos ────────────────────────────────────────
// Uma rodada anda no máximo MAX_PASSOS blocos. Roteiro de verdade para numa
// espera muito antes disso; passar do teto é laço (condição que volta para a
// mensagem que volta para a condição), e laço mandando mensagem é o jeito
// mais rápido de ter o número banido. Passou, a execução para com erro.

import {
  DIGITANDO_EM_LINHA_SEG,
  MAX_PASSOS,
  MAX_SALTOS,
  ehViva,
  type DadosMidia,
  type DadosPassar,
  type Grafo,
  type ModeloDoBloco,
  type MotivoFim,
  type No,
  type Status,
  type Vars,
} from './tipos'
import {
  acharNo,
  duracaoMs,
  escolherRamo,
  escolherVariacao,
  interpolar,
  proximo,
  rotearCondicao,
  variaveisDoModelo,
} from './grafo'
import { proximaAbertura, type Horario } from './horario'

export type EstadoExecucao = {
  id: string
  campanhaId: string
  nodeId: string
  status: Status
  proximoEm: Date | null
  vars: Vars
  teste: boolean
  /** A chave do telefone: é ela que escolhe a variação e o caminho do A/B. */
  semente: string
  motivoFim: MotivoFim | null
}

export type Evento =
  | { tipo: 'iniciar' }
  | { tipo: 'resposta'; texto: string }
  | { tipo: 'acordar' }

/**
 * O que aconteceu com uma mensagem que o motor tentou mandar.
 * 'janela' = WhatsApp oficial, 24 horas sem a pessoa escrever, e sem modelo
 * aprovado para mandar no lugar: a execução termina ('janela_fechada').
 */
export type Envio = 'ok' | 'limite' | 'falha' | 'janela'

export type Deps = {
  agora: () => Date
  dormir: (ms: number) => Promise<void>
  /**
   * `modelo`: o modelo aprovado do bloco, com as variáveis JÁ preenchidas
   * para esta pessoa. Só é usado se a janela de 24 horas fechou (WhatsApp
   * oficial); nos outros canais ele é ignorado.
   */
  enviarTexto: (texto: string, modelo?: ModeloDoBloco | null) => Promise<Envio>
  enviarMidia: (d: DadosMidia, legenda: string) => Promise<Envio>
  /** Avisa a equipe. Devolve quantas mensagens saíram para ela. */
  passarParaPessoa: (d: DadosPassar, vars: Vars) => Promise<number>
  /** O horário da loja entendido, ou nulo (a espera ignora o horário). */
  horario: Horario | null
  /** Uma linha no diário. */
  registrar: (p: { nodeId: string; tipo: string; saida?: string | null; enviadas?: number; internas?: number }) => Promise<void>
  /**
   * Grava onde a pessoa está. Chamado depois de CADA bloco, para que um
   * processo que morra no meio não repita o que já saiu. Falso = a trava foi
   * perdida (alguém tirou a pessoa da campanha enquanto ela andava): o motor
   * para na hora, sem mandar mais nada.
   */
  salvar: (e: EstadoExecucao) => Promise<boolean>
}

export type Resultado = {
  estado: EstadoExecucao
  /** Terminou num "Ir para outra campanha": quem chamou abre a próxima. */
  conectarPara?: string
  /** Quantos blocos esta rodada andou. */
  passos: number
  /** O evento mexeu em alguma coisa? (resposta durante espera "segue esperando" não mexe) */
  andou: boolean
}

/** Falhas seguidas de envio antes de desistir. Cada nova tentativa, dois minutos depois. */
const TENTATIVAS = 3
const REPETIR_EM_MS = 2 * 60_000

type Passo =
  | { tipo: 'seguir'; saida: string }
  | { tipo: 'parar' }
  | { tipo: 'fim'; status: 'concluida' | 'erro'; motivo: MotivoFim; conectarPara?: string }

export async function rodar(g: Grafo, inicial: EstadoExecucao, evento: Evento, deps: Deps): Promise<Resultado> {
  const e: EstadoExecucao = { ...inicial, vars: { ...inicial.vars } }
  let passos = 0
  if (!ehViva(e.status)) return { estado: e, passos, andou: false }

  const encerrar = async (status: 'concluida' | 'erro', motivo: MotivoFim) => {
    e.status = status
    e.motivoFim = motivo
    e.proximoEm = null
    await deps.salvar(e)
  }

  // ── 1. o evento decide de onde se sai ─────────────────────
  let saida: string | null = null
  const atual = acharNo(g, e.nodeId)
  if (!atual) {
    await encerrar('erro', 'bloco_sumiu')
    return { estado: e, passos, andou: true }
  }

  if (evento.tipo === 'resposta') {
    e.vars.ultima = evento.texto.slice(0, 1000)
    if (e.status === 'aguardando_resposta' && atual.tipo === 'aguardar_resposta') {
      e.vars.resposta = evento.texto.slice(0, 1000)
      saida = 'respondeu'
    } else if (e.status === 'esperando' && atual.tipo === 'intervalo' && atual.dados.aoResponder === 'continuar') {
      saida = 'saida'
    } else {
      // Escreveu no meio de uma espera que segue esperando, ou enquanto o
      // roteiro ainda anda: fica anotado, e nada muda.
      return { estado: e, passos, andou: false }
    }
  } else if (evento.tipo === 'acordar') {
    const agora = deps.agora()
    const venceu = !!e.proximoEm && e.proximoEm.getTime() <= agora.getTime()
    if (e.status === 'aguardando_resposta') {
      if (!venceu) return { estado: e, passos, andou: false }
      saida = 'sem_resposta'
    } else if (e.status === 'esperando') {
      if (!venceu) return { estado: e, passos, andou: false }
      // Intervalo vencido sai pela saída; mensagem (digitando longo, nova
      // tentativa) roda de novo o próprio bloco.
      if (atual.tipo === 'intervalo') saida = 'saida'
    }
    // 'rodando' com trava vencida: processo que morreu no meio. Retoma do
    // bloco salvo — que é o bloco que ainda NÃO tinha terminado.
  }

  let noId: string | null = e.nodeId
  if (saida) {
    await deps.registrar({ nodeId: atual.id, tipo: atual.tipo, saida })
    noId = proximo(g, atual.id, saida)
  }
  e.status = 'rodando'
  e.proximoEm = null

  // ── 2. anda até parar ─────────────────────────────────────
  while (true) {
    if (!noId) {
      await encerrar('concluida', 'fim')
      return { estado: e, passos, andou: true }
    }
    if (passos >= MAX_PASSOS) {
      await encerrar('erro', 'passos')
      return { estado: e, passos, andou: true }
    }
    const no = acharNo(g, noId)
    if (!no) {
      await encerrar('erro', 'bloco_sumiu')
      return { estado: e, passos, andou: true }
    }
    e.nodeId = no.id
    passos++

    const r = await executar(no, e, deps)
    if (r.tipo === 'fim') {
      await encerrar(r.status, r.motivo)
      return { estado: e, passos, andou: true, ...(r.conectarPara ? { conectarPara: r.conectarPara } : {}) }
    }
    if (r.tipo === 'parar') {
      if (!(await deps.salvar(e))) return { estado: e, passos, andou: true }
      return { estado: e, passos, andou: true }
    }
    noId = proximo(g, no.id, r.saida)
    if (!(await deps.salvar({ ...e, nodeId: noId ?? e.nodeId }))) return { estado: e, passos, andou: true }
  }
}

/** Manda (ou reagenda, se o canal falhou). */
async function mandar(
  no: No,
  e: EstadoExecucao,
  deps: Deps,
  enviar: () => Promise<Envio>,
): Promise<Passo | null> {
  const r = await enviar()
  if (r === 'ok') {
    delete e.vars._falhas
    return null
  }
  if (r === 'limite') return { tipo: 'fim', status: 'erro', motivo: 'limite' }
  if (r === 'janela') {
    // Tentar de novo não adianta: a janela só reabre quando a PESSOA escrever,
    // e aí é outra conversa. Fica no diário, e a execução termina.
    await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: 'janela_fechada' })
    return { tipo: 'fim', status: 'erro', motivo: 'janela_fechada' }
  }
  const falhas = Number(e.vars._falhas ?? 0) + 1
  if (falhas >= TENTATIVAS) {
    delete e.vars._falhas
    return { tipo: 'fim', status: 'erro', motivo: 'falha_envio' }
  }
  // O fornecedor caiu por um instante: tenta de novo daqui a pouco, no mesmo
  // bloco e sem repetir o "digitando".
  e.vars._falhas = falhas
  e.vars._digitado = no.id
  e.status = 'esperando'
  e.proximoEm = new Date(deps.agora().getTime() + REPETIR_EM_MS)
  await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: 'falhou' })
  return { tipo: 'parar' }
}

async function executar(no: No, e: EstadoExecucao, deps: Deps): Promise<Passo> {
  switch (no.tipo) {
    case 'inicio':
      return { tipo: 'seguir', saida: 'saida' }

    case 'mensagem': {
      const texto = interpolar(escolherVariacao(no.dados.textos, e.semente, no.id), e.vars)
      const seg = no.dados.digitandoSeg
      if (seg > 0 && e.vars._digitado !== no.id) {
        if (seg > DIGITANDO_EM_LINHA_SEG) {
          e.vars._digitado = no.id
          e.status = 'esperando'
          e.proximoEm = new Date(deps.agora().getTime() + seg * 1000)
          return { tipo: 'parar' }
        }
        await deps.dormir(seg * 1000)
      }
      delete e.vars._digitado
      const modelo = no.dados.modelo
        ? { nome: no.dados.modelo.nome, idioma: no.dados.modelo.idioma, variaveis: variaveisDoModelo(no.dados.modelo, e.vars) }
        : null
      if (texto) {
        const falhou = await mandar(no, e, deps, () => deps.enviarTexto(texto, modelo))
        if (falhou) return falhou
      }
      await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: 'saida', enviadas: texto ? 1 : 0 })
      return { tipo: 'seguir', saida: 'saida' }
    }

    case 'midia': {
      delete e.vars._digitado
      const legenda = interpolar(no.dados.legenda, e.vars)
      const falhou = await mandar(no, e, deps, () => deps.enviarMidia(no.dados, legenda))
      if (falhou) return falhou
      await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: 'saida', enviadas: 1 })
      return { tipo: 'seguir', saida: 'saida' }
    }

    case 'intervalo': {
      let quando = new Date(deps.agora().getTime() + duracaoMs(no.dados.quantidade, no.dados.unidade))
      if (no.dados.soHorarioLoja && deps.horario) quando = proximaAbertura(quando, deps.horario)
      e.status = 'esperando'
      e.proximoEm = quando
      await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: null })
      return { tipo: 'parar' }
    }

    case 'aguardar_resposta': {
      e.status = 'aguardando_resposta'
      e.proximoEm = new Date(deps.agora().getTime() + duracaoMs(no.dados.quantidade, no.dados.unidade))
      await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: null })
      return { tipo: 'parar' }
    }

    case 'condicao': {
      const resposta = typeof e.vars.resposta === 'string' ? e.vars.resposta : typeof e.vars.ultima === 'string' ? e.vars.ultima : ''
      const saida = rotearCondicao(no.dados.regras, resposta)
      await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida })
      return { tipo: 'seguir', saida }
    }

    case 'distribuidor': {
      const saida = escolherRamo(no.dados.ramos, e.semente, no.id) ?? no.dados.ramos[0]?.id ?? 'saida'
      await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida })
      return { tipo: 'seguir', saida }
    }

    case 'passar_para_pessoa': {
      const aviso = interpolar(no.dados.mensagemContato, e.vars)
      let enviadas = 0
      if (aviso) {
        const falhou = await mandar(no, e, deps, () => deps.enviarTexto(aviso))
        if (falhou) return falhou
        enviadas = 1
      }
      const internas = await deps.passarParaPessoa(no.dados, e.vars)
      await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: 'humano', enviadas, internas })
      return { tipo: 'fim', status: 'concluida', motivo: 'humano' }
    }

    case 'conectar': {
      const saltos = Number(e.vars._saltos ?? 0) + 1
      if (!no.dados.campanhaId || no.dados.campanhaId === e.campanhaId || saltos > MAX_SALTOS) {
        await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: 'recusado' })
        return { tipo: 'fim', status: 'erro', motivo: 'passos' }
      }
      e.vars._saltos = saltos
      await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: no.dados.campanhaId })
      return { tipo: 'fim', status: 'concluida', motivo: 'conectou', conectarPara: no.dados.campanhaId }
    }

    case 'fim': {
      const texto = interpolar(no.dados.texto, e.vars)
      if (texto) {
        const falhou = await mandar(no, e, deps, () => deps.enviarTexto(texto))
        if (falhou) return falhou
      }
      await deps.registrar({ nodeId: no.id, tipo: no.tipo, saida: 'fim', enviadas: texto ? 1 : 0 })
      return { tipo: 'fim', status: 'concluida', motivo: 'fim' }
    }
  }
}
