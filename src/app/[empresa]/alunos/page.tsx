import { redirect } from 'next/navigation'

// "/alunos" é a tela de Clientes com a palavra do ramo (vocabulario.ts): na
// escola ela já se chama "Alunos" no menu e no título. Este endereço existe
// para quem digita (ou recebe no WhatsApp) o caminho que a palavra sugere —
// ele leva para a mesma tela, e não para um "não encontrado".

export default async function Alunos({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params
  redirect(`/${empresa}/clientes`)
}
