// O título da aba e o "instalar como app" de cada empresa.
//
// Antes, toda aba dizia "Norte". Quem trabalha com Vendas, Estoque e Caixa
// abertos lado a lado — e é assim que o dono trabalha — não sabia qual aba
// era qual, e o histórico do navegador era uma lista de "Norte" iguais.
// Agora: "Vendas · Comércio Exemplo · Norte".
//
// O nome da empresa vem da portaria (a mesma leitura de uma linha que toda
// tela já faz), guardada por requisição com `cache`: o layout e o painel
// perguntam, o banco responde uma vez.
//
// O que NÃO entra no título: nome de cliente, de produto, número de venda. O
// título vai para o histórico do navegador, para a barra de tarefas e para o
// print que alguém manda no grupo — e fica lá.

import { cache } from 'react'
import { acharOrgPorSlug } from './banco'

export const empresaDoEndereco = cache(async (slug: string) => {
  try {
    return await acharOrgPorSlug(slug)
  } catch {
    // Título é enfeite: banco fora não pode derrubar a tela por causa dele.
    // A tela em si vai dar o erro certo quando pedir o que precisa.
    return null
  }
})

/** "Vendas · Comércio Exemplo · Norte" — ou "Vendas · Norte" se a empresa não abre. */
export function montarTitulo(tela: string | null, empresa: string | null): string {
  return [tela, empresa, 'Norte'].filter(Boolean).join(' · ')
}
