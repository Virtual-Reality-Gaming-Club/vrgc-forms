import { authDb as db } from './firebase';
import {
  collection,
  addDoc,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { PaymentItem, PaymentStatus } from '@/types/payment';

// ─── Firestore Collection Names ───────────────────────────────────────────────
export const PAYMENTS_COLLECTION = 'payments';
export const INVOICES_COLLECTION = 'payments';

// ─── Transaction / Invoice Log Type ──────────────────────────────────────────
export interface TransactionLog {
  id: string;
  payment_id?: string;
  user_email: string;
  candidate_name?: string;
  registration_number?: string;
  team?: string;
  payment_title: string;
  amount: number;
  currency: string;
  status: 'Pending' | 'Paid' | 'Failed' | 'Cancelled' | 'Processing';
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  payment_method?: string;
  error_description?: string;
  paid_at?: string;
  failed_at?: string;
  created_at: string;
  updated_at?: string;
}

/**
 * Helper function to determine the real, accurate event timestamp for a transaction log.
 * - Pending: Invoice generation time (created_at)
 * - Paid: Payment confirmation time (paid_at || updated_at || created_at)
 * - Failed / Cancelled: Failure timestamp (failed_at || updated_at || created_at)
 * - Processing: Session update time (updated_at || created_at)
 */
export function getLogEventTimestamp(log: {
  status: string;
  created_at: string;
  paid_at?: string;
  failed_at?: string;
  updated_at?: string;
}): string {
  if (log.status === 'Paid') {
    return log.paid_at || log.updated_at || log.created_at;
  }
  if (log.status === 'Failed' || log.status === 'Cancelled') {
    return log.failed_at || log.updated_at || log.created_at;
  }
  if (log.status === 'Processing') {
    return log.updated_at || log.created_at;
  }
  return log.created_at;
}

// ─── Sample Data ──────────────────────────────────────────────────────────────
export const SAMPLE_PAYMENTS: Omit<PaymentItem, 'id' | 'created_at'>[] = [
  {
    title: "VRGC Membership Fee 2026",
    description: "Annual club membership fee covering VR lab access, discord perks, and workshop priority.",
    category: "Club Fee",
    amount: 500,
    currency: "INR",
    status: "Pending",
    due_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    title: "Cyberpunk Game Jam '26 Pass",
    description: "Registration ticket for the upcoming 48-hour Game Development & VR Hackathon.",
    category: "Event Registration",
    amount: 150,
    currency: "INR",
    status: "Pending",
    due_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    title: "VRGC Cyber Hoodie (Limited Ed.)",
    description: "Official club oversized hoodie with embroidered glow-in-the-dark VRGC insignia.",
    category: "Merchandise",
    amount: 899,
    currency: "INR",
    status: "Pending",
    due_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    title: "VR Lab Equipment Late Fee",
    description: "Overdue return charge for Meta Quest 3 headset (1 day extension).",
    category: "Fine",
    amount: 50,
    currency: "INR",
    status: "Pending",
    due_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  }
];

export const PROCESSING_TIMEOUT_MS = 12 * 60 * 1000; // 12 minutes

/**
 * Verify payment status directly against Razorpay API to prevent false timeout failures.
 */
export async function syncPaymentStatusWithRazorpay(
  paymentId?: string,
  razorpayOrderId?: string,
  syncAll: boolean = false
): Promise<{ success: boolean; status?: string; updated?: boolean; syncedCount?: number; correctedCount?: number }> {
  try {
    const res = await fetch('/api/check-payment-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentId,
        razorpay_order_id: razorpayOrderId,
        syncAll,
      }),
    });
    if (res.ok) {
      return await res.json();
    }
    return { success: false };
  } catch (err) {
    console.warn('Failed to sync payment status with Razorpay:', err);
    return { success: false };
  }
}

/**
 * Derived/Computed state helper: Checks if an unpaid invoice has passed its due date.
 * Does NOT alter the underlying database status.
 */
export function isInvoiceExpired(item: { status?: string; due_date?: string } | null | undefined): boolean {
  if (!item || !item.due_date || item.status === 'Paid') {
    return false;
  }
  const dueMs = new Date(item.due_date).getTime();
  return !isNaN(dueMs) && Date.now() > dueMs;
}

/**
 * Security-checked helper to auto-expire processing payment sessions that exceed 12 minutes.
 * CRITICAL SECURITY GUARANTEE:
 * 1. Never touch or alter any payment with status === 'Paid'.
 * 2. If razorpay_order_id exists, MUST check Razorpay API first before marking as Failed!
 */
export function checkProcessingTimeout(item: PaymentItem): PaymentItem {
  if (!item || item.status !== 'Processing') {
    return item;
  }

  const lastUpdatedIso = item.updated_at || item.created_at;
  const lastUpdatedMs = lastUpdatedIso ? new Date(lastUpdatedIso).getTime() : 0;
  const nowMs = Date.now();

  if (lastUpdatedMs > 0 && nowMs - lastUpdatedMs >= PROCESSING_TIMEOUT_MS) {
    if (item.razorpay_order_id) {
      // Trigger background status check with Razorpay API to prevent false failures for completed payments
      syncPaymentStatusWithRazorpay(item.id, item.razorpay_order_id).catch((err) =>
        console.warn('Background Razorpay status check warning:', err)
      );
    } else {
      const expiredDesc = 'Payment session timed out (12 minute limit exceeded). Please re-attempt payment.';
      const nowIso = new Date().toISOString();

      // Asynchronously sync Firestore document and attempt history without blocking caller
      updatePaymentStatusInFirestore(item.id, {
        status: 'Failed',
        failed_at: nowIso,
        error_description: expiredDesc,
      }).catch((err) => console.warn('Failed to sync expired processing status in Firestore:', err));

      saveTransactionToFirestore({
        payment_id: item.id,
        user_email: item.user_email,
        candidate_name: item.candidate_name,
        registration_number: item.registration_number,
        team: item.team,
        payment_title: item.title,
        amount: item.amount,
        currency: item.currency || 'INR',
        status: 'Failed',
        failed_at: nowIso,
        error_description: expiredDesc,
      }).catch((err) => console.warn('Failed to log expired transaction attempt in Firestore:', err));

      return {
        ...item,
        status: 'Failed',
        failed_at: nowIso,
        error_description: expiredDesc,
      };
    }
  }

  return item;
}

// ─── Firestore Payments CRUD Operations ────────────────────────────────────────

/**
 * Fetch payments from Firestore `invoices` collection.
 * Non-destructive: read-only query.
 */
export async function fetchPaymentsFromFirestore(
  userEmail?: string,
  isAdmin: boolean = false
): Promise<PaymentItem[]> {
  try {
    const colRef = collection(db, INVOICES_COLLECTION);
    let q;

    if (!isAdmin && userEmail && userEmail.trim()) {
      q = query(colRef, where('user_email', '==', userEmail.toLowerCase()));
    } else {
      q = query(colRef);
    }

    const snapshot = await getDocs(q);
    const items: PaymentItem[] = [];

    snapshot.forEach((docSnap) => {
      const data: any = docSnap.data();
      const createdAtIso = data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at || new Date().toISOString();
      const updatedAtIso = data.updated_at?.toDate ? data.updated_at.toDate().toISOString() : data.updated_at || new Date().toISOString();
      const status: PaymentStatus = (data.status as PaymentStatus) || 'Pending';
      const errorDesc = data.error_description || '';

      const rawItem: PaymentItem = {
        id: docSnap.id,
        user_email: data.user_email || '',
        candidate_name: data.candidate_name || data.user_name || '',
        registration_number: data.registration_number || data.regNo || '',
        team: data.team || '',
        title: data.title || '',
        description: data.description || '',
        category: data.category || 'Club Fee',
        amount: Number(data.amount) || 0,
        currency: data.currency || 'INR',
        status,
        due_date: data.due_date || '',
        razorpay_order_id: data.razorpay_order_id || '',
        razorpay_payment_id: data.razorpay_payment_id || '',
        razorpay_signature: data.razorpay_signature || '',
        error_description: errorDesc,
        paid_at: data.paid_at || '',
        failed_at: data.failed_at || '',
        visible_to_faculty: data.visible_to_faculty !== undefined ? !!data.visible_to_faculty : true,
        created_at: createdAtIso,
        updated_at: updatedAtIso,
      };

      items.push(checkProcessingTimeout(rawItem));
    });

    // Client-side sort by created_at descending
    return items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (err) {
    console.error('Failed to fetch payments from Firestore:', err);
    return [];
  }
}

/**
 * Toggle faculty visibility for a specific payment invoice.
 */
export async function togglePaymentFacultyVisibility(
  paymentId: string,
  visibleToFaculty: boolean
): Promise<boolean> {
  try {
    const docRef = doc(db, INVOICES_COLLECTION, paymentId);
    await updateDoc(docRef, {
      visible_to_faculty: visibleToFaculty,
      updated_at: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.error('Failed to toggle faculty visibility:', err);
    return false;
  }
}

/**
 * Update editable invoice properties (Title, Description, Due Date/Time, Visible to Faculty).
 * Amount is intentionally excluded/immutable.
 */
export async function updateInvoiceDetailsInFirestore(
  paymentId: string,
  updates: {
    title?: string;
    description?: string;
    due_date?: string;
    visible_to_faculty?: boolean;
  }
): Promise<boolean> {
  try {
    const docRef = doc(db, INVOICES_COLLECTION, paymentId);
    await updateDoc(docRef, {
      ...updates,
      updated_at: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.error('Failed to update invoice details in Firestore:', err);
    return false;
  }
}

/**
 * Batch update editable invoice properties across multiple payment documents in Firestore.
 * Strictly operates on the provided payment document IDs for exact isolation.
 * Amount is intentionally excluded/immutable.
 */
export async function batchUpdateCampaignInFirestore(
  paymentIds: string[],
  updates: {
    title?: string;
    description?: string;
    due_date?: string;
    visible_to_faculty?: boolean;
  }
): Promise<boolean> {
  try {
    const targetDocIds = Array.from(new Set((paymentIds || []).filter(Boolean)));
    if (targetDocIds.length === 0) return true;

    // Process in batches of 450 (Firestore batch limit is 500 operations)
    const chunkSize = 450;
    for (let i = 0; i < targetDocIds.length; i += chunkSize) {
      const chunk = targetDocIds.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach((id) => {
        const docRef = doc(db, INVOICES_COLLECTION, id);
        batch.update(docRef, {
          ...updates,
          updated_at: serverTimestamp(),
        });
      });
      await batch.commit();
    }
    return true;
  } catch (err) {
    console.error('Failed to batch update campaign in Firestore via writeBatch:', err);
    try {
      const fallbackIds = Array.from(new Set((paymentIds || []).filter(Boolean)));
      const promises = fallbackIds.map((id) =>
        updateDoc(doc(db, INVOICES_COLLECTION, id), {
          ...updates,
          updated_at: serverTimestamp(),
        })
      );
      await Promise.allSettled(promises);
      return true;
    } catch (fallbackErr) {
      console.error('Fallback update failed:', fallbackErr);
      return false;
    }
  }
}

/**
 * Toggle faculty visibility for an entire campaign across all its invoice records in Firestore.
 */
export async function toggleCampaignFacultyVisibility(
  paymentIds: string[],
  visibleToFaculty: boolean
): Promise<boolean> {
  return batchUpdateCampaignInFirestore(paymentIds, {
    visible_to_faculty: visibleToFaculty,
  });
}

/**
 * Create a SINGLE payment invoice record in Firestore `invoices` collection.
 */
export async function createPaymentInFirestore(
  paymentData: Omit<PaymentItem, 'id' | 'created_at'> & {
    created_at?: string;
    candidate_name?: string;
    registration_number?: string;
    team?: string;
  }
): Promise<PaymentItem | null> {
  try {
    const nowMs = Date.now();
    const createdDate = paymentData.created_at ? new Date(paymentData.created_at) : new Date(nowMs);
    const nowIso = createdDate.toISOString();
    const cleanEmail = paymentData.user_email ? paymentData.user_email.toLowerCase() : '';

    const genTimeStr = createdDate.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const defaultDueDate = paymentData.due_date
      ? paymentData.due_date
      : new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();

    const dueTimeStr = new Date(defaultDueDate).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const genTimeOnlyStr = createdDate.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).toLowerCase();

    const invoiceNoticeMsg = `⚠️ IMPORTANT: This invoice was generated at ${genTimeOnlyStr} and will AUTOMATICALLY EXPIRE after the due date. Please complete your payment before expiration.`;
    const userDescription = paymentData.description ? paymentData.description.trim() : '';
    const fullDescription = userDescription
      ? (userDescription.includes('AUTOMATICALLY EXPIRE') || userDescription.includes('IMPORTANT:')
          ? userDescription
          : `${userDescription}\n\n${invoiceNoticeMsg}`)
      : invoiceNoticeMsg;
    
    // Create EXACTLY 1 document in `invoices` collection
    const docRef = await addDoc(collection(db, INVOICES_COLLECTION), {
      ...paymentData,
      description: fullDescription,
      due_date: defaultDueDate,
      user_email: cleanEmail,
      candidate_name: paymentData.candidate_name || '',
      registration_number: paymentData.registration_number || '',
      team: paymentData.team || '',
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      source: 'vrgc-forms',
    });

    const newPayment: PaymentItem = {
      ...paymentData,
      id: docRef.id,
      description: fullDescription,
      due_date: defaultDueDate,
      user_email: cleanEmail,
      candidate_name: paymentData.candidate_name || '',
      registration_number: paymentData.registration_number || '',
      team: paymentData.team || '',
      category: paymentData.category as any,
      created_at: paymentData.created_at || nowIso,
      updated_at: nowIso,
    };

    // Send email notification to user via Resend API
    if (cleanEmail && cleanEmail.includes('@')) {
      const resendApiKey = process.env.RESEND_API_KEY || process.env.NEXT_PUBLIC_RESEND_API_KEY;
      const invoiceEmailText = `
--------------------------------------------------
VRGC PAYMENT INVOICE GENERATED
--------------------------------------------------

INVOICE ID        : ${docRef.id}
ITEM / TITLE      : ${paymentData.title}
AMOUNT DUE        : ₹${paymentData.amount} INR
CATEGORY          : ${paymentData.category}
INVOICE GENERATED : ${genTimeStr}
DUE DATE          : ${dueTimeStr}

--------------------------------------------------
Please log in to your VRGC Forms portal to complete your payment before the due date.
--------------------------------------------------
Automated message sent via VRGC Command Center
`;
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: "VRGC Billing Desk <onboarding@resend.dev>",
          to: ["vrgcdev@gmail.com"], // In Resend test mode sends to account email; with verified domain sends to cleanEmail
          subject: `VRGC Invoice Issued: ₹${paymentData.amount} (Due: ${dueTimeStr})`,
          text: invoiceEmailText,
          reply_to: cleanEmail,
        }),
      }).catch((e) => console.warn('Invoice email dispatch warning:', e));
    }

    // Log initial creation attempt inside subcollection `invoices/{id}/attempts`
    try {
      const attemptsColRef = collection(db, INVOICES_COLLECTION, docRef.id, 'attempts');
      await addDoc(attemptsColRef, {
        payment_id: docRef.id,
        user_email: cleanEmail,
        candidate_name: paymentData.candidate_name || '',
        registration_number: paymentData.registration_number || '',
        team: paymentData.team || '',
        payment_title: paymentData.title,
        amount: paymentData.amount,
        currency: paymentData.currency || 'INR',
        status: paymentData.status,
        error_description: 'Invoice issued',
        timestamp: serverTimestamp(),
        created_at: nowIso,
      });
    } catch (e) {
      console.warn('Subcollection attempt log warning:', e);
    }

    return newPayment;
  } catch (err) {
    console.error('Firestore payment create failed:', err);
    return null;
  }
}

/**
 * Update payment status & details in Firestore `invoices` collection.
 */
export async function updatePaymentStatusInFirestore(
  paymentId: string,
  updates: Partial<PaymentItem>
): Promise<boolean> {
  try {
    const docRef = doc(db, INVOICES_COLLECTION, paymentId);
    const nowIso = new Date().toISOString();
    const finalUpdates: any = {
      ...updates,
      updated_at: serverTimestamp(),
    };
    if (updates.status === 'Paid' && !updates.paid_at) {
      finalUpdates.paid_at = nowIso;
    }
    if ((updates.status === 'Failed' || updates.status === 'Cancelled') && !updates.failed_at) {
      finalUpdates.failed_at = nowIso;
    }
    await updateDoc(docRef, finalUpdates);
    return true;
  } catch (err) {
    console.error('Failed to update payment status in Firestore:', err);
    return false;
  }
}

/**
 * Delete a payment record from Firestore `invoices` collection.
 */
export async function deletePaymentFromFirestore(paymentId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, INVOICES_COLLECTION, paymentId));
    return true;
  } catch (err) {
    console.error('Error deleting payment from Firestore:', err);
    return false;
  }
}

/**
 * Batch delete all invoice records for an entire campaign from Firestore.
 * Executed in writeBatch chunks of 450 for high performance without locking the UI.
 * Strictly operates on the provided payment document IDs for exact isolation.
 */
export async function batchDeleteCampaignFromFirestore(
  paymentIds: string[]
): Promise<boolean> {
  try {
    const targetDocIds = Array.from(new Set((paymentIds || []).filter(Boolean)));
    if (targetDocIds.length === 0) return true;

    const chunkSize = 450;
    for (let i = 0; i < targetDocIds.length; i += chunkSize) {
      const chunk = targetDocIds.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach((id) => {
        batch.delete(doc(db, INVOICES_COLLECTION, id));
      });
      await batch.commit();
    }
    return true;
  } catch (err) {
    console.error('Failed to batch delete campaign from Firestore:', err);
    try {
      const fallbackIds = Array.from(new Set((paymentIds || []).filter(Boolean)));
      const promises = fallbackIds.map((id) => deleteDoc(doc(db, INVOICES_COLLECTION, id)));
      await Promise.allSettled(promises);
      return true;
    } catch (fallbackErr) {
      console.error('Fallback delete failed:', fallbackErr);
      return false;
    }
  }
}

// ─── Firestore Invoices & Transaction Logs ─────────────────────────────────────

/**
 * Save a payment invoice record to Firestore `invoices` collection.
 */
export async function saveInvoiceToFirestore(invoice: {
  payment_id?: string;
  user_email: string;
  candidate_name?: string;
  registration_number?: string;
  team?: string;
  title: string;
  description?: string;
  category: string;
  amount: number;
  currency?: string;
  status: PaymentStatus;
  due_date?: string;
}): Promise<string | null> {
  return invoice.payment_id || null;
}

/**
 * Save a completed, failed, or cancelled payment transaction log to Firestore `invoices` collection
 * AND subcollection `attempts` on the payment document.
 */
export async function saveTransactionToFirestore(tx: {
  payment_id?: string;
  user_email: string;
  candidate_name?: string;
  registration_number?: string;
  team?: string;
  payment_title: string;
  amount: number;
  currency?: string;
  status: 'Paid' | 'Failed' | 'Pending' | 'Processing' | 'Cancelled';
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
  payment_method?: string;
  error_description?: string;
  paid_at?: string;
  failed_at?: string;
}): Promise<string | null> {
  try {
    const cleanEmail = tx.user_email ? tx.user_email.toLowerCase() : '';
    const nowIso = new Date().toISOString();
    if (tx.payment_id) {
      const paidAtVal = tx.paid_at || (tx.status === 'Paid' ? nowIso : '');
      const failedAtVal = tx.failed_at || (tx.status === 'Failed' || tx.status === 'Cancelled' ? nowIso : '');

      // 1. Update primary payment status in main `invoices` doc
      await updatePaymentStatusInFirestore(tx.payment_id, {
        status: tx.status as PaymentStatus,
        razorpay_order_id: tx.razorpay_order_id || '',
        razorpay_payment_id: tx.razorpay_payment_id || '',
        razorpay_signature: tx.razorpay_signature || '',
        paid_at: paidAtVal,
        failed_at: failedAtVal,
        ...(tx.error_description ? { error_description: tx.error_description } : {}),
      });

      // 2. Log payment attempt entry to subcollection `invoices/{payment_id}/attempts`
      const attemptsColRef = collection(db, INVOICES_COLLECTION, tx.payment_id, 'attempts');
      await addDoc(attemptsColRef, {
        payment_id: tx.payment_id,
        user_email: cleanEmail,
        candidate_name: tx.candidate_name || '',
        registration_number: tx.registration_number || '',
        team: tx.team || '',
        payment_title: tx.payment_title,
        amount: tx.amount,
        currency: tx.currency || 'INR',
        status: tx.status,
        razorpay_order_id: tx.razorpay_order_id || '',
        razorpay_payment_id: tx.razorpay_payment_id || '',
        error_description: tx.error_description || '',
        paid_at: paidAtVal,
        failed_at: failedAtVal,
        timestamp: serverTimestamp(),
        created_at: nowIso,
      });

      return tx.payment_id;
    }
    return null;
  } catch (err) {
    console.warn('Firestore transaction update failed:', err);
    return null;
  }
}

/**
 * Update existing invoice document in `invoices` collection by payment_id.
 */
export async function updateInvoiceInFirestore(
  paymentId: string,
  updates: Partial<{
    status: PaymentStatus;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    paid_at: string;
    error_description: string;
  }>
): Promise<boolean> {
  try {
    const colRef = collection(db, INVOICES_COLLECTION);
    const q = query(colRef, where('payment_id', '==', paymentId));
    const snap = await getDocs(q);

    if (snap.empty) {
      // If invoice doc doesn't exist yet, get primary payment doc to create it
      const payDocRef = doc(db, PAYMENTS_COLLECTION, paymentId);
      const paySnap = await getDoc(payDocRef);
      if (paySnap.exists()) {
        const pData: any = paySnap.data();
        await addDoc(colRef, {
          payment_id: paymentId,
          user_email: (pData.user_email || '').toLowerCase(),
          candidate_name: pData.candidate_name || '',
          registration_number: pData.registration_number || '',
          team: pData.team || '',
          title: pData.title || '',
          description: pData.description || '',
          category: pData.category || 'Club Fee',
          amount: Number(pData.amount) || 0,
          currency: pData.currency || 'INR',
          status: updates.status || pData.status || 'Pending',
          due_date: pData.due_date || '',
          razorpay_order_id: updates.razorpay_order_id || '',
          razorpay_payment_id: updates.razorpay_payment_id || '',
          error_description: updates.error_description || '',
          paid_at: updates.paid_at || '',
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      }
    } else {
      for (const docSnap of snap.docs) {
        await updateDoc(docSnap.ref, {
          ...updates,
          updated_at: serverTimestamp(),
        });
      }
    }
    return true;
  } catch (err) {
    console.error('Failed to update invoice in Firestore:', err);
    return false;
  }
}

/**
 * Fetch all attempt logs for a specific payment ID from Firestore (Deduplicated).
 */
export async function fetchPaymentAttemptsFromFirestore(paymentId: string): Promise<TransactionLog[]> {
  try {
    const attemptsColRef = collection(db, PAYMENTS_COLLECTION, paymentId, 'attempts');
    const snapshot = await getDocs(attemptsColRef);
    const rawLogs: TransactionLog[] = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const createdAtMs = parseTimestampMs(data.created_at || data.timestamp);
      const createdAtIso = createdAtMs > 0 ? new Date(createdAtMs).toISOString() : new Date().toISOString();
      const updatedAtMs = parseTimestampMs(data.updated_at);
      const updatedAtIso = updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : undefined;
      const paidAtMs = parseTimestampMs(data.paid_at);
      const paidAtIso = paidAtMs > 0 ? new Date(paidAtMs).toISOString() : (data.paid_at || undefined);
      const failedAtMs = parseTimestampMs(data.failed_at);
      const failedAtIso = failedAtMs > 0 ? new Date(failedAtMs).toISOString() : (data.failed_at || undefined);

      rawLogs.push({
        id: docSnap.id,
        payment_id: paymentId,
        user_email: data.user_email || '',
        candidate_name: data.candidate_name || '',
        registration_number: data.registration_number || '',
        team: data.team || '',
        payment_title: data.payment_title || data.title || '',
        amount: Number(data.amount) || 0,
        currency: data.currency || 'INR',
        status: (data.status as any) || 'Pending',
        razorpay_payment_id: data.razorpay_payment_id || '',
        razorpay_order_id: data.razorpay_order_id || '',
        error_description: data.error_description || '',
        paid_at: paidAtIso,
        failed_at: failedAtIso,
        updated_at: updatedAtIso,
        created_at: createdAtIso,
      });
    });

    // Deduplicate attempt logs to prevent duplicate entries
    const uniqueMap = new Map<string, TransactionLog>();
    rawLogs.forEach((log) => {
      const key = `${log.status}__${log.razorpay_payment_id}__${log.razorpay_order_id}__${log.error_description.slice(0, 30)}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, log);
      }
    });

    const logs = Array.from(uniqueMap.values());
    return logs.sort((a, b) => {
      const timeA = parseTimestampMs(getLogEventTimestamp(a));
      const timeB = parseTimestampMs(getLogEventTimestamp(b));
      if (timeB !== timeA) return timeB - timeA;
      const createdA = parseTimestampMs(a.created_at);
      const createdB = parseTimestampMs(b.created_at);
      if (createdB !== createdA) return createdB - createdA;
      return (b.id || '').localeCompare(a.id || '');
    });
  } catch (err) {
    console.error('Failed to fetch payment attempt logs:', err);
    return [];
  }
}

/**
 * Fetch invoice / transaction logs from Firestore `invoices` collection.
 */
export function parseTimestampMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object' && typeof ts.toDate === 'function') {
    return ts.toDate().getTime();
  }
  if (typeof ts === 'object' && typeof ts.seconds === 'number') {
    return ts.seconds * 1000;
  }
  const parsed = new Date(ts).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Fetch invoice / transaction logs from Firestore `invoices` collection (1 clean entry per payment).
 */
export async function fetchInvoicesFromFirestore(
  email: string,
  isAdmin: boolean = false
): Promise<TransactionLog[]> {
  try {
    const colRef = collection(db, PAYMENTS_COLLECTION);
    
    let q;
    if (!isAdmin && email && email.trim()) {
      q = query(colRef, where('user_email', '==', email.toLowerCase()));
    } else {
      q = query(colRef);
    }

    const snapshot = await getDocs(q);
    const logs: TransactionLog[] = [];

    for (const docSnap of snapshot.docs) {
      const data: any = docSnap.data();
      const createdAtMs = parseTimestampMs(data.created_at || data.timestamp);
      const createdAtIso = createdAtMs > 0 ? new Date(createdAtMs).toISOString() : new Date().toISOString();
      const updatedAtMs = parseTimestampMs(data.updated_at);
      const updatedAtIso = updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : undefined;
      const paidAtMs = parseTimestampMs(data.paid_at);
      const paidAtIso = paidAtMs > 0 ? new Date(paidAtMs).toISOString() : (data.paid_at || undefined);
      const failedAtMs = parseTimestampMs(data.failed_at);
      const failedAtIso = failedAtMs > 0 ? new Date(failedAtMs).toISOString() : (data.failed_at || undefined);

      logs.push({
        id: docSnap.id,
        payment_id: docSnap.id,
        user_email: data.user_email || '',
        candidate_name: data.candidate_name || '',
        registration_number: data.registration_number || '',
        team: data.team || '',
        payment_title: data.title || '',
        amount: Number(data.amount) || 0,
        currency: data.currency || 'INR',
        status: (data.status as any) || 'Pending',
        razorpay_payment_id: data.razorpay_payment_id || '',
        razorpay_order_id: data.razorpay_order_id || '',
        error_description: data.error_description || '',
        paid_at: paidAtIso,
        failed_at: failedAtIso,
        updated_at: updatedAtIso,
        created_at: createdAtIso,
      });
    }

    return logs.sort((a, b) => {
      const timeA = parseTimestampMs(getLogEventTimestamp(a));
      const timeB = parseTimestampMs(getLogEventTimestamp(b));
      if (timeB !== timeA) return timeB - timeA;
      const createdA = parseTimestampMs(a.created_at);
      const createdB = parseTimestampMs(b.created_at);
      if (createdB !== createdA) return createdB - createdA;
      return (b.id || '').localeCompare(a.id || '');
    });
  } catch (err) {
    console.error('Failed to fetch transaction logs from Firestore:', err);
    return [];
  }
}

/**
 * Seed sample payment dues into Firestore `payments` & `invoices` collections.
 */
export async function seedDemoPayments(targetEmail: string): Promise<PaymentItem[]> {
  try {
    const createdItems: PaymentItem[] = [];
    const email = targetEmail ? targetEmail.toLowerCase() : 'user@vrgc.club';

    for (const sample of SAMPLE_PAYMENTS) {
      const created = await createPaymentInFirestore({
        ...sample,
        user_email: email,
      });
      if (created) {
        createdItems.push(created);
      }
    }

    return createdItems;
  } catch (err) {
    console.error('Error seeding demo payments in Firestore:', err);
    return [];
  }
}
