import { PaymentStatus } from '../../../types/enums';

// Stripe PaymentIntent / Charge status mapping (charge context).
// Refund context uses stripe.refund.map.ts.
export const STRIPE_MAP: Record<string, PaymentStatus> = {
  succeeded: PaymentStatus.COLLECTED,
  paid: PaymentStatus.COLLECTED,
  processing: PaymentStatus.PENDING,
  requires_payment_method: PaymentStatus.PENDING,
  requires_confirmation: PaymentStatus.PENDING,
  requires_action: PaymentStatus.PENDING,
  requires_capture: PaymentStatus.PENDING,
  canceled: PaymentStatus.VOIDED,
  failed: PaymentStatus.FAILED,
};
