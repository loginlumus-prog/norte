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
//                   (ou a pessoa pediu PARAR / VOLTAR e recebeu a confirmação)
//   tratou: false → não é assunto de campanha (ou a pessoa está com um humano)
//
// ── PARAR e VOLTAR vêm antes de tudo ─────────────────────────
// Antes de qualquer campanha, a lista de quem não recebe oferta (ver
// ../ofertas.ts): "PARAR" grava a saída para sempre e confirma UMA vez;
// "VOLTAR" (só de quem está na lista) tira dela e grava o aceite. Quem está
// na lista não entra em campanha nenhuma — nem mandando a palavra-chave: a
// mensagem fica para a loja responder, como qualquer outra.
//
// Vem antes até da conferência do plano: o pedido de saída vale mesmo que a
// loja tenha desligado as campanhas ontem e religue amanhã.

import type { Canal } from '../assistente/canal'
import { chaveTelefone, paraEnvio, soDigitos } from '../assistente/telefone'
import { comoOrg } from '../banco'
import { STATUS_VIVOS } from './tipos'
import { decidir, ehPedidoDeParada, lerGatilho } from './casar'
import { campanhasAptas, lerOrgParaCampanha } from './acesso'
import { andar, encerrarViva, iniciar } from './execucao'
import { humanoAteDoTelefone, humanoNoComando } from './humano'
import {
  RECADO_SAIU,
  RECADO_VOLTOU,
  ehParadaInequivoca,
  ehPedidoDeVolta,
  pararPeloWhatsapp,
  voltarPeloWhatsapp,
} from '../ofertas'

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
  const aptas = campanhasAptas(org)

  const lido = await comoOrg(e.orgId, async (db) => {
    const viva = await db.campanhaExecucao.findFirst({
      where: { telefone: chave, status: { in: [...STATUS_VIVOS] } },
      select: { id: true, campanhaId: true, status: true, teste: true, campanha: { select: { ativa: true } } },
    })
    const naLista =
      (await db.optOutWhatsapp.findUnique({ where: { orgId_telefone: { orgId: e.orgId, telefone: chave } }, select: { id: true } })) !== null
    // Sem campanha liberada, nem as campanhas nem as entradas interessam.
    const ativas = aptas
      ? await db.campanha.findMany({
          where: { ativa: true },
          select: { id: true, nome: true, gatilho: true },
          orderBy: { criadaEm: 'asc' },
        })
      : []
    const entradas = aptas
      ? await db.campanhaExecucao.groupBy({
          by: ['campanhaId'],
          where: { telefone: chave, teste: false },
          _max: { iniciadaEm: true },
        })
      : []
    return { viva, naLista, ativas, entradas }
  })

  // ── VOLTAR: só de quem está na lista ─────────────────────
  if (lido.naLista && ehPedidoDeVolta(texto)) {
    const { voltou } = await voltarPeloWhatsapp(e.orgId, chave, agora)
    if (voltou) await confirmar(e.canal, envio, RECADO_VOLTOU, e.orgId)
    return { tratou: voltou }
  }

  // ── PARAR ─────────────────────────────────────────────────
  if (ehPedidoDeParada(texto)) {
    // O teste do dono ("Testar com meu número"): "parar" só encerra o teste.
    // O número é da equipe, e não entra na lista de clientes que saíram.
    if (lido.viva?.teste) return { tratou: await encerrarViva(e.orgId, lido.viva.id, 'cancelada', 'parou', agora) }
    // Sem campanha no meio, só as palavras que não deixam dúvida (ver
    // PARADAS_INEQUIVOCAS): "cancelar" sozinho costuma ser sobre a encomenda.
    if (!lido.viva && !ehParadaInequivoca(texto)) return nao
    if (lido.viva) await encerrarViva(e.orgId, lido.viva.id, 'cancelada', 'parou', agora)
    const { novo } = await pararPeloWhatsapp(e.orgId, chave, agora)
    // UMA confirmação: quem manda "parar" três vezes recebe uma resposta, não três.
    if (novo) await confirmar(e.canal, envio, RECADO_SAIU, e.orgId)
    return { tratou: true }
  }

  // ── quem está na lista não entra em campanha ─────────────
  // Nem com a palavra-chave. A viva não deveria existir (entrar na lista
  // encerra a campanha), mas se uma corrida deixou uma, ela sai aqui.
  if (lido.naLista) {
    if (lido.viva && !lido.viva.teste) await encerrarViva(e.orgId, lido.viva.id, 'cancelada', 'sem_ofertas', agora)
    return nao
  }

  if (!aptas) return nao

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
      // Não chega aqui: o pedido de parada é tratado lá em cima, antes da
      // decisão, porque ele grava a saída para sempre. Fica por segurança.
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
 * A confirmação do PARAR / VOLTAR. É resposta a uma mensagem que a pessoa
 * acabou de mandar — dentro da janela de 24 horas, texto livre. Falhou o
 * envio: a saída (ou a volta) JÁ está gravada, e é isso que importa; o log
 * diz que a frase não saiu.
 */
async function confirmar(canal: Canal, envio: string, texto: string, orgId: string) {
  const r = await canal.enviar(envio, texto).catch(() => ({ ok: false as const, motivo: 'erro' }))
  if (!r.ok) console.warn(`[campanhas] ${orgId}: a confirmação de PARAR/VOLTAR não saiu (${r.motivo})`)
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
