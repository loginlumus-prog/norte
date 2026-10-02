import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { textoSemAcesso, voltarSeguro } from '@/servidor/sem-acesso'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'

export const metadata: Metadata = { title: 'Sem acesso' }

// A tela que diz por que a outra não abriu (ver servidor/sem-acesso.ts).
// Dentro da moldura, com o menu: a pessoa continua no sistema, sabe o
// motivo e tem para onde ir — não cai numa página de "link errado".
export default async function SemAcesso({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ motivo?: string; de?: string }>
}) {
  const { empresa: slug } = await params
  const { motivo, de } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const t = textoSemAcesso(slug, typeof motivo === 'string' ? motivo : undefined, pode(sessao, 'empresa.configurar'))
  const voltar = voltarSeguro(slug, typeof de === 'string' ? de : undefined)

  return (
    <Estrutura empresa={empresa} sessao={sessao} itens={MENU(slug)} ativo="" tema={tema} titulo="Sem acesso">
      <Cartao>
        <div className="flex max-w-xl flex-col gap-3 py-2">
          <h2 className="text-lg font-bold tracking-tight text-tinta">{t.titulo}</h2>
          <p className="text-sm leading-relaxed text-tinta-2">{t.texto}</p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {t.acao && (
              <Link
                href={t.acao.href}
                className="botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta"
              >
                {t.acao.rotulo}
              </Link>
            )}
            <Link
              href={voltar}
              className="rounded-norte border border-borda px-4 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
            >
              {voltar === `/${slug}` ? 'Ir para o Painel' : 'Voltar'}
            </Link>
          </div>
        </div>
      </Cartao>
    </Estrutura>
  )
}
