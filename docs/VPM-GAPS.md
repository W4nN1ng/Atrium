# Atrium VPM · P8-D 缺口清单与 P9 只修范围

> 写于 **2026-10-23**。对账源：`docs/VPM-PARITY.md`（124 行，A–K 全组）。
> 这张表回答三件事：**哪些真的完成了、哪些只是代码完成、P9 只允许修什么**。
>
> 结论先行：**P8 对账完成，但 P8 门禁未签字。** 代码面基本齐了；主要缺口是
> 真 Unity 端到端、数据根落 C、模板编辑 UI，以及更新/安装器/VCC/版本矩阵的真机证据。

---

## 0. 统计与结论

| 指标 | 数量 |
|---|---|
| 对账行 | **124**（A23 + B29 + C15 + D10 + E9 + F8 + G9 + H5 + I10 + K6） |
| 实际=完整 | **60** |
| 实际=部分 | **57** |
| 实际=不做 | **7** |
| 目标=完整但实际=部分（P9 前必须补齐或产品明确接受） | **39** |
| 目标=部分且实际=部分（已接受差异，写进已知限制） | 15 |
| 目标=额外且实际=部分（Atrium 增强，不阻塞 ALCOM 对等） | 3（A17/B23/E7） |

**一句话**：不能把 P8-D 当成“全部做完了”。39 行“目标=完整、实际=部分”里，
21 行是同一个真 Unity 缺口（GAP-01，另覆盖 5 行目标=部分/额外的真机项），
6 行是 VCC 真机（GAP-07），2 行是数据根落 C（GAP-02），其余是模板 UI、更新/安装器、
回退演练、可访问性/性能、版本矩阵与 A18 产品裁定。

---

## 1. 缺口索引

| ID | 类别 | 覆盖行 | 结论 | 去向 |
|---|---|---|---|---|
| **GAP-01** | 真 Unity 2022.3.22f1 端到端 | A4 A11 A12 A17 A19 B4 B5 B6 B7 B8 B9 B18 B23 B27 C11 D5 D6 E7 E8 E9 I9 K1 K2 K3 K4 K5 | 代码/失败注入/恢复有强证据；装包、启动、双击导入、迁移、换版本、旧 Assets 没有真机终态 | P9-D + P4-E/P5-D/P5-E/P6-D review |
| **GAP-02** | 数据根/缓存落 C | G3 I6 | R19 把根固定到 `%APPDATA%\Atrium`，cache/vault/backups 都在 C；与原 P0 非 C 硬约束冲突 | 产品裁定；修或明确接受 R19 |
| **GAP-03** | 模板编辑 UI | A8 | 服务层完整，设置页没有模板新建/编辑/复制 UI | P8-E 或 P9 前补齐 |
| **GAP-04** | 更新检查/安装器真机 | G6 H5 | 只有假 HTTP 测试；GitHub 检查、下载、hash、`runInstaller` 未真跑 | P9-E |
| **GAP-05** | 回退演练 | G8 | 回退手册/开关/安全模式有；演练未做 | P9-D |
| **GAP-06** | 键盘/可访问性/真机 UI/性能 | E5 H4 I2 I10 | 放大镜/深链/焦点/ARIA/5000 包基准未系统验收 | P8-E + P9-C |
| **GAP-07** | VCC/ALCOM 真机只读 | A23 C12 F1 F2 F3 F4 | 测试全部用注入 source；真实 VCC 设置路径未跑 | P9-D 真机，或接受部分 |
| **GAP-08** | 版本/locked/Windows 矩阵 | B12 D10 H1 | 只有 Unity 2022.3.22f1 + Windows 11；真实 locked 对比未做 | P9-C/P9-D |
| **GAP-09** | 已接受差异 | A5 A6 A9 A13 A20 B24 B26 F5 F7 F8 G1 | 目标本来就是部分；写进 README/DEVELOPMENT 即可 | 文档收口 |
| **GAP-10** | 交付/流程 | — | 本分支无 upstream，P4-B…P8-C 没有 PR；`check-worker-deps` 误报已在 P8-D 修 | 推送/PR/发布前核对 |
| **GAP-11** | 文档缺口 | — | `docs/VPM-TASKS.md` 缺 P8-B 交接段 | 本卡补上 |

> A18（从列表移除、不删盘）是单独的产品裁定：当前 R17 明确“删除就是删除，进回收站”，
> 没有“只移除台账”入口。见 §4。

---

## 2. 详细缺口

### GAP-01 真 Unity 2022.3.22f1 端到端（最大缺口）

**覆盖行**：A4、A11、A12、A17、A19、B4–B9、B18、B23、B27、C11、D5、D6、E7、E8、E9、I9、K1–K5。

**已经有的证据**

- P4-B/P4-C/P4-D：事务顺序、manifest 最后写、24 个失败注入点、崩溃恢复、跨进程并发、
  真实仓库下载（`com.vrchat.base@3.7.0`，13.82 MiB，SHA-256 一致）、真实 zip 解压
  （936 条目 / 32.09 MiB / 519 个 `.meta`）、真实 EBUSY/EPERM、进程被杀后恢复；
  见 `docs/VPM-P4-VERIFICATION.md`。
- 包管理 UI/IPC：`tests/vpm/ipc/install.spec.ts`、`tests/vpm/renderer/cart.spec.ts`、
  `tests/vpm/domain/undo.spec.ts`；P4-E 代码完成。
- 启动/绑定：`tests/vpm/unity/launch.spec.ts`、`launch-target.spec.ts`、
  `tests/renderer/vpm-launch-target.spec.ts`；P5-E 验收脚本
  `docs/VERIFY-2026-10-22-VPM-MATERIAL-LINK.md`。
- 工程创建/附件/备份/迁移/换版本：P5-B/P5-C/P6-B/P6-C/P6-D 的单元与失败注入用例。

**缺什么**

1. 在 Unity 2022.3.22f1 沙盒里真的装/升/降/重装/卸一个真实包，确认 Unity 打开无错、
   `Packages/` 与 `vpm-manifest.json` 正确。
2. 确认 Unity 打开工程时**忽略** `.atrium-tx`；如果会干扰，换同卷隐藏目录并记录。
3. 旧 Assets 清理后没有丢引用；日志/回滚仓/vault 内容可人工恢复。
4. 真机撤销、从备份新建、旧式迁移、换版本。
5. 真机启动绑定 → 双击素材导入到刚启动工程；多实例优先级；启动中/连接中等待。
6. 真机创建工程（空白 + 模板 + unitypackage 附件）后 Unity 能打开。

**去向**：P9-D 真机回归；P4-E / P5-D / P5-E / P6-D 保持 **review**，不能提前标 done。
步骤已在 `docs/VPM-P4-VERIFICATION.md` §10.1 和
`docs/VERIFY-2026-10-22-VPM-MATERIAL-LINK.md`，不需要重新设计。

---

### GAP-02 数据根/缓存落 C（产品硬约束冲突）

**覆盖行**：G3、I6。

**事实**

- `src/main/vpm/gate.ts` 的 `defaultVpmDataRoot()` 返回 `%APPDATA%\Atrium`；
  `ensureAutoEnabled()` 首次启动自动启用，`enableVpm({ systemDefault: true })`
  跳过“非系统盘”校验。
- `VpmCacheStore`、`VpmRuntime` 的 cache/vault/backups/templates 都从 dataRoot 派生，
  所以包缓存、回滚仓、备份实际在 C 盘。
- 原 P0 规则和对账表 I6/G3 写的是“缓存不落 C”“无 C 回退”。P4-VERIFICATION 的
  `statfsSync`/缓存验证当时用的是非 C 沙盒，不能证明现在的 C 根。

**两个选项（需要产品裁定）**

- **A. 接受 R19**：明确“数据库/索引/密钥在 `%APPDATA%\Atrium`，缓存/回滚仓/备份也在 C”，
  把 I6/G3 目标改成部分，写进 README/DEVELOPMENT，并在设置里显示用量/清理。
  这是最省事、与当前自动启用一致的方案，但违背早期“缓存不落 C”的用户硬约束。
- **B. 恢复非 C 重数据**：DB/settings 留 `%APPDATA%\Atrium`，cache/vault/backups
  移到用户选定的非 C 数据根（或 `%LOCALAPPDATA%` 以外的盘）。需要新数据根契约、
  迁移/回退和空间校验，属于 P9-A/P9-B 级别的改动。

**建议**：先由用户裁定 A/B；如果选 B，P9 前不要扩大写盘面。P8-D 不擅自改数据根。

---

### GAP-03 模板编辑 UI（A8）

**事实**：`TemplateService` 的 create/update/duplicate/removeReference/restore 都有测试
（`tests/vpm/templates/service.spec.ts`），但设置页只有模板列表/收藏/最近使用；
P8-A 审计 §5 明确“模板编辑 UI 仍缺，属新功能”。

**去向**：P8-F（已建卡，`docs/prompts/tasks/P8-F.md`）：补轻量模板编辑面板
（新建/编辑/复制/删除引用）。如果产品决定不做，必须把 A8 目标从“完整”改成“部分”，
写进已知限制；不能继续写完整。

---

### GAP-04 更新检查/安装器真机（G6/H5）

**事实**

- `updater.ts` + `tests/vpm/updater.spec.ts`(19) 覆盖版本比较、资产选择、正文 hash
  解析、hash 不匹配、错误映射；但 GitHub 真实请求没有跑（本机网络策略/代理），
  `runInstaller` 只做路径白名单，没有真跑 `.exe`。
- H5 安装/卸载/静默升级属于 P9-E，尚未执行。

**去向**：P9-E 在 release 前真跑：GitHub Release 检查、下载、SHA-256、安装器可见 UI、
退出 Atrium 后重启核对版本、卸载不删用户库。G6 目标本来就是部分（手动检查），
但“手动检查”本身仍需真机证据。

---

### GAP-05 回退演练（G8）

**事实**：`docs/VPM-ROLLBACK.md` 有开关/安全模式/回退手册；P9-D 的演练（禁用、
删除数据根、恢复快照、旧 DB 回退）未做。P8-D 不执行破坏性演练。

**去向**：P9-D 按手册逐项演练并记录截图/日志；演练前备份。

---

### GAP-06 键盘/可访问性/真机 UI/性能（I2/I10 + E5/H4）

**事实**

- P8-A 只做了离屏截图（`docs/screenshots/vpm-p8-*`）和组件边界测试；100%/125% 真窗口、
  Tab/Enter/Esc/方向键、焦点陷阱、ARIA/live region 没有系统验收。
- E5“打开备份位置”未在 Electron 真机点开；H4 单实例/深链未装包真点。
- I10：`tests/perf/scale.spec.ts` 只覆盖素材库 5 万条；VPM 目录 5000 包/解析 200 包
  的基准未做。

**去向**：P8-E 键盘/可访问性/截图；P9-C 性能基准。E5/H4 的真机点击并入 P9-D。

---

### GAP-07 VCC/ALCOM 真机只读（A23/C12/F1–F4）

**事实**：所有 VCC 读取测试都用注入的 `VccProjectSource` 或 fake settings；
真实 VCC/ALCOM 安装目录下的 `settings.json` 没有跑过。代码只读、不写回，已有测试
证明不会写 VCC。

**去向**：P9-D 在一台装了 VCC 的机器上真读一次（工程/仓库/用户包目录/Unity 偏好），
或产品接受“只保证注入契约、真实 VCC 未验”的部分状态。

---

### GAP-08 版本/locked/Windows 矩阵（B12/D10/H1）

**事实**：真实环境只覆盖 Unity 2022.3.22f1 + Windows 11；P3-B 的真实 locked 快照对比
未做；其他 Unity 版本（2019/2021/6000）只有解析逻辑，没有真机。H1 目标完整但 Win10
未实机。

**去向**：P9-C 版本矩阵/长路径/性能；P9-D 真机回归。B12 需要至少一个真实工程的
locked 快照长期对比。

---

### GAP-09 已接受差异（写进 README/DEVELOPMENT 即可）

| 行 | 差异 |
|---|---|
| A5/A6 | 模板不含 VRChat 推荐工程设置/场景，只有骨架 + SDK 依赖 |
| A9 | 只导入模板文件，不注册 `.alcomtemplate` 全局关联 |
| A13 | Unity 已运行时不把窗口顶到前台（只保证不重复启动并绑定目标） |
| A20 | 只做搜索/列表，不做完整网格视图 |
| B24 | 包图标只有首字母回退，无远程图标管线 |
| B26 | Unity 运行中刻意拒绝装包（比 ALCOM 保守） |
| F5 | 不读 VCC LiteDB 模板；只读 settings.json |
| F7 | `vcc://` 只在用户显式接管时解析/确认，不默认抢协议 |
| F8 | 不注册 `.alcomtemplate` 全局文件关联 |
| G1 | 三语/主题沿用；没有 ALCOM 全语言列表/紧凑模式 |

---

## 3. P9 只修清单（按顺序）

1. **GAP-02 产品裁定**：A 接受 C 根并改目标，或 B 把 cache/vault/backups 移出 C。
   这是唯一会改变数据布局的决策，必须最先定。
2. **GAP-01 真 Unity 2022.3.22f1 E2E**（P9-D）：装/升/降/重装/卸/撤销、启动、双击导入、
   多实例、创建、附件、备份恢复、迁移、换版本；记录截图/日志/Unity Console。
3. **GAP-04 更新/安装器**（P9-E）：GitHub 检查、下载、hash、安装器、重启版本核对。
4. **GAP-05 回退演练**（P9-D）：禁用/删根/快照恢复/旧 DB 回退。
5. **GAP-03 模板编辑 UI**（P8-F）：实现，或把 A8 目标降为部分并写已知限制。
6. **GAP-06 键盘/可访问性/性能**（P8-E/P9-C）：100%/125% 真窗口、Tab/Esc/Enter、
   ARIA、5000 包目录/200 包解析基准。
7. **GAP-07 VCC 真机只读**（P9-D）：真实 VCC/ALCOM 设置路径。
8. **GAP-08 版本矩阵**（P9-C/D）：locked 对比、Win10、其他 Unity 版本。
9. **GAP-09 文档收口**：把已接受差异写进 README/DEVELOPMENT；同步 A18 产品裁定。
10. **GAP-10 交付**：推送当前分支/建 PR（P4-B…P8-C 尚未上远端）；P9-E 前确认
    `npm run build` 四段都过。

---

## 4. 需要产品裁定的两条

1. **A18**：当前 R17 的 UX 是“删除项目 = 整个文件夹进回收站”，没有“只从列表移除、
   不删盘”的入口。对账目标仍写“完整”。建议二选一：
   - 接受 R17：把 A18 目标改成“部分”，在 README 写“删除即进回收站，没有只移除台账”；
   - 补一个“仅移除列表”次级动作（不删盘），保留 A18 完整。
2. **GAP-02**：接受 C 根（改 I6/G3 目标）或恢复非 C 重数据（新数据根/迁移）。

这两条不是 P8-D 能替用户决定的；P9 开工前需要一句明确裁定。

---

## 5. 流程与交付缺口（GAP-10/11）

- **分支/PR**：当前 `codex/vpm-p4d-failure-recovery` 没有 upstream，`origin/main`
  还停在 P4-A 的 `e8c3dcb`；P4-B…P8-C 全部只在本地。P9 发布前必须推送并走 PR/合并。
- **P8-C 交接文档**：`docs/VPM-P8C-HANDOVER.md` 写“P8-C 未提交、HEAD 689d8e2”，
  实际已提交 `709a990`；接手时以 git 和本文件为准。
- **P8-B 交接**：`docs/VPM-TASKS.md` 缺 P8-B 段；本卡补一条，证据来自
  `src/main/vpm/log/` 与 `tests/vpm/log/diagnostics.spec.ts`。
- **构建闸门**：`tools/check-worker-deps.cjs` 原来把主进程专用的 VPM 动态 chunk
  当成 worker chunk，误报 `yazl`/`electron-log`；P8-D 已改成只检查 worker 可达图，
  修复后 `node tools/check-worker-deps.cjs` 通过。完整 `npm run build` 仍需重跑。

---

## 6. 签字结论

- **P8-D 对账本身：完成**（124 行全部有实际状态/证据/差异/去向；无空白/待定）。
- **P8 门禁：未签字**。39 行目标=完整但实际=部分；其中 21 行是 GAP-01 真 Unity，
  不能靠单元测试冒充。
- **P9 范围：本文件 §3**。P9 只修这些缺口，不再扩大功能面；已接受差异走
  GAP-09 文档收口。
- **下一步**：先处理 §4 的两条产品裁定，再开 P9-D 真 Unity；P9-E 发布前推送/PR
  并跑完整 `npm run build`。
