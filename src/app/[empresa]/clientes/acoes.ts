'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// `cliente.editar` é exigido dentro de `criarCliente` e `editarCliente`.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ConsentimentoOfertas } from '@prisma/client'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { criarCliente, editarCliente, type AceiteNaFicha } from '@/servidor/cliente'
import { anonimizarCliente } from '@/servidor/anonimizar'
import { anotarSemOfertas, tirarSemOfertas } from '@/servidor/ofertas'
import { SemPermissao } from '@/servidor/permissao'

export type EstadoCliente = {
  erro?: string
  ok?: string
  /** Quando o telefone já é de outra pessoa, a tela leva até ela. */
  jaExisteId?: string
  jaExisteNome?: string
}

const texto = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? null : v
}

function dadosDoFormulario(form: FormData) {
  const nascimento = texto(form, 'nascimento')
  return {
    nome: String(form.get('nome') ?? ''),
    telefone: texto(form, 'telefone'),
    documento: texto(form, 'documento'),
    email: texto(form, 'email'),
    // 'T12:00' evita o pulo de dia por fuso: a data digitada é a gravada.
    nascimento: nascimento ? new Date(`${nascimento}T12:00:00`) : null,
    endereco: texto(form, 'endereco'),
    numero: texto(form, 'numero'),
    bairro: texto(form, 'bairro'),
    cidade: texto(form, 'cidade'),
    estado: texto(form, 'estado'),
    cep: texto(form, 'cep'),
    observacoes: texto(form, 'observacoes'),
  }
}

/**
 * A bolinha das ofertas no WhatsApp. O valor vem do navegador, então só os
 * três que existem passam; o resto é "não mexeu".
 */
function aceiteDoFormulario(form: FormData): AceiteNaFicha | null {
  const v = String(form.get('ofertas') ?? '')
  const valor = (['SIM', 'NAO', 'NAO_PERGUNTADO'] as const).find((x) => x === v) as ConsentimentoOfertas | undefined
  if (!valor) return null
  return { valor, origem: texto(form, 'ofertasOrigem') }
}

export async function criar(
  slug: string,
  _anterior: EstadoCliente,
  form: FormData,
): Promise<EstadoCliente> {
  const sessao = await exigirSessao(slug)

  let r
  try {
    r = await criarCliente(sessao, dadosDoFormulario(form), aceiteDoFormulario(form))
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para cadastrar cliente.' }
    return { erro: recadoDoErro(e, 'Não deu para cadastrar.') }
  }

  if (!r.ok) {
    return { erro: r.motivo, jaExisteId: r.jaExiste?.id, jaExisteNome: r.jaExiste?.nome }
  }

  revalidatePath(`/${slug}/clientes`)
  redirect(`/${slug}/clientes/${r.clienteId}`)
}

export async function editar(
  slug: string,
  clienteId: string,
  _anterior: EstadoCliente,
  form: FormData,
): Promise<EstadoCliente> {
  const sessao = await exigirSessao(slug)

  try {
    const r = await editarCliente(
      sessao,
      clienteId,
      { ...dadosDoFormulario(form), ativo: form.get('ativo') === 'on' },
      aceiteDoFormulario(form),
    )
    if (!r.ok) {
      return { erro: r.motivo, jaExisteId: r.jaExiste?.id, jaExisteNome: r.jaExiste?.nome }
    }
    revalidatePath(`/${slug}/clientes`)
    revalidatePath(`/${slug}/clientes/${clienteId}`)
    return { ok: 'Salvo.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para editar cliente.' }
    return { erro: recadoDoErro(e, 'Não deu para salvar.') }
  }
}

// ─────────────────────────────────────────────────────────────
// ANONIMIZAR (direito do titular)
// ─────────────────────────────────────────────────────────────

export type EstadoAnonimizar = { erro?: string }

/**
 * Anonimiza a ficha. A permissão (quem configura a empresa) e a palavra
 * digitada são conferidas DE NOVO em `anonimizarCliente`: a tela esconde o
 * botão, mas a ação é endereço público.
 */
export async function anonimizar(
  slug: string,
  clienteId: string,
  _anterior: EstadoAnonimizar,
  form: FormData,
): Promise<EstadoAnonimizar> {
  const sessao = await exigirSessao(slug)
  let r
  try {
    r = await anonimizarCliente(sessao, clienteId, String(form.get('confirmacao') ?? ''))
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Só quem configura a empresa pode anonimizar um cliente.' }
    return { erro: recadoDoErro(e, 'Não deu para anonimizar. Nada foi apagado.') }
  }
  if (!r.ok) return { erro: r.erro }
  revalidatePath(`/${slug}/clientes`)
  revalidatePath(`/${slug}/clientes/${clienteId}`)
  redirect(`/${slug}/clientes/${clienteId}`)
}

// ─────────────────────────────────────────────────────────────
// A LISTA DE QUEM NÃO RECEBE OFERTAS
// ─────────────────────────────────────────────────────────────

export type EstadoSemOfertas = { erro?: string; ok?: string }

export async function anotarNumero(slug: string, _anterior: EstadoSemOfertas, form: FormData): Promise<EstadoSemOfertas> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await anotarSemOfertas(sessao, String(form.get('telefone') ?? ''))
    if (!r.ok) return { erro: r.erro }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para mexer nesta lista.' }
    return { erro: recadoDoErro(e, 'Não deu para anotar o número.') }
  }
  revalidatePath(`/${slug}/clientes/sem-ofertas`)
  return { ok: 'Anotado. Esse número não entra mais em campanha.' }
}

export async function tirarNumero(slug: string, id: string, _anterior: EstadoSemOfertas, _form: FormData): Promise<EstadoSemOfertas> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await tirarSemOfertas(sessao, id)
    if (!r.ok) return { erro: r.erro }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não tem permissão para mexer nesta lista.' }
    return { erro: recadoDoErro(e, 'Não deu para tirar o número.') }
  }
  revalidatePath(`/${slug}/clientes/sem-ofertas`)
  return { ok: 'Tirado da lista.' }
}
