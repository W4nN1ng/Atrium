import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useUi } from './stores/ui'
import { initI18n } from './i18n'
import { App } from './App'
import { TooltipProvider } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root')

async function main(): Promise<void> {
  await initI18n('zh-CN')
  createRoot(container as HTMLElement).render(
    <StrictMode>
      <ErrorBoundary>
        <TooltipProvider delayDuration={260} skipDelayDuration={400}>
          <App />
        </TooltipProvider>
      </ErrorBoundary>
    </StrictMode>
  )
  void useUi.getState().boot()
}

void main()
