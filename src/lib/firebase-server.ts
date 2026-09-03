/**
 * Server-side Firebase token verification using the Firebase Auth REST API.
 * This avoids requiring the `firebase-admin` SDK or a service account key.
 *
 * Used by API routes to verify the calling user's identity from their
 * Firebase ID token, then authorize Payment Admin operations.
 */

interface VerifiedUser {
  uid: string;
  email: string;
  displayName: string;
}

/**
 * Verifies a Firebase ID token via the Google Identity Toolkit REST API.
 * Returns the verified user's uid, email, and display name.
 * Throws an error if the token is invalid or expired.
 */
export async function verifyFirebaseToken(idToken: string): Promise<VerifiedUser> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error('Firebase API key not configured');
  }

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorMessage = errorData?.error?.message || 'Token verification failed';
    throw new Error(errorMessage);
  }

  const data = await res.json();
  const users = data.users;

  if (!users || users.length === 0) {
    throw new Error('No user found for the provided token');
  }

  const user = users[0];
  return {
    uid: user.localId || '',
    email: (user.email || '').toLowerCase().trim(),
    displayName: user.displayName || user.email?.split('@')[0] || 'Unknown',
  };
}

/**
 * Reads the PAYMENT_ADMIN_EMAILS from the environment variable (server-side).
 * This is the server-side source of truth — not exposed as NEXT_PUBLIC_ on the server,
 * but since the project uses NEXT_PUBLIC_ for this var, we read it here too.
 */
export function getPaymentAdminEmails(): string[] {
  return (process.env.NEXT_PUBLIC_PAYMENT_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Checks if a given email is in the Payment Admin list.
 * Supports exact email matches and username/prefix matches (e.g. reg number or local-part).
 */
export function isPaymentAdminEmail(email: string): boolean {
  if (!email) return false;
  const admins = getPaymentAdminEmails();
  const normalized = email.toLowerCase().trim();
  const username = normalized.split('@')[0];
  return admins.some(
    (a) => a === normalized || a === username || normalized.startsWith(a + '@')
  );
}
