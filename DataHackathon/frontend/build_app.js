const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const target = process.argv[2];
if (!['mac', 'win'].includes(target)) {
  console.error('Usage: node build_app.js <mac|win>');
  process.exit(2);
}

const isWindows = process.platform === 'win32';
const frontendDirectory = __dirname;
const projectDirectory = path.resolve(frontendDirectory, '..');
const requiredDataPaths = [
  ...['d002', 'd004', 'd006', 'd008'].map((dataset) =>
    path.join(projectDirectory, 'data', 'sinte', dataset)
  )
];
const virtualEnvironmentPython = isWindows
  ? path.join(projectDirectory, '.venv', 'Scripts', 'python.exe')
  : path.join(projectDirectory, '.venv', 'bin', 'python');
const python = process.env.PYTHON
  || (fs.existsSync(virtualEnvironmentPython)
    ? virtualEnvironmentPython
    : (isWindows ? 'python' : 'python3'));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: frontendDirectory,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  const expectedPlatform = target === 'win' ? 'win32' : 'darwin';
  if (process.platform !== expectedPlatform) {
    throw new Error(
      `${target} builds must run on ${expectedPlatform === 'win32' ? 'Windows' : 'macOS'} because the embedded Python backend is platform-specific.`
    );
  }
  for (const dataPath of requiredDataPaths) {
    if (!fs.existsSync(dataPath)) {
      throw new Error(`Required packaged data is missing: ${dataPath}`);
    }
  }
  for (const dataset of ['d002', 'd004', 'd006', 'd008']) {
    const datasetPath = path.join(projectDirectory, 'data', 'sinte', dataset);
    if (!fs.readdirSync(datasetPath, { recursive: true }).some((file) => file.endsWith('.csv'))) {
      throw new Error(`No CSV files found in required dataset: ${datasetPath}`);
    }
  }

  run(python, ['build_backend.py']);
  run(
    process.execPath,
    [
      path.join(frontendDirectory, 'node_modules', 'electron-builder', 'cli.js'),
      `--${target}`
    ]
  );
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exit(1);
}
