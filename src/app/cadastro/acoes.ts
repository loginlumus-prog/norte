'use server'

// O cadastro pelo site. Endereço público, sem sessão — as travas moram em
// src/servidor/autocadastro.ts e, a última, dentro do banco.

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import {
  cadastroAberto,
  conferirCarimbo,
  criarEmpresaPeloCadastro,
  type DadosCadastro,
} from '@/servidor/autocadastro'
import { normalizar, entrar } from '@/servidor/autenticacao'
import { abrirSessao } from '@/servidor/sessao'
import { emailConfigurado } from '@/servidor/email'
import { enviarConfirmacao } from '@/servidor/conta'
import { deOndeVeio, enderecoPublico } from '@/servidor/requisicao'
import { recadoDoErro } from '@/servidor/pagina'

export type EstadoCadastro = {
  erro?: string
  /** O que a pessoa digitou, para não precisar digitar de novo. Nunca a senha. */
  valores?: { empresa: string; dono: string; email: string; ramo: string; ref?: string }
  /** Criada, esperando a confirmação do e-mail. */
  criada?: { endereco: string; email: string; enviado: boolean }
}

const GENERICO = 'Não deu para concluir o cadastro agora. Espere alguns segundos e tente de novo.'

export async function criarContaAcao(_anterior: EstadoCadastro, form: FormData): Promise<EstadoCadastro> {
  const dados: DadosCadastro = {
    empresa: String(form.get('empresa') ?? '').slice(0, 200),
    dono: String(form.get('dono') ?? '').slice(0, 200),
    email: String(form.get('email') ?? '').slice(0, 300),
    senha: String(form.get('senha') ?? ''),
    ramo: String(form.get('ramo') ?? ''),
    aceitou: form.get('aceite') === 'on',
    // O código digitado vale mais que o do link: foi a pessoa que escolheu.
    ref: String(form.get('ref') ?? '').trim().slice(0, 30) || (await cookies()).get('norte_ref')?.value || null,
  }
  const valores = { empresa: dados.empresa, dono: dados.dono, email: dados.email, ramo: dados.ramo, ref: String(form.get('ref') ?? '') }

  if (!cadastroAberto()) return { erro: 'O cadastro pelo site está fechado agora. Fale com a gente pelo e-mail.', valores }

  // O campo que ninguém vê: gente não preenche, robô preenche. A resposta não
  // diz por quê — dizer ensinaria o robô.
  if (String(form.get('site') ?? '').trim() !== '') return { erro: GENERICO, valores }

  const carimbo = conferirCarimbo(String(form.get('carimbo') ?? ''))
  if (carimbo === 'rapido') return { erro: GENERICO, valores }
  if (carimbo !== 'ok') {
    return { erro: 'Esta página ficou aberta tempo demais. Recarregue e envie de novo.', valores }
  }

  const ip = await deOndeVeio()
  const base = await enderecoPublico()
  // Confirmação de e-mail só quando o e-mail consegue chegar: exigir um link
  // que nunca sai deixaria a dona trancada do lado de fora da própria loja.
  const comEmail = emailConfigurado() && !!base

  let r: Awaited<ReturnType<typeof criarEmpresaPeloCadastro>>
  try {
    r = await criarEmpresaPeloCadastro(dados, ip, { emailPendente: comEmail })
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para criar a empresa agora. Tente de novo em alguns minutos.'), valores }
  }

  if (!r.ok) {
    if (r.motivo === 'dados') return { erro: r.recado, valores }
    if (r.motivo === 'muitas_tentativas') {
      return { erro: 'Muitas empresas criadas a partir desta conexão na última hora. Tente de novo mais tarde.', valores }
    }
    return { erro: 'Muita gente se cadastrando agora. Tente de novo em alguns minutos.', valores }
  }

  const email = normalizar(dados.email)

  if (comEmail) {
    const envio = await enviarConfirmacao(r.orgId, r.usuarioId, base!, ip)
    return { criada: { endereco: r.endereco, email, enviado: envio === 'enviado' } }
  }

  // Sem e-mail no servidor: entra já, como quem aceita um convite. O
  // primeiro acesso leva ao cadastro inicial (/comecar).
  const entrada = await entrar(r.endereco, email, dados.senha, ip)
  if (entrada.ok) {
    await abrirSessao(r.endereco, entrada.sessao)
    redirect(`/${r.endereco}/comecar`)
  }
  redirect(`/${r.endereco}/entrar`)
}
