// Cloudflare Access service token: sent as CF-Access-Client-Id/Secret on every request the app makes to house.json's
// "accessDomain" (https://*.<domain>), so Access-protected pages open away from home. The user pastes the two values
// on a page from the home network (house.json "homeNet", e.g. "192.168.1."): http://<this machine>:8733/cloudflare.
// The page only writes; it never shows what is saved. Kept in ~/.config/art-desktop/cf-access.json (owner-only).
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, session } = require('electron')

const FILE = path.join(os.homedir(), '.config', 'art-desktop', 'cf-access.json')
const read = () => { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return j.id && j.secret ? j : null } catch { return null } }
// home network and this machine only
const house = require('./house.cjs')
const local = (ip) => /^(127\.|::1$)/.test(ip) || (!!house().homeNet && ip.startsWith(house().homeNet))

function hook(s) {
  const dom = house().accessDomain
  if (!dom) return
  s.webRequest.onBeforeSendHeaders({ urls: [`https://*.${dom}/*`] }, (d, cb) => {
    const t = read()
    cb({ requestHeaders: t ? { ...d.requestHeaders, 'CF-Access-Client-Id': t.id, 'CF-Access-Client-Secret': t.secret } : d.requestHeaders })
  })
}
function start() { hook(session.defaultSession); app.on('session-created', hook) }

const page = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>A.R.T. Desktop · Cloudflare token</title>
<style>body{font:15px system-ui;background:#111;color:#eee;max-width:520px;margin:40px auto;padding:0 16px}
input{width:100%;box-sizing:border-box;padding:9px;margin:4px 0 14px;background:#222;color:#eee;border:1px solid #444;border-radius:8px}
button{padding:9px 22px;border:0;border-radius:20px;background:#e8a33d;font-weight:600}p.m{color:#9c9}</style>
<h2>Cloudflare Access token for this Mac</h2>
<p>${read() ? 'A token is saved. Paste both values again to replace it.' : 'No token saved yet.'}</p>
${msg ? `<p class="m">${msg}</p>` : ''}
<form method="post" autocomplete="off">
<label>Client ID<input name="id" required spellcheck="false"></label>
<label>Client Secret<input name="secret" type="password" required spellcheck="false"></label>
<button>Save</button></form>`

// receiver.cjs hands it GET/POST /cloudflare; returns false when the request isn't for this page
function handle(req, res) {
  if (req.url.split('?')[0] !== '/cloudflare') return false
  const send = (status, html) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' }); res.end(html) }
  if (!local(req.socket.remoteAddress.replace(/^::ffff:/, ''))) return send(403, 'home network only'), true
  if (req.method === 'GET') return send(200, page('')), true
  if (req.method !== 'POST') return send(405, 'GET or POST'), true
  // another site's page can't post here: the form must come from this page
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403, 'wrong origin'), true
  let body = ''
  req.setEncoding('utf8')
  req.on('data', (d) => { body += d; if (body.length > 4000) req.destroy() })
  req.on('end', () => {
    const f = new URLSearchParams(body), id = (f.get('id') || '').trim(), secret = (f.get('secret') || '').trim()
    if (!id || !secret) return send(400, page('Both values are needed.'))
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify({ id, secret }), { mode: 0o600 })
    fs.chmodSync(FILE, 0o600)
    send(200, page('Saved. The app uses it from now on, no restart needed.'))
  })
  return true
}

module.exports = { start, handle }
