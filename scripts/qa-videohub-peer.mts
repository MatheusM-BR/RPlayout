import net from 'node:net'

// Local protocol fixture only, for browser QA. Not a driver or a simulator
// sold as hardware: no physical crosspoint, board, output or user media.
const sockets = new Set<net.Socket>(), routing = new Map<number, number>([[0, 0], [4, 1]])
const peer = net.createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
  socket.setEncoding('utf8')
  socket.write('PROTOCOL PREAMBLE:\nVersion: 2.3\n\nVIDEOHUB DEVICE:\nDevice present: true\nModel name: QA protocol fixture — no physical router\nVideo inputs: 16\nVideo outputs: 16\n\n')
  let pending = ''
  socket.on('data', text => {
    pending += text
    let end: number
    while ((end = pending.indexOf('\n\n')) >= 0) {
      const block = pending.slice(0, end); pending = pending.slice(end + 2)
      console.log(JSON.stringify({ received: block, physicalOutputValidated: false }))
      if (block === 'PING:') socket.write('ACK\n\n')
      else if (block === 'VIDEO OUTPUT ROUTING:') socket.write('ACK\n\nVIDEO OUTPUT ROUTING:\n' + [...routing].map(([destination, source]) => `${destination} ${source}`).join('\n') + '\n\n')
      else {
        const match = /^VIDEO OUTPUT ROUTING:\n(\d+) (\d+)$/.exec(block)
        if (match && Number(match[1]) < 16 && Number(match[2]) < 16) {
          routing.set(Number(match[1]), Number(match[2])); socket.write('ACK\n\n')
        } else socket.write('NAK\n\n')
      }
    }
  })
})
peer.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ fixture: 'VIDEOHUB_QA_LOCAL_ONLY', port: (peer.address() as net.AddressInfo).port, physicalOutputValidated: false })))
process.on('SIGINT', () => { for (const socket of sockets) socket.destroy(); peer.close(() => process.exit(0)) })
