'use client'

// Uma loja: o cartão fechado e o formulário aberto, a mesma peça para abrir
// loja nova e para editar uma que existe.
//
// O RAMO é a primeira pergunta depois do nome, e não enfeite: é ele que diz
// com que categorias a loja nasce e se o balcão vende por botões ou por
// etiqueta. A empresa de roupa que abre uma sorveteria escolhe "Sorveteria"
// aqui e encontra Picolé, Massa e Açaí prontos.

import { useActionState, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Marcar, Selecao, Situacao, cx } from '@/ui/base'
import { criarLojaAcao, editarLojaAcao, situacaoLojaAcao, type EstadoLoja } from './acoes'

export type LojaNaTela = {
  id: string
  nome: string
  apelido: string | null
  documento: string | null
  ramo: string | null
  ramoTitulo: string | null
  ehDeposito: boolean
  ativa: boolean
  telefone: string | null
  endereco: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
  cep: string | null
  horario: string | null
  exclusivos: number
  caixaAberto: boolean
}

type Opcao = { valor: string; titulo: string }

function Formulario({
  slug,
  loja,
  ramos,
  ramoDaEmpresa,
  aoTerminar,
}: {
  slug: string
  loja?: LojaNaTela
  ramos: Opcao[]
  ramoDaEmpresa: string | null
  aoTerminar?: () => void
}) {
  const acao = loja ? editarLojaAcao.bind(null, slug, loja.id) : criarLojaAcao.bind(null, slug)
  const [estado, agir, indo] = useActionState<EstadoLoja, FormData>(acao, {})
  const d = loja

  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome da loja"
          name="nome"
          required
          defaultValue={d?.nome ?? ''}
          placeholder="Loja Centro, Sorveteria da Praça…"
          id={`nome-${d?.id ?? 'nova'}`}
        />
        <Selecao
          rotulo="Ramo desta loja"
          name="ramo"
          id={`ramo-${d?.id ?? 'nova'}`}
          defaultValue={d?.ramo ?? ramoDaEmpresa ?? ''}
          opcoes={[{ valor: '', titulo: 'O mesmo da empresa' }, ...ramos]}
          dica="Decide com que categorias ela nasce e como o balcão vende."
        />
      </div>

      <Marcar
        name="ehDeposito"
        id={`dep-${d?.id ?? 'nova'}`}
        titulo="É um depósito"
        resumo="Guarda estoque e recebe mercadoria, mas não tem balcão de venda."
        defaultChecked={d?.ehDeposito ?? false}
      />

      <details className="group rounded-norte border border-borda-suave px-3 py-2" open={!!d}>
        <summary className="cursor-pointer text-sm font-semibold text-tinta">
          Endereço, contato e horário
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Nome no comprovante" name="apelido" id={`ap-${d?.id ?? 'nova'}`} defaultValue={d?.apelido ?? ''} />
            <Campo rotulo="CNPJ desta loja" name="documento" id={`doc-${d?.id ?? 'nova'}`} inputMode="numeric" defaultValue={d?.documento ?? ''} />
            <Campo rotulo="Telefone" name="telefone" id={`tel-${d?.id ?? 'nova'}`} type="tel" defaultValue={d?.telefone ?? ''} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_6rem_1fr]">
            <Campo rotulo="Endereço" name="endereco" id={`end-${d?.id ?? 'nova'}`} defaultValue={d?.endereco ?? ''} />
            <Campo rotulo="Número" name="numero" id={`num-${d?.id ?? 'nova'}`} defaultValue={d?.numero ?? ''} />
            <Campo rotulo="Complemento" name="complemento" id={`comp-${d?.id ?? 'nova'}`} defaultValue={d?.complemento ?? ''} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_5rem_8rem]">
            <Campo rotulo="Bairro" name="bairro" id={`bai-${d?.id ?? 'nova'}`} defaultValue={d?.bairro ?? ''} />
            <Campo rotulo="Cidade" name="cidade" id={`cid-${d?.id ?? 'nova'}`} defaultValue={d?.cidade ?? ''} />
            <Campo rotulo="UF" name="estado" id={`uf-${d?.id ?? 'nova'}`} maxLength={2} defaultValue={d?.estado ?? ''} />
            <Campo rotulo="CEP" name="cep" id={`cep-${d?.id ?? 'nova'}`} inputMode="numeric" defaultValue={d?.cep ?? ''} />
          </div>
          <Campo
            rotulo="Horário de funcionamento"
            name="horario"
            id={`hor-${d?.id ?? 'nova'}`}
            placeholder="Seg a sex 9h-18h, sáb 9h-13h"
            dica="O assistente responde com isto quando perguntarem."
            defaultValue={d?.horario ?? ''}
          />
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {aoTerminar && (
          <Botao type="button" tom="discreto" onClick={aoTerminar}>
            Fechar
          </Botao>
        )}
        <Botao type="submit" carregando={indo}>
          {d ? 'Salvar' : 'Abrir a loja'}
        </Botao>
      </div>
    </form>
  )
}

export function NovaLoja({
  slug,
  ramos,
  ramoDaEmpresa,
}: {
  slug: string
  ramos: Opcao[]
  ramoDaEmpresa: string | null
}) {
  return <Formulario slug={slug} ramos={ramos} ramoDaEmpresa={ramoDaEmpresa} />
}

export function CartaoLoja({
  slug,
  loja,
  ramos,
  ramoDaEmpresa,
}: {
  slug: string
  loja: LojaNaTela
  ramos: Opcao[]
  ramoDaEmpresa: string | null
}) {
  const [aberta, setAberta] = useState(false)
  const [recado, setRecado] = useState<EstadoLoja | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const endereco = [
    [loja.endereco, loja.numero].filter(Boolean).join(', '),
    loja.bairro,
    [loja.cidade, loja.estado].filter(Boolean).join(' / '),
  ]
    .filter(Boolean)
    .join(' · ')

  function trocar(ativa: boolean) {
    comecar(async () => {
      const r = await situacaoLojaAcao(slug, loja.id, ativa)
      setRecado(r)
      if (r.ok) router.refresh()
    })
  }

  return (
    <section
      className={cx(
        'flex flex-col gap-4 rounded-xl border bg-superficie p-5',
        loja.ativa ? 'border-borda shadow-norte' : 'border-dashed border-borda opacity-80',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-lg font-bold tracking-tight">{loja.nome}</h3>
          <p className="text-sm text-tinta-2">
            {loja.ehDeposito ? 'Depósito' : (loja.ramoTitulo ?? 'Mesmo ramo da empresa')}
            {loja.horario ? ` · ${loja.horario}` : ''}
          </p>
          {endereco && <p className="text-xs text-tinta-3">{endereco}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!loja.ativa && <Situacao nivel="neutro">fechada</Situacao>}
          {loja.caixaAberto && <Situacao nivel="bom">caixa aberto</Situacao>}
          {loja.exclusivos > 0 && (
            <Situacao nivel="neutro">
              {loja.exclusivos} produto{loja.exclusivos === 1 ? '' : 's'} só dela
            </Situacao>
          )}
        </div>
      </header>

      {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
      {recado?.ok && <Aviso nivel="bom">{recado.ok}</Aviso>}

      {aberta ? (
        <Formulario
          slug={slug}
          loja={loja}
          ramos={ramos}
          ramoDaEmpresa={ramoDaEmpresa}
          aoTerminar={() => setAberta(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Botao tom="secundario" onClick={() => setAberta(true)}>
            Editar
          </Botao>
          {loja.ativa ? (
            <Botao tom="discreto" carregando={indo} onClick={() => trocar(false)}>
              Fechar a loja
            </Botao>
          ) : (
            <Botao tom="secundario" carregando={indo} onClick={() => trocar(true)}>
              Reabrir
            </Botao>
          )}
        </div>
      )}
    </section>
  )
}
