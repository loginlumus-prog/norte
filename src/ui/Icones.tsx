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
//   • as DORES — o bento "O que resolve";
//   • os MÓDULOS — o painel "Produto" da barra do topo, nos grupos do menu
//     real (`ui/menu.ts`): Vender, Catálogo, Pessoas, Dinheiro e a Empresa
//     (Assistente, Auditoria, Assinatura, Configurações);
//   • a SEGURANÇA — as cinco garantias, cada uma com a mecânica dela;
//   • os de INTERFACE — seta, menu, fechar, visto — numa grade de 24, que é
//     onde peça de navegação mora.
//
// Nenhuma cor aqui: quem pinta é a classe de quem chama (`text-marca`,
// `text-tinta-3`), e assim o mesmo desenho serve a papel e a azul-noite.

type Props = { tamanho?: number; className?: string }

// ── o traço acompanha o tamanho ──────────────────────────────
// A grade é de 48 e o traço 1.6 foi desenhado para ser visto a 40px, onde ele
// sai com ~1,3px na tela. No menu do topo o mesmo desenho aparece a 24px, e
// ali 1.6 vira 0,8px — some no branco. Então o traço engrossa na grade na
// mesma proporção em que o ícone encolhe, e sai com ~1,3px em qualquer
// tamanho. Acima de 40px ele fica em 1.6, que é o desenho original.
const traco = (tamanho: number) => Math.max(1.6, 64 / tamanho)

const base = (tamanho: number, className?: string) => ({
  width: tamanho,
  height: tamanho,
  viewBox: '0 0 48 48',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: traco(tamanho),
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
        <path d="M16 17.4 L22.5 20.5 L16 28 L9.5 20.5 Z" strokeWidth={traco(tamanho) / 0.7} />
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

/* ═══════════════════════════════════════════════════════════
   Mais duas dores: o fiado e o fechamento do mês
   ═══════════════════════════════════════════════════════════ */

/** Fiado: o carnê — três parcelas, uma já paga (o visto), duas em aberto. */
export function IconeFiado({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <rect x="8" y="9" width="32" height="30" rx="3" />
      <path d="M8 17 H40" opacity="0.5" />
      <path d="M14 24.5 L16.5 27 L21 22.5" />
      <path d="M26 25 H34" opacity="0.6" />
      <circle cx="17.5" cy="33" r="1.4" fill="currentColor" stroke="none" opacity="0.6" />
      <path d="M26 33 H34" opacity="0.6" />
    </svg>
  )
}

/** Fechamento do mês: a folha do calendário, e o visto de mês conferido. */
export function IconeFechamento({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <rect x="7" y="10" width="34" height="30" rx="3" />
      <path d="M7 18 H41" />
      <path d="M15 6 V13 M33 6 V13" />
      <path d="M17 29 L22 34 L31 24" />
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════
   As cinco garantias de segurança
   ═══════════════════════════════════════════════════════════ */

/** Isolamento: duas paredes seguidas, e o dado da empresa atrás das duas. */
export function IconeParedes({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <path d="M13 8 V40 M21 8 V40" />
      <path d="M13 16 H21 M13 24 H21 M13 32 H21" opacity="0.5" />
      <ellipse cx="34" cy="16" rx="7" ry="3" />
      <path d="M27 16 V31 c0 1.7 3.1 3 7 3 s7 -1.3 7 -3 V16" />
      <path d="M27 23.5 c0 1.7 3.1 3 7 3 s7 -1.3 7 -3" opacity="0.6" />
      <path d="M5 24 H9.5 M7.5 21.5 L10 24 L7.5 26.5" opacity="0.6" />
    </svg>
  )
}

/** Acesso cortado: a pessoa, e o traço que atravessa na hora. */
export function IconeCorte({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <circle cx="22" cy="16" r="6" />
      <path d="M9 40 c0-8.5 5.8-13 13-13 c3.5 0 6.6 1 8.8 3" />
      <circle cx="35" cy="34" r="7" />
      <path d="M30 39 L40 29" />
    </svg>
  )
}

/** Freio de senha: o cadeado, e o relógio da espera depois do erro. */
export function IconeFreio({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <rect x="6" y="21" width="22" height="18" rx="3" />
      <path d="M11 21 V15 a6 6 0 0 1 12 0 V21" />
      <circle cx="17" cy="30" r="2" fill="currentColor" stroke="none" />
      <circle cx="35.5" cy="15" r="7.5" />
      <path d="M35.5 11 V15 L38.5 17" />
    </svg>
  )
}

/** A tela que tranca: o monitor, e o cadeado no meio dele. */
export function IconeTranca({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <rect x="5" y="8" width="38" height="26" rx="3" />
      <path d="M18 41 H30 M24 34 V41" opacity="0.6" />
      <rect x="18.5" y="20" width="11" height="8.5" rx="1.5" />
      <path d="M21 20 V17.5 a3 3 0 0 1 6 0 V20" />
    </svg>
  )
}

/** A ajuda em toda tela: o balão com o ponto de interrogação. */
export function IconeGuia({ tamanho = 40, className }: Props) {
  return (
    <svg {...base(tamanho, className)}>
      <circle cx="24" cy="24" r="17" />
      <path d="M19 19.5 a5 5 0 1 1 7 4.6 c-1.3.6 -2 1.6 -2 3 V28.5" />
      <circle cx="24" cy="34" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════
   Interface — grade de 24, traço fixo
   ═══════════════════════════════════════════════════════════
   Seta, menu, fechar e visto são peça de navegação: moram dentro de botão,
   a 14–20px, e precisam de traço firme em vez de desenho. Grade própria de
   24 para não herdar a compensação de traço dos ícones de 48. */

const interface24 = (tamanho: number, className?: string) => ({
  width: tamanho,
  height: tamanho,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
  focusable: 'false' as const,
})

export function IconeAbaixo({ tamanho = 16, className }: Props) {
  return (
    <svg {...interface24(tamanho, className)}>
      <path d="M6 9 L12 15 L18 9" />
    </svg>
  )
}

export function IconeAdiante({ tamanho = 16, className }: Props) {
  return (
    <svg {...interface24(tamanho, className)}>
      <path d="M5 12 H19 M13 6 L19 12 L13 18" />
    </svg>
  )
}

export function IconeMenu({ tamanho = 20, className }: Props) {
  return (
    <svg {...interface24(tamanho, className)}>
      <path d="M4 7 H20 M4 12 H20 M4 17 H20" />
    </svg>
  )
}

export function IconeFechar({ tamanho = 20, className }: Props) {
  return (
    <svg {...interface24(tamanho, className)}>
      <path d="M6 6 L18 18 M18 6 L6 18" />
    </svg>
  )
}

export function IconeVisto({ tamanho = 16, className }: Props) {
  return (
    <svg {...interface24(tamanho, className)}>
      <path d="M5 12.5 L10 17.5 L19 7.5" />
    </svg>
  )
}

export function IconeMais({ tamanho = 16, className }: Props) {
  return (
    <svg {...interface24(tamanho, className)}>
      <path d="M12 5 V19 M5 12 H19" />
    </svg>
  )
}
