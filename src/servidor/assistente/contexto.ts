// O que o laço da conversa e as rotinas precisam saber da empresa — e as
// duas portas por onde o assistente gasta: mensagem enviada e IA consumida.
//
// Cada função abre o SEU `comoOrg` e fecha. Nenhuma é chamada de dentro de
// outro `comoOrg` (trava o pool, ver banco.ts), e nenhuma dispara consultas
// em paralelo dentro da transação (o pg avisa e quebra no pg@9).

import type { Agente, Plano, Situacao } from '@prisma/client'
import { comoOrg } from '../banco'
import { planoLibera } from '../planos'
import { moduloLigado } from '../modulos'
import { unidadesQuePodem, type Acesso, type Capacidade, type Papel, type Sessao } from '../permissao'
import { custoEmCentavos, cobrancaEmCentavos, type Tokens } from '../custo-ia'
import { chaveTelefone, paraEnvio, soDigitos } from './telefone'
import type { Interlocutor, Loja } from './regras'
import type { Canal } from './canal'

// ─────────────────────────────────────────────────────────────
// A EMPRESA
// ─────────────────────────────────────────────────────────────

export type Contexto = {
  org: {
    id: string
    nome: string
    slug: string
    plano: Plano
    situacao: Situacao
    modulos: string[]
  }
  agente: Agente | null
  loja: Loja
}

export async function carregarContexto(orgId: string): Promise<Contexto | null> {
  return comoOrg(orgId, async (db) => {
    const org = await db.org.findUnique({
      where: { id: orgId },
      select: { id: true, nome: true, slug: true, plano: true, situacao: true, modulos: true },
    })
    if (!org) return null
    const agente = await db.agente.findUnique({ where: { orgId } })
    const unidades = await db.unidade.findMany({
      where: { ativa: true, ehDeposito: false },
      orderBy: { criadaEm: 'asc' },
      select: { nome: true, endereco: true, bairro: true, cidade: true, horario: true, telefone: true },
    })
    return { org, agente, loja: { empresa: org.nome, unidades } }
  })
}

/**
 * A empresa pode ter o assistente trabalhando AGORA?
 *
 * As quatro condições são independentes e todas valem: o plano vende o
 * módulo, a empresa ligou o módulo, ela não está suspensa, e o agente existe
 * e está ligado. Qualquer uma falhando, ele fica calado — calado, e não
 * respondendo "não posso", porque quem manda mensagem para a loja não tem
 * nada a ver com a assinatura dela.
 */
export function empresaApta(c: Contexto): c is Contexto & { agente: Agente } {
  if (!c.agente || !c.agente.ativo) return false
  if (c.org.situacao === 'SUSPENSA' || c.org.situacao === 'CANCELADA') return false
  if (!planoLibera(c.org.plano, 'agente')) return false
  if (!moduloLigado(c.org, 'agente')) return false
  return true
}

// ─────────────────────────────────────────────────────────────
// QUEM É QUEM
// ─────────────────────────────────────────────────────────────

/**
 * A sessão de uma pessoa, montada do banco — os papéis que ela tem AGORA.
 *
 * É com ela que o assistente lê, quando fala com alguém da equipe ou manda
 * o relatório para o dono. Nunca uma sessão inventada com "todas as
 * capacidades": o assistente enxerga o que a pessoa do outro lado enxergaria
 * na tela, nem uma linha a mais.
 */
export async function sessaoDoUsuario(orgId: string, usuarioId: string): Promise<Sessao | null> {
  const u = await comoOrg(orgId, (db) =>
    db.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        id: true,
        nome: true,
        ativo: true,
        acessos: { select: { papel: true, unidadeId: true, expiraEm: true } },
      },
    }),
  )
  if (!u || !u.ativo) return null
  return { orgId, usuarioId: u.id, nome: u.nome, acessos: u.acessos as Acesso[] }
}

/**
 * Dono × cliente, pelo telefone.
 *
 * Equipe é USUÁRIO ATIVO com o telefone cadastrado batendo. O acesso de
 * SUPORTE (nosso) não conta como equipe da loja — ele não conversa com o
 * assistente pelo WhatsApp de ninguém. E não existe o caminho "a pessoa diz
 * que é o dono": o que ela escreve não entra nesta decisão.
 */
export async function acharInterlocutor(
  orgId: string,
  telefone: string,
  nomeNoWhats: string | null,
): Promise<{ quem: Interlocutor; clienteId: string | null }> {
  const chave = chaveTelefone(telefone)
  if (!chave) return { quem: { tipo: 'cliente', nome: nomeNoWhats }, clienteId: null }
  const final = chave.slice(-8)

  const achados = await comoOrg(orgId, async (db) => {
    const usuarios = await db.usuario.findMany({
      where: { ativo: true, telefone: { not: null } },
      select: { id: true, telefone: true },
    })
    // O filtro grosso no banco (termina com os 8 dígitos), o fino aqui.
    const clientes = await db.$queryRaw<{ id: string; nome: string; telefone: string }[]>`
      select id, nome, telefone from clientes
       where ativo and telefone is not null
         and regexp_replace(telefone, '\\D', '', 'g') like ${'%' + final}
       limit 20
    `
    return { usuarios, clientes }
  })

  // Dois usuários com o mesmo telefone é cadastro errado, e escolher um deles
  // seria escolher QUAIS poderes a mensagem ganha. Na dúvida, é cliente: o
  // erro que resulta é "ele não me mostrou o faturamento", que aparece na
  // hora e se conserta na tela Equipe — o contrário não aparece nunca.
  const usuarios = achados.usuarios.filter((u) => chaveTelefone(u.telefone) === chave)
  if (usuarios.length > 1) console.warn(`[assistente] ${orgId}: telefone repetido em ${usuarios.length} usuários`)
  const usuario = usuarios.length === 1 ? usuarios[0] : undefined
  if (usuario) {
    const sessao = await sessaoDoUsuario(orgId, usuario.id)
    const soSuporte = sessao?.acessos.every((a) => a.papel === 'SUPORTE') ?? true
    if (sessao && !soSuporte) {
      return { quem: { tipo: 'equipe', sessao, nome: sessao.nome }, clienteId: null }
    }
  }

  const cliente = achados.clientes.find((c) => chaveTelefone(c.telefone) === chave)
  return {
    quem: { tipo: 'cliente', nome: cliente?.nome ?? nomeNoWhats },
    clienteId: cliente?.id ?? null,
  }
}

export type Destinatario = { usuarioId: string; nome: string; telefone: string; sessao: Sessao }

/**
 * Quem recebe relatório e aviso: os DONOS ativos com telefone.
 *
 * Só o dono, e não o gerente, nesta etapa: relatório leva faturamento da
 * empresa inteira, e o gerente da loja 3 não vê a loja 5 (ver permissao.ts).
 * Mandar a cada um só o recorte dele é o próximo passo.
 */
export async function donosComTelefone(orgId: string): Promise<Destinatario[]> {
  const donos = await comoOrg(orgId, (db) =>
    db.usuario.findMany({
      where: {
        ativo: true,
        telefone: { not: null },
        acessos: { some: { papel: 'DONO' as Papel } },
      },
      orderBy: { criadoEm: 'asc' },
      select: { id: true },
    }),
  )
  const saida: Destinatario[] = []
  for (const d of donos) {
    const sessao = await sessaoDoUsuario(orgId, d.id)
    const u = await comoOrg(orgId, (db) =>
      db.usuario.findUnique({ where: { id: d.id }, select: { telefone: true } }),
    )
    if (sessao && u?.telefone && chaveTelefone(u.telefone)) {
      saida.push({ usuarioId: d.id, nome: sessao.nome, telefone: paraEnvio(u.telefone) ?? soDigitos(u.telefone), sessao })
    }
  }
  return saida
}

/** As unidades (ativas) em que a pessoa pode aquela capacidade. */
export async function unidadesVisiveis(sessao: Sessao, cap: Capacidade): Promise<string[]> {
  const quais = unidadesQuePodem(sessao, cap)
  if (quais !== 'todas' && quais.length === 0) return []
  const ativas = await comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({ where: { ativa: true }, select: { id: true } }),
  )
  return ativas.map((u) => u.id).filter((id) => quais === 'todas' || quais.includes(id))
}

// ─────────────────────────────────────────────────────────────
// A CONVERSA NO BANCO
// ─────────────────────────────────────────────────────────────

/**
 * A conversa com este telefone: acha ou cria.
 *
 * A mesma pessoa chega por dois caminhos com o número escrito diferente: o
 * WhatsApp manda "5571999990001" (ou sem o nono dígito), o cadastro da equipe
 * tem "(71) 99999-0001", e a rotina das 8h sai do cadastro. Se a chave fosse o
 * texto, a dona teria duas conversas — e o assistente não lembraria, às 8h05,
 * do relatório que ele mesmo mandou às 8h. Por isso a busca é pela chave do
 * telefone, e o que se grava é o formato de envio (55 + DDD + número).
 */
export async function abrirConversa(
  orgId: string,
  agenteId: string,
  telefone: string,
  dados: { nome?: string | null; daEquipe: boolean; clienteId?: string | null },
) {
  const chave = chaveTelefone(telefone)
  const candidatas = chave
    ? await comoOrg(orgId, (db) =>
        db.conversaAgente.findMany({
          where: { agenteId, telefone: { endsWith: chave.slice(-8) } },
          select: { telefone: true },
        }),
      )
    : []
  const tel =
    candidatas.find((c) => chaveTelefone(c.telefone) === chave)?.telefone ??
    paraEnvio(telefone) ??
    soDigitos(telefone)
  return comoOrg(orgId, (db) =>
    db.conversaAgente.upsert({
      where: { agenteId_telefone: { agenteId, telefone: tel } },
      create: {
        orgId,
        agenteId,
        telefone: tel,
        nome: dados.nome ?? null,
        daEquipe: dados.daEquipe,
        clienteId: dados.clienteId ?? null,
      },
      // Equipe ou não é decidido A CADA mensagem: quem saiu da empresa ontem
      // continua com a conversa, e hoje ela é conversa de cliente.
      update: {
        daEquipe: dados.daEquipe,
        ...(dados.nome ? { nome: dados.nome } : {}),
        ...(dados.clienteId ? { clienteId: dados.clienteId } : {}),
        ultimaEm: new Date(),
      },
    }),
  )
}

/** 00:00 de hoje no relógio do servidor (TZ=America/Sao_Paulo no Render). */
const inicioDoDia = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * O teto de mensagens do dia.
 *
 * Conta tudo o que ELE mandou hoje, para todo mundo — resposta, relatório,
 * aviso. O motivo é o mesmo do teto de gasto: um defeito que faça o agente
 * conversar com outro robô em laço manda mil mensagens numa madrugada, e o
 * número da loja é banido pelo WhatsApp antes de alguém acordar.
 */
export async function mensagensEnviadasHoje(orgId: string): Promise<number> {
  return comoOrg(orgId, (db) =>
    db.mensagemAgente.count({ where: { de: 'AGENTE', criadaEm: { gte: inicioDoDia() } } }),
  )
}

export type Saida = { enviada: boolean; motivo?: 'teto_mensagens' | 'canal' | 'sem_numero' }

/**
 * A única porta de saída: confere o teto, manda pelo canal e grava.
 *
 * Grava DEPOIS de mandar, e só se saiu: o histórico é o que o assistente
 * "lembra" na próxima mensagem, e lembrar de ter dito o que não chegou faz
 * ele continuar uma conversa que a pessoa nunca viu.
 */
export async function enviarEGravar(
  canal: Canal,
  agente: Pick<Agente, 'id' | 'orgId' | 'mensagensDia'>,
  conversa: { id: string; telefone: string },
  texto: string,
): Promise<Saida> {
  const jaForam = await mensagensEnviadasHoje(agente.orgId)
  if (jaForam >= agente.mensagensDia) {
    console.warn(`[assistente] ${agente.orgId}: teto de ${agente.mensagensDia} mensagens/dia atingido`)
    return { enviada: false, motivo: 'teto_mensagens' }
  }

  const r = await canal.enviar(conversa.telefone, texto)
  if (!r.ok) return { enviada: false, motivo: 'canal' }

  await comoOrg(agente.orgId, async (db) => {
    await db.mensagemAgente.create({
      data: { orgId: agente.orgId, conversaId: conversa.id, de: 'AGENTE', texto },
    })
    await db.conversaAgente.update({ where: { id: conversa.id }, data: { ultimaEm: new Date() } })
  })
  return { enviada: true }
}

// ─────────────────────────────────────────────────────────────
// O CONSUMO DE IA
// ─────────────────────────────────────────────────────────────

/**
 * Registra a chamada e DESCONTA da carteira, na mesma transação.
 *
 * É o `registrarConsumo` de agente.ts com o detalhe do cache: lá entram só
 * entrada e saída, e o cache muda a conta por dez — leitura de cache custa um
 * décimo, gravação custa 1,25. Cobrar cache lido como entrada cheia seria
 * cobrar da loja dez vezes o que a gente pagou.
 *
 * A tabela ainda não tem colunas para os tokens de cache; `entradaTokens`
 * guarda a soma dos três, e o custo e a cobrança já saem da conta certa.
 */
export async function registrarConsumoIA(
  orgId: string,
  agenteId: string,
  modelo: string,
  t: Required<Tokens>,
) {
  const custoCent = custoEmCentavos(modelo, t)
  const cobradoCent = cobrancaEmCentavos(modelo, t)
  await comoOrg(orgId, async (db) => {
    await db.consumoIA.create({
      data: {
        orgId,
        agenteId,
        modelo,
        entradaTokens: t.entrada + t.cacheEscrita + t.cacheLeitura,
        saidaTokens: t.saida,
        custoCent,
        cobradoCent,
      },
    })
    await db.org.update({ where: { id: orgId }, data: { creditoIaCent: { decrement: cobradoCent } } })
  })
  return { custoCent, cobradoCent }
}
