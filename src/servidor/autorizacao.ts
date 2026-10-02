// Autorizar na hora, com o PIN de quem pode.
//
// ── o problema ───────────────────────────────────────────────
// A vendedora dá 20% numa loja cujo teto é 15%, ou lança uma peça que não
// tem cadastro. Até aqui o balcão recusava e mandava "chamar quem pode" — e
// quem pode é a gerente, que está no estoque, e a cliente na frente,
// esperando. Ou a gerente vinha, saía da conta da vendedora, entrava na
// dela, fechava a venda e voltava: três minutos e a venda no nome errado.
//
// Agora a gerente chega, digita o PIN dela no balcão da vendedora e pronto:
// a venda segue no nome de quem vendeu, e fica escrito QUEM autorizou.
//
// ── o que o PIN é, e o que não é ─────────────────────────────
// É pessoal (4 a 6 números), criado pela própria pessoa em Minha conta, com a
// senha de entrar. Não é login: não abre sessão, não serve fora do pedido de
// autorização. E não basta acertar o número — quem é dona do PIN precisa ter,
// NESTA loja, a capacidade que o pedido exige (`pode`). O PIN da colega de
// balcão não autoriza desconto, mesmo certo.
//
// ── por que é lento e por que tem freio ──────────────────────
// Guardado como a senha (scrypt, ver senha.ts), amarrado à pessoa: o mesmo
// 1234 de duas pessoas dá dois resumos diferentes. Quatro números são poucos
// — 10 mil combinações —, então o freio é o que segura o chute: cinco erros em
// 15 minutos por LOJA (a mesma régua do login, em limite.ts). Por loja, e não
// por pessoa, porque quem chuta não sabe de quem é o PIN que está tentando.
//
// Cada autorização vai para o livro, no nome de quem AUTORIZOU, com o motivo
// e quem pediu.
//
// NÃO chame de dentro de `comoOrg`: esta função abre as próprias transações
// (o freio e o livro), e transação não aninha.

import { comoOrg } from './banco'
import { SELECT_ACESSO, acessosDoBanco } from './cargos'
import { podeNoAlcance, type Capacidade, type Papel, type Sessao } from './permissao'
import { conferirSenha, guardarSenha, HASH_ISCA } from './senha'
import { concluirTentativa, reservarTentativa } from './limite'

export const PIN_MIN = 4
export const PIN_MAX = 6

/**
 * O que está errado neste PIN, ou `null` quando ele serve.
 *
 * Além do tamanho, recusa o que todo mundo chuta primeiro: número repetido
 * (0000, 1111) e escada (1234, 4321, 123456). Com 10 mil combinações e um
 * freio de cinco tentativas, o chute só funciona se o PIN for desses.
 */
export function problemaDoPin(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return 'O PIN é só de números.'
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return `O PIN tem de ${PIN_MIN} a ${PIN_MAX} números.`
  if (/^(\d)\1+$/.test(pin)) return 'Número repetido (como 0000) é o primeiro que alguém chuta. Escolha outro.'
  const d = [...pin].map(Number)
  const sobe = d.every((x, i) => i === 0 || x === (d[i - 1]! + 1) % 10)
  const desce = d.every((x, i) => i === 0 || x === (d[i - 1]! + 9) % 10)
  if (sobe || desce) return 'Sequência (como 1234) é o primeiro que alguém chuta. Escolha outro.'
  return null
}

/** O que vai para o scrypt: o PIN amarrado à pessoa (e com o tamanho que `guardarSenha` exige). */
const materialDoPin = (usuarioId: string, pin: string) => `pin:${usuarioId}:${pin}`

/** A chave do freio: a loja (ou a empresa inteira, para o que não é de loja). */
const chaveDoFreio = (unidadeId: string | null) => `pin:${unidadeId ?? 'empresa'}`

export type Autorizacao =
  | { ok: true; autorizador: { usuarioId: string; nome: string } }
  | { ok: false; erro: string }

/**
 * Confere o PIN digitado e devolve QUEM autorizou — ou a recusa, numa frase.
 *
 * Acha, entre as pessoas ATIVAS da empresa com PIN criado, a dona deste PIN
 * que tem `capacidade` na loja `unidadeId` (com `null`, na empresa inteira).
 * A recusa é a mesma para "PIN errado" e "PIN de quem não pode": dizer a
 * diferença entregaria que aquele número é o PIN de alguém.
 */
export async function autorizarComPin(p: {
  orgId: string
  unidadeId: string | null
  pin: string
  capacidade: Capacidade
  motivo: string
  quemPediu: { usuarioId: string; nome: string }
}): Promise<{ ok: true; autorizador: { usuarioId: string; nome: string } } | { ok: false; erro: string }> {
  const pin = String(p.pin ?? '').trim()
  // Formato errado não gasta tentativa: é dedo, não chute.
  if (!/^\d+$/.test(pin) || pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return { ok: false, erro: `O PIN tem de ${PIN_MIN} a ${PIN_MAX} números.` }
  }

  // Conta ANTES de conferir, como o login: chutes simultâneos esperam a trava
  // e já enxergam os erros uns dos outros (ver `reservarTentativa`).
  const reserva = await reservarTentativa(p.orgId, chaveDoFreio(p.unidadeId), null)
  if (reserva.bloqueado) {
    return {
      ok: false,
      erro: `PIN errado muitas vezes ${p.unidadeId ? 'nesta loja' : 'nesta empresa'}. Espere ${reserva.esperarMin} min e tente de novo.`,
    }
  }

  const gente = await comoOrg(p.orgId, (db) =>
    db.usuario.findMany({
      where: { ativo: true, pinHash: { not: null } },
      select: {
        id: true,
        nome: true,
        pinHash: true,
        acessos: { select: SELECT_ACESSO },
      },
    }),
  )
  const agora = new Date()
  // Só quem PODE é candidata: o PIN certo de quem não pode não autoriza nada,
  // e conferir só estas poupa o scrypt de toda a equipe.
  const candidatas = gente.filter((u) => {
    const comoSessao: Sessao = {
      orgId: p.orgId,
      usuarioId: u.id,
      nome: u.nome,
      acessos: acessosDoBanco(u.acessos),
    }
    return podeNoAlcance(comoSessao, p.capacidade, p.unidadeId, agora)
  })

  const bateram: { id: string; nome: string }[] = []
  for (const u of candidatas) {
    if (await conferirSenha(materialDoPin(u.id, pin), u.pinHash!)) bateram.push({ id: u.id, nome: u.nome })
  }
  // Ninguém para conferir: gasta o mesmo tempo de uma conferência, senão a
  // resposta instantânea contaria que nesta loja ninguém pode autorizar.
  if (candidatas.length === 0) await conferirSenha(materialDoPin('ninguem', pin), HASH_ISCA)

  if (bateram.length !== 1) {
    // A tentativa já nasceu erro (ver `reservarTentativa`): nada a fechar.
    return {
      ok: false,
      erro:
        bateram.length > 1
          ? 'Duas pessoas que podem autorizar usam esse mesmo PIN. Peça para uma delas trocar o dela em Minha conta.'
          : 'O PIN não confere, ou é de quem não pode autorizar isto nesta loja.',
    }
  }

  const autorizador = bateram[0]!
  await concluirTentativa(p.orgId, reserva.tentativaId, true)

  const motivo = p.motivo.trim().slice(0, 300) || 'autorização'
  await comoOrg(p.orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId: p.orgId,
        unidadeId: p.unidadeId,
        usuarioId: autorizador.id,
        quem: autorizador.nome,
        acao: 'autorizacao.pin',
        alvoTipo: 'usuario',
        alvoId: p.quemPediu.usuarioId,
        alvoNome: p.quemPediu.nome,
        motivo: `${motivo} · pedido por ${p.quemPediu.nome}`,
        depois: { capacidade: p.capacidade },
        // Autorizar com o PIN é assinar: entra no livro de assinaturas.
        assinado: true,
      },
    }),
  )

  return { ok: true, autorizador: { usuarioId: autorizador.id, nome: autorizador.nome } }
}

// ─────────────────────────────────────────────────────────────
// ASSINAR AS EXCEÇÕES COM O PRÓPRIO PIN (o livro de assinaturas)
// ─────────────────────────────────────────────────────────────
//
// Autorizar (acima) é a GERENTE digitando o PIN dela no balcão da vendedora.
// Assinar é outra coisa: é a PRÓPRIA pessoa que está fazendo a exceção — a
// sangria, o cancelamento, a baixa de crediário pago fora, a correção do
// estoque — confirmando com o PIN dela que foi ela. A sessão aberta diz qual
// conta está na tela; o PIN diz quem está na frente dela. Sem isto, a tela
// esquecida aberta no balcão faz sangria no nome de quem saiu para almoçar.
//
// Quando pedir é decisão da empresa (`Org.pinNasExcecoes`, nasce desligado):
// ligado, toda exceção pede; desligado, nenhuma — exceto as que pedem SEMPRE
// (juntar fichas de cliente; a vendedora que corrige estoque porque a empresa
// deixou, ver `soPelaEmpresa`). Nunca em toda venda: a venda é o normal, e
// pedir PIN no normal ensina a equipe a burlar.
//
// Mesma cautela do autorizar: fora de `comoOrg` (abre as próprias transações
// para o freio), PIN nunca guardado, e o freio é POR PESSOA — aqui quem chuta
// sabe de quem é o PIN que está tentando: o da conta aberta na tela.

/** A recusa de uma exceção que precisa de assinatura — a tela mostra o campo do PIN. */
export class PinNecessario extends Error {
  readonly precisaPin = true
  constructor(recado: string) {
    super(recado)
    this.name = 'PinNecessario'
  }
}

export type Assinatura = { ok: true; assinou: boolean } | { ok: false; erro: string; precisaPin: true }

/** A empresa pede o PIN de quem faz nas exceções? */
export async function pedePinNasExcecoes(orgId: string): Promise<boolean> {
  const o = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { pinNasExcecoes: true } }))
  return o?.pinNasExcecoes === true
}

/**
 * Confere o PIN da PRÓPRIA pessoa da sessão. A recusa vem numa frase; quem
 * ainda não criou o PIN ouve isso (não é chute, não gasta tentativa).
 */
export async function conferirMeuPin(
  sessao: Sessao,
  pin: string | null | undefined,
): Promise<{ ok: true } | { ok: false; erro: string; semPin?: true }> {
  const p = String(pin ?? '').trim()
  const eu = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { ativo: true, pinHash: true } }),
  )
  if (!eu?.ativo) return { ok: false, erro: 'Esta conta não está ativa.' }
  if (!eu.pinHash) {
    return { ok: false, semPin: true, erro: 'Você ainda não criou o seu PIN. Crie em Minha conta (leva um minuto) e faça de novo.' }
  }
  // Formato errado não gasta tentativa: é dedo, não chute.
  if (!/^\d+$/.test(p) || p.length < PIN_MIN || p.length > PIN_MAX) {
    return { ok: false, erro: `Digite o seu PIN (de ${PIN_MIN} a ${PIN_MAX} números).` }
  }
  const reserva = await reservarTentativa(sessao.orgId, `pin-meu:${sessao.usuarioId}`, null)
  if (reserva.bloqueado) {
    return { ok: false, erro: `PIN errado muitas vezes. Espere ${reserva.esperarMin} min e tente de novo.` }
  }
  if (!(await conferirSenha(materialDoPin(sessao.usuarioId, p), eu.pinHash))) {
    // A tentativa já nasceu erro (ver `reservarTentativa`).
    return { ok: false, erro: 'O PIN não confere. É o SEU PIN, o que você criou em Minha conta.' }
  }
  await concluirTentativa(sessao.orgId, reserva.tentativaId, true)
  return { ok: true }
}

/**
 * A assinatura de uma exceção: se a empresa (ou a própria exceção, com
 * `sempre`) pede, confere o PIN de quem faz. `assinou` vai para a linha do
 * livro (`Auditoria.assinado`). Não pedida, passa sem assinar — e um PIN que
 * venha mesmo assim é ignorado (a tela não mostra o campo).
 */
export async function assinarExcecao(
  sessao: Sessao,
  p: { pin?: string | null; sempre?: boolean },
): Promise<Assinatura> {
  const pede = p.sempre || (await pedePinNasExcecoes(sessao.orgId))
  if (!pede) return { ok: true, assinou: false }
  if (!String(p.pin ?? '').trim()) {
    const r = await comoOrg(sessao.orgId, (db) =>
      db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { pinHash: true } }),
    )
    return {
      ok: false,
      precisaPin: true,
      erro: r?.pinHash
        ? 'Assine com o seu PIN para registrar.'
        : 'Isto pede a sua assinatura, e você ainda não criou o seu PIN. Crie em Minha conta (leva um minuto) e faça de novo.',
    }
  }
  const r = await conferirMeuPin(sessao, p.pin)
  return r.ok ? { ok: true, assinou: true } : { ok: false, erro: r.erro, precisaPin: true }
}

/** `assinarExcecao` para quem trabalha com exceção: recusa vira `PinNecessario`. */
export async function exigirAssinatura(sessao: Sessao, p: { pin?: string | null; sempre?: boolean }): Promise<boolean> {
  const r = await assinarExcecao(sessao, p)
  if (!r.ok) throw new PinNecessario(r.erro)
  return r.assinou
}

/**
 * Quem ainda não criou o PIN, entre as pessoas ATIVAS que fazem exceção
 * (todo papel que opera — não o contador, que só lê, nem o nosso suporte).
 * Ligar a chave com alguém nesta lista trava essa pessoa no meio de uma
 * sangria; a tela de Configurações mostra os nomes e só liga com ela vazia.
 */
export async function quemFaltaPin(orgId: string, agora = new Date()): Promise<{ id: string; nome: string }[]> {
  const gente = await comoOrg(orgId, (db) =>
    db.usuario.findMany({
      where: { ativo: true, pinHash: null },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, acessos: { select: { papel: true, expiraEm: true } } },
    }),
  )
  return gente
    .filter((u) => u.acessos.some((a) => (!a.expiraEm || a.expiraEm > agora) && a.papel !== 'CONTADOR' && a.papel !== 'SUPORTE'))
    .map((u) => ({ id: u.id, nome: u.nome }))
}

// ─────────────────────────────────────────────────────────────
// O PIN DA PRÓPRIA PESSOA (Minha conta)
// ─────────────────────────────────────────────────────────────

/** Tem PIN criado? Para a tela dizer "criar" ou "trocar". */
export async function meuPin(sessao: Sessao): Promise<{ tem: boolean; desde: Date | null }> {
  const u = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { pinHash: true, pinDefinidoEm: true } }),
  )
  return { tem: !!u?.pinHash, desde: u?.pinDefinidoEm ?? null }
}

/**
 * Cria ou troca o próprio PIN, com a senha de entrar.
 *
 * A senha é o que impede o atalho: a tela aberta e esquecida no balcão não
 * pode virar "criei um PIN na conta da gerente e me autorizei 40%". A senha
 * errada conta no mesmo freio do login (por pessoa), para esta tela não
 * virar o lugar de chutar a senha de quem deixou a conta aberta.
 */
export async function definirMeuPin(
  sessao: Sessao,
  senhaAtual: string,
  pin: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const novo = String(pin ?? '').trim()
  const problema = problemaDoPin(novo)
  if (problema) return { ok: false, erro: problema }

  const reserva = await reservarTentativa(sessao.orgId, `pin-conta:${sessao.usuarioId}`, null)
  if (reserva.bloqueado) {
    return { ok: false, erro: `Senha errada muitas vezes. Espere ${reserva.esperarMin} min e tente de novo.` }
  }
  const eu = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { senhaHash: true, pinHash: true } }),
  )
  const certa = await conferirSenha(String(senhaAtual ?? ''), eu?.senhaHash ?? HASH_ISCA)
  if (!eu?.senhaHash || !certa) return { ok: false, erro: 'A senha de entrar não confere.' }
  await concluirTentativa(sessao.orgId, reserva.tentativaId, true)

  const hash = await guardarSenha(materialDoPin(sessao.usuarioId, novo))
  await comoOrg(sessao.orgId, async (db) => {
    await db.usuario.update({ where: { id: sessao.usuarioId }, data: { pinHash: hash, pinDefinidoEm: new Date() } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: eu.pinHash ? 'conta.pin.trocou' : 'conta.pin.criou',
        alvoTipo: 'usuario',
        alvoId: sessao.usuarioId,
        alvoNome: sessao.nome,
      },
    })
  })
  return { ok: true }
}

/** Apaga o próprio PIN: daqui em diante ninguém autoriza nada com ele. */
export async function tirarMeuPin(sessao: Sessao): Promise<void> {
  await comoOrg(sessao.orgId, async (db) => {
    const r = await db.usuario.updateMany({
      where: { id: sessao.usuarioId, pinHash: { not: null } },
      data: { pinHash: null, pinDefinidoEm: null },
    })
    if (r.count === 0) return
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'conta.pin.tirou',
        alvoTipo: 'usuario',
        alvoId: sessao.usuarioId,
        alvoNome: sessao.nome,
      },
    })
  })
}
