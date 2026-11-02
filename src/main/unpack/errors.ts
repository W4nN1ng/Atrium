export class PasswordNeededError extends Error {
  readonly code = 'ingest.passwordNeeded'
  constructor(public archivePath: string) {
    super(`压缩包需要密码：${archivePath}`)
    this.name = 'PasswordNeededError'
  }
}

export class CorruptArchiveError extends Error {
  readonly code = 'ingest.corruptArchive'
  constructor(public archivePath: string, detail: string) {
    super(`压缩包损坏或格式不支持：${archivePath} —— ${detail}`)
    this.name = 'CorruptArchiveError'
  }
}
