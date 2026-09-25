// O bloco "Ofertas no WhatsApp" da ficha, montado no servidor.
//
// Os textos (a pergunta, o que "aceitou" quer dizer) e as frases do estado
// saem de src/servidor/ofertas.ts — um lugar só, com a versão do texto que
// vai para o livro. A ficha nova e a ficha de quem já existe usam o mesmo.

import type { ConsentimentoOfertas } from '@prisma/client'
import { colunaDoDia, diaEmSP, mostrarDiaDaColuna } from '@/servidor/dia'
import {
  ORIGENS_ACEITE,
  ORIGENS_SAIDA,
  SO_A_PESSOA_TIRA,
  ehOrigemAceite,
  perguntaDoAceite,
  situacaoDoNumero,
  textoDoAceite,
} from '@/servidor/ofertas'
import type { Sessao } from '@/servidor/permissao'
import type { OfertasNaTela } from './Editor'

const dia = (d: Date) => mostrarDiaDaColuna(colunaDoDia(diaEmSP(d)), 'longo')

export async function ofertasNaTela(
  sessao: Sessao,
  loja: string,
  cliente?: {
    telefone: string | null
    ofertasWhatsapp: ConsentimentoOfertas
    ofertasEm: Date | null
    ofertasOrigem: string | null
    ofertasPor: string | null
  },
): Promise<OfertasNaTela> {
  const atual = cliente?.ofertasWhatsapp ?? 'NAO_PERGUNTADO'
  let resumo: string | null = null
  if (cliente && atual !== 'NAO_PERGUNTADO') {
    const como = ehOrigemAceite(cliente.ofertasOrigem) ? `, ${ORIGENS_ACEITE[cliente.ofertasOrigem]}` : ''
    const quando = cliente.ofertasEm ? ` em ${dia(cliente.ofertasEm)}` : ''
    const quem = cliente.ofertasPor ? ` Anotado por ${cliente.ofertasPor}.` : ''
    resumo = `${atual === 'SIM' ? 'Aceitou' : 'Não aceitou'}${quando}${como}.${quem}`
  }

  let lista: OfertasNaTela['lista'] = null
  if (cliente?.telefone) {
    const s = await situacaoDoNumero(sessao, cliente.telefone)
    if (s.valido && s.naLista) {
      lista = {
        frase: `Este número está na lista de quem não recebe ofertas desde ${dia(s.em)} (${ORIGENS_SAIDA[s.origem] ?? s.origem}).`,
        soAPessoa: (SO_A_PESSOA_TIRA as readonly string[]).includes(s.origem),
      }
    }
  }

  return {
    atual,
    resumo,
    pergunta: perguntaDoAceite(loja),
    textoAceite: textoDoAceite(loja),
    origens: Object.entries(ORIGENS_ACEITE).map(([valor, titulo]) => ({ valor, titulo: titulo[0]!.toUpperCase() + titulo.slice(1) })),
    lista,
  }
}
