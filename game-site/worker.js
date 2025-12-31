addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const gameName = url.pathname.split('/')[1]
  const gameURL = `https://raw.githubusercontent.com/chessgrandest-prog/fun/main/UGS Files/${gameName}.html`
  const response = await fetch(gameURL)
  return new Response(response.body, { headers: { 'Content-Type': 'text/html' } })
}
