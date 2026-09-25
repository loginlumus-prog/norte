'use client'

// "Anonimizar este cliente" — o pedido do titular (LGPD art. 18), atendido
// pela loja.
//
// Irreversível, então tem duas travas antes do botão vermelho: a janela que
// diz, em lista, o que some e o que fica — e a palavra ANONIMIZAR digitada.
// Clique acidental não apaga conversa de ninguém. O servidor confere a
// palavra e a permissão de novo (ver src/servidor/anonimizar.ts).

import { useActionState, useRef, useState } from 'react'
import { Aviso, Botao, Campo } from '@/ui/base'
import { anonimizar, type EstadoAnonimizar } from '../acoes'

export function Anonimizar({ slug, clienteId, palavra }: { slug: string; clienteId: string; palavra: string }) {
  const janela = useRef<HTMLDialogElement>(null)
  const [digitado, setDigitado] = useState('')
  const [estado, agir, pendente] = useActionState<EstadoAnonimizar, FormData>(anonimizar.bind(null, slug, clienteId), {})

  return (
    <>
      <Botao type="button" tom="secundario" onClick={() => janela.current?.showModal()}>
        Anonimizar este cliente
      </Botao>

      <dialog
        ref={janela}
        aria-labelledby="anonimizar-titulo"
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-norte border border-borda bg-superficie p-0 text-tinta shadow-xl backdrop:bg-black/50"
      >
        <form action={agir} className="flex flex-col gap-4 p-5">
          <h2 id="anonimizar-titulo" className="text-base font-bold">
            Anonimizar este cliente?
          </h2>
          <div className="flex flex-col gap-2 text-sm text-tinta-2">
            <p>
              Use quando a própria pessoa pedir para ter os dados apagados. <b className="text-tinta">Não tem volta.</b>
            </p>
            <p className="font-semibold text-tinta">Some:</p>
            <ul className="list-disc pl-5">
              <li>nome, WhatsApp, e-mail, CPF, endereço, aniversário e observações da ficha;</li>
              <li>as conversas do WhatsApp com esse número e o que ele respondeu nas campanhas;</li>
              <li>o nome e o telefone nas encomendas dela, e o nome no livro de auditoria.</li>
            </ul>
            <p className="font-semibold text-tinta">Fica, sem nome:</p>
            <ul className="list-disc pl-5">
              <li>as vendas, parcelas, vales e pontos — a lei manda guardar o registro fiscal;</li>
              <li>o número, na lista de quem não recebe ofertas, para ninguém mandar mensagem de novo.</li>
            </ul>
          </div>

          {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

          <Campo
            rotulo={`Para confirmar, digite ${palavra}`}
            name="confirmacao"
            autoComplete="off"
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
          />

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Botao type="button" tom="discreto" onClick={() => janela.current?.close()}>
              Cancelar
            </Botao>
            <Botao
              type="submit"
              tom="perigo"
              carregando={pendente}
              disabled={digitado.trim().toUpperCase() !== palavra}
            >
              {pendente ? 'Anonimizando...' : 'Anonimizar de vez'}
            </Botao>
          </div>
        </form>
      </dialog>
    </>
  )
}
