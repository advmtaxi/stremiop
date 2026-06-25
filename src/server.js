import { createServer } from 'node:http'
import { port } from './env.js'
import { route } from './http/router.js'

const srv = createServer(route)

function boot() {
  const addr = srv.address()
  const host = typeof addr === 'string' ? addr : `localhost:${addr.port}`
  console.log(`http://${host}/`)
}

const hostBinding = process.env.HOST || '0.0.0.0'
srv.listen(port, hostBinding, boot)
