"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import EntryExperience from './components/EntryExperience';
import { fetchCsvMembers, CsvMember } from './utils/csvParser';
import { UnifiedMember } from './types';

interface VerifyCardClientProps {
  scannedMember: UnifiedMember | null;
  otherMembers?: UnifiedMember[];
  initialError?: string | null;
  regNo: string;
}

export default function VerifyCardClient({
  scannedMember,
  otherMembers = [],
  initialError,
  regNo,
}: VerifyCardClientProps) {
  const [member, setMember] = useState<UnifiedMember | null>(scannedMember);
  const [allCsvMembers, setAllCsvMembers] = useState<CsvMember[]>([]);
  const [dbMembers, setDbMembers] = useState<UnifiedMember[]>(otherMembers);
  const [loading, setLoading] = useState<boolean>(!scannedMember && !initialError);
  const [error, setError] = useState<string>(initialError || '');

  useEffect(() => {
    const loadData = async () => {
      try {
        const csvList = await fetchCsvMembers();
        setAllCsvMembers(csvList);

        if (!member) {
          const normalizedTargetReg = regNo.toLowerCase();
          const csvMatch = csvList.find(
            (m) => m.registrationNumber.trim().toLowerCase() === normalizedTargetReg
          );

          if (csvMatch) {
            const photoUrl = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(csvMatch.name)}&backgroundColor=0a0a0f`;
            const merged: UnifiedMember = {
              id: regNo,
              regNo: regNo,
              name: csvMatch.name,
              phone: csvMatch.phone || '',
              email: csvMatch.email || '',
              assignedTeam: csvMatch.team || 'General',
              position: csvMatch.position || 'Core Member',
              role: csvMatch.position || 'Core Member',
              photoUrl,
              imageUrl: photoUrl,
              avatarUrl: photoUrl,
              joinDate: '2024-08-01',
              specialization: `${csvMatch.team} Division`,
              rating: 4.9,
              fromFirestore: false,
              fromCsv: true,
            };
            setMember(merged);
            setError('');
          } else if (!scannedMember) {
            setError(`No verified ID Card dossier found for registration number: ${regNo}`);
          }
        }
      } catch (err) {
        console.error('Error fetching CSV member backup:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [regNo, scannedMember, member]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#020006] text-white p-6 relative overflow-hidden">
        <div className="w-12 h-12 rounded-full border-2 border-t-2 border-t-[#c084fc] border-purple-950/40 animate-spin" />
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#020006] text-white p-6 relative">
        <div className="max-w-md w-full glass-panel p-8 rounded-3xl border border-red-500/30 bg-black/80 backdrop-blur-md space-y-6 text-center shadow-[0_0_50px_rgba(239,68,68,0.2)]">
          <span className="material-symbols-outlined text-red-400 text-5xl animate-bounce">
            gavel
          </span>
          <div className="space-y-2">
            <h3 className="font-display-lg text-lg text-white font-extrabold tracking-widest uppercase">
              VERIFICATION FAILED
            </h3>
            <p className="font-body-md text-xs text-red-400/80 leading-relaxed">
              {error || `Member dossier not found.`}
            </p>
          </div>
          <Link
            href="/"
            className="inline-block px-6 py-2.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold font-label-caps text-xs tracking-wider transition-all"
          >
            RETURN TO CONSOLE
          </Link>
        </div>
      </div>
    );
  }

  return (
    <EntryExperience
      targetMember={member}
      csvMembers={allCsvMembers}
      databaseMembers={dbMembers}
    />
  );
}
