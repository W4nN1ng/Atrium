import type { AppSettings } from './types'
import { DEFAULT_HOTKEY } from './constants'

/**
 * 设置项默认值。放在 shared 是因为主进程（electron-store）和渲染进程（表单初值）都要用，
 * 而主进程模块 import 了 electron，渲染进程碰不得。
 *
 * 两处刻意的默认值偏离（README 有说明）：
 *  - autoExtract 默认 false：实测库 25 GB、E 盘只剩 53 GB，全量解压会把盘写满；
 *  - autoLaunch 默认 false：由首启向导确认后才写启动项，程序不擅自动注册表。
 */
export const DEFAULTS: AppSettings = {
  language: 'zh-CN',
  libraryLocale: 'zh-CN',
  theme: 'dark',
  autoLaunch: false,
  autoLaunchAsked: false,
  minimizeToTray: true,
  globalHotkey: DEFAULT_HOTKEY,

  libraryRoot: null,
  libraryMode: null,
  storageMode: 'archived',
  dirTemplate: '{category}/{subcategory}/{name}',
  keepOriginalArchive: true,
  autoExtract: false,
  flattenExtracted: false,
  extractRoot: '',

  autoArchive: true,
  confidenceAuto: 0.75,
  confidenceConfirm: 0.4,
  groupingEnabled: true,
  bundleSplitEnabled: true,
  bundleChildrenUnderBundleDir: true,
  llmEnabled: false,
  llmEndpoint: '',
  llmModel: '',
  llmApiKeyRef: '',

  unityExePath: '',
  coverDependencyProjectId: null,
  projectRoots: [],
  bridgeAutoInstall: false,
  confirmBeforeImport: true,
  backupOverwritten: true,
  doubleClickAction: 'import',
  autoSwitchBehavior: 'when_matched',

  watchedFolders: [],
  onboardingDone: false,
  onboardingStep: 1,
  onboardingSkippedAt: null,
  /** 第 9 轮 ⑥ · 自动收拾历史遗留只跑一次；撤销过也不许自己又并回去 */
  autoRemergeRunAt: null,
  /** 第 10 轮 #112 · 上一次跑的时候是哪套库（换了库要松开那道刹车，见 `remergeAlreadyRun`） */
  autoRemergeRunRoot: null
}
