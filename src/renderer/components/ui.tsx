import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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

export interface MenuItemSpec {
  key: string
  label: string
  onSelect: () => void
  danger?: boolean
}

/**
 * 行内 `⋯` 菜单。
 *
 * **必须用 portal 渲染到 body**：列表容器是 `overflow-y-auto`，绝对定位的菜单会被
 * 裁在框里（用户实测：菜单在项目框里滚动）。portal + fixed 定位不受任何祖先裁剪影响。
 */
export function MenuButton({
  items,
  label = '⋯',
  title,
  className = ''
}: {
  items: MenuItemSpec[]
  label?: ReactNode
  title?: string
  className?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const anchor = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    const onDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-menu-panel]')) return
      if (anchor.current && target && anchor.current.contains(target)) return
      close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  const toggle = (): void => {
    const rect = anchor.current?.getBoundingClientRect()
    if (rect) {
      const width = 184
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      const top =
        rect.bottom + 4 + 8 * items.length > window.innerHeight
          ? Math.max(8, rect.top - 8 * items.length - 12)
          : rect.bottom + 4
      setPos({ top, left })
    }
    setOpen((current) => !current)
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`btn btn-ghost ${className}`}
        title={title}
        onClick={toggle}
      >
        {label}
      </button>
      {open
        ? createPortal(
            <div
              data-menu-panel
              className="fixed z-[60] rounded-md border p-1 shadow-panel"
              style={{
                top: pos.top,
                left: pos.left,
                width: 184,
                background: 'var(--panel)',
                borderColor: 'var(--line-2)'
              }}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="block w-full rounded px-2 py-1.5 text-left text-[12px] hover:bg-[color:var(--raise)]"
                  style={item.danger ? { color: 'var(--bad)' } : undefined}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
