import { useEffect, useState, type ReactNode } from 'react'
import {
  AppShell, Container, Group, Stack, Title, Text, Card, Badge, Button,
  Select, TextInput, Textarea, Tabs, Alert, Progress, List, ThemeIcon,
  Accordion, SimpleGrid, NumberInput, Paper, Loader, Center, Grid,
  RingProgress, ScrollArea, Image, Timeline, Switch, ActionIcon, Tooltip,
} from '@mantine/core'
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle, IconSearch, IconChecklist, IconBolt, IconHistory,
  IconPhoto, IconSend, IconChartBar, IconBuildingFactory2, IconListSearch,
  IconThumbUp, IconRefresh, IconSparkles, IconArrowRight, IconCircleCheck,
  IconReportAnalytics, IconRobot, IconRoute, IconMicrophone, IconMessageChatbot,
  IconClipboardData, IconBrain,
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
}

const urgencyColor = (lvl: string) => (lvl === 'High' ? 'red' : lvl === 'Medium' ? 'yellow' : 'teal')
const agentColor: Record<string, string> = { Intake: 'gray', Retrieval: 'blue', Triage: 'indigo', Action: 'orange' }

async function fileToB64(file: File): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(file)
  })
}

// 音声入力 (Web Speech API)
function dictate(onText: (t: string) => void) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR) { notifications.show({ color: 'yellow', message: 'このブラウザは音声入力に未対応です' }); return }
  const rec = new SR(); rec.lang = 'ja-JP'; rec.interimResults = false
  rec.onresult = (e: any) => onText(e.results[0][0].transcript)
  rec.start()
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
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

  useEffect(() => { fetch('/api/meta').then((r) => r.json()).then(setMeta).catch(() => {}) }, [])

  const runTriage = async () => {
    setLoading(true); setResult(null)
    try {
      const image_b64 = imgFile ? await fileToB64(imgFile) : null
      const res = await fetch('/api/triage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipment_id: eq, process: proc, error_code: err, symptom, free_text: free, image_b64, use_feedback: useFeedback }),
      })
      if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText)
      setResult(await res.json())
    } catch (e) {
      notifications.show({ color: 'red', title: 'トリアージ失敗', message: String(e) })
    } finally { setLoading(false) }
  }

  const eName = meta?.equipments.find((x) => x.id === eq)?.name ?? eq

  return (
    <AppShell header={{ height: 64 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Group gap="sm">
            <ThemeIcon variant="gradient" gradient={{ from: 'indigo', to: 'cyan' }} size={38} radius="md">
              <IconBuildingFactory2 size={22} />
            </ThemeIcon>
            <div>
              <Title order={4} lh={1}>Manufacturing Triage Agent</Title>
              <Text size="xs" c="dimmed">4エージェントが過去トラブル/手順/設備/品質を横断して即トリアージ</Text>
            </div>
          </Group>
          <Group gap="xs" visibleFrom="sm">
            <Badge color={meta?.aoai_ready ? 'green' : 'red'} variant="dot">Azure OpenAI {meta?.aoai_ready ? '接続OK' : '未設定'}</Badge>
            <Badge color="indigo" variant="light">{meta?.deployment ?? 'gpt-4o'}</Badge>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Container size="lg">
          <Tabs defaultValue="triage" variant="pills" radius="md">
            <Tabs.List mb="md">
              <Tabs.Tab value="triage" leftSection={<IconAlertTriangle size={16} />}>トリアージ</Tabs.Tab>
              <Tabs.Tab value="feedback" leftSection={<IconThumbUp size={16} />}>フィードバック</Tabs.Tab>
              <Tabs.Tab value="knowledge" leftSection={<IconChartBar size={16} />}>ナレッジ集計</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="triage">
              <Grid>
                <Grid.Col span={{ base: 12, md: 5 }}>
                  <InputForm {...{ meta, eq, setEq, proc, setProc, err, setErr, symptom, setSymptom, free, setFree, useFeedback, setUseFeedback, imgPreview, setImgFile, setImgPreview, loading, runTriage }} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 7 }}>
                  <ResultView loading={loading} result={result} />
                </Grid.Col>
              </Grid>
              {result && <FollowupPanel intake={{ equipment_id: eq, equipment_name: eName, error_code: err, symptom, free_text: free, use_feedback: useFeedback }} />}
            </Tabs.Panel>

            <Tabs.Panel value="feedback"><FeedbackForm defaultEq={eq} defaultErr={err} defaultSymptom={symptom} /></Tabs.Panel>
            <Tabs.Panel value="knowledge"><KnowledgeView /></Tabs.Panel>
          </Tabs>
          <Text ta="center" size="xs" c="dimmed" mt="xl">Microsoft Agent Hackathon 2026 ・ Azure OpenAI (GPT-4o) + Azure App Service</Text>
        </Container>
      </AppShell.Main>
    </AppShell>
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
    <Card withBorder shadow="sm" radius="lg" p="lg">
      <Group gap="xs" mb="sm"><ThemeIcon variant="light" color="indigo"><IconListSearch size={18} /></ThemeIcon><Title order={5}>異常入力</Title></Group>
      <Stack gap="sm">
        <Select label="設備" value={p.eq} onChange={(v) => p.setEq(v ?? p.eq)}
          data={(meta?.equipments ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }))} allowDeselect={false} />
        <Group grow>
          <TextInput label="工程" value={p.proc} onChange={(e) => p.setProc(e.currentTarget.value)} />
          <TextInput label="エラーコード" value={p.err} onChange={(e) => p.setErr(e.currentTarget.value)} />
        </Group>
        <Select label="症状カテゴリ" value={p.symptom} onChange={(v) => p.setSymptom(v ?? p.symptom)} data={meta?.symptom_categories ?? []} allowDeselect={false} />
        <Textarea label={
          <Group gap={4} justify="space-between" w="100%"><span>自由記述</span>
            <Tooltip label="音声入力"><ActionIcon variant="subtle" size="sm" onClick={() => dictate(p.setFree)}><IconMicrophone size={16} /></ActionIcon></Tooltip>
          </Group>
        } autosize minRows={3} value={p.free} onChange={(e) => p.setFree(e.currentTarget.value)} />
        <div>
          <Text size="sm" fw={500} mb={4}>画像（任意 / GPT-4o visionで解析）</Text>
          {p.imgPreview ? (
            <Group><Image src={p.imgPreview} h={80} w={80} radius="md" fit="cover" />
              <Button variant="subtle" color="gray" size="xs" onClick={() => { p.setImgFile(null); p.setImgPreview(null) }}>削除</Button></Group>
          ) : (
            <Dropzone accept={IMAGE_MIME_TYPE} multiple={false} onDrop={(files) => { const f = files[0]; p.setImgFile(f); p.setImgPreview(URL.createObjectURL(f)) }} p="sm">
              <Group justify="center" gap="xs" mih={48} style={{ pointerEvents: 'none' }}><IconPhoto size={22} opacity={0.6} /><Text size="sm" c="dimmed">画像をドロップ / クリック</Text></Group>
            </Dropzone>
          )}
        </div>
        <Switch checked={p.useFeedback} onChange={(e) => p.setUseFeedback(e.currentTarget.checked)}
          label="現場知見(フィードバック)を使う" description="OFFにすると蓄積した現場確定事例を使わずに判断（賢くなる効果の比較用）" />
        <Button leftSection={<IconSearch size={18} />} loading={p.loading} onClick={p.runTriage} variant="gradient" gradient={{ from: 'indigo', to: 'cyan' }} size="md" mt="xs">トリアージ実行</Button>
      </Stack>
    </Card>
  )
}

// ---- 結果ビュー ------------------------------------------------------------
function ResultView({ loading, result }: { loading: boolean; result: Triage | null }) {
  if (loading) return (<Card withBorder radius="lg" p="xl"><Center mih={300}><Stack align="center"><Loader /><Text c="dimmed">4エージェントが資料を横断して判断中…</Text></Stack></Center></Card>)
  if (!result) return (<Card withBorder radius="lg" p="xl"><Center mih={300}><Stack align="center" gap="xs"><IconReportAnalytics size={44} opacity={0.3} /><Text c="dimmed">左で異常を入力して「トリアージ実行」を押してください</Text></Stack></Center></Card>)
  const col = urgencyColor(result.urgency.level)
  return (
    <Stack gap="md">
      <Alert color={col} variant="light" radius="lg" icon={<IconAlertTriangle size={22} />}
        title={<Group gap="xs"><Text fw={700} size="lg">緊急度: {result.urgency.level}</Text><Badge color={col} size="lg" variant="filled">{result.urgency.level}</Badge></Group>}>
        {result.urgency.reason}
      </Alert>

      {/* エージェント実行トレース */}
      <Card withBorder radius="lg" p="lg" bg="var(--mantine-color-gray-0)">
        <Group gap="xs" mb="md"><ThemeIcon color="indigo" variant="filled"><IconRoute size={18} /></ThemeIcon><Title order={5}>エージェント実行トレース</Title>
          {result.feedback_used > 0 && <Badge color="green" variant="light" leftSection={<IconBrain size={12} />}>現場知見 {result.feedback_used}件反映</Badge>}</Group>
        <Timeline active={result.trace.length} bulletSize={24} lineWidth={2}>
          {result.trace.map((t, i) => (
            <Timeline.Item key={i} color={agentColor[t.agent] ?? 'gray'}
              bullet={t.agent === 'Action' ? <IconRobot size={13} /> : <IconCircleCheck size={13} />}
              title={<Group gap={6}><Badge size="sm" color={agentColor[t.agent] ?? 'gray'} variant="light">{t.agent}</Badge><Text size="sm" fw={600}>{t.title}</Text></Group>}>
              <Text size="xs" c="dimmed">{t.detail}</Text>
            </Timeline.Item>
          ))}
        </Timeline>
      </Card>

      <Card withBorder radius="lg" p="lg">
        <Group gap="xs" mb="sm"><ThemeIcon color="teal" variant="light"><IconChecklist size={18} /></ThemeIcon><Title order={5}>まず確認すること</Title></Group>
        <List spacing="xs" center icon={<ThemeIcon color="teal" size={22} radius="xl"><IconCircleCheck size={14} /></ThemeIcon>}>
          {result.first_checks.map((c) => <List.Item key={c.order}>{c.action}</List.Item>)}
        </List>
      </Card>

      <Card withBorder radius="lg" p="lg">
        <Group gap="xs" mb="sm"><ThemeIcon color="indigo" variant="light"><IconSearch size={18} /></ThemeIcon><Title order={5}>原因候補 Top3</Title></Group>
        <Stack gap="md">
          {result.root_causes.map((c) => (
            <div key={c.rank}>
              <Group justify="space-between" mb={4}><Text fw={600}>{c.rank}. {c.cause}</Text><Badge variant="light" color="indigo">確信度 {Math.round(c.confidence * 100)}%</Badge></Group>
              <Progress value={c.confidence * 100} color="indigo" radius="xl" mb={4} />
              <Text size="sm" c="dimmed">根拠: {c.evidence}</Text>
            </div>
          ))}
        </Stack>
      </Card>

      {/* 自律実行したアクション */}
      {result.actions.length > 0 && (
        <Alert color="orange" variant="light" radius="lg" icon={<IconRobot size={20} />} title="エージェントが自律実行したアクション (function calling)">
          <Stack gap="xs">
            {result.actions.map((a, i) => (
              <Group key={i} gap="xs"><Badge color="orange" variant="filled" size="sm">{a.tool}</Badge><Text size="sm">{a.result}</Text>
                {a.detail && <Text size="xs" c="dimmed">— {a.detail}</Text>}</Group>
            ))}
          </Stack>
        </Alert>
      )}

      <Card withBorder radius="lg" p="lg">
        <Group gap="xs" mb="sm"><ThemeIcon color="grape" variant="light"><IconBolt size={18} /></ThemeIcon><Title order={5}>推奨アクション</Title></Group>
        <List spacing="xs" icon={<ThemeIcon color="grape" size={20} radius="xl"><IconArrowRight size={12} /></ThemeIcon>}>
          {result.recommended_actions.map((a, i) => <List.Item key={i}>{a}</List.Item>)}
        </List>
      </Card>

      {result.image_findings && (
        <Card withBorder radius="lg" p="lg"><Group gap="xs" mb="sm"><ThemeIcon color="pink" variant="light"><IconPhoto size={18} /></ThemeIcon><Title order={5}>画像所見 (vision)</Title></Group><Text size="sm">{result.image_findings}</Text></Card>
      )}

      <Card withBorder radius="lg" p="lg">
        <Group gap="xs" mb="sm"><ThemeIcon color="cyan" variant="light"><IconHistory size={18} /></ThemeIcon><Title order={5}>類似事例</Title></Group>
        <Stack gap="xs">
          {result.similar_cases.map((s, i) => (
            <Paper key={i} withBorder p="sm" radius="md">
              <Group justify="space-between"><Text fw={500} size="sm">{s.date} {s.title}</Text><Badge variant="light" color="cyan">{s.recovery_minutes}分で復旧</Badge></Group>
              <Text size="sm" c="dimmed">原因: {s.cause} — {s.note}</Text>
            </Paper>
          ))}
        </Stack>
      </Card>

      <Accordion variant="separated" radius="lg">
        <Accordion.Item value="cite">
          <Accordion.Control icon={<IconListSearch size={18} />}>根拠詳細（参照した資料 {result.citations.length} 件）</Accordion.Control>
          <Accordion.Panel>
            <ScrollArea h={240}>
              <Stack gap="xs">
                {result.citations.map((c, i) => (
                  <Paper key={i} withBorder p="xs" radius="md">
                    <Group gap="xs" mb={2}><Badge size="xs" variant="light">{c.label}</Badge>{c.is_feedback && <Badge size="xs" color="green" variant="filled">現場確定</Badge>}<Text size="xs" c="dimmed">{c.doc_id}</Text></Group>
                    <Text size="xs">{c.text}</Text>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  )
}

// ---- フォローアップ質問 ----------------------------------------------------
type FIntake = { equipment_id: string; equipment_name: string; error_code: string; symptom: string; free_text: string; use_feedback: boolean }
function FollowupPanel({ intake }: { intake: FIntake }) {
  const [q, setQ] = useState('')
  const [log, setLog] = useState<{ q: string; a: string }[]>([])
  const [loading, setLoading] = useState(false)
  const ask = async () => {
    if (!q.trim()) return
    const question = q; setQ(''); setLoading(true)
    try {
      const res = await fetch('/api/followup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...intake, question }) })
      const d = await res.json()
      setLog((l) => [...l, { q: question, a: d.answer ?? d.detail ?? 'エラー' }])
    } finally { setLoading(false) }
  }
  return (
    <Card withBorder radius="lg" p="lg" mt="md">
      <Group gap="xs" mb="sm"><ThemeIcon color="indigo" variant="light"><IconMessageChatbot size={18} /></ThemeIcon><Title order={5}>フォローアップ質問（資料を根拠に回答）</Title></Group>
      <Stack gap="sm">
        {log.map((e, i) => (
          <div key={i}>
            <Group gap={6}><Badge variant="light">Q</Badge><Text size="sm" fw={600}>{e.q}</Text></Group>
            <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>{e.a}</Text>
          </div>
        ))}
        <Group gap="xs">
          <TextInput style={{ flex: 1 }} placeholder="例: ローラー交換の手順は？" value={q} onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
          <Tooltip label="音声入力"><ActionIcon variant="light" size="lg" onClick={() => dictate(setQ)}><IconMicrophone size={18} /></ActionIcon></Tooltip>
          <Button onClick={ask} loading={loading} leftSection={<IconSend size={16} />}>質問</Button>
        </Group>
      </Stack>
    </Card>
  )
}

// ---- フィードバック --------------------------------------------------------
function FeedbackForm({ defaultEq, defaultErr, defaultSymptom }: { defaultEq: string; defaultErr: string; defaultSymptom: string }) {
  const [eq, setEq] = useState(defaultEq); const [err, setErr] = useState(defaultErr); const [symptom, setSymptom] = useState(defaultSymptom)
  const [cause, setCause] = useState('搬送ローラー摩耗'); const [action, setAction] = useState('駆動ローラー交換')
  const [rec, setRec] = useState<number | string>(22); const [correct, setCorrect] = useState('当たり'); const [note, setNote] = useState('')
  const submit = async () => {
    const res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipment_id: eq, error_code: err, symptom, root_cause: cause, action_taken: action, recovery_minutes: Number(rec), ai_was_correct: correct, note }) })
    if (res.ok) notifications.show({ color: 'green', icon: <IconSparkles size={18} />, title: '登録しました', message: '次回のトリアージから現場確定事例として参照されます（使うほど賢くなる）' })
  }
  return (
    <Card withBorder shadow="sm" radius="lg" p="lg" maw={640} mx="auto">
      <Group gap="xs" mb="xs"><ThemeIcon variant="light" color="green"><IconThumbUp size={18} /></ThemeIcon><Title order={5}>現場フィードバック登録</Title></Group>
      <Text size="sm" c="dimmed" mb="md">実際の結果を登録すると、次回以降の検索対象に入り精度が上がります。</Text>
      <Stack gap="sm">
        <Group grow><TextInput label="設備ID" value={eq} onChange={(e) => setEq(e.currentTarget.value)} /><TextInput label="エラーコード" value={err} onChange={(e) => setErr(e.currentTarget.value)} /></Group>
        <TextInput label="症状" value={symptom} onChange={(e) => setSymptom(e.currentTarget.value)} />
        <TextInput label="実際の原因" value={cause} onChange={(e) => setCause(e.currentTarget.value)} />
        <TextInput label="実施した対処" value={action} onChange={(e) => setAction(e.currentTarget.value)} />
        <Group grow><NumberInput label="復旧時間(分)" value={rec} onChange={setRec} min={0} />
          <Select label="AI回答は当たっていたか" value={correct} onChange={(v) => setCorrect(v ?? correct)} data={['当たり', '部分的', '外れ']} allowDeselect={false} /></Group>
        <Textarea label="追加メモ" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Button color="green" leftSection={<IconSparkles size={18} />} onClick={submit}>登録</Button>
      </Stack>
    </Card>
  )
}

// ---- ナレッジ集計 ----------------------------------------------------------
type Knowledge = { total: number; avg_recovery: number; estimated_saved_minutes: number; top_causes: { cause: string; count: number }[]; by_equipment: { equipment: string; count: number }[]; longest: { date: string; equipment_id: string; cause: string; minutes: number }[] }
function KnowledgeView() {
  const [k, setK] = useState<Knowledge | null>(null)
  const load = () => fetch('/api/knowledge').then((r) => r.json()).then(setK).catch(() => {})
  useEffect(() => { load() }, [])
  if (!k) return <Center mih={200}><Loader /></Center>
  const maxEq = Math.max(...k.by_equipment.map((e) => e.count), 1)
  return (
    <Stack gap="md">
      <Group justify="flex-end"><Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={load}>更新</Button></Group>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <StatCard color="indigo" label="登録トラブル件数" value={`${k.total} 件`} icon={<IconHistory size={20} />} />
        <StatCard color="cyan" label="平均復旧時間" value={`${k.avg_recovery} 分`} icon={<IconBolt size={20} />} />
        <RingCard saved={k.estimated_saved_minutes} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder radius="lg" p="lg"><Title order={6} mb="sm">よくある原因ランキング</Title>
          <Stack gap="xs">{k.top_causes.map((c, i) => (<Group key={i} justify="space-between"><Text size="sm">{c.cause}</Text><Badge variant="light">{c.count}件</Badge></Group>))}</Stack></Card>
        <Card withBorder radius="lg" p="lg"><Title order={6} mb="sm">設備別トラブル件数</Title>
          <Stack gap="sm">{k.by_equipment.map((e, i) => (<div key={i}><Group justify="space-between" mb={2}><Text size="sm">{e.equipment}</Text><Text size="xs" c="dimmed">{e.count}</Text></Group><Progress value={(e.count / maxEq) * 100} color="indigo" radius="xl" /></div>))}</Stack></Card>
      </SimpleGrid>
      <Card withBorder radius="lg" p="lg"><Title order={6} mb="sm">復旧時間 上位</Title>
        <Stack gap="xs">{k.longest.map((t, i) => (<Group key={i} justify="space-between"><Text size="sm">{t.date} ・ {t.equipment_id} ・ {t.cause}</Text><Badge color="orange" variant="light">{t.minutes}分</Badge></Group>))}</Stack></Card>
      <Text size="xs" c="dimmed" ta="center">※ DT削減は初動判断短縮の試算値。ダウンタイム1分=数千〜数万円のラインを想定。</Text>
    </Stack>
  )
}

function StatCard({ color, label, value, icon }: { color: string; label: string; value: string; icon: ReactNode }) {
  return (<Card withBorder radius="lg" p="lg"><Group><ThemeIcon color={color} variant="light" size={42} radius="md">{icon}</ThemeIcon><div><Text size="xs" c="dimmed">{label}</Text><Text fw={700} size="xl">{value}</Text></div></Group></Card>)
}
function RingCard({ saved }: { saved: number }) {
  return (<Card withBorder radius="lg" p="lg"><Group><RingProgress size={70} thickness={8} roundCaps sections={[{ value: Math.min(saved / 5, 100), color: 'teal' }]} label={<Center><IconClipboardData size={20} /></Center>} /><div><Text size="xs" c="dimmed">初動短縮によるDT削減(試算)</Text><Text fw={700} size="xl">{saved} 分/月</Text></div></Group></Card>)
}
