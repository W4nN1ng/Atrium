# P6-B 交接文档（ZIP 备份、记录与从备份新建）

> 写于 **2026-10-22 19:45**。读者：P6-C（复制/换版本）与 P6-D（UI）的接手人。
>
> 状态：**完成**。

---

## 0. 一页结论

| 项 | 状态 |
|---|---|
| ZIP 写入（store/fast/normal 真三档）+ `.part` 原子写 | ✅ |
| 进度 / 取消（取消不留 `.part`） | ✅ |
| 写后 sha256 + yauzl 读回校验 | ✅ |
| 备份记录（vpm.db v5 `vpm_backup`） | ✅ |
| 从备份新建（目标不存在、路径安全、可选补装） | ✅ |
| 打开备份位置（`shell.showItemInFolder`） | ✅（未在 Electron 里点过） |
| typecheck / 定向测试 | ✅ 10 条新用例 |
| 标准解压工具验证 / GB 级真机 | ❌ 见 §4 |

---

## 1. 契约

```ts
await runtime.backup.create({ projectKey, compression?, excludeVpmPackages?, signal?,
                              onProgress?, allowUnityRunning?, targetPath? })
runtime.backup.list(projectKey?, limit?)
runtime.backup.get(id)
runtime.backup.reveal(id)
await runtime.backup.restore({ backupId, targetDir, installPackages?, signal? })
```

新依赖：`yazl`（+ `@types/yazl`）。选它是因为支持 `compressionLevel`——三档才是真的；
`store` = 不压缩、`fast` = zlib 1、`normal` = zlib 6。

新错误码：`vpmBackupCancelled` / `Failed` / `Invalid` / `Unsafe` / `TooLarge` / `Conflict`（三语）。

DB：**vpm.db v5**，`vpm_backup`（状态 `running/ok/failed/cancelled` + `error_code`）。

---

## 2. 备份流程

```text
projects.get(projectKey)
  ↓ Unity 运行中 && !allowUnityRunning → vpmUnityRunning
  ↓ activity.acquireMaintenance(path, 'backup')   ← P4-F：导入/装包中直接拒绝
  ↓ collectProjectFiles（P6-A）
  ↓ writeZip → <target>.part → rename
  ↓ hashFile(sha256) + readZipEntries（读不了算失败）
  ↓ vpm_backup 写 ok
失败/取消：删 .part，记录 failed/cancelled + error_code
finally：释放租约
```

默认目标：`<dataRoot>/backups/<projectSlug>/<工程名>-<yyyyMMdd-HHmmss>.zip`，冲突加 `-2`。

---

## 3. 从备份新建

- 目标目录**必须不存在**（`vpmBackupConflict`）——空目录也算存在。
- `extractZip` 拒绝：绝对路径、盘符、`..`、反斜杠、控制字符、≥260、符号链接条目、超字节上限。
- 解压后 `projects.addExisting(target)` 入列表；`installPackages` 时调用注入的 `installer`
  （组合根里用 `plans.resolve` + `transactions.apply` 补装）。

---

## 4. 未验证

1. **标准工具解压**：zip 只用 `yauzl` 读回过，**没有用 7-Zip/资源管理器真的解过**。
   这是本卡最该补的一条（人工 1 分钟）。
2. **大工程**：没有 GB 级真机备份；`.part` → rename 在跨卷时的行为没测（默认同卷）。
3. **`reveal`**：`shell.showItemInFolder` 在 Electron 里没点过（只做了注入与失败返回 false）。
4. **从备份新建 + 补装依赖**：`installer` 回调只用假实现测过，没有真机跑。
5. **空间不足**：没有模拟磁盘满（`ENOSPC`）——失败路径会删 `.part` 并记 failed，但没有实测。

---

## 5. 给 P6-C（复制 / 换版本）

- 复制可以直接复用 `collectProjectFiles` + `fsUtil.copyTreeWithDigest`（别自己再写遍历）。
- **换版本前先 `backup.create`**：P6-D 的 UI 会要求"先备份再改版本"，服务层已经能一条命令搞定。
- 复制/换版本都要拿维护租约（`kind='copy' | 'unity-version'`），和备份一样在 `finally` 释放。
- 复制到新目录时，目标必须不存在（和 `restore` 同一套规则）。

## 6. 给 P6-D（UI）

- 备份列表直接读 `runtime.backup.list(projectKey)`；`status !== 'ok'` 的行不要显示成"可用备份"。
- "打开位置"用 `runtime.backup.reveal(id)`；返回 `false` 说明系统调用失败，给提示而不是静默。
- 取消备份：传 `AbortSignal`；取消后记录是 `cancelled`，UI 要能区分"取消"和"失败"。

---

## 7. 环境与坑

| 坑 | 说明 |
|---|---|
| `yazl` 的 `outputStream` 类型 | `@types/yazl` 写成 `ReadableStream`，运行时是 Node Readable；`destroy` 要断言 |
| 小文件压缩反而变大 | 测"真压缩"必须用可压缩的大段内容（20KB 重复文本），否则 store 可能更小 |
| `better-sqlite3` ABI | 构建过 Electron 后跑测试要先 `npm run native:node` |
| db 版本 | 现在是 **v5**；迁移测试里"更新版本"的合成库用 6 |
