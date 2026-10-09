/** 用户可见的产品名。内部标识（appId / com.avca.bridge / .avca.json / %APPDATA%\A）一律不动，
 *  那是三份提示词里定死的契约，改了 Unity 桥接和侧车文件就对不上。 */
export const APP_DISPLAY_NAME = 'Atrium'
/**
 * 进度账本（**只是注释，不再上界面**）—— 交付到哪一步就更新这里。
 *
 * 现在是 **第 8 轮（发布收尾）**。往前数：R4 那七件（批量导入串行 + 进度队列 §8-4、改分类真搬文件、
 * 类别口语进检索、变体分列、跨工程反查、首次发现工程弹三按钮装桥接 R-10）全部落地，
 * 每件都有沙盒活体与图；证据逐条在 `tests/spec-coverage.spec.ts` 的 R4 一节与
 * `node tools/selfcheck-r4.cjs`。M7 首启向导四步 + 库根闸门 + 一屏批量装桥接 + Q10 +
 * `safeStorage` 密码保管也已经在**打包版**上真跑过（§6.2 六条四场 91 条判据 0 红，见 `docs/M7-DESIGN.md` §10）。
 * 还挂着的：M7 三件（首启 3 步向导 / `safeStorage` 密码保管 / 签名）、
 * F8 的 GUID 增量索引与 `bridgeVersion ≥ 1.1.0`（都要改 C# 桥接那一支）、LLM 兜底 §5.5。
 *
 * 真机待验清单见 `node tools/selfcheck-r4.cjs` 末尾 —— 按开发计划的轮数走进度：
 * **第 2 轮**打包版真跑过 R4 全链（①–⑦ 在 `dist\win-unpacked\Atrium.exe` 上重跑通过，产品缺陷 0 条），
 * 它翻出来的那条"口语存安装目录"在**第 3 轮**改掉、并在打包版上验过升级不丢；
 * 真 Unity 那三条欠账（§8-5 Play 排队、真 zip 成员导入、>8 成员多批）**第 4 轮清掉**，
 * 那一轮还顺手修了 busy 第一次退避取不到 1000ms 的下标 bug（见 §10 与 `docs/BRIDGE.md` §15）；
 * M6 那三条真机欠账（真 none /「以后都这样」第二次命中 / 托盘置顶 1.2 秒）**第 5 轮清掉**，
 * 并且置顶那一支是先抓到真缺陷才过的 —— `wakeForProject()` 的判据读在有副作用的
 * `createMainWindow()` 之后，`setAlwaysOnTop` 那段从来没执行过（见 `docs/VERIFY-UNVERIFIED.md` §11，
 * 顺序由 `tests/project/wake-order.spec.ts` 与回退验证器 L1 钉着）。
 */
/**
 * 这里原来放 `MILESTONE = 'R4'`，**第 8 轮删掉了**。两个理由：
 *  1. 「R4 / M7」是内部推进代号，出现在用户界面右上角只会让人以为是版本号的一部分；
 *  2. 更要紧的是"留着但没人读"—— 本仓库为死设置、死服务、死通道各吃过一次亏
 *     （`autoSwitchBehavior`、`bridgeAutoInstall`、六个没人广播的事件通道）。
 * 进度按上面那段账本与 README「当前进度」走，代码里不留只给角标用的常量。
 */

export const APP_ID = 'com.avca.a-manager'
/** 内部标识统一 avca：侧车文件与桥接包名不许改（改了第 3 份就合不起来） */
export const SIDECAR_FILENAME = '.avca.json'
export const THUMB_DIR_NAME = 'thumbs'
export const STAGING_DIR_NAME = 'staging'
export const BACKUP_DIR_NAME = 'backups'
export const EXTRACTED_DIR_NAME = '_extracted'
export const IMPORT_FOLDER_PREFIX = 'Assets/AVCA_Imports'

export const MINIMUM_WINDOW = { width: 1080, height: 680 }
export const MINI_DROP_SIZE = { width: 360, height: 160 }

/** 摄取防抖：文件落地后 3 秒才认为写入完成（第 1 份 F1） */
export const INGEST_DEBOUNCE_MS = 3000
/** 桥接心跳超时：10 秒没更新判定退出（第 3 份 §2.2） */
export const BRIDGE_STALE_MS = 10000
/** busy 退避序列（第 3 份 §2.5），最后一个值重复使用 */
export const BUSY_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000, 30000]
export const BUSY_MAX_RETRIES = 60
/** resolve_guids 单批上限（第 3 份 §3） */
export const GUID_BATCH_SIZE = 2000
/**
 * 同一工程 5 分钟内只自动切换一次（第 3 份 §4.3 防打扰，规格标了"硬性"，所以不给设置项）。
 *
 * ⚠ 这个时间戳（`project.last_auto_switch_at`，V6）**只在真的切换了之后**才写。
 * 按"每次检测都写"实现的后果：一次 skip 就把后面 5 分钟内的真实切换全吞掉 ——
 * 和 M5-A 那个 Tick 死锁是同一类错误（副作用改变了后续守卫的判断条件）。
 * 配套断言在 `tests/project/auto-switch.spec.ts`。
 */
export const AUTO_SWITCH_COOLDOWN_MS = 5 * 60 * 1000
/**
 * 工程运行状态的轮询间隔（第 3 份 §4.2）。
 *
 * 取 3 秒是**为了兜住"桥接心跳还没装上"的那段时间**：
 * 桥接心跳本身是事件驱动（2 秒一次，A 侧 chokidar 秒级感知），
 * 但用户可能还没装桥接 —— 那时只能靠 `UnityLockfile` 独占试开。
 * 3 秒一次足够在 §8-2 要求的"10 秒内标记退出"内反应过来
 * （心跳停在 T，最多再等 3 秒轮询 + 10 秒判陈旧，仍在可接受范围）。
 *
 * ⚠ WMI 那一路**不跟着这个间隔走** —— 它慢得多，规格 §4.2 明说 5 秒一次，
 * 由 `running.ts` 的 `wmiIntervalMs` 单独节流。
 */
export const PROJECT_POLL_MS = 3000

/**
 * **只剩 WMI 一路撑着"工程在运行"时，最多信它多久。**
 *
 * 桥接心跳与 `UnityLockfile` 是"这个工程正被人开着"的直接证据；WMI 只是
 * "有个 `Unity.exe` 的命令行里写着这个路径"，是间接证据，而且真机实测会**卡在一个
 * 已经消失的 pid 上**（2026-10-07：编辑器进程早没了、外部复算 `Get-CimInstance` 返回 0 行，
 * A 每 5 秒重查却仍报命中）—— 那 §8-2 的"关掉 Unity → 10 秒内标退出"就永远不成立。
 *
 * 但不能一上来就不信它：Unity 刚打开、锁文件还没建、桥接还没装的那段窗口里，
 * 只有 WMI 认得出这个工程。15 秒 = 5 轮 WMI 重查，够那段窗口启动，又不至于
 * 让"运行中"卡死到用户点导入等到超时。
 */
export const WMI_ONLY_GRACE_MS = 15_000

/**
 * M6 ⑥ · 托盘唤醒时置顶多久（§4.3「`setAlwaysOnTop(true)` 短暂闪烁」没给时长）。
 * 1.2 秒 = 够一次窗口动画，又不会变成"永远压在 Unity 上面"那种讨厌窗口。
 * 和 `ready-to-show` 的兜底用的是同一个数。**取消置顶必须走 finally**，抛错也要关。
 */
export const WAKE_TOPMOST_MS = 1200

export const DEFAULT_HOTKEY = 'CommandOrControl+Alt+A'
export const MAX_EXTRACT_DEPTH = 3
/** Windows 路径长度预算（第 1 份 F4 模板长度限制） */
export const MAX_TEMPLATE_LENGTH = 240
/** readme 语料截断 */
export const README_TEXT_LIMIT = 8 * 1024
/** unitypackage 单条目扫描 externalRefs 的上限 */
export const PACKAGE_ASSET_SCAN_LIMIT = 4 * 1024 * 1024
/** 备份保留最近 20 次导入 */
export const IMPORT_BACKUP_KEEP = 20
