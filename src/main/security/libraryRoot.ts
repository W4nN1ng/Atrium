import fs from 'node:fs'
import path from 'node:path'
import { isForbiddenLibraryRoot, isForbiddenTarget } from './paths'

/** A library may move incoming files; it must never point into a Unity project. */
export function libraryRootProblem(input: string): string | null {
  let directory = path.resolve(input)
  if (isForbiddenLibraryRoot(directory) || isForbiddenTarget(directory)) return 'wizard.step1.forbidden'
  while (true) {
    try {
      if (fs.statSync(path.join(directory, 'ProjectSettings', 'ProjectVersion.txt')).isFile()) {
        return 'wizard.step1.unityProject'
      }
    } catch { /* Missing project marker is expected for ordinary directories. */ }
    const parent = path.dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}
