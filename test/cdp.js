// Evaluate JS inside the running dev app: node test/cdp.js "<expression>"  (needs PACKOUT_DEBUG_PORT=9333)
const WebSocket = require('ws');
const http = require('http');
const expr = process.argv[2];
http.get('http://localhost:9333/json', (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => {
    const page = JSON.parse(b).find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true } })));
    ws.on('message', (m) => {
      const r = JSON.parse(m);
      if (r.id === 1) {
        console.log(JSON.stringify(r.result.exceptionDetails ? r.result.exceptionDetails.exception.description : r.result.result.value, null, 1));
        if (process.argv[3]) ws.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } }));
        else ws.close();
      } else if (r.id === 2) {
        require('fs').writeFileSync(process.argv[3], Buffer.from(r.result.data, 'base64'));
        ws.close();
      }
    });
  });
});
