'use client'

// Cadastrar um fornecedor: nome e, se a loja quiser, telefone e CNPJ/CPF.

import { useActionState, useEffect, useRef, useState } from 'react'
import { Aviso, Botao, Campo, Cartao } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { classeDaAcao, DicaDaAcao, IconeDaAcao } from '@/ui/premium'
import { salvarFornecedorAcao, type EstadoFornecedor } from './acoes'

export function NovoFornecedor({ slug }: { slug: string }) {
  const [aberto, setAberto] = useState(false)
  const acao = salvarFornecedorAcao.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoFornecedor, FormData>(acao, {})
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset()
      setAberto(false)
    }
  }, [estado.vez, estado.ok])

  if (!aberto) {
    return (
      <span className="flex flex-wrap items-center gap-3">
        <Botao tom="secundario" onClick={() => setAberto(true)}>
          + Fornecedor
        </Botao>
        {estado.ok && <span className="text-sm font-medium text-bom">{estado.ok}</span>}
      </span>
    )
  }
  return (
    <Cartao
      caixa
      titulo="Novo fornecedor"
      acao={
        <button type="button" onClick={() => setAberto(false)} className={classeDaAcao()} aria-label="Fechar o fornecedor novo">
          <IconeDaAcao icone="fechar" />
          <DicaDaAcao>Fechar</DicaDaAcao>
        </button>
      }
    >
      <form ref={formRef} action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-4">
        {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Nome" name="nome" required placeholder="Distribuidora de cosméticos" />
          <Campo rotulo="Telefone" name="telefone" type="tel" inputMode="tel" placeholder="(71) 3333-0000" />
          <Campo rotulo="CNPJ ou CPF" name="documento" inputMode="numeric" dica="Opcional." />
        </div>
        <Campo rotulo="Observação" name="observacao" placeholder="Pedido mínimo, dia de entrega" />
        <div className="flex justify-end">
          <Botao type="submit" carregando={pendente}>
            {pendente ? 'Salvando...' : 'Salvar fornecedor'}
          </Botao>
        </div>
      </form>
    </Cartao>
  )
}
