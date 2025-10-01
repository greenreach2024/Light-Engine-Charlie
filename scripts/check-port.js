#!/usr/bin/env node

/**
 * Utility to diagnose connectivity issues with the Light Engine Charlie HTTP server.
 * The script attempts to open a TCP connection to the configured host/port and
 * prints actionable guidance based on the result.  It is designed to help track
 * down cases where the server process reports a successful start but browsers
 * cannot reach the UI.
 */
const net = require('net');
const { execSync } = require('child_process');

const DEFAULT_PORT = 8091;
const DEFAULT_HOST = process.env.LEC_HOST || process.env.HOST || '127.0.0.1';

const [, , portArg, hostArg] = process.argv;
const port = Number(portArg) || DEFAULT_PORT;
const host = hostArg || DEFAULT_HOST;

function logDivider() {
  console.log(''.padEnd(80, '-'));
}

function tryCommand(label, command) {
  try {
    const output = execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (output.toString().trim().length) {
      logDivider();
      console.log(`${label}:\n${output.toString().trim()}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logDivider();
      console.log(`${label} failed: ${error.message}`);
    }
  }
}

function summarizeError(err) {
  switch (err.code) {
    case 'ECONNREFUSED':
      console.log(`Connection refused when reaching ${host}:${port}.`);
      console.log('The HTTP listener is not accepting connections.');
      console.log('\nSuggested checks:');
      console.log(' • Confirm the server process is still running (npm run start).');
      console.log(' • Verify no other process is bound to the port.');
      console.log(' • Inspect the server logs for initialization errors.');
      tryCommand('Processes using the port (lsof)', `lsof -i :${port}`);
      tryCommand('Socket summary (ss)', `ss -tulpn | grep :${port}`);
      break;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      console.log(`Unable to reach host ${host}.`);
      console.log('Ensure that the interface is bound correctly or adjust HOST to 0.0.0.0.');
      break;
    case 'ETIMEDOUT':
      console.log(`Timed out connecting to ${host}:${port}.`);
      console.log('The server accepted the TCP handshake but is not completing requests.');
      console.log('Check middleware for long-running initialization or hanging promises.');
      break;
    default:
      console.log(`Failed to connect: ${err.message}`);
  }
}

console.log(`Checking Light Engine Charlie availability at ${host}:${port}...`);

const socket = net.createConnection({ host, port });
socket.setTimeout(3000);

socket.once('connect', () => {
  console.log('✅ Successfully connected. HTTP listener is reachable.');
  socket.destroy();
});

socket.once('timeout', () => {
  console.log('⚠️  Connection attempt timed out.');
  summarizeError({ code: 'ETIMEDOUT', message: 'Connection timed out' });
  socket.destroy();
});

socket.once('error', (err) => {
  console.log('❌ Unable to connect.');
  summarizeError(err);
  socket.destroy();
});

socket.once('close', (hadError) => {
  if (!hadError) {
    logDivider();
    console.log('Next steps:');
    console.log(' • If the UI still does not render, inspect browser dev tools for HTTPS/CORS issues.');
    console.log(' • Confirm the SPA assets exist in the public/ build output directory.');
  }
});
