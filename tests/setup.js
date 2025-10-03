// Jest test setup for Light Engine Charlie wizard tests

// Mock console.log to reduce noise during tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: console.error, // Keep errors visible
};

// Setup test timeouts
jest.setTimeout(10000);

// Mock Date.now for consistent timestamps in tests
const mockDate = new Date('2025-10-03T14:30:00.000Z');
global.Date = class extends Date {
  constructor(...args) {
    if (args.length === 0) {
      return mockDate;
    }
    return new Date(...args);
  }
  
  static now() {
    return mockDate.getTime();
  }
};