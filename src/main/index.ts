import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'

import { autoBackupOnStart, configurePathsAndDb, registerIpc } from './ipc/register'

// Electron's GPU shader disk cache fails to initialize on some Windows setups
// (synced/shared folders, antivirus locks, or a second instance), spamming
// "Unable to move the cache / Gpu Cache Creation failed" errors. The app does
// not rely on it, so turn it off to keep startup clean.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'Abu Salah',
    backgroundColor: '#0f172a',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => { win.show(); win.maximize() })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = win
}

// Only one copy of the app may run at a time. A second launch (e.g. double-
// clicking start.bat) would otherwise fight over the same user-data and cache
// files, which is the usual cause of "Access is denied" cache errors.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      await configurePathsAndDb(app.getPath('userData'))
      registerIpc()
      await autoBackupOnStart()
      await createWindow()
    } catch (err) {
      console.error('Startup failed:', err)
      dialog.showErrorBox(
        'Startup error',
        err instanceof Error ? err.message : String(err)
      )
      app.quit()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Hardening: disable navigation, deny all permission requests, block webview attach
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    const allowed =
      (process.env.ELECTRON_RENDERER_URL &&
        url.startsWith(process.env.ELECTRON_RENDERER_URL)) ||
      url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.session.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))
  contents.on('will-attach-webview', (e) => e.preventDefault())
})
