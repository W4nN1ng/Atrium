# VERIFY · 2026-10-22 · 启动即绑定目标与双击素材

> 对应任务：**P5-E**（启动即绑定目标与双击素材真机验收）
>
> **状态：未执行。** 本工作站不启动 Unity（用户要求开发期间不弹窗），
> 下面是可以直接照着跑的验收脚本。跑完把结果填进「结果」列、截图放 `docs/verify/`。

---

## 1. 环境

```powershell
$env:AVCA_APP_HOME = 'E:\avca-sandbox\app'
$env:AVCA_REQUIRE_SANDBOX_HOME = '1'
cd C:\程序\A素材管家
npm run dev          # 或安装版
```

- Unity：**2022.3.22f1**（唯一验证过的版本）
- 数据根：**非 C 盘**（例如 `E:\avca-sandbox\data`）
- 素材库：沙盒库，不要用真实库
- 工程：`E:\avca-sandbox\projects\A`（已存在）、`E:\avca-sandbox\projects\B`（用"新建工程"建）

---

## 2. 单工程链路

| # | 操作 | 期望 | 结果 |
|---|---|---|---|
| 1 | 工程页新建 `B`（空白模板），在详情点"打开 Unity" | Unity 启动并打开 `B`；工程行出现"启动中/连接中"徽标 | ☐ |
| 2 | 等 Unity 连上 | 徽标变成"当前导入目标"（不跳变、不闪回） | ☐ |
| 3 | 双击素材（`A` 已关闭） | **不弹目标选择器**，直接导入 `B`；`B/Assets/` 出现资源 | ☐ |
| 4 | 看 `import_log` | 记录 `project_id` 是 `B` | ☐ |
| 5 | 关闭 Unity（B） | 徽标消失；再双击素材 → 弹目标选择器（因为已无目标） | ☐ |

证据：截图 1（启动中徽标）、截图 2（目标徽标）、`B/Assets` 目录、`import_log` 片段。

---

## 3. 多实例优先级

前提：A、B 都能打开；Atrium 里两个工程都在列表。

| # | 操作 | 期望 | 结果 |
|---|---|---|---|
| 6 | 手动开 A（Hub 或双击 `.unity`），再从 Atrium 启动 B | 目标是 **B**（启动绑定优先于单工程自动） | ☐ |
| 7 | 双击素材 | 导入 **B**；`A/Assets` 无新增文件 | ☐ |
| 8 | 在工程页对 A 点"设为导入目标" | 目标立即切到 A（显式选择覆盖启动绑定），徽标跟随 | ☐ |
| 9 | 再双击素材 | 导入 **A** | ☐ |
| 10 | 关闭 B | 目标仍是 A；B 的徽标消失，不留陈旧可点击目标 | ☐ |

证据：两张 `Assets` 目录对比、两次 `import_log` 片段。

---

## 4. 失败路径

| # | 操作 | 期望 | 结果 |
|---|---|---|---|
| 11 | 把工程的 `ProjectVersion.txt` 改成未安装的版本，点"打开 Unity" | 报"找不到编辑器"，**不换版本**、不启动 | ☐ |
| 12 | 临时把编辑器 exe 改名后再启动 | 报 `vpmUnityLaunchFailed`；徽标**不停在**这个工程上 | ☐ |
| 13 | Unity 启动中（还没连上）双击素材 | 等待并显示"启动中"，就绪后导入；不弹选择器 | ☐ |
| 14 | 导入进行中，在 VPM 里点"应用变更" | 被拒（`vpmProjectImporting`），不写包 | ☐ |

---

## 5. 回归

- [ ] 冲突确认（覆盖已有资源）仍按原流程走
- [ ] 撤销上一次导入仍只删本次新建的 GUID
- [ ] 包事务（装/卸）仍正常
- [ ] `npm run typecheck` exit 0；`npx vitest run` 全绿（除已知 perf flaky）

---

## 6. 代码侧已经保证的部分（不需要真机就能确认）

| 不变量 | 证据 |
|---|---|
| 先 `bindLaunchTarget` 再 `spawn` | `tests/vpm/unity/launch.spec.ts`（顺序断言）+ `launch-target.spec.ts` |
| spawn 失败/异步 error 清绑定 | `launch.spec.ts` + `launch-target.spec.ts` |
| 已运行不重复启动但仍绑定 | 两个 spec 各一条 |
| 没有 coreId 时不假装绑定 | `launch-target.spec.ts` |
| 徽标三态（非目标 / 启动中 / 目标） | `tests/renderer/vpm-launch-target.spec.ts` |
| 目标优先级由核心连接层固定 | `src/main/project/connections.ts` 的 `manualId ?? launchId` |
| 工程消失/关闭后清除绑定 | `connections.pruneLaunchBinding()` |

---

## 7. 已知未验证

- 真 Unity 下"启动中双击素材会等 180s"的实际体验（超时/取消按钮文案）。
- 多实例真机下的目标抢占细节（P5-E 只做了代码路径与单元测试）。
- 其他 Unity 版本（2021.3 / 2023.x）——刻意不支持，不在本卡范围。
