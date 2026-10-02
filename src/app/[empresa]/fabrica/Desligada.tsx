import Link from 'next/link'
import { MODULOS } from '@/servidor/modulos'
import { Aviso } from '@/ui/base'

// O módulo desligado. O menu já não mostra a Fábrica, mas o endereço pode
// chegar por link: em vez de "não encontrado", a tela diz o que é e onde se liga.

export function FabricaDesligada({ slug, podeLigar }: { slug: string; podeLigar: boolean }) {
  const resumo = MODULOS.fabrica.resumo
  return (
    <Aviso nivel="neutro">
      A Fábrica está desligada nesta empresa. Ela serve a quem fabrica o que vende (sorvete, pão, doce) e abastece as
      próprias lojas: {resumo.charAt(0).toLowerCase() + resumo.slice(1)}{' '}
      {podeLigar ? (
        <>
          Para ligar, vá em{' '}
          <Link href={`/${slug}/configuracoes`} className="font-semibold underline underline-offset-2">
            Configurações › O que sua empresa usa
          </Link>
          .
        </>
      ) : (
        'Quem responde pela empresa liga em Configurações.'
      )}
    </Aviso>
  )
}
