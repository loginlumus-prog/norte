// A vitrine pública não usa o esqueleto do sistema (menu, painel): a cliente
// nunca viu aquilo. Enquanto carrega, o desenho da vitrine em cinza — o
// cabeçalho, a busca, as categorias e as linhas de produto.
export default function Carregando() {
  return (
    <main className="min-h-dvh bg-fundo" aria-busy="true" aria-label="Carregando o catálogo">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 pt-6 sm:pt-10">
        <div className="flex items-center gap-3.5">
          <span className="h-16 w-16 animate-pulse rounded-[20px] bg-superficie-2 sm:h-[72px] sm:w-[72px]" />
          <div className="flex flex-col gap-2">
            <span className="h-5 w-44 animate-pulse rounded-full bg-superficie-2" />
            <span className="h-3.5 w-24 animate-pulse rounded-full bg-superficie-2" />
          </div>
        </div>
        <div className="flex gap-2">
          <span className="h-8 w-24 animate-pulse rounded-full bg-superficie-2" />
          <span className="h-8 w-32 animate-pulse rounded-full bg-superficie-2" />
        </div>
        <span className="mt-2 h-12 w-full animate-pulse rounded-full bg-superficie-2" />
        <div className="flex gap-2 overflow-hidden">
          {[16, 20, 24, 20, 18].map((w, i) => (
            <span key={i} className="h-9 shrink-0 animate-pulse rounded-full bg-superficie-2" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex items-center gap-3.5 rounded-[20px] border border-borda-suave bg-superficie p-3">
              <span className="h-[76px] w-[76px] shrink-0 animate-pulse rounded-2xl bg-superficie-2" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="h-4 w-3/5 animate-pulse rounded-full bg-superficie-2" />
                <span className="h-4 w-20 animate-pulse rounded-full bg-superficie-2" />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
