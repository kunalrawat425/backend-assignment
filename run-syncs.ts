import axios from 'axios';

const BASE_URL = 'http://localhost:3000';
const API_KEY = 'f5d96a7ebcd7fbe4f691c28c894d0a1b';
const ADMIN_API_KEY = '9a7c3b2f5d1e4c7b8e0a1f2c3d4e5f6a';

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerAndPoll() {
  console.log('=== STARTING HUBSPOT & GCAL SYNC RUNS ===\n');

  // 1. Trigger HubSpot Incremental Sync
  let hubspotRunId = '';
  try {
    const res = await axios.post(`${BASE_URL}/trigger/hubspot/incremental`, {}, {
      headers: {
        'X-Admin-Api-Key': ADMIN_API_KEY,
        'Idempotency-Key': `trigger-hubspot-inc-${Date.now()}`
      }
    });
    hubspotRunId = res.data.runId;
    console.log(`✅ Triggered HubSpot Sync! Run ID: ${hubspotRunId}`);
  } catch (err: any) {
    console.error('❌ Failed to trigger HubSpot Sync:', err.response?.data || err.message);
  }

  // 2. Trigger GCal Incremental Sync
  let gcalRunId = '';
  try {
    const res = await axios.post(`${BASE_URL}/trigger/gcal/incremental`, {}, {
      headers: {
        'X-Admin-Api-Key': ADMIN_API_KEY,
        'Idempotency-Key': `trigger-gcal-inc-${Date.now()}`
      }
    });
    gcalRunId = res.data.runId;
    console.log(`✅ Triggered Google Calendar Sync! Run ID: ${gcalRunId}`);
  } catch (err: any) {
    console.error('❌ Failed to trigger Google Calendar Sync:', err.response?.data || err.message);
  }

  console.log('\nWaiting 10 seconds for syncs to complete and process outbox...');
  await wait(10000);

  // 3. Fetch runs from server to check the status
  try {
    const res = await axios.get(`${BASE_URL}/runs?limit=10`, {
      headers: {
        'X-Api-Key': API_KEY
      }
    });
    console.log('\n=== LATEST RUN REPORTS ===');
    const filteredRuns = res.data.runs.filter((r: any) => r.runId === hubspotRunId || r.runId === gcalRunId);
    console.log(JSON.stringify(filteredRuns, null, 2));
  } catch (err: any) {
    console.error('❌ Failed to fetch run status:', err.response?.data || err.message);
  }
}

triggerAndPoll();
