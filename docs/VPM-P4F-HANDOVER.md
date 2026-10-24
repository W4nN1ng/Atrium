# P4-F 交接文档（工程活动闸门与素材/包冲突防护）

> 写于 **2026-10-22 17:40**。读者：P5-A / P6-D 的接手人。
>
> 状态：**完成**。唯一没做的是"真 Unity 并发"（需要开 Unity，本工作站不启动 GUI）。

---

## 0. 一页结论

| 项 | 状态 |
|---|---|
| 活动闸门状态机（租约 / 导入计数 / Unity 运行） | ✅ |
| 包事务接闸门（拿不到租约不写盘） | ✅ |
| 素材写入上报 importing（导入 / 撤销 / 成员导入） | ✅ |
| 旧 Assets 保护（`import_log` guid） | ✅ |
| 受保护包机械规则（`com.avca.bridge`） | ✅ |
| typecheck / 定向测试 | ✅ 20 条新用例 |
| 真 Unity 并发（导入中装包 / 装包中导入） | ❌ 需要 GUI，见 §6 |

---

## 1. 契约变化（重要）

| 变化 | 说明 |
|---|---|
| 端口迁到 `shared/vpm/linkage.ts` | `MaintenanceKind` / `ProjectActivitySnapshot` / `MaintenanceLease` / `ProjectActivityPort` / `LegacyGuardPort`。`install` 仍 re-export，老 import 不用改。 |
| `acquireMaintenance` 变成**必需** | 之前 `ProjectActivityPort` 只有 `state()`；现在事务会调用 `acquireMaintenance()`，缺了会编译不过。 |
| `LegacyGuardPort.isProtected` 多一个参数 | 现在是 `(projectPath, relativePath)`；旧实现只接收相对路径，**参数位置变了**，外部实现必须同步改。 |
| `LegacyGuardPort.prime?()` | 清理开始前刷新缓存（可选）。 |
| `setImportActivityHook()` | `import/coordinator.ts` 新增；组合根注入，测试可传 `null` 复位。 |

错误码没有新增：`vpmProjectBusy`（已有租约）/ `vpmProjectImporting`（导入中）/
`vpmUnityRunning`（Unity 在跑），参数里带 `kind`。

---

## 2. 闸门怎么工作

```text
素材写入（导入/撤销/成员导入）
  coordinator.importUnitypackage()
    beginImport(path)  → 计数 +1
    …原有逻辑完全不动…
    finally: release() → 计数 -1（幂等，嵌套安全）

维护写（装包/备份/复制/迁移/换版本/建工程）
  acquireMaintenance(path, kind)
    已有租约      → vpmProjectBusy
    导入计数 > 0  → vpmProjectImporting
    Unity 在跑    → vpmUnityRunning
    finally: release()（只删自己那一个）
```

包事务的接入点：**预检通过之后、写盘之前**。这样预检能给出更具体的原因
（`vpmUnityRunning` 等），而租约负责堵住"预检通过到 move-out 之间"插进来的导入。

`state()` 里的 `unityRunning` 每次都问桥接心跳（`bridge.statusOf(path).running`），
不缓存；探针自己抛错时按"可能在跑"处理（fail closed）。

---

## 3. 旧 Assets 保护（机械规则）

```text
Assets/OldThing/model.prefab
  → 读 Assets/OldThing/model.prefab.meta 的 guid
  → 在 import_log（该项目）的 created_guids_json / overwritten_json 里出现过？
     是 → 保护（整目录也会因为"目录里有受保护文件"而跳过）
     否 → 按包声明的 legacyFolders/legacyFiles 正常清理
```

- 没有 `.meta` 的文件不保护：P4-C 只清"包自己声明的路径"，包自带资源本来就不会被误伤。
- 缓存按工程路径存，`cleanupLegacyAssets` 开始前 `prime()` 刷新一次；
  事务期间拿着维护租约，`import_log` 不会变，所以缓存是安全的。
- `com.avca.bridge` 的 legacy 声明即使出现在移除集合里也一律跳过（`protectedPackage`），
  这是"桥接包不可删"的第二道机械保险（第一道在解析器的 protected 集合）。

---

## 4. 改动的文件

| 文件 | 变化 |
|---|---|
| `src/main/project/activity.ts` | **新增**：`ProjectActivityRegistry`、`createProjectActivityPort`、`createLegacyGuard`、`normalizeProjectPath` |
| `src/shared/vpm/linkage.ts` | 新增五个活动/保护类型 |
| `src/main/import/coordinator.ts` | `setImportActivityHook` + 两个包装函数（原实现改名 `*Inner`） |
| `src/main/vpm/install/transaction.ts` | 预检通过后申请租约、`finally` 释放；端口类型改从 shared 导入 |
| `src/main/vpm/install/legacy.ts` | `isProtected(projectPath, relative)`；`prime()`；`protectedPackage` 跳过 |
| `src/main/vpm/gate.ts` | `VpmGateDeps` 新增 `projectActivity` / `legacyGuard`，透传给 `initVpm` |
| `src/main/index.ts` | 建注册表（`isUnityRunning` 读桥接心跳）、注入导入钩子、传给 gate |
| `docs/VPM-ARCHITECTURE.md` | §7.3.1 记录实现与"用路径不用 projectId"的取舍 |
| `tests/project/activity.spec.ts` | **新增** 14 条 |
| `tests/vpm/install/activity-gate.spec.ts` | **新增** 6 条 |

---

## 5. 证据

```
npm run typecheck                          → exit 0
npx vitest run tests/project/activity.spec.ts        → 14 passed
npx vitest run tests/vpm/install/activity-gate.spec.ts → 6 passed
```

覆盖点：

- 状态机：获取 / 二次获取被拒 / 幂等释放 / 异常路径释放 / 导入计数与嵌套 /
  Unity 运行 / 探针抛错 fail closed / 不同工程互不影响 / `clear()`。
- 集成：导入中装包被拒且**不写盘**、他人持租约时 `vpmProjectBusy`、成功后租约释放、
  中途失败（注入 `move-in:item:after`）后租约释放且工程回滚、两个工程并行、
  预检失败不残留租约。
- 保护：`import_log` created/overwritten 的 guid 命中即保护、无 `.meta` 不保护、
  `prime()` 刷新缓存、路径逃逸 fail closed。
- 导入钩子：真实 `importUnitypackage` 期间 `importing=true`、结束后释放；
  包读不出来也释放；`rollbackImport` 同样上报。

---

## 6. 未验证

1. **真 Unity 并发**：导入进行中点"应用变更"、装包过程中双击素材导入 —— 没有真机证据。
   代码路径与错误码都对，但"用户真的会看到什么"没看过。
2. **P6 的维护动作还没接**：备份/复制/迁移/换版本目前**没有**调用 `acquireMaintenance`，
   这是 P6-D 的活。它们现在不会抢租约，也不会被闸门挡住。
3. **跨进程**：两个 Atrium 实例同时操作同一工程不在覆盖范围（单实例假设）。
4. **长事务持锁体验**：大包安装期间持租约，用户此时导入会被拒——UI 提示语是否够清楚没验证过。

---

## 7. 给下一个任务

### P6-D（备份/迁移）

```ts
const lease = activity.acquireMaintenance(projectPath, 'backup')  // 或 'copy' | 'migrate'
try {
  // 只读复制/打包；备份也要在 importing=true 时拒绝
} finally {
  lease.release()
}
```

- 备份/复制/迁移**不需要** Unity 关闭（只读），但 `acquireMaintenance` 会检查 `unityRunning`。
  如果某个动作允许 Unity 运行，就别用 `acquireMaintenance` 的这一路，改成
  `state()` + 自定义规则；**换版本/迁移**必须 Unity 关闭，直接用租约即可。
- 复制工程到新路径时，租约只针对**源工程**；目标路径是新工程，没有并发者。

### P5-A（模板）

与闸门无关，但建工程（P5-B）如果要写进已存在的工程，也要拿 `create-project` 租约。

---

## 8. 环境与坑

| 坑 | 说明 |
|---|---|
| `better-sqlite3` ABI | 构建过 Electron 后跑测试要先 `npm run native:node` |
| 全量测试约 3.3 分钟 | `tests/perf/scale.spec.ts` 占 160s |
| 闸门身份是路径 | 传 `C:\Demo\` 和 `c:/demo` 是同一个工程；不要拿 `project.id` 去调 |
| 导入钩子是模块级单例 | 测试里 `setImportActivityHook(null)` 复位，避免串味 |
