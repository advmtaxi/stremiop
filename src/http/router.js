import { serve } from '../relay/m3u8.js'
import { run } from '../goat/run.js'
import { serveStatic } from './static.js'
import { fetchJson } from '../streamed/api.js'
import { fetchLinks } from '../streamed/match.js'
import { streamedOrigin } from '../env.js'

function json(res, status, body) {
  res.writeHead(status, { 
    'Content-Type': 'application/json', 
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString())
}

// Ensure the ID has the "spk:" prefix handled safely
function stripPrefix(id) {
  return id.startsWith('spk:') ? id.slice(4) : id
}

export async function route(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    })
    res.end()
    return
  }

  if (!req.headers.host) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('missing host')
    return
  }

  const proto = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const loc = new URL(req.url ?? '/', `${proto}://${host}`)
  const { searchParams, origin } = loc
  const pathname = decodeURIComponent(loc.pathname)
  
  // Extract real client IP if proxied
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress

  try {
    // ------------------------------------------
    // STREMIO ADDON PROTOCOL
    // ------------------------------------------

    // 1. Manifest
    if (pathname === '/manifest.json') {
      return json(res, 200, {
        id: 'org.streamedpk.addon',
        version: '1.0.0',
        name: 'Streamed.pk Sports',
        description: 'Live Sports Streams from streamed.pk, natively resolved!',
        catalogs: [{ type: 'tv', id: 'streamedpk', name: 'Live Sports' }],
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv', 'sport'],
        idPrefixes: ['spk:']
      })
    }

    // 2. Catalog
    if (pathname.startsWith('/catalog/tv/streamedpk')) {
      const list = await fetchJson('/api/matches/all')
      const metas = list.map(match => ({
        id: `spk:${match.id}`,
        type: 'tv',
        name: match.title,
        poster: match.poster ? `${streamedOrigin}${match.poster}` : undefined,
        description: `${match.category ? match.category.toUpperCase() : ''} - ${new Date(match.date).toLocaleString()}`
      }))
      return json(res, 200, { metas })
    }

    // 3. Meta
    if (pathname.startsWith('/meta/tv/spk:')) {
      const matchId = stripPrefix(pathname.split('/')[3].replace('.json', ''))
      const list = await fetchJson('/api/matches/all')
      const match = list.find((item) => item.id === matchId)
      
      if (!match) return json(res, 404, { meta: null })

      return json(res, 200, {
        meta: {
          id: `spk:${match.id}`,
          type: 'tv',
          name: match.title,
          poster: match.poster ? `${streamedOrigin}${match.poster}` : undefined,
          description: `Live sports event: ${match.title}`,
          background: match.poster ? `${streamedOrigin}${match.poster}` : undefined
        }
      })
    }

    // 4. Stream
    if (pathname.startsWith('/stream/tv/spk:')) {
      const matchId = stripPrefix(pathname.split('/')[3].replace('.json', ''))
      const list = await fetchJson('/api/matches/all')
      const match = list.find((item) => item.id === matchId)
      
      if (!match || !match.sources || match.sources.length === 0) {
        return json(res, 200, { streams: [] })
      }

      // Resolve all sources to actual Stremio streams
      const streams = []
      
      for (const source of match.sources) {
        try {
          const links = await fetchLinks(source.source, source.id)
          
          for (const link of links) {
            try {
              const body = { matchId: match.id, source: source.source, stream: link.streamNo }
              const result = await run(body, origin, clientIp)
              
              if (result.ok && result.m3u8) {
                const quality = link.hd ? 'HD' : 'SD'
                const lang = link.language ? link.language.toUpperCase() : 'EN'
                const viewers = link.viewers ? `${link.viewers} viewers` : ''
                
                streams.push({
                  name: `Streamed.pk\n${source.source.toUpperCase()}`,
                  title: `Stream ${link.streamNo} | ${quality} | ${lang}\n${viewers}`,
                  url: result.m3u8,
                  behaviorHints: {
                    notWebReady: true,
                    proxyHeaders: {
                      request: {
                        "Origin": "https://embed.st",
                        "Referer": "https://embed.st/"
                      }
                    }
                  }
                })
              }
            } catch (e) {
              console.error(`Failed resolving stream ${link.streamNo} for ${source.source}:`, e)
            }
          }
        } catch (e) {
          console.error(`Failed fetching links for ${source.source}:`, e)
        }
      }

      return json(res, 200, { streams })
    }

    // ------------------------------------------
    // OLD API ROUTES (Kept for backwards compat)
    // ------------------------------------------

    if (pathname === '/api/hls') {
      await serve(res, searchParams, origin)
      return
    }

    if (pathname === '/api/stream') {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'POST required' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch {
        json(res, 400, { ok: false, error: 'invalid json' })
        return
      }
      json(res, 200, await run(body, origin, clientIp))
      return
    }

    if (serveStatic(pathname, res)) return

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  } catch (err) {
    json(res, 500, { ok: false, error: String(err.message || err) })
  }
}
