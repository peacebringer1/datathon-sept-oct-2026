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
const databasePath = path.join(projectDirectory, 'database.sqlite');
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
  if (!fs.existsSync(databasePath)) {
    throw new Error(`Required packaged database is missing: ${databasePath}`);
  }
  run(python, [
    '-c',
    [
      'import sqlite3, sys',
      'database = sqlite3.connect(sys.argv[1])',
      'tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type = \'table\'")}',
      'if "sinte_import_manifest" not in tables: raise SystemExit("database.sqlite is missing sinte_import_manifest")',
      'forms = {row[0] for row in database.execute("SELECT DISTINCT form FROM sinte_import_manifest")}',
      'missing = {"d002", "d004", "d006", "d008"} - forms',
      'if missing: raise SystemExit("database.sqlite is missing imported datasets: " + ", ".join(sorted(missing)))',
      'result = database.execute("PRAGMA quick_check").fetchone()[0]',
      'if result != "ok": raise SystemExit("database.sqlite integrity check failed: " + result)',
      'database.close()'
    ].join('\n'),
    databasePath
  ]);

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
