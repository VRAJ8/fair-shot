// GSAP + Lenis wiring. Lenis drives smooth scrolling; ScrollTrigger reads it.
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin)

export const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

let lenis: Lenis | null = null

export function startSmoothScroll() {
  if (lenis || reducedMotion) return lenis
  lenis = new Lenis({ lerp: 0.11 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis?.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
  return lenis
}

export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true })
  else window.scrollTo(0, 0)
}

export function scrollToEl(target: string) {
  if (lenis) lenis.scrollTo(target, { offset: -70, duration: 1.4 })
  else document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' })
}

export { gsap, ScrollTrigger, SplitText }
