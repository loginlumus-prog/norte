// O suporte do Norte atendendo um pedido de titular que chegou por e-mail
// (a página /exclusao-de-dados manda escrever para nós).
//
//   npm run anonimizar -- --empresa padaria-do-ze --telefone "(71) 99999-0000" \
//                         --protocolo LGPD-2026-0042 --atendente "Nome de quem atendeu"
//
//   ... --cpf 12345678909          (em vez de, ou junto com, o telefone)
//   ... --confirmar                (sem isto, só CONTA as fichas; não apaga nada)
//   ... --producao                 (lê .env.producao em vez do .env)
//
// ── o que ele faz ────────────────────────────────────────────
// Exatamente o que o botão "Anonimizar este cliente" faz na ficha — as duas
// portas chamam `anonimizarPorPedidoAoSuporte` / `anonimizarNaEmpresa`
// (src/servidor/anonimizar.ts). A diferença é quem assina no livro de
// auditoria da loja: "Suporte do Norte (<atendente>)", com o protocolo.
//
// ── por que a credencial da APLICAÇÃO, e não a de admin ──────
// Tudo roda dentro de `comoOrg` da empresa do endereço: o RLS garante que o
// script só enxerga e só apaga a ficha daquela loja, igual à tela. A empresa
// é descoberta pela portaria (a mesma do login), que só lê a fachada.
//
// ── o que ele NUNCA imprime ──────────────────────────────────
// Credencial, nome, telefone ou CPF. Só quantas fichas, e quanto foi apagado,
// em números. O protocolo tem forma fixa (LGPD-<ano>-<número>) porque vai
// para o livro, e o livro não se apaga.

import { carregarAmbiente } from './ambiente'

carregarAmbiente()

const { acharOrgPorSlug, fechar } = await import('../src/servidor/banco')
const { anonimizarPorPedidoAoSuporte, fichasDoPedido, protocoloValido } = await import('../src/servidor/anonimizar')

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

const slug = argumento('empresa')
const telefone = argumento('telefone')
const documento = argumento('cpf')
const protocolo = argumento('protocolo') ?? ''
const atendente = argumento('atendente') ?? ''
const confirmar = process.argv.includes('--confirmar')

function parar(texto: string): never {
  console.error(`\n  ${texto}\n`)
  process.exit(1)
}

if (!slug) parar('Falta --empresa <endereço da loja>.')
if (!telefone && !documento) parar('Falta --telefone ou --cpf (o que o titular informou no e-mail).')
if (!protocoloValido(protocolo)) parar('Falta --protocolo no formato LGPD-<ano>-<número> (ex.: LGPD-2026-0042).')
if (!atendente.trim()) parar('Falta --atendente (quem do suporte atendeu).')

try {
  const org = await acharOrgPorSlug(slug)
  if (!org) parar('Não existe empresa com esse endereço.')

  const fichas = await fichasDoPedido(org.id, { telefone, documento })
  console.log(`\n  ${org.nome}: ${fichas.length} ficha(s) batem com o que o titular informou.`)
  if (fichas.length === 0) parar('Nada a fazer. Responda ao titular que a loja não tem cadastro com esses dados.')

  if (!confirmar) {
    console.log('  Nada foi apagado. Confira e rode de novo com --confirmar.\n')
  } else {
    const r = await anonimizarPorPedidoAoSuporte(org.id, { telefone, documento }, { atendente, protocolo })
    if (!r.ok) parar(r.erro)
    for (const a of r.apagado) {
      console.log(
        `  anonimizada: ${a.conversas} conversa(s), ${a.mensagens} mensagem(ns), ${a.execucoes} campanha(s), ` +
          `${a.encomendas} encomenda(s), ${a.lancamentos} lançamento(s), ${a.linhasDoLivro} linha(s) do livro limpas` +
          (a.foraDasOfertas ? '; número na lista de quem não recebe ofertas' : ''),
      )
    }
    console.log(`  Registrado no livro de auditoria da loja com o protocolo ${protocolo}.\n`)
  }
} finally {
  await fechar()
}
