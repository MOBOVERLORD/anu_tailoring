import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, "..")
const python = process.platform === "win32"
  ? join(projectRoot, ".venv", "Scripts", "python.exe")
  : join(projectRoot, ".venv", "bin", "python")
const alembicArguments = process.argv.slice(2)
const command = alembicArguments.length > 0
  ? alembicArguments
  : ["upgrade", "head"]

if (!existsSync(python)) {
  console.error(
    "[Vastrivo] Python environment is missing. Run `npm run setup` first.",
  )
  process.exit(1)
}

const result = spawnSync(
  python,
  ["-m", "alembic", ...command],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  },
)

if (result.error) {
  console.error(`[Vastrivo] Could not run database migration: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
