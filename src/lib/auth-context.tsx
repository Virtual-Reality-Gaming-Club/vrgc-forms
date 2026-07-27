"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { auth } from '@/lib/firebase';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  User,
} from 'firebase/auth';
import { loadCsv } from '@/lib/loadCsv';

// ✅ Designated payment admin email
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

  // CSV data stored in refs so they are always current without causing re-renders
  const membersListRef = useRef<MemberData[]>([]);
  const adminEmailsSetRef = useRef<Set<string>>(new Set());
  const csvLoadedRef = useRef(false);

  // Load CSVs once and store in refs
  useEffect(() => {
    const loadCSVs = async () => {
      try {
        // Load admins
        const adminsSet = await loadCsv('/admins.csv');
        adminsSet.add(PAYMENT_ADMIN_EMAIL);
        adminEmailsSetRef.current = adminsSet;

        // Load members list
        const memberRes = await fetch('/members.csv');
        const parsed: MemberData[] = [];
        if (memberRes.ok) {
          const text = await memberRes.text();
          const lines = text.split('\n');
          const headers = lines[0].split(',').map(h => h.trim());
          const idx = (name: string) => headers.findIndex(h => h.toLowerCase() === name);
          const emailIdx = idx('email');
          const nameIdx = idx('name');
          const regIdx = idx('registration number');
          const phoneIdx = idx('phone');
          const teamIdx = idx('team');
          const posIdx = idx('position');

          for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const cols = lines[i].split(',');
            parsed.push({
              name: cols[nameIdx]?.trim() || '',
              registrationNumber: cols[regIdx]?.trim() || '',
              phone: cols[phoneIdx]?.trim() || '',
              email: cols[emailIdx]?.trim().toLowerCase() || '',
              team: cols[teamIdx]?.trim() || '',
              position: cols[posIdx]?.trim() || 'Member',
            });
          }
        }
        membersListRef.current = parsed;
        csvLoadedRef.current = true;
      } catch (err) {
        console.error('AuthProvider: Failed to load CSVs', err);
        csvLoadedRef.current = true; // allow auth to proceed even if CSVs fail
      }
    };

    loadCSVs();
  }, []);

  // Resolve user against loaded CSV data
  const resolveUser = useCallback((firebaseUser: User | null) => {
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

    const admin = adminEmailsSetRef.current.has(em) || em === PAYMENT_ADMIN_EMAIL;
    const paymentAdmin = em === PAYMENT_ADMIN_EMAIL;
    setIsAdmin(admin);
    setIsPaymentAdmin(paymentAdmin);

    const membersList = membersListRef.current;
    const userEntries = membersList.filter(m => m.email === em);

    if (userEntries.length > 0) {
      const teams = [...new Set(userEntries.map(m => m.team).filter(Boolean))].join(', ');
      const positions = [...new Set(userEntries.map(m => m.position).filter(Boolean))].join(', ');
      setMemberData({
        name: userEntries[0].name,
        registrationNumber: userEntries[0].registrationNumber,
        phone: userEntries[0].phone,
        email: em,
        team: teams,
        position: positions,
      });
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
    } else if (membersList.length > 0) {
      // CSVs loaded and user is not in them — deny
      setIsAuthorized(false);
      setMemberData(null);
      setAuthError('Access Denied: You are not a registered VRGC member. Please contact admin.');
      signOut(auth).catch(console.error);
    } else {
      // CSVs not loaded yet (edge case) — keep loading
      setIsAuthorized(false);
    }

    setAuthLoading(false);
  }, []);

  // Single onAuthStateChanged listener — waits for CSVs before resolving
  useEffect(() => {
    let pendingUser: User | null | undefined = undefined;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      pendingUser = firebaseUser;

      // If CSVs already loaded, resolve immediately
      if (csvLoadedRef.current) {
        resolveUser(firebaseUser);
        return;
      }

      // CSVs not yet ready — poll until they are (max 5s)
      setAuthLoading(true);
      let waited = 0;
      const interval = setInterval(() => {
        waited += 100;
        if (csvLoadedRef.current || waited >= 5000) {
          clearInterval(interval);
          // Only resolve if this is still the latest pending user
          if (pendingUser === firebaseUser) {
            resolveUser(firebaseUser);
          }
        }
      }, 100);
    });

    return () => unsubscribe();
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
