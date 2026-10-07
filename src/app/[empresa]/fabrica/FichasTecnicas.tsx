'use client'

// As fichas técnicas: o que entra numa batelada e quanto ela rende.
//
// É a ficha que faz a ordem de produção nascer com o previsto, e é ela que dá
// o custo de cada picolé. Por isso o custo aparece AO VIVO enquanto a pessoa
// monta: trocar 4 L de leite por 5 mostra na hora quanto a unidade encarece.
//
// O insumo se busca entre o MATERIAL DE USO (leite, açúcar, palito, pote) e
// também entre os outros produtos — a calda que a loja vende pode entrar no
// sundae que a fábrica faz.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao, cx } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { brl } from '@/ui/painel'
import { classeDaAcao, DicaDaAcao, IconeDaAcao } from '@/ui/premium'
import { quantidade } from '@/ui/texto'
import type { ItemDoCatalogo, ReceitaNaTela } from '@/servidor/fabrica'
import { apagarReceitaAcao, salvarReceitaAcao } from './acoes'
import { LEGIVEL, ler, paraCampo, sigla } from './formato'

type Linha = { chave: string; insumoId: string; quantidade: string }

const novaChave = () => Math.random().toString(36).slice(2)
const solto = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function FichasTecnicas({
  slug,
  receitas,
  catalogo,
  podeEditar,
  verCusto,
}: {
  slug: string
  receitas: ReceitaNaTela[]
  catalogo: ItemDoCatalogo[]
  podeEditar: boolean
  verCusto: boolean
}) {
  // null = fechado; '' = ficha nova; id = editando aquela.
  const [editando, setEditando] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const router = useRouter()
  const temInsumo = catalogo.some((i) => i.usoInterno)
  const receita = editando ? receitas.find((r) => r.id === editando) : undefined

  return (
    <div className="flex flex-col gap-4">
      {!temInsumo && (
        <Aviso nivel="atencao">
          Nenhum insumo cadastrado ainda. Cadastre o leite, o açúcar, o palito e o pote em{' '}
          <Link href={`/${slug}/produtos/novo`} className="font-semibold underline underline-offset-2">
            Produtos › Novo
          </Link>{' '}
          marcando <b>&ldquo;Material de uso — não vende&rdquo;</b>, com o custo de compra. Eles não aparecem no balcão, mas
          têm estoque e entram aqui.
        </Aviso>
      )}
      {recado && <Aviso nivel="bom">{recado}</Aviso>}

      {podeEditar && editando === null && (
        <Botao className="w-fit" onClick={() => { setRecado(null); setEditando('') }}>
          Nova ficha técnica
        </Botao>
      )}
      {podeEditar && editando !== null && (
        <Editor
          key={editando || 'nova'}
          slug={slug}
          receita={receita}
          jaTem={new Set(receitas.map((r) => r.variacaoId))}
          catalogo={catalogo}
          verCusto={verCusto}
          aoFechar={(ok) => {
            setEditando(null)
            if (ok) setRecado(ok)
          }}
        />
      )}

      {receitas.length === 0 ? (
        <p className="text-sm text-tinta-3">
          Nenhuma ficha técnica ainda. Comece pelo produto que mais sai: quanto de cada insumo vai numa batelada e quantos
          ficam prontos.
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {receitas.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
              <header className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold text-tinta">{r.produto}</span>
                  <span className="text-xs text-tinta-3">
                    {r.codigo && <span className="font-mono">{r.codigo} · </span>}
                    uma batelada rende {quantidade(r.rendimento, r.medida)}
                    {r.validadeDias ? ` · validade ${r.validadeDias} dias` : ' · sem validade'}
                  </span>
                </div>
                {r.custoUnidade != null && (
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="numero text-sm font-bold text-tinta">{brl(r.custoUnidade)}</span>
                    <span className="text-xs text-tinta-3">por {sigla(r.medida)}</span>
                  </span>
                )}
              </header>
              <ul className="flex flex-col gap-1 text-sm">
                {r.itens.map((i) => (
                  <li key={i.insumoId} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-tinta-2">{i.nome}</span>
                    <span className="numero shrink-0 text-tinta">{quantidade(i.quantidade, i.medida)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-tinta-3">
                {r.custoBatelada != null
                  ? `Custo da batelada: ${brl(r.custoBatelada)}, pelo custo de hoje dos insumos.`
                  : verCusto
                    ? 'Falta o custo de algum insumo: sem ele, o custo da batelada não fecha.'
                    : ''}
                {r.observacao ? ` ${r.observacao}` : ''}
              </p>
              {podeEditar && (
                <div className="flex flex-wrap gap-2">
                  <Botao tom="secundario" onClick={() => { setRecado(null); setEditando(r.id) }}>
                    Editar
                  </Botao>
                  <Confirmar
                    pergunta="Apagar a ficha? As ordens já feitas continuam."
                    sim="Sim, apagar"
                    aoConfirmar={async () => {
                      const x = await apagarReceitaAcao(slug, r.id)
                      if (x.ok) {
                        setRecado(x.ok)
                        router.refresh()
                      }
                      return x
                    }}
                  >
                    Apagar
                  </Confirmar>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Editor({
  slug,
  receita,
  jaTem,
  catalogo,
  verCusto,
  aoFechar,
}: {
  slug: string
  receita?: ReceitaNaTela
  jaTem: Set<string>
  catalogo: ItemDoCatalogo[]
  verCusto: boolean
  aoFechar: (ok?: string) => void
}) {
  // O pronto é o que se vende (não material de uso). Os que ainda não têm
  // ficha primeiro: é a ficha que falta fazer.
  const prontos = catalogo.filter((i) => !i.usoInterno && (!jaTem.has(i.variacaoId) || i.variacaoId === receita?.variacaoId))
  const [produto, setProduto] = useState(receita?.variacaoId ?? prontos[0]?.variacaoId ?? '')
  const [rendimento, setRendimento] = useState(receita ? paraCampo(receita.rendimento) : '')
  const [validade, setValidade] = useState(receita?.validadeDias ? String(receita.validadeDias) : '')
  const [observacao, setObservacao] = useState(receita?.observacao ?? '')
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    receita
      ? receita.itens.map((i) => ({ chave: novaChave(), insumoId: i.insumoId, quantidade: paraCampo(i.quantidade) }))
      : [{ chave: novaChave(), insumoId: '', quantidade: '' }],
  )
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const porId = useMemo(() => new Map(catalogo.map((i) => [i.variacaoId, i])), [catalogo])
  const pronto = porId.get(produto)
  const usados = new Set(linhas.map((l) => l.insumoId).filter(Boolean))

  // O custo enquanto monta: só fecha com o custo de TODOS os insumos.
  const r = ler(rendimento)
  const partes = linhas.filter((l) => l.insumoId).map((l) => ({ q: ler(l.quantidade), custo: porId.get(l.insumoId)?.custo ?? null }))
  const fecha = verCusto && partes.length > 0 && partes.every((p) => p.custo != null && p.q != null && !Number.isNaN(p.q))
  const custoBatelada = fecha ? partes.reduce((s, p) => s + (p.q ?? 0) * (p.custo ?? 0), 0) : null

  function salvar() {
    const rend = ler(rendimento)
    const dias = validade.trim() ? Number(validade.trim()) : null
    const itens = linhas.filter((l) => l.insumoId).map((l) => ({ insumoId: l.insumoId, quantidade: ler(l.quantidade) }))
    if (rend === null) return setErro('Quanto sai de uma batelada?')
    if (Number.isNaN(rend) || itens.some((i) => i.quantidade === null || Number.isNaN(i.quantidade))) return setErro(LEGIVEL)
    if (dias !== null && !Number.isInteger(dias)) return setErro('A validade é em dias inteiros (ou em branco).')
    setErro(null)
    comecar(async () => {
      const x = await salvarReceitaAcao(slug, { variacaoId: produto, rendimento: rend, validadeDias: dias, observacao, itens })
      if (x.erro) return setErro(x.erro)
      router.refresh()
      aoFechar(x.ok)
    })
  }

  return (
    <Cartao
      caixa
      titulo={receita ? `Ficha técnica · ${receita.produto}` : 'Nova ficha técnica'}
      acao={
        <button type="button" onClick={() => aoFechar()} className={classeDaAcao()} aria-label="Fechar a ficha técnica">
          <IconeDaAcao icone="fechar" />
          <DicaDaAcao>Fechar</DicaDaAcao>
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {receita ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-tinta">Produto pronto</span>
              <span className="truncate rounded-norte border border-borda-suave bg-superficie-2 px-3 py-2 text-sm text-tinta">{receita.produto}</span>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="ficha-produto" className="text-sm font-medium text-tinta">
                Produto pronto
              </label>
              <select
                id="ficha-produto"
                value={produto}
                onChange={(ev) => setProduto(ev.currentTarget.value)}
                className="w-full min-w-0 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
              >
                {prontos.length === 0 && <option value="">Todos os produtos já têm ficha</option>}
                {prontos.map((p) => (
                  <option key={p.variacaoId} value={p.variacaoId}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Campo
            rotulo={`Quanto sai de uma batelada${pronto ? ` (${sigla(pronto.medida)})` : ''}`}
            name="rendimento"
            inputMode="decimal"
            value={rendimento}
            onChange={(ev) => setRendimento(ev.currentTarget.value)}
            placeholder="40"
          />
          <Campo
            rotulo="Validade (dias)"
            name="validade"
            inputMode="numeric"
            value={validade}
            onChange={(ev) => setValidade(ev.currentTarget.value.replace(/\D/g, ''))}
            placeholder="180"
            dica="Em branco: sem validade."
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-tinta">Insumos de UMA batelada</p>
          <ul className="flex flex-col gap-2">
            {linhas.map((l, n) => {
              const item = porId.get(l.insumoId)
              return (
                <li key={l.chave} className="grid grid-cols-1 items-end gap-2 rounded-norte border border-borda-suave p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
                  {item ? (
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-sm font-medium text-tinta">Insumo</span>
                      <span className="flex items-center justify-between gap-2 rounded-norte border border-borda-suave bg-superficie-2 py-1 pr-1 pl-3 text-sm">
                        <span className="min-w-0 truncate text-tinta">{item.nome}</span>
                        <button
                          type="button"
                          onClick={() => setLinhas((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, insumoId: '' } : x)))}
                          className={classeDaAcao()}
                          aria-label={`Trocar o insumo ${item.nome}`}
                        >
                          <IconeDaAcao icone="trocar" />
                          <DicaDaAcao>Trocar</DicaDaAcao>
                        </button>
                      </span>
                    </div>
                  ) : (
                    <BuscaInsumo
                      id={`insumo-${l.chave}`}
                      catalogo={catalogo}
                      fora={new Set([...usados, produto])}
                      aoEscolher={(i) => setLinhas((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, insumoId: i.variacaoId } : x)))}
                    />
                  )}
                  <Campo
                    rotulo={`Quantidade${item ? ` (${sigla(item.medida)})` : ''}`}
                    name={`qtd-${l.chave}`}
                    id={`qtd-${l.chave}`}
                    inputMode="decimal"
                    value={l.quantidade}
                    onChange={(ev) => {
                      const v = ev.currentTarget.value
                      setLinhas((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, quantidade: v } : x)))
                    }}
                  />
                  <button
                    type="button"
                    className={classeDaAcao({ tom: 'perigo' })}
                    aria-label={`Remover a linha ${n + 1}`}
                    onClick={() => setLinhas((ls) => (ls.length === 1 ? [{ chave: novaChave(), insumoId: '', quantidade: '' }] : ls.filter((x) => x.chave !== l.chave)))}
                  >
                    <IconeDaAcao icone="excluir" />
                    <DicaDaAcao>Remover</DicaDaAcao>
                  </button>
                </li>
              )
            })}
          </ul>
          <Botao tom="secundario" className="w-fit" onClick={() => setLinhas((ls) => [...ls, { chave: novaChave(), insumoId: '', quantidade: '' }])}>
            + insumo
          </Botao>
        </div>

        <Campo rotulo="Observação (opcional)" name="observacao" value={observacao} onChange={(ev) => setObservacao(ev.currentTarget.value)} placeholder="Bater 10 minutos, descansar a calda…" />

        {verCusto && (
          <p className="text-sm text-tinta-2">
            {custoBatelada != null ? (
              <>
                Custo da batelada: <b className="numero text-tinta">{brl(custoBatelada)}</b>
                {r != null && !Number.isNaN(r) && r > 0 && pronto && (
                  <>
                    {' '}· por {sigla(pronto.medida)}: <b className="numero text-tinta">{brl(custoBatelada / r)}</b>
                  </>
                )}
                , pelo custo de hoje dos insumos.
              </>
            ) : partes.length > 0 ? (
              'Algum insumo está sem custo na ficha dele: o custo da batelada não fecha sem todos.'
            ) : null}
          </p>
        )}

        {erro && <Aviso nivel="critico">{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <Botao tom="discreto" onClick={() => aoFechar()}>
            Fechar
          </Botao>
          <Botao carregando={indo} onClick={salvar} disabled={!produto}>
            Salvar a ficha
          </Botao>
        </div>
      </div>
    </Cartao>
  )
}

/**
 * Achar o insumo. Sem digitar nada, aparecem os de material de uso (são
 * poucos, e são quase sempre o que se procura); digitando, entram também os
 * outros produtos, depois deles.
 */
function BuscaInsumo({
  id,
  catalogo,
  fora,
  aoEscolher,
}: {
  id: string
  catalogo: ItemDoCatalogo[]
  fora: Set<string>
  aoEscolher: (i: ItemDoCatalogo) => void
}) {
  const [termo, setTermo] = useState('')
  const [aberta, setAberta] = useState(false)
  const t = solto(termo.trim())
  const achados = catalogo
    .filter((i) => !fora.has(i.variacaoId))
    .filter((i) => (t ? solto(i.nome).includes(t) || solto(i.codigo ?? '').includes(t) : i.usoInterno))
    .sort((a, b) => Number(b.usoInterno) - Number(a.usoInterno))
    .slice(0, 30)

  return (
    <div className="relative flex min-w-0 flex-col">
      <Campo
        rotulo="Insumo"
        id={id}
        name={id}
        value={termo}
        autoComplete="off"
        placeholder="Leite, açúcar, palito…"
        onFocus={() => setAberta(true)}
        // Um respiro antes de fechar: o clique na opção chega depois do blur.
        onBlur={() => setTimeout(() => setAberta(false), 150)}
        onChange={(ev) => {
          setTermo(ev.currentTarget.value)
          setAberta(true)
        }}
      />
      {aberta && (
        <ul
          role="listbox"
          aria-label="Insumos"
          className="realce absolute top-full right-0 left-0 z-20 mt-1 flex max-h-72 flex-col overflow-y-auto rounded-norte border border-borda bg-superficie py-1"
        >
          {achados.length === 0 ? (
            <li className="px-3 py-2 text-xs text-tinta-3">{t ? 'Nada com esse nome.' : 'Digite para buscar entre todos os produtos.'}</li>
          ) : (
            achados.map((i) => (
              <li key={i.variacaoId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    aoEscolher(i)
                    setTermo('')
                    setAberta(false)
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-superficie-2"
                >
                  <span className="min-w-0 truncate text-sm text-tinta">{i.nome}</span>
                  <span className={cx('shrink-0 text-xs', i.usoInterno ? 'text-marca' : 'text-tinta-3')}>
                    {i.usoInterno ? 'material de uso' : 'produto'} · {sigla(i.medida)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
