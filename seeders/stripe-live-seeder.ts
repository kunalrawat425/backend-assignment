import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const stripeApiKey = process.env.STRIPE_API_KEY;
if (!stripeApiKey || stripeApiKey.includes('YOUR_STRIPE_API_KEY')) {
  console.error('Stripe API Key is not configured correctly in .env.');
  process.exit(1);
}

const stripe = new Stripe(stripeApiKey, { apiVersion: '2024-09-30.acacia' as any });

async function seedStripe() {
  console.log('=== SEEDING STRIPE TEST CHARGES ===');
  
  const charges = [];
  for (let i = 1; i <= 3; i++) {
    const amount = 1000 * i; // $10, $20, $30
    const charge = await stripe.charges.create({
      amount,
      currency: 'usd',
      source: 'tok_visa',
      description: `Buffalo test charge ${i} - ${new Date().toISOString()}`,
    });
    console.log(`Created charge ID: ${charge.id}, Amount: $${amount / 100}`);
    charges.push(charge);
  }
  
  console.log('Stripe seeding complete.');
}

seedStripe().catch(err => {
  console.error('Stripe seeding failed:', err);
  process.exit(1);
});
