'use server'

import { redirect } from 'next/navigation'
import { comoOrg } from '@/servidor/banco'
import { sessaoViva } from '@/servidor/pagina'
import { exigir } from '@/servidor/permissao'
import { TODOS, RAMOS, type Modulo, type Ramo } from '@/servidor/modulos'
import { PORTES, DORES, CATALOGOS, CANAIS_VALIDOS, daLista } from '@/servidor/cadastro'
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
  const sessao = await sessaoViva(slug)
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

  // As cinco respostas de "como você trabalha". Tudo conferido contra a lista
  // de verdade em servidor/cadastro.ts: o que chega do formulário é do
  // navegador, e o navegador é de quem está do outro lado.
  const porte = daLista(form.get('porte'), PORTES)
  const dor = daLista(form.get('dor'), DORES)
  const catalogo = daLista(form.get('catalogo'), CATALOGOS)
  const comoVende = form
    .getAll('comoVende')
    .map(String)
    .filter((c) => CANAIS_VALIDOS.includes(c))

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
        // O jeito de vender vem do ramo: sorveteria toca no botão, loja de
        // roupa bipa a etiqueta. É padrão, e o dono troca em Configurações.
        balcaoGrade: RAMOS[ramo].balcao === 'grade',
        porte,
        dor,
        catalogo,
        comoVende,
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
      // A PRIMEIRA unidade não passa por cota, e não é economia de código: ela
      // É o cadastro da empresa. Recusar aqui seria barrar quem está entrando
      // no sistema pela primeira vez — e nem existe plano que barre, porque o
      // menor deles já cabe uma.
      //
      // Aqui havia uma chamada a `exigirCotaDeUnidade`, e ela quebrava TODA
      // empresa nova: a função abre a própria transação, e esta linha roda
      // dentro de uma. Duas transações, uma conexão, dois segundos de espera e
      // "Deu problema aqui do nosso lado" na cara de quem acabou de assinar.
      // Só não aparecia no desenvolvimento porque as empresas de exemplo já
      // nascem com unidade e nunca caem neste ramo.
      //
      // Quando existir tela de "abrir outra loja", a cota é lá — e FORA da
      // transação. O `comoOrg` agora recusa aninhamento e explica o porquê.
      await db.unidade.create({ data: { orgId: sessao.orgId, ...dadosUnidade } })
    }

    // ── o que o ramo deixa pronto ────────────────────────────
    // Tudo daqui para baixo é ATALHO, não regra: a empresa acrescenta,
    // renomeia e apaga depois. O ramo escolhe o que NASCE pronto, nunca o
    // caminho que o código toma.
    //
    // E cada bloco só age se ainda não existir nada — quem voltar ao cadastro
    // para trocar o telefone não pode ganhar uma segunda leva de categorias.
    const preset = RAMOS[ramo]

    const jaTemEixo = await db.eixo.count()
    if (jaTemEixo === 0) {
      for (const [i, e] of preset.eixos.entries()) {
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

    // As gavetas do catálogo. Tela de categoria vazia é uma pergunta sem
    // resposta ("como é que EU deveria dividir isso?"); cinco nomes do ramo
    // dela são um ponto de partida que ela corrige em trinta segundos.
    const jaTemCategoria = await db.categoria.count()
    if (jaTemCategoria === 0 && preset.categorias.length > 0) {
      await db.categoria.createMany({
        data: preset.categorias.map((nome, i) => ({ orgId: sessao.orgId, nome, ordem: i })),
      })
    }

    // O assistente nasce DESLIGADO e sem poder nenhum — mas já sabendo do que
    // aquele comércio vive. O manual do ramo é o que separa um assistente que
    // pergunta "qual o tamanho?" numa sapataria (onde a pergunta é o NÚMERO)
    // de um que abre a boca certo no primeiro dia.
    //
    // `create` direto, e não `salvarAgente`: aquela função abre a própria
    // transação, e a gente já está dentro de uma.
    if (agenteNome) {
      const jaTemAgente = await db.agente.count()
      if (jaTemAgente === 0) {
        await db.agente.create({
          data: { orgId: sessao.orgId, nome: agenteNome, manual: preset.manual },
        })
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
        depois: { ramo, modulos, porte, dor, catalogo, comoVende },
      },
    })
  })

  redirect(`/${slug}`)
}

/** Ligar e desligar módulo depois, em Configurações. */
export async function salvarModulos(_anterior: EstadoComeco, form: FormData): Promise<EstadoComeco> {
  const slug = String(form.get('empresa') ?? '')
  const sessao = await sessaoViva(slug)
  if (!sessao) redirect(`/${slug}/entrar`)
  exigir(sessao, 'empresa.configurar')

  const modulos = TODOS.filter((m) => form.get(`modulo_${m}`) === 'on') as Modulo[]
  const balcaoGrade = form.get('balcaoGrade') === 'on'

  await comoOrg(sessao.orgId, async (db) => {
    const antes = await db.org.findUnique({
      where: { id: sessao.orgId },
      select: { modulos: true, balcaoGrade: true },
    })
    await db.org.update({ where: { id: sessao.orgId }, data: { modulos, balcaoGrade } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.modulos',
        antes: { modulos: antes?.modulos ?? [], balcaoGrade: antes?.balcaoGrade ?? false },
        depois: { modulos, balcaoGrade },
      },
    })
  })

  redirect(`/${slug}/configuracoes`)
}
