import Link from 'next/link'
import { Marca } from '@/ui/Marca'
import { Bussola } from '@/ui/Traco'

// A tela de endereço que não existe.
//
// Sem ela, o Next serve a página branca dele — texto pequeno em inglês, sem
// cor, sem marca. Quem tropeça num link velho conclui que o sistema caiu.
//
// Ela também é a resposta de "empresa não existe": `exigirEntrada` chama
// `notFound()` quando o endereço não bate com nenhuma empresa. Por isso o
// texto NÃO diz "esta empresa não existe" — dizer isso deixaria qualquer
// pessoa descobrir, testando endereços, quem é cliente da gente.
export default function NaoAchei() {
  return (
    <main className="nav-fundo relative flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden p-6 text-center">
      <Bussola
        tamanho={760}
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-nav-tinta opacity-[0.06]"
      />
      <div className="relative">
        <Marca tamanho={30} nu claro />
      </div>
      <div className="relative flex max-w-md flex-col gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight text-nav-tinta">
          Este endereço não abre.
        </h1>
        <p className="leading-relaxed text-nav-tinta-2">
          Ou o link está errado, ou você não tem acesso a ele. Se o link chegou por
          convite, use o que veio na mensagem — cada empresa entra pelo endereço dela.
        </p>
      </div>
      <Link
        href="/"
        className="botao-marca relative rounded-norte px-5 py-2.5 text-sm font-semibold text-marca-tinta"
      >
        Voltar ao começo
      </Link>
    </main>
  )
}
