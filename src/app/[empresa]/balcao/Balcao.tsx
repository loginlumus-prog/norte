'use client'

// A tela do balcão.
//
// Aqui as regras vêm de quem fica em pé atrás do caixa, não de quem desenha:
//
// 1. O CURSOR VOLTA SOZINHO PARA A BUSCA. Depois de cada item lançado. Quem
//    passa o leitor de código de barras não pode ter que clicar entre um bipe
//    e outro — o leitor digita e dá Enter, e só isso.
// 2. ENTER LANÇA O PRIMEIRO RESULTADO. Se veio um só, entra direto.
// 3. NADA DE MODAL PARA FECHAR. O pagamento vive ao lado, sempre visível: com
//    fila esperando, abrir e fechar janela custa segundos que não existem.
// 4. O TROCO APARECE ANTES DE CONFIRMAR, grande. É o número que a pessoa vai
//    conferir na gaveta.
// 5. QUEM NÃO TEM ETIQUETA TOCA NO BOTÃO. Sorveteria não etiqueta picolé,
//    lanchonete não etiqueta X-salada. Para essas, embaixo da busca fica a
//    grade: categorias como abas, produtos como botões com nome e preço, um
//    toque lança. E a quantidade se escolhe ANTES de tocar ("×20, picolé"),
//    que é uma ação a menos do que lançar e corrigir depois.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { EscolherCliente } from './Cliente'
import type { ClienteNoBalcao } from './acoes'
import { chaveDoBalcao, guardar, recuperar, esquecer, faz } from './guardar'
import { oferecer, valorEmCentavos, type Programa } from '@/servidor/pontos'
import { Botao, Campo, Aviso, Situacao, cx } from '@/ui/base'
import { procurar, grade, fecharVenda, type Achado, type Grade } from './acoes'

const FORMAS = [
  { chave: 'DINHEIRO', titulo: 'Dinheiro' },
  { chave: 'PIX', titulo: 'Pix' },
  { chave: 'DEBITO', titulo: 'Débito' },
  { chave: 'CREDITO', titulo: 'Crédito' },
] as const

type Linha = Achado & { quantidade: number }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const cent = (v: number) => Math.round(v * 100)

export function Balcao({
  slug,
  unidadeId,
  usuarioId,
  caixaId,
  unidadeNome,
  programa,
}: {
  slug: string
  unidadeId: string
  /** Quem está operando. Entra na chave do que fica guardado — ver guardar.ts. */
  usuarioId: string
  caixaId: string | null
  unidadeNome: string
  programa: Programa
}) {
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<Achado[]>([])
  const [carrinho, setCarrinho] = useState<Linha[]>([])
  const [pagos, setPagos] = useState<{ forma: string; valor: number }[]>([])
  const [desconto, setDesconto] = useState(0)
  const [cliente, setCliente] = useState<ClienteNoBalcao | null>(null)
  const [pontosUsar, setPontosUsar] = useState(0)
  const [recado, setRecado] = useState<{ nivel: 'bom' | 'critico'; texto: string } | null>(null)
  const [voltou, setVoltou] = useState<number | null>(null)
  const [indo, comecar] = useTransition()

  // ── a grade e a quantidade ───────────────────────────────
  // `qtd` é a quantidade do PRÓXIMO lançamento, e volta a 1 depois de cada um.
  // Para peso (KG), é o peso lido na balança; para unidade, quantas.
  const [qtd, setQtd] = useState(1)
  const [botoes, setBotoes] = useState<Grade | null>(null)
  const [categoriaId, setCategoriaId] = useState<string | null>(null)
  const qtdRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let vivo = true
    grade(slug, unidadeId, categoriaId)
      .then((g) => vivo && setBotoes(g))
      .catch(() => vivo && setBotoes(null))
    return () => {
      vivo = false
    }
  }, [slug, unidadeId, categoriaId])

  const busca = useRef<HTMLInputElement>(null)
  const focarBusca = () => busca.current?.focus()

  // ── a venda em andamento não se perde ────────────────────
  // Ver guardar.ts para o porquê. Aqui é só a ligação com a tela, e ela tem
  // uma ordem que importa: RECUPERAR antes de começar a GUARDAR.
  //
  // Sem isso os dois efeitos brigam na montagem — o de guardar rodaria com o
  // carrinho ainda vazio e apagaria o que o de recuperar ia buscar. O
  // `primeiraVez` existe só para o segundo efeito deixar a montagem passar.
  const chave = useMemo(
    () => chaveDoBalcao(slug, unidadeId, usuarioId),
    [slug, unidadeId, usuarioId],
  )
  const primeiraVez = useRef(true)

  useEffect(() => {
    const g = recuperar(chave)
    if (!g) return
    setCarrinho(g.carrinho as Linha[])
    setPagos(g.pagos)
    setDesconto(g.desconto)
    setCliente(g.cliente)
    setPontosUsar(g.pontosUsar)
    setVoltou(g.em)
  }, [chave])

  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false
      return
    }
    if (carrinho.length === 0) esquecer(chave)
    else guardar(chave, { carrinho, pagos, desconto, cliente, pontosUsar })
  }, [chave, carrinho, pagos, desconto, cliente, pontosUsar])

  // Busca conforme digita, com uma pausa curta para não consultar a cada tecla.
  useEffect(() => {
    if (termo.trim().length < 2) {
      setAchados([])
      return
    }
    const t = setTimeout(() => {
      procurar(slug, unidadeId, termo).then(setAchados).catch(() => setAchados([]))
    }, 180)
    return () => clearTimeout(t)
  }, [termo, slug, unidadeId])

  const totalCent = carrinho.reduce((s, l) => s + Math.round(cent(l.preco) * l.quantidade), 0)
  const descontoCent = cent(desconto)
  const comDescontoCent = Math.max(totalCent - descontoCent, 0)

  // A oferta de pontos é calculada em cima do valor JÁ com desconto, e sobre o
  // saldo menos o que já foi marcado — senão, ao aplicar, a tela ofereceria os
  // mesmos pontos de novo.
  const oferta = cliente ? oferecer(cliente.pontos, comDescontoCent, programa) : null
  const pontosCent = valorEmCentavos(pontosUsar, programa)
  const aPagarCent = Math.max(comDescontoCent - pontosCent, 0)
  const pagoCent = pagos.reduce((s, p) => s + cent(p.valor), 0)
  const faltaCent = aPagarCent - pagoCent
  // Troco só existe em dinheiro. Cartão e Pix não devolvem diferença — se
  // sobrar ali, é erro de digitação, e a venda tem que travar em vez de
  // "dar troco" de um valor que nunca entrou na gaveta.
  const temDinheiro = pagos.some((p) => p.forma === 'DINHEIRO')
  const trocoCent = temDinheiro ? Math.max(-faltaCent, 0) : 0
  const sobrouSemDinheiro = !temDinheiro && faltaCent < 0

  function lancar(a: Achado) {
    setRecado(null)
    const q = qtd > 0 ? qtd : 1
    setCarrinho((c) => {
      const jaTem = c.find((l) => l.id === a.id)
      // Unidade acumula: tocar duas vezes no picolé é dois picolés. Peso
      // não acumula sozinho: 0,3 kg + 0,3 kg raramente é o que se quer — a
      // segunda pesagem SUBSTITUI a primeira.
      if (jaTem && a.medida === 'UN') {
        return c.map((l) => (l.id === a.id ? { ...l, quantidade: l.quantidade + q } : l))
      }
      if (jaTem) return c.map((l) => (l.id === a.id ? { ...l, quantidade: q } : l))
      return [...c, { ...a, quantidade: q }]
    })
    // A quantidade é do lançamento, não da sessão: "×20" vale para o próximo
    // toque e mais nenhum. Sem isto, o "20" esquecido lançava 20 do item
    // seguinte — e o erro só aparecia no total.
    setQtd(1)
    setTermo('')
    setAchados([])
    focarBusca()
  }

  function mudarQtd(id: string, q: number) {
    setCarrinho((c) => c.map((l) => (l.id === id ? { ...l, quantidade: Math.max(q, 0) } : l)))
  }

  const tirar = (id: string) => setCarrinho((c) => c.filter((l) => l.id !== id))

  function pagarCom(forma: string) {
    // Clicar na forma preenche o que FALTA. É o gesto mais comum: a pessoa
    // escolhe como vai receber e o valor já vem certo. Mas o valor fica
    // EDITÁVEL: em dinheiro o cliente entrega R$ 100 numa venda de R$ 83, e o
    // caixa precisa digitar os 100 para ver o troco.
    const falta = (aPagarCent - pagoCent) / 100
    if (falta <= 0) return
    setPagos((p) => [...p, { forma, valor: falta }])
  }

  const mudarPago = (i: number, valor: number) =>
    setPagos((p) => p.map((x, j) => (j === i ? { ...x, valor: Math.max(valor, 0) } : x)))

  function limpar() {
    setVoltou(null)
    setCarrinho([])
    setPagos([])
    setDesconto(0)
    setCliente(null)
    setPontosUsar(0)
    setTermo('')
    setAchados([])
    focarBusca()
  }

  function concluir() {
    if (carrinho.length === 0) return
    comecar(async () => {
      const r = await fecharVenda(slug, {
        unidadeId,
        caixaId,
        desconto,
        clienteId: cliente?.id ?? null,
        pontosUsar,
        itens: carrinho.map((l) => ({
          variacaoId: l.id,
          quantidade: l.quantidade,
          precoUnit: l.preco,
        })),
        // O troco não é pagamento: o que entra no sistema é o que FICA na
        // gaveta. E ele sai do dinheiro, nunca do cartão.
        pagamentos: (() => {
          if (trocoCent === 0) return pagos
          const ultimoDinheiro = pagos.map((p) => p.forma).lastIndexOf('DINHEIRO')
          return pagos.map((p, i) =>
            i === ultimoDinheiro ? { ...p, valor: p.valor - trocoCent / 100 } : p,
          )
        })(),
      })

      if (r.ok) {
        // O ganho aparece no recado porque e a hora de falar: "voce ja tem
        // 1.240 pontos" dito no balcao e o que faz a pessoa voltar. Guardado
        // so no banco, o programa nao existe para quem compra.
        const ganhou = r.pontosGanhos > 0 ? ` · ganhou ${r.pontosGanhos} pontos` : ''
        setRecado({
          nivel: 'bom',
          texto: `Venda ${r.numero} fechada — ${brl(r.total)}${ganhou}`,
        })
        limpar()
      } else if (r.motivo === 'pontos_recusados') {
        setRecado({ nivel: 'critico', texto: r.recado })
        setPontosUsar(0)
      } else if (r.motivo === 'sem_estoque') {
        setRecado({
          nivel: 'critico',
          texto: `Sem estoque: ${r.faltando.map((f) => `${f.descricao} (tem ${f.tem})`).join(', ')}`,
        })
      } else if (r.motivo === 'pagamento_nao_fecha') {
        setRecado({ nivel: 'critico', texto: `A conta não fecha: falta ${brl(r.total - r.pago)}` })
      } else if (r.motivo === 'caixa_fechado') {
        setRecado({ nivel: 'critico', texto: 'O caixa foi fechado. Abra de novo para vender.' })
      } else {
        setRecado({ nivel: 'critico', texto: 'Não deu para fechar a venda.' })
      }
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      {/* ── esquerda: buscar e lançar ── */}
      <div className="flex flex-col gap-3">
        {/* Recuperar em silêncio seria pior que perder: a pessoa veria itens
            que ela não lançou agora e não saberia de onde vieram. Diz o que
            aconteceu, de quando é, e deixa jogar fora num clique. */}
        {voltou !== null && carrinho.length > 0 && (
          <Aviso nivel="atencao">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Recuperamos a venda que estava sendo montada {faz(voltou)}.</span>
              <button
                type="button"
                onClick={limpar}
                className="font-semibold underline underline-offset-2"
              >
                Não é essa — começar do zero
              </button>
            </span>
          </Aviso>
        )}

        {recado && <Aviso nivel={recado.nivel}>{recado.texto}</Aviso>}

        <div className="relative flex gap-2">
          {/* A quantidade fica À ESQUERDA, antes do produto, porque é essa a
              ordem em que se fala: "vinte picolés", não "picolé, vinte".
              Estreita e com o × na frente para ler como multiplicador. */}
          <label className="flex shrink-0 items-center gap-1 rounded-norte border-2 border-borda bg-superficie px-2">
            <span aria-hidden className="text-sm text-tinta-3">×</span>
            <input
              ref={qtdRef}
              type="number"
              min={0.001}
              step="any"
              inputMode="decimal"
              value={qtd}
              onChange={(e) => setQtd(Number(e.target.value))}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  focarBusca()
                }
              }}
              aria-label="Quantidade do próximo item"
              className="numero w-14 bg-transparent py-3 text-center text-base text-tinta focus:outline-none"
            />
          </label>
          <input
            ref={busca}
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && achados[0]) {
                e.preventDefault()
                lancar(achados[0])
              }
              if (e.key === 'Escape') {
                setTermo('')
                setAchados([])
              }
            }}
            placeholder="Bipe a etiqueta ou digite o nome..."
            aria-label="Procurar produto"
            className={cx(
              'w-full rounded-norte border-2 border-borda bg-superficie px-4 py-3',
              'text-base text-tinta placeholder:text-tinta-3',
              'focus:border-marca focus:outline-none',
            )}
          />
          {achados.length > 0 && (
            <ul className="absolute z-20 mt-1 flex max-h-80 w-full flex-col overflow-y-auto rounded-norte border border-borda bg-superficie shadow-norte">
              {achados.map((a, i) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => lancar(a)}
                    className="flex w-full items-center justify-between gap-3 border-b border-borda-suave px-3 py-2 text-left last:border-0 hover:bg-superficie-2"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-tinta">
                        {a.descricao}
                      </span>
                      <span className="font-mono text-xs text-tinta-3">{a.codigo}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Situacao nivel={a.saldo <= 0 ? 'critico' : 'bom'}>
                        {a.saldo <= 0 ? 'acabou' : `${a.saldo}`}
                      </Situacao>
                      <span className="numero text-sm font-semibold text-tinta">
                        {brl(a.preco)}
                      </span>
                      {i === 0 && (
                        <kbd className="rounded bg-superficie-3 px-1 text-[10px] text-tinta-3">
                          Enter
                        </kbd>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── a grade de botões ──
            Aparece quando a busca está vazia — quem está digitando quer o
            dropdown, quem não está quer os botões. Some sozinha quando não há
            o que mostrar (loja sem produto ainda). */}
        {termo.trim().length < 2 && botoes && botoes.itens.length > 0 && (
          <div className="flex flex-col gap-2">
            {botoes.categorias.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[{ id: null as string | null, nome: 'Todos', quantos: 0 }, ...botoes.categorias].map((c) => (
                  <button
                    key={c.id ?? 'todos'}
                    type="button"
                    onClick={() => setCategoriaId(c.id)}
                    aria-pressed={categoriaId === c.id}
                    className={cx(
                      'rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
                      categoriaId === c.id
                        ? 'bg-tinta text-superficie'
                        : 'border border-borda bg-superficie text-tinta-2 hover:bg-superficie-2',
                    )}
                  >
                    {c.nome}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {botoes.itens.map((a) => {
                const acabou = a.saldo <= 0
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => lancar(a)}
                    disabled={acabou}
                    title={acabou ? 'Acabou' : `Lançar ${a.descricao}`}
                    className={cx(
                      'flex min-h-[4.25rem] flex-col justify-between rounded-norte border px-3 py-2 text-left transition-colors',
                      acabou
                        ? 'cursor-not-allowed border-borda-suave bg-superficie-2 text-tinta-3'
                        : 'border-borda bg-superficie hover:border-marca hover:bg-superficie-2 active:bg-marca/10',
                    )}
                  >
                    <span className="line-clamp-2 text-[13px] leading-snug font-medium">{a.descricao}</span>
                    <span className="flex items-baseline justify-between gap-2 pt-1">
                      <span className="numero text-sm font-bold">{brl(a.preco)}</span>
                      <span className={cx('numero text-[11px]', acabou ? 'font-semibold' : 'text-tinta-3')}>
                        {acabou ? 'acabou' : a.saldo}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            {botoes.cortou && (
              <p className="text-xs text-tinta-3">
                Categoria grande demais para botão — mostrando os primeiros. Para o resto, digite.
              </p>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-norte border border-borda bg-superficie">
          {carrinho.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-tinta-3">
              {botoes && botoes.itens.length > 0
                ? 'Toque num produto, ou bipe a etiqueta.'
                : 'Bipe a primeira etiqueta para começar.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-borda bg-superficie-2 text-xs tracking-wide text-tinta-3 uppercase">
                  <th className="px-3 py-2 text-left font-semibold">Item</th>
                  <th className="w-28 px-3 py-2 text-right font-semibold">Qtd</th>
                  <th className="w-28 px-3 py-2 text-right font-semibold">Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {carrinho.map((l) => (
                  <tr key={l.id} className="border-b border-borda-suave last:border-0">
                    <td className="px-3 py-2">
                      <span className="block text-tinta">{l.descricao}</span>
                      <span className="font-mono text-xs text-tinta-3">
                        {l.codigo} · {brl(l.preco)}
                        {l.medida !== 'UN' && ` / ${l.medida.toLowerCase()}`}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={l.quantidade}
                        min={0}
                        step={l.medida === 'UN' ? 1 : 0.001}
                        onChange={(e) => mudarQtd(l.id, Number(e.target.value))}
                        aria-label={`Quantidade de ${l.descricao}`}
                        className="numero w-full rounded border border-borda bg-superficie px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="numero px-3 py-2 font-semibold text-tinta">
                      {brl((Math.round(cent(l.preco) * l.quantidade)) / 100)}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => tirar(l.id)}
                        aria-label={`Tirar ${l.descricao}`}
                        className="rounded px-1.5 py-0.5 text-sm text-tinta-3 hover:bg-critico-fundo hover:text-critico"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── direita: pagamento, sempre visível ── */}
      <aside className="flex h-fit flex-col gap-3 rounded-norte border border-borda bg-superficie p-4 lg:sticky lg:top-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-tinta-3">{unidadeNome}</span>
          {!caixaId && <Situacao nivel="critico">caixa fechado</Situacao>}
        </div>

        <EscolherCliente slug={slug} escolhido={cliente} aoEscolher={setCliente} />

        <div className="flex flex-col gap-1 border-b border-borda-suave pb-3">
          <div className="flex items-baseline justify-between text-sm text-tinta-2">
            <span>{carrinho.length} item{carrinho.length === 1 ? '' : 's'}</span>
            <span className="numero">{brl(totalCent / 100)}</span>
          </div>
          <label className="flex items-center justify-between gap-2 text-sm text-tinta-2">
            Desconto
            <input
              type="number"
              min={0}
              step={0.01}
              value={desconto || ''}
              onChange={(e) => setDesconto(Number(e.target.value) || 0)}
              placeholder="0,00"
              className="numero w-24 rounded border border-borda bg-superficie px-2 py-1 text-sm"
            />
          </label>

          {/* A oferta. Aparece sozinha, com o numero pronto: ninguem no balcao
              vai abrir outra tela para descobrir quantos pontos a pessoa tem,
              nem fazer a conta de quanto isso vale. Se nao aparecer aqui,
              o programa de pontos nao existe na pratica. */}
          {oferta?.pode && pontosUsar === 0 && (
            <button
              type="button"
              onClick={() => setPontosUsar(oferta.pontos)}
              className={
                'flex items-center justify-between gap-2 rounded-norte border ' +
                'border-bom-vivo bg-bom-fundo px-2.5 py-2 text-left'
              }
            >
              <span className="flex flex-col">
                <span className="text-xs font-semibold text-tinta">
                  Tem {oferta.saldo} pontos
                </span>
                <span className="text-xs text-tinta-2">
                  da {brl(oferta.centavos / 100)} de desconto
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold text-bom">usar</span>
            </button>
          )}

          {pontosUsar > 0 && (
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-tinta-2">{pontosUsar} pontos</span>
              <span className="flex items-baseline gap-2">
                <span className="numero text-bom">- {brl(pontosCent / 100)}</span>
                <button
                  type="button"
                  onClick={() => setPontosUsar(0)}
                  className="text-xs text-tinta-3 hover:text-tinta"
                  aria-label="Nao usar os pontos"
                >
                  x
                </button>
              </span>
            </div>
          )}

          {oferta && !oferta.pode && oferta.recado && (
            <span className="text-xs text-tinta-3">{oferta.recado}</span>
          )}
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-tinta">A pagar</span>
          <span className="numero text-3xl font-bold tracking-tight text-tinta">
            {brl(aPagarCent / 100)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {FORMAS.map((f) => (
            <Botao
              key={f.chave}
              tom="secundario"
              onClick={() => pagarCom(f.chave)}
              disabled={aPagarCent === 0 || faltaCent <= 0}
              className="py-2 text-xs"
            >
              {f.titulo}
            </Botao>
          ))}
        </div>

        {pagos.length > 0 && (
          <ul className="flex flex-col gap-1">
            {pagos.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-tinta-2">
                  {FORMAS.find((f) => f.chave === p.forma)?.titulo ?? p.forma}
                </span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={p.valor}
                    onChange={(e) => mudarPago(i, Number(e.target.value))}
                    aria-label={`Valor recebido em ${p.forma}`}
                    className="numero w-24 rounded border border-borda bg-superficie px-2 py-1 text-sm font-semibold text-tinta"
                  />
                  <button
                    type="button"
                    onClick={() => setPagos((x) => x.filter((_, j) => j !== i))}
                    aria-label="Tirar pagamento"
                    className="text-tinta-3 hover:text-critico"
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {faltaCent > 0 && pagos.length > 0 && (
          <div className="flex items-baseline justify-between rounded-norte bg-atencao-fundo px-2.5 py-1.5">
            <span className="text-sm font-semibold text-atencao">Falta</span>
            <span className="numero font-bold text-atencao">{brl(faltaCent / 100)}</span>
          </div>
        )}

        {sobrouSemDinheiro && (
          <Aviso nivel="critico">
            O valor passou do total, e não há dinheiro na venda para dar troco. Ajuste o
            valor recebido.
          </Aviso>
        )}

        {trocoCent > 0 && (
          <div className="flex items-baseline justify-between rounded-norte bg-bom-fundo px-2.5 py-2">
            <span className="text-sm font-semibold text-bom">Troco</span>
            <span className="numero text-2xl font-bold text-bom">{brl(trocoCent / 100)}</span>
          </div>
        )}

        <Botao
          tom="confirmar"
          largo
          onClick={concluir}
          carregando={indo}
          disabled={carrinho.length === 0 || faltaCent > 0 || sobrouSemDinheiro || !caixaId}
          className="py-3 text-base"
        >
          {indo ? 'Fechando...' : 'Fechar venda'}
        </Botao>

        {carrinho.length > 0 && (
          <Botao tom="discreto" largo onClick={limpar} className="py-1.5 text-xs">
            Cancelar venda
          </Botao>
        )}
      </aside>
    </div>
  )
}
