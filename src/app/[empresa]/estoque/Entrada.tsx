'use client'

// Dar entrada na mercadoria que chegou.
//
// A tela é uma lista que cresce: busca, adiciona, digita quantidade e custo.
// Quem recebe a caixa do fornecedor tem a nota na mão e vai item por item —
// então nada de abrir e fechar janela por peça.
//
// ── a decisão que faz esta tela valer ────────────────────────
// O CUSTO E A CONTA A PAGAR ficam aqui, não em outra tela. É agora que a
// informação está fresca: a nota está na mão, o valor está escrito nela.
// Separado, o custo nunca é atualizado (e a margem do mês vira ficção) e a
// conta é lançada de cabeça no fim do mês, com o valor errado.

import { useEffect, useRef, useState, useTransition } from 'react'
import { Botao, Campo, Selecao, Marcar, Aviso, Cartao, cx } from '@/ui/base'
import { procurarParaEntrada, darEntrada, type AchadoEstoque } from './acoes'

type Linha = AchadoEstoque & { quantidade: number; custoUnit: number | null }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hojeMais = (dias: number) =>
  new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10)

export function Entrada({
  slug,
  unidadeId,
  unidadeNome,
  ambiguo,
  categorias,
  podeLancarConta,
}: {
  slug: string
  unidadeId: string
  unidadeNome: string
  /** A tela está no consolidado e a empresa tem mais de uma loja. */
  ambiguo: boolean
  categorias: { id: string; nome: string }[]
  podeLancarConta: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<AchadoEstoque[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [fornecedor, setFornecedor] = useState('')
  const [documento, setDocumento] = useState('')
  const [lancarConta, setLancarConta] = useState(false)
  const [categoriaId, setCategoriaId] = useState(
    categorias.find((c) => c.nome === 'Compra de mercadoria')?.id ?? categorias[0]?.id ?? '',
  )
  const [vencimento, setVencimento] = useState(hojeMais(30))
  const [jaPago, setJaPago] = useState(false)
  const [recado, setRecado] = useState<{ nivel: 'bom' | 'critico' | 'atencao'; texto: string } | null>(null)
  const [indo, comecar] = useTransition()

  const busca = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (termo.trim().length < 2) {
      setAchados([])
      return
    }
    const t = setTimeout(() => {
      procurarParaEntrada(slug, unidadeId, termo).then(setAchados).catch(() => setAchados([]))
    }, 180)
    return () => clearTimeout(t)
  }, [termo, slug, unidadeId])

  const total = linhas.reduce((s, l) => s + (l.custoUnit ?? 0) * l.quantidade, 0)
  const semCusto = linhas.filter((l) => l.custoUnit == null).length

  function adicionar(a: AchadoEstoque) {
    setLinhas((atual) =>
      atual.some((l) => l.id === a.id)
        ? atual
        : [...atual, { ...a, quantidade: 1, custoUnit: a.custo }],
    )
    setTermo('')
    setAchados([])
    busca.current?.focus()
  }

  const mudar = (id: string, campo: 'quantidade' | 'custoUnit', valor: number | null) =>
    setLinhas((atual) => atual.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)))

  function enviar() {
    setRecado(null)
    comecar(async () => {
      const r = await darEntrada(slug, {
        unidadeId,
        fornecedor,
        documento,
        itens: linhas.map((l) => ({
          variacaoId: l.id,
          quantidade: l.quantidade,
          custoUnit: l.custoUnit,
        })),
        conta:
          lancarConta && podeLancarConta ? { categoriaId, vencimento, jaPago } : null,
      })

      if (r.erro) {
        setRecado({ nivel: 'critico', texto: r.erro })
        return
      }
      setRecado({
        nivel: r.aviso ? 'atencao' : 'bom',
        texto: r.aviso ? `${r.ok} ${r.aviso}` : (r.ok ?? 'Pronto.'),
      })
      setLinhas([])
      setFornecedor('')
      setDocumento('')
    })
  }

  if (!aberto) {
    return (
      <div className="flex items-center gap-3">
        <Botao tom="principal" onClick={() => setAberto(true)}>
          + Dar entrada
        </Botao>
        {recado && (
          <span
            className={cx(
              'text-sm font-medium',
              recado.nivel === 'bom' ? 'text-bom' : recado.nivel === 'atencao' ? 'text-atencao' : 'text-critico',
            )}
          >
            {recado.texto}
          </span>
        )}
      </div>
    )
  }

  return (
    <Cartao
      titulo="Entrada de mercadoria"
      acao={
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-xs text-tinta-3 hover:text-tinta"
        >
          fechar
        </button>
      }
    >
      {recado && (
        <div className="mb-3">
          <Aviso nivel={recado.nivel}>{recado.texto}</Aviso>
        </div>
      )}

      {/* Mercadoria entra em UMA loja. No consolidado a tela soma as duas, e
          sem dizer onde vai entrar a pessoa dá entrada na loja errada e só
          descobre no balanço. */}
      {ambiguo && (
        <div className="mb-3">
          <Aviso nivel="atencao">
            A mercadoria vai entrar em <b>{unidadeNome}</b>. A lista abaixo está somando
            todas as lojas — troque a loja no alto da tela se for outra.
          </Aviso>
        </div>
      )}

      {/* ── busca ── */}
      <div className="relative">
        <Campo
          campoRef={busca}
          rotulo="O que chegou"
          value={termo}
          onChange={(e) => setTermo(e.currentTarget.value)}
          placeholder="Bipe a etiqueta ou digite o nome"
          autoComplete="off"
        />
        {achados.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-norte border border-borda bg-superficie shadow-norte">
            {achados.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => adicionar(a)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-superficie-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-tinta">{a.descricao}</span>
                    <span className="font-mono text-xs text-tinta-3">{a.codigo}</span>
                  </span>
                  <span className="numero shrink-0 text-xs text-tinta-3">
                    {a.saldo} em {unidadeNome}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── o que vai entrar ── */}
      {linhas.length > 0 && (
        <ul className="mt-4 flex flex-col">
          {linhas.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-end gap-3 border-b border-borda-suave py-2.5 last:border-0"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-tinta">{l.descricao}</span>
                <span className="font-mono text-xs text-tinta-3">
                  {l.codigo} · tem {l.saldo} em {unidadeNome}
                </span>
              </span>

              <label className="flex w-24 flex-col gap-1">
                <span className="text-xs font-medium text-tinta-2">Quantas</span>
                <input
                  type="number"
                  min={0}
                  step={l.medida === 'UN' || l.medida === 'PAR' || l.medida === 'CX' ? 1 : 0.001}
                  value={l.quantidade}
                  onChange={(e) => mudar(l.id, 'quantidade', Number(e.currentTarget.value))}
                  className="numero rounded-norte border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta"
                />
              </label>

              <label className="flex w-28 flex-col gap-1">
                <span className="text-xs font-medium text-tinta-2">Custo un.</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={l.custoUnit ?? ''}
                  placeholder="—"
                  onChange={(e) =>
                    mudar(l.id, 'custoUnit', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))
                  }
                  className="numero rounded-norte border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta"
                />
              </label>

              <button
                type="button"
                onClick={() => setLinhas((a) => a.filter((x) => x.id !== l.id))}
                className="pb-2 text-xs text-tinta-3 hover:text-critico"
              >
                tirar
              </button>
            </li>
          ))}
        </ul>
      )}

      {linhas.length > 0 && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Campo
              rotulo="Fornecedor"
              value={fornecedor}
              onChange={(e) => setFornecedor(e.currentTarget.value)}
              placeholder="Distribuidora Norte"
            />
            <Campo
              rotulo="Nota ou pedido"
              value={documento}
              onChange={(e) => setDocumento(e.currentTarget.value)}
              placeholder="Opcional"
            />
          </div>

          {semCusto > 0 && (
            <p className="mt-3 text-xs text-tinta-3">
              {semCusto} {semCusto === 1 ? 'item' : 'itens'} sem custo. Sem ele o relatório não consegue calcular a
              margem daquela peça — e o total abaixo fica incompleto.
            </p>
          )}

          {podeLancarConta && (
            <div className="mt-4 flex flex-col gap-3">
              <Marcar
                name="lancarConta"
                checked={lancarConta}
                onChange={(e) => setLancarConta(e.currentTarget.checked)}
                titulo={`Lançar a conta do fornecedor — ${brl(total)}`}
                resumo="Entra em contas a pagar com o total desta entrada. Comprar mercadoria não é despesa do mês: vira custo quando a peça vende."
              />
              {lancarConta && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Selecao
                    rotulo="Categoria"
                    value={categoriaId}
                    onChange={(e) => setCategoriaId(e.currentTarget.value)}
                    opcoes={categorias.map((c) => ({ valor: c.id, titulo: c.nome }))}
                  />
                  <Campo
                    rotulo="Vencimento"
                    type="date"
                    value={vencimento}
                    onChange={(e) => setVencimento(e.currentTarget.value)}
                  />
                  <div className="flex items-end pb-1">
                    <Marcar
                      name="jaPago"
                      checked={jaPago}
                      onChange={(e) => setJaPago(e.currentTarget.checked)}
                      titulo="Já paguei"
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <span className="text-sm text-tinta-2">
              {linhas.length} {linhas.length === 1 ? 'item' : 'itens'} ·{' '}
              <b className="numero text-tinta">{brl(total)}</b>
            </span>
            <Botao tom="confirmar" carregando={indo} onClick={enviar}>
              {indo ? 'Registrando...' : 'Dar entrada'}
            </Botao>
          </div>
        </>
      )}
    </Cartao>
  )
}
