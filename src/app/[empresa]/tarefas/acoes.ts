'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// A permissão e o plano são exigidos dentro de `servidor/tarefas.ts`; aqui se
// confere só a FORMA do que veio (o navegador é do usuário) e se traduz o
// erro para uma frase que a tela pode mostrar.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import {
  alterarQuadro,
  alterarTarefa,
  apagarTarefa,
  arquivarQuadro,
  criarDeModelo,
  criarQuadro,
  criarTarefa,
  modeloValido,
  moverTarefa,
  progredir,
  renomearGrupo,
  situacaoValida,
  type AlteracaoDeTarefa,
} from '@/servidor/tarefas'

export type Resultado = { ok?: string; erro?: string; id?: string }

const texto = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')

const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

/** Roda a ação, traduz o erro, revalida a tela. Todas as ações passam aqui. */
async function tentar(slug: string, fn: () => Promise<Resultado | void>, semPermissao: string): Promise<Resultado> {
  try {
    const r = (await fn()) ?? {}
    revalidatePath(`/${slug}/tarefas`)
    return r
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: semPermissao }
    return { erro: e instanceof Error ? e.message : 'Não deu para salvar.' }
  }
}

export async function criarQuadroAcao(slug: string, form: FormData): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  const nome = texto(form.get('nome'), 80).trim()
  if (!nome) return { erro: 'Dê um nome ao quadro.' }
  const unidadeId = texto(form.get('unidadeId'), 64) || null
  if (unidadeId && !idValido(unidadeId)) return { erro: 'Loja inválida.' }
  const cor = texto(form.get('cor'), 7) || null
  const grupos = texto(form.get('grupos'), 600)
    .split(/[\n,]/)
    .map((g) => g.trim())
    .filter(Boolean)

  return tentar(
    slug,
    async () => {
      const q = await criarQuadro(sessao, {
        nome,
        descricao: texto(form.get('descricao')) || null,
        cor,
        unidadeId,
        grupos: grupos.length ? grupos : undefined,
      })
      return { ok: 'Quadro criado.', id: q.id }
    },
    'Você não pode criar quadro.',
  )
}

export async function criarDeModeloAcao(slug: string, chave: string, unidadeId: string | null): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!modeloValido(chave)) return { erro: 'Esse modelo não existe.' }
  if (unidadeId && !idValido(unidadeId)) return { erro: 'Loja inválida.' }
  return tentar(
    slug,
    async () => {
      const q = await criarDeModelo(sessao, chave, unidadeId)
      return { ok: 'Quadro criado a partir do modelo.', id: q.id }
    },
    'Você não pode criar quadro.',
  )
}

export async function renomearQuadroAcao(slug: string, quadroId: string, nome: string): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!idValido(quadroId)) return { erro: 'Quadro inválido.' }
  return tentar(slug, () => alterarQuadro(sessao, quadroId, { nome: texto(nome, 80) }), 'Você não pode alterar este quadro.')
}

export async function novoGrupoAcao(slug: string, quadroId: string, grupos: string[], novo: string): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!idValido(quadroId)) return { erro: 'Quadro inválido.' }
  const nome = texto(novo, 40).trim()
  if (!nome) return { erro: 'Dê um nome ao grupo.' }
  if (!Array.isArray(grupos)) return { erro: 'Lista de grupos inválida.' }
  if (grupos.map((g) => texto(g, 40).trim()).includes(nome)) return { erro: 'Já existe um grupo com esse nome.' }
  return tentar(
    slug,
    () => alterarQuadro(sessao, quadroId, { grupos: [...grupos.map((g) => texto(g, 40)), nome] }),
    'Você não pode alterar este quadro.',
  )
}

export async function renomearGrupoAcao(slug: string, quadroId: string, de: string, para: string): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!idValido(quadroId)) return { erro: 'Quadro inválido.' }
  return tentar(slug, () => renomearGrupo(sessao, quadroId, texto(de, 40), texto(para, 40)), 'Você não pode alterar este quadro.')
}

export async function arquivarQuadroAcao(slug: string, quadroId: string): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!idValido(quadroId)) return { erro: 'Quadro inválido.' }
  return tentar(
    slug,
    async () => {
      await arquivarQuadro(sessao, quadroId)
      return { ok: 'Quadro arquivado.' }
    },
    'Você não pode arquivar este quadro.',
  )
}

export async function criarTarefaAcao(slug: string, quadroId: string, grupo: string, titulo: string): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!idValido(quadroId)) return { erro: 'Quadro inválido.' }
  const t = texto(titulo, 160).trim()
  if (!t) return { erro: 'Escreva o que é para fazer.' }
  return tentar(
    slug,
    async () => {
      const r = await criarTarefa(sessao, { quadroId, grupo: texto(grupo, 40), titulo: t })
      return { id: r.id }
    },
    'Você não pode criar tarefa neste quadro.',
  )
}

export async function alterarTarefaAcao(slug: string, tarefaId: string, campos: AlteracaoDeTarefa): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!idValido(tarefaId)) return { erro: 'Tarefa inválida.' }
  if (!campos || typeof campos !== 'object') return { erro: 'Nada para alterar.' }

  // Só os campos conhecidos passam, cada um com o tipo que se espera dele.
  const limpo: AlteracaoDeTarefa = {}
  if ('titulo' in campos) limpo.titulo = texto(campos.titulo, 160)
  if ('descricao' in campos) limpo.descricao = campos.descricao === null ? null : texto(campos.descricao)
  if ('grupo' in campos) limpo.grupo = texto(campos.grupo, 40)
  if ('responsavelId' in campos) {
    if (campos.responsavelId !== null && !idValido(campos.responsavelId)) return { erro: 'Pessoa inválida.' }
    limpo.responsavelId = campos.responsavelId
  }
  if ('prioridade' in campos) {
    const n = Number(campos.prioridade)
    if (!Number.isInteger(n) || n < 0 || n > 5) return { erro: 'Prioridade vai de 0 a 5.' }
    limpo.prioridade = n
  }
  if ('prazo' in campos) limpo.prazo = campos.prazo === null ? null : texto(campos.prazo, 10)
  if ('inicio' in campos) limpo.inicio = campos.inicio === null ? null : texto(campos.inicio, 10)

  return tentar(slug, () => alterarTarefa(sessao, tarefaId, limpo), 'Você não pode editar esta tarefa.')
}

export async function moverTarefaAcao(slug: string, tarefaId: string, situacao: string): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!idValido(tarefaId)) return { erro: 'Tarefa inválida.' }
  if (!situacaoValida(situacao)) return { erro: 'Situação inválida.' }
  return tentar(
    slug,
    () => moverTarefa(sessao, tarefaId, situacao),
    'Esta tarefa é de outra pessoa. Você muda a situação só das suas e das que não têm responsável.',
  )
}

export async function progredirAcao(slug: string, tarefaId: string, progresso: number): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!idValido(tarefaId)) return { erro: 'Tarefa inválida.' }
  const n = Number(progresso)
  if (!Number.isInteger(n) || n < 0 || n > 100) return { erro: 'Progresso vai de 0 a 100.' }
  return tentar(
    slug,
    () => progredir(sessao, tarefaId, n),
    'Esta tarefa é de outra pessoa. Você mexe no progresso só das suas e das que não têm responsável.',
  )
}

export async function apagarTarefaAcao(slug: string, tarefaId: string): Promise<Resultado> {
  const sessao = await exigirSessao(slug)
  if (!idValido(tarefaId)) return { erro: 'Tarefa inválida.' }
  return tentar(
    slug,
    async () => {
      await apagarTarefa(sessao, tarefaId)
      return { ok: 'Tarefa apagada.' }
    },
    'Você não pode apagar tarefa.',
  )
}
