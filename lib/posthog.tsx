'use client'

// ─── PostHog (analytics + session replay) ─────────────────────────────────────
// Free tier: 1M events / 5K session recordings per month.
// Required env: NEXT_PUBLIC_POSTHOG_KEY (and optionally NEXT_PUBLIC_POSTHOG_HOST)
// If the key is missing the SDK is simply not initialised — the app keeps working.

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useEffect, type ReactNode } from 'react'

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key) return // No key configured (local dev without env, etc.) — silently skip.

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      person_profiles: 'always',
      // Vercel Analytics already counts page views; PostHog handles its own automatically.
      capture_pageview: true,
      capture_pageleave: true,
      // Session replay (heatmaps + click recordings) — start sampled to stay within free tier.
      session_recording: {
        maskAllInputs: false,
        maskTextSelector: '[data-ph-mask]', // Use this attribute to mask any sensitive UI
      },
      autocapture: true,
      // Don't capture in dev so local clicks don't pollute analytics.
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') ph.opt_out_capturing()
      },
    })
  }, [])

  return <PHProvider client={posthog}>{children}</PHProvider>
}

/**
 * Capture a custom event from anywhere in the client tree.
 * Safe to call before PostHog finishes initializing — events are queued.
 */
export function capture(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  try {
    posthog.capture(event, props)
  } catch {
    /* posthog not loaded yet or blocked by adblocker — noop */
  }
}
