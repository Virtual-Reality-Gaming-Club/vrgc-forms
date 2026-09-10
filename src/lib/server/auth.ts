import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

if (typeof window !== 'undefined') {
  throw new Error('Server auth utilities must only be executed in server-side environments.');
}

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  token: DecodedIdToken;
}

/**
 * Extracts the Bearer token from a Request or Headers instance.
 * Rejects any format other than "Bearer <token>".
 */
export function extractBearerToken(requestOrHeaders: Request | Headers): string | null {
  const headers = requestOrHeaders instanceof Request ? requestOrHeaders.headers : requestOrHeaders;
  const authHeader = headers.get('authorization') || headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  return token || null;
}

/**
 * Cryptographically verifies a Firebase ID token using the Firebase Admin SDK.
 * Rejects expired, invalid, or forged tokens.
 */
export async function verifyIdToken(token: string): Promise<AuthenticatedUser> {
  const decoded = await adminAuth.verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email ? decoded.email.toLowerCase().trim() : null,
    emailVerified: Boolean(decoded.email_verified),
    token: decoded,
  };
}

/**
 * Authenticates an incoming Next.js API request by validating the Firebase ID token
 * in the Authorization header. Returns the trusted AuthenticatedUser or a 401 NextResponse.
 */
export async function authenticateRequest(
  request: Request
): Promise<{ user: AuthenticatedUser; errorResponse: null } | { user: null; errorResponse: NextResponse }> {
  const token = extractBearerToken(request);

  if (!token) {
    return {
      user: null,
      errorResponse: NextResponse.json(
        { success: false, error: 'Unauthorized: Missing or invalid Authorization Bearer header' },
        { status: 401 }
      ),
    };
  }

  try {
    const user = await verifyIdToken(token);
    return { user, errorResponse: null };
  } catch (err: any) {
    const code = err?.code || '';
    let errorMessage = 'Unauthorized: Invalid authentication credentials';

    if (code === 'auth/id-token-expired') {
      errorMessage = 'Unauthorized: Authentication token has expired';
    } else if (code === 'auth/argument-error') {
      errorMessage = 'Unauthorized: Invalid token format';
    }

    return {
      user: null,
      errorResponse: NextResponse.json(
        { success: false, error: errorMessage },
        { status: 401 }
      ),
    };
  }
}
