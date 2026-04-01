import { useEffect, useState } from "react"
import { listWorkspaceFiles } from "#ui/workspace-files"

type ActiveFileToken = {
  readonly query: string
  readonly startIndex: number
}

export function useWorkspaceFiles(activeFileToken: ActiveFileToken | null): {
  readonly workspaceFiles: readonly string[]
  readonly workspaceFilesLoaded: boolean
} {
  const [workspaceFiles, setWorkspaceFiles] = useState<readonly string[]>([])
  const [workspaceFilesLoaded, setWorkspaceFilesLoaded] = useState(false)

  useEffect(() => {
    if (!activeFileToken || workspaceFilesLoaded) {
      return
    }

    let cancelled = false

    void listWorkspaceFiles(process.cwd())
      .then((files) => {
        if (!cancelled) {
          setWorkspaceFiles(files)
          setWorkspaceFilesLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceFiles([])
          setWorkspaceFilesLoaded(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeFileToken, workspaceFilesLoaded])

  return {
    workspaceFiles,
    workspaceFilesLoaded,
  }
}
