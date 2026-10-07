'use client'

// A ficha do produto: cadastrar e editar usam a mesma tela.
//
// Duas decisões que valem entender antes de mexer:
//
// 1. A GRADE MOSTRA A CONTA ENQUANTO A PESSOA MARCA. "2 cores × 3 tamanhos =
//    6 itens na prateleira" aparece antes de salvar. Sem isso, alguém marca
//    quatro eixos sem perceber e descobre depois que criou 96 variações para
//    contar uma por uma no balanço.
//
// 2. O QUE JÁ TEM HISTÓRICO É AVISADO, NÃO ESCONDIDO. Desmarcar uma opção que
//    já foi vendida não apaga nada — desativa. A tela diz isso na hora, não
//    depois do susto.

import { useActionState, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavegacaoDeSecoes } from '@/ui/NavegacaoDeSecoes'
import { tocar } from '@/ui/sons'
import Link from 'next/link'
import { Botao, Campo, Selecao, Marcar, Aviso, Cartao, cx } from '@/ui/base'
import { arrumarEixo, criar, editar, novaOpcao, novoEixo, type EstadoProduto } from './acoes'
import { semApagar } from '@/ui/formulario'
import { CampoDoPin } from '@/ui/Assinar'

export type EixoNaTela = {
  id: string
  nome: string
  ehCor: boolean
  opcoes: { id: string; valor: string; hex: string | null }[]
}

export type ProdutoNaTela = {
  id: string
  nome: string
  marca: string
  referencia?: string | null
  descricao: string
  categoriaId: string
  medida: string
  precoVista: string
  precoCartao: string
  precoCrediario: string
  custo: string
  /** Dias, como texto do campo. Vazio = não informado. */
  prazoReposicaoDias: string
  /** É serviço (sem estoque). */
  servico?: boolean
  /** Minutos na agenda, como texto do campo. */
  duracaoMin?: string
  /** Material de uso: tem estoque, não vende. */
  usoInterno?: boolean
  /** Feito no dia: zerado depois de fechar não é falta. */
  feitoNoDia?: boolean
  /** Ids das lojas onde é vendido. Vazio = todas. */
  vendidoEm: string[]
  ativo: boolean
  /** As opções já marcadas hoje, por eixo. */
  marcadas: Record<string, string[]>
  /** Os itens da grade e o preço à vista de cada um (o do produto + a diferença dele). */
  itens?: { id: string; rotulo: string; preco: string; custo: string }[]
  /** Pode mexer em preço: só então a ficha mostra o preço de cada item. */
  podePreco?: boolean
  /** Combinações que já têm venda ou movimento — não somem, desativam. */
  comHistorico: number
  /** Falso = quem abre não vê o custo deste produto; o campo nem aparece. */
  verCusto?: boolean
  /**
   * Vendido em lojas que quem abre a ficha não cuida: preço, custo, lojas,
   * medida, situação e grade ficam só para ler (o servidor recusa de todo
   * jeito — ver `alcancaOProduto`). Nome, marca, descrição e prazo seguem.
   */
  travado?: boolean
}

const MEDIDAS = [
  { valor: 'UN', titulo: 'Unidade' },
  { valor: 'KG', titulo: 'Quilo' },
  { valor: 'G', titulo: 'Grama' },
  { valor: 'L', titulo: 'Litro' },
  { valor: 'ML', titulo: 'Mililitro' },
  { valor: 'M', titulo: 'Metro' },
  { valor: 'PAR', titulo: 'Par' },
  { valor: 'CX', titulo: 'Caixa' },
]

/** Os eixos que a ficha sugere criar quando a empresa não tem nenhum. */
const SUGESTOES_DE_EIXO = [
  { nome: 'Sabor', ehCor: false },
  { nome: 'Tamanho', ehCor: false },
  { nome: 'Cor', ehCor: true },
]

const CAMPO_PEQUENO =
  'h-9 min-w-0 rounded-norte border border-borda bg-superficie px-2.5 text-sm text-tinta placeholder:text-tinta-3 focus:border-marca focus:outline-none'

/** "+ Sabor": uma linha para escrever o nome e criar a opção na hora. Enter cria, não salva a ficha. */
function NovaOpcao({
  eixo,
  aoCriar,
  slug,
}: {
  eixo: EixoNaTela
  slug: string
  aoCriar: (eixoId: string, opcao: { id: string; valor: string; hex: string | null }) => void
}) {
  const [texto, setTexto] = useState('')
  const [hex, setHex] = useState('#1f4fd8')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, setIndo] = useState(false)

  async function criarAgora() {
    if (!texto.trim() || indo) return
    setIndo(true)
    setErro(null)
    const r = await novaOpcao(slug, eixo.id, texto, eixo.ehCor ? hex : null).catch(() => ({ erro: 'Sem conexão. Tente de novo.' }))
    setIndo(false)
    if ('erro' in r) return setErro(r.erro)
    aoCriar(eixo.id, r.opcao)
    setTexto('')
  }

  return (
    <div className="mt-2.5 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {eixo.ehCor && (
          <input
            type="color"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            aria-label={`Cor de ${eixo.nome.toLowerCase()}`}
            className="h-9 w-10 shrink-0 cursor-pointer rounded-norte border border-borda bg-superficie p-0.5"
          />
        )}
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void criarAgora()
            }
          }}
          maxLength={40}
          placeholder={`Novo ${eixo.nome.toLowerCase()}: escreva e toque em Adicionar`}
          aria-label={`Novo ${eixo.nome.toLowerCase()}`}
          className={cx(CAMPO_PEQUENO, 'w-full max-w-xs flex-1')}
        />
        <Botao type="button" tom="secundario" onClick={criarAgora} carregando={indo} disabled={!texto.trim()} className="h-9 py-0">
          + Adicionar
        </Botao>
      </div>
      {erro && <p className="text-xs text-critico">{erro}</p>}
    </div>
  )
}

/**
 * "Arrumar": renomear e excluir o eixo e as opções dele. Mexe na EMPRESA, não
 * só neste produto — o "oi" criado por engano aparecia em toda ficha e não
 * havia como tirar. O que tem venda não some do histórico: o servidor arquiva.
 */
function ArrumarEixo({
  eixo,
  slug,
  aoRenomearEixo,
  aoRenomearOpcao,
  aoExcluirEixo,
  aoExcluirOpcao,
}: {
  eixo: EixoNaTela
  slug: string
  aoRenomearEixo: (nome: string) => void
  aoRenomearOpcao: (opcaoId: string, valor: string) => void
  aoExcluirEixo: () => void
  aoExcluirOpcao: (opcaoId: string) => void
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [indo, setIndo] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)

  async function fazer(chave: string, pedido: Parameters<typeof arrumarEixo>[1], depois: (nome?: string) => void) {
    if (indo) return
    setIndo(chave)
    setErro(null)
    const r = await arrumarEixo(slug, pedido).catch(() => ({ erro: 'Sem conexão. Tente de novo.' }))
    setIndo(null)
    setConfirmando(null)
    if ('erro' in r) return setErro(r.erro)
    depois(r.nome)
  }

  const excluir = (chave: string, rotulo: string, acao: () => void) =>
    confirmando === chave ? (
      <span className="flex items-center gap-1.5">
        <Botao type="button" tom="perigo" carregando={indo === chave} onClick={acao} className="h-8 py-0 text-xs">
          Excluir mesmo
        </Botao>
        <Botao type="button" tom="discreto" onClick={() => setConfirmando(null)} className="h-8 py-0 text-xs">
          Voltar
        </Botao>
      </span>
    ) : (
      <Botao type="button" tom="discreto" onClick={() => setConfirmando(chave)} aria-label={rotulo} className="h-8 py-0 text-xs text-critico">
        Excluir
      </Botao>
    )

  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-norte border border-borda bg-superficie-2 p-3">
      <p className="text-xs text-tinta-2">
        Vale para <b>todos os produtos</b>. O que já foi vendido continua no histórico com o nome da época.
      </p>
      <LinhaDeNome
        rotulo={`Nome do eixo ${eixo.nome}`}
        inicial={eixo.nome}
        indo={indo === 'eixo'}
        aoSalvar={(nome) => fazer('eixo', { tipo: 'renomearEixo', eixoId: eixo.id, nome }, (n) => aoRenomearEixo(n ?? nome))}
        depois={excluir('eixo-x', `Excluir ${eixo.nome}`, () =>
          fazer('eixo-x', { tipo: 'excluirEixo', eixoId: eixo.id }, aoExcluirEixo),
        )}
      />
      {eixo.opcoes.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-borda pt-2.5">
          {eixo.opcoes.map((o) => (
            <li key={o.id}>
              <LinhaDeNome
                rotulo={`Nome de ${o.valor}`}
                inicial={o.valor}
                indo={indo === o.id}
                aoSalvar={(nome) =>
                  fazer(o.id, { tipo: 'renomearOpcao', opcaoId: o.id, nome }, (n) => aoRenomearOpcao(o.id, n ?? nome))
                }
                depois={excluir(`${o.id}-x`, `Excluir ${o.valor}`, () =>
                  fazer(`${o.id}-x`, { tipo: 'excluirOpcao', opcaoId: o.id }, () => aoExcluirOpcao(o.id)),
                )}
              />
            </li>
          ))}
        </ul>
      )}
      {erro && <p className="text-xs text-critico">{erro}</p>}
    </div>
  )
}

/** Um nome editável: o botão Salvar só aparece quando o texto mudou. */
function LinhaDeNome({
  rotulo,
  inicial,
  indo,
  aoSalvar,
  depois,
}: {
  rotulo: string
  inicial: string
  indo: boolean
  aoSalvar: (nome: string) => void
  depois: ReactNode
}) {
  const [texto, setTexto] = useState(inicial)
  const mudou = texto.trim() !== '' && texto.trim() !== inicial
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (mudou) aoSalvar(texto)
          }
        }}
        maxLength={40}
        aria-label={rotulo}
        className={cx(CAMPO_PEQUENO, 'w-full max-w-56 flex-1')}
      />
      {mudou && (
        <Botao type="button" tom="secundario" carregando={indo} onClick={() => aoSalvar(texto)} className="h-8 py-0 text-xs">
          Salvar nome
        </Botao>
      )}
      {depois}
    </div>
  )
}

/** Sem eixo nenhum: escolhe Sabor, Tamanho ou Cor, ou escreve o nome do eixo. */
function NovoEixo({
  slug,
  aoCriar,
  existentes = [],
}: {
  slug: string
  aoCriar: (e: EixoNaTela) => void
  /** Os eixos que a empresa já tem: a sugestão com o mesmo nome não aparece de novo. */
  existentes?: string[]
}) {
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, setIndo] = useState(false)

  async function criarAgora(n: string, ehCor: boolean) {
    if (!n.trim() || indo) return
    setIndo(true)
    setErro(null)
    const r = await novoEixo(slug, n, ehCor).catch(() => ({ erro: 'Sem conexão. Tente de novo.' }))
    setIndo(false)
    if ('erro' in r) return setErro(r.erro)
    aoCriar(r.eixo)
    setNome('')
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {SUGESTOES_DE_EIXO.filter((s) => !existentes.some((n) => n.toLocaleLowerCase('pt-BR') === s.nome.toLocaleLowerCase('pt-BR'))).map((s) => (
          <Botao key={s.nome} type="button" tom="secundario" disabled={indo} onClick={() => criarAgora(s.nome, s.ehCor)} className="h-9 py-0">
            + {s.nome}
          </Botao>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void criarAgora(nome, false)
            }
          }}
          maxLength={30}
          placeholder="Ou outro: Voltagem, Peso, Sabor da calda…"
          aria-label="Nome do novo eixo"
          className={cx(CAMPO_PEQUENO, 'w-full max-w-xs flex-1')}
        />
        <Botao type="button" tom="secundario" onClick={() => criarAgora(nome, false)} disabled={!nome.trim() || indo} className="h-9 py-0">
          Criar
        </Botao>
      </div>
      {erro && <p className="text-xs text-critico">{erro}</p>}
    </div>
  )
}

/** Os eixos que a empresa já tem e este produto não usa, e o "criar outro". */
function EscolherEixo({
  fechados,
  abrir,
  slug,
  aoCriar,
  existentes,
}: {
  fechados: EixoNaTela[]
  abrir: (id: string) => void
  slug: string
  aoCriar: (e: EixoNaTela) => void
  existentes: string[]
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {fechados.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-tinta-3">Já cadastrados:</span>
            {fechados.map((e) => (
              <Botao key={e.id} type="button" tom="secundario" onClick={() => abrir(e.id)} className="h-9 py-0">
                + {e.nome}
              </Botao>
            ))}
          </div>
          <p className="text-xs text-tinta-3">
            Algum criado por engano? Toque nele e depois em <b>Renomear ou excluir</b>.
          </p>
        </div>
      )}
      <NovoEixo slug={slug} aoCriar={aoCriar} existentes={existentes} />
    </div>
  )
}

export function Editor({
  slug,
  eixos: eixosDaPagina,
  categorias,
  lojas = [],
  sugestao,
  marcas,
  produto,
  servicoPadrao = false,
  pedePin = false,
}: {
  slug: string
  eixos: EixoNaTela[]
  categorias: { id: string; nome: string }[]
  /**
   * As lojas abertas que vendem (depósito não). Com uma só, a pergunta nem
   * aparece. `podeMarcar` falso = loja que a pessoa não cuida: aparece, mas
   * travada — ligar ou desligar o produto lá é de quem responde por ela.
   */
  lojas?: { id: string; nome: string; ramo: string | null; podeMarcar?: boolean }[]
  /** Produto novo: por categoria, as lojas do ramo dela. Vazio = todas. */
  sugestao?: Record<string, string[]>
  /** Produto novo: por categoria, o padrão de "material de uso" e "feito no dia" do ramo. */
  marcas?: Record<string, { usoInterno: boolean; feitoNoDia: boolean }>
  /** Ausente = cadastro novo. */
  produto?: ProdutoNaTela
  /** Cadastro novo aberto por "Cadastrar serviço": a ficha já vem marcada como serviço. */
  servicoPadrao?: boolean
  /** Quem cadastra assina com o PIN (a vendedora, quando a empresa deixa — ver EXTRAS_DO_BALCAO). */
  pedePin?: boolean
}) {
  // Os eixos moram aqui, e não só na página, porque a ficha cria sabor e eixo
  // na hora — sem recarregar e sem perder o que já foi digitado.
  const [eixos, setEixos] = useState<EixoNaTela[]>(eixosDaPagina)
  const idsDosEixos = useMemo(() => eixos.map((e) => e.id), [eixos])
  const travado = produto?.travado === true

  const acao = produto
    ? editar.bind(null, slug, produto.id, idsDosEixos)
    : criar.bind(null, slug, idsDosEixos)
  const [estado, agir, pendente] = useActionState<EstadoProduto, FormData>(acao, {})
  // Salvou: o som de sucesso; não deu: o de erro (sons.ts).
  useEffect(() => {
    if (estado.ok) tocar('sucesso')
    else if (estado.erro) tocar('erro')
  }, [estado])

  const [marcadas, setMarcadas] = useState<Record<string, string[]>>(produto?.marcadas ?? {})

  // "Vendido em" controlado: no cadastro novo, escolher a categoria já marca
  // as lojas do ramo dela (o picolé só na sorveteria). A pessoa ainda pode
  // mudar à mão depois — trocar de categoria de novo refaz a sugestão.
  // No cadastro novo, loja travada nasce desmarcada: o produto do gerente
  // nasce só nas lojas dele, e a tela precisa dizer isso antes de salvar.
  const vendeEmTodas = (ids: string[]) =>
    Object.fromEntries(
      lojas.map((l) => [l.id, (ids.length === 0 || ids.includes(l.id)) && (!!produto || l.podeMarcar !== false)]),
    )
  const [vendeEm, setVendeEm] = useState<Record<string, boolean>>(() =>
    vendeEmTodas(produto?.vendidoEm ?? []),
  )
  const [sugerido, setSugerido] = useState(false)
  // "Material de uso" e "feito no dia" controlados pelo mesmo motivo: no
  // cadastro novo, a gaveta de material do ramo (a acetona no salão) já
  // marca a caixa. Trocar de gaveta refaz o padrão; a pessoa manda no fim.
  const [usoInterno, setUsoInterno] = useState(produto?.usoInterno ?? false)
  const [feitoNoDia, setFeitoNoDia] = useState(produto?.feitoNoDia ?? false)
  const aoTrocarCategoria = (categoriaId: string) => {
    if (produto) return
    if (marcas) {
      setUsoInterno(marcas[categoriaId]?.usoInterno ?? false)
      setFeitoNoDia(marcas[categoriaId]?.feitoNoDia ?? false)
    }
    if (!sugestao) return
    const ids = sugestao[categoriaId] ?? []
    setVendeEm(vendeEmTodas(ids))
    setSugerido(ids.length > 0)
  }

  const alterna = (eixoId: string, opcaoId: string, on: boolean) =>
    setMarcadas((m) => {
      const atual = m[eixoId] ?? []
      return { ...m, [eixoId]: on ? [...atual, opcaoId] : atual.filter((x) => x !== opcaoId) }
    })

  // Opção criada na hora: entra no eixo e já vem marcada — quem escreveu
  // "Morango" quer o Morango neste produto.
  const opcaoCriada = (eixoId: string, opcao: { id: string; valor: string; hex: string | null }) => {
    setEixos((es) =>
      es.map((e) => (e.id === eixoId && !e.opcoes.some((o) => o.id === opcao.id) ? { ...e, opcoes: [...e.opcoes, opcao] } : e)),
    )
    setMarcadas((m) => ((m[eixoId] ?? []).includes(opcao.id) ? m : { ...m, [eixoId]: [...(m[eixoId] ?? []), opcao.id] }))
  }
  // Só os eixos que ESTE produto usa ficam abertos. Antes, todo eixo da
  // empresa aparecia em toda ficha — o "ATC 10UN" de um produto aparecia no
  // açaí, vazio, pedindo "escreva o primeiro".
  const [abertos, setAbertos] = useState<string[]>(() =>
    eixosDaPagina.filter((e) => (produto?.marcadas?.[e.id] ?? []).length > 0).map((e) => e.id),
  )
  const [arrumando, setArrumando] = useState<string | null>(null)
  const abrir = (id: string) => setAbertos((a) => (a.includes(id) ? a : [...a, id]))
  const fechar = (id: string) => {
    setAbertos((a) => a.filter((x) => x !== id))
    setMarcadas((m) => ({ ...m, [id]: [] }))
    setArrumando((x) => (x === id ? null : x))
  }
  const eixoCriado = (novo: EixoNaTela) => {
    setEixos((es) => (es.some((e) => e.id === novo.id) ? es : [...es, novo]))
    abrir(novo.id)
  }
  const visiveis = eixos.filter((e) => abertos.includes(e.id))
  const fechados = eixos.filter((e) => !abertos.includes(e.id))

  // A conta que a pessoa precisa ver ANTES de salvar.
  const usados = eixos.filter((e) => (marcadas[e.id] ?? []).length > 0)
  const quantas = usados.reduce((n, e) => n * (marcadas[e.id]!.length), 1)
  const total = usados.length === 0 ? 1 : quantas

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex max-w-3xl flex-col gap-5">
      <NavegacaoDeSecoes />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <Cartao titulo="O que é">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Nome"
            name="nome"
            required
            defaultValue={produto?.nome ?? ''}
            placeholder="Nome do produto"
            dica="É o que aparece no balcão e no comprovante."
          />
          <Campo
            rotulo="Marca"
            name="marca"
            defaultValue={produto?.marca ?? ''}
            placeholder="Opcional"
          />
          <Campo
            rotulo="Referência do fornecedor"
            name="referencia"
            defaultValue={produto?.referencia ?? ''}
            placeholder="Opcional — a da caixa ou da nota"
          />
          <Selecao
            rotulo="Categoria"
            name="categoriaId"
            defaultValue={produto?.categoriaId ?? ''}
            onChange={(e) => aoTrocarCategoria(e.target.value)}
            opcoes={[{ valor: '', titulo: 'Sem categoria' }, ...categorias.map((c) => ({ valor: c.id, titulo: c.nome }))]}
          />
          <Selecao
            rotulo="Como se conta"
            name={travado ? undefined : 'medida'}
            defaultValue={produto?.medida ?? 'UN'}
            opcoes={MEDIDAS}
            disabled={travado}
            dica="Sorvete a granel vende em quilo; blusa vende em unidade."
          />
          {/* Campo travado não vai no formulário; o valor de hoje vai escondido. */}
          {travado && <input type="hidden" name="medida" value={produto?.medida ?? 'UN'} />}
        </div>
      </Cartao>

      {travado && (
        <Aviso nivel="neutro">
          Este produto também é vendido em lojas que você não cuida. Você pode corrigir nome,
          marca, categoria e prazo; preço, custo, lojas, medida, situação e grade ficam com
          quem responde por todas elas.
        </Aviso>
      )}

      <Cartao titulo="Quanto custa">
        <p className="mb-3 text-sm text-tinta-2">
          O preço à vista é o único obrigatório. Deixando os outros em branco, eles ficam
          iguais a ele.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="À vista" name="precoVista" required readOnly={travado} defaultValue={produto?.precoVista ?? ''} placeholder="0,00" inputMode="decimal" erro={estado.campos?.precoVista} />
          <Campo rotulo="No cartão" name="precoCartao" readOnly={travado} defaultValue={produto?.precoCartao ?? ''} placeholder="Igual à vista" inputMode="decimal" erro={estado.campos?.precoCartao} />
          <Campo rotulo="No crediário" name="precoCrediario" readOnly={travado} defaultValue={produto?.precoCrediario ?? ''} placeholder="Igual à vista" inputMode="decimal" erro={estado.campos?.precoCrediario} />
          {/* Sem o campo, o custo não vai no formulário e fica como está: quem
              não responde por nenhuma loja deste produto não lê o custo dele. */}
          {produto?.verCusto !== false && (
            <Campo
              rotulo="Custo"
              name="custo"
              readOnly={travado}
              defaultValue={produto?.custo ?? ''}
              placeholder="0,00 ou 35%"
              inputMode="decimal"
              erro={estado.campos?.custo}
              dica="Do quilo, do litro ou da unidade, como se conta. Não sabe o valor? Escreva em % do preço (ex.: 35%)."
            />
          )}
          {/* Ao lado do custo porque é a outra metade da conta de compra:
              quanto custa e quanto demora. Sem ele a previsão de ruptura usa
              um prazo padrão e avisa que é padrão. */}
          <Campo
            rotulo="Prazo de reposição (dias)"
            name="prazoReposicaoDias"
            type="number"
            min={0}
            max={365}
            step={1}
            defaultValue={produto?.prazoReposicaoDias ?? ''}
            placeholder="7"
            inputMode="numeric"
            erro={estado.campos?.prazoReposicaoDias}
            dica="Quantos dias o fornecedor leva para entregar. É o que transforma 'está acabando' em 'vai faltar'."
          />
        </div>
      </Cartao>

      {/* SERVIÇO. A manicure, a consulta, a aula: vende no balcão como
          qualquer produto, mas não tem estoque — não baixa saldo e nunca
          aparece como "acabou". A duração é o padrão do horário na Agenda. */}
      <Cartao titulo="Serviço">
        <input type="hidden" name="servicoNaTela" value="1" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Marcar
            name="servico"
            defaultChecked={produto?.servico ?? servicoPadrao}
            titulo="É serviço (não tem estoque)"
            resumo="Manicure, consulta, aula avulsa. Vende no balcão sem mexer em saldo."
          />
          <Campo
            rotulo="Duração na agenda (min)"
            name="duracaoMin"
            type="number"
            min={5}
            max={720}
            step={5}
            defaultValue={produto?.duracaoMin ?? ''}
            placeholder="45"
            inputMode="numeric"
            erro={estado.campos?.duracaoMin}
            dica="Só para serviço com horário marcado. É o tempo que a Agenda reserva."
          />
        </div>
      </Cartao>

      {/* COMO O ESTOQUE ANDA. Material de uso tem estoque e compra, mas não
          vende: some do balcão, e a venda recusa. Feito no dia zera todo fim
          de tarde: zerado não vira "acabou". */}
      <Cartao titulo="Estoque">
        <input type="hidden" name="marcasNaTela" value="1" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Marcar
            name={travado ? undefined : 'usoInterno'}
            id="produto-uso-interno"
            checked={usoInterno}
            disabled={travado}
            onChange={(e) => setUsoInterno(e.target.checked)}
            titulo="Material de uso — não vende"
            resumo="O que se gasta dentro de casa e não se vende. Conta estoque, mínimo e compra; não aparece no balcão."
          />
          {travado && usoInterno && <input type="hidden" name="usoInterno" value="on" />}
          <Marcar
            name="feitoNoDia"
            id="produto-feito-no-dia"
            checked={feitoNoDia}
            onChange={(e) => setFeitoNoDia(e.target.checked)}
            titulo="Feito no dia"
            resumo="O pão, a coxinha. A sobra sai ao fechar: zerado não conta como acabou."
          />
        </div>
      </Cartao>

      {/* VENDIDO EM. Só existe para quem tem mais de uma loja — e é o que
          impede a sorveteria de mostrar camisa no balcão quando a mesma
          empresa tem as duas. Tudo marcado = vendido em todas, inclusive nas
          que abrirem depois; desmarcar é tirar do balcão daquela loja. */}
      {lojas.length > 1 && (
        <Cartao titulo="Vendido em">
          {/* Travado, a pergunta não vai: o servidor mantém as lojas como estão. */}
          {!travado && <input type="hidden" name="temLojas" value="1" />}
          <p className="text-xs text-tinta-3">
            O balcão de cada loja só mostra o que está marcado aqui. Com todas marcadas, a loja
            que você abrir depois também vende este produto.
          </p>
          {sugerido && (
            <p className="text-xs font-medium text-marca">
              Marquei as lojas do ramo desta categoria. Confira antes de salvar.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {lojas.map((l) => (
              <Marcar
                key={l.id}
                name={`vendidoEm_${l.id}`}
                id={`vendido-${l.id}`}
                titulo={l.nome}
                resumo={l.ramo ?? undefined}
                checked={vendeEm[l.id] ?? true}
                disabled={travado || l.podeMarcar === false}
                onChange={(e) => setVendeEm((v) => ({ ...v, [l.id]: e.target.checked }))}
              />
            ))}
          </div>
          {!travado && lojas.some((l) => l.podeMarcar === false) && (
            <p className="text-xs text-tinta-3">
              As lojas travadas não são suas: ligar ou desligar o produto nelas é de quem cuida delas.
            </p>
          )}
        </Cartao>
      )}

      {/* O mesmo produto, o mesmo estoque, preços diferentes: a casquinha
          comum a R$ 4 e a recheada a R$ 7. Aparece para quem mexe em preço e
          quando a grade já existe (salvou as variações): é sobre cada item. */}
      {produto && !travado && produto.podePreco && (produto.itens?.length ?? 0) >= 2 && (
        <Cartao titulo={produto.verCusto ? 'Preço e custo de cada item' : 'Preço de cada item'}>
          <p className="mb-3 text-sm text-tinta-2">
            Algum item é vendido por outro preço? Escreva o preço dele aqui. O estoque continua junto, no mesmo produto.
            Item que fica igual ao preço de cima acompanha o produto quando você mudar o preço.
            No cartão e no crediário, soma a mesma diferença.
            {produto.verCusto && ' O custo de cada item entra na margem de cada venda; em branco, o item usa o custo do produto.'}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {produto.itens!.map((i) => (
              <div key={i.id} className="flex flex-col gap-2">
                <Campo
                  rotulo={produto.verCusto ? `${i.rotulo || 'Item'} · preço` : i.rotulo || 'Item'}
                  name={`precoItem_${i.id}`}
                  defaultValue={i.preco}
                  placeholder="0,00"
                  inputMode="decimal"
                  erro={estado.campos?.[`precoItem_${i.id}`]}
                />
                {/* O que estava na tela ao abrir: só vai para o servidor quem mudou. */}
                <input type="hidden" name={`precoItemAntes_${i.id}`} value={i.preco} readOnly />
                {produto.verCusto && (
                  <>
                    <Campo
                      rotulo={`${i.rotulo || 'Item'} · custo`}
                      name={`custoItem_${i.id}`}
                      defaultValue={i.custo}
                      placeholder={produto.custo ? `${produto.custo} (do produto)` : '0,00'}
                      inputMode="decimal"
                      erro={estado.campos?.[`custoItem_${i.id}`]}
                    />
                    <input type="hidden" name={`custoItemAntes_${i.id}`} value={i.custo} readOnly />
                  </>
                )}
              </div>
            ))}
          </div>
        </Cartao>
      )}

      <Cartao
        titulo="Como varia"
        acao={
          <span className="numero text-xs font-semibold text-tinta-3">
            {total} {total === 1 ? 'item' : 'itens'} na prateleira
          </span>
        }
      >
        {travado && <input type="hidden" name="gradeTravada" value="1" />}
        <p className="mb-3 text-sm text-tinta-2">
          {visiveis.length === 0 ? (
            <>
              Este produto é um item único. Para ele variar (sabor, tamanho, cor…), escolha abaixo
              <b> como ele varia</b>.
            </>
          ) : (
            <>
              Marque só o que este produto tem de verdade. Cada combinação vira um item
              contado separado no estoque, com o próprio código de etiqueta.
            </>
          )}
        </p>

        {visiveis.length > 0 && (
          <div className="flex flex-col gap-4">
            {visiveis.map((e) => {
              const desteEixo = marcadas[e.id] ?? []
              return (
                <section key={e.id}>
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-tinta-3 uppercase">
                      {e.nome}
                      {desteEixo.length > 0 && (
                        <span className="numero rounded bg-superficie-2 px-1.5 py-px text-[10px] font-semibold text-tinta-2">
                          {desteEixo.length}
                        </span>
                      )}
                    </h3>
                    {!travado && (
                      <span className="ml-auto flex items-center gap-3 text-xs font-semibold">
                        <button
                          type="button"
                          onClick={() => setArrumando((x) => (x === e.id ? null : e.id))}
                          aria-expanded={arrumando === e.id}
                          className="text-marca underline-offset-2 hover:underline"
                        >
                          {arrumando === e.id ? 'Fechar' : 'Renomear ou excluir'}
                        </button>
                        <button
                          type="button"
                          onClick={() => fechar(e.id)}
                          className="text-tinta-2 underline-offset-2 hover:text-critico hover:underline"
                        >
                          Tirar deste produto
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {e.opcoes.map((o) => {
                      const ligada = desteEixo.includes(o.id)
                      return (
                        <label
                          key={o.id}
                          className={cx(
                            'flex cursor-pointer items-center gap-1.5 rounded-norte border px-2.5 py-1.5 text-sm transition-colors',
                            ligada
                              // Escolha é azul, como no Marcar: verde é situação.
                              ? 'border-marca bg-marca-suave font-semibold text-tinta'
                              : 'border-borda bg-superficie text-tinta-2 hover:bg-superficie-2',
                          )}
                        >
                          <input
                            type="checkbox"
                            name={`opcao_${e.id}_${o.id}`}
                            disabled={travado}
                            defaultChecked={ligada}
                            onChange={(ev) => alterna(e.id, o.id, ev.currentTarget.checked)}
                            className="size-3.5 accent-[var(--marca)]"
                          />
                          {o.hex && (
                            <span
                              aria-hidden
                              className="size-3 rounded-full border border-borda"
                              style={{ background: o.hex }}
                            />
                          )}
                          {/* cor E texto: a bolinha sozinha exclui quem não distingue */}
                          <span>{o.valor}</span>
                        </label>
                      )
                    })}
                  </div>
                  {e.opcoes.length === 0 && (
                    <p className="text-sm text-tinta-2">
                      Ainda não há nenhum {e.nome.toLowerCase()} cadastrado. Escreva o primeiro abaixo.
                    </p>
                  )}
                  {!travado && <NovaOpcao eixo={e} slug={slug} aoCriar={opcaoCriada} />}
                  {!travado && arrumando === e.id && (
                    <ArrumarEixo
                      eixo={e}
                      slug={slug}
                      aoRenomearEixo={(nome) => setEixos((es) => es.map((x) => (x.id === e.id ? { ...x, nome } : x)))}
                      aoRenomearOpcao={(opcaoId, valor) =>
                        setEixos((es) =>
                          es.map((x) =>
                            x.id === e.id ? { ...x, opcoes: x.opcoes.map((o) => (o.id === opcaoId ? { ...o, valor } : o)) } : x,
                          ),
                        )
                      }
                      aoExcluirEixo={() => {
                        fechar(e.id)
                        setEixos((es) => es.filter((x) => x.id !== e.id))
                      }}
                      aoExcluirOpcao={(opcaoId) => {
                        setEixos((es) =>
                          es.map((x) => (x.id === e.id ? { ...x, opcoes: x.opcoes.filter((o) => o.id !== opcaoId) } : x)),
                        )
                        setMarcadas((m) => ({ ...m, [e.id]: (m[e.id] ?? []).filter((x) => x !== opcaoId) }))
                      }}
                    />
                  )}
                </section>
              )
            })}
          </div>
        )}

        {!travado && visiveis.length === 0 && (
          <EscolherEixo fechados={fechados} abrir={abrir} slug={slug} aoCriar={eixoCriado} existentes={eixos.map((e) => e.nome)} />
        )}
        {!travado && visiveis.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-semibold text-marca underline-offset-2 hover:underline">
              Variar de outro jeito também (tamanho, cor…)
            </summary>
            <div className="mt-2.5">
              <EscolherEixo fechados={fechados} abrir={abrir} slug={slug} aoCriar={eixoCriado} existentes={eixos.map((e) => e.nome)} />
            </div>
          </details>
        )}

            {usados.length > 1 && (
              <p className="mt-4 text-sm text-tinta-2">
                {/* "cor (2)", não "2 cor": o nome do eixo é da empresa e não dá para pôr no plural. */}
                {usados.map((e) => `${e.nome.toLowerCase()} (${marcadas[e.id]!.length})`).join(' × ')}{' '}
                = <b className="numero text-tinta">{total}</b> itens contados separado no estoque.
              </p>
            )}

            {produto && produto.comHistorico > 0 && (
              <div className="mt-4">
                <Aviso nivel="atencao">
                  Este produto já tem venda ou movimento de estoque. Desmarcar uma opção{' '}
                  <b>não apaga nada</b>: aquela combinação sai do balcão e continua no
                  histórico e no relatório, com o saldo que ainda tiver.
                </Aviso>
              </div>
            )}
      </Cartao>

      {produto && (
        <Cartao titulo="Situação">
          <Marcar
            name={travado ? undefined : 'ativo'}
            id="produto-ativo"
            defaultChecked={produto.ativo}
            disabled={travado}
            titulo="Produto à venda"
            resumo="Desmarcado, ele some do balcão e da lista — e continua em todo relatório antigo."
          />
          {travado && produto.ativo && <input type="hidden" name="ativo" value="on" />}
        </Cartao>
      )}

      {!produto && (pedePin || estado.precisaPin) && (
        <div className="flex justify-end">
          <CampoDoPin slug={slug} name="pin" rotulo="Seu PIN (assina o cadastro)" foco={!!estado.precisaPin} />
        </div>
      )}

      {/* A barra de salvar flutua no pé da tela: a ficha é longa, e o
          "Salvar" lá no fim fazia a pessoa rolar tudo depois de mudar o preço. */}
      <div className="sticky bottom-3 z-20 flex items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie/90 px-4 py-3 shadow-[0_18px_40px_-20px_rgb(15_23_42/0.5)] backdrop-blur-xl">
        <Link
          href={`/${slug}/produtos`}
          className="text-sm font-medium text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
        >
          ← Voltar
        </Link>
        <span className="flex items-center gap-3">
          <span className="hidden text-xs text-tinta-3 sm:inline">{produto ? 'As mudanças valem no balcão e no catálogo na hora.' : 'Cadastra e já aparece no balcão.'}</span>
          <Botao type="submit" tom="confirmar" carregando={pendente} className="px-5">
            {pendente ? 'Salvando...' : produto ? 'Salvar alterações' : 'Cadastrar'}
          </Botao>
        </span>
      </div>
    </form>
  )
}
