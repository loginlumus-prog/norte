// "Sem acesso": a tela que diz POR QUE a tela pedida não abre.
//
// Antes, módulo desligado, cargo que não abre a tela, fechamento de caixa
// ainda aberto e carnê de venda sem carnê caíam todos no `notFound()` — a
// página "Este endereço não abre. Ou o link está errado…", sem o menu, como
// se o sistema tivesse quebrado. O link não estava errado: faltava ligar um
// módulo, ou fechar o caixa. Agora cada caso leva a `/<empresa>/sem-acesso`,
// dentro da moldura (com o menu), dizendo o motivo e o que fazer.
//
// O 404 continua para o que não existe de verdade: endereço desconhecido,
// venda de outra empresa, id inventado.
//
// O motivo viaja no endereço, mas a tela só mostra texto DESTA lista: quem
// edita o `?motivo=` não escreve nada na tela, só escolhe entre frases nossas.

import { redirect } from 'next/navigation'
import { MODULOS, type Modulo } from './modulos'

export type MotivoSemAcesso =
  | 'cargo'
  | 'caixa-aberto'
  | 'sem-carne'
  | 'sem-aluno'
  | `modulo-${Modulo}`

/** Leva à tela "sem acesso" com o motivo. `de` é a tela de onde veio (para o "Voltar"). */
export function semAcesso(slug: string, motivo: MotivoSemAcesso, de?: string): never {
  const q = new URLSearchParams({ motivo })
  if (de) q.set('de', de)
  redirect(`/${slug}/sem-acesso?${q.toString()}`)
}

export type TextoSemAcesso = {
  titulo: string
  texto: string
  /** O botão que resolve. Sem ele, só o "Voltar". */
  acao: { href: string; rotulo: string } | null
}

/**
 * A frase de cada motivo. `podeConfigurar`: quem liga módulo ganha o botão
 * para Configurações; quem não liga fica sabendo quem liga.
 */
export function textoSemAcesso(
  slug: string,
  motivo: string | undefined,
  podeConfigurar: boolean,
): TextoSemAcesso {
  if (motivo?.startsWith('modulo-')) {
    const m = motivo.slice('modulo-'.length)
    const nome = m in MODULOS ? MODULOS[m as Modulo].titulo : null
    if (nome) {
      return {
        titulo: `O módulo ${nome} está desligado`,
        texto: podeConfigurar
          ? `Esta tela é do módulo ${nome}, que não está ligado na empresa. Ligue em Configurações, em "O que sua empresa usa" — o que já foi lançado continua guardado.`
          : `Esta tela é do módulo ${nome}, que não está ligado na empresa. Quem responde pela empresa liga em Configurações.`,
        acao: podeConfigurar ? { href: `/${slug}/configuracoes`, rotulo: 'Abrir Configurações' } : null,
      }
    }
  }
  switch (motivo) {
    case 'caixa-aberto':
      return {
        titulo: 'Este caixa ainda está aberto',
        texto: 'O fechamento só sai depois que o caixa é fechado: é ele que diz quanto ficou na gaveta. Feche o caixa e volte aqui.',
        acao: { href: `/${slug}/caixa`, rotulo: 'Ir para o Caixa' },
      }
    case 'sem-carne':
      return {
        titulo: 'Esta venda não tem carnê',
        texto: 'O carnê existe só para venda no crediário, com cliente e parcelas. Esta foi paga de outro jeito — o comprovante é o papel dela.',
        acao: null,
      }
    case 'sem-aluno':
      return {
        titulo: 'Escolha de quem é o carnê',
        texto: 'O carnê sai da ficha de um aluno. Abra Mensalidades, escolha o aluno e toque em "Carnê".',
        acao: { href: `/${slug}/mensalidades`, rotulo: 'Abrir Mensalidades' },
      }
    case 'cargo':
    default:
      return {
        titulo: 'Seu acesso não abre esta tela',
        texto: 'O que cada pessoa vê depende do papel ou do cargo dela na empresa. Se você precisa desta tela, peça a quem cuida da equipe para mudar o seu acesso em Equipe.',
        acao: null,
      }
  }
}

/** O "Voltar" só aceita caminho desta empresa — nunca um endereço de fora vindo do `?de=`. */
export function voltarSeguro(slug: string, de: string | undefined): string {
  if (de && de.startsWith(`/${slug}/`) && /^[\w\-/]+$/.test(de) && !de.includes('//')) return de
  return `/${slug}`
}
