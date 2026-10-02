// O balcão que abre sem internet.
//
// Faz DUAS coisas, e só elas:
//   1. Guarda os arquivos do sistema (/_next/static/…): o nome deles muda a
//      cada versão, então guardar não serve versão velha — serve a que a
//      página pede.
//   2. Guarda a página do BALCÃO (/{empresa}/balcao) cada vez que ela abre com
//      internet. Sem internet, recarregar a página entrega a cópia guardada, e
//      o balcão segue vendendo pela fila do aparelho (ver semInternet.ts).
//
// Com internet, a página vem SEMPRE do servidor (rede primeiro): a cópia só
// existe para a queda. Nenhuma outra tela é guardada, e nenhum pedido de
// dados (as Server Actions são POST) passa por aqui.
//
// Quando a tela de entrar aparece (saiu, ou a sessão caiu), a cópia do balcão
// daquela empresa é apagada: o próximo a usar o aparelho não abre, sem
// internet, a tela de quem saiu.

const ESTATICO = 'norte-estatico-v1'
const PAGINAS = 'norte-balcao-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((nomes) => Promise.all(nomes.filter((n) => n !== ESTATICO && n !== PAGINAS).map((n) => caches.delete(n)))).then(() => self.clients.claim()),
  )
})

const ehBalcao = (p) => /^\/[a-z0-9-]+\/balcao\/?$/.test(p)
const ehEntrar = (p) => /^\/[a-z0-9-]+\/entrar\/?$/.test(p)

self.addEventListener('fetch', (e) => {
  const r = e.request
  if (r.method !== 'GET') return
  const url = new URL(r.url)
  if (url.origin !== self.location.origin) return

  // 1. Os arquivos do sistema: guardados uma vez, servidos do aparelho.
  if (url.pathname.startsWith('/_next/static/')) {
    // À prova de falha: qualquer erro do guardado vira o pedido normal à rede.
    e.respondWith(
      (async () => {
        try {
          const c = await caches.open(ESTATICO)
          const ja = await c.match(r)
          if (ja) return ja
          const resp = await fetch(r)
          if (resp.ok) c.put(r, resp.clone()).catch(() => {})
          return resp
        } catch {
          return fetch(r)
        }
      })(),
    )
    return
  }

  if (r.mode !== 'navigate') return

  // A tela de entrar: some a cópia do balcão desta empresa.
  if (ehEntrar(url.pathname)) {
    const empresa = url.pathname.split('/')[1]
    e.waitUntil(
      caches
        .open(PAGINAS)
        .then(async (c) => {
          for (const k of await c.keys()) if (new URL(k.url).pathname.split('/')[1] === empresa) await c.delete(k)
        })
        .catch(() => {}),
    )
    return
  }

  // 2. O balcão: rede primeiro; a cópia só na queda.
  if (ehBalcao(url.pathname)) {
    e.respondWith(
      fetch(r)
        .then((resp) => {
          // Só guarda a página do balcão de verdade (não o desvio para entrar).
          if (resp.ok && !resp.redirected && ehBalcao(new URL(resp.url).pathname)) {
            const copia = resp.clone()
            caches.open(PAGINAS).then((c) => c.put(url.origin + url.pathname, copia)).catch(() => {})
          }
          return resp
        })
        .catch(async () => {
          try {
            const c = await caches.open(PAGINAS)
            return (await c.match(url.origin + url.pathname)) ?? Response.error()
          } catch {
            return Response.error()
          }
        }),
    )
  }
})
