import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { lerOrgParaCampanha, porQueNao } from '@/servidor/campanhas/acesso'
import { contatosDentro, lerParaEditor } from '@/servidor/campanhas/admin'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { Editor } from './Editor'

// O editor de uma campanha: o desenho do roteiro, o bloco escolhido, as
// pendências e quem está dentro agora. Tudo o que a tela confere, o servidor
// confere de novo ao salvar (ver src/servidor/campanhas/admin.ts).

export default async function EditorDeCampanha({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  const { empresa: slug, id } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'agente.configurar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const base = { empresa, sessao, itens: MENU(slug), ativo: `/${slug}/campanhas`, tema }

  const bloqueio = porQueNao(await lerOrgParaCampanha(sessao.orgId))
  if (bloqueio) {
    return (
      <Estrutura {...base} titulo="Campanha">
        <Aviso nivel="atencao">
          {bloqueio}{' '}
          <Link href={`/${slug}/campanhas`} className="underline">
            Voltar
          </Link>
        </Aviso>
      </Estrutura>
    )
  }

  const dados = await lerParaEditor(sessao, id)
  if (!dados) notFound()
  const dentro = await contatosDentro(sessao, id)

  return (
    <Estrutura
      {...base}
      titulo={dados.campanha.nome}
      acao={
        <Link href={`/${slug}/campanhas`} className="text-sm font-medium text-tinta-2 hover:text-tinta">
          ← Campanhas
        </Link>
      }
    >
      <Editor
        slug={slug}
        inicial={dados}
        dentro={dentro.map((d) => ({
          ...d,
          desde: d.desde.toISOString(),
          proximoEm: d.proximoEm ? d.proximoEm.toISOString() : null,
        }))}
      />
    </Estrutura>
  )
}
