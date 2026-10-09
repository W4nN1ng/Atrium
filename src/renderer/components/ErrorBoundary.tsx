import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18next from 'i18next'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  info: string
}

/**
 * 渲染进程兜底。
 *
 * 起因：humanBytes 把 Intl 单位写成 'bytes'，小于 1KB 的文件一进收件箱就抛 RangeError，
 * React 直接把整棵树卸载 —— 用户看到的是全白窗口，只能重开（2026-10-04 实测）。
 * 一个组件写错不该让程序消失，所以这里给一句人话 + 重新加载。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? '' })
    // 主进程把渲染进程的 console 转进日志文件（window.ts），所以这里不用另开 IPC 通道
    console.error('renderer crash: ' + error.message + '\n' + (info.componentStack ?? ''))
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div
          className="max-w-lg rounded-lg border p-4"
          style={{ borderColor: 'var(--bad)', background: 'var(--panel)' }}
        >
          <div className="mb-2 text-[14px]">{i18next.t('error.crashed')}</div>
          <pre
            className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]"
            style={{ color: 'var(--faint)' }}
          >
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button type="button" className="btn px-3 py-1" onClick={() => window.location.reload()}>
            {i18next.t('error.reload')}
          </button>
        </div>
      </div>
    )
  }
}
