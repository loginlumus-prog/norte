'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// `cliente.editar` é exigido dentro de `criarCliente` e `editarCliente`.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { criarCliente, editarCliente } from '@/servidor/cliente'
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

export async function criar(
  slug: string,
  _anterior: EstadoCliente,
  form: FormData,
): Promise<EstadoCliente> {
  const sessao = await exigirSessao(slug)

  let r
  try {
    r = await criarCliente(sessao, dadosDoFormulario(form))
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
    const r = await editarCliente(sessao, clienteId, {
      ...dadosDoFormulario(form),
      ativo: form.get('ativo') === 'on',
    })
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
