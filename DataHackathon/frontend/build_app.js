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
