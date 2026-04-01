import type { CLIArgs } from "#cli/args"
import { CONFIG_PATH, type ConfigLoadResult } from "#config/schema"
import { runSessionsList, runSessionsShow } from "#cli/commands/sessions"
import { runUninstall } from "#cli/commands/uninstall"
import { runUpgrade } from "#cli/commands/upgrade"

export async function runCliCommand(
  cliArgs: CLIArgs,
  options: { readonly configResult?: ConfigLoadResult } = {},
): Promise<boolean> {
  switch (cliArgs.command) {
    case "upgrade":
      await runUpgrade()
      return true
    case "uninstall":
      await runUninstall()
      return true
    case "sessions.list":
      await runSessionsList()
      return true
    case "sessions.show":
      await runSessionsShow(cliArgs.sessionId)
      return true
    case "config":
      if (!options.configResult) {
        return false
      }

      console.log(`Config path: ${CONFIG_PATH}`)
      console.log(JSON.stringify(options.configResult.config, null, 2))
      return true
    default:
      return false
  }
}
