'use client'

// "Ler da balança": o peso vem da balança pelo cabo, em vez de ser digitado.
//
// ── o que isto faz, e o que não faz ──────────────────────────
// Usa a Web Serial do navegador para falar com a balança ligada no computador
// por cabo serial ou por adaptador USB-serial. Manda o pedido de peso (ENQ,
// 0x05), escuta por um segundo e meio e aceita só peso ESTÁVEL — ver `lerPeso`
// em ramo.ts para os formatos (Toledo P03, Filizola, linha "ST,GS").
//
// Os limites, ditos sem rodeio:
//   • Só existe onde o navegador tem Web Serial: Chrome e Edge no computador,
//     em endereço seguro (https ou localhost). Safari, Firefox, iPad e a
//     maioria dos celulares não têm — e aí o botão NEM APARECE. Não há botão
//     que só serve para dar erro.
//   • A porta é aberta a 9600 bauds, 8 bits, sem paridade, 1 bit de parada —
//     o padrão de fábrica das balanças de balcão mais comuns. Balança
//     configurada em outra velocidade não responde, e a tela pede para digitar.
//   • Na primeira vez o navegador pergunta QUAL porta; depois lembra (é a
//     permissão do próprio navegador, por site e por aparelho).
//   • O valor da venda continua sendo conta do sistema (peso × preço do
//     quilo). Isto só LÊ o peso — não substitui a balança homologada pelo
//     Inmetro que imprime etiqueta, nem é ela.
//
// E a regra que vale acima de tudo: falhou, a venda segue. Qualquer erro
// (porta ocupada, cabo solto, balança calada, peso mexendo) vira uma frase
// curta embaixo do campo, e o campo continua lá para digitar.

import { useEffect, useState } from 'react'
import { cx } from '@/ui/base'
import { lerPeso, type Leitura } from './ramo'

// A Web Serial ainda não está nos tipos do TypeScript: o mínimo que se usa.
type PortaSerial = {
  open(o: { baudRate: number; dataBits?: number; stopBits?: number; parity?: 'none' | 'even' | 'odd' }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
}
type Serial = { getPorts(): Promise<PortaSerial[]>; requestPort(): Promise<PortaSerial> }

const serialDoNavegador = (): Serial | null =>
  typeof navigator !== 'undefined' && 'serial' in navigator
    ? ((navigator as unknown as { serial: Serial }).serial ?? null)
    : null

const ESPERA_MS = 1500
const ENQ = 0x05

/** Pede o peso e escuta até vir um estável, ou até o tempo acabar. */
async function lerDaPorta(serial: Serial): Promise<Leitura> {
  // A porta que o navegador já liberou antes; senão, ele pergunta qual. O
  // pedido acontece dentro do toque no botão, que é o que o navegador exige.
  const [lembrada] = await serial.getPorts()
  const porta = lembrada ?? (await serial.requestPort())
  await porta.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' })
  let texto = ''
  try {
    if (porta.writable) {
      const w = porta.writable.getWriter()
      try {
        await w.write(new Uint8Array([ENQ]))
      } finally {
        w.releaseLock()
      }
    }
    if (!porta.readable) return null
    const r = porta.readable.getReader()
    const decodificar = new TextDecoder('latin1')
    const fim = setTimeout(() => void r.cancel().catch(() => {}), ESPERA_MS)
    try {
      for (;;) {
        const { value, done } = await r.read()
        if (done) break
        if (value) texto += decodificar.decode(value, { stream: true })
        const l = lerPeso(texto)
        if (l && 'kg' in l) break
        // Guarda só o fim: balança que transmite sem parar encheria a memória.
        if (texto.length > 4000) texto = texto.slice(-400)
      }
    } finally {
      clearTimeout(fim)
      await r.cancel().catch(() => {})
      r.releaseLock()
    }
  } finally {
    await porta.close().catch(() => {})
  }
  return lerPeso(texto)
}

export function LerBalanca({ aoPesar }: { aoPesar: (kg: number) => void }) {
  // Descoberto depois de montar: o servidor não sabe que navegador é este, e
  // decidir no primeiro desenho daria tela diferente entre servidor e cliente.
  const [tem, setTem] = useState(false)
  const [lendo, setLendo] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)
  useEffect(() => setTem(serialDoNavegador() !== null), [])

  if (!tem) return null

  async function ler() {
    const serial = serialDoNavegador()
    if (!serial || lendo) return
    setLendo(true)
    setRecado(null)
    try {
      const l = await lerDaPorta(serial)
      if (l && 'kg' in l && l.kg > 0) {
        aoPesar(l.kg)
        setRecado(null)
      } else if (l && 'kg' in l) {
        setRecado('A balança marcou zero. Ponha o copo no prato e leia de novo.')
      } else if (l && 'instavel' in l) {
        setRecado('O peso ainda estava mexendo. Espere parar e leia de novo — ou digite.')
      } else {
        setRecado('A balança não respondeu. Confira o cabo, ou digite o peso.')
      }
    } catch (e) {
      // Fechar a janela de escolha da porta não é erro: é "agora não".
      const nome = e instanceof Error ? e.name : ''
      setRecado(
        nome === 'NotFoundError'
          ? null
          : nome === 'InvalidStateError' || nome === 'NetworkError'
            ? 'A porta da balança está ocupada por outro programa. Digite o peso.'
            : 'Não deu para ler a balança. Digite o peso.',
      )
    } finally {
      setLendo(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void ler()}
        disabled={lendo}
        className={cx(
          'flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-borda bg-superficie px-4 text-base font-semibold text-tinta',
          'hover:border-marca/50 hover:bg-superficie-2 disabled:opacity-60',
        )}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="size-5 text-tinta-2" fill="none">
          <path d="M3 16h14M5 16l1.5-7h7L15 16M10 9V5M7 5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {lendo ? 'Lendo a balança…' : 'Ler da balança'}
      </button>
      {recado && (
        <p role="status" className="text-sm text-atencao">
          {recado}
        </p>
      )}
    </div>
  )
}
