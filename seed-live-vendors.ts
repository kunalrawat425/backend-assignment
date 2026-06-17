import 'dotenv/config';
import { google } from 'googleapis';
import axios from 'axios';
import { ConfigService } from './src/config/config.service';

// Load config
ConfigService.load();
const cfg = ConfigService.get();

async function createGCalEvent() {
  console.log('--- Creating Live Google Calendar Event ---');
  if (!cfg.GOOGLE_CLIENT_EMAIL || !cfg.GOOGLE_PRIVATE_KEY) {
    console.error('❌ GCal credentials missing.');
    return;
  }

  const privateKey = cfg.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT(
    cfg.GOOGLE_CLIENT_EMAIL,
    undefined,
    privateKey,
    ['https://www.googleapis.com/auth/calendar']
  );

  const calendar = google.calendar({ version: 'v3', auth });

  const event = {
    summary: 'Buffalo Sync Test Event',
    description: 'This is a test event created for live sync verification.',
    start: {
      dateTime: new Date().toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: new Date(Date.now() + 3600000).toISOString(),
      timeZone: 'UTC',
    },
  };

  try {
    const res = await calendar.events.insert({
      calendarId: cfg.GOOGLE_CALENDAR_ID || 'primary',
      requestBody: event,
    });
    console.log(`✅ Event successfully created! Event ID: ${res.data.id}`);
  } catch (err: any) {
    console.error('❌ Failed to create Google Calendar Event:', err.message);
  }
}

async function createHubSpotContact() {
  console.log('\n--- Creating Live HubSpot Contact ---');
  if (!cfg.HUBSPOT_ACCESS_TOKEN) {
    console.error('❌ HubSpot Access Token missing.');
    return;
  }

  const contactData = {
    properties: {
      firstname: 'Buffalo',
      lastname: `User-${Math.floor(Math.random() * 1000)}`,
      email: `buffalo.user.${Date.now()}@example.com`,
      phone: '+1-555-384-5920'
    }
  };

  try {
    const res = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', contactData, {
      headers: {
        Authorization: `Bearer ${cfg.HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ HubSpot Contact created! Contact ID: ${res.data.id}`);
  } catch (err: any) {
    console.error('❌ Failed to create HubSpot Contact:', err.response?.data || err.message);
  }
}

async function run() {
  await createGCalEvent();
  await createHubSpotContact();
  console.log('\nDone seeding live vendors.');
}

run();
