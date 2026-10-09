/**
 * VRGC Forms — Shared Application Constants
 *
 * Central location for:
 * - Firestore collection name strings (prevents typos; single rename point)
 * - External API base URLs (single version-pin for Dicebear, Razorpay checkout, etc.)
 *
 * Rule: Any string literal that appears in more than one file SHOULD live here.
 */

// ─── Firestore Collection Names ───────────────────────────────────────────────
export const COLLECTIONS = {
  /** Club member records */
  MEMBERS: 'members',
  /** Firebase Auth / Google ID-card records */
  ID_CARDS: 'id_cards',
  /** Explicitly blocked user emails */
  BLOCKED_USERS: 'blocked_users',
  /** Admin / coordinator records */
  ADMINS: 'admins',
  /** Role assignments */
  ROLES: 'roles',
  /** Super admin records */
  SUPER_ADMINS: 'super_admins',
  /** Idea Curator Hub ideas */
  IDEAS: 'club_ideas',
  /** Planned / community events */
  PLANNED_EVENTS: 'planned_events',
  /** Payment / dues records */
  PAYMENTS: 'payments_dues',
  /** Referral records */
  REFERRALS: 'referrals',
  /** Support / helpdesk tickets */
  SUPPORT_TICKETS: 'support_tickets',
  /** Support FAQ entries */
  SUPPORT_FAQS: 'support_faqs',
  /** Presence / audit session records */
  SESSIONS: 'sessions',
  /** Administrative action logs */
  ADMIN_LOGS: 'admin_logs',
  /** Global portal configuration */
  CONFIG: 'config',
  /** Faculty member records */
  FACULTY: 'faculty',
  /** Lost / damaged ID card replacement requests */
  ID_CARD_REQUESTS: 'id_card_requests',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

// ─── External Avatar API ───────────────────────────────────────────────────────
/** Pinned Dicebear API base — update version here to upgrade globally */
const DICEBEAR_BASE = 'https://api.dicebear.com/9.x';

/**
 * Generates a robot/bot avatar URL (member cards, idea hub)
 * @param seed - Unique string seed (name or email)
 */
export function genBotAvatar(seed: string): string {
  return `${DICEBEAR_BASE}/bottts/svg?seed=${encodeURIComponent(seed || 'default')}`;
}

/**
 * Generates a pixel-art avatar URL (ID cards, card deck)
 * @param seed - Unique string seed
 * @param bg   - Optional hex background colour (no #), default: 0a0a0f
 */
export function genPixelAvatar(seed: string, bg = '0a0a0f'): string {
  return `${DICEBEAR_BASE}/pixel-art/svg?seed=${encodeURIComponent(seed || 'default')}&backgroundColor=${bg}`;
}

// ─── Payment Gateway ──────────────────────────────────────────────────────────
/** Razorpay checkout script URL */
export const RAZORPAY_CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
