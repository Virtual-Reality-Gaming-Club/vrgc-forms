'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import EntryExperience from '@/components/animation/EntryExperience';
import { Member } from '@/components/animation/members';

interface VerifyCardClientProps {
  scannedMember: Member | null;
  otherMembers: Member[];
  error: string | null;
}

export default function VerifyCardClient({
  scannedMember,
  otherMembers,
  error,
}: VerifyCardClientProps) {
  const [replayKey, setReplayKey] = useState<number>(0);

  if (error || !scannedMember) {
    return (
      <div className="min-h-screen bg-[#05010a] text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-red-400 text-3xl">error_outline</span>
        </div>
        <h1 className="font-display-lg text-xl sm:text-2xl font-bold tracking-wider mb-2 text-red-300">
          DOSSIER NOT FOUND
        </h1>
        <p className="font-code-sm text-xs sm:text-sm text-purple-300/70 max-w-md mb-6">
          {error || 'No verified member record matches the provided registration parameters.'}
        </p>
        <Link
          href="/"
          className="px-6 py-2.5 rounded-xl bg-purple-600/30 border border-purple-500/40 text-purple-200 hover:bg-purple-600/50 transition-all font-code-sm text-xs uppercase tracking-widest"
        >
          Return to Command Center
        </Link>
      </div>
    );
  }

  return (
    <main key={replayKey} className="relative w-full min-h-[100dvh] bg-[#05010a] overflow-hidden">
      {/* Dynamic Cyber Experience */}
      <EntryExperience
        targetMember={scannedMember}
        otherMembers={otherMembers}
      />

      {/* Floating Action Controls */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#0a0214]/80 backdrop-blur-md px-4 py-2 rounded-full border border-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
        <button
          onClick={() => setReplayKey((k) => k + 1)}
          className="flex items-center gap-1.5 text-[11px] font-code-sm text-purple-200 hover:text-white uppercase tracking-wider transition-colors"
        >
          <span className="material-symbols-outlined text-sm">replay</span>
          Replay Reveal
        </button>
        <div className="w-px h-3 bg-purple-500/30" />
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[11px] font-code-sm text-purple-300 hover:text-white uppercase tracking-wider transition-colors"
        >
          <span className="material-symbols-outlined text-sm">home</span>
          Portal
        </Link>
      </div>
    </main>
  );
}
