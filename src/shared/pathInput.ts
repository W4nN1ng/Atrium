/** Enter confirms an IME candidate while composing; it must not commit or blur the path editor. */
export function shouldCommitPath(event: { key: string; isComposing?: boolean; keyCode?: number }, composing = false): boolean {
  return event.key === 'Enter' && !composing && !event.isComposing && event.keyCode !== 229
}
