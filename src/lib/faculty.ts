import { db } from './firebase';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { FacultyMember, FutureEventPlan, FacultyDecision, FacultyApprovalStatus } from '@/types/faculty';

export const FACULTY_COLLECTION = 'faculty';
export const FUTURE_EVENTS_COLLECTION = 'future_events';

// Default test faculty email loaded from environment — no hardcoded email or name
export const DEFAULT_TEST_FACULTY_EMAIL = (process.env.NEXT_PUBLIC_DEFAULT_FACULTY_EMAIL || '').toLowerCase().trim();

/**
 * Seed or ensure default faculty member exists in Firestore `faculty` collection.
 * Only runs if NEXT_PUBLIC_DEFAULT_FACULTY_EMAIL is set in the environment.
 */
export async function ensureDefaultTestFaculty(): Promise<void> {
  if (!DEFAULT_TEST_FACULTY_EMAIL) return; // Skip seeding if no env var is set
  try {
    const docRef = doc(db, FACULTY_COLLECTION, DEFAULT_TEST_FACULTY_EMAIL);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      await setDoc(
        docRef,
        {
          id: DEFAULT_TEST_FACULTY_EMAIL,
          email: DEFAULT_TEST_FACULTY_EMAIL,
          name: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_NAME || 'Faculty Member',
          facultyId: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_ID || 'FAC-VRGC-01',
          department: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DEPT || '',
          designation: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DESIGNATION || 'Faculty Mentor',
          created_at: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.warn('Unable to auto-seed default faculty to Firestore:', err);
  }
}

/**
 * Check if a given email belongs to the `faculty` Firestore collection or is test faculty.
 */
export async function checkIsFaculty(email: string): Promise<FacultyMember | null> {
  if (!email) return null;
  const cleanEmail = email.toLowerCase().trim();

  // Fast in-memory check for the seeded default faculty email (env-driven, never hardcoded)
  if (DEFAULT_TEST_FACULTY_EMAIL && cleanEmail === DEFAULT_TEST_FACULTY_EMAIL) {
    return {
      id: DEFAULT_TEST_FACULTY_EMAIL,
      email: DEFAULT_TEST_FACULTY_EMAIL,
      name: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_NAME || 'Faculty Member',
      facultyId: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_ID || 'FAC-VRGC-01',
      department: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DEPT || '',
      designation: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DESIGNATION || 'Faculty Mentor',
      created_at: new Date().toISOString(),
    };
  }

  try {
    // 1. Direct document lookup by email docId
    const directDoc = await getDoc(doc(db, FACULTY_COLLECTION, cleanEmail));
    if (directDoc.exists()) {
      const data = directDoc.data();
      return {
        id: directDoc.id,
        email: data.email || cleanEmail,
        name: data.name || data.fullName || 'Faculty Member',
        facultyId: data.facultyId || data.faculty_id || '',
        department: data.department || '',
        designation: data.designation || 'Faculty Member',
        phone: data.phone || '',
        avatarUrl: data.avatarUrl || data.photoUrl || '',
        created_at: data.created_at || '',
      };
    }

    // 2. Query lookup by 'email' field
    const q = query(collection(db, FACULTY_COLLECTION), where('email', '==', cleanEmail));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      const data = docSnap.data();
      return {
        id: docSnap.id,
        email: data.email || cleanEmail,
        name: data.name || data.fullName || 'Faculty Member',
        facultyId: data.facultyId || data.faculty_id || '',
        department: data.department || '',
        designation: data.designation || 'Faculty Member',
        phone: data.phone || '',
        avatarUrl: data.avatarUrl || data.photoUrl || '',
        created_at: data.created_at || '',
      };
    }
  } catch (err) {
    console.warn('Error checking faculty status:', err);
  }

  return null;
}

/**
 * Fetch all registered faculty members from Firestore `faculty` collection.
 */
export async function fetchAllFaculty(): Promise<FacultyMember[]> {
  try {
    const colRef = collection(db, FACULTY_COLLECTION);
    const snap = await getDocs(colRef);
    const list: FacultyMember[] = [];

    snap.forEach((d) => {
      const data = d.data();
      list.push({
        id: d.id,
        email: (data.email || d.id).toLowerCase(),
        name: data.name || data.fullName || 'Faculty Member',
        facultyId: data.facultyId || data.faculty_id || '',
        department: data.department || '',
        designation: data.designation || 'Faculty Member',
        phone: data.phone || '',
        avatarUrl: data.avatarUrl || data.photoUrl || '',
        created_at: data.created_at || '',
      });
    });

    // If a default faculty email is set via env and not already in the list, include it
    if (
      DEFAULT_TEST_FACULTY_EMAIL &&
      !list.some((f) => f.email.toLowerCase() === DEFAULT_TEST_FACULTY_EMAIL)
    ) {
      list.push({
        id: DEFAULT_TEST_FACULTY_EMAIL,
        email: DEFAULT_TEST_FACULTY_EMAIL,
        name: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_NAME || 'Faculty Member',
        facultyId: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_ID || 'FAC-VRGC-01',
        department: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DEPT || '',
        designation: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DESIGNATION || 'Faculty Mentor',
        created_at: new Date().toISOString(),
      });
    }

    return list;
  } catch (err) {
    console.error('Error fetching faculty list:', err);
    return DEFAULT_TEST_FACULTY_EMAIL
      ? [
          {
            id: DEFAULT_TEST_FACULTY_EMAIL,
            email: DEFAULT_TEST_FACULTY_EMAIL,
            name: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_NAME || 'Faculty Member',
            facultyId: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_ID || 'FAC-VRGC-01',
            department: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DEPT || '',
            designation: process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DESIGNATION || 'Faculty Mentor',
            created_at: new Date().toISOString(),
          },
        ]
      : [];
  }
}

/**
 * Add / Create a faculty member in Firestore.
 */
export async function createFacultyMember(faculty: {
  id?: string;
  email: string;
  name: string;
  facultyId: string;
  department: string;
  designation: string;
  phone?: string;
}): Promise<boolean> {
  try {
    const cleanEmail = faculty.email.toLowerCase().trim();
    if (!cleanEmail) throw new Error('Email is required');
    const docRef = doc(db, FACULTY_COLLECTION, cleanEmail);
    await setDoc(
      docRef,
      {
        id: cleanEmail,
        email: cleanEmail,
        name: faculty.name.trim(),
        facultyId: faculty.facultyId.trim(),
        department: faculty.department.trim(),
        designation: faculty.designation.trim(),
        phone: faculty.phone?.trim() || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.error('Error creating faculty member:', err);
    return false;
  }
}

/**
 * Update an existing faculty member in Firestore.
 */
export async function updateFacultyMember(
  facultyEmail: string,
  updates: Partial<Omit<FacultyMember, 'id' | 'email' | 'created_at'>>
): Promise<boolean> {
  try {
    const cleanEmail = facultyEmail.toLowerCase().trim();
    const docRef = doc(db, FACULTY_COLLECTION, cleanEmail);
    await updateDoc(docRef, {
      ...updates,
      updated_at: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    console.error('Error updating faculty member:', err);
    return false;
  }
}

/**
 * Delete a faculty member from Firestore.
 */
export async function deleteFacultyMember(facultyEmail: string): Promise<boolean> {
  try {
    const cleanEmail = facultyEmail.toLowerCase().trim();
    const docRef = doc(db, FACULTY_COLLECTION, cleanEmail);
    await deleteDoc(docRef);
    return true;
  } catch (err) {
    console.error('Error deleting faculty member:', err);
    return false;
  }
}

// ─── Future Event Plans CRUD ──────────────────────────────────────────────────

/**
 * Fetch all future event plans from Firestore.
 */
export async function fetchFutureEvents(): Promise<FutureEventPlan[]> {
  try {
    const colRef = collection(db, FUTURE_EVENTS_COLLECTION);
    const snap = await getDocs(colRef);
    const plans: FutureEventPlan[] = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      plans.push({
        id: docSnap.id,
        title: data.title || '',
        tentativeDate: data.tentativeDate || data.tentative_date || '',
        description: data.description || '',
        driveLink: data.driveLink || data.drive_link || '',
        createdBy: data.createdBy || data.created_by || '',
        createdAt: data.createdAt || data.created_at || new Date().toISOString(),
        updatedAt: data.updatedAt || data.updated_at || '',
        facultyDecisions: data.facultyDecisions || {},
      });
    });

    // Sort by createdAt descending
    return plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    console.error('Error fetching future event plans:', err);
    return [];
  }
}

/**
 * Create a new planned future event (Admin action).
 */
export async function createFutureEvent(
  plan: Omit<FutureEventPlan, 'id' | 'createdAt' | 'updatedAt' | 'facultyDecisions' | 'createdBy'>,
  adminEmail: string
): Promise<FutureEventPlan | null> {
  try {
    const newDocRef = doc(collection(db, FUTURE_EVENTS_COLLECTION));
    const nowIso = new Date().toISOString();
    const newPlan: FutureEventPlan = {
      id: newDocRef.id,
      title: plan.title,
      tentativeDate: plan.tentativeDate,
      description: plan.description,
      driveLink: plan.driveLink,
      createdBy: adminEmail,
      createdAt: nowIso,
      updatedAt: nowIso,
      facultyDecisions: {},
    };

    await setDoc(newDocRef, newPlan);
    return newPlan;
  } catch (err) {
    console.error('Error creating future event plan:', err);
    return null;
  }
}

/**
 * Update an existing planned future event (Admin action).
 */
export async function updateFutureEvent(
  eventId: string,
  updates: Partial<Omit<FutureEventPlan, 'id' | 'createdAt'>>
): Promise<boolean> {
  try {
    const docRef = doc(db, FUTURE_EVENTS_COLLECTION, eventId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    console.error('Error updating future event plan:', err);
    return false;
  }
}

/**
 * Delete a planned future event (Admin action).
 */
export async function deleteFutureEvent(eventId: string): Promise<boolean> {
  try {
    const docRef = doc(db, FUTURE_EVENTS_COLLECTION, eventId);
    await deleteDoc(docRef);
    return true;
  } catch (err) {
    console.error('Error deleting future event plan:', err);
    return false;
  }
}

/**
 * Submit or update a faculty member's decision (Approve / Reject) for a future event plan.
 */
export async function submitFacultyDecision(
  eventId: string,
  facultyEmail: string,
  facultyName: string,
  status: FacultyApprovalStatus,
  remarks: string = ''
): Promise<boolean> {
  try {
    const docRef = doc(db, FUTURE_EVENTS_COLLECTION, eventId);
    const sanitizedKey = facultyEmail.replace(/[^a-zA-Z0-9_]/g, '_');

    const decision: FacultyDecision = {
      facultyEmail,
      facultyName,
      status,
      remarks,
      respondedAt: new Date().toISOString(),
    };

    await updateDoc(docRef, {
      [`facultyDecisions.${sanitizedKey}`]: decision,
      updatedAt: new Date().toISOString(),
    });

    return true;
  } catch (err) {
    console.error('Error submitting faculty decision:', err);
    return false;
  }
}
