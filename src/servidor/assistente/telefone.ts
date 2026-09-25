// Quem está falando, pelo número.
//
// O WhatsApp entrega o número do jeito DELE: com 55 na frente, às vezes sem o
// nono dígito (número antigo que a operadora nunca migrou no cadastro do
// WhatsApp). O cadastro da loja guarda do jeito da PESSOA: "(71) 99999-0000",
// "71 9 9999 0000", "+55 71...". Comparar texto com texto faria o dono virar
// cliente — e cliente não recebe o faturamento, então o erro seria "o
// assistente não me responde", que é o pior tipo de defeito: parece que
// funciona.
//
// A chave aqui é DDD + os últimos OITO dígitos. Ela ignora o 55 e ignora o
// nono dígito, que são exatamente as duas coisas que variam entre os dois
// lados. Duas pessoas diferentes com a mesma chave precisariam ter o mesmo
// DDD e os mesmos oito dígitos finais, o que só acontece com o mesmo número.
//
// PURO: sem banco, sem I/O. É o que decide dono × cliente, então é testado à
// parte.

export const soDigitos = (v: string) => v.replace(/\D/g, '')

/**
 * "5571999990000" → "7199990000". Nulo quando não parece telefone
 * brasileiro — número estrangeiro não vira chave, e sem chave ninguém é
 * reconhecido como equipe. É o lado seguro do erro.
 */
export function chaveTelefone(bruto: string | null | undefined): string | null {
  if (!bruto) return null
  let d = soDigitos(bruto)
  // 55 + DDD + 8 ou 9 dígitos
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  // DDD com zero de operadora na frente ("071...")
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  if (d.length !== 10 && d.length !== 11) return null
  // DDD brasileiro não tem zero (11 a 99, sem 20, 30...), e número de onze
  // dígitos é celular, que começa com 9. Sem isto um número americano de
  // onze dígitos (1 415 555 0100) passava por "DDD 14".
  if (d[0] === '0' || d[1] === '0') return null
  if (d.length === 11 && d[2] !== '9') return null
  if (d.length === 10 && d[2] === '0') return null
  return d.slice(0, 2) + d.slice(-8)
}

export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = chaveTelefone(a)
  return ka !== null && ka === chaveTelefone(b)
}

/**
 * O número no formato que o canal espera: 55 + DDD + número, só dígitos.
 * O que já veio com 55 do próprio WhatsApp passa como está.
 */
export function paraEnvio(bruto: string): string | null {
  let d = soDigitos(bruto)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  if (d.length === 10 || d.length === 11) return `55${d}`
  return null
}

/** "(71) 9····-0000" — para a tela de histórico, que não precisa do número inteiro. */
export function mascarar(bruto: string): string {
  const d = soDigitos(bruto).replace(/^55(?=\d{10,11}$)/, '')
  if (d.length < 8) return '····'
  return `(${d.slice(0, 2)}) ${d.slice(2, 3)}····-${d.slice(-4)}`
}
