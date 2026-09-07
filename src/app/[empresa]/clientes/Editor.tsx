'use client'

// A ficha do cliente: cadastrar e editar usam a mesma tela.
//
// ── o que é obrigatório, e por quê ───────────────────────────
// Só o nome. CPF não, endereço não, nem telefone. No comércio de bairro
// quase ninguém pede CPF, e exigir campo para cadastrar faz a vendedora
// desistir e vender sem cliente — e aí não existe histórico, não existe
// "cliente sumido", e o assistente não tem a quem escrever.
//
// O telefone é o campo que MAIS importa mesmo não sendo obrigatório: é por
// ele que o assistente fala, é por ele que a cobrança sai, e é ele que
// impede a mesma pessoa de virar quatro cadastros.

import { useActionState } from 'react'
import Link from 'next/link'
import { Botao, Campo, Marcar, Aviso, Cartao } from '@/ui/base'
import { criar, editar, type EstadoCliente } from './acoes'

export type ClienteNaTela = {
  id: string
  nome: string
  telefone: string
  documento: string
  email: string
  nascimento: string
  endereco: string
  numero: string
  bairro: string
  cidade: string
  estado: string
  cep: string
  observacoes: string
  ativo: boolean
}

export function Editor({ slug, cliente }: { slug: string; cliente?: ClienteNaTela }) {
  const acao = cliente ? editar.bind(null, slug, cliente.id) : criar.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoCliente, FormData>(acao, {})

  return (
    <form action={agir} className="flex max-w-3xl flex-col gap-5">
      {estado.erro && (
        <Aviso nivel="critico">
          <span className="flex flex-wrap items-center gap-2">
            {estado.erro}
            {estado.jaExisteId && (
              <Link
                href={`/${slug}/clientes/${estado.jaExisteId}`}
                className="font-semibold underline underline-offset-2"
              >
                Abrir {estado.jaExisteNome}
              </Link>
            )}
          </span>
        </Aviso>
      )}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <Cartao titulo="Quem é">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" name="nome" required defaultValue={cliente?.nome ?? ''} placeholder="Maria da Silva" />
          <Campo
            rotulo="WhatsApp"
            name="telefone"
            inputMode="tel"
            defaultValue={cliente?.telefone ?? ''}
            placeholder="(71) 99999-0000"
            dica="É por aqui que o assistente fala e a cobrança sai."
          />
          <Campo
            rotulo="CPF"
            name="documento"
            inputMode="numeric"
            defaultValue={cliente?.documento ?? ''}
            placeholder="Opcional"
            dica="Só é obrigatório para nota fiscal e crediário."
          />
          <Campo rotulo="E-mail" name="email" type="email" defaultValue={cliente?.email ?? ''} placeholder="Opcional" />
          <Campo
            rotulo="Aniversário"
            name="nascimento"
            type="date"
            defaultValue={cliente?.nascimento ?? ''}
            dica="Serve para o assistente lembrar você de mandar um recado."
          />
        </div>
      </Cartao>

      <Cartao titulo="Onde mora">
        <p className="mb-3 text-sm text-tinta-2">
          Só precisa quando você entrega ou emite nota. Deixe em branco se não usa.
        </p>
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-4">
            <Campo rotulo="Rua" name="endereco" defaultValue={cliente?.endereco ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <Campo rotulo="Número" name="numero" defaultValue={cliente?.numero ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <Campo rotulo="Bairro" name="bairro" defaultValue={cliente?.bairro ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <Campo rotulo="Cidade" name="cidade" defaultValue={cliente?.cidade ?? ''} />
          </div>
          <div className="sm:col-span-1">
            <Campo rotulo="UF" name="estado" maxLength={2} defaultValue={cliente?.estado ?? ''} />
          </div>
          <div className="sm:col-span-1">
            <Campo rotulo="CEP" name="cep" inputMode="numeric" defaultValue={cliente?.cep ?? ''} />
          </div>
        </div>
      </Cartao>

      <Cartao titulo="Observações">
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Observações</span>
          <textarea
            name="observacoes"
            rows={3}
            defaultValue={cliente?.observacoes ?? ''}
            placeholder="Prefere ser avisada de manhã. Usa 38. Sempre leva conjunto."
            className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
          />
          <span className="text-xs text-tinta-3">
            O que a equipe precisa lembrar. O assistente também lê isto.
          </span>
        </label>
      </Cartao>

      {cliente && (
        <Cartao titulo="Situação">
          <Marcar
            name="ativo"
            defaultChecked={cliente.ativo}
            titulo="Cliente ativo"
            resumo="Desmarcado, some da busca do balcão — e continua no histórico de tudo que já comprou."
          />
        </Cartao>
      )}

      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/${slug}/clientes`}
          className="text-sm font-medium text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
        >
          Voltar
        </Link>
        <Botao type="submit" tom="confirmar" carregando={pendente}>
          {pendente ? 'Salvando...' : cliente ? 'Salvar' : 'Cadastrar'}
        </Botao>
      </div>
    </form>
  )
}
