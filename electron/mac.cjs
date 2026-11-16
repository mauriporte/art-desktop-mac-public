// macOS stand-in for windows.ps1: answers the same command lines (winCmd) with the same JSON, through osascript.
// What has no Mac equivalent here (window lists, taskbar, AppBar, key presses) answers null, as a failed command does.
const { execFile } = require('child_process')

const osa = (args, ms = 8000) => new Promise((res) => execFile('osascript', args, { timeout: ms, encoding: 'utf8' }, (err, out) => res(err ? null : out.trim())))
const jxa = (src) => osa(['-l', 'JavaScript', '-e', src])
const json = (s) => { try { return JSON.parse(s) } catch { return null } }

// Spotify or Music, the playing one first; .running() never launches an app that is closed. The first call makes
// macOS ask once whether this app may control Spotify/Music (System Preferences > Security & Privacy > Automation).
const NOW = `(() => {
  const seen = []
  for (const n of ['Spotify', 'Music']) {
    const a = Application(n)
    if (!a.running()) continue
    const st = a.playerState()
    if (st === 'stopped') continue
    const t = a.currentTrack(), sp = n === 'Spotify'
    seen.push({ app: n, raw: t.name(), playing: st === 'playing', title: t.name(), artist: t.artist(), album: t.album(),
      position: a.playerPosition(), duration: sp ? t.duration() / 1000 : t.duration(), updatedAt: Date.now(), hasArt: sp, spotify: sp,
      artUrl: sp ? t.artworkUrl() : '' })
  }
  return JSON.stringify(seen.find((x) => x.playing) || seen[0] || { none: true })
})()`

async function media() { return json(await jxa(NOW)) }

async function mediaArt() {
  const m = await media()
  if (!m?.artUrl) return { none: true }
  try {
    const r = await fetch(m.artUrl, { signal: AbortSignal.timeout(8000) })
    return { title: m.title, art: `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}` }
  } catch { return { none: true } }
}

async function mediaCtl(what) {
  const m = await media()
  const verb = { play: 'playpause', next: 'nextTrack', prev: 'previousTrack' }[what]
  if (!m?.app || !verb) return null
  return (await jxa(`Application(${JSON.stringify(m.app)}).${verb}(); 'ok'`)) === 'ok' ? { ok: true } : null
}

// ---- the notch's Controls tab, answered like radios.ps1: { route, wifi, lan, airplane, radios, ssid }
const sh = (cmd, args, ms = 8000) => new Promise((res) => execFile(cmd, args, { timeout: ms, encoding: 'utf8' }, (err, out) => res(err ? '' : out)))
// network services in macOS' order (the first one that is up carries the traffic), with their hardware port and device
const services = async () => parseServices(await sh('networksetup', ['-listnetworkserviceorder']))
function parseServices(out) {
  return [...out.matchAll(/^\((\d+|\*)\) (.+)\n\(Hardware Port: (.+?), Device: (\w*)\)/gm)].map((m) => ({ name: m[2], port: m[3], device: m[4], off: m[1] === '*' }))
}
// "1000baseT" -> "1 Gbps", "100baseTX" -> "100 Mbps" (the Windows LinkSpeed wording)
const media2speed = (s) => { const n = Number(s.match(/(\d+)base/)?.[1]); return !n ? '' : n >= 1000 ? `${n / 1000} Gbps` : `${n} Mbps` }
async function link(device) {
  const out = await sh('ifconfig', [device])
  return { up: /status: active/.test(out), ip: out.match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1], speed: media2speed(out.match(/media: .*?\((\w+)/)?.[1] ?? '') }
}
const AIRPORT = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport'
// Bluetooth power through IOBluetooth's own preference calls (what System Preferences uses); no controller = no adapter
const BT = (set) => jxa(`ObjC.import('IOBluetooth')
  const get = ObjC.bindFunction('IOBluetoothPreferenceGetControllerPowerState', ['int', []])
  ${set == null ? '' : `ObjC.bindFunction('IOBluetoothPreferenceSetControllerPowerState', ['void', ['int']])(${set ? 1 : 0}); delay(1.5)`}
  JSON.stringify({ has: !$.IOBluetoothHostController.defaultController.isNil(), on: get() === 1 })`)

async function radios(kind, state) {
  const all = await services()
  // a hackintosh: en0 is the Intel card under itlwm, which macOS lists as "Ethernet"; on this Mac en0 is only ever Wi-Fi
  const wifiSvc = all.find((s) => s.port === 'Wi-Fi' && s.device) ?? all.find((s) => s.device === 'en0')
  const itl = wifiSvc && wifiSvc.port !== 'Wi-Fi'
  // the card's radio is off (HP airplane key) when its Intel Bluetooth half (USB vendor 0x8087) drops off USB
  const radioOff = itl && !/"idVendor" = 32903/.test(await sh('ioreg', ['-p', 'IOUSB', '-l', '-w0']))
  if (kind) {
    const on = state === 'On'
    if (wifiSvc && !itl && (kind === 'WiFi' || kind === 'All')) await sh('networksetup', ['-setairportpower', wifiSvc.device, on ? 'on' : 'off'])
    if (kind === 'Bluetooth' || kind === 'All') await BT(on)
  }
  const radiosList = []
  let wifi = null, ssid = ''
  if (wifiSvc) {
    const on = itl ? !radioOff : /: On/.test(await sh('networksetup', ['-getairportpower', wifiSvc.device]))
    radiosList.push({ kind: 'WiFi', name: wifiSvc.name, on })
    const l = await link(wifiSvc.device)
    if (on && l.up) {
      ssid = itl ? '' : (await sh('networksetup', ['-getairportnetwork', wifiSvc.device])).match(/Network: (.+)/)?.[1]?.trim() ?? ''
      const rate = itl ? '' : (await sh(AIRPORT, ['-I'])).match(/lastTxRate: (\d+)/)?.[1]
      wifi = { name: wifiSvc.name, ip: l.ip, speed: rate ? `${rate} Mbps` : '' }
    }
  }
  const bt = json(await BT())
  if (bt?.has) radiosList.push({ kind: 'Bluetooth', name: 'Bluetooth', on: bt.on })
  // wired networks: every other service on a real device, except bridges, Bluetooth and FireWire
  const lan = await Promise.all(all.filter((s) => s !== wifiSvc && s.device && !s.off && !/Bluetooth|Bridge|FireWire/i.test(s.port))
    .map(async (s) => { const l = await link(s.device); return { name: s.name, label: 'LAN', up: l.up, speed: l.speed, ip: l.ip, network: s.port } }))
  const dev = (await sh('route', ['-n', 'get', 'default'])).match(/interface: (\w+)/)?.[1]
  return { route: all.find((s) => s.device === dev)?.name ?? '', wifi, lan, airplane: !!radioOff, radios: radiosList, ssid }
}

// traffic switch: the chosen service goes first in macOS' service order, through the administrator prompt every time
// (as traffic.ps1 goes through Windows' UAC); 'lan' puts the wired one back in front
// With house.json "networks" ({ local: [...], vpn: [...] } Wi-Fi names) it first joins that way's Wi-Fi network,
// 5 GHz first; macOS uses the password it already keeps for a network joined before (none is ever passed here)
const byBand = (names) => [...names].sort((a, b) => /5G/i.test(b) - /5G/i.test(a))
async function joinWay(device, names) {
  const cur = (await sh('networksetup', ['-getairportnetwork', device])).match(/Network: (.+)/)?.[1]?.trim()
  if (names.includes(cur)) return { ok: true }
  for (const n of byBand(names)) {
    // networksetup prints nothing when it joined, and a message ("Could not find network…", "Failed to join…") when not
    if (!(await sh('networksetup', ['-setairportnetwork', device, n], 30000)).trim()) return { ok: true }
  }
  return { error: `Couldn't join ${names.join(' / ')}: join it once from the Wi-Fi menu` }
}
async function traffic(via, wifi, lan, nets = {}) {
  const svc = await services(), all = svc.map((s) => s.name), first = via === 'vpn' ? wifi : lan
  const names = (via === 'vpn' ? nets.vpn : nets.local) ?? [], dev = svc.find((s) => s.name === wifi)?.device
  if (names.length && dev) { const j = await joinWay(dev, names); if (j.error || !lan) return j }
  if (!all.includes(wifi) || !all.includes(lan)) return { error: 'network not found' }
  const order = [first, ...all.filter((n) => n !== first)].map((n) => `'${n.replace(/'/g, "'\\''")}'`).join(' ')
  const r = await new Promise((res) => execFile('osascript', ['-e', `do shell script ${JSON.stringify(`/usr/sbin/networksetup -ordernetworkservices ${order}`)} with administrator privileges`],
    { timeout: 120000, encoding: 'utf8' }, (err, _o, e) => res(err ? { error: /-128|cancel/i.test(String(e)) ? 'cancelled' : String(e || err.message).slice(0, 200) } : { ok: true })))
  return r
}

// Night Shift through CoreBrightness (what Control Center uses). shortcut: macOS gives no plain way to read its state,
// so this remembers what was last set here and starts as Off; read CBBlueLightClient's status struct if that misleads
let night = false
const nightShift = async (on) => { const r = await jxa(`ObjC.import('Foundation'); $.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/CoreBrightness.framework').load
  $.NSClassFromString('CBBlueLightClient').alloc.init.setEnabled(${on}); 'ok'`); if (r === 'ok') night = on; return r === 'ok' }

// the taskbar switch: on a Mac it hides the Dock (auto-hide, as System Preferences does)
const dockHidden = async () => (await sh('defaults', ['read', 'com.apple.dock', 'autohide'])).trim() === '1'
const setDockHidden = (on) => osa(['-e', `tell application "System Events" to set autohide of dock preferences to ${!!on}`])

// a phone's keys (Joint Remote receiver), Windows virtual-key codes -> macOS key codes, typed through System Events
// (macOS asks once to allow Accessibility for this app)
const KEYS = { 38: 126, 40: 125, 37: 123, 39: 124, 13: 36 }
async function key(vk) {
  vk = Number(vk)
  if (vk === 0xAF || vk === 0xAE) return osa(['-e', `set volume output volume ((output volume of (get volume settings)) ${vk === 0xAF ? '+' : '-'} 6)`])
  if (vk === 0xAD) return osa(['-e', 'set volume output muted (not (output muted of (get volume settings)))'])
  if (vk === 0xA6) return osa(['-e', 'tell application "System Events" to keystroke "[" using command down']) // browser back
  if (KEYS[vk]) return osa(['-e', `tell application "System Events" to key code ${KEYS[vk]}`])
  return null
}
// Win+D desktop, Win+Tab every window, Win+N notifications; Win+K cast and Win+P project open the Displays settings (AirPlay, mirroring)
const MC = '/System/Applications/Mission Control.app/Contents/MacOS/Mission Control'
const DISPLAYS = ['open', ['x-apple.systempreferences:com.apple.preference.displays']]
const WINKEY = { 0x44: [MC, ['1']], 0x09: [MC, []], 0x4B: DISPLAYS, 0x50: DISPLAYS }
const winKey = (code) => { const c = WINKEY[code]; return c ? sh(c[0], c[1]).then(() => ({ ok: true })) : null }

async function cmd(line) {
  const [op, arg = ''] = String(line).split(/ (.*)/s)
  if (op === 'night') return (await nightShift(arg === '1')) ? { ok: true } : null
  if (op === 'winkey') return winKey(arg.toUpperCase().charCodeAt(0))
  if (op === 'winvk') return winKey(Number(arg))
  if (op === 'key') return (await key(arg)) !== null ? { ok: true } : null
  if (op === 'type') return (await osa(['-e', `tell application "System Events" to keystroke ${JSON.stringify(Buffer.from(arg, 'base64').toString('utf8'))}`])) !== null ? { ok: true } : null
  if (op === 'media') return media()
  if (op === 'mediaart') return mediaArt()
  if (op === 'mediactl') return mediaCtl(arg)
  if (op === 'quick') {
    const v = json(await jxa('(() => { const a = Application.currentApplication(); a.includeStandardAdditions = true; const s = a.getVolumeSettings(); return JSON.stringify({ vol: s.outputVolume / 100, mute: s.outputMuted }) })()'))
    return v && { ...v, saver: false, night }
  }
  if (op === 'vol' && /^(0(\.\d+)?|1(\.0+)?)$/.test(arg)) return (await osa(['-e', `set volume output volume ${Math.round(Number(arg) * 100)}`])) !== null ? { ok: true } : null
  if (op === 'mute' && /^[01]$/.test(arg)) return (await osa(['-e', `set volume ${arg === '1' ? 'with' : 'without'} output muted`])) !== null ? { ok: true } : null
  return null
}

// power tab: lock = display sleep (locks when the Mac asks for the password at once); the rest asks macOS to do it
const POWER = {
  lock: ['pmset', ['displaysleepnow']],
  sleep: ['pmset', ['sleepnow']],
  signout: ['osascript', ['-e', 'tell application "loginwindow" to «event aevtrlgo»']],
  restart: ['osascript', ['-e', 'tell application "loginwindow" to «event aevtrrst»']],
  shutdown: ['osascript', ['-e', 'tell application "loginwindow" to «event aevtrsdn»']],
}

// the Joint Remote announcement through macOS' own Bonjour tool, same name, type and TXT keys as announce.ps1
function announce(name, port, id) {
  // wait for the old one to be gone: run alongside, pkill also killed the new announcement  try { require('child_process').execFileSync('pkill', ['-f', 'dns-sd -R .* _jointremote._tcp']) } catch {} // exit 1 = none running
  return require('child_process').spawn('dns-sd', ['-R', name, '_jointremote._tcp', 'local', String(port), `id=${id}`, 'kind=desktop'], { stdio: 'ignore' })
}

module.exports = { cmd, POWER, announce, radios, traffic, dockHidden, setDockHidden, media2speed, parseServices, byBand }

// quick checks, no Mac needed: node electron/mac.cjs --selftest
if (process.argv.includes('--selftest')) {
  const assert = require('assert')
  ;(async () => {
    assert.strictEqual(await cmd('appbar 1 2 3'), null) // no Mac equivalent: answers like a failed command
    assert.strictEqual(await cmd('vol 7'), null)        // out of range never reaches osascript
    assert.strictEqual(await cmd('mute x'), null)
    assert.ok(['lock', 'sleep', 'signout', 'restart', 'shutdown'].every((k) => POWER[k]))
    const sv = parseServices(['An asterisk (*) denotes that a network service is disabled.', '(1) USB 10/100/1000 LAN',
      '(Hardware Port: USB 10/100/1000 LAN, Device: en6)', '', '(2) Wi-Fi', '(Hardware Port: Wi-Fi, Device: en0)', '',
      '(*) Bluetooth PAN', '(Hardware Port: Bluetooth PAN, Device: en3)', ''].join(String.fromCharCode(10)))
    assert.deepStrictEqual(sv.map((x) => [x.name, x.port, x.device, x.off]), [['USB 10/100/1000 LAN', 'USB 10/100/1000 LAN', 'en6', false], ['Wi-Fi', 'Wi-Fi', 'en0', false], ['Bluetooth PAN', 'Bluetooth PAN', 'en3', true]])
    assert.deepStrictEqual(byBand(['Home', 'Home-5G']), ['Home-5G', 'Home'])
    assert.strictEqual(media2speed('1000baseT'), '1 Gbps')
    assert.strictEqual(media2speed('100baseTX'), '100 Mbps')
    assert.strictEqual(media2speed('none'), '')
    assert.strictEqual(await cmd('winkey Z'), null)   // only the mapped Windows keys do something
    assert.strictEqual(await cmd('key 999'), null)
    console.log('mac selftest ok')
  })()
}
