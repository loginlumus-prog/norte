// A cara da vitrine: os temas prontos, os temas de data e qual vale agora.
//
// Sem I/O — é conta e tabela, e roda no servidor e no aparelho (o painel
// mostra a prévia com as mesmas cores que a cliente vai ver).
//
// ── a ordem de quem manda ────────────────────────────────────
//   1. o tema de data ligado pela loja (Natal, São João...), enquanto valer
//   2. a cor escolhida à mão
//   3. o tema pronto
//   4. a cor da marca, do cadastro da empresa
//
// ── as datas ─────────────────────────────────────────────────
// Cada data tem uma janela por ano. A loja vê a sugestão uma semana antes e
// durante a janela; ligada, ela sai sozinha no último dia (`especialAte`). A
// Páscoa e o Carnaval mudam de dia todo ano: saem da conta da Páscoa
// (algoritmo de Meeus/Jones/Butcher, o calendário gregoriano).

export type Arte = 'confete' | 'ovos' | 'coracoes' | 'bandeirinhas' | 'baloes' | 'morcegos' | 'etiquetas' | 'neve' | 'estrelas'

export type TemaPronto = { chave: string; nome: string; cor: string }

/** Os temas prontos. A cor é o que muda: botões, destaques, o brilho do topo. */
export const TEMAS: readonly TemaPronto[] = [
  { chave: 'morango', nome: 'Morango', cor: '#d93d72' },
  { chave: 'menta', nome: 'Menta', cor: '#0f9b77' },
  { chave: 'acai', nome: 'Açaí', cor: '#6b2c91' },
  { chave: 'caramelo', nome: 'Caramelo', cor: '#b8650f' },
  { chave: 'oceano', nome: 'Oceano', cor: '#1765c9' },
  { chave: 'limao', nome: 'Limão', cor: '#4f8a12' },
  { chave: 'chocolate', nome: 'Chocolate', cor: '#6a3b24' },
  { chave: 'noite', nome: 'Noite', cor: '#2c2f7a' },
]

export type DataEspecial = {
  chave: string
  nome: string
  cor: string
  arte: Arte
  /** O recado que aparece no topo enquanto o tema estiver ligado. */
  saudacao: string
  /** A janela no ano (dias 'AAAA-MM-DD', os dois inclusos). */
  janela: (ano: number) => { de: string; ate: string }
}

const d = (ano: number, mes: number, dia: number) => `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

/** O domingo de Páscoa do ano, como 'AAAA-MM-DD'. */
export function pascoa(ano: number): string {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const dd = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - dd - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return d(ano, mes, dia)
}

/** Soma dias a um 'AAAA-MM-DD' (conta em UTC, sem fuso: é dia de calendário). */
export function somar(dia: string, n: number): string {
  const t = new Date(`${dia}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** O segundo domingo de maio (Dia das Mães no Brasil). */
function segundoDomingoDeMaio(ano: number): string {
  const primeiro = new Date(Date.UTC(ano, 4, 1, 12))
  const ate = (7 - primeiro.getUTCDay()) % 7
  return d(ano, 5, 1 + ate + 7)
}

export const DATAS: readonly DataEspecial[] = [
  {
    chave: 'carnaval', nome: 'Carnaval', cor: '#d6337f', arte: 'confete', saudacao: 'É Carnaval! Peça o seu e caia na folia.',
    // Terça de Carnaval = Páscoa − 47. A festa: da sexta antes até a quarta de cinzas.
    janela: (ano) => { const terca = somar(pascoa(ano), -47); return { de: somar(terca, -4), ate: somar(terca, 1) } },
  },
  {
    chave: 'pascoa', nome: 'Páscoa', cor: '#8a5cc7', arte: 'ovos', saudacao: 'Feliz Páscoa! Tem doçura especial esperando por você.',
    janela: (ano) => { const p = pascoa(ano); return { de: somar(p, -10), ate: p } },
  },
  {
    chave: 'maes', nome: 'Dia das Mães', cor: '#d9487d', arte: 'coracoes', saudacao: 'Para a mãe mais especial: peça e surpreenda.',
    janela: (ano) => { const dia = segundoDomingoDeMaio(ano); return { de: somar(dia, -9), ate: dia } },
  },
  {
    chave: 'namorados', nome: 'Dia dos Namorados', cor: '#c92a5c', arte: 'coracoes', saudacao: 'Dia dos Namorados: um mimo para dividir a dois.',
    janela: (ano) => ({ de: d(ano, 6, 1), ate: d(ano, 6, 12) }),
  },
  {
    chave: 'saojoao', nome: 'São João', cor: '#d9661a', arte: 'bandeirinhas', saudacao: 'Arraiá chegou! Aproveite o São João com a gente.',
    janela: (ano) => ({ de: d(ano, 6, 1), ate: d(ano, 7, 2) }),
  },
  {
    chave: 'criancas', nome: 'Dia das Crianças', cor: '#1f8fd1', arte: 'baloes', saudacao: 'Dia das Crianças! Tem alegria para os pequenos.',
    janela: (ano) => ({ de: d(ano, 10, 1), ate: d(ano, 10, 12) }),
  },
  {
    chave: 'halloween', nome: 'Halloween', cor: '#e06a0e', arte: 'morcegos', saudacao: 'Doces ou travessuras? Venha assustar a fome!',
    janela: (ano) => ({ de: d(ano, 10, 15), ate: d(ano, 10, 31) }),
  },
  {
    chave: 'blackfriday', nome: 'Black Friday', cor: '#26262e', arte: 'etiquetas', saudacao: 'Black Friday: aproveite enquanto durar.',
    janela: (ano) => ({ de: d(ano, 11, 15), ate: d(ano, 11, 30) }),
  },
  {
    chave: 'natal', nome: 'Natal', cor: '#c42b2b', arte: 'neve', saudacao: 'Feliz Natal! Encomende o seu para a ceia.',
    janela: (ano) => ({ de: d(ano, 12, 1), ate: d(ano, 12, 25) }),
  },
  {
    chave: 'anonovo', nome: 'Ano Novo', cor: '#b38a12', arte: 'estrelas', saudacao: 'Feliz Ano Novo! Comece o ano com sabor.',
    // Atravessa o ano: de 26/12 a 02/01 do ano seguinte.
    janela: (ano) => ({ de: d(ano, 12, 26), ate: d(ano + 1, 1, 2) }),
  },
]

const HEX = /^#[0-9a-f]{6}$/i
export const corValida = (cor: string | null | undefined): string | null => (cor && HEX.test(cor) ? cor.toLowerCase() : null)

export const temaPronto = (chave: string | null | undefined) => TEMAS.find((t) => t.chave === chave) ?? null
export const dataEspecial = (chave: string | null | undefined) => DATAS.find((x) => x.chave === chave) ?? null

/** A janela desta data que contém `hoje`, ou a próxima (a do ano de `hoje` ou a do anterior, para a que atravessa o ano). */
function janelaPerto(x: DataEspecial, hoje: string): { de: string; ate: string } {
  const ano = Number(hoje.slice(0, 4))
  const anterior = x.janela(ano - 1)
  if (hoje <= anterior.ate) return anterior
  return x.janela(ano)
}

/** Quanto antes da data a sugestão aparece. */
export const DIAS_DE_AVISO = 7

/**
 * As datas que o painel sugere hoje: de uma semana antes até o último dia.
 * `ate` é o último dia em que o tema fica ligado.
 */
export function datasParaSugerir(hoje: string): { data: DataEspecial; de: string; ate: string; jaComecou: boolean }[] {
  return DATAS.map((x) => ({ data: x, ...janelaPerto(x, hoje) }))
    .filter((j) => hoje >= somar(j.de, -DIAS_DE_AVISO) && hoje <= j.ate)
    .map((j) => ({ ...j, jaComecou: hoje >= j.de }))
}

/** Até quando o tema desta data fica ligado, se a loja ligar hoje. Nulo = fora da época. */
export function fimDaData(chave: string, hoje: string): string | null {
  const x = dataEspecial(chave)
  if (!x) return null
  const j = datasParaSugerir(hoje).find((s) => s.data.chave === chave)
  return j ? j.ate : null
}

export type TemaNaTela = {
  /** A cor que pinta a vitrine (#rrggbb), ou nulo para a do sistema. */
  cor: string | null
  /** O tema de data ligado agora, com o desenho e o recado. */
  especial: { chave: string; nome: string; arte: Arte; saudacao: string } | null
}

/**
 * O tema que vale agora. `agora` vem de fora para o teste (e para o painel
 * mostrar a prévia de amanhã, se precisar).
 */
export function temaDaVitrine(
  c: { tema: string | null; corTema: string | null; especial: string | null; especialAte: Date | null },
  corMarca: string | null,
  agora: Date = new Date(),
): TemaNaTela {
  const esp = c.especial && c.especialAte && c.especialAte.getTime() > agora.getTime() ? dataEspecial(c.especial) : null
  if (esp) return { cor: esp.cor, especial: { chave: esp.chave, nome: esp.nome, arte: esp.arte, saudacao: esp.saudacao } }
  return { cor: corValida(c.corTema) ?? temaPronto(c.tema)?.cor ?? corValida(corMarca), especial: null }
}
