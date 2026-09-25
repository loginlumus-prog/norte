'use client'

// O editor de campanha: o desenho no meio, a paleta de blocos em cima, e ao
// lado o formulário do bloco escolhido, as pendências e quem está dentro.
//
// ── simples antes de tudo ────────────────────────────────────
// O dono pediu simplicidade, então o caminho mais curto não exige arrastar
// nada: clicar num bloco da paleta cria o bloco LOGO ABAIXO do escolhido e já
// liga os dois. Arrastar para reposicionar e puxar uma ligação de uma saída
// para outro bloco continuam valendo, para quem quiser desenhar desvios.
//
// ── uma fonte da verdade ─────────────────────────────────────
// Os blocos vivem no estado do React Flow (posição, medida, seleção), com o
// tipo e os dados do bloco dentro de `data`. O grafo que vai para o servidor
// é montado desses nós na hora de salvar — e o servidor limpa e confere tudo
// de novo antes de gravar.

import '@xyflow/react/dist/base.css'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Handle,
  Position,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, cx } from '@/ui/base'
import {
  ROTULO_NO,
  ROTULO_STATUS,
  type DadosPorTipo,
  type Gatilho,
  type Grafo,
  type No,
  type Status,
  type TipoNo,
} from '@/servidor/campanhas/tipos'
import { dadosPadrao, pendencias, saidasDoNo, temErro, type Pendencia } from '@/servidor/campanhas/grafo'
import type { ParaEditor } from '@/servidor/campanhas/admin'
import { ativarAcao, removerAcao, salvarAcao, testarAcao, type Resposta } from '../acoes'
import { PainelDoBloco } from './Painel'

type DadosDoNo = { tipo: TipoNo; dados: DadosPorTipo[TipoNo] }
type NoFluxo = Node<DadosDoNo, 'bloco'>

export type DentroNaTela = {
  id: string
  nome: string | null
  telefone: string
  bloco: string
  status: Status
  desde: string
  proximoEm: string | null
  teste: boolean
}

// ─────────────────────────────────────────────────────────────
// CORES E RESUMOS DOS BLOCOS
// ─────────────────────────────────────────────────────────────

/** A faixa do bloco diz a família: fala, espera, decide, entrega. */
const FAMILIA: Record<TipoNo, string> = {
  inicio: 'bg-marca',
  mensagem: 'bg-marca',
  midia: 'bg-marca',
  fim: 'bg-tinta-3',
  intervalo: 'bg-atencao-vivo',
  aguardar_resposta: 'bg-atencao-vivo',
  condicao: 'bg-sol',
  distribuidor: 'bg-sol',
  passar_para_pessoa: 'bg-bom-vivo',
  conectar: 'bg-bom-vivo',
}

const PALETA: { tipo: TipoNo; dica: string }[] = [
  { tipo: 'mensagem', dica: 'Texto, com o nome da pessoa' },
  { tipo: 'midia', dica: 'Foto, vídeo ou áudio' },
  { tipo: 'intervalo', dica: 'Minutos, horas ou dias' },
  { tipo: 'aguardar_resposta', dica: 'E guarda o que ela disse' },
  { tipo: 'condicao', dica: 'Um caminho por palavra' },
  { tipo: 'distribuidor', dica: 'Metade vê A, metade B' },
  { tipo: 'passar_para_pessoa', dica: 'Avisa a equipe e para' },
  { tipo: 'conectar', dica: 'Segue em outra campanha' },
  { tipo: 'fim', dica: 'Última mensagem (opcional)' },
]

const unid = { min: 'min', h: 'h', d: 'dia(s)' } as const
const corta = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function resumo(no: DadosDoNo, ctx: Ctx): string {
  const d = no.dados as never as Record<string, unknown>
  switch (no.tipo) {
    case 'inicio': {
      const g = ctx.gatilho
      if (g.tipo === 'manual') return 'Só por outra campanha ou teste'
      const partes = [...g.frases.map((f) => `"${f}"`), ...(g.anuncioIds.length ? [`${g.anuncioIds.length} anúncio(s)`] : [])]
      return partes.length ? `Entra quem escrever ${corta(partes.join(', '), 70)}` : 'Falta a frase de entrada'
    }
    case 'mensagem': {
      const m = no.dados as DadosPorTipo['mensagem']
      const extra = m.textos.filter((t) => t.trim()).length - 1
      return `${corta(m.textos[0]?.trim() || '(vazia)')}${extra > 0 ? ` · +${extra} variação(ões)` : ''}`
    }
    case 'midia': {
      const m = no.dados as DadosPorTipo['midia']
      return m.midiaId ? `${m.tipo ?? 'arquivo'}: ${corta(m.nome ?? 'arquivo', 40)}${m.legenda ? ` · ${corta(m.legenda, 40)}` : ''}` : 'Sem arquivo'
    }
    case 'intervalo': {
      const m = no.dados as DadosPorTipo['intervalo']
      return `Espera ${m.quantidade} ${unid[m.unidade]}${m.soHorarioLoja ? ', com a loja aberta' : ''}${m.aoResponder === 'continuar' ? '; se responder, segue já' : ''}`
    }
    case 'aguardar_resposta': {
      const m = no.dados as DadosPorTipo['aguardar_resposta']
      return `Espera até ${m.quantidade} ${unid[m.unidade]}`
    }
    case 'condicao':
      return (no.dados as DadosPorTipo['condicao']).regras.map((r) => r.rotulo || r.palavras.join(', ')).join(' · ') || 'Sem regra'
    case 'distribuidor':
      return (no.dados as DadosPorTipo['distribuidor']).ramos.map((r) => `${r.rotulo || r.id} ${r.peso}`).join(' · ')
    case 'passar_para_pessoa': {
      const m = no.dados as DadosPorTipo['passar_para_pessoa']
      return m.para === 'donos' ? 'Avisa os donos e encerra' : `Avisa ${m.usuarioIds.length} pessoa(s) e encerra`
    }
    case 'conectar': {
      const alvo = ctx.outras.find((o) => o.id === (no.dados as DadosPorTipo['conectar']).campanhaId)
      return alvo ? `Vai para "${alvo.nome}"` : 'Escolha a campanha'
    }
    case 'fim':
      return (d.texto as string)?.trim() ? corta(d.texto as string) : 'Termina sem mensagem'
  }
}

// ─────────────────────────────────────────────────────────────
// O BLOCO NO DESENHO
// ─────────────────────────────────────────────────────────────

type Ctx = {
  gatilho: Gatilho
  outras: { id: string; nome: string }[]
  problemas: Map<string, 'erro' | 'aviso'>
}
const EditorCtx = createContext<Ctx>({ gatilho: { tipo: 'frase', frases: [], anuncioIds: [], reentrada: 'nunca' }, outras: [], problemas: new Map() })

function Bloco({ id, data, selected }: NodeProps<NoFluxo>) {
  const ctx = useContext(EditorCtx)
  const saidas = saidasDoNo({ id, tipo: data.tipo, x: 0, y: 0, dados: data.dados } as No)
  const problema = ctx.problemas.get(id)
  return (
    <div
      className={cx(
        'w-60 rounded-norte border bg-superficie text-left shadow-norte',
        selected ? 'border-marca ring-2 ring-marca/30' : problema === 'erro' ? 'border-critico-vivo' : 'border-borda',
      )}
    >
      {data.tipo !== 'inicio' && <Handle type="target" position={Position.Top} className="!size-3 !border-2 !border-superficie !bg-tinta-3" />}
      <div className={cx('h-1.5 rounded-t-norte', FAMILIA[data.tipo])} />
      <div className="flex flex-col gap-1 px-3 pt-2 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-wide text-tinta uppercase">{ROTULO_NO[data.tipo]}</span>
          {problema && (
            <span className={cx('text-[10px] font-semibold', problema === 'erro' ? 'text-critico' : 'text-atencao')}>
              {problema === 'erro' ? 'pendência' : 'aviso'}
            </span>
          )}
        </div>
        <p className="text-xs leading-snug break-words text-tinta-2">{resumo(data, ctx)}</p>
      </div>
      {saidas.length > 0 && (
        <div className="flex justify-around gap-1 border-t border-borda-suave px-1 pt-1 pb-2">
          {saidas.map((s) => (
            <span key={s.id} className="max-w-24 truncate text-[10px] text-tinta-3" title={s.rotulo}>
              {s.rotulo}
            </span>
          ))}
        </div>
      )}
      {saidas.map((s, i) => (
        <Handle
          key={s.id}
          type="source"
          id={s.id}
          position={Position.Bottom}
          style={{ left: `${((i + 1) / (saidas.length + 1)) * 100}%` }}
          className="!size-3 !border-2 !border-superficie !bg-marca"
          title={s.rotulo}
        />
      ))}
    </div>
  )
}

const TIPOS_DE_NO = { bloco: Bloco }

// ─────────────────────────────────────────────────────────────
// CONVERSÕES
// ─────────────────────────────────────────────────────────────

const paraNos = (g: Grafo): NoFluxo[] =>
  g.nodes.map((n) => ({
    id: n.id,
    type: 'bloco',
    position: { x: n.x, y: n.y },
    data: { tipo: n.tipo, dados: n.dados },
    deletable: n.tipo !== 'inicio',
  }))

// Sem rótulo na ligação: o nome de cada saída já está embaixo da bolinha,
// no próprio bloco — escrito duas vezes, o desenho vira sopa de letras.
const paraArestas = (g: Grafo): Edge[] => g.edges.map((e) => ({ id: e.id, source: e.de, sourceHandle: e.saida, target: e.para }))

const saidasDe = (n: NoFluxo) => saidasDoNo({ id: n.id, tipo: n.data.tipo, x: 0, y: 0, dados: n.data.dados } as No)

/** Os blocos que vêm depois deste (para empurrar para baixo quando algo entra no meio). */
function depoisDe(inicio: string, arestas: Edge[]): Set<string> {
  const vistos = new Set<string>()
  const fila = [inicio]
  while (fila.length) {
    const x = fila.shift()!
    if (vistos.has(x)) continue
    vistos.add(x)
    for (const e of arestas) if (e.source === x) fila.push(e.target)
  }
  return vistos
}

function paraGrafo(nos: NoFluxo[], arestas: Edge[]): Grafo {
  return {
    nodes: nos.map((n) => ({ id: n.id, tipo: n.data.tipo, x: Math.round(n.position.x), y: Math.round(n.position.y), dados: n.data.dados }) as No),
    edges: arestas.map((e) => ({ id: e.id, de: e.source, saida: e.sourceHandle ?? 'saida', para: e.target })),
  }
}

const novoId = (prefixo: string) => `${prefixo}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

/** Tira as ligações que saem de uma saída que não existe mais (regra apagada, ramo apagado). */
function soArestasValidas(nos: NoFluxo[], arestas: Edge[]): Edge[] {
  const ids = new Set(nos.map((n) => n.id))
  return arestas.filter((e) => {
    const n = nos.find((x) => x.id === e.source)
    if (!n || !ids.has(e.target)) return false
    return saidasDoNo({ id: n.id, tipo: n.data.tipo, x: 0, y: 0, dados: n.data.dados } as No).some((s) => s.id === (e.sourceHandle ?? 'saida'))
  })
}

// ─────────────────────────────────────────────────────────────
// O EDITOR
// ─────────────────────────────────────────────────────────────

export function Editor(props: { slug: string; inicial: ParaEditor; dentro: DentroNaTela[] }) {
  return (
    <ReactFlowProvider>
      <EditorPorDentro {...props} />
    </ReactFlowProvider>
  )
}

function EditorPorDentro({ slug, inicial, dentro }: { slug: string; inicial: ParaEditor; dentro: DentroNaTela[] }) {
  const c = inicial.campanha
  const router = useRouter()
  const fluxo = useReactFlow()
  const [nos, setNos, mudouNos] = useNodesState<NoFluxo>(paraNos(c.grafo))
  const [arestas, setArestas, mudouArestas] = useEdgesState<Edge>(paraArestas(c.grafo))
  const [nome, setNome] = useState(c.nome)
  const [pasta, setPasta] = useState(c.pasta ?? '')
  const [gatilho, setGatilho] = useState<Gatilho>(c.gatilho)
  const [ativa, setAtiva] = useState(c.ativa)
  const [escolhido, setEscolhido] = useState<string | null>(c.grafo.nodes.find((n) => n.tipo === 'inicio')?.id ?? null)
  const [aba, setAba] = useState<'bloco' | 'pendencias' | 'dentro'>('bloco')
  const [sujo, setSujo] = useState(false)
  const [recado, setRecado] = useState<Resposta>({})
  const [midias, setMidias] = useState(inicial.midias)
  const [indo, comecar] = useTransition()

  const grafo = useMemo(() => paraGrafo(nos, arestas), [nos, arestas])
  const ps: Pendencia[] = useMemo(
    () =>
      pendencias(grafo, {
        campanhaId: c.id,
        campanhas: inicial.outras,
        frases: gatilho.frases,
        anuncioIds: gatilho.anuncioIds,
        tipoGatilho: gatilho.tipo,
        horarioEntendido: inicial.horario.entendido,
      }),
    [grafo, gatilho, c.id, inicial.outras, inicial.horario.entendido],
  )
  const bloqueada = temErro(ps)
  const problemas = useMemo(() => {
    const m = new Map<string, 'erro' | 'aviso'>()
    for (const p of ps) if (p.nodeId && m.get(p.nodeId) !== 'erro') m.set(p.nodeId, p.nivel)
    return m
  }, [ps])

  // Mudança não salva: o navegador pergunta antes de sair.
  useEffect(() => {
    if (!sujo) return
    const antes = (ev: BeforeUnloadEvent) => ev.preventDefault()
    window.addEventListener('beforeunload', antes)
    return () => window.removeEventListener('beforeunload', antes)
  }, [sujo])

  const marcar = () => {
    setSujo(true)
    setRecado({})
  }

  const noEscolhido = nos.find((n) => n.id === escolhido) ?? null
  // Por qual saída do escolhido o próximo bloco entra: a que a pessoa
  // escolheu no painel; senão a primeira livre; senão (todas ocupadas) no
  // meio da primeira. A dica diz qual, antes do clique.
  const [saidaEscolhida, setSaidaEscolhida] = useState<{ no: string; saida: string } | null>(null)
  const ocupada = (n: NoFluxo, saida: string) => arestas.find((e) => e.source === n.id && (e.sourceHandle ?? 'saida') === saida)
  const saidaPara = (n: NoFluxo) => {
    const saidas = saidasDe(n)
    const pref = saidaEscolhida?.no === n.id ? saidas.find((x) => x.id === saidaEscolhida.saida) : undefined
    return pref ?? saidas.find((x) => !ocupada(n, x.id)) ?? saidas[0]
  }
  const saidaDaVez = noEscolhido ? saidaPara(noEscolhido) : undefined

  const mudarDados = useCallback(
    (id: string, dados: DadosPorTipo[TipoNo]) => {
      const novos = nos.map((n) => (n.id === id ? { ...n, data: { ...n.data, dados } } : n))
      setNos(novos)
      setArestas((as) => soArestasValidas(novos, as))
      marcar()
    },
    [nos, setNos, setArestas],
  )

  const apagarBloco = (id: string) => {
    if (nos.find((n) => n.id === id)?.data.tipo === 'inicio') return
    setNos((ns) => ns.filter((n) => n.id !== id))
    setArestas((as) => as.filter((e) => e.source !== id && e.target !== id))
    setEscolhido(null)
    marcar()
  }

  /**
   * Cria o bloco logo DEPOIS do escolhido e liga os dois.
   *
   *   • a saída da vez (a escolhida no painel, ou a primeira livre) está
   *     livre → o novo entra nela, embaixo;
   *   • ela já leva a algum lugar → o novo entra NO MEIO: escolhido → novo →
   *     quem vinha depois, e o resto do caminho desce para abrir espaço. É o
   *     "pôr depois de" que a pessoa espera.
   */
  const adicionar = (tipo: TipoNo) => {
    const base = noEscolhido ?? [...nos].sort((a, b) => b.position.y - a.position.y)[0] ?? null
    const id = novoId(tipo.slice(0, 3))
    let dados = dadosPadrao(tipo)
    if (tipo === 'condicao') dados = { regras: [{ id: novoId('r'), rotulo: 'Sim', palavras: ['sim', 'quero'] }] }
    if (tipo === 'distribuidor') dados = { ramos: [{ id: novoId('a'), rotulo: 'A', peso: 50 }, { id: novoId('b'), rotulo: 'B', peso: 50 }] }
    const novo: NoFluxo = { id, type: 'bloco', position: { x: 0, y: 0 }, data: { tipo, dados }, deletable: true, selected: true }
    const PASSO = 170

    let ns = nos.map((n) => ({ ...n, selected: false }))
    let as = arestas
    if (base) {
      const saidas = saidasDe(base)
      const alvo = saidaPara(base)
      const velha = alvo ? ocupada(base, alvo.id) : undefined
      if (alvo && !velha) {
        novo.position = { x: base.position.x + saidas.findIndex((x) => x.id === alvo.id) * 270, y: base.position.y + PASSO }
        as = [...as, { id: novoId('e'), source: base.id, sourceHandle: alvo.id, target: id }]
      } else if (alvo && velha) {
        const descem = depoisDe(velha.target, arestas)
        ns = ns.map((n) => (descem.has(n.id) && n.position.y > base.position.y ? { ...n, position: { ...n.position, y: n.position.y + PASSO } } : n))
        novo.position = { x: base.position.x, y: base.position.y + PASSO }
        as = as.filter((e) => e.id !== velha.id)
        as.push({ id: novoId('e'), source: base.id, sourceHandle: velha.sourceHandle, target: id })
        const primeira = saidasDe(novo)[0]
        if (primeira) as.push({ id: novoId('e'), source: id, sourceHandle: primeira.id, target: velha.target })
      } else {
        // Bloco sem saída (fim, passar, ir para): o novo entra ANTES dele —
        // "pôr uma mensagem antes do fim" — e ele desce. Sem ninguém chegando
        // nele, o novo fica ao lado, solto.
        const chegando = arestas.find((e) => e.target === base.id)
        const primeira = saidasDe(novo)[0]
        if (chegando && primeira) {
          ns = ns.map((n) => (n.id === base.id ? { ...n, position: { ...n.position, y: n.position.y + PASSO } } : n))
          novo.position = { ...base.position }
          as = as.map((e) => (e.id === chegando.id ? { ...e, target: id } : e))
          as.push({ id: novoId('e'), source: id, sourceHandle: primeira.id, target: base.id })
        } else {
          novo.position = { x: base.position.x + 280, y: base.position.y }
        }
      }
    }
    setNos([...ns, novo])
    setArestas(as)
    setSaidaEscolhida(null)
    setEscolhido(id)
    setAba('bloco')
    marcar()
    const { x, y } = novo.position
    requestAnimationFrame(() => fluxo.setCenter(x + 120, y + 60, { zoom: fluxo.getZoom(), duration: 250 }))
  }

  const ligar = useCallback(
    (con: Connection) => {
      if (!con.source || !con.target || con.source === con.target) return
      const saida = con.sourceHandle ?? 'saida'
      setArestas((as) => [
        ...as.filter((e) => !(e.source === con.source && (e.sourceHandle ?? 'saida') === saida)),
        { id: novoId('e'), source: con.source, sourceHandle: saida, target: con.target },
      ])
      marcar()
    },
    [setArestas],
  )

  const salvar = async (): Promise<boolean> => {
    const r = await salvarAcao(slug, c.id, { nome, pasta: pasta || null, gatilho, grafo })
    setRecado(r)
    if (r.ok) {
      setSujo(false)
      return true
    }
    return false
  }

  const alternarAtiva = () =>
    comecar(async () => {
      if (sujo && !(await salvar())) return
      const r = await ativarAcao(slug, c.id, !ativa)
      setRecado(r)
      if (r.ok) setAtiva(!ativa)
      router.refresh()
    })

  const testar = () =>
    comecar(async () => {
      if (sujo && !(await salvar())) return
      setRecado(await testarAcao(slug, c.id))
      router.refresh()
    })

  const ctx: Ctx = useMemo(() => ({ gatilho, outras: inicial.outras, problemas }), [gatilho, inicial.outras, problemas])
  const erros = ps.filter((p) => p.nivel === 'erro').length

  const variaveisDoFluxo = {
    '--xy-edge-stroke': 'var(--tinta-3)',
    '--xy-edge-stroke-selected': 'var(--marca)',
    '--xy-edge-stroke-width': '1.75',
    '--xy-connectionline-stroke': 'var(--marca)',
    '--xy-background-pattern-color': 'var(--borda)',
    '--xy-background-color': 'var(--fundo)',
    '--xy-selection-background-color': 'color-mix(in srgb, var(--marca) 10%, transparent)',
    '--xy-selection-border': '1px dashed var(--marca)',
    '--xy-attribution-background-color': 'transparent',
  } as CSSProperties

  return (
    <EditorCtx.Provider value={ctx}>
      <div className="flex flex-col gap-3">
        {/* ── barra de cima ── */}
        <div className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-3 lg:flex-row lg:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-tinta">
            Nome
            <input
              value={nome}
              maxLength={80}
              onChange={(e) => {
                setNome(e.target.value)
                marcar()
              }}
              className="w-full rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-tinta lg:w-48">
            Pasta (opcional)
            <input
              value={pasta}
              maxLength={40}
              placeholder="Ex.: Verão"
              onChange={(e) => {
                setPasta(e.target.value)
                marcar()
              }}
              className="w-full rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                ativa ? 'bg-bom-fundo text-bom' : 'bg-superficie-2 text-tinta-2',
              )}
            >
              <span aria-hidden className={cx('size-1.5 rounded-full', ativa ? 'bg-bom-vivo' : 'bg-tinta-3')} />
              {ativa ? 'Ativa' : 'Pausada'}
            </span>
            <Botao tom="secundario" carregando={indo} disabled={!sujo} onClick={() => comecar(async () => void (await salvar()))}>
              {sujo ? 'Salvar' : 'Salvo'}
            </Botao>
            <Botao
              tom={ativa ? 'secundario' : 'confirmar'}
              disabled={indo || (!ativa && bloqueada)}
              title={!ativa && bloqueada ? 'Resolva as pendências antes de ativar' : undefined}
              onClick={alternarAtiva}
            >
              {ativa ? 'Pausar' : 'Ativar'}
            </Botao>
            <Botao
              tom="secundario"
              disabled={indo || bloqueada || !inicial.meuTelefone}
              title={!inicial.meuTelefone ? 'Ponha o seu telefone em Equipe para testar' : bloqueada ? 'Resolva as pendências antes de testar' : undefined}
              onClick={testar}
            >
              Testar com meu número
            </Botao>
          </div>
        </div>

        {(recado.erro || recado.ok) && (
          <Aviso nivel={recado.erro ? 'critico' : 'bom'}>
            {recado.erro ?? recado.ok}
            {recado.ok && inicial.meuTelefone && recado.ok.startsWith('Teste') ? ` (${inicial.meuTelefone})` : ''}
          </Aviso>
        )}

        {/* ── paleta ── */}
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-tinta-3">
            Clique num bloco para pôr{' '}
            {noEscolhido ? (
              <>
                {saidasDe(noEscolhido).length === 0 ? 'antes de' : 'depois de'} <b className="text-tinta-2">{ROTULO_NO[noEscolhido.data.tipo]}</b>
                {saidaDaVez && saidasDe(noEscolhido).length > 1 ? <> (saída “{saidaDaVez.rotulo}”)</> : null}
              </>
            ) : (
              'no fim'
            )}
            . Para
            desviar, puxe a bolinha de uma saída até outro bloco.
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {PALETA.map((p) => (
              <button
                key={p.tipo}
                type="button"
                onClick={() => adicionar(p.tipo)}
                className="flex shrink-0 items-center gap-2 rounded-norte border border-borda bg-superficie px-3 py-2 text-left hover:border-marca/50 hover:bg-superficie-2"
              >
                <span aria-hidden className={cx('h-7 w-1 rounded-full', FAMILIA[p.tipo])} />
                <span className="flex flex-col">
                  <span className="text-xs font-semibold text-tinta">{ROTULO_NO[p.tipo]}</span>
                  <span className="text-[11px] text-tinta-3">{p.dica}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* ── o desenho ── */}
          <div className="relative h-[62vh] min-h-[420px] overflow-hidden rounded-norte border border-borda" style={variaveisDoFluxo}>
            <ReactFlow<NoFluxo, Edge>
              nodes={nos}
              edges={arestas}
              nodeTypes={TIPOS_DE_NO}
              onNodesChange={(ch) => {
                mudouNos(ch)
                if (ch.some((x) => x.type === 'position' && x.dragging === false) || ch.some((x) => x.type === 'remove')) marcar()
              }}
              onEdgesChange={(ch) => {
                mudouArestas(ch)
                if (ch.some((x) => x.type === 'remove')) marcar()
              }}
              onNodesDelete={(apagados) => {
                const ids = new Set(apagados.map((n) => n.id))
                setArestas((as) => as.filter((e) => !ids.has(e.source) && !ids.has(e.target)))
                setEscolhido(null)
              }}
              onConnect={ligar}
              isValidConnection={(con) => con.source !== con.target && nos.find((n) => n.id === con.target)?.data.tipo !== 'inicio'}
              onSelectionChange={({ nodes }) => {
                if (nodes[0]) {
                  setEscolhido(nodes[0].id)
                  setAba('bloco')
                }
              }}
              deleteKeyCode={['Delete', 'Backspace']}
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
              minZoom={0.3}
              maxZoom={1.5}
              defaultEdgeOptions={{ type: 'smoothstep' }}
            >
              <Background gap={20} size={1.2} />
            </ReactFlow>
            <div className="absolute right-2 bottom-2 flex flex-col gap-1">
              {[
                ['+', 'Aproximar', () => fluxo.zoomIn()],
                ['−', 'Afastar', () => fluxo.zoomOut()],
                ['⤢', 'Ver tudo', () => fluxo.fitView({ padding: 0.3, maxZoom: 1 })],
              ].map(([t, rotulo, f]) => (
                <button
                  key={rotulo as string}
                  type="button"
                  aria-label={rotulo as string}
                  title={rotulo as string}
                  onClick={f as () => void}
                  className="grid size-8 place-items-center rounded-norte border border-borda bg-superficie text-sm font-bold text-tinta-2 shadow-norte hover:text-tinta"
                >
                  {t as string}
                </button>
              ))}
            </div>
          </div>

          {/* ── o lado ── */}
          <aside className="flex min-w-0 flex-col gap-3 rounded-norte border border-borda bg-superficie p-3">
            <div role="tablist" className="flex gap-1 border-b border-borda">
              {(
                [
                  ['bloco', 'Bloco'],
                  ['pendencias', `Pendências${erros ? ` (${erros})` : ''}`],
                  ['dentro', `Dentro agora (${dentro.length})`],
                ] as const
              ).map(([k, t]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={aba === k}
                  type="button"
                  onClick={() => setAba(k)}
                  className={cx(
                    '-mb-px border-b-2 px-2.5 py-2 text-xs font-semibold',
                    aba === k ? 'border-marca text-tinta' : 'border-transparent text-tinta-2 hover:text-tinta',
                    k === 'pendencias' && erros > 0 && 'text-critico',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            {aba === 'bloco' &&
              (noEscolhido ? (
                <>
                {saidasDe(noEscolhido).length > 0 && (
                  <Saidas
                    no={noEscolhido}
                    nos={nos}
                    arestas={arestas}
                    daVez={saidaDaVez?.id}
                    aoEscolher={(saida) => setSaidaEscolhida({ no: noEscolhido.id, saida })}
                    aoLigar={(saida, para) => {
                      setArestas((as) => [
                        ...as.filter((e) => !(e.source === noEscolhido.id && (e.sourceHandle ?? 'saida') === saida)),
                        ...(para ? [{ id: novoId('e'), source: noEscolhido.id, sourceHandle: saida, target: para }] : []),
                      ])
                      marcar()
                    }}
                  />
                )}
                <PainelDoBloco
                  key={noEscolhido.id}
                  slug={slug}
                  no={{ id: noEscolhido.id, tipo: noEscolhido.data.tipo, x: 0, y: 0, dados: noEscolhido.data.dados } as No}
                  gatilho={gatilho}
                  aoMudarGatilho={(g) => {
                    setGatilho(g)
                    marcar()
                  }}
                  aoMudar={(d) => mudarDados(noEscolhido.id, d)}
                  aoApagar={() => apagarBloco(noEscolhido.id)}
                  outras={inicial.outras}
                  equipe={inicial.equipe}
                  midias={midias}
                  aoSubirMidia={(m) => setMidias((ms) => [m, ...ms.filter((x) => x.id !== m.id)])}
                  horario={inicial.horario}
                  pendencias={ps.filter((p) => p.nodeId === noEscolhido.id)}
                />
                </>
              ) : (
                <p className="text-sm text-tinta-2">Escolha um bloco no desenho para mudar o que ele faz.</p>
              ))}

            {aba === 'pendencias' &&
              (ps.length === 0 ? (
                <p className="text-sm text-bom">Nada pendente. A campanha pode ser ativada.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {ps.map((p, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        disabled={!p.nodeId}
                        onClick={() => {
                          if (!p.nodeId) return
                          setEscolhido(p.nodeId)
                          setNos((ns) => ns.map((n) => ({ ...n, selected: n.id === p.nodeId })))
                          const n = nos.find((x) => x.id === p.nodeId)
                          if (n) fluxo.setCenter(n.position.x + 120, n.position.y + 60, { zoom: 1, duration: 250 })
                          setAba('bloco')
                        }}
                        className={cx(
                          'flex w-full items-start gap-2 rounded-norte px-2.5 py-2 text-left text-sm',
                          p.nivel === 'erro' ? 'bg-critico-fundo text-critico' : 'bg-atencao-fundo text-atencao',
                        )}
                      >
                        <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', p.nivel === 'erro' ? 'bg-critico-vivo' : 'bg-atencao-vivo')} />
                        {p.texto}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}

            {aba === 'dentro' && <Dentro slug={slug} campanhaId={c.id} linhas={dentro} />}
          </aside>
        </div>
      </div>
    </EditorCtx.Provider>
  )
}

// ─────────────────────────────────────────────────────────────
// AS SAÍDAS DO BLOCO ESCOLHIDO
// ─────────────────────────────────────────────────────────────

/**
 * Para onde cada saída leva, escolhido numa lista — o mesmo que puxar a
 * bolinha no desenho, sem precisar acertar a bolinha com o dedo. E, quando
 * o bloco tem mais de uma saída, em qual delas entra o próximo bloco da
 * faixa de cima.
 */
function Saidas({
  no,
  nos,
  arestas,
  daVez,
  aoEscolher,
  aoLigar,
}: {
  no: NoFluxo
  nos: NoFluxo[]
  arestas: Edge[]
  daVez?: string
  aoEscolher: (saida: string) => void
  aoLigar: (saida: string, para: string | null) => void
}) {
  const saidas = saidasDe(no)
  const destinos = nos.filter((n) => n.id !== no.id && n.data.tipo !== 'inicio')
  const nomeDo = (n: NoFluxo) => {
    const d = n.data.dados as { textos?: string[]; texto?: string }
    const trecho = (d.textos?.[0] ?? d.texto ?? '').trim()
    return trecho ? `${ROTULO_NO[n.data.tipo]}: ${corta(trecho, 28)}` : ROTULO_NO[n.data.tipo]
  }
  return (
    <div className="flex flex-col gap-2 rounded-norte bg-superficie-2 p-2.5">
      <p className="text-xs font-medium text-tinta-2">{saidas.length > 1 ? 'Saídas deste bloco' : 'Depois deste bloco'}</p>
      {saidas.map((x) => {
        const atual = arestas.find((e) => e.source === no.id && (e.sourceHandle ?? 'saida') === x.id)
        return (
          <div key={x.id} className="flex items-center gap-2">
            {saidas.length > 1 && (
              <input
                type="radio"
                name={`vez-${no.id}`}
                checked={daVez === x.id}
                onChange={() => aoEscolher(x.id)}
                title="O próximo bloco da faixa de cima entra aqui"
                aria-label={`O próximo bloco entra em "${x.rotulo}"`}
                className="accent-[var(--marca)]"
              />
            )}
            <span className="w-24 shrink-0 truncate text-xs text-tinta" title={x.rotulo}>
              {x.rotulo}
            </span>
            <select
              value={atual?.target ?? ''}
              onChange={(e) => aoLigar(x.id, e.target.value || null)}
              aria-label={`Para onde vai "${x.rotulo}"`}
              className="min-w-0 flex-1 rounded-norte border border-borda bg-superficie px-2 py-1 text-xs text-tinta"
            >
              <option value="">— o roteiro acaba —</option>
              {destinos.map((n) => (
                <option key={n.id} value={n.id}>
                  {nomeDo(n)}
                </option>
              ))}
            </select>
          </div>
        )
      })}
      {saidas.length > 1 && <p className="text-[11px] text-tinta-3">A bolinha marca onde entra o próximo bloco que você clicar na faixa de cima.</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// QUEM ESTÁ DENTRO
// ─────────────────────────────────────────────────────────────

const quando = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

function Dentro({ slug, campanhaId, linhas }: { slug: string; campanhaId: string; linhas: DentroNaTela[] }) {
  const router = useRouter()
  const [indo, comecar] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  if (linhas.length === 0) return <p className="text-sm text-tinta-2">Ninguém dentro desta campanha agora.</p>
  return (
    <div className="flex flex-col gap-2">
      {erro && <Aviso nivel="critico">{erro}</Aviso>}
      <ul className="flex max-h-[52vh] flex-col divide-y divide-borda overflow-y-auto">
        {linhas.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-2 py-2">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium text-tinta">
                {l.nome ?? 'Sem nome'} <span className="font-normal text-tinta-3">{l.telefone}</span>
                {l.teste && <span className="ml-1 rounded-full bg-superficie-2 px-1.5 text-[10px] text-tinta-2">teste</span>}
              </p>
              <p className="text-xs text-tinta-2">
                {l.bloco} · {ROTULO_STATUS[l.status]}
                {l.proximoEm ? ` até ${quando(l.proximoEm)}` : ''}
              </p>
              <p className="text-[11px] text-tinta-3">entrou {quando(l.desde)}</p>
            </div>
            <Botao
              tom="discreto"
              disabled={indo}
              onClick={() =>
                comecar(async () => {
                  const r = await removerAcao(slug, campanhaId, l.id)
                  setErro(r.erro ?? null)
                  router.refresh()
                })
              }
            >
              Tirar
            </Botao>
          </li>
        ))}
      </ul>
    </div>
  )
}
