import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { escolherUnidade } from '@/servidor/unidade'
import { caixaAberto, conferirCaixa } from '@/servidor/caixa'
import { listarVendedores } from '@/servidor/equipe'
import { configCrediario } from '@/servidor/crediario'
import { minhaMeta, mesChave } from '@/servidor/metas'
import { moduloLigado, RAMOS } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso } from '@/ui/base'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import type { Tema } from '@/ui/TrocaTema'
import { Balcao } from './Balcao'
import { BalcaoSimples } from './BalcaoSimples'
import { lerModo } from '@/servidor/modo'
import { BarraCaixa } from './BarraCaixa'
import { comoOrg } from '@/servidor/banco'
import { programaNoPlano, DESLIGADO } from '@/servidor/pontos'
import { AbrirCaixa, FecharCaixa, Movimento } from './Caixa'

export default async function BalcaoPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; caixa?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, caixa: aba } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'venda.criar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // Vender é sempre EM uma loja — não existe venda "consolidada". Por isso
  // aqui o seletor nunca cai em "todas": pega a primeira que a pessoa alcança.
  const onde = await escolherUnidade(sessao, empresa, pedida, 'venda.criar')
  const unidadeId = onde.unidadeId ?? onde.opcoes[0]?.id ?? null
  const unidadeNome = onde.opcoes.find((u) => u.id === unidadeId)?.nome ?? ''

  // O programa de pontos vem do servidor junto com a tela. A conta de quanto
  // a pessoa pode abater roda no navegador, para responder no ato — mas ela é
  // refeita no servidor na hora de fechar, porque o que vem do navegador é
  // pedido, nunca ordem.
  const conf = await comoOrg(sessao.orgId, (db) =>
    db.org.findUnique({
      where: { id: sessao.orgId },
      select: { pontosAtivo: true, pontosPorReal: true, pontoVale: true, pontosMinimo: true, balcaoGrade: true, plano: true, ramo: true },
    }),
  )
  // O programa que o PLANO libera: sem isso a tela prometeria "ganha X pontos"
  // num plano em que o servidor não credita ponto nenhum.
  const programa = conf ? programaNoPlano(conf) : DESLIGADO

  // Botões ou busca é decisão da LOJA, não da empresa: a mesma empresa pode
  // ter a loja de roupa (bipa etiqueta) e a sorveteria (toca no picolé). Loja
  // com ramo próprio segue o ramo; sem ramo, vale a escolha da empresa em
  // Configurações. Uma consulta depois da outra — ver acoes.ts, `grade`.
  const loja = unidadeId
    ? await comoOrg(sessao.orgId, (db) =>
        db.unidade.findUnique({ where: { id: unidadeId }, select: { ramo: true } }),
      )
    : null
  const ramoDaLoja = loja?.ramo && loja.ramo in RAMOS ? RAMOS[loja.ramo as keyof typeof RAMOS] : null
  const usaGrade = ramoDaLoja ? ramoDaLoja.balcao === 'grade' : (conf?.balcaoGrade ?? false)
  // O ramo que vale para os ATALHOS do balcão simples (teclas de peso,
  // complementos): o da loja, senão o da empresa. Não muda regra de venda —
  // ver ramo.ts.
  const ramo = loja?.ramo && loja.ramo in RAMOS ? loja.ramo : conf?.ramo && conf.ramo in RAMOS ? conf.ramo : null

  const caixa = unidadeId ? await caixaAberto(sessao, unidadeId) : null
  const conferencia = caixa ? await conferirCaixa(sessao, caixa.id) : null

  const podeOperarCaixa = unidadeId ? pode(sessao, 'caixa.operar', unidadeId) : false

  // "Quem vendeu" só existe com o módulo de metas: sem meta e sem comissão,
  // a pergunta não tem para que servir, e o seletor seria mais um campo.
  const vendedores =
    unidadeId && moduloLigado(empresa, 'metas') ? await listarVendedores(sessao, unidadeId) : null

  const podeAvulso = unidadeId ? pode(sessao, 'venda.desconto', unidadeId) : false

  // Crediário só existe com o módulo: sem ele, a forma nem aparece.
  const crediario = moduloLigado(empresa, 'crediario')
    ? { maxParcelas: (await configCrediario(sessao)).maxParcelas }
    : null

  // A meta de quem está no caixa, na barra: "faltam R$ 800" é o que faz a
  // meta existir durante o dia, e não só no dia 30.
  const meta = moduloLigado(empresa, 'metas') ? await minhaMeta(sessao, mesChave(new Date())) : null

  // O modo é do APARELHO (ver servidor/modo.ts): o computador do balcão fica
  // no simples, e vende por cartões grandes; o notebook do dono, no avançado,
  // vende por busca e tabela. A venda é a mesma — muda só a cara.
  const simples = (await lerModo()) === 'simples'
  // A venda do simples ocupa a janela inteira: a moldura vira trilho de
  // ícones e não rola — quem rola são as colunas do balcão. Só na tela de
  // venda: abrir e fechar o caixa são páginas comuns, que rolam.
  const telaDeVenda = simples && !!unidadeId && !!caixa && aba !== 'fechar'

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/balcao`}
      tema={tema}
      titulo={aba === 'fechar' ? 'Fechar o caixa' : 'Balcão'}
      recolhida={telaDeVenda}
      acao={
        onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={unidadeId} /> : undefined
      }
    >
      {!unidadeId ? (
        <Aviso nivel="atencao">
          Você não tem acesso de venda em nenhuma unidade. Peça para quem responde pela
          empresa liberar.
        </Aviso>
      ) : !caixa ? (
        podeOperarCaixa ? (
          <AbrirCaixa slug={slug} unidadeId={unidadeId} unidadeNome={unidadeNome} />
        ) : (
          <Aviso nivel="atencao">
            O caixa desta loja está fechado, e só quem opera o caixa pode abrir. Chame o
            gerente.
          </Aviso>
        )
      ) : aba === 'fechar' ? (
        <div className="flex flex-col gap-4">
          <FecharCaixa slug={slug} caixaId={caixa.id} conferencia={conferencia!} />
          <Movimento slug={slug} caixaId={caixa.id} />
        </div>
      ) : simples ? (
        <BalcaoSimples
          slug={slug}
          unidadeId={unidadeId}
          usuarioId={sessao.usuarioId}
          caixaId={caixa.id}
          unidadeNome={unidadeNome}
          ramo={ramo}
          programa={programa}
          vendedores={vendedores}
          podeAvulso={podeAvulso}
          crediario={crediario}
          colada
          barra={
            <BarraCaixa
              compacta
              slug={slug}
              unidadeId={unidadeId}
              caixa={caixa}
              conferencia={conferencia!}
              podeOperar={podeOperarCaixa}
              meta={meta && meta.valor > 0 ? { valor: meta.valor, vendido: meta.vendido } : null}
            />
          }
        />
      ) : (
        <>
          <BarraCaixa
            slug={slug}
            unidadeId={unidadeId}
            caixa={caixa}
            conferencia={conferencia!}
            podeOperar={podeOperarCaixa}
            meta={meta && meta.valor > 0 ? { valor: meta.valor, vendido: meta.vendido } : null}
          />
          <Balcao
            slug={slug}
            unidadeId={unidadeId}
            usuarioId={sessao.usuarioId}
            grade={usaGrade}
            caixaId={caixa.id}
            unidadeNome={unidadeNome}
            programa={programa}
            vendedores={vendedores}
            podeAvulso={podeAvulso}
            crediario={crediario}
          />
        </>
      )}
    </Estrutura>
  )
}
