'use client'

// A etiqueta do lote, no rolo 60×40 da térmica: o produto, o lote, o dia em
// que foi feito, a validade e como conservar. Sem preço — ela vai na caixa
// que sai da fábrica, e o preço é de cada loja.
//
// Mesmo caminho de impressão das etiquetas de produto (produtos/etiquetas/
// DaLoja.tsx): uma página por etiqueta, no tamanho do papel, impressa por um
// iframe escondido; a prévia é o MESMO HTML. O 60×40 entra deitado na
// térmica, e por isso o "Normal" já sai girado (`giroBase` do rolo).

import { useState } from 'react'
import { TAMANHOS, giroFinal, trocaOrientacao, type Giro } from '@/servidor/etiqueta-layout'
import { bilheteDoDocumento, imprimirHTML } from '@/app/[empresa]/produtos/etiquetas/DaLoja'
import { plural } from '@/ui/texto'

export type DadosDaEtiqueta = {
  produto: string
  lote: string
  /** DD/MM/AAAA, ou null. */
  fabricacao: string | null
  validade: string | null
  empresa: string
}

const MAXIMO = 500

const ficha = (ativa: boolean) =>
  'rounded-full border px-3 py-1.5 text-xs font-semibold ' +
  (ativa ? 'border-marca/40 bg-marca-suave text-marca' : 'border-borda text-tinta-2 hover:bg-superficie-2 hover:text-tinta')

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/** A página de impressão: N etiquetas iguais, uma por página. */
function etiquetasDoLoteHTML(d: DadosDaEtiqueta & { conservacao: string }, n: number, giro: Giro, nonce?: string): string {
  const t = TAMANHOS['60x40']
  const vira = trocaOrientacao(giro)
  const paginaW = vira ? t.alturaMM : t.larguraMM
  const paginaH = vira ? t.larguraMM : t.alturaMM
  const girar = giro !== 0 ? `position:absolute; left:50%; top:50%; transform: translate(-50%,-50%) rotate(${giro}deg);` : ''
  // O nome encolhe se for comprido: "Pote de sorvete de doce de leite com
  // castanha 2 L" ainda cabe em duas linhas.
  const fsNome = Math.max(3.2, 4.6 * Math.min(1, 28 / Math.max(28, d.produto.length)))
  const uma = `<div class="et">
    <div class="nome" style="font-size:${fsNome.toFixed(2)}mm">${esc(d.produto)}</div>
    <div class="lote">LOTE <b>${esc(d.lote)}</b></div>
    <div class="datas">
      <div><span>FABRICAÇÃO</span><b>${esc(d.fabricacao ?? '—')}</b></div>
      <div><span>VALIDADE</span><b>${esc(d.validade ?? '—')}</b></div>
    </div>
    ${d.conservacao.trim() ? `<div class="cons">${esc(d.conservacao.trim())}</div>` : ''}
    <div class="emp">${esc(d.empresa)}</div>
  </div>`
  const corpo = Array.from({ length: n }, () => `<div class="pg"><div class="row">${uma}</div></div>`).join('\n')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas do lote</title>
${nonce ? `<style nonce="${esc(nonce)}">` : '<style>'}
  @page { size: ${paginaW}mm ${paginaH}mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html,body { margin:0; padding:0; background:#fff; }
  body { font-family: Arial, Helvetica, sans-serif; color:#000; }
  .pg { position:relative; width:${paginaW}mm; height:${paginaH}mm; overflow:hidden; page-break-after: always; break-after: page; }
  .pg:last-child { page-break-after:auto; break-after:auto; }
  .row { width:${t.larguraMM}mm; height:${t.alturaMM}mm; overflow:hidden; ${girar} }
  /* folga em cima e embaixo: a térmica desvia ~1 mm na vertical */
  .et { width:${t.larguraMM}mm; height:${t.alturaMM}mm; padding:2.6mm 2.6mm; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; line-height:1.1; }
  .nome { font-weight:bold; line-height:1.08; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; padding-top:0.14em; }
  .lote { font-size:3mm; letter-spacing:0.1mm; }
  .lote b { font-family: ui-monospace, Consolas, monospace; font-size:3.6mm; }
  .datas { display:flex; gap:3mm; border-top:0.3mm solid #000; padding-top:1.2mm; }
  .datas div { display:flex; flex-direction:column; gap:0.4mm; }
  .datas span { font-size:2.1mm; letter-spacing:0.1mm; }
  .datas b { font-size:3.6mm; }
  .cons { font-size:2.5mm; font-weight:bold; }
  .emp { font-size:2.2mm; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
</style></head><body>
${corpo}
</body></html>`
}

export function EtiquetaDoLote({ dados, quantas, nonce }: { dados: DadosDaEtiqueta; quantas: number; nonce?: string }) {
  const [n, setN] = useState(Math.max(1, Math.min(MAXIMO, quantas)))
  const [ajuste, setAjuste] = useState<Giro>(0)
  const [conservacao, setConservacao] = useState('Conservar a -18 °C ou menos')
  const [falhou, setFalhou] = useState(false)
  const bilhete = bilheteDoDocumento(nonce)
  const t = TAMANHOS['60x40']
  const giro = giroFinal(t, ajuste)
  const d = { ...dados, conservacao }

  // A prévia é a etiqueta de pé, sem o giro da impressora.
  const previa = etiquetasDoLoteHTML(d, 1, 0, bilhete)
  const mudarN = (v: number) => setN(Math.max(1, Math.min(MAXIMO, Math.round(v) || 1)))

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-tinta-3">Prévia no tamanho real (60×40 mm)</p>
          {/* O cinza e o branco NÃO seguem o tema: a etiqueta sai sempre preto
              no branco, e o cinza fixo é a "mesa" que mostra a borda dela. */}
          <div className="flex justify-center overflow-x-auto rounded-norte p-4" style={{ background: '#8a8a8a' }}>
            <iframe
              title="Prévia da etiqueta do lote"
              srcDoc={previa}
              scrolling="no"
              style={{ width: `${t.larguraMM}mm`, height: `${t.alturaMM}mm`, border: 0, borderRadius: '1mm', background: '#fff', display: 'block', flex: 'none' }}
            />
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-tinta">
          Como conservar
          <input
            value={conservacao}
            maxLength={60}
            onChange={(e) => setConservacao(e.target.value)}
            className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
          />
          <span className="text-xs font-normal text-tinta-3">Em branco, a linha sai da etiqueta.</span>
        </label>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-tinta-3">Quantas etiquetas</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => mudarN(n - 1)}
              aria-label="Uma etiqueta a menos"
              className="size-8 rounded-full border border-borda text-sm font-bold text-tinta hover:bg-superficie-2"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={MAXIMO}
              inputMode="numeric"
              value={n}
              onChange={(e) => mudarN(Number(e.target.value))}
              aria-label="Quantas etiquetas"
              className="numero w-20 rounded-norte border border-borda bg-superficie px-1 py-1.5 text-center text-sm font-bold text-tinta"
            />
            <button
              type="button"
              onClick={() => mudarN(n + 1)}
              aria-label="Uma etiqueta a mais"
              className="botao-marca size-8 rounded-full text-sm font-bold text-marca-tinta"
            >
              +
            </button>
          </div>
          {n > 1 && (
            <p className="mt-2 rounded-norte border border-atencao-borda bg-atencao-fundo p-2.5 text-xs text-tinta">
              Na impressora térmica, mandar muitas de uma vez às vezes sai torto; se acontecer, deixe <b>1</b> aqui e peça a
              quantidade no campo <b>Cópias</b> do diálogo de impressão.
            </p>
          )}
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
            <b>Normal</b> é o de sempre do rolo 60×40. Só mexa se a impressora teimar.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-tinta-2">
            <b className="numero text-tinta">{plural(n, 'etiqueta', 'etiquetas')}</b>
          </span>
          <button
            type="button"
            onClick={() => setFalhou(!imprimirHTML(etiquetasDoLoteHTML(d, n, giro, bilhete)))}
            className="botao-marca ml-auto rounded-norte px-5 py-2.5 text-sm font-semibold text-marca-tinta"
          >
            Imprimir
          </button>
        </div>
        {falhou && (
          <p role="alert" className="text-sm text-critico">
            O navegador não abriu a impressão. Recarregue a página e tente de novo.
          </p>
        )}
        <p className="rounded-norte border border-borda bg-superficie-2 p-3 text-xs text-tinta-2">
          <b className="text-tinta">No diálogo:</b> a impressora de etiquetas · papel <b>60×40 mm</b> · margens <b>Nenhuma</b> ·
          escala <b>100%</b> · <b>Cabeçalhos e rodapés desmarcado</b>.
        </p>
      </div>
    </div>
  )
}
