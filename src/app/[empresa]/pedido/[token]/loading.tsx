// A vitrine pública não usa o esqueleto do sistema (menu, painel): a cliente
// nunca viu aquilo. Enquanto carrega, só a grade cinza.
export default function Carregando() {
  return (
    <main className="min-h-dvh bg-fundo">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 pt-6">
        <div className="flex items-center gap-3.5">
          <span className="h-14 w-14 animate-pulse rounded-2xl bg-superficie-2" />
          <span className="h-5 w-40 animate-pulse rounded-full bg-superficie-2" />
        </div>
        <span className="h-11 w-full animate-pulse rounded-2xl bg-superficie-2" />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-superficie-2" />
          ))}
        </ul>
      </div>
    </main>
  )
}
