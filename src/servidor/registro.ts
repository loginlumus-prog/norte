// O registro de erro do servidor: uma linha por falha, em JSON, sem dado
// pessoal, com um código que a pessoa na tela consegue ditar ao suporte.
//
// ── por que não `console.error('[acao]', e)` ─────────────────
// O erro inteiro do Prisma é um relatório da consulta. O de validação
// (`PrismaClientValidationError`) imprime os ARGUMENTOS com os valores:
// `data: { nome: "Rosa Lima", telefone: "71999998888" }`. Logar o objeto
// inteiro manda nome e telefone do cliente para o painel da hospedagem, onde
// fica por semanas, fora do alcance do pedido de exclusão (LGPD) — o
// anonimizar apaga a ficha, não o log.
//
// Então o que vai para o log é o RESUMO: nome do erro, código do Prisma, a
// primeira e a última linha da mensagem (é onde o Prisma diz o QUÊ falhou —
// "Invalid `prisma.cliente.create()` invocation" … "Argument `nome` is
// missing") e, mesmo nelas, e-mail, sequência longa de dígitos e texto entre
// aspas viram marcador.
//
// ── o código ─────────────────────────────────────────────────
// A tela de erro (src/app/error.tsx) mostra o `digest` do Next, e o
// `onRequestError` (src/instrumentation.ts) grava o mesmo digest no log. Mas
// erro de ação que a própria ação trata (`recadoDoErro`) não chega lá: vira
// frase na tela. Para ele, o código é sorteado aqui, vai para o log e volta
// para a frase. É o mesmo fio: a pessoa dita, o suporte procura.

import { randomBytes } from 'node:crypto'

/** Tira do texto o que pode ser dado pessoal: e-mail, telefone/CPF, texto entre aspas. */
export function mascarar(texto: string): string {
  return (
    texto
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
      // Oito ou mais dígitos, com ou sem pontuação no meio: telefone, CPF,
      // CNPJ, cartão. Id do sistema (cuid) tem letra, não cai aqui.
      .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[número]' : m))
      // O que está entre aspas numa mensagem de erro é VALOR vindo de fora.
      // Nome de campo e de modelo o Prisma escreve entre crases, e esses ficam.
      .replace(/"[^"\n]*"/g, '"…"')
      .replace(/'[^'\n]{3,}'/g, "'…'")
  )
}

/** Uma linha curta que descreve o erro sem carregar dado de quem quer que seja. */
export function resumoDoErro(e: unknown): string {
  if (!(e instanceof Error)) return typeof e === 'string' ? mascarar(e).slice(0, 200) : `valor não-Error (${typeof e})`
  const linhas = (e.message ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  const primeira = linhas[0] ?? ''
  const ultima = linhas.length > 1 ? linhas[linhas.length - 1]! : ''
  const codigo = 'code' in e && typeof (e as { code?: unknown }).code === 'string' ? ` ${(e as { code: string }).code}` : ''
  const mensagem = mascarar(ultima && ultima !== primeira ? `${primeira} … ${ultima}` : primeira)
  return `${e.name}${codigo}: ${mensagem}`.slice(0, 400)
}

/** Oito caracteres que se ditam por telefone: sem 0/O nem 1/l. */
export function novoCodigo(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz23456789'
  return [...randomBytes(8)].map((b) => letras[b % letras.length]).join('')
}

/**
 * Grava o erro no log (uma linha JSON) e devolve o código dele.
 * `onde` é um rótulo nosso (`acao`, `encomenda.salvar`), nunca dado de fora.
 */
export function registrarErro(onde: string, e: unknown, extra: Record<string, string | number | undefined> = {}): string {
  const codigo = novoCodigo()
  console.error(JSON.stringify({ nivel: 'erro', codigo, onde, erro: resumoDoErro(e), ...extra }))
  return codigo
}

/** O caminho sem a busca: `?q=Rosa` é nome de cliente. */
export const semBusca = (caminho: string) => (caminho.split(/[?#]/)[0] || '/').slice(0, 200)
