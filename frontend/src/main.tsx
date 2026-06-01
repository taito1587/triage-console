import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dropzone/styles.css'
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
  defaultRadius: 'md',
  fontSizes: {
    xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '19px',
  },
  headings: {
    fontWeight: '650',
    sizes: {
      h4: { fontSize: '16px', lineHeight: '1.4' },
      h5: { fontSize: '14px', lineHeight: '1.4' },
      h6: { fontSize: '13px', lineHeight: '1.4' },
    },
  },
  radius: { sm: '6px', md: '8px', lg: '12px' },
  components: {
    Card: { defaultProps: { shadow: 'none', withBorder: true, radius: 'md' } },
    Paper: { defaultProps: { radius: 'md' } },
    Button: { defaultProps: { fw: 600 } },
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
