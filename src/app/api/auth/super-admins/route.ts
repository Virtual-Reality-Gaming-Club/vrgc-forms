import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { CONFIG } from '@/lib/config';
import { authenticateRequest } from '@/lib/server/auth';

async function isAuthorizedCaller(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Authoritative server configuration lists (Super Admin & Admin)
  if (
    CONFIG.SUPER_ADMIN_EMAILS.includes(normalized) ||
    CONFIG.ADMIN_EMAILS.includes(normalized)
  ) {
    return true;
  }

  // 2. Dynamic Firestore super_admins & admins collections
  try {
    const superDoc = await adminDb.collection('super_admins').doc(normalized).get();
    if (superDoc.exists) return true;

    const adminDoc = await adminDb.collection('admins').doc(normalized).get();
    if (adminDoc.exists) return true;
  } catch (err) {
    console.warn('[SuperAdmins API] Admin check fallback notice:', err);
  }

  return false;
}

export async function GET(request: Request) {
  // 1. Cryptographically verify Firebase ID token
  const { user, errorResponse } = await authenticateRequest(request);
  if (errorResponse) {
    return errorResponse;
  }

  // 2. Authorize caller identity
  const isAuthorized = await isAuthorizedCaller(user.email);
  if (!isAuthorized) {
    return NextResponse.json(
      { error: 'Forbidden: Access to Super Admin registry requires administrator authorization.' },
      { status: 403 }
    );
  }

  const superAdminEnv = process.env.SUPER_ADMIN_EMAILS || '';
  const superAdmins = superAdminEnv
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return NextResponse.json(
    { superAdmins },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}