import type { Metadata } from 'next'
import { vocabularioDaEmpresa, vocabularioDoEndereco } from '@/servidor/vocabulario'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Secao } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Editor } from '../Editor'
import { ofertasNaTela } from '../ofertasNaTela'
import { palavrasDaFicha } from '../palavras'

export async function generateMetadata({ params }: { params: Promise<{ empresa: string }> }): Promise<Metadata> {
  return { title: (await vocabularioDoEndereco((await params).empresa)).novo }
}

export default async function NovoCliente({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'cliente.editar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // O botão que leva até aqui já está escondido; endereço colado no navegador
  // não passa pelo botão.
  if (!pode(sessao, 'cliente.editar')) semAcesso(slug, 'cargo')
  const ofertas = await ofertasNaTela(sessao, empresa.nome)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/clientes`}
      tema={tema}
      titulo={(await vocabularioDaEmpresa(sessao.orgId)).novo}
    >
      <Secao titulo="Cadastro">
        <Editor slug={slug} ofertas={ofertas} palavras={await palavrasDaFicha(sessao.orgId)} />
      </Secao>
    </Estrutura>
  )
}
