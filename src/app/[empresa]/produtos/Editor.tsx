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

import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import { Botao, Campo, Selecao, Marcar, Aviso, Cartao, cx } from '@/ui/base'
import { criar, editar, type EstadoProduto } from './acoes'
import { semApagar } from '@/ui/formulario'

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

export function Editor({
  slug,
  eixos,
  categorias,
  lojas = [],
  sugestao,
  marcas,
  produto,
  servicoPadrao = false,
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
}) {
  const idsDosEixos = useMemo(() => eixos.map((e) => e.id), [eixos])
  const travado = produto?.travado === true

  const acao = produto
    ? editar.bind(null, slug, produto.id, idsDosEixos)
    : criar.bind(null, slug, idsDosEixos)
  const [estado, agir, pendente] = useActionState<EstadoProduto, FormData>(acao, {})

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

  // A conta que a pessoa precisa ver ANTES de salvar.
  const usados = eixos.filter((e) => (marcadas[e.id] ?? []).length > 0)
  const quantas = usados.reduce((n, e) => n * (marcadas[e.id]!.length), 1)
  const total = usados.length === 0 ? 1 : quantas

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex max-w-3xl flex-col gap-5">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <Cartao titulo="O que é">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Nome"
            name="nome"
            required
            defaultValue={produto?.nome ?? ''}
            placeholder="Camiseta canelada"
            dica="É o que aparece no balcão e no comprovante."
          />
          <Campo
            rotulo="Marca"
            name="marca"
            defaultValue={produto?.marca ?? ''}
            placeholder="Opcional"
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
          <Campo rotulo="À vista" name="precoVista" required readOnly={travado} defaultValue={produto?.precoVista ?? ''} placeholder="49,90" inputMode="decimal" erro={estado.campos?.precoVista} />
          <Campo rotulo="No cartão" name="precoCartao" readOnly={travado} defaultValue={produto?.precoCartao ?? ''} placeholder="54,90" inputMode="decimal" erro={estado.campos?.precoCartao} />
          <Campo rotulo="No crediário" name="precoCrediario" readOnly={travado} defaultValue={produto?.precoCrediario ?? ''} placeholder="59,90" inputMode="decimal" erro={estado.campos?.precoCrediario} />
          {/* Sem o campo, o custo não vai no formulário e fica como está: quem
              não responde por nenhuma loja deste produto não lê o custo dele. */}
          {produto?.verCusto !== false && (
            <Campo
              rotulo="Custo"
              name="custo"
              readOnly={travado}
              defaultValue={produto?.custo ?? ''}
              placeholder="22,00"
              inputMode="decimal"
              erro={estado.campos?.custo}
              dica="Sem ele o relatório não sabe calcular margem."
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
            resumo="A luva, a acetona, o algodão. Conta estoque, mínimo e compra; não aparece no balcão."
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

      <Cartao
        titulo="Como varia"
        acao={
          <span className="numero text-xs font-semibold text-tinta-3">
            {total} {total === 1 ? 'item' : 'itens'} na prateleira
          </span>
        }
      >
        {eixos.length === 0 ? (
          <Aviso nivel="neutro">
            Sua empresa ainda não criou nenhum eixo de variação (Cor, Tamanho, Numeração,
            Sabor…). Sem eixo, o produto entra como item único — que é o certo para quem
            vende a granel.
          </Aviso>
        ) : (
          <>
            {travado && <input type="hidden" name="gradeTravada" value="1" />}
            <p className="mb-3 text-sm text-tinta-2">
              Marque só o que este produto tem de verdade. Cada combinação vira um item
              contado separado no estoque, com o próprio código de etiqueta.
            </p>

            <div className="flex flex-col gap-4">
              {eixos.map((e) => {
                const desteEixo = marcadas[e.id] ?? []
                return (
                  <section key={e.id}>
                    <h3 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wide text-tinta-3 uppercase">
                      {e.nome}
                      {desteEixo.length > 0 && (
                        <span className="numero rounded bg-superficie-2 px-1.5 py-px text-[10px] font-semibold text-tinta-2">
                          {desteEixo.length}
                        </span>
                      )}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {e.opcoes.map((o) => {
                        const ligada = desteEixo.includes(o.id)
                        return (
                          <label
                            key={o.id}
                            className={cx(
                              'flex cursor-pointer items-center gap-1.5 rounded-norte border px-2.5 py-1.5 text-sm transition-colors',
                              ligada
                                // Escolha é azul, como no `Marcar`: verde é situação.
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
                  </section>
                )
              })}
            </div>

            {usados.length > 1 && (
              <p className="mt-4 text-sm text-tinta-2">
                {usados.map((e) => `${marcadas[e.id]!.length} ${e.nome.toLowerCase()}`).join(' × ')}{' '}
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
          </>
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

      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/${slug}/produtos`}
          className="text-sm font-medium text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
        >
          Voltar
        </Link>
        <Botao type="submit" tom="confirmar" carregando={pendente}>
          {pendente ? 'Salvando...' : produto ? 'Salvar' : 'Cadastrar'}
        </Botao>
      </div>
    </form>
  )
}
