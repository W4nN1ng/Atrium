export type ConnectionPhase = 'closed' | 'disabled' | 'unsupported' | 'installing' | 'connecting' | 'ready' | 'failed'

export interface ProjectConnection {
  projectId: string
  projectPath: string
  name: string
  phase: ConnectionPhase
  reasonKey: string | null
  detail: string | null
}

export interface UnityConnectionSnapshot {
  projects: ProjectConnection[]
  targetProjectId: string | null
  targetMode: 'auto' | 'manual' | 'launch'
  /** launch 绑定后、Unity 还没真正启动/连接时为 true；界面可显示“正在启动”。 */
  targetPending?: boolean
  ambiguous: boolean
}

export type UnityTargetResolution =
  | { kind: 'selected'; projectId: string; projectName: string }
  | { kind: 'choose'; projectIds: string[] }
  | { kind: 'none' }
