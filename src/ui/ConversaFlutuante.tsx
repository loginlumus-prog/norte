'use client'

// A conversa do assistente, flutuando.
//
// ── o que estava errado antes ────────────────────────────────
// A versão anterior era uma janelinha branca, dentro de uma moldura escura com
// sombra, dentro da seção. Três degraus de caixa encaixados — e o resultado
// não parece uma conversa: parece a captura de tela de uma conversa, colada
// num slide. É a mesma coisa que a referência evita em todos os blocos dela.
//
// ── o que faz parecer real ───────────────────────────────────
// Quatro coisas, e nenhuma é desenho bonito:
//
//   1. NENHUM CONTÊINER. As bolhas pousam direto no fundo da seção. Sem
//      moldura, sem barra de celular, sem cabeçalho de aplicativo.
//   2. INDENTAÇÃO DESIGUAL. Conversa de verdade não é uma coluna alinhada:
//      cada bolha entra um pouco diferente, e é isso que dá ritmo.
//   3. SANGRIA. A última passa da borda direita e é cortada pela seção — o
//      olho entende que a conversa continua fora da tela.
//   4. VIDRO FOSCO. O fundo é uma aurora com movimento de cor; bolha opaca
//      viraria adesivo em cima dela. Translúcida com desfoque, ela pertence
//      ao fundo em vez de tampá-lo.
//
// ── e por que ela não é `AoEntrar` ───────────────────────────
// A cascata daqui tem tempo próprio (a conversa "acontece"), e a peça precisa
// estar legível parada de qualquer jeito — então o movimento é CSS puro
// pendurado no `.cascata` do globals, que já respeita movimento reduzido.

import { AoEntrar } from './AoEntrar'

const FALAS: {
  de: 'agente' | 'dono'
  texto: string
  destaque?: string
  recuo: string
}[] = [
  {
    de: 'agente',
    texto: 'Bom dia! A Camiseta canelada Preto · G tem 2 peças e vende 9 por semana. Acaba quinta.',
    recuo: 'ml-0',
  },
  { de: 'dono', texto: 'pede 20 pro fornecedor', recuo: 'mr-4' },
  {
    de: 'agente',
    texto: 'Anotei a compra: 20 un × R$ 22,40 = R$ 448,00, vencimento em 30 dias. Confirma?',
    recuo: 'ml-6',
  },
  { de: 'dono', texto: 'confirmo', recuo: 'mr-0' },
  {
    de: 'agente',
    texto: 'Pronto. Entrou em contas a pagar e avisei o Carlos no balcão.',
    destaque: 'Esse mês eu já recuperei R$ 1.240 de crediário atrasado.',
    // Sangra: passa da borda direita da seção e é cortada.
    recuo: '-mr-10 ml-3',
  },
]

export function ConversaFlutuante() {
  return (
    <AoEntrar className="relative">
      {/* O nome flutua acima da conversa, sem barra de aplicativo em volta. */}
      <div className="surge mb-4 flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bom-vivo text-sm font-bold text-white shadow-[0_0_24px_-4px_var(--bom-vivo)]">
          A
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-nav-tinta">Aurora</span>
          <span className="text-[11px] text-nav-tinta-2">assistente da sua loja</span>
        </span>
      </div>

      <div className="cascata flex flex-col gap-2.5">
        {FALAS.map((f) => {
          const dele = f.de === 'dono'
          return (
            <div
              key={f.texto}
              className={`flex ${dele ? 'justify-end' : 'justify-start'} ${f.recuo}`}
            >
              <div
                className={
                  'max-w-[27rem] rounded-2xl px-4 py-2.5 backdrop-blur-md ' +
                  (dele
                    ? 'rounded-br-md bg-bom-vivo/22 text-right shadow-[0_8px_32px_-12px_rgb(16_184_102/0.5)]'
                    : 'rounded-bl-md bg-white/[0.07] shadow-[0_8px_32px_-14px_rgb(0_0_0/0.8)]')
                }
              >
                <p className="text-[13px] leading-relaxed text-white/90">{f.texto}</p>
                {f.destaque && (
                  <p className="mt-1.5 border-t border-white/12 pt-1.5 text-[13px] leading-relaxed font-semibold text-sol-claro">
                    {f.destaque}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="surge mt-4 text-[11px] text-nav-tinta-2">
        “Aurora” é só um exemplo — quem dá o nome é você.
      </p>
    </AoEntrar>
  )
}
