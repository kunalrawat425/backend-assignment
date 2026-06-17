import 'dotenv/config';
import Stripe from 'stripe';
import { google } from 'googleapis';
import axios from 'axios';
import { ConfigService } from './src/config/config.service';

ConfigService.load();
const cfg = ConfigService.get();

async function createStripeCharges() {
  console.log('--- Creating 3 Live Stripe Charges ---');
  if (!cfg.STRIPE_API_KEY || cfg.STRIPE_API_KEY.includes('YOUR_STRIPE_API_KEY')) {
    console.error('❌ Stripe API Key is missing or default.');
    return;
  }

  try {
    const stripe = new Stripe(cfg.STRIPE_API_KEY, { apiVersion: '2024-09-30.acacia' as any });
    for (let i = 1; i <= 3; i++) {
      const amount = 1000 * i; // $10, $20, $30
      const charge = await stripe.charges.create({
        amount,
        currency: 'usd',
        source: 'tok_visa',
        description: `Live Vendor Seeder charge ${i} - ${new Date().toISOString()}`,
      });
      console.log(`✅ Stripe Charge created! ID: ${charge.id}, Amount: $${amount / 100}`);
    }
  } catch (err: any) {
    console.error('❌ Failed to create Stripe charges:', err.message);
  }
}

async function createHubSpotContacts() {
  console.log('\n--- Creating 3 Live HubSpot Contacts ---');
  if (!cfg.HUBSPOT_ACCESS_TOKEN) {
    console.error('❌ HubSpot Access Token missing.');
    return;
  }

  for (let i = 1; i <= 3; i++) {
    const contactData = {
      properties: {
        firstname: 'Buffalo',
        lastname: `User-${Math.floor(Math.random() * 1000)}`,
        email: `buffalo.user.${Date.now()}.${i}@example.com`,
        phone: `+1-555-384-592${i}`
      }
    };

    try {
      const res = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', contactData, {
        headers: {
          Authorization: `Bearer ${cfg.HUBSPOT_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log(`✅ HubSpot Contact ${i} created! Contact ID: ${res.data.id}`);
    } catch (err: any) {
      console.error(`❌ Failed to create HubSpot Contact ${i}:`, err.response?.data || err.message);
    }
  }
}

async function createGCalEvents() {
  console.log('\n--- Creating 3 Live Google Calendar Events ---');
  if (!cfg.GOOGLE_CLIENT_EMAIL || !cfg.GOOGLE_PRIVATE_KEY) {
    console.error('❌ GCal credentials missing.');
    return;
  }

  const privateKey = cfg.GOOGLE_PRIVATE_KEY.replace(/^"|"$/g, '').replace(/\\n/g, '\n');

  try {
    const auth = new google.auth.JWT(
      cfg.GOOGLE_CLIENT_EMAIL,
      undefined,
      privateKey,
      ['https://www.googleapis.com/auth/calendar']
    );

    const calendar = google.calendar({ version: 'v3', auth });

    for (let i = 1; i <= 3; i++) {
      const event = {
        summary: `Buffalo Sync Test Event ${i}`,
        description: `This is test event ${i} created for live sync verification.`,
        start: {
          dateTime: new Date(Date.now() + i * 3600000).toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: new Date(Date.now() + i * 3600000 + 1800000).toISOString(),
          timeZone: 'UTC',
        },
      };

      const res = await calendar.events.insert({
        calendarId: cfg.GOOGLE_CALENDAR_ID || 'primary',
        requestBody: event,
      });
      console.log(`✅ Google Calendar Event ${i} created! Event ID: ${res.data.id}`);
    }
  } catch (err: any) {
    console.error('❌ Failed to create Google Calendar Events:', err.message);
  }
}

async function run() {
  await createStripeCharges();
  await createHubSpotContacts();
  await createGCalEvents();
  console.log('\nDone seeding live vendors. No local sync was performed.');
}

run();
