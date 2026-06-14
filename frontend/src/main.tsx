import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dropzone/styles.css'
import '@mantine/charts/styles.css'
import './index.css'
import { MantineProvider, createTheme, type MantineColorsTuple } from '@mantine/core'
import { Notifications } from '@mantine/notifications'

import App from './App.tsx'

// 信頼感のある単色ブルーをアクセントに（業務 SaaS 基調）
const brand: MantineColorsTuple = [
  '#eef4ff', '#dce6fb', '#b6cbf3', '#8dafec', '#6c97e6',
  '#5687e3', '#497ee2', '#3a6bc9', '#305fb4', '#22529f',
]

// ニュートラルは slate 系で統一（クール寄りの落ち着いたグレー）
const slate: MantineColorsTuple = [
  '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8',
  '#64748b', '#475569', '#334155', '#1e293b', '#0f172a',
]

const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 5 },
  colors: { brand, gray: slate, dark: slate },
  white: '#ffffff',
  black: '#0f172a',
  fontFamily:
    '"Inter", "Hiragino Sans", "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace',
  defaultRadius: 'sm',
  fontSizes: {
    xs: '11px', sm: '13px', md: '14px', lg: '15px', xl: '18px',
  },
  headings: {
    fontWeight: '700',
    sizes: {
      h3: { fontSize: '18px', lineHeight: '1.3' },
      h4: { fontSize: '15px', lineHeight: '1.4' },
      h5: { fontSize: '13px', lineHeight: '1.4' },
      h6: { fontSize: '12px', lineHeight: '1.4' },
    },
  },
  radius: { xs: '3px', sm: '4px', md: '6px', lg: '10px' },
  components: {
    Card: { defaultProps: { shadow: 'none', withBorder: true, radius: 'sm' } },
    Paper: { defaultProps: { radius: 'sm' } },
    Button: { defaultProps: { fw: 600, radius: 'sm' } },
    Badge: { defaultProps: { radius: 'xs' } },
    TextInput: { defaultProps: { radius: 'sm' } },
    Textarea: { defaultProps: { radius: 'sm' } },
    Select: { defaultProps: { radius: 'sm' } },
    NumberInput: { defaultProps: { radius: 'sm' } },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </StrictMode>,
)
