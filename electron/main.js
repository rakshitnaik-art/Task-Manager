const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

// Auto-updater (electron-updater) — checked for updates from GitHub Releases
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch {
  // electron-updater not installed in dev — safe to skip
}

// Load .env.local so API routes have Turso/Anthropic/Google credentials at runtime
function loadEnv() {
  const envPath = app.isPackaged
    ? path.join(process.resourcesPath, '.env.local')
    : path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
}

// Load ~/.taskora/settings.json and mirror its keys into process.env
// (only for keys not already set from .env.local — .env.local wins for dev).
function loadSettings() {
  const settingsPath = path.join(os.homedir(), '.taskora', 'settings.json');
  if (!fs.existsSync(settingsPath)) return;
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const s = JSON.parse(raw);
    const map = {
      anthropicKey: 'ANTHROPIC_API_KEY',
      googleClientId: 'GOOGLE_CLIENT_ID',
      googleClientSecret: 'GOOGLE_CLIENT_SECRET',
      googleRedirectUri: 'GOOGLE_REDIRECT_URI',
      slackClientId: 'SLACK_CLIENT_ID',
      slackClientSecret: 'SLACK_CLIENT_SECRET',
      slackRedirectUri: 'SLACK_REDIRECT_URI',
    };
    for (const [settingKey, envKey] of Object.entries(map)) {
      const v = s[settingKey];
      if (typeof v === 'string' && v.length > 0 && !process.env[envKey]) {
        process.env[envKey] = v;
      }
    }
  } catch (e) {
    console.warn('[taskora] failed to load ~/.taskora/settings.json', e && e.message);
  }
}

function ensureTaskoraDir() {
  const dir = path.join(os.homedir(), '.taskora');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const PORT = 3001;
let mainWindow = null;
let nextProcess = null;

function waitForServer(callback) {
  const try_ = () => {
    const req = http.get(`http://localhost:${PORT}`, () => callback());
    req.on('error', () => setTimeout(try_, 500));
    req.end();
  };
  try_();
}

function startNext() {
  const bin = path.join(__dirname, '..', 'node_modules', '.bin', 'next');
  const taskoraDir = ensureTaskoraDir();
  nextProcess = spawn(bin, ['start', '--port', String(PORT)], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TASKORA_USER_DATA: taskoraDir },
    stdio: 'pipe',
  });
  nextProcess.stdout.on('data', (d) => process.stdout.write(d));
  nextProcess.stderr.on('data', (d) => process.stderr.write(d));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Kick off an update check after the UI is visible
    if (autoUpdater && app.isPackaged) {
      try {
        autoUpdater.setFeedURL({
          provider: 'github',
          owner: 'taskora-app',
          repo: 'taskora',
        });
        autoUpdater.checkForUpdatesAndNotify();
      } catch (e) {
        console.warn('[taskora] auto-update check failed', e && e.message);
      }
    }
  });

  // Open external links in the system browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function isPortInUse(port, callback) {
  const req = http.get(`http://localhost:${port}`, () => callback(true));
  req.on('error', () => callback(false));
  req.end();
}

app.whenReady().then(() => {
  loadEnv();
  loadSettings();
  isPortInUse(PORT, (inUse) => {
    if (!inUse) startNext();
    waitForServer(createWindow);
  });
});

app.on('window-all-closed', () => {
  if (nextProcess) nextProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

app.on('before-quit', () => {
  if (nextProcess) nextProcess.kill();
});
