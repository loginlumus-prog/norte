'use client'

// Enviar formulário sem apagar o que a pessoa digitou.
//
// Com `<form action={agir}>`, o React 19 LIMPA o formulário toda vez que a
// ação termina — inclusive quando ela volta com erro. Medido na tela de Novo
// cliente: nome, CPF, cidade e observação preenchidos, CPF com um dígito
// errado, "Cadastrar" → aparece "Esse CPF não confere" e os quatro campos
// voltam VAZIOS. A pessoa corrige um dígito redigitando a ficha inteira — e
// no produto, com grade e preço, isso é um minuto de trabalho jogado fora.
//
// Uso: `<form action={agir} onSubmit={semApagar(agir)}>` — os DOIS.
//
//   • Com a página já viva (hidratada), o `onSubmit` chega primeiro, segura o
//     envio e chama a mesma ação (mesmo `useActionState`, mesmo `pendente`)
//     sem a limpeza automática. O React vê o envio segurado e não roda a
//     ação de novo.
//   • Antes de hidratar (tablet lento, dedo rápido), quem vale é o `action`:
//     o navegador posta para a Server Action como formulário comum. SEM ele,
//     o envio caía no padrão do HTML — GET para o próprio endereço, com
//     nome, CPF e observação na barra de endereço e no histórico. Visto na
//     tela de Novo cliente antes de pôr o `action` de volta.
//
// O formulário que PRECISA limpar depois do sucesso (lançar outra conta em
// seguida) faz isso explicitamente, olhando o `ok` da resposta.

import { startTransition, type FormEvent } from 'react'

export function semApagar(agir: (dados: FormData) => void) {
  return (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault()
    const form = ev.currentTarget
    // O botão clicado vai junto (name/value), como no envio normal. Navegador
    // antigo não aceita o segundo argumento: aí ele entra à mão.
    const botao = (ev.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | HTMLInputElement | null
    let dados: FormData
    try {
      dados = new FormData(form, botao ?? undefined)
    } catch {
      dados = new FormData(form)
      if (botao?.name) dados.append(botao.name, botao.value)
    }
    startTransition(() => agir(dados))
  }
}
