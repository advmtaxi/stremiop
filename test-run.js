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
    console.log('Stream result:', json)
    if (!json.ok) {
      console.error('FAILED AT RESOLVE STAGE')
      process.exit(1)
    }
    
    console.log('\nFetching relay link:', json.relay)
    const relayRes = await fetch(json.relay)
    console.log('Relay Status:', relayRes.status)
    const relayText = await relayRes.text()
    
    if (relayRes.status !== 200) {
      console.error('FAILED AT RELAY STAGE:', relayRes.status)
      console.error(relayText)
      process.exit(1)
    }
    
    console.log('Relay Output (first 500 chars):')
    console.log(relayText.slice(0, 500))
    console.log('\nSUCCESS!')
    process.exit(0)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})
