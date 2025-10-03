// Test harness to start the server once for integration tests
import { spawn } from 'child_process';
import path from 'path';

let serverProcess;

export function startServer(port = 8199) {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve('./server-charlie.js');
    const env = { ...process.env, PORT: String(port) };
    serverProcess = spawn('node', [serverPath], { env });

    const timeout = setTimeout(() => {
      reject(new Error('Server start timeout'));
    }, 10000);

    serverProcess.stdout.on('data', (data) => {
      const line = data.toString();
      if (line.includes(`running http://127.0.0.1:${port}`)) {
        clearTimeout(timeout);
        resolve({ port });
      }
    });
    serverProcess.stderr.on('data', (data) => {
      // Allow stderr logs but still capture potential startup failures
      const line = data.toString();
      if (line.toLowerCase().includes('error')) {
        // Don't reject immediately; server may still continue
        console.error('[server stderr]', line);
      }
    });
    serverProcess.on('exit', (code) => {
      if (code !== 0) {
        console.error('Server exited early with code', code);
      }
    });
  });
}

export function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}
