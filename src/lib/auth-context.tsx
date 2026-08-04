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
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { CONFIG } from '@/lib/config';

// Designated payment admin emails (Restricted only to vrgc@vitbhopal.ac.in & developer)
const DEFAULT_PAYMENT_ADMIN_EMAILS = [
  'vrgc@vitbhopal.ac.in',
  'vrgcdev@gmail.com',
];

const envPaymentAdmins = (process.env.NEXT_PUBLIC_PAYMENT_ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const PAYMENT_ADMIN_EMAILS = Array.from(
  new Set([...DEFAULT_PAYMENT_ADMIN_EMAILS, ...envPaymentAdmins])
);
export const PAYMENT_ADMIN_EMAIL = 'vrgc@vitbhopal.ac.in';
export const ADMIN_EMAIL = 'vrgc@vitbhopal.ac.in';

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
  isAdmin: boolean;
  isPaymentAdmin: boolean;
  isAuthorized: boolean;
  memberData: MemberData | null;
  authLoading: boolean;
  authError: string;
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userEmail: '',
  isAdmin: false,
  isPaymentAdmin: false,
  isAuthorized: false,
  memberData: null,
  authLoading: true,
  authError: '',
  handleLogin: async () => {},
  handleLogout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPaymentAdmin, setIsPaymentAdmin] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [memberData, setMemberData] = useState<MemberData | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Resolve user against Firestore Database
  const resolveUser = useCallback(async (firebaseUser: User | null) => {
    if (!firebaseUser || !firebaseUser.email) {
      setUser(null);
      setUserEmail('');
      setIsAdmin(false);
      setIsPaymentAdmin(false);
      setIsAuthorized(false);
      setMemberData(null);
      setAuthError('');
      setAuthLoading(false);
      return;
    }

    const em = firebaseUser.email.toLowerCase();
    setUser(firebaseUser);
    setUserEmail(em);

    try {
      // 1. Check Admin status (Firestore 'admins' collection OR Config env / payment admin)
      const configAdmins = CONFIG.ADMIN_EMAILS.map((e) => e.toLowerCase());
      let isDbAdmin = false;

      try {
        // Direct doc check (doc id = email)
        const adminDoc = await getDoc(doc(db, 'admins', em));
        if (adminDoc.exists()) {
          isDbAdmin = true;
        } else {
          // Query check by 'email' field
          const adminQuery = query(collection(db, 'admins'), where('email', '==', em));
          const adminSnap = await getDocs(adminQuery);
          if (!adminSnap.empty) {
            isDbAdmin = true;
          }
        }
      } catch (adminErr) {
        console.warn('Firestore admin check fallback:', adminErr);
      }

      const isPaymentAdminEmail = PAYMENT_ADMIN_EMAILS.includes(em);
      const admin = isDbAdmin || isPaymentAdminEmail || em === PAYMENT_ADMIN_EMAIL || configAdmins.includes(em);
      const paymentAdmin = isPaymentAdminEmail;
      setIsAdmin(admin);
      setIsPaymentAdmin(paymentAdmin);

      // 2. Query Firestore 'members' collection by email
      let memberRecord: MemberData | null = null;
      try {
        const memberQuery = query(collection(db, 'members'), where('email', '==', em));
        const memberSnap = await getDocs(memberQuery);
        if (!memberSnap.empty) {
          const userEntries = memberSnap.docs.map((d) => d.data() as MemberData);
          const teams = [...new Set(userEntries.map((m) => m.team).filter(Boolean))].join(', ');
          const positions = [...new Set(userEntries.map((m) => m.position).filter(Boolean))].join(', ');
          memberRecord = {
            name: userEntries[0].name || firebaseUser.displayName || 'Member',
            registrationNumber: userEntries[0].registrationNumber || '',
            phone: userEntries[0].phone || '',
            email: em,
            team: teams || 'Member',
            position: positions || 'Member',
          };
        }
      } catch (memberErr) {
        console.warn('Firestore member check warning:', memberErr);
      }

      if (memberRecord) {
        setMemberData(memberRecord);
        setIsAuthorized(true);
        setAuthError('');
      } else if (admin) {
        setMemberData({
          name: firebaseUser.displayName || 'Administrator',
          registrationNumber: 'ADMIN',
          phone: '',
          email: em,
          team: 'Management',
          position: 'Lead',
        });
        setIsAuthorized(true);
        setAuthError('');
      } else {
        setIsAuthorized(false);
        setMemberData(null);
        setAuthError('Access Denied: You are not a registered VRGC member. Please contact admin.');
        if (auth) signOut(auth).catch(console.error);
      }
    } catch (err: any) {
      console.error('AuthProvider resolution error:', err);
      setAuthError('Authentication error occurred. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setAuthLoading(true);
      resolveUser(firebaseUser);
    });

    return () => unsubscribe();
  }, [resolveUser]);

  const handleLogin = useCallback(async () => {
    setAuthError('');
    if (!auth) {
      setAuthError('Firebase Auth is not configured. Please set NEXT_PUBLIC_FIREBASE_API_KEY in your .env.local file.');
      return;
    }
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
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Signout error:', err);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        userEmail,
        isAdmin,
        isPaymentAdmin,
        isAuthorized,
        memberData,
        authLoading,
        authError,
        handleLogin,
        handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
