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
        acessos: { select: { papel: true, unidadeId: true, expiraEm: true } },
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
      acessos: u.acessos.map((a) => ({ papel: a.papel as Papel, unidadeId: a.unidadeId, expiraEm: a.expiraEm })),
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
      },
    }),
  )

  return { ok: true, autorizador: { usuarioId: autorizador.id, nome: autorizador.nome } }
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
