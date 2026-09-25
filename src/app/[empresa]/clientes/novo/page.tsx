import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Secao } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Editor } from '../Editor'
import { ofertasNaTela } from '../ofertasNaTela'

export default async function NovoCliente({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'cliente.editar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // O botão que leva até aqui já está escondido; endereço colado no navegador
  // não passa pelo botão.
  if (!pode(sessao, 'cliente.editar')) notFound()
  const ofertas = await ofertasNaTela(sessao, empresa.nome)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/clientes`}
      tema={tema}
      titulo="Novo cliente"
    >
      <Secao titulo="Cadastro">
        <Editor slug={slug} ofertas={ofertas} />
      </Secao>
    </Estrutura>
  )
}
