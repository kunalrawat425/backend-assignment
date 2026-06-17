import { PaymentStatus } from '../../../types/enums';

// Stripe refund.status mapping. `succeeded` here means money returned to customer.
export const STRIPE_REFUND_MAP: Record<string, PaymentStatus> = {
  succeeded: PaymentStatus.REFUNDED,
  pending: PaymentStatus.PENDING,
  failed: PaymentStatus.FAILED,
  canceled: PaymentStatus.VOIDED,
  requires_action: PaymentStatus.PENDING,
};
