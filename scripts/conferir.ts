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
import { registrarVenda } from '../src/servidor/venda'
import { MAX_POR_EMAIL } from '../src/servidor/limite'
import { sessaoAindaVale } from '../src/servidor/permissao'
import { cortarSessoes } from '../src/servidor/pagina'
import { acharAgente, propor, responderProposta, paraConfig } from '../src/servidor/agente'
import { criarProduto, ajustarGrade, eixosDaEmpresa } from '../src/servidor/produto'
import { registrarEntrada, definirMinimo } from '../src/servidor/entrada'
import { listarEquipe, mudarAcesso, mudarSituacao } from '../src/servidor/equipe'
import { criarCliente, listarClientes } from '../src/servidor/cliente'
import { ferramentasDe, AcimaDoTeto } from '../src/servidor/poderes'
import { escolherUnidade } from '../src/servidor/unidade'
import { resumoDoPainel } from '../src/servidor/painel'
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
// Sem número escrito na mão: compara com a verdade do banco. Número fixo em
// checagem envelhece junto com o exemplo e passa a reprovar coisa certa.
const uniA = await comoOrg(A, (db) => db.unidade.findMany({ select: { id: true, nome: true, orgId: true } }))
const uniB = await comoOrg(B, (db) => db.unidade.findMany({ select: { id: true, nome: true, orgId: true } }))

ok('Comércio Exemplo vê só as unidades dela',
   uniA.length > 0 && uniA.every((u) => u.orgId === A),
   uniA.map((u) => u.nome).join(', '))
ok('Vizinha vê só as unidades dela',
   uniB.length > 0 && uniB.every((u) => u.orgId === B),
   uniB.map((u) => u.nome).join(', '))
ok('e nenhuma unidade aparece nas duas',
   !uniA.some((a) => uniB.some((b) => b.id === a.id)))

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
ok('count() não soma o das outras',
   totalA === uniA.length && totalB === uniB.length && totalA !== totalA + totalB,
   `A=${totalA} B=${totalB}`)

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
  const CAM = 'var-cam-azul-m'
  const SORVETE = 'var-sorvete'
  const UNI = 'uni-a1'

  // Tudo daqui para baixo compara com o saldo do momento, nunca com numero
  // escrito na mao: o exemplo muda, e checagem com numero fixo passa a
  // reprovar codigo que esta certo.
  const camAntes = await saldo(s, CAM, UNI)

  const v1 = await mexerEstoque(s, { variacaoId: CAM, unidadeId: UNI, tipo: 'VENDA', quantidade: 2 })
  ok('venda baixa o estoque', v1.ok && v1.saldo === camAntes - 2, `${camAntes} -> ${v1.saldo}`)

  const dev = await mexerEstoque(s, { variacaoId: CAM, unidadeId: UNI, tipo: 'DEVOLUCAO', quantidade: 1 })
  ok('devolucao devolve', dev.ok && dev.saldo === camAntes - 1, `saldo ${dev.saldo}`)

  // O caso que protege o dono: nao vender o que nao existe.
  const demais = await mexerEstoque(s, { variacaoId: CAM, unidadeId: UNI, tipo: 'VENDA', quantidade: 999 })
  ok('nao vende mais do que tem', !demais.ok && demais.motivo === 'sem_saldo')
  ok('e o saldo fica intacto depois da recusa', (await saldo(s, CAM, UNI)) === camAntes - 1)

  // Peso: a sorveteria vende 340 g, nao "1 unidade".
  const sorveteAntes = await saldo(s, SORVETE, UNI)
  const kg = await mexerEstoque(s, { variacaoId: SORVETE, unidadeId: UNI, tipo: 'VENDA', quantidade: 0.34 })
  ok('vende por peso, com casas decimais',
     kg.ok && Math.abs(kg.saldo - (sorveteAntes - 0.34)) < 0.001, `${kg.saldo} kg`)

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


// -- venda --------------------------------------------------
console.log('\n  Venda\n')

if (dona.ok) {
  const s = dona.sessao
  const UNI = 'uni-a1'
  const CAM = 'var-cam-preto-g'   // saldo 6
  const SORVETE = 'var-sorvete'

  const antesCam = await saldo(s, CAM, UNI)

  const v1 = await registrarVenda(s, {
    unidadeId: UNI,
    itens: [{ variacaoId: CAM, quantidade: 2 }],
    pagamentos: [{ forma: 'DINHEIRO', valor: 99.8 }],
  })
  ok('venda simples fecha', v1.ok, v1.ok ? `n. ${v1.numero}, R$ ${v1.total}` : v1.motivo)
  ok('e o estoque baixou junto', (await saldo(s, CAM, UNI)) === antesCam - 2)

  // Pagamento dividido: metade no cartao, metade em dinheiro.
  const v2 = await registrarVenda(s, {
    unidadeId: UNI,
    itens: [{ variacaoId: CAM, quantidade: 1 }],
    pagamentos: [
      { forma: 'DEBITO', valor: 25 },
      { forma: 'DINHEIRO', valor: 24.9 },
    ],
  })
  ok('aceita pagamento dividido em duas formas', v2.ok, v2.ok ? `R$ ${v2.total}` : v2.motivo)

  // Peso: 0,750 kg de sorvete.
  const v3 = await registrarVenda(s, {
    unidadeId: UNI,
    itens: [{ variacaoId: SORVETE, quantidade: 0.75 }],
    pagamentos: [{ forma: 'PIX', valor: 33.68 }],
  })
  ok('vende por peso', v3.ok, v3.ok ? `R$ ${v3.total}` : v3.motivo)

  // Um centavo a menos trava de proposito.
  const errado = await registrarVenda(s, {
    unidadeId: UNI,
    itens: [{ variacaoId: CAM, quantidade: 1 }],
    pagamentos: [{ forma: 'DINHEIRO', valor: 49.89 }],
  })
  ok('um centavo faltando NAO passa', !errado.ok && errado.motivo === 'pagamento_nao_fecha')

  // Sem estoque: recusa antes de escrever, e diz o que faltou.
  const semEstoque = await registrarVenda(s, {
    unidadeId: UNI,
    itens: [{ variacaoId: CAM, quantidade: 9999 }],
    pagamentos: [{ forma: 'DINHEIRO', valor: 1 }],
  })
  ok('recusa venda sem estoque e diz o que faltou',
     !semEstoque.ok && semEstoque.motivo === 'sem_estoque',
     !semEstoque.ok && semEstoque.motivo === 'sem_estoque' ? semEstoque.faltando[0]?.descricao : '')

  // E a recusa nao pode ter deixado rastro.
  // A recusa nao pode ter gasto numero: o proximo numero da unidade tem que
  // ser exatamente um a mais que a ultima venda feita.
  const [ultima, proximo] = await comoOrg(A, async (db) => [
    await db.venda.findFirst({ where: { unidadeId: UNI }, orderBy: { numero: 'desc' },
                               select: { numero: true } }),
    await db.unidade.findUnique({ where: { id: UNI }, select: { proximaVenda: true } }),
  ])
  ok('venda recusada nao gasta numero',
     (ultima?.numero ?? 0) + 1 === proximo?.proximaVenda,
     `ultima ${ultima?.numero}, proxima ${proximo?.proximaVenda}`)

  // A fotografia: mudar o preco do produto nao mexe na venda ja feita.
  const itemAntes = await comoOrg(A, (db) =>
    db.vendaItem.findFirst({ where: { variacaoId: CAM }, select: { precoUnit: true, descricao: true } }))
  await comoOrg(A, (db) =>
    db.produto.update({ where: { id: 'prod-camiseta' }, data: { precoVista: 999 } }))
  const itemDepois = await comoOrg(A, (db) =>
    db.vendaItem.findFirst({ where: { variacaoId: CAM }, select: { precoUnit: true } }))
  ok('mudar o preco do produto NAO reescreve a venda antiga',
     Number(itemAntes?.precoUnit) === Number(itemDepois?.precoUnit),
     `${itemAntes?.descricao} continua R$ ${itemAntes?.precoUnit}`)
  await comoOrg(A, (db) =>
    db.produto.update({ where: { id: 'prod-camiseta' }, data: { precoVista: 49.9 } }))

  // Numeracao: sequencial e sem buraco, mesmo com vendas simultaneas.
  const emParalelo = await Promise.all(
    Array.from({ length: 5 }, () =>
      registrarVenda(s, {
        unidadeId: UNI,
        itens: [{ variacaoId: 'var-cam-azul-p', quantidade: 1 }],
        pagamentos: [{ forma: 'PIX', valor: 49.9 }],
      })),
  )
  const ns = emParalelo.filter((r) => r.ok).map((r) => (r as { numero: number }).numero)
  ok('5 vendas simultaneas, 5 numeros diferentes',
     new Set(ns).size === ns.length && ns.length === 5, ns.join(', '))

  // O livro registra cada venda. Conta o que ESTA passagem gerou, para a
  // checagem continuar valendo quando o script rodar duas vezes seguidas.
  const noLivro = await comoOrg(A, (db) =>
    db.auditoria.count({ where: { acao: 'venda.registrou' } }))
  const vendasReais = await comoOrg(A, (db) =>
    db.venda.count({ where: { id: { not: { startsWith: 'venda-org-' } } } }))
  ok('cada venda entra no livro', noLivro === vendasReais,
     `${noLivro} registro(s) para ${vendasReais} venda(s)`)
}

// -- separacao por loja --------------------------------------
console.log('\n  Separação por loja\n')

if (dona.ok) {
  const s = dona.sessao

  // A dona ve as duas lojas.
  const daDona = await escolherUnidade(s, { modulos: ['multiUnidade'] }, undefined)
  ok('a dona ve todas as lojas', daDona.opcoes.length === 2,
     daDona.opcoes.map((u) => u.nome).join(', '))
  ok('e o consolidado soma as duas', daDona.ids.length === 2)

  // Cria um gerente preso a UMA loja.
  const c = await convidar(s, { email: 'gerente2@exemplo.com', papel: 'GERENTE', unidadeId: 'uni-a2' },
                           'https://norte.app/exemplo')
  await aceitarConvite('exemplo', c.link.split('/convite/')[1]!,
                       { nome: 'Gerente do Shopping', senha: 'senha-boa-2026' })
  const g = await entrar('exemplo', 'gerente2@exemplo.com', 'senha-boa-2026')
  ok('o gerente da loja entra', g.ok)

  if (g.ok) {
    const dele = await escolherUnidade(g.sessao, { modulos: ['multiUnidade'] }, undefined)
    ok('o gerente ve SO a loja dele', dele.opcoes.length === 1 && dele.opcoes[0]?.id === 'uni-a2',
       dele.opcoes.map((u) => u.nome).join(', '))

    // E se ele COLAR na barra de endereco o id da outra loja?
    const tentando = await escolherUnidade(g.sessao, { modulos: ['multiUnidade'] }, 'uni-a1')
    ok('pedir a outra loja pelo endereco NAO abre',
       !tentando.ids.includes('uni-a1'), `viu: ${tentando.ids.join(', ')}`)

    // O numero que ele ve e o da loja dele, nao o da empresa.
    const painelDele = await resumoDoPainel(g.sessao, dele.ids)
    const painelDaDona = await resumoDoPainel(s, daDona.ids)
    ok('o total do gerente e menor que o da empresa',
       painelDele.mes.total > 0 && painelDele.mes.total < painelDaDona.mes.total,
       `gerente R$ ${painelDele.mes.total.toFixed(2)} de R$ ${painelDaDona.mes.total.toFixed(2)}`)
  }
}


// ── cadastro de produto ──────────────────────────────────────
console.log('\n  Cadastro de produto\n')

{
  const dona = await entrar('exemplo', 'ana@exemplo.com', 'exemplo-2026')
  const balconista = await entrar('exemplo', 'carlos@exemplo.com', 'exemplo-2026')

  if (dona.ok && balconista.ok) {
    const eixos = await eixosDaEmpresa(dona.sessao)
    const cor = eixos.find((e) => e.nome === 'Cor')
    const tam = eixos.find((e) => e.nome === 'Tamanho')

    // 1. Sem eixo: uma variação só, marcada como padrão. É o sorvete a granel.
    const semGrade = await criarProduto(dona.sessao, {
      nome: 'Agua mineral', medida: 'UN', precoVista: 3.5, custo: 1.2,
    })
    ok('produto sem variacao nasce com UMA variacao padrao',
       semGrade.ok && semGrade.variacoes === 1,
       semGrade.ok ? `${semGrade.variacoes} variacao` : semGrade.motivo)

    // 2. Com dois eixos: o produto cartesiano, com código para cada um.
    const comGrade = await criarProduto(
      dona.sessao,
      { nome: 'Bermuda tactel', medida: 'UN', precoVista: 79.9, custo: 31 },
      [
        { eixoId: cor!.id, opcaoIds: cor!.opcoes.slice(0, 2).map((o) => o.id) },
        { eixoId: tam!.id, opcaoIds: tam!.opcoes.map((o) => o.id) },
      ],
    )
    ok('2 cores x 3 tamanhos = 6 variacoes',
       comGrade.ok && comGrade.variacoes === 6,
       comGrade.ok ? `${comGrade.variacoes}` : comGrade.motivo)

    const produtoId = comGrade.ok ? comGrade.produtoId : ''

    // 3. Cada uma com código próprio, e nenhum repetido na empresa inteira.
    const codigos = await comoOrg(A, (db) =>
      db.variacao.findMany({ select: { codigo: true } }),
    )
    const lista = codigos.map((c) => c.codigo).filter(Boolean)
    ok('nenhum codigo de etiqueta se repete na empresa',
       new Set(lista).size === lista.length, `${lista.length} codigos`)

    // 4. Quem não pode cadastrar, não cadastra — nem pelo endereço direto.
    let recusado = false
    try {
      await criarProduto(balconista.sessao, { nome: 'Nao deveria existir', medida: 'UN', precoVista: 10 })
    } catch (e) {
      recusado = e instanceof SemPermissao
    }
    ok('o balcao NAO cadastra produto', recusado)

    // 5. Preço zero não passa.
    const semPreco = await criarProduto(dona.sessao, { nome: 'Sem preco', medida: 'UN', precoVista: 0 })
    ok('produto sem preco a vista e recusado', !semPreco.ok, semPreco.ok ? 'PASSOU!' : semPreco.motivo)

    // ── o cuidado que importa: o que SAI da grade ──
    if (produtoId) {
      // 6. Combinação virgem some de vez — é lixo de digitação.
      const virgem = await ajustarGrade(dona.sessao, produtoId, [
        { eixoId: cor!.id, opcaoIds: [cor!.opcoes[0]!.id] },
        { eixoId: tam!.id, opcaoIds: tam!.opcoes.map((o) => o.id) },
      ])
      ok('combinacao sem historico e APAGADA', virgem.apagadas === 3 && virgem.desativadas === 0,
         `${virgem.apagadas} apagadas, ${virgem.desativadas} desativadas`)
    }

    // 7. Combinação COM histórico é desativada, nunca apagada — e volta com o
    //    MESMO código, senão a etiqueta já colada na peça deixa de achar.
    const antesG = await comoOrg(A, (db) =>
      db.variacao.findFirst({
        where: { produtoId: 'prod-camiseta', opcoes: { some: { opcao: { valor: 'G' } } } },
        select: { id: true, codigo: true },
      }),
    )

    const tirandoG = await ajustarGrade(dona.sessao, 'prod-camiseta', [
      { eixoId: cor!.id, opcaoIds: cor!.opcoes.map((o) => o.id) },
      { eixoId: tam!.id, opcaoIds: tam!.opcoes.filter((o) => o.valor !== 'G').map((o) => o.id) },
    ])
    ok('combinacao COM historico e DESATIVADA, nao apagada',
       tirandoG.desativadas === 2 && tirandoG.apagadas === 0,
       `${tirandoG.desativadas} desativadas, ${tirandoG.apagadas} apagadas`)

    const aindaLa = await comoOrg(A, (db) =>
      db.variacao.findUnique({ where: { id: antesG!.id }, select: { ativa: true, codigo: true } }),
    )
    ok('e ela continua existindo, so que fora do balcao',
       !!aindaLa && aindaLa.ativa === false, aindaLa ? `ativa=${aindaLa.ativa}` : 'SUMIU!')

    const voltandoG = await ajustarGrade(dona.sessao, 'prod-camiseta', [
      { eixoId: cor!.id, opcaoIds: cor!.opcoes.map((o) => o.id) },
      { eixoId: tam!.id, opcaoIds: tam!.opcoes.map((o) => o.id) },
    ])
    const depoisG = await comoOrg(A, (db) =>
      db.variacao.findUnique({ where: { id: antesG!.id }, select: { ativa: true, codigo: true } }),
    )
    ok('e volta com o MESMO codigo de etiqueta',
       voltandoG.reativadas === 2 && depoisG?.ativa === true && depoisG?.codigo === antesG!.codigo,
       `${antesG!.codigo} -> ${depoisG?.codigo}`)

    // 8. E a venda antiga daquela combinação continua de pé.
    const vendeuG = await comoOrg(A, (db) =>
      db.vendaItem.count({ where: { variacaoId: antesG!.id } }),
    )
    ok('a venda antiga da combinacao continua no historico', vendeuG > 0, `${vendeuG} item(ns)`)
  }
}


// ── entrada de mercadoria ────────────────────────────────────
console.log('\n  Entrada de mercadoria\n')

{
  const dona = await entrar('exemplo', 'ana@exemplo.com', 'exemplo-2026')
  const balconista = await entrar('exemplo', 'carlos@exemplo.com', 'exemplo-2026')

  if (dona.ok && balconista.ok) {
    const peca = await comoOrg(A, (db) =>
      db.variacao.findFirst({
        where: { produto: { nome: 'Camiseta canelada' } },
        orderBy: { codigo: 'asc' },
        select: { id: true, produtoId: true },
      }),
    )
    const cat = await comoOrg(A, (db) =>
      db.categoriaFinanceira.findFirst({ where: { nome: 'Compra de mercadoria' }, select: { id: true } }),
    )

    const antes = await saldo(dona.sessao, peca!.id, 'uni-a1')
    const contasAntes = await comoOrg(A, (db) => db.lancamento.count())

    const r = await registrarEntrada(dona.sessao, {
      unidadeId: 'uni-a1',
      fornecedor: 'Fornecedor da conferencia',
      documento: 'NF-CONF-1',
      itens: [{ variacaoId: peca!.id, quantidade: 12, custoUnit: 27.4 }],
      conta: { categoriaId: cat!.id, vencimento: new Date(Date.now() + 30 * 864e5), jaPago: false },
    })

    ok('entrada registrada', r.ok, r.ok ? `${r.itens} item(ns), R$ ${r.total.toFixed(2)}` : r.motivo)

    const depois = await saldo(dona.sessao, peca!.id, 'uni-a1')
    ok('o saldo sobe exatamente o que entrou', depois === antes + 12, `${antes} -> ${depois}`)

    const custo = await comoOrg(A, (db) =>
      db.produto.findUnique({ where: { id: peca!.produtoId }, select: { custo: true } }),
    )
    ok('o custo passa a ser o DESTA compra', Number(custo?.custo) === 27.4, `R$ ${custo?.custo}`)

    const contasDepois = await comoOrg(A, (db) => db.lancamento.count())
    const conta = await comoOrg(A, (db) =>
      db.lancamento.findFirst({ where: { documento: 'NF-CONF-1' }, select: { valor: true, fornecedor: true } }),
    )
    ok('e a conta do fornecedor nasce com 12 x 27,40',
       contasDepois === contasAntes + 1 && Number(conta?.valor) === 328.8,
       `R$ ${conta?.valor} para ${conta?.fornecedor}`)

    // O saldo continua batendo com a soma do histórico. É a checagem que
    // impede o estoque de virar um número em que ninguém confia.
    const divergentes = await conferirSaldos(dona.sessao, 'uni-a1')
    ok('e o saldo continua batendo com o historico', divergentes.length === 0,
       `${divergentes.length} divergencia(s)`)

    // Quem vende não dá entrada: seria o caminho para "aparecer" mercadoria.
    let recusado = false
    try {
      await registrarEntrada(balconista.sessao, {
        unidadeId: 'uni-a1',
        itens: [{ variacaoId: peca!.id, quantidade: 999 }],
      })
    } catch (e) {
      recusado = e instanceof SemPermissao
    }
    ok('o balcao NAO da entrada de mercadoria', recusado)

    // Balanço: a pessoa digita o que CONTOU, e o sistema calcula o ajuste.
    const contado = 7
    const b = await mexerEstoque(dona.sessao, {
      variacaoId: peca!.id,
      unidadeId: 'uni-a1',
      tipo: 'BALANCO',
      quantidade: contado,
      motivo: 'Contagem da conferencia',
    })
    ok('balanco grava o que foi CONTADO, nao a diferenca',
       b.ok && b.saldo === contado, b.ok ? `saldo ${b.saldo}` : b.motivo)

    const aindaBate = await conferirSaldos(dona.sessao, 'uni-a1')
    ok('e o balanco tambem entra no historico', aindaBate.length === 0,
       `${aindaBate.length} divergencia(s)`)

    // O mínimo é o que transforma "acabou" em "está acabando".
    await definirMinimo(dona.sessao, peca!.id, 'uni-a1', 4)
    const comMinimo = await comoOrg(A, (db) =>
      db.estoque.findUnique({
        where: { variacaoId_unidadeId: { variacaoId: peca!.id, unidadeId: 'uni-a1' } },
        select: { minimo: true },
      }),
    )
    ok('o minimo de reposicao e gravado', Number(comMinimo?.minimo) === 4, `minimo ${comMinimo?.minimo}`)
  }
}

// ── o agente ─────────────────────────────────────────────────
// Prova o caminho inteiro: ele propõe, quem não pode não confirma, quem pode
// confirma, e a ação acontece de verdade no financeiro.
console.log('\n  Agente\n')

{
  const dona = await entrar('exemplo', 'ana@exemplo.com', 'exemplo-2026')
  const balconista = await entrar('exemplo', 'carlos@exemplo.com', 'exemplo-2026')
  const empresa = { modulos: ['agente', 'multiUnidade', 'metas'] }

  const agente = await acharAgente(A)
  ok('a empresa tem assistente', !!agente, agente?.nome ?? 'nenhum')

  if (agente && dona.ok && balconista.ok) {
    // 1. O que vai para o modelo depende de quem está falando.
    const cfg = paraConfig(agente)
    const paraEquipe = ferramentasDe(cfg, empresa, true)
    const paraCliente = ferramentasDe(cfg, empresa, false)
    ok('a equipe recebe mais ferramentas que o cliente',
       paraEquipe.length > paraCliente.length,
       `equipe ${paraEquipe.length}, cliente ${paraCliente.length}`)
    ok('o cliente NAO recebe a ferramenta do faturamento',
       !paraCliente.includes('ver.resumo'), paraCliente.join(', '))

    // 2. O teto recusa antes de a proposta existir.
    const teto = agente.valorMaxCent / 100
    let recusou = false
    try {
      await propor(A, empresa, {
        poder: 'lancar.despesa',
        resumo: 'Teste acima do teto',
        dados: {},
        valor: teto * 3,
      })
    } catch (e) {
      recusou = e instanceof AcimaDoTeto
    }
    ok('proposta acima do teto nem chega a existir', recusou, `teto R$ ${teto}`)

    // 3. Dentro do teto, ela nasce esperando.
    const cat = await comoOrg(A, (db) =>
      db.categoriaFinanceira.findFirst({ where: { nome: 'Sistema e software' }, select: { id: true } }),
    )
    const p = await propor(A, empresa, {
      poder: 'lancar.despesa',
      resumo: 'Assinatura do sistema de etiqueta, R$ 89,00/mes. Lancar?',
      dados: {
        categoriaId: cat?.id ?? '',
        descricao: 'Sistema de etiqueta',
        valor: 89,
        vencimento: new Date(Date.now() + 10 * 864e5).toISOString(),
        fornecedor: 'Etiquetas SA',
      },
      valor: 89,
    })
    ok('dentro do teto, a proposta nasce esperando', p.situacao === 'AGUARDANDO', p.resumo.slice(0, 40))

    // 4. Quem não tem a capacidade NÃO confirma — nem pelo agente.
    const doBalcao = await responderProposta(balconista.sessao, empresa, p.id, true)
    ok('o balcao NAO confirma proposta de financeiro',
       !doBalcao.ok && doBalcao.motivo === 'sem_permissao',
       doBalcao.ok ? 'CONFIRMOU!' : doBalcao.motivo)

    // 5. E a proposta continua de pé, esperando quem pode.
    const aindaLa = await comoOrg(A, (db) =>
      db.propostaAgente.findUnique({ where: { id: p.id }, select: { situacao: true } }),
    )
    ok('e a proposta continua esperando', aindaLa?.situacao === 'AGUARDANDO', aindaLa?.situacao)

    // 6. A dona confirma, e a conta nasce de verdade.
    const antes = await comoOrg(A, (db) => db.lancamento.count())
    const r = await responderProposta(dona.sessao, empresa, p.id, true)
    const depois = await comoOrg(A, (db) => db.lancamento.count())
    ok('a dona confirma e a conta entra no financeiro',
       r.ok && depois === antes + 1, r.ok ? `${antes} -> ${depois}` : r.motivo)

    // 7. O livro guarda que a ideia foi do agente.
    const noLivro = await comoOrg(A, (db) =>
      db.auditoria.findFirst({
        where: { acao: 'agente.proposta.confirmou', alvoId: p.id },
        select: { autor: true, quem: true },
      }),
    )
    ok('e o livro registra que quem propos foi o agente',
       noLivro?.autor === 'AGENTE' && noLivro?.quem === 'Ana',
       `${noLivro?.autor} / confirmado por ${noLivro?.quem}`)

    // 8. Duas confirmações não viram duas contas.
    const deNovo = await responderProposta(dona.sessao, empresa, p.id, true)
    const final = await comoOrg(A, (db) => db.lancamento.count())
    ok('confirmar duas vezes NAO lanca duas vezes',
       !deNovo.ok && deNovo.motivo === 'ja_respondida' && final === depois,
       deNovo.ok ? 'LANCOU DE NOVO!' : `${final} lancamentos`)
  }
}



// ── clientes ─────────────────────────────────────────────────
console.log('\n  Clientes\n')

{
  const dona = await entrar('exemplo', 'ana@exemplo.com', 'exemplo-2026')
  const balconista = await entrar('exemplo', 'carlos@exemplo.com', 'exemplo-2026')

  if (dona.ok && balconista.ok) {
    // Só o nome é obrigatório: exigir CPF faria a vendedora desistir e vender
    // sem cliente — e aí nao existe historico nem "cliente sumido".
    const so = await criarCliente(dona.sessao, { nome: 'Cliente so com nome' })
    ok('cliente nasce so com o nome', so.ok, so.ok ? so.clienteId.slice(0, 8) : so.motivo)

    // CPF errado é recusado ANTES de virar nota fiscal recusada pela SEFAZ.
    const cpfRuim = await criarCliente(dona.sessao, { nome: 'CPF errado', documento: '529.982.247-26' })
    ok('CPF com digito errado e recusado', !cpfRuim.ok, cpfRuim.ok ? 'PASSOU!' : cpfRuim.motivo)

    // Telefone digitado de outro jeito é a MESMA pessoa.
    const p1 = await criarCliente(dona.sessao, { nome: 'Fulana', telefone: '(71) 98888-7777' })
    const p2 = await criarCliente(dona.sessao, { nome: 'Fulana de novo', telefone: '71988887777' })
    ok('o mesmo telefone escrito diferente NAO vira segundo cadastro',
       p1.ok && !p2.ok && !!p2.jaExiste,
       p2.ok ? 'DUPLICOU!' : `aponta para ${p2.jaExiste?.nome}`)

    // O balcão cadastra cliente (é ele que atende), mas não é livre geral.
    const doBalcao = await criarCliente(balconista.sessao, { nome: 'Cliente do balcao' })
    ok('o balcao PODE cadastrar cliente', doBalcao.ok, doBalcao.ok ? 'ok' : doBalcao.motivo)

    // A busca acha por nome e por telefone, com ou sem formatação.
    const porNome = await listarClientes(dona.sessao, 'Marta')
    const porFone = await listarClientes(dona.sessao, '(71) 98881-0001')
    ok('a busca acha por nome', porNome.length > 0, porNome[0]?.nome ?? 'nada')
    ok('e por telefone formatado', porFone.length > 0 && porFone[0]?.nome === porNome[0]?.nome,
       porFone[0]?.nome ?? 'nada')

    // O histórico é o que transforma a lista em ferramenta de venda.
    const comHistorico = porNome[0]
    ok('e a lista ja traz quanto a pessoa gastou',
       !!comHistorico && comHistorico.compras > 0 && comHistorico.gastou > 0,
       comHistorico ? `${comHistorico.compras} compras, R$ ${comHistorico.gastou.toFixed(2)}` : 'sem')
  }
}

// ── equipe ───────────────────────────────────────────────────
console.log('\n  Equipe\n')

{
  const dona = await entrar('exemplo', 'ana@exemplo.com', 'exemplo-2026')

  if (dona.ok) {
    const time = await listarEquipe(dona.sessao)
    ok('a lista traz a equipe inteira', time.length > 1, `${time.length} pessoa(s)`)

    const carlos = time.find((p) => p.email === 'carlos@exemplo.com')

    // 1. Ninguém mexe no próprio acesso. Sem isso, a única dona se rebaixa
    //    sem querer e ninguém mais consegue desfazer.
    const emMim = await mudarAcesso(dona.sessao, dona.sessao.usuarioId, {
      papel: 'BALCAO',
      unidadeId: null,
    })
    ok('ninguem muda o proprio acesso', !emMim.ok, emMim.ok ? 'MUDOU!' : emMim.motivo)

    const euMesma = await mudarSituacao(dona.sessao, dona.sessao.usuarioId, false)
    ok('nem se desativa', !euMesma.ok, euMesma.ok ? 'DESATIVOU!' : euMesma.motivo)

    // 2. Mudar papel corta a sessão de quem foi mudado.
    const nasceu = new Date()
    await new Promise((r) => setTimeout(r, 5))
    const promovido = await mudarAcesso(dona.sessao, carlos!.id, {
      papel: 'GERENTE',
      unidadeId: 'uni-a1',
    })
    ok('a dona promove o balconista a gerente', promovido.ok,
       promovido.ok ? 'GERENTE em uni-a1' : promovido.motivo)

    const dele = await comoOrg(A, (db) =>
      db.usuario.findUnique({
        where: { id: carlos!.id },
        select: { ativo: true, sessoesDesde: true },
      }),
    )
    ok('e o cookie antigo dele deixa de valer na hora',
       !sessaoAindaVale(dele, nasceu), `corte ${dele?.sessoesDesde.toISOString()}`)

    // 3. O gerente NÃO promove ninguém a dono — nem a gerente.
    const gerente = await entrar('exemplo', 'carlos@exemplo.com', 'exemplo-2026')
    if (gerente.ok) {
      const tentando = await mudarAcesso(gerente.sessao, 'usr-a3', { papel: 'DONO', unidadeId: null })
      ok('o gerente NAO cria dono', !tentando.ok, tentando.ok ? 'CRIOU!' : tentando.motivo)

      const aindaMenos = await mudarAcesso(gerente.sessao, 'usr-a3', { papel: 'GERENTE', unidadeId: 'uni-a1' })
      ok('nem outro gerente', !aindaMenos.ok, aindaMenos.ok ? 'CRIOU!' : aindaMenos.motivo)
    }

    // 4. A empresa nunca fica sem dono.
    const donos = await comoOrg(A, (db) =>
      db.acesso.findMany({ where: { papel: 'DONO' }, select: { usuarioId: true } }),
    )
    if (donos.length === 1) {
      // A única dona é a própria Ana, e ela não mexe em si — então o teste
      // do "último dono" precisa de outra pessoa promovida e rebaixada.
      const outra = await mudarAcesso(dona.sessao, 'usr-a3', { papel: 'DONO', unidadeId: null })
      if (outra.ok) {
        const rebaixando = await mudarAcesso(dona.sessao, 'usr-a3', { papel: 'CONTADOR', unidadeId: null })
        ok('rebaixar um dono quando existe outro E PERMITIDO', rebaixando.ok,
           rebaixando.ok ? 'ok' : rebaixando.motivo)
      }
    }

    // 5. Tirar o acesso não apaga a pessoa nem o que ela fez.
    const vendasDele = await comoOrg(A, (db) =>
      db.venda.count({ where: { vendedorId: carlos!.id } }),
    )
    await mudarSituacao(dona.sessao, carlos!.id, false)
    const depois = await comoOrg(A, (db) =>
      db.usuario.findUnique({ where: { id: carlos!.id }, select: { ativo: true, nome: true } }),
    )
    const vendasDepois = await comoOrg(A, (db) =>
      db.venda.count({ where: { vendedorId: carlos!.id } }),
    )
    ok('tirar o acesso nao apaga a pessoa nem as vendas dela',
       depois?.ativo === false && vendasDepois === vendasDele,
       `${depois?.nome} inativo, ${vendasDepois} venda(s) intactas`)

    // e ele nao entra mais
    const tentandoEntrar = await entrar('exemplo', 'carlos@exemplo.com', 'exemplo-2026')
    ok('e ele nao entra mais', !tentandoEntrar.ok,
       tentandoEntrar.ok ? 'ENTROU!' : tentandoEntrar.motivo)
  }
}

// ── segurança ────────────────────────────────────────────────
// Fica no FIM de propósito: o freio de login bloqueia um e-mail por 15
// minutos, e bloquear no meio faria as checagens seguintes falharem pelo
// motivo errado.
console.log('\n  Segurança\n')

{
  const dona = await entrar('exemplo', 'ana@exemplo.com', 'exemplo-2026')
  const balconista = await entrar('exemplo', 'carlos@exemplo.com', 'exemplo-2026')

  if (dona.ok && balconista.ok) {
    // Uma peça qualquer com preço e estoque, na loja do balconista.
    const peca = await comoOrg(A, (db) =>
      db.variacao.findFirst({
        where: { estoques: { some: { unidadeId: 'uni-a1', quantidade: { gt: 5 } } } },
        select: { id: true, ajustePreco: true, produto: { select: { nome: true, precoVista: true } } },
      }),
    )
    const tabela = Number(peca?.produto.precoVista ?? 0) + Number(peca?.ajustePreco ?? 0)

    if (peca && tabela > 0) {
      // 1. O preço que chega do navegador não pode ser inventado.
      const roubo = await registrarVenda(balconista.sessao, {
        unidadeId: 'uni-a1',
        itens: [{ variacaoId: peca.id, quantidade: 1, precoUnit: 0.01 }],
        pagamentos: [{ forma: 'DINHEIRO', valor: 0.01 }],
      })
      ok('balcao NAO vende a R$ 0,01 uma peca de tabela',
         !roubo.ok && roubo.motivo === 'desconto_acima_do_teto',
         roubo.ok ? 'PASSOU!' : `recusado: ${roubo.motivo}`)

      // 2. Mas desconto pequeno, dentro do teto da empresa, passa.
      const dentro = Math.round(tabela * 0.95 * 100) / 100
      const legitimo = await registrarVenda(balconista.sessao, {
        unidadeId: 'uni-a1',
        itens: [{ variacaoId: peca.id, quantidade: 1, precoUnit: dentro }],
        pagamentos: [{ forma: 'DINHEIRO', valor: dentro }],
      })
      ok('mas 5% de desconto passa (teto da empresa e 10%)', legitimo.ok,
         legitimo.ok ? `R$ ${legitimo.total.toFixed(2)}` : legitimo.motivo)

      // 3. Quem tem a capacidade passa do teto.
      const metade = Math.round(tabela * 0.5 * 100) / 100
      const daDonaComDesconto = await registrarVenda(dona.sessao, {
        unidadeId: 'uni-a1',
        itens: [{ variacaoId: peca.id, quantidade: 1, precoUnit: metade }],
        pagamentos: [{ forma: 'DINHEIRO', valor: metade }],
      })
      ok('a dona da 50% porque tem venda.desconto', daDonaComDesconto.ok,
         daDonaComDesconto.ok ? `R$ ${daDonaComDesconto.total.toFixed(2)}` : daDonaComDesconto.motivo)

      // 4. E o desconto fica escrito no livro, com o número.
      const noLivro = await comoOrg(A, (db) =>
        db.auditoria.findFirst({
          where: { acao: 'venda.registrou', motivo: { not: null } },
          orderBy: { criadoEm: 'desc' },
          select: { motivo: true },
        }),
      )
      ok('e o desconto entra no livro de auditoria',
         !!noLivro?.motivo?.startsWith('desconto'), noLivro?.motivo ?? 'nada')

      // 5. Preço acima da tabela não vira cobrança a mais no cliente.
      const dobro = Math.round(tabela * 2 * 100) / 100
      const caro = await registrarVenda(balconista.sessao, {
        unidadeId: 'uni-a1',
        itens: [{ variacaoId: peca.id, quantidade: 1, precoUnit: dobro }],
        pagamentos: [{ forma: 'DINHEIRO', valor: tabela }],
      })
      ok('preco acima da tabela nao cobra a mais — vale a etiqueta', caro.ok,
         caro.ok ? `cobrou R$ ${caro.total.toFixed(2)} (tabela R$ ${tabela.toFixed(2)})` : caro.motivo)
    }

    // 6. Corte de sessão: o cookie de antes do corte deixa de valer.
    const nasceu = new Date()
    await new Promise((r) => setTimeout(r, 5))
    await cortarSessoes(A, balconista.sessao.usuarioId)
    const depois = await comoOrg(A, (db) =>
      db.usuario.findUnique({
        where: { id: balconista.sessao.usuarioId },
        select: { ativo: true, sessoesDesde: true },
      }),
    )
    ok('cortar sessoes derruba o cookie que ja estava aberto',
       !sessaoAindaVale(depois, nasceu), `corte ${depois?.sessoesDesde.toISOString()}`)
  }

  // 7. O freio: erro seguido bloqueia, e a senha CERTA continua recusada.
  for (let i = 0; i < MAX_POR_EMAIL; i++) {
    await entrar('exemplo', 'carlos@exemplo.com', 'senha-errada')
  }
  const travado = await entrar('exemplo', 'carlos@exemplo.com', 'exemplo-2026')
  ok(`${MAX_POR_EMAIL} erros seguidos travam a conta`,
     !travado.ok && travado.motivo === 'muitas_tentativas',
     travado.ok ? 'ENTROU!' : RECADO[travado.motivo])

  // 8. E o freio não conta só quem existe — senão ele mesmo entregaria a
  //    lista de e-mails da empresa.
  for (let i = 0; i < MAX_POR_EMAIL; i++) {
    await entrar('exemplo', 'ninguem@exemplo.com', 'chute')
  }
  const inexistente = await entrar('exemplo', 'ninguem@exemplo.com', 'chute')
  ok('e-mail que NAO existe trava igual (nao entrega quem tem conta)',
     !inexistente.ok && inexistente.motivo === 'muitas_tentativas',
     inexistente.ok ? 'ENTROU!' : inexistente.motivo)

  // 9. Travar uma conta não trava a empresa inteira.
  const outra = await entrar('exemplo', 'ana@exemplo.com', 'exemplo-2026')
  ok('mas a dona continua entrando normalmente', outra.ok,
     outra.ok ? outra.sessao.nome : RECADO[outra.motivo])
}


await fechar()

console.log(
  falhas === 0
    ? '\n  Tudo isolado. (escritas bloqueadas: npm test)\n'
    : `\n  ${falhas} falha(s). NÃO subir nada assim.\n`,
)
process.exit(falhas === 0 ? 0 : 1)
