const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

let mainWindow;
let flaskProcess = null;
let analyzerProcess = null;
let packagedBackendProcess = null;

const PYTHON_SCRIPT_PATH = path.join(__dirname, 'app.py');
const ANALYZER_SCRIPT_PATH = path.join(__dirname, '..', 'server.py');
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');
const CLAUDE_KEY_FILE = 'claude-api-key.enc';
const PACKAGED_BACKEND_PATH = path.join(
  process.resourcesPath,
  'backend',
  `desktop-backend${process.platform === 'win32' ? '.exe' : ''}`
);

if (!app.isPackaged) {
  require('electron-reload')(__dirname, {
    electron: require(`${__dirname}/node_modules/electron`)
  });
}

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

  ipcMain.handle('export:table-pdf', async (event, payload) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
      throw new Error('Сохранение PDF доступно только из главного окна приложения.');
    }
    const html = payload?.html;
    if (typeof html !== 'string' || html.length > 20_000_000) {
      throw new Error('Таблица пуста или слишком велика для экспорта.');
    }
    const requestedName = path.basename(String(payload.filename || 'table.pdf'))
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const filename = requestedName.toLowerCase().endsWith('.pdf') ? requestedName : `${requestedName}.pdf`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить таблицу в PDF',
      defaultPath: path.join(app.getPath('documents'), filename),
      filters: [{ name: 'PDF документ', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { canceled: true };

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'datahackathon-pdf-'));
    const tempHtml = path.join(tempDir, 'table.html');
    const pdfWindow = new BrowserWindow({
      show: false,
      width: 1200,
      height: 850,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    try {
      await fs.promises.writeFile(tempHtml, html, 'utf8');
      await pdfWindow.loadFile(tempHtml);
      const pdf = await pdfWindow.webContents.printToPDF({
        pageSize: 'A4',
        landscape: true,
        printBackground: true,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
      });
      await fs.promises.writeFile(filePath, pdf);
      return { saved: true, filePath };
    } finally {
      if (!pdfWindow.isDestroyed()) pdfWindow.close();
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  ipcMain.handle('export:table-excel', async (event, payload) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
      throw new Error('Сохранение Excel доступно только из главного окна приложения.');
    }
    const base64 = payload?.base64;
    if (typeof base64 !== 'string' || !base64 || base64.length > 80_000_000 || !/^[A-Za-z0-9+/]+=*$/.test(base64)) {
      throw new Error('Excel файл пуст или слишком велик для экспорта.');
    }
    const requestedName = path.basename(String(payload.filename || 'table.xlsx'))
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const filename = requestedName.toLowerCase().endsWith('.xlsx') ? requestedName : `${requestedName}.xlsx`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить таблицу в Excel',
      defaultPath: path.join(app.getPath('documents'), filename),
      filters: [{ name: 'Excel книга', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'));
    return { saved: true, filePath };
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

function startPackagedBackend(apiPort, analyzerPort, savedApiKey) {
  const appDataPath = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(path.join(appDataPath, 'sinte'), { recursive: true });

  packagedBackendProcess = spawn(PACKAGED_BACKEND_PATH, [], {
    cwd: appDataPath,
    windowsHide: true,
    env: {
      ...process.env,
      ...(savedApiKey ? { CLAUDE_API_KEY: savedApiKey } : {}),
      APP_DATA_DIR: appDataPath,
      DATABASE_FILE: path.join(appDataPath, 'database.sqlite'),
      DATASETS_DIR: path.join(process.resourcesPath, 'data', 'sinte'),
      APP_PACKAGED: '1',
      ANALYZER_UI_PATH: path.join(process.resourcesPath, 'app-ui', 'index.html'),
      PYTHONUNBUFFERED: '1',
      FLASK_PORT: String(apiPort),
      ANALYZER_PORT: String(analyzerPort)
    }
  });

  packagedBackendProcess.stdout.on('data', (data) => {
    console.log(`[Backend]: ${data.toString().trim()}`);
  });
  packagedBackendProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error]: ${data.toString().trim()}`);
  });
  packagedBackendProcess.on('error', (error) => {
    console.error('[Backend] Не удалось запустить встроенный сервер:', error);
    dialog.showErrorBox(
      'Не удалось запустить приложение',
      `Встроенный backend не запустился: ${error.message}`
    );
  });
  packagedBackendProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      const message = `Сервер завершился с кодом ${code} (signal: ${signal || 'none'}).`;
      console.error(`[Backend] ${message}`);
      if (app.isReady()) {
        dialog.showErrorBox('Встроенный сервер остановился', message);
      }
    }
  });
}

function createWindow(apiPort, analyzerPort) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 500,
    icon: path.join(__dirname, 'img', 'app-icon.ico'),
    title: 'Аналитика Демографии Казахстана',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.removeMenu();

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
  if (app.isPackaged) {
    startPackagedBackend(apiPort, analyzerPort, savedApiKey);
  } else {
    startFlaskServer(apiPort, savedApiKey);
    startAnalyzerServer(analyzerPort);
  }
  createWindow(apiPort, analyzerPort);
});

app.on('window-all-closed', () => {
  if (packagedBackendProcess) packagedBackendProcess.kill();
  if (flaskProcess) flaskProcess.kill();
  if (analyzerProcess) analyzerProcess.kill();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
