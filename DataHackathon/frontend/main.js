const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

let mainWindow;
let flaskProcess = null;
let analyzerProcess = null;

const PYTHON_SCRIPT_PATH = path.join(__dirname, 'app.py');
const ANALYZER_SCRIPT_PATH = path.join(__dirname, '..', 'server.py');
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');
const CLAUDE_KEY_FILE = 'claude-api-key.enc';

const electron = require('electron');

// Указываем путь к вашему основному файлу или папке с проектом
require('electron-reload')(__dirname, {
  // Указываем путь до electron (если папка с node_modules находится рядом)
  electron: require(`${__dirname}/node_modules/electron`)
});



// Функция определения интерпретатора Python (поддерживает .venv для Windows и macOS/Linux)
function getPythonPath() {
  const isWin = os.platform() === 'win32';

  // Путь к виртуальному окружению .venv на уровень выше от frontend/ (в корне DataHackathon/)
  const venvPython = isWin
    ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', '.venv', 'bin', 'python3');

  // Если виртуальное окружение существует, используем его, иначе откатываемся на системный python
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return isWin ? 'python' : 'python3';
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function readSavedClaudeApiKey() {
  const keyFile = path.join(app.getPath('userData'), CLAUDE_KEY_FILE);
  if (!fs.existsSync(keyFile)) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Безопасное хранилище недоступно: сохранённый ключ Claude нельзя расшифровать.');
  }
  return safeStorage.decryptString(fs.readFileSync(keyFile));
}

function registerSettingsHandlers() {
  ipcMain.handle('settings:save-claude-key', (_event, apiKey) => {
    if (typeof apiKey !== 'string' || apiKey.trim().length < 20 || !apiKey.trim().startsWith('sk-ant-')) {
      throw new Error('Введите полный API-ключ Claude, начинающийся с sk-ant-.');
    }
    const key = apiKey.trim();
    if (!/^[\x00-\x7F]+$/.test(key)) {
      throw new Error('API-ключ должен содержать только ASCII-символы.');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Безопасное хранилище недоступно. Ключ не был сохранён.');
    }

    const keyFile = path.join(app.getPath('userData'), CLAUDE_KEY_FILE);
    fs.writeFileSync(keyFile, safeStorage.encryptString(key));
    return { saved: true };
  });

  ipcMain.handle('settings:clear-claude-key', () => {
    const keyFile = path.join(app.getPath('userData'), CLAUDE_KEY_FILE);
    if (fs.existsSync(keyFile)) fs.unlinkSync(keyFile);
    return { cleared: true };
  });
}

function startFlaskServer(port, savedApiKey) {
  const pythonCmd = getPythonPath();

  console.log('Запуск Flask сервера:', pythonCmd, PYTHON_SCRIPT_PATH);

  flaskProcess = spawn(pythonCmd, [PYTHON_SCRIPT_PATH], {
    cwd: path.dirname(PYTHON_SCRIPT_PATH),
    env: {
      ...process.env,
      ...(savedApiKey ? { CLAUDE_API_KEY: savedApiKey } : {}),
      PYTHONUNBUFFERED: '1',
      FLASK_PORT: String(port)
    }
  });

  flaskProcess.stdout.on('data', (data) => {
    console.log(`[Flask]: ${data.toString().trim()}`);
  });

  flaskProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (!msg.includes('127.0.0.1') && !msg.includes('WARNING: This is a development server')) {
      console.error(`[Flask Error]: ${msg}`);
    } else {
      console.log(`[Flask]: ${msg}`);
    }
  });
}

function startAnalyzerServer(port) {
  const pythonCmd = getPythonPath();

  console.log('Запуск Data Analyzer API:', pythonCmd, ANALYZER_SCRIPT_PATH);
  analyzerProcess = spawn(pythonCmd, [ANALYZER_SCRIPT_PATH, String(port)], {
    cwd: path.dirname(ANALYZER_SCRIPT_PATH),
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  analyzerProcess.stdout.on('data', (data) => {
    console.log(`[Data Analyzer]: ${data.toString().trim()}`);
  });
  analyzerProcess.stderr.on('data', (data) => {
    console.error(`[Data Analyzer Error]: ${data.toString().trim()}`);
  });
  analyzerProcess.on('error', (error) => {
    console.error('[Data Analyzer] Не удалось запустить сервер:', error);
  });
}

function createWindow(apiPort, analyzerPort) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 500,
    title: 'Аналитика Демографии Казахстана',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.loadFile(INDEX_HTML_PATH, {
    query: {
      apiPort: String(apiPort),
      analyzerPort: String(analyzerPort)
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());


}

app.whenReady().then(async () => {
  registerSettingsHandlers();
  const savedApiKey = readSavedClaudeApiKey();
  const [apiPort, analyzerPort] = await Promise.all([
    getAvailablePort(),
    getAvailablePort()
  ]);
  startFlaskServer(apiPort, savedApiKey);
  startAnalyzerServer(analyzerPort);
  createWindow(apiPort, analyzerPort);
});

app.on('window-all-closed', () => {
  if (flaskProcess) flaskProcess.kill();
  if (analyzerProcess) analyzerProcess.kill();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
