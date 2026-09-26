const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let mainWindow;
let flaskProcess = null;

const PYTHON_SCRIPT_PATH = path.join(__dirname, 'app.py'); 
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');

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

function startFlaskServer() {
  const pythonCmd = getPythonPath();

  console.log('Запуск Flask сервера:', pythonCmd, PYTHON_SCRIPT_PATH);

  flaskProcess = spawn(pythonCmd, [PYTHON_SCRIPT_PATH], {
    cwd: path.dirname(PYTHON_SCRIPT_PATH), 
    env: { ...process.env, PYTHONUNBUFFERED: '1' } 
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Аналитика Демографии Казахстана',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile(INDEX_HTML_PATH);
  

}

app.whenReady().then(() => {
  startFlaskServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (flaskProcess) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', flaskProcess.pid, '/f', '/t']);
    } else {
      flaskProcess.kill();
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});