const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { findCommand, capture } = require('./util');
const { getSettings, setSettings } = require('./storage');

/**
 * Serves the "coach pack" and the phone web app to phones on the same network, or to an
 * Android phone over USB (adb reverse makes the phone's localhost point back here).
 * The data endpoint needs a secret key that only the QR code / link carries.
 */
const PORT = 8731;
let server = null;
let pack = null; // { text, etag, at }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json; charset=utf-8' };
const STATIC = new Set(['index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'sw.js', 'icon.png', 'frames.js', 'jsqr.js']);

function resourceFile(name) {
  const candidates = [
    path.join(app.getAppPath(), 'src', 'resources', 'coach', name),
    path.join(process.resourcesPath || '', 'resources', 'coach', name),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function token() {
  let t = getSettings().coachKey;
  if (!t) {
    t = crypto.randomBytes(6).toString('hex');
    setSettings({ coachKey: t });
  }
  return t;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

function status() {
  const key = token();
  return {
    running: Boolean(server),
    port: PORT,
    key,
    urls: lanAddresses().map((ip) => `http://${ip}:${PORT}/?k=${key}`),
    packAt: pack ? pack.at : null,
    packBytes: pack ? pack.text.length : 0,
  };
}

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const name = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
  res.setHeader('Cache-Control', 'no-store');
  if (name === 'data.json') {
    const key = url.searchParams.get('k') || req.headers['x-packout-key'];
    if (key !== token()) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Wrong or missing key');
    }
    if (!pack) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Nothing published yet — press "Update phone data" in Packout');
    }
    if (req.headers['if-none-match'] === pack.etag) {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES['.json'], ETag: pack.etag, 'Access-Control-Allow-Origin': '*' });
    return res.end(pack.text);
  }
  if (STATIC.has(name)) {
    const file = resourceFile(name);
    if (file) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function start() {
  return new Promise((resolve, reject) => {
    if (server) return resolve(status());
    const s = http.createServer(handler);
    s.once('error', (e) => reject(new Error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : e.message)));
    const ready = () => {
      server = s;
      resolve(status());
    };
    // '::' accepts both IPv4 and IPv6 (so "localhost" works either way); fall back if IPv6 is off.
    s.listen(PORT, '::', ready);
    s.once('error', (e) => {
      if (e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL') s.listen(PORT, '0.0.0.0', ready);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve(status());
    server.close(() => {
      server = null;
      resolve(status());
    });
    server.closeAllConnections?.();
  });
}

function publish(text) {
  pack = { text, etag: `"${crypto.createHash('sha1').update(text).digest('hex').slice(0, 16)}"`, at: new Date().toISOString() };
  return status();
}

/** Android over USB: reverse-forward the port, then open Chrome on the phone. */
async function androidUsb() {
  const adb = findCommand(['adb']);
  if (!adb) throw new Error('adb not found. Install Android platform-tools (macOS: brew install android-platform-tools · Windows: unzip Google’s platform-tools to C:\\platform-tools) and enable USB debugging on the phone. Or skip the cable: scan the QR code with the Packout Coach web app instead.');
  const list = await capture(adb, ['devices']);
  const devices = list.stdout.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === 'device').map((p) => p[0]);
  if (!devices.length) throw new Error('No Android phone found. Plug it in, unlock it and accept the "Allow USB debugging" prompt.');
  await start();
  const dev = devices[0];
  const rev = await capture(adb, ['-s', dev, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
  if (rev.code !== 0) throw new Error('Could not set up the USB link: ' + rev.tail.split('\n').pop());
  const url = `http://localhost:${PORT}/?k=${token()}`;
  await capture(adb, ['-s', dev, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
  return { device: dev, url };
}

module.exports = { start, stop, publish, status, androidUsb, PORT };
