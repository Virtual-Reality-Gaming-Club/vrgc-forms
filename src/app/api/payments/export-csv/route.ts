import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { SERVER_CONFIG } from '@/lib/server/config';
import { authenticateRequest } from '@/lib/server/auth';

// Admin authorization: Firestore is the sole source of truth for all normal roles.
// Super Admin env list is checked only for the Super Admin role (env-controlled by design).
async function isAuthorizedAdminEmail(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Super Admin via env (the only env-var-controlled role)
  if (SERVER_CONFIG.SUPER_ADMIN_EMAILS.includes(normalized)) {
    return true;
  }

  // 2. Firestore: admins and super_admins collections (managed by Super Admin Console)
  try {
    const adminDoc = await adminDb.collection('admins').doc(normalized).get();
    if (adminDoc.exists) return true;

    const superDoc = await adminDb.collection('super_admins').doc(normalized).get();
    if (superDoc.exists) return true;
  } catch (err) {
    console.warn('[Payments Export CSV] Firestore admin check notice:', err);
  }

  return false;
}

function verifyExportSecret(adminKey: string | null): boolean {
  const exportSecret = process.env.ADMIN_EXPORT_SECRET;
  if (!exportSecret || !adminKey) return false;
  if (adminKey.length !== exportSecret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(adminKey), Buffer.from(exportSecret));
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawTitle = searchParams.get('title');
    const titleFilter = rawTitle ? rawTitle.trim() : null;

    if (titleFilter && titleFilter.length > 128) {
      return NextResponse.json({ error: 'Invalid title filter parameter.' }, { status: 400 });
    }

    const rawAdminKey = request.headers.get('x-admin-key');
    const adminKey = rawAdminKey && rawAdminKey.length <= 128 ? rawAdminKey.trim() : null;

    // 1. Check server-side export secret header (for automated backups/scripts)
    const isAuthorizedSecret = verifyExportSecret(adminKey);

    if (!isAuthorizedSecret) {
      // 2. Cryptographically verify Firebase ID token via server auth helper
      const { user, errorResponse } = await authenticateRequest(request);
      if (errorResponse) {
        return errorResponse;
      }

      // 3. Verify that the authenticated user's email has admin authorization
      const isAuthorizedAdmin = await isAuthorizedAdminEmail(user.email);
      if (!isAuthorizedAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Access to payment exports requires admin authorization.' },
          { status: 403 }
        );
      }
    }

    const paymentsCol = adminDb.collection('payments');
    const snapshot = titleFilter
      ? await paymentsCol.where('title', '==', titleFilter).get()
      : await paymentsCol.get();
    const payments: any[] = [];

    snapshot.forEach((docSnap) => {
      payments.push({ id: docSnap.id, ...(docSnap.data() as object) });
    });

    // Sort by paid_at descending
    payments.sort((a, b) => {
      const dateA = a.paid_at ? new Date(a.paid_at).getTime() : 0;
      const dateB = b.paid_at ? new Date(b.paid_at).getTime() : 0;
      return dateB - dateA;
    });

    // Construct CSV Header
    const headers = [
      'Payer Email',
      'Payment Title',
      'Category',
      'Amount (INR)',
      'Status',
      'Paid At',
      'Razorpay Payment ID',
      'Razorpay Order ID',
      'Created At',
    ];

    // Format Rows
    const rows = payments.map((p) => [
      `"${p.user_email || ''}"`,
      `"${(p.title || '').replace(/"/g, '""')}"`,
      `"${p.category || ''}"`,
      p.amount,
      p.status,
      `"${p.paid_at ? new Date(p.paid_at).toLocaleString('en-IN') : ''}"`,
      `"${p.razorpay_payment_id || ''}"`,
      `"${p.razorpay_order_id || ''}"`,
      `"${p.created_at?.toDate ? p.created_at.toDate().toLocaleString('en-IN') : (p.created_at ? new Date(p.created_at).toLocaleString('en-IN') : '')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const fileName = titleFilter
      ? `VRGC_Payments_${titleFilter.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.csv`
      : `VRGC_All_Payments_${Date.now()}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'CSV Export failed' }, { status: 500 });
  }
}

