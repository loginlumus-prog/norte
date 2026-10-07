'use client'

// A tela de trazer produtos, em quatro passos que a pessoa vê de cima:
//
//   1. De onde vêm — o arquivo (CSV, TSV, XLSX) ou o que ela copiou de uma
//      planilha e colou. Lido AQUI, no navegador: o arquivo não sobe.
//   2. As colunas — o que o Norte entendeu de cada uma, em listas que ela
//      corrige ("Esta coluna é: Nome / Preço / … / Ignorar"). Quando os
//      títulos não dizem, a IA olha os títulos e oito linhas e sugere.
//   3. A prévia — quantos produtos, quantas categorias novas, quais linhas
//      ficam de fora e por quê, o que já existe no Norte e o que fazer com
//      isso, e a loja onde o estoque entra.
//   4. Trazendo — em lotes de 200, com a barra andando. Caiu a internet no
//      meio? "Continuar" retoma do lote que parou; mandar tudo de novo
//      também não duplica (ver servidor/importacao.ts).

import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { Aviso, Botao, Cartao, cx } from '@/ui/base'
import { CampoDoPin } from '@/ui/Assinar'
import { plural } from '@/ui/texto'
import { classeDaAcao, IconeDaAcao } from '@/ui/premium'
import {
  CAMPOS,
  MAX_LINHAS,
  MODELO_CSV,
  ROTULO_DO_CAMPO,
  acharCabecalho,
  adivinharCampos,
  amostraParaIA,
  arrumarGrade,
  chaveDoNome,
  decodificar,
  largura,
  lerTexto,
  lotes,
  montarItens,
  pesoDo,
  precisaDeAjuda,
  textoDe,
  vazia,
  type Campo,
  type Celula,
  type Grade,
  type ItemImportado,
} from '@/servidor/importacao-planilha'
import type { LinhaDoLote, SeJaExiste } from '@/servidor/importacao'
import { conferirExistentesAcao, importarLoteAcao, sugerirColunasAcao, terminarImportacaoAcao } from './acoes'

type Loja = { id: string; nome: string; deposito: boolean }
type Etapa = 'escolher' | 'colunas' | 'previa' | 'trazendo' | 'pronto'

/** Arquivo maior que isto não é catálogo de loja, é backup do sistema inteiro. */
const MAX_BYTES = 25 * 1024 * 1024

const brl = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const qtd = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }))
const letra = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`)

/** Planilha HTML com extensão .xls (muito sistema antigo exporta assim): as células das <tr>. */
function lerTabelaHtml(html: string): Grade {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td,th')].map((td) => td.textContent ?? ''))
}

/** O que a pessoa escolheu, em linhas e colunas — ou a frase do porquê não. */
async function lerArquivo(f: File): Promise<Grade | string> {
  if (f.size === 0) return 'O arquivo está vazio.'
  if (f.size > MAX_BYTES) return 'Arquivo grande demais (mais de 25 MB). Exporte só os produtos, ou divida em partes.'
  const bytes = new Uint8Array(await f.arrayBuffer())
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  if (ole) {
    return 'Este é o formato antigo do Excel (.xls). Abra no Excel (ou no Google Planilhas) e salve como .xlsx ou CSV — leva dez segundos — e escolha de novo.'
  }
  if (zip) {
    if (!/\.xlsx$/i.test(f.name) && !/\.xlsm$/i.test(f.name)) return 'Não deu para ler este arquivo. Serve planilha do Excel (.xlsx) ou texto (CSV).'
    try {
      // Só carrega o leitor de Excel quando chega um Excel.
      const { default: lerXlsx } = await import('read-excel-file/browser')
      const folhas = await lerXlsx(f)
      // A aba com mais linhas preenchidas: a primeira às vezes é a capa.
      const melhor = folhas
        .map((s) => ({ s, n: s.data.filter((l) => l.some((c) => !vazia(c as Celula))).length }))
        .sort((a, b) => b.n - a.n)[0]
      return (melhor?.s.data ?? []) as Grade
    } catch {
      return 'Não deu para abrir esta planilha. Ela tem senha? Tente salvar de novo como .xlsx, ou exporte em CSV.'
    }
  }
  const texto = decodificar(bytes)
  if (/^\s*</.test(texto) && /<table/i.test(texto)) return lerTabelaHtml(texto)
  if (/[\u0000-\u0008]/.test(texto.slice(0, 2000))) return 'Não deu para ler este arquivo. Serve planilha do Excel (.xlsx) ou texto (CSV, TSV).'
  return lerTexto(texto)
}

/** Um número com o rótulo, em cor — a linha de contagens da prévia. */
function Conta({ n, rotulo, nivel = 'neutro' }: { n: number; rotulo: string; nivel?: 'bom' | 'atencao' | 'critico' | 'neutro' }) {
  if (n === 0) return null
  const ponto = { bom: 'bg-bom-vivo', atencao: 'bg-atencao-vivo', critico: 'bg-critico-vivo', neutro: 'bg-tinta-3' }[nivel]
  const texto = { bom: 'text-bom', atencao: 'text-atencao', critico: 'text-critico', neutro: 'text-tinta' }[nivel]
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span aria-hidden className={cx('size-2 rounded-full', ponto)} />
      <span className={cx('numero font-bold', texto)}>{n.toLocaleString('pt-BR')}</span>
      <span className="text-tinta-2">{rotulo}</span>
    </span>
  )
}

/** O número do passo, a régua da tela. */
function Passo({ n, titulo, atual, feito, children }: { n: number; titulo: string; atual: boolean; feito: boolean; children?: ReactNode }) {
  return (
    <section className={cx('flex flex-col gap-4', !atual && !feito && 'opacity-50')}>
      <header className="flex items-center gap-3 border-b border-borda pb-2">
        <span
          aria-hidden
          className={cx(
            'numero flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            feito ? 'bg-bom-vivo text-white' : atual ? 'bg-marca text-marca-tinta' : 'bg-superficie-2 text-tinta-3',
          )}
        >
          {feito ? '✓' : n}
        </span>
        <h2 className="text-[15px] font-bold tracking-tight">{titulo}</h2>
      </header>
      {children}
    </section>
  )
}

export function Importar({
  slug,
  lojas,
  categorias,
  jaTemProdutos,
  temIA,
  podePreco,
  empresaInteira,
  pedePin,
}: {
  slug: string
  lojas: Loja[]
  categorias: string[]
  jaTemProdutos: boolean
  temIA: boolean
  podePreco: boolean
  empresaInteira: boolean
  pedePin: boolean
}) {
  const [etapa, setEtapa] = useState<Etapa>('escolher')
  const [erro, setErro] = useState<string | null>(null)
  const [origem, setOrigem] = useState('')
  const [grade, setGrade] = useState<Grade>([])
  const [cabecalho, setCabecalho] = useState<number | null>(null)
  const [campos, setCampos] = useState<Campo[]>([])
  const [ia, setIa] = useState<'nao' | 'pensando' | 'usou' | 'falhou'>('nao')
  const [colado, setColado] = useState('')
  const [arrastando, setArrastando] = useState(false)
  const [lendo, setLendo] = useState(false)
  const arquivoRef = useRef<HTMLInputElement>(null)

  const [existentes, setExistentes] = useState<{ codigos: Set<string>; nomes: Set<string> } | null>(null)
  const [loja, setLoja] = useState(lojas.find((u) => !u.deposito)?.id ?? lojas[0]?.id ?? '')
  const [seJaExiste, setSeJaExiste] = useState<SeJaExiste>('pular')
  // Os produtos novos nascem vendidos SÓ na loja da planilha (o padrão), ou
  // em todas as lojas de quem traz.
  const [emTodas, setEmTodas] = useState(false)
  const [verProblemas, setVerProblemas] = useState(false)

  const [indo, comecar] = useTransition()
  const [feitos, setFeitos] = useState(0)
  const [parado, setParado] = useState<{ lote: number; erro: string; precisaPin?: boolean } | null>(null)
  const [pin, setPin] = useState('')
  const [mostrarPin, setMostrarPin] = useState(pedePin)
  const [resultado, setResultado] = useState({ criados: 0, atualizados: 0, pulados: 0, erros: 0, categoriasNovas: [] as string[], linhas: [] as LinhaDoLote[] })

  // ── a leitura ──────────────────────────────────────────────
  const montagem = useMemo(() => (grade.length ? montarItens(grade, cabecalho, campos) : null), [grade, cabecalho, campos])
  const colunas = useMemo(() => largura(grade), [grade])
  const faltaNome = !campos.includes('nome')
  const faltaPreco = !campos.includes('precoVista')

  async function comecarCom(bruta: Grade | string, de: string) {
    setErro(null)
    if (typeof bruta === 'string') return setErro(bruta)
    const g = arrumarGrade(bruta)
    if (g.filter((l) => l.some((c) => !vazia(c))).length === 0) return setErro('Não achamos nada escrito. Confira o arquivo (ou o que foi colado) e tente de novo.')
    if (g.length > MAX_LINHAS + 50) {
      return setErro(`São ${g.length.toLocaleString('pt-BR')} linhas — o máximo por vez é ${MAX_LINHAS.toLocaleString('pt-BR')}. Divida a planilha em partes (por categoria, por exemplo) e traga uma de cada vez.`)
    }
    const cab = acharCabecalho(g)
    const palpite = adivinharCampos(g, cab)
    setGrade(g)
    setOrigem(de)
    setCabecalho(cab)
    setCampos(palpite)
    setExistentes(null)
    setEtapa('colunas')
    setIa('nao')
    if (temIA && precisaDeAjuda(g, cab, palpite)) {
      // A IA vê os títulos e até oito linhas — nada mais da planilha.
      setIa('pensando')
      const amostra = amostraParaIA(g, cab)
      const r = await sugerirColunasAcao(slug, amostra.linhas).catch(() => ({ ok: false as const }))
      if (!r.ok) return setIa('falhou')
      const novoCab = r.cabecalho !== null ? (amostra.indices[r.cabecalho] ?? cab) : cab
      // O que a IA não marcou e as regras acharam continua: as duas se somam.
      const juntos = palpite.map((c, i) => (i < r.campos.length ? r.campos[i]! : c))
      for (const [i, c] of palpite.entries()) {
        if (c !== 'ignorar' && juntos[i] === 'ignorar' && !juntos.includes(c)) juntos[i] = c
      }
      setCabecalho(novoCab)
      setCampos(juntos)
      setIa('usou')
    }
  }

  async function escolherArquivo(f: File | undefined) {
    if (!f) return
    setLendo(true)
    try {
      await comecarCom(await lerArquivo(f), f.name)
    } finally {
      setLendo(false)
      if (arquivoRef.current) arquivoRef.current.value = ''
    }
  }

  function trocarCampo(i: number, c: Campo) {
    // Cada campo é de UMA coluna: escolher "Preço" aqui solta o "Preço" de lá.
    setCampos((atual) => atual.map((x, j) => (j === i ? c : c !== 'ignorar' && x === c ? 'ignorar' : x)))
  }

  function trocarCabecalho(v: string) {
    const cab = v === '' ? null : Number(v)
    setCabecalho(cab)
    setCampos(adivinharCampos(grade, cab))
  }

  function baixarModelo() {
    const url = URL.createObjectURL(new Blob([`﻿${MODELO_CSV}\r\n`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'modelo-de-produtos.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── a prévia ───────────────────────────────────────────────
  const itens = montagem?.itens ?? []
  const comEstoque = itens.some((i) => i.estoque !== null || i.variacoes.some((v) => v.estoque !== null))
  const existe = (i: ItemImportado) =>
    !!existentes &&
    ([i.codigo, i.codigoBarras, ...i.variacoes.flatMap((v) => [v.codigo, v.codigoBarras])].some((c) => c && existentes.codigos.has(c)) ||
      existentes.nomes.has(chaveDoNome(i.nome)))
  const jaExistem = itens.filter(existe).length
  const temCategoria = new Set(categorias.map(chaveDoNome))
  const categoriasNovas = (montagem?.categorias ?? []).filter((c) => !temCategoria.has(chaveDoNome(c)))
  const comGrade = itens.filter((i) => i.variacoes.length > 0)

  async function irParaPrevia() {
    setErro(null)
    setEtapa('previa')
    if (!jaTemProdutos) return setExistentes({ codigos: new Set(), nomes: new Set() })
    setExistentes(null)
    const codigos = [...new Set(itens.flatMap((i) => [i.codigo, i.codigoBarras, ...i.variacoes.flatMap((v) => [v.codigo, v.codigoBarras])]).filter((c): c is string => !!c))]
    const nomes = [...new Set(itens.map((i) => i.nome))]
    const achados = { codigos: new Set<string>(), nomes: new Set<string>() }
    for (let i = 0; i < Math.max(codigos.length, nomes.length); i += 2000) {
      const r = await conferirExistentesAcao(slug, { codigos: codigos.slice(i, i + 2000), nomes: nomes.slice(i, i + 2000) }).catch(() => ({ erro: 'A conexão caiu.' }))
      if ('erro' in r) {
        setErro(`Não deu para conferir o que já existe (${r.erro}). Pode trazer assim mesmo: o que já existe é achado na hora.`)
        break
      }
      r.codigos.forEach((c) => achados.codigos.add(c))
      r.nomes.forEach((n) => achados.nomes.add(n))
    }
    setExistentes(achados)
  }

  // ── trazer ─────────────────────────────────────────────────
  const semLoja = lojas.length === 0
  // Sem loja onde a pessoa possa lançar estoque, os produtos entram sem ele.
  const paraMandar = useMemo(
    () => (semLoja ? itens.map((i) => ({ ...i, estoque: null, variacoes: i.variacoes.map((v) => ({ ...v, estoque: null })) })) : itens),
    [itens, semLoja],
  )
  const pacotes = useMemo(() => lotes(paraMandar), [paraMandar])
  const totalLinhas = paraMandar.reduce((s, i) => s + pesoDo(i), 0)

  function trazer(aPartirDe: number) {
    setParado(null)
    setEtapa('trazendo')
    if (aPartirDe === 0) setResultado({ criados: 0, atualizados: 0, pulados: 0, erros: 0, categoriasNovas: [], linhas: [] })
    comecar(async () => {
      let feitas = pacotes.slice(0, aPartirDe).reduce((s, l) => s + l.reduce((t, i) => t + pesoDo(i), 0), 0)
      setFeitos(feitas)
      for (let n = aPartirDe; n < pacotes.length; n++) {
        const lote = pacotes[n]!
        const r = await importarLoteAcao(slug, {
          // A loja vai sempre: é onde o estoque entra E onde os produtos
          // novos nascem vendidos (a não ser que a pessoa peça todas).
          unidadeId: !semLoja ? loja : null,
          vendidoEmTodas: emTodas,
          seJaExiste,
          itens: lote,
          pin: pin || null,
        }).catch(() => ({ ok: false as const, erro: 'A conexão caiu no meio do caminho. O que já entrou está guardado.' }))
        if (!r.ok) {
          if ('precisaPin' in r && r.precisaPin) setMostrarPin(true)
          setParado({ lote: n, erro: r.erro, precisaPin: 'precisaPin' in r ? r.precisaPin : undefined })
          return
        }
        setResultado((a) => ({
          criados: a.criados + r.criados,
          atualizados: a.atualizados + r.atualizados,
          pulados: a.pulados + r.pulados,
          erros: a.erros + r.erros,
          categoriasNovas: [...a.categoriasNovas, ...r.categoriasNovas],
          linhas: [...a.linhas, ...r.linhas.filter((l) => l.situacao !== 'criado' || l.recado)],
        }))
        feitas += lote.reduce((t, i) => t + pesoDo(i), 0)
        setFeitos(feitas)
      }
      await terminarImportacaoAcao(slug).catch(() => {})
      setEtapa('pronto')
    })
  }

  /** As linhas que não entraram, com o motivo, numa planilha para arrumar e trazer de novo. */
  function baixarDeFora() {
    const motivos = new Map<number, string>()
    for (const p of montagem?.problemas ?? []) motivos.set(p.linha, p.motivo)
    for (const l of resultado.linhas) if (l.situacao === 'erro') motivos.set(l.linha, l.recado ?? 'não entrou')
    const celula = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const titulos = cabecalho !== null ? (grade[cabecalho] ?? []).map(textoDe) : Array.from({ length: colunas }, (_, i) => `Coluna ${letra(i)}`)
    const corpo = [...motivos]
      .sort((a, b) => a[0] - b[0])
      .map(([linha, motivo]) => [String(linha), motivo, ...Array.from({ length: colunas }, (_, i) => textoDe(grade[linha - 1]?.[i]))].map(celula).join(';'))
    const texto = [['Linha', 'Por que ficou de fora', ...titulos].map(celula).join(';'), ...corpo].join('\r\n')
    const url = URL.createObjectURL(new Blob([`﻿${texto}\r\n`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'linhas-que-ficaram-de-fora.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function recomecar() {
    setEtapa('escolher')
    setGrade([])
    setCampos([])
    setColado('')
    setErro(null)
    setParado(null)
    setFeitos(0)
    setResultado({ criados: 0, atualizados: 0, pulados: 0, erros: 0, categoriasNovas: [], linhas: [] })
  }

  const passou = (e: Etapa) => ['escolher', 'colunas', 'previa', 'trazendo', 'pronto'].indexOf(etapa) > ['escolher', 'colunas', 'previa', 'trazendo', 'pronto'].indexOf(e)
  const titulosDaGrade = cabecalho !== null ? grade[cabecalho] ?? [] : []
  const dados = grade.slice(cabecalho === null ? 0 : cabecalho + 1).filter((l) => l.some((c) => !vazia(c)))
  const deFora = (montagem?.problemas.length ?? 0) + resultado.erros

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      {/* ── 1. de onde ── */}
      <Passo n={1} titulo="De onde vêm os produtos?" atual={etapa === 'escolher'} feito={passou('escolher')}>
        {etapa === 'escolher' ? (
          <>
            <p className="max-w-2xl text-sm text-tinta-2">
              Serve a planilha que o sistema antigo exporta, o relatório de estoque, ou uma lista feita à mão no Excel ou
              no Google Planilhas. Não precisa arrumar nada antes: o Norte acha as colunas, entende &ldquo;R$ 1.234,56&rdquo;
              e &ldquo;10 kg&rdquo;, e mostra tudo antes de gravar.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setArrastando(true)
                }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setArrastando(false)
                  void escolherArquivo(e.dataTransfer.files[0])
                }}
                className={cx(
                  'flex flex-col items-center justify-center gap-3 rounded-norte border-2 border-dashed p-6 text-center transition-colors',
                  arrastando ? 'border-marca bg-marca-suave' : 'border-borda bg-superficie',
                )}
              >
                <span className="text-sm font-semibold text-tinta">Um arquivo</span>
                <span className="text-xs text-tinta-2">Excel (.xlsx), CSV ou TSV — arraste para cá ou</span>
                <Botao type="button" carregando={lendo} onClick={() => arquivoRef.current?.click()}>
                  Escolher o arquivo
                </Botao>
                <input
                  ref={arquivoRef}
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => void escolherArquivo(e.target.files?.[0])}
                />
              </div>
              <div className="flex flex-col gap-2 rounded-norte border border-borda bg-superficie p-4">
                <label htmlFor="colado" className="text-sm font-semibold text-tinta">
                  Ou copie e cole
                </label>
                <span className="text-xs text-tinta-2">
                  Selecione as células no Excel, no Google Planilhas ou no relatório do sistema, copie (Ctrl+C) e cole aqui (Ctrl+V) — com os títulos, se tiver.
                </span>
                <textarea
                  id="colado"
                  value={colado}
                  onChange={(e) => setColado(e.target.value)}
                  rows={5}
                  spellCheck={false}
                  placeholder={'Código\tNome\tPreço\tEstoque\n001\tCamiseta básica\t49,90\t12'}
                  className="w-full min-w-0 rounded-norte border border-borda bg-superficie px-3 py-2 font-mono text-xs text-tinta placeholder:text-tinta-3"
                />
                <Botao type="button" tom="secundario" disabled={!colado.trim()} onClick={() => void comecarCom(lerTexto(colado), 'o que foi colado')}>
                  Usar o que colei
                </Botao>
              </div>
            </div>
            <p className="text-xs text-tinta-3">
              Começando do zero?{' '}
              <button type="button" onClick={baixarModelo} className="font-semibold text-marca underline-offset-2 hover:underline">
                Baixe a planilha modelo
              </button>
              , preencha e traga de volta. O arquivo é lido aqui no seu navegador; só os produtos sobem.
            </p>
          </>
        ) : (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tinta-2">
            <span>
              Lido: <strong className="text-tinta">{origem}</strong> · {plural(dados.length, 'linha', 'linhas')}
            </span>
            {etapa !== 'trazendo' && (
              <button type="button" onClick={recomecar} className={classeDaAcao({ jeito: 'pilula' })} aria-label="Trocar o arquivo">
                <IconeDaAcao icone="trocar" tamanho={15} />
                Trocar
              </button>
            )}
          </p>
        )}
        {erro && etapa === 'escolher' && <Aviso nivel="critico">{erro}</Aviso>}
      </Passo>

      {/* ── 2. colunas ── */}
      <Passo n={2} titulo="O que é cada coluna" atual={etapa === 'colunas'} feito={passou('colunas')}>
        {etapa === 'colunas' && (
          <>
            {ia === 'pensando' && <Aviso>A IA está lendo os títulos e as primeiras linhas para entender as colunas…</Aviso>}
            {ia === 'usou' && <Aviso nivel="bom">A IA leu as colunas. Confira — e troque o que não estiver certo.</Aviso>}
            {ia === 'falhou' && <Aviso nivel="atencao">A IA não respondeu agora. Este é o nosso palpite: confira coluna por coluna.</Aviso>}
            {ia === 'nao' && cabecalho === null && <Aviso nivel="atencao">Não achamos a linha de títulos. Diga o que é cada coluna olhando os exemplos.</Aviso>}

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-medium text-tinta">Os títulos das colunas estão na</span>
                <select
                  value={cabecalho === null ? '' : String(cabecalho)}
                  onChange={(e) => trocarCabecalho(e.target.value)}
                  className="max-w-full min-w-0 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
                >
                  <option value="">nenhuma linha — começa direto nos produtos</option>
                  {grade.slice(0, 15).map((l, i) =>
                    l.some((c) => !vazia(c)) ? (
                      <option key={i} value={i}>
                        linha {i + 1}: {l.filter((c) => !vazia(c)).slice(0, 4).map((c) => textoDe(c).slice(0, 18)).join(' · ')}
                      </option>
                    ) : null,
                  )}
                </select>
              </label>
            </div>

            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs text-tinta-3">
                    <th className="border-b border-borda py-2 pr-3 font-semibold">Coluna</th>
                    <th className="border-b border-borda py-2 pr-3 font-semibold">Exemplos</th>
                    <th className="border-b border-borda py-2 font-semibold">Esta coluna é</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: colunas }, (_, i) => {
                    const exemplos = dados.map((l) => textoDe(l[i])).filter(Boolean).slice(0, 3)
                    const titulo = textoDe(titulosDaGrade[i])
                    const c = campos[i] ?? 'ignorar'
                    return (
                      <tr key={i} className={cx(c === 'ignorar' && 'text-tinta-3')}>
                        <td className="border-b border-borda-suave py-2 pr-3 align-top">
                          <span className="font-semibold text-tinta">{titulo || `Coluna ${letra(i)}`}</span>
                          {titulo && <span className="block text-xs text-tinta-3">coluna {letra(i)}</span>}
                        </td>
                        <td className="max-w-[280px] border-b border-borda-suave py-2 pr-3 align-top text-xs text-tinta-2">
                          {exemplos.length ? exemplos.map((e, j) => <span key={j} className="block truncate">{e}</span>) : <em>vazia</em>}
                        </td>
                        <td className="border-b border-borda-suave py-2 align-top">
                          <select
                            aria-label={`O que é a coluna ${titulo || letra(i)}`}
                            value={c}
                            onChange={(e) => trocarCampo(i, e.target.value as Campo)}
                            className={cx(
                              'w-full min-w-[180px] rounded-norte border bg-superficie px-2 py-1.5 text-sm',
                              c === 'ignorar' ? 'border-borda text-tinta-3' : 'border-marca/50 font-semibold text-tinta',
                            )}
                          >
                            {CAMPOS.map((k) => (
                              <option key={k} value={k}>
                                {ROTULO_DO_CAMPO[k]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {(faltaNome || faltaPreco) && (
              <Aviso nivel="atencao">
                Diga qual coluna é {[faltaNome && 'o nome do produto', faltaPreco && 'o preço de venda'].filter(Boolean).join(' e qual é ')}: sem isso, o produto não entra.
              </Aviso>
            )}
            {campos.some((c) => c === 'tamanho' || c === 'cor') && (
              <p className="text-xs text-tinta-2">
                Com tamanho ou cor: as linhas com o mesmo nome (ou o mesmo código) viram UM produto com grade, uma opção por linha.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Botao type="button" disabled={faltaNome || faltaPreco || ia === 'pensando'} onClick={() => void irParaPrevia()}>
                Ver a prévia
              </Botao>
              <Botao type="button" tom="discreto" onClick={recomecar}>
                Escolher outro arquivo
              </Botao>
            </div>
          </>
        )}
      </Passo>

      {/* ── 3. prévia ── */}
      <Passo n={3} titulo="Prévia: o que vai entrar" atual={etapa === 'previa'} feito={passou('previa')}>
        {etapa === 'previa' && montagem && (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <Conta n={itens.length} rotulo={itens.length === 1 ? 'produto' : 'produtos'} nivel="bom" />
              <Conta n={comGrade.length} rotulo={`com grade (${comGrade.reduce((s, i) => s + i.variacoes.length, 0)} opções)`} />
              <Conta n={categoriasNovas.length} rotulo={categoriasNovas.length === 1 ? 'categoria nova' : 'categorias novas'} />
              <Conta n={jaExistem} rotulo={jaExistem === 1 ? 'já existe no Norte' : 'já existem no Norte'} nivel="atencao" />
              <Conta n={montagem.problemas.length} rotulo={montagem.problemas.length === 1 ? 'linha com problema' : 'linhas com problema'} nivel="critico" />
              {montagem.problemas.length + montagem.avisos.length > 0 && (
                <button type="button" onClick={() => setVerProblemas((v) => !v)} aria-expanded={verProblemas} className={classeDaAcao({ jeito: 'pilula' })}>
                  <IconeDaAcao icone={verProblemas ? 'cancelar' : 'ver'} tamanho={15} />
                  {verProblemas ? 'Esconder' : 'Ver'}
                </button>
              )}
            </div>
            {existentes === null && jaTemProdutos && <p className="text-xs text-tinta-3">Conferindo o que já existe no Norte…</p>}
            {erro && <Aviso nivel="atencao">{erro}</Aviso>}

            {verProblemas && (
              <div className="grid gap-4 md:grid-cols-2">
                {montagem.problemas.length > 0 && (
                  <Cartao titulo="Ficam de fora">
                    <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-sm">
                      {montagem.problemas.map((p) => (
                        <li key={`${p.linha}-${p.motivo}`} className="flex gap-2">
                          <span className="numero w-14 shrink-0 text-xs text-tinta-3">linha {p.linha}</span>
                          <span className="min-w-0">
                            <span className="font-semibold text-critico">{p.motivo}</span>
                            {p.trecho && <span className="block truncate text-xs text-tinta-3">{p.trecho}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Cartao>
                )}
                {montagem.avisos.length > 0 && (
                  <Cartao titulo="Entram com um ajuste">
                    <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-sm">
                      {montagem.avisos.map((a, j) => (
                        <li key={j} className="flex gap-2">
                          <span className="numero w-14 shrink-0 text-xs text-tinta-3">linha {a.linha}</span>
                          <span className="min-w-0 text-atencao">{a.aviso}</span>
                        </li>
                      ))}
                    </ul>
                  </Cartao>
                )}
              </div>
            )}

            {categoriasNovas.length > 0 && (
              <p className="text-sm text-tinta-2">
                Categorias novas, criadas na hora: <span className="text-tinta">{categoriasNovas.slice(0, 12).join(', ')}{categoriasNovas.length > 12 ? '…' : ''}</span>
              </p>
            )}

            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs text-tinta-3">
                    <th className="border-b border-borda py-2 pr-3 font-semibold">Linha</th>
                    <th className="border-b border-borda py-2 pr-3 font-semibold">Produto</th>
                    <th className="border-b border-borda py-2 pr-3 font-semibold">Código</th>
                    <th className="border-b border-borda py-2 pr-3 font-semibold">Categoria</th>
                    <th className="border-b border-borda py-2 pr-3 text-right font-semibold">Preço</th>
                    <th className="border-b border-borda py-2 pr-3 text-right font-semibold">Custo</th>
                    <th className="border-b border-borda py-2 pr-3 text-right font-semibold">Estoque</th>
                    <th className="border-b border-borda py-2 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {itens.slice(0, 20).map((i) => {
                    const estoque = i.variacoes.length ? i.variacoes.reduce<number | null>((s, v) => (v.estoque === null ? s : (s ?? 0) + v.estoque), null) : i.estoque
                    return (
                      <tr key={i.linha}>
                        <td className="numero border-b border-borda-suave py-2 pr-3 text-xs text-tinta-3">{i.linha}</td>
                        <td className="border-b border-borda-suave py-2 pr-3">
                          <span className="font-semibold text-tinta">{i.nome}</span>
                          {i.variacoes.length > 0 && (
                            <span className="block text-xs text-tinta-2">
                              {plural(i.variacoes.length, 'opção', 'opções')}: {i.variacoes.slice(0, 6).map((v) => [v.cor, v.tamanho].filter(Boolean).join(' ')).join(', ')}
                              {i.variacoes.length > 6 ? '…' : ''}
                            </span>
                          )}
                          {i.marca && <span className="block text-xs text-tinta-3">{i.marca}</span>}
                        </td>
                        <td className="border-b border-borda-suave py-2 pr-3 text-xs">{i.codigo ?? <span className="text-tinta-3">o Norte cria</span>}</td>
                        <td className="border-b border-borda-suave py-2 pr-3 text-xs">{i.categoria ?? '—'}</td>
                        <td className="numero border-b border-borda-suave py-2 pr-3 text-right">{brl(i.precoVista)}</td>
                        <td className="numero border-b border-borda-suave py-2 pr-3 text-right text-tinta-2">{brl(i.custo)}</td>
                        <td className="numero border-b border-borda-suave py-2 pr-3 text-right">
                          {qtd(estoque)} {estoque !== null && i.medida !== 'UN' ? i.medida.toLowerCase() : ''}
                        </td>
                        <td className="border-b border-borda-suave py-2 text-xs">
                          {existe(i) ? <span className="font-semibold text-atencao">já existe</span> : <span className="text-bom">novo</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {itens.length > 20 && <p className="text-xs text-tinta-3">Mostrando os 20 primeiros de {itens.length.toLocaleString('pt-BR')}.</p>}

            <div className="grid gap-4 md:grid-cols-2">
              {semLoja ? (
                comEstoque && (
                  <Aviso nivel="atencao">Você não pode lançar estoque em nenhuma loja: os produtos entram sem estoque. Quem pode ajustar o estoque lança depois.</Aviso>
                )
              ) : (
                <div className="flex min-w-0 flex-col gap-3">
                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-sm font-medium text-tinta">{comEstoque ? 'O estoque da planilha entra em' : 'A planilha é da loja'}</span>
                    <select
                      value={loja}
                      onChange={(e) => setLoja(e.target.value)}
                      className="w-full min-w-0 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
                    >
                      {lojas.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nome}
                          {u.deposito ? ' (depósito)' : ''}
                        </option>
                      ))}
                    </select>
                    {comEstoque && (
                      <span className="text-xs text-tinta-3">
                        Entra como o saldo contado, com o motivo &ldquo;Importado de outro sistema&rdquo;. Trazer de novo deixa o saldo no número da planilha — não soma.
                      </span>
                    )}
                  </label>
                  {/* Onde os produtos NOVOS são vendidos. O padrão é só a loja
                      da planilha: a planilha da sorveteria não põe picolé no
                      balcão da loja de roupa. Depósito não vende — com ele, a
                      pergunta não vale. */}
                  {lojas.length > 1 && !lojas.find((u) => u.id === loja)?.deposito && (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-1.5 text-sm font-medium text-tinta">Os produtos novos são vendidos</legend>
                      {(
                        [
                          [false, `Só em ${lojas.find((u) => u.id === loja)?.nome ?? 'nesta loja'}`, 'Nas outras lojas, marque na ficha do produto quando quiser.'],
                          [true, empresaInteira ? 'Em todas as lojas' : 'Em todas as lojas que você cuida', 'Inclusive no balcão das outras lojas, desde já.'],
                        ] as const
                      ).map(([v, t, r]) => (
                        <label key={String(v)} className="flex cursor-pointer items-start gap-3 rounded-norte border border-borda bg-superficie p-3 has-checked:border-marca has-checked:bg-marca-suave">
                          <input type="radio" name="vendidoEmTodas" checked={emTodas === v} onChange={() => setEmTodas(v)} className="mt-0.5 size-4 accent-[var(--marca)]" />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-sm font-semibold text-tinta">{t}</span>
                            <span className="text-xs text-tinta-2">{r}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </div>
              )}
              {jaExistem > 0 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1.5 text-sm font-medium text-tinta">
                    {plural(jaExistem, 'produto já existe', 'produtos já existem')} no Norte (mesmo código ou mesmo nome)
                  </legend>
                  {(
                    [
                      ['atualizar', 'Atualizar o preço e o estoque do que já existe', podePreco ? 'Nome, grade e etiqueta continuam como estão.' : 'O estoque muda; o preço só para quem pode mexer em preço.'],
                      [
                        'pular',
                        'Pular o que já existe',
                        comEstoque
                          ? 'Não mexe no que já está no Norte — só lança o estoque desta loja do que ainda não tem saldo nela.'
                          : 'Não mexe em nada do que já está no Norte.',
                      ],
                    ] as const
                  ).map(([v, t, r]) => (
                    <label key={v} className="flex cursor-pointer items-start gap-3 rounded-norte border border-borda bg-superficie p-3 has-checked:border-marca has-checked:bg-marca-suave">
                      <input type="radio" name="seJaExiste" value={v} checked={seJaExiste === v} onChange={() => setSeJaExiste(v)} className="mt-0.5 size-4 accent-[var(--marca)]" />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-semibold text-tinta">{t}</span>
                        <span className="text-xs text-tinta-2">{r}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
            {!empresaInteira && (
              <p className="text-xs text-tinta-3">Os produtos novos nascem vendidos só nas lojas que você cuida — como no cadastro de um por um.</p>
            )}
            {mostrarPin && (
              <div className="max-w-xs">
                <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} foco={false} rotulo="Seu PIN (a importação fica assinada)" />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Botao type="button" tom="confirmar" disabled={itens.length === 0 || (jaTemProdutos && existentes === null && !erro)} onClick={() => trazer(0)}>
                Trazer {plural(itens.length, 'produto', 'produtos')}
              </Botao>
              <Botao type="button" tom="discreto" onClick={() => setEtapa('colunas')}>
                Voltar às colunas
              </Botao>
            </div>
          </>
        )}
      </Passo>

      {/* ── 4. trazendo ── */}
      <Passo n={4} titulo={etapa === 'pronto' ? 'Pronto' : 'Trazendo'} atual={etapa === 'trazendo'} feito={etapa === 'pronto'}>
        {(etapa === 'trazendo' || etapa === 'pronto') && (
          <>
            <div className="flex flex-col gap-1.5" aria-live="polite">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={totalLinhas}
                aria-valuenow={feitos}
                aria-label="Progresso da importação"
                className="h-2.5 w-full overflow-hidden rounded-full bg-superficie-2"
              >
                <div className={cx('h-full rounded-full transition-[width] duration-300', parado ? 'bg-atencao-vivo' : 'bg-bom-vivo')} style={{ width: `${totalLinhas ? Math.round((feitos / totalLinhas) * 100) : 0}%` }} />
              </div>
              <span className="text-xs text-tinta-2">
                {feitos.toLocaleString('pt-BR')} de {plural(totalLinhas, 'linha', 'linhas')}
                {indo && ' — pode deixar a tela aberta; não feche até terminar.'}
              </span>
            </div>

            {parado && (
              <div className="flex flex-col gap-3">
                <Aviso nivel={parado.precisaPin ? 'atencao' : 'critico'}>{parado.erro}</Aviso>
                {mostrarPin && (
                  <div className="max-w-xs">
                    <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} aoEnviar={() => trazer(parado.lote)} />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Botao type="button" onClick={() => trazer(parado.lote)}>
                    Continuar de onde parou
                  </Botao>
                  <Botao type="button" tom="discreto" onClick={() => setEtapa('previa')}>
                    Voltar à prévia
                  </Botao>
                </div>
              </div>
            )}

            {(resultado.criados + resultado.atualizados + resultado.pulados + resultado.erros > 0 || etapa === 'pronto') && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                <Conta n={resultado.criados} rotulo={resultado.criados === 1 ? 'produto novo' : 'produtos novos'} nivel="bom" />
                <Conta n={resultado.atualizados} rotulo={resultado.atualizados === 1 ? 'atualizado' : 'atualizados'} />
                <Conta n={resultado.pulados} rotulo={resultado.pulados === 1 ? 'pulado (já existia)' : 'pulados (já existiam)'} nivel="atencao" />
                <Conta n={resultado.erros} rotulo={resultado.erros === 1 ? 'não entrou' : 'não entraram'} nivel="critico" />
                <Conta n={resultado.categoriasNovas.length} rotulo={resultado.categoriasNovas.length === 1 ? 'categoria nova' : 'categorias novas'} />
              </div>
            )}

            {resultado.linhas.length > 0 && (
              <details className="rounded-norte border border-borda bg-superficie p-3">
                <summary className="cursor-pointer text-sm font-semibold text-tinta">Linha por linha ({resultado.linhas.length.toLocaleString('pt-BR')})</summary>
                <ul className="mt-2 flex max-h-80 flex-col gap-1.5 overflow-y-auto text-sm">
                  {resultado.linhas.map((l, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="numero w-14 shrink-0 text-xs text-tinta-3">linha {l.linha}</span>
                      <span className="min-w-0">
                        <span className="font-semibold text-tinta">{l.nome}</span>{' '}
                        <span className={cx(l.situacao === 'erro' ? 'text-critico' : l.situacao === 'pulado' ? 'text-atencao' : 'text-tinta-2')}>
                          — {l.situacao === 'erro' ? 'não entrou' : l.situacao}
                          {l.recado ? `: ${l.recado}` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {etapa === 'pronto' && (
              <>
                <Aviso nivel="bom">
                  Pronto. {resultado.criados > 0 ? `${plural(resultado.criados, 'produto entrou', 'produtos entraram')} no Norte` : 'Nada novo entrou'}
                  {resultado.atualizados > 0 ? ` e ${plural(resultado.atualizados, 'foi atualizado', 'foram atualizados')}` : ''}. Pode trazer a
                  mesma planilha de novo sem medo: o que já existe não duplica.
                </Aviso>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/${slug}/produtos`} className="botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta">
                    Ver os produtos
                  </Link>
                  {comEstoque && !semLoja && (
                    <Link href={`/${slug}/estoque?unidade=${loja}`} className="rounded-norte border border-borda bg-superficie px-4 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2">
                      Ver o estoque
                    </Link>
                  )}
                  {deFora > 0 && (
                    <Botao type="button" tom="secundario" onClick={baixarDeFora}>
                      Baixar as {plural(deFora, 'linha', 'linhas')} que ficaram de fora
                    </Botao>
                  )}
                  <Botao type="button" tom="discreto" onClick={recomecar}>
                    Trazer outra planilha
                  </Botao>
                </div>
              </>
            )}
          </>
        )}
      </Passo>
    </div>
  )
}
