// Acompanhar o pedido também não usa o esqueleto do sistema: enquanto
// carrega, o desenho da página em cinza — a loja, a situação e os itens.
export default function Carregando() {
  return (
    <main className="min-h-dvh bg-fundo px-4 pt-6 pb-12 sm:pt-10" aria-busy="true" aria-label="Carregando o pedido">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="h-12 w-12 animate-pulse rounded-2xl bg-superficie-2" />
          <div className="flex flex-col gap-2">
            <span className="h-4 w-36 animate-pulse rounded-full bg-superficie-2" />
            <span className="h-3 w-20 animate-pulse rounded-full bg-superficie-2" />
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-[24px] border border-borda-suave bg-superficie p-5">
          <span className="h-3 w-24 animate-pulse rounded-full bg-superficie-2" />
          <span className="h-7 w-48 animate-pulse rounded-full bg-superficie-2" />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3.5">
              <span className="h-7 w-7 animate-pulse rounded-full bg-superficie-2" />
              <span className="h-4 w-40 animate-pulse rounded-full bg-superficie-2" />
            </div>
          ))}
        </div>
        <span className="h-40 animate-pulse rounded-[24px] bg-superficie-2" />
      </div>
    </main>
  )
}
