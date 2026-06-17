import axios from 'axios';

const BASE_URL = 'http://localhost:3000';
const API_KEY = 'f5d96a7ebcd7fbe4f691c28c894d0a1b';
const ADMIN_API_KEY = '9a7c3b2f5d1e4c7b8e0a1f2c3d4e5f6a';

async function runTests() {
  console.log('=== STARTING SEQUENTIAL API TEST SUITE ===\n');

  // Case 1: GET /healthz
  try {
    const res = await axios.get(`${BASE_URL}/healthz`);
    console.log('✅ Case 1: GET /healthz - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('❌ Case 1: GET /healthz - Failed', err.message);
  }

  // Case 2: GET /readyz
  try {
    const res = await axios.get(`${BASE_URL}/readyz`);
    console.log('\n✅ Case 2: GET /readyz - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 2: GET /readyz - Failed', err.message);
  }

  // Case 3: POST /trigger/stripe/incremental
  try {
    const res = await axios.post(`${BASE_URL}/trigger/stripe/incremental`, {}, {
      headers: {
        'X-Admin-Api-Key': ADMIN_API_KEY,
        'Idempotency-Key': `trigger-stripe-inc-${Date.now()}`
      }
    });
    console.log('\n✅ Case 3: POST /trigger/stripe/incremental - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 3: POST /trigger/stripe/incremental - Failed', err.response?.data || err.message);
  }

  // Case 4: POST /trigger/stripe/full
  try {
    const res = await axios.post(`${BASE_URL}/trigger/stripe/full`, {}, {
      headers: {
        'X-Admin-Api-Key': ADMIN_API_KEY,
        'Idempotency-Key': `trigger-stripe-full-${Date.now()}`
      }
    });
    console.log('\n✅ Case 4: POST /trigger/stripe/full - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 4: POST /trigger/stripe/full - Failed', err.response?.data || err.message);
  }

  // Case 5: GET /runs
  try {
    const res = await axios.get(`${BASE_URL}/runs?limit=5`, {
      headers: {
        'X-Api-Key': API_KEY
      }
    });
    console.log('\n✅ Case 5: GET /runs - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 5: GET /runs - Failed', err.response?.data || err.message);
  }

  // Case 6: POST /trigger - Missing Idempotency Key (Should fail with 400)
  try {
    await axios.post(`${BASE_URL}/trigger/stripe/incremental`, {}, {
      headers: {
        'X-Admin-Api-Key': ADMIN_API_KEY
      }
    });
    console.error('\n❌ Case 6: POST /trigger (missing idempotency key) - Failed (expected 400 but got 2xx)');
  } catch (err: any) {
    if (err.response?.status === 400) {
      console.log('\n✅ Case 6: POST /trigger (missing idempotency key) - Passed (Successfully rejected with 400)');
      console.log(`   Status: 400, Body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error('\n❌ Case 6: POST /trigger (missing idempotency key) - Failed with unexpected error', err.response?.data || err.message);
    }
  }

  // Case 7: POST /trigger - Invalid source (Should fail with 400)
  try {
    await axios.post(`${BASE_URL}/trigger/invalid-source/incremental`, {}, {
      headers: {
        'X-Admin-Api-Key': ADMIN_API_KEY,
        'Idempotency-Key': `trigger-invalid-${Date.now()}`
      }
    });
    console.error('\n❌ Case 7: POST /trigger (invalid source) - Failed (expected 400 but got 2xx)');
  } catch (err: any) {
    if (err.response?.status === 400) {
      console.log('\n✅ Case 7: POST /trigger (invalid source) - Passed (Successfully rejected with 400)');
      console.log(`   Status: 400, Body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error('\n❌ Case 7: POST /trigger (invalid source) - Failed with unexpected error', err.response?.data || err.message);
    }
  }

  // Case 8: GET /metrics/revenue/summary
  try {
    const res = await axios.get(`${BASE_URL}/metrics/revenue/summary`, {
      headers: { 'X-Api-Key': API_KEY }
    });
    console.log('\n✅ Case 8: GET /metrics/revenue/summary - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 8: GET /metrics/revenue/summary - Failed', err.response?.data || err.message);
  }

  // Case 9: GET /metrics/revenue/daily
  try {
    const res = await axios.get(`${BASE_URL}/metrics/revenue/daily`, {
      headers: { 'X-Api-Key': API_KEY }
    });
    console.log('\n✅ Case 9: GET /metrics/revenue/daily - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 9: GET /metrics/revenue/daily - Failed', err.response?.data || err.message);
  }

  // Case 10: GET /metrics/revenue/weekly
  try {
    const res = await axios.get(`${BASE_URL}/metrics/revenue/weekly`, {
      headers: { 'X-Api-Key': API_KEY }
    });
    console.log('\n✅ Case 10: GET /metrics/revenue/weekly - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 10: GET /metrics/revenue/weekly - Failed', err.response?.data || err.message);
  }

  console.log('\n=== SEQUENTIAL API TESTS COMPLETE ===');
}

runTests();
