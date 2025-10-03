/**
 * Manual Review Test for Light Engine Charlie
 * This script tests key functionality and reports findings
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8091';

async function testEndpoint(path, expectedStatus = 200) {
  try {
    const response = await fetch(`${BASE_URL}${path}`);
    const status = response.status;
    const success = status === expectedStatus;
    
    return {
      path,
      status,
      success,
      message: success ? 'OK' : `Expected ${expectedStatus}, got ${status}`
    };
  } catch (error) {
    return {
      path,
      status: 'ERROR',
      success: false,
      message: error.message
    };
  }
}

async function runReview() {
  console.log('🔍 Light Engine Charlie - Comprehensive Review\n');
  
  const tests = [
    // Core endpoints
    { path: '/', name: 'Main Application' },
    { path: '/healthz', name: 'Health Check' },
    
    // Data endpoints
    { path: '/data/farm.json', name: 'Farm Configuration' },
    { path: '/data/device-meta.json', name: 'Device Metadata' },
    { path: '/data/plans.json', name: 'Light Plans' },
    { path: '/data/groups.json', name: 'Groups Configuration' },
    { path: '/data/schedules.json', name: 'Schedules' },
    { path: '/data/rooms.json', name: 'Rooms Configuration' },
    
    // AI endpoints
    { path: '/ai/setup-assist', name: 'AI Setup Assistant', expectedStatus: 405 }, // GET not allowed, POST expected
    
    // Static assets
    { path: '/app.charlie.js', name: 'Main JavaScript' },
    { path: '/styles.charlie.css', name: 'Main Stylesheet' },
    { path: '/ai-placeholder-replacer.js', name: 'AI Placeholder System' }
  ];
  
  console.log('📡 Testing Endpoints...\n');
  
  const results = [];
  for (const test of tests) {
    const result = await testEndpoint(test.path, test.expectedStatus || 200);
    result.name = test.name;
    results.push(result);
    
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${result.name}: ${result.message}`);
  }
  
  console.log('\n📊 Summary:');
  const passed = results.filter(r => r.success).length;
  const total = results.length;
  console.log(`${passed}/${total} tests passed (${Math.round(passed/total*100)}%)`);
  
  if (passed === total) {
    console.log('\n🎉 All core functionality appears to be working!');
  } else {
    console.log('\n⚠️  Some issues found. Check failed endpoints above.');
  }
}

// Test AI Setup Assistant POST endpoint
async function testAIEndpoint() {
  console.log('\n🤖 Testing AI Setup Assistant...');
  
  try {
    const response = await fetch(`${BASE_URL}/ai/setup-assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceType: 'light',
        manufacturer: 'GROW3',
        model: 'TopLight MH Model-300W-22G12'
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.suggestions) {
      console.log('✅ AI Setup Assistant working');
      console.log(`   Provider: ${data.provider || 'unknown'}`);
      console.log(`   Suggestions: ${Object.keys(data.suggestions).length} items`);
    } else {
      console.log('❌ AI Setup Assistant failed');
      console.log(`   Status: ${response.status}`);
    }
  } catch (error) {
    console.log('❌ AI Setup Assistant error:', error.message);
  }
}

// Run the review
runReview().then(() => testAIEndpoint());