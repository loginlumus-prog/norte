'use server'

// As ações da área de parceiros. Endereço público: cadastro, entrar e senha
// passam pelas funções do banco (a portaria); o resto exige a sessão do
// parceiro, conferida de novo a cada ação.

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import {
  cadastrarParceiro,
  entrarParceiro,
  pedirTrocaDeSenha,
  salvarDadosDoParceiro,
  sessaoDoParceiroVale,
  trocarSenhaPeloCodigo,
} from '@/servidor/parceiros'
import { abrirSessaoParceiro, fecharSessaoParceiro, lerSessaoParceiro } from '@/servidor/sessao-parceiro'
import { deOndeVeio, enderecoPublico } from '@/servidor/requisicao'
import { conferirCarimbo } from '@/servidor/autocadastro'
import { emailConfigurado, enviarEmail } from '@/servidor/email'
import { emailParceiroSenha } from '@/servidor/email-modelos'
import { recadoDoErro } from '@/servidor/pagina'

export type Estado = { erro?: string; ok?: string; valores?: Record<string, string> }

const GENERICO = 'Não deu para concluir agora. Espere alguns segundos e tente de novo.'
const txt = (f: FormData, k: string, max = 300) => String(f.get(k) ?? '').slice(0, max)

export async function cadastrarAcao(_: Estado, f: FormData): Promise<Estado> {
  const valores = { nome: txt(f, 'nome'), email: txt(f, 'email'), telefone: txt(f, 'telefone') }
  if (txt(f, 'site').trim() !== '') return { erro: GENERICO, valores }
  const carimbo = conferirCarimbo(txt(f, 'carimbo'))
  if (carimbo === 'rapido') return { erro: GENERICO, valores }
  if (carimbo !== 'ok') return { erro: 'Esta página ficou aberta tempo demais. Recarregue e envie de novo.', valores }

  const patrocinador = (await cookies()).get('norte_ref_parceiro')?.value ?? null
  let r: Awaited<ReturnType<typeof cadastrarParceiro>>
  try {
    r = await cadastrarParceiro(
      { ...valores, senha: String(f.get('senha') ?? ''), aceitou: f.get('aceite') === 'on' },
      await deOndeVeio(),
      patrocinador,
    )
  } catch (e) {
    return { erro: recadoDoErro(e, GENERICO), valores }
  }
  if (!r.ok) return { erro: r.recado, valores }
  await abrirSessaoParceiro(r.parceiroId)
  redirect('/parceiros/painel?novo=1')
}

export async function entrarAcao(_: Estado, f: FormData): Promise<Estado> {
  const email = txt(f, 'email')
  let r: Awaited<ReturnType<typeof entrarParceiro>>
  try {
    r = await entrarParceiro(email, String(f.get('senha') ?? ''), await deOndeVeio())
  } catch (e) {
    return { erro: recadoDoErro(e, GENERICO), valores: { email } }
  }
  if (!r.ok) return { erro: r.recado, valores: { email } }
  await abrirSessaoParceiro(r.parceiroId)
  redirect('/parceiros/painel')
}

export async function esqueciAcao(_: Estado, f: FormData): Promise<Estado> {
  const email = txt(f, 'email')
  const base = await enderecoPublico()
  if (!emailConfigurado() || !base) {
    return { erro: 'O envio de e-mail não está ligado agora. Fale com a equipe do Norte para trocar a senha.', valores: { email } }
  }
  try {
    const r = await pedirTrocaDeSenha(email, await deOndeVeio())
    if (r) {
      await enviarEmail(
        emailParceiroSenha({ para: email.trim().toLowerCase(), nome: r.nome, link: `${base}/parceiros/nova-senha?c=${r.codigo}`, validadeMin: 60 }),
      )
    }
  } catch (e) {
    return { erro: recadoDoErro(e, GENERICO), valores: { email } }
  }
  // A mesma resposta exista a conta ou não: a tela não conta quem é parceiro.
  return { ok: 'Se este e-mail tem conta de parceiro, o link para a senha nova chega em alguns minutos. Confira o spam.' }
}

export async function novaSenhaAcao(_: Estado, f: FormData): Promise<Estado> {
  const senha = String(f.get('senha') ?? '')
  if (senha !== String(f.get('confirma') ?? '')) return { erro: 'As duas senhas não são iguais.' }
  const r = await trocarSenhaPeloCodigo(txt(f, 'codigo', 100), senha)
  if (!r.ok) return { erro: r.recado }
  await abrirSessaoParceiro(r.parceiroId)
  redirect('/parceiros/painel')
}

/** A sessão, conferida no banco. Sem ela, volta para entrar. */
async function exigirParceiro(): Promise<string> {
  const s = await lerSessaoParceiro()
  if (!s || !(await sessaoDoParceiroVale(s.id, s.nasceu))) redirect('/parceiros/entrar')
  return s.id
}

export async function salvarPagamentoAcao(_: Estado, f: FormData): Promise<Estado> {
  const id = await exigirParceiro()
  const valores = { pixTipo: txt(f, 'pixTipo'), pixChave: txt(f, 'pixChave'), documento: txt(f, 'documento'), telefone: txt(f, 'telefone') }
  const r = await salvarDadosDoParceiro(id, valores)
  if (!r.ok) return { erro: r.recado, valores }
  return { ok: 'Dados de pagamento salvos.', valores }
}

export async function sairAcao() {
  await fecharSessaoParceiro()
  redirect('/parceiros/entrar')
}
