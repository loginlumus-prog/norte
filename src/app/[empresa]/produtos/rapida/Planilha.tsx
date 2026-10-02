'use client'

// A planilha: cada célula é um campo, o que mudou fica marcado, e "Salvar"
// grava tudo de uma vez — produto por produto, pelas mesmas regras da ficha.
//
// ── o estoque pede motivo e, se a empresa mandar, assinatura ─
// Mudar o número do estoque é a mesma correção da tela de Estoque: precisa de
// um motivo (fica no livro) e, com "assinar as exceções" ligado em
// Configurações, do PIN de quem está mexendo. O motivo e o PIN ficam UMA vez
// na barra de baixo e valem para o lote inteiro.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, cx } from '@/ui/base'
import { CampoDoPin, MotivosProntos } from '@/ui/Assinar'
import { criarLinha, salvarEstoque, salvarLinha, type LinhaEditada } from './acoes'

export type LinhaDaPlanilha = {
  id: string
  codigo: string
  nome: string
  categoriaId: string | null
  precoVista: number
  precoCartao: number | null
  precoCrediario: number | null
  /** Nulo também quando quem vê não pode ver custo. */
  custo: number | null
  servico: boolean
  /** Quantas opções (cor, tamanho, sabor). Mais de uma: o estoque é por opção, na tela de Estoque. */
  opcoes: number
  variacaoId: string | null
  /** O saldo nesta loja. Nulo = nunca teve estoque lançado aqui. */
  estoque: number | null
}

type Rascunho = { nome: string; categoriaId: string; precoVista: string; precoCartao: string; precoCrediario: string; custo: string; estoque: string }

const paraCampo = (n: number | null) => (n === null ? '' : String(Number(n.toFixed(3))).replace('.', ','))
/** Dinheiro sempre com centavos: "1,00", não "1". */
const dinheiroNoCampo = (n: number | null) => (n === null ? '' : n.toFixed(2).replace('.', ','))
const doCampo = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const inicial = (l: LinhaDaPlanilha): Rascunho => ({
  nome: l.nome,
  categoriaId: l.categoriaId ?? '',
  precoVista: dinheiroNoCampo(l.precoVista),
  precoCartao: dinheiroNoCampo(l.precoCartao),
  precoCrediario: dinheiroNoCampo(l.precoCrediario),
  custo: custoNoCampo(l.custo),
  estoque: paraCampo(l.estoque),
})
/** O custo com até quatro casas quando ele tem (o mililitro a 0,0028): com duas, aparecia 0,00. */
function custoNoCampo(n: number | null) {
  if (n === null) return ''
  const quatro = Math.round(n * 10_000) / 10_000
  return Math.round(quatro * 100) / 100 === quatro ? dinheiroNoCampo(quatro) : String(quatro).replace('.', ',')
}
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const campo =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-tinta outline-none transition hover:border-borda focus:border-marca focus:bg-superficie disabled:text-tinta-3 disabled:hover:border-transparent'

export function Planilha({
  slug,
  linhas,
  categorias,
  loja,
  podePreco,
  podeEditar,
  podeCadastrar,
  podeEstoque,
  tresPrecos,
  pedePin,
}: {
  slug: string
  linhas: LinhaDaPlanilha[]
  categorias: { id: string; nome: string }[]
  loja: { id: string; nome: string } | null
  podePreco: boolean
  podeEditar: boolean
  podeCadastrar: boolean
  podeEstoque: boolean
  tresPrecos: boolean
  pedePin: boolean
}) {
  const router = useRouter()
  const [indo, comecar] = useTransition()
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({})
  const [erros, setErros] = useState<Record<string, string>>({})
  const [recado, setRecado] = useState<{ nivel: 'bom' | 'critico' | 'atencao'; texto: string } | null>(null)
  const [busca, setBusca] = useState('')
  const [gaveta, setGaveta] = useState('')
  const [motivo, setMotivo] = useState('')
  const [pin, setPin] = useState('')
  const [mostrarPin, setMostrarPin] = useState(pedePin)
  const vazio = { nome: '', categoriaId: gaveta, precoVista: '', custo: '', estoque: '' }
  const [novo, setNovo] = useState(vazio)

  const nomeDaGaveta = useMemo(() => new Map(categorias.map((c) => [c.id, c.nome])), [categorias])
  const visiveis = linhas.filter(
    (l) =>
      (!gaveta || l.categoriaId === gaveta) &&
      (!busca.trim() || semAcento(`${l.nome} ${l.codigo}`).includes(semAcento(busca.trim()))),
  )

  const valor = (l: LinhaDaPlanilha) => rascunhos[l.id] ?? inicial(l)
  const mudar = (l: LinhaDaPlanilha, parte: Partial<Rascunho>) =>
    setRascunhos((r) => ({ ...r, [l.id]: { ...(r[l.id] ?? inicial(l)), ...parte } }))

  // O que mudou em cada linha, comparado ao que veio do servidor.
  const mudancas = linhas.flatMap((l) => {
    const r = rascunhos[l.id]
    if (!r) return []
    const o = inicial(l)
    const dados: LinhaEditada = {}
    if (r.nome.trim() !== o.nome.trim()) dados.nome = r.nome
    if (r.categoriaId !== o.categoriaId) dados.categoriaId = r.categoriaId || null
    if (r.precoVista !== o.precoVista) dados.precoVista = r.precoVista
    if (r.precoCartao !== o.precoCartao) dados.precoCartao = r.precoCartao || null
    if (r.precoCrediario !== o.precoCrediario) dados.precoCrediario = r.precoCrediario || null
    if (r.custo !== o.custo) dados.custo = r.custo || null
    const estoque = r.estoque !== o.estoque && r.estoque.trim() !== '' ? r.estoque : null
    if (Object.keys(dados).length === 0 && estoque === null) return []
    return [{ l, dados, estoque }]
  })
  const mexeEstoque = mudancas.some((m) => m.estoque !== null)

  const salvarTudo = () =>
    comecar(async () => {
      setRecado(null)
      if (mexeEstoque && motivo.trim().length < 3) {
        setRecado({ nivel: 'atencao', texto: 'Mudou estoque: escolha ou escreva o motivo, lá embaixo, antes de salvar.' })
        return
      }
      const novosErros: Record<string, string> = {}
      let salvas = 0
      let pediuPin = false
      for (const m of mudancas) {
        if (Object.keys(m.dados).length > 0) {
          const r = await salvarLinha(slug, m.l.id, m.dados)
          if (r.erro) {
            novosErros[m.l.id] = r.erro
            continue
          }
        }
        if (m.estoque !== null && m.l.variacaoId && loja) {
          const r = await salvarEstoque(slug, {
            variacaoId: m.l.variacaoId,
            unidadeId: loja.id,
            contado: m.estoque,
            motivo,
            visto: m.l.estoque ?? 0,
            pin: pin || null,
          })
          if (r.erro) {
            novosErros[m.l.id] = r.erro
            if (r.precisaPin) {
              pediuPin = true
              break
            }
            continue
          }
        }
        salvas++
        setRascunhos((x) => {
          const { [m.l.id]: _, ...resto } = x
          return resto
        })
      }
      setErros(novosErros)
      if (pediuPin) {
        setMostrarPin(true)
        setRecado({ nivel: 'atencao', texto: 'A empresa pede assinatura para mexer no estoque: digite o seu PIN lá embaixo e salve de novo.' })
      } else if (Object.keys(novosErros).length > 0) {
        setRecado({ nivel: 'critico', texto: `${salvas} ${salvas === 1 ? 'linha salva' : 'linhas salvas'}; ${Object.keys(novosErros).length} com problema — veja em vermelho na linha.` })
      } else {
        setRecado({ nivel: 'bom', texto: salvas === 1 ? '1 produto salvo.' : `${salvas} produtos salvos.` })
      }
      router.refresh()
    })

  const adicionar = () =>
    comecar(async () => {
      setRecado(null)
      const r = await criarLinha(slug, {
        nome: novo.nome,
        categoriaId: novo.categoriaId || null,
        precoVista: novo.precoVista,
        custo: novo.custo || null,
        estoque: novo.estoque || null,
        unidadeId: loja?.id ?? null,
        motivo: motivo.trim() || 'Estoque inicial',
        pin: pin || null,
      })
      if (r.precisaPin) setMostrarPin(true)
      if (r.erro && !r.produtoId) {
        setRecado({ nivel: 'critico', texto: r.erro })
        return
      }
      setRecado(r.erro ? { nivel: 'atencao', texto: r.erro } : { nivel: 'bom', texto: `"${novo.nome.trim()}" cadastrado.` })
      setNovo({ ...vazio, categoriaId: novo.categoriaId })
      router.refresh()
    })

  const numeroDe = (s: string) => {
    const n = doCampo(s)
    return n !== null && Number.isNaN(n)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-tinta-2">
        Clique em qualquer célula e digite. O que você mudou fica marcado em azul; nada é gravado até
        {' '}<strong>Salvar</strong>. O estoque é o da loja <strong>{loja?.nome ?? '—'}</strong> e é o número que você
        CONTOU (não a diferença). Para cor, tamanho, sabor e foto, use a ficha do produto.
      </p>

      {recado && <Aviso nivel={recado.nivel}>{recado.texto}</Aviso>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.currentTarget.value)}
          placeholder="Procurar por nome ou código"
          aria-label="Procurar produto"
          className="w-64 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Gaveta">
          {[{ id: '', nome: 'Todas' }, ...categorias].map((c) => (
            <button
              key={c.id || 'todas'}
              type="button"
              onClick={() => {
                setGaveta(c.id)
                setNovo((n) => ({ ...n, categoriaId: c.id }))
              }}
              className={cx(
                'rounded-full border px-3 py-1 text-xs font-semibold transition',
                gaveta === c.id ? 'border-marca bg-marca-suave text-tinta' : 'border-borda text-tinta-2 hover:border-marca/50',
              )}
            >
              {c.nome}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-norte border border-borda bg-superficie">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-borda bg-superficie-2 text-left text-[11px] font-bold tracking-wide text-tinta-3 uppercase">
              <th className="w-[4.5rem] px-2 py-2">Código</th>
              <th className="px-3 py-2">Nome</th>
              <th className="w-32 px-2 py-2">Gaveta</th>
              <th className="w-24 px-2 py-2 text-right">{tresPrecos ? 'À vista' : 'Preço'}</th>
              {tresPrecos && <th className="w-24 px-2 py-2 text-right">Cartão</th>}
              {tresPrecos && <th className="w-24 px-2 py-2 text-right">Crediário</th>}
              {podePreco && <th className="w-24 px-2 py-2 text-right">Custo</th>}
              <th className="w-40 px-2 py-2 text-right" title={loja ? `Estoque na loja ${loja.nome}` : undefined}>Estoque</th>
            </tr>
          </thead>
          <tbody>
            {podeCadastrar && (
              <tr className="border-b-2 border-marca/30 bg-marca-suave/40">
                <td className="px-2 py-1.5 text-xs font-semibold text-marca">novo</td>
                <td className="px-1 py-1">
                  <input
                    className={cx(campo, 'border-borda bg-superficie')}
                    placeholder="Nome do produto novo"
                    value={novo.nome}
                    onChange={(e) => setNovo({ ...novo, nome: e.currentTarget.value })}
                    onKeyDown={(e) => e.key === 'Enter' && novo.nome.trim() && novo.precoVista && adicionar()}
                    aria-label="Nome do produto novo"
                  />
                </td>
                <td className="px-1 py-1">
                  <select
                    className={cx(campo, 'border-borda bg-superficie')}
                    value={novo.categoriaId}
                    onChange={(e) => setNovo({ ...novo, categoriaId: e.currentTarget.value })}
                    aria-label="Gaveta do produto novo"
                  >
                    <option value="">sem gaveta</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-1">
                  <input
                    inputMode="decimal"
                    className={cx(campo, 'numero border-borda bg-superficie text-right')}
                    placeholder="0,00"
                    value={novo.precoVista}
                    onChange={(e) => setNovo({ ...novo, precoVista: e.currentTarget.value })}
                    aria-label="Preço do produto novo"
                  />
                </td>
                {tresPrecos && <td />}
                {tresPrecos && <td />}
                {podePreco && (
                  <td className="px-1 py-1">
                    <input
                      inputMode="decimal"
                      className={cx(campo, 'numero border-borda bg-superficie text-right')}
                      placeholder="0,00"
                      value={novo.custo}
                      onChange={(e) => setNovo({ ...novo, custo: e.currentTarget.value })}
                      aria-label="Custo do produto novo"
                    />
                  </td>
                )}
                <td className="px-1 py-1">
                  <span className="flex items-center gap-1.5">
                    <input
                      inputMode="decimal"
                      className={cx(campo, 'numero border-borda bg-superficie text-right')}
                      placeholder="0"
                      value={novo.estoque}
                      disabled={!podeEstoque}
                      onChange={(e) => setNovo({ ...novo, estoque: e.currentTarget.value })}
                      aria-label="Estoque inicial do produto novo"
                    />
                    <Botao
                      tom="confirmar"
                      className="shrink-0 px-2.5 py-1.5 text-xs"
                      carregando={indo}
                      disabled={!novo.nome.trim() || !novo.precoVista.trim()}
                      onClick={adicionar}
                    >
                      Adicionar
                    </Botao>
                  </span>
                </td>
              </tr>
            )}

            {visiveis.map((l) => {
              const v = valor(l)
              const mudou = mudancas.some((m) => m.l.id === l.id)
              const erro = erros[l.id]
              const celula = (mudouAqui: boolean) => cx(campo, mudouAqui && 'border-marca/60 bg-marca-suave/50 font-semibold')
              const o = inicial(l)
              return (
                <tr key={l.id} className={cx('border-b border-borda-suave last:border-0', mudou && 'bg-marca-suave/20', erro && 'bg-critico-fundo/60')}>
                  <td className="px-2 py-1 align-top">
                    <Link href={`/${slug}/produtos/${l.id}`} className="numero font-mono text-xs font-bold text-tinta-2 hover:text-marca" title="Abrir a ficha completa">
                      {l.codigo || 'ficha'}
                    </Link>
                    {erro && <span className="mt-1 block max-w-[14rem] text-[11px] leading-tight font-medium whitespace-normal text-critico">{erro}</span>}
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className={celula(v.nome !== o.nome)}
                      value={v.nome}
                      disabled={!podeEditar}
                      onChange={(e) => mudar(l, { nome: e.currentTarget.value })}
                      aria-label={`Nome de ${l.nome}`}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className={celula(v.categoriaId !== o.categoriaId)}
                      value={v.categoriaId}
                      disabled={!podeEditar}
                      onChange={(e) => mudar(l, { categoriaId: e.currentTarget.value })}
                      aria-label={`Gaveta de ${l.nome}`}
                    >
                      <option value="">sem gaveta</option>
                      {categorias.map((c) => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                      ))}
                    </select>
                  </td>
                  {(['precoVista', ...(tresPrecos ? (['precoCartao', 'precoCrediario'] as const) : []), ...(podePreco ? (['custo'] as const) : [])] as const).map((k) => (
                    <td key={k} className="px-1 py-1">
                      <input
                        inputMode="decimal"
                        className={cx(celula(v[k] !== o[k]), 'numero text-right', numeroDe(v[k]) && 'border-critico text-critico')}
                        value={v[k]}
                        placeholder={k === 'custo' ? '—' : k === 'precoVista' ? '0,00' : 'igual'}
                        disabled={!podePreco}
                        onChange={(e) => mudar(l, { [k]: e.currentTarget.value })}
                        aria-label={`${k === 'custo' ? 'Custo' : 'Preço'} de ${l.nome}`}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1 text-right">
                    {l.servico ? (
                      <span className="px-2 text-xs text-tinta-3">serviço</span>
                    ) : l.opcoes > 1 ? (
                      <Link
                        href={`/${slug}/estoque?q=${encodeURIComponent(l.nome)}${loja ? `&unidade=${loja.id}` : ''}`}
                        className="px-2 text-xs font-semibold text-marca hover:underline"
                        title="Cada opção tem o seu estoque"
                      >
                        {l.opcoes} opções →
                      </Link>
                    ) : (
                      <input
                        inputMode="decimal"
                        className={cx(celula(v.estoque !== o.estoque), 'numero text-right', numeroDe(v.estoque) && 'border-critico text-critico')}
                        value={v.estoque}
                        placeholder={l.estoque === null ? 'não lançado' : '0'}
                        disabled={!podeEstoque || !loja}
                        onChange={(e) => mudar(l, { estoque: e.currentTarget.value })}
                        aria-label={`Estoque de ${l.nome} na loja ${loja?.nome ?? ''}`}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-tinta-3">
                  Nenhum produto {gaveta ? `na gaveta ${nomeDaGaveta.get(gaveta) ?? ''}` : ''} com essa busca.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── a barra de salvar ── */}
      {(mudancas.length > 0 || mostrarPin) && (
        <div className="sticky bottom-0 z-30 rounded-norte border border-borda bg-superficie/95 px-4 py-3 shadow-norte-alta backdrop-blur">
          <div className="flex flex-col gap-2">
            {mexeEstoque && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-tinta-2">Motivo da mudança de estoque:</span>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.currentTarget.value)}
                  placeholder="Ex.: contagem da loja"
                  aria-label="Motivo da mudança de estoque"
                  className="w-56 rounded-norte border border-borda bg-superficie px-2 py-1 text-sm text-tinta placeholder:text-tinta-3"
                />
                {/* Os da implantação e da contagem primeiro; depois os de exceção. */}
                {['Estoque inicial', 'Contagem da loja', 'Produção / chegou da fábrica'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMotivo(m)}
                    className={cx(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition',
                      motivo === m ? 'border-marca bg-marca-suave text-tinta' : 'border-borda text-tinta-2 hover:border-marca/50',
                    )}
                  >
                    {m}
                  </button>
                ))}
                <MotivosProntos excecao="estoque.ajuste" atual={motivo} aoEscolher={setMotivo} />
              </div>
            )}
            {mostrarPin && (
              <div className="flex flex-wrap items-center gap-2">
                <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} aoEnviar={salvarTudo} foco={false} rotulo="Seu PIN (assina a mudança de estoque)" />
              </div>
            )}
            {/* À direita sobra o lugar do botão de Ajuda, que flutua no canto. */}
            <div className="flex flex-wrap items-center justify-between gap-2 pr-24">
              <span className="text-sm font-semibold text-tinta">
                {mudancas.length === 0
                  ? 'Nada mudado ainda.'
                  : `${mudancas.length} ${mudancas.length === 1 ? 'produto mudado' : 'produtos mudados'}`}
              </span>
              <span className="flex gap-2">
                <Botao
                  tom="discreto"
                  disabled={indo || mudancas.length === 0}
                  onClick={() => {
                    setRascunhos({})
                    setErros({})
                  }}
                >
                  Desfazer
                </Botao>
                <Botao tom="confirmar" carregando={indo} disabled={mudancas.length === 0} onClick={salvarTudo}>
                  Salvar {mudancas.length > 0 ? `(${mudancas.length})` : ''}
                </Botao>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
