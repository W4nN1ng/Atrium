import i18next from 'i18next'

/**
 * 探测结果的 label 是 ASCII 技术名（'RAR5'、'ZIP'、'Folder'、'Text'…）。
 * 主进程不许回传中文，所以"能翻译的那几个"在这里查 key，
 * 剩下本来就是格式名（RAR5/UnityPackage/Photoshop PSD），原样显示就是对的。
 */
const LABEL_KEY: Record<string, string> = {
  Empty: 'probe.empty',
  Text: 'probe.text',
  'UTF-8 Text': 'probe.textUtf8',
  'UTF-16 Text': 'probe.textUtf16',
  Unknown: 'probe.unknown',
  Folder: 'probe.folder',
  EXE: 'probe.exe',
  LNK: 'probe.lnk',
  OLE: 'probe.ole',
  Blender: 'probe.blender',
  'Unity YAML': 'probe.unityYaml'
}

export function probeLabel(label: string | undefined | null): string {
  if (!label) return ''
  const key = LABEL_KEY[label]
  if (key && i18next.exists(key)) return String(i18next.t(key))
  return label
}
