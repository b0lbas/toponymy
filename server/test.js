#!/usr/bin/env node
// Quick test script to verify server setup

import fetch from 'node-fetch';

const API_BASE = process.env.API_URL || 'http://localhost:3001';
const delay = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  try {
    console.log('Testing Toponymy API...\n');

    // Test register
    console.log('1. Registering user...');
    const regRes = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-' + Date.now() })
    });
    const regData = await regRes.json();
    if (!regData.success) throw new Error('Register failed: ' + regData.error);
    console.log('✓ Registered:', regData.userId);
    const token = regData.token;
    const userId = regData.userId;

    // Test get user
    console.log('\n2. Getting current user...');
    const meRes = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const meData = await meRes.json();
    console.log('✓ User:', meData.userId);

    // Test toggle like
    console.log('\n3. Toggling like...');
    const likeRes = await fetch(`${API_BASE}/api/likes/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ patternKey: 'test-pattern-1' })
    });
    const likeData = await likeRes.json();
    if (!likeData.success) throw new Error('Like toggle failed: ' + likeData.error);
    console.log('✓ Liked:', likeData.liked, 'Count:', likeData.count);

    // Test get likes
    console.log('\n4. Getting likes...');
    const getLikeRes = await fetch(`${API_BASE}/api/likes/test-pattern-1`);
    const getLikeData = await getLikeRes.json();
    console.log('✓ Pattern likes count:', getLikeData.count);

    // Test login
    console.log('\n5. Testing login with wrong password...');
    const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });
    const loginData = await loginRes.json();
    if (loginData.success) throw new Error('Should have failed login');
    console.log('✓ Correctly rejected wrong password');

    console.log('\n✅ All tests passed!');
    process.exit(0);
  } catch (e) {
    console.error('\n❌ Error:', e.message);
    process.exit(1);
  }
})();
