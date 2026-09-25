'use client'

// O Guia do Norte: a ajuda dentro do sistema, em toda tela.
//
// ── o que ele é ──────────────────────────────────────────────
// Um botão redondo no canto, e um painel que abre pela direita com três
// coisas, nesta ordem: o que ESTA tela faz e como (o manual, aberto na
// página certa); uma busca no manual inteiro; e uma pergunta livre, que o
// servidor responde pela IA quando há chave e pelo manual quando não há.
//
// ── três decisões ────────────────────────────────────────────
// 1. A BUSCA RODA NO NAVEGADOR. O manual (servidor/guia.ts) é puro e vem no
//    pacote da tela; buscar nele não vai ao servidor. Ajuda que demora é
//    ajuda que ninguém abre pela segunda vez.
// 2. A PERGUNTA VAI AO SERVIDOR, e só ela. Lá se decide IA ou manual, lá
//    mora a chave e o freio. A tela nunca sabe se há chave — só recebe a
//    resposta e o rodapé miúdo dizendo quem respondeu.
// 3. NO CELULAR VIRA FOLHA INTEIRA. A 375px um painel de 400px não é painel,
//    é a tela; então ele ocupa tudo e o ✕ fica onde o polegar alcança.
//
// O que a pessoa digitou e a última resposta ficam em estado local enquanto
// o componente vive — fechar e abrir de novo não apaga. Nada em localStorage.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { perguntarAoGuiaAcao, type RespostaDoGuia } from '@/app/[empresa]/acoes'
import {
  buscarNoGuia,
  entradaDaTela,
  rotuloDoPlano,
  telaAbre,
  NOME_DA_CAPACIDADE,
  type Passo,
  type QuemLe,
  type ResultadoBusca,
} from '@/servidor/guia'
import { Simbolo } from './Marca'
import { Aviso, Botao, Campo, cx } from './base'

export function Guia({
  slug,
  empresa,
  nome,
  quem,
}: {
  slug: string
  empresa: string
  nome: string
  /** O que esta pessoa abre. A busca e os links só mostram as telas dela. */
  quem: QuemLe
}) {
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [pergunta, setPergunta] = useState('')
  const [resposta, setResposta] = useState<RespostaDoGuia | null>(null)
  const [pensando, comecar] = useTransition()
  const fechar = useRef<HTMLButtonElement>(null)

  // O caminho sem o slug: '/loja/vendas/abc' vira '/vendas/abc'. É com ele
  // que o manual acha a página certa.
  const caminho = usePathname() ?? ''
  const semSlug = caminho.startsWith(`/${slug}`) ? caminho.slice(slug.length + 1) : caminho
  const tela = useMemo(() => entradaDaTela(semSlug), [semSlug])

  // A busca, a cada tecla, sem ir ao servidor.
  const achados = useMemo(
    () => (termo.trim().length >= 2 ? buscarNoGuia(termo, semSlug, quem) : []),
    [termo, semSlug, quem],
  )
  const abrePlanos = telaAbre({ abre: ['empresa.configurar', 'financeiro.ver'] }, quem)

  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('keydown', esc)
    // A página de trás não rola com o painel aberto — o mesmo motivo da
    // gaveta do menu: o dedo que arrasta o guia arrastaria a tela junto.
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    fechar.current?.focus()
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = antes
    }
  }, [aberto])

  function enviar() {
    const p = pergunta.trim()
    if (p.length < 2 || pensando) return
    comecar(async () => {
      try {
        setResposta(await perguntarAoGuiaAcao(slug, p, semSlug))
      } catch {
        setResposta({ modo: 'erro', texto: 'O guia não conseguiu responder agora. Tente de novo em instantes.' })
      }
    })
  }

  return (
    <>
      {/* O botão. Some quando o painel está aberto: dois jeitos de abrir a
          mesma coisa, um em cima do outro, só confundem.
          ── por que "?" e "Ajuda", e não o símbolo da marca ──
          Era um círculo azul-noite com a agulha do Norte: o maior bloco
          escuro da tela branca, e quem nunca usou não tinha como saber que
          aquilo era ajuda. O ponto de interrogação é o sinal que qualquer
          pessoa reconhece, e a palavra tira a última dúvida onde há espaço.
          No celular fica só o círculo, para cobrir menos da tela. */}
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir a ajuda (Guia do Norte)"
          title="Ajuda — Guia do Norte"
          className="fixed right-4 bottom-4 z-40 flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-borda bg-superficie px-3 text-sm font-semibold text-titulo shadow-norte-alta transition-colors hover:border-marca hover:text-marca"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7.9 7.7a2.2 2.2 0 1 1 3.1 2c-.6.3-1 .8-1 1.5v.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="10" cy="14.2" r=".95" fill="currentColor" />
          </svg>
          <span className="hidden sm:inline">Ajuda</span>
        </button>
      )}

      {aberto && (
        <>
          <div aria-hidden onClick={() => setAberto(false)} className="fixed inset-0 z-40 bg-nav/40" />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Guia do Norte"
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-borda bg-superficie shadow-norte-alta sm:w-[400px]"
          >
            {/* Cabeçalho branco, com fio embaixo, como o cabeçalho de toda
                tela. Já foi azul-noite "como a barra" — mas a barra ficou
                branca em 24/09, e o bloco escuro virou a única mancha pesada
                de um sistema claro. O símbolo com azulejo segura a marca. */}
            <header className="flex items-start justify-between gap-3 border-b border-borda bg-superficie px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Simbolo tamanho={26} id="guia-painel" />
                <div className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-extrabold tracking-[-0.035em] text-titulo">
                    Guia do Norte
                  </span>
                  <span className="truncate text-xs text-tinta-3">
                    {tela ? `Você está em ${tela.titulo}` : empresa}
                  </span>
                </div>
              </div>
              <button
                ref={fechar}
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar o guia"
                className="flex size-9 shrink-0 items-center justify-center rounded-norte text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
              >
                <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-4">
              {/* ── 1. nesta tela ── */}
              <section className="flex flex-col gap-2">
                <Titulo>Nesta tela</Titulo>
                {tela ? (
                  <>
                    <p className="text-sm leading-relaxed text-tinta-2">{tela.oQueE}</p>
                    <ul className="flex flex-col gap-1">
                      {tela.comoFazer.map((c) => (
                        <li key={c.titulo}>
                          <ComoFazer passo={c} />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-tinta-3">
                    Esta tela ainda não tem página no guia. Procure abaixo, ou pergunte.
                  </p>
                )}
              </section>

              {/* ── 2. buscar ── */}
              <section className="flex flex-col gap-2">
                <Titulo>O que você quer fazer?</Titulo>
                <Campo
                  rotulo="Buscar no guia"
                  name="guia-busca"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="abrir o caixa, vender fiado, imprimir etiqueta…"
                  autoComplete="off"
                />
                {termo.trim().length >= 2 &&
                  (achados.length === 0 ? (
                    <p className="text-sm text-tinta-3">Nada com essas palavras. Tente outra, ou pergunte abaixo.</p>
                  ) : (
                    <Cartoes slug={slug} itens={achados} />
                  ))}
              </section>

              {/* ── 3. perguntar ── */}
              <section className="flex flex-col gap-2">
                <Titulo>Perguntar ao guia</Titulo>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-tinta">Escreva como falaria com alguém da loja</span>
                  <textarea
                    value={pergunta}
                    onChange={(e) => setPergunta(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault()
                        enviar()
                      }
                    }}
                    rows={3}
                    maxLength={500}
                    placeholder={`${nome.split(' ')[0]}, o que você quer saber?`}
                    className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
                  />
                </label>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-tinta-3">Ctrl+Enter também envia</span>
                  <Botao onClick={enviar} carregando={pensando} disabled={pergunta.trim().length < 2}>
                    Perguntar
                  </Botao>
                </div>

                {pensando && (
                  <span className="inline-flex w-fit items-center rounded-full bg-superficie-2 px-3 py-2 [&_i]:bg-tinta-3" aria-label="O guia está pensando">
                    <span className="pensando">
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                )}

                {!pensando && resposta && (
                  <div className="flex flex-col gap-2">
                    {resposta.modo === 'erro' && <Aviso nivel="critico">{resposta.texto}</Aviso>}
                    {resposta.modo === 'ia' && (
                      <p className="rounded-norte border border-borda bg-superficie-2 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-tinta">
                        {resposta.texto}
                      </p>
                    )}
                    {resposta.modo === 'manual' &&
                      (resposta.respostas.length === 0 ? (
                        <Aviso nivel="neutro">
                          O manual não tem nada com essas palavras. Tente dizer o nome da tela ou da ação.
                        </Aviso>
                      ) : (
                        <Cartoes slug={slug} itens={resposta.respostas} />
                      ))}
                    {resposta.modo !== 'erro' && (
                      <p className="text-[11px] text-tinta-3">
                        {resposta.modo === 'ia' ? 'Respondido pela IA, com o manual como fonte.' : 'Respondido pelo manual.'}
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>

            {abrePlanos && (
              <footer className="border-t border-borda px-4 py-3 text-xs">
                <Link
                  href={`/${slug}/assinatura`}
                  onClick={() => setAberto(false)}
                  className="font-medium text-marca underline-offset-2 hover:underline"
                >
                  Os planos e o que cada um abre →
                </Link>
              </footer>
            )}
          </div>
        </>
      )}
    </>
  )
}

function Titulo({ children }: { children: string }) {
  return (
    <h2 className="text-[10px] font-bold tracking-[0.12em] text-tinta-3 uppercase">{children}</h2>
  )
}

/** Um como-fazer, fechado: o título e, ao abrir, os passos numerados. */
function ComoFazer({ passo, aberto = false }: { passo: Passo; aberto?: boolean }) {
  return (
    <details open={aberto || undefined} className="group rounded-norte border border-borda bg-superficie">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2">
        <span>{passo.titulo}</span>
        <span aria-hidden className="text-tinta-3 transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-borda-suave px-3 py-2.5">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-tinta-2">
          {passo.passos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        {(passo.capacidade || passo.plano) && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-tinta-3">
            {passo.capacidade && <span>Precisa poder: {NOME_DA_CAPACIDADE[passo.capacidade]}.</span>}
            {passo.plano && <span>Plano: {rotuloDoPlano(passo.plano)}.</span>}
          </p>
        )}
      </div>
    </details>
  )
}

/** Os cartões da busca e da resposta pelo manual: a tela, e os passos que casaram. */
function Cartoes({ slug, itens }: { slug: string; itens: ResultadoBusca[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((r, n) => (
        <li key={r.entrada.chave} className={cx('flex flex-col gap-1.5 rounded-norte border border-borda p-3', n === 0 && 'bg-marca-suave/40')}>
          <Link href={`/${slug}${r.entrada.caminho}`} className="text-sm font-bold text-marca underline-offset-2 hover:underline">
            {r.entrada.titulo} →
          </Link>
          {r.passos.length === 0 ? (
            <p className="text-xs leading-relaxed text-tinta-2">{r.entrada.oQueE}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {r.passos.map((p, i) => (
                <li key={p.titulo}>
                  <ComoFazer passo={p} aberto={n === 0 && i === 0} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
