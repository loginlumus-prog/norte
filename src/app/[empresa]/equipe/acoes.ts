'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// `equipe.gerir` e `podeConceder` são exigidos dentro dos serviços.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { after } from 'next/server'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { convidar, revogarConvite, EmailJaUsado, VALE_DIAS } from '@/servidor/convite'
import { gerarLinkDeSenha } from '@/servidor/conta'
import { emailConfigurado, enviarEmail } from '@/servidor/email'
import { emailConvite } from '@/servidor/email-modelos'
import { enderecoPublico } from '@/servidor/requisicao'
import { acharOrgPorSlug } from '@/servidor/banco'
import { NOME_DO_PAPEL } from '@/servidor/guia'
import { cortarAcessoDoSuporte, mudarAcesso, mudarSituacao, mudarTelefone } from '@/servidor/equipe'
import { salvarMeta, mesValido } from '@/servidor/metas'
import { SemPermissao, type Papel } from '@/servidor/permissao'

export async function salvarMetaAcao(
  slug: string,
  m: { usuarioId: string; mes: string; valor: number; comissaoPct: number },
): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  if (!mesValido(m.mes)) return { erro: 'Mês inválido.' }
  if (!Number.isFinite(m.valor) || m.valor < 0) return { erro: 'A meta é um valor em reais, zero ou mais.' }
  if (!Number.isFinite(m.comissaoPct) || m.comissaoPct < 0 || m.comissaoPct > 50) {
    return { erro: 'A comissão é uma porcentagem entre 0 e 50.' }
  }
  try {
    await salvarMeta(sessao, m)
    revalidatePath(`/${slug}/equipe`)
    revalidatePath(`/${slug}`)
    return { ok: 'Salvo.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode definir metas.' }
    return { erro: recadoDoErro(e, 'Não deu para salvar.') }
  }
}

export type EstadoEquipe = { erro?: string; ok?: string; link?: string }

const PAPEIS: Papel[] = ['DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR']

/**
 * A base do link do convite.
 *
 * Sai dos cabeçalhos da requisição, não de variável de ambiente: o mesmo
 * código serve o domínio de produção, o de teste e o localhost, e um link de
 * convite que aponta para o lugar errado é um convite que ninguém aceita.
 */
async function baseDoSite(slug: string): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const protocolo = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protocolo}://${host}/${slug}`
}

export async function convidarPessoa(
  slug: string,
  _anterior: EstadoEquipe,
  form: FormData,
): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)

  const email = String(form.get('email') ?? '').trim()
  if (!email.includes('@')) return { erro: 'Informe um e-mail válido.' }

  const papelBruto = String(form.get('papel') ?? '') as Papel
  if (!PAPEIS.includes(papelBruto)) return { erro: 'Escolha um papel.' }

  const unidadeId = String(form.get('unidadeId') ?? '') || null

  // Com e-mail configurado, o convite também vai por e-mail — e aí o link
  // segue o endereço público (NORTE_URL), o mesmo de todo link que sai por
  // e-mail (ver requisicao.ts). Sem ele, o de sempre: o endereço da tela.
  const publico = emailConfigurado() ? await enderecoPublico() : null

  try {
    const c = await convidar(sessao, { email, papel: papelBruto, unidadeId }, publico ? `${publico}/${slug}` : await baseDoSite(slug))
    revalidatePath(`/${slug}/equipe`)
    // O link aparece UMA vez. Ele não fica guardado em lugar nenhum que dê
    // para recuperar — o banco só tem o resumo dele.
    if (publico) {
      const org = await acharOrgPorSlug(slug)
      const mensagem = emailConvite({
        para: c.email,
        empresa: org?.nome ?? slug,
        quemConvidou: sessao.nome,
        papel: NOME_DO_PAPEL[c.papel],
        link: c.link,
        validadeDias: VALE_DIAS,
      })
      // Depois da resposta: o fornecedor de e-mail lento não segura a tela.
      after(async () => {
        await enviarEmail(mensagem)
      })
      return { ok: `Convite criado e enviado por e-mail para ${c.email}. Se preferir, mande você mesmo este link:`, link: c.link }
    }
    return { ok: `Convite criado para ${c.email}. Mande este link para ela:`, link: c.link }
  } catch (e) {
    if (e instanceof EmailJaUsado) return { erro: e.message }
    if (e instanceof SemPermissao) return { erro: 'Você não pode convidar para esse papel.' }
    return { erro: recadoDoErro(e, 'Não deu para convidar.') }
  }
}

export async function revogar(slug: string, conviteId: string): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  try {
    await revogarConvite(sessao, conviteId)
    revalidatePath(`/${slug}/equipe`)
    return { ok: 'Convite cancelado.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode cancelar convite.' }
    return { erro: recadoDoErro(e, 'Não deu para cancelar.') }
  }
}

export async function trocarPapel(
  slug: string,
  usuarioId: string,
  papel: string,
  unidadeId: string | null,
): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  if (!PAPEIS.includes(papel as Papel)) return { erro: 'Escolha um papel da lista.' }

  try {
    // O dono vale para a empresa inteira, sempre (ver `DONO_SO_DA_EMPRESA`):
    // promover a dono quem estava preso a uma loja solta a loja junto.
    const r = await mudarAcesso(sessao, usuarioId, { papel: papel as Papel, unidadeId: papel === 'DONO' ? null : unidadeId })
    if (!r.ok) return { erro: r.motivo }
    revalidatePath(`/${slug}/equipe`)
    return { ok: 'Acesso alterado. A pessoa vai precisar entrar de novo.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer nesse acesso.' }
    return { erro: recadoDoErro(e, 'Não deu para alterar.') }
  }
}

export async function trocarSituacao(
  slug: string,
  usuarioId: string,
  ativo: boolean,
): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await mudarSituacao(sessao, usuarioId, ativo)
    if (!r.ok) return { erro: r.motivo }
    revalidatePath(`/${slug}/equipe`)
    return { ok: ativo ? 'Acesso devolvido.' : 'Acesso tirado. Ela sai do sistema na próxima tela.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer nesse acesso.' }
    return { erro: recadoDoErro(e, 'Não deu para alterar.') }
  }
}

export async function trocarTelefone(
  slug: string,
  usuarioId: string,
  telefone: string,
): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await mudarTelefone(sessao, usuarioId, String(telefone ?? '').slice(0, 30))
    if (!r.ok) return { erro: r.motivo }
    revalidatePath(`/${slug}/equipe`)
    revalidatePath(`/${slug}/agente`)
    if (!telefone.trim()) return { ok: 'Telefone apagado.' }
    if (!r.faltaConfirmar) return { ok: 'Telefone salvo.' }
    // Número novo só vale depois de a própria pessoa confirmar — até lá o
    // assistente trata como cliente (ver servidor/assistente/confirmacao.ts).
    return {
      ok:
        usuarioId === sessao.usuarioId
          ? 'Telefone salvo. Agora confirme em Minha conta: só depois disso o assistente reconhece você no WhatsApp.'
          : 'Telefone salvo. Falta a pessoa confirmar, em Minha conta: até lá o assistente trata este número como de cliente.',
    }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode mexer no telefone desta pessoa.' }
    return { erro: recadoDoErro(e, 'Não deu para salvar o telefone.') }
  }
}

/**
 * Um link de senha nova para alguém da equipe — o caminho quando o servidor
 * não manda e-mail, ou quando a pessoa não lê e-mail. Aparece UMA vez, como o
 * do convite. As travas (quem pode gerar para quem) moram em conta.ts.
 */
export async function gerarLinkSenha(slug: string, usuarioId: string): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await gerarLinkDeSenha(sessao, usuarioId, await baseDoSite(slug))
    if (!r.ok) return { erro: r.motivo }
    revalidatePath(`/${slug}/auditoria`)
    return {
      ok: `Link de senha nova para ${r.nome}. Mande só para ela — quem abre este link escolhe a senha da conta:`,
      link: r.link,
    }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode gerar link de senha.' }
    return { erro: recadoDoErro(e, 'Não deu para gerar o link.') }
  }
}

/** Cortar o acesso do NOSSO suporte antes do prazo — só a dona da empresa inteira. */
export async function cortarSuporte(slug: string, usuarioId: string): Promise<EstadoEquipe> {
  const sessao = await exigirSessao(slug)
  try {
    const r = await cortarAcessoDoSuporte(sessao, usuarioId)
    if (!r.ok) return { erro: r.motivo }
    revalidatePath(`/${slug}/equipe`)
    return { ok: 'Acesso do suporte cortado. Ele sai do sistema na próxima tela.' }
  } catch (e) {
    if (e instanceof SemPermissao) return { erro: 'Você não pode cortar o acesso do suporte.' }
    return { erro: recadoDoErro(e, 'Não deu para cortar o acesso.') }
  }
}
