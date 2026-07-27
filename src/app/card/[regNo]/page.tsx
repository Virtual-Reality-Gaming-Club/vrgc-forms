import React, { cache } from 'react';
import { Metadata } from 'next';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import VerifyCardClient from './VerifyCardClient';
import { UnifiedMember } from './types';

// ISR: revalidate this page every 5 minutes
export const revalidate = 300;

interface PageProps {
  params: Promise<{
    regNo: string;
  }>;
}

const SUPABASE_STORAGE_BASE = 'https://fopyejijjeoumimsdgiz.supabase.co/storage/v1/object/public/id-cards';

function formatSupabaseUrl(urlOrPath: string, isAvatar: boolean = false): string {
  if (!urlOrPath) return '';
  const trimmed = urlOrPath.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const cleanPath = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  if (cleanPath.startsWith('id-photos/') || cleanPath.startsWith('avatars/')) {
    return `${SUPABASE_STORAGE_BASE}/${cleanPath}`;
  }
  if (isAvatar || cleanPath.toLowerCase().endsWith('.gif')) {
    return `${SUPABASE_STORAGE_BASE}/avatars/${cleanPath}`;
  }
  return `${SUPABASE_STORAGE_BASE}/id-photos/${cleanPath}`;
}

// cache() deduplicates calls — generateMetadata and VerifyCardPage share one Firestore fetch
const getMemberData = cache(async function getMemberData(regNo: string) {
  let member: any = null;
  let otherMembers: UnifiedMember[] = [];
  let error: string | null = null;

  const regUpper = regNo.toUpperCase();
  const regLower = regNo.toLowerCase();

  try {
    if (db) {
      let q = query(collection(db, 'id_cards'), where('registrationNumber', '==', regUpper));
      let snapshot = await getDocs(q);

      if (snapshot.empty) {
        q = query(collection(db, 'id_cards'), where('registrationNumber', '==', regNo));
        snapshot = await getDocs(q);
      }
      if (snapshot.empty) {
        q = query(collection(db, 'id_cards'), where('registrationNumber', '==', regLower));
        snapshot = await getDocs(q);
      }
      if (snapshot.empty) {
        q = query(collection(db, 'id_cards'), where('regNo', '==', regUpper));
        snapshot = await getDocs(q);
      }

      if (!snapshot.empty) {
        snapshot.forEach(doc => {
          member = doc.data();
        });

        // Fetch small sample roster for orbital deck animation (limit 8 for instant speed)
        try {
          const allQ = query(collection(db, 'id_cards'), limit(8));
          const allSnapshot = await getDocs(allQ);
          allSnapshot.forEach(docSnap => {
            const d = docSnap.data();
            const rNo = d.registrationNumber || d.regNo || docSnap.id;
            if (rNo) {
              const photo = formatSupabaseUrl(d.photoUrl || d.photo_url || d.photoURL || d.photo || d.image || d.imageUrl || '');
              const avatar = formatSupabaseUrl(d.gifUrl || d.avatarUrl || d.avatar_url || d.avatarURL || d.avatar || '', true) || photo;
              otherMembers.push({
                id: rNo,
                name: d.name || 'Member',
                regNo: rNo,
                phone: d.phone || 'N/A',
                email: d.email || '',
                photoUrl: photo,
                imageUrl: photo,
                avatarUrl: avatar,
                assignedTeam: d.team || d.assignedTeam || 'Development',
                position: d.position || d.role || 'Core Member',
                role: d.position || d.role || 'Core Member',
                rating: 4.9,
                joinDate: d.submittedAt ? String(d.submittedAt).split('T')[0] : '2025-01-01',
                specialization: `${d.team || 'Member'} • ${d.position || 'Core'}`,
                fromFirestore: true,
                fromCsv: false,
              });
            }
          });
        } catch (rErr) {
          console.warn("Server roster fetch error:", rErr);
        }
      } else {
        error = `No verified ID Card dossier found for registration number: ${regNo}`;
      }
    }
  } catch (err) {
    console.error("Server fetch error:", err);
    error = "System calibration failed. Unable to fetch registry records.";
  }

  return { member, otherMembers, error };
});

// Dynamic OpenGraph SEO Metadata for Social Media Sharing (SSR)
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { regNo } = await params;
  const { member } = await getMemberData(regNo);

  if (!member) {
    return {
      title: `Verification Failed | VRGC Member Portal`,
      description: `No verified ID card dossier found for registration number ${regNo}.`,
    };
  }

  const name = member.name || 'Member';
  const role = member.position || 'Core Member';
  const team = member.team || 'VRGC';
  const photo = formatSupabaseUrl(member.photoUrl || member.photo_url || member.photoURL || member.photo || member.image || member.imageUrl || '');

  return {
    title: `${name} | VRGC Verified Member`,
    description: `Official Verified Dossier for ${name} (${regNo}) — ${role} in ${team} Team at Virtual Reality & Gaming Club.`,
    openGraph: {
      title: `${name} • VRGC Official ID Card`,
      description: `VRGC Verified Dossier • ${role} | ${team}`,
      url: `https://vrgcforms.vercel.app/card/${regNo}`,
      siteName: 'VRGC Member Registry',
      images: photo ? [{ url: photo, width: 800, height: 800, alt: `${name} Profile Photo` }] : [],
      type: 'profile',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} | VRGC Verified ID Card`,
      description: `Verified Member Dossier (${regNo}) • ${role} of ${team}`,
      images: photo ? [photo] : [],
    },
  };
}

export default async function VerifyCardPage({ params }: PageProps) {
  const { regNo } = await params;
  const { member, otherMembers, error } = await getMemberData(regNo);

  const photo = formatSupabaseUrl(member?.photoUrl || member?.photo_url || member?.photoURL || member?.photo || member?.image || member?.imageUrl || '');
  const avatar = formatSupabaseUrl(member?.gifUrl || member?.avatarUrl || member?.avatar_url || member?.avatarURL || member?.avatar || '', true) || photo;

  const scannedMember: UnifiedMember | null = member ? {
    id: member.registrationNumber || member.regNo || regNo,
    name: member.name || 'Member',
    regNo: member.registrationNumber || member.regNo || regNo,
    phone: member.phone || '+91 98765 43210',
    email: member.email || '',
    photoUrl: photo,
    imageUrl: photo,
    avatarUrl: avatar,
    assignedTeam: member.team || member.assignedTeam || 'Development',
    position: member.position || member.role || 'Core Member',
    role: member.position || member.role || 'Core Member',
    rating: 4.9,
    joinDate: member.submittedAt ? String(member.submittedAt).split('T')[0] : '2025-01-01',
    specialization: `${member.team || 'VRGC Member'} • ${member.position || 'Core'}`,
    fromFirestore: true,
    fromCsv: false,
  } : null;

  return (
    <>
      {scannedMember?.avatarUrl && (
        <link rel="preload" as="image" href={scannedMember.avatarUrl} fetchPriority="high" />
      )}
      {scannedMember?.photoUrl && (
        <link rel="preload" as="image" href={scannedMember.photoUrl} fetchPriority="high" />
      )}
      <VerifyCardClient 
        scannedMember={scannedMember} 
        otherMembers={otherMembers} 
        initialError={error}
        regNo={regNo}
      />
    </>
  );
}
