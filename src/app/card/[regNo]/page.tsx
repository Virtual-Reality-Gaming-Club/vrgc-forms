"use client";

import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import EntryExperience from './components/EntryExperience';
import { fetchCsvMembers, CsvMember } from './utils/csvParser';
import { UnifiedMember } from './types';

interface PublicIDCardProps {
  params: Promise<{
    regNo: string;
  }>;
}

export default function VerifyCardPage({ params }: PublicIDCardProps) {
  const resolvedParams = (
    typeof (params as any)?.then === 'function'
      ? React.use(params as Promise<{ regNo: string }>)
      : params
  ) as { regNo: string };
  const regNo = (resolvedParams?.regNo || '').trim();

  const [member, setMember] = useState<UnifiedMember | null>(null);
  const [allCsvMembers, setAllCsvMembers] = useState<CsvMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadData = async () => {
      if (!regNo) return;
      setLoading(true);
      setError('');

      try {
        // 1. Fetch CSV members
        const csvList = await fetchCsvMembers();

        const normalizedTargetReg = regNo.toLowerCase();
        const csvMatch = csvList.find(
          (m) => m.registrationNumber.trim().toLowerCase() === normalizedTargetReg
        );

        // 2. Fetch Firestore records (id_cards collection) and build a lookup map by regNo & email
        let firestoreDoc: any = null;
        const firestoreDocsMap: Record<string, any> = {};

        if (db) {
          try {
            const allDocsSnapshot = await getDocs(collection(db, 'id_cards'));
            const targetRegClean = regNo.trim().toLowerCase();
            const targetEmailClean = (csvMatch?.email || '').trim().toLowerCase();
            const targetNameClean = (csvMatch?.name || '').trim().toLowerCase();

            allDocsSnapshot.forEach((d) => {
              const data = d.data();
              const docReg = (data.registrationNumber || '').trim().toLowerCase();
              const docEmail = (data.email || d.id || '').trim().toLowerCase();
              const docName = (data.name || '').trim().toLowerCase();

              if (docReg) firestoreDocsMap[docReg] = data;
              if (docEmail) firestoreDocsMap[docEmail] = data;

              // Match target member
              if (
                (docReg && docReg === targetRegClean) ||
                (docEmail && targetEmailClean && docEmail === targetEmailClean) ||
                (docName && targetNameClean && docName === targetNameClean)
              ) {
                firestoreDoc = data;
              }
            });
          } catch (fsErr) {
            console.warn('Firestore query notice:', fsErr);
          }
        }

        // Enrich CSV members with Firestore avatarUrl / photoUrl if available
        const enrichedCsvMembers = csvList.map((m) => {
          const regClean = m.registrationNumber.trim().toLowerCase();
          const emailClean = m.email.trim().toLowerCase();
          const docData = firestoreDocsMap[regClean] || firestoreDocsMap[emailClean];
          const avatar =
            docData?.avatarUrl ||
            docData?.gifUrl ||
            docData?.avatar ||
            docData?.photoUrl ||
            docData?.imageUrl ||
            '';
          return {
            ...m,
            avatarUrl: avatar,
          };
        });

        setAllCsvMembers(enrichedCsvMembers);

        // 3. Validate existence
        if (!firestoreDoc && !csvMatch) {
          setError(`No verified ID Card dossier found for registration number: ${regNo}`);
          setLoading(false);
          return;
        }

        // 4. Extract target member photoUrl & avatarUrl from Firestore
        const name = firestoreDoc?.name || csvMatch?.name || 'VRGC Member';
        const phone = firestoreDoc?.phone || csvMatch?.phone || '';
        const email = firestoreDoc?.email || csvMatch?.email || '';
        const assignedTeam = firestoreDoc?.team || csvMatch?.team || 'General';
        const position = firestoreDoc?.position || csvMatch?.position || 'Core Member';
        const role = position;

        const rawPhoto =
          firestoreDoc?.photoUrl ||
          firestoreDoc?.imageUrl ||
          firestoreDoc?.image ||
          firestoreDoc?.photo ||
          firestoreDoc?.avatarUrl ||
          '';

        const photoUrl =
          rawPhoto ||
          `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(name)}&backgroundColor=0a0a0f`;

        const imageUrl = photoUrl;
        const avatarUrl = firestoreDoc?.avatarUrl || firestoreDoc?.gifUrl || firestoreDoc?.avatar || photoUrl || '';

        const specialization =
          firestoreDoc?.specialization ||
          firestoreDoc?.department ||
          (csvMatch ? `${csvMatch.team} Division` : 'Game Dev & Esports');

        const joinDate =
          firestoreDoc?.joinDate ||
          firestoreDoc?.joinedDate ||
          firestoreDoc?.submittedAt ||
          '2024-08-01';

        const merged: UnifiedMember = {
          id: regNo,
          regNo: regNo,
          name,
          phone,
          email,
          assignedTeam,
          position,
          role,
          photoUrl,
          imageUrl,
          avatarUrl,
          joinDate,
          specialization,
          rating: firestoreDoc?.rating || 4.9,
          fromFirestore: Boolean(firestoreDoc),
          fromCsv: Boolean(csvMatch),
        };

        setMember(merged);
      } catch (err) {
        console.error('Error fetching dynamic member card:', err);
        setError('System calibration failed. Unable to fetch registry records.');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [regNo]);

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

  return <EntryExperience targetMember={member} csvMembers={allCsvMembers} />;
}
