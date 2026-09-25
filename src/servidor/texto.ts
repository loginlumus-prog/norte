// O plural das frases que o SERVIDOR escreve — mensagem de erro, aviso do
// fechamento, texto do WhatsApp.
//
// "2 caixa(s) aberto(s)" é o programa dizendo que não quis fazer a conta, e
// a conta é uma linha. A regra mora em `ui/texto.ts`, que é pura e já serve
// às telas; aqui ela só ganha um endereço dentro de `servidor/`, para as
// regras de negócio não dependerem da pasta de tela.

export { duracao, palavra, plural, quantidade } from '../ui/texto'
