"use client";

import React, { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { initOrResumeSession, finalizeSession, touchSessionActivity } from '@/lib/sessionTracker';

export const SessionTracker: React.FC = () => {
  const { user, userEmail, memberData, authenticRole, isAuthenticSuperAdmin, isAdmin, isElevatedSession, isFaculty, authLoading } = useAuth();
  const initDispatchedRef = React.useRef<boolean>(false);

  const resolvedName = memberData?.name || user?.displayName || (userEmail ? userEmail.split('@')[0] : 'Guest Visitor');
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

  // 1. Initialize session ONLY ONCE after auth state has settled (Single write to Firestore)
  useEffect(() => {
    if (authLoading) return;
    if (initDispatchedRef.current) return;

    initDispatchedRef.current = true;
    const isElevated = isElevatedSession && !isAuthenticSuperAdmin;
    initOrResumeSession({
      email: isElevated ? null : (userEmail || user?.email || null),
      name: resolvedName,
      photo: user?.photoURL || null,
      role: resolvedRole,
    });
  }, [authLoading, userEmail, resolvedName, resolvedRole, user?.photoURL, user?.email, isElevatedSession, isAuthenticSuperAdmin]);

  // 2. Periodic gentle heartbeat every 3 minutes while tab is active and visible (Zero waste on Spark quota)
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        touchSessionActivity();
      }
    }, 3 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // 3. Mark offline on browser exit / tab close via sendBeacon
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

