import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { escolherUnidade } from '@/servidor/unidade'
import { caixaAberto, conferirCaixa } from '@/servidor/caixa'
import { listarVendedores } from '@/servidor/equipe'
import { configCrediario } from '@/servidor/crediario'
import { minhaMeta, mesChave } from '@/servidor/metas'
import { moduloLigado, RAMOS } from '@/servidor/modulos'
import { pode, podeVerPlanos } from '@/servidor/permissao'
import { encomendaParaReceber } from '@/servidor/encomenda'
import { achadosPorVariacao } from './acoes'
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
import { vocabularioDaEmpresa, vocabularioDoEndereco, vocabularioDoRamo } from '@/servidor/vocabulario'
import { programaNoPlano, DESLIGADO } from '@/servidor/pontos'
import { AbrirCaixa, FecharCaixa, Movimento } from './Caixa'
import { paraCobrarHorario } from './acoes'
import { ComPalavras } from './palavras'
import { AvisoVersao } from './AvisoVersao'
import { versaoDoBuild } from './versaoDoBuild'
import { lerMaquininhas } from '@/servidor/maquininhas'
import type { ConfigDoBalcao } from './useVenda'

// "Recepção" na clínica e no salão, "Secretaria" na escola (vocabulario.ts).
export async function generateMetadata({ params }: { params: Promise<{ empresa: string }> }): Promise<Metadata> {
  return { title: (await vocabularioDoEndereco((await params).empresa)).Balcao }
}

export default async function BalcaoPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; caixa?: string; agendamento?: string; encomenda?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, caixa: aba, agendamento, encomenda: encomendaPedida } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'venda.criar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // Vender é sempre EM uma loja — não existe venda "consolidada". Por isso
  // aqui o seletor nunca cai em "todas": pega a primeira que a pessoa alcança.
  //
  // E só LOJA: depósito guarda estoque, não tem balcão. Ele saía no seletor
  // (e às vezes como a única opção), abria caixa e vendia — baixando estoque
  // de onde ninguém atende. O servidor recusa de novo (`loja_nao_vende`).
  const escolha = await escolherUnidade(sessao, empresa, pedida, 'venda.criar')
  const lojas = escolha.opcoes.filter((u) => !u.ehDeposito)
  const onde = {
    ...escolha,
    opcoes: lojas,
    unidadeId: escolha.unidadeId && lojas.some((u) => u.id === escolha.unidadeId) ? escolha.unidadeId : null,
    mostrarSeletor: escolha.mostrarSeletor && lojas.length > 1,
  }
  const unidadeId = onde.unidadeId ?? onde.opcoes[0]?.id ?? null
  const unidadeNome = onde.opcoes.find((u) => u.id === unidadeId)?.nome ?? ''

  // "Receber no balcão", vindo de Encomendas: a linha do que falta entra no
  // pedido. Aqui é só para MOSTRAR — a venda lê a encomenda de novo, travada.
  const recebendo =
    unidadeId && encomendaPedida && /^[\w-]{1,64}$/.test(encomendaPedida)
      ? await encomendaParaReceber(sessao, encomendaPedida, unidadeId)
      : null
  const lida = recebendo?.ok ? recebendo.encomenda : null
  // O pedido do catálogo traz os produtos: eles entram como linhas do pedido.
  const achadosDoPedido = lida && lida.itens.length > 0 && unidadeId ? await achadosPorVariacao(slug, unidadeId, lida.itens.map((i) => i.variacaoId)) : []
  const encomenda = lida
    ? {
        ...lida,
        itens: lida.itens.flatMap((i) => {
          const a = achadosDoPedido.find((x) => x.id === i.variacaoId)
          return a ? [{ achado: a, quantidade: i.quantidade }] : []
        }),
        faltaram: lida.itens.length - lida.itens.filter((i) => achadosDoPedido.some((x) => x.id === i.variacaoId)).length,
      }
    : null
  const veAssinatura = podeVerPlanos(sessao)

  // O programa de pontos vem do servidor junto com a tela. A conta de quanto
  // a pessoa pode abater roda no navegador, para responder no ato — mas ela é
  // refeita no servidor na hora de fechar, porque o que vem do navegador é
  // pedido, nunca ordem.
  const conf = await comoOrg(sessao.orgId, (db) =>
    db.org.findUnique({
      where: { id: sessao.orgId },
      select: {
        pontosAtivo: true, pontosPorReal: true, pontoVale: true, pontosMinimo: true, balcaoGrade: true, plano: true, ramo: true,
        vendeSemEstoque: true, creditoMaxParcelas: true, creditoJurosPct: true,
      },
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
        db.unidade.findUnique({ where: { id: unidadeId }, select: { ramo: true, maquininhas: true } }),
      )
    : null
  const ramoDaLoja = loja?.ramo && loja.ramo in RAMOS ? RAMOS[loja.ramo as keyof typeof RAMOS] : null
  const usaGrade = ramoDaLoja ? ramoDaLoja.balcao === 'grade' : (conf?.balcaoGrade ?? false)
  // O ramo que vale para os ATALHOS do balcão simples (teclas de peso,
  // complementos): o da loja, senão o da empresa. Não muda regra de venda —
  // ver ramo.ts.
  const ramo = loja?.ramo && loja.ramo in RAMOS ? loja.ramo : conf?.ramo && conf.ramo in RAMOS ? conf.ramo : null
  // E as PALAVRAS da tela: na recepção da clínica o botão diz "Concluir
  // atendimento", e o catálogo, "serviço". Pelo mesmo ramo — o da loja.
  const palavras = vocabularioDoRamo(ramo)

  const caixa = unidadeId ? await caixaAberto(sessao, unidadeId) : null

  // "Atender e cobrar", vindo da Agenda: o serviço e o cliente do horário já
  // entram na venda. Só com a Agenda ligada, e só o horário desta loja que
  // ainda não foi cobrado — o resto cai no balcão de sempre.
  const inicial =
    unidadeId && typeof agendamento === 'string' && moduloLigado(empresa, 'agenda')
      ? await paraCobrarHorario(slug, agendamento, unidadeId)
      : null
  const conferencia = caixa ? await conferirCaixa(sessao, caixa.id) : null

  const podeOperarCaixa = unidadeId ? pode(sessao, 'caixa.operar', unidadeId) : false
  // Quanto a loja vendeu e quanto deveria ter na gaveta são números de dono
  // (ver o Painel em ui/menu.ts). Quem opera o caixa conta a gaveta às cegas.
  const veReceita = unidadeId ? pode(sessao, 'relatorio.ver', unidadeId) : false
  // O que vai para a barra. Sem `relatorio.ver`, os valores nem saem do
  // servidor: esconder só na tela deixaria o esperado no HTML da página.
  const naBarra = conferencia
    ? {
        vendas: conferencia.vendas,
        vendidoTotal: veReceita ? conferencia.vendidoTotal : 0,
        esperado: veReceita ? conferencia.esperado : 0,
      }
    : null

  // "Quem vendeu" só existe com o módulo de metas: sem meta e sem comissão,
  // a pergunta não tem para que servir, e o seletor seria mais um campo.
  const vendedores =
    unidadeId && moduloLigado(empresa, 'metas') ? await listarVendedores(sessao, unidadeId) : null

  // O avulso é de todo mundo que vende: quem não pode passar do teto lança
  // e, ao concluir, a venda pede o PIN de quem pode (ver autorizacao.ts).
  const precisaPin = unidadeId ? !pode(sessao, 'venda.desconto', unidadeId) : true
  const podeAvulso = true

  // Crediário só existe com o módulo: sem ele, a forma nem aparece.
  // `receber`: quem opera aqui recebe parcela (o aviso "ela já deve" aparece
  // para todos; o botão de receber, só para quem pode).
  const crediario = moduloLigado(empresa, 'crediario')
    ? await configCrediario(sessao).then((c) => ({
        maxParcelas: c.maxParcelas,
        diasEntre: c.diasEntre,
        receber: unidadeId ? pode(sessao, 'crediario.receber', unidadeId) : false,
      }))
    : null

  // As regras desta loja que a tela precisa saber para perguntar a coisa
  // certa. O servidor confere tudo de novo ao fechar.
  const config: ConfigDoBalcao = {
    // Antes de escolher a forma, o preço mais caro que a loja cobra — e,
    // embaixo, quanto se economiza à vista (ver conta.ts).
    semForma: crediario ? 'crediario' : 'cartao',
    vendeSemEstoque: !!conf?.vendeSemEstoque,
    maquininhas: lerMaquininhas(loja?.maquininhas),
    credito: { maxParcelas: conf?.creditoMaxParcelas ?? 1, jurosPct: Number(conf?.creditoJurosPct ?? 0) },
  }

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
      titulo={aba === 'fechar' ? 'Fechar o caixa' : (await vocabularioDaEmpresa(sessao.orgId)).Balcao}
      recolhida={telaDeVenda}
      acao={
        onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={unidadeId} /> : undefined
      }
    >
      <ComPalavras palavras={palavras}>
        {/* O balcão fica aberto o dia todo: subiu versão nova, ele avisa. */}
        <AvisoVersao slug={slug} versao={versaoDoBuild()} />
        {recebendo && !recebendo.ok && aba !== 'fechar' && <Aviso nivel="atencao">{recebendo.erro}</Aviso>}
        {!unidadeId ? (
          <Aviso nivel="atencao">
            {escolha.opcoes.length > 0
              ? 'Aqui só há depósito, e depósito não vende. Para vender, a empresa precisa de uma loja.'
              : 'Você não tem acesso de venda em nenhuma unidade. Peça para quem responde pela empresa liberar.'}
          </Aviso>
        ) : aba === 'fechar' && podeOperarCaixa ? (
          // ANTES do "caixa fechado → abrir": fechar atualiza a página, e o
          // caixa some dela. Se este ramo dependesse do caixa aberto, a tela do
          // fechamento (a conta, o "Imprimir o fechamento", o "Sair da minha
          // conta") era trocada pelo "Abrir o caixa" no mesmo instante. Aqui
          // ela continua montada, no mesmo lugar, e mostra a conta.
          <div className="flex flex-col gap-4">
            <FecharCaixa
              slug={slug}
              caixaId={caixa?.id ?? null}
              hrefBalcao={`/${slug}/balcao${onde.unidadeId ? `?unidade=${onde.unidadeId}` : ''}`}
              turno={
                caixa && conferencia
                  ? {
                      vendas: conferencia.vendas,
                      // Cartão e Pix por maquininha (vendas e crediário juntos);
                      // fiado e vale à parte — não passam por máquina nenhuma.
                      maquininhas: conferencia.maquininhas,
                      semMaquininha: conferencia.porForma.filter((f) => f.forma === 'CREDIARIO' || f.forma === 'VALE'),
                    }
                  : null
              }
            />
            {caixa && <Movimento slug={slug} caixaId={caixa.id} />}
          </div>
        ) : !caixa ? (
          podeOperarCaixa ? (
            <AbrirCaixa slug={slug} unidadeId={unidadeId} unidadeNome={unidadeNome} />
          ) : (
            <Aviso nivel="atencao">
              O caixa desta loja está fechado, e só quem opera o caixa pode abrir. Chame o
              gerente.
            </Aviso>
          )
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
            inicial={inicial}
            encomenda={encomenda}
            veAssinatura={veAssinatura}
            config={config}
            precisaPin={precisaPin}
            colada
            barra={
              <BarraCaixa
                compacta
                slug={slug}
                unidadeId={unidadeId}
                caixa={caixa}
                conferencia={naBarra!}
                podeOperar={podeOperarCaixa}
                veReceita={veReceita}
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
              conferencia={naBarra!}
              podeOperar={podeOperarCaixa}
              veReceita={veReceita}
              meta={meta && meta.valor > 0 ? { valor: meta.valor, vendido: meta.vendido } : null}
            />
            <Balcao
              slug={slug}
              unidadeId={unidadeId}
              usuarioId={sessao.usuarioId}
              grade={usaGrade}
              ramo={ramo}
              caixaId={caixa.id}
              unidadeNome={unidadeNome}
              programa={programa}
              vendedores={vendedores}
              podeAvulso={podeAvulso}
              crediario={crediario}
              inicial={inicial}
              encomenda={encomenda}
              veAssinatura={veAssinatura}
              config={config}
              precisaPin={precisaPin}
            />
          </>
        )}
      </ComPalavras>
    </Estrutura>
  )
}
