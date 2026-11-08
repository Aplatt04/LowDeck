const { execFile } = require('child_process');
const path = require('path');

const PS_SCRIPT = path.join(__dirname, '..', 'scripts', 'volume.ps1');

function runPs(args) {
  return new Promise((resolve, reject) => {
    const psArgs = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', PS_SCRIPT,
      ...args
    ];
    execFile('powershell.exe', psArgs, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

async function listSessions() {
  try {
    const out = await runPs(['-action', 'list']);
    if (!out || out === 'null') return [];
    const parsed = JSON.parse(out);
    // Normalize: single object → array
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.error('listSessions error:', e.message);
    return [];
  }
}

async function setSessionVolume(pid, volume) {
  await runPs(['-action', 'set', '-procId', String(pid), '-volume', String(volume)]);
}

async function getMasterVolume() {
  try {
    const out = await runPs(['-action', 'getMaster']);
    return parseFloat(out);
  } catch { return 1.0; }
}

async function setMasterVolume(volume) {
  await runPs(['-action', 'setMaster', '-volume', String(volume)]);
}

module.exports = { listSessions, setSessionVolume, getMasterVolume, setMasterVolume };
