import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AppShell, Group, Stack, Box, Title, Text, Card, Badge, Button,
  Select, TextInput, Textarea, Progress, UnstyledButton, ActionIcon,
  Accordion, SimpleGrid, NumberInput, Paper, Loader, Center, Grid,
  ScrollArea, Image, Switch, Tooltip, Burger, Divider, Checkbox, Skeleton, Table, Modal,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone'
import { notifications } from '@mantine/notifications'
import { BarChart, DonutChart, AreaChart } from '@mantine/charts'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  IconAlertTriangle, IconSearch, IconChecklist, IconBolt, IconHistory,
  IconPhoto, IconSend, IconChartBar, IconBuildingFactory2, IconListSearch,
  IconRefresh, IconArrowRight, IconCircleCheck, IconCheck,
  IconRobot, IconRoute, IconMicrophone, IconMessageChatbot, IconClock,
  IconAlertCircle, IconX, IconForms, IconDatabaseSearch, IconStethoscope,
  IconActivityHeartbeat, IconBulb, IconChartHistogram, IconSitemap,
  IconClipboardPlus, IconPlayerStopFilled,
  IconPrinter, IconPencil, IconShieldCheck, IconDownload, IconInbox,
} from '@tabler/icons-react'

// ---- types ----------------------------------------------------------------
type Equip = { id: string; name: string; process: string }
type Meta = { equipments: Equip[]; symptom_categories: string[]; aoai_ready: boolean; deployment: string; teams_ready: boolean }
type Cause = { rank: number; cause: string; evidence: string; confidence: number; supporting_doc_ids?: string[] }
type Check = { order: number; action: string }
type Similar = { title: string; date: string; cause: string; recovery_minutes: number; note: string }
type Citation = { source_type: string; label: string; doc_id: string; text: string; is_feedback: boolean }
type TraceStep = { agent: string; title: string; detail: string }
type ActionTaken = { tool: string; args: Record<string, unknown>; result: string; detail?: string; to?: string; executed: boolean }
type Trust = { band: 'green' | 'yellow' | 'red'; ungrounded_percentage: number; bound_rate: number; n_citations: number }
type Triage = {
  urgency: { level: string; reason: string }
  root_causes: Cause[]; first_checks: Check[]; similar_cases: Similar[]
  recommended_actions: string[]
  parallel_checks_while_waiting: string[]
  recommended_tools: string[]
  trust?: Trust
  escalation: { should_notify: boolean; to: string; message: string }
  image_findings: string | null
  citations: Citation[]
  trace: TraceStep[]; actions: ActionTaken[]; feedback_used: number; use_feedback: boolean
  engine: string
  specialist_findings: { name: string; label: string; output: string }[]
}
type Intake = { equipment_id: string; equipment_name: string; process: string; error_code: string; symptom: string; free_text: string; use_feedback: boolean }

// 緊急度 4 段階(Critical/High/Medium/Low) → 表示メタ
// 自律性: Critical=auto / High=承認 / Medium=承認+並行 / Low=案内のみ
const urgency = (lvl: string) =>
  lvl === 'Critical' ? { color: 'red',    label: 'Critical', word: '即時自動通知', icon: IconAlertTriangle, autonomy: 'auto' as const }
    : lvl === 'High'   ? { color: 'red',    label: 'High',     word: '承認後 即通知',  icon: IconAlertTriangle, autonomy: 'approve' as const }
    : lvl === 'Medium' ? { color: 'orange', label: 'Medium',   word: '承認 + 並行作業',icon: IconAlertCircle,   autonomy: 'parallel' as const }
    :                    { color: 'gray',   label: 'Low',      word: '自己解決ガイド', icon: IconCircleCheck,   autonomy: 'guide' as const }

// Trust 信号(緑/黄/赤)。Microsoft Confidence-Aware RAG パターン準拠の3色ルーティング
const trustMeta = (band?: string) =>
  band === 'red'    ? { color: 'red',   label: 'AI判断保留', sub: '人の確認が必要' }
  : band === 'yellow' ? { color: 'orange', label: '要確認',    sub: '根拠の一部が弱い'  }
  :                   { color: 'teal',  label: '根拠あり',  sub: '出典で支持されている' }

// ---- 表示用サニタイズ（内部実装やエラーをユーザーに見せない） --------------
// 文中に紛れる doc-id を除去（"(id=trouble-…)" も "(参照: 作業手順書 id=proc-…)" も対応）
// id= とその値だけを落とし、人間に読める「参照: 作業手順書」等は残す。空になった括弧は除去。
const stripIds = (s: string) => (s || '')
  .replace(/[【[][^】\]]*(?:†|‡|↑|source)[^】\]]*[】\]]/gi, '') // Foundry等のファイル引用注釈
  .replace(/(?:過去トラブル|作業手順書|設備仕様|品質記録|文書|資料|参照)?\s*ID[:：]\s*[A-Za-z0-9][\w\-./]*/gi, '')
  .replace(/[,、]?\s*id=[^\s)〉)】,、。]+/gi, '')
  .replace(/\s*(?:trouble|proc|spec|qa|fb|evt|equip|doc)-[A-Za-z0-9][\w\-./]*/gi, '')
  // 中身が空 or 区切り/句読点だけ残った括弧を全種類除去(半角・全角・角・鉤・隅)
  // 最大3回パスして連鎖した残骸まで掃除する
  .replace(/[(【「[]\s*[、,;:/\\\s.・]*\s*[)】」\]]/g, '')
  .replace(/[(【「[]\s*[、,;:/\\\s.・]*\s*[)】」\]]/g, '')
  .replace(/[(【「[]\s*[、,;:/\\\s.・]*\s*[)】」\]]/g, '')
  .replace(/\s+([)】」\]、,。])/g, '$1')
  .replace(/([(【「[])\s+/g, '$1')
  .replace(/[、,]{2,}/g, '、')
  .replace(/^[\s、。]+/, '')
  .replace(/\s{2,}/g, ' ')
  .trim()
const engineLabel = (e: string) => (e === 'foundry' ? 'Azure AI Foundry' : 'ローカル推論')

// ビュー間でフェッチ結果をキャッシュ(タブ再訪時の空白リフェッチを防ぐ / stale-while-revalidate)
const _viewCache: Record<string, unknown> = {}
function useCached<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(() => (key in _viewCache ? (_viewCache[key] as T) : null))
  const [loading, setLoading] = useState(!(key in _viewCache))
  const refresh = () => {
    fetcher().then((d) => { _viewCache[key] = d; setData(d) }).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, loading, refresh, setData }
}

// カード形のスケルトン(ローディングの空白感を解消)
function CardSkeleton({ rows = 3, h = 'lg' }: { rows?: number; h?: string }) {
  return (
    <Card p={h}>
      <Skeleton h={11} w={150} mb="lg" radius="sm" />
      <Stack gap="md">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i}>
            <Skeleton h={11} w={`${55 + (i % 3) * 10}%`} mb={8} radius="sm" />
            <Skeleton h={8} w="100%" radius="xl" />
          </div>
        ))}
      </Stack>
    </Card>
  )
}

async function fileToB64(file: File): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(file)
  })
}

// 音声入力 — ブラウザ録音(MediaRecorder) → Azure OpenAI(whisper) で文字起こし
// 録音フォーマットをブラウザ横断で選定(Chrome=webm / Safari=mp4)。いずれも whisper 対応。
const pickRecMime = (): string => {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']
  const MR = typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined
  for (const m of cands) if (MR?.isTypeSupported?.(m)) return m
  return ''
}
const extOf = (mime: string): string => {
  const base = (mime || '').split(';')[0]
  return base.includes('mp4') ? 'mp4' : base.includes('mpeg') ? 'mp3' : base.includes('ogg') ? 'ogg' : 'webm'
}

function useDictation(onText: (t: string) => void) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const mrRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const toggle = async () => {
    if (recording) { mrRef.current?.stop(); return }
    if (typeof MediaRecorder === 'undefined') {
      notifications.show({ color: 'yellow', title: '音声入力', message: 'このブラウザは録音に対応していません' }); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickRecMime()
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false); setBusy(true)
        try {
          // 実際の録音 MIME に合わせて Blob 種別とファイル名拡張子を一致させる
          const actual = mr.mimeType || mime || 'audio/webm'
          const blob = new Blob(chunksRef.current, { type: actual })
          const fd = new FormData(); fd.append('file', blob, `audio.${extOf(actual)}`)
          const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
          const d = await res.json().catch(() => ({}))
          if (res.ok && d.text) onText(d.text)
          else notifications.show({ color: 'red', title: '音声入力', message: d.detail || '文字起こしに失敗しました' })
        } catch (err) {
          notifications.show({ color: 'red', title: '音声入力', message: String(err) })
        } finally { setBusy(false) }
      }
      mr.start(); mrRef.current = mr; setRecording(true)
    } catch {
      notifications.show({ color: 'red', title: '音声入力', message: 'マイクにアクセスできません（ブラウザの許可を確認してください）' })
    }
  }
  return { recording, busy, toggle }
}

// 入力欄に馴染む円形マイクボタン（録音中は赤＋脈動、変換中はローダー）
function MicIcon({ onText, size = 30 }: { onText: (t: string) => void; size?: number }) {
  const { recording, busy, toggle } = useDictation(onText)
  return (
    <Tooltip label={busy ? '変換中…' : recording ? '停止' : '音声で入力'} withArrow>
      <ActionIcon onClick={toggle} loading={busy} size={size} radius="xl" aria-label="音声入力"
        variant={recording ? 'filled' : 'subtle'} color={recording ? 'red' : 'gray'}
        className={recording ? 'mic-pulse' : undefined}>
        {recording ? <IconPlayerStopFilled size={Math.round(size * 0.46)} /> : <IconMicrophone size={Math.round(size * 0.52)} />}
      </ActionIcon>
    </Tooltip>
  )
}

// ---- 共通: カード見出し（アイコンはモノクロで統一） ----------------------
function CardHead({ icon, title, sub, right }: { icon: ReactNode; title: string; sub?: string; right?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" mb="md">
      <Group gap={10} wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
        <Box c="gray.5" mt={1} style={{ display: 'flex', flexShrink: 0 }}>{icon}</Box>
        <div style={{ minWidth: 0 }}>
          <Text fw={650} size="sm" c="gray.8">{title}</Text>
          {sub && <Text size="xs" c="dimmed" mt={2}>{sub}</Text>}
        </div>
      </Group>
      {right}
    </Group>
  )
}

const NAV = [
  { value: 'triage', label: 'トリアージ', desc: '異常を入力して即診断', icon: IconActivityHeartbeat },
  { value: 'incidents', label: 'インシデント', desc: '自律トリアージと承認', icon: IconRobot },
  { value: 'feedback', label: '現場フィードバック', desc: '対処結果を学習させる', icon: IconBulb },
  { value: 'knowledge', label: 'ナレッジ集計', desc: '蓄積データの分析', icon: IconChartHistogram },
  { value: 'eval', label: '品質評価', desc: '診断精度を計測', icon: IconShieldCheck },
]

// 診断履歴(ローカル保存・サイドバーから再参照)
type HistItem = { id: string; ts: number; equipment_name: string; urgency: string; top_cause: string; result: Triage; intake: Intake }
const HIST_KEY = 'mta_history'
const loadHist = (): HistItem[] => { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]') } catch { return [] } }
const saveHist = (h: HistItem[]) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 20))) } catch { /* noop */ } }
const relTime = (ts: number) => {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'たった今'
  if (s < 3600) return `${Math.floor(s / 60)}分前`
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`
  return `${Math.floor(s / 86400)}日前`
}
// 履歴ID/タイムスタンプ（描画外の純粋ヘルパー：レンダー中の Date.now 直呼びを避ける）
const nowMs = () => Date.now()
const histId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.floor(Math.random() * 1e6)}`)

// デモ用プリセット(クリックで入力欄を一括投入)
// 4 段の自律性(Critical/High/Medium/Low)を見せられるよう各段から1件ずつ
const SCENARIOS = [
  { label: 'Critical / 火災', eq: 'L2-FILL-01', proc: '充填', err: 'F-911', symptom: '停止', free: '充填ヘッド付近で煙の臭い。ヒーター異常上昇を検知。ライン全停止。' },
  { label: 'High / 異音', eq: 'L2-CONV-01', proc: '搬送', err: 'E-142', symptom: '異音', free: '搬送部から異音。温度上昇あり。直前に段取り替え。' },
  { label: 'Medium / 振動', eq: 'L2-CAP-01', proc: '充填', err: 'C-301', symptom: '振動', free: 'キャッパーの打栓部から軽い振動。トルクは規定内。直近1時間で増加傾向。' },
  { label: 'Low / 誤検知', eq: 'L2-INSP-01', proc: '検査', err: 'I-305', symptom: '停止', free: '検査機が誤検知で頻繁に停止。照明のちらつきあり。レンズ汚れの可能性。' },
]
const FREE_MAX = 1000          // 自由記述の上限文字数
const IMG_MAX_MB = 6           // 画像の上限サイズ(MB)

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [active, setActive] = useState('triage')
  const [navOpen, { toggle: toggleNav, close: closeNav }] = useDisclosure(false)

  const [eq, setEq] = useState('L2-CONV-01')
  const [proc, setProc] = useState('搬送')
  const [err, setErr] = useState('E-142')
  const [symptom, setSymptom] = useState('異音')
  const [free, setFree] = useState('搬送部から異音。温度上昇あり。直前に段取り替え。')
  const [useFeedback, setUseFeedback] = useState(true)
  const [imgFile, setImgFile] = useState<File | null>(null)
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Triage | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 結果から「対応を記録」した際のフィードバック事前入力
  const [fbSeed, setFbSeed] = useState<{ eq: string; err: string; symptom: string; cause: string } | null>(null)
  const [history, setHistory] = useState<HistItem[]>(loadHist)

  useEffect(() => { fetch('/api/meta').then((r) => r.json()).then(setMeta).catch(() => {}) }, [])

  const eName = meta?.equipments.find((x) => x.id === eq)?.name ?? eq
  const intake: Intake = { equipment_id: eq, equipment_name: eName, process: proc, error_code: err, symptom, free_text: free, use_feedback: useFeedback }

  const clearImage = () => { setImgFile(null); setImgPreview(null) }

  const runTriage = async () => {
    setLoading(true); setResult(null); setError(null)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 150000) // 真のハング検知用の余裕ある上限(通常診断は30秒台。foundryのコールドスタート/画像付きでも誤発火しない)
    try {
      const image_b64 = imgFile ? await fileToB64(imgFile) : null
      const res = await fetch('/api/triage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ equipment_id: eq, process: proc, error_code: err, symptom, free_text: free, image_b64, use_feedback: useFeedback }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText)
      const data: Triage = await res.json()
      setResult(data)
      const item: HistItem = {
        id: histId(), ts: nowMs(), equipment_name: eName,
        urgency: data.urgency?.level ?? '-', top_cause: data.root_causes?.[0]?.cause ?? '',
        result: data, intake,
      }
      setHistory((h) => { const next = [item, ...h].slice(0, 20); saveHist(next); return next })
    } catch (e) {
      setError((e as { name?: string })?.name === 'AbortError'
        ? 'TIMEOUT'
        : String(e).replace(/^Error:\s*/, '').replace(/^トリアージ失敗:\s*/, ''))
    } finally { clearTimeout(timer); setLoading(false) }
  }

  const recordFromResult = (cause: string) => { setFbSeed({ eq, err, symptom, cause }); setActive('feedback') }
  const goHome = () => { setActive('triage'); setResult(null); setError(null); closeNav() }
  const restore = (h: HistItem) => {
    setEq(h.intake.equipment_id); setProc(h.intake.process); setErr(h.intake.error_code)
    setSymptom(h.intake.symptom); setFree(h.intake.free_text); setUseFeedback(h.intake.use_feedback)
    clearImage() // 履歴は画像を保持しないため、現在の画像を残さない
    setResult(h.result); setError(null); setActive('triage'); closeNav()
  }

  return (
    <AppShell
      navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !navOpen } }}
      padding="lg"
    >
      {/* ---- サイドバー（ヘッダー廃止・これがアプリの主クロム） ------------- */}
      <AppShell.Navbar withBorder p={0}>
        <Stack gap={0} h="100%">
          {/* ロゴ：最上部・クリックでホーム・hover演出なし */}
          <UnstyledButton onClick={goHome} aria-label="ホームに戻る"
            style={{ display: 'block', padding: '20px 18px 16px' }}>
            <img src="/logo.png" alt="Triage Console" style={{ height: 46, width: 'auto', maxWidth: '100%', display: 'block', pointerEvents: 'none' }} />
          </UnstyledButton>
          <Divider />

          <ScrollArea style={{ flex: 1 }} type="hover">
            <Box p="sm">
              <Text size="10px" fw={700} c="dimmed" tt="uppercase" px="xs" mb={8} style={{ letterSpacing: 0.6 }}>Workspace</Text>
              <Stack gap={2}>
                {NAV.map((n) => {
                  const on = active === n.value
                  return (
                    <UnstyledButton key={n.value} className="nav-item" data-active={on}
                      onClick={() => { setActive(n.value); closeNav() }}>
                      <Box style={{
                        width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: on ? 'var(--mantine-color-brand-7)' : 'var(--mantine-color-gray-6)', flexShrink: 0,
                      }}>
                        <n.icon size={15} stroke={1.6} />
                      </Box>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size="13px" fw={on ? 650 : 500} c={on ? 'brand.8' : 'gray.8'} lh={1.25}>{n.label}</Text>
                      </Box>
                    </UnstyledButton>
                  )
                })}
              </Stack>

              <Group justify="space-between" align="center" px="xs" mt="lg" mb={6} wrap="nowrap">
                <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }}>History</Text>
                {history.length > 0 && (
                  <Tooltip label="履歴を消去" withArrow>
                    <ActionIcon size="sm" variant="subtle" color="gray" aria-label="履歴を消去"
                      onClick={() => { setHistory([]); saveHist([]) }}><IconX size={12} /></ActionIcon>
                  </Tooltip>
                )}
              </Group>
              {history.length === 0 ? (
                <Text size="11px" c="dimmed" px="xs">診断するとここに履歴が残ります</Text>
              ) : (
                <Stack gap={1}>
                  {history.map((h) => {
                    const u = urgency(h.urgency)
                    return (
                      <UnstyledButton key={h.id} className="hist-item" onClick={() => restore(h)}>
                        <Box w={6} h={6} bg={`${u.color}.5`} style={{ borderRadius: 999, flexShrink: 0, marginTop: 5 }} />
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="11px" fw={600} c="gray.8" truncate miw={0}>{h.equipment_name}</Text>
                          <Text size="10px" c="dimmed" truncate miw={0}>{h.top_cause || '—'} · {relTime(h.ts)}</Text>
                        </Box>
                      </UnstyledButton>
                    )
                  })}
                </Stack>
              )}
            </Box>
          </ScrollArea>

          {/* 最下部: 接続状態 + マルチエージェント構成(Linear 調) */}
          <Box p="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
            <Group gap={6} mb={8} px="xs" wrap="nowrap" align="center">
              <Box w={6} h={6} style={{
                borderRadius: 999, flexShrink: 0,
                background: `var(--mantine-color-${meta?.aoai_ready ? 'teal' : 'red'}-6)`,
              }} />
              <Text size="11px" c="gray.7" fw={500}>Azure OpenAI</Text>
              <Text size="10px" c="dimmed" ff="monospace" ml="auto">{meta?.deployment ?? 'gpt-4o'}</Text>
            </Group>
            <Box px="xs">
              <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }}>Engine</Text>
              <Group gap={6} mt={4} wrap="nowrap" align="center">
                <IconSitemap size={12} color="var(--mantine-color-gray-5)" stroke={1.6} />
                <Text size="11px" c="gray.7">Intake → Retrieval → Triage → Action</Text>
              </Group>
            </Box>
          </Box>
        </Stack>
      </AppShell.Navbar>

      {/* ---- メイン --------------------------------------------------------- */}
      <AppShell.Main>
        <Box maw={1180} mx="auto" w="100%">
          {/* モバイル用ナビ開閉(ヘッダー廃止のため) */}
          <Group hiddenFrom="sm" mb="md" gap="sm" align="center">
            <Burger opened={navOpen} onClick={toggleNav} size="sm" />
            <UnstyledButton onClick={goHome}><img src="/logo.png" alt="Triage Console" style={{ height: 24, width: 'auto', display: 'block' }} /></UnstyledButton>
          </Group>

          {active === 'incidents' && (
            <>
              <PageHead title="インシデント・ボード" desc="設備アラームを取り込み、緊急度を自動判定して整理します。High は承認後に保全へ通知します。" />
              <IncidentBoard />
            </>
          )}

          {active === 'eval' && (
            <>
              <PageHead title="品質評価" desc="ラベル付きテストセットで診断の正答率と根拠提示率を計測します。" />
              <EvalView />
            </>
          )}

          {active === 'triage' && (
            result
              ? <ResultReport result={result} intake={intake} imgPreview={imgPreview} onEdit={() => setResult(null)} onRecord={recordFromResult} />
              : (
                <>
                  <PageHead title="設備異常トリアージ" desc="過去トラブル・手順書・設備台帳・品質記録を横断し、原因候補と初動を提示します。" />
                  <Grid gap="lg">
                    <Grid.Col span={{ base: 12, md: 5 }}>
                      <InputForm {...{ meta, eq, setEq, proc, setProc, err, setErr, symptom, setSymptom, free, setFree, useFeedback, setUseFeedback, imgPreview, setImgFile, setImgPreview, loading, runTriage }} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 7 }}>
                      {loading ? <ProgressStages /> : error ? <ErrorState msg={error} onRetry={runTriage} /> : <EmptyGuide />}
                    </Grid.Col>
                  </Grid>
                </>
              )
          )}

          {active === 'feedback' && (
            <>
              <PageHead title="現場フィードバック登録" desc="実際の原因と対処を登録すると、次回以降の検索対象に加わり診断精度が向上します。" />
              <FeedbackForm key={fbSeed?.cause ?? 'default'} defaultEq={fbSeed?.eq ?? eq} defaultErr={fbSeed?.err ?? err}
                defaultSymptom={fbSeed?.symptom ?? symptom} defaultCause={fbSeed?.cause} fromResult={!!fbSeed} />
            </>
          )}

          {active === 'knowledge' && (
            <>
              <PageHead title="ナレッジ集計" desc="蓄積されたトラブル対応データを集計し、傾向と削減効果を可視化します。" />
              <KnowledgeView />
            </>
          )}

          <Text ta="center" size="xs" c="dimmed" mt={48} mb="md" className="no-print">
            Microsoft Agent Hackathon 2026 ・ Azure OpenAI (GPT-4o) on Azure App Service
          </Text>
        </Box>
      </AppShell.Main>
    </AppShell>
  )
}

function PageHead({ title, desc }: { title: string; desc: string }) {
  return (
    <Box mb="lg">
      <Title order={3} fw={700} c="gray.9">{title}</Title>
      <Text size="sm" c="dimmed" mt={4}>{desc}</Text>
    </Box>
  )
}

// ---- Vision 自動入力(デモのオープニング・クライマックス) -------------------
// 写真投入 → GPT-4o vision が銘板/HMIエラー画面/状態表示を読取
// → 設備ID / エラーコード / 症状 / ヒント文 を自動でフォームに流し込む
// 入力時間を実質ゼロにしてトリアージへ直行できる
function VisionAutoFillBox({ p }: { p: InputProps }) {
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<{ confidence?: string; equipment_id?: string; error_code?: string; symptom?: string; hint_text?: string } | null>(null)
  const onDrop = async (files: File[]) => {
    const f = files[0]
    if (!f) return
    p.setImgFile(f); p.setImgPreview(URL.createObjectURL(f))
    setBusy(true); setHint(null)
    try {
      const b64 = await fileToB64(f)
      const res = await fetch('/api/extract_from_image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_b64: b64 }),
      })
      if (!res.ok) throw new Error()
      const d = await res.json()
      // 自動プリフィル(空欄でない値だけ上書き)
      if (d.equipment_id) p.setEq(d.equipment_id)
      if (d.error_code) p.setErr(d.error_code)
      if (d.symptom) p.setSymptom(d.symptom)
      if (d.hint_text) p.setFree(p.free ? `${p.free} / ${d.hint_text}` : d.hint_text)
      setHint(d)
      notifications.show({ color: 'teal', icon: <IconCheck size={16} />, title: '画像から自動入力しました',
                            message: d.equipment_id ? `設備=${d.equipment_id} ${d.error_code ? ' / コード=' + d.error_code : ''}` : 'ヒントを取得しました' })
    } catch {
      notifications.show({ color: 'orange', title: '画像解析', message: '自動入力できませんでした。手動で入力してください' })
    } finally { setBusy(false) }
  }
  return (
    <div>
      <Group gap={6} mb={6}>
        <Text size="sm" fw={600} c="gray.8">📷 写真から自動入力</Text>
        <Badge variant="default" size="xs" radius={3}>GPT-4o Vision</Badge>
      </Group>
      <Text size="xs" c="dimmed" mb={8}>設備の型式銘板/HMIエラー画面を撮影 → 設備ID・エラーコード・症状を自動で抽出します</Text>
      {p.imgPreview ? (
        <Paper withBorder p="sm" radius={4}>
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <Image src={p.imgPreview} h={64} w={64} radius={4} fit="cover" style={{ flexShrink: 0 }} />
            <Box style={{ flex: 1, minWidth: 0 }}>
              {busy ? (
                <Group gap={8}><Loader size="xs" /><Text size="xs" c="gray.7">画像から設備・症状を解析中…</Text></Group>
              ) : hint ? (
                <Stack gap={2}>
                  <Text size="xs" c="teal.7" fw={600}>自動入力済み (信頼度: {hint.confidence ?? '—'})</Text>
                  {hint.equipment_id && <Text size="xs" c="gray.7">設備: <code className="mono">{hint.equipment_id}</code></Text>}
                  {hint.error_code && <Text size="xs" c="gray.7">エラー: <code className="mono">{hint.error_code}</code></Text>}
                  {hint.hint_text && <Text size="xs" c="gray.6" lineClamp={2}>{hint.hint_text}</Text>}
                </Stack>
              ) : (
                <Text size="xs" c="gray.6">画像を解析対象として添付しました(自動入力なし)</Text>
              )}
            </Box>
            <Button variant="default" size="compact-xs" leftSection={<IconX size={12} />}
              onClick={() => { p.setImgFile(null); p.setImgPreview(null); setHint(null) }}>削除</Button>
          </Group>
        </Paper>
      ) : (
        <Dropzone accept={IMAGE_MIME_TYPE} multiple={false} radius={4} maxSize={IMG_MAX_MB * 1024 * 1024}
          onReject={() => notifications.show({ color: 'red', title: '画像', message: `画像は ${IMG_MAX_MB}MB 以下にしてください` })}
          onDrop={onDrop} p="md">
          <Group justify="center" gap={8} mih={52} style={{ pointerEvents: 'none' }}>
            <IconPhoto size={22} stroke={1.5} color="var(--mantine-color-gray-5)" />
            <Box>
              <Text size="sm" c="gray.7" fw={500}>画像をドロップ / クリックして選択</Text>
              <Text size="10px" c="dimmed">推奨: 設備全景 + 銘板 + HMIエラー画面のいずれか</Text>
            </Box>
          </Group>
        </Dropzone>
      )}
    </div>
  )
}

// ---- 入力フォーム ----------------------------------------------------------
type InputProps = {
  meta: Meta | null; eq: string; setEq: (v: string) => void; proc: string; setProc: (v: string) => void
  err: string; setErr: (v: string) => void; symptom: string; setSymptom: (v: string) => void
  free: string; setFree: (v: string) => void; useFeedback: boolean; setUseFeedback: (v: boolean) => void
  imgPreview: string | null; setImgFile: (f: File | null) => void; setImgPreview: (v: string | null) => void
  loading: boolean; runTriage: () => void
}
function InputForm(p: InputProps) {
  const { meta } = p
  return (
    <Card p="lg" style={{ position: 'sticky', top: 76 }}>
      <CardHead icon={<IconListSearch size={16} />} title="異常入力" sub="わかる範囲で入力してください" />
      <Box mb="sm">
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={6} style={{ letterSpacing: 0.6 }}>Quick scenarios</Text>
        <Group gap={6} wrap="wrap">
          {SCENARIOS.map((s) => (
            <Button key={s.label} variant="default" size="compact-xs" radius={3}
              onClick={() => { p.setEq(s.eq); p.setProc(s.proc); p.setErr(s.err); p.setSymptom(s.symptom); p.setFree(s.free) }}>
              {s.label}
            </Button>
          ))}
        </Group>
      </Box>
      <Stack gap="sm">
        <Select label="設備" value={p.eq} onChange={(v) => p.setEq(v ?? p.eq)}
          data={(meta?.equipments ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }))} allowDeselect={false} />
        <Group grow>
          <TextInput label="工程" value={p.proc} onChange={(e) => p.setProc(e.currentTarget.value)} />
          <TextInput label="エラーコード" value={p.err} onChange={(e) => p.setErr(e.currentTarget.value)} />
        </Group>
        <Select label="症状カテゴリ" value={p.symptom} onChange={(v) => p.setSymptom(v ?? p.symptom)} data={meta?.symptom_categories ?? []} allowDeselect={false} />
        <Textarea
          label={
            <Group gap={6} align="center" wrap="nowrap">
              <span>自由記述</span>
              <MicIcon size={26} onText={(t) => p.setFree(p.free ? `${p.free} ${t}` : t)} />
              <Text span size="xs" c="dimmed" fw={400}>音声でも入力できます</Text>
            </Group>
          }
          autosize minRows={3} maxLength={FREE_MAX} value={p.free}
          onChange={(e) => p.setFree(e.currentTarget.value)} placeholder="例: 搬送部から異音。直前に段取り替え。"
          inputWrapperOrder={['label', 'input', 'description']}
          description={<Text component="span" display="block" size="xs" c={p.free.length > FREE_MAX * 0.9 ? 'orange.7' : 'dimmed'} ta="right" className="tnum">{p.free.length} / {FREE_MAX}</Text>} />

        <VisionAutoFillBox p={p} />


        <Box p="sm" style={{ border: '1px solid var(--mantine-color-gray-2)', borderRadius: 4 }}>
          <Switch checked={p.useFeedback} onChange={(e) => p.setUseFeedback(e.currentTarget.checked)} size="sm"
            label={<Text size="sm" fw={500}>現場知見(フィードバック)を使う</Text>}
            description="OFF で蓄積事例なしの素の判断と比較できます" />
        </Box>

        <Button leftSection={<IconSearch size={15} />} loading={p.loading} onClick={p.runTriage} size="md" mt={4} fullWidth>
          トリアージ実行
        </Button>
      </Stack>
    </Card>
  )
}

// ---- 結果なし: 診断フローのガイド -----------------------------------------
const PIPELINE = [
  { icon: IconForms, tag: 'Intake', title: '入力を構造化', desc: '設備・症状・自由記述(必要なら写真)を解析' },
  { icon: IconDatabaseSearch, tag: 'Retrieval', title: '資料を横断検索', desc: '過去トラブル・手順書・設備台帳・品質記録を照合' },
  { icon: IconStethoscope, tag: 'Triage', title: '緊急度・原因を判定', desc: '4段の自律性(Critical/High/Medium/Low)で振り分け' },
  { icon: IconRobot, tag: 'Action', title: '情報パッケージ提案', desc: '保全への通知本文・推奨工具・並行作業を組み立て(実行は人の承認後)' },
]
const OUTPUTS = [
  '緊急度の判定と理由(4段の自律性)',
  '原因候補 Top3 と出典(claim→source)',
  '保全への情報パッケージ(推奨工具同梱)',
  'オペレーター並行作業の指示',
]

function EmptyGuide() {
  return (
    <Card p="xl" h="100%">
      <Stack gap="lg">
        <div>
          <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.6 }}>Triage pipeline</Text>
          <Title order={4} c="gray.9" fw={700}>4 つのエージェントが連携して診断します</Title>
          <Text size="sm" c="dimmed" mt={4}>左で異常内容を入力し「トリアージ実行」を押してください。</Text>
        </div>

        <Stack gap={0}>
          {PIPELINE.map((s, i) => {
            const last = i === PIPELINE.length - 1
            return (
              <Group key={s.tag} gap="md" wrap="nowrap" align="flex-start">
                <Stack gap={0} align="center" w={28} style={{ flexShrink: 0 }}>
                  <Box w={24} h={24} style={{
                    borderRadius: 4, border: '1px solid var(--mantine-color-gray-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--mantine-color-gray-6)',
                  }}>
                    <s.icon size={13} stroke={1.6} />
                  </Box>
                  {!last && <Box w={1} flex={1} mih={20} bg="gray.2" my={4} />}
                </Stack>
                <Box pb={last ? 0 : 'lg'} pt={2} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={8} align="baseline">
                    <Text fw={650} size="sm" c="gray.8">{s.title}</Text>
                    <Text size="10px" c="dimmed" ff="monospace">{s.tag}</Text>
                  </Group>
                  <Text size="xs" c="dimmed" mt={3}>{s.desc}</Text>
                </Box>
              </Group>
            )
          })}
        </Stack>

        <Box style={{ borderTop: '1px solid var(--mantine-color-gray-2)', paddingTop: 14 }}>
          <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb="sm" style={{ letterSpacing: 0.6 }}>Outputs</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" verticalSpacing="xs">
            {OUTPUTS.map((o) => (
              <Group key={o} gap={8} wrap="nowrap" align="center">
                <Box w={4} h={4} bg="teal.5" style={{ borderRadius: 999, flexShrink: 0 }} />
                <Text size="sm" c="gray.7">{o}</Text>
              </Group>
            ))}
          </SimpleGrid>
        </Box>
      </Stack>
    </Card>
  )
}

// ---- 失敗状態 --------------------------------------------------------------
function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  const timeout = msg === 'TIMEOUT'
  const unset = /未設定|503/.test(msg)
  const title = timeout ? '時間内に応答がありませんでした' : 'トリアージを実行できませんでした'
  const body = timeout
    ? 'AI エンジンの応答に時間がかかっています(混雑の可能性)。入力を短くするか、少し待って再試行してください。'
    : unset
      ? 'Azure OpenAI が未設定です。接続設定を確認してください。'
      : '一時的に AI エンジンへ接続できませんでした。少し時間をおいて再試行してください。'
  const accent = timeout ? 'orange' : 'red'
  return (
    <Card p="xl" h="100%">
      <Center mih={360}>
        <Stack align="center" gap="sm" maw={380}>
          <Box style={{
            width: 44, height: 44, borderRadius: 6,
            border: `1px solid var(--mantine-color-${accent}-3)`,
            background: `var(--mantine-color-${accent}-0)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: `var(--mantine-color-${accent}-7)`,
          }}>
            {timeout ? <IconClock size={20} stroke={1.6} /> : <IconAlertTriangle size={20} stroke={1.6} />}
          </Box>
          <Text fw={650} c="gray.9">{title}</Text>
          <Text size="sm" c="dimmed" ta="center">{body}</Text>
          <Button variant="default" leftSection={<IconRefresh size={14} />} onClick={onRetry} mt={4}>再試行</Button>
        </Stack>
      </Center>
    </Card>
  )
}

// ---- 実行中: 段階プログレス(4工程・時間ベース疑似進捗) ------------------
// 設計: Foundry のコールドスタートや画像付きで 25-40 秒掛かることがある。
// 時間ベース疑似で 100% に達してから止まって見えるのが最悪なので、
// 最終工程の Action は pct 上限を 90% に頭打ちし、進捗バーを「無期限の不確定モード」に切替えて
// 「動いている」を継続表示する。
function ProgressStages() {
  const [t, setT] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 0.1), 100)
    return () => clearInterval(id)
  }, [])
  const PER = 6 // 1工程あたりの目安秒(平均診断 24 秒)
  const activeIdx = Math.min(PIPELINE.length - 1, Math.floor(t / PER))
  // 最終工程に入って 1.5 倍を超えたら「もう少しお待ちください」モードへ
  // 進捗バー値は overrun でも 90 に頭打ち。100% で止まって見えるのが最悪なため
  const overrun = activeIdx === PIPELINE.length - 1 && t > PER * (PIPELINE.length + 0.5)
  const pct = Math.min(90, (t / (PER * PIPELINE.length)) * 100)
  return (
    <Card p="xl" h="100%">
      <Stack gap="lg">
        <div>
          <Group gap={8} mb={4} wrap="nowrap">
            <Loader size="xs" />
            <Text fw={700} c="gray.9">診断を実行中…</Text>
          </Group>
          <Text size="sm" c="dimmed">
            {overrun
              ? '主エージェントが専門エージェント(品質影響・保全プランナー)の所見を統合中です…'
              : '4つのエージェントが順に資料を横断しています(通常 10〜30 秒)'}
          </Text>
        </div>

        <div>
          <Group justify="space-between" mb={6} wrap="nowrap" gap="sm">
            <Text size="xs" fw={600} c="gray.7" truncate miw={0}>
              {overrun ? '統合と判断生成' : PIPELINE[activeIdx].title}
            </Text>
            <Text size="xs" fw={700} c="brand.7" className="tnum" style={{ flexShrink: 0 }}>
              {overrun ? '— ' : Math.round(pct)}{overrun ? '' : '%'}
            </Text>
          </Group>
          <Progress value={overrun ? 100 : pct} radius="xl" size="md" color="brand" striped animated />
        </div>

        <Stack gap={0}>
          {PIPELINE.map((s, i) => {
            const done = i < activeIdx || (i === PIPELINE.length - 1 ? false : overrun)
            const active = i === activeIdx
            const last = i === PIPELINE.length - 1
            return (
              <Group key={s.tag} gap="md" wrap="nowrap" align="flex-start">
                <Stack gap={0} align="center" w={28} style={{ flexShrink: 0 }}>
                  <Box w={20} h={20} style={{
                    borderRadius: 999, border: '1px solid var(--mantine-color-gray-3)',
                    background: done ? 'var(--mantine-color-teal-5)' : active ? 'var(--mantine-color-brand-5)' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {done ? <IconCheck size={12} stroke={2.5} color="#fff" />
                          : active ? <Loader size={10} color="#fff" />
                          : <Box w={5} h={5} bg="gray.4" style={{ borderRadius: 999 }} />}
                  </Box>
                  {!last && <Box w={1} flex={1} mih={16} bg={done ? 'teal.3' : 'gray.2'} my={4} />}
                </Stack>
                <Box pb={last ? 0 : 'md'} pt={2} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={8} wrap="nowrap">
                    <Text size="sm" fw={active ? 700 : 600} c={done || active ? 'gray.8' : 'gray.5'}>{s.title}</Text>
                    <Text size="10px" c="dimmed" ff="monospace">{s.tag}</Text>
                  </Group>
                  <Text size="xs" c={active ? 'brand.7' : 'dimmed'} fw={active ? 600 : 400} mt={2}>
                    {done ? '完了' : active ? '処理中…' : '待機中'}
                  </Text>
                </Box>
              </Group>
            )
          })}
        </Stack>
      </Stack>
    </Card>
  )
}

// ===========================================================================
// 診断レポート（結果）— Triage Report 形式(業務SaaS調)
// 主軸: 「保全に渡す情報パッケージ」+ 緊急度別の自律性(Critical=auto / High=承認 /
//        Medium=承認+並行 / Low=自己解決ガイド)
// ===========================================================================
function ResultReport({ result, intake, imgPreview, onEdit, onRecord }: {
  result: Triage; intake: Intake; imgPreview: string | null; onEdit: () => void; onRecord: (cause: string) => void
}) {
  const topCause = result.root_causes?.[0]?.cause ?? ''
  const [activeRank, setActiveRank] = useState<number | null>(null)
  const activeDocIds = result.root_causes?.find(c => c.rank === activeRank)?.supporting_doc_ids ?? []
  const u = urgency(result.urgency.level)
  return (
    <Box maw={960} mx="auto" w="100%" className="print-report">
      <Stack gap="lg">
        <Box className="print-only">
          <Text fw={700} fz={18} c="gray.9">設備異常トリアージ — 引継ぎ票</Text>
          <Text size="xs" c="dimmed">{new Date().toLocaleString('ja-JP')} 出力</Text>
        </Box>

        {/* Card 1: Action signal の主役カード(設備メタ → Hero) */}
        <Card p="lg">
          <TriageReportHeader intake={intake} result={result} />
          <UrgencyBlock result={result} />
          <Group gap="xs" mt={20} wrap="wrap" className="no-print">
            <Button size="sm" leftSection={<IconClipboardPlus size={14} />} onClick={() => onRecord(topCause)}>対応を記録</Button>
            <Button variant="default" size="sm" leftSection={<IconPencil size={14} />} onClick={onEdit}>Edit triage</Button>
            <Button variant="default" size="sm" leftSection={<IconPrinter size={14} />} onClick={() => window.print()}>Export PDF</Button>
            {imgPreview && (
              <Tooltip label="添付画像(GPT-4o vision で解析)" withArrow>
                <Image src={imgPreview} w={34} h={34} radius={4} fit="cover" ml="auto" style={{ border: '1px solid var(--mantine-color-gray-2)' }} />
              </Tooltip>
            )}
          </Group>
        </Card>

        {/* Card 2: 保全への情報パッケージ(本プロダクトの核) */}
        <MaintenancePackage result={result} intake={intake} />

        {/* Card 3: 原因候補 Top 3(独立カード化して claim→source 体験を明確に) */}
        <Card p="lg">
          <CardHead
            icon={<IconSearch size={16} />}
            title="原因候補 Top 3"
            sub="原因をクリックすると下の References で参照資料がハイライトされます"
          />
          <Causes causes={result.root_causes} activeRank={activeRank} setActiveRank={setActiveRank} />
        </Card>

        {/* Card 4: First checks + 並行作業 */}
        <NextSteps checks={result.first_checks} recs={result.recommended_actions} parallel={result.parallel_checks_while_waiting} autonomy={u.autonomy} />

        {/* Card 5: 折り畳み Similar / References / Ask follow-up */}
        <CollapsibleSections result={result} intake={intake} activeDocIds={activeDocIds} />
        {result.image_findings && (
          <Card p="lg">
            <CardHead icon={<IconPhoto size={18} />} title="画像所見" sub="GPT-4o vision による解析" />
            <Text size="sm" c="gray.7">{result.image_findings}</Text>
          </Card>
        )}
      </Stack>
    </Box>
  )
}

// 確信度バンド表示(較正されていない LLM 自己申告 % を過剰精度で出さない)
const confBand = (c: number) =>
  c >= 0.7 ? { stars: '★★★', label: 'High' }
  : c >= 0.4 ? { stars: '★★ ', label: 'Med' }
  :            { stars: '★  ', label: 'Low' }

// Triage Report ヘッダ: 業務 SaaS 調の「設備情報を表組で整然と」
// コンパクトな breadcrumb 風メタストリップ(設備・工程・症状・入力をすべて1ブロックに圧縮)
// 既知の入力情報なので主役を奪わない。Hero(UrgencyBlock)の前段。
function TriageReportHeader({ intake, result }: { intake: Intake; result: Triage }) {
  return (
    <Box>
      <Group justify="space-between" align="baseline" wrap="nowrap" gap="md" mb={4}>
        <Group gap={8} wrap="nowrap" align="baseline" style={{ minWidth: 0 }}>
          <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.8, flexShrink: 0 }}>Triage</Text>
          <code className="mono" style={{ flexShrink: 0 }}>{intake.equipment_id}</code>
          <Text size="sm" c="gray.7" truncate style={{ minWidth: 0 }}>{intake.equipment_name}</Text>
        </Group>
        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text size="10px" c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>Engine</Text>
          <Text size="xs" c="gray.7" fw={600}>{engineLabel(result.engine)}</Text>
        </Group>
      </Group>
      <Group gap={8} wrap="wrap" align="baseline">
        <Text size="xs" c="gray.6">{intake.process || '—'}</Text>
        <Text size="xs" c="gray.4">·</Text>
        <code className="mono" style={{ fontSize: 11 }}>{intake.error_code || '—'}</code>
        <Text size="xs" c="gray.4">·</Text>
        <Text size="xs" c="gray.6">{intake.symptom || '—'}</Text>
      </Group>
      {intake.free_text && (
        <Text size="xs" c="gray.6" mt={4} lineClamp={2} style={{ lineHeight: 1.6 }}>"{intake.free_text}"</Text>
      )}
    </Box>
  )
}

// 定義行(IncidentAuditPanel と共有)。ラベル左・値右の Notion 流定義リスト
function DefRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <Group gap={0} wrap="nowrap" align="flex-start" style={{ padding: '4px 0' }}>
      <Box w={120} style={{ flexShrink: 0 }}>
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>{k}</Text>
      </Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        {typeof v === 'string' ? <Text size="sm" c="gray.8">{v}</Text> : v}
      </Box>
    </Group>
  )
}

// Hero: Urgency と Top cause を**画面の主役**にする。
// 旧版は「URGENCY / TRUST / TOP CAUSE」の小さい3列ラベルで主役を埋もれさせていた。
// 新版は 緊急度 28pt + Trust バッジ 上段 / 最有力原因 22pt + ★スター / Reason / Autonomy notice。
function UrgencyBlock({ result }: { result: Triage }) {
  const u = urgency(result.urgency.level)
  const t = trustMeta(result.trust?.band)
  const top = result.root_causes?.[0]
  const band = top ? confBand(top.confidence) : null
  return (
    <Box style={{ borderLeft: `3px solid var(--mantine-color-${u.color}-6)`, paddingLeft: 18, marginTop: 18 }}>
      {/* 上段: Urgency 主役 + Trust 横バッジ */}
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap={12} wrap="nowrap" align="baseline">
          <Box w={12} h={12} bg={`${u.color}.6`} style={{ borderRadius: 999, flexShrink: 0 }} />
          <Text fz={28} fw={800} c={`${u.color}.7`} lh={1}>{u.label}</Text>
          <Text size="sm" c="gray.6" mb={2}>{u.word}</Text>
        </Group>
        <Group gap={6} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
          <TrustDots band={result.trust?.band} />
          <Text size="xs" c={`${t.color}.7`} fw={600}>{t.label}</Text>
          <Text size="10px" c="dimmed">· {t.sub}</Text>
        </Group>
      </Group>

      {/* Reason - 主役なのでフォントサイズと行間を明確に */}
      <Text size="sm" c="gray.8" mt={12} style={{ lineHeight: 1.75, maxWidth: 780 }}>
        {result.urgency.reason}
      </Text>

      {/* 最有力原因セクション(Causes Card と差別化: ここは "一行サマリ" として置く。詳細は下のカード) */}
      {top && band && (
        <Box mt={16} style={{ paddingTop: 14, borderTop: '1px solid var(--mantine-color-gray-2)' }}>
          <Group justify="space-between" align="baseline" wrap="nowrap" gap="md">
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.6 }}>最有力原因</Text>
              <Text fz={20} fw={700} c="gray.9" lh={1.3}>{top.cause}</Text>
            </Box>
            <Tooltip label={`確信度: ${band.label}`} withArrow>
              <Box style={{ flexShrink: 0, textAlign: 'right' }}>
                <Text size="10px" c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>確信度</Text>
                <Text size="sm" c="gray.6" ff="monospace" mt={2}>{band.stars}</Text>
              </Box>
            </Tooltip>
          </Group>
        </Box>
      )}

      {/* Trust band red の警告(他より優先して目立たせる) */}
      {result.trust?.band === 'red' && (
        <Paper mt={14} p="sm" bg="red.0" withBorder style={{ borderColor: 'var(--mantine-color-red-3)' }}>
          <Group gap={8} wrap="nowrap" align="flex-start">
            <IconAlertTriangle size={14} color="var(--mantine-color-red-7)" style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Text size="xs" fw={700} c="red.8">Trust: red — AI 判断保留</Text>
              <Text size="11px" c="gray.7" mt={2}>
                出典が薄く、原因と参照資料の紐付けも弱いため、AI の判断をそのまま採用せず
                <Text span fw={600}>人による確認</Text>を推奨します(Microsoft Confidence-Aware RAG の abstention レイヤ)。
              </Text>
            </Box>
          </Group>
        </Paper>
      )}

      {/* 自律性に応じた Notice */}
      {u.autonomy === 'auto' && (
        <Paper mt={14} p="sm" bg="red.0" withBorder style={{ borderColor: 'var(--mantine-color-red-3)' }}>
          <Group gap={8} wrap="nowrap">
            <IconAlertTriangle size={15} color="var(--mantine-color-red-7)" />
            <Text size="sm" c="red.8" fw={600}>Critical: 即時通知レベル(本番運用では承認をスキップして保全に直送)</Text>
          </Group>
        </Paper>
      )}
      {u.autonomy === 'guide' && (
        <Paper mt={14} p="sm" bg="gray.0" withBorder>
          <Group gap={8} wrap="nowrap">
            <IconBulb size={15} color="var(--mantine-color-gray-6)" />
            <Text size="sm" c="gray.7">Low: 保全通知不要・下の First checks で自己解決を試行</Text>
          </Group>
        </Paper>
      )}
      {(u.autonomy === 'approve' || u.autonomy === 'parallel') && (
        <Paper mt={14} p="sm" bg="gray.0" withBorder>
          <Group gap={8} wrap="nowrap">
            <IconShieldCheck size={15} color="var(--mantine-color-gray-6)" />
            <Text size="sm" c="gray.7">
              送信は <Text span fw={600}>インシデント・ボード</Text> 経由で人の承認後(HITL)。承認時に保全 Teams へ情報パッケージを送信します。
            </Text>
          </Group>
        </Paper>
      )}
    </Box>
  )
}

function TrustDots({ band }: { band?: string }) {
  const color = band === 'red' ? 'red.5' : band === 'yellow' ? 'orange.5' : 'teal.5'
  const filled = band === 'red' ? 1 : band === 'yellow' ? 2 : 3
  return (
    <Group gap={3} style={{ display: 'inline-flex' }}>
      {[0, 1, 2].map(i => (
        <Box key={i} w={6} h={6} bg={i < filled ? color : 'gray.3'} style={{ borderRadius: 999 }} />
      ))}
    </Group>
  )
}

// 次にすべきこと: First checks + 推奨対処 + (Medium のみ)並行作業
function NextSteps({ checks, recs, parallel, autonomy }: {
  checks: Check[]; recs: string[]; parallel: string[]; autonomy: 'auto' | 'approve' | 'parallel' | 'guide'
}) {
  const showParallel = (autonomy === 'parallel' || autonomy === 'approve') && parallel.length > 0
  return (
    <Card p="lg">
      <CardHead icon={<IconChecklist size={18} />} title="First checks" sub="現場でまず確認する項目" />
      <Stack gap="lg">
        <StepGroup label="まず確認" color="teal" items={[...checks].sort((a, b) => a.order - b.order).map((c) => c.action)} />
        {showParallel && (
          <StepGroup label="保全到着までの並行作業(オペレーター)" color="brand"
            items={parallel} hint="安全に並行できるもの。修理は保全担当が到着後に実施" />
        )}
        {recs.length > 0 && <StepGroup label="推奨する対処" color="gray" items={recs} />}
      </Stack>
    </Card>
  )
}
function StepGroup({ label, color, items, hint }: { label: string; color: string; items: string[]; hint?: string }) {
  return (
    <div>
      <Group gap={8} mb={hint ? 2 : 'xs'}>
        <Box w={3} h={14} bg={`${color}.5`} style={{ borderRadius: 2 }} />
        <Text size="xs" fw={700} c="gray.7" tt="uppercase" style={{ letterSpacing: 0.4 }}>{label}</Text>
      </Group>
      {hint && <Text size="10px" c="dimmed" mb={6} ml={11}>{hint}</Text>}
      <Stack gap={4} pl={2}>
        {items.map((t, i) => (
          <Checkbox key={i} size="sm" radius={2} color={color}
            label={<Text size="sm" c="gray.7">{stripIds(t)}</Text>}
            styles={{ body: { alignItems: 'flex-start' }, labelWrapper: { paddingTop: 1 } }} />
        ))}
      </Stack>
    </div>
  )
}

// 原因候補(claim→source binding 対応: クリックで参照資料がハイライト)
// Card の中で使用。内側ラベルは持たない(Card のヘッダで出す)。
function Causes({ causes, activeRank, setActiveRank }: {
  causes: Cause[]; activeRank: number | null; setActiveRank: (r: number | null) => void
}) {
  return (
    <Stack gap={0} style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
      {causes.map((c) => {
        const active = c.rank === activeRank
        const band = confBand(c.confidence)
        const docs = c.supporting_doc_ids ?? []
        return (
          <UnstyledButton key={c.rank} onClick={() => setActiveRank(active ? null : c.rank)}
            style={{
              padding: '14px 10px',
              borderBottom: '1px solid var(--mantine-color-gray-2)',
              background: active ? 'var(--mantine-color-gray-0)' : 'transparent',
              display: 'block', width: '100%', textAlign: 'left',
            }}>
            <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
              <Group gap={12} wrap="nowrap" style={{ minWidth: 0, flex: 1 }} align="flex-start">
                <Text size="xs" fw={700} c="dimmed" w={16} ff="monospace" style={{ flexShrink: 0, marginTop: 3 }}>{c.rank}.</Text>
                <Box style={{ minWidth: 0, flex: 1 }}>
                  <Text fw={c.rank === 1 ? 700 : 600} size="sm" c="gray.9" lh={1.4}>{c.cause}</Text>
                  {c.evidence && (
                    <Text size="xs" c="gray.6" mt={4} style={{ lineHeight: 1.65 }}>{stripIds(c.evidence)}</Text>
                  )}
                  {docs.length > 0 && (
                    <Group gap={5} mt={6}>
                      {docs.map(did => (
                        <Box key={did} component="span" px={6} py={1}
                          style={{
                            fontSize: 10, fontFamily: 'var(--mantine-font-family-monospace)',
                            border: '1px solid var(--mantine-color-gray-3)',
                            color: 'var(--mantine-color-gray-7)',
                            borderRadius: 3,
                          }}>{did}</Box>
                      ))}
                    </Group>
                  )}
                </Box>
              </Group>
              {/* 確信度は星のみ。「High」文字は Urgency と衝突するので使わない */}
              <Tooltip label={`確信度: ${band.label}`} withArrow>
                <Box style={{ flexShrink: 0, textAlign: 'right', paddingTop: 2 }}>
                  <Text size="xs" c="gray.5" ff="monospace">{band.stars}</Text>
                </Box>
              </Tooltip>
            </Group>
          </UnstyledButton>
        )
      })}
    </Stack>
  )
}

// 保全への情報パッケージ(プロダクトの核): 緊急度別に表示を変える
function MaintenancePackage({ result, intake }: { result: Triage; intake: Intake }) {
  const u = urgency(result.urgency.level)
  const tools = result.recommended_tools ?? []
  const top3 = (result.root_causes ?? []).slice(0, 3)
  const sim = (result.similar_cases ?? [])[0]
  const titleLabel = u.autonomy === 'auto' ? '保全へ送る情報パッケージ(Critical は承認スキップ・即時送信)'
    : u.autonomy === 'approve' || u.autonomy === 'parallel' ? '保全へ送る情報パッケージ(承認後に送信)'
    : '自己解決ガイド(保全通知は不要)'
  return (
    <Card p="lg" style={u.autonomy === 'auto' ? { borderColor: 'var(--mantine-color-red-4)' } : undefined}>
      <CardHead
        icon={u.autonomy === 'guide' ? <IconBulb size={18} /> : <IconSend size={18} />}
        title={titleLabel}
        sub={u.autonomy === 'guide'
          ? 'Low 判定: オペレーターが自身で確認すれば対応可能なレベル'
          : '電話で「異音がする」と呼ばれるより、現場到着後の診断時間を短縮するための情報セット'}
        right={u.autonomy === 'auto'
          ? <Badge color="red" variant="filled" radius={4} size="sm">即時通知レベル</Badge>
          : u.autonomy === 'approve' || u.autonomy === 'parallel'
            ? <Badge color="orange" variant="light" radius={4} size="sm">承認後に送信</Badge>
            : <Badge color="gray" variant="default" radius={4} size="sm">通知不要</Badge>}
      />
      {u.autonomy === 'guide' ? (
        <Text size="sm" c="gray.7">
          下の First checks を順に試してください。改善しない場合のみ保全に連絡してください。
        </Text>
      ) : (
        <Stack gap="md">
          {/* 通知本文プレビュー */}
          <Paper bg="gray.0" p="md" radius={4} withBorder>
            <Group gap={6} mb={8} wrap="nowrap">
              <IconAlertTriangle size={14} color={`var(--mantine-color-${u.color}-7)`} />
              <Text size="sm" fw={700} c={`${u.color}.8`}>製造トリアージ通知 [{u.label}]</Text>
            </Group>
            <Text size="xs" c="gray.7" mb={10}>
              設備: <Text span fw={600}>{intake.equipment_name}</Text> ({intake.equipment_id}) ・
              症状: <Text span fw={600}>{intake.symptom}</Text>
              {intake.error_code && <> ・ コード: <code className="mono">{intake.error_code}</code></>}
            </Text>
            {top3.length > 0 && (
              <Box mb={10}>
                <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>推定原因(確信度順)</Text>
                <Stack gap={2} pl={2}>
                  {top3.map(c => (
                    <Text key={c.rank} size="xs" c="gray.7">
                      {c.rank}. {c.cause} <Text span c="dimmed" ff="monospace">({Math.round(c.confidence * 100)}%)</Text>
                    </Text>
                  ))}
                </Stack>
              </Box>
            )}
            {tools.length > 0 && (
              <Box mb={10}>
                <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>持参推奨ツール</Text>
                <Group gap={6}>
                  {tools.map((t, i) => (
                    <Box key={i} component="span" px={6} py={2}
                      style={{
                        fontSize: 11, color: 'var(--mantine-color-gray-7)',
                        border: '1px solid var(--mantine-color-gray-3)',
                        borderRadius: 3, background: '#fff',
                      }}>{t}</Box>
                  ))}
                </Group>
              </Box>
            )}
            {sim && (
              <Box>
                <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>類似事例</Text>
                <Text size="xs" c="gray.7">{sim.date} ・ 原因={sim.cause} ・ {sim.recovery_minutes}分で復旧</Text>
              </Box>
            )}
          </Paper>
          <Text size="10px" c="dimmed">
            {u.autonomy === 'auto'
              ? '※ Critical: 承認スキップ・即時送信(本番運用時)。インシデント・ボードに送信者/時刻が監査ログとして残ります。'
              : '※ HITL(Human-in-the-Loop): 送信は人の承認後。インシデント・ボード経由で承認者/時刻/送信内容を全件監査ログに保持。'}
          </Text>
        </Stack>
      )}
    </Card>
  )
}

// 折り畳みセクション群(Similar / References / Ask follow-up)
// 業務 SaaS 調の控えめなドロップダウン。チャット UI 感を消す
// activeDocIds がセットされたら References を自動展開する(claim→source の体験完結のため)
function CollapsibleSections({ result, intake, activeDocIds }: {
  result: Triage; intake: Intake; activeDocIds: string[]
}) {
  const [open, setOpen] = useState<string | null>(null)
  // activeDocIds の中身が変わったら References を自動展開(claim→source の体験完結)
  // prop 変化トリガーで設計上は安全。React 19 の set-state-in-effect 警告は意図して抑止。
  const docsKey = activeDocIds.join('|')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (docsKey) setOpen(prev => prev === 'references' ? prev : 'references')
  }, [docsKey])
  return (
    <Card p={0}>
      <Accordion variant="separated" radius={4} chevronPosition="right" multiple={false}
        value={open} onChange={setOpen}
        styles={{
          item: { border: 'none', borderRadius: 0, background: 'transparent' },
          control: { paddingLeft: 16, paddingRight: 16 },
          panel: { paddingLeft: 16, paddingRight: 16, paddingBottom: 12 },
        }}>
        <Accordion.Item value="similar">
          <Accordion.Control icon={<IconHistory size={16} color="var(--mantine-color-gray-5)" />}>
            <Text size="sm" fw={600} c="gray.8">Similar cases <Text span c="dimmed" fw={400}>({result.similar_cases?.length ?? 0}件)</Text></Text>
          </Accordion.Control>
          <Accordion.Panel><SimilarCases cases={result.similar_cases ?? []} /></Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="references">
          <Accordion.Control icon={<IconRoute size={16} color="var(--mantine-color-gray-5)" />}>
            <Text size="sm" fw={600} c="gray.8">
              References <Text span c="dimmed" fw={400}>({result.citations.length}件)</Text>
              {activeDocIds.length > 0 && <Text span c="brand.7" fw={600} ml={6}> · 強調中 {activeDocIds.length}件</Text>}
            </Text>
          </Accordion.Control>
          <Accordion.Panel><References result={result} activeDocIds={activeDocIds} /></Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="followup">
          <Accordion.Control icon={<IconMessageChatbot size={16} color="var(--mantine-color-gray-5)" />}>
            <Text size="sm" fw={600} c="gray.8">Ask follow-up</Text>
          </Accordion.Control>
          <Accordion.Panel><FollowupPanel intake={intake} /></Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  )
}

// References(citations のリスト表示・activeDocIds は黄色強調 + 先頭にスクロール)
function References({ result, activeDocIds }: { result: Triage; activeDocIds: string[] }) {
  const refsTop = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (activeDocIds.length && refsTop.current) {
      refsTop.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeDocIds])
  const active = new Set(activeDocIds)
  return (
    <Stack gap="sm" ref={refsTop}>
      {/* エージェント工程(コンパクト) */}
      <div>
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>Agent trace</Text>
        <Stack gap={2}>
          {result.trace.map((t, i) => (
            <Group key={i} gap={6} wrap="nowrap">
              <Badge size="xs" radius={3} variant="default" tt="none" style={{ flexShrink: 0 }}>{t.agent}</Badge>
              <Text size="xs" c="gray.7" truncate>{t.title}<Text span c="dimmed"> · {stripIds(t.detail)}</Text></Text>
            </Group>
          ))}
        </Stack>
      </div>
      {/* 専門所見 */}
      {result.specialist_findings?.length > 0 && (
        <div>
          <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>Specialist findings</Text>
          <Stack gap="sm">
            {result.specialist_findings.map((f, i) => (
              <Paper key={i} withBorder p="sm" radius={4} bg="gray.0">
                <Badge variant="light" color="brand" radius={3} size="xs" mb={6} tt="none">{f.label}</Badge>
                <Text size="xs" c="gray.7" style={{ whiteSpace: 'pre-wrap' }}>{stripIds(f.output)}</Text>
              </Paper>
            ))}
          </Stack>
        </div>
      )}
      {/* citation 群(active な doc_id は黄色強調) */}
      <div>
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>Citations</Text>
        <ScrollArea.Autosize mah={280}>
          <Stack gap={6} pr="sm">
            {result.citations.map((c, i) => {
              const on = active.has(c.doc_id)
              return (
                <Paper key={i} withBorder p="sm" radius={4}
                  bg={on ? 'yellow.0' : 'gray.0'}
                  style={on ? { borderColor: 'var(--mantine-color-yellow-4)' } : undefined}>
                  <Group gap={6} mb={4} wrap="nowrap">
                    <Badge size="xs" variant="default" radius={3} ff="monospace">{c.doc_id}</Badge>
                    <Badge size="xs" variant="default" radius={3}>{c.label}</Badge>
                    {c.is_feedback && <Badge size="xs" color="teal" variant="light" radius={3}>現場確定</Badge>}
                  </Group>
                  <Text size="xs" c="gray.7">{c.text}</Text>
                </Paper>
              )
            })}
          </Stack>
        </ScrollArea.Autosize>
      </div>
    </Stack>
  )
}

// 類似事例(Accordion内で使用・控えめなテーブル風)
function SimilarCases({ cases }: { cases: Similar[] }) {
  if (!cases || cases.length === 0) {
    return <Text size="xs" c="dimmed" pl={2}>関連する過去事例はありません</Text>
  }
  return (
    <Stack gap={6}>
      {cases.map((s, i) => (
        <Group key={i} justify="space-between" wrap="nowrap" gap="sm" py={6}
          style={{ borderBottom: i < cases.length - 1 ? '1px solid var(--mantine-color-gray-2)' : 'none' }}>
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text size="xs" c="gray.6" ff="monospace">{s.date}</Text>
            <Text fw={600} size="sm" c="gray.8" mt={2}>{s.title}</Text>
            <Text size="xs" c="gray.6" mt={2}>原因: {s.cause} ・ {s.note}</Text>
          </Box>
          <Text size="xs" c="gray.7" ff="monospace" style={{ flexShrink: 0 }}>{s.recovery_minutes}分で復旧</Text>
        </Group>
      ))}
    </Stack>
  )
}

// ---- フォローアップ質問 ----------------------------------------------------
// Markdown 回答(Mantine 調の体裁・サイズ控えめ)
function MarkdownAnswer({ text }: { text: string }) {
  return (
    <div className="md-answer">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  )
}

function FollowupPanel({ intake }: { intake: Intake }) {
  const [q, setQ] = useState('')
  const [log, setLog] = useState<{ q: string; a: string }[]>([])
  const [loading, setLoading] = useState(false)
  const ask = async (preset?: string) => {
    const question = (preset ?? q).trim()
    if (!question || loading) return
    setQ(''); setLoading(true)
    const idx = log.length
    setLog((l) => [...l, { q: question, a: '' }])
    try {
      const res = await fetch('/api/followup/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...intake, question }),
      })
      if (!res.ok || !res.body) throw new Error()
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let acc = ''
      for (; ;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += dec.decode(value, { stream: true })
        setLog((l) => l.map((e, i) => (i === idx ? { ...e, a: acc } : e)))
      }
    } catch {
      setLog((l) => l.map((e, i) => (i === idx ? { ...e, a: '回答を取得できませんでした。時間をおいて再度お試しください。' } : e)))
    } finally { setLoading(false) }
  }
  return (
    <Stack gap="md" className="no-print">
      <Text size="xs" c="dimmed">この診断結果と参照資料に基づいて追加の質問に答えます。</Text>
      {log.length === 0 && (
        <Group gap={6} wrap="wrap">
          {['推奨工具の詳細を教えて', '再発防止策は？', '点検頻度の目安は？'].map((s) => (
            <Button key={s} variant="default" size="compact-sm" radius={4} disabled={loading} onClick={() => ask(s)}>{s}</Button>
          ))}
        </Group>
      )}
      {log.map((e, i) => {
        const streaming = loading && i === log.length - 1 && !e.a
        return (
          <Box key={i}>
            <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>Q</Text>
            <Text size="sm" fw={600} c="gray.8" mb={6}>{e.q}</Text>
            <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>Answer</Text>
            <Paper bg="gray.0" p="sm" radius={4} withBorder>
              {streaming
                ? <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">回答を作成中…</Text></Group>
                : <MarkdownAnswer text={stripIds(e.a)} />}
            </Paper>
          </Box>
        )
      })}
      <Group gap="xs" wrap="nowrap">
        <TextInput style={{ flex: 1, minWidth: 0 }} placeholder="例: ローラー交換の手順は？" value={q}
          onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
        <MicIcon size={36} onText={(t) => setQ(q ? `${q} ${t}` : t)} />
        <Button onClick={() => ask()} loading={loading} variant="default" leftSection={<IconSend size={15} />}>Inquire</Button>
      </Group>
    </Stack>
  )
}

// ---- フィードバック --------------------------------------------------------
function FeedbackForm({ defaultEq, defaultErr, defaultSymptom, defaultCause, fromResult }:
  { defaultEq: string; defaultErr: string; defaultSymptom: string; defaultCause?: string; fromResult?: boolean }) {
  const [eq, setEq] = useState(defaultEq); const [err, setErr] = useState(defaultErr); const [symptom, setSymptom] = useState(defaultSymptom)
  const [cause, setCause] = useState(defaultCause ?? '搬送ローラー摩耗'); const [action, setAction] = useState('駆動ローラー交換')
  const [rec, setRec] = useState<number | string>(22); const [correct, setCorrect] = useState('当たり'); const [note, setNote] = useState('')
  const submit = async () => {
    const res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipment_id: eq, error_code: err, symptom, root_cause: cause, action_taken: action, recovery_minutes: Number(rec), ai_was_correct: correct, note }) })
    if (res.ok) notifications.show({ color: 'teal', icon: <IconCheck size={16} />, title: '登録しました', message: '次回のトリアージから現場確定事例として参照されます' })
  }
  return (
    <Grid gap="lg" align="stretch">
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Card p="lg" h="100%">
          <CardHead icon={<IconClipboardPlus size={16} />} title="対応実績の登録" sub="実際の結果が次回以降の検索対象に加わります" />
          {fromResult && (
            <Paper p="xs" mb="md" withBorder
              style={{ borderColor: 'var(--mantine-color-gray-3)', background: 'var(--mantine-color-gray-0)' }}>
              <Group gap={8} wrap="nowrap">
                <IconArrowRight size={13} color="var(--mantine-color-gray-6)" style={{ flexShrink: 0 }} />
                <Text size="xs" c="gray.7">診断結果から引き継ぎました。実際の対処結果に修正して登録してください。</Text>
              </Group>
            </Paper>
          )}
          <Stack gap="sm">
            <Group grow>
              <TextInput label="設備ID" value={eq} onChange={(e) => setEq(e.currentTarget.value)} />
              <TextInput label="エラーコード" value={err} onChange={(e) => setErr(e.currentTarget.value)} />
            </Group>
            <TextInput label="症状" value={symptom} onChange={(e) => setSymptom(e.currentTarget.value)} />
            <TextInput label="実際の原因" value={cause} onChange={(e) => setCause(e.currentTarget.value)} />
            <TextInput label="実施した対処" value={action} onChange={(e) => setAction(e.currentTarget.value)} />
            <Group grow>
              <NumberInput label="復旧時間 (分)" value={rec} onChange={setRec} min={0} />
              <Select label="AI 回答の精度" value={correct} onChange={(v) => setCorrect(v ?? correct)} data={['当たり', '部分的', '外れ']} allowDeselect={false} />
            </Group>
            <Textarea label="追加メモ" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={2} />
            <Button leftSection={<IconCheck size={15} />} onClick={submit} mt={4}>登録する</Button>
          </Stack>
        </Card>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Card p="lg" h="100%">
          <CardHead icon={<IconRoute size={16} />} title="現場知見の学習ループ" sub="登録は次回トリアージの検索に直結します" />
          <Stack gap={0}>
            {LEARN_STEPS.map((s, i) => {
              const last = i === LEARN_STEPS.length - 1
              return (
                <Group key={i} gap="md" wrap="nowrap" align="flex-start">
                  <Stack gap={0} align="center" w={24} style={{ flexShrink: 0 }}>
                    <Box w={20} h={20} style={{
                      borderRadius: 4, border: '1px solid var(--mantine-color-gray-3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text size="10px" fw={700} c="gray.7" ff="monospace">{i + 1}</Text>
                    </Box>
                    {!last && <Box w={1} flex={1} mih={18} bg="gray.2" my={4} />}
                  </Stack>
                  <Box pb={last ? 0 : 'md'} pt={2} style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={650} size="sm" c="gray.8">{s.title}</Text>
                    <Text size="xs" c="dimmed" mt={2}>{s.desc}</Text>
                  </Box>
                </Group>
              )
            })}
          </Stack>
          <Box mt="md" pt={10} style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
            <Text size="11px" c="gray.6" lh={1.5}>
              登録が増えるほど現場固有の知見が蓄積され、原因特定の精度と初動の速さが向上します。
            </Text>
          </Box>
        </Card>
      </Grid.Col>
    </Grid>
  )
}

const LEARN_STEPS = [
  { title: '対応実績を登録', desc: '実際の原因・対処・復旧時間を入力' },
  { title: '現場確定事例として索引化', desc: '検索対象のナレッジに自動で追加' },
  { title: '次回トリアージで優先参照', desc: '同様の症状で確定事例を根拠に提示' },
  { title: '診断精度が継続的に向上', desc: '使うほど現場に最適化されていく' },
]

// ---- ナレッジ集計 ----------------------------------------------------------
type Knowledge = {
  total: number; avg_recovery: number; estimated_saved_minutes: number
  feedback_count?: number; ai_hit_rate?: number | null
  top_causes: { cause: string; count: number }[]
  by_equipment: { equipment: string; count: number }[]
  by_code?: { code: string; count: number }[]
  by_symptom?: { symptom: string; count: number }[]
  by_month?: { month: string; count: number; avg_recovery: number }[]
  equip_recovery?: { equipment: string; avg: number; count: number }[]
  longest: { date: string; equipment_id: string; cause: string; minutes: number }[]
}
function KnowledgeView() {
  const { data: k, loading, refresh } = useCached<Knowledge>('knowledge', () => fetch('/api/knowledge').then((r) => r.json()))
  const load = refresh
  if (!k) {
    return loading ? (
      <Stack gap="md">
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">{[0, 1, 2, 3].map((i) => <Card key={i} p="md"><Skeleton h={9} w="60%" mb="md" /><Skeleton h={26} w="40%" /></Card>)}</SimpleGrid>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md"><CardSkeleton rows={5} /><CardSkeleton rows={5} /></SimpleGrid>
      </Stack>
    ) : <Center mih={240}><Text size="sm" c="dimmed">データを取得できませんでした</Text></Center>
  }
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="11px" c="dimmed">登録済み事例 {k.total} 件(うち現場確定 {k.feedback_count ?? 0} 件)</Text>
        <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} onClick={load}>Refresh</Button>
      </Group>

      {/* KPI 群: 縦線セパレータで統一 */}
      <Card p="lg">
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing={0}>
          <KpiTile label="登録事例" value={k.total.toLocaleString()} unit="件" />
          <KpiTile label="平均復旧時間" value={k.avg_recovery.toString()} unit="分" sep />
          <KpiTile label="AI 的中率" value={k.ai_hit_rate == null ? '—' : `${k.ai_hit_rate}`} unit={k.ai_hit_rate == null ? '' : '%'} sep />
          <KpiTile label="DT 削減(試算)" value={k.estimated_saved_minutes.toLocaleString()} unit="分/月" sep accent />
        </SimpleGrid>
      </Card>

      {/* 月別トレンド(AreaChart) */}
      {(k.by_month?.length ?? 0) > 0 && (
        <Card p="lg">
          <CardHead icon={<IconChartHistogram size={16} />} title="月別トレンド" sub="件数と平均復旧時間の推移" />
          <AreaChart
            h={220}
            data={(k.by_month ?? []).map(m => ({ month: m.month, '件数': m.count, '平均復旧(分)': m.avg_recovery }))}
            dataKey="month"
            series={[
              { name: '件数', color: 'brand.6' },
              { name: '平均復旧(分)', color: 'orange.5' },
            ]}
            curveType="monotone"
            withDots={false}
            gridAxis="xy"
            tickLine="none"
            withLegend
            legendProps={{ verticalAlign: 'top', height: 30 }}
            valueFormatter={(v) => v.toLocaleString()}
          />
        </Card>
      )}

      {/* 原因ランキング / 設備別 */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card p="lg">
          <CardHead icon={<IconChartBar size={16} />} title="よくある原因 Top 6" />
          <BarChart
            h={240}
            data={(k.top_causes ?? [])
              // ノイズ除去: 1〜2 字未満の意味の無い cause(テスト残骸など)は除外
              .filter(c => (c.cause || '').trim().length >= 3)
              .slice(0, 6)
              .map(c => {
                // ラベルは最大 12 字、超過は末尾「…」で省略
                const full = (c.cause || '').trim()
                const label = full.length > 12 ? full.slice(0, 11) + '…' : full
                return { cause: label, _full: full, 件数: c.count }
              })}
            dataKey="cause"
            orientation="vertical"
            yAxisProps={{ width: 168, tick: { fontSize: 11 } }}
            xAxisProps={{ tick: { fontSize: 10 } }}
            series={[{ name: '件数', color: 'brand.6' }]}
            barProps={{ radius: 2 }}
            gridAxis="x"
            withLegend={false}
            valueFormatter={(v) => `${v}件`}
          />
        </Card>
        <Card p="lg">
          <CardHead icon={<IconBuildingFactory2 size={16} />} title="設備別 件数" />
          <BarChart
            h={220}
            data={(k.by_equipment ?? []).slice(0, 8).map(e => ({ equipment: e.equipment, 件数: e.count }))}
            dataKey="equipment"
            yAxisProps={{ width: 24, tick: { fontSize: 10 } }}
            xAxisProps={{ tick: { fontSize: 10 } }}
            series={[{ name: '件数', color: 'gray.6' }]}
            barProps={{ radius: 2 }}
            gridAxis="y"
            withLegend={false}
            valueFormatter={(v) => `${v}件`}
          />
        </Card>
      </SimpleGrid>

      {/* 症状別 ドーナツ + 復旧時間上位 */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {(k.by_symptom?.length ?? 0) > 0 && (
          <Card p="lg">
            <CardHead icon={<IconActivityHeartbeat size={16} />} title="症状カテゴリ別" />
            <Group gap="lg" wrap="nowrap" align="center" mt="sm">
              <DonutChart
                size={180}
                thickness={28}
                data={(k.by_symptom ?? []).map((s, i) => ({
                  name: s.symptom, value: s.count,
                  color: ['brand.6', 'orange.5', 'red.5', 'teal.5', 'gray.5', 'grape.5'][i] ?? 'gray.5'
                }))}
                strokeWidth={1}
              />
              <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                {(k.by_symptom ?? []).map((s, i) => (
                  <Group key={s.symptom} gap={8} wrap="nowrap" justify="space-between">
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      <Box w={8} h={8} style={{
                        background: `var(--mantine-color-${['brand', 'orange', 'red', 'teal', 'gray', 'grape'][i] ?? 'gray'}-5)`,
                        borderRadius: 2, flexShrink: 0
                      }} />
                      <Text size="xs" c="gray.7" truncate>{s.symptom}</Text>
                    </Group>
                    <Text size="xs" c="dimmed" ff="monospace" style={{ flexShrink: 0 }}>{s.count}件</Text>
                  </Group>
                ))}
              </Stack>
            </Group>
          </Card>
        )}
        <Card p="lg">
          <CardHead icon={<IconClock size={16} />} title="復旧時間 上位" sub="長時間化したトラブル" />
          <Stack gap={0}>
            {k.longest.map((t, i) => (
              <Group key={i} justify="space-between" py={8} wrap="nowrap" gap="sm"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--mantine-color-gray-2)' }}>
                <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Text size="11px" c="dimmed" ff="monospace" w={80} style={{ flexShrink: 0 }} visibleFrom="xs">{t.date}</Text>
                  <code className="mono" style={{ flexShrink: 0 }}>{t.equipment_id}</code>
                  <Text size="sm" c="gray.7" truncate miw={0}>{t.cause}</Text>
                </Group>
                <Text size="xs" c="orange.7" ff="monospace" fw={600} style={{ flexShrink: 0 }}>{t.minutes} 分</Text>
              </Group>
            ))}
          </Stack>
        </Card>
      </SimpleGrid>

      <ROICard total={k.total} avg={k.avg_recovery} />

      <Text size="10px" c="dimmed" ta="center">
        ※ ROI は初動判断短縮の試算値。係数(短縮率・分単価)は現場の実態に合わせて画面で調整してください。
      </Text>
    </Stack>
  )
}

function KpiTile({ label, value, unit, sep, accent }: {
  label: string; value: string; unit?: string; sep?: boolean; accent?: boolean
}) {
  return (
    <Box style={{ padding: '4px 16px', borderLeft: sep ? '1px solid var(--mantine-color-gray-2)' : 'none' }}>
      <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }}>{label}</Text>
      <Group gap={6} align="baseline" mt={6}>
        <Text fw={700} fz={26} c={accent ? 'brand.7' : 'gray.9'} className="tnum" lh={1}>{value}</Text>
        {unit && <Text size="xs" c="dimmed">{unit}</Text>}
      </Group>
    </Box>
  )
}

// ダウンタイム削減 ROI(係数を画面で調整できる式 — Linear/業務 SaaS 調)
// 「ピッチで Siemens TCOD 2024 等の出典を載せた控えめな係数を出発点に提示」する想定
function ROICard({ total, avg }: { total: number; avg: number }) {
  const [count, setCount] = useState<number | string>(total)
  const [recMin, setRecMin] = useState<number | string>(avg)
  const [reduction, setReduction] = useState<number | string>(30)
  const [rate, setRate] = useState<number | string>(8000)
  const c = Number(count) || 0, r = Number(recMin) || 0, red = Number(reduction) || 0, y = Number(rate) || 0
  const savedMin = Math.round((c * r * red) / 100)
  const savedYen = savedMin * y
  return (
    <Card p="lg">
      <CardHead icon={<IconBolt size={16} />} title="ダウンタイム削減 ROI 試算" sub="係数を変えると即時に再計算されます" />
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" mb="md">
        <NumberInput label="対象件数" value={count} onChange={setCount} min={0} thousandSeparator="," />
        <NumberInput label="平均復旧時間(分)" value={recMin} onChange={setRecMin} min={0} />
        <NumberInput label="初動短縮率(%)" value={reduction} onChange={setReduction} min={0} max={100} suffix="%" />
        <NumberInput label="分単価(¥/分)" value={rate} onChange={setRate} min={0} step={500} thousandSeparator="," prefix="¥" />
      </SimpleGrid>
      <Box style={{ borderTop: '1px solid var(--mantine-color-gray-2)', paddingTop: 12 }}>
        <Group justify="space-between" wrap="nowrap" mb={6}>
          <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }}>計算式</Text>
          <Text size="xs" c="gray.7" ff="monospace">{c.toLocaleString()} 件 × {r} 分 × {red}% × ¥{y.toLocaleString()}/分</Text>
        </Group>
        <Group justify="space-between" align="baseline" wrap="wrap" gap="xs" mt={4}>
          <Text size="xs" c="gray.6">削減見込み: <Text span fw={700} c="gray.9" ff="monospace">{savedMin.toLocaleString()}</Text> <Text span size="10px" c="dimmed">分</Text></Text>
          <Group gap={6} align="baseline">
            <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }}>月間削減額</Text>
            <Text fw={700} fz={24} c="brand.7" className="tnum" lh={1}>¥{savedYen.toLocaleString()}</Text>
          </Group>
        </Group>
      </Box>
    </Card>
  )
}

// ===========================================================================
// 自律インシデント・ボード（R1 + S1 + S3）
// ===========================================================================
type AuditEntry = { action: string; by: string; ts: string; detail: string }
type IncidentTriage = {
  urgency?: { level: string; reason: string }
  root_causes?: Cause[]
  recommended_tools?: string[]
  similar_cases?: Similar[]
  escalation?: { should_notify: boolean; to: string; message: string }
  parallel_checks_while_waiting?: string[]
}
type Incident = {
  id: string; equipment_id: string; equipment_name: string; error_code: string; symptom: string
  free_text?: string
  source: string; created_at: string; urgency: string; top_cause: string; confidence: number; status: string
  trust_band?: 'green' | 'yellow' | 'red'
  audit?: AuditEntry[]
  triage?: IncidentTriage
  resolution: null | { root_cause: string; recovery_minutes: number; note?: string; ai_was_correct?: string }
}
type Board = { incidents: Incident[]; kpi: {
  awaiting_approval: number; auto_escalated: number; triaged: number; escalated: number;
  resolved: number; self_help: number; ai_hit_rate: number | null
} }
const STATUS_META: Record<string, { label: string; color: string }> = {
  awaiting_approval: { label: '承認待ち', color: 'orange' },
  auto_escalated:    { label: '自動通知済', color: 'red' },
  triaged:           { label: '対応待ち', color: 'gray' },
  escalated:         { label: '保全対応中', color: 'blue' },
  resolved:          { label: '解決済み', color: 'teal' },
  self_help:         { label: '自己解決ガイド', color: 'gray' },
}

function IncidentBoard() {
  const { data: board, loading, refresh } = useCached<Board>('incidents', () => fetch('/api/incidents').then((r) => r.json()))
  const [busy, setBusy] = useState(false)
  const load = refresh
  const ingest = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/incidents/ingest_sample', { method: 'POST' })
      if (!res.ok) throw new Error()
      await load()
    }
    catch { notifications.show({ color: 'red', title: 'インシデント', message: '取り込みに失敗しました' }) }
    finally { setBusy(false) }
  }
  const k = board?.kpi
  return (
    <Stack gap="md">
      <Group justify="flex-end" gap="xs" wrap="nowrap">
        <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} onClick={load}>更新</Button>
        <Button variant="default" size="xs" leftSection={<IconDownload size={15} />} loading={busy} onClick={ingest}>サンプルを取り込み</Button>
      </Group>

      {k && (
        <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm">
          <MiniStat label="Critical 自動通知" value={k.auto_escalated ?? 0} color="red" />
          <MiniStat label="承認待ち" value={k.awaiting_approval} color="orange" />
          <MiniStat label="対応中" value={k.escalated} color="blue" />
          <MiniStat label="解決済み" value={k.resolved} color="teal" />
          <MiniStat label="AI 的中率" value={k.ai_hit_rate == null ? '—' : `${k.ai_hit_rate}%`} color="gray" />
        </SimpleGrid>
      )}

      {busy && !board?.incidents?.length ? (
        <Card p="xl"><Center mih={180}><Stack align="center" gap="sm" maw={360}>
          <Loader />
          <Text fw={650} c="gray.8">アラームをトリアージ中…</Text>
          <Text size="sm" c="dimmed" ta="center">各アラームを自動診断しています（通常 10〜30 秒）。</Text>
        </Stack></Center></Card>
      ) : !board ? (
        loading ? (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">{[0, 1, 2, 3].map((i) => <Card key={i} p="md"><Skeleton h={9} w="70%" mb={10} /><Skeleton h={24} w="40%" /></Card>)}</SimpleGrid>
            <Stack gap="sm">{[0, 1, 2].map((i) => <Card key={i} p="md"><Group><Skeleton h={36} w={36} radius="md" /><Box style={{ flex: 1 }}><Skeleton h={11} w="50%" mb={8} /><Skeleton h={9} w="80%" /></Box></Group></Card>)}</Stack>
          </Stack>
        ) : <Center mih={160}><Text size="sm" c="dimmed">データを取得できませんでした</Text></Center>
      ) : board.incidents.length === 0 ? (
        <EmptyBoard onIngest={ingest} busy={busy} />
      ) : (
        <IncidentTable incidents={board.incidents} onChange={load} />
      )}
    </Stack>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <Card p="md">
      <Group gap={6} wrap="nowrap" mb={6}>
        <Box w={8} h={8} bg={`${color}.5`} style={{ borderRadius: 2, flexShrink: 0 }} />
        <Text size="xs" c="dimmed" fw={500} truncate miw={0}>{label}</Text>
      </Group>
      <Text fw={700} fz={26} c="gray.9" className="tnum" lh={1}>{value}</Text>
    </Card>
  )
}

function EmptyBoard({ onIngest, busy }: { onIngest: () => void; busy: boolean }) {
  return (
    <Card p="xl">
      <Center mih={220}>
        <Stack align="center" gap="sm" maw={440}>
          <Box style={{
            width: 40, height: 40, borderRadius: 6,
            border: '1px solid var(--mantine-color-gray-3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--mantine-color-gray-6)',
          }}>
            <IconInbox size={18} stroke={1.6} />
          </Box>
          <Text fw={650} c="gray.9">インシデントはありません</Text>
          <Text size="sm" c="dimmed" ta="center">
            設備アラームのサンプルを取り込むと、AI が自動でトリアージして緊急度順に一覧表示します。
            <br />
            Critical = 自動通知 / High,Medium = 承認待ち / Low = 自己解決ガイド
          </Text>
          <Button variant="default" leftSection={<IconDownload size={14} />} loading={busy} onClick={onIngest} mt={4}>
            サンプルを取り込み
          </Button>
        </Stack>
      </Center>
    </Card>
  )
}

function IncidentTable({ incidents, onChange }: { incidents: Incident[]; onChange: () => void }) {
  const [resolving, setResolving] = useState<Incident | null>(null)
  const [previewing, setPreviewing] = useState<Incident | null>(null)   // Shadow Mode 承認 Modal
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)      // 監査ログ展開
  // 実際の承認実行(Shadow Mode Modal の「送信して承認」から呼ばれる)
  const executeApprove = async (inc: Incident) => {
    setBusyId(inc.id)
    try {
      const res = await fetch(`/api/incidents/${inc.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) throw new Error()
      notifications.show({ color: 'teal', icon: <IconCheck size={16} />, title: '承認しました',
                            message: '保全へ情報パッケージを送信し、対応中に移行しました' })
      setPreviewing(null)
      onChange()
    } catch {
      notifications.show({ color: 'red', title: '承認に失敗しました', message: '時間をおいて再度お試しください' })
    } finally { setBusyId(null) }
  }
  const rows = incidents.flatMap((inc) => {
    const u = urgency(inc.urgency)
    const st = STATUS_META[inc.status] ?? { label: inc.status, color: 'gray' }
    // 表示: 年は省略(同年の運用想定)。06-14 08:12 形式
    const tsShort = (inc.created_at || '').replace('T', ' ').slice(5, 16)
    const t = trustMeta(inc.trust_band)
    const stars = inc.confidence > 0 ? confBand(inc.confidence).stars : ''
    const expanded = expandedId === inc.id
    return [
      <Table.Tr key={inc.id} style={{ cursor: 'pointer', background: expanded ? 'var(--mantine-color-gray-0)' : undefined }}
        onClick={(e) => {
          // ボタン/アクション要素のクリックでは展開しない(イベントが上に伝播)
          const tgt = e.target as HTMLElement
          if (tgt.closest('button')) return
          setExpandedId(expanded ? null : inc.id)
        }}>
        {/* Urgency: ドット + 単語(1 行) */}
        <Table.Td>
          <Group gap={6} wrap="nowrap" align="center">
            <IconArrowRight size={10} stroke={2}
              style={{ color: 'var(--mantine-color-gray-4)', flexShrink: 0,
                       transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                       transition: 'transform 0.15s ease' }} />
            <Box w={6} h={6} bg={`${u.color}.6`} style={{ borderRadius: 999, flexShrink: 0 }} />
            <Text size="sm" fw={650} c={`${u.color}.7`} style={{ whiteSpace: 'nowrap' }}>{u.label}</Text>
          </Group>
        </Table.Td>

        {/* Equipment: 名前(主)+ ID(副) — テーブル唯一の2行セル(視覚的リズム用) */}
        <Table.Td>
          <Text size="sm" fw={600} c="gray.9" style={{ whiteSpace: 'nowrap' }}>{inc.equipment_name}</Text>
          <code className="mono" style={{ fontSize: 10 }}>{inc.equipment_id}</code>
        </Table.Td>

        {/* Symptom: 症状 · エラーコード を 1 行インライン */}
        <Table.Td>
          <Text size="sm" c="gray.8" style={{ whiteSpace: 'nowrap' }}>
            {inc.symptom}
            {inc.error_code && (
              <Text span c="dimmed" ml={6} style={{ fontSize: 11 }}>
                · <code className="mono" style={{ fontSize: 10 }}>{inc.error_code}</code>
              </Text>
            )}
          </Text>
        </Table.Td>

        {/* Estimated cause: 1 行 + 右端に確信度の星(High/Med/Low 文字を排除して Urgency と衝突回避) */}
        <Table.Td miw={220} style={{ maxWidth: 320 }}>
          <Group gap={8} wrap="nowrap" justify="space-between">
            <Text size="sm" c="gray.7" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
              {inc.top_cause || '—'}
            </Text>
            {stars && (
              <Tooltip label={`Top cause confidence: ${confBand(inc.confidence).label}`} withArrow>
                <Text size="10px" c="gray.5" ff="monospace" style={{ flexShrink: 0 }}>{stars}</Text>
              </Tooltip>
            )}
          </Group>
        </Table.Td>

        {/* Trust: ドット + 1 ラベルのみ(「確信」行は廃止) */}
        <Table.Td>
          <Group gap={6} wrap="nowrap">
            <TrustDots band={inc.trust_band} />
            <Text size="11px" c="gray.6" style={{ whiteSpace: 'nowrap' }}>{t.label}</Text>
          </Group>
        </Table.Td>

        {/* Detected: 日時 · 検知源 を 1 行インライン */}
        <Table.Td>
          <Text size="11px" c="dimmed" ff="monospace" style={{ whiteSpace: 'nowrap' }}>
            {tsShort}
            <Text span c="gray.4" mx={4}>·</Text>
            <Text span c="gray.6" style={{ fontFamily: 'inherit' }}>{inc.source}</Text>
          </Text>
        </Table.Td>

        {/* Status: バッジ */}
        <Table.Td>
          <Badge color={st.color} variant="light" radius={3} size="sm" style={{ whiteSpace: 'nowrap' }}
            styles={{ label: { overflow: 'visible' } }}>{st.label}</Badge>
        </Table.Td>
        {/* Action: Status と同じ単語の重複を避け、ボタンと付加情報だけを置く */}
        <Table.Td>
          {inc.status === 'resolved' ? (
            <Tooltip label={inc.resolution ? `${inc.resolution.root_cause} · AI=${inc.resolution.ai_was_correct ?? '—'}` : '—'} withArrow>
              <Text size="11px" c="teal.7" ff="monospace" ta="right" style={{ whiteSpace: 'nowrap' }}>
                復旧 {inc.resolution?.recovery_minutes ?? '—'} 分
              </Text>
            </Tooltip>
          ) : (
            <Group gap={6} wrap="nowrap" justify="flex-end">
              {inc.status === 'awaiting_approval' && (
                <Button size="compact-xs" color="red" leftSection={<IconShieldCheck size={13} />}
                  loading={busyId === inc.id} onClick={() => setPreviewing(inc)}>
                  Approve & notify
                </Button>
              )}
              <Button size="compact-xs" variant="default" onClick={() => setResolving(inc)}>
                {inc.status === 'self_help' ? '確認済み' : '解決を記録'}
              </Button>
            </Group>
          )}
        </Table.Td>
      </Table.Tr>,
      expanded ? (
        <Table.Tr key={`${inc.id}-audit`}>
          <Table.Td colSpan={8} style={{ background: 'var(--mantine-color-gray-0)', padding: '14px 18px',
                                          borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
            <IncidentAuditPanel inc={inc} />
          </Table.Td>
        </Table.Tr>
      ) : null,
    ]
  })
  return (
    <Card p={0} withBorder>
      <Table.ScrollContainer minWidth={1120}>
        <Table highlightOnHover verticalSpacing={10} horizontalSpacing="md" stickyHeader
          styles={{
            th: { whiteSpace: 'nowrap', fontSize: 11, color: 'var(--mantine-color-gray-6)',
                  fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                  borderBottom: '1px solid var(--mantine-color-gray-3)' },
            td: { borderBottom: '1px solid var(--mantine-color-gray-2)' },
          }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Urgency</Table.Th>
              <Table.Th>Equipment</Table.Th>
              <Table.Th>Symptom</Table.Th>
              <Table.Th>Estimated cause</Table.Th>
              <Table.Th>Trust</Table.Th>
              <Table.Th>Detected</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th ta="right">Action</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{rows}</Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <ResolveModal inc={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); onChange() }} />
      <ShadowApproveModal inc={previewing} busy={!!previewing && busyId === previewing.id}
        onClose={() => setPreviewing(null)} onConfirm={() => previewing && executeApprove(previewing)} />
    </Card>
  )
}

// 監査ログのタイムライン展開(FINOS MI-21 Tier 2 相当の証跡可視化)
function IncidentAuditPanel({ inc }: { inc: Incident }) {
  const events = inc.audit ?? []
  const fmt = (ts: string) => ts ? ts.replace('T', ' ').replace(/\+00:00$/, ' UTC').slice(0, 19) : '—'
  const actionLabel = (a: string) =>
    a === 'auto_triaged' ? '自動トリアージ'
    : a === 'auto_escalated' ? '自動エスカレーション(Critical)'
    : a === 'self_help' ? '自己解決ガイドのみ(Low)'
    : a === 'approved_escalated' ? '承認 → 保全へ情報パッケージ送信'
    : a === 'resolved' ? '解決'
    : a
  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={8} style={{ letterSpacing: 0.6 }}>Audit trail</Text>
        <Stack gap={0}>
          {events.length === 0
            ? <Text size="xs" c="dimmed">監査ログなし</Text>
            : events.map((e, i) => {
              const last = i === events.length - 1
              return (
                <Group key={i} gap="sm" wrap="nowrap" align="flex-start">
                  <Stack gap={0} align="center" w={14} style={{ flexShrink: 0 }}>
                    <Box w={8} h={8} bg="brand.6" style={{ borderRadius: 999, marginTop: 5 }} />
                    {!last && <Box w={1} flex={1} mih={28} bg="gray.3" />}
                  </Stack>
                  <Box pb={last ? 0 : 12} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap={8} wrap="nowrap" align="baseline">
                      <Text size="11px" c="gray.6" ff="monospace">{fmt(e.ts)}</Text>
                      <Text size="xs" fw={600} c="gray.9">{actionLabel(e.action)}</Text>
                      <Text size="11px" c="dimmed">— {e.by}</Text>
                    </Group>
                    {e.detail && <Text size="xs" c="gray.6" mt={2}>{e.detail}</Text>}
                  </Box>
                </Group>
              )
            })}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={8} style={{ letterSpacing: 0.6 }}>Triage details</Text>
        <Stack gap={6}>
          <DefRow k="Equipment" v={<><code className="mono">{inc.equipment_id}</code> ・ {inc.equipment_name}</>} />
          <DefRow k="Symptom" v={<Text size="xs" c="gray.7">{inc.symptom}{inc.error_code ? <> ・ <code className="mono">{inc.error_code}</code></> : null}</Text>} />
          {inc.free_text && (
            <DefRow k="Free text" v={<Text size="xs" c="gray.7" lineClamp={3}>{inc.free_text}</Text>} />
          )}
          {inc.triage?.urgency?.reason && (
            <DefRow k="Reason" v={<Text size="xs" c="gray.7" lineClamp={3}>{inc.triage.urgency.reason}</Text>} />
          )}
          {(inc.triage?.recommended_tools ?? []).length > 0 && (
            <Box style={{ paddingTop: 6 }}>
              <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.6 }}>持参推奨ツール</Text>
              <Group gap={5}>
                {(inc.triage?.recommended_tools ?? []).map((t, i) => (
                  <Box key={i} component="span" px={6} py={1}
                    style={{ fontSize: 10, color: 'var(--mantine-color-gray-7)',
                              border: '1px solid var(--mantine-color-gray-3)', borderRadius: 3, background: '#fff' }}>
                    {t}
                  </Box>
                ))}
              </Group>
            </Box>
          )}
        </Stack>
        {inc.resolution && (
          <Paper mt={10} p="sm" bg="teal.0" withBorder style={{ borderColor: 'var(--mantine-color-teal-2)' }}>
            <Text size="10px" fw={700} c="teal.7" tt="uppercase" mb={4} style={{ letterSpacing: 0.6 }}>Resolution</Text>
            <Text size="xs" c="gray.8">原因: {inc.resolution.root_cause} ・ 復旧 {inc.resolution.recovery_minutes}分 ・ AI={inc.resolution.ai_was_correct ?? '—'}</Text>
            {inc.resolution.note && <Text size="xs" c="gray.6" mt={2}>{inc.resolution.note}</Text>}
          </Paper>
        )}
      </Grid.Col>
    </Grid>
  )
}

// Shadow Mode 承認 Modal: 「これから送る Teams 通知の実物プレビュー」を見せてから承認
function ShadowApproveModal({ inc, busy, onClose, onConfirm }: {
  inc: Incident | null; busy: boolean; onClose: () => void; onConfirm: () => void
}) {
  if (!inc) return null
  const tri = inc.triage ?? {}
  const causes = (tri.root_causes ?? []).slice(0, 3)
  const tools = tri.recommended_tools ?? []
  const sim = (tri.similar_cases ?? [])[0]
  const parallel = (tri.parallel_checks_while_waiting ?? []).slice(0, 3)
  return (
    <Modal opened={!!inc} onClose={busy ? () => {} : onClose} title="承認の最終確認(Shadow mode)"
      centered radius={4} size="lg" withCloseButton={!busy}>
      <Text size="xs" c="dimmed" mb={10}>
        この承認で、保全 Teams チャネルに以下の情報パッケージが送信されます。内容を確認してから「送信」してください。
      </Text>
      <Paper bg="gray.0" p="md" radius={4} withBorder>
        <Group gap={6} mb={8} wrap="nowrap">
          <IconAlertTriangle size={14} color="var(--mantine-color-red-7)" />
          <Text size="sm" fw={700} c="red.8">製造トリアージ通知 [{inc.urgency}]</Text>
        </Group>
        <Text size="xs" c="gray.7" mb={10}>
          設備: <Text span fw={600}>{inc.equipment_name}</Text> ({inc.equipment_id})  ・
          症状: <Text span fw={600}>{inc.symptom}</Text>
          {inc.error_code && <> ・ コード: <code className="mono">{inc.error_code}</code></>}
        </Text>
        {causes.length > 0 && (
          <Box mb={10}>
            <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>推定原因(確信度順)</Text>
            <Stack gap={2} pl={2}>
              {causes.map(c => (
                <Text key={c.rank} size="xs" c="gray.7">
                  {c.rank}. {c.cause}{' '}
                  <Text span c="dimmed" ff="monospace">({Math.round((c.confidence ?? 0) * 100)}%)</Text>
                </Text>
              ))}
            </Stack>
          </Box>
        )}
        {tools.length > 0 && (
          <Box mb={10}>
            <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>持参推奨ツール</Text>
            <Group gap={6}>
              {tools.map((t, i) => (
                <Box key={i} component="span" px={6} py={2}
                  style={{ fontSize: 11, color: 'var(--mantine-color-gray-7)',
                            border: '1px solid var(--mantine-color-gray-3)', borderRadius: 3, background: '#fff' }}>
                  {t}
                </Box>
              ))}
            </Group>
          </Box>
        )}
        {sim && (
          <Box mb={10}>
            <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>類似事例</Text>
            <Text size="xs" c="gray.7">{sim.date} ・ 原因={sim.cause} ・ {sim.recovery_minutes}分で復旧</Text>
          </Box>
        )}
        {parallel.length > 0 && (
          <Box>
            <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: 0.5 }}>オペレーター並行作業</Text>
            <Stack gap={2} pl={2}>
              {parallel.map((p, i) => <Text key={i} size="xs" c="gray.7">・ {p}</Text>)}
            </Stack>
          </Box>
        )}
      </Paper>
      <Text size="10px" c="dimmed" mt={10}>
        ※ HITL(Human-in-the-Loop): 承認者・時刻・送信内容を監査ログ(`audit[]`)に全件記録します。
      </Text>
      <Group gap={8} mt={14} justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button color="red" loading={busy} onClick={onConfirm} leftSection={<IconSend size={14} />}>
          送信して承認
        </Button>
      </Group>
    </Modal>
  )
}

function ResolveModal({ inc, onClose, onDone }: { inc: Incident | null; onClose: () => void; onDone: () => void }) {
  // 中身は inc.id を key にして再マウント(選択ごとにフォーム状態を初期化。effect 内 setState を回避)
  return (
    <Modal opened={!!inc} onClose={onClose} title="解決を記録(現場確定事例として学習に還流)" centered radius={4} size="md">
      {inc && <ResolveForm key={inc.id} inc={inc} onDone={onDone} />}
    </Modal>
  )
}

function ResolveForm({ inc, onDone }: { inc: Incident; onDone: () => void }) {
  const [cause, setCause] = useState(inc.top_cause || '')
  const [rec, setRec] = useState<number | string>(20)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/incidents/${inc.id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root_cause: cause, recovery_minutes: Number(rec), note }) })
      if (!res.ok) throw new Error()
      notifications.show({ color: 'teal', icon: <IconCheck size={16} />, title: '解決を記録', message: '現場確定事例として学習に還流しました' }); onDone()
    } catch {
      notifications.show({ color: 'red', title: '登録に失敗しました', message: '時間をおいて再度お試しください' })
    } finally { setBusy(false) }
  }
  return (
    <Stack gap="sm">
      <Group gap={6} wrap="nowrap">
        <code className="mono">{inc.equipment_id}</code>
        <Text size="xs" c="gray.7">{inc.equipment_name} ・ {inc.symptom}{inc.error_code ? ` ・ ${inc.error_code}` : ''}</Text>
      </Group>
      <TextInput label="実際の原因" value={cause} onChange={(e) => setCause(e.currentTarget.value)} />
      <Group grow>
        <NumberInput label="復旧時間(分)" value={rec} onChange={setRec} min={0} />
        <TextInput label="メモ(対処内容など)" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      </Group>
      <Group justify="flex-end" mt={4}>
        <Button leftSection={<IconCheck size={14} />} loading={busy} onClick={submit}>Save & 学習に反映</Button>
      </Group>
    </Stack>
  )
}

// ===========================================================================
// 品質評価（S2）
// ===========================================================================
type EvalDetail = { id: string; equipment_id: string; expected: string[]; predicted_top: string; top1: boolean; top3: boolean; grounded: boolean }
type EvalRes = { n: number; use_feedback: boolean; top1_accuracy: number; top3_accuracy: number; grounded_rate: number; details: EvalDetail[] }

function EvalView() {
  const [res, setRes] = useState<EvalRes | null>(null)
  const [busy, setBusy] = useState(false)
  const [useFb, setUseFb] = useState(true)
  const run = async () => {
    setBusy(true)
    try { const r = await fetch(`/api/eval/run?use_feedback=${useFb}`, { method: 'POST' }); setRes(await r.json()) }
    catch { notifications.show({ color: 'red', title: '評価', message: '評価の実行に失敗しました' }) }
    finally { setBusy(false) }
  }
  return (
    <Stack gap="md">
      <Card p="lg">
        <Group justify="space-between" wrap="wrap" gap="md">
          <Box style={{ maxWidth: 600 }}>
            <Text fw={650} c="gray.8" size="sm">ラベル付きテストセットで診断品質を計測</Text>
            <Text size="xs" c="dimmed" mt={4}>
              各シナリオの正解原因に対し Top1/Top3 命中率と、根拠を提示できた割合(groundedness)を測ります。
              現場知見(フィードバック)の ON/OFF で「使うほど賢くなる」を定量検証。
            </Text>
          </Box>
          <Group gap="sm">
            <Switch checked={useFb} onChange={(e) => setUseFb(e.currentTarget.checked)} label="現場知見を使う" size="sm" />
            <Button loading={busy} leftSection={<IconShieldCheck size={15} />} onClick={run}>評価を実行</Button>
          </Group>
        </Group>
      </Card>

      {busy && (
        <Center mih={160}>
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">全シナリオを並列で診断・採点中…(30〜60秒)</Text>
          </Stack>
        </Center>
      )}

      {res && !busy && (
        <>
          <Card p="lg">
            <Group justify="space-between" mb="sm">
              <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }}>
                Run results · N={res.n} · 現場知見 {res.use_feedback ? 'ON' : 'OFF'}
              </Text>
              <Text size="10px" c="dimmed">※ 較正前の自己申告値ではなく、正解ラベルに対する実測</Text>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing={0}>
              <EvalStat label="Top1 正答率" pct={res.top1_accuracy} />
              <EvalStat label="Top3 正答率" pct={res.top3_accuracy} sep />
              <EvalStat label="Groundedness(根拠提示率)" pct={res.grounded_rate} sep />
            </SimpleGrid>
          </Card>

          <Card p={0}>
            <Box px="lg" pt="lg" pb="sm">
              <CardHead icon={<IconStethoscope size={16} />} title="ケース別結果"
                sub={`Top1 → ${res.details.filter(d => d.top1).length} 件命中 / Top3 → ${res.details.filter(d => d.top3).length} 件命中`} />
            </Box>
            <Table.ScrollContainer minWidth={620}>
              <Table verticalSpacing={10} horizontalSpacing="md"
                styles={{
                  th: { whiteSpace: 'nowrap', fontSize: 11, color: 'var(--mantine-color-gray-6)',
                        fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                        borderBottom: '1px solid var(--mantine-color-gray-3)' },
                  td: { borderBottom: '1px solid var(--mantine-color-gray-2)' },
                }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Result</Table.Th>
                    <Table.Th>Equipment</Table.Th>
                    <Table.Th>Predicted top cause</Table.Th>
                    <Table.Th>Expected</Table.Th>
                    <Table.Th ta="right">Grounded</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {res.details.map((d) => (
                    <Table.Tr key={d.id}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Box w={6} h={6} bg={d.top1 ? 'teal.5' : d.top3 ? 'orange.5' : 'red.5'}
                            style={{ borderRadius: 999 }} />
                          <Text size="11px" fw={600} ff="monospace"
                            c={d.top1 ? 'teal.7' : d.top3 ? 'orange.7' : 'red.7'}>
                            {d.top1 ? 'Top1' : d.top3 ? 'Top3' : 'Miss'}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td><code className="mono">{d.equipment_id}</code></Table.Td>
                      <Table.Td><Text size="sm" c="gray.8" lineClamp={1}>{d.predicted_top}</Text></Table.Td>
                      <Table.Td><Text size="xs" c="gray.6" lineClamp={1}>{d.expected.join(' / ')}</Text></Table.Td>
                      <Table.Td ta="right">
                        <Text size="11px" c={d.grounded ? 'teal.7' : 'gray.5'} ff="monospace" fw={600}>
                          {d.grounded ? '✓' : '—'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
          <Text size="10px" c="dimmed" ta="center">
            ※ テストセットはコーパス内の文書化済み原因を正解とする in-distribution 評価(汎化テストではありません)
          </Text>
        </>
      )}
    </Stack>
  )
}

function EvalStat({ label, pct, sep }: { label: string; pct: number; sep?: boolean }) {
  return (
    <Box style={{ padding: '4px 16px', borderLeft: sep ? '1px solid var(--mantine-color-gray-2)' : 'none' }}>
      <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }}>{label}</Text>
      <Group gap={6} align="baseline" mt={8} mb={6}>
        <Text fw={700} fz={28} c="brand.7" className="tnum" lh={1}>{pct}</Text>
        <Text size="xs" c="dimmed">%</Text>
      </Group>
      <Progress value={pct} color="brand" radius={2} size="xs" />
    </Box>
  )
}
