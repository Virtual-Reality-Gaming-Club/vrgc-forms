"use client";

import React, { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { initOrResumeSession, finalizeSession, touchSessionActivity, upgradeSessionIdentity } from '@/lib/sessionTracker';

export const SessionTracker: React.FC = () => {
  const { user, userEmail, memberData, authenticRole, isAuthenticSuperAdmin, isAdmin, isElevatedSession, isFaculty, authLoading } = useAuth();

  // Last raw Firebase email seen before any admission processing.
  // Preserved across signOut() — never cleared when Firebase fires with null.
  // This ensures non-member emails are attributable even after the admission
  // gate calls signOut() and clears the auth-context state.
  const rawFirebaseEmailRef = useRef<string | null>(null);

  // Email that was actually written to the Firestore session record.
  // null = session was created as Guest Visitor (or not yet created).
  const recordedEmailRef = useRef<string | null>(null);

  // Whether the initial session Firestore write has been dispatched.
  const initDoneRef = useRef<boolean>(false);

  // resolvedRole: for admitted users only (userEmail is set by auth-context ONLY on success).
  // Denied users have userEmail='', so they fall through to 'Guest' here.
  // The actual 'Access Denied' label is applied in the init effect using rawFirebaseEmailRef.
  const resolvedRole = isAuthenticSuperAdmin
    ? 'Super Admin'
    : authenticRole
    ? authenticRole
    : (isAdmin && !isElevatedSession)
    ? 'Admin'
    : isFaculty
    ? 'Faculty'
    : userEmail
    ? 'Member'
    : 'Guest';

  // 0. Subscribe directly to raw Firebase auth state, independently of the admission context.
  //    Captures the authenticated email BEFORE the admission gate may call signOut() and
  //    clear auth-context state (userEmail / user). Does NOT clear the ref on sign-out —
  //    the last-seen email is preserved for identity attribution throughout the session.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser?.email) {
        rawFirebaseEmailRef.current = firebaseUser.email.toLowerCase().trim();
      }
      // Intentionally NOT clearing rawFirebaseEmailRef on null: we want the last
      // authenticated email to remain available even after signOut.
    });
    return () => unsubscribe();
  }, []);

  // 1. Initialize session ONLY ONCE after auth state has settled (single Firestore write).
  //    Identity priority:
  //      a. Auth-context email (admitted member / admin) → role = resolvedRole (Member/Admin/etc)
  //      b. Raw Firebase email only (denied non-member — auth-context cleared userEmail on denial)
  //         → role = 'Access Denied'
  //      c. null → "Guest Visitor" (truly anonymous, Firebase has no current user)
  //    Elevated sessions intentionally record null to preserve identity privacy.
  useEffect(() => {
    if (authLoading) return;
    if (initDoneRef.current) return;

    initDoneRef.current = true;
    const isElevated = isElevatedSession && !isAuthenticSuperAdmin;

    const effectiveEmail = isElevated ? null : (userEmail || rawFirebaseEmailRef.current || null);
    const effectiveName = effectiveEmail
      ? (memberData?.name || user?.displayName || effectiveEmail.split('@')[0])
      : 'Guest Visitor';

    // Determine the role for the session record:
    // - Admitted user (userEmail is set)   → use resolvedRole
    // - Denied user (only rawFirebaseEmail) → 'Access Denied'
    // - Truly anonymous (no email)          → 'Guest'
    const effectiveRole = isElevated
      ? 'Guest'
      : userEmail
      ? resolvedRole
      : rawFirebaseEmailRef.current
      ? 'Access Denied'
      : 'Guest';

    recordedEmailRef.current = effectiveEmail;

    initOrResumeSession({
      email: effectiveEmail,
      name: effectiveName,
      photo: user?.photoURL || null,
      role: effectiveRole,
    });
  }, [authLoading, userEmail, resolvedRole, user?.photoURL, user?.displayName, user?.email, isElevatedSession, isAuthenticSuperAdmin, memberData]);

  // 2. Upgrade identity when an anonymous (or Guest Visitor) session transitions to authenticated.
  //    Fires after init when auth state changes — e.g., user navigates anonymously then logs in.
  //    Uses setDoc merge via upgradeSessionIdentity — no new session, no duplicate records.
  useEffect(() => {
    if (authLoading) return;
    if (!initDoneRef.current) return;

    const isElevated = isElevatedSession && !isAuthenticSuperAdmin;
    if (isElevated) return;

    // Prefer auth-context email (admitted user), fall back to raw Firebase email (denied/transitioning).
    const effectiveEmail = userEmail || rawFirebaseEmailRef.current || null;

    // Only write if we now have an email that differs from what was previously recorded.
    if (!effectiveEmail || effectiveEmail === recordedEmailRef.current) return;

    recordedEmailRef.current = effectiveEmail;
    const effectiveName = memberData?.name || user?.displayName || effectiveEmail.split('@')[0];

    // Role for upgrade: admitted user → resolvedRole, denied (rawFirebaseEmail only) → 'Access Denied'
    const upgradeRole = userEmail ? resolvedRole : 'Access Denied';

    upgradeSessionIdentity({
      email: effectiveEmail,
      name: effectiveName,
      photo: user?.photoURL || null,
      role: upgradeRole,
    });
  }, [authLoading, userEmail, resolvedRole, user?.displayName, user?.photoURL, isElevatedSession, isAuthenticSuperAdmin, memberData]);

  // 3. Periodic gentle heartbeat every 3 minutes while tab is active and visible (Zero waste on Spark quota)
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        touchSessionActivity();
      }
    }, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // 4. Mark offline on browser exit / tab close via sendBeacon
  useEffect(() => {
    let finalized = false;

    const handleExit = () => {
      if (finalized) return;
      finalized = true;
      finalizeSession();
    };

    window.addEventListener('beforeunload', handleExit);
    window.addEventListener('pagehide', handleExit);

    return () => {
      window.removeEventListener('beforeunload', handleExit);
      window.removeEventListener('pagehide', handleExit);
    };
  }, []);

  return null;
};

export default SessionTracker;
