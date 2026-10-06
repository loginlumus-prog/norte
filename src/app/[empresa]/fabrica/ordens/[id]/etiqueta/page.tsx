import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { moduloLigado } from '@/servidor/modulos'
import { acharOrdem } from '@/servidor/fabrica'
import { quantidade } from '@/ui/texto'
import { diaBR } from '../../../formato'
import { EtiquetaDoLote } from './EtiquetaDoLote'

export const metadata: Metadata = { title: 'Etiquetas do lote' }

// As etiquetas de um lote produzido, para a caixa que sai da fábrica.
//
// Sem a moldura do sistema, como as etiquetas de produto: isto é papel. Quantas
// vem do endereço (?n=), para o link da produção já trazer a conta pronta;
// a tela deixa trocar antes de imprimir.

export default async function EtiquetaDoLotePagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; id: string }>
  searchParams: Promise<{ n?: string | string[] }>
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const { empresa: slug, id } = await params
  const q = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'fabrica.ver' })
  if (!moduloLigado(empresa, 'fabrica')) semAcesso(slug, 'modulo-fabrica')
  if (!/^[\w-]{1,64}$/.test(id)) notFound()
  const ordem = await acharOrdem(sessao, id)
  if (!ordem) notFound()

  const n = typeof q.n === 'string' && /^\d{1,3}$/.test(q.n) ? Number(q.n) : 1

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-norte border border-borda bg-superficie p-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-bold tracking-tight text-tinta">
            Etiquetas do lote <span className="font-mono">{ordem.lote}</span>
          </h1>
          <p className="text-xs text-tinta-2">
            OP {ordem.numero} · {ordem.produto} · {quantidade(ordem.quantidade, ordem.medida)} · {ordem.unidade}
          </p>
        </div>
        <Link href={`/${slug}/fabrica`} className="text-sm text-tinta-2 hover:text-tinta">
          ← voltar para a Fábrica
        </Link>
      </div>

      {ordem.situacao !== 'ENCERRADA' && (
        <p className="rounded-norte border border-atencao-borda bg-atencao-fundo p-3 text-sm text-tinta">
          {ordem.situacao === 'ABERTA'
            ? 'Esta ordem ainda está em produção: a fabricação e a validade só existem depois de encerrar. Encerre antes de imprimir.'
            : 'Esta ordem foi cancelada — nada dela entrou no estoque.'}
        </p>
      )}

      <EtiquetaDoLote
        dados={{
          produto: ordem.produto,
          lote: ordem.lote,
          fabricacao: ordem.fabricadaEm ? diaBR(ordem.fabricadaEm) : null,
          validade: ordem.validade ? diaBR(ordem.validade) : null,
          empresa: empresa.nome,
        }}
        quantas={n}
        nonce={nonce}
      />
    </div>
  )
}
