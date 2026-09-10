// O exemplo: duas empresas, a equipe delas e o movimento de trinta dias.
//
// Mora aqui, e não dentro do preparar-banco, porque DOIS lugares precisam
// dele. O preparar cria o exemplo quando o banco nasce; a conferência recria
// o exemplo a cada rodada. E ela precisa recriar: as checagens leem quanto
// tem em estoque e vendem em cima disso, então uma rodada gasta o estoque da
// próxima. Rodando duas vezes seguidas, a segunda reprovava "venda baixa o
// estoque" sem nenhum defeito no sistema — e defeito falso cansa quem lê e
// acaba com a lista inteira sendo ignorada.

import type { Client } from 'pg'
import { guardarSenha } from '../src/servidor/senha'
import { semearCatalogo } from './exemplo-catalogo'
import { semearVendas } from './exemplo-vendas'
import { semearFinanceiro } from './exemplo-financeiro'
import { semearAgente } from './exemplo-agente'
import { semearClientes } from './exemplo-clientes'
import { CATEGORIAS_PADRAO } from '../src/servidor/financeiro'

export const ORG_A = 'org-exemplo-a'
export const ORG_B = 'org-exemplo-b'
export const SENHA_EXEMPLO = 'exemplo-2026'

/** Apaga as duas empresas de exemplo. O cascade leva junto tudo que é delas. */
export async function apagarExemplo(cliente: Client) {
  await cliente.query('delete from orgs where id = any($1)', [[ORG_A, ORG_B]])
}

export async function semearExemplo(cliente: Client, passo: (t: string) => void) {
  // ── 4. exemplo ───────────────────────────────────────────────
  // A pergunta certa é "as DUAS de exemplo existem?", e não "a tabela está
  // vazia?".
  //
  // Era a segunda, e o efeito só apareceu quando passou a existir empresa de
  // verdade no laptop: a conferência apaga as duas de exemplo, chega aqui,
  // encontra a tabela NÃO vazia por causa da outra empresa, decide que não
  // precisa semear — e o passo seguinte tenta gravar catálogo numa empresa que
  // acabou de ser apagada. O erro sai lá na frente, como violação de chave
  // estrangeira em `eixos`, sem dizer nada sobre a causa.
  const { rows } = await cliente.query<{ n: string }>(
    'select count(*)::int as n from orgs where id = any($1)',
    [[ORG_A, ORG_B]],
  )
  if (Number(rows[0]!.n) === 0) {
    passo('duas empresas de exemplo...')
    await cliente.query(`
      insert into orgs (id, nome, slug, plano, situacao, cor_marca, ramo, modulos,
                        configurada_em, telefone, criada_em, atualizada_em) values
        -- A NAO usa crediario de proposito: e assim que se ve o menu encolher.
        ('org-exemplo-a', 'Comércio Exemplo', 'exemplo', 'BALCAO_AGENTE', 'ATIVA', '#0D4A57',
         'roupa', ARRAY['agente','metas','multiUnidade'], now(), '(71) 99999-0000', now(), now()),
        ('org-exemplo-b', 'Empresa Vizinha', 'vizinha', 'REDE', 'ATIVA', '#7A4B12',
         'sorveteria', ARRAY['crediario','notaFiscal','multiUnidade'], now(), null, now(), now());

      -- A de exemplo tem programa de pontos ligado; a Vizinha nao. E assim que
      -- se ve, lado a lado, o balcao com e sem a oferta de pontos na tela.
      update orgs set pontos_ativo = true, pontos_por_real = 1, ponto_vale = 0.03,
                      pontos_minimo = 100
                where id = 'org-exemplo-a';

      -- Duas recargas, com o saldo andando de verdade.
      insert into recargas_ia (id, org_id, centavos, saldo_depois, tipo, origem, motivo, quem, criado_em) values
        ('rec-a1', 'org-exemplo-a', 4000, 4000, 'PLANO',  'plano',  'Credito do mes',    'sistema', now() - interval '26 days'),
        ('rec-a2', 'org-exemplo-a', 5000, 9000, 'COMPRA', 'manual', 'Recarga pela tela', 'Ana',     now() - interval '9 days');

      insert into unidades (id, org_id, nome, ativa, eh_deposito, criada_em, atualizada_em) values
        ('uni-a1', 'org-exemplo-a', 'Loja Centro',   true, false, now(), now()),
        ('uni-a2', 'org-exemplo-a', 'Loja Shopping', true, false, now(), now()),
        ('uni-b1', 'org-exemplo-b', 'Loja Sul', true, false, now(), now()),
        ('uni-b2', 'org-exemplo-b', 'Deposito',      true, true,  now(), now());

    `)

    // Senha de exemplo, igual para todo mundo. Só existe em banco local.
    const hash = await guardarSenha(SENHA_EXEMPLO)
    await cliente.query(
      `insert into usuarios (id, org_id, nome, email, senha_hash, ativo, criado_em, atualizado_em) values
        ('usr-a1', 'org-exemplo-a', 'Ana',   'ana@exemplo.com',   $1, true, now(), now()),
        ('usr-a2', 'org-exemplo-a', 'Carlos',   'carlos@exemplo.com',   $1, true, now(), now()),
        ('usr-a3', 'org-exemplo-a', 'Contador','contador@exemplo.com',$1, true, now(), now()),
        ('usr-a4', 'org-exemplo-a', 'Antiga',  'antiga@exemplo.com',  $1, false, now(), now()),
        ('usr-b1', 'org-exemplo-b', 'Vizinho', 'vizinho@exemplo.com', $1, true, now(), now())`,
      [hash],
    )

    await cliente.query(`
      insert into acessos (id, org_id, usuario_id, unidade_id, papel, criado_em) values
        ('acs-a1', 'org-exemplo-a', 'usr-a1', null,     'DONO',     now()),
        ('acs-a2', 'org-exemplo-a', 'usr-a2', 'uni-a1', 'BALCAO',   now()),
        ('acs-a3', 'org-exemplo-a', 'usr-a3', null,     'CONTADOR', now()),
        ('acs-b1', 'org-exemplo-b', 'usr-b1', null,     'DONO',     now());
    `)
    // 'usr-a4' fica de proposito SEM acesso: e o caso "conta existe, senha bate,
    // mas nao tem papel em lugar nenhum".
  } else {
    passo('as empresas de exemplo já existem — não foram tocadas')
  }

  if (await semearCatalogo(cliente, 'org-exemplo-a', 'uni-a1')) {
    passo('catálogo de exemplo (camiseta com grade + sorvete por quilo)...')
    // A segunda loja começa com a mesma carga, para o filtro ter os dois lados.
    await cliente.query(`
      insert into estoque (id, org_id, variacao_id, unidade_id, quantidade, minimo, atualizado_em)
      select 'est2-' || v.id, v.org_id, v.id, 'uni-a2', 40, 3, now()
        from variacoes v where v.org_id = 'org-exemplo-a';
      insert into movimentos_estoque
        (id, org_id, variacao_id, unidade_id, tipo, quantidade, saldo_depois, motivo, quem, criado_em)
      select 'mov2-' || v.id, v.org_id, v.id, 'uni-a2', 'ENTRADA', 40, 40,
             'Carga inicial do exemplo', 'sistema', now()
        from variacoes v where v.org_id = 'org-exemplo-a';
    `)
  }

  const nVendas = await semearVendas(cliente, 'org-exemplo-a', [
    { id: 'uni-a1', nome: 'Loja Centro', fatia: 3 },
    { id: 'uni-a2', nome: 'Loja Shopping', fatia: 2 },
  ])
  if (nVendas) passo(`${nVendas} vendas de exemplo nos últimos 30 dias...`)

  // Categorias e contas do financeiro. Toda empresa começa com estas — o dono
  // renomeia e acrescenta, mas ninguém deveria ter que montar do zero.
  const { rows: temCat } = await cliente.query<{ n: string }>(
    "select count(*)::int as n from categorias_financeiras where org_id = 'org-exemplo-a'",
  )
  if (Number(temCat[0]!.n) === 0) {
    for (const [i, c] of CATEGORIAS_PADRAO.entries()) {
      await cliente.query(
        `insert into categorias_financeiras (id, org_id, nome, tipo, grupo, ordem, ativa)
         values ($1,'org-exemplo-a',$2,$3,$4,$5,true)`,
        [`cat-fin-${i}`, c.nome, c.tipo, c.grupo, i],
      )
    }
    await cliente.query(`
      insert into contas_financeiras (id, org_id, nome, tipo, saldo_inicial, ativa) values
        ('conta-caixa', 'org-exemplo-a', 'Caixa da loja',  'CAIXA', 0, true),
        ('conta-banco', 'org-exemplo-a', 'Conta do banco', 'BANCO', 0, true);
    `)
    passo('categorias e contas do financeiro...')
  }

  const nLanc = await semearFinanceiro(cliente, 'org-exemplo-a', 'uni-a1')
  if (nLanc) passo(`${nLanc} lançamentos de exemplo (2 meses + contas a pagar)...`)

  // Depois das vendas: os clientes de exemplo se ligam a vendas que já existem.
  const nCli = await semearClientes(cliente, 'org-exemplo-a')
  if (nCli) passo(`${nCli} clientes de exemplo, com as compras deles...`)

  // Depois do financeiro de propósito: a proposta de compra do agente aponta
  // para uma categoria financeira, e ela precisa existir antes.
  const nRec = await semearAgente(cliente, 'org-exemplo-a')
  if (nRec) passo(`assistente "Aurora" com ${nRec} recibos e uma proposta esperando...`)

  // O saldo de credito nasce da CONTA, nao de um numero escrito na mao.
  // Escrever "1240" aqui e depois semear consumo por fora quebra a identidade
  // "saldo = recargas - consumos" — e a conferencia pega isso na hora, que foi
  // o que aconteceu na primeira versao deste seed.
  await cliente.query(`
    update orgs o set credito_ia_cent =
      coalesce((select sum(r.centavos) from recargas_ia r where r.org_id = o.id), 0)
      - coalesce((select sum(c.cobrado_cent) from consumo_ia c where c.org_id = o.id), 0)
     where o.id = 'org-exemplo-a';
  `)
}
