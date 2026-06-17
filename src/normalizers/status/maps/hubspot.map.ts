import { PaymentStatus } from '../../../types/enums';

// HubSpot deal stage mapping (deals act as payment proxies).
export const HUBSPOT_MAP: Record<string, PaymentStatus> = {
  closedwon: PaymentStatus.COLLECTED,
  paid: PaymentStatus.COLLECTED,
  completed: PaymentStatus.COLLECTED,
  closedlost: PaymentStatus.FAILED,
  appointmentscheduled: PaymentStatus.PENDING,
  qualifiedtobuy: PaymentStatus.PENDING,
  presentationscheduled: PaymentStatus.PENDING,
  decisionmakerboughtin: PaymentStatus.PENDING,
  contractsent: PaymentStatus.PENDING,
};
