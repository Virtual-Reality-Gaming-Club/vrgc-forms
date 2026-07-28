"use client";

import React, { useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import Payments from '@/components/Payments';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

import Footer from '@/components/Footer';

export default function PaymentsPage() {
  const router = useRouter();
  const { user, userEmail, isAdmin, isAuthorized, authLoading, handleLogout } = useAuth();

  // Route protection — redirect unauthenticated or unauthorized users to home
  useEffect(() => {
    if (!authLoading && (!user || !isAuthorized)) {
      router.replace('/');
    }
  }, [authLoading, user, isAuthorized, router]);

  const handlePageChange = (pageId: string) => {
    if (pageId === 'dashboard') {
      router.push('/');
    } else if (pageId === 'payments') {
      // Already on payments page
    } else {
      router.push(`/?page=${pageId}`);
    }
  };

  // Show loading spinner while auth resolves
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#05010a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          <span className="text-purple-300 text-sm font-semibold tracking-widest uppercase">Authenticating…</span>
        </div>
      </div>
    );
  }

  // If not signed in or not authorized, render nothing (redirect happens above)
  if (!user || !isAuthorized) return null;

  return (
    <div className="min-h-screen bg-[#05010a] text-[#e2e8f0] flex flex-col custom-scrollbar">
      <Navbar pageTitle="Payments & Dues Portal" userEmail={userEmail} isAdmin={isAdmin} onLogout={handleLogout} />

      <div className="flex flex-1">
        <Sidebar activePage="payments" onPageChange={handlePageChange} isAdmin={isAdmin} />

        <main className="flex-grow min-w-0 pb-24 md:pb-12 min-h-[calc(100vh-76px)] flex flex-col">
          <Payments
            onRedirect={() => router.push('/')}
            externalUser={user}
            externalUserEmail={userEmail}
            externalIsAdmin={isAdmin}
          />
        </main>
      </div>
      <Footer />
    </div>
  );
}
