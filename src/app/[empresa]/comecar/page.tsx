import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { RAMOS, type Ramo } from '@/servidor/modulos'
import { Aviso } from '@/ui/base'
import { Formulario } from './Formulario'
import { sairAcao } from '@/app/[empresa]/acoes'

export const metadata: Metadata = { title: 'Começar' }

export default async function Comecar({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  // `false`: esta é a própria tela de cadastro, senão entraria em laço.
  const { empresa, sessao } = await exigirEntrada(slug, false)

  // Já configurada: não deixa refazer o cadastro inicial por engano.
  if (empresa.configuradaEm) redirect(`/${slug}/configuracoes`)

  // Quem se cadastrou pelo site já disse o ramo lá; a tela começa com ele.
  const { ramo } = await comoOrg(sessao.orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { ramo: true } }),
  )
  const ramoAtual = ramo && ramo in RAMOS ? (ramo as Ramo) : undefined

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
      <header className="flex flex-col gap-2">
        {/* A saída. Esta tela não tem menu, e quem entrou com a conta errada
            (ou só queria olhar) ficava preso nela até o cookie expirar. */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-xs tracking-widest text-tinta-3 uppercase">Primeiro acesso</p>
          <form action={sairAcao}>
            <input type="hidden" name="empresa" value={slug} />
            <button
              type="submit"
              className="text-xs font-medium text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
            >
              Sair ({sessao.nome.split(' ')[0]})
            </button>
          </form>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          Vamos deixar o Norte com a cara da sua empresa
        </h1>
        <p className="max-w-prose text-tinta-2">
          Leva dois minutos. O que você marcar aqui decide o que aparece no sistema — e tudo
          pode mudar depois.
        </p>
      </header>

      {pode(sessao, 'empresa.configurar') ? (
        <Formulario empresa={slug} nomeAtual={empresa.nome} ramoAtual={ramoAtual} />
      ) : (
        <Aviso nivel="atencao">
          Esta empresa ainda está sendo configurada por quem responde por ela. Assim que
          terminarem, seu acesso aparece aqui.
        </Aviso>
      )}
    </main>
  )
}
