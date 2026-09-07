// Conferência de fumaça: prova que as duas paredes estão de pé no banco que
// está rodando agora — não em memória de teste, no banco de verdade, passando
// pelo Prisma como a aplicação vai passar.
//
//   npm run conferir
//
// Exige o banco no ar (npm run banco) e preparado (npm run preparar).
// Sai com código 1 se algo vazar, então serve em CI.
//
// ── POR QUE SÓ TEM LEITURA AQUI ──────────────────────────────
// O banco local é PGlite atrás de um socket, e ele NÃO recupera a conexão
// depois de uma transação abortada (Postgres de verdade recupera). Então uma
// checagem do tipo "esta escrita tem que dar erro" envenenaria a conexão e
// faria todas as seguintes "passarem" pelo motivo errado — falso positivo, que
// é pior que não testar.
//
// As escritas bloqueadas (gravar carimbado como da outra empresa, reescrever o
// livro de auditoria) são cobertas por `npm test`, que fala com o PGlite direto
// e não sofre disso. Quando houver Postgres hospedado, essas checagens podem
// voltar para cá.

import 'dotenv/config'
import { comoOrg, acharOrgPorSlug, fechar } from '../src/servidor/banco'
import { entrar, RECADO } from '../src/servidor/autenticacao'
import { pode } from '../src/servidor/permissao'
import { convidar, aceitarConvite, listarConvites, revogarConvite } from '../src/servidor/convite'
import { mexerEstoque, saldo, conferirSaldos } from '../src/servidor/estoque'
import { SemPermissao } from '../src/servidor/permissao'

const A = 'org-exemplo-a'
const B = 'org-exemplo-b'

let falhas = 0
const ok = (t: string, passou: boolean, detalhe = '') => {
  console.log(`  ${passou ? 'ok   ' : 'FALHA'} ${t}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!passou) falhas++
}

console.log('\n  Conferindo o isolamento no banco em uso\n')

// A empresa é descoberta pelo endereço, antes de existir sessão.
const org = await acharOrgPorSlug('exemplo')
ok('acha a empresa pelo endereço', org?.id === A, org?.nome ?? 'não achou')

// Cada uma enxerga só o que é seu.
const uniA = await comoOrg(A, (db) => db.unidade.findMany())
ok('Comércio Exemplo vê só as unidades dela', uniA.length === 1, uniA.map((u) => u.nome).join(', '))

const uniB = await comoOrg(B, (db) => db.unidade.findMany())
ok('Vizinha vê só as unidades dela', uniB.length === 2, uniB.map((u) => u.nome).join(', '))

// O caso que mais importa: consulta escrita SEM filtro de empresa.
// É o esquecimento que todo mundo comete, e ele precisa ser inofensivo.
// Compara com a verdade nua do banco, sem número escrito na mão — assim a
// checagem não vence quando o exemplo mudar.
const usuarios = await comoOrg(A, (db) =>
  db.usuario.findMany({ select: { nome: true, orgId: true } }),
)
const usuariosNoBanco = await comoOrg(B, (db) => db.usuario.count())
ok(
  'findMany() sem filtro não vaza',
  usuarios.length > 0 &&
    usuarios.every((u) => u.orgId === A) &&
    usuariosNoBanco > 0, // a vizinha tem gente, e mesmo assim nenhum apareceu
  `${usuarios.length} da Comércio Exemplo, 0 dos ${usuariosNoBanco} da Vizinha`,
)

// Nem pedindo pelo id exato da linha da vizinha.
const alheia = await comoOrg(A, (db) => db.unidade.findUnique({ where: { id: 'uni-b1' } }))
ok('não alcança linha da outra pelo id', alheia === null)

// Contagem também respeita a parede — inclusive agregação.
const totalA = await comoOrg(A, (db) => db.unidade.count())
const totalB = await comoOrg(B, (db) => db.unidade.count())
ok('count() não soma o das outras', totalA === 1 && totalB === 2, `A=${totalA} B=${totalB}`)

// Escrita normal, dentro da própria empresa, continua funcionando.
const marca = `conferencia-${Date.now()}`
await comoOrg(A, (db) =>
  db.auditoria.create({ data: { orgId: A, quem: 'conferência', acao: marca } }),
)
const gravou = await comoOrg(A, (db) => db.auditoria.findFirst({ where: { acao: marca } }))
ok('grava no livro da própria empresa', gravou !== null)
ok('e a vizinha não enxerga esse registro',
  (await comoOrg(B, (db) => db.auditoria.findFirst({ where: { acao: marca } }))) === null)

// ── entrar no sistema ────────────────────────────────────────
console.log('\n  Login\n')

const SENHA = 'exemplo-2026'

const dona = await entrar('exemplo', 'ana@exemplo.com', SENHA)
ok('a dona entra', dona.ok, dona.ok ? dona.sessao.nome : RECADO[dona.motivo])
ok('e vem com o papel dela', dona.ok && dona.sessao.acessos[0]?.papel === 'DONO')

// A prova que interessa: credencial de uma empresa não abre a porta da outra.
// O usuário da Ana existe, a senha está certa — mas ela não existe na Vizinha.
const invasao = await entrar('vizinha', 'ana@exemplo.com', SENHA)
ok('credencial de uma empresa NÃO entra na outra', !invasao.ok,
   invasao.ok ? 'ENTROU!!' : invasao.motivo)

const senhaErrada = await entrar('exemplo', 'ana@exemplo.com', 'chute')
ok('senha errada é recusada', !senhaErrada.ok)

const naoExiste = await entrar('exemplo', 'ninguem@exemplo.com', SENHA)
ok('e-mail inexistente dá o MESMO motivo que senha errada',
   !naoExiste.ok && !senhaErrada.ok && naoExiste.motivo === senhaErrada.motivo,
   naoExiste.ok ? '' : naoExiste.motivo)

const desativada = await entrar('exemplo', 'antiga@exemplo.com', SENHA)
ok('conta desativada também dá o mesmo motivo',
   !desativada.ok && desativada.motivo === 'credenciais')

const empresaErrada = await entrar('nao-existe', 'ana@exemplo.com', SENHA)
ok('empresa inexistente é dita com clareza',
   !empresaErrada.ok && empresaErrada.motivo === 'empresa_nao_existe')

// Permissão vinda do banco, não de objeto montado à mão.
const balcao = await entrar('exemplo', 'carlos@exemplo.com', SENHA)
ok('o balcão entra', balcao.ok)
if (balcao.ok) {
  ok('balcão vende', pode(balcao.sessao, 'venda.criar', 'uni-a1'))
  ok('balcão não mexe em preço', !pode(balcao.sessao, 'produto.preco', 'uni-a1'))
  ok('balcão não vê o financeiro', !pode(balcao.sessao, 'financeiro.ver', 'uni-a1'))
  ok('e é preso à unidade dele', !pode(balcao.sessao, 'venda.criar', 'uni-outra'))
}

const cont = await entrar('exemplo', 'contador@exemplo.com', SENHA)
ok('o contador entra', cont.ok)
if (cont.ok) {
  ok('contador vê o financeiro', pode(cont.sessao, 'financeiro.ver'))
  ok('contador não vê as vendas', !pode(cont.sessao, 'venda.ver'))
}

// Quem entrou fica registrado no livro do cliente.
const entradas = await comoOrg(A, (db) =>
  db.auditoria.count({ where: { acao: 'sessao.entrou' } }),
)
ok('cada entrada fica registrada no livro', entradas >= 3, `${entradas} registro(s)`)

// ── convite de equipe ────────────────────────────────────────
console.log('\n  Convite de equipe\n')

if (dona.ok) {
  const s = dona.sessao

  const c = await convidar(s, { email: 'novo@exemplo.com', papel: 'GERENTE', unidadeId: 'uni-a1' },
                           'https://norte.app/exemplo')
  ok('a dona convida um gerente', c.link.includes('/convite/'), c.email)

  // O que vai no link NÃO é o que fica no banco.
  const token = c.link.split('/convite/')[1]!
  const guardado = await comoOrg(A, (db) =>
    db.convite.findFirst({ where: { email: 'novo@exemplo.com' }, select: { token: true } }))
  ok('o link não está guardado em texto claro',
     guardado !== null && guardado.token !== token)

  // Token de uma empresa não vale na outra.
  const naVizinha = await aceitarConvite('vizinha', token, { nome: 'Invasor', senha: 'senha-boa-2026' })
  ok('convite de uma empresa NÃO vale na outra', !naVizinha.ok,
     naVizinha.ok ? 'ACEITOU!!' : naVizinha.motivo)

  const inventado = await aceitarConvite('exemplo', 'token-inventado', { nome: 'X', senha: 'senha-boa-2026' })
  ok('token inventado é recusado', !inventado.ok && inventado.motivo === 'invalido')

  const aceito = await aceitarConvite('exemplo', token, { nome: 'Marina', senha: 'senha-boa-2026' })
  ok('a pessoa aceita e a conta nasce', aceito.ok, aceito.ok ? aceito.papel : aceito.motivo)

  const entrou = await entrar('exemplo', 'novo@exemplo.com', 'senha-boa-2026')
  ok('e ela já entra com a senha que escolheu', entrou.ok, entrou.ok ? entrou.sessao.nome : '')
  ok('com o papel do convite, na unidade do convite',
     entrou.ok && entrou.sessao.acessos[0]?.papel === 'GERENTE'
              && entrou.sessao.acessos[0]?.unidadeId === 'uni-a1')

  const dnv = await aceitarConvite('exemplo', token, { nome: 'Outro', senha: 'senha-boa-2026' })
  ok('o mesmo link não serve duas vezes', !dnv.ok && dnv.motivo === 'ja_usado')

  // Escalada de papel: o gerente recém-criado não pode fabricar um dono.
  if (entrou.ok) {
    let barrou = false
    try {
      await convidar(entrou.sessao, { email: 'golpe@exemplo.com', papel: 'DONO', unidadeId: 'uni-a1' },
                     'https://norte.app/exemplo')
    } catch { barrou = true }
    ok('gerente NÃO consegue convidar um dono', barrou)

    const podeBalcao = await convidar(entrou.sessao,
      { email: 'balconista@exemplo.com', papel: 'BALCAO', unidadeId: 'uni-a1' },
      'https://norte.app/exemplo')
    ok('mas contrata balconista na loja dele', podeBalcao.papel === 'BALCAO')
  }

  const abertos = await listarConvites(s)
  ok('convite aceito sai da lista de pendentes',
     !abertos.some((x) => x.email === 'novo@exemplo.com'), `${abertos.length} pendente(s)`)

  const paraRevogar = abertos.find((x) => x.email === 'balconista@exemplo.com')
  if (paraRevogar) {
    await revogarConvite(s, paraRevogar.id)
    const depois = await listarConvites(s)
    ok('revogar tira o convite da lista', !depois.some((x) => x.id === paraRevogar.id))
  }
}

// ── estoque ──────────────────────────────────────────────────
console.log('\n  Estoque\n')

if (dona.ok) {
  const s = dona.sessao
  const CAM = 'var-cam-azul-m'   // comeca com 12
  const SORVETE = 'var-sorvete'  // comeca com 12,500 kg
  const UNI = 'uni-a1'

  const v1 = await mexerEstoque(s, { variacaoId: CAM, unidadeId: UNI, tipo: 'VENDA', quantidade: 2 })
  ok('venda baixa o estoque', v1.ok && v1.saldo === 10, `saldo ${v1.saldo}`)

  const dev = await mexerEstoque(s, { variacaoId: CAM, unidadeId: UNI, tipo: 'DEVOLUCAO', quantidade: 1 })
  ok('devolucao devolve', dev.ok && dev.saldo === 11, `saldo ${dev.saldo}`)

  // O caso que protege o dono: nao vender o que nao existe.
  const demais = await mexerEstoque(s, { variacaoId: CAM, unidadeId: UNI, tipo: 'VENDA', quantidade: 999 })
  ok('nao vende mais do que tem', !demais.ok && demais.motivo === 'sem_saldo')
  ok('e o saldo fica intacto depois da recusa', (await saldo(s, CAM, UNI)) === 11)

  // Peso: a sorveteria vende 340 g, nao "1 unidade".
  const kg = await mexerEstoque(s, { variacaoId: SORVETE, unidadeId: UNI, tipo: 'VENDA', quantidade: 0.34 })
  ok('vende por peso, com casas decimais', kg.ok && Math.abs(kg.saldo - 12.16) < 0.001, `${kg.saldo} kg`)

  // Balanco: informa o CONTADO, o sistema calcula a diferenca.
  const bal = await mexerEstoque(s, { variacaoId: CAM, unidadeId: UNI, tipo: 'BALANCO', quantidade: 9,
                                      motivo: 'contagem do dia 30' })
  ok('balanco ajusta para o que foi contado', bal.ok && bal.saldo === 9, `saldo ${bal.saldo}`)

  // A prova da atomicidade: 8 baixas disparadas juntas, nenhuma pode se perder.
  // (Num Postgres de verdade elas correm em paralelo; aqui o PGlite serializa,
  //  entao isto prova a aritmetica, nao a corrida. A corrida so se verifica
  //  no banco hospedado.)
  const antes = await saldo(s, CAM, UNI)
  const juntas = await Promise.all(
    Array.from({ length: 8 }, () =>
      mexerEstoque(s, { variacaoId: CAM, unidadeId: UNI, tipo: 'VENDA', quantidade: 1 })),
  )
  const passaram = juntas.filter((r) => r.ok).length
  const depois = await saldo(s, CAM, UNI)
  ok('8 baixas ao mesmo tempo: nenhuma se perde nem duplica',
     depois === antes - passaram && depois >= 0,
     `${antes} -> ${depois}, ${passaram} passaram`)

  // O historico e a verdade; o saldo e atalho. Os dois tem que bater.
  const divergentes = await conferirSaldos(s)
  ok('saldo bate com a soma do historico', divergentes.length === 0,
     divergentes.length ? `${divergentes.length} divergente(s)` : 'tudo conferido')
}

// Permissao no movimento: o balcao vende, mas nao ajusta estoque.
const balcao2 = await entrar('exemplo', 'carlos@exemplo.com', SENHA)
if (balcao2.ok) {
  const s = balcao2.sessao
  const v = await mexerEstoque(s, { variacaoId: 'var-cam-preto-p', unidadeId: 'uni-a1',
                                    tipo: 'VENDA', quantidade: 1 })
  ok('balcao consegue dar baixa de venda', v.ok)

  let barrou = false
  try {
    await mexerEstoque(s, { variacaoId: 'var-cam-preto-p', unidadeId: 'uni-a1',
                            tipo: 'AJUSTE', quantidade: 50 })
  } catch (e) { barrou = e instanceof SemPermissao }
  ok('mas NAO consegue ajustar estoque', barrou)
}

// A vizinha nao enxerga estoque nenhum desta empresa.
const daVizinha = await comoOrg(B, (db) => db.estoque.count())
ok('a empresa vizinha nao ve este estoque', daVizinha === 0, `${daVizinha} linha(s)`)

await fechar()

console.log(
  falhas === 0
    ? '\n  Tudo isolado. (escritas bloqueadas: npm test)\n'
    : `\n  ${falhas} falha(s). NÃO subir nada assim.\n`,
)
process.exit(falhas === 0 ? 0 : 1)
