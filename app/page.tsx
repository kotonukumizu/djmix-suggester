'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Track } from '@/types'
import { camelotColor, camelotCompatibility, Compatibility } from '@/lib/camelot'
import { analyzeTrack } from '@/lib/client-analyze'

// ─── Audio Preview ────────────────────────────────────────────────────────────

function AudioBtn({ url }: { url: string | null }) {
  const [playing, setPlaying] = useState(false)
  const ref = useRef<HTMLAudioElement | null>(null)

  useEffect(() => () => { ref.current?.pause() }, [])

  if (!url) return <span className="w-7 h-7" />

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!ref.current) {
      ref.current = new Audio(url!)
      ref.current.onended = () => setPlaying(false)
    }
    if (playing) { ref.current.pause(); setPlaying(false) }
    else { ref.current.play(); setPlaying(true) }
  }

  return (
    <button
      onClick={toggle}
      className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 shrink-0 ${
        playing
          ? 'bg-purple-500/25 border border-purple-400/60 text-purple-300 shadow-[0_0_8px_rgba(168,85,247,0.3)]'
          : 'bg-white/5 hover:bg-purple-500/15 border border-white/10 hover:border-purple-500/40 text-white/45 hover:text-purple-300'
      }`}
      title="Preview"
    >
      {playing ? (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
          <rect x="1" y="1" width="3" height="8" rx="0.5" /><rect x="6" y="1" width="3" height="8" rx="0.5" />
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
          <polygon points="2,1 9,5 2,9" />
        </svg>
      )}
    </button>
  )
}

// ─── Camelot Badge ─────────────────────────────────────────────────────────

function CamelotBadge({ camelot, analyzing }: { camelot: string | null; analyzing?: boolean }) {
  const color = camelotColor(camelot)
  return (
    <span
      className={`inline-flex items-center justify-center w-11 h-6 rounded-md text-[11px] font-bold tracking-wide shrink-0 ${analyzing && !camelot ? 'animate-pulse' : ''}`}
      style={{
        backgroundColor: color + '22',
        color,
        border: `1px solid ${color}44`,
        textShadow: `0 0 10px ${color}99`,
        boxShadow: `0 0 6px ${color}18`,
      }}
    >
      {analyzing && !camelot ? '…' : (camelot ?? '—')}
    </span>
  )
}

// ─── BPM Badge ─────────────────────────────────────────────────────────────

function BpmBadge({ bpm, analyzing }: { bpm: number | null; analyzing?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center px-2.5 h-6 rounded-md text-[11px] font-mono font-semibold bg-white/5 text-white/50 border border-white/10 shrink-0 tracking-tight ${analyzing && !bpm ? 'animate-pulse' : ''}`}>
      {analyzing && !bpm ? '…' : (bpm ? `${bpm}` : '—')}
      {bpm && <span className="text-white/25 ml-0.5 text-[9px] font-normal not-italic">BPM</span>}
    </span>
  )
}

// ─── Compatibility Connector ───────────────────────────────────────────────

const COMPAT_STYLE: Record<Compatibility, { color: string; label: string }> = {
  perfect: { color: '#10b981', label: 'Perfect' },
  good:    { color: '#34d399', label: 'Good' },
  ok:      { color: '#f59e0b', label: 'OK' },
  poor:    { color: '#ef4444', label: 'Poor' },
  unknown: { color: '#4b5563', label: '—' },
}

// Effective BPM diff: considers ×2/÷2 double-half-tempo equivalence (mirrors server-side algorithm)
// e.g. effectiveBpmDiff(101, 179) = min(78, 23, 257, 128.5, |101-89.5|=11.5) = 11.5
// e.g. effectiveBpmDiff(70,  130) = min(60, 10,  190, 95,   |70-65|=5)        = 5
function effectiveBpmDiff(a: number, b: number): number {
  return Math.min(
    Math.abs(a - b),
    Math.abs(a * 2 - b),
    Math.abs(a - b * 2),
    Math.abs(a / 2 - b),
    Math.abs(a - b / 2),
  )
}

/**
 * BPMフローを悪化させるブリッジを除去する。
 * 各ブリッジの「左→ブリッジ」「ブリッジ→右」の最悪ステップが、
 * そのブリッジをスキップしたときのステップ以上なら除去する。
 * 除去が連鎖する可能性があるため、変化がなくなるまで繰り返す。
 *
 * Returns: pruned playlist + kept[] (original indices that survived)
 */
function pruneIneffectiveBridges(playlist: Track[]): { pruned: Track[]; kept: number[] } {
  type Tagged = { track: Track; origIdx: number }
  let current: Tagged[] = playlist.map((t, i) => ({ track: t, origIdx: i }))

  let changed = true
  while (changed) {
    changed = false
    const next: Tagged[] = []
    for (let i = 0; i < current.length; i++) {
      const { track, origIdx } = current[i]
      // Non-bridge tracks always kept; bridges without BPM can't be evaluated → keep
      if (!track.isBridge || track.bpm == null) {
        next.push({ track, origIdx }); continue
      }
      const prev = next.length > 0 ? next[next.length - 1].track : null
      const after = i + 1 < current.length ? current[i + 1].track : null
      if (!prev || !after || prev.bpm == null || after.bpm == null) {
        next.push({ track, origIdx }); continue
      }
      const leftDiff   = effectiveBpmDiff(prev.bpm,  track.bpm)
      const rightDiff  = effectiveBpmDiff(track.bpm, after.bpm)
      const bypassDiff = effectiveBpmDiff(prev.bpm,  after.bpm)
      // Prune if the worst step through this bridge ≥ skipping it entirely
      if (Math.max(leftDiff, rightDiff) >= bypassDiff) {
        changed = true // pruned — don't push
      } else {
        next.push({ track, origIdx })
      }
    }
    current = next
  }

  return {
    pruned: current.map((x) => x.track),
    kept:   current.map((x) => x.origIdx),
  }
}

function TransitionLine({ from, to, tolerance = 7 }: { from: Track; to: Track; tolerance?: number }) {
  const compat = camelotCompatibility(from.camelot, to.camelot)
  const { label, color: keyColor } = COMPAT_STYLE[compat]

  const effDiff = from.bpm && to.bpm ? effectiveBpmDiff(from.bpm, to.bpm) : null
  const bpmOk = effDiff === null || effDiff <= tolerance

  // BPMの色（ライン・背景に使用）
  const bpmColor = effDiff === null
    ? '#4b5563'
    : effDiff <= tolerance / 2 ? '#10b981'
    : effDiff <= tolerance     ? '#f59e0b'
    : '#ef4444'

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 ml-14">
      <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, transparent, ${bpmColor}20, ${bpmColor}45, ${bpmColor}20, transparent)` }} />
      <div
        className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-medium"
        style={{
          backgroundColor: bpmColor + '0e',
          border: `1px solid ${bpmColor}30`,
        }}
      >
        {!bpmOk && (
          <span title={`BPM差が${tolerance}を超えています`} className="text-red-400 text-[11px]">⚠</span>
        )}
        {effDiff !== null && (
          <span className="font-mono font-semibold" style={{ color: bpmColor }}>
            {`±${Math.round(effDiff)}`}
            <span className="ml-0.5 font-normal text-[9px]" style={{ color: bpmColor, opacity: 0.55 }}>BPM</span>
          </span>
        )}
        {effDiff !== null && <span className="opacity-15 text-[8px] text-white">|</span>}
        {/* Key互換 — テキスト色は固定。小ドットでクオリティを示す */}
        <span className="flex items-center gap-1">
          <span style={{ color: keyColor }} className="text-[6px] leading-none">●</span>
          <span className="font-semibold text-white/40">{`Key : ${label}`}</span>
        </span>
        {from.camelot && to.camelot && (
          <span className="font-mono text-[9px] text-white/22">{`${from.camelot}→${to.camelot}`}</span>
        )}
      </div>
      <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, transparent, ${bpmColor}20, ${bpmColor}45, ${bpmColor}20, transparent)` }} />
    </div>
  )
}

// ─── Track Card ────────────────────────────────────────────────────────────

function TrackCard({
  track, onRemove, onTogglePool, onRetryAnalyze, isBridge, index,
  dragHandle, analyzing, poolExpanded, showBadges = true,
}: {
  track: Track
  onRemove?: () => void
  onTogglePool?: () => void
  onRetryAnalyze?: () => void
  isBridge?: boolean
  index?: number
  dragHandle?: React.ReactNode
  analyzing?: boolean
  poolExpanded?: boolean
  showBadges?: boolean
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 group transition-all duration-200 ${
      isBridge
        ? 'bg-gradient-to-r from-purple-950/50 to-purple-900/20 border border-purple-500/40 shadow-[0_0_16px_rgba(168,85,247,0.1),inset_0_1px_0_rgba(168,85,247,0.08)] hover:shadow-[0_0_22px_rgba(168,85,247,0.16),inset_0_1px_0_rgba(168,85,247,0.1)] hover:border-purple-400/50'
        : 'bg-[#13131f] border border-white/7 hover:border-white/14 hover:bg-[#141420]'
    }`}>
      {dragHandle}
      {index !== undefined && (
        <span className={`text-[11px] font-mono w-5 text-right shrink-0 tabular-nums ${isBridge ? 'text-purple-400/40' : 'text-white/18'}`}>{index + 1}</span>
      )}
      {track.albumArt ? (
        <Image src={track.albumArt} alt={track.name} width={44} height={44}
          className={`rounded-lg shrink-0 object-cover ${isBridge ? 'shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-1 ring-purple-500/40' : 'shadow-md'}`} />
      ) : (
        <div className={`w-11 h-11 rounded-lg shrink-0 flex items-center justify-center ${isBridge ? 'bg-purple-900/40 ring-1 ring-purple-500/25' : 'bg-white/6'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={isBridge ? 'text-purple-400/40' : 'text-white/15'}>
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-tight truncate ${isBridge ? 'text-purple-50' : 'text-white/95'}`}>{track.name}</p>
        <p className={`text-xs truncate mt-0.5 ${isBridge ? 'text-purple-300/50' : 'text-white/38'}`}>{track.artist}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {showBadges && <BpmBadge bpm={track.bpm} analyzing={analyzing} />}
        {showBadges && !analyzing && track.bpm == null && onRetryAnalyze && (
          <button
            onClick={onRetryAnalyze}
            className="w-5 h-5 rounded-full flex items-center justify-center text-white/25 hover:text-purple-300 hover:bg-purple-500/15 transition-all duration-150 shrink-0"
            title="BPM・Keyを再解析"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
        )}
        {showBadges && <CamelotBadge camelot={track.camelot} analyzing={analyzing} />}
        <AudioBtn url={track.previewUrl} />
        {isBridge && (
          <span
            className="text-purple-300 text-[9px] font-bold uppercase px-2 py-1 rounded-md bg-purple-500/15 border border-purple-400/30"
            style={{ letterSpacing: '0.12em' }}
          >
            Bridge
          </span>
        )}
        {onTogglePool && (
          <button
            onClick={onTogglePool}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-[0.1em] transition-all duration-200 shrink-0 border ${
              poolExpanded
                ? 'text-amber-300 bg-amber-500/12 border-amber-500/28'
                : 'text-purple-400/60 hover:text-purple-200 bg-purple-500/8 hover:bg-purple-500/18 border-purple-500/20 hover:border-purple-400/38'
            }`}
            title="候補曲一覧を表示"
          >
            {poolExpanded ? '閉じる' : '候補'}
          </button>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            className="w-6 h-6 rounded-full flex items-center justify-center text-white/18 hover:text-white/65 hover:bg-white/8 transition-all duration-150 opacity-0 group-hover:opacity-100"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Sortable Card ─────────────────────────────────────────────────────────

function SortableCard({ track, onRemove, analyzing, onRetryAnalyze }: { track: Track; onRemove: () => void; analyzing?: boolean; onRetryAnalyze?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: track.spotifyId })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <TrackCard
        track={track}
        onRemove={onRemove}
        analyzing={analyzing}
        onRetryAnalyze={onRetryAnalyze}
        dragHandle={
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-white/15 hover:text-white/40 transition-colors shrink-0 touch-none"
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
              <circle cx="3" cy="3" r="1.5" /><circle cx="9" cy="3" r="1.5" />
              <circle cx="3" cy="8" r="1.5" /><circle cx="9" cy="8" r="1.5" />
              <circle cx="3" cy="13" r="1.5" /><circle cx="9" cy="13" r="1.5" />
            </svg>
          </button>
        }
      />
    </div>
  )
}

// ─── BPM Analysis with Retry ──────────────────────────────────────────────
// BPMが取得できなかった場合のみリトライする。
// Deezerプレビューが一時的に取得できない・タイムアウトなどの場合に有効。
// "プレビュー自体が存在しない" ケースはリトライしても同じ結果になるが無害。
const ANALYZE_MAX_RETRIES = 2

async function analyzeTrackWithRetry(
  spotifyId: string,
  artist: string,
  title: string,
  previewUrl?: string | null,
): Promise<{ spotifyId: string; bpm: number | null; camelot: string | null }> {
  for (let attempt = 0; attempt <= ANALYZE_MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 700 * attempt))
    const result = await analyzeTrack(spotifyId, artist, title, previewUrl)
      .catch(() => ({ spotifyId, bpm: null as number | null, camelot: null as string | null }))
    if (result.bpm != null) return result
  }
  return { spotifyId, bpm: null, camelot: null }
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function Home() {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Track[]>([])
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([])
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [suggestedPlaylist, setSuggestedPlaylist] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [copied, setCopied] = useState(false)
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set())
  const [inputAnalyzingIds, setInputAnalyzingIds] = useState<Set<string>>(new Set())
  const [bpmTolerance, setBpmTolerance] = useState(7)
  const maxTracks = 25
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ブリッジ候補プール（インデックス → オリジナル候補一覧）
  const originalCandidatesRef = useRef<Map<number, Track[]>>(new Map())
  const [expandedPoolIndices, setExpandedPoolIndices] = useState<Set<number>>(new Set())
  const [candidateAnalysis, setCandidateAnalysis] = useState<Map<string, { bpm: number | null; camelot: string | null }>>(new Map())
  const analyzingCandidateIdsRef = useRef<Set<string>>(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleSearch = useCallback((value: string) => {
    setQuery(value)
    if (!value.trim()) { setSearchResults([]); return }
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setSearching(true)
      const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`)
      setSearchResults(await res.json())
      setSearching(false)
    }, 400)
  }, [])

  function sortByBpm(tracks: Track[]): Track[] {
    return [...tracks].sort((a, b) => {
      if (a.bpm == null && b.bpm == null) return 0
      if (a.bpm == null) return 1
      if (b.bpm == null) return -1
      return a.bpm - b.bpm
    })
  }

  function analyzeInputTrack(track: Track) {
    setInputAnalyzingIds((prev) => new Set([...prev, track.spotifyId]))
    analyzeTrackWithRetry(track.spotifyId, track.artist, track.name, track.previewUrl)
      .then(({ spotifyId, bpm, camelot }) => {
        setSelectedTracks((prev) => {
          const updated = prev.map((t) => t.spotifyId === spotifyId ? { ...t, bpm, camelot } : t)
          return sortByBpm(updated)
        })
        setInputAnalyzingIds((prev) => { const next = new Set(prev); next.delete(spotifyId); return next })
      })
  }

  async function handleLoadPlaylist() {
    if (!playlistUrl.trim()) return
    setLoading(true)
    const res = await fetch(`/api/playlist?url=${encodeURIComponent(playlistUrl)}`)
    const data: Track[] = await res.json()
    const tracks = data.slice(0, maxTracks)
    setSelectedTracks(tracks)
    setLoading(false)
    tracks.forEach(analyzeInputTrack)
  }

  function addTrack(track: Track) {
    if (selectedTracks.find((t) => t.spotifyId === track.spotifyId)) return
    setSelectedTracks((p) => [...p, track])
    setSearchResults([])
    setQuery('')
    analyzeInputTrack(track)
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setSelectedTracks((tracks) => {
      const oldIdx = tracks.findIndex((t) => t.spotifyId === active.id)
      const newIdx = tracks.findIndex((t) => t.spotifyId === over.id)
      return arrayMove(tracks, oldIdx, newIdx)
    })
  }

  // Phase 1: ブリッジ曲など未解析曲を解析してBPM/Camelotを表示
  // Phase 2: 全解析完了後、BPMが悪いブリッジを候補曲と入れ替え
  // Phase 3: BPMフローを悪化させるブリッジを除去
  async function analyzeAndOptimizeBridges(playlist: Track[]) {
    // ── Phase 1: BPM未取得の曲だけを並列解析（入力曲はスキップ） ─────────
    const tracksToAnalyze = playlist.filter((t) => t.bpm == null)
    const ids = new Set(tracksToAnalyze.map((t) => t.spotifyId))
    setAnalyzingIds(ids)

    const phase1Results = new Map<string, { bpm: number | null; camelot: string | null }>(
      // 既にBPMが分かっている曲をあらかじめ登録
      playlist
        .filter((t) => t.bpm != null)
        .map((t) => [t.spotifyId, { bpm: t.bpm, camelot: t.camelot }])
    )

    await Promise.all(
      tracksToAnalyze.map((track) =>
        analyzeTrackWithRetry(track.spotifyId, track.artist, track.name, track.previewUrl)
          .then(({ spotifyId, bpm, camelot }) => {
            phase1Results.set(spotifyId, { bpm, camelot })
            setSuggestedPlaylist((prev) =>
              prev.map((t) => t.spotifyId === spotifyId ? { ...t, bpm, camelot } : t)
            )
            setAnalyzingIds((prev) => { const s = new Set(prev); s.delete(spotifyId); return s })
          })
      )
    )

    // Phase 1 完了後: インメモリのワーキングプレイリストを構築
    // （以降の Phase 2/3 はここを基準に操作し、最後にまとめて setState する）
    let workingPlaylist: Track[] = playlist.map((t) => {
      const r = phase1Results.get(t.spotifyId)
      return r ? { ...t, bpm: r.bpm, camelot: r.camelot } : t
    })

    // ── Phase 2: 全候補を並列解析し、targetBPMに最も近い曲を選ぶ ──────────
    // インデックスベースで管理することで、同一 spotifyId のブリッジが複数あっても安全
    const bridgesWithCandidates = playlist
      .map((t, i) => ({ track: t, idx: i }))
      .filter(({ track: t }) => t.isBridge && t.targetBpm != null && t.candidates && t.candidates.length > 0)

    for (const { track: bridge, idx: bridgeIdx } of bridgesWithCandidates) {
      const primaryBpm = workingPlaylist[bridgeIdx].bpm
      const target = bridge.targetBpm!
      const currentDiff = primaryBpm != null ? effectiveBpmDiff(primaryBpm, target) : Infinity

      // 完璧一致ならスキップ
      if (currentDiff === 0) continue

      // 全候補を並列解析
      const results = await Promise.all(
        bridge.candidates!.map((c) =>
          analyzeTrackWithRetry(c.spotifyId, c.artist, c.name, c.previewUrl)
            .then((r) => ({ ...r, candidate: c }))
        )
      )

      // targetBPMに最も近い候補を選ぶ（現在のブリッジより悪ければ差し替えない）
      let bestDiff = currentDiff
      let best: { candidate: Track; bpm: number; camelot: string | null } | null = null
      for (const r of results) {
        if (r.bpm == null) continue
        const diff = effectiveBpmDiff(r.bpm, target)
        if (diff < bestDiff) { bestDiff = diff; best = { candidate: r.candidate, bpm: r.bpm, camelot: r.camelot } }
      }

      if (!best) continue

      const replacement: Track = {
        ...best.candidate,
        isBridge: true,
        targetBpm: target,
        bpm: best.bpm,
        camelot: best.camelot,
        candidates: undefined,
      }
      workingPlaylist[bridgeIdx] = replacement
      setSuggestedPlaylist((prev) => prev.map((t, j) => j === bridgeIdx ? replacement : t))
    }

    // ── Phase 3: BPMフローを悪化させるブリッジを除去 ─────────────────────
    const { pruned, kept } = pruneIneffectiveBridges(workingPlaylist)
    if (pruned.length < workingPlaylist.length) {
      // 候補プールの参照を新しいインデックスに対応させる
      const newOriginals = new Map<number, Track[]>()
      kept.forEach((origIdx, newIdx) => {
        const pool = originalCandidatesRef.current.get(origIdx)
        if (pool) newOriginals.set(newIdx, pool)
      })
      originalCandidatesRef.current = newOriginals
      setSuggestedPlaylist(pruned)
    }
  }

  async function handleSuggest() {
    if (selectedTracks.length === 0) return
    setLoading(true)
    setSuggestedPlaylist([])
    const res = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: selectedTracks, bpmTolerance, maxSuggestions: maxTracks }),
    })
    const playlist: Track[] = await res.json()

    // selectedTracksで解析済みのBPM/Camelotをプレイリストのインプット曲に引き継ぐ
    // （サーバーサイドでは解析できないため、クライアント側で補完）
    const bpmMap = new Map(selectedTracks.map((t) => [t.spotifyId, { bpm: t.bpm, camelot: t.camelot }]))
    const enrichedPlaylist = playlist.map((track) => {
      const cached = bpmMap.get(track.spotifyId)
      if (cached?.bpm != null) return { ...track, bpm: cached.bpm, camelot: cached.camelot ?? null }
      return track
    })

    // 候補プールを初期化（ブリッジ曲の candidates[] をインデックスごとに保持）
    const originals = new Map<number, Track[]>()
    enrichedPlaylist.forEach((track, i) => {
      if (track.isBridge && track.candidates?.length) {
        originals.set(i, [...track.candidates])
      }
    })
    originalCandidatesRef.current = originals
    setExpandedPoolIndices(new Set())
    setCandidateAnalysis(new Map())

    setSuggestedPlaylist(enrichedPlaylist)
    setLoading(false)

    // クライアントサイドで BPM/Camelot を解析 → ブリッジ最適化
    await analyzeAndOptimizeBridges(enrichedPlaylist)
  }

  async function retryResultAnalysis(track: Track, index: number) {
    setAnalyzingIds((prev) => new Set([...prev, track.spotifyId]))
    const { spotifyId, bpm, camelot } = await analyzeTrackWithRetry(
      track.spotifyId, track.artist, track.name, track.previewUrl
    )
    setSuggestedPlaylist((prev) =>
      prev.map((t, j) => j === index ? { ...t, bpm, camelot } : t)
    )
    setAnalyzingIds((prev) => { const s = new Set(prev); s.delete(spotifyId); return s })
  }

  async function analyzeCandidatesForBridge(index: number) {
    const candidates = originalCandidatesRef.current.get(index) ?? []
    const toAnalyze = candidates.filter(
      (c) => !analyzingCandidateIdsRef.current.has(c.spotifyId) && !candidateAnalysis.has(c.spotifyId)
    )
    if (toAnalyze.length === 0) return
    toAnalyze.forEach((c) => analyzingCandidateIdsRef.current.add(c.spotifyId))
    await Promise.all(
      toAnalyze.map((c) =>
        analyzeTrackWithRetry(c.spotifyId, c.artist, c.name, c.previewUrl)
          .then(({ spotifyId, bpm, camelot }) => {
            analyzingCandidateIdsRef.current.delete(spotifyId)
            setCandidateAnalysis((prev) => new Map(prev).set(spotifyId, { bpm, camelot }))
          })
      )
    )
  }

  function toggleBridgePool(index: number) {
    const isOpen = expandedPoolIndices.has(index)
    setExpandedPoolIndices((prev) => {
      const next = new Set(prev)
      if (isOpen) next.delete(index)
      else next.add(index)
      return next
    })
    if (!isOpen) analyzeCandidatesForBridge(index)
  }

  async function selectCandidate(bridgeIndex: number, candidate: Track) {
    const targetBpm = suggestedPlaylist[bridgeIndex]?.targetBpm ?? null
    let bpm = candidateAnalysis.get(candidate.spotifyId)?.bpm ?? null
    let camelot = candidateAnalysis.get(candidate.spotifyId)?.camelot ?? null
    if (!candidateAnalysis.has(candidate.spotifyId)) {
      const result = await analyzeTrackWithRetry(candidate.spotifyId, candidate.artist, candidate.name, candidate.previewUrl)
      bpm = result.bpm
      camelot = result.camelot
      setCandidateAnalysis((prev) => new Map(prev).set(candidate.spotifyId, { bpm, camelot }))
    }
    setSuggestedPlaylist((prev) =>
      prev.map((t, j) =>
        j === bridgeIndex ? { ...candidate, isBridge: true, targetBpm, bpm, camelot } : t
      )
    )
    setExpandedPoolIndices((prev) => {
      const next = new Set(prev)
      next.delete(bridgeIndex)
      return next
    })
  }

  function copyPlaylist() {
    const text = suggestedPlaylist
      .map((t, i) => `${i + 1}. ${t.name} - ${t.artist}${t.bpm ? ` [${t.bpm} BPM]` : ''}${t.camelot ? ` [${t.camelot}]` : ''}${t.isBridge ? ' *bridge*' : ''}`)
      .join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <main className="min-h-screen bg-[#080810] text-white" style={{ backgroundImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(109,40,217,0.06) 0%, transparent 60%)' }}>
      <div className="max-w-2xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="mb-14">
          {/* Top accent line */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-purple-500/40 to-transparent mb-10" />
          <div className="flex items-center gap-4 mb-3">
            {/* Logo mark */}
            <div className="relative shrink-0">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-500 via-purple-700 to-purple-900 flex items-center justify-center shadow-[0_4px_20px_rgba(124,58,237,0.45)] ring-1 ring-purple-400/30">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.95 }}>
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="3" x2="12" y2="5" />
                  <line x1="12" y1="19" x2="12" y2="21" />
                  <line x1="3" y1="12" x2="5" y2="12" />
                  <line x1="19" y1="12" x2="21" y2="12" />
                </svg>
              </div>
              {/* glow */}
              <div className="absolute inset-0 rounded-2xl bg-purple-500/20 blur-md -z-10" />
            </div>
            <div>
              <h1 className="text-[1.6rem] font-black tracking-tight leading-none">
                <span className="bg-gradient-to-r from-white via-purple-100 to-purple-300 bg-clip-text text-transparent">
                  DJ Mix Suggester
                </span>
              </h1>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="h-px w-20 bg-gradient-to-r from-purple-500/70 to-transparent" />
                <span className="text-[9px] text-purple-400/60 uppercase tracking-[0.18em] font-bold">Powered by Camelot &amp; BPM</span>
              </div>
            </div>
          </div>
          <p className="text-white/30 text-[13px] ml-[3.75rem] leading-relaxed">好きな曲を選んでブリッジ曲を自動提案。BPM・Camelot互換でスムーズにミックス。</p>
        </div>

        {/* Search */}
        <section className="mb-6">
          <label className="flex items-center gap-2 text-[9px] text-purple-400/60 uppercase tracking-[0.18em] mb-3 font-bold">
            <span className="w-1 h-3 rounded-full bg-gradient-to-b from-purple-400/80 to-purple-600/40" />
            曲を検索して追加
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="曲名 / アーティスト名..."
              className="w-full bg-[#12121e] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-white/18 focus:outline-none focus:border-purple-500/50 focus:bg-[#13132a] focus:shadow-[0_0_0_2px_rgba(168,85,247,0.12),0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-200"
            />
            {searching && (
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/25 text-xs animate-pulse">検索中…</span>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="mt-1.5 rounded-xl border border-white/8 bg-[#0e0e1c] overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)]">
              {searchResults.map((t) => (
                <button
                  key={t.spotifyId}
                  onClick={() => addTrack(t)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-purple-500/10 focus:bg-purple-500/10 focus:outline-none transition-all duration-150 text-left border-b border-white/5 last:border-0 group/item"
                >
                  {t.albumArt
                    ? <Image src={t.albumArt} alt={t.name} width={36} height={36} className="rounded-lg shadow-md shrink-0" />
                    : <div className="w-9 h-9 rounded-lg bg-white/6 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-white/90 text-sm font-medium truncate group-hover/item:text-purple-100 transition-colors duration-100">{t.name}</p>
                    <p className="text-white/35 text-xs truncate mt-0.5">{t.artist}</p>
                  </div>
                  <span className="text-white/18 text-base shrink-0 group-hover/item:text-purple-400 transition-colors duration-100">＋</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Playlist Import */}
        <section className="mb-8">
          <label className="flex items-center gap-2 text-[9px] text-purple-400/60 uppercase tracking-[0.18em] mb-3 font-bold">
            <span className="w-1 h-3 rounded-full bg-gradient-to-b from-purple-400/80 to-purple-600/40" />
            Spotifyプレイリストから読み込む
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              placeholder="https://open.spotify.com/playlist/..."
              className="flex-1 bg-[#12121e] border border-white/8 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/18 focus:outline-none focus:border-purple-500/50 focus:bg-[#13132a] focus:shadow-[0_0_0_2px_rgba(168,85,247,0.12)] transition-all duration-200"
            />
            <button
              onClick={handleLoadPlaylist}
              disabled={loading}
              className="px-4 py-2.5 bg-white/6 hover:bg-white/10 border border-white/8 hover:border-purple-500/30 hover:text-purple-200 rounded-xl text-sm text-white/60 transition-all duration-200 disabled:opacity-40 shrink-0"
            >
              読み込む
            </button>
          </div>
        </section>

        {/* Selected Tracks */}
        {selectedTracks.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-[9px] text-purple-400/60 uppercase tracking-[0.18em] font-bold">
                <span className="w-1 h-3 rounded-full bg-gradient-to-b from-purple-400/80 to-purple-600/40" />
                選択した曲
                <span className="text-purple-400/90 font-extrabold text-[11px] normal-case tracking-tight tabular-nums">{selectedTracks.length}</span>
                <span className="text-white/18 text-[9px] font-normal normal-case tracking-normal">/ {maxTracks}曲</span>
              </label>
              <button
                onClick={() => setSelectedTracks([])}
                className="text-[11px] text-white/20 hover:text-white/45 transition-colors px-2.5 py-1 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/8"
              >
                クリア
              </button>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={selectedTracks.map((t) => t.spotifyId)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {selectedTracks.map((track) => (
                    <SortableCard
                      key={track.spotifyId}
                      track={track}
                      analyzing={inputAnalyzingIds.has(track.spotifyId)}
                      onRemove={() => setSelectedTracks((p) => p.filter((t) => t.spotifyId !== track.spotifyId))}
                      onRetryAnalyze={() => analyzeInputTrack(track)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* BPM許容差設定 */}
            <div className="mt-4 rounded-xl bg-white/2 border border-white/6 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="shrink-0">
                  <p className="text-[9px] text-white/35 uppercase tracking-[0.16em] font-bold">BPM許容差</p>
                </div>
                <input
                  type="range"
                  min={3}
                  max={20}
                  step={1}
                  value={bpmTolerance}
                  onChange={(e) => setBpmTolerance(Number(e.target.value))}
                  className="flex-1 accent-purple-500 h-1 cursor-pointer"
                />
                <div className="shrink-0 text-right w-12">
                  <span className="text-base font-mono font-black text-purple-300 tabular-nums">±{bpmTolerance}</span>
                  <p className="text-[9px] text-white/25 mt-0.5">BPM</p>
                </div>
              </div>
              {/* Visual scale */}
              <div className="flex items-center gap-0 px-4 pb-2">
                <div className="flex-1 flex justify-between px-0.5">
                  {[3,5,7,10,14,20].map((v) => (
                    <span key={v} className={`text-[8px] font-mono tabular-nums transition-colors ${Math.abs(v - bpmTolerance) <= 1 ? 'text-purple-400/70' : 'text-white/15'}`}>{v}</span>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleSuggest}
              disabled={loading || selectedTracks.length < 2 || inputAnalyzingIds.size > 0}
              className="mt-3 w-full py-4 rounded-xl font-bold text-[15px] transition-all duration-300 relative overflow-hidden disabled:cursor-not-allowed"
              style={{
                background: (loading || selectedTracks.length < 2 || inputAnalyzingIds.size > 0)
                  ? 'linear-gradient(135deg, rgba(109,40,217,0.3) 0%, rgba(91,33,182,0.25) 100%)'
                  : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 40%, #6d28d9 75%, #5b21b6 100%)',
                boxShadow: (loading || selectedTracks.length < 2 || inputAnalyzingIds.size > 0)
                  ? 'none'
                  : '0 0 32px rgba(139,92,246,0.4), 0 0 8px rgba(124,58,237,0.3), 0 4px 16px rgba(0,0,0,0.4)',
                opacity: (loading || selectedTracks.length < 2 || inputAnalyzingIds.size > 0) ? 0.55 : 1,
              }}
            >
              {/* shimmer effect */}
              {!loading && selectedTracks.length >= 2 && inputAnalyzingIds.size === 0 && (
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
              )}
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <svg className="animate-spin w-4 h-4 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                    </svg>
                    検索中…
                  </>
                ) : inputAnalyzingIds.size > 0 ? (
                  <>
                    <svg className="animate-spin w-4 h-4 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                    </svg>
                    {`BPMを解析中… (${inputAnalyzingIds.size}曲)`}
                  </>
                ) : (
                  <>
                    ブリッジ曲を提案する
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                    </svg>
                  </>
                )}
              </span>
            </button>

            {/* ─── Spinning Record Loading UI ────────────────────────────── */}
            {(loading || inputAnalyzingIds.size > 0) && (
              <div className="flex flex-col items-center gap-3 mt-10 mb-4 select-none">
                <div className="relative" style={{ width: 128, height: 128 }}>

                  {/* ── 回転するレコード盤 ── */}
                  <svg
                    className="animate-spin absolute inset-0 w-full h-full"
                    style={{ animationDuration: '3s', animationTimingFunction: 'linear' }}
                    viewBox="0 0 128 128"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    {/* ビニール */}
                    <circle cx="64" cy="64" r="62" fill="#0c0c1e"/>
                    <circle cx="64" cy="64" r="62" fill="none" stroke="#2d1b69" strokeWidth="2"/>

                    {/* グルーヴ — 不均一ダッシュで回転が見える */}
                    <circle cx="64" cy="64" r="56" stroke="#1a1a38" strokeWidth="1"   strokeDasharray="14 4 7 3 10 6 5 8"/>
                    <circle cx="64" cy="64" r="50" stroke="#161632" strokeWidth="1"   strokeDasharray="9  5 4 9 11 3 6 7"/>
                    <circle cx="64" cy="64" r="44" stroke="#1a1a38" strokeWidth="1"   strokeDasharray="8  4 11 3 5 8 3 6"/>
                    <circle cx="64" cy="64" r="38" stroke="#161632" strokeWidth="1"   strokeDasharray="7  3 9  4 4 7 6 5"/>
                    <circle cx="64" cy="64" r="32" stroke="#1e1e40" strokeWidth="1.2" strokeDasharray="6  3 8  2 5 6 4 5"/>
                    <circle cx="64" cy="64" r="26" stroke="#1e1e40" strokeWidth="1.2" strokeDasharray="5  2 7  3 3 5"/>

                    {/* センターラベル */}
                    <circle cx="64" cy="64" r="21" fill="#2d0f7a"/>
                    <circle cx="64" cy="64" r="21" fill="none" stroke="#5b21b6" strokeWidth="1"/>

                    {/* 回転マーカー — 非対称デザインで「動き」がわかる */}
                    {/* 大きな楔（上向き三角）*/}
                    <path d="M64 43 L74 62 L54 62 Z" fill="#8b5cf6" opacity="0.95"/>
                    {/* 左下の丸ドット */}
                    <circle cx="55" cy="70" r="3.5" fill="#a78bfa" opacity="0.8"/>
                    {/* 右の小ドット */}
                    <circle cx="72" cy="69" r="2" fill="#6d28d9" opacity="0.6"/>
                    {/* 下のストライプ */}
                    <rect x="60" y="74" width="12" height="2" rx="1" fill="#c4b5fd" opacity="0.4"/>

                    {/* スピンドル穴 */}
                    <circle cx="64" cy="64" r="4.5" fill="#080810" stroke="#4c1d95" strokeWidth="1"/>
                    <circle cx="64" cy="64" r="2.5" fill="#050510"/>
                  </svg>

                  {/* ── 静止する光沢ハイライト（動かない） ── */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 128 128" fill="none">
                    <path d="M30 36 Q44 18 66 14" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.11"/>
                    <path d="M22 52 Q28 38 38 30" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.07"/>
                  </svg>

                  {/* ── 静止するトーンアーム ── */}
                  <svg
                    className="absolute pointer-events-none"
                    style={{ top: -12, right: -24 }}
                    width="72" height="96"
                    viewBox="0 0 72 96"
                    fill="none"
                  >
                    {/* ピボットベース */}
                    <circle cx="56" cy="10" r="9" fill="#1a0a4e" stroke="#7c3aed" strokeWidth="2"/>
                    <circle cx="56" cy="10" r="4" fill="#a78bfa"/>
                    <circle cx="56" cy="10" r="2" fill="#c4b5fd"/>
                    {/* アーム本体 */}
                    <path d="M54 19 Q44 36 26 70" stroke="#7c3aed" strokeWidth="4" strokeLinecap="round"/>
                    <path d="M54 19 Q44 36 26 70" stroke="#c4b5fd" strokeWidth="1.2" strokeLinecap="round" opacity="0.45"/>
                    {/* ヘッドシェル */}
                    <line x1="26" y1="70" x2="20" y2="82" stroke="#7c3aed" strokeWidth="3.5" strokeLinecap="round"/>
                    <line x1="26" y1="70" x2="20" y2="82" stroke="#c4b5fd" strokeWidth="1"   strokeLinecap="round" opacity="0.5"/>
                    {/* カートリッジ */}
                    <ellipse cx="20" cy="83" rx="4" ry="3" fill="#6d28d9" stroke="#c4b5fd" strokeWidth="1"/>
                    {/* ニードル */}
                    <line x1="20" y1="86" x2="20" y2="93" stroke="#e9d5ff" strokeWidth="1.5" strokeLinecap="round"/>
                    <circle cx="20" cy="93" r="1.5" fill="#e9d5ff"/>
                  </svg>
                </div>

                <p className="text-white/75 text-sm font-semibold tracking-wide">
                  {loading ? 'ブリッジ曲を探しています…' : `BPMを解析中… (${inputAnalyzingIds.size}曲)`}
                </p>
                <p className="text-white/35 text-xs">
                  {loading ? '30〜60秒かかります' : '解析が終わると提案できます'}
                </p>
              </div>
            )}

            {selectedTracks.length < 2 && !loading && (
              <p className="text-center text-white/25 text-xs mt-2">曲を2つ以上追加してください</p>
            )}
          </section>
        )}

        {/* Result */}
        {suggestedPlaylist.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-[9px] text-purple-400/60 uppercase tracking-[0.18em] font-bold">
                <span className="w-1 h-3 rounded-full bg-gradient-to-b from-purple-400/80 to-purple-600/40" />
                提案されたミックス
                <span className="text-purple-400/90 font-extrabold text-[11px] normal-case tracking-tight tabular-nums">{suggestedPlaylist.length}曲</span>
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyPlaylist}
                  className={`text-[11px] font-medium transition-all duration-200 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${
                    copied
                      ? 'text-emerald-300 bg-emerald-500/12 border-emerald-500/30 shadow-[0_0_8px_rgba(52,211,153,0.12)]'
                      : 'text-white/55 hover:text-white/90 bg-white/5 hover:bg-white/9 border-white/12 hover:border-white/22'
                  }`}
                >
                  {copied ? (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      コピーしました
                    </>
                  ) : (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      コピー
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mb-4 px-1">
              <span className="flex items-center gap-1.5 text-[9px] text-white/22 uppercase tracking-[0.1em]">
                <span className="w-6 h-5 rounded border border-white/10 bg-white/4 inline-flex items-center justify-center font-mono text-[9px] text-white/20">000</span>
                BPM
              </span>
              <span className="flex items-center gap-1.5 text-[9px] text-white/22 uppercase tracking-[0.1em]">
                <span className="w-7 h-5 rounded border border-purple-400/20 bg-purple-400/10 inline-flex items-center justify-center font-bold text-[9px] text-purple-300/50">1A</span>
                Key
              </span>
              <span className="flex items-center gap-1.5 text-[9px] text-white/22 uppercase tracking-[0.1em]">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500/60 inline-block ring-1 ring-purple-400/30" />
                Bridge
              </span>
            </div>

            <div className="flex flex-col">
              {suggestedPlaylist.map((track, i) => {
                const prev = i > 0 ? suggestedPlaylist[i - 1] : null
                const poolCandidates = originalCandidatesRef.current.get(i) ?? []
                const isPoolOpen = expandedPoolIndices.has(i)
                return (
                  <div key={`${track.spotifyId}-${i}`}>
                    {prev && <TransitionLine from={prev} to={track} tolerance={bpmTolerance} />}
                    <TrackCard
                      track={track}
                      isBridge={track.isBridge}
                      index={i}
                      analyzing={analyzingIds.has(track.spotifyId)}
                      onRetryAnalyze={() => retryResultAnalysis(track, i)}
                      onTogglePool={track.isBridge && poolCandidates.length > 0 ? () => toggleBridgePool(i) : undefined}
                      poolExpanded={isPoolOpen}
                    />
                    {/* ブリッジ候補プール（per-bridge） */}
                    {track.isBridge && isPoolOpen && poolCandidates.length > 0 && (
                      <div className="ml-7 mt-1.5 mb-1.5 rounded-xl border border-purple-500/20 bg-[#0f0c1a] overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.35)]">
                        {/* Header */}
                        <div className="flex items-center justify-between px-3 py-2 border-b border-purple-500/12 bg-purple-950/30">
                          <p className="text-[9px] text-purple-400/70 uppercase tracking-[0.14em] font-bold flex items-center gap-1.5">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-70"><circle cx="12" cy="12" r="3"/><path d="M20.188 10.934c.2.4.312.845.312 1.066s-.112.666-.312 1.066C19.236 15.066 15.818 18 12 18c-3.818 0-7.236-2.934-8.188-4.934C3.612 12.666 3.5 12.221 3.5 12s.112-.666.312-1.066C4.764 8.934 8.182 6 12 6c3.818 0 7.236 2.934 8.188 4.934z"/></svg>
                            候補
                            <span className="text-purple-300/80 font-extrabold">{poolCandidates.length}</span>曲
                            <span className="text-purple-400/35 normal-case font-medium tracking-normal ml-0.5">— クリックで差し替え</span>
                          </p>
                          {track.targetBpm != null && (
                            <span className="text-[9px] text-white/25 font-mono flex items-center gap-1">
                              target
                              <span className="text-purple-300/55 font-bold tabular-nums">{Math.round(track.targetBpm)}</span>
                              <span className="text-white/15">BPM</span>
                            </span>
                          )}
                        </div>
                        {/* Column headers */}
                        <div className="flex items-center gap-2.5 px-3 py-1.5 border-b border-white/4">
                          <span className="w-4" />
                          <span className="w-[26px]" />
                          <span className="flex-1 text-[9px] text-white/18 uppercase tracking-[0.1em]">曲名</span>
                          <span className="text-[9px] text-white/18 uppercase tracking-[0.1em] w-8 text-right">BPM</span>
                          <span className="text-[9px] text-white/18 uppercase tracking-[0.1em] w-7">Key</span>
                          <span className="text-[9px] text-white/18 uppercase tracking-[0.1em] w-7 text-right">差</span>
                        </div>
                        <div className="divide-y divide-white/4">
                        {[...poolCandidates]
                          .map((c) => {
                            const a = candidateAnalysis.get(c.spotifyId)
                            return { c, bpm: a?.bpm ?? null, camelot: a?.camelot ?? null, analyzed: a !== undefined }
                          })
                          .sort((x, y) => {
                            if (!track.targetBpm) return 0
                            if (x.bpm == null && y.bpm == null) return 0
                            if (x.bpm == null) return 1
                            if (y.bpm == null) return -1
                            return effectiveBpmDiff(x.bpm, track.targetBpm) - effectiveBpmDiff(y.bpm, track.targetBpm)
                          })
                          .map(({ c, bpm, camelot, analyzed }) => {
                            const diff = bpm != null && track.targetBpm != null
                              ? effectiveBpmDiff(bpm, track.targetBpm)
                              : null
                            const diffColor = diff == null ? 'text-white/22'
                              : diff <= bpmTolerance / 2 ? 'text-emerald-400'
                              : diff <= bpmTolerance    ? 'text-amber-400'
                              : 'text-red-400'
                            const isCurrentBridge = c.spotifyId === track.spotifyId
                            return (
                              <button
                                key={c.spotifyId}
                                onClick={() => !isCurrentBridge && selectCandidate(i, c)}
                                disabled={isCurrentBridge}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors text-left ${
                                  isCurrentBridge
                                    ? 'bg-purple-500/10 border-l-2 border-l-purple-400/55 cursor-default'
                                    : 'hover:bg-purple-500/8 cursor-pointer'
                                }`}
                              >
                                <span className={`shrink-0 w-1 h-1 rounded-full ${isCurrentBridge ? 'bg-purple-400' : 'bg-transparent'}`} />
                                {c.albumArt
                                  ? <Image src={c.albumArt} alt={c.name} width={26} height={26} className="rounded-md shrink-0 object-cover opacity-75" />
                                  : <div className="w-[26px] h-[26px] rounded-md bg-white/6 shrink-0" />
                                }
                                <div className="flex-1 min-w-0">
                                  <p className={`truncate font-medium leading-tight text-[12px] ${isCurrentBridge ? 'text-purple-200' : 'text-white/55 group-hover:text-white/80'}`}>
                                    {c.name}
                                    {isCurrentBridge && <span className="ml-1.5 text-[8px] text-purple-400/60 uppercase tracking-[0.12em] font-extrabold">選択中</span>}
                                  </p>
                                  <p className="text-white/22 text-[10px] truncate mt-0.5">{c.artist}</p>
                                </div>
                                <span className="font-mono text-white/40 text-[11px] w-8 text-right tabular-nums">
                                  {!analyzed ? <span className="animate-pulse opacity-40">…</span> : (bpm ?? '—')}
                                </span>
                                <span className="text-[10px] text-white/25 w-7 tabular-nums">{camelot ?? '—'}</span>
                                {diff !== null ? (
                                  <span className={`font-mono font-semibold text-[10px] w-7 text-right tabular-nums ${diffColor}`}>
                                    ±{Math.round(diff)}
                                  </span>
                                ) : (
                                  <span className="w-7" />
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Summary */}
            <div className="mt-8 rounded-xl border border-white/7 overflow-hidden" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.025), rgba(255,255,255,0.012))' }}>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/6">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-purple-400/50">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <span className="text-[9px] text-white/25 uppercase tracking-[0.16em] font-bold">使い方ガイド</span>
              </div>
              <div className="px-4 py-4 space-y-3">
                {[
                  { icon: '◆', text: '紫のカードがAIが追加したブリッジ曲です' },
                  { icon: '♪', text: 'Camelotの数字が近いほど、ハーモニックに繋がりやすいです' },
                  { icon: '—', text: 'BPMが「—」の曲はプレビュー音源からBPMを取得できませんでした' },
                ].map(({ icon, text }, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="shrink-0 mt-0.5 w-5 h-5 rounded-lg border border-purple-500/25 bg-purple-500/8 flex items-center justify-center shadow-[0_0_6px_rgba(168,85,247,0.06)]">
                      <span className="text-purple-400/60 text-[8px] font-black">{icon}</span>
                    </span>
                    <p className="text-[12px] text-white/32 leading-relaxed">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
