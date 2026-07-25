"use client";

import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import EntryExperience from '@/components/animation/EntryExperience';
import { Member } from '@/components/animation/members';

interface PublicIDCardProps {
  params: Promise<{
    regNo: string;
  }>;
}

export default function VerifyCardPage({ params }: PublicIDCardProps) {
  const [regNo, setRegNo] = useState<string>('');
  const [member, setMember] = useState<any>(null);
  const [otherMembers, setOtherMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [replayKey, setReplayKey] = useState<number>(0);

  useEffect(() => {
    params.then(p => setRegNo(p.regNo));
  }, [params]);

  useEffect(() => {
    const fetchMemberCard = async () => {
      if (!regNo) return;
      setLoading(true);
      setError('');
      try {
        if (db) {
          // Fetch target member card
          const q = query(collection(db, 'id_cards'), where('registrationNumber', '==', regNo));
          const snapshot = await getDocs(q);
          if (snapshot.empty) {
            setError(`No verified ID Card dossier found for registration number: ${regNo}`);
          } else {
            let foundDoc: any = null;
            snapshot.forEach(doc => {
              foundDoc = doc.data();
            });
            setMember(foundDoc);

            // Fetch real avatars submitted by other club members for the orbital deck shuffle
            try {
              const allQ = query(collection(db, 'id_cards'));
              const allSnapshot = await getDocs(allQ);
              const roster: Member[] = [];
              allSnapshot.forEach(docSnap => {
                const d = docSnap.data();
                if (d.registrationNumber) {
                  roster.push({
                    id: d.registrationNumber,
                    name: d.name || 'Member',
                    regNo: d.registrationNumber,
                    phone: d.phone || 'N/A',
                    photoUrl: d.photoUrl || '',
                    avatarUrl: d.avatarUrl || d.photoUrl || '',
                    assignedTeam: d.team || 'Development',
                    role: d.position || 'Core Member',
                    qrCodeUrl: d.qrCodeUrl || '',
                    rating: 4.9,
                    joinDate: d.submittedAt ? d.submittedAt.split('T')[0] : '2025-01-01',
                    specialization: `${d.team || 'Member'} • ${d.position || 'Core'}`,
                  });
                }
              });
              setOtherMembers(roster);
            } catch (rErr) {
              console.warn("Could not load full roster for animation deck:", rErr);
            }
          }
        } else {
          setError(`No verified ID Card dossier found for registration number: ${regNo}`);
        }
      } catch (err) {
        console.error("Error fetching public card:", err);
        setError("System calibration failed. Unable to fetch registry records.");
      } finally {
        setLoading(false);
      }
    };

    fetchMemberCard();
  }, [regNo]);

  const scannedMember: Member | null = member ? {
    id: member.registrationNumber || regNo,
    name: member.name || 'Member',
    regNo: member.registrationNumber || regNo,
    phone: member.phone || '+91 98765 43210',
    photoUrl: member.photoUrl || '',
    avatarUrl: member.avatarUrl || member.photoUrl || '',
    assignedTeam: member.team || 'Development',
    role: member.position || 'Core Member',
    qrCodeUrl: member.qrCodeUrl || '',
    rating: 4.9,
    joinDate: member.submittedAt ? member.submittedAt.split('T')[0] : '2025-01-01',
    specialization: `${member.team || 'VRGC Member'} • ${member.position || 'Core'}`,
  } : null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-mesh text-white p-6">
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-t-2 border-t-[#a855f7] border-white/5 animate-spin"></div>
          <p className="font-code-sm text-xs text-white/50 tracking-widest uppercase">FETCHING DIGITAL REGISTRY...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-mesh text-white p-6">
        <div className="glass-panel p-8 rounded-3xl border border-red-500/20 bg-black/60 backdrop-blur-md space-y-6 max-w-md text-center">
          <span className="material-symbols-outlined text-red-400 text-5xl animate-bounce">gavel</span>
          <div className="space-y-2">
            <h3 className="font-display-lg text-lg text-white font-extrabold tracking-widest uppercase">VERIFICATION FAILED</h3>
            <p className="font-body-md text-xs text-red-400/80 leading-relaxed">{error}</p>
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
    <div className="relative min-h-screen w-full bg-black overflow-hidden">
      {scannedMember && (
        <EntryExperience 
          key={replayKey}
          targetMember={scannedMember} 
          otherMembers={otherMembers}
          onSkip={() => setReplayKey(prev => prev + 1)}
        />
      )}
      
      {/* Quick replay button */}
      <div className="fixed top-4 left-4 z-[60]">
        <button
          type="button"
          onClick={() => setReplayKey(prev => prev + 1)}
          className="px-4 py-2 rounded-full border border-[#a855f7]/40 bg-black/80 backdrop-blur-md text-[#d8b4fe] font-code-sm text-xs tracking-wider uppercase hover:bg-[#a855f7]/20 transition-all cursor-pointer shadow-[0_0_15px_rgba(168,85,247,0.3)] flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">replay</span>
          <span>Replay Cyber Reveal</span>
        </button>
      </div>

      {/* Return home button */}
      <div className="fixed top-4 right-4 z-[60]">
        <Link
          href="/"
          className="px-4 py-2 rounded-full border border-purple-500/40 bg-black/80 backdrop-blur-md text-purple-300 font-code-sm text-xs tracking-wider uppercase hover:bg-purple-500/20 transition-all shadow-[0_0_15px_rgba(168,85,247,0.3)] inline-flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">home</span>
          <span>Home</span>
        </Link>
      </div>
    </div>
  );
}
