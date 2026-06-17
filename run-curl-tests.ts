import 'dotenv/config';
import axios from 'axios';

const BASE_URL = process.env.BASE_URL || 'https://backend-assignment-7in3.onrender.com';
const API_KEY = process.env.API_KEY || 'f5d96a7ebcd7fbe4f691c28c894d0a1b';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '9a7c3b2f5d1e4c7b8e0a1f2c3d4e5f6a';

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

  // Case 11: GET /metrics/revenue/summary with invalid date parameter format (Expect 400)
  try {
    await axios.get(`${BASE_URL}/metrics/revenue/summary?startDate=15-06-2026`, {
      headers: { 'X-Api-Key': API_KEY }
    });
    console.error('\n❌ Case 11: GET /metrics/revenue/summary (invalid date format) - Failed (expected 400 but got 2xx)');
  } catch (err: any) {
    if (err.response?.status === 400) {
      console.log('\n✅ Case 11: GET /metrics/revenue/summary (invalid date format) - Passed (Successfully rejected with 400)');
      console.log(`   Status: 400, Body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error('\n❌ Case 11: GET /metrics/revenue/summary (invalid date format) - Failed with unexpected error', err.response?.data || err.message);
    }
  }

  // Case 12: GET /metrics/revenue/summary with unauthorized/missing API key (Expect 401)
  try {
    await axios.get(`${BASE_URL}/metrics/revenue/summary`, {
      headers: { 'X-Api-Key': 'invalid-unauthorized-key' }
    });
    console.error('\n❌ Case 12: GET /metrics/revenue/summary (unauthorized key) - Failed (expected 401 but got 2xx)');
  } catch (err: any) {
    if (err.response?.status === 401) {
      console.log('\n✅ Case 12: GET /metrics/revenue/summary (unauthorized key) - Passed (Successfully rejected with 401)');
      console.log(`   Status: 401, Body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error('\n❌ Case 12: GET /metrics/revenue/summary (unauthorized key) - Failed with unexpected error', err.response?.data || err.message);
    }
  }

  // Case 13: GET /metrics/revenue/summary filtering by source 'stripe' (Expect 200)
  try {
    const res = await axios.get(`${BASE_URL}/metrics/revenue/summary?source=stripe`, {
      headers: { 'X-Api-Key': API_KEY }
    });
    console.log('\n✅ Case 13: GET /metrics/revenue/summary?source=stripe - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 13: GET /metrics/revenue/summary?source=stripe - Failed', err.response?.data || err.message);
  }

  // Case 14: GET /metrics/revenue/daily with startDate & endDate constraints (Expect 200)
  try {
    const res = await axios.get(`${BASE_URL}/metrics/revenue/daily?startDate=2026-06-15&endDate=2026-06-17`, {
      headers: { 'X-Api-Key': API_KEY }
    });
    console.log('\n✅ Case 14: GET /metrics/revenue/daily?startDate=2026-06-15&endDate=2026-06-17 - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 14: GET /metrics/revenue/daily?startDate=2026-06-15&endDate=2026-06-17 - Failed', err.response?.data || err.message);
  }

  // Case 15: GET /metrics/revenue/weekly with source=stripe and date range filters (Expect 200)
  try {
    const res = await axios.get(`${BASE_URL}/metrics/revenue/weekly?source=stripe&startDate=2026-06-15&endDate=2026-06-17`, {
      headers: { 'X-Api-Key': API_KEY }
    });
    console.log('\n✅ Case 15: GET /metrics/revenue/weekly?source=stripe&startDate=2026-06-15&endDate=2026-06-17 - Passed');
    console.log(`   Status: ${res.status}, Body: ${JSON.stringify(res.data)}`);
  } catch (err: any) {
    console.error('\n❌ Case 15: GET /metrics/revenue/weekly?source=stripe&startDate=2026-06-15&endDate=2026-06-17 - Failed', err.response?.data || err.message);
  }

  // Case 16: POST /trigger/stripe/incremental with general key (Expect 401 since it requires X-Admin-Api-Key)
  try {
    await axios.post(`${BASE_URL}/trigger/stripe/incremental`, {}, {
      headers: {
        'X-Admin-Api-Key': 'invalid-admin-key',
        'Idempotency-Key': `trigger-unauth-${Date.now()}`
      }
    });
    console.error('\n❌ Case 16: POST /trigger with invalid admin key - Failed (expected 401 but got 2xx)');
  } catch (err: any) {
    if (err.response?.status === 401) {
      console.log('\n✅ Case 16: POST /trigger with invalid admin key - Passed (Successfully rejected with 401)');
      console.log(`   Status: 401, Body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error('\n❌ Case 16: POST /trigger with invalid admin key - Failed with unexpected error', err.response?.data || err.message);
    }
  }

  console.log('\n=== SEQUENTIAL API TESTS COMPLETE ===');
}

runTests();
