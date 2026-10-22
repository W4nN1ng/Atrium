import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export const TooltipProvider = Tooltip.Provider

export function Tip({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-50 rounded border px-2 py-1 text-[11px]"
          style={{ background: 'var(--raise)', borderColor: 'var(--line-2)', color: 'var(--text)' }}
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

type BtnProps = {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'accent' | 'ghost'
  disabled?: boolean
  title?: string
  className?: string
  /** 危险确认框里要把焦点放在"安全的那一个"上（一键入库 = 仅登记，不移动磁盘） */
  autoFocus?: boolean
}

export function Button({ children, onClick, variant = 'default', disabled, title, className = '', autoFocus }: BtnProps): ReactNode {
  const cls = variant === 'accent' ? 'btn btn-accent' : variant === 'ghost' ? 'btn btn-ghost' : 'btn'
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} autoFocus={autoFocus} className={`${cls} ${className}`}>
      {children}
    </button>
  )
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`switch ${checked ? 'switch-on' : ''}`}
    >
      <span className="switch-knob" />
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
  inline
}: {
  label: string
  hint?: string
  children: ReactNode
  inline?: boolean
}): ReactNode {
  return (
    <div className={inline ? 'flex items-center justify-between gap-4 py-2' : 'py-2'}>
      <div className={inline ? 'min-w-0' : 'mb-1.5'}>
        <div className="label">{label}</div>
        {hint ? <div className="faint mt-0.5 text-[11px] leading-relaxed">{hint}</div> : null}
      </div>
      <div className={inline ? 'shrink-0' : ''}>{children}</div>
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className = ''
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  className?: string
}): ReactNode {
  return (
    <select
      className={`input ${className}`}
      style={{ width: 'auto', minWidth: 120 }}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Badge({
  children,
  tone = 'default'
}: {
  children: ReactNode
  tone?: 'default' | 'accent' | 'ok' | 'warn' | 'bad'
}): ReactNode {
  const style: Record<string, string> = {
    default: '',
    accent: 'chip-accent',
    ok: '',
    warn: '',
    bad: ''
  }
  const color =
    tone === 'ok'
      ? { color: 'var(--ok)', borderColor: 'var(--ok)' }
      : tone === 'warn'
        ? { color: 'var(--warn)', borderColor: 'var(--warn)' }
        : tone === 'bad'
          ? { color: 'var(--bad)', borderColor: 'var(--bad)' }
          : undefined
  return (
    <span className={`chip ${style[tone] ?? ''}`} style={color}>
      {children}
    </span>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }): ReactNode {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-[15px]">{title}</div>
      {hint ? <div className="faint max-w-md text-[12px] leading-relaxed">{hint}</div> : null}
    </div>
  )
}

export function Modal({
  open,
  onOpenChange,
  title,
  children,
  footer,
  width = 680
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  children: ReactNode
  footer?: ReactNode
  /** 内容多的弹窗（工程详情）给更宽的框；默认 680。 */
  width?: number
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,.55)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4 shadow-panel"
          style={{
            width: `min(${width}px, 92vw)`,
            background: 'var(--panel)',
            borderColor: 'var(--line-2)'
          }}
        >
          <Dialog.Title className="mb-3 text-[14px] font-medium">{title}</Dialog.Title>
          <Dialog.Description asChild>{children}</Dialog.Description>
          {footer ? <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
