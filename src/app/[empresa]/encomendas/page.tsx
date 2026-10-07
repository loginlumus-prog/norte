import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { moduloLigado } from '@/servidor/modulos'
import { pode, suporteEdita } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { escolherUnidade } from '@/servidor/unidade'
import { lerModo } from '@/servidor/modo'
import { mostrarTelefone } from '@/servidor/cliente'
import {
  NIVEL_ENCOMENDA,
  ROTULO_ENCOMENDA,
  ROTULO_FORMA_SINAL,
  acharEncomenda,
  formaSinalValida,
  agrupar,
  diaCurtoSP,
  diaEmSP,
  ehFinal,
  horaEmSP,
  linkWhatsApp,
  listarEncomendas,
  resumoEncomendas,
  type EncomendaNaLista,
  type SituacaoEncomenda,
} from '@/servidor/encomenda'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Secao, Tira, brl } from '@/ui/painel'
import { Aviso, Situacao, Vazio, cx } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { Formulario } from './Formulario'
import { AcoesEncomenda } from './Linha'
import { palavra } from '@/ui/texto'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Encomendas' }

// Encomendas: o que sai depois — bolo para sábado, buquê para as 16h.
//
// A lista abre pelo que vence primeiro, em faixas (Atrasadas, Hoje, Amanhã,
// Esta semana, Depois), porque a pergunta de quem abre é "o que eu tenho de
// entregar agora?". Atrasada é a primeira faixa e a única vermelha: é o que
// não pode continuar ali.
//
// Filtros no endereço: `?situacao=`, `?unidade=`, `?q=`. Mudar uma encomenda
// é `?editar=<id>`. O link é a tela inteira.
//
// Cada encomenda é um cartão, nos dois modos (ver `cartoes`); no simples, com
// os botões grandes de tocar.

const FILTROS: Record<string, SituacaoEncomenda | 'todas'> = {
  aberta: 'ABERTA',
  pronta: 'PRONTA',
  entregue: 'ENTREGUE',
  cancelada: 'CANCELADA',
  todas: 'todas',
}

export default async function Encomendas({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; situacao?: string; q?: string; editar?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, situacao: sitPedida, q: qBruto, editar } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'venda.ver' })
  // Módulo desligado: a tela não existe para esta empresa — igual ao menu.
  if (!moduloLigado(empresa, 'encomenda')) semAcesso(slug, 'modulo-encomenda')

  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const simples = (await lerModo()) === 'simples'
  const agora = new Date()
  const q = (qBruto ?? '').trim().slice(0, 80)
  const chaveFiltro = sitPedida && Object.hasOwn(FILTROS, sitPedida) ? sitPedida : null
  const situacao = chaveFiltro ? FILTROS[chaveFiltro]! : 'abertas'

  // Uma consulta de cada vez: cada uma abre a própria transação, e a regra
  // da casa é não paralelizar o que fala com o banco.
  const onde = await escolherUnidade(sessao, empresa, pedida, 'venda.ver')
  const lista = await listarEncomendas(sessao, { unidadeIds: onde.ids, situacao, q })
  const resumo = await resumoEncomendas(sessao, onde.ids, agora)
  const editando = editar && /^[\w-]{1,64}$/.test(editar) ? await acharEncomenda(sessao, editar) : null

  // Só loja que atende cliente: depósito e fábrica não recebem encomenda (o
  // servidor recusa de novo — ver `criarEncomenda`).
  const fabricas = await comoOrg(sessao.orgId, (db) => db.unidade.findMany({ where: { ehFabrica: true }, select: { id: true } }))
  const lojasParaAnotar = onde.opcoes
    .filter((u) => (onde.unidadeId ? u.id === onde.unidadeId : true))
    .filter((u) => !u.ehDeposito && !fabricas.some((f) => f.id === u.id))
    .filter((u) => pode(sessao, 'venda.criar', u.id))
  const podeAnotar = lojasParaAnotar.length > 0
  const podeBuscarCliente = pode(sessao, 'cliente.ver')
  const variasLojas = onde.opcoes.length > 1 && onde.unidadeId === null

  const atuais = { unidade: onde.unidadeId, situacao: chaveFiltro, q }
  const link = (m: Record<string, string | null>) => enderecoCom(`/${slug}/encomendas`, atuais, m)
  const grupos = agrupar(lista, agora)

  // A bolinha do menu: as atrasadas, em vermelho. É o que precisa de alguém.
  const menu = MENU(slug).map((i) =>
    i.href === `/${slug}/encomendas` && resumo.atrasadas > 0
      ? { ...i, aviso: { quantos: resumo.atrasadas, nivel: 'critico' as const, titulo: palavra(resumo.atrasadas, 'atrasada', 'atrasadas') } }
      : i,
  )

  const atrasada = (e: EncomendaNaLista) => !ehFinal(e.situacao) && e.para.getTime() < agora.getTime()

  const pilula = (e: EncomendaNaLista) =>
    e.nova ? (
      <span className="flex flex-wrap gap-1">
        <Situacao nivel="atencao">novo · catálogo</Situacao>
      </span>
    ) : atrasada(e) ? (
      <span className="flex flex-wrap gap-1">
        <Situacao nivel="critico">atrasada</Situacao>
        {e.situacao === 'PRONTA' && <Situacao nivel="atencao">pronta</Situacao>}
      </span>
    ) : (
      <Situacao nivel={NIVEL_ENCOMENDA[e.situacao]}>{ROTULO_ENCOMENDA[e.situacao]}</Situacao>
    )

  // A venda do balcão que recebeu o resto: um link de verdade (é a ligação
  // `Venda.encomendaId`, não texto na observação).
  const recebida = (e: EncomendaNaLista) =>
    e.venda && (
      <Link href={`/${slug}/vendas/${e.venda.id}`} className="text-xs font-medium text-marca hover:underline">
        Recebida no balcão: venda {e.venda.numero}
      </Link>
    )

  // "Pix", "Dinheiro": como o sinal foi pago. Some nas encomendas antigas.
  const formaDoSinal = (e: EncomendaNaLista) =>
    e.sinal > 0 && formaSinalValida(e.sinalForma) ? (
      <span className="text-[12.5px] text-tinta-3">{ROTULO_FORMA_SINAL[e.sinalForma]}</span>
    ) : null

  // O pedido do catálogo: os itens, um por linha, e como a cliente vai pagar.
  const doCatalogo = (e: EncomendaNaLista) =>
    e.origem === 'CATALOGO' && e.itens.length > 0 ? (
      <span className="flex flex-col gap-0.5 text-sm text-tinta-2">
        {e.itens.map((i, n) => (
          <span key={n}>
            <b className="numero font-semibold text-tinta">{i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}×</b> {i.descricao}{' '}
            <span className="numero text-tinta-3">{brl(i.total)}</span>
          </span>
        ))}
        {e.taxaEntrega > 0 && <span>Entrega <span className="numero text-tinta-3">{brl(e.taxaEntrega)}</span></span>}
        <span className="text-xs text-tinta-3">
          Pelo catálogo{e.formaCombinada ? ` · pagamento: ${ROTULO_FORMA_SINAL[e.formaCombinada as keyof typeof ROTULO_FORMA_SINAL] ?? e.formaCombinada}` : ''}
        </span>
      </span>
    ) : null

  const comoSai = (e: EncomendaNaLista) =>
    e.entrega ? (
      <span className="text-sm text-tinta-2">
        <b className="font-semibold text-tinta">Entrega</b> · {e.endereco}
      </span>
    ) : (
      <span className="text-sm text-tinta-2">Retirada na loja</span>
    )

  const acoes = (e: EncomendaNaLista) => (
    <AcoesEncomenda
      slug={slug}
      id={e.id}
      unidadeId={e.unidadeId}
      resumo={`${e.clienteNome} — ${e.descricao}`}
      situacao={e.situacao}
      falta={e.falta}
      sinal={e.sinal}
      sinalForma={formaSinalValida(e.sinalForma) ? e.sinalForma : null}
      podeMexer={pode(sessao, 'venda.criar', e.unidadeId) || suporteEdita(sessao)}
      podeCancelar={pode(sessao, 'venda.cancelar', e.unidadeId)}
      podeVender={pode(sessao, 'venda.criar', e.unidadeId)}
      editarEm={link({ editar: e.id })}
      simples={simples}
      nova={e.nova}
      comProdutos={e.comProdutos}
    />
  )

  // Entregue ou cancelada não tem mais "falta pagar": o resto foi recebido no
  // Balcão, ou o pedido morreu. Mostrar R$ 35 ali faria alguém cobrar de novo.
  const falta = (e: EncomendaNaLista) => (ehFinal(e.situacao) ? '—' : e.falta > 0 ? brl(e.falta) : 'pago')

  // A cor do bloco da hora diz o estado: vermelho atrasada, âmbar pronta,
  // verde entregue — o olho acha a encomenda que pede ação sem ler.
  const tomDaHora = (e: EncomendaNaLista) =>
    atrasada(e) ? 'critico' : e.nova ? 'atencao' : e.situacao === 'PRONTA' ? 'atencao' : e.situacao === 'ENTREGUE' ? 'bom' : e.situacao === 'CANCELADA' ? 'apagada' : 'neutro'

  // Uma encomenda, um cartão — no computador também. Já foi uma tabela de
  // nove colunas: o pedido do catálogo, com os itens um por linha, esticava
  // a linha, os botões empilhavam numa coluna estreita e a tabela rolava de
  // lado. No cartão, cada coisa tem o seu lugar: a hora à esquerda, quem e
  // o quê no meio, o dinheiro e os botões à direita, numa linha só.
  const cartoes = (itens: EncomendaNaLista[]) => (
    <ul className="flex flex-col gap-3">
      {itens.map((e) => (
        <li key={e.id} className="encomenda-cartao caixa-viva rounded-2xl border border-borda bg-superficie">
          <div className="grid gap-4 p-4 sm:grid-cols-[5.5rem_minmax(0,1fr)] lg:grid-cols-[5.5rem_minmax(0,1fr)_auto]">
            {/* ── quando ── */}
            <div data-tom={tomDaHora(e)} className="encomenda-hora flex flex-row items-baseline gap-2 self-start rounded-xl px-3 py-2 sm:flex-col sm:items-center sm:gap-0 sm:py-3 sm:text-center">
              <span className="numero text-xl leading-tight font-extrabold">{horaEmSP(e.para)}</span>
              <span className="text-xs font-semibold opacity-80">{diaCurtoSP(e.para)}</span>
            </div>

            {/* ── quem e o quê ── */}
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="text-base font-bold text-tinta">{e.clienteNome}</span>
                {pilula(e)}
                {variasLojas && <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-xs font-semibold text-tinta-2">{e.unidadeNome}</span>}
              </div>
              {(() => {
                const wa = linkWhatsApp(e.telefone)
                return wa ? (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="encomenda-zap inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold" title="Abrir a conversa no WhatsApp">
                    <svg aria-hidden viewBox="0 0 20 20" className="size-3.5" fill="currentColor">
                      <path d="M10 2.5a7.4 7.4 0 0 0-6.4 11.2L2.5 17.5l3.9-1A7.4 7.4 0 1 0 10 2.5Zm4.2 10.4c-.2.5-1 1-1.5 1-.4.1-.9.1-1.5-.1a9.6 9.6 0 0 1-3.6-3.1c-.7-.9-1-1.9-1-2.6 0-.8.4-1.2.6-1.4.2-.2.4-.2.5-.2h.4c.1 0 .3 0 .4.3l.6 1.4c.1.1.1.3 0 .4l-.2.4-.3.3c-.1.1-.2.2-.1.4.2.3.6 1 1.2 1.5.8.7 1.4.9 1.6 1 .2.1.3.1.4-.1l.6-.7c.1-.2.3-.2.5-.1l1.3.6c.2.1.3.2.4.2v.8Z" />
                    </svg>
                    {mostrarTelefone(e.telefone)}
                  </a>
                ) : (
                  <span className="text-xs text-tinta-3">sem telefone</span>
                )
              })()}
              <div className="flex flex-col gap-1 rounded-xl bg-superficie-2/70 px-3 py-2.5 text-sm">
                {doCatalogo(e) ?? <span className="font-medium text-tinta">{e.descricao}</span>}
                {comoSai(e)}
                {e.observacao && <span className="text-xs whitespace-pre-line text-tinta-2 italic">“{e.observacao}”</span>}
                {recebida(e)}
              </div>
            </div>

            {/* ── dinheiro e botões ── */}
            <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-1 lg:w-[23rem] lg:items-end">
              <dl className="grid w-full grid-cols-3 overflow-hidden rounded-xl border border-borda-suave text-center">
                <div className="flex flex-col gap-0.5 px-2 py-2">
                  <dt className="text-xs font-semibold text-tinta-3">Valor</dt>
                  <dd className="numero text-[15px] font-bold text-tinta">{brl(e.valor)}</dd>
                </div>
                <div className="flex flex-col gap-0.5 border-x border-borda-suave px-2 py-2">
                  <dt className="text-xs font-semibold text-tinta-3">Sinal</dt>
                  <dd className="numero flex flex-col text-[15px] font-bold text-tinta-2">
                    {brl(e.sinal)}
                    {formaDoSinal(e)}
                  </dd>
                </div>
                <div className={cx('flex flex-col gap-0.5 px-2 py-2', !ehFinal(e.situacao) && e.falta > 0 && 'bg-atencao-fundo/60')}>
                  <dt className="text-xs font-semibold text-tinta-3">Falta</dt>
                  <dd className={cx('numero text-[15px] font-extrabold', e.falta > 0 || ehFinal(e.situacao) ? 'text-tinta' : 'text-bom')}>{falta(e)}</dd>
                </div>
              </dl>
              {acoes(e)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}/encomendas`}
      tema={tema}
      // Só o nome da tela: a loja já está escrita no seletor ao lado, e
      // repetida no título ela empurrava os seletores para baixo no celular.
      titulo="Encomendas"
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} /> : undefined}
    >
      {/* ── o tamanho do dia ── */}
      {/* `empty:hidden`: num dia sem nada, a linha vazia ainda ocupava o
          espaço de uma peça e empurrava o resto para baixo. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 empty:hidden">
        <Tira
          itens={[
            { rotulo: resumo.atrasadas === 1 ? 'atrasada' : 'atrasadas', quantos: resumo.atrasadas, nivel: 'critico' },
            { rotulo: 'para hoje', quantos: resumo.hoje, nivel: 'atencao' },
            { rotulo: 'nesta semana', quantos: resumo.semana, nivel: 'neutro' },
          ]}
        />
        {resumo.aReceber > 0 && (
          <span className="flex items-center gap-1.5 text-sm">
            <span aria-hidden className="size-2 rounded-full bg-bom-vivo" />
            <span className="text-tinta-2">a receber</span>
            <b className="numero text-tinta">{brl(resumo.aReceber)}</b>
            <span className="text-tinta-3">
              de {resumo.comSaldo} encomenda{resumo.comSaldo === 1 ? '' : 's'}
            </span>
          </span>
        )}
      </div>

      {/* Pulsa: o bolo das 10h que às 14h não saiu é o único aviso desta
          tela que piora sozinho com o tempo. */}
      {resumo.atrasadas > 0 && (
        <Aviso nivel="critico" pulsa>
          {resumo.atrasadas === 1
            ? '1 encomenda passou da hora e não saiu. Ligue para o cliente ou marque como entregue.'
            : `${resumo.atrasadas} encomendas passaram da hora e não saíram. Ligue para os clientes ou marque como entregues.`}
        </Aviso>
      )}

      {editando && !ehFinal(editando.situacao) && (pode(sessao, 'venda.criar', editando.unidadeId) || suporteEdita(sessao)) ? (
        <Formulario
          key={editando.id}
          slug={slug}
          lojas={[{ id: editando.unidadeId, nome: editando.unidadeNome }]}
          lojaAtual={editando.unidadeId}
          hoje={diaEmSP(agora)}
          podeBuscarCliente={podeBuscarCliente}
          simples={simples}
          voltarPara={link({ editar: null })}
          inicial={{
            id: editando.id,
            clienteId: editando.clienteId,
            clienteNome: editando.clienteNome,
            telefone: editando.telefone,
            descricao: editando.descricao,
            valor: editando.valor,
            sinal: editando.sinal,
            sinalForma: formaSinalValida(editando.sinalForma) ? editando.sinalForma : null,
            dia: diaEmSP(editando.para),
            hora: horaEmSP(editando.para),
            entrega: editando.entrega,
            endereco: editando.endereco,
            observacao: editando.observacao,
            unidadeNome: editando.unidadeNome,
          }}
        />
      ) : editar ? (
        <Aviso nivel="neutro">Essa encomenda não pode mais ser mudada — ou não é de uma loja que você vê.</Aviso>
      ) : (
        podeAnotar && (
          <Formulario
            slug={slug}
            lojas={lojasParaAnotar.map((u) => ({ id: u.id, nome: u.nome }))}
            lojaAtual={onde.unidadeId}
            hoje={diaEmSP(agora)}
            podeBuscarCliente={podeBuscarCliente}
            simples={simples}
            voltarPara={link({})}
          />
        )
      )}

      {/* ── busca e filtros ── */}
      <div className="flex flex-col gap-2">
        <Busca
          valor={q}
          placeholder="Cliente, telefone ou o que foi encomendado"
          rotulo="Buscar encomenda"
          manter={{ unidade: onde.unidadeId, situacao: chaveFiltro }}
          limparEm={link({ q: null })}
        />
        <Fichas
          opcoes={[
            { valor: null, rotulo: 'em aberto' },
            { valor: 'aberta', rotulo: 'a fazer' },
            { valor: 'pronta', rotulo: 'prontas' },
            { valor: 'entregue', rotulo: 'entregues' },
            { valor: 'cancelada', rotulo: 'canceladas' },
            { valor: 'todas', rotulo: 'todas' },
          ]}
          atual={chaveFiltro}
          linkDe={(v) => link({ situacao: v })}
        />
      </div>

      {grupos.length === 0 ? (
        <Vazio
          acao={
            (q || chaveFiltro) && (
              <Link href={`/${slug}/encomendas`} className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2">
                Ver as em aberto
              </Link>
            )
          }
        >
          {q || chaveFiltro
            ? 'Nenhuma encomenda com esse filtro.'
            : 'Nenhuma encomenda em aberto.'}
        </Vazio>
      ) : (
        grupos.map((g) => (
          <Secao
            key={g.chave}
            titulo={g.titulo}
            acao={
              <span className="text-sm text-tinta-3">
                <span className="numero font-semibold text-tinta-2">{g.itens.length}</span> encomenda
                {g.itens.length === 1 ? '' : 's'}
              </span>
            }
          >
            {g.chave === 'atrasadas' && (
              <p className="-mt-2 text-sm text-critico">Passaram da hora combinada e ainda não saíram.</p>
            )}
            {cartoes(g.itens)}
          </Secao>
        ))
      )}

      <p className="text-xs text-tinta-3">
        O sinal entra como receita no dia em que é recebido. Na entrega, lance no Balcão só o que falta.
      </p>
    </Estrutura>
  )
}
