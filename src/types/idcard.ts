export type IDCardStatus = 'active' | 'suspended' | 'pending' | 'rejected' | string;

export interface IDCardDoc {
  id?: string;
  name: string;
  registrationNumber: string;
  phone: string;
  team: string;
  position: string;
  email: string;
  photoUrl: string;
  avatarUrl?: string;
  gifUrl?: string;
  submittedAt: string;
  status: IDCardStatus;
  activeRequestId?: string | null;
  suspendedReason?: string | null;
  suspendedAt?: string | null;
  requestDenied?: boolean;
  denialMessage?: string;
  deniedAt?: string | null;
  isBlocked?: boolean;
  [key: string]: any;
}

export type IDCardRequestPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
export type IDCardRequestFulfillmentStatus = 'payment_pending' | 'queued' | 'resolved' | 'cancelled' | 'denied';

export interface IDCardRequest {
  id: string; // requestId (e.g. req_...)
  userEmail: string;
  candidateName: string;
  registrationNumber: string;
  phone?: string;
  team: string;
  position: string;
  photoUrl?: string;
  avatarUrl?: string;
  feeAmount: number; // in INR
  amount?: number; // alias for feeAmount
  currency: string;
  paymentId: string;
  invoiceId?: string; // alias for paymentId
  razorpayOrderId?: string;
  orderId?: string; // alias for razorpayOrderId
  paymentStatus: IDCardRequestPaymentStatus;
  fulfillmentStatus: IDCardRequestFulfillmentStatus;
  reason?: string; // e.g. 'lost_replacement'
  createdAt: string | number;
  updatedAt?: string | number;
  expireAt: number; // epoch ms for expiry checks
  paidAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  denialMessage?: string;
  [key: string]: any;
}

export interface IDCardSettings {
  replacementFee: number; // in INR, default 150
  expiryMinutes: number; // in minutes, default 60
}

export const DEFAULT_ID_CARD_SETTINGS: IDCardSettings = {
  replacementFee: 150,
  expiryMinutes: 60,
};

// Generates short, clean, human-friendly identifier (e.g. REQ-9K2L4B7 or ORD-9K2L4B7)
export function generateShortId(prefix = 'REQ'): string {
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  const randPart = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}-${timePart}${randPart}`;
}

// Formats any raw ID (even long legacy IDs) into a clean, short human-readable reference
export function formatDisplayId(rawId?: string | null, fallbackPrefix = 'REQ'): string {
  if (!rawId) return `${fallbackPrefix}-N/A`;
  const clean = String(rawId).trim();
  if (clean.startsWith('REQ-') || clean.startsWith('ORD-') || clean.startsWith('PAY-')) {
    return clean;
  }
  const cleanAlnum = clean.replace(/[^a-zA-Z0-9]/g, '');
  const shortCode = cleanAlnum.slice(-6).toUpperCase();
  return `${fallbackPrefix}-${shortCode || 'REF'}`;
}
