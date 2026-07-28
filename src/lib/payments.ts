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
} from 'firebase/firestore';
import { PaymentItem, PaymentStatus } from '@/types/payment';

// ─── Firestore Collection Names ───────────────────────────────────────────────
export const PAYMENTS_COLLECTION = 'payments';
export const INVOICES_COLLECTION = 'invoices';

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
  created_at: string;
  updated_at?: string;
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
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    title: "Cyberpunk Game Jam '26 Pass",
    description: "Registration ticket for the upcoming 48-hour Game Development & VR Hackathon.",
    category: "Event Registration",
    amount: 150,
    currency: "INR",
    status: "Pending",
    due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    title: "VRGC Cyber Hoodie (Limited Ed.)",
    description: "Official club oversized hoodie with embroidered glow-in-the-dark VRGC insignia.",
    category: "Merchandise",
    amount: 899,
    currency: "INR",
    status: "Pending",
    due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    title: "VR Lab Equipment Late Fee",
    description: "Overdue return charge for Meta Quest 3 headset (1 day extension).",
    category: "Fine",
    amount: 50,
    currency: "INR",
    status: "Pending",
    due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  }
];

// ─── Firestore Payments CRUD Operations ────────────────────────────────────────

/**
 * Fetch payments from Firestore `payments` collection.
 * Non-destructive: read-only query.
 */
export async function fetchPaymentsFromFirestore(
  userEmail?: string,
  isAdmin: boolean = false
): Promise<PaymentItem[]> {
  try {
    const colRef = collection(db, PAYMENTS_COLLECTION);
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
      items.push({
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
        status: (data.status as PaymentStatus) || 'Pending',
        due_date: data.due_date || '',
        razorpay_order_id: data.razorpay_order_id || '',
        razorpay_payment_id: data.razorpay_payment_id || '',
        razorpay_signature: data.razorpay_signature || '',
        error_description: data.error_description || '',
        paid_at: data.paid_at || '',
        created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at || new Date().toISOString(),
        updated_at: data.updated_at?.toDate ? data.updated_at.toDate().toISOString() : data.updated_at || new Date().toISOString(),
      });
    });

    // Client-side sort by created_at descending
    return items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (err) {
    console.error('Failed to fetch payments from Firestore:', err);
    return [];
  }
}

/**
 * Create a new payment record in Firestore `payments` collection.
 * Also mirrors an initial record to Firestore `invoices` collection.
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
    const now = new Date().toISOString();
    const cleanEmail = paymentData.user_email ? paymentData.user_email.toLowerCase() : '';
    const docRef = await addDoc(collection(db, PAYMENTS_COLLECTION), {
      ...paymentData,
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
      user_email: cleanEmail,
      candidate_name: paymentData.candidate_name || '',
      registration_number: paymentData.registration_number || '',
      team: paymentData.team || '',
      category: paymentData.category as any,
      created_at: paymentData.created_at || now,
      updated_at: now,
    };

    // Save initial creation attempt log in subcollection & invoices
    saveTransactionToFirestore({
      payment_id: docRef.id,
      user_email: cleanEmail,
      candidate_name: paymentData.candidate_name || '',
      registration_number: paymentData.registration_number || '',
      team: paymentData.team || '',
      payment_title: paymentData.title,
      amount: paymentData.amount,
      currency: paymentData.currency || 'INR',
      status: paymentData.status as any,
      error_description: 'Payment invoice issued',
    });

    return newPayment;
  } catch (err) {
    console.error('Firestore payment create failed:', err);
    return null;
  }
}

/**
 * Update payment status & details in Firestore `payments` collection.
 */
export async function updatePaymentStatusInFirestore(
  paymentId: string,
  updates: Partial<PaymentItem>
): Promise<boolean> {
  try {
    const docRef = doc(db, PAYMENTS_COLLECTION, paymentId);
    await updateDoc(docRef, {
      ...updates,
      updated_at: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.error('Failed to update payment status in Firestore:', err);
    return false;
  }
}

/**
 * Delete a payment record from Firestore `payments` collection.
 */
export async function deletePaymentFromFirestore(paymentId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, PAYMENTS_COLLECTION, paymentId));
    return true;
  } catch (err) {
    console.error('Error deleting payment from Firestore:', err);
    return false;
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
}): Promise<string | null> {
  try {
    const cleanEmail = tx.user_email ? tx.user_email.toLowerCase() : '';
    if (tx.payment_id) {
      // 1. Update primary payment status in main `payments` doc
      await updatePaymentStatusInFirestore(tx.payment_id, {
        status: tx.status as PaymentStatus,
        razorpay_order_id: tx.razorpay_order_id || '',
        razorpay_payment_id: tx.razorpay_payment_id || '',
        razorpay_signature: tx.razorpay_signature || '',
        paid_at: tx.paid_at || (tx.status === 'Paid' ? new Date().toISOString() : ''),
        ...(tx.error_description ? { error_description: tx.error_description } : {}),
      });

      // 2. Log payment attempt entry to subcollection `payments/{payment_id}/attempts`
      const attemptsColRef = collection(db, PAYMENTS_COLLECTION, tx.payment_id, 'attempts');
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
        paid_at: tx.paid_at || '',
        timestamp: serverTimestamp(),
        created_at: new Date().toISOString(),
      });

      // 3. Mirror into global `invoices` collection for unified tracking
      const invoicesColRef = collection(db, INVOICES_COLLECTION);
      await addDoc(invoicesColRef, {
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
        paid_at: tx.paid_at || '',
        created_at: serverTimestamp(),
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
 * Fetch all attempt logs for a specific payment ID from Firestore.
 */
export async function fetchPaymentAttemptsFromFirestore(paymentId: string): Promise<TransactionLog[]> {
  try {
    const attemptsColRef = collection(db, PAYMENTS_COLLECTION, paymentId, 'attempts');
    const snapshot = await getDocs(attemptsColRef);
    const logs: TransactionLog[] = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      logs.push({
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
        paid_at: data.paid_at || '',
        created_at: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.created_at || new Date().toISOString(),
      });
    });

    return logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (err) {
    console.error('Failed to fetch payment attempt logs:', err);
    return [];
  }
}

/**
 * Fetch invoice / transaction logs from Firestore `invoices` collection.
 */
export async function fetchInvoicesFromFirestore(
  email: string,
  isAdmin: boolean = false
): Promise<TransactionLog[]> {
  try {
    const colRef = collection(db, PAYMENTS_COLLECTION);
    
    const q = isAdmin
      ? query(colRef, orderBy('created_at', 'desc'))
      : query(colRef, where('user_email', '==', email.toLowerCase()), orderBy('created_at', 'desc'));

    const snapshot = await getDocs(q);
    const logs: TransactionLog[] = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      logs.push({
        id: docSnap.id,
        payment_id: docSnap.id,
        user_email: data.user_email || '',
        payment_title: data.title || '',
        amount: Number(data.amount) || 0,
        currency: data.currency || 'INR',
        status: (data.status as any) || 'Pending',
        razorpay_payment_id: data.razorpay_payment_id || '',
        razorpay_order_id: data.razorpay_order_id || '',
        error_description: data.error_description || '',
        created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at || new Date().toISOString(),
      });
    });

    return logs;
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
