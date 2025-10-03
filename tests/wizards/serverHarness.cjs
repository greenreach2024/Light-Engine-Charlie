const { spawn } = require('child_process');
const path = require('path');
let serverProcess;
let active = false;

function startServer(port = 8199) {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve('./server-charlie.js');
  const env = { ...process.env, PORT: String(port), TEST_WIZARDS: '1' };
    serverProcess = spawn('node', [serverPath], { env });

    active = true;
    const timeout = setTimeout(() => {
      active = false;
      reject(new Error('Server start timeout'))
    }, 10000);

    serverProcess.stdout.on('data', (d) => {
      const line = d.toString();
      if (line.includes(`running http://127.0.0.1:${port}`)) {
        clearTimeout(timeout);
        resolve({ port });
      }
    });
    serverProcess.stderr.on('data', (d) => {
      const line = d.toString();
      if (line.toLowerCase().includes('error')) {
        // Not rejecting immediately
        console.error('[server stderr]', line);
      }
    });
    serverProcess.on('exit', (code) => {
      if (active && code !== 0) console.error('Server exited early with code', code);
    });
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
    active = false;
  }
}

module.exports = { startServer, stopServer };
