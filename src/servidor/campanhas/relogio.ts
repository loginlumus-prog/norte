// O relógio das campanhas: `tickCampanhas(agora)`, de minuto em minuto.
//
// A lista de empresas vem da portaria (id e slug, nada mais — o mesmo corte
// das rotinas do assistente: quem ligou o módulo e não está fora do ar).
// Todo o resto é lido empresa por empresa, dentro do `comoOrg` dela.

import { empresasComAgente } from '../assistente/portaria'
import { canalPara, temZapi } from '../assistente/canal'
import { assistenteFala, campanhasAptas, lerAgenteParaCampanha, lerOrgParaCampanha } from './acesso'
import { tickCampanhasCom, type Batida } from './execucao'

/**
 * A empresa pode ter o relógio das campanhas agora? O plano, o módulo e a
 * suspensão — E o assistente ligado com o WhatsApp conectado (ver
 * `assistenteFala`). Sem a segunda metade, a loja que desligou o assistente
 * continuava mandando o roteiro, e as respostas caíam numa porta fechada.
 */
export async function campanhasRodam(orgId: string): Promise<boolean> {
  if (!campanhasAptas(await lerOrgParaCampanha(orgId))) return false
  return assistenteFala(await lerAgenteParaCampanha(orgId))
}

export async function tickCampanhas(agora: Date = new Date()): Promise<Batida> {
  // Sem Z-API global no servidor (o laptop, a demonstração), quem não tem
  // linha própria roda no canal de mentira e fica no histórico — como nas
  // rotinas. Com Z-API global, empresa sem linha de verdade fica de fora: ela
  // falaria pelo número de outra loja, ou por lugar nenhum fingindo que falou.
  const semWhatsappNoServidor = !temZapi()
  return tickCampanhasCom(agora, {
    empresas: empresasComAgente,
    apta: campanhasRodam,
    canalDe: async (org) => {
      const canal = await canalPara(org)
      return canal.real || semWhatsappNoServidor ? canal : null
    },
  })
}
