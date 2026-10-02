'use client'

// O livro de assinaturas e o balcão que conta estoque, do lado de quem decide.
//
// As chaves são de ligar e desligar (sem formulário): cada toque vai ao
// servidor e a tela mostra o que ficou. A do PIN mostra QUEM ainda não criou
// o seu — ligar com essa lista cheia trava essas pessoas no meio do turno, e o
// servidor recusa.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Aviso, Botao } from '@/ui/base'
import { plural } from '@/ui/texto'
import { mudarBalcaoAmpliadoAcao, mudarPinNaVendaAcao, mudarPinNasExcecoesAcao, type EstadoChave } from './acoesAssinaturas'

export function Assinaturas({
  slug,
  pinNasExcecoes,
  balcaoAmpliado,
  faltam,
  pinNaVenda,
}: {
  slug: string
  pinNasExcecoes: boolean
  balcaoAmpliado: boolean
  faltam: { id: string; nome: string }[]
  /** "Pedir o PIN de quem vendeu em toda venda" (Org.pinEmTodaVenda). */
  pinNaVenda: boolean
}) {
  const [pin, setPin] = useState(pinNasExcecoes)
  const [balcao, setBalcao] = useState(balcaoAmpliado)
  const [venda, setVenda] = useState(pinNaVenda)
  const [estado, setEstado] = useState<EstadoChave>({})
  const [indo, comecar] = useTransition()

  function mudar(qual: 'pin' | 'balcao' | 'venda', ligar: boolean) {
    setEstado({})
    comecar(async () => {
      const r =
        qual === 'pin'
          ? await mudarPinNasExcecoesAcao(slug, ligar)
          : qual === 'venda'
            ? await mudarPinNaVendaAcao(slug, ligar)
            : await mudarBalcaoAmpliadoAcao(slug, ligar)
      setEstado(r)
      if (!r.erro) (qual === 'pin' ? setPin : qual === 'venda' ? setVenda : setBalcao)(ligar)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      {/* O PIN em toda venda: liga mesmo com gente sem PIN — quem não tem
          confirma sem ele (no próprio nome), então ninguém trava. A lista
          de quem falta é para a dona cobrar, não uma trava. */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-xl flex-col gap-1">
            <h3 className="text-sm font-bold text-tinta">Pedir o PIN de quem vendeu em toda venda</h3>
            <p className="text-[13px] leading-relaxed text-tinta-2">
              No “Concluir”, o balcão mostra o total e pede o PIN de 4 números. Nada é gravado antes — o toque sem querer
              não vira venda — e a venda fica no nome de quem digitou, mesmo no tablet que fica logado numa conta só.
              Meta e comissão saem certas.
            </p>
          </div>
          <Botao tom={venda ? 'secundario' : 'principal'} carregando={indo} onClick={() => mudar('venda', !venda)}>
            {venda ? 'Desligar' : 'Ligar'}
          </Botao>
        </div>
        <p className="text-xs font-semibold text-tinta-2">{venda ? 'Ligado.' : 'Desligado.'}</p>
        {venda && faltam.length > 0 && (
          <Aviso nivel="atencao">
            Ainda sem PIN: <b>{faltam.map((f) => f.nome).join(', ')}</b>. Até criarem, confirmam a venda sem PIN, no
            próprio nome. Cada uma cria o seu em{' '}
            <Link href={`/${slug}/conta#pin`} className="underline underline-offset-2">
              Minha conta
            </Link>
            .
          </Aviso>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-borda-suave pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-xl flex-col gap-1">
            <h3 className="text-sm font-bold text-tinta">Pedir o PIN de quem faz nas exceções</h3>
            <p className="text-[13px] leading-relaxed text-tinta-2">
              Sangria, suprimento, cancelar venda, baixa de crediário pago fora, corrigir estoque e corrigir a data de uma
              venda passam a pedir o PIN pessoal de quem está fazendo — e ficam no livro como assinados. Desconto acima do
              teto continua com o PIN da gerente.
            </p>
          </div>
          <Botao
            tom={pin ? 'secundario' : 'principal'}
            carregando={indo}
            disabled={!pin && faltam.length > 0}
            onClick={() => mudar('pin', !pin)}
          >
            {pin ? 'Desligar' : 'Ligar'}
          </Botao>
        </div>
        <p className="text-xs font-semibold text-tinta-2">{pin ? 'Ligado.' : 'Desligado.'}</p>
        {!pin && faltam.length > 0 && (
          <Aviso nivel="atencao">
            Só liga quando todo mundo tiver o PIN. Falta{faltam.length === 1 ? '' : 'm'}{' '}
            {plural(faltam.length, 'pessoa', 'pessoas')}: <b>{faltam.map((f) => f.nome).join(', ')}</b>. Cada uma cria o seu em{' '}
            <Link href={`/${slug}/conta`} className="underline underline-offset-2">
              Minha conta
            </Link>
            .
          </Aviso>
        )}
        <p className="text-xs text-tinta-3">
          O que foi assinado aparece em Auditoria, no filtro “assinado com PIN”. Juntar duas fichas de cliente pede o PIN
          sempre, com a chave ligada ou não.
        </p>
      </section>

      <section className="flex flex-wrap items-start justify-between gap-3 border-t border-borda-suave pt-4">
        <div className="flex max-w-xl flex-col gap-1">
          <h3 className="text-sm font-bold text-tinta">Vendedora conta e corrige o estoque e cadastra produto</h3>
          <p className="text-[13px] leading-relaxed text-tinta-2">
            Quem é do balcão passa a corrigir o estoque pelo que contou e a cadastrar a peça que chegou — sempre assinando
            com o PIN dela. Mudar o preço depois de cadastrado continua com a gerência. Desligado, o balcão é o de sempre.
          </p>
          <p className="text-xs font-semibold text-tinta-2">{balcao ? 'Ligado.' : 'Desligado.'}</p>
        </div>
        <Botao tom={balcao ? 'secundario' : 'principal'} carregando={indo} onClick={() => mudar('balcao', !balcao)}>
          {balcao ? 'Desligar' : 'Ligar'}
        </Botao>
      </section>
    </div>
  )
}
