import { redirect } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { Aviso } from '@/ui/base'
import { Formulario } from './Formulario'

export default async function Comecar({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  // `false`: esta é a própria tela de cadastro, senão entraria em laço.
  const { empresa, sessao } = await exigirEntrada(slug, false)

  // Já configurada: não deixa refazer o cadastro inicial por engano.
  if (empresa.configuradaEm) redirect(`/${slug}/configuracoes`)

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-widest text-tinta-3 uppercase">Primeiro acesso</p>
        <h1 className="text-2xl font-extrabold tracking-tight text-tinta">
          Vamos deixar o Norte com a cara da sua empresa
        </h1>
        <p className="max-w-prose text-tinta-2">
          Leva dois minutos. O que você marcar aqui decide o que aparece no sistema — e tudo
          pode mudar depois.
        </p>
      </header>

      {pode(sessao, 'empresa.configurar') ? (
        <Formulario empresa={slug} nomeAtual={empresa.nome} />
      ) : (
        <Aviso nivel="atencao">
          Esta empresa ainda está sendo configurada por quem responde por ela. Assim que
          terminarem, seu acesso aparece aqui.
        </Aviso>
      )}
    </main>
  )
}
