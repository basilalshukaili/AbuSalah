#!/usr/bin/env node

// Electron's installer can return before its asynchronous extraction finishes
// on newer Node.js releases. Keep the event loop alive and perform the same
// download/extraction here so start.bat can reliably repair a partial install.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { downloadArtifact } = require('@electron/get')

const electronDir = path.resolve(__dirname, '..', 'node_modules', 'electron')
const electronPackage = require(path.join(electronDir, 'package.json'))

function platformExecutable(platform) {
  switch (platform) {
    case 'win32':
      return 'electron.exe'
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return 'electron'
    default:
      throw new Error(`Electron is not available for platform ${platform}`)
  }
}

async function main() {
  const platform = process.env.npm_config_platform || process.platform
  const arch = process.env.npm_config_arch || process.arch
  const executable = platformExecutable(platform)
  const distDir = path.join(electronDir, 'dist')
  const executablePath = path.join(distDir, executable)

  if (fs.existsSync(executablePath)) {
    console.log('Electron runtime is ready.')
    return
  }

  console.log(`Downloading Electron ${electronPackage.version} (${platform}-${arch})...`)
  const zipPath = await downloadArtifact({
    version: electronPackage.version,
    artifactName: 'electron',
    platform,
    arch,
    force: process.env.force_no_cache === 'true',
    cacheRoot: process.env.electron_config_cache,
    checksums: require(path.join(electronDir, 'checksums.json'))
  })

  await fs.promises.rm(distDir, { recursive: true, force: true })
  await fs.promises.mkdir(distDir, { recursive: true })
  execFileSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(__dirname, 'extract-zip.ps1'),
      '-ZipPath',
      zipPath,
      '-Destination',
      distDir
    ],
    { stdio: 'inherit' }
  )
  await fs.promises.writeFile(path.join(electronDir, 'path.txt'), executable)

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Electron extraction completed but ${executablePath} is missing`)
  }

  console.log('Electron runtime installed successfully.')
}

const keepAlive = setInterval(() => {}, 1000)

main()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
  .finally(() => clearInterval(keepAlive))
