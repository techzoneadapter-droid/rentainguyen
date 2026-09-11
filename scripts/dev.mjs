import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const isWindows = process.platform === 'win32';
const vinextBin = path.join(root, 'node_modules', '.bin', isWindows ? 'vinext.cmd' : 'vinext');

const helper = spawn(process.execPath, [path.join(root, 'scripts', 'browser-profile-helper.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

const app = spawn(vinextBin, ['dev', '--port', '5173'], {
  cwd: root,
  stdio: 'inherit',
  shell: isWindows,
});

let shuttingDown = false;

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!helper.killed) helper.kill();
  if (!app.killed) app.kill();
  process.exit(code);
}

helper.on('exit', (code) => {
  if (!shuttingDown && code && code !== 0) {
    console.warn(`[browser-helper] stopped with code ${code}; OAuth still works in the current browser profile.`);
  }
});

app.on('exit', (code) => stop(code ?? 0));
app.on('error', (error) => {
  console.error('[dev] Không khởi động được Vinext:', error);
  stop(1);
});
helper.on('error', (error) => {
  console.warn('[browser-helper] Không khởi động được helper:', error);
});

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
