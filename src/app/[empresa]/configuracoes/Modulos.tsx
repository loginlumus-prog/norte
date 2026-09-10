'use client'

import { useActionState } from 'react'
import { Botao, Marcar, Aviso } from '@/ui/base'
import { MODULOS, TODOS } from '@/servidor/modulos'
import { salvarModulos, type EstadoComeco } from '../comecar/acoes'

export function Modulos({
  empresa,
  ligados,
  grade,
}: {
  empresa: string
  ligados: string[]
  /** O balcão vende tocando em botões (true) ou bipando a etiqueta (false)? */
  grade: boolean
}) {
  const [estado, agir, pendente] = useActionState<EstadoComeco, FormData>(salvarModulos, {})

  return (
    <form action={agir} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <div className="grid gap-2 sm:grid-cols-2">
        {TODOS.map((m) => (
          <Marcar
            key={m}
            name={`modulo_${m}`}
            titulo={MODULOS[m].titulo}
            resumo={MODULOS[m].resumo}
            defaultChecked={ligados.includes(m)}
          />
        ))}
      </div>

      {/* Não é módulo — é o JEITO de vender, e por isso fica separado da
          grade de módulos. O ramo escolheu o padrão no cadastro; aqui o dono
          desdiz. Uma loja de roupa com uma vitrine de acessórios pode querer
          os botões; uma sorveteria que etiquetou tudo pode preferir bipar. */}
      <div className="border-t border-borda-suave pt-4">
        <Marcar
          name="balcaoGrade"
          titulo="Vender tocando em botões"
          resumo="O balcão mostra os produtos por categoria, para tocar em vez de digitar. É o jeito de quem não etiqueta: sorveteria, lanchonete, floricultura. Desligado, o balcão é só a busca — bipa a etiqueta e pronto."
          defaultChecked={grade}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-tinta-3">
          Desligar não apaga nada: os dados continuam guardados, só somem da tela.
        </p>
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  )
}
