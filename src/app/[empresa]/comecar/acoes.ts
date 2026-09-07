'use server'

import { redirect } from 'next/navigation'
import { comoOrg } from '@/servidor/banco'
import { lerSessao } from '@/servidor/sessao'
import { exigir } from '@/servidor/permissao'
import { TODOS, RAMOS, type Modulo, type Ramo } from '@/servidor/modulos'
import type { Regime } from '@prisma/client'

export type EstadoComeco = { erro?: string }

const texto = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? null : v
}

export async function terminarCadastro(
  _anterior: EstadoComeco,
  form: FormData,
): Promise<EstadoComeco> {
  const slug = String(form.get('empresa') ?? '')
  const sessao = await lerSessao(slug)
  if (!sessao) redirect(`/${slug}/entrar`)

  // Só quem manda na empresa configura a empresa.
  exigir(sessao, 'empresa.configurar')

  const nome = texto(form, 'nome')
  if (!nome) return { erro: 'O nome da empresa é obrigatório.' }

  const ramo = String(form.get('ramo') ?? 'outro') as Ramo
  if (!(ramo in RAMOS)) return { erro: 'Escolha um ramo.' }

  // Só entram módulos que existem — o que vem do formulário é do navegador,
  // e o navegador é do usuário. Nunca confiar na lista que chegou.
  const modulos = TODOS.filter((m) => form.get(`modulo_${m}`) === 'on')

  const regimeBruto = String(form.get('regime') ?? '')
  const regime = ['MEI', 'SIMPLES', 'PRESUMIDO', 'REAL'].includes(regimeBruto)
    ? (regimeBruto as Regime)
    : null

  const agenteNome = modulos.includes('agente') ? texto(form, 'agenteNome') : null

  await comoOrg(sessao.orgId, async (db) => {
    await db.org.update({
      where: { id: sessao.orgId },
      data: {
        nome,
        ramo,
        modulos,
        regime,
        agenteNome,
        razaoSocial: texto(form, 'razaoSocial'),
        documento: texto(form, 'documento'),
        inscricaoEstadual: texto(form, 'inscricaoEstadual'),
        email: texto(form, 'email'),
        telefone: texto(form, 'telefone'),
        whatsapp: texto(form, 'whatsapp'),
        corMarca: texto(form, 'corMarca'),
        configuradaEm: new Date(),
      },
    })

    // A primeira unidade é a própria loja. Quem tem uma só nem percebe que
    // existe o conceito — e quem tem cinco não precisa de caso especial.
    const primeira = await db.unidade.findFirst({ orderBy: { criadaEm: 'asc' } })
    const dadosUnidade = {
      nome: texto(form, 'unidadeNome') ?? nome,
      documento: texto(form, 'documento'),
      endereco: texto(form, 'endereco'),
      numero: texto(form, 'numero'),
      complemento: texto(form, 'complemento'),
      bairro: texto(form, 'bairro'),
      cidade: texto(form, 'cidade'),
      estado: texto(form, 'estado'),
      cep: texto(form, 'cep'),
      telefone: texto(form, 'telefone'),
      horario: texto(form, 'horario'),
    }

    if (primeira) {
      await db.unidade.update({ where: { id: primeira.id }, data: dadosUnidade })
    } else {
      await db.unidade.create({ data: { orgId: sessao.orgId, ...dadosUnidade } })
    }

    // Semeia os eixos do ramo. Isto é ATALHO, não regra: a empresa acrescenta,
    // renomeia e apaga depois. O ramo escolhe o que nasce pronto, nunca o
    // caminho que o código toma.
    const jaTemEixo = await db.eixo.count()
    if (jaTemEixo === 0) {
      for (const [i, e] of RAMOS[ramo].eixos.entries()) {
        const eixo = await db.eixo.create({
          data: { orgId: sessao.orgId, nome: e.nome, ordem: i, ehCor: e.ehCor },
        })
        for (const [j, valor] of e.opcoes.entries()) {
          await db.opcao.create({
            data: { orgId: sessao.orgId, eixoId: eixo.id, valor, ordem: j },
          })
        }
      }
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.configurou',
        alvoTipo: 'org',
        alvoId: sessao.orgId,
        alvoNome: nome,
        depois: { ramo, modulos },
      },
    })
  })

  redirect(`/${slug}`)
}

/** Ligar e desligar módulo depois, em Configurações. */
export async function salvarModulos(_anterior: EstadoComeco, form: FormData): Promise<EstadoComeco> {
  const slug = String(form.get('empresa') ?? '')
  const sessao = await lerSessao(slug)
  if (!sessao) redirect(`/${slug}/entrar`)
  exigir(sessao, 'empresa.configurar')

  const modulos = TODOS.filter((m) => form.get(`modulo_${m}`) === 'on') as Modulo[]

  await comoOrg(sessao.orgId, async (db) => {
    const antes = await db.org.findUnique({
      where: { id: sessao.orgId },
      select: { modulos: true },
    })
    await db.org.update({ where: { id: sessao.orgId }, data: { modulos } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.modulos',
        antes: { modulos: antes?.modulos ?? [] },
        depois: { modulos },
      },
    })
  })

  redirect(`/${slug}/configuracoes`)
}
