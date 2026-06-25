import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { port } from './env.js'
import { route } from './http/router.js'

const srv = createServer(route)

function boot() {
  const addr = srv.address()
  const host = typeof addr === 'string' ? addr : `localhost:${addr.port}`
  const url = `http://127.0.0.1:${srv.address().port}/`
  console.log(url)
  
  // Auto-open browser
  const platform = process.platform;
  const cmd = platform === 'win32' ? `start ${url}` : platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
  exec(cmd, () => {});
}

const hostBinding = process.env.HOST || '0.0.0.0'
srv.listen(port, hostBinding, boot)
