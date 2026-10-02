// O endereço da empresa: o primeiro pedaço da URL (gestornorte.com/<slug>).
//
// Ele disputa espaço com as páginas do próprio site. `gestornorte.com/termos`
// precisa ser os termos, não a loja de alguém que se cadastrou como "Termos".
// Por isso existe uma lista de nomes que empresa nenhuma pode ter.
//
// ── uma lista, dois lugares ──────────────────────────────────
// Esta lista vale no script de operador (scripts/criar-empresa.ts), na tela
// de cadastro (autocadastro.ts) e DENTRO do banco, na função
// `criar_empresa_cadastro` (prisma/sql/rls.sql) — porque é a função que tem a
// última palavra, e ela não confia em quem a chama. A cópia do SQL é
// conferida contra esta pelo teste (tests/contas.test.ts): mudou aqui, o
// teste manda mudar lá.
//
// A lista é maior do que as páginas de hoje de propósito: tirar um nome de
// alguém que já está usando é muito pior do que reservar um nome a mais.
// Todo diretório de src/app e de public/ tem de estar aqui — o teste confere.

export const RESERVADOS: ReadonlySet<string> = new Set([
  // o que existe
  'fontes', 'img', 'video', 'arte', 'marca', 'saude', 'exclusao-de-dados',
  // o que o Next usa
  '_next', 'api', 'static',
  // páginas do site, as de hoje e as próximas
  'termos', 'privacidade', 'contrato', 'planos', 'precos', 'ajuda', 'suporte',
  'sobre', 'contato', 'blog', 'status', 'seguranca', 'lgpd',
  // o que confunde com o sistema
  'admin', 'app', 'painel', 'entrar', 'sair', 'conta', 'assinatura', 'convite',
  'cadastro', 'cadastrar', 'criar', 'nova', 'novo', 'norte', 'www', 'mail', 'email',
  'redefinir-senha', 'confirmar-email', 'esqueci-a-senha', 'comecar', 'login',
])

/** De 3 a 40: minúsculas, números e hífen, sem hífen nas pontas. */
export const FORMATO_ENDERECO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

export function enderecoValido(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 40 && FORMATO_ENDERECO.test(slug) && !RESERVADOS.has(slug)
}

/**
 * O endereço que o nome da empresa sugere: "Sorveteria da Praça" →
 * "sorveteria-da-praca". Sem acento, sem símbolo, até 40 letras cortadas em
 * fim de palavra.
 *
 * Não confere se está livre — quem confere é o banco, na hora de gravar, e
 * ele acrescenta "-2", "-3"... quando precisa. Conferir aqui e gravar depois
 * deixaria duas pessoas se cadastrarem com o mesmo nome no mesmo segundo.
 */
export function enderecoDoNome(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  let corte = base
  if (corte.length > 40) {
    corte = corte.slice(0, 40)
    const ultimo = corte.lastIndexOf('-')
    if (ultimo >= 20) corte = corte.slice(0, ultimo)
    corte = corte.replace(/-+$/g, '')
  }
  // Nome curto demais ("Zé", "3") ou feito só de símbolos: o endereço ganha
  // um prefixo em vez de virar vazio. Reservado também: "Contato" vira
  // "loja-contato", que é melhor do que "contato-2".
  if (corte.length < 3 || RESERVADOS.has(corte)) corte = `loja-${corte}`.replace(/-+$/g, '')
  if (corte.length < 3) corte = 'loja'
  return corte.slice(0, 40).replace(/-+$/g, '')
}
