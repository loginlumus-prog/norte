'use client'

// O quadro, no desenho do Monday: um título colorido por grupo e, embaixo,
// uma tabela densa em que CADA CÉLULA É UM CONTROLE. Clicou no título, edita;
// clicou na pílula, escolhe a situação; clicou na estrela, marca a
// prioridade. Não há tela de edição — a linha é a tela.
//
// ── por que a tabela é feita à mão e não com `ui/Tabela` ─────
// Duas coisas que a Tabela genérica não tem, de propósito: cabeçalho com a
// etiqueta de cadeado (o título dela é texto) e a linha "+ Adicionar tarefa"
// dentro do próprio quadro. As classes são as mesmas dela — densa, cabeçalho
// grudado, rola dentro da própria caixa — para a pessoa não notar diferença.
//
// ── tudo que vem daqui já veio DECIDIDO do servidor ──────────
// `atrasada`, `podeMexer` e o que o plano abre chegam prontos. O cliente não
// recalcula regra nenhuma; se recalculasse, um dia as duas contas divergiam e
// a pílula diria uma coisa e o servidor faria outra.
//
// Controle que a pessoa não pode usar fica DESABILITADO com o motivo no
// `title` — nunca some. Sumir ensina que o sistema é pequeno; desabilitado
// com motivo ensina o que existe e por que ainda não dá.

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Situacao, cx, type Nivel } from '@/ui/base'
import { Cadeado } from '@/ui/Cadeado'
import { LIBERACOES, doPlano, planoQueAbre, type Liberacao } from '@/servidor/planos'
// Só TIPOS daqui: o módulo de tarefas fala com o banco, e valor importado
// dele arrastaria o driver do Postgres para o bundle do navegador. Rótulos,
// cores e iniciais chegam prontos da página, como dado.
import type { SituacaoTarefa, Veredito } from '@/servidor/tarefas'
import {
  alterarTarefaAcao,
  apagarTarefaAcao,
  arquivarQuadroAcao,
  criarTarefaAcao,
  moverTarefaAcao,
  novoGrupoAcao,
  progredirAcao,
  renomearGrupoAcao,
  renomearQuadroAcao,
  type Resultado,
} from './acoes'

export type TarefaNaTela = {
  id: string
  grupo: string
  titulo: string
  descricao: string | null
  responsavelId: string | null
  responsavelNome: string | null
  /** "AS" para Ana Souza — calculado no servidor. */
  responsavelIniciais: string | null
  situacao: SituacaoTarefa
  prioridade: number
  progresso: number
  /** "AAAA-MM-DD" ou nulo. */
  inicio: string | null
  prazo: string | null
  atrasada: boolean
  /** Esta pessoa pode mudar situação e progresso desta linha. */
  podeMexer: boolean
}

export type QuadroNaTela = {
  id: string
  nome: string
  descricao: string | null
  cor: string | null
  unidadeId: string | null
  unidadeNome: string | null
  grupos: string[]
  tarefas: TarefaNaTela[]
}

/** O que o plano da empresa abre neste quadro. */
export type Liberacoes = Record<'responsavel' | 'prazo' | 'prioridade' | 'linhaDoTempo', boolean>

export type Pessoa = { id: string; nome: string; iniciais: string }

/** Uma situação com o rótulo e a cor que a página decidiu. */
export type SituacaoNaTela = { chave: SituacaoTarefa; rotulo: string; nivel: Nivel }

const SO_QUEM_GERE = 'Só quem gere a equipe altera isto.'
const NAO_E_SUA = 'Esta tarefa é de outra pessoa. Você muda só as suas e as que não têm responsável.'

const trancado = (chave: Liberacao) => `${LIBERACOES[chave].titulo}: ${doPlano(planoQueAbre(chave).codigo)} para cima`

/** "2026-09-16" → "16/09". A chave já vem validada do servidor. */
const ddmm = (chave: string) => `${chave.slice(8, 10)}/${chave.slice(5, 7)}`

type Rodar = (fn: () => Promise<Resultado>, depois?: () => void) => void

// O slug e a tabela de situações são um só para a tela inteira. Em vez de
// descer por dez componentes, vão por contexto, preenchidos uma vez pelo `Quadro`.
const TelaContexto = createContext<{ slug: string; situacoes: SituacaoNaTela[] }>({ slug: '', situacoes: [] })
const useSlug = () => useContext(TelaContexto).slug
const useSituacoes = () => useContext(TelaContexto).situacoes
const situacaoDe = (lista: SituacaoNaTela[], chave: SituacaoTarefa): SituacaoNaTela =>
  lista.find((s) => s.chave === chave) ?? { chave, rotulo: chave, nivel: 'neutro' }

/* ── Menu solto ───────────────────────────────────────────── */

/**
 * Um botão que abre uma lista por cima da tabela. Fecha no clique fora e no
 * Esc — o que qualquer pessoa tenta primeiro. É o mesmo desenho do seletor
 * de unidade, e por isso parece a mesma coisa.
 */
function Menu({
  gatilho,
  aberto,
  aoAbrir,
  aoFechar,
  desabilitado,
  titulo,
  rotulo,
  children,
}: {
  gatilho: ReactNode
  aberto: boolean
  aoAbrir: () => void
  aoFechar: () => void
  desabilitado?: boolean
  titulo?: string
  rotulo: string
  children: ReactNode
}) {
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) aoFechar()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar()
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto, aoFechar])

  return (
    <div ref={caixa} className="relative inline-block">
      <button
        type="button"
        disabled={desabilitado}
        title={titulo}
        aria-label={rotulo}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        onClick={() => (aberto ? aoFechar() : aoAbrir())}
        className="rounded-norte disabled:cursor-not-allowed disabled:opacity-60"
      >
        {gatilho}
      </button>
      {aberto && (
        <div
          role="listbox"
          aria-label={rotulo}
          className="absolute left-0 z-30 mt-1 flex min-w-44 flex-col gap-0.5 rounded-norte border border-borda bg-superficie p-1.5 shadow-norte"
        >
          {children}
        </div>
      )}
    </div>
  )
}

const itemDoMenu = (ativo: boolean) =>
  cx(
    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
    ativo ? 'bg-marca-suave font-semibold text-marca' : 'text-tinta hover:bg-superficie-2',
  )

/* ── Células ──────────────────────────────────────────────── */

function Iniciais({ sigla, apagado }: { sigla: string | null; apagado?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold',
        sigla ? 'bg-marca-suave text-marca' : 'border border-dashed border-borda text-tinta-3',
        apagado && 'opacity-60',
      )}
    >
      {sigla ?? '?'}
    </span>
  )
}

function Responsavel({
  t,
  pessoas,
  podeGerir,
  liberado,
  rodar,
}: {
  t: TarefaNaTela
  pessoas: Pessoa[]
  podeGerir: boolean
  liberado: boolean
  rodar: Rodar
}) {
  const slug = useSlug()
  const [aberto, setAberto] = useState(false)
  const titulo = !liberado ? trancado('tarefas.responsavel') : !podeGerir ? SO_QUEM_GERE : 'Quem responde por esta tarefa'
  return (
    <Menu
      rotulo={`Responsável: ${t.responsavelNome ?? 'ninguém'}`}
      aberto={aberto}
      aoAbrir={() => setAberto(true)}
      aoFechar={() => setAberto(false)}
      desabilitado={!podeGerir || !liberado}
      titulo={titulo}
      gatilho={
        <span className="flex items-center gap-1.5 text-xs">
          <Iniciais sigla={t.responsavelIniciais} apagado={!liberado} />
          <span className={cx('max-w-28 truncate', t.responsavelNome ? 'text-tinta' : 'text-tinta-3')}>
            {t.responsavelNome ?? 'ninguém'}
          </span>
        </span>
      }
    >
      <button
        type="button"
        role="option"
        aria-selected={t.responsavelId === null}
        className={itemDoMenu(t.responsavelId === null)}
        onClick={() => {
          setAberto(false)
          rodar(() => alterarTarefaAcao(slug, t.id, { responsavelId: null }))
        }}
      >
        <Iniciais sigla={null} /> Ninguém
      </button>
      {pessoas.map((p) => (
        <button
          key={p.id}
          type="button"
          role="option"
          aria-selected={t.responsavelId === p.id}
          className={itemDoMenu(t.responsavelId === p.id)}
          onClick={() => {
            setAberto(false)
            rodar(() => alterarTarefaAcao(slug, t.id, { responsavelId: p.id }))
          }}
        >
          <Iniciais sigla={p.iniciais} /> <span className="truncate">{p.nome}</span>
        </button>
      ))}
      {pessoas.length === 0 && <p className="px-2 py-2 text-xs text-tinta-3">Ninguém com acesso a este quadro.</p>}
    </Menu>
  )
}

function PilulaSituacao({ t, rodar }: { t: TarefaNaTela; rodar: Rodar }) {
  const slug = useSlug()
  const situacoes = useSituacoes()
  const atual = situacaoDe(situacoes, t.situacao)
  const [aberto, setAberto] = useState(false)
  return (
    <Menu
      rotulo={`Situação: ${atual.rotulo}`}
      aberto={aberto}
      aoAbrir={() => setAberto(true)}
      aoFechar={() => setAberto(false)}
      desabilitado={!t.podeMexer}
      titulo={t.podeMexer ? 'Mudar a situação' : NAO_E_SUA}
      gatilho={<Situacao nivel={atual.nivel}>{atual.rotulo}</Situacao>}
    >
      {situacoes.map((s) => (
        <button
          key={s.chave}
          type="button"
          role="option"
          aria-selected={s.chave === t.situacao}
          className={itemDoMenu(s.chave === t.situacao)}
          onClick={() => {
            setAberto(false)
            if (s.chave !== t.situacao) rodar(() => moverTarefaAcao(slug, t.id, s.chave))
          }}
        >
          <Situacao nivel={s.nivel}>{s.rotulo}</Situacao>
        </button>
      ))}
    </Menu>
  )
}

/**
 * A barra início→prazo, preenchida pelo progresso. Clique ou arraste define
 * o progresso em passos de dez; as setas do teclado também. É um `slider`
 * de verdade para o leitor de tela, não um desenho.
 */
function LinhaDoTempo({ t, liberado, rodar }: { t: TarefaNaTela; liberado: boolean; rodar: Rodar }) {
  const slug = useSlug()
  const [previa, setPrevia] = useState<number | null>(null)
  const barra = useRef<HTMLDivElement>(null)
  const valor = previa ?? t.progresso
  const podeMexer = liberado && t.podeMexer

  const pctDoEvento = (e: { clientX: number }) => {
    const r = barra.current?.getBoundingClientRect()
    if (!r || r.width === 0) return valor
    const bruto = ((e.clientX - r.left) / r.width) * 100
    return Math.max(0, Math.min(100, Math.round(bruto / 10) * 10))
  }
  const salvar = (n: number) => {
    setPrevia(null)
    if (n !== t.progresso) rodar(() => progredirAcao(slug, t.id, n))
  }

  if (!liberado) {
    return (
      <span className="text-xs text-tinta-3" title={trancado('tarefas.linhaDoTempo')}>
        —
      </span>
    )
  }

  const periodo = t.inicio || t.prazo ? `${t.inicio ? ddmm(t.inicio) : '…'} → ${t.prazo ? ddmm(t.prazo) : '…'}` : 'sem datas'

  return (
    <div className="flex min-w-36 flex-col gap-0.5">
      <div
        ref={barra}
        role="slider"
        tabIndex={podeMexer ? 0 : -1}
        aria-label={`Progresso de ${t.titulo}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={valor}
        aria-valuetext={`${valor}%`}
        aria-disabled={!podeMexer}
        title={podeMexer ? 'Clique ou arraste para marcar o progresso' : NAO_E_SUA}
        className={cx(
          'relative h-4 overflow-hidden rounded-full bg-superficie-2',
          podeMexer ? 'cursor-pointer outline-anel focus-visible:outline-2' : 'cursor-not-allowed',
        )}
        onPointerDown={(e) => {
          if (!podeMexer) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setPrevia(pctDoEvento(e))
        }}
        onPointerMove={(e) => {
          if (previa !== null && podeMexer) setPrevia(pctDoEvento(e))
        }}
        onPointerUp={(e) => {
          if (!podeMexer) return
          salvar(pctDoEvento(e))
        }}
        onKeyDown={(e) => {
          if (!podeMexer) return
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') salvar(Math.min(100, t.progresso + 10))
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') salvar(Math.max(0, t.progresso - 10))
        }}
      >
        <div
          className={cx('h-full rounded-full', t.situacao === 'FEITO' ? 'bg-bom-vivo' : t.situacao === 'PARADO' ? 'bg-critico-vivo' : 'bg-marca')}
          style={{ width: `${valor}%` }}
        />
        <span className="numero pointer-events-none absolute inset-0 grid place-items-center text-[10px] font-bold text-tinta mix-blend-difference">
          {valor}%
        </span>
      </div>
      <span className="numero text-[10px] text-tinta-3">{periodo}</span>
    </div>
  )
}

function Prazo({ t, podeGerir, liberado, rodar }: { t: TarefaNaTela; podeGerir: boolean; liberado: boolean; rodar: Rodar }) {
  const slug = useSlug()
  const [editando, setEditando] = useState(false)
  const pode = podeGerir && liberado
  const titulo = !liberado ? trancado('tarefas.prazo') : !podeGerir ? SO_QUEM_GERE : 'Mudar o prazo'

  if (editando) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={t.prazo ?? ''}
        aria-label={`Prazo de ${t.titulo}`}
        className="numero rounded border border-borda bg-superficie px-1.5 py-0.5 text-xs text-tinta"
        onBlur={(e) => {
          setEditando(false)
          const v = e.target.value || null
          if (v !== t.prazo) rodar(() => alterarTarefaAcao(slug, t.id, { prazo: v }))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setEditando(false)
        }}
      />
    )
  }

  return (
    <button
      type="button"
      disabled={!pode}
      title={titulo}
      onClick={() => setEditando(true)}
      className={cx(
        'numero flex items-center gap-1.5 rounded px-1 py-0.5 text-xs',
        pode ? 'hover:bg-superficie-2' : 'cursor-not-allowed',
        t.atrasada ? 'font-semibold text-critico' : t.prazo ? 'text-tinta' : 'text-tinta-3',
        !liberado && 'opacity-60',
      )}
    >
      {t.prazo ? ddmm(t.prazo) : '—'}
      {t.atrasada && <span className="font-medium">atrasada</span>}
    </button>
  )
}

function Estrelas({ t, podeGerir, liberado, rodar }: { t: TarefaNaTela; podeGerir: boolean; liberado: boolean; rodar: Rodar }) {
  const slug = useSlug()
  const pode = podeGerir && liberado
  const titulo = !liberado ? trancado('tarefas.prioridade') : !podeGerir ? SO_QUEM_GERE : undefined
  return (
    <span
      role="group"
      aria-label={`${t.prioridade} de 5`}
      title={titulo ?? `Prioridade ${t.prioridade} de 5`}
      className={cx('inline-flex items-center', !liberado && 'opacity-60')}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!pode}
          aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
          aria-pressed={t.prioridade >= n}
          // Clicar na estrela já acesa apaga tudo: é o jeito de voltar a "sem prioridade".
          onClick={() => rodar(() => alterarTarefaAcao(slug, t.id, { prioridade: t.prioridade === n ? 0 : n }))}
          className={cx(
            'px-px text-base leading-none disabled:cursor-not-allowed',
            n <= t.prioridade ? 'text-atencao-vivo' : 'text-tinta-3',
            pode && 'hover:scale-110',
          )}
        >
          {n <= t.prioridade ? '★' : '☆'}
        </button>
      ))}
    </span>
  )
}

function Titulo({ t, podeGerir, rodar }: { t: TarefaNaTela; podeGerir: boolean; rodar: Rodar }) {
  const slug = useSlug()
  const [editando, setEditando] = useState(false)
  if (editando) {
    return (
      <input
        autoFocus
        defaultValue={t.titulo}
        maxLength={160}
        aria-label="Título da tarefa"
        className="w-full rounded border border-borda bg-superficie px-1.5 py-0.5 text-sm text-tinta"
        onBlur={(e) => {
          setEditando(false)
          const v = e.target.value.trim()
          if (v && v !== t.titulo) rodar(() => alterarTarefaAcao(slug, t.id, { titulo: v }))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setEditando(false)
        }}
      />
    )
  }
  return (
    <button
      type="button"
      disabled={!podeGerir}
      title={podeGerir ? 'Clique para editar' : SO_QUEM_GERE}
      onClick={() => setEditando(true)}
      className={cx(
        'w-full rounded px-1 py-0.5 text-left text-sm',
        podeGerir ? 'hover:bg-superficie-2' : 'cursor-default',
        t.situacao === 'FEITO' ? 'text-tinta-3 line-through decoration-tinta-3/60' : 'text-tinta',
      )}
    >
      {t.titulo}
      {t.descricao && (
        <span aria-label="tem descrição" title={t.descricao} className="ml-1.5 text-xs text-tinta-3">
          ¶
        </span>
      )}
    </button>
  )
}

/** A linha aberta: descrição, mover de grupo, apagar. */
function Detalhes({
  t,
  grupos,
  podeGerir,
  rodar,
  fechar,
}: {
  t: TarefaNaTela
  grupos: string[]
  podeGerir: boolean
  rodar: Rodar
  fechar: () => void
}) {
  const slug = useSlug()
  const [confirmando, setConfirmando] = useState(false)
  const [descricao, setDescricao] = useState(t.descricao ?? '')
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <label className="flex flex-1 flex-col gap-1 text-xs text-tinta-2">
        Descrição
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          readOnly={!podeGerir}
          rows={2}
          maxLength={2000}
          placeholder={podeGerir ? 'Detalhe o que precisa ser feito…' : 'Sem descrição.'}
          className="rounded-norte border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta placeholder:text-tinta-3"
        />
        {podeGerir && (descricao.trim() || '') !== (t.descricao ?? '') && (
          <Botao
            tom="secundario"
            className="self-start py-1 text-xs"
            onClick={() => rodar(() => alterarTarefaAcao(slug, t.id, { descricao: descricao.trim() || null }))}
          >
            Salvar descrição
          </Botao>
        )}
      </label>
      <div className="flex flex-col gap-2 sm:w-56">
        <label className="flex flex-col gap-1 text-xs text-tinta-2">
          Grupo
          <select
            value={t.grupo}
            disabled={!podeGerir}
            title={podeGerir ? undefined : SO_QUEM_GERE}
            onChange={(e) => rodar(() => alterarTarefaAcao(slug, t.id, { grupo: e.target.value }))}
            className="rounded-norte border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta disabled:cursor-not-allowed disabled:opacity-60"
          >
            {!grupos.includes(t.grupo) && <option value={t.grupo}>{t.grupo || 'Sem grupo'}</option>}
            {grupos.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        {confirmando ? (
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-critico">Apagar de vez?</span>
            <Botao tom="perigo" className="py-1 text-xs" onClick={() => rodar(() => apagarTarefaAcao(slug, t.id), fechar)}>
              Apagar
            </Botao>
            <Botao tom="discreto" className="py-1 text-xs" onClick={() => setConfirmando(false)}>
              Deixar
            </Botao>
          </span>
        ) : (
          <Botao
            tom="discreto"
            disabled={!podeGerir}
            title={podeGerir ? 'Apagar a tarefa. Some do quadro; fica no livro de auditoria.' : SO_QUEM_GERE}
            className="self-start py-1 text-xs text-critico"
            onClick={() => setConfirmando(true)}
          >
            Apagar tarefa
          </Botao>
        )}
      </div>
    </div>
  )
}

/* ── Linha ────────────────────────────────────────────────── */

const CELULA = 'border-b border-borda-suave px-2 py-1.5 align-middle'

function Linha({
  t,
  grupos,
  pessoas,
  podeGerir,
  lib,
  rodar,
}: {
  t: TarefaNaTela
  grupos: string[]
  pessoas: Pessoa[]
  podeGerir: boolean
  lib: Liberacoes
  rodar: Rodar
}) {
  const [aberta, setAberta] = useState(false)
  return (
    <>
      <tr className={cx('group', aberta && 'bg-superficie-2/60')}>
        <td className={cx(CELULA, 'min-w-56')}>
          <Titulo t={t} podeGerir={podeGerir} rodar={rodar} />
        </td>
        <td className={CELULA}>
          <Responsavel t={t} pessoas={pessoas} podeGerir={podeGerir} liberado={lib.responsavel} rodar={rodar} />
        </td>
        <td className={CELULA}>
          <PilulaSituacao t={t} rodar={rodar} />
        </td>
        <td className={CELULA}>
          <LinhaDoTempo t={t} liberado={lib.linhaDoTempo} rodar={rodar} />
        </td>
        <td className={CELULA}>
          <Prazo t={t} podeGerir={podeGerir} liberado={lib.prazo} rodar={rodar} />
        </td>
        <td className={CELULA}>
          <Estrelas t={t} podeGerir={podeGerir} liberado={lib.prioridade} rodar={rodar} />
        </td>
        <td className={cx(CELULA, 'w-8 text-right')}>
          <button
            type="button"
            aria-label={aberta ? 'Fechar detalhes' : 'Detalhes da tarefa'}
            aria-expanded={aberta}
            title="Descrição, grupo e apagar"
            onClick={() => setAberta((v) => !v)}
            className="rounded px-1.5 py-0.5 text-sm font-bold text-tinta-3 hover:bg-superficie-2 hover:text-tinta"
          >
            ⋯
          </button>
        </td>
      </tr>
      {aberta && (
        <tr>
          <td colSpan={7} className="border-b border-borda-suave bg-superficie-2/40 px-3 py-3">
            <Detalhes t={t} grupos={grupos} podeGerir={podeGerir} rodar={rodar} fechar={() => setAberta(false)} />
          </td>
        </tr>
      )}
    </>
  )
}

/* ── Grupo ────────────────────────────────────────────────── */

function NovaTarefa({ quadroId, grupo, podeGerir, teto, rodar }: { quadroId: string; grupo: string; podeGerir: boolean; teto: Veredito; rodar: Rodar }) {
  const slug = useSlug()
  const [valor, setValor] = useState('')
  const pode = podeGerir && teto.pode
  const titulo = !podeGerir ? SO_QUEM_GERE : !teto.pode ? teto.motivo : undefined
  return (
    <input
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      disabled={!pode}
      title={titulo}
      maxLength={160}
      placeholder={pode ? '+ Adicionar tarefa' : !teto.pode ? `+ ${teto.motivo}` : '+ Adicionar tarefa (só quem gere)'}
      aria-label={`Nova tarefa em ${grupo || 'sem grupo'}`}
      className="w-full rounded px-1 py-1 text-sm text-tinta placeholder:text-tinta-3 hover:bg-superficie-2 focus:bg-superficie disabled:cursor-not-allowed"
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        const t = valor.trim()
        if (!t) return
        setValor('')
        rodar(() => criarTarefaAcao(slug, quadroId, grupo, t))
      }}
    />
  )
}

function TituloDoGrupo({
  quadroId,
  nome,
  quantos,
  cor,
  primeiro,
  podeGerir,
  rodar,
}: {
  quadroId: string
  nome: string
  quantos: number
  cor: string | null
  primeiro: boolean
  podeGerir: boolean
  rodar: Rodar
}) {
  const slug = useSlug()
  const [editando, setEditando] = useState(false)
  const classe = cx('text-sm font-bold', !cor && (primeiro ? 'text-marca' : 'text-tinta-2'))
  const estilo = cor ? { color: cor } : undefined
  if (editando && nome) {
    return (
      <input
        autoFocus
        defaultValue={nome}
        maxLength={40}
        aria-label="Nome do grupo"
        className={cx(classe, 'rounded border border-borda bg-superficie px-1.5 py-0.5')}
        style={estilo}
        onBlur={(e) => {
          setEditando(false)
          const v = e.target.value.trim()
          if (v && v !== nome) rodar(() => renomearGrupoAcao(slug, quadroId, nome, v))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setEditando(false)
        }}
      />
    )
  }
  return (
    <h3 className="flex items-baseline gap-2">
      <button
        type="button"
        disabled={!podeGerir || !nome}
        title={!nome ? 'Tarefas sem grupo' : podeGerir ? 'Clique para renomear' : SO_QUEM_GERE}
        onClick={() => setEditando(true)}
        className={cx(classe, 'rounded px-1 text-left', podeGerir && nome && 'hover:bg-superficie-2')}
        style={estilo}
      >
        {nome || 'Sem grupo'}
      </button>
      <span className="numero text-xs text-tinta-3">
        {quantos} {quantos === 1 ? 'tarefa' : 'tarefas'}
      </span>
    </h3>
  )
}

function Grupo({
  quadro,
  nome,
  tarefas,
  primeiro,
  pessoas,
  podeGerir,
  lib,
  teto,
  slug,
  rodar,
}: {
  quadro: QuadroNaTela
  nome: string
  tarefas: TarefaNaTela[]
  primeiro: boolean
  pessoas: Pessoa[]
  podeGerir: boolean
  lib: Liberacoes
  teto: Veredito
  slug: string
  rodar: Rodar
}) {
  const cabecalho = 'sticky top-0 z-10 border-b border-borda bg-superficie-2 px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-tinta-3 uppercase'
  const th = (titulo: string, chave?: Liberacao, aberto = true) => (
    <th scope="col" className={cabecalho}>
      <span className="flex items-center gap-1.5">
        {titulo}
        {chave && !aberto && <Cadeado chave={chave} slug={slug} />}
      </span>
    </th>
  )

  return (
    <section className="flex flex-col gap-1.5">
      <TituloDoGrupo quadroId={quadro.id} nome={nome} quantos={tarefas.length} cor={quadro.cor} primeiro={primeiro} podeGerir={podeGerir} rodar={rodar} />
      {/* A faixa da esquerda leva a cor do grupo, como a fita colorida da
          pasta. A tabela rola dentro da própria caixa — a página nunca rola
          de lado, senão o menu vai embora. */}
      <div
        className={cx('overflow-x-auto rounded-norte border border-borda bg-superficie border-l-[3px]', !quadro.cor && (primeiro ? 'border-l-marca' : 'border-l-tinta-3'))}
        style={quadro.cor ? { borderLeftColor: quadro.cor } : undefined}
      >
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr>
              {th('Tarefa')}
              {th('Resp.', 'tarefas.responsavel', lib.responsavel)}
              {th('Situação')}
              {th('Linha do tempo', 'tarefas.linhaDoTempo', lib.linhaDoTempo)}
              {th('Prazo', 'tarefas.prazo', lib.prazo)}
              {th('Prioridade', 'tarefas.prioridade', lib.prioridade)}
              <th scope="col" className={cabecalho}>
                <span className="sr-only">Detalhes</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tarefas.map((t) => (
              <Linha key={t.id} t={t} grupos={quadro.grupos} pessoas={pessoas} podeGerir={podeGerir} lib={lib} rodar={rodar} />
            ))}
            {tarefas.length === 0 && (
              <tr>
                <td colSpan={7} className="border-b border-borda-suave px-3 py-3 text-center text-xs text-tinta-3">
                  Nada neste grupo ainda.
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={7} className="px-2 py-1">
                <NovaTarefa quadroId={quadro.id} grupo={nome} podeGerir={podeGerir} teto={teto} rodar={rodar} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ── O quadro ─────────────────────────────────────────────── */

export function Quadro({
  slug,
  quadro,
  podeGerir,
  liberacoes,
  pessoas,
  situacoes,
  teto,
}: {
  slug: string
  quadro: QuadroNaTela
  podeGerir: boolean
  liberacoes: Liberacoes
  pessoas: Pessoa[]
  /** As quatro situações, com rótulo e cor, na ordem do menu. */
  situacoes: SituacaoNaTela[]
  /** Cabe mais uma tarefa em aberto no plano? Vem calculado do servidor. */
  teto: Veredito
}) {
  const router = useRouter()
  const [indo, comecar] = useTransition()
  const [recado, setRecado] = useState<Resultado | null>(null)
  const [novoGrupo, setNovoGrupo] = useState('')
  const [renomeando, setRenomeando] = useState(false)
  const [arquivando, setArquivando] = useState(false)

  // Toda ação passa aqui: roda, guarda o recado e recarrega a tela do
  // servidor — é ele quem sabe a verdade depois da escrita.
  const rodar: Rodar = (fn, depois) =>
    comecar(async () => {
      const r = await fn()
      setRecado(r.erro ? r : null)
      if (!r.erro) {
        depois?.()
        router.refresh()
      }
    })

  // Os grupos do quadro, mais um "sem grupo" no fim se alguma tarefa ficou solta.
  const grupos = [...quadro.grupos]
  if (quadro.tarefas.some((t) => !t.grupo)) grupos.push('')

  return (
    <TelaContexto.Provider value={{ slug, situacoes }}>
    <div className={cx('flex flex-col gap-5', indo && 'opacity-80 transition-opacity')} aria-busy={indo}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {renomeando ? (
            <input
              autoFocus
              defaultValue={quadro.nome}
              maxLength={80}
              aria-label="Nome do quadro"
              className="rounded border border-borda bg-superficie px-2 py-1 text-[17px] font-bold text-tinta"
              onBlur={(e) => {
                setRenomeando(false)
                const v = e.target.value.trim()
                if (v && v !== quadro.nome) rodar(() => renomearQuadroAcao(slug, quadro.id, v))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenomeando(false)
              }}
            />
          ) : (
            <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight text-tinta">
              {quadro.cor && <span aria-hidden className="size-2.5 rounded-full" style={{ background: quadro.cor }} />}
              <button
                type="button"
                disabled={!podeGerir}
                title={podeGerir ? 'Clique para renomear' : SO_QUEM_GERE}
                onClick={() => setRenomeando(true)}
                className={cx('rounded px-1 text-left', podeGerir && 'hover:bg-superficie-2')}
              >
                {quadro.nome}
              </button>
              <span className="text-xs font-normal text-tinta-3">{quadro.unidadeNome ?? 'empresa inteira'}</span>
            </h2>
          )}
          {quadro.descricao && <p className="text-sm text-tinta-2">{quadro.descricao}</p>}
        </div>

        {arquivando ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-tinta-2">Arquivar? Ele sai daqui, mas nada é apagado.</span>
            <Botao tom="perigo" className="py-1 text-xs" onClick={() => rodar(() => arquivarQuadroAcao(slug, quadro.id), () => router.push(`/${slug}/tarefas`))}>
              Arquivar
            </Botao>
            <Botao tom="discreto" className="py-1 text-xs" onClick={() => setArquivando(false)}>
              Deixar
            </Botao>
          </span>
        ) : (
          <Botao
            tom="discreto"
            className="py-1 text-xs"
            disabled={!podeGerir}
            title={podeGerir ? 'Tira o quadro da tela. As tarefas ficam guardadas.' : SO_QUEM_GERE}
            onClick={() => setArquivando(true)}
          >
            Arquivar quadro
          </Botao>
        )}
      </header>

      {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}

      {grupos.map((g, i) => (
        <Grupo
          key={g || '__sem_grupo'}
          quadro={quadro}
          nome={g}
          tarefas={quadro.tarefas.filter((t) => t.grupo === g)}
          primeiro={i === 0}
          pessoas={pessoas}
          podeGerir={podeGerir}
          lib={liberacoes}
          teto={teto}
          slug={slug}
          rodar={rodar}
        />
      ))}

      <div className="flex items-center gap-2">
        <input
          value={novoGrupo}
          onChange={(e) => setNovoGrupo(e.target.value)}
          disabled={!podeGerir}
          title={podeGerir ? 'Uma faixa nova no quadro: "Esta semana", "Ao fechar"…' : SO_QUEM_GERE}
          maxLength={40}
          placeholder="+ Novo grupo"
          aria-label="Novo grupo"
          className="rounded-norte border border-dashed border-borda bg-transparent px-2.5 py-1.5 text-sm text-tinta placeholder:text-tinta-3 hover:bg-superficie disabled:cursor-not-allowed"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const v = novoGrupo.trim()
            if (!v) return
            rodar(() => novoGrupoAcao(slug, quadro.id, quadro.grupos, v), () => setNovoGrupo(''))
          }}
        />
        {novoGrupo.trim() && (
          <Botao tom="secundario" className="py-1 text-xs" carregando={indo} onClick={() => rodar(() => novoGrupoAcao(slug, quadro.id, quadro.grupos, novoGrupo.trim()), () => setNovoGrupo(''))}>
            Criar grupo
          </Botao>
        )}
      </div>
    </div>
    </TelaContexto.Provider>
  )
}
