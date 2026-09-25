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
import { cortarSessoes } from './pagina'
import { exigir, podeConcederAcesso, PODERES, type Papel, type Sessao } from './permissao'

export type PessoaDaEquipe = {
  id: string
  nome: string
  email: string
  ativo: boolean
  ultimoLogin: Date | null
  telefone: string | null
  acessos: { id: string; papel: Papel; unidadeId: string | null; unidadeNome: string | null; expiraEm: Date | null }[]
}

export async function listarEquipe(sessao: Sessao): Promise<PessoaDaEquipe[]> {
  exigir(sessao, 'equipe.ver')

  return comoOrg(sessao.orgId, async (db) => {
    const pessoas = await db.usuario.findMany({
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      select: {
        id: true, nome: true, email: true, ativo: true, ultimoLogin: true, telefone: true,
        acessos: { select: { id: true, papel: true, unidadeId: true, expiraEm: true } },
      },
    })
    const unidades = await db.unidade.findMany({ select: { id: true, nome: true } })

    const nomeDa = new Map(unidades.map((u) => [u.id, u.nome]))
    return pessoas.map((p) => ({
      ...p,
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

export async function mudarAcesso(
  sessao: Sessao,
  usuarioId: string,
  novo: { papel: Papel; unidadeId: string | null },
): Promise<ResultadoEquipe> {
  exigir(sessao, 'equipe.gerir')

  if (usuarioId === sessao.usuarioId) {
    return { ok: false, motivo: 'Você não pode mudar o próprio acesso. Peça para outra pessoa.' }
  }
  // `null` é a empresa inteira, e só dá quem tem a empresa inteira — ver
  // `podeConcederAcesso`.
  if (!podeConcederAcesso(sessao, novo.papel, novo.unidadeId)) {
    return { ok: false, motivo: `Você não pode conceder o papel ${novo.papel}${novo.unidadeId ? ' nesta loja' : ' para todas as lojas'}.` }
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
 */
export async function mudarTelefone(
  sessao: Sessao,
  usuarioId: string,
  bruto: string,
): Promise<ResultadoEquipe> {
  const eu = usuarioId === sessao.usuarioId
  if (!eu) exigir(sessao, 'equipe.gerir')

  const texto = bruto.trim()
  const chave = texto ? chaveTelefone(texto) : null
  if (texto && !chave) {
    return { ok: false, motivo: 'Use um celular com DDD, por exemplo (71) 99999-0000.' }
  }
  const guardar = texto ? soDigitos(texto).replace(/^55(?=\d{10,11}$)/, '') : null

  return comoOrg(sessao.orgId, async (db): Promise<ResultadoEquipe> => {
    const pessoa = await db.usuario.findUnique({
      where: { id: usuarioId },
      select: { nome: true, telefone: true, acessos: { select: { papel: true, unidadeId: true, expiraEm: true } } },
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

    await db.usuario.update({ where: { id: usuarioId }, data: { telefone: guardar } })
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
    return { ok: true }
  })
}
