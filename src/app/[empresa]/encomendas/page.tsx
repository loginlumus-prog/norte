import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { moduloLigado } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { lerModo } from '@/servidor/modo'
import { mostrarTelefone } from '@/servidor/cliente'
import {
  NIVEL_ENCOMENDA,
  ROTULO_ENCOMENDA,
  acharEncomenda,
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
import { Tabela } from '@/ui/Tabela'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Secao, Tira, brl } from '@/ui/painel'
import { Aviso, Cartao, FAIXA, Situacao, Vazio, cx } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { Formulario } from './Formulario'
import { AcoesEncomenda } from './Linha'

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
// No modo simples, cada encomenda é um cartão com botões grandes; no
// avançado, a tabela completa (no celular, os cartões — tabela de nove
// colunas em 375px é rolagem de lado, e rolagem de lado no balcão é erro).

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
  if (!moduloLigado(empresa, 'encomenda')) notFound()

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

  const lojasParaAnotar = onde.opcoes
    .filter((u) => (onde.unidadeId ? u.id === onde.unidadeId : true))
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
      ? { ...i, aviso: { quantos: resumo.atrasadas, nivel: 'critico' as const, titulo: 'atrasada(s)' } }
      : i,
  )

  const atrasada = (e: EncomendaNaLista) => !ehFinal(e.situacao) && e.para.getTime() < agora.getTime()

  const pilula = (e: EncomendaNaLista) =>
    atrasada(e) ? (
      <span className="flex flex-wrap gap-1">
        <Situacao nivel="critico">atrasada</Situacao>
        {e.situacao === 'PRONTA' && <Situacao nivel="atencao">pronta</Situacao>}
      </span>
    ) : (
      <Situacao nivel={NIVEL_ENCOMENDA[e.situacao]}>{ROTULO_ENCOMENDA[e.situacao]}</Situacao>
    )

  const contato = (e: EncomendaNaLista) => {
    const wa = linkWhatsApp(e.telefone)
    return (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-tinta">{e.clienteNome}</span>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-marca underline-offset-2 hover:underline"
            title="Abrir a conversa no WhatsApp"
          >
            {mostrarTelefone(e.telefone)} · WhatsApp
          </a>
        ) : (
          <span className="text-xs text-tinta-3">sem telefone</span>
        )}
      </span>
    )
  }

  const comoSai = (e: EncomendaNaLista) =>
    e.entrega ? (
      <span className="text-xs text-tinta-2">
        <b className="font-semibold text-tinta">Entrega</b> · {e.endereco}
      </span>
    ) : (
      <span className="text-xs text-tinta-2">Retirada na loja</span>
    )

  const acoes = (e: EncomendaNaLista) => (
    <AcoesEncomenda
      slug={slug}
      id={e.id}
      resumo={`${e.clienteNome} — ${e.descricao}`}
      situacao={e.situacao}
      falta={e.falta}
      sinal={e.sinal}
      podeMexer={pode(sessao, 'venda.criar', e.unidadeId)}
      podeCancelar={pode(sessao, 'venda.cancelar', e.unidadeId)}
      podeVender={pode(sessao, 'venda.criar', e.unidadeId)}
      editarEm={link({ editar: e.id })}
      simples={simples}
    />
  )

  // Entregue ou cancelada não tem mais "falta pagar": o resto foi recebido no
  // Balcão, ou o pedido morreu. Mostrar R$ 35 ali faria alguém cobrar de novo.
  const falta = (e: EncomendaNaLista) => (ehFinal(e.situacao) ? '—' : e.falta > 0 ? brl(e.falta) : 'pago')

  const nivelDoCartao = (e: EncomendaNaLista) =>
    atrasada(e) ? 'critico' : e.situacao === 'PRONTA' ? 'atencao' : e.situacao === 'ENTREGUE' ? 'bom' : 'neutro'

  const cartoes = (itens: EncomendaNaLista[]) => (
    <ul className="flex flex-col gap-3">
      {itens.map((e) => (
        <li
          key={e.id}
          className={cx('flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-4', FAIXA[nivelDoCartao(e)])}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="flex items-baseline gap-2">
              <span className="numero text-xl font-bold text-tinta">{horaEmSP(e.para)}</span>
              <span className="text-sm text-tinta-2">{diaCurtoSP(e.para)}</span>
            </span>
            {pilula(e)}
          </div>
          {contato(e)}
          <p className="text-sm text-tinta">{e.descricao}</p>
          {comoSai(e)}
          {e.observacao && <p className="text-xs whitespace-pre-line text-tinta-3">{e.observacao}</p>}
          <dl className="grid grid-cols-3 gap-2 border-t border-borda-suave pt-2 text-xs">
            <div className="flex flex-col">
              <dt className="text-tinta-3">Valor</dt>
              <dd className="numero font-semibold text-tinta">{brl(e.valor)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-tinta-3">Sinal</dt>
              <dd className="numero text-tinta-2">{brl(e.sinal)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-tinta-3">Falta pagar</dt>
              <dd className={cx('numero font-semibold', e.falta > 0 || ehFinal(e.situacao) ? 'text-tinta' : 'text-bom')}>
                {falta(e)}
              </dd>
            </div>
          </dl>
          {variasLojas && <span className="text-xs text-tinta-3">{e.unidadeNome}</span>}
          {acoes(e)}
        </li>
      ))}
    </ul>
  )

  const tabela = (itens: EncomendaNaLista[]) => (
    <Tabela
      colunas={[
        {
          chave: 'quando',
          titulo: 'Quando',
          largura: '5.5rem',
          celula: (e: EncomendaNaLista) => (
            <span className="flex flex-col">
              <span className="numero font-semibold text-tinta">{horaEmSP(e.para)}</span>
              <span className="text-xs text-tinta-3">{diaCurtoSP(e.para)}</span>
            </span>
          ),
        },
        { chave: 'cliente', titulo: 'Cliente', largura: '10rem', celula: contato },
        {
          chave: 'desc',
          titulo: 'Encomenda',
          celula: (e: EncomendaNaLista) => (
            <span className="flex min-w-[13rem] flex-col gap-0.5">
              <span className="text-tinta">{e.descricao}</span>
              {comoSai(e)}
              {e.observacao && <span className="text-xs whitespace-pre-line text-tinta-3">{e.observacao}</span>}
              {variasLojas && <span className="text-xs text-tinta-3">{e.unidadeNome}</span>}
            </span>
          ),
        },
        { chave: 'valor', titulo: 'Valor', numero: true, largura: '5.5rem', celula: (e: EncomendaNaLista) => brl(e.valor) },
        {
          chave: 'sinal',
          titulo: 'Sinal',
          numero: true,
          largura: '5.5rem',
          celula: (e: EncomendaNaLista) => <span className="text-tinta-2">{brl(e.sinal)}</span>,
        },
        {
          chave: 'falta',
          titulo: 'Falta',
          numero: true,
          largura: '5.5rem',
          celula: (e: EncomendaNaLista) => (
            <span className={cx('font-semibold', e.falta > 0 || ehFinal(e.situacao) ? 'text-tinta' : 'text-bom')}>
              {falta(e)}
            </span>
          ),
        },
        { chave: 'sit', titulo: 'Situação', largura: '6.5rem', celula: pilula },
        { chave: 'acoes', titulo: '', largura: '12rem', celula: acoes },
      ]}
      linhas={itens}
      chave={(e) => e.id}
    />
  )

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}/encomendas`}
      tema={tema}
      titulo={onde.mostrarSeletor ? `Encomendas · ${onde.titulo}` : 'Encomendas'}
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} /> : undefined}
    >
      {/* ── o tamanho do dia ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
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
          {resumo.atrasadas} encomenda{resumo.atrasadas === 1 ? '' : 's'} passou da hora e não saiu. Ligue para o
          cliente ou marque como entregue.
        </Aviso>
      )}

      {editando && !ehFinal(editando.situacao) && pode(sessao, 'venda.criar', editando.unidadeId) ? (
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
        <Vazio>
          {q || chaveFiltro
            ? 'Nenhuma encomenda com esse filtro.'
            : 'Nenhuma encomenda em aberto. Quando alguém pedir um bolo para sábado, anote em “Nova encomenda” — com dia, hora e sinal.'}
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
            {simples ? (
              cartoes(g.itens)
            ) : (
              <>
                <div className="md:hidden">{cartoes(g.itens)}</div>
                <div className="hidden md:block">
                  <Cartao>{tabela(g.itens)}</Cartao>
                </div>
              </>
            )}
          </Secao>
        ))
      )}

      <p className="text-xs text-tinta-3">
        O sinal entra no Financeiro no dia em que é recebido, como receita. Na entrega, o que falta é recebido no
        Balcão, como venda — lance lá só o que falta.
      </p>
    </Estrutura>
  )
}
