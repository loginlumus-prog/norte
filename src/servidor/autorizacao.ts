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
// — 10 mil combinações —, e mesmo assim o PIN é de 4 a 6 (decisão do dono: é
// digitado a cada venda, e seis números no pico viram fila). Quem segura o
// chute é o freio, não o tamanho: cinco erros em 15 minutos por LOJA e cinco
// por QUEM PEDE (a mesma régua do login, em limite.ts), mais a recusa do PIN
// que todo mundo chuta primeiro (`problemaDoPin`). Por loja porque quem
// chuta não sabe de quem é o PIN que está tentando; por quem pede porque a loja é a conta de todos — e o acerto não
// zera a conta da loja: o PIN da gerente digitado certo no meio dos chutes
// liberaria mais cinco a cada vez.
//
// A recusa é UMA só para tudo que não seja a trava: PIN errado, PIN de quem
// não pode, e PIN igual de duas pessoas. Frase diferente para "duas pessoas
// usam esse PIN" contava que aquele número é o PIN de alguém. O PIN repetido
// é barrado na hora de criar (`definirMeuPin`).
//
// Cada autorização vai para o livro, no nome de quem AUTORIZOU, com o motivo
// e quem pediu.
//
// NÃO chame de dentro de `comoOrg`: esta função abre as próprias transações
// (o freio e o livro), e transação não aninha.

import { comoOrg, type BancoDaOrg } from './banco'
import { SELECT_ACESSO, acessosDoBanco } from './cargos'
import { exigir, exigirQueNaoSejaSuporte, pode, podeNoAlcance, type Capacidade, type Papel, type Sessao } from './permissao'
import { conferirSenha, guardarSenha, HASH_ISCA } from './senha'
import { concluirTentativa, desfazerTentativa, estaTravada, reservarTentativa } from './limite'
import { PIN_MIN, PIN_MAX, problemaDoPin } from './pin-regra'

export { PIN_MIN, PIN_MAX, problemaDoPin }

/**
 * O que faz de alguém "quem pode autorizar": qualquer uma destas, em alguma
 * loja. Quem tem uma delas cria o PIN com a senha de entrar (a tela esquecida
 * aberta não vira "criei um PIN na conta da gerente e me autorizei 40%"). Quem
 * não tem nenhuma — o balcão — cria só com o PIN, e o PIN dela serve para
 * assinar as PRÓPRIAS vendas: `autorizarComPin` só aceita o PIN de quem tem a
 * capacidade que o pedido exige, então o PIN dela nunca autoriza nada de ninguém.
 */
export const CAPACIDADES_DE_AUTORIZAR: readonly Capacidade[] = [
  'venda.desconto',
  'venda.cancelar',
  'crediario.cobrar',
  'financeiro.lancar',
  'equipe.gerir',
  'empresa.configurar',
]

/** Esta sessão pode autorizar exceção de alguém? */
export function podeAutorizar(sessao: Sessao, agora = new Date()): boolean {
  return CAPACIDADES_DE_AUTORIZAR.some((c) => pode(sessao, c, undefined, agora))
}

/** O que vai para o scrypt: o PIN amarrado à pessoa (e com o tamanho que `guardarSenha` exige). */
const materialDoPin = (usuarioId: string, pin: string) => `pin:${usuarioId}:${pin}`

/** A chave do freio: a loja (ou a empresa inteira, para o que não é de loja). */
const chaveDoFreio = (unidadeId: string | null) => `pin:${unidadeId ?? 'empresa'}`
/** E a de quem pede, na mesma loja: a vendedora que chuta trava a si mesma primeiro. */
const chaveDeQuemPede = (unidadeId: string | null, usuarioId: string) => `pin:${unidadeId ?? 'empresa'}:${usuarioId}`

/** A recusa de sempre. Igual para tudo, para não ensinar nada a quem chuta. */
const RECUSA_DO_PIN = 'O PIN não confere, ou é de quem não pode autorizar isto nesta loja.'

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
  // e já enxergam os erros uns dos outros (ver `reservarTentativa`). Duas
  // contas: a de quem pede e a da loja. Qualquer uma travada, para.
  const daPessoa = await reservarTentativa(p.orgId, chaveDeQuemPede(p.unidadeId, p.quemPediu.usuarioId), null)
  if (daPessoa.bloqueado) {
    return { ok: false, erro: `PIN errado muitas vezes. Espere ${daPessoa.esperarMin} min e tente de novo.` }
  }
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
    // As tentativas já nasceram erro (ver `reservarTentativa`): nada a fechar.
    // Dois que bateram (PIN repetido de antes da regra nova) cai na mesma
    // recusa: quem autoriza não fica sabendo que aquele número é de alguém.
    return { ok: false, erro: RECUSA_DO_PIN }
  }

  const autorizador = bateram[0]!
  // Quem pede, acertando, zera a própria conta. A da LOJA não: o acerto só
  // deixa de contar como erro, e os chutes de antes continuam valendo.
  await concluirTentativa(p.orgId, daPessoa.tentativaId, true)
  await desfazerTentativa(p.orgId, reserva.tentativaId)

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
// deixou, ver `soPelaEmpresa`). A venda tem a assinatura dela, à parte
// (`Org.pinEmTodaVenda`, lá embaixo): é outra pergunta — "quem vendeu?".
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
  const v = await conferirPinNovo(sessao, senhaAtual, pin)
  if (!v.ok) return { ok: false, erro: v.erro }
  await comoOrg(sessao.orgId, (db) => gravarPin(db, sessao, v.hash, v.tinhaPin, null))
  return { ok: true }
}

/**
 * Tudo o que decide se este PIN novo serve, ANTES de gravar: o formato, a
 * senha de entrar (no freio do login, por pessoa) e o PIN já usado por quem
 * divide loja. É o miolo de `definirMeuPin` e da criação na hora da venda
 * (ver `NovaVenda.assinatura.criarPin`): as duas têm a mesma proteção. Fora
 * de `comoOrg` (o freio abre as próprias transações). `etapa` diz à tela a
 * que passo voltar: o PIN ou a senha.
 */
export async function conferirPinNovo(
  sessao: Sessao,
  senhaAtual: string,
  pin: string,
  /** Na criação na hora da venda: quem não pode autorizar nada dispensa a senha. */
  opcoes: { dispensaSenhaDeQuemNaoAutoriza?: boolean } = {},
): Promise<{ ok: true; hash: string; tinhaPin: boolean } | { ok: false; erro: string; etapa: 'pin' | 'senha' }> {
  const novo = String(pin ?? '').trim()
  const problema = problemaDoPin(novo)
  if (problema) return { ok: false, erro: problema, etapa: 'pin' }

  const reserva = await reservarTentativa(sessao.orgId, `pin-conta:${sessao.usuarioId}`, null)
  if (reserva.bloqueado) {
    return { ok: false, erro: `Tentativas erradas muitas vezes. Espere ${reserva.esperarMin} min e tente de novo.`, etapa: 'senha' }
  }
  const eu = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { senhaHash: true, pinHash: true } }),
  )
  // Sem a senha só para quem não autoriza ninguém. O freio acima conta do mesmo
  // jeito: sem a senha de barreira, é ele que segura quem testa PINs alheios.
  const semSenha = opcoes.dispensaSenhaDeQuemNaoAutoriza === true && !podeAutorizar(sessao)
  if (!semSenha) {
    const certa = await conferirSenha(String(senhaAtual ?? ''), eu?.senhaHash ?? HASH_ISCA)
    if (!eu?.senhaHash || !certa) return { ok: false, erro: 'A senha de entrar não confere.', etapa: 'senha' }
  }

  // O mesmo PIN de outra pessoa que alcança alguma loja desta: no balcão, os
  // dois batem e ninguém autoriza nada. Barrado aqui, com uma frase que não
  // diz de quem — e a tentativa fica contada como erro (o freio desta tela),
  // para isto não virar o jeito de testar PINs alheios.
  if (await pinJaUsado(sessao.orgId, sessao.usuarioId, sessao.acessos, novo)) {
    return { ok: false, erro: 'Esse PIN não pode ser usado. Escolha outro.', etapa: 'pin' }
  }
  await concluirTentativa(sessao.orgId, reserva.tentativaId, true)

  return { ok: true, hash: await guardarSenha(materialDoPin(sessao.usuarioId, novo)), tinhaPin: !!eu?.pinHash }
}

/**
 * Grava o PIN e o livro, dentro da transação de quem chamou. `motivo`: o
 * porquê, quando não é a pessoa em Minha conta ("criado na hora, ao registrar
 * a venda").
 */
export async function gravarPin(
  db: BancoDaOrg,
  sessao: Sessao,
  hash: string,
  tinhaPin: boolean,
  motivo: string | null,
): Promise<void> {
  await db.usuario.update({ where: { id: sessao.usuarioId }, data: { pinHash: hash, pinDefinidoEm: new Date() } })
  await db.auditoria.create({
    data: {
      orgId: sessao.orgId,
      usuarioId: sessao.usuarioId,
      quem: sessao.nome,
      acao: tinhaPin ? 'conta.pin.trocou' : 'conta.pin.criou',
      alvoTipo: 'usuario',
      alvoId: sessao.usuarioId,
      alvoNome: sessao.nome,
      ...(motivo ? { motivo } : {}),
    },
  })
}

/**
 * Alguém mais, que divide loja com esta pessoa (ou alcança a empresa
 * inteira), já usa este PIN? Confere um a um (scrypt: lento de propósito) —
 * é raro, só ao criar ou trocar o PIN, e a equipe de uma loja é pequena.
 */
async function pinJaUsado(
  orgId: string,
  /** Quem está criando (fica de fora da conta); nulo para quem ainda nem tem conta (o convite). */
  usuarioId: string | null,
  acessos: readonly { unidadeId: string | null; expiraEm?: Date | null }[],
  pin: string,
): Promise<boolean> {
  const gente = await comoOrg(orgId, (db) =>
    db.usuario.findMany({
      where: { ativo: true, pinHash: { not: null }, ...(usuarioId ? { id: { not: usuarioId } } : {}) },
      select: { id: true, pinHash: true, acessos: { select: { unidadeId: true, expiraEm: true } } },
    }),
  )
  const agora = new Date()
  const lojasDe = (acessos: { unidadeId: string | null; expiraEm: Date | null }[]) => {
    const vivos = acessos.filter((a) => !a.expiraEm || a.expiraEm > agora)
    return vivos.some((a) => a.unidadeId === null) ? 'todas' : new Set(vivos.map((a) => a.unidadeId!))
  }
  const minhas = lojasDe(acessos.map((a) => ({ unidadeId: a.unidadeId, expiraEm: a.expiraEm ?? null })))
  for (const u of gente) {
    const delas = lojasDe(u.acessos)
    const dividem =
      minhas === 'todas' || delas === 'todas' ? true : [...minhas].some((id) => delas.has(id))
    if (dividem && (await conferirSenha(materialDoPin(u.id, pin), u.pinHash!))) return true
  }
  return false
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

// ─────────────────────────────────────────────────────────────
// ASSINAR A VENDA (Org.pinEmTodaVenda)
// ─────────────────────────────────────────────────────────────
//
// ── para que serve ───────────────────────────────────────────
// O PIN no fim da venda é a CONFIRMAÇÃO: nada é gravado antes dele, então o
// toque sem querer em "Concluir" não vira venda. E é a ASSINATURA: no balcão
// dividido (o tablet que fica logado o dia todo numa conta só), quem vendeu
// digita o PIN DELA e a venda vai para o nome dela — meta e comissão certas,
// e o livro sabe quem estava na frente da cliente.
//
// O PIN esperado é o da conta aberta (o caso comum: uma conferência só). Não
// sendo, vale o de qualquer pessoa ATIVA com `venda.criar` NESTA loja.
//
// ── o freio, em duas contas ──────────────────────────────────
// A do APARELHO (a conta aberta, nesta loja): cinco erros seguidos travam, e
// o acerto zera — quem errou o dedo e acertou em seguida não carrega nada.
// A da LOJA: mais folga (dez), porque soma o dedo de todos os caixas no pico,
// e o acerto NÃO zera (o PIN conhecido de alguém digitado entre os chutes
// liberaria mais dez). Contas separadas das do autorizar: o erro de dedo de
// quem vende não pode travar o desconto da gerente.
//
// ── ninguém fica preso ───────────────────────────────────────
// - Quem está na conta aberta e ainda não criou o PIN CRIA na hora, na própria
//   janela do balcão (`assinatura.criarPin` em venda.ts): o PIN e a senha de
//   entrar vão na mesma chamada que grava a venda, e o livro marca "PIN criado
//   na hora". O PIN é a assinatura de quem vendeu — sem ele a venda não grava.
//   Fora do balcão o sistema segue normal: só o registrar da venda pede.
// - Freio travado: a venda pode ir no nome da conta aberta, marcada para
//   conferir. Só quando a trava é de verdade (`pinTravadoNaVenda`) — quem
//   trava de propósito não ganha nada com isso: a venda não vai para o nome
//   de ninguém além da conta aberta, e o livro marca.
// - Sem internet: ver `NovaVenda.assinatura` em venda.ts.

/** Erros que a conta da LOJA aguenta em 15 minutos, no PIN de assinar a venda. */
export const MAX_PIN_VENDA_LOJA = 10
const chaveVendaLoja = (unidadeId: string) => `pin-venda:${unidadeId}`
const chaveVendaAparelho = (unidadeId: string, usuarioId: string) => `pin-venda:${unidadeId}:${usuarioId}`

/** A empresa pede o PIN de quem vendeu em toda venda? */
export async function pedePinNaVenda(orgId: string): Promise<boolean> {
  const o = await comoOrg(orgId, (db) => db.org.findUnique({ where: { id: orgId }, select: { pinEmTodaVenda: true } }))
  return o?.pinEmTodaVenda === true
}

/** Esta pessoa já criou o PIN? */
export async function temPin(orgId: string, usuarioId: string): Promise<boolean> {
  const u = await comoOrg(orgId, (db) => db.usuario.findUnique({ where: { id: usuarioId }, select: { pinHash: true } }))
  return !!u?.pinHash
}

export type QuemVendeu =
  | { ok: true; vendedor: { usuarioId: string; nome: string } }
  | { ok: false; erro: string; travado?: true }

/**
 * Confere o PIN digitado no fim da venda e devolve QUEM vendeu.
 *
 * Primeiro o da conta aberta; depois o das outras pessoas que vendem nesta
 * loja. Duas que batem (PIN repetido de antes da regra) não assinam: a frase
 * é a mesma do PIN errado, para não contar que aquele número é de alguém.
 *
 * NÃO chame de dentro de `comoOrg`: o freio abre as próprias transações.
 */
export async function identificarQuemVendeu(p: { sessao: Sessao; unidadeId: string; pin: string }): Promise<QuemVendeu> {
  const { sessao, unidadeId } = p
  const pin = String(p.pin ?? '').trim()
  // Formato errado não gasta tentativa: é dedo, não chute.
  if (!/^\d+$/.test(pin) || pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return { ok: false, erro: `Digite o PIN (de ${PIN_MIN} a ${PIN_MAX} números).` }
  }

  const doAparelho = await reservarTentativa(sessao.orgId, chaveVendaAparelho(unidadeId, sessao.usuarioId), null)
  if (doAparelho.bloqueado) {
    return { ok: false, travado: true, erro: `PIN errado muitas vezes neste aparelho. Espere ${doAparelho.esperarMin} min e tente de novo.` }
  }
  const daLoja = await reservarTentativa(sessao.orgId, chaveVendaLoja(unidadeId), null, MAX_PIN_VENDA_LOJA)
  if (daLoja.bloqueado) {
    return { ok: false, travado: true, erro: `PIN errado muitas vezes nesta loja. Espere ${daLoja.esperarMin} min e tente de novo.` }
  }

  // Duas leituras, uma depois da outra: quem tem PIN, e os acessos dessas
  // pessoas (a relação "para muitos" na mesma leitura rodaria em paralelo).
  const gente = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findMany({ where: { ativo: true, pinHash: { not: null } }, select: { id: true, nome: true, pinHash: true } }),
  )
  const acessos = gente.length
    ? await comoOrg(sessao.orgId, (db) =>
        db.acesso.findMany({ where: { usuarioId: { in: gente.map((u) => u.id) } }, select: { usuarioId: true, ...SELECT_ACESSO } }),
      )
    : []
  const agora = new Date()
  const candidatas = gente.filter((u) =>
    pode(
      { orgId: sessao.orgId, usuarioId: u.id, nome: u.nome, acessos: acessosDoBanco(acessos.filter((a) => a.usuarioId === u.id)) },
      'venda.criar',
      unidadeId,
      agora,
    ),
  )
  // A conta aberta primeiro: é o caso de quase toda venda, e aí basta uma conferência.
  candidatas.sort((a, b) => (a.id === sessao.usuarioId ? -1 : b.id === sessao.usuarioId ? 1 : 0))

  const bateram: { id: string; nome: string }[] = []
  for (const u of candidatas) {
    if (await conferirSenha(materialDoPin(u.id, pin), u.pinHash!)) {
      bateram.push({ id: u.id, nome: u.nome })
      // O da conta aberta bateu: é ela, sem conferir o resto.
      if (u.id === sessao.usuarioId) break
    }
  }
  if (candidatas.length === 0) await conferirSenha(materialDoPin('ninguem', pin), HASH_ISCA)

  const achada = bateram[0]?.id === sessao.usuarioId ? bateram[0] : bateram.length === 1 ? bateram[0] : null
  if (!achada) {
    // As duas tentativas já nasceram erro (ver `reservarTentativa`).
    return { ok: false, erro: 'O PIN não confere com ninguém que vende nesta loja. Confira e digite de novo.' }
  }
  // O aparelho zera; a loja só deixa de contar este como erro.
  await concluirTentativa(sessao.orgId, doAparelho.tentativaId, true)
  await desfazerTentativa(sessao.orgId, daLoja.tentativaId)
  return { ok: true, vendedor: { usuarioId: achada.id, nome: achada.nome } }
}

/** O freio do PIN de assinar está travado agora, neste aparelho ou nesta loja? Só olha. */
export async function pinTravadoNaVenda(sessao: Sessao, unidadeId: string): Promise<boolean> {
  return (
    (await estaTravada(sessao.orgId, chaveVendaAparelho(unidadeId, sessao.usuarioId))) ||
    (await estaTravada(sessao.orgId, chaveVendaLoja(unidadeId), MAX_PIN_VENDA_LOJA))
  )
}

/**
 * Liga ou desliga "Pedir o PIN de quem vendeu em toda venda". Nasce ligado e
 * liga sempre, mesmo com gente sem PIN: ninguém fica preso (quem não tem cria
 * o dele na hora de registrar, e a tela de Equipe mostra quem falta).
 * Desligado, a venda é a de antes.
 */
export async function mudarPinNaVenda(sessao: Sessao, ligar: boolean): Promise<void> {
  exigir(sessao, 'empresa.configurar')
  exigirQueNaoSejaSuporte(sessao, 'muda as regras do PIN')
  await comoOrg(sessao.orgId, async (db) => {
    const antes = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { pinEmTodaVenda: true } })
    if (antes.pinEmTodaVenda === ligar) return
    await db.org.update({ where: { id: sessao.orgId }, data: { pinEmTodaVenda: ligar } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'empresa.assinaturas',
        alvoTipo: 'empresa',
        alvoId: sessao.orgId,
        antes: { pinEmTodaVenda: antes.pinEmTodaVenda },
        depois: { pinEmTodaVenda: ligar },
      },
    })
  })
}

// ─────────────────────────────────────────────────────────────
// O PIN CRIADO NO CONVITE
// ─────────────────────────────────────────────────────────────

/**
 * O PIN escolhido no convite serve? Antes de a conta nascer: o formato (o que
 * todo mundo chuta) e o PIN repetido de alguém da mesma loja. Com freio por
 * convite — senão o formulário do convite virava o lugar de testar PINs
 * alheios ("esse não pode" = é de alguém).
 */
export async function pinDoConviteServe(
  orgId: string,
  chaveDoConvite: string,
  unidadeId: string | null,
  pin: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const problema = problemaDoPin(pin)
  if (problema) return { ok: false, erro: problema }
  const reserva = await reservarTentativa(orgId, `pin-convite:${chaveDoConvite}`, null)
  if (reserva.bloqueado) return { ok: false, erro: `Muitas tentativas. Espere ${reserva.esperarMin} min e tente de novo.` }
  if (await pinJaUsado(orgId, null, [{ unidadeId, expiraEm: null }], pin)) {
    return { ok: false, erro: 'Esse PIN não pode ser usado. Escolha outro.' }
  }
  await concluirTentativa(orgId, reserva.tentativaId, true)
  return { ok: true }
}

/** Grava o PIN de quem acabou de aceitar o convite (já conferido em `pinDoConviteServe`). */
export async function gravarPinDoConvite(orgId: string, usuarioId: string, nome: string, pin: string): Promise<void> {
  const hash = await guardarSenha(materialDoPin(usuarioId, pin))
  await comoOrg(orgId, async (db) => {
    await db.usuario.update({ where: { id: usuarioId }, data: { pinHash: hash, pinDefinidoEm: new Date() } })
    await db.auditoria.create({
      data: { orgId, usuarioId, quem: nome, acao: 'conta.pin.criou', alvoTipo: 'usuario', alvoId: usuarioId, alvoNome: nome },
    })
  })
}
