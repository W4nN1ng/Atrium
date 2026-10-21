import type Database from 'better-sqlite3'

/** VPM 独立库的句柄；不要把它暴露给 IPC/渲染层。 */
export type VpmDb = Database.Database
