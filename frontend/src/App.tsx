import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AppShell, Group, Stack, Box, Title, Text, Card, Badge, Button,
  Select, TextInput, Textarea, Progress, ThemeIcon, UnstyledButton, ActionIcon,
  Accordion, SimpleGrid, NumberInput, Paper, Loader, Center, Grid,
  ScrollArea, Image, Switch, Tooltip, Burger, Divider, Checkbox,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle, IconSearch, IconChecklist, IconBolt, IconHistory,
  IconPhoto, IconSend, IconChartBar, IconBuildingFactory2, IconListSearch,
  IconRefresh, IconArrowRight, IconCircleCheck, IconCheck,
  IconRobot, IconRoute, IconMicrophone, IconMessageChatbot, IconClock,
  IconAlertCircle, IconX, IconForms, IconDatabaseSearch, IconStethoscope,
  IconActivityHeartbeat, IconBulb, IconChartHistogram, IconSitemap,
  IconPointFilled, IconClipboardPlus, IconPlayerStopFilled,
  IconPrinter, IconPencil, IconShieldCheck,
} from '@tabler/icons-react'

// ---- types ----------------------------------------------------------------
type Equip = { id: string; name: string; process: string }
type Meta = { equipments: Equip[]; symptom_categories: string[]; aoai_ready: boolean; deployment: string; teams_ready: boolean }
type Cause = { rank: number; cause: string; evidence: string; confidence: number }
type Check = { order: number; action: string }
type Similar = { title: string; date: string; cause: string; recovery_minutes: number; note: string }
type Citation = { source_type: string; label: string; doc_id: string; text: string; is_feedback: boolean }
type TraceStep = { agent: string; title: string; detail: string }
type ActionTaken = { tool: string; args: Record<string, unknown>; result: string; detail?: string; executed: boolean }
type Triage = {
  urgency: { level: string; reason: string }
  root_causes: Cause[]; first_checks: Check[]; similar_cases: Similar[]
  recommended_actions: string[]
  escalation: { should_notify: boolean; to: string; message: string }
  image_findings: string | null
  citations: Citation[]
  trace: TraceStep[]; actions: ActionTaken[]; feedback_used: number; use_feedback: boolean
  engine: string
  specialist_findings: { name: string; label: string; output: string }[]
}
type Intake = { equipment_id: string; equipment_name: string; process: string; error_code: string; symptom: string; free_text: string; use_feedback: boolean }

// 緊急度 → 配色 / ラベル（意味づけ色のみ用途を限定して使用）
const urgency = (lvl: string) =>
  lvl === 'High' ? { color: 'red', label: '高', word: '即対応', icon: IconAlertTriangle }
    : lvl === 'Medium' ? { color: 'orange', label: '中', word: '要注意', icon: IconAlertCircle }
      : { color: 'teal', label: '低', word: '通常対応', icon: IconCircleCheck }

// ---- 表示用サニタイズ（内部実装やエラーをユーザーに見せない） --------------
const TOOL_LABEL: Record<string, string> = { escalate_to_maintenance: '保全へ通知', isolate_lot: 'ロット隔離' }
const toolLabel = (t: string) => TOOL_LABEL[t] ?? t
// 文中に紛れる doc-id を除去（"(id=trouble-…)" も "(参照: 作業手順書 id=proc-…)" も対応）
// id= とその値だけを落とし、人間に読める「参照: 作業手順書」等は残す。空になった括弧は除去。
const stripIds = (s: string) => (s || '')
  .replace(/[,、]?\s*id=[^\s)）,、。]+/gi, '')   // machine id を除去
  .replace(/[（(]\s*[)）]/g, '')                  // 空になった括弧を除去
  .replace(/\s+([)）])/g, '$1')                   // 閉じ括弧前の余分な空白
  .replace(/[（(]\s*[、,]\s*/g, '（')              // 開き括弧直後の区切りを整理
  .replace(/\s{2,}/g, ' ')
  .trim()
// 通知の送信失敗など内部例外をユーザー表示から除去
const cleanDetail = (s?: string) => (s || '').replace(/\n*[（(]\s*送信失敗[:：][^)）]*[)）]/g, '').trim()
const engineLabel = (e: string) => (e === 'foundry' ? 'Azure AI Foundry' : 'ローカル推論')

async function fileToB64(file: File): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(file)
  })
}

// 音声入力 — ブラウザ録音(MediaRecorder) → Azure OpenAI(whisper) で文字起こし
function useDictation(onText: (t: string) => void) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const mrRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const toggle = async () => {
    if (recording) { mrRef.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false); setBusy(true)
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          const fd = new FormData(); fd.append('file', blob, 'audio.webm')
          const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
          const d = await res.json()
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

// デモ用プリセット（クリックで入力欄を一括投入）
const SCENARIOS = [
  { label: '搬送・異音', eq: 'L2-CONV-01', proc: '搬送', err: 'E-142', symptom: '異音', free: '搬送部から異音。温度上昇あり。直前に段取り替え。' },
  { label: '充填・品質不良', eq: 'L2-FILL-01', proc: '充填', err: 'F-220', symptom: '品質不良', free: '充填量がばらつき品質不良。直前にサーボ調整。打ち始めに軽い異音。' },
  { label: '検査・停止', eq: 'L2-INSP-01', proc: '検査', err: 'I-305', symptom: '停止', free: '検査機が誤検知で頻繁に停止。照明のちらつきあり。レンズ汚れの可能性。' },
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
    const timer = setTimeout(() => ctrl.abort(), 45000) // 45秒でタイムアウト
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
              <Text size="10px" fw={700} c="dimmed" tt="uppercase" px="xs" mb={8} style={{ letterSpacing: 0.6 }}>メニュー</Text>
              <Stack gap={4}>
                {NAV.map((n) => {
                  const on = active === n.value
                  return (
                    <UnstyledButton key={n.value} className="nav-item" data-active={on}
                      onClick={() => { setActive(n.value); closeNav() }}>
                      <ThemeIcon size={34} radius={9} variant={on ? 'filled' : 'light'} color={on ? 'brand' : 'gray'}>
                        <n.icon size={18} stroke={1.8} />
                      </ThemeIcon>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={on ? 650 : 550} c={on ? 'brand.7' : 'gray.8'} lh={1.25}>{n.label}</Text>
                        <Text size="xs" c="dimmed" lh={1.3} truncate>{n.desc}</Text>
                      </Box>
                    </UnstyledButton>
                  )
                })}
              </Stack>

              <Group justify="space-between" align="center" px="xs" mt="lg" mb={8} wrap="nowrap">
                <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }}>診断履歴</Text>
                {history.length > 0 && (
                  <Tooltip label="履歴を消去" withArrow>
                    <ActionIcon size="sm" variant="subtle" color="gray" aria-label="履歴を消去"
                      onClick={() => { setHistory([]); saveHist([]) }}><IconX size={13} /></ActionIcon>
                  </Tooltip>
                )}
              </Group>
              {history.length === 0 ? (
                <Text size="xs" c="dimmed" px="xs">診断するとここに履歴が残ります</Text>
              ) : (
                <Stack gap={2}>
                  {history.map((h) => {
                    const u = urgency(h.urgency)
                    return (
                      <UnstyledButton key={h.id} className="hist-item" onClick={() => restore(h)}>
                        <Box w={7} h={7} bg={`${u.color}.6`} style={{ borderRadius: 999, flexShrink: 0, marginTop: 5 }} />
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" fw={600} c="gray.8" truncate>{h.equipment_name}</Text>
                          <Text size="10px" c="dimmed" truncate>{h.top_cause || '—'}</Text>
                          <Text size="10px" c="dimmed">{relTime(h.ts)}</Text>
                        </Box>
                      </UnstyledButton>
                    )
                  })}
                </Stack>
              )}
            </Box>
          </ScrollArea>

          {/* 最下部：接続状態 + マルチエージェント構成 */}
          <Box p="sm">
            <Divider mb="sm" />
            <Group gap={8} mb="sm" px="xs" wrap="nowrap">
              <IconPointFilled size={11} style={{ color: `var(--mantine-color-${meta?.aoai_ready ? 'teal' : 'red'}-6)`, flexShrink: 0 }} />
              <Text size="xs" c="gray.7" fw={600}>Azure OpenAI</Text>
              <Badge variant="default" radius="sm" size="xs" ml="auto" tt="none">{meta?.deployment ?? 'gpt-4o'}</Badge>
            </Group>
            <Card p="sm" radius="md" bg="gray.0" withBorder>
              <Group gap={8} wrap="nowrap">
                <ThemeIcon variant="light" color="gray" size={30} radius="md"><IconSitemap size={16} /></ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Text size="xs" fw={600} c="gray.8" lh={1.2}>マルチエージェント構成</Text>
                  <Text size="10px" c="dimmed" lh={1.3} mt={2}>Intake → Retrieval → Triage → Action</Text>
                </div>
              </Group>
            </Card>
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
              <PageHead title="自律インシデント・ボード" desc="設備アラームを取り込み、エージェントが自動トリアージ。High は承認を経て保全へ。" />
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
      <CardHead icon={<IconListSearch size={18} />} title="異常入力" sub="わかる範囲で入力してください" />
      <Box mb="sm">
        <Text size="xs" c="dimmed" mb={6}>デモシナリオで一括入力</Text>
        <Group gap={6} wrap="wrap">
          {SCENARIOS.map((s) => (
            <Button key={s.label} variant="default" size="compact-sm" radius="xl"
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
          description={<Text size="xs" c={p.free.length > FREE_MAX * 0.9 ? 'orange.7' : 'dimmed'} ta="right" className="tnum">{p.free.length} / {FREE_MAX}</Text>} />

        <div>
          <Text size="sm" fw={500} mb={6}>画像 <Text span size="xs" c="dimmed">（任意・GPT-4o vision で解析）</Text></Text>
          {p.imgPreview ? (
            <Group gap="sm">
              <Image src={p.imgPreview} h={72} w={72} radius="md" fit="cover" />
              <Button variant="default" size="xs" leftSection={<IconX size={14} />} onClick={() => { p.setImgFile(null); p.setImgPreview(null) }}>削除</Button>
            </Group>
          ) : (
            <Dropzone accept={IMAGE_MIME_TYPE} multiple={false} radius="md" maxSize={IMG_MAX_MB * 1024 * 1024}
              onReject={() => notifications.show({ color: 'red', title: '画像', message: `画像は ${IMG_MAX_MB}MB 以下にしてください` })}
              onDrop={(files) => { const f = files[0]; p.setImgFile(f); p.setImgPreview(URL.createObjectURL(f)) }} p="md">
              <Group justify="center" gap="xs" mih={44} style={{ pointerEvents: 'none' }}>
                <IconPhoto size={20} stroke={1.6} color="var(--mantine-color-gray-5)" />
                <Text size="sm" c="dimmed">画像をドロップ / クリックして選択</Text>
              </Group>
            </Dropzone>
          )}
        </div>

        <Card bg="gray.0" p="sm" radius="md" withBorder={false}>
          <Switch checked={p.useFeedback} onChange={(e) => p.setUseFeedback(e.currentTarget.checked)} size="sm"
            label={<Text size="sm" fw={500}>現場知見（フィードバック）を使う</Text>}
            description="OFF で蓄積事例なしの素の判断と比較できます" />
        </Card>

        <Button leftSection={<IconSearch size={17} />} loading={p.loading} onClick={p.runTriage} size="md" mt={4} fullWidth>
          トリアージ実行
        </Button>
      </Stack>
    </Card>
  )
}

// ---- 結果なし: 診断フローのガイド -----------------------------------------
const PIPELINE = [
  { icon: IconForms, tag: 'Intake', title: '入力を構造化', desc: '設備・症状・自由記述を解析し、検索クエリへ変換' },
  { icon: IconDatabaseSearch, tag: 'Retrieval', title: '資料を横断検索', desc: '過去トラブル・手順書・設備台帳・品質記録を照合' },
  { icon: IconStethoscope, tag: 'Triage', title: '緊急度・原因を判定', desc: '根拠付きで緊急度と原因候補 Top3 を提示' },
  { icon: IconRobot, tag: 'Action', title: '自律対応', desc: '必要に応じて通知や手順提示を自動実行' },
]
const OUTPUTS = ['緊急度の判定と理由', '原因候補 Top3（確信度付き）', 'まず確認すべきチェックリスト', '推奨アクションと類似事例']

function EmptyGuide() {
  return (
    <Card p="xl" h="100%">
      <Stack gap="lg">
        <div>
          <Badge variant="light" color="brand" radius="sm" mb="sm">診断フロー</Badge>
          <Title order={4} c="gray.9" fw={700}>4つのエージェントが連携して診断します</Title>
          <Text size="sm" c="dimmed" mt={4}>左で異常内容を入力し「トリアージ実行」を押してください。</Text>
        </div>

        <Stack gap={0}>
          {PIPELINE.map((s, i) => {
            const last = i === PIPELINE.length - 1
            return (
              <Group key={s.tag} gap="md" wrap="nowrap" align="flex-start">
                <Stack gap={0} align="center" w={40}>
                  <ThemeIcon size={40} radius="md" variant="light" color="brand"><s.icon size={20} stroke={1.6} /></ThemeIcon>
                  {!last && <Box w={2} flex={1} mih={20} bg="gray.2" my={4} />}
                </Stack>
                <Box pb={last ? 0 : 'lg'} pt={6} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={8}>
                    <Text fw={650} size="sm" c="gray.8">{s.title}</Text>
                    <Badge size="xs" radius="sm" variant="default" tt="none">{s.tag}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mt={3}>{s.desc}</Text>
                </Box>
              </Group>
            )
          })}
        </Stack>

        <Divider />

        <div>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="sm" style={{ letterSpacing: 0.5 }}>得られる情報</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" verticalSpacing="xs">
            {OUTPUTS.map((o) => (
              <Group key={o} gap={8} wrap="nowrap" align="center">
                <ThemeIcon color="teal" variant="light" size={20} radius="xl"><IconCheck size={12} /></ThemeIcon>
                <Text size="sm" c="gray.7">{o}</Text>
              </Group>
            ))}
          </SimpleGrid>
        </div>
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
    ? 'AIエンジンの応答に時間がかかっています（混雑の可能性）。入力を短くするか、少し待って再試行してください。'
    : unset
      ? 'Azure OpenAI が未設定です。接続設定を確認してください。'
      : '一時的にAIエンジンへ接続できませんでした。少し時間をおいて再試行してください。'
  return (
    <Card p="xl" h="100%">
      <Center mih={360}>
        <Stack align="center" gap="sm" maw={360}>
          <ThemeIcon color={timeout ? 'orange' : 'red'} variant="light" size={52} radius="md">
            {timeout ? <IconClock size={26} stroke={1.6} /> : <IconAlertTriangle size={26} stroke={1.6} />}
          </ThemeIcon>
          <Text fw={650} c="gray.8">{title}</Text>
          <Text size="sm" c="dimmed" ta="center">{body}</Text>
          <Button variant="light" leftSection={<IconRefresh size={15} />} onClick={onRetry} mt={4}>再試行</Button>
        </Stack>
      </Center>
    </Card>
  )
}

// ---- 実行中: 段階プログレス（4工程を順に点灯＋ストライプ進捗バー） ---------
function ProgressStages() {
  const [t, setT] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 0.1), 100)
    return () => clearInterval(id)
  }, [])
  const PER = 3.4 // 1工程あたりの目安秒
  const activeIdx = Math.min(PIPELINE.length - 1, Math.floor(t / PER))
  const pct = Math.min(96, (t / (PER * PIPELINE.length)) * 100)
  return (
    <Card p="xl" h="100%">
      <Stack gap="lg">
        <div>
          <Group gap={8} mb={4} wrap="nowrap">
            <Loader size="xs" />
            <Text fw={700} c="gray.9">診断を実行中…</Text>
          </Group>
          <Text size="sm" c="dimmed">4つのエージェントが順に資料を横断しています（通常 5〜20 秒）</Text>
        </div>

        <div>
          <Group justify="space-between" mb={6} wrap="nowrap" gap="sm">
            <Text size="xs" fw={600} c="gray.7" truncate>{PIPELINE[activeIdx].title}</Text>
            <Text size="xs" fw={700} c="brand.7" className="tnum" style={{ flexShrink: 0 }}>{Math.round(pct)}%</Text>
          </Group>
          <Progress value={pct} radius="xl" size="md" color="brand" striped animated />
        </div>

        <Stack gap={0}>
          {PIPELINE.map((s, i) => {
            const done = i < activeIdx
            const active = i === activeIdx
            const last = i === PIPELINE.length - 1
            return (
              <Group key={s.tag} gap="md" wrap="nowrap" align="flex-start">
                <Stack gap={0} align="center" w={36} style={{ flexShrink: 0 }}>
                  <ThemeIcon size={36} radius="md" variant={done || active ? 'light' : 'default'}
                    color={done ? 'teal' : active ? 'brand' : 'gray'}>
                    {done ? <IconCheck size={18} /> : active ? <Loader size={15} color="brand" /> : <s.icon size={18} stroke={1.6} />}
                  </ThemeIcon>
                  {!last && <Box w={2} flex={1} mih={16} bg={done ? 'teal.2' : 'gray.2'} my={4} />}
                </Stack>
                <Box pb={last ? 0 : 'md'} pt={7} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={8} wrap="nowrap">
                    <Text size="sm" fw={active ? 700 : 600} c={done || active ? 'gray.8' : 'gray.5'}>{s.title}</Text>
                    <Badge size="xs" radius="sm" variant="default" tt="none" visibleFrom="sm">{s.tag}</Badge>
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
// 診断レポート（結果）— 意思決定順に積む単一カラム
// ===========================================================================
function ResultReport({ result, intake, imgPreview, onEdit, onRecord }: {
  result: Triage; intake: Intake; imgPreview: string | null; onEdit: () => void; onRecord: (cause: string) => void
}) {
  const topCause = result.root_causes?.[0]?.cause ?? ''
  return (
    <Box maw={920} mx="auto" w="100%" className="print-report">
      <Stack gap="md">
        <Box className="print-only">
          <Text fw={700} fz={18} c="gray.9">設備異常トリアージ — 引継ぎ票</Text>
          <Text size="xs" c="dimmed">{new Date().toLocaleString('ja-JP')} 出力</Text>
        </Box>
        <SummaryBar intake={intake} result={result} imgPreview={imgPreview} onEdit={onEdit} />
        <UrgencyHero result={result} onRecord={() => onRecord(topCause)} />
        <NextSteps checks={result.first_checks} recs={result.recommended_actions} />
        <Causes causes={result.root_causes} />
        <FollowupPanel intake={intake} />
        {result.image_findings && (
          <Card p="lg">
            <CardHead icon={<IconPhoto size={18} />} title="画像所見" sub="GPT-4o vision による解析" />
            <Text size="sm" c="gray.7">{result.image_findings}</Text>
          </Card>
        )}
        {result.actions.length > 0 && <SystemActions actions={result.actions} />}
        <SimilarCases cases={result.similar_cases} />
        <ProcessDetails result={result} />
      </Stack>
    </Box>
  )
}

// 入力サマリ（入力条件の全体）+ 編集導線
function SummaryBar({ intake, result, imgPreview, onEdit }: { intake: Intake; result: Triage; imgPreview: string | null; onEdit: () => void }) {
  const hasDetail = !!(intake.free_text || imgPreview || intake.process)
  return (
    <Card p="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color="gray" size={36} radius="md"><IconBuildingFactory2 size={19} /></ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Text fw={650} size="sm" c="gray.9" truncate>{intake.equipment_name}</Text>
            <Group gap={6} mt={3} wrap="wrap">
              <Badge variant="default" radius="sm" size="sm">コード {intake.error_code || '—'}</Badge>
              <Badge variant="default" radius="sm" size="sm">{intake.symptom}</Badge>
            </Group>
          </Box>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label={result.engine === 'foundry' ? 'Azure AI Foundry の connected agents で実行' : 'ローカル推論で実行'} withArrow>
            <Badge variant="light" color={result.engine === 'foundry' ? 'brand' : 'gray'} radius="sm" tt="none"
              leftSection={<IconSitemap size={11} />}>{engineLabel(result.engine)}</Badge>
          </Tooltip>
          {result.feedback_used > 0 && (
            <Badge variant="light" color="teal" radius="sm" leftSection={<IconShieldCheck size={11} />} visibleFrom="sm">
              現場知見 {result.feedback_used}件
            </Badge>
          )}
          <Button variant="default" size="xs" leftSection={<IconPencil size={14} />} onClick={onEdit} className="no-print">条件を編集</Button>
        </Group>
      </Group>

      {hasDetail && (
        <>
          <Divider my="sm" label={<Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>入力条件</Text>} labelPosition="left" />
          <Group align="flex-start" gap="md" wrap="nowrap">
            {imgPreview && (
              <Tooltip label="添付画像（GPT-4o vision で解析）" withArrow>
                <Image src={imgPreview} w={56} h={56} radius="md" fit="cover" style={{ flexShrink: 0, border: '1px solid var(--mantine-color-gray-2)' }} />
              </Tooltip>
            )}
            <Box style={{ minWidth: 0, flex: 1 }}>
              {intake.process && (
                <Text size="xs" c="gray.7" mb={intake.free_text ? 4 : 0}>
                  <Text span fw={600} c="gray.6">工程:</Text> {intake.process}
                </Text>
              )}
              {intake.free_text
                ? <Text size="xs" c="gray.7" lineClamp={2}><Text span fw={600} c="gray.6">自由記述:</Text> {intake.free_text}</Text>
                : (imgPreview && <Text size="xs" c="dimmed">画像を添付して診断しました。</Text>)}
            </Box>
          </Group>
        </>
      )}
    </Card>
  )
}

// 緊急度ヒーロー（画面を支配する判定）
function UrgencyHero({ result, onRecord }: { result: Triage; onRecord: () => void }) {
  const u = urgency(result.urgency.level)
  const Icon = u.icon
  const top = result.root_causes?.[0]
  return (
    <Card p={0} style={{ overflow: 'hidden', borderColor: `var(--mantine-color-${u.color}-3)` }}>
      <Box p="lg" style={{ background: `var(--mantine-color-${u.color}-0)` }}>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Group gap="md" wrap="nowrap" align="flex-start" style={{ flex: '1 1 280px', minWidth: 0 }}>
            <ThemeIcon color={u.color} variant="filled" size={52} radius="md" style={{ flexShrink: 0 }}>
              <Icon size={28} />
            </ThemeIcon>
            <Box style={{ minWidth: 0 }}>
              <Text size="xs" fw={700} tt="uppercase" c={`${u.color}.7`} style={{ letterSpacing: 0.6 }}>緊急度</Text>
              <Group gap={10} align="baseline" mt={2}>
                <Text fz={30} fw={800} c={`${u.color}.8`} lh={1}>{u.label}</Text>
                <Text size="sm" fw={600} c={`${u.color}.7`}>{u.word}</Text>
              </Group>
              <Text size="sm" c="gray.8" mt={8} style={{ lineHeight: 1.6 }}>{result.urgency.reason}</Text>
            </Box>
          </Group>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }} className="no-print">
            <Button leftSection={<IconClipboardPlus size={16} />} onClick={onRecord}>対応を記録</Button>
            <Tooltip label="印刷 / PDF保存（引継ぎ票）" withArrow>
              <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>共有</Button>
            </Tooltip>
          </Group>
        </Group>

        {top && (
          <Card mt="md" p="sm" radius="md" withBorder>
            <Group justify="space-between" wrap="nowrap" gap="sm" mb={6}>
              <Text size="xs" c="dimmed" fw={600} style={{ flexShrink: 0 }}>最有力原因</Text>
              <Text size="sm" fw={800} c={`${u.color}.7`} className="tnum" style={{ flexShrink: 0 }}>{Math.round(top.confidence * 100)}%</Text>
            </Group>
            <Text size="sm" fw={650} c="gray.8" truncate mb={6}>{top.cause}</Text>
            <Progress value={top.confidence * 100} color={u.color} radius="xl" size="sm" />
          </Card>
        )}
      </Box>
    </Card>
  )
}

// 次にすべきこと（「まず確認」+「推奨対処」を1か所に統合・消し込み可）
function NextSteps({ checks, recs }: { checks: Check[]; recs: string[] }) {
  return (
    <Card p="lg">
      <CardHead icon={<IconChecklist size={18} />} title="次にすべきこと" sub="上から順に確認・対処してください" />
      <Stack gap="lg">
        <StepGroup label="まず確認" color="teal" items={[...checks].sort((a, b) => a.order - b.order).map((c) => c.action)} />
        {recs.length > 0 && <StepGroup label="推奨する対処" color="brand" items={recs} />}
      </Stack>
    </Card>
  )
}
function StepGroup({ label, color, items }: { label: string; color: string; items: string[] }) {
  return (
    <div>
      <Group gap={8} mb="xs">
        <Box w={3} h={14} bg={`${color}.5`} style={{ borderRadius: 2 }} />
        <Text size="xs" fw={700} c="gray.7" tt="uppercase" style={{ letterSpacing: 0.4 }}>{label}</Text>
      </Group>
      <Stack gap={6} pl={2}>
        {items.map((t, i) => (
          <Checkbox key={i} size="sm" radius="sm" color={color}
            label={<Text size="sm" c="gray.7">{stripIds(t)}</Text>}
            styles={{ body: { alignItems: 'flex-start' }, labelWrapper: { paddingTop: 1 } }} />
        ))}
      </Stack>
    </div>
  )
}

// 原因候補
function Causes({ causes }: { causes: Cause[] }) {
  return (
    <Card p="lg">
      <CardHead icon={<IconSearch size={18} />} title="原因候補 Top 3" sub="確信度の高い順・根拠付き" />
      <Stack gap="lg">
        {causes.map((c) => (
          <div key={c.rank}>
            <Group justify="space-between" mb={6} wrap="nowrap" align="center" gap="sm">
              <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                <Badge variant="filled" color={c.rank === 1 ? 'brand' : 'gray'} radius="sm" size="sm" style={{ flexShrink: 0 }}>{c.rank}</Badge>
                <Text fw={650} size="sm" c="gray.8" truncate>{c.cause}</Text>
              </Group>
              <Text size="sm" fw={700} c="brand.7" className="tnum" style={{ flexShrink: 0 }}>{Math.round(c.confidence * 100)}%</Text>
            </Group>
            <Progress value={c.confidence * 100} color={c.rank === 1 ? 'brand' : 'gray.4'} radius="xl" size="sm" mb={8} />
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.6 }}>{stripIds(c.evidence)}</Text>
          </div>
        ))}
      </Stack>
    </Card>
  )
}

// システムが自動で実施したこと
function SystemActions({ actions }: { actions: ActionTaken[] }) {
  return (
    <Card p="lg" style={{ borderLeft: '3px solid var(--mantine-color-orange-5)' }}>
      <CardHead icon={<IconRobot size={18} />} title="システムが自動で実施したこと" sub="エージェントが function calling で判断・実行" />
      <Stack gap="sm">
        {actions.map((a, i) => {
          const sim = /シミュレート|デモ/.test(a.result)
          const detail = cleanDetail(a.detail)
          return (
            <Paper key={i} withBorder p="sm" radius="md" bg="gray.0">
              <Group gap="xs" wrap="nowrap" mb={detail ? 4 : 0}>
                <ThemeIcon size={20} radius="xl" variant="light" color={sim ? 'gray' : 'teal'} style={{ flexShrink: 0 }}>
                  <IconCheck size={12} />
                </ThemeIcon>
                <Badge color="orange" variant="light" radius="sm" size="sm" tt="none" style={{ flexShrink: 0 }}>{toolLabel(a.tool)}</Badge>
                <Text size="sm" fw={600} c="gray.8">{a.result}</Text>
                <Badge variant="default" radius="sm" size="xs" ml="auto" visibleFrom="xs">{sim ? 'シミュレート' : '実施済み'}</Badge>
              </Group>
              {detail && <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{detail}</Text>}
            </Paper>
          )
        })}
      </Stack>
    </Card>
  )
}

// 類似事例
function SimilarCases({ cases }: { cases: Similar[] }) {
  return (
    <Card p="lg">
      <CardHead icon={<IconHistory size={18} />} title="類似事例" sub="過去に同様の症状を解決した記録" />
      <Stack gap="xs">
        {cases.map((s, i) => (
          <Paper key={i} withBorder p="sm" radius="md" bg="gray.0">
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Text fw={600} size="sm" c="gray.8" truncate>{s.title}</Text>
              <Badge variant="default" radius="sm" size="sm" leftSection={<IconClock size={11} />} style={{ flexShrink: 0 }}>{s.recovery_minutes}分で復旧</Badge>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>{s.date} ・ 原因: {s.cause} — {s.note}</Text>
          </Paper>
        ))}
      </Stack>
    </Card>
  )
}

// 処理の詳細（エージェント工程・専門所見・参照資料）— デフォルト折りたたみ
function ProcessDetails({ result }: { result: Triage }) {
  const friendly = (t: TraceStep) =>
    t.agent === 'System'
      ? { title: '簡易エンジンで継続', detail: '高負荷のためローカル推論で処理しました。' }
      : { title: t.title, detail: stripIds(t.detail) }
  return (
    <Accordion variant="separated" radius="md"
      styles={{ item: { border: '1px solid var(--mantine-color-gray-2)', background: '#fff' } }}>
      <Accordion.Item value="process">
        <Accordion.Control icon={<IconRoute size={17} color="var(--mantine-color-gray-5)" />}>
          <Text size="sm" fw={600} c="gray.8">処理の詳細 <Text span c="dimmed" fw={400}>エージェント工程・参照資料 {result.citations.length} 件</Text></Text>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="lg" pt={4}>
            {/* エージェント工程 */}
            <div>
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="sm" style={{ letterSpacing: 0.4 }}>エージェント工程</Text>
              <Stack gap={0}>
                {result.trace.map((t, i) => {
                  const last = i === result.trace.length - 1
                  const f = friendly(t)
                  return (
                    <Group key={i} gap="sm" wrap="nowrap" align="flex-start">
                      <Stack gap={0} align="center" w={22} style={{ flexShrink: 0 }}>
                        <ThemeIcon size={22} radius="xl" variant="light" color={t.agent === 'Action' ? 'orange' : t.agent === 'System' ? 'gray' : 'brand'}>
                          {t.agent === 'Action' ? <IconRobot size={12} /> : <IconCheck size={12} />}
                        </ThemeIcon>
                        {!last && <Box w={2} flex={1} mih={16} bg="gray.2" my={2} />}
                      </Stack>
                      <Box pb={last ? 0 : 'sm'} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={6}>
                          <Badge size="xs" radius="sm" color="gray" variant="light" tt="none">{t.agent}</Badge>
                          <Text size="sm" fw={600} c="gray.8">{f.title}</Text>
                        </Group>
                        <Text size="xs" c="dimmed" mt={2}>{f.detail}</Text>
                      </Box>
                    </Group>
                  )
                })}
              </Stack>
            </div>

            {/* 専門エージェントの所見 */}
            {result.specialist_findings?.length > 0 && (
              <div>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="sm" style={{ letterSpacing: 0.4 }}>専門エージェントの所見</Text>
                <Stack gap="sm">
                  {result.specialist_findings.map((f, i) => (
                    <Paper key={i} withBorder p="sm" radius="md" bg="gray.0">
                      <Badge variant="light" color="brand" radius="sm" size="sm" mb={6} tt="none">{f.label}</Badge>
                      <Text size="sm" c="gray.7" style={{ whiteSpace: 'pre-wrap' }}>{stripIds(f.output)}</Text>
                    </Paper>
                  ))}
                </Stack>
              </div>
            )}

            {/* 参照資料 */}
            <div>
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="sm" style={{ letterSpacing: 0.4 }}>参照資料</Text>
              <ScrollArea.Autosize mah={260}>
                <Stack gap="xs" pr="sm">
                  {result.citations.map((c, i) => (
                    <Paper key={i} withBorder p="sm" radius="md" bg="gray.0">
                      <Group gap="xs" mb={4} wrap="nowrap">
                        <Badge size="xs" variant="default" radius="sm">{c.label}</Badge>
                        {c.is_feedback && <Badge size="xs" color="teal" variant="light" radius="sm">現場確定</Badge>}
                      </Group>
                      <Text size="xs" c="gray.7">{c.text}</Text>
                    </Paper>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </div>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  )
}

// ---- フォローアップ質問 ----------------------------------------------------
function FollowupPanel({ intake }: { intake: Intake }) {
  const [q, setQ] = useState('')
  const [log, setLog] = useState<{ q: string; a: string }[]>([])
  const [loading, setLoading] = useState(false)
  const ask = async () => {
    if (!q.trim()) return
    const question = q; setQ(''); setLoading(true)
    try {
      const res = await fetch('/api/followup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...intake, question }) })
      const d = await res.json()
      setLog((l) => [...l, { q: question, a: d.answer ?? d.detail ?? '回答を取得できませんでした' }])
    } catch {
      setLog((l) => [...l, { q: question, a: '回答を取得できませんでした。時間をおいて再度お試しください。' }])
    } finally { setLoading(false) }
  }
  return (
    <Card p="lg" className="no-print">
      <CardHead icon={<IconMessageChatbot size={18} />} title="この診断について質問する" sub="資料を根拠に、追加の疑問へ回答します" />
      <Stack gap="md">
        {log.length === 0 && (
          <Group gap={6} wrap="wrap">
            {['交換手順を教えて', '再発を防ぐには？', '点検頻度の目安は？'].map((s) => (
              <Button key={s} variant="default" size="compact-sm" radius="xl" onClick={() => setQ(s)}>{s}</Button>
            ))}
          </Group>
        )}
        {log.map((e, i) => (
          <Box key={i}>
            <Group gap={8} mb={6} align="flex-start" wrap="nowrap">
              <Badge variant="filled" color="dark" radius="sm" size="sm" style={{ flexShrink: 0 }}>Q</Badge>
              <Text size="sm" fw={600} c="gray.8">{e.q}</Text>
            </Group>
            <Paper bg="gray.0" p="sm" radius="md" withBorder>
              <Text size="sm" c="gray.7" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{stripIds(e.a)}</Text>
            </Paper>
          </Box>
        ))}
        {loading && <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">回答を作成中…</Text></Group>}
        <Group gap="xs" wrap="nowrap">
          <TextInput style={{ flex: 1, minWidth: 0 }} placeholder="例: ローラー交換の手順は？" value={q}
            onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
          <MicIcon size={36} onText={(t) => setQ(q ? `${q} ${t}` : t)} />
          <Button onClick={ask} loading={loading} leftSection={<IconSend size={15} />}>質問</Button>
        </Group>
      </Stack>
    </Card>
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
          <CardHead icon={<IconClipboardPlus size={18} />} title="対応実績の登録" sub="実際の結果が次回以降の検索対象に加わります" />
          {fromResult && (
            <Paper bg="brand.0" p="xs" radius="md" mb="md" withBorder style={{ borderColor: 'var(--mantine-color-brand-2)' }}>
              <Group gap={8} wrap="nowrap">
                <ThemeIcon color="brand" variant="light" size={20} radius="xl"><IconArrowRight size={12} /></ThemeIcon>
                <Text size="xs" c="gray.7">直前の診断結果から引き継ぎました。実際の対処結果に修正して登録してください。</Text>
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
            <Button leftSection={<IconCheck size={16} />} onClick={submit} mt={4}>登録する</Button>
          </Stack>
        </Card>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Card p="lg" h="100%">
          <CardHead icon={<IconRoute size={18} />} title="現場知見の学習ループ" />
          <Stack gap={0}>
            {LEARN_STEPS.map((s, i) => {
              const last = i === LEARN_STEPS.length - 1
              return (
                <Group key={i} gap="md" wrap="nowrap" align="flex-start">
                  <Stack gap={0} align="center" w={28} style={{ flexShrink: 0 }}>
                    <ThemeIcon size={28} radius="xl" variant="light" color="brand">
                      <Text size="xs" fw={700} c="brand.7">{i + 1}</Text>
                    </ThemeIcon>
                    {!last && <Box w={2} flex={1} mih={18} bg="gray.2" my={4} />}
                  </Stack>
                  <Box pb={last ? 0 : 'md'} pt={3} style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={650} size="sm" c="gray.8">{s.title}</Text>
                    <Text size="xs" c="dimmed" mt={2}>{s.desc}</Text>
                  </Box>
                </Group>
              )
            })}
          </Stack>
          <Card bg="gray.0" p="sm" radius="md" withBorder={false} mt="md">
            <Group gap={8} wrap="nowrap" align="flex-start">
              <ThemeIcon color="teal" variant="light" size={22} radius="xl" style={{ flexShrink: 0 }}><IconCheck size={13} /></ThemeIcon>
              <Text size="xs" c="gray.7" lh={1.5}>登録が増えるほど現場固有の知見が蓄積され、原因特定の精度と初動の速さが向上します。</Text>
            </Group>
          </Card>
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
type Knowledge = { total: number; avg_recovery: number; estimated_saved_minutes: number; top_causes: { cause: string; count: number }[]; by_equipment: { equipment: string; count: number }[]; longest: { date: string; equipment_id: string; cause: string; minutes: number }[] }
function KnowledgeView() {
  const [k, setK] = useState<Knowledge | null>(null)
  const load = () => fetch('/api/knowledge').then((r) => r.json()).then(setK).catch(() => {})
  useEffect(() => { load() }, [])
  if (!k) return <Center mih={240}><Loader size="sm" /></Center>
  const maxEq = Math.max(...k.by_equipment.map((e) => e.count), 1)
  const maxCause = Math.max(...k.top_causes.map((c) => c.count), 1)
  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} onClick={load}>更新</Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        <StatCard label="登録トラブル件数" value={k.total} unit="件" icon={<IconHistory size={18} />} />
        <StatCard label="平均復旧時間" value={k.avg_recovery} unit="分" icon={<IconClock size={18} />} />
        <StatCard label="初動短縮による DT 削減（試算）" value={k.estimated_saved_minutes} unit="分/月" icon={<IconBolt size={18} />} accent />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card p="lg">
          <CardHead icon={<IconChartBar size={18} />} title="よくある原因ランキング" />
          <Stack gap="sm">
            {k.top_causes.map((c, i) => (
              <div key={i}>
                <Group justify="space-between" mb={4} wrap="nowrap" gap="sm">
                  <Text size="sm" c="gray.7" truncate>{c.cause}</Text>
                  <Text size="xs" c="dimmed" className="tnum" style={{ flexShrink: 0 }}>{c.count}件</Text>
                </Group>
                <Progress value={(c.count / maxCause) * 100} color="brand" radius="xl" size="sm" />
              </div>
            ))}
          </Stack>
        </Card>
        <Card p="lg">
          <CardHead icon={<IconBuildingFactory2 size={18} />} title="設備別トラブル件数" />
          <Stack gap="sm">
            {k.by_equipment.map((e, i) => (
              <div key={i}>
                <Group justify="space-between" mb={4} wrap="nowrap" gap="sm">
                  <Text size="sm" c="gray.7" truncate>{e.equipment}</Text>
                  <Text size="xs" c="dimmed" className="tnum" style={{ flexShrink: 0 }}>{e.count}</Text>
                </Group>
                <Progress value={(e.count / maxEq) * 100} color="gray.5" radius="xl" size="sm" />
              </div>
            ))}
          </Stack>
        </Card>
      </SimpleGrid>

      <Card p="lg">
        <CardHead icon={<IconClock size={18} />} title="復旧時間 上位" />
        <Stack gap={0}>
          {k.longest.map((t, i) => (
            <Group key={i} justify="space-between" py="xs" wrap="nowrap" gap="sm"
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--mantine-color-gray-1)' }}>
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <Text size="xs" c="dimmed" className="tnum" w={84} style={{ flexShrink: 0 }} visibleFrom="xs">{t.date}</Text>
                <Badge variant="default" radius="sm" size="sm" style={{ flexShrink: 0 }}>{t.equipment_id}</Badge>
                <Text size="sm" c="gray.7" truncate>{t.cause}</Text>
              </Group>
              <Badge color="orange" variant="light" radius="sm" size="sm" className="tnum" style={{ flexShrink: 0 }}>{t.minutes}分</Badge>
            </Group>
          ))}
        </Stack>
      </Card>

      <ROICard total={k.total} avg={k.avg_recovery} />

      <Text size="xs" c="dimmed" ta="center">
        ※ ROI は初動判断短縮の試算値。係数（短縮率・分単価）は現場の実態に合わせて調整してください。
      </Text>
    </Stack>
  )
}

// ダウンタイム削減 ROI（係数を画面で調整できる“式”で算出）
function ROICard({ total, avg }: { total: number; avg: number }) {
  const [count, setCount] = useState<number | string>(total)
  const [recMin, setRecMin] = useState<number | string>(avg)
  const [reduction, setReduction] = useState<number | string>(30)
  const [rate, setRate] = useState<number | string>(8000)
  const c = Number(count) || 0, r = Number(recMin) || 0, red = Number(reduction) || 0, y = Number(rate) || 0
  const savedMin = Math.round((c * r * red) / 100)
  const savedYen = savedMin * y
  return (
    <Card p="lg" style={{ borderColor: 'var(--mantine-color-brand-3)' }}>
      <CardHead icon={<IconBolt size={18} />} title="ダウンタイム削減 ROI 試算" sub="係数を変えると即時に再計算されます" />
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" mb="md">
        <NumberInput label="対象トラブル件数" value={count} onChange={setCount} min={0} thousandSeparator="," />
        <NumberInput label="平均復旧時間(分)" value={recMin} onChange={setRecMin} min={0} />
        <NumberInput label="初動短縮率(%)" value={reduction} onChange={setReduction} min={0} max={100} suffix="%" />
        <NumberInput label="分単価(¥/分)" value={rate} onChange={setRate} min={0} step={500} thousandSeparator="," prefix="¥" />
      </SimpleGrid>
      <Paper bg="gray.0" p="md" radius="md" withBorder>
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={6} style={{ letterSpacing: 0.4 }}>計算式</Text>
        <Text size="sm" c="gray.7" className="tnum" style={{ lineHeight: 1.7 }}>
          {c.toLocaleString()} 件 × {r} 分 × {red}% × ¥{y.toLocaleString()}/分
        </Text>
        <Divider my="sm" />
        <Group justify="space-between" align="baseline" wrap="wrap" gap="xs">
          <Text size="sm" c="gray.7">削減見込み <Text span fw={700} className="tnum">{savedMin.toLocaleString()}</Text> 分</Text>
          <Group gap={8} align="baseline">
            <Text size="sm" c="dimmed">月間削減額</Text>
            <Text fw={800} fz={30} c="brand.7" className="tnum" lh={1}>¥{savedYen.toLocaleString()}</Text>
          </Group>
        </Group>
      </Paper>
    </Card>
  )
}

function StatCard({ label, value, unit, icon, accent }: { label: string; value: number; unit: string; icon: ReactNode; accent?: boolean }) {
  return (
    <Card p="lg" style={accent ? { borderColor: 'var(--mantine-color-brand-3)', background: 'var(--mantine-color-brand-0)' } : undefined}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text size="xs" c="dimmed" fw={500} maw={150}>{label}</Text>
        <ThemeIcon color={accent ? 'brand' : 'gray'} variant={accent ? 'light' : 'default'} size={32} radius="md" style={{ flexShrink: 0 }}>{icon}</ThemeIcon>
      </Group>
      <Group gap={6} align="baseline" mt="md">
        <Text fw={700} fz={30} c={accent ? 'brand.7' : 'gray.9'} className="tnum" lh={1}>{value.toLocaleString()}</Text>
        <Text size="sm" c="dimmed">{unit}</Text>
      </Group>
    </Card>
  )
}

// ===========================================================================
// 自律インシデント・ボード（R1 + S1 + S3）
// ===========================================================================
type Incident = {
  id: string; equipment_id: string; equipment_name: string; error_code: string; symptom: string
  source: string; created_at: string; urgency: string; top_cause: string; confidence: number; status: string
  resolution: null | { root_cause: string; recovery_minutes: number }
}
type Board = { incidents: Incident[]; kpi: { awaiting_approval: number; triaged: number; escalated: number; resolved: number; ai_hit_rate: number | null } }
const STATUS_META: Record<string, { label: string; color: string }> = {
  awaiting_approval: { label: '承認待ち', color: 'red' },
  triaged: { label: '対応待ち', color: 'orange' },
  escalated: { label: '保全対応中', color: 'blue' },
  resolved: { label: '解決済み', color: 'teal' },
}

function IncidentBoard() {
  const [board, setBoard] = useState<Board | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => fetch('/api/incidents').then((r) => r.json()).then(setBoard).catch(() => {})
  useEffect(() => { load() }, [])
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
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Text size="sm" c="dimmed" style={{ maxWidth: 560 }}>設備アラームを取り込むと、エージェントが全件を並列で自動トリアージし、緊急度順に積みます。</Text>
        <Group gap="xs">
          <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} onClick={load}>更新</Button>
          <Button size="xs" leftSection={<IconRobot size={15} />} loading={busy} onClick={ingest}>サンプルアラームを取り込み</Button>
        </Group>
      </Group>

      {k && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <MiniStat label="承認待ち" value={k.awaiting_approval} color="red" />
          <MiniStat label="対応待ち / 対応中" value={k.triaged + k.escalated} color="orange" />
          <MiniStat label="解決済み" value={k.resolved} color="teal" />
          <MiniStat label="AI 的中率" value={k.ai_hit_rate == null ? '—' : `${k.ai_hit_rate}%`} color="brand" />
        </SimpleGrid>
      )}

      {busy && !board?.incidents?.length && (
        <Center mih={160}><Stack align="center" gap="xs"><Loader /><Text size="sm" c="dimmed">取り込んだアラームを並列トリアージ中…</Text></Stack></Center>
      )}

      {!board ? <Center mih={160}><Loader /></Center>
        : board.incidents.length === 0 ? <EmptyBoard onIngest={ingest} busy={busy} />
          : <Stack gap="sm">{board.incidents.map((i) => <IncidentCard key={i.id} inc={i} onChange={load} />)}</Stack>}
    </Stack>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <Card p="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={800} fz={26} c={`${color}.7`} className="tnum" mt={4} lh={1}>{value}</Text>
    </Card>
  )
}

function EmptyBoard({ onIngest, busy }: { onIngest: () => void; busy: boolean }) {
  return (
    <Card p="xl"><Center mih={200}><Stack align="center" gap="sm" maw={440}>
      <ThemeIcon variant="light" color="brand" size={52} radius="md"><IconRobot size={26} /></ThemeIcon>
      <Text fw={650} c="gray.8">インシデントはまだありません</Text>
      <Text size="sm" c="dimmed" ta="center">設備アラームのサンプルを取り込むと、エージェントが全件を自動トリアージし、緊急度順にここへ積みます。</Text>
      <Button leftSection={<IconRobot size={15} />} loading={busy} onClick={onIngest} mt={4}>サンプルアラームを取り込み</Button>
    </Stack></Center></Card>
  )
}

function IncidentCard({ inc, onChange }: { inc: Incident; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [cause, setCause] = useState(inc.top_cause)
  const [rec, setRec] = useState<number | string>(20)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const u = urgency(inc.urgency)
  const st = STATUS_META[inc.status] ?? { label: inc.status, color: 'gray' }
  const approve = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/incidents/${inc.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) throw new Error()
      notifications.show({ color: 'teal', icon: <IconCheck size={16} />, title: '承認しました', message: '保全へ通知し、対応中に移行しました' }); onChange()
    } catch {
      notifications.show({ color: 'red', title: '承認に失敗しました', message: '時間をおいて再度お試しください' })
    } finally { setBusy(false) }
  }
  const resolve = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/incidents/${inc.id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root_cause: cause, recovery_minutes: Number(rec), note }) })
      if (!res.ok) throw new Error()
      notifications.show({ color: 'teal', icon: <IconCheck size={16} />, title: '解決を記録', message: '現場確定事例として学習に還流しました' }); setOpen(false); onChange()
    } catch {
      notifications.show({ color: 'red', title: '登録に失敗しました', message: '時間をおいて再度お試しください' })
    } finally { setBusy(false) }
  }
  return (
    <Card p="md" style={{ borderLeft: `3px solid var(--mantine-color-${u.color}-5)` }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon color={u.color} variant="light" size={36} radius="md" style={{ flexShrink: 0 }}><u.icon size={18} /></ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Group gap={6} wrap="wrap">
              <Text fw={650} size="sm" c="gray.8" truncate>{inc.equipment_name}</Text>
              <Badge size="xs" variant="default" radius="sm">{inc.symptom}</Badge>
              {inc.error_code && <Badge size="xs" variant="default" radius="sm">{inc.error_code}</Badge>}
            </Group>
            <Text size="xs" c="dimmed" mt={3} truncate>{inc.top_cause || '—'}{inc.confidence > 0 ? ` (${Math.round(inc.confidence * 100)}%)` : ''}</Text>
            <Text size="10px" c="dimmed" mt={2}>{inc.source} ・ {(inc.created_at || '').replace('T', ' ').slice(0, 16)}</Text>
          </Box>
        </Group>
        <Stack gap={6} align="flex-end" style={{ flexShrink: 0 }}>
          <Badge color={st.color} variant={inc.status === 'resolved' ? 'light' : 'filled'} radius="sm" size="sm">{st.label}</Badge>
          <Badge color={u.color} variant="light" radius="sm" size="xs">{u.label}</Badge>
        </Stack>
      </Group>

      {inc.status !== 'resolved' && (
        <Group gap="xs" mt="sm" justify="flex-end">
          {inc.status === 'awaiting_approval' && (
            <Button size="xs" color="orange" leftSection={<IconShieldCheck size={14} />} loading={busy} onClick={approve}>承認して保全へ通知</Button>
          )}
          <Button size="xs" variant="default" leftSection={<IconClipboardPlus size={14} />} onClick={() => setOpen((o) => !o)}>解決を記録</Button>
        </Group>
      )}
      {open && (
        <Paper bg="gray.0" p="sm" radius="md" mt="sm" withBorder>
          <Stack gap="xs">
            <TextInput size="xs" label="実際の原因" value={cause} onChange={(e) => setCause(e.currentTarget.value)} />
            <Group grow>
              <NumberInput size="xs" label="復旧時間(分)" value={rec} onChange={setRec} min={0} />
              <TextInput size="xs" label="メモ" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
            </Group>
            <Button size="xs" leftSection={<IconCheck size={14} />} loading={busy} onClick={resolve}>解決として登録（学習に反映）</Button>
          </Stack>
        </Paper>
      )}
      {inc.resolution && <Text size="xs" c="teal.7" mt="xs">解決: {inc.resolution.root_cause} ・ {inc.resolution.recovery_minutes}分</Text>}
    </Card>
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
          <Box style={{ maxWidth: 560 }}>
            <Text fw={650} c="gray.8" size="sm">ラベル付きテストセットで診断品質を計測</Text>
            <Text size="xs" c="dimmed" mt={4}>各シナリオの正解原因に対し Top1/Top3 命中率と、根拠を提示できた割合(groundedness)を測ります。現場知見の ON/OFF で比較できます。</Text>
          </Box>
          <Group gap="sm">
            <Switch checked={useFb} onChange={(e) => setUseFb(e.currentTarget.checked)} label="現場知見を使う" size="sm" />
            <Button loading={busy} leftSection={<IconShieldCheck size={15} />} onClick={run}>評価を実行</Button>
          </Group>
        </Group>
      </Card>

      {busy && (
        <Center mih={160}><Stack align="center" gap="xs"><Loader /><Text size="sm" c="dimmed">全シナリオを並列で診断・採点中…（30〜60秒）</Text></Stack></Center>
      )}

      {res && !busy && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <EvalStat label="Top1 正答率" pct={res.top1_accuracy} />
            <EvalStat label="Top3 正答率" pct={res.top3_accuracy} />
            <EvalStat label="groundedness (根拠提示率)" pct={res.grounded_rate} />
          </SimpleGrid>
          <Card p="lg">
            <CardHead icon={<IconStethoscope size={18} />} title={`ケース別結果（${res.n}件 / 現場知見 ${res.use_feedback ? 'ON' : 'OFF'}）`} />
            <Stack gap={0}>
              {res.details.map((d, i) => (
                <Group key={d.id} justify="space-between" wrap="nowrap" gap="sm" py="xs"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--mantine-color-gray-1)' }}>
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <ThemeIcon size={20} radius="xl" variant="light" color={d.top1 ? 'teal' : d.top3 ? 'orange' : 'red'} style={{ flexShrink: 0 }}>
                      {d.top1 ? <IconCheck size={12} /> : d.top3 ? <IconAlertCircle size={12} /> : <IconX size={12} />}
                    </ThemeIcon>
                    <Badge size="xs" variant="default" radius="sm" style={{ flexShrink: 0 }}>{d.equipment_id}</Badge>
                    <Text size="sm" c="gray.7" truncate>{d.predicted_top}</Text>
                  </Group>
                  <Text size="xs" c="dimmed" truncate visibleFrom="sm" style={{ flexShrink: 0, maxWidth: 160 }}>期待: {d.expected.join('/')}</Text>
                </Group>
              ))}
            </Stack>
          </Card>
          <Text size="xs" c="dimmed" ta="center">※ テストセットはコーパス内の文書化済み原因を正解とする in-distribution 評価です（汎化テストではありません）。</Text>
        </>
      )}
    </Stack>
  )
}

function EvalStat({ label, pct }: { label: string; pct: number }) {
  return (
    <Card p="lg">
      <Text size="xs" c="dimmed" fw={500}>{label}</Text>
      <Text fw={800} fz={34} c="brand.7" className="tnum" mt={6} lh={1}>{pct}<Text span fz={18} c="dimmed">%</Text></Text>
      <Progress value={pct} color="brand" radius="xl" size="sm" mt="sm" />
    </Card>
  )
}
