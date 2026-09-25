'use client'

// A conversa do assistente, acontecendo.
//
// ── o que estava errado na primeira versão ───────────────────
// Era uma janelinha branca, dentro de uma moldura escura, dentro da seção.
// Três degraus de caixa encaixados — e o resultado não parece uma conversa:
// parece a captura de tela de uma conversa, colada num slide.
//
// ── o que faz parecer real ───────────────────────────────────
//   1. NENHUM CONTÊINER. As bolhas pousam direto no fundo da seção. Sem
//      moldura, sem barra de celular, sem cabeçalho de aplicativo.
//   2. INDENTAÇÃO DESIGUAL. Conversa de verdade não é uma coluna alinhada:
//      cada bolha entra um pouco diferente, e é isso que dá ritmo.
//   3. RESPIRO DESIGUAL. O recuo de cada lado varia de balão para balão.
//   4. OS DOIS PAPÉIS DE TODA CONVERSA: o dele à esquerda, o seu à direita,
//      em cores diferentes — sem precisar de nome em cada balão.
//   5. ELA ACONTECE. Um balão de cada vez, com "digitando" antes da fala do
//      assistente e o texto sendo escrito na frente de quem está lendo. É o
//      que separa "conversa" de "lista de mensagens".
//
// ── em 24/09 virou papel claro ───────────────────────────────
// A página inteira ficou branca, e a conversa saiu da aurora escura. O que
// valia continua valendo — nenhuma moldura de celular, indentação desigual,
// um balão de cada vez —, mas o fundo passou a ser o papel de parede de
// pontinhos da seção (`.papel-conversa`) e os balões viraram os dois papéis
// de qualquer conversa: o dele branco com borda, o seu no verde claro da
// situação "bom". Tudo em ficha, então o tema escuro acompanha sozinho.
//
// A sangria da última bolha saiu junto: ela existia para romper a borda da
// aurora; dentro de um painel claro ela só cortaria texto.
//
// ── por que máquina de estados, e não CSS ────────────────────
// A versão anterior escalonava com `animation-delay`: as bolhas APARECIAM em
// sequência, mas nada era escrito e não havia onde encaixar o "digitando".
// Escrever caractere a caractere só existe em JavaScript.
//
// ── nada nasce invisível ─────────────────────────────────────
// O estado inicial é a conversa INTEIRA na tela — é isso que o servidor manda,
// e é isso que fica se o JavaScript não rodar, se ele quebrar, ou se a pessoa
// pediu menos movimento. Só depois de montar, e só se o movimento for
// bem-vindo, o componente volta ao começo e toca a cena. O buscador indexa a
// conversa completa.
//
// ── e por que a altura é travada antes de começar ────────────
// Bolha que entra empurra o que está embaixo, e a seção inteira cresceria
// durante a animação — a página pularia debaixo de quem está lendo a coluna
// da esquerda. A altura final é medida ANTES de esconder qualquer coisa
// (quando tudo ainda está montado) e vira piso do bloco.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Fala = {
  de: 'agente' | 'dono'
  texto: string
  destaque?: string
  /** Indentação: conversa de verdade não é uma coluna alinhada. */
  recuo: string
}

const FALAS: Fala[] = [
  {
    de: 'agente',
    texto: 'Bom dia! A Camiseta canelada Preto · G tem 2 peças e vende 9 por semana. Acaba quinta.',
    recuo: 'mr-8',
  },
  { de: 'dono', texto: 'pede 20 pro fornecedor', recuo: 'ml-10' },
  {
    de: 'agente',
    texto: 'Anotei a compra: 20 un × R$ 22,40 = R$ 448,00, vencimento em 30 dias. Confirma?',
    recuo: 'mr-4',
  },
  { de: 'dono', texto: 'confirmo', recuo: 'ml-16' },
  {
    de: 'agente',
    texto: 'Pronto. Entrou em contas a pagar e avisei o Carlos no balcão.',
    // O destaque é um dos recibos que a tela do assistente soma de verdade
    // ("reposição antes de acabar"). Já foi "recuperei R$ 1.240 de crediário
    // atrasado" — e cobrar crediário é poder que ainda não existe
    // (`servidor/poderes.ts`, `disponivel: false`). Frase de exemplo também
    // promete.
    destaque: 'Esse mês já foram 4 reposições antes de a peça acabar.',
    recuo: 'mr-2',
  },
]

// ── o compasso ──
// Os números são de conversa, não de animação: 900ms de "digitando" é o tempo
// que uma resposta leva para começar a chegar, e o dono escreve mais devagar
// que o assistente porque ele é uma pessoa com um celular na mão.
const PENSA = 900 // quanto tempo os três pontinhos ficam
const ANTES_DO_AGENTE = 300 // respiro antes de ele começar a pensar
const ANTES_DO_DONO = 550 // respiro antes de o dono começar a responder
const LETRA_AGENTE = 11 // ms por caractere
const LETRA_DONO = 42
const DEPOIS = 450 // pausa com a fala pronta, antes da próxima

type Fase = 'espera' | 'pensa' | 'escreve'

export function ConversaFlutuante() {
  const bloco = useRef<HTMLDivElement>(null)
  const pilha = useRef<HTMLDivElement>(null)

  /** false = a conversa inteira na tela (servidor, sem JS, movimento reduzido). */
  const [animando, setAnimando] = useState(false)
  const [naTela, setNaTela] = useState(false)
  const [piso, setPiso] = useState<number>()

  const [n, setN] = useState(0)
  const [fase, setFase] = useState<Fase>('espera')
  const [letras, setLetras] = useState(0)

  // Mede a altura final ANTES de esconder qualquer bolha, e só então entra em
  // modo animação. `useLayoutEffect` para medida e troca acontecerem no mesmo
  // quadro: depois da pintura, dava para ver a conversa piscar.
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (pilha.current) setPiso(pilha.current.offsetHeight)
    setAnimando(true)
  }, [])

  // Só começa quando a pessoa chega na seção — a cena é para ser vista.
  useEffect(() => {
    const el = bloco.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setNaTela(true)
          obs.disconnect()
        }
      },
      { threshold: 0.25 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // O relógio da cena. Cada passo agenda um tempo só e devolve a limpeza —
  // assim não sobra temporizador solto se a pessoa sair no meio.
  useEffect(() => {
    if (!animando || !naTela || n >= FALAS.length) return
    const f = FALAS[n]!
    const dele = f.de === 'dono'
    const inteiro = f.texto.length + (f.destaque?.length ?? 0)

    if (fase === 'espera') {
      const t = setTimeout(
        () => setFase(dele ? 'escreve' : 'pensa'),
        dele ? ANTES_DO_DONO : ANTES_DO_AGENTE,
      )
      return () => clearTimeout(t)
    }

    if (fase === 'pensa') {
      const t = setTimeout(() => setFase('escreve'), PENSA)
      return () => clearTimeout(t)
    }

    if (letras < inteiro) {
      const t = setTimeout(() => setLetras((k) => k + 1), dele ? LETRA_DONO : LETRA_AGENTE)
      return () => clearTimeout(t)
    }

    const t = setTimeout(() => {
      setN((k) => k + 1)
      setFase('espera')
      setLetras(0)
    }, DEPOIS)
    return () => clearTimeout(t)
  }, [animando, naTela, n, fase, letras])

  const prontas = animando ? FALAS.slice(0, n) : FALAS
  const atual = animando && n < FALAS.length && fase === 'escreve' ? FALAS[n] : undefined
  const pensando = animando && n < FALAS.length && fase === 'pensa'

  return (
    <div ref={bloco} className="conversa-clara relative">
      {/* O nome flutua acima da conversa, sem barra de aplicativo em volta. */}
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-bom-vivo text-sm font-bold text-white shadow-norte">
          A
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-tinta">Aurora</span>
          <span className="text-[11.5px] text-tinta-3">assistente da sua loja · no WhatsApp</span>
        </span>
      </div>

      <div
        ref={pilha}
        className="flex flex-col gap-2.5"
        style={piso ? { minHeight: piso } : undefined}
      >
        {prontas.map((f) => (
          <Balao key={f.texto} f={f} texto={f.texto} destaque={f.destaque} />
        ))}

        {atual && (
          <Balao
            key={atual.texto}
            f={atual}
            escrevendo
            texto={atual.texto.slice(0, letras)}
            destaque={
              atual.destaque && letras > atual.texto.length
                ? atual.destaque.slice(0, letras - atual.texto.length)
                : undefined
            }
          />
        )}

        {pensando && (
          <div className={`flex justify-start ${FALAS[n]!.recuo}`}>
            <div className="balao-entra rounded-2xl rounded-bl-md border border-borda bg-superficie px-4 py-3.5 shadow-norte">
              <span className="pensando" role="status" aria-label="Aurora está digitando">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-[11.5px] text-tinta-3">
        “Aurora” é só um exemplo — quem dá o nome é você.
      </p>
    </div>
  )
}

function Balao({
  f,
  texto,
  destaque,
  escrevendo,
}: {
  f: Fala
  texto: string
  destaque?: string
  /** A que está sendo escrita agora ganha o cursor. */
  escrevendo?: boolean
}) {
  const dele = f.de === 'dono'
  return (
    <div className={`flex ${dele ? 'justify-end' : 'justify-start'} ${f.recuo}`}>
      <div
        className={
          'balao-entra max-w-[26rem] rounded-2xl border px-4 py-2.5 shadow-norte ' +
          (dele
            ? 'rounded-br-md border-bom-borda bg-bom-fundo text-right'
            : 'rounded-bl-md border-borda bg-superficie')
        }
      >
        <p className="text-[13.5px] leading-relaxed text-tinta">
          {texto}
          {escrevendo && destaque === undefined && <span className="cursor-digita">|</span>}
        </p>
        {destaque !== undefined && (
          <p className="mt-1.5 border-t border-borda-suave pt-1.5 text-[13px] leading-relaxed font-semibold text-bom">
            {destaque}
            {escrevendo && <span className="cursor-digita">|</span>}
          </p>
        )}
      </div>
    </div>
  )
}
