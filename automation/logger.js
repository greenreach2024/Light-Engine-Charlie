import path from 'path';
import { appendNdjsonLine, ensureDirSync } from './utils/file-storage.js';

export default class AutomationLogger {
  constructor(options = {}) {
    const {
      dataDir = path.resolve('./data/automation'),
      fileName = 'events.ndjson'
    } = options;

    this.dataDir = dataDir;
    this.filePath = path.join(this.dataDir, fileName);
    ensureDirSync(this.dataDir);
  }

  log(event) {
    const payload = {
      ts: event?.ts || Date.now(),
      timestamp: event?.timestamp || new Date(event?.ts || Date.now()).toISOString(),
      ...event
    };
    appendNdjsonLine(this.filePath, payload);
    return payload;
  }
}
