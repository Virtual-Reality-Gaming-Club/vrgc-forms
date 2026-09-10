import { db } from './firebase';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';

export interface SupportFaq {
  id: string;
  question: string;
  answer: string;
  category: string;
  order: number;
  isActive: boolean;
  status: 'active' | 'hidden';
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const FAQ_CATEGORIES = [
  { id: 'payment', label: 'Payment & Dues', color: 'emerald' },
  { id: 'idcard', label: 'ID Card & Dossier', color: 'purple' },
  { id: 'membership', label: 'Domain & Roster', color: 'indigo' },
  { id: 'events', label: 'Planned Events', color: 'amber' },
  { id: 'referrals', label: 'Referrals & Milestones', color: 'cyan' },
  { id: 'technical', label: 'Technical & Access', color: 'rose' },
  { id: 'general', label: 'General Inquiry', color: 'fuchsia' },
];

export const DEFAULT_SUPPORT_FAQS: Omit<SupportFaq, 'id'>[] = [
  {
    question: 'How do I verify if my club membership payment went through?',
    answer: 'Head to the Payments & Dues portal from the main dashboard. If your payment was successful via Razorpay, your status will show "Verified" with a transaction reference. If amount was deducted but still shows pending, submit a ticket below with your payment screenshot / Razorpay payment ID.',
    category: 'payment',
    order: 1,
    isActive: true,
    status: 'active',
  },
  {
    question: 'How long does payment verification take?',
    answer: 'Razorpay online transactions are verified automatically within seconds. If your payment was deducted but shows pending in the portal, please wait up to 10 minutes before submitting a ticket.',
    category: 'payment',
    order: 2,
    isActive: true,
    status: 'active',
  },
  {
    question: 'When will I receive my VRGC Member ID Card?',
    answer: 'Once your photo and dossier details are approved by the lead administrators, your official 3D ID badge will be minted and made available in the ID Card Portal immediately.',
    category: 'idcard',
    order: 3,
    isActive: true,
    status: 'active',
  },
  {
    question: 'How do referral milestones work?',
    answer: 'When someone uses your exclusive Referral Link or Registration ID, you gain recruit XP. Milestones unlock exclusive club roles, early access to esports tryouts, and merchandise drops.',
    category: 'referrals',
    order: 4,
    isActive: true,
    status: 'active',
  },
  {
    question: 'Can non-members register for Planned Events and Hackathons?',
    answer: 'Most flag-bearer tournaments and workshops have open public rounds. However, members receive priority seating, waived registration fees, and official VRGC digital credentials.',
    category: 'events',
    order: 5,
    isActive: true,
    status: 'active',
  },
];

const FAQS_COLLECTION = 'support_faqs';

/**
 * Fetch all Support FAQs sorted by order ascending.
 */
export async function fetchSupportFaqs(): Promise<SupportFaq[]> {
  try {
    const q = query(collection(db, FAQS_COLLECTION), orderBy('order', 'asc'));
    const snap = await getDocs(q);
    if (snap.empty) {
      return DEFAULT_SUPPORT_FAQS.map((f, i) => ({
        ...f,
        id: `default-${i + 1}`,
      }));
    }
    return snap.docs.map((docSnap) => {
      const data = docSnap.data();
      const isActive = data.isActive !== undefined ? data.isActive : data.status === 'active';
      return {
        id: docSnap.id,
        question: data.question || '',
        answer: data.answer || '',
        category: data.category || 'general',
        order: data.order || 1,
        isActive,
        status: (data.status as 'active' | 'hidden') || (isActive ? 'active' : 'hidden'),
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy,
      };
    });
  } catch (err) {
    console.warn('Error fetching support FAQs from Firestore, falling back to defaults:', err);
    return DEFAULT_SUPPORT_FAQS.map((f, i) => ({
      ...f,
      id: `default-${i + 1}`,
    }));
  }
}

/**
 * Real-time subscription to Support FAQs.
 */
export function subscribeSupportFaqs(callback: (faqs: SupportFaq[]) => void): () => void {
  try {
    const q = query(collection(db, FAQS_COLLECTION), orderBy('order', 'asc'));
    return onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          callback(
            DEFAULT_SUPPORT_FAQS.map((f, i) => ({
              ...f,
              id: `default-${i + 1}`,
            }))
          );
        } else {
          const list: SupportFaq[] = snap.docs.map((docSnap) => {
            const data = docSnap.data();
            const isActive = data.isActive !== undefined ? data.isActive : data.status === 'active';
            return {
              id: docSnap.id,
              question: data.question || '',
              answer: data.answer || '',
              category: data.category || 'general',
              order: data.order || 1,
              isActive,
              status: (data.status as 'active' | 'hidden') || (isActive ? 'active' : 'hidden'),
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
              updatedBy: data.updatedBy,
            };
          });
          callback(list);
        }
      },
      (err) => {
        console.warn('Snapshot listener error on support FAQs:', err);
        callback(
          DEFAULT_SUPPORT_FAQS.map((f, i) => ({
            ...f,
            id: `default-${i + 1}`,
          }))
        );
      }
    );
  } catch (err) {
    console.warn('Failed to subscribe to support FAQs:', err);
    callback(
      DEFAULT_SUPPORT_FAQS.map((f, i) => ({
        ...f,
        id: `default-${i + 1}`,
      }))
    );
    return () => {};
  }
}

/**
 * Create a new Support FAQ in Firestore.
 */
export async function createSupportFaq(
  faq: Omit<SupportFaq, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: 'active' | 'hidden' },
  userEmail?: string
): Promise<string> {
  const newDocRef = doc(collection(db, FAQS_COLLECTION));
  const isActive = faq.isActive !== undefined ? faq.isActive : faq.status === 'active';
  const status = faq.status || (isActive ? 'active' : 'hidden');
  const now = new Date().toISOString();

  await setDoc(newDocRef, {
    ...faq,
    isActive,
    status,
    createdAt: now,
    updatedAt: now,
    updatedBy: userEmail || 'SuperAdmin',
  });
  return newDocRef.id;
}

/**
 * Update an existing Support FAQ. Uses setDoc with merge: true so it never throws "No document to update".
 */
export async function updateSupportFaq(
  id: string,
  data: Partial<SupportFaq>,
  userEmail?: string
): Promise<void> {
  const docRef = doc(db, FAQS_COLLECTION, id);
  const isActive = data.isActive !== undefined ? data.isActive : data.status !== undefined ? data.status === 'active' : undefined;
  const status = data.status || (isActive !== undefined ? (isActive ? 'active' : 'hidden') : undefined);

  const payload: any = {
    ...data,
    updatedAt: new Date().toISOString(),
    ...(userEmail ? { updatedBy: userEmail } : {}),
  };

  if (isActive !== undefined) payload.isActive = isActive;
  if (status !== undefined) payload.status = status;

  await setDoc(docRef, payload, { merge: true });
}

/**
 * Delete an FAQ document.
 */
export async function deleteSupportFaq(id: string): Promise<void> {
  const docRef = doc(db, FAQS_COLLECTION, id);
  await deleteDoc(docRef);
}

/**
 * Reorder FAQs by updating their `order` indices in a batch.
 */
export async function reorderSupportFaqs(orderedFaqs: SupportFaq[]): Promise<void> {
  const batch = writeBatch(db);
  orderedFaqs.forEach((faq, index) => {
    const docRef = doc(db, FAQS_COLLECTION, faq.id);
    batch.set(docRef, { order: index + 1 }, { merge: true });
  });
  await batch.commit();
}

/**
 * Seed default FAQs into Firestore if collection is empty or if forced.
 */
export async function seedDefaultSupportFaqs(userEmail?: string): Promise<SupportFaq[]> {
  const batch = writeBatch(db);
  const now = new Date().toISOString();
  const seededList: SupportFaq[] = [];

  for (let i = 0; i < DEFAULT_SUPPORT_FAQS.length; i++) {
    const faq = DEFAULT_SUPPORT_FAQS[i];
    const docId = `default-${i + 1}`;
    const docRef = doc(db, FAQS_COLLECTION, docId);
    const itemData: SupportFaq = {
      id: docId,
      ...faq,
      order: i + 1,
      status: 'active',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      updatedBy: userEmail || 'System Seeder',
    };
    batch.set(docRef, {
      question: itemData.question,
      answer: itemData.answer,
      category: itemData.category,
      order: itemData.order,
      status: itemData.status,
      isActive: itemData.isActive,
      createdAt: itemData.createdAt,
      updatedAt: itemData.updatedAt,
      updatedBy: itemData.updatedBy,
    }, { merge: true });
    seededList.push(itemData);
  }
  await batch.commit();
  return seededList;
}

