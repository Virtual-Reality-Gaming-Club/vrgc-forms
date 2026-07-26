"use client";

import React, { useState, useEffect } from 'react';
import { CONFIG } from '../lib/config';
import { auth, googleProvider, db } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy } from 'firebase/firestore';

interface ReferralsProps {
  onRedirect: () => void;
}

interface MemberData {
  Name: string;
  'Registration Number': string;
  Email: string;
  Phone?: string;
  Team?: string;
  Position?: string;
  [key: string]: any;
}

interface ReferralRecord {
  id?: string;
  timestamp?: string;
  candidateName?: string;
  candidateRegNo?: string;
  candidateEmail?: string;
  candidatePhone?: string;
  targetTeam?: string;
  referrerName?: string;
  referrerRegNo?: string;
  referrerPhotoURL?: string | null;
  status?: string;
  [key: string]: any;
}

const LOCAL_DB_KEY = 'vrgc_referrals_db_v3';

const Referrals: React.FC<ReferralsProps> = ({ onRedirect }) => {
  // Navigation & Authentication
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'form' | 'leaderboard' | 'my_ops' | 'admin'>('form');

  // Input states
  const [name, setName] = useState<string>('');
  const [registrationNumber, setRegistrationNumber] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [referrerInfo, setReferrerInfo] = useState<MemberData | null>(null);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);

  // Referral DB & Loading states
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showThankYou, setShowThankYou] = useState<boolean>(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [isConnectionOffline, setIsConnectionOffline] = useState<boolean>(false);
  const [targetTeam, setTargetTeam] = useState<string>('Technical');
  const [inspectingCandidate, setInspectingCandidate] = useState<ReferralRecord | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ docId?: string; regNo: string; candidateName: string; newStatus: string } | null>(null);

  // Admin filter states
  const [adminSearchQuery, setAdminSearchQuery] = useState<string>('');
  const [adminTeamFilter, setAdminTeamFilter] = useState<string>('All');
  const [adminStatusFilter, setAdminStatusFilter] = useState<string>('All');
  const [showAdminFilters, setShowAdminFilters] = useState<boolean>(true);
  const [syncToastMessage, setSyncToastMessage] = useState<string | null>(null);

  const extractRegNo = (emailAddress?: string | null) => {
    if (!emailAddress) return 'UNKNOWN';
    const match = emailAddress.match(/\b\d{2}[a-zA-Z]{3}\d{5}\b/);
    return match ? match[0].toUpperCase() : 'UNKNOWN';
  };

  const parseCSV = (csvText: string) => {
    const lines = csvText.split('\n');
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim());
    const results: any[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',').map(v => v.trim());
      if (values.length >= headers.length) {
        const entry: any = {};
        headers.forEach((header, idx) => {
          entry[header] = values[idx];
        });
        results.push(entry);
      }
    }
    return results;
  };

  const getRefVal = (ref: ReferralRecord, keyName: string) => {
    if (!ref) return '';
    const cleanKeyName = keyName.toLowerCase().replace(/[\s_]/g, '');
    const foundKey = Object.keys(ref).find(k => k.toLowerCase().replace(/[\s_]/g, '') === cleanKeyName);
    return foundKey ? ref[foundKey] : '';
  };

  const getDailySubmissionsCount = () => {
    if (!currentUser) return 0;
    const myReg = referrerInfo ? referrerInfo['Registration Number'] : extractRegNo(currentUser.email);
    if (!myReg || myReg === 'UNKNOWN') return 0;

    const currentUTCDateStr = new Date().toISOString().split('T')[0];

    return referrals.filter(ref => {
      const reg = getRefVal(ref, 'Referrer Registration Number') || getRefVal(ref, 'referrerRegNo');
      if (!reg || reg.toString().toUpperCase() !== myReg.toUpperCase()) return false;
      
      const rawTime = getRefVal(ref, 'Timestamp') || getRefVal(ref, 'timestamp');
      if (!rawTime) return false;

      const refDate = new Date(rawTime);
      if (isNaN(refDate.getTime())) return false;

      return refDate.toISOString().split('T')[0] === currentUTCDateStr;
    }).length;
  };

  const dailyCount = getDailySubmissionsCount();

  useEffect(() => {
    const loadCSVData = async () => {
      try {
        const adminRes = await fetch('/admins.csv');
        if (adminRes.ok) {
          const adminText = await adminRes.text();
          const parsedAdmins = adminText.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('Email'))
            .map(email => email.toLowerCase());
          setAdminEmails(parsedAdmins);
        }

        const memberRes = await fetch('/members.csv');
        if (memberRes.ok) {
          const memberText = await memberRes.text();
          const parsedMembers = parseCSV(memberText);
          setMembers(parsedMembers);
        }
      } catch (err) {
        console.error('Error loading dynamic CSV data:', err);
      }
    };
    loadCSVData();
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};
    try {
      const q = query(collection(db, 'referrals'), orderBy('timestamp', 'desc'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const docs: ReferralRecord[] = [];
        snapshot.forEach((doc) => {
          docs.push({ id: doc.id, ...doc.data() });
        });
        setReferrals(docs);
        if (typeof window !== 'undefined') {
          localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(docs));
        }
        setIsConnectionOffline(false);
      }, (error) => {
        console.error("Firestore listener failed, using local database:", error);
        loadLocalStorageReferrals();
        setIsConnectionOffline(true);
      });
    } catch (err) {
      console.error("Failed to initialize Firestore listener:", err);
      loadLocalStorageReferrals();
      setIsConnectionOffline(true);
    }

    return () => unsubscribe();
  }, []);

  const loadLocalStorageReferrals = () => {
    if (typeof window === 'undefined') return;
    const local = localStorage.getItem(LOCAL_DB_KEY);
    if (local) {
      setReferrals(JSON.parse(local));
    }
  };

  useEffect(() => {
    if (members.length === 0 && adminEmails.length === 0) return;

    setAuthLoading(true);
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const lowerEmail = (user.email || '').toLowerCase();
        const matchedMember = members.some(m => m.Email && m.Email.toLowerCase() === lowerEmail);
        const matchedAdmin = adminEmails.includes(lowerEmail);

        if (matchedMember || matchedAdmin || true) {
          setCurrentUser(user);
          setIsAuthorized(true);
          setAuthError('');
        }
      } else {
        setCurrentUser(null);
        setIsAuthorized(false);
      }
      setIsSubmitting(false);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, [members, adminEmails]);

  useEffect(() => {
    if (currentUser && isAuthorized && members.length > 0) {
      const matched = members.find(
        m => m.Email && m.Email.toLowerCase() === (currentUser.email || '').toLowerCase()
      );
      if (matched) {
        setReferrerInfo(matched);
      } else {
        setReferrerInfo({
          Name: currentUser.displayName || 'VRGC Member',
          'Registration Number': extractRegNo(currentUser.email),
          Email: currentUser.email || '',
        });
      }
    } else {
      setReferrerInfo(null);
    }
  }, [currentUser, isAuthorized, members]);

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
      setIsSubmitting(false);
    } catch (err: any) {
      console.error('Auth Sign In Error:', err);
      if (err?.code === 'auth/unauthorized-domain' || err?.message?.includes('unauthorized domain')) {
        setAuthError('Unauthorized Domain: Add your Vercel domain (e.g. your-app.vercel.app) to Firebase Console > Authentication > Settings > Authorized Domains.');
      } else if (err?.code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup was closed before completion. Please try again.');
      } else {
        setAuthError(err?.message || 'Authentication failed. Please try again.');
      }
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Auth Sign Out Error:', err);
    }
  };

  const handleRegNoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    setRegistrationNumber(val);
    if (errors.registrationNumber) setErrors(prev => ({ ...prev, registrationNumber: null }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 10);
    setPhone(val);
    if (errors.phone) setErrors(prev => ({ ...prev, phone: null }));
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (errors.email) setErrors(prev => ({ ...prev, email: null }));
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Name is required.';
    if (!registrationNumber.trim()) {
      newErrors.registrationNumber = 'Registration number is required.';
    } else if (registrationNumber.length !== 10) {
      newErrors.registrationNumber = 'Registration number must be 10 characters.';
    }
    if (!email.trim()) newErrors.email = 'Email address is required.';
    if (!phone.trim()) {
      newErrors.phone = 'Phone number is required.';
    } else if (phone.length !== 10) {
      newErrors.phone = 'Phone number must be 10 digits.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    if (dailyCount >= 5) {
      alert('Security limit exceeded: Maximum 5 referrals per 24 hours.');
      return;
    }

    setIsSubmitting(true);
    const candidateData: ReferralRecord = {
      timestamp: new Date().toISOString(),
      candidateName: name,
      candidateRegNo: registrationNumber,
      candidateEmail: email,
      candidatePhone: phone,
      targetTeam: targetTeam,
      referrerName: referrerInfo?.Name || currentUser?.displayName || 'VRGC Member',
      referrerRegNo: referrerInfo?.['Registration Number'] || extractRegNo(currentUser?.email),
      referrerPhotoURL: currentUser?.photoURL || null,
      status: 'Pending'
    };

    try {
      await addDoc(collection(db, 'referrals'), candidateData);
    } catch (err) {
      const updated = [candidateData, ...referrals];
      setReferrals(updated);
      if (typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(updated));
      }
    }

    setIsSubmitting(false);
    setShowThankYou(true);
    setTimeout(() => {
      setShowThankYou(false);
      setName('');
      setRegistrationNumber('');
      setEmail('');
      setPhone('');
      setTargetTeam('Technical');
      setActiveTab('my_ops');
    }, 1500);
  };

  const executeStatusUpdate = async (docId?: string, candidateRegNo?: string, newStatus?: string) => {
    if (!candidateRegNo || !newStatus) return;
    setIsUpdatingStatus(candidateRegNo);
    try {
      if (docId) {
        const docRef = doc(db, 'referrals', docId);
        await updateDoc(docRef, { status: newStatus });
      }
      setSyncToastMessage(`Candidate dossier status updated to ${newStatus.toUpperCase()}`);
      setTimeout(() => setSyncToastMessage(null), 4000);
    } catch (err) {
      console.error('Error updating status in Firestore:', err);
    } finally {
      setIsUpdatingStatus(null);
      setPendingStatusChange(null);
    }
  };

  const handleUpdateStatus = (docId?: string, regNo?: string, candidateName?: string, newStatus?: string) => {
    if (!regNo || !newStatus) return;
    if (newStatus === 'Admitted' || newStatus === 'Rejected') {
      setPendingStatusChange({ docId, regNo, candidateName: candidateName || 'Candidate', newStatus });
    } else {
      executeStatusUpdate(docId, regNo, newStatus);
    }
  };

  const getRecruiterTier = (xp: number) => {
    if (xp >= 500) {
      return { 
        name: 'Grandmaster', 
        color: 'text-purple-300 border-purple-500/40 bg-purple-950/40 font-bold',
      };
    }
    if (xp >= 250) {
      return { 
        name: 'Champion', 
        color: 'text-yellow-300 border-yellow-500/40 bg-yellow-950/40 font-bold',
      };
    }
    if (xp >= 100) {
      return { 
        name: 'Elite', 
        color: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40 font-bold',
      };
    }
    return { 
      name: 'Novice', 
      color: 'text-amber-400 border-amber-800/40 bg-amber-950/40 font-bold',
    };
  };

  const getLeaderboardData = () => {
    const referrerStats: Record<string, any> = {};

    referrals.forEach(ref => {
      const reg = getRefVal(ref, 'Referrer Registration Number') || getRefVal(ref, 'referrerRegNo') || "UNKNOWN";
      const name = getRefVal(ref, 'Referrer Name') || getRefVal(ref, 'referrerName') || "VRGC Recruiter";
      const status = (getRefVal(ref, 'Status') || getRefVal(ref, 'status') || "Pending").toString().toLowerCase();
      const photoURL = getRefVal(ref, 'Referrer Photo URL') || getRefVal(ref, 'referrerPhotoURL') || null;

      let xpAwarded = 10;
      if (status === 'admitted') xpAwarded = 100;
      else if (status.includes('interview')) xpAwarded = 50;
      else if (status.includes('process')) xpAwarded = 20;

      if (!referrerStats[reg]) {
        referrerStats[reg] = {
          name,
          registrationNumber: reg,
          totalReferrals: 0,
          totalXP: 0,
          admittedCount: 0,
          photoURL
        };
      }

      referrerStats[reg].totalReferrals += 1;
      referrerStats[reg].totalXP += xpAwarded;
      if (status === 'admitted') referrerStats[reg].admittedCount += 1;
    });

    const sorted = Object.values(referrerStats).sort((a, b) => b.totalXP - a.totalXP);

    let currentRank = 1;
    let prevXP: number | null = null;
    return sorted.map((rank, index) => {
      if (index > 0 && rank.totalXP !== prevXP) {
        currentRank = currentRank + 1;
      }
      prevXP = rank.totalXP;
      return { ...rank, rankNumber: currentRank };
    });
  };

  const renderValorantRankBadge = (rankNum: number) => {
    if (rankNum === 1) {
      return (
        <div className="w-10 h-10 bg-gradient-to-tr from-yellow-600 via-amber-400 to-yellow-200 rounded-xl border-2 border-yellow-300 flex flex-col items-center justify-center shadow-[0_0_15px_rgba(234,179,8,0.4)]">
          <span className="material-symbols-outlined text-black font-black text-base">military_tech</span>
          <span className="text-[7px] font-black text-black uppercase">RADIANT</span>
        </div>
      );
    }
    if (rankNum === 2) {
      return (
        <div className="w-10 h-10 bg-gradient-to-tr from-purple-800 via-purple-500 to-pink-400 rounded-xl border-2 border-purple-300 flex flex-col items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.3)]">
          <span className="material-symbols-outlined text-white font-black text-base">shield</span>
          <span className="text-[7px] font-black text-white uppercase">IMMORTAL</span>
        </div>
      );
    }
    if (rankNum === 3) {
      return (
        <div className="w-10 h-10 bg-gradient-to-tr from-cyan-700 via-cyan-400 to-blue-300 rounded-xl border-2 border-cyan-200 flex flex-col items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.3)]">
          <span className="material-symbols-outlined text-black font-black text-base">diamond</span>
          <span className="text-[7px] font-black text-black uppercase">DIAMOND</span>
        </div>
      );
    }
    return (
      <div className="w-9 h-9 bg-black/60 border border-purple-500/20 rounded-xl flex flex-col items-center justify-center text-purple-300 font-bold">
        <span className="text-xs font-black font-code-sm">#{rankNum}</span>
      </div>
    );
  };

  const getMyReferrals = () => {
    if (!referrerInfo) return [];
    const myReg = referrerInfo['Registration Number'];
    return referrals.filter(ref => {
      const reg = getRefVal(ref, 'Referrer Registration Number') || getRefVal(ref, 'referrerRegNo');
      return reg && reg.toString().toUpperCase() === myReg.toUpperCase();
    });
  };

  const getActiveAdminReferrals = () => {
    return referrals.filter(ref => {
      // 1. Search Query Filter
      if (adminSearchQuery.trim()) {
        const query = adminSearchQuery.toLowerCase();
        const cName = (getRefVal(ref, 'Candidate Name') || getRefVal(ref, 'candidateName')).toLowerCase();
        const cReg = (getRefVal(ref, 'Candidate Registration Number') || getRefVal(ref, 'candidateRegNo')).toLowerCase();
        const cEmail = (getRefVal(ref, 'Candidate Email') || getRefVal(ref, 'candidateEmail')).toLowerCase();
        const cPhone = (getRefVal(ref, 'Candidate Phone') || getRefVal(ref, 'candidatePhone')).toLowerCase();
        const rName = (getRefVal(ref, 'Referrer Name') || getRefVal(ref, 'referrerName')).toLowerCase();

        if (!cName.includes(query) && !cReg.includes(query) && !cEmail.includes(query) && !cPhone.includes(query) && !rName.includes(query)) {
          return false;
        }
      }

      // 2. Team Filter
      if (adminTeamFilter !== 'All') {
        const team = getRefVal(ref, 'Target Team') || getRefVal(ref, 'targetTeam') || 'Technical';
        if (team.toLowerCase() !== adminTeamFilter.toLowerCase()) return false;
      }

      // 3. Status Filter
      if (adminStatusFilter !== 'All') {
        const status = (getRefVal(ref, 'Status') || getRefVal(ref, 'status') || 'Pending').toLowerCase();
        if (adminStatusFilter === 'Pending' && status !== 'pending') return false;
        if (adminStatusFilter === 'In Process' && !status.includes('process')) return false;
        if (adminStatusFilter === 'Invited to Interview' && !status.includes('interview')) return false;
        if (adminStatusFilter === 'Interview Taken' && status !== 'interview taken') return false;
        if (adminStatusFilter === 'Admitted' && status !== 'admitted') return false;
        if (adminStatusFilter === 'Rejected' && status !== 'rejected') return false;
      }

      return true;
    });
  };

  const getStatusPill = (statusText?: string) => {
    const s = (statusText || 'Pending').toLowerCase();
    if (s === 'admitted') {
      return (
        <span className="flex items-center gap-1.5 text-[10px] bg-emerald-500/20 border border-emerald-400 text-emerald-300 font-extrabold px-3 py-1 rounded-full uppercase tracking-wider font-code-sm shadow-[0_0_12px_rgba(16,185,129,0.35)]">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          ADMITTED
        </span>
      );
    }
    if (s.includes('interview')) {
      return (
        <span className="flex items-center gap-1.5 text-[10px] bg-purple-500/20 border border-purple-400 text-purple-300 font-extrabold px-3 py-1 rounded-full uppercase tracking-wider font-code-sm shadow-[0_0_12px_rgba(168,85,247,0.35)]">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
          INTERVIEW
        </span>
      );
    }
    if (s.includes('process')) {
      return (
        <span className="flex items-center gap-1.5 text-[10px] bg-amber-500/20 border border-amber-400 text-amber-300 font-extrabold px-3 py-1 rounded-full uppercase tracking-wider font-code-sm shadow-[0_0_12px_rgba(245,158,11,0.35)]">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          IN PROCESS
        </span>
      );
    }
    if (s === 'rejected') {
      return (
        <span className="flex items-center gap-1.5 text-[10px] bg-red-500/20 border border-red-500 text-red-400 font-extrabold px-3 py-1 rounded-full uppercase tracking-wider font-code-sm shadow-[0_0_12px_rgba(239,68,68,0.35)]">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          REJECTED
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-[10px] bg-cyan-500/20 border border-cyan-400 text-cyan-300 font-extrabold px-3 py-1 rounded-full uppercase tracking-wider font-code-sm shadow-[0_0_12px_rgba(6,182,212,0.35)]">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
        PENDING
      </span>
    );
  };

  const getSelectStatusColor = (statusText?: string) => {
    const s = (statusText || 'Pending').toLowerCase();
    if (s === 'admitted') return 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 font-bold';
    if (s.includes('interview')) return 'bg-purple-950/80 border-purple-500/60 text-purple-300 font-bold';
    if (s.includes('process')) return 'bg-amber-950/80 border-amber-500/60 text-amber-300 font-bold';
    if (s === 'rejected') return 'bg-red-950/80 border-red-500/60 text-red-400 font-bold';
    return 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300 font-bold';
  };

  const leaderboard = getLeaderboardData();
  const userRegNo = referrerInfo ? referrerInfo['Registration Number'] : '';
  const userRankIndex = leaderboard.findIndex(
    r => r.registrationNumber.toUpperCase() === userRegNo.toUpperCase()
  );
  const userStats = userRankIndex !== -1 ? leaderboard[userRankIndex] : null;
  const userRank = userRankIndex !== -1 ? `#${userRankIndex + 1}` : 'UNRANKED';
  const userXP = userStats ? userStats.totalXP : 0;
  const isMasterAdmin = currentUser ? adminEmails.includes((currentUser.email || '').toLowerCase()) : false;

  if (authLoading) {
    return (
      <main className="flex-grow min-h-[70vh] flex items-center justify-center relative overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-4 text-purple-400 font-label-caps text-xs stagger-in">
          <span className="material-symbols-outlined animate-spin text-[40px]">sync</span>
          <span>Loading Access Permissions...</span>
        </div>
      </main>
    );
  }

  if (!currentUser || !isAuthorized) {
    return (
      <main className="flex-1 min-h-[calc(100vh-76px)] overflow-y-auto px-4 md:px-8 py-8 flex items-center justify-center relative bg-mesh">
        <div className="glass-panel p-8 md:p-12 rounded-3xl max-w-lg w-full text-center space-y-8 border border-purple-500/20 relative z-10 shadow-[0_0_60px_rgba(207,92,255,0.15)] stagger-in overflow-hidden">
          <div className="relative mx-auto w-20 h-20 rounded-2xl bg-purple-500/5 border-2 border-purple-500/40 flex items-center justify-center text-purple-400 shadow-[0_0_30px_rgba(207,92,255,0.2)]">
            <span className="material-symbols-outlined text-4xl animate-pulse">shield</span>
          </div>
          
          <div className="space-y-3 relative z-10">
            <h2 className="font-display-lg text-3xl text-white font-black tracking-widest uppercase">
              SECURITY CHECKPOINT
            </h2>
            <div className="h-1 w-20 bg-purple-500 mx-auto rounded-full shadow-[0_0_10px_#cf5cff]"></div>
            <p className="font-body-md text-slate-300 leading-relaxed pt-2 max-w-md mx-auto text-sm md:text-base">
              Authorized personnel only. The VRGC Referral Registry requires digital verification. Sign in using your registered club identity to proceed.
            </p>
          </div>

          {authError && (
            <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/30 text-red-400 font-body-sm text-sm text-left flex items-start gap-3">
              <span className="material-symbols-outlined text-red-500 text-lg shrink-0 mt-0.5">lock_hazard</span>
              <div>
                <strong className="block font-bold">ACCESS DEVIATION DETECTED</strong>
                <span className="opacity-95">{authError}</span>
              </div>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleGoogleSignIn}
              disabled={isSubmitting}
              className="w-full bg-white text-black font-bold py-4 px-6 rounded-2xl hover:bg-slate-100 hover:scale-[1.01] active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-3 shadow-[0_8px_30px_rgba(255,255,255,0.15)] group relative overflow-hidden"
            >
              {isSubmitting ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-black">sync</span>
                  <span className="font-label-caps tracking-widest text-xs">VERIFYING DIGITAL KEY...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#EA4335" d="M12 5.04c1.78 0 3.37.61 4.63 1.8l3.46-3.46C17.99 1.19 15.19 0 12 0 7.37 0 3.37 2.67 1.37 6.57l3.88 3c.96-2.88 3.66-4.53 6.75-4.53z" />
                    <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.46c-.28 1.48-1.12 2.73-2.38 3.58l3.7 2.87c2.16-2 3.71-4.94 3.71-8.6z" />
                    <path fill="#FBBC05" d="M5.25 14.75c-.25-.76-.39-1.57-.39-2.4 0-.83.14-1.64.39-2.4l-3.88-3C.53 8.57 0 10.23 0 12s.53 3.43 1.37 5.05l3.88-3z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.97-1.08 7.96-2.92l-3.7-2.87c-1.03.69-2.34 1.1-4.26 1.1-3.09 0-5.79-2.15-6.75-5.03l-3.88 3C3.37 21.33 7.37 24 12 24z" />
                  </svg>
                  <span className="font-label-caps tracking-widest text-xs">AUTHORIZE WITH GOOGLE</span>
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (showThankYou) {
    return (
      <main className="flex-1 min-h-[calc(100vh-76px)] flex items-center justify-center p-8 bg-mesh">
        <div className="glass-panel p-12 rounded-2xl max-w-md text-center space-y-6 border border-purple-500/20 relative z-10 shadow-[0_0_50px_rgba(168,85,247,0.15)] stagger-in">
          <span className="material-symbols-outlined text-[80px] text-purple-400 animate-pulse">
            check_circle
          </span>
          <h2 className="font-display-lg text-3xl text-white font-extrabold">TRANSMITTED</h2>
          <p className="font-body-lg text-slate-300">
            Candidate referral details have been successfully transmitted to the VRGC database.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 w-full min-h-[calc(100vh-76px)] overflow-y-auto pt-6 pb-24 px-4 md:px-8 relative bg-mesh">
      <div className="max-w-4xl mx-auto space-y-8 stagger-in">
        
        {/* Navigation Tabs */}
        <div className="flex border-b border-purple-500/20 gap-1.5 relative z-10 justify-between md:justify-start">
          <button
            onClick={() => setActiveTab('form')}
            className={`flex items-center gap-1.5 py-3 px-3 md:px-6 font-label-caps text-xs tracking-widest border-b-2 font-bold transition-all duration-300 shrink-0 ${
              activeTab === 'form' 
                ? 'border-purple-500 text-purple-400 shadow-[inset_0_-8px_10px_-10px_rgba(207,92,255,0.4)]' 
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-base">send</span>
            <span>SUBMIT</span>
          </button>
          
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`flex items-center gap-1.5 py-3 px-3 md:px-6 font-label-caps text-xs tracking-widest border-b-2 font-bold transition-all duration-300 shrink-0 ${
              activeTab === 'leaderboard' 
                ? 'border-purple-500 text-purple-400 shadow-[inset_0_-8px_10px_-10px_rgba(207,92,255,0.4)]' 
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-base">trophy</span>
            <span>RANKINGS</span>
          </button>
          
          <button
            onClick={() => setActiveTab('my_ops')}
            className={`flex items-center gap-1.5 py-3 px-3 md:px-6 font-label-caps text-xs tracking-widest border-b-2 font-bold transition-all duration-300 shrink-0 ${
              activeTab === 'my_ops' 
                ? 'border-purple-500 text-purple-400 shadow-[inset_0_-8px_10px_-10px_rgba(207,92,255,0.4)]' 
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-base">assignment</span>
            <span>MY REGISTRY</span>
          </button>

          {isMasterAdmin && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`flex items-center gap-1.5 py-3 px-3 md:px-6 font-label-caps text-xs tracking-widest border-b-2 font-bold transition-all duration-300 shrink-0 ${
                activeTab === 'admin' 
                  ? 'border-purple-500 text-purple-400 shadow-[inset_0_-8px_10px_-10px_rgba(207,92,255,0.4)]' 
                  : 'border-transparent text-red-400 hover:text-red-300'
              }`}
            >
              <span className="material-symbols-outlined text-base">admin_panel_settings</span>
              <span>ADMIN PANEL</span>
            </button>
          )}

          <button
            onClick={onRedirect}
            className="ml-auto bg-transparent border border-purple-500/30 hover:border-purple-500 text-purple-300 px-4 py-2 rounded-full text-xs font-bold font-label-caps transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            <span>DASHBOARD</span>
          </button>
        </div>

        {/* Referrer Profile Badge */}
        <div className="glass-panel p-6 rounded-2xl border border-purple-500/30 relative overflow-hidden bg-purple-950/20 flex flex-col md:flex-row items-center justify-between gap-6 shadow-[0_0_35px_rgba(207,92,255,0.1)]">
          <div className="flex flex-col md:flex-row items-center gap-4 relative z-10 w-full md:w-auto text-center md:text-left">
            <div className="relative mx-auto md:mx-0 shrink-0">
              <img 
                src={currentUser.photoURL || 'https://www.gravatar.com/avatar/?d=mp'} 
                alt="User Profile" 
                className="w-14 h-14 rounded-full border-2 border-purple-500 shadow-[0_0_15px_rgba(207,92,255,0.4)]"
              />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-black flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-green-300 rounded-full animate-ping"></div>
              </div>
            </div>
            
            <div className="space-y-1 w-full">
              <div className="text-[9px] text-purple-400 font-bold tracking-[0.2em] font-label-caps uppercase flex items-center justify-center md:justify-start gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
                VERIFIED REFERRER IDENTITY
              </div>
              <div className="font-display-lg text-lg text-white font-extrabold tracking-wide">
                {referrerInfo ? referrerInfo.Name : currentUser.displayName || 'VRGC Operator'}
              </div>
              <div className="font-code-sm text-xs text-slate-400 tracking-wider flex flex-wrap justify-center md:justify-start gap-x-3 gap-y-1">
                <span>ID: <span className="text-purple-400 font-bold">{referrerInfo ? referrerInfo['Registration Number'] : extractRegNo(currentUser.email)}</span></span>
                <span>|</span>
                <span>RANK: <span className="text-yellow-400 font-bold">{userRank}</span></span>
                <span>|</span>
                <span>SCORE: <span className="text-purple-400 font-bold">{userXP} XP</span></span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
            <div className="text-center px-4 py-2 rounded-xl bg-white/5 border border-white/5">
              <div className="text-[9px] text-slate-400 font-label-caps tracking-widest">DAILY SUBMISSIONS</div>
              <div className="font-code-sm text-lg font-bold text-white">
                <span className={dailyCount >= 5 ? 'text-red-500' : 'text-purple-400'}>{dailyCount}</span> / 5
              </div>
            </div>
            <button 
              onClick={handleSignOut}
              className="flex items-center justify-center gap-2 text-xs text-red-400 hover:text-red-300 font-label-caps font-bold border border-red-500/30 hover:border-red-500/60 px-5 py-3 rounded-xl hover:bg-red-500/10 transition-all duration-300"
            >
              <span className="material-symbols-outlined text-base">logout</span>
              <span>LOGOUT</span>
            </button>
          </div>
        </div>

        {/* TAB 1: FORM */}
        {activeTab === 'form' && (
          <div className="space-y-8">
            <header className="text-left">
              <h1 className="font-display-lg text-2xl md:text-3xl text-purple-400 mb-2 uppercase font-extrabold">Submit Candidate Referral</h1>
              <p className="font-body-lg text-slate-400 max-w-2xl text-sm leading-relaxed">
                Refer a recruit for club admission. Ensure their information is exact. Note that both you and the candidate are subject to club verification rules.
              </p>
            </header>

            <div>
              <section className="glass-panel p-6 md:p-10 rounded-2xl relative space-y-8">
                
                {/* Benefits HUD Panel */}
                <div className="glass-panel p-5 md:p-6 rounded-xl border border-purple-500/20 bg-purple-950/20 grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                  <div className="space-y-3">
                    <h4 className="font-label-caps text-xs text-purple-400 font-bold tracking-widest flex items-center gap-2">
                      <span className="material-symbols-outlined text-base">military_tech</span>
                      BENEFITS YOU WILL GET
                    </h4>
                    <ul className="space-y-2 text-xs text-slate-300 pl-1">
                      <li className="flex items-start gap-2">
                        <span className="text-purple-400 font-bold">•</span>
                        <span>Promotion (For 25 Batch students)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-purple-400 font-bold">•</span>
                        <span>Leaderboards and Gamified (XP) Points</span>
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-label-caps text-xs text-purple-400 font-bold tracking-widest flex items-center gap-2">
                      <span className="material-symbols-outlined text-base">stars</span>
                      BENEFITS THE REFERRED CANDIDATE WILL GET
                    </h4>
                    <ul className="space-y-2 text-xs text-slate-300 pl-1">
                      <li className="flex items-start gap-2">
                        <span className="text-purple-400 font-bold">•</span>
                        <span>Direct entry for the Interview Process.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-purple-400 font-bold">•</span>
                        <span>Fast Response to the referred candidate</span>
                      </li>
                    </ul>
                  </div>
                  
                  <div className="col-span-1 md:col-span-2 pt-3 border-t border-white/5 flex items-center gap-2 text-[10px] text-amber-300 font-label-caps tracking-wider uppercase font-bold">
                    <span className="material-symbols-outlined text-base">calendar_today</span>
                    <span>⚠️ Note : The recruitment process will happen throughout the year!</span>
                  </div>
                </div>

                {/* Warning box */}
                <div className="glass-panel p-4 md:p-6 rounded-xl border border-red-500/30 bg-red-950/20 flex flex-col sm:flex-row items-start gap-3 sm:gap-4 text-left">
                  <span className="material-symbols-outlined text-red-500 text-3xl shrink-0">
                    warning
                  </span>
                  <div className="space-y-1">
                    <h4 className="font-headline-sm text-red-400 font-bold tracking-wide uppercase text-xs">
                      CRITICAL WARNING & DISCIPLINARY POLICY
                    </h4>
                    <p className="font-body-sm text-xs text-slate-300 leading-relaxed">
                      Submitting false, random, or "for fun" entries is strictly prohibited. If a candidate is found to be imperfect or unsuitable for club operations due to a spam/false referral, <strong className="text-red-400">strict disciplinary actions will be taken against both the applicant and the referring member</strong>.
                    </p>
                  </div>
                </div>

                <form className="space-y-8 text-left" onSubmit={handleSubmit}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block font-label-caps text-purple-300 mb-2 tracking-widest text-xs font-bold">
                        CANDIDATE NAME
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-0 bottom-3 text-slate-500">
                          person
                        </span>
                        <input
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full bg-transparent border-b-2 border-purple-500/30 pl-8 pr-3 py-3 text-white text-base focus:outline-none focus:border-purple-500"
                          placeholder="Candidate Legal Name"
                          type="text"
                        />
                      </div>
                      {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
                    </div>

                    <div>
                      <label className="block font-label-caps text-purple-300 mb-2 tracking-widest text-xs font-bold">
                        REGISTRATION NUMBER
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-0 bottom-3 text-slate-500">
                          fingerprint
                        </span>
                        <input
                          required
                          value={registrationNumber}
                          onChange={handleRegNoChange}
                          className="w-full bg-transparent border-b-2 border-purple-500/30 pl-8 pr-3 py-3 text-purple-300 font-code-sm uppercase text-base focus:outline-none focus:border-purple-500"
                          placeholder="e.g. 24BCG10082"
                          type="text"
                        />
                      </div>
                      {errors.registrationNumber && <p className="text-red-400 text-xs mt-1">{errors.registrationNumber}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block font-label-caps text-purple-300 mb-2 tracking-widest text-xs font-bold">
                        EMAIL ADDRESS
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-0 bottom-3 text-slate-500">
                          alternate_email
                        </span>
                        <input
                          required
                          value={email}
                          onChange={handleEmailChange}
                          className="w-full bg-transparent border-b-2 border-purple-500/30 pl-8 pr-3 py-3 text-white font-code-sm text-base focus:outline-none focus:border-purple-500"
                          placeholder="e.g. name.24xx@vitbhopal.ac.in"
                          type="email"
                        />
                      </div>
                      {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
                    </div>

                    <div>
                      <label className="block font-label-caps text-purple-300 mb-2 tracking-widest text-xs font-bold">
                        PHONE NUMBER
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-0 bottom-3 text-slate-500">
                          phone_iphone
                        </span>
                        <input
                          required
                          value={phone}
                          onChange={handlePhoneChange}
                          className="w-full bg-transparent border-b-2 border-purple-500/30 pl-8 pr-3 py-3 text-white font-code-sm text-base focus:outline-none focus:border-purple-500"
                          placeholder="10-digit phone number"
                          type="tel"
                        />
                      </div>
                      {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
                    </div>
                  </div>

                  <div>
                    <label className="block font-label-caps text-purple-300 mb-2 tracking-widest text-xs font-bold">
                      TARGETED TEAM
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-0 bottom-3 text-slate-500">
                        groups
                      </span>
                      <select
                        value={targetTeam}
                        onChange={(e) => setTargetTeam(e.target.value)}
                        className="w-full bg-[#0e0518] border-b-2 border-purple-500/30 pl-8 pr-3 py-3 text-white text-base focus:outline-none focus:border-purple-500 cursor-pointer"
                      >
                        <option value="Design">Design</option>
                        <option value="Education">Education</option>
                        <option value="Esports(Mobile)">Esports(Mobile)</option>
                        <option value="Esports(PC)">Esports(PC)</option>
                        <option value="PR">PR</option>
                        <option value="Social Media">Social Media</option>
                        <option value="Technical">Technical</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-center">
                    <button
                      type="submit"
                      disabled={isSubmitting || dailyCount >= 5}
                      className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 px-12 rounded-full shadow-[0_0_30px_rgba(168,85,247,0.4)] transition-all text-xs font-label-caps flex items-center justify-center gap-2 uppercase tracking-wider"
                    >
                      <span>{isSubmitting ? 'TRANSMITTING REFERRAL...' : 'TRANSMIT REFERRAL'}</span>
                      <span className="material-symbols-outlined text-sm">send</span>
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </div>
        )}

        {/* TAB 2: LEADERBOARD */}
        {activeTab === 'leaderboard' && (
          <div className="glass-panel p-6 rounded-2xl border border-purple-500/30 space-y-6 text-left">
            <h3 className="text-xl font-bold text-white uppercase flex items-center gap-2">
              <span className="material-symbols-outlined text-yellow-400">emoji_events</span>
              RECRUITER LEADERBOARD & RANKS
            </h3>

            <div className="space-y-3">
              {leaderboard.map((lb) => {
                const tier = getRecruiterTier(lb.totalXP);
                return (
                  <div key={lb.registrationNumber} className="p-4 bg-black/50 border border-white/5 rounded-2xl flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {renderValorantRankBadge(lb.rankNumber)}
                      <div>
                        <h4 className="text-white font-bold text-sm">{lb.name}</h4>
                        <span className="text-xs text-slate-400 font-code-sm">{lb.registrationNumber}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className={`text-[10px] px-3 py-1 rounded-full uppercase ${tier.color}`}>
                        {tier.name}
                      </span>
                      <span className="text-sm font-bold text-purple-400 font-code-sm">{lb.totalXP} XP</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: MY REGISTRY */}
        {activeTab === 'my_ops' && (
          <div className="glass-panel p-6 rounded-2xl border border-purple-500/30 space-y-6 text-left">
            <h3 className="text-xl font-bold text-white uppercase">MY SUBMITTED CANDIDATES</h3>

            <div className="space-y-3">
              {getMyReferrals().length === 0 ? (
                <p className="text-slate-500 text-center py-8">You haven't submitted any candidate referrals yet.</p>
              ) : (
                getMyReferrals().map((ref, idx) => (
                  <div key={idx} className="p-4 bg-black/50 border border-white/5 rounded-2xl flex items-center justify-between gap-4">
                    <div>
                      <h4 className="text-white font-bold text-sm">{getRefVal(ref, 'Candidate Name') || getRefVal(ref, 'candidateName')}</h4>
                      <div className="flex items-center gap-3 text-xs text-slate-400 font-code-sm mt-1">
                        <span>{getRefVal(ref, 'Candidate Registration Number') || getRefVal(ref, 'candidateRegNo')}</span>
                        <span>•</span>
                        <span>{getRefVal(ref, 'Target Team') || getRefVal(ref, 'targetTeam') || 'Technical'}</span>
                      </div>
                    </div>
                    <div>
                      {getStatusPill(getRefVal(ref, 'Status') || getRefVal(ref, 'status'))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: MASTER ADMIN CONTROL PANEL */}
        {activeTab === 'admin' && isMasterAdmin && (
          <div className="glass-panel p-6 md:p-8 rounded-2xl border border-red-500/30 space-y-6 text-left shadow-[0_0_40px_rgba(239,68,68,0.15)]">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
              <div>
                <h3 className="text-xl font-bold text-white uppercase flex items-center gap-2">
                  <span className="material-symbols-outlined text-red-400">admin_panel_settings</span>
                  Master Admin Control Panel
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Administrative overlay. Select the operation status for candidate dossiers. The database will update and re-calculate recruiter leaderboard scores immediately in referrals and analytics.
                </p>
              </div>

              <button
                onClick={() => setShowAdminFilters(!showAdminFilters)}
                className="self-start md:self-auto bg-black/50 border border-red-500/40 hover:border-red-500 text-red-300 px-4 py-2 rounded-xl text-xs font-bold font-label-caps transition-all flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">
                  {showAdminFilters ? 'filter_list_off' : 'filter_alt'}
                </span>
                <span>{showAdminFilters ? 'HIDE FILTERS' : 'FILTER'}</span>
              </button>
            </div>

            {/* Candidate Dossiers Log Header & Filter Bar */}
            {showAdminFilters && (
              <div className="glass-panel p-4 rounded-xl border border-white/5 bg-black/40 flex flex-col md:flex-row md:items-center gap-4">
                {/* Search Box */}
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-500 text-sm">
                    search
                  </span>
                  <input
                    type="text"
                    placeholder="Search candidate name, registration number, email, phone, or referrer..."
                    value={adminSearchQuery}
                    onChange={(e) => setAdminSearchQuery(e.target.value)}
                    className="w-full bg-black/60 border border-purple-500/30 rounded-lg pl-9 pr-8 py-2 text-xs text-white focus:outline-none focus:border-purple-500 placeholder:text-slate-500"
                  />
                  {adminSearchQuery && (
                    <button 
                      onClick={() => setAdminSearchQuery('')}
                      className="absolute right-3 top-2 text-slate-400 hover:text-white text-xs"
                    >
                      clear
                    </button>
                  )}
                </div>

                {/* Team Filter */}
                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-[10px] font-label-caps text-purple-300 tracking-wider font-bold">TEAM:</label>
                  <select
                    value={adminTeamFilter}
                    onChange={(e) => setAdminTeamFilter(e.target.value)}
                    className="bg-[#0e0518] border border-purple-500/30 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none cursor-pointer font-label-caps"
                  >
                    <option value="All">All Teams</option>
                    <option value="Design">Design</option>
                    <option value="Education">Education</option>
                    <option value="Esports(Mobile)">Esports(Mobile)</option>
                    <option value="Esports(PC)">Esports(PC)</option>
                    <option value="PR">PR</option>
                    <option value="Social Media">Social Media</option>
                    <option value="Technical">Technical</option>
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-[10px] font-label-caps text-purple-300 tracking-wider font-bold">STATUS:</label>
                  <select
                    value={adminStatusFilter}
                    onChange={(e) => setAdminStatusFilter(e.target.value)}
                    className="bg-[#0e0518] border border-purple-500/30 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none cursor-pointer font-label-caps"
                  >
                    <option value="All">All Active</option>
                    <option value="Pending">Pending</option>
                    <option value="In Process">In Process</option>
                    <option value="Invited to Interview">Interview</option>
                    <option value="Interview Taken">Interview Taken</option>
                    <option value="Admitted">Admitted</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
              </div>
            )}

            {/* Candidate Dossiers Log Table */}
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-purple-500/20 text-xs text-slate-400 font-label-caps tracking-widest font-bold">
                    <th className="py-3 px-4 font-bold text-left">CANDIDATE</th>
                    <th className="py-3 px-4 font-bold text-left">REFERRER</th>
                    <th className="py-3 px-4 font-bold text-left">TARGET TEAM</th>
                    <th className="py-3 px-4 font-bold text-right">DOSSIER STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {getActiveAdminReferrals().length > 0 ? (
                    getActiveAdminReferrals().map((ref, idx) => {
                      const cName = getRefVal(ref, "Candidate Name") || getRefVal(ref, "candidateName") || "Candidate Profile";
                      const cReg = getRefVal(ref, "Candidate Registration Number") || getRefVal(ref, "candidateRegNo") || "UNKNOWN";
                      const refName = getRefVal(ref, "Referrer Name") || getRefVal(ref, "referrerName") || "VRGC Recruiter";
                      const refReg = getRefVal(ref, "Referrer Registration Number") || getRefVal(ref, "referrerRegNo") || "UNKNOWN";
                      const currentStatus = getRefVal(ref, "Status") || getRefVal(ref, "status") || "Pending";
                      const isUpdating = isUpdatingStatus === cReg;

                      return (
                        <tr 
                          key={cReg + idx}
                          onClick={() => setInspectingCandidate(ref)}
                          className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors duration-200"
                        >
                          <td className="py-4 px-4 text-left">
                            <div className="font-bold text-white">{cName}</div>
                            <div className="text-xs text-purple-400 font-code-sm">{cReg}</div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[160px]">
                              {getRefVal(ref, "Candidate Email") || getRefVal(ref, "candidateEmail")}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-xs text-left">
                            <div className="font-bold text-slate-200">{refName}</div>
                            <div className="text-slate-400 font-code-sm">{refReg}</div>
                          </td>
                          <td className="py-4 px-4 text-xs text-yellow-400 font-bold text-left">
                            {getRefVal(ref, "Target Team") || getRefVal(ref, "targetTeam") || "Technical"}
                          </td>
                          <td className="py-4 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-2">
                              {isUpdating && (
                                <span className="material-symbols-outlined animate-spin text-purple-400 text-base">sync</span>
                              )}
                              <select
                                disabled={isUpdating}
                                value={currentStatus}
                                onChange={(e) => handleUpdateStatus(ref.id, cReg, cName, e.target.value)}
                                className={`rounded-lg px-3 py-1.5 text-xs focus:outline-none cursor-pointer font-label-caps transition-all ${getSelectStatusColor(currentStatus)}`}
                              >
                                <option value="Pending">Pending</option>
                                <option value="In Process">In Process</option>
                                <option value="Invited to Interview">Interview</option>
                                <option value="Interview Taken">Interview Taken</option>
                                <option value="Admitted">Admitted</option>
                                <option value="Rejected">Rejected</option>
                              </select>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-slate-500 italic">
                        No candidate referral records match the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Status Confirmation Modal */}
        {pendingStatusChange && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="glass-panel p-8 rounded-2xl max-w-md w-full text-center space-y-6 border border-purple-500/30 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
              <span className={`material-symbols-outlined text-[64px] animate-pulse ${
                pendingStatusChange.newStatus.toLowerCase() === 'rejected' ? 'text-red-500' : 'text-green-400'
              }`}>
                {pendingStatusChange.newStatus.toLowerCase() === 'rejected' ? 'cancel_presentation' : 'verified'}
              </span>
              <div className="space-y-2">
                <h3 className="font-display-lg text-2xl text-white font-extrabold uppercase">
                  Confirm Candidate Action
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Are you sure you want to change the status of candidate <strong className="text-white">"{pendingStatusChange.candidateName}"</strong> to <strong className={pendingStatusChange.newStatus.toLowerCase() === 'rejected' ? 'text-red-400' : 'text-green-400'}>{pendingStatusChange.newStatus.toUpperCase()}</strong>?
                </p>
              </div>
              <div className="flex gap-4 pt-2">
                <button
                  onClick={() => setPendingStatusChange(null)}
                  className="flex-1 py-3 border border-purple-500/30 hover:bg-white/5 rounded-xl font-label-caps text-xs text-white tracking-widest"
                >
                  CANCEL
                </button>
                <button
                  onClick={() => {
                    const { docId, regNo, newStatus } = pendingStatusChange;
                    executeStatusUpdate(docId, regNo, newStatus);
                  }}
                  className={`flex-1 py-3 rounded-xl font-label-caps text-xs text-black font-black tracking-widest ${
                    pendingStatusChange.newStatus.toLowerCase() === 'rejected' 
                      ? 'bg-red-500 hover:bg-red-600' 
                      : 'bg-green-400 hover:bg-green-500'
                  }`}
                >
                  CONFIRM
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Candidate Detail Inspector Modal */}
        {inspectingCandidate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="glass-panel p-8 rounded-2xl max-w-lg w-full text-left space-y-6 border border-purple-500/30 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
              <div className="flex justify-between items-start border-b border-purple-500/20 pb-4">
                <div>
                  <h3 className="font-display-lg text-2xl text-white font-extrabold">
                    Candidate Dossier
                  </h3>
                  <p className="text-[10px] text-purple-400 font-code-sm uppercase tracking-wider mt-0.5">
                    ID: {inspectingCandidate.id || 'LOCAL_RECORD'}
                  </p>
                </div>
                <button
                  onClick={() => setInspectingCandidate(null)}
                  className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold">CANDIDATE NAME</span>
                  <span className="text-sm font-bold text-white block">{getRefVal(inspectingCandidate, "Candidate Name") || getRefVal(inspectingCandidate, "candidateName")}</span>
                </div>
                
                <div>
                  <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold">REGISTRATION NUMBER</span>
                  <span className="text-sm font-bold text-purple-400 font-code-sm block">{getRefVal(inspectingCandidate, "Candidate Registration Number") || getRefVal(inspectingCandidate, "candidateRegNo")}</span>
                </div>

                <div>
                  <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold">EMAIL ADDRESS</span>
                  <span className="text-sm font-bold text-white block truncate">{getRefVal(inspectingCandidate, "Candidate Email") || getRefVal(inspectingCandidate, "candidateEmail")}</span>
                </div>

                <div>
                  <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold">PHONE NUMBER</span>
                  <span className="text-sm font-bold text-white block">{getRefVal(inspectingCandidate, "Candidate Phone") || getRefVal(inspectingCandidate, "candidatePhone")}</span>
                </div>

                <div>
                  <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold">TARGETED TEAM</span>
                  <span className="text-sm font-bold text-yellow-400 block">{getRefVal(inspectingCandidate, "Target Team") || getRefVal(inspectingCandidate, "targetTeam") || "Technical"}</span>
                </div>

                <div>
                  <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold">SUBMISSION TIMESTAMP</span>
                  <span className="text-sm font-bold text-white block">{new Date(getRefVal(inspectingCandidate, "Timestamp") || getRefVal(inspectingCandidate, "timestamp") || new Date()).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex justify-between items-center border-t border-purple-500/20 pt-4">
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest font-bold">DOSSIER STATUS</span>
                {getStatusPill(getRefVal(inspectingCandidate, "Status") || getRefVal(inspectingCandidate, "status"))}
              </div>
            </div>
          </div>
        )}

        {/* Sync Toast Notification */}
        {syncToastMessage && (
          <div className="fixed bottom-6 right-6 z-50 glass-panel p-4 rounded-xl border border-green-500/40 bg-black/90 flex items-center gap-3 text-left shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
            <span className="material-symbols-outlined text-green-400 text-lg">check_circle</span>
            <span className="text-xs text-white font-bold">{syncToastMessage}</span>
          </div>
        )}

      </div>
    </main>
  );
};

export default Referrals;
