import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { db } from '@/lib/firebase';
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  serverTimestamp,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { authenticateRequest } from '@/lib/server/auth';
import { CONFIG } from '@/lib/config';

async function isAuthorizedAdmin(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // 1. Authoritative server configuration lists
  if (
    CONFIG.ADMIN_EMAILS.includes(normalized) ||
    CONFIG.SUPER_ADMIN_EMAILS.includes(normalized) ||
    CONFIG.PAYMENT_ADMIN_EMAILS.includes(normalized)
  ) {
    return true;
  }

  // 2. Dynamic Firestore admin collections
  try {
    const adminDoc = await getDoc(doc(db, 'admins', normalized));
    if (adminDoc.exists()) return true;

    const superDoc = await getDoc(doc(db, 'super_admins', normalized));
    if (superDoc.exists()) return true;
  } catch (err) {
    console.warn('Admin authorization check notice:', err);
  }

  return false;
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
      const attemptsCol = collection(db, 'payments', tx.payment_id, 'attempts');
      const existingSnap = await getDocs(attemptsCol);
      let duplicateDocRef = null;

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
        await updateDoc(duplicateDocRef, {
          ...tx,
          updated_at: serverTimestamp(),
        });
      } else {
        await addDoc(attemptsCol, {
          ...tx,
          user_email: (tx.user_email || 'unknown').toLowerCase(),
          payment_title: tx.payment_title || 'Unknown Payment',
          amount: tx.amount || 0,
          currency: tx.currency || 'INR',
          failed_at: tx.failed_at || (tx.status === 'Failed' ? new Date().toISOString() : ''),
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          source: 'vrgc-forms',
        });
      }
    }
  } catch (err) {
    console.warn('Transaction log attempt to Firestore failed:', err);
  }
}

async function processRazorpaySync(docs: Array<any>, isSingleTarget: boolean = false) {
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

  // FETCH RECENT CAPTURED PAYMENTS DIRECTLY FROM RAZORPAY API (Count: 100)
  const allPaymentsRes = await razorpay.payments.all({ count: 100 });
  const capturedPayments = (allPaymentsRes?.items || []).filter(
    (p: any) => p.status === 'captured' || p.status === 'authorized'
  );

  for (const pDoc of docs) {
    const pData = pDoc.data();
    const docId = pDoc.id;

    if (pData.status === 'Paid') {
      if (isSingleTarget) {
        singleDocFinalStatus = 'Paid';
      }
      continue; // Already verified & paid, skip
    }

    const docEmail = (pData.user_email || '').toLowerCase().trim();
    const docCandidateName = (pData.candidate_name || '').toLowerCase().trim();
    const docAmountPaise = Math.round((Number(pData.amount) || 0) * 100);
    const docOrderId = (pData.razorpay_order_id || '').trim();

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
      // 3. Member Email and Amount Match
      if (
        docEmail &&
        txEmail &&
        txEmail === docEmail &&
        Number(tx.amount) === docAmountPaise
      ) {
        return true;
      }
      // 4. Notes userEmail and Amount Match
      if (
        docEmail &&
        txNotesEmail &&
        txNotesEmail === docEmail &&
        Number(tx.amount) === docAmountPaise
      ) {
        return true;
      }
      // 5. Candidate Name and Amount Match (Safeguard: transaction must not contradict member email)
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

    // Fallback: If not in recent 100 list, query Razorpay order directly by order_id if present
    if (!activeTx && docOrderId) {
      try {
        const orderPayments = await razorpay.orders.fetchPayments(docOrderId);
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

      const paidAtTime = matchingTx?.created_at
        ? new Date(matchingTx.created_at * 1000).toISOString()
        : new Date().toISOString();

      // UPDATE FIRESTORE DOCUMENT WITH EXACT ACCURATE RAZORPAY DETAILS
      await updateDoc(pDoc.ref, {
        status: 'Paid',
        razorpay_order_id: paidOrderId,
        razorpay_payment_id: paidPaymentId,
        payment_method: methodDetail,
        razorpay_vpa: vpa,
        razorpay_bank: bank,
        razorpay_wallet: wallet,
        razorpay_contact: contact,
        paid_at: paidAtTime,
        updated_at: serverTimestamp(),
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

      correctedCount++;
      repairedDocs.push(docId);
      if (isSingleTarget) {
        singleDocFinalStatus = 'Paid';
        singleDocUpdated = true;
      }
    } else if (pData.status === 'Processing') {
      // Security Check: No captured/authorized payment was found on Razorpay.
      // Evaluate if all order payment attempts failed or if the 12-minute processing session timed out.
      const lastUpdatedIso = pData.updated_at?.toDate ? pData.updated_at.toDate().toISOString() : pData.updated_at || pData.created_at || '';
      const lastUpdatedMs = lastUpdatedIso ? new Date(lastUpdatedIso).getTime() : 0;
      const nowMs = Date.now();
      const isStaleTimeout = lastUpdatedMs > 0 && (nowMs - lastUpdatedMs >= 12 * 60 * 1000);

      let allAttemptsFailed = false;
      let failureReason = 'Payment session timed out (exceeded 12 minute checkout window). Please re-attempt.';

      if (docOrderId) {
        try {
          const orderPayments = await razorpay.orders.fetchPayments(docOrderId);
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
          console.warn(`Failed to fetch Razorpay order payments for ${docOrderId}:`, err);
        }
      }

      // Transition to Failed ONLY if backend confirms all attempts failed or session is stale
      if (allAttemptsFailed || isStaleTimeout) {
        const nowIso = new Date().toISOString();
        await updateDoc(pDoc.ref, {
          status: 'Failed',
          failed_at: nowIso,
          error_description: failureReason,
          updated_at: serverTimestamp(),
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
  }

  return result;
}

export async function POST(request: Request) {
  try {
    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(request);
    if (errorResponse) {
      return errorResponse;
    }

    const body = await request.json().catch(() => ({}));
    const { paymentId } = body;

    const callerEmail = (user.email || '').toLowerCase().trim();
    const callerUid = user.uid;
    const isAdmin = await isAuthorizedAdmin(callerEmail);

    if (paymentId) {
      // Single payment target check
      const paymentDocRef = doc(db, 'payments', String(paymentId));
      const paymentDocSnap = await getDoc(paymentDocRef);

      if (!paymentDocSnap.exists()) {
        return NextResponse.json(
          { success: false, error: 'Invoice or payment record not found in database.' },
          { status: 404 }
        );
      }

      const pData = paymentDocSnap.data();
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

      const result = await processRazorpaySync([paymentDocSnap], true);
      return NextResponse.json(result);
    }

    // Broad sync (no specific paymentId provided)
    let docsToProcess: any[] = [];
    if (isAdmin) {
      // Authoritative admin: process full collection
      const allDocsSnap = await getDocs(collection(db, 'payments'));
      docsToProcess = allDocsSnap.docs;
    } else {
      // Normal authenticated user: scope strictly to payments owned by caller
      const userPaymentsQuery = query(
        collection(db, 'payments'),
        where('user_email', '==', callerEmail)
      );
      const userDocsSnap = await getDocs(userPaymentsQuery);
      docsToProcess = userDocsSnap.docs;
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
    // 1. Cryptographically verify Firebase ID token
    const { user, errorResponse } = await authenticateRequest(request);
    if (errorResponse) {
      return errorResponse;
    }

    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get('paymentId');

    const callerEmail = (user.email || '').toLowerCase().trim();
    const callerUid = user.uid;
    const isAdmin = await isAuthorizedAdmin(callerEmail);

    if (paymentId) {
      // Single payment target check
      const paymentDocRef = doc(db, 'payments', String(paymentId));
      const paymentDocSnap = await getDoc(paymentDocRef);

      if (!paymentDocSnap.exists()) {
        return NextResponse.json(
          { success: false, error: 'Invoice or payment record not found in database.' },
          { status: 404 }
        );
      }

      const pData = paymentDocSnap.data();
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

      const result = await processRazorpaySync([paymentDocSnap], true);
      return NextResponse.json(result);
    }

    // Broad sync on GET requires admin privileges (prevents payment enumeration across users)
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Full payment status synchronization requires admin privileges.' },
        { status: 403 }
      );
    }

    const allDocsSnap = await getDocs(collection(db, 'payments'));
    const result = await processRazorpaySync(allDocsSnap.docs, false);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in GET check-payment-status API:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to check Razorpay payment status' },
      { status: 500 }
    );
  }
}
