import { useEffect, useState, type ReactNode } from 'react'
import {
  AppShell, Group, Stack, Box, Title, Text, Card, Badge, Button,
  Select, TextInput, Textarea, Progress, ThemeIcon, UnstyledButton,
  Accordion, SimpleGrid, NumberInput, Paper, Loader, Center, Grid,
  ScrollArea, Image, Switch, ActionIcon, Tooltip, Burger, Divider, Skeleton,
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
  IconPointFilled, IconClipboardPlus,
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

// 緊急度 → 配色 / ラベル（意味づけ色のみ最小限に使用）
const urgency = (lvl: string) =>
  lvl === 'High' ? { color: 'red', label: '高', icon: <IconAlertTriangle size={18} /> }
    : lvl === 'Medium' ? { color: 'orange', label: '中', icon: <IconAlertCircle size={18} /> }
      : { color: 'teal', label: '低', icon: <IconCircleCheck size={18} /> }

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

// ---- 共通: カード見出し（アイコンはモノクロで統一） ----------------------
function CardHead({ icon, title, sub, right }: { icon: ReactNode; title: string; sub?: string; right?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" mb="md">
      <Group gap={10} wrap="nowrap" align="flex-start">
        <Box c="gray.5" mt={1} style={{ display: 'flex' }}>{icon}</Box>
        <div>
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
  { value: 'feedback', label: '現場フィードバック', desc: '対処結果を学習させる', icon: IconBulb },
  { value: 'knowledge', label: 'ナレッジ集計', desc: '蓄積データの分析', icon: IconChartHistogram },
]

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
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 264, breakpoint: 'sm', collapsed: { mobile: !navOpen } }}
      padding="lg"
    >
      {/* ---- ヘッダー -------------------------------------------------------- */}
      <AppShell.Header withBorder>
        <Group h="100%" px="lg" justify="space-between" wrap="nowrap" align="center">
          <Group gap="sm" wrap="nowrap" align="center">
            <Burger opened={navOpen} onClick={toggleNav} hiddenFrom="sm" size="sm" />
            <img src="/logo.png" alt="Triage Console" style={{ height: 32, width: 'auto', display: 'block' }} />
          </Group>

          <Tooltip label={meta?.aoai_ready ? 'Azure OpenAI に接続済み' : 'Azure OpenAI が未設定です'} withArrow position="bottom-end">
            <Box visibleFrom="xs" style={{
              display: 'flex', alignItems: 'stretch', height: 30, overflow: 'hidden',
              border: '1px solid var(--mantine-color-gray-2)', borderRadius: 8,
            }}>
              <Box style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px' }}>
                <IconPointFilled size={11} style={{ color: `var(--mantine-color-${meta?.aoai_ready ? 'teal' : 'red'}-6)` }} />
                <Text size="xs" fw={600} c="gray.7" lh={1}>Azure OpenAI</Text>
              </Box>
              <Box style={{ width: 1, background: 'var(--mantine-color-gray-2)' }} />
              <Box style={{ display: 'flex', alignItems: 'center', padding: '0 10px', background: 'var(--mantine-color-gray-0)' }}>
                <Text size="xs" fw={600} c="gray.6" ff="monospace" lh={1}>{meta?.deployment ?? 'gpt-4o'}</Text>
              </Box>
            </Box>
          </Tooltip>
        </Group>
      </AppShell.Header>

      {/* ---- サイドバー ------------------------------------------------------ */}
      <AppShell.Navbar p="sm" withBorder>
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" px="xs" mb={8} style={{ letterSpacing: 0.6 }}>
          メニュー
        </Text>
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

        <Box mt="auto" pt="sm">
          <Divider mb="sm" />
          <Card p="sm" radius="md" bg="gray.0" withBorder>
            <Group gap={8} wrap="nowrap">
              <ThemeIcon variant="light" color="gray" size={30} radius="md"><IconSitemap size={16} /></ThemeIcon>
              <div>
                <Text size="xs" fw={600} c="gray.8" lh={1.2}>マルチエージェント構成</Text>
                <Text size="10px" c="dimmed" lh={1.3} mt={2}>Intake → Retrieval → Triage → Action</Text>
              </div>
            </Group>
          </Card>
        </Box>
      </AppShell.Navbar>

      {/* ---- メイン --------------------------------------------------------- */}
      <AppShell.Main>
        <Box maw={1180} mx="auto">
          {active === 'triage' && (
            <>
              <PageHead title="設備異常トリアージ" desc="過去トラブル・手順書・設備台帳・品質記録を横断し、原因候補と初動を提示します。" />
              <Grid gap="lg">
                <Grid.Col span={{ base: 12, md: 5 }}>
                  <InputForm {...{ meta, eq, setEq, proc, setProc, err, setErr, symptom, setSymptom, free, setFree, useFeedback, setUseFeedback, imgPreview, setImgFile, setImgPreview, loading, runTriage }} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 7 }}>
                  <ResultView loading={loading} result={result} />
                </Grid.Col>
              </Grid>
              {result && <FollowupPanel intake={{ equipment_id: eq, equipment_name: eName, error_code: err, symptom, free_text: free, use_feedback: useFeedback }} />}
            </>
          )}

          {active === 'feedback' && (
            <>
              <PageHead title="現場フィードバック登録" desc="実際の原因と対処を登録すると、次回以降の検索対象に加わり診断精度が向上します。" />
              <FeedbackForm defaultEq={eq} defaultErr={err} defaultSymptom={symptom} />
            </>
          )}

          {active === 'knowledge' && (
            <>
              <PageHead title="ナレッジ集計" desc="蓄積されたトラブル対応データを集計し、傾向と削減効果を可視化します。" />
              <KnowledgeView />
            </>
          )}

          <Text ta="center" size="xs" c="dimmed" mt={48} mb="md">
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
            <Group gap={4} justify="space-between" w="100%">
              <span>自由記述</span>
              <Tooltip label="音声入力"><ActionIcon variant="subtle" color="gray" size="sm" onClick={() => dictate(p.setFree)}><IconMicrophone size={15} /></ActionIcon></Tooltip>
            </Group>
          }
          autosize minRows={3} value={p.free} onChange={(e) => p.setFree(e.currentTarget.value)} placeholder="例: 搬送部から異音。直前に段取り替え。" />

        <div>
          <Text size="sm" fw={500} mb={6}>画像 <Text span size="xs" c="dimmed">（任意・GPT-4o vision で解析）</Text></Text>
          {p.imgPreview ? (
            <Group gap="sm">
              <Image src={p.imgPreview} h={72} w={72} radius="md" fit="cover" />
              <Button variant="default" size="xs" leftSection={<IconX size={14} />} onClick={() => { p.setImgFile(null); p.setImgPreview(null) }}>削除</Button>
            </Group>
          ) : (
            <Dropzone accept={IMAGE_MIME_TYPE} multiple={false} radius="md"
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
                <Box pb={last ? 0 : 'lg'} pt={6} style={{ flex: 1 }}>
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
          <SimpleGrid cols={2} spacing="sm" verticalSpacing="xs">
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

// ---- 結果なし/処理中スケルトン --------------------------------------------
function ResultSkeleton() {
  return (
    <Stack gap="md">
      <Card p="lg" style={{ borderLeft: '3px solid var(--mantine-color-gray-3)' }}>
        <Group wrap="nowrap">
          <Skeleton h={38} w={38} radius="md" />
          <Box style={{ flex: 1 }}>
            <Skeleton h={9} w={90} mb={10} radius="sm" />
            <Skeleton h={13} w="75%" radius="sm" />
          </Box>
        </Group>
      </Card>
      <Card p="lg">
        <Skeleton h={11} w={150} mb="lg" radius="sm" />
        {[0, 1, 2].map((i) => (
          <Group key={i} wrap="nowrap" mb={i === 2 ? 0 : 'md'} align="flex-start">
            <Skeleton h={24} w={24} radius="xl" />
            <Box style={{ flex: 1 }}>
              <Skeleton h={11} w="40%" mb={8} radius="sm" />
              <Skeleton h={9} w="85%" radius="sm" />
            </Box>
          </Group>
        ))}
      </Card>
      <Card p="lg">
        <Skeleton h={11} w={120} mb="lg" radius="sm" />
        {[0, 1, 2].map((i) => (
          <Box key={i} mb={i === 2 ? 0 : 'md'}>
            <Skeleton h={11} w="55%" mb={8} radius="sm" />
            <Skeleton h={8} w="100%" radius="xl" />
          </Box>
        ))}
      </Card>
      <Center mt="xs">
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">エージェントが資料を横断して判断中…</Text>
        </Group>
      </Center>
    </Stack>
  )
}

// ---- 結果ビュー ------------------------------------------------------------
function ResultView({ loading, result }: { loading: boolean; result: Triage | null }) {
  if (loading) return <ResultSkeleton />
  if (!result) return <EmptyGuide />

  const u = urgency(result.urgency.level)
  const foundry = (result.engine || '') === 'foundry'
  return (
    <Stack gap="md">
      {/* 緊急度バナー */}
      <Card p="lg" style={{ borderLeft: `3px solid var(--mantine-color-${u.color}-6)` }}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon color={u.color} variant="light" size={38} radius="md">{u.icon}</ThemeIcon>
            <div>
              <Group gap={8}>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: 0.4 }}>緊急度</Text>
                <Badge color={u.color} variant="light" radius="sm" size="sm">{u.label} ・ {result.urgency.level}</Badge>
              </Group>
              <Text size="sm" c="gray.7" mt={6}>{result.urgency.reason}</Text>
            </div>
          </Group>
        </Group>
      </Card>

      {/* エージェント実行トレース */}
      <Card p="lg">
        <CardHead icon={<IconRoute size={18} />} title="エージェント実行トレース"
          right={
            <Group gap={6} wrap="nowrap">
              <Badge color={foundry ? 'brand' : 'gray'} variant="light" radius="sm" tt="none"
                leftSection={<IconSitemap size={11} />}>
                {foundry ? 'Azure AI Foundry' : 'ローカル推論'}
              </Badge>
              {result.feedback_used > 0 && (
                <Badge color="teal" variant="light" radius="sm" leftSection={<IconCheck size={11} />}>現場知見 {result.feedback_used}件反映</Badge>
              )}
            </Group>
          } />
        <Stack gap={0}>
          {result.trace.map((t, i) => {
            const last = i === result.trace.length - 1
            return (
              <Group key={i} gap="sm" wrap="nowrap" align="flex-start">
                <Stack gap={0} align="center" w={24}>
                  <ThemeIcon size={24} radius="xl" variant="light" color={t.agent === 'Action' ? 'orange' : 'brand'}>
                    {t.agent === 'Action' ? <IconRobot size={13} /> : <IconCheck size={13} />}
                  </ThemeIcon>
                  {!last && <Box w={2} flex={1} mih={18} bg="gray.2" my={2} />}
                </Stack>
                <Box pb={last ? 0 : 'md'} style={{ flex: 1 }}>
                  <Group gap={6}>
                    <Badge size="xs" radius="sm" color="gray" variant="light" tt="none">{t.agent}</Badge>
                    <Text size="sm" fw={600} c="gray.8">{t.title}</Text>
                  </Group>
                  <Text size="xs" c="dimmed" mt={2}>{t.detail}</Text>
                </Box>
              </Group>
            )
          })}
        </Stack>
      </Card>

      {/* connected agents の所見 */}
      {result.specialist_findings?.length > 0 && (
        <Card p="lg">
          <CardHead icon={<IconSitemap size={18} />} title="専門エージェントの所見"
            sub="Azure AI Foundry の connected agents が個別に分析" />
          <Stack gap="sm">
            {result.specialist_findings.map((f, i) => (
              <Paper key={i} withBorder p="sm" radius="md" bg="gray.0">
                <Badge variant="light" color="brand" radius="sm" size="sm" mb={6} tt="none">{f.label}</Badge>
                <Text size="sm" c="gray.7" style={{ whiteSpace: 'pre-wrap' }}>{f.output}</Text>
              </Paper>
            ))}
          </Stack>
        </Card>
      )}

      {/* 自律実行アクション */}
      {result.actions.length > 0 && (
        <Card p="lg" style={{ borderLeft: '3px solid var(--mantine-color-orange-5)' }}>
          <CardHead icon={<IconRobot size={18} />} title="自律実行したアクション" sub="function calling によりエージェントが実施" />
          <Stack gap="xs">
            {result.actions.map((a, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Badge color="orange" variant="light" radius="sm" size="sm" tt="none">{a.tool}</Badge>
                <Text size="sm" c="gray.7">{a.result}{a.detail && <Text span size="xs" c="dimmed"> — {a.detail}</Text>}</Text>
              </Group>
            ))}
          </Stack>
        </Card>
      )}

      <SimpleGrid cols={{ base: 1 }} spacing="md">
        {/* まず確認すること */}
        <Card p="lg">
          <CardHead icon={<IconChecklist size={18} />} title="まず確認すること" />
          <Stack gap="xs">
            {result.first_checks.map((c) => (
              <Group key={c.order} gap="sm" align="flex-start" wrap="nowrap">
                <ThemeIcon color="teal" variant="light" size={22} radius="xl"><IconCheck size={13} /></ThemeIcon>
                <Text size="sm" c="gray.7">{c.action}</Text>
              </Group>
            ))}
          </Stack>
        </Card>

        {/* 原因候補 */}
        <Card p="lg">
          <CardHead icon={<IconSearch size={18} />} title="原因候補 Top 3" />
          <Stack gap="md">
            {result.root_causes.map((c) => (
              <div key={c.rank}>
                <Group justify="space-between" mb={6} wrap="nowrap" align="flex-start">
                  <Group gap={8} wrap="nowrap">
                    <Badge variant="filled" color="gray" radius="sm" size="sm">{c.rank}</Badge>
                    <Text fw={600} size="sm" c="gray.8">{c.cause}</Text>
                  </Group>
                  <Text size="xs" fw={700} c="brand.7" className="tnum">{Math.round(c.confidence * 100)}%</Text>
                </Group>
                <Progress value={c.confidence * 100} color="brand" radius="xl" size="sm" mb={6} />
                <Text size="xs" c="dimmed">根拠: {c.evidence}</Text>
              </div>
            ))}
          </Stack>
        </Card>

        {/* 推奨アクション */}
        <Card p="lg">
          <CardHead icon={<IconBolt size={18} />} title="推奨アクション" />
          <Stack gap="xs">
            {result.recommended_actions.map((a, i) => (
              <Group key={i} gap="sm" align="flex-start" wrap="nowrap">
                <ThemeIcon color="brand" variant="light" size={20} radius="xl"><IconArrowRight size={12} /></ThemeIcon>
                <Text size="sm" c="gray.7">{a}</Text>
              </Group>
            ))}
          </Stack>
        </Card>

        {/* 画像所見 */}
        {result.image_findings && (
          <Card p="lg">
            <CardHead icon={<IconPhoto size={18} />} title="画像所見 (vision)" />
            <Text size="sm" c="gray.7">{result.image_findings}</Text>
          </Card>
        )}

        {/* 類似事例 */}
        <Card p="lg">
          <CardHead icon={<IconHistory size={18} />} title="類似事例" />
          <Stack gap="xs">
            {result.similar_cases.map((s, i) => (
              <Paper key={i} withBorder p="sm" radius="md" bg="gray.0">
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={600} size="sm" c="gray.8">{s.title}</Text>
                  <Badge variant="default" radius="sm" size="sm" leftSection={<IconClock size={11} />}>{s.recovery_minutes}分で復旧</Badge>
                </Group>
                <Text size="xs" c="dimmed" mt={4}>{s.date} ・ 原因: {s.cause} — {s.note}</Text>
              </Paper>
            ))}
          </Stack>
        </Card>
      </SimpleGrid>

      {/* 根拠詳細 */}
      <Accordion variant="separated" radius="md"
        styles={{ item: { border: '1px solid var(--mantine-color-gray-2)', background: '#fff' } }}>
        <Accordion.Item value="cite">
          <Accordion.Control icon={<IconListSearch size={17} color="var(--mantine-color-gray-5)" />}>
            <Text size="sm" fw={600} c="gray.8">参照資料 <Text span c="dimmed" fw={400}>{result.citations.length} 件</Text></Text>
          </Accordion.Control>
          <Accordion.Panel>
            <ScrollArea h={240}>
              <Stack gap="xs" pr="sm">
                {result.citations.map((c, i) => (
                  <Paper key={i} withBorder p="sm" radius="md" bg="gray.0">
                    <Group gap="xs" mb={4} wrap="nowrap">
                      <Badge size="xs" variant="default" radius="sm">{c.label}</Badge>
                      {c.is_feedback && <Badge size="xs" color="teal" variant="light" radius="sm">現場確定</Badge>}
                      <Text size="xs" c="dimmed" className="tnum">{c.doc_id}</Text>
                    </Group>
                    <Text size="xs" c="gray.7">{c.text}</Text>
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
    <Card p="lg" mt="md">
      <CardHead icon={<IconMessageChatbot size={18} />} title="フォローアップ質問" sub="診断内容について資料を根拠に回答します" />
      <Stack gap="md">
        {log.map((e, i) => (
          <Box key={i}>
            <Group gap={8} mb={6} align="flex-start" wrap="nowrap">
              <Badge variant="filled" color="dark" radius="sm" size="sm">Q</Badge>
              <Text size="sm" fw={600} c="gray.8">{e.q}</Text>
            </Group>
            <Paper bg="gray.0" p="sm" radius="md" withBorder>
              <Text size="sm" c="gray.7" style={{ whiteSpace: 'pre-wrap' }}>{e.a}</Text>
            </Paper>
          </Box>
        ))}
        <Group gap="xs">
          <TextInput style={{ flex: 1 }} placeholder="例: ローラー交換の手順は？" value={q} onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
          <Tooltip label="音声入力"><ActionIcon variant="default" size="lg" onClick={() => dictate(setQ)}><IconMicrophone size={17} /></ActionIcon></Tooltip>
          <Button onClick={ask} loading={loading} leftSection={<IconSend size={15} />}>質問</Button>
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
    if (res.ok) notifications.show({ color: 'teal', icon: <IconCheck size={16} />, title: '登録しました', message: '次回のトリアージから現場確定事例として参照されます' })
  }
  return (
    <Grid gap="lg" align="stretch">
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Card p="lg" h="100%">
          <CardHead icon={<IconClipboardPlus size={18} />} title="対応実績の登録" sub="実際の結果が次回以降の検索対象に加わります" />
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
                  <Stack gap={0} align="center" w={28}>
                    <ThemeIcon size={28} radius="xl" variant="light" color="brand">
                      <Text size="xs" fw={700} c="brand.7">{i + 1}</Text>
                    </ThemeIcon>
                    {!last && <Box w={2} flex={1} mih={18} bg="gray.2" my={4} />}
                  </Stack>
                  <Box pb={last ? 0 : 'md'} pt={3} style={{ flex: 1 }}>
                    <Text fw={650} size="sm" c="gray.8">{s.title}</Text>
                    <Text size="xs" c="dimmed" mt={2}>{s.desc}</Text>
                  </Box>
                </Group>
              )
            })}
          </Stack>
          <Card bg="gray.0" p="sm" radius="md" withBorder={false} mt="md">
            <Group gap={8} wrap="nowrap" align="flex-start">
              <ThemeIcon color="teal" variant="light" size={22} radius="xl"><IconCheck size={13} /></ThemeIcon>
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
                <Group justify="space-between" mb={4}>
                  <Text size="sm" c="gray.7">{c.cause}</Text>
                  <Text size="xs" c="dimmed" className="tnum">{c.count}件</Text>
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
                <Group justify="space-between" mb={4}>
                  <Text size="sm" c="gray.7">{e.equipment}</Text>
                  <Text size="xs" c="dimmed" className="tnum">{e.count}</Text>
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
            <Group key={i} justify="space-between" py="xs" wrap="nowrap"
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--mantine-color-gray-1)' }}>
              <Group gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed" className="tnum" w={84}>{t.date}</Text>
                <Badge variant="default" radius="sm" size="sm">{t.equipment_id}</Badge>
                <Text size="sm" c="gray.7">{t.cause}</Text>
              </Group>
              <Badge color="orange" variant="light" radius="sm" size="sm" className="tnum">{t.minutes}分</Badge>
            </Group>
          ))}
        </Stack>
      </Card>

      <Text size="xs" c="dimmed" ta="center">
        ※ DT 削減は初動判断短縮の試算値。ダウンタイム 1 分 = 数千〜数万円のラインを想定。
      </Text>
    </Stack>
  )
}

function StatCard({ label, value, unit, icon, accent }: { label: string; value: number; unit: string; icon: ReactNode; accent?: boolean }) {
  return (
    <Card p="lg" style={accent ? { borderColor: 'var(--mantine-color-brand-3)', background: 'var(--mantine-color-brand-0)' } : undefined}>
      <Group justify="space-between" align="flex-start">
        <Text size="xs" c="dimmed" fw={500} maw={150}>{label}</Text>
        <ThemeIcon color={accent ? 'brand' : 'gray'} variant={accent ? 'light' : 'default'} size={32} radius="md">{icon}</ThemeIcon>
      </Group>
      <Group gap={6} align="baseline" mt="md">
        <Text fw={700} fz={30} c={accent ? 'brand.7' : 'gray.9'} className="tnum" lh={1}>{value.toLocaleString()}</Text>
        <Text size="sm" c="dimmed">{unit}</Text>
      </Group>
    </Card>
  )
}
