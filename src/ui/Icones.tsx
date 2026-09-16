// Os ícones de linha da página de venda.
//
// ── por que desenhados à mão, e não de biblioteca ────────────
// Pelo mesmo motivo dos selos de plano (ver `SeloPlano.tsx`): cada um sai com
// menos de 1 KB, herda a cor do tema por `currentColor` e é visto a 40 pixels,
// onde traço de biblioteca genérica ou fica fino demais ou vira bolinha. E
// biblioteca traz ícone de tudo — o que a gente precisa são catorze, cada um
// dizendo UMA coisa do Norte, no mesmo traço (1.6) e na mesma grade (48).
//
// ── o que cada um conta ──────────────────────────────────────
// Não é "um ícone bonito para cada palavra": é a MECÂNICA da dor ou do
// módulo, resumida em duas ou três formas. A pilha que tomba é excesso; a
// prateleira com um vão pontilhado e um relógio é ruptura com prazo; a caixa
// com uma seta entrando e outra saindo é o estoque em movimento. Quem lê o
// título ao lado confirma o que o desenho já disse.
//
// Duas famílias, e a diferença é onde aparecem:
//   • as SEIS DORES — a grade "O que resolve";
//   • os OITO MÓDULOS — o diagrama "Um sistema só", nos grupos do menu real
//     (`ui/menu.ts`): Vender, Catálogo, Pessoas, Dinheiro e a Empresa em
//     quatro (Assistente, Auditoria, Assinatura, Configurações).
//
// Nenhuma cor aqui: quem pinta é a classe de quem chama (`text-marca`,
// `text-tinta-3`), e assim o mesmo desenho serve a papel e a azul-noite.

type Props = { tamanho?: number; className?: string }

const base = (tamanho: number, className?: string) => ({
  width: tamanho,
  height: tamanho,
  viewBox: '0 0 48 48',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
  focusable: 'false' as const,
})

/* ═══════════════════════════════════════════════════════════
   As seis dores
   ═══════════════════════════════════════════════════════════ */

/** Estoque em excesso: a pilha cresceu além da prateleira e a de cima tomba. */
export function IconeExcesso({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <path d="M6 40 H42" opacity="0.45" />
      <rect x="9" y="30" width="10" height="10" rx="1.5" />
      <rect x="19" y="30" width="10" height="10" rx="1.5" />
      <rect x="29" y="30" width="10" height="10" rx="1.5" />
      <rect x="14" y="20" width="10" height="10" rx="1.5" />
      <rect x="24" y="20" width="10" height="10" rx="1.5" />
      {/* A de cima está inclinada: é o que separa "estoque" de "excesso". */}
      <g transform="rotate(-14 24 13.5)">
        <rect x="19" y="8.5" width="10" height="10" rx="1.5" />
      </g>
    </svg>
  )
}

/** Ruptura: o vão pontilhado é a peça que faltou; o relógio é o prazo do fornecedor. */
export function IconeRuptura({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <path d="M6 37 H42" opacity="0.45" />
      <rect x="8" y="25" width="9" height="12" rx="1.5" />
      <rect x="19" y="25" width="9" height="12" rx="1.5" />
      <rect x="30" y="25" width="9" height="12" rx="1.5" strokeDasharray="2.5 2.5" opacity="0.6" />
      <circle cx="34.5" cy="12" r="6.5" />
      <path d="M34.5 8.5 V12 L37 13.8" />
    </svg>
  )
}

/** Precificação: a etiqueta de preço com a porcentagem — a margem — dentro. */
export function IconePreco({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <path d="M7 7 H20.5 L41 27.5 L27.5 41 L7 20.5 Z" />
      <circle cx="13.5" cy="13.5" r="2.2" />
      <circle cx="21" cy="21" r="2.4" />
      <circle cx="30" cy="30" r="2.4" />
      <path d="M31 19 L20 32" />
    </svg>
  )
}

/** Tempo e produtividade: o relógio, e o visto do que foi entregue. */
export function IconeTempo({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <circle cx="19" cy="21" r="12.5" />
      <path d="M19 13.5 V21 L24 24.5" />
      <path d="M30 35 L35 40 L44 30" />
    </svg>
  )
}

/** Controle de estoque: a caixa, uma seta entrando e outra saindo. */
export function IconeControle({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <path d="M14 19 L24 14 L34 19 V33 L24 38 L14 33 Z" />
      <path d="M14 19 L24 24 L34 19 M24 24 V38" opacity="0.6" />
      <path d="M4 26 H10.5 M8 23.5 L10.5 26 L8 28.5" />
      <path d="M38 26 H44 M41.5 23.5 L44 26 L41.5 28.5" />
    </svg>
  )
}

/** Integração das equipes: três pessoas sobre o mesmo chão. */
export function IconeEquipes({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <circle cx="24" cy="11" r="4" />
      <path d="M17 23 c0-4.5 3-7 7-7 s7 2.5 7 7" />
      <circle cx="11" cy="28" r="4" />
      <path d="M4 40 c0-4.5 3-7 7-7 s7 2.5 7 7" />
      <circle cx="37" cy="28" r="4" />
      <path d="M30 40 c0-4.5 3-7 7-7 s7 2.5 7 7" />
      {/* O chão em arco é o mesmo dos selos de plano: dá lugar às pessoas em
          vez de deixá-las soltas — e é o "mesmo lugar" que a palavra
          integração quer dizer. */}
      <path d="M6 44 Q 24 40 42 44" opacity="0.35" />
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════
   Os oito módulos
   ═══════════════════════════════════════════════════════════ */

/** Vender: a registradora — visor, teclas e a gaveta. */
export function IconeVender({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <rect x="16" y="8" width="16" height="9" rx="1.5" />
      <path d="M20 12.5 H28" opacity="0.5" />
      <path d="M10 17 H38 L41 26 H7 Z" />
      <path d="M14 21.5 H17 M20 21.5 H23 M26 21.5 H29 M32 21.5 H35" opacity="0.5" />
      <rect x="7" y="26" width="34" height="13" rx="1.5" />
      <path d="M20 32.5 H28" />
    </svg>
  )
}

/** Catálogo: a grade de produtos, e o ponto que é a variação de um deles. */
export function IconeCatalogo({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <rect x="8" y="8" width="14" height="14" rx="2.5" />
      <rect x="26" y="8" width="14" height="14" rx="2.5" />
      <rect x="8" y="26" width="14" height="14" rx="2.5" />
      <rect x="26" y="26" width="14" height="14" rx="2.5" />
      <path d="M12 15 H18 M30 15 H36 M12 33 H18" opacity="0.5" />
      <circle cx="33" cy="33" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Pessoas: duas, uma na frente e outra um pouco atrás. */
export function IconePessoas({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <circle cx="19" cy="15" r="5.5" />
      <path d="M7 39 c0-8 5.5-12.5 12-12.5 s12 4.5 12 12.5" />
      <g opacity="0.55">
        <circle cx="33" cy="17" r="4.5" />
        <path d="M33 27.5 c5.5 0 9 4 9 11" />
      </g>
    </svg>
  )
}

/** Dinheiro: três barras subindo sobre a linha do chão — o mês em números. */
export function IconeDinheiro({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <path d="M6 40 H42" opacity="0.45" />
      <rect x="9" y="27" width="7" height="13" rx="1" />
      <rect x="20.5" y="19" width="7" height="21" rx="1" />
      <rect x="32" y="11" width="7" height="29" rx="1" />
    </svg>
  )
}

/** Assistente: o balão de conversa com a agulha do Norte dentro — é o NOSSO que atende. */
export function IconeAssistente({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <path d="M10 8 H38 a4 4 0 0 1 4 4 V27 a4 4 0 0 1 -4 4 H21 L12 39 V31 H10 a4 4 0 0 1 -4 -4 V12 a4 4 0 0 1 4 -4 Z" />
      {/* A agulha do símbolo (`Marca.tsx`), a 70%: a metade norte cheia, a sul
          só em traço. O traço é engrossado na mesma proporção para continuar
          lendo como 1.6 depois da escala. */}
      <g transform="translate(12.8 8.3) scale(0.7)">
        <path d="M16 4 L22.5 20.5 L16 17.4 L9.5 20.5 Z" fill="currentColor" stroke="none" />
        <path d="M16 17.4 L22.5 20.5 L16 28 L9.5 20.5 Z" strokeWidth={1.6 / 0.7} />
      </g>
    </svg>
  )
}

/** Auditoria: o livro fechado, com a dobra e as linhas — quem, o quê, quando. */
export function IconeAuditoria({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <rect x="11" y="8" width="26" height="32" rx="2.5" />
      <path d="M17 8 V40" opacity="0.5" />
      <path d="M23 16 H32 M23 22 H32 M23 28 H29" opacity="0.6" />
    </svg>
  )
}

/** Assinatura: o cartão, e o visto de conta em dia. */
export function IconeAssinatura({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <rect x="5" y="11" width="38" height="26" rx="3" />
      <path d="M5 19 H43" />
      <rect x="10" y="25" width="9" height="5" rx="1" opacity="0.6" />
      <path d="M27 29.5 L31 33.5 L38 25" />
    </svg>
  )
}

/** Configurações: três controles deslizantes, cada um numa posição. */
export function IconeConfiguracoes({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <path d="M7 14 H41 M7 24 H41 M7 34 H41" opacity="0.45" />
      <circle cx="30" cy="14" r="3.2" fill="currentColor" stroke="none" />
      <circle cx="17" cy="24" r="3.2" fill="currentColor" stroke="none" />
      <circle cx="26" cy="34" r="3.2" fill="currentColor" stroke="none" />
    </svg>
  )
}
