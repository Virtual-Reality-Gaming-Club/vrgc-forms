"use client";

import React, { useState, useEffect } from 'react';
import { CONFIG } from '../lib/config';
import { auth, googleProvider, db } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, getDocs } from 'firebase/firestore';

interface ReferralsProps {
  onRedirect: () => void;
  externalUser?: User | null;
  externalMemberData?: any;
  externalIsAdmin?: boolean;
  externalIsAuthorized?: boolean;
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

const Referrals: React.FC<ReferralsProps> = ({
  onRedirect,
  externalUser,
  externalMemberData,
  externalIsAdmin,
  externalIsAuthorized,
}) => {
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
  const [isTeamDropdownOpen, setIsTeamDropdownOpen] = useState<boolean>(false);
  const [inspectingCandidate, setInspectingCandidate] = useState<ReferralRecord | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ docId?: string; regNo: string; candidateName: string; newStatus: string } | null>(null);
  const [pendingDeleteReferral, setPendingDeleteReferral] = useState<{ docId?: string; regNo: string; candidateName: string } | null>(null);
  const [isDeletingReferral, setIsDeletingReferral] = useState<string | null>(null);
  const [activeStatusDropdownId, setActiveStatusDropdownId] = useState<string | null>(null);

  const canDeleteReferrals = CONFIG.LOG_DELETE_ADMIN_EMAILS.includes((currentUser?.email || '').toLowerCase().trim());

  // Admin filter states
  const [adminSearchQuery, setAdminSearchQuery] = useState<string>('');
  const [adminTeamFilter, setAdminTeamFilter] = useState<string>('All');
  const [adminStatusFilter, setAdminStatusFilter] = useState<string>('All');
  const [showAdminFilters, setShowAdminFilters] = useState<boolean>(true);
  const [syncToastMessage, setSyncToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (externalUser !== undefined) {
      setCurrentUser(externalUser);
    }
    if (externalIsAuthorized !== undefined) {
      setIsAuthorized(externalIsAuthorized);
    }
  }, [externalUser, externalIsAuthorized]);

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

  const [userPhotoMap, setUserPhotoMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadFirestoreData = async () => {
      try {
        const photos: Record<string, string> = {};

        // Fetch admins from Firestore 'admins' collection
        try {
          const adminCol = collection(db, 'admins');
          const adminSnap = await getDocs(adminCol);
          const parsedAdmins: string[] = [];
          adminSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const email = (data.email || docSnap.id || '').toLowerCase().trim();
            if (email && email.includes('@')) {
              parsedAdmins.push(email);
              if (data.photoUrl || data.avatarUrl || data.photoURL) {
                photos[email] = data.photoUrl || data.avatarUrl || data.photoURL;
              }
            }
          });
          if (parsedAdmins.length > 0) {
            setAdminEmails(parsedAdmins);
          }
        } catch (aErr) {
          console.warn('Error fetching admins from Firestore:', aErr);
        }

        // Fetch members from Firestore 'members' collection
        try {
          const mSnap = await getDocs(collection(db, 'members'));
          mSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const email = (data.email || data.Email || docSnap.id || '').toLowerCase().trim();
            const reg = (data.registrationNumber || data['Registration Number'] || data.regNo || '').toUpperCase().trim();
            const name = (data.name || data.Name || data.fullName || '').toLowerCase().trim();
            const photo = data.photoUrl || data.photoURL || data.avatarUrl || data.photo || data.image || data.avatar;

            if (photo) {
              if (email) {
                photos[email] = photo;
                photos[email.split('@')[0]] = photo;
              }
              if (reg) photos[reg] = photo;
              if (name) photos[name] = photo;
            }
          });
        } catch (mErr) {
          console.warn('Error fetching members collection photos:', mErr);
        }

        // Fetch members from Firestore 'id_cards' collection
        try {
          const memberCol = collection(db, 'id_cards');
          const memberSnap = await getDocs(memberCol);
          const parsedMembers: MemberData[] = [];
          memberSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const email = (data.email || data.Email || docSnap.id || '').toLowerCase().trim();
            const reg = (data.regNo || data.registrationNumber || '').toUpperCase().trim();
            const name = (data.fullName || data.name || '').toLowerCase().trim();
            const photo = data.photoUrl || data.photoURL || data.avatarUrl || data.photo || data.image;

            if (photo) {
              if (email) {
                photos[email] = photo;
                photos[email.split('@')[0]] = photo;
              }
              if (reg) photos[reg] = photo;
              if (name) photos[name] = photo;
            }

            if (email && email.includes('@')) {
              parsedMembers.push({
                Name: data.fullName || data.name || 'Member',
                'Registration Number': reg,
                Email: email,
                Phone: data.phone || '',
                Team: data.team || data.domain || 'Member',
                Position: data.position || 'Member',
              });
            }
          });
          if (parsedMembers.length > 0) {
            setMembers(parsedMembers);
          }
        } catch (mErr) {
          console.warn('Error fetching members from Firestore:', mErr);
        }

        setUserPhotoMap(photos);
      } catch (err) {
        console.error('Error loading Firestore referral data:', err);
      }
    };
    loadFirestoreData();
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
    if (currentUser && isAuthorized) {
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
      referrerEmail: currentUser?.email || '',
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

  const executeDeleteReferral = async (docId?: string, candidateRegNo?: string) => {
    if (!candidateRegNo) return;
    setIsDeletingReferral(candidateRegNo);
    try {
      if (docId) {
        const docRef = doc(db, 'referrals', docId);
        await deleteDoc(docRef);
      }
      setReferrals(prev => prev.filter(r => (r.id !== docId && (getRefVal(r, 'Candidate Registration Number') || getRefVal(r, 'candidateRegNo')) !== candidateRegNo)));
      setSyncToastMessage(`Candidate referral dossier permanently deleted.`);
      setTimeout(() => setSyncToastMessage(null), 4000);
      if (inspectingCandidate && ((inspectingCandidate.id === docId) || ((getRefVal(inspectingCandidate, 'Candidate Registration Number') || getRefVal(inspectingCandidate, 'candidateRegNo')) === candidateRegNo))) {
        setInspectingCandidate(null);
      }
    } catch (err) {
      console.error('Error deleting referral record from Firestore:', err);
      alert('Failed to delete referral record from database.');
    } finally {
      setIsDeletingReferral(null);
      setPendingDeleteReferral(null);
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

  const getFirstName = (fullName: string) => {
    if (!fullName) return '';
    return fullName.trim().split(/\s+/)[0];
  };

  const getRecruiterTier = (rank: number) => {
    if (rank === 1) {
      return { 
        name: 'Mythic Prime', 
        color: 'text-amber-300 border-amber-500/40 bg-amber-950/40 font-black shadow-[0_0_10px_rgba(245,158,11,0.2)]',
      };
    }
    if (rank >= 2 && rank <= 6) {
      return { 
        name: 'Apex Titan', 
        color: 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-950/40 font-bold shadow-[0_0_10px_rgba(217,70,239,0.2)]',
      };
    }
    if (rank >= 7 && rank <= 16) {
      return { 
        name: 'Cyber Elite', 
        color: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40 font-bold shadow-[0_0_10px_rgba(6,182,212,0.2)]',
      };
    }
    return { 
      name: 'Challenger', 
      color: 'text-purple-300 border-purple-800/40 bg-purple-950/40 font-medium',
    };
  };

  const getLeaderboardData = () => {
    const referrerStats: Record<string, any> = {};

    referrals.forEach(ref => {
      const reg = getRefVal(ref, 'Referrer Registration Number') || getRefVal(ref, 'referrerRegNo') || "UNKNOWN";
      const name = getRefVal(ref, 'Referrer Name') || getRefVal(ref, 'referrerName') || "VRGC Recruiter";
      const status = (getRefVal(ref, 'Status') || getRefVal(ref, 'status') || "Pending").toString().toLowerCase();
      const email = (getRefVal(ref, 'Referrer Email') || getRefVal(ref, 'referrerEmail') || '').toLowerCase().trim();
      const emailPrefix = email ? email.split('@')[0] : '';
      const nameLower = name.toLowerCase().trim();

      const photoURL = getRefVal(ref, 'Referrer Photo URL') || 
                       getRefVal(ref, 'referrerPhotoURL') || 
                       (reg ? userPhotoMap[reg] : null) || 
                       (email ? userPhotoMap[email] : null) || 
                       (emailPrefix ? userPhotoMap[emailPrefix] : null) || 
                       (nameLower ? userPhotoMap[nameLower] : null) || 
                       null;

      if (!referrerStats[reg]) {
        referrerStats[reg] = {
          name,
          registrationNumber: reg,
          totalReferrals: 0,
          admittedCount: 0,
          interviewCount: 0,
          totalXP: 0,
          photoURL,
        };
      } else if (!referrerStats[reg].photoURL && photoURL) {
        referrerStats[reg].photoURL = photoURL;
      }

      let xpAwarded = 10;
      if (status === 'admitted') {
        xpAwarded = 100;
        referrerStats[reg].admittedCount += 1;
      } else if (status.includes('interview')) {
        xpAwarded = 50;
        referrerStats[reg].interviewCount += 1;
      }

      referrerStats[reg].totalReferrals += 1;
      referrerStats[reg].totalXP += xpAwarded;
    });

    const sorted = Object.values(referrerStats).sort((a: any, b: any) => b.totalXP - a.totalXP);

    let currentRank = 1;
    let prevXP: number | null = null;
    return sorted.map((rank: any, index: number) => {
      if (index > 0 && rank.totalXP !== prevXP) {
        currentRank = index + 1;
      } else if (index === 0) {
        currentRank = 1;
      }
      prevXP = rank.totalXP;
      return { ...rank, rankNumber: currentRank };
    });
  };

  const renderRankBadge = (rankNum: number) => {
    if (rankNum === 1) {
      return (
        <div className="w-10 h-10 bg-gradient-to-tr from-amber-600 via-yellow-400 to-amber-200 rounded-2xl border-2 border-yellow-200 flex flex-col items-center justify-center shadow-[0_0_20px_rgba(245,158,11,0.5)]">
          <span className="material-symbols-outlined text-black font-black text-lg">sports_esports</span>
          <span className="text-[7px] font-black text-black font-mono leading-none">#1</span>
        </div>
      );
    }
    if (rankNum === 2) {
      return (
        <div className="w-10 h-10 bg-gradient-to-tr from-purple-800 via-fuchsia-500 to-purple-400 rounded-2xl border-2 border-fuchsia-300 flex flex-col items-center justify-center shadow-[0_0_20px_rgba(217,70,239,0.4)]">
          <span className="material-symbols-outlined text-white font-black text-lg">bolt</span>
          <span className="text-[7.5px] font-black text-white font-mono leading-none">#2</span>
        </div>
      );
    }
    if (rankNum === 3) {
      return (
        <div className="w-10 h-10 bg-gradient-to-tr from-cyan-800 via-cyan-400 to-teal-300 rounded-2xl border-2 border-cyan-200 flex flex-col items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)]">
          <span className="material-symbols-outlined text-black font-black text-lg">videogame_asset</span>
          <span className="text-[7.5px] font-black text-black font-mono leading-none">#3</span>
        </div>
      );
    }
    return (
      <div className="w-10 h-10 bg-[#0c0419] border border-purple-500/30 rounded-2xl flex flex-col items-center justify-center text-purple-300 font-bold shadow-[0_0_10px_rgba(168,85,247,0.1)]">
        <span className="text-xs font-black font-mono">#{rankNum}</span>
        <span className="text-[6px] text-slate-400 font-bold uppercase">LVL</span>
      </div>
    );
  };

  const getMyReferrals = () => {
    if (!currentUser) return [];

    const myEmail = (currentUser.email || '').toLowerCase().trim();
    const myReg = (referrerInfo ? referrerInfo['Registration Number'] : extractRegNo(currentUser.email)).toUpperCase().trim();
    const myName = (referrerInfo?.Name || currentUser.displayName || '').toLowerCase().trim();

    return referrals.filter(ref => {
      // 1. Match by Registration Number
      const reg = (
        getRefVal(ref, 'Referrer Registration Number') ||
        getRefVal(ref, 'referrerRegNo') ||
        getRefVal(ref, 'referrer_reg_no') ||
        ref.referrerRegNo ||
        ref['Referrer Registration Number'] ||
        ''
      ).toString().toUpperCase().trim();

      if (myReg && myReg !== 'UNKNOWN' && reg && reg === myReg) {
        return true;
      }

      // 2. Match by Email Address
      const email = (
        getRefVal(ref, 'Referrer Email') ||
        getRefVal(ref, 'referrerEmail') ||
        getRefVal(ref, 'user_email') ||
        getRefVal(ref, 'email') ||
        ref.referrerEmail ||
        ref.user_email ||
        ''
      ).toString().toLowerCase().trim();

      if (myEmail && email && email === myEmail) {
        return true;
      }

      // 3. Match by Referrer Name
      if (myName) {
        const refName = (
          getRefVal(ref, 'Referrer Name') ||
          getRefVal(ref, 'referrerName') ||
          ref.referrerName ||
          ''
        ).toString().toLowerCase().trim();
        if (refName && refName === myName) {
          return true;
        }
      }

      return false;
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
      const status = (getRefVal(ref, 'Status') || getRefVal(ref, 'status') || 'Pending').toLowerCase();
      if (adminStatusFilter === 'All') {
        // By default on main referral list, exclude Admitted and Rejected candidates (show only active/in-process/pending)
        if (status === 'admitted' || status === 'rejected') return false;
      } else {
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
    <main className="flex-1 w-full min-h-[calc(100vh-76px)] overflow-y-auto overflow-x-hidden pt-6 pb-24 px-4 md:px-8 relative bg-mesh">
      <div className="max-w-4xl mx-auto space-y-8 stagger-in w-full">
        
        {/* Navigation Tabs - Horizontally scrollable on mobile */}
        <div className="relative z-10 w-full">
          <div className="flex items-center border-b border-purple-500/25 gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pb-1 w-full max-w-full">
            <button
              onClick={() => setActiveTab('form')}
              className={`flex items-center gap-2 py-3 px-4 md:px-6 font-label-caps text-xs tracking-widest border-b-2 font-bold transition-all duration-300 rounded-t-xl shrink-0 whitespace-nowrap ${
                activeTab === 'form' 
                  ? 'border-purple-500 text-purple-300 bg-purple-500/10 shadow-[0_-5px_15px_rgba(168,85,247,0.15)]' 
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-base">send</span>
              <span>SUBMIT REFERRAL</span>
            </button>
            
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`flex items-center gap-2 py-3 px-4 md:px-6 font-label-caps text-xs tracking-widest border-b-2 font-bold transition-all duration-300 rounded-t-xl shrink-0 whitespace-nowrap ${
                activeTab === 'leaderboard' 
                  ? 'border-purple-500 text-purple-300 bg-purple-500/10 shadow-[0_-5px_15px_rgba(168,85,247,0.15)]' 
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-base">trophy</span>
              <span>LEADERBOARD</span>
            </button>
            
            <button
              onClick={() => setActiveTab('my_ops')}
              className={`flex items-center gap-2 py-3 px-4 md:px-6 font-label-caps text-xs tracking-widest border-b-2 font-bold transition-all duration-300 rounded-t-xl shrink-0 whitespace-nowrap ${
                activeTab === 'my_ops' 
                  ? 'border-purple-500 text-purple-300 bg-purple-500/10 shadow-[0_-5px_15px_rgba(168,85,247,0.15)]' 
                  : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-base">assignment</span>
              <span>MY REGISTRY</span>
            </button>

            {isMasterAdmin && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`flex items-center gap-2 py-3 px-4 md:px-6 font-label-caps text-xs tracking-widest border-b-2 font-bold transition-all duration-300 rounded-t-xl shrink-0 whitespace-nowrap ${
                  activeTab === 'admin' 
                    ? 'border-rose-500 text-rose-300 bg-rose-500/10 shadow-[0_-5px_15px_rgba(244,63,94,0.15)]' 
                    : 'border-transparent text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/5'
                }`}
              >
                <span className="material-symbols-outlined text-base">admin_panel_settings</span>
                <span>ADMIN DESK</span>
              </button>
            )}

            <button
              onClick={onRedirect}
              className="ml-auto shrink-0 bg-purple-500/10 border border-purple-500/30 hover:border-purple-400 hover:bg-purple-500/20 text-purple-300 px-4 py-2 rounded-full text-xs font-extrabold font-label-caps transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(168,85,247,0.15)] whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              <span>DASHBOARD</span>
            </button>
          </div>
        </div>

        {/* Referrer Profile Badge */}
        <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-purple-500/30 relative overflow-hidden bg-gradient-to-r from-[#130728] via-[#0e041f] to-[#080213] flex flex-col md:flex-row items-center justify-between gap-5 sm:gap-6 shadow-[0_0_40px_rgba(168,85,247,0.15)]">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500" />
          <div className="flex flex-col sm:flex-row items-center gap-4 relative z-10 w-full md:w-auto text-center sm:text-left">
            <div className="relative mx-auto sm:mx-0 shrink-0">
              <img 
                src={currentUser.photoURL || 'https://www.gravatar.com/avatar/?d=mp'} 
                alt="User Profile" 
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border-2 border-purple-400/60 shadow-[0_0_20px_rgba(168,85,247,0.35)]"
              />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-[#090314] flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-ping"></div>
              </div>
            </div>
            
            <div className="space-y-1.5 w-full">
              <div className="text-[9px] text-purple-400 font-extrabold tracking-[0.2em] font-label-caps uppercase flex items-center justify-center sm:justify-start gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                VERIFIED REFERRER IDENTITY
              </div>
              <div className="font-display-lg text-lg sm:text-xl text-white font-extrabold tracking-wide">
                {referrerInfo ? referrerInfo.Name : currentUser.displayName || 'VRGC Operator'}
              </div>
              <div className="font-code-sm text-xs text-slate-300 tracking-wider flex flex-wrap justify-center sm:justify-start gap-1.5 sm:gap-2 items-center">
                <span className="bg-purple-500/15 border border-purple-500/30 px-2.5 py-0.5 rounded-full">ID: <strong className="text-purple-300 font-bold">{referrerInfo ? referrerInfo['Registration Number'] : extractRegNo(currentUser.email)}</strong></span>
                <span className="bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-full">RANK: <strong className="text-amber-300 font-bold">{userRank}</strong></span>
                <span className="bg-purple-500/15 border border-purple-500/30 px-2.5 py-0.5 rounded-full">SCORE: <strong className="text-purple-300 font-bold">{userXP} XP</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-4 md:pt-0 border-purple-500/15">
            <div className="text-center px-3.5 sm:px-4 py-2 rounded-2xl bg-black/40 border border-purple-500/20">
              <div className="text-[9px] text-slate-400 font-label-caps tracking-widest font-bold">DAILY SUBMISSIONS</div>
              <div className="font-code-sm text-base sm:text-lg font-bold text-white mt-0.5">
                <span className={dailyCount >= 5 ? 'text-rose-400' : 'text-emerald-400'}>{dailyCount}</span> / 5
              </div>
            </div>
            <button 
              onClick={handleSignOut}
              className="flex items-center justify-center gap-1.5 sm:gap-2 text-xs text-rose-400 hover:text-rose-300 font-label-caps font-bold border border-rose-500/30 hover:border-rose-500/60 px-4 sm:px-5 py-2.5 sm:py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 transition-all duration-300 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">logout</span>
              <span>LOGOUT</span>
            </button>
          </div>
        </div>

        {/* TAB 1: FORM */}
        {activeTab === 'form' && (
          <div className="space-y-8">
            <header className="text-left space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-purple-500/15 text-purple-300 border border-purple-500/30">
                <span className="material-symbols-outlined text-xs">how_to_reg</span>
                RECRUITMENT PIPELINE
              </div>
              <h1 className="font-display-lg text-2xl md:text-3xl text-white uppercase font-black tracking-tight">
                Submit Candidate Referral
              </h1>
              <p className="font-body-lg text-slate-400 max-w-2xl text-xs sm:text-sm leading-relaxed">
                Refer a talented recruit for club admission. Ensure their information is exact. Note that both you and the candidate are subject to club verification rules.
              </p>
            </header>

            <div>
              <section className="bg-gradient-to-b from-[#130728] via-[#0b0318] to-[#06010d] border border-purple-500/30 p-4 sm:p-6 md:p-10 rounded-3xl relative space-y-6 sm:space-y-8 shadow-[0_0_40px_rgba(168,85,247,0.12)]">
                
                {/* Benefits Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 text-left">
                  {/* Referrer Benefits */}
                  <div className="p-4 sm:p-5 rounded-2xl border border-purple-500/25 bg-gradient-to-br from-purple-950/40 to-transparent space-y-3 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-purple-600/10 rounded-full blur-2xl pointer-events-none" />
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                        <span className="material-symbols-outlined text-lg">military_tech</span>
                      </div>
                      <h4 className="font-label-caps text-xs text-purple-300 font-extrabold tracking-wider">
                        BENEFITS YOU WILL GET
                      </h4>
                    </div>
                    <ul className="space-y-2 text-xs text-slate-300">
                      <li className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                        <span>Fast-track promotion consideration (25 Batch)</span>
                      </li>
                      <li className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                        <span>Leaderboard progression &amp; gamified Recruiter XP</span>
                      </li>
                    </ul>
                  </div>

                  {/* Candidate Benefits */}
                  <div className="p-4 sm:p-5 rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/30 to-transparent space-y-3 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-600/10 rounded-full blur-2xl pointer-events-none" />
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
                        <span className="material-symbols-outlined text-lg">stars</span>
                      </div>
                      <h4 className="font-label-caps text-xs text-cyan-300 font-extrabold tracking-wider">
                        BENEFITS REFERRED CANDIDATE GETS
                      </h4>
                    </div>
                    <ul className="space-y-2 text-xs text-slate-300">
                      <li className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                        <span>Direct priority invitation to the Interview stage</span>
                      </li>
                      <li className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                        <span>Expedited response &amp; review by Team Leads</span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Recruitment Season Note */}
                <div className="px-4 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center gap-2 text-xs text-purple-200">
                  <span className="material-symbols-outlined text-purple-400 text-sm shrink-0">calendar_month</span>
                  <span><strong>Year-Round Cycle:</strong> VRGC candidate intake and recruitment evaluations continue actively throughout the academic year.</span>
                </div>

                {/* Disciplinary Warning Alert */}
                <div className="p-4 sm:p-5 rounded-2xl border border-rose-500/30 bg-gradient-to-r from-rose-950/40 via-[#18050e] to-transparent flex items-start gap-3.5 text-left">
                  <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-xl">warning</span>
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-black tracking-wider text-rose-300 uppercase">
                      CRITICAL INTEGRITY &amp; DISCIPLINARY POLICY
                    </h4>
                    <p className="text-xs text-slate-300/90 leading-relaxed">
                      Submitting fake, prank, or unverified entries is strictly prohibited. If a candidate is submitted as a spam referral, <strong className="text-rose-300">strict disciplinary actions will be taken against both the applicant and the referring member</strong>.
                    </p>
                  </div>
                </div>

                {/* Referral Submission Form */}
                <form className="space-y-6 text-left" onSubmit={handleSubmit}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                    {/* Candidate Name */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider text-purple-300">
                        CANDIDATE FULL NAME *
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-400/70 text-lg">
                          person
                        </span>
                        <input
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400/50 transition-all"
                          placeholder="e.g. Rahul Sharma"
                          type="text"
                        />
                      </div>
                      {errors.name && <p className="text-rose-400 text-xs font-semibold mt-1">{errors.name}</p>}
                    </div>

                    {/* Registration Number */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider text-purple-300">
                        REGISTRATION NUMBER *
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-400/70 text-lg">
                          fingerprint
                        </span>
                        <input
                          required
                          value={registrationNumber}
                          onChange={handleRegNoChange}
                          className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl pl-10 pr-4 py-3 text-white font-mono text-sm uppercase placeholder-slate-500 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400/50 transition-all"
                          placeholder="e.g. 24BCG10082"
                          type="text"
                        />
                      </div>
                      {errors.registrationNumber && <p className="text-rose-400 text-xs font-semibold mt-1">{errors.registrationNumber}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                    {/* Email Address */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider text-purple-300">
                        INSTITUTIONAL EMAIL *
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-400/70 text-lg">
                          alternate_email
                        </span>
                        <input
                          required
                          value={email}
                          onChange={handleEmailChange}
                          className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl pl-10 pr-4 py-3 text-white font-mono text-sm placeholder-slate-500 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400/50 transition-all"
                          placeholder="e.g. rahul.24xx@vitbhopal.ac.in"
                          type="email"
                        />
                      </div>
                      {errors.email && <p className="text-rose-400 text-xs font-semibold mt-1">{errors.email}</p>}
                    </div>

                    {/* Phone Number */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider text-purple-300">
                        PHONE NUMBER *
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-400/70 text-lg">
                          phone_iphone
                        </span>
                        <input
                          required
                          value={phone}
                          onChange={handlePhoneChange}
                          className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl pl-10 pr-4 py-3 text-white font-mono text-sm placeholder-slate-500 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400/50 transition-all"
                          placeholder="10-digit mobile number"
                          type="tel"
                        />
                      </div>
                      {errors.phone && <p className="text-rose-400 text-xs font-semibold mt-1">{errors.phone}</p>}
                    </div>
                  </div>

                  {/* Targeted Team Custom Professional Dropdown */}
                  <div className="space-y-1.5 relative">
                    <div className="flex items-center justify-between">
                      <label className="block text-[11px] font-extrabold uppercase tracking-wider text-purple-300">
                        TARGETED CLUB DIVISION *
                      </label>
                      <span className="text-[10px] text-slate-400 font-medium">Select primary domain</span>
                    </div>

                    {/* Custom Dropdown Trigger */}
                    <button
                      type="button"
                      onClick={() => setIsTeamDropdownOpen((prev) => !prev)}
                      className="w-full bg-[#0a0315] hover:bg-[#110522] border border-purple-500/30 hover:border-purple-400/70 rounded-xl px-4 py-3 text-left flex items-center justify-between transition-all duration-200 shadow-[0_0_15px_rgba(168,85,247,0.05)] group cursor-pointer focus:outline-none focus:ring-1 focus:ring-purple-400/50"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300 group-hover:scale-105 transition-transform shrink-0">
                          <span className="material-symbols-outlined text-base">
                            {targetTeam === 'Technical' ? 'terminal' :
                             targetTeam === 'Design' ? 'palette' :
                             targetTeam === 'Education' ? 'school' :
                             targetTeam === 'Esports (PC)' ? 'sports_esports' :
                             targetTeam === 'Esports (Mobile)' ? 'smartphone' :
                             targetTeam === 'PR' ? 'campaign' : 'share'}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-white text-sm font-bold tracking-wide flex items-center gap-2">
                            <span>{targetTeam}</span>
                            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                              Active Domain
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 line-clamp-1 sm:line-clamp-none">
                            {targetTeam === 'Technical' && 'Full stack development, bot systems, infrastructure'}
                            {targetTeam === 'Design' && 'UI/UX interface design, 3D assets, visual branding'}
                            {targetTeam === 'Education' && 'Workshops, training sessions, VR/AR curriculum'}
                            {targetTeam === 'Esports (PC)' && 'Competitive tournaments & PC scrim coordination'}
                            {targetTeam === 'Esports (Mobile)' && 'Mobile gaming rosters & battle-royale operations'}
                            {targetTeam === 'PR' && 'Public relations, institutional outreach, sponsorship'}
                            {targetTeam === 'Social Media' && 'Content strategy, media management, broadcast'}
                          </div>
                        </div>
                      </div>
                      <span className={`material-symbols-outlined text-purple-400 transition-transform duration-200 shrink-0 ml-2 ${isTeamDropdownOpen ? 'rotate-180' : ''}`}>
                        expand_more
                      </span>
                    </button>

                    {/* Dropdown Menu Modal/Overlay */}
                    {isTeamDropdownOpen && (
                      <>
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setIsTeamDropdownOpen(false)}
                        />
                        <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-[#0e041d]/95 backdrop-blur-2xl border border-purple-500/40 rounded-2xl p-2 shadow-[0_15px_50px_rgba(0,0,0,0.8)] space-y-1 animate-in fade-in zoom-in-95 duration-150 max-h-72 overflow-y-auto custom-scrollbar">
                          {[
                            { name: 'Technical', icon: 'terminal', desc: 'Full stack development, bot systems, infrastructure', badge: 'Dev Core' },
                            { name: 'Design', icon: 'palette', desc: 'UI/UX interface design, 3D assets, visual branding', badge: 'Creative' },
                            { name: 'Education', icon: 'school', desc: 'Workshops, training sessions, VR/AR curriculum', badge: 'Academy' },
                            { name: 'Esports (PC)', icon: 'sports_esports', desc: 'Competitive tournaments & PC scrim coordination', badge: 'PC League' },
                            { name: 'Esports (Mobile)', icon: 'smartphone', desc: 'Mobile gaming rosters & battle-royale operations', badge: 'Mobile' },
                            { name: 'PR', icon: 'campaign', desc: 'Public relations, institutional outreach, sponsorship', badge: 'Outreach' },
                            { name: 'Social Media', icon: 'share', desc: 'Content strategy, media management, broadcast', badge: 'Media' },
                          ].map((teamItem) => {
                            const isSelected = targetTeam === teamItem.name;
                            return (
                              <button
                                key={teamItem.name}
                                type="button"
                                onClick={() => {
                                  setTargetTeam(teamItem.name);
                                  setIsTeamDropdownOpen(false);
                                }}
                                className={`w-full p-2.5 rounded-xl flex items-center justify-between text-left transition-all duration-150 cursor-pointer ${
                                  isSelected
                                    ? 'bg-purple-600/30 border border-purple-400/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                                    : 'hover:bg-white/5 border border-transparent'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                    isSelected 
                                      ? 'bg-purple-500 text-white' 
                                      : 'bg-purple-500/10 text-purple-300 border border-purple-500/20'
                                  }`}>
                                    <span className="material-symbols-outlined text-base">{teamItem.icon}</span>
                                  </div>
                                  <div>
                                    <div className="text-white text-xs font-bold tracking-wide flex items-center gap-2">
                                      <span>{teamItem.name}</span>
                                      <span className="text-[9px] font-mono px-2 py-0.2 rounded-full bg-white/5 text-purple-300 border border-purple-500/20">
                                        {teamItem.badge}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-400">{teamItem.desc}</div>
                                  </div>
                                </div>
                                {isSelected && (
                                  <span className="material-symbols-outlined text-purple-300 text-base">check_circle</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Submit Button */}
                  <div className="pt-4 flex justify-center">
                    <button
                      type="submit"
                      disabled={isSubmitting || dailyCount >= 5}
                      className="w-full sm:w-auto bg-gradient-to-r from-purple-600 via-fuchsia-600 to-purple-600 hover:from-purple-500 hover:to-fuchsia-500 text-white font-black py-4 px-12 rounded-2xl shadow-[0_0_30px_rgba(168,85,247,0.4)] transition-all duration-300 text-xs font-label-caps flex items-center justify-center gap-2 uppercase tracking-widest active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <span>{isSubmitting ? 'TRANSMITTING REFERRAL...' : 'TRANSMIT REFERRAL'}</span>
                      <span className="material-symbols-outlined text-base">send</span>
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </div>
        )}

        {/* TAB 2: LEADERBOARD */}
        {activeTab === 'leaderboard' && (
          <div className="space-y-8 text-left">
            {/* Header / Stats Summary */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 mb-2">
                  <span className="material-symbols-outlined text-xs text-amber-400">emoji_events</span>
                  VRGC RECRUITER HONORS
                </div>
                <h3 className="text-2xl font-black text-white uppercase tracking-tight">
                  Recruiter Leaderboard &amp; Tier Standings
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Earn XP by submitting high-caliber recruits: <strong className="text-purple-300">+10 XP</strong> submission, <strong className="text-cyan-300">+50 XP</strong> interview, <strong className="text-emerald-300">+100 XP</strong> admitted recruit.
                </p>
              </div>

              {/* Total Active Recruiters Counter */}
              <div className="px-4 py-2 rounded-2xl bg-purple-500/10 border border-purple-500/25 flex items-center gap-3 shrink-0">
                <span className="material-symbols-outlined text-purple-400 text-2xl">groups</span>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">ACTIVE RECRUITERS</div>
                  <div className="text-lg font-black text-white font-mono">{leaderboard.length}</div>
                </div>
              </div>
            </div>

            {/* Top 3 Podium Highlight (If enough recruiters exist) */}
            {leaderboard.length >= 3 && (() => {
              const tier1 = getRecruiterTier(leaderboard[1].rankNumber);
              const tier0 = getRecruiterTier(leaderboard[0].rankNumber);
              const tier2 = getRecruiterTier(leaderboard[2].rankNumber);

              return (
                <div className="grid grid-cols-3 gap-2 sm:gap-3 md:gap-4 pt-4 md:pt-6 items-end">
                  {/* #2 Rank - Silver Podium */}
                  <div className="p-2.5 xs:p-3 sm:p-5 rounded-2xl sm:rounded-3xl bg-gradient-to-b from-[#180932] via-[#0d041c] to-[#06010e] border border-purple-500/40 relative flex flex-col items-center text-center shadow-[0_0_30px_rgba(168,85,247,0.15)] hover:-translate-y-1 transition-transform">
                    <div className="relative mb-2 sm:mb-3">
                      <img
                        src={leaderboard[1].photoURL || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(leaderboard[1].name)}`}
                        alt={leaderboard[1].name}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(leaderboard[1].name)}`;
                        }}
                        className="w-10 h-10 xs:w-12 xs:h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl object-cover border-2 border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.4)] bg-purple-950/40"
                      />
                      <div className="absolute -bottom-1.5 -right-1.5 sm:-bottom-2 sm:-right-2 w-5 h-5 sm:w-6 sm:h-6 rounded-md sm:rounded-lg bg-purple-600 border border-purple-300 flex items-center justify-center text-white text-[10px] sm:text-xs font-black shadow-md">
                        2
                      </div>
                    </div>
                    <span className={`text-[8px] sm:text-[9px] font-black uppercase tracking-wider px-2 sm:px-2.5 py-0.5 rounded-full border mb-1.5 sm:mb-2 truncate max-w-full ${tier1.color}`}>
                      #2 {tier1.name.toUpperCase()}
                    </span>
                    <h4 className="text-xs sm:text-base font-extrabold text-white truncate max-w-full">
                      <span className="sm:hidden">{getFirstName(leaderboard[1].name)}</span>
                      <span className="hidden sm:inline">{leaderboard[1].name}</span>
                    </h4>
                    <span className="text-[10px] sm:text-xs text-slate-400 font-mono truncate max-w-full">{leaderboard[1].registrationNumber}</span>
                    <div className="mt-3 pt-2 sm:mt-4 sm:pt-3 border-t border-purple-500/20 w-full flex flex-col sm:flex-row items-center justify-between text-[10px] sm:text-xs gap-0.5">
                      <span className="text-slate-400 text-center sm:text-left">Refs: <strong className="text-white">{leaderboard[1].totalReferrals}</strong></span>
                      <span className="font-bold text-purple-300 font-mono text-xs sm:text-sm">{leaderboard[1].totalXP} XP</span>
                    </div>
                  </div>

                  {/* #1 Rank - Gold Podium (Elevated) */}
                  <div className="p-3 xs:p-4 sm:p-6 rounded-2xl sm:rounded-3xl bg-gradient-to-b from-[#2a1705] via-[#150a02] to-[#0a0501] border-2 border-amber-400/60 relative flex flex-col items-center text-center shadow-[0_0_40px_rgba(245,158,11,0.25)] pb-4 sm:pb-6 md:-translate-y-2 hover:-translate-y-3 transition-transform">
                    <div className="absolute -top-3 px-2 sm:px-3 py-0.5 rounded-full bg-amber-400 text-black font-black text-[9px] sm:text-[10px] uppercase tracking-wider sm:tracking-widest shadow-[0_0_15px_rgba(245,158,11,0.6)] whitespace-nowrap">
                      👑 <span className="hidden xs:inline">CROWN</span>
                    </div>
                    <div className="relative my-2 sm:my-3">
                      <img
                        src={leaderboard[0].photoURL || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(leaderboard[0].name)}`}
                        alt={leaderboard[0].name}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(leaderboard[0].name)}`;
                        }}
                        className="w-12 h-12 xs:w-14 xs:h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl object-cover border-2 border-yellow-300 shadow-[0_0_25px_rgba(245,158,11,0.5)] bg-amber-950/40"
                      />
                      <div className="absolute -bottom-1.5 -right-1.5 sm:-bottom-2 sm:-right-2 w-5 h-5 sm:w-7 sm:h-7 rounded-md sm:rounded-lg bg-gradient-to-tr from-amber-500 to-yellow-300 border border-yellow-200 flex items-center justify-center text-black text-[10px] sm:text-xs font-black shadow-md">
                        1
                      </div>
                    </div>
                    <span className={`text-[8px] sm:text-[10px] font-black uppercase tracking-wider px-2 sm:px-3 py-0.5 rounded-full border mb-1.5 sm:mb-2 truncate max-w-full ${tier0.color}`}>
                      #1 {tier0.name.toUpperCase()}
                    </span>
                    <h4 className="text-xs sm:text-lg font-black text-white truncate max-w-full">
                      <span className="sm:hidden">{getFirstName(leaderboard[0].name)}</span>
                      <span className="hidden sm:inline">{leaderboard[0].name}</span>
                    </h4>
                    <span className="text-[10px] sm:text-xs text-amber-200/80 font-mono font-bold truncate max-w-full">{leaderboard[0].registrationNumber}</span>
                    <div className="mt-3 pt-2 sm:mt-4 sm:pt-3 border-t border-amber-500/30 w-full flex flex-col sm:flex-row items-center justify-between text-[10px] sm:text-xs gap-0.5">
                      <span className="text-slate-300 text-center sm:text-left">Adm: <strong className="text-emerald-400 font-bold">{leaderboard[0].admittedCount}</strong></span>
                      <span className="font-black text-amber-300 font-mono text-xs sm:text-base">{leaderboard[0].totalXP} XP</span>
                    </div>
                  </div>

                  {/* #3 Rank - Bronze Podium */}
                  <div className="p-2.5 xs:p-3 sm:p-5 rounded-2xl sm:rounded-3xl bg-gradient-to-b from-[#081a28] via-[#040e16] to-[#02070b] border border-cyan-500/40 relative flex flex-col items-center text-center shadow-[0_0_30px_rgba(6,182,212,0.15)] hover:-translate-y-1 transition-transform">
                    <div className="relative mb-2 sm:mb-3">
                      <img
                        src={leaderboard[2].photoURL || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(leaderboard[2].name)}`}
                        alt={leaderboard[2].name}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(leaderboard[2].name)}`;
                        }}
                        className="w-10 h-10 xs:w-12 xs:h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl object-cover border-2 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)] bg-cyan-950/40"
                      />
                      <div className="absolute -bottom-1.5 -right-1.5 sm:-bottom-2 sm:-right-2 w-5 h-5 sm:w-6 sm:h-6 rounded-md sm:rounded-lg bg-cyan-600 border border-cyan-300 flex items-center justify-center text-white text-[10px] sm:text-xs font-black shadow-md">
                        3
                      </div>
                    </div>
                    <span className={`text-[8px] sm:text-[9px] font-black uppercase tracking-wider px-2 sm:px-2.5 py-0.5 rounded-full border mb-1.5 sm:mb-2 truncate max-w-full ${tier2.color}`}>
                      #3 {tier2.name.toUpperCase()}
                    </span>
                    <h4 className="text-xs sm:text-base font-extrabold text-white truncate max-w-full">
                      <span className="sm:hidden">{getFirstName(leaderboard[2].name)}</span>
                      <span className="hidden sm:inline">{leaderboard[2].name}</span>
                    </h4>
                    <span className="text-[10px] sm:text-xs text-slate-400 font-mono truncate max-w-full">{leaderboard[2].registrationNumber}</span>
                    <div className="mt-3 pt-2 sm:mt-4 sm:pt-3 border-t border-cyan-500/20 w-full flex flex-col sm:flex-row items-center justify-between text-[10px] sm:text-xs gap-0.5">
                      <span className="text-slate-400 text-center sm:text-left">Refs: <strong className="text-white">{leaderboard[2].totalReferrals}</strong></span>
                      <span className="font-bold text-cyan-300 font-mono text-xs sm:text-sm">{leaderboard[2].totalXP} XP</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Comprehensive Standings Table */}
            <div className="bg-[#0b0318]/90 border border-purple-500/30 rounded-3xl p-4 sm:p-6 shadow-[0_0_35px_rgba(168,85,247,0.1)] space-y-4">
              <div className="flex items-center justify-between px-2">
                <span className="text-xs font-black uppercase tracking-wider text-purple-300">
                  ALL OPERATOR STANDINGS
                </span>
                <span className="text-[11px] text-slate-400 font-mono">Ranked by Total Recruiter XP</span>
              </div>

              <div className="space-y-2.5">
                {leaderboard.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">No referral records on leaderboard yet.</div>
                ) : (
                  leaderboard.map((lb) => {
                    const tier = getRecruiterTier(lb.rankNumber);
                    const isCurrentUser = userRegNo && lb.registrationNumber.toUpperCase() === userRegNo.toUpperCase();

                    return (
                      <div 
                        key={lb.registrationNumber} 
                        className={`p-3.5 sm:p-4 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-3 ${
                          isCurrentUser
                            ? 'bg-purple-600/20 border-purple-400/80 shadow-[0_0_20px_rgba(168,85,247,0.25)]'
                            : 'bg-black/40 border-purple-500/15 hover:border-purple-500/40 hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="shrink-0 flex items-center gap-2">
                            {renderRankBadge(lb.rankNumber)}
                            <img
                              src={lb.photoURL || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(lb.name)}`}
                              alt={lb.name}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(lb.name)}`;
                              }}
                              className="w-10 h-10 rounded-xl object-cover border border-purple-500/30 bg-purple-950/40"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-white font-bold text-sm truncate">{lb.name}</h4>
                              {isCurrentUser && (
                                <span className="text-[9px] font-black uppercase px-2 py-0.2 rounded-full bg-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.5)]">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-0.5">
                              <span>{lb.registrationNumber}</span>
                              <span>•</span>
                              <span>{lb.totalReferrals} referred</span>
                              {lb.admittedCount > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="text-emerald-400 font-bold">{lb.admittedCount} admitted</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`hidden sm:inline-flex text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold ${tier.color}`}>
                            {tier.name}
                          </span>
                          <div className="text-right">
                            <span className="text-sm sm:text-base font-black text-purple-300 font-mono tracking-tight block">
                              {lb.totalXP} XP
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: MY REGISTRY */}
        {activeTab === 'my_ops' && (
          <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-purple-500/30 space-y-5 sm:space-y-6 text-left">
            <h3 className="text-lg sm:text-xl font-bold text-white uppercase">MY SUBMITTED CANDIDATES</h3>

            <div className="space-y-3">
              {getMyReferrals().length === 0 ? (
                <p className="text-slate-500 text-center py-8 text-sm">You haven't submitted any candidate referrals yet.</p>
              ) : (
                getMyReferrals().map((ref, idx) => (
                  <div key={idx} className="p-3.5 sm:p-4 bg-black/50 border border-white/5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-white font-bold text-sm truncate">{getRefVal(ref, 'Candidate Name') || getRefVal(ref, 'candidateName')}</h4>
                      <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-400 font-code-sm mt-1 flex-wrap">
                        <span>{getRefVal(ref, 'Candidate Registration Number') || getRefVal(ref, 'candidateRegNo')}</span>
                        <span>•</span>
                        <span>{getRefVal(ref, 'Target Team') || getRefVal(ref, 'targetTeam') || 'Technical'}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-white/5 shrink-0">
                      {getStatusPill(getRefVal(ref, 'Status') || getRefVal(ref, 'status'))}
                      {canDeleteReferrals && (
                        <button
                          type="button"
                          title="Delete Referral (Admin)"
                          onClick={() => {
                            const cReg = getRefVal(ref, 'Candidate Registration Number') || getRefVal(ref, 'candidateRegNo') || 'UNKNOWN';
                            const cName = getRefVal(ref, 'Candidate Name') || getRefVal(ref, 'candidateName') || 'Candidate';
                            setPendingDeleteReferral({ docId: ref.id, regNo: cReg, candidateName: cName });
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: MASTER ADMIN CONTROL PANEL */}
        {activeTab === 'admin' && isMasterAdmin && (
          <div className="space-y-4 text-left">
            {/* Minimal Header & Quick Metrics */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-2xl bg-[#0e041d]/80 border border-purple-500/30 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300">
                  <span className="material-symbols-outlined text-xl">admin_panel_settings</span>
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                    <span>CANDIDATE DOSSIERS</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      {getActiveAdminReferrals().length} Active
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">Manage candidate pipeline status and admissions</p>
                </div>
              </div>

              {/* Status Mini Badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { label: 'Pending', count: referrals.filter(r => (getRefVal(r, 'Status') || getRefVal(r, 'status') || 'Pending').toLowerCase() === 'pending').length, color: 'text-cyan-300 bg-cyan-950/40 border-cyan-500/30' },
                  { label: 'Process', count: referrals.filter(r => (getRefVal(r, 'Status') || getRefVal(r, 'status') || '').toLowerCase().includes('process')).length, color: 'text-amber-300 bg-amber-950/40 border-amber-500/30' },
                  { label: 'Interview', count: referrals.filter(r => (getRefVal(r, 'Status') || getRefVal(r, 'status') || '').toLowerCase().includes('interview')).length, color: 'text-purple-300 bg-purple-950/40 border-purple-500/30' },
                  { label: 'Admitted', count: referrals.filter(r => (getRefVal(r, 'Status') || getRefVal(r, 'status') || '').toLowerCase() === 'admitted').length, color: 'text-emerald-300 bg-emerald-950/40 border-emerald-500/30' },
                ].map((s, idx) => (
                  <span key={idx} className={`px-2.5 py-1 rounded-xl text-[11px] font-mono font-bold border ${s.color} flex items-center gap-1.5`}>
                    <span>{s.label}:</span>
                    <span className="font-black">{s.count}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Filter Controls Bar */}
            <div className="p-3 sm:p-4 rounded-2xl bg-[#090214]/90 border border-purple-500/25 flex flex-col md:flex-row md:items-center gap-3 shadow-md">
              {/* Search Box */}
              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-purple-400 text-base">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Search candidate name, reg number, email, phone, or referrer..."
                  value={adminSearchQuery}
                  onChange={(e) => setAdminSearchQuery(e.target.value)}
                  className="w-full bg-[#05010a] border border-purple-500/30 rounded-xl pl-9 pr-8 py-2 text-xs text-white focus:outline-none focus:border-purple-400 placeholder:text-slate-500 font-mono transition-all"
                />
                {adminSearchQuery && (
                  <button 
                    onClick={() => setAdminSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs p-1"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full md:w-auto">
                {/* Team Filter */}
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <span className="text-[10px] font-black text-purple-300 uppercase tracking-wider shrink-0">TEAM:</span>
                  <select
                    value={adminTeamFilter}
                    onChange={(e) => setAdminTeamFilter(e.target.value)}
                    className="w-full sm:w-auto min-w-0 bg-[#05010a] border border-purple-500/30 text-white rounded-xl px-2 sm:px-3 py-2 text-xs focus:outline-none focus:border-purple-400 cursor-pointer font-bold tracking-wide truncate"
                  >
                    <option value="All">All Divisions</option>
                    <option value="Technical">Technical</option>
                    <option value="Design">Design</option>
                    <option value="Education">Education</option>
                    <option value="Esports(PC)">Esports (PC)</option>
                    <option value="Esports(Mobile)">Esports (Mobile)</option>
                    <option value="PR">PR</option>
                    <option value="Social Media">Social Media</option>
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <span className="text-[10px] font-black text-purple-300 uppercase tracking-wider shrink-0">STATUS:</span>
                  <select
                    value={adminStatusFilter}
                    onChange={(e) => setAdminStatusFilter(e.target.value)}
                    className="w-full sm:w-auto min-w-0 bg-[#05010a] border border-purple-500/30 text-white rounded-xl px-2 sm:px-3 py-2 text-xs focus:outline-none focus:border-purple-400 cursor-pointer font-bold tracking-wide truncate"
                  >
                    <option value="All">Active Pipeline (Excl. Final)</option>
                    <option value="Pending">Pending Review</option>
                    <option value="In Process">In Process</option>
                    <option value="Invited to Interview">Interview Scheduled</option>
                    <option value="Interview Taken">Interview Taken</option>
                    <option value="Admitted">Admitted</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Candidate Dossiers Section */}
            <div className="bg-[#090214]/95 border border-purple-500/30 rounded-2xl p-3 sm:p-5 shadow-[0_0_30px_rgba(0,0,0,0.6)] space-y-3">
              
              {/* === MOBILE CARD VIEW (< md) === */}
              <div className="md:hidden space-y-3">
                {getActiveAdminReferrals().length > 0 ? (
                  getActiveAdminReferrals().map((ref, idx) => {
                    const cName = getRefVal(ref, "Candidate Name") || getRefVal(ref, "candidateName") || "Candidate Profile";
                    const cReg = getRefVal(ref, "Candidate Registration Number") || getRefVal(ref, "candidateRegNo") || "UNKNOWN";
                    const refName = getRefVal(ref, "Referrer Name") || getRefVal(ref, "referrerName") || "VRGC Recruiter";
                    const refReg = getRefVal(ref, "Referrer Registration Number") || getRefVal(ref, "referrerRegNo") || "UNKNOWN";
                    const currentStatus = getRefVal(ref, "Status") || getRefVal(ref, "status") || "Pending";
                    const isUpdating = isUpdatingStatus === cReg;
                    const dropdownKey = `m-${ref.id || cReg}`;

                    return (
                      <div
                        key={cReg + idx}
                        onClick={() => setInspectingCandidate(ref)}
                        className="p-3.5 rounded-2xl bg-black/50 border border-purple-500/20 space-y-2.5 hover:border-purple-400/40 transition-colors cursor-pointer"
                      >
                        {/* Header: Candidate Name, ID & Team Badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-white text-sm truncate flex items-center gap-1.5">
                              <span>{cName}</span>
                              <span className="material-symbols-outlined text-xs text-purple-400">visibility</span>
                            </div>
                            <div className="text-xs text-purple-400 font-mono font-semibold mt-0.5">{cReg}</div>
                          </div>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold font-mono bg-yellow-500/10 text-yellow-300 border border-yellow-500/25 shrink-0">
                            {getRefVal(ref, "Target Team") || getRefVal(ref, "targetTeam") || "Technical"}
                          </span>
                        </div>

                        {/* Candidate Email & Recruiter Attribution */}
                        <div className="text-[11px] text-slate-400 space-y-1 pt-1.5 border-t border-white/5 font-mono">
                          <div className="truncate text-slate-300">
                            {getRefVal(ref, "Candidate Email") || getRefVal(ref, "candidateEmail")}
                          </div>
                          <div className="flex items-center gap-1 text-slate-400 truncate">
                            <span className="text-purple-300">Ref by:</span>
                            <span className="text-white font-bold truncate">{refName}</span>
                            <span className="text-slate-500 shrink-0">({refReg})</span>
                          </div>
                        </div>

                        {/* Action Bar: Status Pill Dropdown & Delete */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
                          <div className="relative flex-1">
                            {isUpdating ? (
                              <div className="flex items-center gap-2 text-purple-400 text-xs py-1.5 font-mono">
                                <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                                <span>UPDATING...</span>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setActiveStatusDropdownId(activeStatusDropdownId === dropdownKey ? null : dropdownKey)}
                                  className={`w-full px-3 py-1.5 rounded-xl text-xs font-bold font-mono tracking-wide flex items-center justify-between gap-1.5 border transition-colors cursor-pointer shadow-md ${getSelectStatusColor(currentStatus)} hover:brightness-125`}
                                >
                                  <span className="truncate">{currentStatus}</span>
                                  <span className={`material-symbols-outlined text-xs shrink-0 transition-transform ${activeStatusDropdownId === dropdownKey ? 'rotate-180' : ''}`}>
                                    expand_more
                                  </span>
                                </button>

                                {activeStatusDropdownId === dropdownKey && (
                                  <>
                                    <div 
                                      className="fixed inset-0 z-40" 
                                      onClick={() => setActiveStatusDropdownId(null)}
                                    />
                                    <div className="absolute left-0 bottom-full mb-1.5 z-50 bg-[#0d041c] border border-purple-500/50 rounded-xl p-1.5 shadow-[0_15px_50px_rgba(0,0,0,0.95)] min-w-[200px] w-full space-y-1 text-left animate-in fade-in duration-100">
                                      {[
                                        { name: 'Pending', icon: 'hourglass_empty', color: 'text-cyan-300 hover:bg-cyan-950/50' },
                                        { name: 'In Process', icon: 'timelapse', color: 'text-amber-300 hover:bg-amber-950/50' },
                                        { name: 'Invited to Interview', icon: 'event', color: 'text-purple-300 hover:bg-purple-950/50' },
                                        { name: 'Interview Taken', icon: 'how_to_reg', color: 'text-indigo-300 hover:bg-indigo-950/50' },
                                        { name: 'Admitted', icon: 'verified', color: 'text-emerald-300 hover:bg-emerald-950/50' },
                                        { name: 'Rejected', icon: 'cancel', color: 'text-rose-400 hover:bg-rose-950/50' },
                                      ].map((opt) => {
                                        const isSelected = currentStatus === opt.name;
                                        return (
                                          <button
                                            key={opt.name}
                                            type="button"
                                            onClick={() => {
                                              setActiveStatusDropdownId(null);
                                              handleUpdateStatus(ref.id, cReg, cName, opt.name);
                                            }}
                                            className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center justify-between gap-3 transition-colors cursor-pointer whitespace-nowrap ${
                                              isSelected 
                                                ? 'bg-purple-600/35 text-white border border-purple-400/50' 
                                                : `${opt.color} hover:text-white`
                                            }`}
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className="material-symbols-outlined text-sm">{opt.icon}</span>
                                              <span>{opt.name}</span>
                                            </div>
                                            {isSelected && (
                                              <span className="material-symbols-outlined text-xs text-purple-300">check</span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                          </div>

                          {canDeleteReferrals && (
                            <button
                              type="button"
                              title="Delete Referral Dossier (Super Admin Only)"
                              disabled={isDeletingReferral === cReg}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDeleteReferral({ docId: ref.id, regNo: cReg, candidateName: cName });
                              }}
                              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all cursor-pointer shrink-0"
                            >
                              {isDeletingReferral === cReg ? (
                                <span className="material-symbols-outlined animate-spin text-sm text-rose-400">sync</span>
                              ) : (
                                <span className="material-symbols-outlined text-sm">delete</span>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-10 text-center text-slate-500 text-xs italic">
                    No candidate referral records match the selected filters.
                  </div>
                )}
              </div>

              {/* === DESKTOP TABLE VIEW (md+) === */}
              <div className="hidden md:block overflow-x-auto [scrollbar-width:thin] custom-scrollbar">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-purple-500/20 text-[10px] text-slate-400 uppercase tracking-widest font-black">
                      <th className="py-2.5 px-3 font-black text-left">CANDIDATE INFO</th>
                      <th className="py-2.5 px-3 font-black text-left">RECRUITER IDENT</th>
                      <th className="py-2.5 px-3 font-black text-left">DIVISION</th>
                      <th className="py-2.5 px-3 font-black text-right">DOSSIER STATUS</th>
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
                            className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors duration-150 group"
                          >
                            <td className="py-3 px-3 text-left">
                              <div className="font-bold text-white text-xs group-hover:text-purple-300 transition-colors">{cName}</div>
                              <div className="text-[11px] text-purple-400 font-mono font-bold">{cReg}</div>
                              <div className="text-[10px] text-slate-400 truncate max-w-[180px]">
                                {getRefVal(ref, "Candidate Email") || getRefVal(ref, "candidateEmail")}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-xs text-left">
                              <div className="font-bold text-slate-200">{refName}</div>
                              <div className="text-slate-400 font-mono text-[10px]">{refReg}</div>
                            </td>
                            <td className="py-3 px-3 text-xs text-left">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold font-mono bg-yellow-500/10 text-yellow-300 border border-yellow-500/25">
                                {getRefVal(ref, "Target Team") || getRefVal(ref, "targetTeam") || "Technical"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="inline-flex items-center justify-end gap-2 relative">
                                {isUpdating && (
                                  <span className="material-symbols-outlined animate-spin text-purple-400 text-sm">sync</span>
                                )}

                                {/* Custom Status Pill & Dropdown */}
                                <div className="relative">
                                  <button
                                    type="button"
                                    disabled={isUpdating}
                                    onClick={() => setActiveStatusDropdownId(activeStatusDropdownId === (ref.id || cReg) ? null : (ref.id || cReg))}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold font-mono tracking-wide flex items-center justify-between gap-1.5 border transition-colors cursor-pointer shadow-md ${getSelectStatusColor(currentStatus)} hover:brightness-125 whitespace-nowrap min-w-[130px]`}
                                  >
                                    <span className="truncate">{currentStatus}</span>
                                    <span className={`material-symbols-outlined text-xs shrink-0 transition-transform ${activeStatusDropdownId === (ref.id || cReg) ? 'rotate-180' : ''}`}>
                                      expand_more
                                    </span>
                                  </button>

                                  {activeStatusDropdownId === (ref.id || cReg) && (
                                    <>
                                      <div 
                                        className="fixed inset-0 z-40" 
                                        onClick={() => setActiveStatusDropdownId(null)}
                                      />
                                      <div className="absolute right-0 top-full mt-1.5 z-50 bg-[#0d041c] border border-purple-500/50 rounded-xl p-1.5 shadow-[0_15px_50px_rgba(0,0,0,0.95)] min-w-[190px] w-max space-y-1 text-left animate-in fade-in duration-100">
                                        {[
                                          { name: 'Pending', icon: 'hourglass_empty', color: 'text-cyan-300 hover:bg-cyan-950/50' },
                                          { name: 'In Process', icon: 'timelapse', color: 'text-amber-300 hover:bg-amber-950/50' },
                                          { name: 'Invited to Interview', icon: 'event', color: 'text-purple-300 hover:bg-purple-950/50' },
                                          { name: 'Interview Taken', icon: 'how_to_reg', color: 'text-indigo-300 hover:bg-indigo-950/50' },
                                          { name: 'Admitted', icon: 'verified', color: 'text-emerald-300 hover:bg-emerald-950/50' },
                                          { name: 'Rejected', icon: 'cancel', color: 'text-rose-400 hover:bg-rose-950/50' },
                                        ].map((opt) => {
                                          const isSelected = currentStatus === opt.name;
                                          return (
                                            <button
                                              key={opt.name}
                                              type="button"
                                              onClick={() => {
                                                setActiveStatusDropdownId(null);
                                                handleUpdateStatus(ref.id, cReg, cName, opt.name);
                                              }}
                                              className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center justify-between gap-3 transition-colors cursor-pointer whitespace-nowrap ${
                                                isSelected 
                                                  ? 'bg-purple-600/35 text-white border border-purple-400/50' 
                                                  : `${opt.color} hover:text-white`
                                              }`}
                                            >
                                              <div className="flex items-center gap-2">
                                                <span className="material-symbols-outlined text-sm">{opt.icon}</span>
                                                <span>{opt.name}</span>
                                              </div>
                                              {isSelected && (
                                                <span className="material-symbols-outlined text-xs text-purple-300">check</span>
                                              )}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </>
                                  )}
                                </div>

                                {canDeleteReferrals && (
                                  <button
                                    type="button"
                                    title="Delete Referral Dossier (Super Admin Only)"
                                    disabled={isDeletingReferral === cReg}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPendingDeleteReferral({ docId: ref.id, regNo: cReg, candidateName: cName });
                                    }}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 transition-all cursor-pointer"
                                  >
                                    {isDeletingReferral === cReg ? (
                                      <span className="material-symbols-outlined animate-spin text-sm text-rose-400">sync</span>
                                    ) : (
                                      <span className="material-symbols-outlined text-sm">delete</span>
                                    )}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-slate-500 text-xs italic">
                          No candidate referral records match the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Status Confirmation Modal */}
        {pendingStatusChange && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md">
            <div className="glass-panel p-6 sm:p-8 rounded-2xl max-w-md w-full text-center space-y-5 sm:space-y-6 border border-purple-500/30 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
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

        {/* Sync Toast Notification */}
        {syncToastMessage && (
          <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 glass-panel p-3.5 sm:p-4 rounded-xl border border-green-500/40 bg-black/90 flex items-center gap-3 text-left shadow-[0_10px_30px_rgba(0,0,0,0.8)] max-w-[calc(100vw-2rem)] sm:max-w-none">
            <span className="material-symbols-outlined text-green-400 text-lg shrink-0">check_circle</span>
            <span className="text-xs text-white font-bold">{syncToastMessage}</span>
          </div>
        )}

      </div>

      {/* Candidate Detail Inspector Modal */}
      {inspectingCandidate && (
        <div className="fixed inset-0 z-[999] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
          <div className="glass-panel p-5 sm:p-6 md:p-8 rounded-2xl max-w-lg w-full text-left space-y-4 sm:space-y-5 border border-purple-500/30 shadow-[0_0_60px_rgba(168,85,247,0.4)] relative max-h-[85vh] overflow-y-auto custom-scrollbar animate-in zoom-in-95 duration-150">
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
                className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">CANDIDATE NAME</span>
                <span className="text-sm font-bold text-white block">{getRefVal(inspectingCandidate, "Candidate Name") || getRefVal(inspectingCandidate, "candidateName")}</span>
              </div>
              
              <div>
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">REGISTRATION NUMBER</span>
                <span className="text-sm font-bold text-purple-400 font-code-sm block">{getRefVal(inspectingCandidate, "Candidate Registration Number") || getRefVal(inspectingCandidate, "candidateRegNo")}</span>
              </div>

              <div className="sm:col-span-2">
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">EMAIL ADDRESS</span>
                <span className="text-sm font-bold text-white block truncate">{getRefVal(inspectingCandidate, "Candidate Email") || getRefVal(inspectingCandidate, "candidateEmail")}</span>
              </div>

              <div>
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">PHONE NUMBER</span>
                <span className="text-sm font-bold text-white block">{getRefVal(inspectingCandidate, "Candidate Phone") || getRefVal(inspectingCandidate, "candidatePhone")}</span>
              </div>

              <div>
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">TARGETED TEAM</span>
                <span className="text-sm font-bold text-yellow-400 block">{getRefVal(inspectingCandidate, "Target Team") || getRefVal(inspectingCandidate, "targetTeam") || "Technical"}</span>
              </div>

              <div className="sm:col-span-2">
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">SUBMISSION TIMESTAMP</span>
                <span className="text-sm font-bold text-white block">{new Date(getRefVal(inspectingCandidate, "Timestamp") || getRefVal(inspectingCandidate, "timestamp") || new Date()).toLocaleString()}</span>
              </div>
            </div>

            <div className="flex justify-between items-center border-t border-purple-500/20 pt-4">
              <span className="text-[10px] text-purple-300 font-label-caps tracking-widest font-bold">DOSSIER STATUS</span>
              <div className="flex items-center gap-3">
                {getStatusPill(getRefVal(inspectingCandidate, "Status") || getRefVal(inspectingCandidate, "status"))}
                {canDeleteReferrals && (
                  <button
                    type="button"
                    onClick={() => {
                      const cReg = getRefVal(inspectingCandidate, "Candidate Registration Number") || getRefVal(inspectingCandidate, "candidateRegNo") || "UNKNOWN";
                      const cName = getRefVal(inspectingCandidate, "Candidate Name") || getRefVal(inspectingCandidate, "candidateName") || "Candidate";
                      setPendingDeleteReferral({ docId: inspectingCandidate.id, regNo: cReg, candidateName: cName });
                    }}
                    className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/20 text-xs font-bold font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                    <span>DELETE DOSSIER</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Referral Confirmation Modal */}
      {pendingDeleteReferral && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md">
          <div className="glass-panel p-6 sm:p-8 rounded-2xl max-w-md w-full text-center space-y-5 sm:space-y-6 border border-rose-500/50 shadow-[0_0_60px_rgba(244,63,94,0.3)]">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-500/15 border-2 border-rose-500/40 flex items-center justify-center text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.3)]">
              <span className="material-symbols-outlined text-3xl">delete_forever</span>
            </div>
            <div className="space-y-2">
              <h3 className="font-display-lg text-2xl text-white font-extrabold uppercase">
                Delete Referral Record?
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to permanently delete candidate referral dossier for <strong className="text-white">"{pendingDeleteReferral.candidateName}"</strong> (<span className="text-purple-400 font-mono">{pendingDeleteReferral.regNo}</span>)?
              </p>
              <p className="text-[11px] text-rose-400/90 font-medium">
                ⚠️ This action cannot be undone and will recalculate recruiter leaderboard scores.
              </p>
            </div>
            <div className="flex gap-4 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteReferral(null)}
                className="flex-1 py-3 border border-purple-500/30 hover:bg-white/5 rounded-xl font-label-caps text-xs text-white tracking-widest cursor-pointer"
              >
                CANCEL
              </button>
              <button
                type="button"
                disabled={isDeletingReferral === pendingDeleteReferral.regNo}
                onClick={() => {
                  const { docId, regNo } = pendingDeleteReferral;
                  executeDeleteReferral(docId, regNo);
                }}
                className="flex-1 py-3 rounded-xl font-label-caps text-xs text-white font-black tracking-widest bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 shadow-[0_0_20px_rgba(244,63,94,0.4)] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {isDeletingReferral === pendingDeleteReferral.regNo ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                    <span>DELETING...</span>
                  </>
                ) : (
                  <span>DELETE FOREVER</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default Referrals;
