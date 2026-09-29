'use server'

// Server Action é endereço público — ver `balcao/acoes.ts`. Aqui se confere a
// FORMA do que veio (o navegador é do usuário) e se traduz o erro para uma
// frase; quem pode o quê, e o módulo, são conferidos em `servidor/escola.ts`.

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { SemPermissao } from '@/servidor/permissao'
import { lerDinheiro, lerNumero } from '@/servidor/dinheiro'
import {
  buscarAlunos,
  criarTurma,
  editarMatricula,
  editarTurma,
  matricular,
  mudarMatricula,
  type DadosTurma,
  type SituacaoMatricula,
} from '@/servidor/escola'
import { registrarErro } from '@/servidor/registro'

export type EstadoEscola = { erro?: string; ok?: string; pedeConfirmacao?: boolean; vez?: number; id?: string }

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

function lerTurma(form: FormData): DadosTurma | { erro: string } {
  const mensalidade = lerDinheiro(texto(form.get('mensalidade'), 20) || '0')
  if (mensalidade === null) return { erro: 'Não deu para ler a mensalidade. Escreva assim: 450,00.' }
  const capBruta = texto(form.get('capacidade'), 6).trim()
  const diaBruto = texto(form.get('diaVencimento'), 3).trim()
  return {
    unidadeId: texto(form.get('unidadeId'), 64),
    nome: texto(form.get('nome'), 120),
    curso: texto(form.get('curso'), 120),
    turno: texto(form.get('turno'), 20) || null,
    professorId: texto(form.get('professorId'), 64) || null,
    dias: [0, 1, 2, 3, 4, 5, 6].filter((d) => form.get(`dia_${d}`) === 'on'),
    horaInicio: texto(form.get('horaInicio'), 5) || null,
    horaFim: texto(form.get('horaFim'), 5) || null,
    capacidade: capBruta ? Number(capBruta) : null,
    inicio: texto(form.get('inicio'), 10) || null,
    fim: texto(form.get('fim'), 10) || null,
    mensalidade,
    diaVencimento: diaBruto ? Number(diaBruto) : 10,
    ativa: form.get('ativa') === null ? true : form.get('ativa') === 'on',
  }
}

export async function salvarTurmaAcao(slug: string, anterior: EstadoEscola, form: FormData): Promise<EstadoEscola> {
  const sessao = await exigirSessao(slug)
  const vez = (anterior.vez ?? 0) + 1
  const id = texto(form.get('id'), 64)
  if (id && !idValido(id)) return { erro: 'Turma inválida.', vez }
  const d = lerTurma(form)
  if ('erro' in d) return { erro: d.erro, vez }
  if (d.professorId && !idValido(d.professorId)) return { erro: 'Professor inválido.', vez }
  if (!idValido(d.unidadeId)) return { erro: 'Escolha a unidade da turma.', vez }
  // O formulário de edição manda "ativa" sempre (a caixa desmarcada não vem).
  if (id) d.ativa = form.get('ativa') === 'on'
  try {
    const r = id ? await editarTurma(sessao, id, d) : await criarTurma(sessao, d)
    if (!r.ok) return { erro: r.erro, vez }
    revalidatePath(`/${slug}/turmas`)
    return { ok: id ? 'Turma salva.' : 'Turma criada.', vez, id: r.id }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Criar e mudar turma é com quem gere a escola.', vez }
    return { erro: `Não deu para salvar. Tente de novo. (código ${registrarErro('turma.salvar', e)})`, vez }
  }
}

export async function matricularAcao(slug: string, anterior: EstadoEscola, form: FormData): Promise<EstadoEscola> {
  const sessao = await exigirSessao(slug)
  const vez = (anterior.vez ?? 0) + 1
  const alunoId = texto(form.get('alunoId'), 64)
  const turmaId = texto(form.get('turmaId'), 64)
  if (!idValido(alunoId)) return { erro: 'Escolha o aluno na busca.', vez }
  if (!idValido(turmaId)) return { erro: 'Turma inválida.', vez }
  try {
    const r = await matricular(sessao, {
      alunoId,
      turmaId,
      inicio: texto(form.get('inicio'), 10) || null,
      confirmar: form.get('confirmar') === 'on',
    })
    if (!r.ok) return { erro: r.erro, pedeConfirmacao: r.pedeConfirmacao, vez }
    revalidatePath(`/${slug}/turmas/${turmaId}`)
    revalidatePath(`/${slug}/mensalidades`)
    return { ok: `Matriculado.${r.mensalidades > 0 ? ` ${r.mensalidades === 1 ? 'A mensalidade já está' : 'As mensalidades já estão'} em Mensalidades.` : ''}`, vez }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não matricula nesta unidade.', vez }
    return { erro: `Não deu para matricular. Tente de novo. (código ${registrarErro('matricula.criar', e)})`, vez }
  }
}

const SITUACOES: SituacaoMatricula[] = ['ATIVA', 'TRANCADA', 'CANCELADA', 'CONCLUIDA']

export async function mudarMatriculaAcao(
  slug: string,
  id: string,
  para: string,
  motivo: string,
): Promise<{ ok?: string; erro?: string }> {
  const sessao = await exigirSessao(slug)
  if (!idValido(id)) return { erro: 'Matrícula inválida.' }
  const alvo = SITUACOES.find((s) => s === para)
  if (!alvo) return { erro: 'Situação inválida.' }
  try {
    const r = await mudarMatricula(sessao, id, { para: alvo, motivo: texto(motivo, 200) })
    if (!r.ok) return { erro: r.erro }
    revalidatePath(`/${slug}/turmas`, 'layout')
    revalidatePath(`/${slug}/mensalidades`)
    return {
      ok:
        alvo === 'ATIVA'
          ? 'Matrícula reativada.'
          : `Pronto.${r.dispensadas > 0 ? ` ${r.dispensadas === 1 ? '1 mensalidade futura dispensada' : `${r.dispensadas} mensalidades futuras dispensadas`}.` : ''}`,
    }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não mexe em matrícula desta unidade.' }
    return { erro: `Não deu. Tente de novo. (código ${registrarErro('matricula.mudar', e)})` }
  }
}

export async function editarMatriculaAcao(slug: string, anterior: EstadoEscola, form: FormData): Promise<EstadoEscola> {
  const sessao = await exigirSessao(slug)
  const vez = (anterior.vez ?? 0) + 1
  const id = texto(form.get('id'), 64)
  if (!idValido(id)) return { erro: 'Matrícula inválida.', vez }
  const valor = lerDinheiro(texto(form.get('valor'), 20))
  if (valor === null) return { erro: 'Não deu para ler a mensalidade. Escreva assim: 450,00.', vez }
  const pct = lerNumero(texto(form.get('descontoPct'), 10) || '0')
  if (pct === null) return { erro: 'Não deu para ler a bolsa em porcento.', vez }
  const fixo = lerDinheiro(texto(form.get('descontoValor'), 20) || '0')
  if (fixo === null) return { erro: 'Não deu para ler o desconto em reais.', vez }
  try {
    const r = await editarMatricula(sessao, id, {
      valor,
      diaVencimento: Number(texto(form.get('diaVencimento'), 3)),
      descontoPct: pct,
      descontoValor: fixo,
      descontoMotivo: texto(form.get('descontoMotivo'), 160),
    })
    if (!r.ok) return { erro: r.erro, vez }
    revalidatePath(`/${slug}/turmas`, 'layout')
    revalidatePath(`/${slug}/mensalidades`)
    return { ok: `Salvo.${r.ajustadas > 0 ? ` ${r.ajustadas === 1 ? '1 mensalidade em aberto ajustada' : `${r.ajustadas} mensalidades em aberto ajustadas`}.` : ''}`, vez }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Mudar valor e dar bolsa é com quem gere a escola.', vez }
    return { erro: `Não deu para salvar. Tente de novo. (código ${registrarErro('matricula.editar', e)})`, vez }
  }
}

export async function buscarAlunosAcao(slug: string, termo: string) {
  const sessao = await exigirSessao(slug)
  try {
    const r = await buscarAlunos(sessao, texto(termo, 80))
    return r.map((a) => ({ id: a.id, nome: a.nome, nascimento: a.nascimento ? a.nascimento.toISOString().slice(0, 10) : null }))
  } catch {
    return []
  }
}
