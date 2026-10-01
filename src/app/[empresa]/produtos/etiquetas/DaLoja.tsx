'use client'

// A etiqueta da loja, para um produto ou um lote (o desenho está em
// servidor/etiqueta-layout.ts).
//
// A quantidade sai de um dos dois jeitos:
//  · PELO ESTOQUE — uma por peça de verdade (cada tamanho × cor), que é
//    como a peça fica na arara. A cor conta, mas não vai impressa;
//  · EU ESCOLHO QUANTAS — quantas de CADA produto. Começa em 1: na térmica,
//    uma por vez e a quantidade no "Cópias" do diálogo é o que sai certo.
//
// Imprime por um iframe escondido, com a página no tamanho do papel: sem a
// moldura do sistema e sem o endereço no rodapé. A prévia é o MESMO HTML.

import { useMemo, useState } from 'react'
import {
  MAXIMO_DE_ETIQUETAS, TAMANHOS, ajustarRolo, etiquetasDoProduto, etiquetasHTML, giroFinal, larguraPagina,
  pecasEmEstoque, testeCalibracaoHTML, type ChaveTamanho, type Giro, type ProdutoEtiquetavel,
} from '@/servidor/etiqueta-layout'
import { plural } from '@/ui/texto'

export type ProdutoDaLoja = ProdutoEtiquetavel & { id: string; semPreco: boolean }

/** Os rolos, na ordem em que aparecem. O 60×40 é o do dia a dia. */
const ROLOS: { chave: ChaveTamanho; rotulo: string }[] = [
  { chave: '60x40', rotulo: '60×40' },
  { chave: '33x22-1col', rotulo: '33×22 · uma por página' },
  { chave: '33x22-3col', rotulo: '33×22 · fileira de 3' },
  { chave: '50x30', rotulo: '50×30' },
]

const ficha = (ativa: boolean) =>
  'rounded-full border px-3 py-1.5 text-xs font-semibold ' +
  (ativa ? 'border-marca/40 bg-marca-suave text-marca' : 'border-borda text-tinta-2 hover:bg-superficie-2 hover:text-tinta')

/**
 * Manda uma página para a impressora por um iframe escondido.
 *
 * Iframe, e não janela nova: `window.open('')` deixa a página como
 * about:blank, e o navegador imprimia isso no rodapé da etiqueta. Com srcdoc
 * o endereço some (o "Cabeçalhos e rodapés" do diálogo ainda precisa estar
 * desmarcado).
 */
function imprimirHTML(html: string): boolean {
  try {
    document.getElementById('etiqueta-impressao')?.remove()
    const frame = document.createElement('iframe')
    frame.id = 'etiqueta-impressao'
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    frame.srcdoc = html
    frame.onload = () => {
      const janela = frame.contentWindow
      if (!janela) return
      janela.focus()
      janela.print()
      // o diálogo já leu o conteúdo; o iframe sai depois
      setTimeout(() => frame.remove(), 60_000)
    }
    document.body.appendChild(frame)
    return true
  } catch {
    return false
  }
}

/**
 * O bilhete da CSP que vale NESTE documento.
 *
 * O iframe de srcdoc herda a política da página que o criou — e em produção
 * ela só aceita <style> com o bilhete sorteado quando a página CARREGOU. O
 * que o servidor manda nas props é o da última requisição: depois de uma
 * troca pelo roteador (trocar de loja, chegar por um <Link>) ele já é outro,
 * e a etiqueta sairia sem estilo nenhum. Os scripts da página guardam o
 * bilhete certo (a propriedade `nonce` continua legível, mesmo escondida do
 * atributo).
 */
function bilheteDoDocumento(doServidor?: string): string | undefined {
  if (typeof document === 'undefined') return doServidor
  return document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce || doServidor
}

export function EtiquetasDaLoja({
  produtos,
  parcelasCartao,
  nonce,
}: {
  produtos: ProdutoDaLoja[]
  /** "Cartão até Nx": o teto do crédito da empresa (Configurações › Balcão). */
  parcelasCartao: number
  /** O bilhete da CSP desta requisição — para o servidor desenhar a prévia (ver `bilheteDoDocumento`). */
  nonce?: string
}) {
  const [chave, setChave] = useState<ChaveTamanho>('60x40')
  const [modo, setModo] = useState<'estoque' | 'manual'>('manual')
  // CORREÇÃO de giro, não o giro absoluto: cada rolo já tem o que ele pede
  // (`giroBase`). "Normal" = rolo do jeito certo; os outros, se sair torto.
  const [ajuste, setAjuste] = useState<Giro>(0)
  const [parcelas, setParcelas] = useState(Math.max(1, parcelasCartao))
  const [barras, setBarras] = useState(false)
  // 1 por produto: é o que imprime certo na térmica.
  const [qtd, setQtd] = useState<Record<string, number>>({})
  const mudarQtd = (id: string, v: number) =>
    setQtd((antes) => ({ ...antes, [id]: Math.max(0, Math.min(999, Math.round(v) || 0)) }))
  // O rolo varia de fábrica para fábrica: dá para acertar sem mexer em nada.
  const [gap, setGap] = useState<number | null>(null)
  const [larguraRolo, setLarguraRolo] = useState<number | null>(null)
  const [falhou, setFalhou] = useState(false)

  const bilhete = bilheteDoDocumento(nonce)
  const base = TAMANHOS[chave]
  const t = ajustarRolo(base, { gapMM: gap, larguraRoloMM: larguraRolo })
  const giro = giroFinal(t, ajuste)

  // As etiquetas de cada produto, na ordem da lista — o desenho quebra em fileiras.
  const porProduto = useMemo(
    () =>
      produtos.map((p) =>
        etiquetasDoProduto(p, { parcelasCartao: parcelas, quantidade: modo === 'manual' ? (qtd[p.id] ?? 1) : undefined }),
      ),
    [produtos, modo, qtd, parcelas],
  )
  const todas = useMemo(() => porProduto.flat(), [porProduto])
  const etiquetas = todas.slice(0, MAXIMO_DE_ETIQUETAS)
  const fileiras = Math.ceil(etiquetas.length / t.colunas)
  // O código que cada produto imprime, e quem imprimiria "S/ CÓDIGO" — pelo
  // estoque inteiro, para não depender da quantidade escolhida.
  const pelaPeca = useMemo(() => produtos.map((p) => etiquetasDoProduto(p)), [produtos])
  // Tudo em zero ainda mostra como a etiqueta fica.
  const reserva = pelaPeca.find((l) => l.length)?.[0]
  const amostra = etiquetas[0] ?? (reserva && { ...reserva, parcelasCartao: parcelas })
  const semCodigo = pelaPeca.filter((l) => l.some((e) => !e.codigo)).length
  const semPreco = produtos.filter((p) => p.semPreco).length
  const opcoesParcelas = Array.from({ length: Math.min(12, Math.max(6, parcelasCartao)) }, (_, i) => i + 1)

  const previa = etiquetasHTML(amostra ? [amostra] : [], { ...t, colunas: 1, gapMM: 0, margemMM: 0 }, 0, {
    nonce: bilhete,
    codigoDeBarras: barras,
  })

  function imprimir(html: string) {
    setFalhou(!imprimirHTML(html))
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── a prévia e o rolo ── */}
      <div className="flex flex-col gap-4">
        {semCodigo > 0 && (
          <p className="rounded-norte border border-critico-borda bg-critico-fundo p-3 text-sm text-critico">
            {produtos.length === 1
              ? 'Este produto está sem código: a etiqueta sai com “S/ CÓDIGO”. Cadastre o código na ficha do produto antes de imprimir.'
              : `${plural(semCodigo, 'produto está', 'produtos estão')} sem código: nesses a etiqueta sai com “S/ CÓDIGO”. Cadastre o código antes de imprimir.`}
          </p>
        )}
        {semPreco > 0 && (
          <p className="rounded-norte border border-atencao-borda bg-atencao-fundo p-3 text-sm text-tinta">
            {plural(semPreco, 'produto não tem', 'produtos não têm')} preço à vista: a etiqueta sairia com R$ 0,00.
          </p>
        )}

        <div>
          <p className="mb-1.5 text-xs font-semibold text-tinta-3">
            {etiquetas.length > 1 ? 'Prévia (a primeira da fila), no tamanho real' : 'Prévia no tamanho real'}
          </p>
          {/* O cinza e o branco daqui NÃO seguem o tema, de propósito: a
              etiqueta sai sempre preto no papel branco, e o cinza fixo é a
              "mesa" que mostra onde ela começa e acaba nos dois temas. */}
          <div className="flex justify-center overflow-x-auto rounded-norte p-4" style={{ background: '#8a8a8a' }}>
            {/* Sem rolagem: 60 mm são 226,77 px, a página arredonda para 227 e a
                barra de rolagem que aparecia por meio pixel comia o preço. */}
            <iframe
              title="Prévia da etiqueta"
              srcDoc={previa}
              scrolling="no"
              style={{
                width: `${t.larguraMM}mm`,
                height: `${t.alturaMM}mm`,
                border: 0,
                borderRadius: '1mm',
                background: '#fff',
                display: 'block',
                flex: 'none',
              }}
            />
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-tinta-3">Rolo</p>
          <div className="flex flex-wrap gap-1.5">
            {ROLOS.map((r) => (
              <button
                key={r.chave}
                type="button"
                aria-pressed={chave === r.chave}
                onClick={() => {
                  setChave(r.chave)
                  setGap(null)
                  setLarguraRolo(null)
                  setAjuste(0)
                }}
                className={ficha(chave === r.chave)}
              >
                {r.rotulo}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-tinta-2">
            Papel: <b className="text-tinta">{larguraPagina(t).toLocaleString('pt-BR')} × {t.alturaMM} mm</b>
            {t.colunas > 1 ? (
              <>
                {' '}— a fileira inteira do rolo. <b>Só use se existir um papel de {larguraPagina(t).toLocaleString('pt-BR')}×{t.alturaMM} mm no driver da impressora.</b>
              </>
            ) : (
              ' — uma etiqueta por página.'
            )}
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-tinta-3">Saiu deitado?</p>
          <div className="flex flex-wrap gap-1.5">
            {([0, 90, 270] as Giro[]).map((g) => (
              <button key={g} type="button" aria-pressed={ajuste === g} onClick={() => setAjuste(g)} className={ficha(ajuste === g)}>
                {g === 0 ? 'Normal' : g === 90 ? 'Girar 90°' : 'Girar 270°'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-tinta-2">
            <b>Normal</b> já sai do jeito certo para este rolo — é o de sempre. Só mexa se a impressora teimar: saiu
            deitado, gire 90°; de cabeça para baixo, 270°.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-tinta-3">Parcelas no cartão</p>
          <div className="flex flex-wrap gap-1.5">
            {opcoesParcelas.map((n) => (
              <button key={n} type="button" aria-pressed={parcelas === n} onClick={() => setParcelas(n)} className={ficha(parcelas === n)}>
                {n}x
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-tinta">
          <input type="checkbox" checked={barras} onChange={(e) => setBarras(e.target.checked)} className="mt-0.5" />
          <span>
            Com código de barras
            <span className="block text-xs text-tinta-3">
              Só para quem tem leitor no balcão. Sem ele a etiqueta fica como a loja conhece: o código grande, digitado.
            </span>
          </span>
        </label>

        {t.colunas > 1 && (
          <details className="rounded-norte border border-borda bg-superficie p-3">
            <summary className="cursor-pointer text-sm font-semibold text-marca">Ajuste fino (se sair torto)</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-tinta-2">
                Largura do rolo (mm)
                <input
                  type="number"
                  step="0.5"
                  inputMode="decimal"
                  value={larguraRolo ?? larguraPagina(t)}
                  onChange={(e) => setLarguraRolo(e.target.value === '' ? null : Number(e.target.value))}
                  className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
                />
                <span className="text-tinta-3">o papel inteiro, com régua</span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-tinta-2">
                Vão entre etiquetas (mm)
                <input
                  type="number"
                  step="0.5"
                  inputMode="decimal"
                  value={gap ?? t.gapMM}
                  onChange={(e) => setGap(e.target.value === '' ? null : Number(e.target.value))}
                  className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
                />
                <span className="text-tinta-3">o branco entre elas</span>
              </label>
            </div>
            <p className="mt-2 text-xs text-tinta-2">
              Sobra em cada lado: <b>{t.margemMM.toLocaleString('pt-BR')} mm</b>. Saiu deslocado <b>para a direita</b>? Aumente
              o vão. <b>Para a esquerda</b>? Diminua. Se a 3ª etiqueta sai bem pior que a 1ª, é o <b>vão</b> que está errado.
            </p>
          </details>
        )}
      </div>

      {/* ── quantas, e imprimir ── */}
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-tinta-3">Quantas etiquetas</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={modo === 'estoque'} onClick={() => setModo('estoque')} className={ficha(modo === 'estoque')}>
              Pelo estoque (uma por peça)
            </button>
            <button type="button" aria-pressed={modo === 'manual'} onClick={() => setModo('manual')} className={ficha(modo === 'manual')}>
              Eu escolho quantas
            </button>
          </div>

          <ul className="flex max-h-[28rem] flex-col divide-y divide-borda-suave overflow-y-auto rounded-norte border border-borda bg-superficie">
            {produtos.map((p, i) => {
              const codigos = new Set((pelaPeca[i] ?? []).map((e) => e.codigo))
              const codigo = codigos.size > 1 ? null : (pelaPeca[i]?.[0]?.codigo ?? null)
              const pecas = pecasEmEstoque(p)
              return (
                <li key={p.id} className="flex items-center gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-tinta">{p.nome}</p>
                    <p className="text-xs text-tinta-3">
                      {codigo ? <span className="font-mono">{codigo}</span> : codigos.size > 1 ? 'um código por item' : 'sem código'} ·{' '}
                      {plural(pecas, 'peça', 'peças')} em estoque
                    </p>
                  </div>
                  {modo === 'manual' ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => mudarQtd(p.id, (qtd[p.id] ?? 1) - 1)}
                        aria-label={`Uma etiqueta a menos de ${p.nome}`}
                        className="size-8 rounded-full border border-borda text-sm font-bold text-tinta hover:bg-superficie-2"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        inputMode="numeric"
                        value={qtd[p.id] ?? 1}
                        onChange={(e) => mudarQtd(p.id, Number(e.target.value))}
                        aria-label={`Quantas etiquetas de ${p.nome}`}
                        className="numero w-14 rounded-norte border border-borda bg-superficie px-1 py-1.5 text-center text-sm font-bold text-tinta"
                      />
                      <button
                        type="button"
                        onClick={() => mudarQtd(p.id, (qtd[p.id] ?? 1) + 1)}
                        aria-label={`Uma etiqueta a mais de ${p.nome}`}
                        className="botao-marca size-8 rounded-full text-sm font-bold text-marca-tinta"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <span className="numero shrink-0 text-sm font-bold text-marca">{porProduto[i]?.length ?? 0}</span>
                  )}
                </li>
              )
            })}
          </ul>

          {modo === 'manual' && produtos.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-tinta-3">Mesma quantidade para todos:</span>
              {[1, 2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQtd(Object.fromEntries(produtos.map((p) => [p.id, n])))}
                  className={ficha(false)}
                >
                  {n}
                </button>
              ))}
            </div>
          )}

          {todas.length > MAXIMO_DE_ETIQUETAS && (
            <p className="mt-2 rounded-norte border border-atencao-borda bg-atencao-fundo p-2.5 text-xs text-tinta">
              Deu {todas.length.toLocaleString('pt-BR')} etiquetas; saem as primeiras {MAXIMO_DE_ETIQUETAS.toLocaleString('pt-BR')} por
              vez. Imprima o resto escolhendo menos produtos.
            </p>
          )}
          {/* Mandar o lote inteiro de uma vez às vezes sai torto na térmica. O
              caminho que sai certo é UMA etiqueta e a quantidade no "Cópias". */}
          {etiquetas.length > 1 && (
            <p className="mt-2 rounded-norte border border-atencao-borda bg-atencao-fundo p-2.5 text-xs text-tinta">
              Vai gerar <b>{plural(etiquetas.length, 'etiqueta', 'etiquetas')}</b> de uma vez. Na impressora térmica isso
              às vezes sai torto; se acontecer, deixe <b>1</b> aqui e peça a quantidade no campo <b>Cópias</b> do
              diálogo de impressão.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-tinta-2">
            <b className="numero text-tinta">{plural(etiquetas.length, 'etiqueta', 'etiquetas')}</b>
            {t.colunas > 1 && etiquetas.length > 0 && <> · {plural(fileiras, 'fileira', 'fileiras')} do rolo</>}
          </span>
          <button
            type="button"
            onClick={() => imprimir(etiquetasHTML(etiquetas, t, giro, { nonce: bilhete, codigoDeBarras: barras }))}
            disabled={etiquetas.length === 0}
            className="botao-marca ml-auto rounded-norte px-5 py-2.5 text-sm font-semibold text-marca-tinta disabled:opacity-40"
          >
            Imprimir
          </button>
        </div>
        {falhou && (
          <p role="alert" className="text-sm text-critico">
            O navegador não abriu a impressão. Recarregue a página e tente de novo.
          </p>
        )}

        {/* CONFERIR SEM GASTAR ETIQUETA: a prévia do diálogo já denuncia o erro. */}
        <div className="flex flex-col gap-2 rounded-norte border border-borda bg-superficie-2 p-3 text-xs text-tinta-2">
          <p className="font-semibold text-tinta">Antes de imprimir, olhe a prévia do diálogo de impressão</p>
          <p>
            A etiqueta tem que <b>preencher a página inteira</b>, sem sobra branca. Sobrou branco <b>embaixo</b>? É a altura
            do papel no driver (tem que ser {t.alturaMM} mm). <b>Dos lados</b>? É a largura ({larguraPagina(t).toLocaleString('pt-BR')} mm).
            Nos dois casos, não imprima — conferir na prévia não gasta etiqueta.
          </p>
          <p>
            <b className="text-tinta">No diálogo:</b> a impressora de etiquetas · papel{' '}
            <b>
              {larguraPagina(t).toLocaleString('pt-BR')}×{t.alturaMM} mm
            </b>{' '}
            · margens <b>Nenhuma</b> · escala <b>100%</b> (nunca &ldquo;Ajustar&rdquo;) · <b>Cabeçalhos e rodapés desmarcado</b>.
          </p>
          <button
            type="button"
            onClick={() => imprimir(testeCalibracaoHTML(t, giro, { nonce: bilhete }))}
            className="rounded-norte border border-borda bg-superficie px-3 py-2 text-xs font-semibold text-tinta hover:bg-superficie-3"
          >
            Imprimir o teste (quadros + barra de 100 mm)
          </button>
        </div>
      </div>
    </div>
  )
}
