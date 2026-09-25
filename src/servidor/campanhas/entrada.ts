// A porta de entrada das campanhas: TODA mensagem de cliente passa por aqui.
//
// A decisão do dono, que este arquivo cumpre: com CLIENTE o assistente não
// conversa solto. A mensagem ou abre uma campanha (a frase, o anúncio), ou
// continua a campanha em que a pessoa já está, ou tira a pessoa dela
// ("parar"). Qualquer outra coisa é da loja — `tratou: false`, e quem chamou
// fica calado: uma pessoa da loja responde no próprio celular.
//
// Quem chama é o roteamento da conversa (assistente/conversa.ts), para cada
// mensagem de quem NÃO é da equipe. Nada aqui usa IA.
//
//   tratou: true  → a campanha começou, andou ou foi cancelada por esta mensagem
//   tratou: false → não é assunto de campanha (ou a pessoa está com um humano)

import type { Canal } from '../assistente/canal'
import { chaveTelefone, paraEnvio, soDigitos } from '../assistente/telefone'
import { comoOrg } from '../banco'
import { STATUS_VIVOS } from './tipos'
import { decidir, lerGatilho } from './casar'
import { campanhasAptas, lerOrgParaCampanha } from './acesso'
import { andar, encerrarViva, iniciar } from './execucao'
import { humanoAteDoTelefone, humanoNoComando } from './humano'

export type MensagemDeCliente = {
  orgId: string
  agenteId: string
  telefone: string
  nome: string | null
  texto: string
  anuncioId?: string | null
  canal: Canal
  agora?: Date
}

export async function receberDeCliente(e: {
  orgId: string
  agenteId: string
  telefone: string
  nome: string | null
  texto: string
  anuncioId?: string | null
  canal: Canal
  agora?: Date
}): Promise<{ tratou: boolean }> {
  const nao = { tratou: false }
  const agora = e.agora ?? new Date()
  const chave = chaveTelefone(e.telefone)
  if (!chave) return nao
  const envio = paraEnvio(e.telefone) ?? soDigitos(e.telefone)
  const texto = (e.texto ?? '').trim()
  const anuncioId = (e.anuncioId ?? '').trim() || null
  if (!texto && !anuncioId) return nao

  const org = await lerOrgParaCampanha(e.orgId)
  if (!campanhasAptas(org)) return nao

  const lido = await comoOrg(e.orgId, async (db) => {
    const viva = await db.campanhaExecucao.findFirst({
      where: { telefone: chave, status: { in: [...STATUS_VIVOS] } },
      select: { id: true, campanhaId: true, status: true, teste: true, campanha: { select: { ativa: true } } },
    })
    const ativas = await db.campanha.findMany({
      where: { ativa: true },
      select: { id: true, nome: true, gatilho: true },
      orderBy: { criadaEm: 'asc' },
    })
    const entradas = await db.campanhaExecucao.groupBy({
      by: ['campanhaId'],
      where: { telefone: chave, teste: false },
      _max: { iniciadaEm: true },
    })
    return { viva, ativas, entradas }
  })

  // Alguém da loja está conversando com a pessoa (escreveu pelo celular, ou
  // uma campanha passou para ela): nenhuma campanha começa, e a que estava
  // viva sai — uma pessoa conversando manda mais do que o roteiro. O estado é
  // o `humanoAte` da conversa, o mesmo que cala o recado automático.
  if (humanoNoComando(await humanoAteDoTelefone(e.orgId, chave), agora) && !lido.viva?.teste) {
    if (lido.viva) await encerrarViva(e.orgId, lido.viva.id, 'cancelada', 'humano_assumiu', agora)
    return nao
  }

  const ultima = new Map(lido.entradas.map((x) => [x.campanhaId, x._max.iniciadaEm ?? null]))
  const d = decidir({
    texto,
    anuncioId,
    viva: lido.viva,
    ativas: lido.ativas.map((c) => ({ id: c.id, nome: c.nome, gatilho: lerGatilho(c.gatilho) })),
    ultimaEntrada: (id) => ultima.get(id) ?? null,
    agora,
  })
  const ctx = { canal: e.canal, agora: e.agora }
  const contato = { chave, envio, nome: e.nome?.trim() || null }

  switch (d.acao) {
    case 'ignorar':
      return nao

    case 'cancelar':
      // Pediu para parar: sai, e nada mais é enviado — nem "tudo bem".
      return { tratou: await encerrarViva(e.orgId, d.execucaoId, 'cancelada', 'parou', agora) }

    case 'responder': {
      // Campanha pausada: a pessoa está parada lá dentro, e a mensagem é da loja.
      if (!lido.viva?.campanha.ativa && !lido.viva?.teste) return nao
      await comoOrg(e.orgId, (db) =>
        db.campanhaExecucao.updateMany({ where: { id: d.execucaoId }, data: { ultimaEntradaEm: agora } }),
      )
      const r = await andar(e.orgId, d.execucaoId, { tipo: 'resposta', texto }, ctx)
      return { tratou: !!r?.andou }
    }

    case 'trocar':
      await encerrarViva(e.orgId, d.execucaoId, 'cancelada', 'outro_fluxo', agora)
      return { tratou: (await iniciar(e.orgId, d.campanhaId, contato, { teste: false, ultimaEntradaEm: agora }, ctx)) !== null }

    case 'iniciar':
      return { tratou: (await iniciar(e.orgId, d.campanhaId, contato, { teste: false, ultimaEntradaEm: agora }, ctx)) !== null }
  }
}

/**
 * Este telefone está num TESTE de campanha agora?
 *
 * O teste roda no número de quem testa — o dono, que é EQUIPE. O roteamento
 * manda mensagem de equipe para o assistente, e a resposta do dono ao
 * "Esperar resposta" do teste nunca chegaria aqui. Com isto o roteamento
 * pode perguntar antes e entregar a mensagem a `receberDeCliente`.
 */
export async function testeVivo(orgId: string, telefone: string): Promise<boolean> {
  const chave = chaveTelefone(telefone)
  if (!chave) return false
  const viva = await comoOrg(orgId, (db) =>
    db.campanhaExecucao.findFirst({ where: { telefone: chave, teste: true, status: { in: [...STATUS_VIVOS] } }, select: { id: true } }),
  )
  return viva !== null
}
