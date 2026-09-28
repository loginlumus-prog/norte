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
// lados.
//
// ── mas só o nono dígito de CELULAR ──────────────────────────
// Até 27/09 o nove caía sempre, e aí o FIXO (11) 3333-4444 e o celular
// (11) 9 3333-4444 davam a mesma chave: a loja cujo fixo é igual ao celular
// da dona (tirando o nove) teria o fixo reconhecido como DONA — relatório e
// ferramentas de dono para quem mandasse do fixo —, e o PARAR de um valeria
// para o outro. O WhatsApp só entrega "sem o nove" os celulares ANTIGOS, dos
// tempos de oito dígitos, e esses começavam com 6, 7, 8 ou 9 (fixo começa com
// 2 a 5). Então:
//
//   • 9 + [6-9]...  → DDD + 8 (dobra o nove: é o celular antigo, que o
//                     WhatsApp pode entregar com ou sem ele)
//   • 9 + [0-5]...  → DDD + 9 + 8 (celular novo; nunca existiu sem o nove, e
//                     assim não encosta no fixo)
//   • 8 dígitos      → DDD + 8 (fixo, ou o celular antigo sem o nove)
//
// As chaves GUARDADAS no banco antes disto (lista de quem não recebe oferta,
// execuções de campanha) usavam a regra velha, e para o celular 9 + [0-5] a
// velha é diferente da nova. Quem procura nessas tabelas procura pelas duas
// (`chavesParaBuscar`) — o PARAR de ontem continua valendo.
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
  // Celular novo (9 seguido de 0 a 5): o nove fica, e o fixo com os mesmos
  // oito dígitos finais não vira a mesma pessoa.
  if (d.length === 11 && !/[6-9]/.test(d[3]!)) return d
  return d.slice(0, 2) + d.slice(-8)
}

/**
 * As chaves com que este número pode estar GUARDADO: a de hoje e, para o
 * celular 9 + [0-5], a da regra antiga (DDD + 8), de antes de 27/09. Recebe
 * uma chave já calculada. É para procurar na lista de quem não recebe oferta
 * e nas execuções de campanha; gravar, só com a chave de hoje.
 *
 * O lado ruim do erro é o seguro: um fixo com os mesmos oito dígitos finais
 * de um celular que pediu PARAR também fica sem oferta.
 */
export function chavesParaBuscar(chave: string): string[] {
  return chave.length === 11 ? [chave, chave.slice(0, 2) + chave.slice(-8)] : [chave]
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
