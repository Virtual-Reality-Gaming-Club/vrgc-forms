import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { adminDb } from '@/lib/firebase-admin';
import { CONFIG } from '@/lib/config';

async function isAuthorizedAdmin(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Authoritative server configuration lists
  if (
    CONFIG.ADMIN_EMAILS.includes(normalized) ||
    CONFIG.SUPER_ADMIN_EMAILS.includes(normalized)
  ) {
    return true;
  }

  // 2. Dynamic Firestore admin collections
  try {
    const adminDoc = await adminDb.collection('admins').doc(normalized).get();
    if (adminDoc.exists) return true;

    const superDoc = await adminDb.collection('super_admins').doc(normalized).get();
    if (superDoc.exists) return true;
  } catch (err) {
    console.warn('[ID Card Sheets API] Admin authorization check notice:', err);
  }

  return false;
}

function buildSheetSyncUrl(scriptBaseUrl: string, candidate: any): string {
  const email = encodeURIComponent(candidate.email || '');
  const name = encodeURIComponent(candidate.name || '');
  const regNo = encodeURIComponent(candidate.regNo || candidate.registrationNumber || '');
  const phone = encodeURIComponent(candidate.phone || '');
  const team = encodeURIComponent(candidate.team || '');
  const position = encodeURIComponent(candidate.position || 'Member');
  const photoUrl = encodeURIComponent(candidate.photoUrl || '');
  const avatarUrl = encodeURIComponent(candidate.avatarUrl || candidate.avatar || '');
  const qrCode = encodeURIComponent(candidate.qrCode || candidate.qrUrl || '');
  const cardUrl = encodeURIComponent(candidate.cardUrl || '');
  const submittedAt = encodeURIComponent(candidate.submittedAt || '');
  const status = encodeURIComponent(candidate.status || 'Pending');

  return `${scriptBaseUrl}?action=sync_idcard&email=${email}&name=${name}&regNo=${regNo}&registrationNumber=${regNo}&phone=${phone}&team=${team}&position=${position}&photoUrl=${photoUrl}&avatarUrl=${avatarUrl}&avatar=${avatarUrl}&qrCode=${qrCode}&qrUrl=${qrCode}&cardUrl=${cardUrl}&submittedAt=${submittedAt}&status=${status}`;
}

export async function POST(req: Request) {
  try {
    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(req);
    if (errorResponse) {
      return errorResponse;
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    const callerEmail = (user.email || '').toLowerCase().trim();
    const isAdmin = await isAuthorizedAdmin(callerEmail);

    const scriptUrl = process.env.GOOGLE_SCRIPT_ID_CARD_URL;
    if (!scriptUrl) {
      return NextResponse.json(
        { success: true, warning: 'Google Script ID Card URL is not configured on server.' },
        { status: 200 }
      );
    }

    if (action === 'delete_idcard') {
      // Deletions are strictly administrative
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: 'Forbidden: Only authorized administrators can delete records from Google Sheets.' },
          { status: 403 }
        );
      }

      const targetEmail = (body.email || '').toLowerCase().trim();
      if (!targetEmail) {
        return NextResponse.json({ success: false, error: 'Target email is required for deletion.' }, { status: 400 });
      }

      const deleteUrl = `${scriptUrl}?action=delete_idcard&email=${encodeURIComponent(targetEmail)}`;
      try {
        await fetch(deleteUrl);
      } catch (fetchErr) {
        console.error('[ID Card Sheets API] Google Script delete call failed:', fetchErr);
      }

      return NextResponse.json({ success: true, message: `Deletion notification sent for ${targetEmail}` });
    }

    if (action === 'bulk_sync') {
      // Bulk synchronization is strictly administrative
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: 'Forbidden: Bulk synchronization requires admin privileges.' },
          { status: 403 }
        );
      }

      const candidates: any[] = Array.isArray(body.candidates) ? body.candidates : [];
      const syncPromises = candidates.map(async (c) => {
        const url = buildSheetSyncUrl(scriptUrl, c);
        try {
          const res = await fetch(url);
          return res.ok;
        } catch {
          return false;
        }
      });

      const results = await Promise.allSettled(syncPromises);
      const successfulCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;

      return NextResponse.json({ success: true, count: successfulCount, total: candidates.length });
    }

    if (action === 'sync_idcard') {
      const targetEmail = (body.email || '').toLowerCase().trim();
      // Allow if caller is admin OR caller is syncing their own ID card
      const isSelf = targetEmail && targetEmail === callerEmail;
      if (!isAdmin && !isSelf) {
        return NextResponse.json(
          { success: false, error: "Forbidden: You are not authorized to sync another user's ID card." },
          { status: 403 }
        );
      }

      const syncUrl = buildSheetSyncUrl(scriptUrl, body);
      try {
        await fetch(syncUrl);
      } catch (fetchErr) {
        console.error('[ID Card Sheets API] Google Script sync call failed:', fetchErr);
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Invalid or missing action parameter.' }, { status: 400 });
  } catch (err: any) {
    console.error('[ID Card Sheets API] Internal error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Failed to sync to Google Sheets' }, { status: 500 });
  }
}
