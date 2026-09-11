import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HOST = '127.0.0.1';
const PORT = 5174;
const OAUTH_START_URL = 'http://localhost:5173/api/meta-oauth/start';
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function browserDefinitions() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

  if (process.platform === 'win32') {
    return [
      {
        id: 'chrome',
        name: 'Google Chrome',
        userData: path.join(local, 'Google', 'Chrome', 'User Data'),
        executables: [
          path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ],
      },
      {
        id: 'edge',
        name: 'Microsoft Edge',
        userData: path.join(local, 'Microsoft', 'Edge', 'User Data'),
        executables: [
          path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ],
      },
      {
        id: 'brave',
        name: 'Brave',
        userData: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
        executables: [
          path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        ],
      },
    ];
  }

  if (process.platform === 'darwin') {
    return [
      {
        id: 'chrome',
        name: 'Google Chrome',
        userData: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
        executables: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      },
      {
        id: 'edge',
        name: 'Microsoft Edge',
        userData: path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
        executables: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      },
      {
        id: 'brave',
        name: 'Brave',
        userData: path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
        executables: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
      },
    ];
  }

  return [
    {
      id: 'chrome',
      name: 'Google Chrome',
      userData: path.join(home, '.config', 'google-chrome'),
      executables: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      userData: path.join(home, '.config', 'microsoft-edge'),
      executables: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    },
    {
      id: 'brave',
      name: 'Brave',
      userData: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser'),
      executables: ['/usr/bin/brave-browser'],
    },
  ];
}

async function firstExisting(paths) {
  for (const candidate of paths) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function readProfiles(userData) {
  const found = new Map();
  try {
    const raw = await readFile(path.join(userData, 'Local State'), 'utf8');
    const state = JSON.parse(raw);
    const cache = state?.profile?.info_cache || {};
    for (const [directory, value] of Object.entries(cache)) {
      if (!directory || !(await exists(path.join(userData, directory)))) continue;
      const profile = value && typeof value === 'object' ? value : {};
      found.set(directory, {
        directory,
        name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : directory,
      });
    }
  } catch {
    // Fallback below only inspects profile folder names. No cookies or credentials are read.
  }

  if (found.size === 0) {
    try {
      const entries = await readdir(userData, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name !== 'Default' && !/^Profile \d+$/.test(entry.name)) continue;
        found.set(entry.name, { directory: entry.name, name: entry.name });
      }
    } catch {
      return [];
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

async function discoverBrowsers() {
  const result = [];
  for (const definition of browserDefinitions()) {
    const executable = await firstExisting(definition.executables);
    if (!executable || !(await exists(definition.userData))) continue;
    const profiles = await readProfiles(definition.userData);
    if (!profiles.length) continue;
    result.push({ ...definition, executable, profiles });
  }
  return result;
}

function writeJson(res, status, body, origin) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error('Yêu cầu quá lớn.');
  }
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';

  if (req.method === 'OPTIONS') {
    if (!ALLOWED_ORIGINS.has(origin)) {
      writeJson(res, 403, { error: 'Origin không được phép.' }, origin);
      return;
    }
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    res.end();
    return;
  }

  if (!ALLOWED_ORIGINS.has(origin)) {
    writeJson(res, 403, { error: 'Chỉ tool local mới được gọi browser helper.' }, origin);
    return;
  }

  const requestUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && requestUrl.pathname === '/profiles') {
    const browsers = await discoverBrowsers();
    writeJson(
      res,
      200,
      {
        browsers: browsers.map((browser) => ({
          id: browser.id,
          name: browser.name,
          profiles: browser.profiles,
        })),
      },
      origin,
    );
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/launch') {
    try {
      const input = await readJson(req);
      const browserId = String(input.browserId || '');
      const profileDirectory = String(input.profileDirectory || '');
      const browsers = await discoverBrowsers();
      const browser = browsers.find((item) => item.id === browserId);
      const profile = browser?.profiles.find((item) => item.directory === profileDirectory);

      if (!browser || !profile) {
        writeJson(res, 400, { error: 'Không tìm thấy trình duyệt hoặc profile đã chọn.' }, origin);
        return;
      }

      const child = spawn(
        browser.executable,
        [`--profile-directory=${profile.directory}`, '--new-window', OAUTH_START_URL],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();

      writeJson(
        res,
        200,
        {
          ok: true,
          browser: browser.name,
          profile: profile.name,
        },
        origin,
      );
    } catch (error) {
      writeJson(res, 400, { error: error instanceof Error ? error.message : 'Không mở được profile.' }, origin);
    }
    return;
  }

  writeJson(res, 404, { error: 'Không tìm thấy endpoint.' }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`[browser-helper] Ready at http://${HOST}:${PORT}`);
  console.log('[browser-helper] Chỉ đọc tên profile để mở OAuth; không đọc cookie, mật khẩu hoặc token trình duyệt.');
});
