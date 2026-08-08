import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, spawnSync } from "node:child_process"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, "..")
const frontendDirectory = join(projectRoot, "frontend")
const virtualEnvironmentDirectory = join(projectRoot, ".venv")
const localPython = process.platform === "win32"
  ? join(virtualEnvironmentDirectory, "Scripts", "python.exe")
  : join(virtualEnvironmentDirectory, "bin", "python")
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const setupOnly = process.argv.includes("--setup-only")
const showHelp = process.argv.includes("--help") || process.argv.includes("-h")

if (showHelp) {
  console.log(`
Vastrivo development launcher

Usage:
  start-dev.cmd                 Set up and start UI + backend
  node scripts/dev.mjs          Same as above
  node scripts/dev.mjs --setup-only
                                Install dependencies without starting servers

Environment:
  PYTHON_EXECUTABLE             Optional path to a Python 3.11+ executable
`)
  process.exit(0)
}

function fail(message) {
  console.error(`\n[Vastrivo] ${message}\n`)
  process.exit(1)
}

function prepareCommand(command, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    }
  }
  return { command, args }
}

function run(command, args, options = {}) {
  const prepared = prepareCommand(command, args)
  const result = spawnSync(prepared.command, prepared.args, {
    cwd: options.cwd || projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  })

  if (result.error) {
    fail(`Could not run ${command}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    fail(`${options.label || command} failed with exit code ${result.status}.`)
  }
}

function commandWorks(command, args = ["--version"]) {
  const prepared = prepareCommand(command, args)
  const result = spawnSync(prepared.command, prepared.args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "ignore",
    shell: false,
  })
  return !result.error && result.status === 0
}

function findBootstrapPython() {
  if (process.env.PYTHON_EXECUTABLE) {
    const configuredPython = resolve(process.env.PYTHON_EXECUTABLE)
    if (!existsSync(configuredPython)) {
      fail(`PYTHON_EXECUTABLE does not exist: ${configuredPython}`)
    }
    return { command: configuredPython, prefix: [] }
  }

  if (process.platform === "win32" && commandWorks("py", ["-3", "--version"])) {
    return { command: "py", prefix: ["-3"] }
  }
  if (commandWorks("python3")) {
    return { command: "python3", prefix: [] }
  }
  if (commandWorks("python")) {
    return { command: "python", prefix: [] }
  }

  fail(
    "Python 3.11 or newer was not found. Install Python, enable “Add Python to PATH”, then run start-dev.cmd again.",
  )
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function ensureEnvironmentFile() {
  if (!existsSync(join(projectRoot, ".env"))) {
    fail("The .env file is missing. Copy .env.example to .env and fill in the database and admin values.")
  }
}

function ensurePythonEnvironment() {
  let createdEnvironment = false
  if (!existsSync(localPython)) {
    const bootstrap = findBootstrapPython()
    console.log("\n[setup] Creating the Python virtual environment...")
    run(bootstrap.command, [...bootstrap.prefix, "-m", "venv", virtualEnvironmentDirectory], {
      label: "Python virtual environment creation",
    })
    createdEnvironment = true
  }

  const requirementsPath = join(projectRoot, "requirements.txt")
  const requirementsStamp = join(virtualEnvironmentDirectory, ".vastrivo-requirements.sha256")
  const currentHash = fileHash(requirementsPath)
  const savedHash = existsSync(requirementsStamp)
    ? readFileSync(requirementsStamp, "utf8").trim()
    : ""

  if (createdEnvironment || savedHash !== currentHash) {
    console.log("\n[setup] Installing backend packages...")
    run(localPython, ["-m", "pip", "install", "--upgrade", "pip"], {
      label: "pip upgrade",
    })
    run(localPython, ["-m", "pip", "install", "-r", requirementsPath], {
      label: "backend package installation",
    })
    writeFileSync(requirementsStamp, `${currentHash}\n`)
  }
}

function ensureFrontendEnvironment() {
  const lockfilePath = join(frontendDirectory, "package-lock.json")
  const nodeModulesDirectory = join(frontendDirectory, "node_modules")
  const packageStamp = join(nodeModulesDirectory, ".vastrivo-package-lock.sha256")
  const currentHash = fileHash(lockfilePath)
  const savedHash = existsSync(packageStamp)
    ? readFileSync(packageStamp, "utf8").trim()
    : ""

  if (!existsSync(nodeModulesDirectory) || savedHash !== currentHash) {
    console.log("\n[setup] Installing frontend packages...")
    run(npmCommand, ["install"], {
      cwd: frontendDirectory,
      label: "frontend package installation",
    })
    writeFileSync(packageStamp, `${currentHash}\n`)
  }
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
    })
  } else {
    child.kill("SIGTERM")
  }
}

ensureEnvironmentFile()
ensurePythonEnvironment()
ensureFrontendEnvironment()

if (setupOnly) {
  console.log("\n[Vastrivo] Setup complete.")
  process.exit(0)
}

console.log(`
============================================================
 Vastrivo development environment
------------------------------------------------------------
 UI:          http://127.0.0.1:5173
 Backend API: http://127.0.0.1:8000
 API docs:    http://127.0.0.1:8000/docs

 Press Ctrl+C once to stop both services.
============================================================
`)

console.log("[backend] Starting FastAPI on http://127.0.0.1:8000 ...")
const backend = spawn(
  localPython,
  [
    "-u",
    "-m",
    "uvicorn",
    "app.main:app",
    "--reload",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
    "--log-level",
    "info",
    "--access-log",
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  },
)

console.log("[frontend] Starting Vite on http://127.0.0.1:5173 ...")
const frontendCommand = prepareCommand(
  npmCommand,
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
)
const frontend = spawn(
  frontendCommand.command,
  frontendCommand.args,
  {
    cwd: frontendDirectory,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  },
)

let stopping = false

function prefixOutput(stream, label, destination) {
  let remainder = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    const lines = `${remainder}${chunk}`.split(/\r?\n/)
    remainder = lines.pop() || ""
    for (const line of lines) {
      if (line.length > 0) destination.write(`[${label}] ${line}\n`)
    }
  })
  stream.on("end", () => {
    if (remainder.length > 0) destination.write(`[${label}] ${remainder}\n`)
  })
}

prefixOutput(backend.stdout, "backend", process.stdout)
prefixOutput(backend.stderr, "backend", process.stderr)
prefixOutput(frontend.stdout, "frontend", process.stdout)
prefixOutput(frontend.stderr, "frontend", process.stderr)

function shutdown(exitCode = 0) {
  if (stopping) return
  stopping = true
  console.log("\n[Vastrivo] Stopping UI and backend...")
  stopProcessTree(frontend)
  stopProcessTree(backend)
  process.exit(exitCode)
}

backend.on("error", (error) => {
  console.error(`[backend] ${error.message}`)
  shutdown(1)
})

frontend.on("error", (error) => {
  console.error(`[frontend] ${error.message}`)
  shutdown(1)
})

backend.on("exit", (code) => {
  if (!stopping) {
    console.error(`\n[backend] Stopped unexpectedly with exit code ${code ?? 1}.`)
    shutdown(code ?? 1)
  }
})

frontend.on("exit", (code) => {
  if (!stopping) {
    console.error(`\n[frontend] Stopped unexpectedly with exit code ${code ?? 1}.`)
    shutdown(code ?? 1)
  }
})

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))
