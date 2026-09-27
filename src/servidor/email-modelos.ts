// Os e-mails que o Norte manda, em português, HTML e texto.
//
// ── o desenho ────────────────────────────────────────────────
// Um cartão branco sobre cinza, o nome "Norte" em texto no alto (nada de
// imagem: metade dos clientes de e-mail bloqueia imagem por padrão, e a
// outra metade mostra a imagem quebrada no celular), um título, dois ou três
// parágrafos curtos, UM botão e, embaixo dele, o link escrito por extenso —
// para quem não consegue clicar, ou quer conferir para onde vai.
//
// Tudo em tabela e estilo na linha, porque é o que o Outlook entende. Cor
// fixa em tom claro: e-mail não tem como saber o tema de quem lê, e os
// clientes que escurecem sozinhos fazem isso melhor sobre um desenho claro
// simples.
//
// ── o rodapé ─────────────────────────────────────────────────
// Quem manda: a identidade de src/servidor/legal.ts (razão social, CNPJ e
// endereço quando existirem — a mesma fonte dos Termos, para não haver duas
// versões), o contato e o porquê de a pessoa estar recebendo aquilo.
//
// ── texto que vem de fora ────────────────────────────────────
// Nome da empresa e nome da pessoa foram DIGITADOS por alguém. No HTML tudo
// passa por `esc`; no assunto, quebra de linha vira espaço (email.ts). Um
// nome de loja com `<a href=...>` sai como texto, não como link.

import { EMPRESA } from './legal'
import type { Email } from './email'

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const COR = {
  fundo: '#f6f7f9',
  cartao: '#ffffff',
  borda: '#e4e7ec',
  titulo: '#0b1220',
  texto: '#374151',
  apagado: '#6b7280',
  marca: '#1f4fd8',
}

const FONTE = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** As linhas do rodapé, iguais no HTML e no texto. */
function rodape(): string[] {
  const quem = [EMPRESA.razaoSocial ?? 'Norte', EMPRESA.cnpj ? `CNPJ ${EMPRESA.cnpj}` : null]
    .filter(Boolean)
    .join(' · ')
  return [quem, EMPRESA.endereco, `Dúvidas: ${EMPRESA.email} · Privacidade: ${EMPRESA.encarregadoEmail}`].filter(
    (l): l is string => !!l,
  )
}

type Peca = {
  para: string
  assunto: string
  /** A linha que aparece na caixa de entrada, depois do assunto. */
  resumo: string
  titulo: string
  paragrafos: string[]
  botao?: { texto: string; link: string }
  /** Depois do botão: prazo, "se não foi você", o que acontece a seguir. */
  depois?: string[]
  /** Por que a pessoa está recebendo isto. Uma frase. */
  motivo: string
}

export function montar(p: Peca): Email {
  const par = (t: string) =>
    `<p style="margin:0 0 14px;font:15px/1.6 ${FONTE};color:${COR.texto};">${esc(t)}</p>`
  const pequeno = (t: string) =>
    `<p style="margin:0 0 8px;font:13px/1.55 ${FONTE};color:${COR.apagado};">${esc(t)}</p>`

  const botao = p.botao
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 18px;">
        <tr><td bgcolor="${COR.marca}" style="border-radius:10px;">
          <a href="${esc(p.botao.link)}" target="_blank" rel="noopener"
             style="display:inline-block;padding:13px 22px;font:600 15px/1 ${FONTE};color:#ffffff;text-decoration:none;border-radius:10px;">${esc(p.botao.texto)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 18px;font:12px/1.5 ${FONTE};color:${COR.apagado};word-break:break-all;">
        Se o botão não abrir, copie este endereço no navegador:<br>
        <a href="${esc(p.botao.link)}" style="color:${COR.marca};">${esc(p.botao.link)}</a>
      </p>`
    : ''

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(p.assunto)}</title>
</head>
<body style="margin:0;padding:0;background:${COR.fundo};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(p.resumo)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COR.fundo};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 16px;font:800 20px/1 ${FONTE};letter-spacing:-0.5px;color:${COR.titulo};">Norte</td></tr>
      <tr><td style="background:${COR.cartao};border:1px solid ${COR.borda};border-radius:14px;padding:32px 28px;">
        <h1 style="margin:0 0 16px;font:700 21px/1.3 ${FONTE};color:${COR.titulo};">${esc(p.titulo)}</h1>
        ${p.paragrafos.map(par).join('\n        ')}
        ${botao}
        ${(p.depois ?? []).map(pequeno).join('\n        ')}
      </td></tr>
      <tr><td style="padding:18px 4px 0;">
        ${pequeno(p.motivo)}
        ${rodape().map(pequeno).join('\n        ')}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

  const texto = [
    p.titulo,
    '',
    ...p.paragrafos.flatMap((t) => [t, '']),
    ...(p.botao ? [`${p.botao.texto}:`, p.botao.link, ''] : []),
    ...(p.depois ?? []).flatMap((t) => [t, '']),
    '—',
    p.motivo,
    ...rodape(),
  ].join('\n')

  return { para: p.para, assunto: p.assunto, html, texto }
}

// ─────────────────────────────────────────────────────────────
// OS E-MAILS
// ─────────────────────────────────────────────────────────────

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || nome.trim()

const hora = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(d)

export function emailRedefinirSenha(d: {
  para: string
  nome: string
  empresa: string
  link: string
  validadeMin: number
}): Email {
  return montar({
    para: d.para,
    assunto: `Redefinir a senha · ${d.empresa}`,
    resumo: `O link vale por ${d.validadeMin} minutos e serve uma vez.`,
    titulo: 'Redefinir a sua senha',
    paragrafos: [
      `Olá, ${primeiroNome(d.nome)}. Alguém pediu para redefinir a senha da sua conta em ${d.empresa}, no Norte.`,
      'Se foi você, é só escolher a senha nova:',
    ],
    botao: { texto: 'Escolher a senha nova', link: d.link },
    depois: [
      `O link vale por ${d.validadeMin} minutos e serve uma vez só. Pediu de novo? Vale só o último.`,
      'Não foi você? Pode ignorar este e-mail: a sua senha continua a mesma, e sem o link ninguém troca.',
    ],
    motivo: `Você recebeu este e-mail porque este endereço tem uma conta em ${d.empresa}, no Norte.`,
  })
}

export function emailSenhaAlterada(d: {
  para: string
  nome: string
  empresa: string
  quando: Date
  linkEntrar: string
}): Email {
  return montar({
    para: d.para,
    assunto: `A sua senha foi trocada · ${d.empresa}`,
    resumo: 'Todos os aparelhos saíram da conta. Não foi você? Avise quem administra a empresa.',
    titulo: 'A sua senha foi trocada',
    paragrafos: [
      `Olá, ${primeiroNome(d.nome)}. A senha da sua conta em ${d.empresa} foi trocada em ${hora(d.quando)} (horário de Brasília).`,
      'Por segurança, todos os aparelhos que estavam dentro da conta saíram. Para entrar de novo, use a senha nova.',
    ],
    botao: { texto: 'Entrar', link: d.linkEntrar },
    depois: [
      `Não foi você? Fale agora com quem administra ${d.empresa}: na tela Equipe, dá para tirar o acesso da conta ou gerar um link de senha nova. Se precisar, escreva para ${EMPRESA.email}.`,
    ],
    motivo: 'Este aviso é sempre enviado quando a senha de uma conta muda. Não dá para desligar.',
  })
}

export function emailConfirmarCadastro(d: {
  para: string
  nome: string
  empresa: string
  link: string
  validadeHoras: number
}): Email {
  return montar({
    para: d.para,
    assunto: `Confirme o seu e-mail · ${d.empresa}`,
    resumo: 'Um clique e a sua empresa está pronta para entrar.',
    titulo: 'Confirme o seu e-mail',
    paragrafos: [
      `Olá, ${primeiroNome(d.nome)}. A empresa ${d.empresa} acabou de ser criada no Norte com este e-mail.`,
      'Falta só confirmar que o endereço é seu. Depois disso, é entrar com a senha que você escolheu e terminar o cadastro inicial — leva dois minutos.',
    ],
    botao: { texto: 'Confirmar meu e-mail', link: d.link },
    depois: [
      `O link vale por ${d.validadeHoras} horas e serve uma vez só.`,
      'Não foi você? Ignore este e-mail. Sem a confirmação, ninguém entra nessa conta.',
    ],
    motivo: 'Você recebeu este e-mail porque alguém criou uma conta no Norte com este endereço.',
  })
}

export function emailConvite(d: {
  para: string
  empresa: string
  quemConvidou: string
  papel: string
  link: string
  validadeDias: number
}): Email {
  return montar({
    para: d.para,
    assunto: `${primeiroNome(d.quemConvidou)} convidou você para ${d.empresa}`,
    resumo: `O convite vale por ${d.validadeDias} dias e serve uma vez.`,
    titulo: `Você foi convidado para ${d.empresa}`,
    paragrafos: [
      `${d.quemConvidou} convidou você para a equipe de ${d.empresa} no Norte, o sistema da loja, com o papel ${d.papel}.`,
      'Para aceitar, abra o convite, diga o seu nome e escolha uma senha. A conta nasce ali, já com o acesso que te deram.',
    ],
    botao: { texto: 'Aceitar o convite', link: d.link },
    depois: [
      `O convite vale por ${d.validadeDias} dias e serve uma vez só.`,
      'Não conhece essa empresa? Pode ignorar este e-mail: sem abrir o convite, nenhuma conta é criada.',
    ],
    motivo: `Você recebeu este e-mail porque alguém de ${d.empresa} convidou este endereço.`,
  })
}
