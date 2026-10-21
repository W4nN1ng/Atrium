# src/main/vpm/db

## 职责

VPM 独立库 `vpm.db` 的连接、版本检查、只前进迁移和迁移前备份/校验。
它只拥有库文件，不理解仓库/包的业务含义。

## 不负责什么

- 不写仓库/包业务 SQL（在 `repos/`）。
- 不发网络、不解析仓库 JSON、不接触 Unity 工程或渲染层。
- 不读写核心 `library.db`。

## 公开 API

只从 `index.ts` 导出：

- `openVpmDb(options?): Promise<VpmDb>`：建目录/打开/设 pragma/版本检查/备份/迁移/完整性检查。
- `closeVpmDb(db)`：checkpoint + 关闭，吞掉关闭期异常。
- `VpmDb`：句柄类型。
- `VPM_SCHEMA_VERSION`：当前支持的最高版本。

测试可直接 import `migrations.ts` 的 `VPM_MIGRATIONS` 来构造“下一版”场景；业务代码不要依赖迁移表。

## 数据 / 写入

- 库文件：`P.vpmDb()` → `%APPDATA%\A\vpm\vpm.db`。
- 备份：`P.vpmBackups()` → `%APPDATA%\A\vpm\backups\vpm.db.bak-v<from>-<ts>`。
- 连接：WAL、`foreign_keys=ON`、`busy_timeout=5000`、`synchronous=NORMAL`。
- 迁移前若 `user_version > 0` 且要升级：
  1. `quick_check` 源库；
  2. `db.backup()` 到备份目录；
  3. 只读打开备份，校验 `integrity_check` 与 `user_version`；
  4. 任一步失败 → `vpmDbBackupFailed`，不迁移。
- 每个版本在事务里 `exec(sql)` + `user_version = version`；失败回滚该版本。

## 失败模式

- 文件不是数据库/无法打开 → `vpmDbOpenFailed`。
- `user_version > 支持版本` → `vpmDbVersionTooNew`；**不降级、不重建**。
- `user_version=0` 但已有 VPM 表 → `vpmDbOpenFailed`（来源不明，不覆盖）。
- 迁移失败 → `vpmDbMigrationFailed`；该版本事务回滚，旧版本保留。
- 备份失败/备份校验失败 → `vpmDbBackupFailed`。
- 完整性/必需表缺失 → `vpmDbIntegrityFailed`。

核心 `library.db` 的 `user_version` 始终是 11，VPM 不碰它。

## 测试入口

- `tests/vpm/db/migrate.spec.ts`
- 运行：`npm test`（会先切 Node ABI）

## 谁依赖我 / 我依赖谁

- 被 `repos/`、P1-D 组合根使用；不被 IPC/渲染层直接引用。
- 依赖：`better-sqlite3`、`P`（paths）、`VpmError`。
- 不被 `src/main/index.ts` 静态 import；只通过门面动态加载。
