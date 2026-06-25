import http from 'http'
import { route } from './src/http/router.js'

const server = http.createServer(route)
server.listen(0, async () => {
  const port = server.address().port
  try {
    console.log(`Testing against http://127.0.0.1:${port}`)
    const res = await fetch(`http://127.0.0.1:${port}/api/stream`, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://embed.st/embed/echo/england-vs-new-zealand-third-test-cricket-hundred-1/1' })
    })
    const json = await res.json()
    console.log('Result:', json)
    if (json.ok) {
      console.log('SUCCESS!')
      process.exit(0)
    } else {
      console.error('FAILED!')
      process.exit(1)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})
