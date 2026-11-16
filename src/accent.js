import { useEffect, useState } from 'react'

// the A.R.T. accent colour: index.css's --color-accent (#E8650A) is the fallback;
// main resolves this device's override, else the master's shared "accent", and every window follows it live.
// Same names as JLDL/JLDW's accent.js.
export const FALLBACK = '#E8650A'
// the colour now, for canvas and Leaflet (CSS and SVG classes use var(--color-accent) directly)
export const accentNow = () => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || FALLBACK
export const applyAccent = (a) => a?.accent && document.documentElement.style.setProperty('--color-accent', a.accent)
// once per window, before the first render
export const startAccent = () => {
  window.art?.accent?.onChange(applyAccent)
  return window.art?.accent ? window.art.accent.get().then(applyAccent, () => {}) : Promise.resolve()
}
// { accent, local, shared } as main reports it, kept current
export function useAccent() {
  const [a, setA] = useState(null)
  useEffect(() => { window.art?.accent?.get().then(setA, () => {}); window.art?.accent?.onChange(setA) }, [])
  return a
}
