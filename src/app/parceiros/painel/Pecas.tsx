'use client'

import { useActionState, useState } from 'react'
import { Botao, Aviso, cx } from '@/ui/base'
import { salvarPagamentoAcao, type Estado } from '../acoes'
import { CAMPO, ROTULO } from '../Formularios'

/** Um texto para copiar: o link, a mensagem pronta. */
export function Copiar({ texto, rotulo = 'Copiar', copiado = 'Copiado' }: { texto: string; rotulo?: string; copiado?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <Botao
      type="button"
      tom="secundario"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto)
          setOk(true)
          setTimeout(() => setOk(false), 2000)
        } catch {
          // sem permissão de copiar: o texto está à vista para selecionar
        }
      }}
    >
      {ok ? copiado : rotulo}
    </Botao>
  )
}

const TIPOS = [
  ['cpf', 'CPF'],
  ['cnpj', 'CNPJ'],
  ['email', 'E-mail'],
  ['telefone', 'Telefone'],
  ['aleatoria', 'Chave aleatória'],
] as const

export function FormPagamento({
  inicial,
}: {
  inicial: { pixTipo: string; pixChave: string; documento: string; telefone: string }
}) {
  const [estado, agir, pendente] = useActionState<Estado, FormData>(salvarPagamentoAcao, {})
  const v = estado.valores ?? inicial
  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}
      <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="pg-tipo" className={ROTULO}>
            Tipo da chave Pix
          </label>
          <select id="pg-tipo" name="pixTipo" required defaultValue={v.pixTipo || ''} className={cx(CAMPO, 'pr-8')}>
            <option value="" disabled>
              Escolha…
            </option>
            {TIPOS.map(([valor, nome]) => (
              <option key={valor} value={valor}>
                {nome}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="pg-chave" className={ROTULO}>
            Chave Pix
          </label>
          <input id="pg-chave" name="pixChave" required maxLength={80} autoComplete="off" defaultValue={v.pixChave} className={CAMPO} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="pg-doc" className={ROTULO}>
            CPF ou CNPJ de quem recebe
          </label>
          <input id="pg-doc" name="documento" required inputMode="numeric" maxLength={20} autoComplete="off" defaultValue={v.documento} className={CAMPO} />
          <p className="text-xs text-tinta-3">Vai no recibo do repasse. Tem MEI? Use o CNPJ.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="pg-tel" className={ROTULO}>
            WhatsApp
          </label>
          <input id="pg-tel" name="telefone" type="tel" inputMode="tel" maxLength={20} defaultValue={v.telefone} className={CAMPO} />
        </div>
      </div>
      <Botao type="submit" carregando={pendente} className="h-11 self-start rounded-xl px-5">
        Salvar dados de pagamento
      </Botao>
    </form>
  )
}
