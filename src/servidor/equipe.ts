// A equipe: quem tem acesso, com que papel e em qual loja.
//
// O convite (quem ENTRA) mora em `convite.ts`. Aqui está o que acontece
// depois: mudar o papel de alguém, tirar o acesso, devolver.
//
// ── três travas que parecem burocracia e não são ─────────────
//
// 1. NINGUÉM MUDA O PRÓPRIO ACESSO. Nem para menos. Sem isso, a única dona
//    consegue se rebaixar sem querer e a empresa fica sem ninguém que possa
//    configurar nada — inclusive desfazer o rebaixamento.
//
// 2. A EMPRESA NUNCA FICA SEM DONO. Desativar o último ou rebaixá-lo é
//    recusado. É o caso que a gente só descobriria com o cliente ligando
//    sem conseguir entrar em nada.
//
// 3. TIROU O ACESSO, A SESSÃO MORRE NA HORA. `cortarSessoes` derruba o
//    cookie que já estava aberto. Sem isso, demitir alguém de manhã só faz
//    efeito quando o cookie dele expira, até 12 horas depois.

import { comoOrg } from './banco'
import { chaveTelefone, soDigitos } from './assistente/telefone'
import { SELECT_TELEFONE, estadoDoTelefone, type EstadoTelefone } from './assistente/confirmacao'
import { cortarSessoes } from './pagina'
import { exigir, podeConcederAcesso, PODERES, type Papel, type Sessao } from './permissao'
import { NOME_DO_PAPEL } from './guia'

export type PessoaDaEquipe = {
  id: string
  nome: string
  email: string
  ativo: boolean
  ultimoLogin: Date | null
  telefone: string | null
  /** Só 'confirmado' faz o assistente reconhecer a pessoa (ver assistente/confirmacao.ts). */
  telefoneEstado: EstadoTelefone
  acessos: {
    id: string
    papel: Papel
    unidadeId: string | null
    unidadeNome: string | null
    expiraEm: Date | null
    /** Só o SUPORTE tem: por que o acesso foi aberto. A dona lê na tela. */
    motivo: string | null
  }[]
}

export async function listarEquipe(sessao: Sessao): Promise<PessoaDaEquipe[]> {
  exigir(sessao, 'equipe.ver')

  return comoOrg(sessao.orgId, async (db) => {
    const pessoas = await db.usuario.findMany({
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      select: {
        id: true, nome: true, email: true, ativo: true, ultimoLogin: true, ...SELECT_TELEFONE,
        acessos: { select: { id: true, papel: true, unidadeId: true, expiraEm: true, motivo: true } },
      },
    })
    const unidades = await db.unidade.findMany({ select: { id: true, nome: true } })

    const nomeDa = new Map(unidades.map((u) => [u.id, u.nome]))
    const agora = new Date()
    return pessoas.map(({ telefoneConfirmado: _c, telefoneConfirmadoEm: _e, telefoneVistoEm: _v, ...p }) => ({
      ...p,
      telefoneEstado: estadoDoTelefone({ telefone: p.telefone, telefoneConfirmado: _c, telefoneConfirmadoEm: _e, telefoneVistoEm: _v }, agora),
      acessos: p.acessos.map((a) => ({
        ...a,
        papel: a.papel as Papel,
        unidadeNome: a.unidadeId ? (nomeDa.get(a.unidadeId) ?? null) : null,
      })),
    }))
  })
}

export type Vendedor = { id: string; nome: string }

/**
 * Quem pode vender NESTA unidade — para o balcão escolher "quem vendeu".
 *
 * Derivado da tabela de poderes: é gente ativa cujo papel inclui
 * `venda.criar`, com acesso à unidade ou à empresa inteira. A lista existe
 * para meta e comissão: a vendedora atende no salão, a caixa registra, e a
 * venda precisa ir para o nome certo.
 */
export async function listarVendedores(sessao: Sessao, unidadeId: string): Promise<Vendedor[]> {
  exigir(sessao, 'venda.criar', unidadeId)
  const agora = new Date()
  const papeis = (Object.keys(PODERES) as Papel[]).filter((p) => PODERES[p].includes('venda.criar'))

  return comoOrg(sessao.orgId, async (db) => {
    const pessoas = await db.usuario.findMany({
      where: {
        ativo: true,
        acessos: {
          some: {
            papel: { in: papeis },
            OR: [{ unidadeId: null }, { unidadeId }],
            AND: [{ OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] }],
          },
        },
      },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    })
    return pessoas
  })
}

export type ResultadoEquipe = { ok: true } | { ok: false; motivo: string }

type AcessoDoAlvo = { papel: Papel; unidadeId: string | null; expiraEm: Date | null }

/**
 * Esta pessoa pode mexer em quem tem ESTES acessos?
 *
 * Mexer em alguém — trocar o papel, desativar, reativar — exige poder dar
 * cada acesso que o alvo tem hoje. Antes só se conferia o acesso NOVO: o
 * gerente da loja 3 rebaixava a segunda dona para balconista, desativava o
 * gerente da loja 5 e reativava o dono que tinha sido tirado — tudo colando
 * o id na chamada. Puro, para o teste cobrir os casos.
 */
export function podeMexerEm(sessao: Sessao, acessosDoAlvo: readonly AcessoDoAlvo[], agora = new Date()): boolean {
  return acessosDoAlvo.every((a) => podeConcederAcesso(sessao, a.papel, a.unidadeId, agora))
}

const NAO_ALCANCA =
  'Você não pode mexer no acesso desta pessoa: ela tem um papel ou uma loja que você não pode conceder.'

/**
 * A frase de "não pode dar este acesso", com o nome do papel como a tela
 * mostra ("Balcão"), e não o código do banco ("BALCAO").
 */
export function recadoNaoConcede(papel: Papel, unidadeId: string | null): string {
  return `Você não pode dar o acesso de ${NOME_DO_PAPEL[papel]} ${unidadeId ? 'nesta loja' : 'para a empresa inteira'}.`
}

/**
 * O dono vale para a empresa INTEIRA, sempre.
 *
 * A tela deixava escolher "Dono" e uma loja, e o resultado era um dono preso
 * a uma loja que passava em toda conferência de "configurar a empresa" —
 * fechava a loja do sócio, trocava o plano, anonimizava qualquer cliente.
 * Quem precisa mandar numa loja só é Gerente dela.
 */
export const DONO_SO_DA_EMPRESA =
  'O acesso de Dono vale para a empresa inteira: não dá para prender a uma loja. Para uma loja só, use Gerente.'

export async function mudarAcesso(
  sessao: Sessao,
  usuarioId: string,
  novo: { papel: Papel; unidadeId: string | null },
): Promise<ResultadoEquipe> {
  exigir(sessao, 'equipe.gerir')

  if (usuarioId === sessao.usuarioId) {
    return { ok: false, motivo: 'Você não pode mudar o próprio acesso. Peça para outra pessoa.' }
  }
  if (novo.papel === 'DONO' && novo.unidadeId !== null) return { ok: false, motivo: DONO_SO_DA_EMPRESA }
  // `null` é a empresa inteira, e só dá quem tem a empresa inteira — ver
  // `podeConcederAcesso`.
  if (!podeConcederAcesso(sessao, novo.papel, novo.unidadeId)) {
    return { ok: false, motivo: recadoNaoConcede(novo.papel, novo.unidadeId) }
  }

  // Tudo numa transação: ler quem é o alvo, conferir, contar os donos e
  // escrever. Ler numa e escrever noutra deixava a conferência valer para
  // uma fotografia que já podia ter mudado.
  const r = await comoOrg(sessao.orgId, async (db): Promise<ResultadoEquipe> => {
    const pessoa = await db.usuario.findUnique({
      where: { id: usuarioId },
      select: { nome: true, acessos: { select: { papel: true, unidadeId: true, expiraEm: true } } },
    })
    if (!pessoa) return { ok: false, motivo: 'Pessoa não encontrada nesta empresa.' }
    const acessos = pessoa.acessos.map((a) => ({ ...a, papel: a.papel as Papel }))
    if (!podeMexerEm(sessao, acessos)) return { ok: false, motivo: NAO_ALCANCA }

    if (novo.unidadeId) {
      const loja = await db.unidade.findUnique({ where: { id: novo.unidadeId }, select: { id: true } })
      if (!loja) return { ok: false, motivo: 'Loja não encontrada nesta empresa.' }
    }

    // Tirar o último dono é o erro que só aparece quando ninguém mais entra.
    const eraDono = acessos.some((a) => a.papel === 'DONO')
    if (eraDono && novo.papel !== 'DONO') {
      const outros = await db.acesso.count({
        where: { papel: 'DONO', usuario: { ativo: true }, usuarioId: { not: usuarioId } },
      })
      if (outros === 0) return { ok: false, motivo: 'Esta é a única pessoa com acesso de dono. Promova outra antes.' }
    }

    await db.acesso.deleteMany({ where: { usuarioId } })
    await db.acesso.create({
      data: { orgId: sessao.orgId, usuarioId, papel: novo.papel, unidadeId: novo.unidadeId },
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: novo.unidadeId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'equipe.papel.alterou',
        alvoTipo: 'usuario',
        alvoId: usuarioId,
        alvoNome: pessoa.nome,
        antes: { papel: acessos[0]?.papel ?? null, unidadeId: acessos[0]?.unidadeId ?? null },
        depois: { papel: novo.papel, unidadeId: novo.unidadeId },
      },
    })
    return { ok: true }
  })
  if (!r.ok) return r

  // O cookie dela carrega os papéis ANTIGOS. Sem o corte, quem foi rebaixado
  // continua com o poder de antes até o cookie expirar.
  await cortarSessoes(sessao.orgId, usuarioId)
  return { ok: true }
}

export async function mudarSituacao(
  sessao: Sessao,
  usuarioId: string,
  ativo: boolean,
): Promise<ResultadoEquipe> {
  exigir(sessao, 'equipe.gerir')

  if (usuarioId === sessao.usuarioId) {
    return { ok: false, motivo: 'Você não pode desativar a própria conta.' }
  }

  const r = await comoOrg(sessao.orgId, async (db): Promise<ResultadoEquipe> => {
    const pessoa = await db.usuario.findUnique({
      where: { id: usuarioId },
      select: { nome: true, acessos: { select: { papel: true, unidadeId: true, expiraEm: true } } },
    })
    if (!pessoa) return { ok: false, motivo: 'Pessoa não encontrada nesta empresa.' }
    const acessos = pessoa.acessos.map((a) => ({ ...a, papel: a.papel as Papel }))
    // Vale nos dois sentidos: desativar a dona e REATIVAR o dono que foi
    // tirado são o mesmo poder, e o gerente da loja 3 não tem nenhum dos dois.
    if (!podeMexerEm(sessao, acessos)) return { ok: false, motivo: NAO_ALCANCA }

    if (!ativo && acessos.some((a) => a.papel === 'DONO')) {
      const outros = await db.acesso.count({
        where: { papel: 'DONO', usuario: { ativo: true }, usuarioId: { not: usuarioId } },
      })
      if (outros === 0) {
        return { ok: false, motivo: 'Esta é a única pessoa com acesso de dono. A empresa ficaria sem ninguém.' }
      }
    }

    await db.usuario.update({ where: { id: usuarioId }, data: { ativo } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: ativo ? 'equipe.reativou' : 'equipe.desativou',
        alvoTipo: 'usuario',
        alvoId: usuarioId,
        alvoNome: pessoa.nome,
        depois: { ativo },
      },
    })
    return { ok: true }
  })
  if (!r.ok) return r

  // Vale nos dois sentidos: desativar derruba agora; reativar também corta,
  // porque a sessão velha foi emitida quando a conta estava morta.
  await cortarSessoes(sessao.orgId, usuarioId)
  return { ok: true }
}

/**
 * O telefone de uma pessoa da equipe — o que o assistente usa para saber que
 * a mensagem é DELA, e para onde vão o relatório e os avisos.
 *
 * Por isso a regra é mais dura que um campo de cadastro:
 *
 *  - Cada um muda o PRÓPRIO. O de outra pessoa, só quem gere a equipe e
 *    alcança todos os acessos dela (`podeMexerEm`) — o gerente não mexe no
 *    telefone da dona.
 *  - Telefone repetido na equipe é recusado: com dois iguais o assistente
 *    trata a mensagem como de cliente (ver `acharInterlocutor`), e a dona
 *    perderia o relatório por um erro de digitação de outra pessoa.
 *  - Telefone que está no cadastro de um CLIENTE é recusado: a mensagem desse
 *    número passaria a falar com os poderes de quem é da equipe.
 *  - Só celular brasileiro com DDD vira chave (`chaveTelefone`). Vazio apaga.
 *  - Número NOVO nasce sem confirmação: o assistente só reconhece a pessoa
 *    depois que ela mesma confirma, em Minha conta (ver
 *    assistente/confirmacao.ts). Salvar o MESMO número de outro jeito
 *    ("(71) 9…" → "719…") não desfaz a confirmação.
 */
export async function mudarTelefone(
  sessao: Sessao,
  usuarioId: string,
  bruto: string,
): Promise<ResultadoEquipe & { faltaConfirmar?: boolean }> {
  const eu = usuarioId === sessao.usuarioId
  if (!eu) exigir(sessao, 'equipe.gerir')
  // O PRÓPRIO telefone também é escrita — e não uma qualquer: é ele que faz o
  // assistente tratar a mensagem como de gente da equipe. O suporte (nosso) e
  // o contador são só leitura em tudo; aqui também.
  if (eu && soLeitura(sessao)) {
    return { ok: false, motivo: 'Seu acesso é só de leitura: o telefone não muda por aqui. Peça a quem administra a equipe.' }
  }

  const texto = bruto.trim()
  const chave = texto ? chaveTelefone(texto) : null
  if (texto && !chave) {
    return { ok: false, motivo: 'Use um celular com DDD, por exemplo (71) 99999-0000.' }
  }
  const guardar = texto ? soDigitos(texto).replace(/^55(?=\d{10,11}$)/, '') : null

  return comoOrg(sessao.orgId, async (db): Promise<ResultadoEquipe & { faltaConfirmar?: boolean }> => {
    const pessoa = await db.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        nome: true, telefone: true, telefoneConfirmado: true,
        acessos: { select: { papel: true, unidadeId: true, expiraEm: true } },
      },
    })
    if (!pessoa) return { ok: false, motivo: 'Pessoa não encontrada nesta empresa.' }
    if (!eu && !podeMexerEm(sessao, pessoa.acessos.map((a) => ({ ...a, papel: a.papel as Papel })))) {
      return { ok: false, motivo: NAO_ALCANCA }
    }

    if (chave) {
      const outros = await db.usuario.findMany({
        where: { id: { not: usuarioId }, telefone: { not: null } },
        select: { nome: true, telefone: true },
      })
      const igual = outros.find((o) => chaveTelefone(o.telefone) === chave)
      if (igual) return { ok: false, motivo: `Este telefone já está com ${igual.nome}. Cada pessoa precisa do seu.` }

      const final = chave.slice(-8)
      const clientes = await db.$queryRaw<{ telefone: string }[]>`
        select telefone from clientes
         where telefone is not null
           and regexp_replace(telefone, '\\D', '', 'g') like ${'%' + final}
         limit 20
      `
      if (clientes.some((c) => chaveTelefone(c.telefone) === chave)) {
        return {
          ok: false,
          motivo:
            'Este telefone está no cadastro de um cliente. Tire de lá antes: com ele aqui, a mensagem desse número falaria com o assistente como equipe.',
        }
      }
    }

    // A confirmação é do NÚMERO: outro número, outra confirmação — e os
    // códigos pedidos para o número velho deixam de valer.
    const outroNumero = chave !== pessoa.telefoneConfirmado
    await db.usuario.update({
      where: { id: usuarioId },
      data: {
        telefone: guardar,
        ...(outroNumero ? { telefoneConfirmado: null, telefoneConfirmadoEm: null, telefoneVistoEm: null } : {}),
      },
    })
    if (outroNumero) {
      await db.confirmacaoTelefone.updateMany({
        where: { usuarioId, usadoEm: null, expiraEm: { gt: new Date() } },
        data: { expiraEm: new Date() },
      })
    }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'equipe.telefone',
        alvoTipo: 'usuario',
        alvoId: usuarioId,
        alvoNome: pessoa.nome,
        // Só os quatro últimos: o livro diz que mudou, sem espalhar o número.
        antes: { telefone: pessoa.telefone ? `…${soDigitos(pessoa.telefone).slice(-4)}` : null },
        depois: { telefone: guardar ? `…${guardar.slice(-4)}` : null },
      },
    })
    // Número salvo que ainda não vale para o assistente: a tela avisa.
    return { ok: true, faltaConfirmar: !!chave && outroNumero }
  })
}

/** Só SUPORTE e CONTADOR: acessos de quem olha e não escreve. */
export function soLeitura(sessao: Sessao, agora = new Date()): boolean {
  const vivos = sessao.acessos.filter((a) => !a.expiraEm || a.expiraEm > agora)
  return vivos.every((a) => a.papel === 'SUPORTE' || a.papel === 'CONTADOR')
}

/**
 * Cortar o acesso do NOSSO suporte, agora.
 *
 * O acesso de SUPORTE não se concede pela tela (ver `PODE_CONCEDER`), e por
 * isso `podeMexerEm` nunca o alcança — nem para a dona. Resultado: a loja via
 * a nossa conta na equipe e não tinha como tirá-la antes do prazo. O acesso é
 * nosso, mas a loja é dela: a dona da empresa inteira corta quando quiser,
 * sem precisar ligar para ninguém.
 *
 * Vence o acesso (não apaga): a linha, com o motivo e o prazo, continua
 * explicando o que está no livro de auditoria. Só o acesso de SUPORTE: se a
 * mesma pessoa tiver outro papel na loja, ele fica.
 */
export async function cortarAcessoDoSuporte(sessao: Sessao, usuarioId: string): Promise<ResultadoEquipe> {
  exigir(sessao, 'equipe.gerir')
  // Quem corta é quem poderia dar o acesso mais alto: a dona da empresa inteira.
  if (!podeConcederAcesso(sessao, 'DONO', null)) {
    return { ok: false, motivo: 'Só quem é Dono da empresa inteira corta o acesso do suporte.' }
  }
  const agora = new Date()
  const r = await comoOrg(sessao.orgId, async (db): Promise<ResultadoEquipe> => {
    const pessoa = await db.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } })
    if (!pessoa) return { ok: false, motivo: 'Pessoa não encontrada nesta empresa.' }
    const cortados = await db.acesso.updateMany({
      where: { usuarioId, papel: 'SUPORTE', OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
      data: { expiraEm: agora },
    })
    if (cortados.count === 0) return { ok: false, motivo: 'Esta pessoa não tem acesso de suporte valendo.' }
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'equipe.suporte.cortou',
        alvoTipo: 'usuario',
        alvoId: usuarioId,
        alvoNome: pessoa.nome,
        depois: { expiraEm: agora.toISOString() },
      },
    })
    return { ok: true }
  })
  if (!r.ok) return r
  // O cookie do suporte carrega o acesso de antes: sem o corte, ele seguiria
  // dentro até o cookie expirar.
  await cortarSessoes(sessao.orgId, usuarioId)
  return { ok: true }
}

/** O teto do nome: cabe em qualquer tela e no livro. */
export const NOME_MAX = 80

/**
 * Trocar o PRÓPRIO nome — na tela Minha conta.
 *
 * A tela dizia que "quem administra a equipe" mudava o nome, e nenhuma tela
 * mudava. O nome é da pessoa: é como ela aparece na venda, no quadro de
 * tarefas e no livro. Só o nosso suporte fica de fora — o nome dele é o que
 * a loja lê no livro para saber que fomos nós.
 *
 * As linhas antigas do livro continuam com o nome de antes (o livro guarda
 * quem fez, como era na hora), e a troca vira linha própria.
 */
export async function mudarMeuNome(sessao: Sessao, bruto: string): Promise<ResultadoEquipe & { nome?: string }> {
  if (sessao.acessos.length > 0 && sessao.acessos.every((a) => a.papel === 'SUPORTE')) {
    return { ok: false, motivo: 'O nome do acesso de suporte não muda por aqui.' }
  }
  const nome = String(bruto ?? '').replace(/\s+/g, ' ').trim()
  if (nome.length < 2) return { ok: false, motivo: 'Escreva o seu nome.' }
  if (nome.length > NOME_MAX) return { ok: false, motivo: `Nome longo demais: até ${NOME_MAX} letras.` }

  return comoOrg(sessao.orgId, async (db) => {
    const eu = await db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { nome: true } })
    if (!eu) return { ok: false as const, motivo: 'Conta não encontrada.' }
    if (eu.nome === nome) return { ok: true as const, nome }
    await db.usuario.update({ where: { id: sessao.usuarioId }, data: { nome } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: nome,
        acao: 'equipe.nome',
        alvoTipo: 'usuario',
        alvoId: sessao.usuarioId,
        alvoNome: nome,
        antes: { nome: eu.nome },
        depois: { nome },
      },
    })
    return { ok: true as const, nome }
  })
}
