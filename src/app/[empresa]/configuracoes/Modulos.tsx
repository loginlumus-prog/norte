'use client'

// Os módulos da empresa: o que liga e desliga, dentro do que o plano abre.
//
// ── o que o plano não abre aparece TRANCADO ──────────────────
// O servidor recusa ligar módulo fora do plano (`salvarModulos`). Se a tela
// oferecesse a caixa marcável, a pessoa marcava, salvava e levava um "não" —
// botão que falha ao clicar. Então o módulo de fora aparece como está: com
// cadeado, com o plano que abre, e com o caminho para os planos. Nunca some:
// saber que existe é metade do motivo de subir de plano.
//
// Módulo que ficou ligado de um plano anterior (a empresa desceu de plano)
// aparece trancado também, com o aviso de que salvar desliga — é o que o
// servidor faz, e a tela não pode prometer outra coisa.

import Link from 'next/link'
import { useActionState } from 'react'
import type { Plano } from '@prisma/client'
import { Botao, Marcar, Aviso } from '@/ui/base'
import { IconeCadeado } from '@/ui/Cadeado'
import { MODULOS, TODOS, type Modulo } from '@/servidor/modulos'
import { ORDEM, doPlano, planoLibera } from '@/servidor/planos'
import { salvarModulos, type EstadoComeco } from '../comecar/acoes'

/** O plano mais barato que abre o módulo, ou null se nenhum abre ainda. */
const primeiroQueAbre = (m: Modulo): Plano | null => ORDEM.find((p) => planoLibera(p, m)) ?? null

export function Modulos({
  empresa,
  ligados,
  grade,
  plano,
}: {
  empresa: string
  ligados: string[]
  /** O balcão vende tocando em botões (true) ou bipando a etiqueta (false)? */
  grade: boolean
  /** O plano de agora: decide o que é marcável e o que aparece trancado. */
  plano: Plano
}) {
  const [estado, agir, pendente] = useActionState<EstadoComeco, FormData>(salvarModulos, {})
  const abertos = TODOS.filter((m) => planoLibera(plano, m))
  const trancados = TODOS.filter((m) => !planoLibera(plano, m))

  return (
    <form action={agir} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      {abertos.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {abertos.map((m) => (
            <Marcar
              key={m}
              name={`modulo_${m}`}
              titulo={MODULOS[m].titulo}
              resumo={MODULOS[m].resumo}
              defaultChecked={ligados.includes(m)}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-tinta-2">
          O seu plano usa o essencial — vender, cadastrar, estoque e clientes — e não tem
          módulos para ligar. Os de baixo abrem nos planos pagos.
        </p>
      )}

      {trancados.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-tinta-3">Fora do seu plano</span>
          <ul className="grid gap-2 sm:grid-cols-2">
            {trancados.map((m) => {
              const abre = primeiroQueAbre(m)
              return (
                <li
                  key={m}
                  className="flex items-start gap-3 rounded-norte border border-dashed border-borda bg-superficie-2/60 p-3"
                >
                  <IconeCadeado className="mt-0.5 size-4 shrink-0 text-tinta-3" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-tinta-2">{MODULOS[m].titulo}</span>
                    <span className="text-xs text-tinta-3">{MODULOS[m].resumo}</span>
                    {ligados.includes(m) && (
                      <span className="text-xs font-medium text-atencao">
                        Ficou ligado de um plano anterior. Ao salvar, ele desliga — os dados ficam guardados.
                      </span>
                    )}
                    {abre ? (
                      <Link
                        href={`/${empresa}/assinatura`}
                        className="mt-1 w-fit text-xs font-semibold text-marca underline-offset-2 hover:underline"
                      >
                        {doPlano(abre)} para cima · ver os planos
                      </Link>
                    ) : (
                      <span className="mt-1 text-xs text-tinta-3">Ainda não está em nenhum plano.</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

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
