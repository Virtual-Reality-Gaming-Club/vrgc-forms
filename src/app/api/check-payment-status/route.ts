import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { adminDb, hasAdminCredentials } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/server/auth';
import { SERVER_CONFIG } from '@/lib/server/config';

// Admin authorization: Firestore is the sole source of truth for all normal roles.
// Super Admin env list is checked only for the Super Admin role (env-controlled by design).
async function isAuthorizedAdmin(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Super Admin via env (the only env-var-controlled role)
  if (SERVER_CONFIG.SUPER_ADMIN_EMAILS.includes(normalized)) {
    return true;
  }

  // 2. Firestore: admins and super_admins collections (managed by Super Admin Console)
  if (hasAdminCredentials()) {
    try {
      const adminDoc = await adminDb.collection('admins').doc(normalized).get();
      if (adminDoc.exists) return true;

      const superDoc = await adminDb.collection('super_admins').doc(normalized).get();
      if (superDoc.exists) return true;
    } catch (err) {
      console.warn('Admin authorization check notice:', err);
    }
  }

  return false;
}

function parseTimestampMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object' && typeof ts.toMillis === 'function') {
    return ts.toMillis();
  }
  if (typeof ts === 'object' && typeof ts.toDate === 'function') {
    return ts.toDate().getTime();
  }
  if (typeof ts === 'object' && typeof ts.seconds === 'number') {
    return ts.seconds * 1000;
  }
  if (typeof ts === 'object' && typeof ts._seconds === 'number') {
    return ts._seconds * 1000;
  }
  const parsed = new Date(ts).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

async function logTransactionToFirestore(tx: {
  payment_id?: string;
  user_email?: string;
  candidate_name?: string;
  registration_number?: string;
  team?: string;
  payment_title?: string;
  amount?: number;
  currency?: string;
  status: 'Paid' | 'Failed' | 'Pending' | 'Processing';
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  payment_method?: string;
  razorpay_vpa?: string;
  razorpay_bank?: string;
  razorpay_wallet?: string;
  razorpay_contact?: string;
  error_description?: string;
  paid_at?: string;
  failed_at?: string;
}) {
  try {
    if (tx.payment_id) {
      const attemptsCol = adminDb.collection('payments').doc(tx.payment_id).collection('attempts');
      const existingSnap = await attemptsCol.get();
      let duplicateDocRef: any = null;

      existingSnap.forEach((dSnap) => {
        const dData = dSnap.data();
        if (
          dData.status === tx.status &&
          ((tx.razorpay_payment_id && dData.razorpay_payment_id === tx.razorpay_payment_id) ||
            (tx.razorpay_order_id && dData.razorpay_order_id === tx.razorpay_order_id))
        ) {
          duplicateDocRef = dSnap.ref;
        }
      });

      if (duplicateDocRef) {
        await duplicateDocRef.update({
          ...tx,
          updated_at: FieldValue.serverTimestamp(),
        });
      } else {
        await attemptsCol.add({
          ...tx,
          user_email: (tx.user_email || 'unknown').toLowerCase(),
          payment_title: tx.payment_title || 'Unknown Payment',
          amount: tx.amount || 0,
          currency: tx.currency || 'INR',
          failed_at: tx.failed_at || (tx.status === 'Failed' ? new Date().toISOString() : ''),
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
          source: 'vrgc-forms',
        });
      }
    }
  } catch (err) {
    console.warn('Transaction log attempt to Firestore failed:', err);
  }
}

async function processRazorpaySync(
  docs: Array<any>,
  isSingleTarget: boolean = false,
  explicitPaymentId?: string | null
) {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

  if (!keyId || !keySecret) {
    return { success: false, error: 'Razorpay API credentials not configured in environment variables.' };
  }

  const razorpay = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  let correctedCount = 0;
  const repairedDocs: string[] = [];
  let singleDocFinalStatus: string | undefined = undefined;
  let singleDocUpdated = false;
  let singleDocPaymentId: string | undefined = undefined;
  let singleDocMethod: string | undefined = undefined;
  let singleDocPaidAt: string | undefined = undefined;

  // FETCH RECENT CAPTURED PAYMENTS DIRECTLY FROM RAZORPAY API (Count: 100)
  let capturedPayments: any[] = [];
  try {
    const allPaymentsRes: any = await razorpay.payments.all({ count: 100 });
    capturedPayments = (allPaymentsRes?.items || []).filter(
      (p: any) => p.status === 'captured' || p.status === 'authorized'
    );
  } catch (err: any) {
    console.warn('Notice: razorpay.payments.all returned warning:', err?.message || err);
  }

  for (const pDoc of docs) {
    const pData = pDoc.data();
    const docId = pDoc.id;

    // If already Paid with a real Razorpay ID (starts with pay_), skip.
    // BUT if razorpay_payment_id is missing or starts with manual_, WE MUST CHECK RAZORPAY to replace with real transaction!
    const hasManualOrMissingId =
      !pData.razorpay_payment_id || String(pData.razorpay_payment_id).startsWith('manual_');

    if (pData.status === 'Paid' && !hasManualOrMissingId && !explicitPaymentId) {
      if (isSingleTarget) {
        singleDocFinalStatus = 'Paid';
        singleDocPaymentId = pData.razorpay_payment_id;
        singleDocMethod = pData.payment_method;
        singleDocPaidAt = pData.paid_at;
      }
      continue; // Already verified & paid with real Razorpay ID, skip
    }

    const docEmail = (pData.user_email || '').toLowerCase().trim();
    const docCandidateName = (pData.candidate_name || '').toLowerCase().trim();
    const docAmountPaise = Math.round((Number(pData.amount) || 0) * 100);
    const docOrderId = (pData.razorpay_order_id || '').trim();

    // Order IDs pool to check
    const orderIdsToCheck = Array.from(new Set([
      ...(docOrderId ? [docOrderId] : []),
      ...(Array.isArray(pData.order_ids) ? pData.order_ids : []),
    ]));

    // Multimodal Matching: Check captured payments against Firestore document
    const matchingTx = capturedPayments.find((tx: any) => {
      const txEmail = (tx.email || '').toLowerCase().trim();
      const txNotesEmail = (tx.notes?.userEmail || '').toLowerCase().trim();

      // 1. Direct Document ID Match in Notes
      if (tx.notes?.paymentId && String(tx.notes.paymentId).trim() === docId) {
        return true;
      }
      // 2. Order ID Match
      if (docOrderId && tx.order_id && String(tx.order_id).trim() === docOrderId) {
        return true;
      }
      if (tx.order_id && orderIdsToCheck.includes(String(tx.order_id).trim())) {
        return true;
      }
      // 3. Receipt Match
      if (tx.receipt && String(tx.receipt).includes(docId)) {
        return true;
      }
      // 4. Member Email and Amount Match
      if (
        docEmail &&
        txEmail &&
        txEmail === docEmail &&
        Number(tx.amount) === docAmountPaise
      ) {
        return true;
      }
      // 5. Notes userEmail and Amount Match
      if (
        docEmail &&
        txNotesEmail &&
        txNotesEmail === docEmail &&
        Number(tx.amount) === docAmountPaise
      ) {
        return true;
      }
      // 6. Candidate Name and Amount Match (Safeguard: transaction must not contradict member email)
      if (
        docCandidateName &&
        tx.notes?.candidateName &&
        String(tx.notes.candidateName).toLowerCase().trim() === docCandidateName &&
        Number(tx.amount) === docAmountPaise
      ) {
        if (txEmail && docEmail && txEmail !== docEmail) {
          return false;
        }
        if (txNotesEmail && docEmail && txNotesEmail !== docEmail) {
          return false;
        }
        return true;
      }
      return false;
    });

    let activeTx = matchingTx;

    // Check explicit payment ID if provided
    if (!activeTx && explicitPaymentId && explicitPaymentId.startsWith('pay_')) {
      try {
        const fetched = await razorpay.payments.fetch(explicitPaymentId);
        if (fetched && (fetched.status === 'captured' || fetched.status === 'authorized')) {
          activeTx = fetched;
        }
      } catch (err) {
        console.warn(`Failed to fetch explicit payment ID ${explicitPaymentId}:`, err);
      }
    }

    // Check if doc already had a real pay_ ID (e.g. for re-verification)
    if (!activeTx && pData.razorpay_payment_id && String(pData.razorpay_payment_id).startsWith('pay_')) {
      try {
        const fetched = await razorpay.payments.fetch(String(pData.razorpay_payment_id).trim());
        if (fetched && (fetched.status === 'captured' || fetched.status === 'authorized')) {
          activeTx = fetched;
        }
      } catch (err) {
        // ignore
      }
    }

    // Fallback: If not in recent 100 list, query Razorpay order directly by order_id (and order_ids history)
    if (!activeTx && orderIdsToCheck.length > 0) {
      for (const oId of orderIdsToCheck) {
        if (activeTx) break;
        try {
          const orderPayments = await razorpay.orders.fetchPayments(oId);
          const orderCaptured = (orderPayments?.items || []).find(
            (p: any) => p.status === 'captured' || p.status === 'authorized'
          );
          if (orderCaptured) {
            activeTx = orderCaptured;
          }
        } catch (e) {
          // Silently skip if order lookup fails
        }
      }
    }

    if (activeTx) {
      const paidPaymentId = activeTx.id || `pay_${docId}`;
      const paidOrderId = activeTx.order_id || docOrderId || '';
      const rawMethod = String(activeTx.method || 'online').toUpperCase();
      const vpa = String(activeTx.vpa || activeTx.acquirer_data?.upi_transaction_id || '');
      const bank = String(activeTx.bank || '');
      const wallet = String(activeTx.wallet || '');
      const contact = String(activeTx.contact || '');

      const methodDetail = vpa
        ? `Razorpay (UPI: ${vpa})`
        : bank
        ? `Razorpay (${rawMethod}: ${bank})`
        : wallet
        ? `Razorpay (WALLET: ${wallet})`
        : `Razorpay (${rawMethod})`;

      const paidAtTime = activeTx?.created_at
        ? new Date(activeTx.created_at * 1000).toISOString()
        : new Date().toISOString();

      // UPDATE FIRESTORE DOCUMENT WITH EXACT ACCURATE RAZORPAY DETAILS
      if (hasAdminCredentials()) {
        try {
          await pDoc.ref.update({
            status: 'Paid',
            razorpay_order_id: paidOrderId,
            razorpay_payment_id: paidPaymentId,
            payment_method: methodDetail,
            razorpay_vpa: vpa,
            razorpay_bank: bank,
            razorpay_wallet: wallet,
            razorpay_contact: contact,
            paid_at: paidAtTime,
            updated_at: FieldValue.serverTimestamp(),
            error_description: '',
          });

          // Log attempt subdocument
          await logTransactionToFirestore({
            payment_id: docId,
            user_email: docEmail,
            candidate_name: pData.candidate_name || '',
            registration_number: pData.registration_number || '',
            team: pData.team || '',
            payment_title: pData.title || '',
            amount: Number(pData.amount) || 0,
            currency: pData.currency || 'INR',
            status: 'Paid',
            razorpay_order_id: paidOrderId,
            razorpay_payment_id: paidPaymentId,
            payment_method: methodDetail,
            razorpay_vpa: vpa,
            razorpay_bank: bank,
            razorpay_wallet: wallet,
            razorpay_contact: contact,
            paid_at: paidAtTime,
          });
        } catch (dbErr) {
          console.warn('Firestore admin update warning in check-payment-status:', dbErr);
        }
      }

      correctedCount++;
      repairedDocs.push(docId);
      if (isSingleTarget) {
        singleDocFinalStatus = 'Paid';
        singleDocUpdated = true;
        singleDocPaymentId = paidPaymentId;
        singleDocMethod = methodDetail;
        singleDocPaidAt = paidAtTime;
      }
    } else if (pData.status === 'Processing') {
      // Security Check: No captured/authorized payment was found on Razorpay.
      // Evaluate if all order payment attempts failed or if the 12-minute processing session timed out.
      const lastUpdatedMs = parseTimestampMs(pData.updated_at) || parseTimestampMs(pData.created_at);
      const nowMs = Date.now();
      const isStaleTimeout = lastUpdatedMs > 0 && (nowMs - lastUpdatedMs >= 12 * 60 * 1000);

      let allAttemptsFailed = false;
      let failureReason = 'Payment session timed out (exceeded 12 minute checkout window). Please re-attempt.';

      if (orderIdsToCheck.length > 0) {
        for (const oId of orderIdsToCheck) {
          try {
            const orderPayments = await razorpay.orders.fetchPayments(oId);
            const items = orderPayments?.items || [];
            if (items.length > 0) {
              const hasSuccess = items.some((p: any) => p.status === 'captured' || p.status === 'authorized');
              if (!hasSuccess) {
                allAttemptsFailed = true;
                const lastFail = items[0];
                failureReason = lastFail?.error_description || 'Payment attempt failed or was cancelled by candidate (click Re-attempt to try again)';
              }
            }
          } catch (err) {
            console.warn(`Failed to fetch Razorpay order payments for ${oId}:`, err);
          }
        }
      }

      // Transition to Failed ONLY if backend confirms all attempts failed or session is stale (> 12 min)
      if (allAttemptsFailed || isStaleTimeout) {
        const nowIso = new Date().toISOString();
        if (hasAdminCredentials()) {
          try {
            await pDoc.ref.update({
              status: 'Failed',
              failed_at: nowIso,
              error_description: failureReason,
              updated_at: FieldValue.serverTimestamp(),
            });

            await logTransactionToFirestore({
              payment_id: docId,
              user_email: docEmail,
              candidate_name: pData.candidate_name || '',
              registration_number: pData.registration_number || '',
              team: pData.team || '',
              payment_title: pData.title || '',
              amount: Number(pData.amount) || 0,
              currency: pData.currency || 'INR',
              status: 'Failed',
              failed_at: nowIso,
              razorpay_order_id: docOrderId,
              error_description: failureReason,
            });
          } catch (dbErr) {
            console.warn('Firestore admin update warning in check-payment-status timeout:', dbErr);
          }
        }

        correctedCount++;
        repairedDocs.push(docId);
        if (isSingleTarget) {
          singleDocFinalStatus = 'Failed';
          singleDocUpdated = true;
        }
      } else if (isSingleTarget) {
        singleDocFinalStatus = 'Processing';
      }
    } else if (isSingleTarget) {
      singleDocFinalStatus = pData.status || 'Pending';
    }
  }

  const result: any = {
    success: true,
    correctedCount,
    repairedDocs,
    message: `Scanned Razorpay captured payments and corrected ${correctedCount} Firestore record(s) with exact Razorpay details.`,
  };

  if (isSingleTarget) {
    result.status = singleDocFinalStatus;
    result.updated = singleDocUpdated;
    result.razorpay_payment_id = singleDocPaymentId;
    result.payment_method = singleDocMethod;
    result.paid_at = singleDocPaidAt;
  }

  return result;
}

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 32768) {
      return NextResponse.json({ success: false, error: 'Payload too large' }, { status: 413 });
    }

    const body = await request.json().catch(() => ({}));
    const { paymentId, razorpay_order_id, razorpay_payment_id } = body;

    const rawPaymentId = typeof paymentId === 'string' ? paymentId.trim() : null;
    const rawOrderId = typeof razorpay_order_id === 'string' ? razorpay_order_id.trim() : null;
    const rawExplicitPaymentId = typeof razorpay_payment_id === 'string' && razorpay_payment_id.trim()
      ? razorpay_payment_id.trim()
      : null;

    if (rawPaymentId && (rawPaymentId.length > 128 || rawPaymentId.includes('/'))) {
      return NextResponse.json({ success: false, error: 'Invalid paymentId format.' }, { status: 400 });
    }

    if (rawOrderId && (rawOrderId.length > 64 || !/^[A-Za-z0-9_-]{8,64}$/.test(rawOrderId))) {
      return NextResponse.json({ success: false, error: 'Invalid razorpay_order_id format.' }, { status: 400 });
    }

    // Direct Razorpay verification when running without server-side Firebase Admin credentials
    if (!hasAdminCredentials()) {
      const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
      const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

      if (!keyId || !keySecret) {
        return NextResponse.json({
          success: false,
          error: 'Razorpay API credentials not configured on server.',
        }, { status: 500 });
      }

      const razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });

      // 1. Direct explicit payment ID check
      if (rawExplicitPaymentId && rawExplicitPaymentId.startsWith('pay_')) {
        try {
          const fetched: any = await razorpay.payments.fetch(rawExplicitPaymentId);
          if (fetched && (fetched.status === 'captured' || fetched.status === 'authorized')) {
            const rawMethod = String(fetched.method || 'online').toUpperCase();
            const vpa = String(fetched.vpa || fetched.acquirer_data?.upi_transaction_id || '');
            const bank = String(fetched.bank || '');
            const wallet = String(fetched.wallet || '');
            const methodDetail = vpa
              ? `Razorpay (UPI: ${vpa})`
              : bank
              ? `Razorpay (${rawMethod}: ${bank})`
              : wallet
              ? `Razorpay (WALLET: ${wallet})`
              : `Razorpay (${rawMethod})`;

            const paidAtTime = fetched.created_at
              ? new Date(fetched.created_at * 1000).toISOString()
              : new Date().toISOString();

            return NextResponse.json({
              success: true,
              status: 'Paid',
              updated: true,
              razorpay_payment_id: fetched.id,
              payment_method: methodDetail,
              paid_at: paidAtTime,
            });
          }
        } catch {
          // continue
        }
      }

      // 2. Direct order ID check
      if (rawOrderId) {
        try {
          const orderPayments: any = await razorpay.orders.fetchPayments(rawOrderId);
          const orderCaptured = (orderPayments?.items || []).find(
            (p: any) => p.status === 'captured' || p.status === 'authorized'
          );
          if (orderCaptured) {
            const rawMethod = String(orderCaptured.method || 'online').toUpperCase();
            const vpa = String(orderCaptured.vpa || orderCaptured.acquirer_data?.upi_transaction_id || '');
            const bank = String(orderCaptured.bank || '');
            const wallet = String(orderCaptured.wallet || '');
            const methodDetail = vpa
              ? `Razorpay (UPI: ${vpa})`
              : bank
              ? `Razorpay (${rawMethod}: ${bank})`
              : wallet
              ? `Razorpay (WALLET: ${wallet})`
              : `Razorpay (${rawMethod})`;

            const paidAtTime = orderCaptured.created_at
              ? new Date(orderCaptured.created_at * 1000).toISOString()
              : new Date().toISOString();

            return NextResponse.json({
              success: true,
              status: 'Paid',
              updated: true,
              razorpay_payment_id: orderCaptured.id,
              payment_method: methodDetail,
              paid_at: paidAtTime,
            });
          }
        } catch {
          // continue
        }
      }

      // 3. Scan recent captured payments
      if (rawPaymentId) {
        try {
          const allRes: any = await razorpay.payments.all({ count: 50 });
          const match = (allRes?.items || []).find(
            (p: any) =>
              (p.status === 'captured' || p.status === 'authorized') &&
              (p.notes?.paymentId === rawPaymentId || (p.receipt && String(p.receipt).includes(rawPaymentId)))
          );
          if (match) {
            const rawMethod = String(match.method || 'online').toUpperCase();
            const vpa = String(match.vpa || match.acquirer_data?.upi_transaction_id || '');
            const bank = String(match.bank || '');
            const wallet = String(match.wallet || '');
            const methodDetail = vpa
              ? `Razorpay (UPI: ${vpa})`
              : bank
              ? `Razorpay (${rawMethod}: ${bank})`
              : wallet
              ? `Razorpay (WALLET: ${wallet})`
              : `Razorpay (${rawMethod})`;

            const paidAtTime = match.created_at
              ? new Date(match.created_at * 1000).toISOString()
              : new Date().toISOString();

            return NextResponse.json({
              success: true,
              status: 'Paid',
              updated: true,
              razorpay_payment_id: match.id,
              payment_method: methodDetail,
              paid_at: paidAtTime,
            });
          }
        } catch {
          // continue
        }
      }

      return NextResponse.json({
        success: true,
        status: 'Processing',
        updated: false,
        message: 'Checked Razorpay directly. No captured transaction detected.',
      });
    }

    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(request);
    if (errorResponse) {
      return errorResponse;
    }

    const callerEmail = (user.email || '').toLowerCase().trim();
    const callerUid = user.uid;
    const isAdmin = await isAuthorizedAdmin(callerEmail);

    const targetPaymentId = rawPaymentId || null;
    const targetOrderId = rawOrderId || null;

    if (targetPaymentId || targetOrderId) {
      // Single payment target check
      let paymentDocSnap: any = null;
      if (targetPaymentId) {
        const paymentDocRef = adminDb.collection('payments').doc(targetPaymentId);
        paymentDocSnap = await paymentDocRef.get();
      } else if (targetOrderId) {
        const qSnap = await adminDb
          .collection('payments')
          .where('razorpay_order_id', '==', targetOrderId)
          .limit(1)
          .get();
        if (!qSnap.empty) {
          paymentDocSnap = qSnap.docs[0];
        }
      }

      if (!paymentDocSnap || !paymentDocSnap.exists) {
        return NextResponse.json(
          { success: false, error: 'Invoice or payment record not found in database.' },
          { status: 404 }
        );
      }

      const pData = paymentDocSnap.data() || {};
      const docEmail = (pData.user_email || '').toLowerCase().trim();
      const docUserId = pData.user_id ? String(pData.user_id).trim() : null;

      const isOwner = Boolean(
        (docEmail && docEmail === callerEmail) ||
        (docUserId && docUserId === callerUid)
      );

      if (!isOwner && !isAdmin) {
        return NextResponse.json(
          { success: false, error: "Forbidden: You are not authorized to check or update another user's payment." },
          { status: 403 }
        );
      }

      const result = await processRazorpaySync([paymentDocSnap], true, rawExplicitPaymentId);
      return NextResponse.json(result);
    }

    // Broad sync (no specific paymentId or orderId provided)
    let docsToProcess: any[] = [];
    if (isAdmin) {
      // Authoritative admin: process full collection
      const allDocsSnap = await adminDb.collection('payments').get();
      docsToProcess = allDocsSnap.docs;
    } else {
      // Normal authenticated user: scope strictly to payments owned by caller (via user_email or user_id)
      const userDocsMap = new Map<string, any>();
      if (callerEmail) {
        const emailDocsSnap = await adminDb
          .collection('payments')
          .where('user_email', '==', callerEmail)
          .get();
        emailDocsSnap.docs.forEach((doc) => userDocsMap.set(doc.id, doc));
      }
      if (callerUid) {
        const uidDocsSnap = await adminDb
          .collection('payments')
          .where('user_id', '==', callerUid)
          .get();
        uidDocsSnap.docs.forEach((doc) => userDocsMap.set(doc.id, doc));
      }
      docsToProcess = Array.from(userDocsMap.values());
    }

    const result = await processRazorpaySync(docsToProcess, false);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in POST check-payment-status API:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to check Razorpay payment status' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get('paymentId');
    const razorpayOrderId = searchParams.get('razorpay_order_id');
    const razorpayPaymentId = searchParams.get('razorpay_payment_id');

    const rawPaymentId = paymentId ? paymentId.trim() : null;
    const rawOrderId = razorpayOrderId ? razorpayOrderId.trim() : null;
    const rawExplicitPaymentId = razorpayPaymentId ? razorpayPaymentId.trim() : null;

    if (rawPaymentId && (rawPaymentId.length > 128 || rawPaymentId.includes('/'))) {
      return NextResponse.json({ success: false, error: 'Invalid paymentId format.' }, { status: 400 });
    }

    if (rawOrderId && (rawOrderId.length > 64 || !/^[A-Za-z0-9_-]{8,64}$/.test(rawOrderId))) {
      return NextResponse.json({ success: false, error: 'Invalid razorpay_order_id format.' }, { status: 400 });
    }

    // Direct Razorpay verification when running without server-side Firebase Admin credentials
    if (!hasAdminCredentials()) {
      const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
      const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

      if (!keyId || !keySecret) {
        return NextResponse.json({
          success: false,
          error: 'Razorpay API credentials not configured on server.',
        }, { status: 500 });
      }

      const razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });

      if (rawExplicitPaymentId && rawExplicitPaymentId.startsWith('pay_')) {
        try {
          const fetched: any = await razorpay.payments.fetch(rawExplicitPaymentId);
          if (fetched && (fetched.status === 'captured' || fetched.status === 'authorized')) {
            const rawMethod = String(fetched.method || 'online').toUpperCase();
            const vpa = String(fetched.vpa || fetched.acquirer_data?.upi_transaction_id || '');
            const bank = String(fetched.bank || '');
            const wallet = String(fetched.wallet || '');
            const methodDetail = vpa
              ? `Razorpay (UPI: ${vpa})`
              : bank
              ? `Razorpay (${rawMethod}: ${bank})`
              : wallet
              ? `Razorpay (WALLET: ${wallet})`
              : `Razorpay (${rawMethod})`;

            const paidAtTime = fetched.created_at
              ? new Date(fetched.created_at * 1000).toISOString()
              : new Date().toISOString();

            return NextResponse.json({
              success: true,
              status: 'Paid',
              updated: true,
              razorpay_payment_id: fetched.id,
              payment_method: methodDetail,
              paid_at: paidAtTime,
            });
          }
        } catch {
          // continue
        }
      }

      if (rawOrderId) {
        try {
          const orderPayments: any = await razorpay.orders.fetchPayments(rawOrderId);
          const orderCaptured = (orderPayments?.items || []).find(
            (p: any) => p.status === 'captured' || p.status === 'authorized'
          );
          if (orderCaptured) {
            const rawMethod = String(orderCaptured.method || 'online').toUpperCase();
            const vpa = String(orderCaptured.vpa || orderCaptured.acquirer_data?.upi_transaction_id || '');
            const bank = String(orderCaptured.bank || '');
            const wallet = String(orderCaptured.wallet || '');
            const methodDetail = vpa
              ? `Razorpay (UPI: ${vpa})`
              : bank
              ? `Razorpay (${rawMethod}: ${bank})`
              : wallet
              ? `Razorpay (WALLET: ${wallet})`
              : `Razorpay (${rawMethod})`;

            const paidAtTime = orderCaptured.created_at
              ? new Date(orderCaptured.created_at * 1000).toISOString()
              : new Date().toISOString();

            return NextResponse.json({
              success: true,
              status: 'Paid',
              updated: true,
              razorpay_payment_id: orderCaptured.id,
              payment_method: methodDetail,
              paid_at: paidAtTime,
            });
          }
        } catch {
          // continue
        }
      }

      return NextResponse.json({
        success: true,
        status: 'Processing',
        updated: false,
        message: 'Checked Razorpay directly. No captured transaction detected.',
      });
    }

    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(request);
    if (errorResponse) {
      return errorResponse;
    }

    const targetPaymentId = rawPaymentId || null;
    const targetOrderId = rawOrderId || null;

    const callerEmail = (user.email || '').toLowerCase().trim();
    const callerUid = user.uid;
    const isAdmin = await isAuthorizedAdmin(callerEmail);

    if (targetPaymentId || targetOrderId) {
      // Single payment target check
      let paymentDocSnap: any = null;
      if (targetPaymentId) {
        const paymentDocRef = adminDb.collection('payments').doc(targetPaymentId);
        paymentDocSnap = await paymentDocRef.get();
      } else if (targetOrderId) {
        const qSnap = await adminDb
          .collection('payments')
          .where('razorpay_order_id', '==', targetOrderId)
          .limit(1)
          .get();
        if (!qSnap.empty) {
          paymentDocSnap = qSnap.docs[0];
        }
      }

      if (!paymentDocSnap || !paymentDocSnap.exists) {
        return NextResponse.json(
          { success: false, error: 'Invoice or payment record not found in database.' },
          { status: 404 }
        );
      }

      const pData = paymentDocSnap.data() || {};
      const docEmail = (pData.user_email || '').toLowerCase().trim();
      const docUserId = pData.user_id ? String(pData.user_id).trim() : null;

      const isOwner = Boolean(
        (docEmail && docEmail === callerEmail) ||
        (docUserId && docUserId === callerUid)
      );

      if (!isOwner && !isAdmin) {
        return NextResponse.json(
          { success: false, error: "Forbidden: You are not authorized to check or update another user's payment." },
          { status: 403 }
        );
      }

      const result = await processRazorpaySync([paymentDocSnap], true, rawExplicitPaymentId);
      return NextResponse.json(result);
    }

    // Broad sync on GET:
    let docsToProcess: any[] = [];
    if (isAdmin) {
      // Authoritative admin: process full collection
      const allDocsSnap = await adminDb.collection('payments').get();
      docsToProcess = allDocsSnap.docs;
    } else {
      // Normal authenticated user: scope strictly to payments owned by caller (via user_email or user_id)
      const userDocsMap = new Map<string, any>();
      if (callerEmail) {
        const emailDocsSnap = await adminDb
          .collection('payments')
          .where('user_email', '==', callerEmail)
          .get();
        emailDocsSnap.docs.forEach((doc) => userDocsMap.set(doc.id, doc));
      }
      if (callerUid) {
        const uidDocsSnap = await adminDb
          .collection('payments')
          .where('user_id', '==', callerUid)
          .get();
        uidDocsSnap.docs.forEach((doc) => userDocsMap.set(doc.id, doc));
      }
      docsToProcess = Array.from(userDocsMap.values());
    }

    const result = await processRazorpaySync(docsToProcess, false);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in GET check-payment-status API:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to check Razorpay payment status' },
      { status: 500 }
    );
  }
}
