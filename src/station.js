import { useEffect, useState } from 'react'
import { house } from './house.js'

// parts that live on one PC (house.json "station"): when HA says that PC is off they show "<name> is off" instead of
// errors. "station": { "name": the PC's name (its server tile), "sensor": HA's on/off binary_sensor for it ("off" =
// off or asleep; "unavailable" = unknown, the normal look), "only": a regex of the entities that live on it }.
// Relay tiles count too (they ask Claude sessions that run on that PC). No "station": nothing is ever shown off.
const conf = () => house.station ?? {}
let only = null, onlySrc = null
const onlyRe = () => { const s = conf().only; if (s !== onlySrc) { onlySrc = s; try { only = s ? new RegExp(s) : null } catch { only = null } } return only }
export const stationOnly = (x) => !!x && !!conf().sensor && (!!x.relay || (!!conf().name && x.name === conf().name && !!x.apps) || !!onlyRe()?.test(x.entity ?? ''))
export const OFF_TEXT = '{pc} is off'

let off = false, users = 0, timer = null
const subs = new Set()
const read = () => !conf().sensor ? Promise.resolve() : (window.art?.ha('states', [conf().sensor]) ?? Promise.resolve({})).then((r) => {
  const now = r?.value?.[conf().sensor]?.state === 'off'
  if (now !== off) { off = now; subs.forEach((f) => f(off)) }
})
// true only while HA reports the PC off; one shared poll for every component
export function useStationOff() {
  const [v, setV] = useState(off)
  useEffect(() => {
    subs.add(setV); setV(off)
    if (users++ === 0) { read(); timer = setInterval(read, 10000) }
    return () => { subs.delete(setV); if (--users === 0) clearInterval(timer) }
  }, [])
  return v
}
