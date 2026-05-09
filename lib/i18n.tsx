'use client'

// ─── Lightweight i18n ─────────────────────────────────────────────────────────
// Single-page bilingual UI. Persists the chosen locale in localStorage.
// Usage:
//   const t = useT()
//   t('search.label') → "曲を検索して追加" / "Search a track"
//   t('count.tracks', { n: 5 }) → "5曲" / "5 tracks"

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type Locale = 'ja' | 'en'

type Messages = Record<string, string>

const ja: Messages = {
  // Header
  'header.tagline': '好きな曲を選んでブリッジ曲を自動提案。BPM・Camelot互換でスムーズにミックス。',
  'header.poweredBy': 'Powered by Camelot & BPM',

  // Search
  'search.label': '曲を検索して追加',
  'search.placeholder': '曲名 / アーティスト名...',
  'search.searching': '検索中…',

  // Playlist import
  'playlist.label': 'Spotifyプレイリストから読み込む',
  'playlist.placeholder': 'https://open.spotify.com/playlist/...',
  'playlist.load': '読み込む',

  // Selected tracks
  'selected.label': '選択した曲',
  'selected.maxSuffix': '/ {n}曲',
  'selected.clear': 'クリア',
  'selected.minHint': '曲を2つ以上追加してください',

  // BPM tolerance
  'tolerance.label': 'BPM許容差',

  // Suggest button & loading
  'suggest.button': 'ブリッジ曲を提案する',
  'suggest.searching': '検索中…',
  'suggest.analyzing': 'BPMを解析中… ({n}曲)',
  'suggest.loadingTitle': 'ブリッジ曲を探しています…',
  'suggest.loadingSub.duration': '30〜60秒かかります',
  'suggest.loadingSub.waitAnalysis': '解析が終わると提案できます',

  // Track row
  'track.title.reanalyze': 'BPM・Keyを再解析',
  'track.title.showPool': '候補曲一覧を表示',
  'track.btn.close': '閉じる',
  'track.btn.candidates': '候補',
  'track.tolerance.warn': 'BPM差が{n}を超えています',

  // Result playlist
  'result.title': '提案されたミックス',
  'result.tracksSuffix': '{n}曲',
  'result.copy': 'コピー',
  'result.copied': 'コピーしました',

  // Candidate pool
  'pool.headerCount': '候補',
  'pool.tracksWord': '曲',
  'pool.swapHint': '— クリックで差し替え',
  'pool.col.title': '曲名',
  'pool.col.diff': '差',
  'pool.selected': '選択中',

  // Usage guide
  'guide.title': '使い方ガイド',
  'guide.bullet.bridge': '紫のカードがAIが追加したブリッジ曲です',
  'guide.bullet.camelot': 'Camelotの数字が近いほど、ハーモニックに繋がりやすいです',
  'guide.bullet.bpmDash': 'BPMが「—」の曲はプレビュー音源からBPMを取得できませんでした',

  // Footer / About
  'about.title': 'DJ Mix Suggester とは',
  'about.p1.before': '曲名やSpotifyプレイリストを入力するだけで、',
  'about.p1.bpmStrong': 'BPM（テンポ）',
  'about.p1.middle': 'と',
  'about.p1.camelotStrong': 'Camelotキー（ハーモニックミキシング）',
  'about.p1.after': 'の互換性を考慮し、滑らかに繋がるDJミックスのセットリストを自動生成するWebツールです。',
  'about.p2.before': '曲と曲のBPM差が大きい区間には、AIが知識ベースから',
  'about.p2.bridgeStrong': 'ブリッジ曲',
  'about.p2.after': 'を提案して挿入します。Camelot wheelの隣接キー判定により、キーの衝突しない選曲が可能です。',
  'about.p3': 'インストール不要・登録不要。ブラウザだけでDJの選曲・繋ぎを補助します。',
  'about.tag.bpmMatch': 'BPMマッチング',
  'about.tag.camelotCompat': 'Camelot互換',
  'about.tag.harmonic': 'ハーモニックミキシング',
  'about.tag.aiBridge': 'AIブリッジ提案',
  'about.tag.playlistGen': 'プレイリスト生成',

  // Support / Buy Me a Coffee
  'support.invite': 'このツールが役に立ったら、コーヒー一杯ぶんの応援をいただけると嬉しいです。',
  'support.button': '☕ Buy me a coffee',
}

const en: Messages = {
  // Header
  'header.tagline': 'Pick songs you love and let AI suggest bridge tracks. Smooth mixing via BPM & Camelot key compatibility.',
  'header.poweredBy': 'Powered by Camelot & BPM',

  // Search
  'search.label': 'Search & add tracks',
  'search.placeholder': 'Track name / artist...',
  'search.searching': 'Searching…',

  // Playlist import
  'playlist.label': 'Import from Spotify playlist',
  'playlist.placeholder': 'https://open.spotify.com/playlist/...',
  'playlist.load': 'Load',

  // Selected tracks
  'selected.label': 'Selected tracks',
  'selected.maxSuffix': '/ {n} tracks',
  'selected.clear': 'Clear',
  'selected.minHint': 'Please add at least 2 tracks',

  // BPM tolerance
  'tolerance.label': 'BPM tolerance',

  // Suggest button & loading
  'suggest.button': 'Suggest bridge tracks',
  'suggest.searching': 'Searching…',
  'suggest.analyzing': 'Analyzing BPM… ({n} tracks)',
  'suggest.loadingTitle': 'Finding bridge tracks…',
  'suggest.loadingSub.duration': 'This takes 30–60 seconds',
  'suggest.loadingSub.waitAnalysis': 'Ready to suggest after analysis completes',

  // Track row
  'track.title.reanalyze': 'Re-analyze BPM & Key',
  'track.title.showPool': 'Show candidate tracks',
  'track.btn.close': 'Close',
  'track.btn.candidates': 'Candidates',
  'track.tolerance.warn': 'BPM gap exceeds {n}',

  // Result playlist
  'result.title': 'Suggested mix',
  'result.tracksSuffix': '{n} tracks',
  'result.copy': 'Copy',
  'result.copied': 'Copied',

  // Candidate pool
  'pool.headerCount': 'Candidates',
  'pool.tracksWord': 'tracks',
  'pool.swapHint': '— click to swap',
  'pool.col.title': 'Track',
  'pool.col.diff': 'Δ',
  'pool.selected': 'Selected',

  // Usage guide
  'guide.title': 'How to read',
  'guide.bullet.bridge': 'Purple cards are bridge tracks added by AI',
  'guide.bullet.camelot': 'Closer Camelot numbers connect more harmonically',
  'guide.bullet.bpmDash': 'Tracks with "—" BPM had no preview audio for analysis',

  // Footer / About
  'about.title': 'About DJ Mix Suggester',
  'about.p1.before': 'Enter song names or a Spotify playlist URL, and the tool considers ',
  'about.p1.bpmStrong': 'BPM (tempo)',
  'about.p1.middle': ' and ',
  'about.p1.camelotStrong': 'Camelot key (harmonic mixing)',
  'about.p1.after': ' compatibility to auto-generate a smoothly connected DJ set.',
  'about.p2.before': 'Where adjacent tracks have a large BPM gap, AI proposes ',
  'about.p2.bridgeStrong': 'bridge tracks',
  'about.p2.after': ' from its music knowledge base. Camelot wheel adjacency keeps keys from clashing.',
  'about.p3': 'No install, no signup. Your browser is enough to assist DJ selection and transitions.',
  'about.tag.bpmMatch': 'BPM matching',
  'about.tag.camelotCompat': 'Camelot compatible',
  'about.tag.harmonic': 'Harmonic mixing',
  'about.tag.aiBridge': 'AI bridge suggestions',
  'about.tag.playlistGen': 'Playlist generation',

  // Support / Buy Me a Coffee
  'support.invite': 'If this tool helps you, consider buying me a coffee — it keeps the project going.',
  'support.button': '☕ Buy me a coffee',
}

const dictionaries: Record<Locale, Messages> = { ja, en }

// ─── Context ──────────────────────────────────────────────────────────────────

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const STORAGE_KEY = 'djmix.locale'

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'ja' // SSR fallback (page initial render is always 'ja' to match metadata)
  const saved = window.localStorage.getItem(STORAGE_KEY) as Locale | null
  if (saved === 'ja' || saved === 'en') return saved
  // Browser language detection — anything that isn't Japanese gets English
  const navLang = window.navigator.language || (window.navigator as Navigator & { userLanguage?: string }).userLanguage || ''
  return navLang.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Always start as 'ja' on server + first client render to avoid hydration mismatch.
  // Then upgrade to actual preference in useEffect.
  const [locale, setLocaleState] = useState<Locale>('ja')

  useEffect(() => {
    const initial = detectInitialLocale()
    if (initial !== 'ja') setLocaleState(initial)
  }, [])

  function setLocale(l: Locale) {
    setLocaleState(l)
    try { window.localStorage.setItem(STORAGE_KEY, l) } catch { /* noop */ }
    // Update <html lang="..."> for accessibility & screen readers
    if (typeof document !== 'undefined') document.documentElement.lang = l
  }

  const t = useMemo(() => {
    const dict = dictionaries[locale]
    return (key: string, params?: Record<string, string | number>): string => {
      let s = dict[key] ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = s.replaceAll(`{${k}}`, String(v))
        }
      }
      return s
    }
  }, [locale])

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used inside <LanguageProvider>')
  return ctx
}

export function useT() {
  return useLocale().t
}
