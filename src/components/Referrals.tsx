"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CONFIG } from '../lib/config';
import { auth, googleProvider, db } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, updateDoc, deleteDoc, doc, setDoc, onSnapshot, query, orderBy, getDocs, getDoc, deleteField, where } from 'firebase/firestore';
import SpecularButton from './SpecularButton';

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
  const [mounted, setMounted] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'form' | 'leaderboard' | 'my_ops' | 'admin'>('form');

  useEffect(() => {
    setMounted(true);
  }, []);

  // Input states
  const [name, setName] = useState<string>('');
  const [registrationNumber, setRegistrationNumber] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [referrerInfo, setReferrerInfo] = useState<MemberData | null>(null);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const isMasterAdmin = externalIsAdmin !== undefined ? externalIsAdmin : (currentUser ? adminEmails.includes((currentUser.email || '').toLowerCase()) : false);
  const canDeleteReferrals = isMasterAdmin || CONFIG.LOG_DELETE_ADMIN_EMAILS.includes((currentUser?.email || '').toLowerCase().trim());

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
  const [pendingBulkDelete, setPendingBulkDelete] = useState<ReferralRecord[] | null>(null);
  const [editingCandidate, setEditingCandidate] = useState<ReferralRecord | null>(null);
  const [editFormData, setEditFormData] = useState({
    candidateName: '',
    candidateRegNo: '',
    candidateEmail: '',
    candidatePhone: '',
    targetTeam: 'Technical',
    status: 'Pending',
  });
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [isDeletingReferral, setIsDeletingReferral] = useState<string | null>(null);
  const [activeStatusDropdownId, setActiveStatusDropdownId] = useState<string | null>(null);

  // Admin filter states
  const [adminSearchQuery, setAdminSearchQuery] = useState<string>('');
  const [adminTeamFilter, setAdminTeamFilter] = useState<string>('All');
  const [adminStatusFilter, setAdminStatusFilter] = useState<string>('All');
  const [showAdminFilters, setShowAdminFilters] = useState<boolean>(true);
  const [syncToastMessage, setSyncToastMessage] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);

  // Multi-selection & Bulk Status state
  const [selectedReferralIds, setSelectedReferralIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState<boolean>(false);

  // Close export dropdown when clicking outside
  useEffect(() => {
    if (!showExportMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.ref-export-dropdown-container')) {
        setShowExportMenu(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [showExportMenu]);

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
    const myEmail = (currentUser?.email || '').toLowerCase().trim();
    if (!myEmail) return 0;

    const currentUTCDateStr = new Date().toISOString().split('T')[0];

    return referrals.filter(ref => {
      const email = (
        getRefVal(ref, 'Referrer Email') ||
        getRefVal(ref, 'referrerEmail') ||
        getRefVal(ref, 'referrer_email') ||
        ref.referrerEmail ||
        ref['Referrer Email'] ||
        ref.user_email ||
        getRefVal(ref, 'user_email') ||
        ref.userEmail ||
        getRefVal(ref, 'userEmail') ||
        ''
      ).toString().toLowerCase().trim();

      if (email !== myEmail) return false;

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

        // Fetch members from Firestore 'members' and 'id_cards' collections
        const parsedMembersMap = new Map<string, MemberData>();

        try {
          const mSnap = await getDocs(collection(db, 'members'));
          mSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const email = (data.email || data.Email || docSnap.id || '').toLowerCase().trim();
            const reg = (data.registrationNumber || data['Registration Number'] || data.regNo || '').toUpperCase().trim();
            const name = (data.name || data.Name || data.fullName || 'Member').trim();
            const photo = data.photoUrl || data.photoURL || data.avatarUrl || data.photo || data.image || data.avatar;

            if (photo) {
              if (email) {
                photos[email] = photo;
                photos[email.split('@')[0]] = photo;
              }
              if (reg) photos[reg] = photo;
              if (name) photos[name.toLowerCase()] = photo;
            }

            const mapKey = reg || email || docSnap.id;
            if (mapKey) {
              parsedMembersMap.set(mapKey, {
                Name: name,
                'Registration Number': reg,
                Email: email,
                Phone: data.phone || data.Phone || '',
                Team: data.team || data.domain || 'Member',
                Position: data.position || 'Member',
              });
            }
          });
        } catch (mErr) {
          console.warn('Error fetching members collection:', mErr);
        }

        // Fetch members from Firestore 'id_cards' collection
        try {
          const memberCol = collection(db, 'id_cards');
          const memberSnap = await getDocs(memberCol);
          memberSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const email = (data.email || data.Email || docSnap.id || '').toLowerCase().trim();
            const reg = (data.regNo || data.registrationNumber || '').toUpperCase().trim();
            const name = (data.fullName || data.name || 'Member').trim();
            const photo = data.photoUrl || data.photoURL || data.avatarUrl || data.photo || data.image;

            if (photo) {
              if (email) {
                photos[email] = photo;
                photos[email.split('@')[0]] = photo;
              }
              if (reg) photos[reg] = photo;
              if (name) photos[name.toLowerCase()] = photo;
            }

            const mapKey = reg || email || docSnap.id;
            if (mapKey && !parsedMembersMap.has(mapKey)) {
              parsedMembersMap.set(mapKey, {
                Name: name,
                'Registration Number': reg,
                Email: email,
                Phone: data.phone || '',
                Team: data.team || data.domain || 'Member',
                Position: data.position || 'Member',
              });
            }
          });

          if (parsedMembersMap.size > 0) {
            setMembers(Array.from(parsedMembersMap.values()));
          }
        } catch (mErr) {
          console.warn('Error fetching id_cards from Firestore:', mErr);
        }

        setUserPhotoMap(photos);
      } catch (err) {
        console.error('Error loading Firestore referral data:', err);
      }
    };
    loadFirestoreData();
  }, []);

  useEffect(() => {
    let unsubscribe = () => { };
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

  const checkDuplicateRegistration = (regNo: string, currentDocId?: string): { isDuplicate: boolean; message?: string } => {
    const clean = regNo.trim().toUpperCase();
    if (!clean) return { isDuplicate: false };

    // 1. HIGHEST PRIORITY: Check if the candidate is already an active/admitted member of VRGC Roster
    const existingMember = members.find(m => {
      const mReg = (m['Registration Number'] || m.regNo || m['Registration No'] || m.registrationNumber || '').toUpperCase().trim();
      return mReg === clean;
    });

    if (existingMember) {
      const personName = (existingMember.Name || existingMember.name || existingMember['Full Name'] || '').trim();
      const displayName = personName || name.trim() || clean;
      return {
        isDuplicate: true,
        message: `${displayName} is already present in the Members Roster.`,
      };
    }

    // 2. Check active in-progress referrals (Pending, Under Review, Interviewing, etc.)
    // Note: If candidate was admitted previously but deleted from the roster, or rejected, they are not in the roster and can be referred!
    const activeReferral = referrals.find(r => {
      if (currentDocId && r.id === currentDocId) return false;
      const rReg = (getRefVal(r, 'Candidate Registration Number') || getRefVal(r, 'candidateRegNo') || '').toUpperCase().trim();
      if (rReg !== clean) return false;

      const rawStatus = (getRefVal(r, 'Status') || r.status || '').toLowerCase().trim();
      if (rawStatus === 'admitted' || rawStatus === 'rejected') {
        return false;
      }
      return true;
    });

    if (activeReferral) {
      const personName = (getRefVal(activeReferral, 'Candidate Name') || getRefVal(activeReferral, 'candidateName') || '').trim();
      const displayName = personName || name.trim() || clean;
      return {
        isDuplicate: true,
        message: `Someone has already referred ${displayName}! A candidate cannot be referred more than once.`,
      };
    }

    return { isDuplicate: false };
  };

  const handleRegNoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    setRegistrationNumber(val);
    if (val.length === 10) {
      const dup = checkDuplicateRegistration(val);
      if (dup.isDuplicate) {
        setErrors(prev => ({ ...prev, registrationNumber: dup.message || null }));
      } else if (errors.registrationNumber) {
        setErrors(prev => ({ ...prev, registrationNumber: null }));
      }
    } else if (errors.registrationNumber) {
      setErrors(prev => ({ ...prev, registrationNumber: null }));
    }
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
    } else {
      const dup = checkDuplicateRegistration(registrationNumber);
      if (dup.isDuplicate) {
        newErrors.registrationNumber = dup.message || 'Someone has already registered that member!';
      }
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

    const cleanReg = registrationNumber.trim().toUpperCase();

    // Secondary defensive duplicate check (local state)
    const dupCheck = checkDuplicateRegistration(cleanReg);
    if (dupCheck.isDuplicate) {
      setErrors(prev => ({ ...prev, registrationNumber: dupCheck.message || null }));
      return;
    }

    setIsSubmitting(true);

    // Deep Firestore uniqueness check (ensures real-time integrity even against parallel requests)
    try {
      // 1. Check if candidate is already in Firestore 'members' collection
      let memName = '';
      const qMemReg = query(collection(db, 'members'), where('registrationNumber', '==', cleanReg));
      const snapMem = await getDocs(qMemReg);
      if (!snapMem.empty) {
        const d = snapMem.docs[0].data();
        memName = (d.name || d.Name || d.fullName || '').trim();
      } else {
        const docById = await getDoc(doc(db, 'members', cleanReg.toLowerCase()));
        if (docById.exists()) {
          const d = docById.data();
          memName = (d.name || d.Name || d.fullName || '').trim();
        }
      }

      if (!memName) {
        // Also check id_cards in Firestore
        const qId = query(collection(db, 'id_cards'), where('regNo', '==', cleanReg));
        const snapId = await getDocs(qId);
        if (!snapId.empty) {
          const d = snapId.docs[0].data();
          memName = (d.fullName || d.name || '').trim();
        }
      }

      if (memName) {
        const displayName = memName || name.trim() || cleanReg;
        setErrors(prev => ({ ...prev, registrationNumber: `${displayName} is already present in the Members Roster.` }));
        setIsSubmitting(false);
        return;
      }

      // 2. Check Firestore 'referrals' collection
      const qCamel = query(collection(db, 'referrals'), where('candidateRegNo', '==', cleanReg));
      const snapCamel = await getDocs(qCamel);
      let dupDoc = snapCamel.docs[0];
      if (!dupDoc) {
        const qTitle = query(collection(db, 'referrals'), where('Candidate Registration Number', '==', cleanReg));
        const snapTitle = await getDocs(qTitle);
        dupDoc = snapTitle.docs[0];
      }

      if (dupDoc) {
        const dupData = dupDoc.data();
        const dupStatus = (dupData.status || dupData.Status || '').toLowerCase().trim();
        const candName = (dupData.candidateName || dupData['Candidate Name'] || name.trim() || cleanReg).trim();

        if (dupStatus === 'admitted' || dupStatus === 'rejected') {
          // Member was deleted from roster or rejected, but stale referral record lingered:
          // Clean up the stale referral doc so the new referral transmits seamlessly!
          await deleteDoc(dupDoc.ref).catch(() => {});
          setReferrals(prev => prev.filter(r => r.id !== dupDoc?.id));
        } else {
          setErrors(prev => ({
            ...prev,
            registrationNumber: `Someone has already referred ${candName}! A candidate cannot be referred more than once.`,
          }));
          setIsSubmitting(false);
          return;
        }
      }
    } catch (queryErr) {
      console.warn('Firestore real-time uniqueness query error:', queryErr);
    }

    const candidateData: ReferralRecord = {
      timestamp: new Date().toISOString(),
      candidateName: name.trim(),
      candidateRegNo: cleanReg,
      candidateEmail: email.trim().toLowerCase(),
      candidatePhone: phone.trim(),
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

  const getRefKey = (ref: ReferralRecord, idx?: number) => {
    return ref.id || getRefVal(ref, 'Candidate Registration Number') || getRefVal(ref, 'candidateRegNo') || `ref-${idx}`;
  };

  const addAdmittedCandidateToMembers = async (candidate: ReferralRecord) => {
    try {
      const cName = getRefVal(candidate, 'Candidate Name') || getRefVal(candidate, 'candidateName') || 'Member';
      const cReg = (getRefVal(candidate, 'Candidate Registration Number') || getRefVal(candidate, 'candidateRegNo') || '').toUpperCase().trim();
      const cEmail = (getRefVal(candidate, 'Candidate Email') || getRefVal(candidate, 'candidateEmail') || '').toLowerCase().trim();
      const cPhone = (getRefVal(candidate, 'Candidate Phone') || getRefVal(candidate, 'candidatePhone') || '').trim();
      const cTeam = formatTeamName(getRefVal(candidate, 'Target Team') || getRefVal(candidate, 'targetTeam') || 'Technical');

      const docId = (cEmail || cReg || `admitted-${Date.now()}`).toLowerCase();
      await setDoc(
        doc(db, 'members', docId),
        {
          name: cName,
          registrationNumber: cReg,
          email: cEmail,
          phone: cPhone,
          team: cTeam,
          position: 'Core Member', // As requested: role as core member in VRGC database
          admittedFrom: 'referrals',
          admittedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Immediately sync local members state
      setMembers((prev) => {
        const alreadyInState = prev.some((m) => {
          const mReg = (m['Registration Number'] || m.regNo || m.registrationNumber || '').toUpperCase().trim();
          const mEmail = (m.Email || m.email || '').toLowerCase().trim();
          return (cReg && mReg === cReg) || (cEmail && mEmail === cEmail);
        });
        if (alreadyInState) return prev;
        return [
          ...prev,
          {
            Name: cName,
            'Registration Number': cReg,
            Email: cEmail,
            Phone: cPhone,
            Team: cTeam,
            Position: 'Core Member',
          },
        ];
      });
    } catch (memberErr) {
      console.error('Error auto-adding admitted candidate to VRGC database:', memberErr);
    }
  };

  const removeCandidateFromMembers = async (candidate: ReferralRecord) => {
    try {
      const cReg = (getRefVal(candidate, 'Candidate Registration Number') || getRefVal(candidate, 'candidateRegNo') || '').toUpperCase().trim();
      const cEmail = (getRefVal(candidate, 'Candidate Email') || getRefVal(candidate, 'candidateEmail') || '').toLowerCase().trim();

      if (cEmail) {
        await deleteDoc(doc(db, 'members', cEmail)).catch(() => {});
      }
      if (cReg) {
        await deleteDoc(doc(db, 'members', cReg)).catch(() => {});
        await deleteDoc(doc(db, 'members', cReg.toLowerCase())).catch(() => {});
      }

      if (cEmail) {
        const qEmail = query(collection(db, 'members'), where('email', '==', cEmail));
        const snapEmail = await getDocs(qEmail);
        snapEmail.forEach((d) => deleteDoc(d.ref).catch(() => {}));
      }
      if (cReg) {
        const qReg = query(collection(db, 'members'), where('registrationNumber', '==', cReg));
        const snapReg = await getDocs(qReg);
        snapReg.forEach((d) => deleteDoc(d.ref).catch(() => {}));
      }

      // Immediately remove from local members state
      setMembers((prev) =>
        prev.filter((m) => {
          const mReg = (m['Registration Number'] || m.regNo || m.registrationNumber || '').toUpperCase().trim();
          const mEmail = (m.Email || m.email || '').toLowerCase().trim();
          const matchReg = cReg && mReg === cReg;
          const matchEmail = cEmail && mEmail === cEmail;
          return !matchReg && !matchEmail;
        })
      );
    } catch (memberErr) {
      console.error('Error removing candidate from VRGC members database:', memberErr);
    }
  };

  const executeStatusUpdate = async (docId?: string, candidateRegNo?: string, newStatus?: string) => {
    if (!candidateRegNo || !newStatus) return;
    setIsUpdatingStatus(candidateRegNo);
    try {
      const candidate = referrals.find(
        (r) => r.id === docId || (getRefVal(r, 'Candidate Registration Number') || getRefVal(r, 'candidateRegNo')) === candidateRegNo
      );
      const prevStatus = (candidate ? (getRefVal(candidate, 'Status') || getRefVal(candidate, 'status') || '') : '').toLowerCase();
      const wasInterviewed = prevStatus.includes('interview') || candidate?.interviewed || candidate?.hadInterview;

      if (docId) {
        const docRef = doc(db, 'referrals', docId);
        const updatePayload: Record<string, any> = { status: newStatus };
        if (wasInterviewed) {
          updatePayload.interviewed = true;
        }
        await updateDoc(docRef, updatePayload);
      }

      // If admitted, auto-add to members collection as Core Member; if rejected, remove from members collection
      if (newStatus === 'Admitted' && candidate) {
        await addAdmittedCandidateToMembers(candidate);
      } else if (newStatus === 'Rejected' && candidate) {
        await removeCandidateFromMembers(candidate);
      }

      setSyncToastMessage(
        newStatus === 'Admitted'
          ? `Candidate ADMITTED & enrolled into VRGC Database as Core Member! 🎉`
          : newStatus === 'Rejected'
          ? `Candidate marked REJECTED and updated in roster.`
          : `Candidate dossier status updated to ${newStatus.toUpperCase()}`
      );
      setTimeout(() => setSyncToastMessage(null), 4000);
    } catch (err) {
      console.error('Error updating status in Firestore:', err);
    } finally {
      setIsUpdatingStatus(null);
      setPendingStatusChange(null);
    }
  };

  const handleApplyBulkStatus = async (targetStatus: string) => {
    if (selectedReferralIds.size === 0) return;
    setBulkUpdating(true);
    try {
      const activeList = getActiveAdminReferrals();
      const targetRefs = activeList.filter((r, idx) => selectedReferralIds.has(getRefKey(r, idx)));

      for (const ref of targetRefs) {
        const prevStatus = (getRefVal(ref, 'Status') || getRefVal(ref, 'status') || '').toLowerCase();
        const wasInterviewed = prevStatus.includes('interview') || ref?.interviewed || ref?.hadInterview;

        if (ref.id) {
          const docRef = doc(db, 'referrals', ref.id);
          const updatePayload: Record<string, any> = { status: targetStatus };
          if (wasInterviewed) {
            updatePayload.interviewed = true;
          }
          await updateDoc(docRef, updatePayload);
        }
        if (targetStatus === 'Admitted') {
          await addAdmittedCandidateToMembers(ref);
        } else if (targetStatus === 'Rejected') {
          await removeCandidateFromMembers(ref);
        }
      }

      setSyncToastMessage(
        targetStatus === 'Admitted'
          ? `Bulk enrolled ${targetRefs.length} candidate(s) into VRGC Database as Core Members! 🎉`
          : `Bulk updated ${targetRefs.length} candidate(s) to ${targetStatus.toUpperCase()}!`
      );
      setTimeout(() => setSyncToastMessage(null), 4000);
      setSelectedReferralIds(new Set());
    } catch (err: any) {
      console.error('Error in bulk status update:', err);
      alert('Failed to update candidate statuses: ' + err.message);
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleToggleSelectAll = () => {
    const activeList = getActiveAdminReferrals();
    const allKeys = activeList.map((r, idx) => getRefKey(r, idx));
    const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedReferralIds.has(k));

    if (allSelected) {
      setSelectedReferralIds(new Set());
    } else {
      setSelectedReferralIds(new Set(allKeys));
    }
  };

  const handleToggleSelectOne = (key: string) => {
    setSelectedReferralIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const openEditCandidateModal = (cand: ReferralRecord) => {
    setEditingCandidate(cand);
    setEditFormData({
      candidateName: getRefVal(cand, 'Candidate Name') || getRefVal(cand, 'candidateName') || '',
      candidateRegNo: (getRefVal(cand, 'Candidate Registration Number') || getRefVal(cand, 'candidateRegNo') || '').toUpperCase(),
      candidateEmail: (getRefVal(cand, 'Candidate Email') || getRefVal(cand, 'candidateEmail') || '').toLowerCase(),
      candidatePhone: getRefVal(cand, 'Candidate Phone') || getRefVal(cand, 'candidatePhone') || '',
      targetTeam: formatTeamName(getRefVal(cand, 'Target Team') || getRefVal(cand, 'targetTeam') || 'Technical'),
      status: getRefVal(cand, 'Status') || getRefVal(cand, 'status') || 'Pending',
    });
  };

  const handleSaveEditCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCandidate) return;

    setIsSavingEdit(true);
    try {
      const docId = editingCandidate.id;
      const cleanName = editFormData.candidateName.trim();
      const cleanReg = editFormData.candidateRegNo.trim().toUpperCase();

      // Check duplicate registration number against other candidates
      const dupCheck = checkDuplicateRegistration(cleanReg, docId);
      if (dupCheck.isDuplicate) {
        alert(dupCheck.message || 'Registration number already exists.');
        setIsSavingEdit(false);
        return;
      }

      const cleanEmail = editFormData.candidateEmail.trim().toLowerCase();
      const cleanPhone = editFormData.candidatePhone.trim();
      const cleanTeam = editFormData.targetTeam;
      const cleanStatus = editFormData.status;

      const updatedFields: Record<string, any> = {};

      // Overwrite ONLY the existing field key; if both exist, retain standard camelCase and delete duplicate Title Case field
      const setSingleField = (camelKey: string, titleKey: string, value: any) => {
        const hasCamel = camelKey in editingCandidate;
        const hasTitle = titleKey in editingCandidate;

        if (hasCamel && hasTitle) {
          updatedFields[camelKey] = value;
          updatedFields[titleKey] = deleteField();
        } else if (hasTitle) {
          updatedFields[titleKey] = value;
        } else {
          updatedFields[camelKey] = value;
        }
      };

      setSingleField('candidateName', 'Candidate Name', cleanName);
      setSingleField('candidateRegNo', 'Candidate Registration Number', cleanReg);
      setSingleField('candidateEmail', 'Candidate Email', cleanEmail);
      setSingleField('candidatePhone', 'Candidate Phone', cleanPhone);
      setSingleField('targetTeam', 'Target Team', cleanTeam);
      setSingleField('status', 'Status', cleanStatus);

      if (docId) {
        const docRef = doc(db, 'referrals', docId);
        await updateDoc(docRef, updatedFields);
      }

      // If status changed to Admitted, enroll candidate into members collection; if Rejected, remove
      if (cleanStatus === 'Admitted') {
        const memDocId = (cleanEmail || cleanReg || `admitted-${Date.now()}`).toLowerCase();
        await setDoc(
          doc(db, 'members', memDocId),
          {
            name: cleanName,
            registrationNumber: cleanReg,
            email: cleanEmail,
            phone: cleanPhone,
            team: cleanTeam,
            position: 'Core Member',
            admittedFrom: 'referrals',
            admittedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } else if (cleanStatus === 'Rejected') {
        await removeCandidateFromMembers({
          ...editingCandidate,
          candidateEmail: cleanEmail,
          candidateRegNo: cleanReg,
        } as ReferralRecord);
      }

      // Update local state without duplicate keys
      setReferrals(prev =>
        prev.map(r => {
          if (r.id === docId || (getRefVal(r, 'Candidate Registration Number') || getRefVal(r, 'candidateRegNo')) === cleanReg) {
            const updated = { ...r };

            if ('Candidate Name' in updated && 'candidateName' in updated) {
              delete updated['Candidate Name'];
              updated.candidateName = cleanName;
            } else if ('Candidate Name' in updated) {
              updated['Candidate Name'] = cleanName;
            } else {
              updated.candidateName = cleanName;
            }

            if ('Candidate Registration Number' in updated && 'candidateRegNo' in updated) {
              delete updated['Candidate Registration Number'];
              updated.candidateRegNo = cleanReg;
            } else if ('Candidate Registration Number' in updated) {
              updated['Candidate Registration Number'] = cleanReg;
            } else {
              updated.candidateRegNo = cleanReg;
            }

            if ('Candidate Email' in updated && 'candidateEmail' in updated) {
              delete updated['Candidate Email'];
              updated.candidateEmail = cleanEmail;
            } else if ('Candidate Email' in updated) {
              updated['Candidate Email'] = cleanEmail;
            } else {
              updated.candidateEmail = cleanEmail;
            }

            if ('Candidate Phone' in updated && 'candidatePhone' in updated) {
              delete updated['Candidate Phone'];
              updated.candidatePhone = cleanPhone;
            } else if ('Candidate Phone' in updated) {
              updated['Candidate Phone'] = cleanPhone;
            } else {
              updated.candidatePhone = cleanPhone;
            }

            if ('Target Team' in updated && 'targetTeam' in updated) {
              delete updated['Target Team'];
              updated.targetTeam = cleanTeam;
            } else if ('Target Team' in updated) {
              updated['Target Team'] = cleanTeam;
            } else {
              updated.targetTeam = cleanTeam;
            }

            if ('Status' in updated && 'status' in updated) {
              delete updated['Status'];
              updated.status = cleanStatus;
            } else if ('Status' in updated) {
              updated['Status'] = cleanStatus;
            } else {
              updated.status = cleanStatus;
            }

            return updated;
          }
          return r;
        })
      );

      if (inspectingCandidate && (inspectingCandidate.id === docId || (getRefVal(inspectingCandidate, 'Candidate Registration Number') || getRefVal(inspectingCandidate, 'candidateRegNo')) === cleanReg)) {
        setInspectingCandidate(prev => {
          if (!prev) return null;
          const updated = { ...prev };

          if ('Candidate Name' in updated && 'candidateName' in updated) {
            delete updated['Candidate Name'];
            updated.candidateName = cleanName;
          } else if ('Candidate Name' in updated) {
            updated['Candidate Name'] = cleanName;
          } else {
            updated.candidateName = cleanName;
          }

          if ('Candidate Registration Number' in updated && 'candidateRegNo' in updated) {
            delete updated['Candidate Registration Number'];
            updated.candidateRegNo = cleanReg;
          } else if ('Candidate Registration Number' in updated) {
            updated['Candidate Registration Number'] = cleanReg;
          } else {
            updated.candidateRegNo = cleanReg;
          }

          if ('Candidate Email' in updated && 'candidateEmail' in updated) {
            delete updated['Candidate Email'];
            updated.candidateEmail = cleanEmail;
          } else if ('Candidate Email' in updated) {
            updated['Candidate Email'] = cleanEmail;
          } else {
            updated.candidateEmail = cleanEmail;
          }

          if ('Candidate Phone' in updated && 'candidatePhone' in updated) {
            delete updated['Candidate Phone'];
            updated.candidatePhone = cleanPhone;
          } else if ('Candidate Phone' in updated) {
            updated['Candidate Phone'] = cleanPhone;
          } else {
            updated.candidatePhone = cleanPhone;
          }

          if ('Target Team' in updated && 'targetTeam' in updated) {
            delete updated['Target Team'];
            updated.targetTeam = cleanTeam;
          } else if ('Target Team' in updated) {
            updated['Target Team'] = cleanTeam;
          } else {
            updated.targetTeam = cleanTeam;
          }

          if ('Status' in updated && 'status' in updated) {
            delete updated['Status'];
            updated.status = cleanStatus;
          } else if ('Status' in updated) {
            updated['Status'] = cleanStatus;
          } else {
            updated.status = cleanStatus;
          }

          return updated;
        });
      }

      setSyncToastMessage(`Candidate "${cleanName}" details updated in database! ✨`);
      setTimeout(() => setSyncToastMessage(null), 4000);
      setEditingCandidate(null);
    } catch (err: any) {
      console.error('Error saving candidate edit:', err);
      alert('Failed to update candidate record in database: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const executeBulkDeleteReferrals = async () => {
    if (!pendingBulkDelete || pendingBulkDelete.length === 0) return;
    setBulkUpdating(true);
    try {
      const deletedIds = new Set<string>();
      const deletedRegs = new Set<string>();

      for (const ref of pendingBulkDelete) {
        if (ref.id) {
          const docRef = doc(db, 'referrals', ref.id);
          await deleteDoc(docRef);
          deletedIds.add(ref.id);
        }
        const reg = (getRefVal(ref, 'Candidate Registration Number') || getRefVal(ref, 'candidateRegNo') || '').toUpperCase().trim();
        const email = (getRefVal(ref, 'Candidate Email') || getRefVal(ref, 'candidateEmail') || '').toLowerCase().trim();
        if (reg) deletedRegs.add(reg);

        const memDocId = (email || reg).toLowerCase();
        if (memDocId) {
          try {
            await deleteDoc(doc(db, 'members', memDocId));
          } catch {
            // ignore if not present in members
          }
        }
      }

      setReferrals(prev => prev.filter(r => {
        const rId = r.id;
        const rReg = (getRefVal(r, 'Candidate Registration Number') || getRefVal(r, 'candidateRegNo') || '').toUpperCase().trim();
        if (rId && deletedIds.has(rId)) return false;
        if (rReg && deletedRegs.has(rReg)) return false;
        return true;
      }));

      setSelectedReferralIds(new Set());
      setSyncToastMessage(`Successfully deleted ${pendingBulkDelete.length} candidate dossier(s) permanently from database.`);
      setTimeout(() => setSyncToastMessage(null), 4000);
      setPendingBulkDelete(null);
    } catch (err: any) {
      console.error('Error in bulk delete:', err);
      alert('Failed to delete selected referrals from database: ' + (err?.message || 'Unknown error'));
    } finally {
      setBulkUpdating(false);
    }
  };

  const executeDeleteReferral = async (docId?: string, candidateRegNo?: string) => {
    if (!candidateRegNo && !docId) return;
    setIsDeletingReferral(candidateRegNo || docId || 'deleting');
    try {
      if (docId) {
        const docRef = doc(db, 'referrals', docId);
        await deleteDoc(docRef);
      }
      if (candidateRegNo) {
        try {
          await deleteDoc(doc(db, 'members', candidateRegNo.toLowerCase()));
        } catch {
          // ignore if not in members
        }
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

  // Strict Recruiter XP Formula per candidate referral:
  // +10 XP for submission (pending / in process)
  // +50 XP when invited to interview / interview taken
  // +100 XP when admitted
  // Rejection rules:
  // - If rejected before moving to interview: RETAINS 10 XP (for submission)
  // - If rejected after interviewing: RETAINS 50 XP (for interview completion)
  const calculateCandidateXP = (rawStatus?: string, record?: ReferralRecord): number => {
    const s = (rawStatus || 'pending').toLowerCase().trim();
    if (s === 'admitted' || s.includes('admit')) {
      return 100;
    }
    if (s.includes('interview')) {
      return 50;
    }
    if (s === 'rejected' || s.includes('reject')) {
      const isInterviewed = record?.interviewed || record?.hadInterview || (record && (getRefVal(record, 'interviewed') === 'true' || getRefVal(record, 'interviewed') === true));
      return isInterviewed ? 50 : 10;
    }
    // Submission / Pending / In Process
    return 10;
  };

  // Ranking Rewards Tiers:
  // 1 - Mythic Prime (Rank 1)
  // Next 5 - Apex Titan (Ranks 2–6)
  // Next 10 - Cyber Elite (Ranks 7–16)
  // Remaining - Challenger (Ranks 17+)
  const getRecruiterTier = (rankNum: number) => {
    if (rankNum === 1) {
      return {
        name: 'Mythic Prime',
        tierRange: 'Rank 1',
        badge: 'MYTHIC',
        color: 'text-amber-300 border-amber-500/40 bg-amber-950/40 font-black shadow-[0_0_12px_rgba(245,158,11,0.25)]',
        accentColor: '#f59e0b',
        title: 'Mythic Prime (Rank 1)',
        description: 'Supreme Recruiter honor, exclusive VIP club placement & recognition'
      };
    }
    if (rankNum >= 2 && rankNum <= 6) {
      return {
        name: 'Apex Titan',
        tierRange: 'Ranks 2–6 (Next 5)',
        badge: 'APEX',
        color: 'text-rose-400 border-rose-500/40 bg-rose-950/40 font-bold shadow-[0_0_12px_rgba(244,63,94,0.25)]',
        accentColor: '#f43f5e',
        title: 'Apex Titan (Next 5)',
        description: 'Fast-track executive intake review & priority placement honors'
      };
    }
    if (rankNum >= 7 && rankNum <= 16) {
      return {
        name: 'Cyber Elite',
        tierRange: 'Ranks 7–16 (Next 10)',
        badge: 'CYBER',
        color: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40 font-bold shadow-[0_0_12px_rgba(6,182,212,0.2)]',
        accentColor: '#06b6d4',
        title: 'Cyber Elite (Next 10)',
        description: 'Elite recruiter distinction badge & specialized division priority'
      };
    }
    return {
      name: 'Challenger',
      tierRange: 'Ranks 17+ (Remaining)',
      badge: 'CHALLENGER',
      color: 'text-slate-300 border-slate-700/60 bg-slate-900/40 font-medium',
      accentColor: '#94a3b8',
      title: 'Challenger (Remaining)',
      description: 'Active club recruitment operative climbing the leaderboards'
    };
  };

  const getLeaderboardData = () => {
    const referrerStats: Record<string, any> = {};

    referrals.forEach(ref => {
      let reg = (getRefVal(ref, 'Referrer Registration Number') || getRefVal(ref, 'referrerRegNo') || '').toString().toUpperCase().trim();
      const name = getRefVal(ref, 'Referrer Name') || getRefVal(ref, 'referrerName') || "VRGC Recruiter";
      const rawStatus = (getRefVal(ref, 'Status') || getRefVal(ref, 'status') || "Pending").toString();
      const statusLower = rawStatus.toLowerCase().trim();
      const email = (
        getRefVal(ref, 'Referrer Email') ||
        getRefVal(ref, 'referrerEmail') ||
        getRefVal(ref, 'referrer_email') ||
        ref.referrerEmail ||
        ref['Referrer Email'] ||
        ref.user_email ||
        getRefVal(ref, 'user_email') ||
        ref.userEmail ||
        getRefVal(ref, 'userEmail') ||
        ''
      ).toString().toLowerCase().trim();

      // If registration number is missing or UNKNOWN, extract from vitbhopal email if available
      if (!reg || reg === 'UNKNOWN') {
        const extracted = extractRegNo(email);
        if (extracted !== 'UNKNOWN') {
          reg = extracted;
        }
      }

      const emailPrefix = email ? email.split('@')[0] : '';
      const nameLower = name.toLowerCase().trim();

      const photoURL = getRefVal(ref, 'Referrer Photo URL') ||
        getRefVal(ref, 'referrerPhotoURL') ||
        (reg && reg !== 'UNKNOWN' ? userPhotoMap[reg] : null) ||
        (email ? userPhotoMap[email] : null) ||
        (emailPrefix ? userPhotoMap[emailPrefix] : null) ||
        (nameLower ? userPhotoMap[nameLower] : null) ||
        null;

      const xpAwarded = calculateCandidateXP(rawStatus, ref);

      // Canonical grouping key: Primary is the unique registration number if valid; fallback to email, name, or doc ID
      const groupKey = (reg && reg !== 'UNKNOWN')
        ? `reg_${reg}`
        : (email ? `email_${email}` : (nameLower ? `name_${nameLower}` : `ref_${ref.id || 'unknown'}`));

      if (!referrerStats[groupKey]) {
        referrerStats[groupKey] = {
          name,
          email,
          registrationNumber: (reg && reg !== 'UNKNOWN') ? reg : (emailPrefix.toUpperCase() || 'UNKNOWN'),
          totalReferrals: 0,
          totalXP: 0,
          admittedCount: 0,
          interviewCount: 0,
          pendingCount: 0,
          rejectedCount: 0,
          photoURL
        };
      } else {
        if (!referrerStats[groupKey].photoURL && photoURL) {
          referrerStats[groupKey].photoURL = photoURL;
        }
        if ((!referrerStats[groupKey].registrationNumber || referrerStats[groupKey].registrationNumber === 'UNKNOWN') && reg && reg !== 'UNKNOWN') {
          referrerStats[groupKey].registrationNumber = reg;
        }
        if (!referrerStats[groupKey].email && email) {
          referrerStats[groupKey].email = email;
        }
        // If current name is generic or contains reg no, prefer cleaner human name
        if (name && name !== 'VRGC Recruiter' && name !== 'VRGC Member') {
          if (referrerStats[groupKey].name === 'VRGC Recruiter' || referrerStats[groupKey].name === 'VRGC Member') {
            referrerStats[groupKey].name = name;
          } else if (reg && reg !== 'UNKNOWN' && referrerStats[groupKey].name.includes(reg) && !name.includes(reg)) {
            referrerStats[groupKey].name = name;
          }
        }
      }

      referrerStats[groupKey].totalReferrals += 1;
      referrerStats[groupKey].totalXP += xpAwarded;

      if (statusLower === 'admitted' || statusLower.includes('admit')) {
        referrerStats[groupKey].admittedCount += 1;
      } else if (statusLower.includes('interview')) {
        referrerStats[groupKey].interviewCount += 1;
      } else if (statusLower === 'rejected' || statusLower.includes('reject')) {
        referrerStats[groupKey].rejectedCount += 1;
      } else {
        referrerStats[groupKey].pendingCount += 1;
      }
    });

    // Primary sort: Total Recruiter XP, Secondary sort: Admitted Count, Tertiary: Total Submissions
    const sorted = Object.values(referrerStats).sort((a, b) => {
      if (b.totalXP !== a.totalXP) return b.totalXP - a.totalXP;
      if (b.admittedCount !== a.admittedCount) return b.admittedCount - a.admittedCount;
      return b.totalReferrals - a.totalReferrals;
    });

    return sorted.map((rank, index) => {
      const rankNumber = index + 1;
      const uniqueId = (rank.registrationNumber && rank.registrationNumber !== 'UNKNOWN')
        ? rank.registrationNumber
        : (rank.email || `${rank.name.replace(/\s+/g, '_')}_${rankNumber}`);

      return {
        ...rank,
        id: uniqueId,
        rankNumber,
        tier: getRecruiterTier(rankNumber)
      };
    });
  };

  const getPodiumTierTheme = (tierName: string = 'Apex Titan') => {
    switch (tierName) {
      case 'Mythic Prime':
        return {
          cardBg: 'bg-gradient-to-b from-[#261504] via-[#140a02] to-[#080401]',
          cardBorder: 'border-2 border-amber-400/80',
          cardShadow: 'shadow-[0_0_30px_rgba(245,158,11,0.3)]',
          badgePill: 'bg-amber-500/20 text-amber-300 border-amber-400/50',
          avatarBorder: 'border-2 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.5)] bg-amber-950/50',
          avatarFallback: 'bg-gradient-to-tr from-amber-600 to-yellow-400 border-2 border-amber-300 text-black',
          rankBadge: 'bg-amber-400 border border-amber-200 text-black',
          divider: 'border-amber-500/30',
          xpColor: 'text-amber-300'
        };
      case 'Cyber Elite':
        return {
          cardBg: 'bg-gradient-to-b from-[#061726] via-[#030e1a] to-[#01060c]',
          cardBorder: 'border border-cyan-500/40',
          cardShadow: 'shadow-[0_0_20px_rgba(6,182,212,0.15)]',
          badgePill: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40',
          avatarBorder: 'border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.3)] bg-cyan-950/50',
          avatarFallback: 'bg-gradient-to-tr from-cyan-800 to-teal-500 border border-cyan-400/60 text-white',
          rankBadge: 'bg-cyan-600 border border-cyan-300 text-white',
          divider: 'border-cyan-500/20',
          xpColor: 'text-cyan-300'
        };
      case 'Challenger':
        return {
          cardBg: 'bg-gradient-to-b from-[#13111c] via-[#09080e] to-[#040407]',
          cardBorder: 'border border-slate-700/50',
          cardShadow: 'shadow-[0_0_15px_rgba(148,163,184,0.1)]',
          badgePill: 'bg-slate-800 text-slate-300 border border-slate-700',
          avatarBorder: 'border border-slate-600 shadow-[0_0_10px_rgba(148,163,184,0.2)] bg-slate-900/50',
          avatarFallback: 'bg-gradient-to-tr from-slate-700 to-slate-500 border border-slate-600 text-white',
          rankBadge: 'bg-slate-700 border border-slate-400 text-white',
          divider: 'border-slate-700/20',
          xpColor: 'text-slate-300'
        };
      case 'Apex Titan':
      default:
        return {
          cardBg: 'bg-gradient-to-b from-[#28050e] via-[#140207] to-[#070104]',
          cardBorder: 'border border-rose-500/40',
          cardShadow: 'shadow-[0_0_20px_rgba(244,63,94,0.2)]',
          badgePill: 'bg-rose-500/20 text-rose-300 border border-rose-400/40',
          avatarBorder: 'border border-rose-400/60 shadow-[0_0_15px_rgba(244,63,94,0.3)] bg-rose-950/50',
          avatarFallback: 'bg-gradient-to-tr from-red-700 to-rose-500 border border-rose-400/60 text-white',
          rankBadge: 'bg-gradient-to-tr from-red-600 to-rose-500 border border-rose-300 text-white',
          divider: 'border-rose-500/20',
          xpColor: 'text-rose-400'
        };
    }
  };

  const renderRankBadge = (rankNum: number) => {
    if (rankNum === 1) {
      return (
        <div className="w-8 h-8 sm:w-9 sm:h-9 bg-gradient-to-tr from-amber-500 to-yellow-400 rounded-xl border border-yellow-200 flex flex-col items-center justify-center text-black shadow-[0_0_15px_rgba(245,158,11,0.5)] shrink-0">
          <span className="material-symbols-outlined text-xs sm:text-sm leading-none">sports_esports</span>
          <span className="text-[7px] sm:text-[8px] font-black font-mono leading-none">#1</span>
        </div>
      );
    }
    if (rankNum >= 2 && rankNum <= 6) {
      return (
        <div className="w-8 h-8 sm:w-9 sm:h-9 bg-gradient-to-tr from-red-600 to-rose-500 rounded-xl border border-rose-300 flex flex-col items-center justify-center text-white shadow-[0_0_15px_rgba(244,63,94,0.4)] shrink-0">
          <span className="material-symbols-outlined text-xs sm:text-sm leading-none">bolt</span>
          <span className="text-[7px] sm:text-[8px] font-black font-mono leading-none">#{rankNum}</span>
        </div>
      );
    }
    if (rankNum >= 7 && rankNum <= 16) {
      return (
        <div className="w-8 h-8 sm:w-9 sm:h-9 bg-gradient-to-tr from-cyan-700 to-teal-400 rounded-xl border border-cyan-300 flex flex-col items-center justify-center text-black shadow-[0_0_15px_rgba(6,182,212,0.4)] shrink-0">
          <span className="material-symbols-outlined text-xs sm:text-sm leading-none">videogame_asset</span>
          <span className="text-[7px] sm:text-[8px] font-black font-mono leading-none">#{rankNum}</span>
        </div>
      );
    }
    return (
      <div className="w-8 h-8 sm:w-9 sm:h-9 bg-[#110624] border border-purple-500/30 rounded-xl flex flex-col items-center justify-center text-purple-300 font-bold shadow-sm shrink-0">
        <span className="text-[10px] sm:text-xs font-black font-mono leading-none">#{rankNum}</span>
      </div>
    );
  };

  const getMyReferrals = () => {
    const myEmail = (currentUser?.email || '').toLowerCase().trim();
    if (!myEmail) return [];

    const myRegNo = (userRegNo && userRegNo !== 'UNKNOWN')
      ? userRegNo.toUpperCase().trim()
      : extractRegNo(myEmail);

    // Fetch individual referrals done by that member (by email, or by member registration number if email was omitted in older docs)
    return referrals.filter(ref => {
      const email = (
        getRefVal(ref, 'Referrer Email') ||
        getRefVal(ref, 'referrerEmail') ||
        getRefVal(ref, 'referrer_email') ||
        ref.referrerEmail ||
        ref['Referrer Email'] ||
        ref.user_email ||
        getRefVal(ref, 'user_email') ||
        ref.userEmail ||
        getRefVal(ref, 'userEmail') ||
        ''
      ).toString().toLowerCase().trim();

      // 1. Direct email match
      if (email && email === myEmail) return true;

      // 2. Extracted registration number from email matches member's registration number
      if (email && myRegNo && myRegNo !== 'UNKNOWN') {
        const refExtracted = extractRegNo(email);
        if (refExtracted !== 'UNKNOWN' && refExtracted === myRegNo) return true;
      }

      // 3. Registration number from document matches member's registration number
      const reg = (
        getRefVal(ref, 'Referrer Registration Number') ||
        getRefVal(ref, 'referrerRegNo') ||
        ref.referrerRegNo ||
        ''
      ).toString().toUpperCase().trim();

      if (myRegNo && myRegNo !== 'UNKNOWN' && reg && reg === myRegNo) {
        return true;
      }

      return false;
    });
  };

  const formatTeamName = (teamText?: string) => {
    if (!teamText) return 'Technical';
    // Normalize esports naming: remove any space before parenthesis, e.g. "Esports (PC)" -> "Esports(PC)"
    return teamText.replace(/Esports\s+\(/gi, 'Esports(');
  };

  const getActiveAdminReferrals = () => {
    return referrals.filter(ref => {
      // 1. Search Query Filter
      if (adminSearchQuery.trim()) {
        const query = adminSearchQuery.toLowerCase();
        const normQuery = query.replace(/\s+/g, '');
        const cName = (getRefVal(ref, 'Candidate Name') || getRefVal(ref, 'candidateName')).toLowerCase();
        const cReg = (getRefVal(ref, 'Candidate Registration Number') || getRefVal(ref, 'candidateRegNo')).toLowerCase();
        const cEmail = (getRefVal(ref, 'Candidate Email') || getRefVal(ref, 'candidateEmail')).toLowerCase();
        const cPhone = (getRefVal(ref, 'Candidate Phone') || getRefVal(ref, 'candidatePhone')).toLowerCase();
        const rName = (getRefVal(ref, 'Referrer Name') || getRefVal(ref, 'referrerName')).toLowerCase();
        const cTeam = (getRefVal(ref, 'Target Team') || getRefVal(ref, 'targetTeam') || '').toLowerCase();
        const normCTeam = cTeam.replace(/\s+/g, '');

        if (
          !cName.includes(query) &&
          !cReg.includes(query) &&
          !cEmail.includes(query) &&
          !cPhone.includes(query) &&
          !rName.includes(query) &&
          !cTeam.includes(query) &&
          !normCTeam.includes(normQuery)
        ) {
          return false;
        }
      }

      // 2. Team Filter
      if (adminTeamFilter !== 'All') {
        const rawTeam = getRefVal(ref, 'Target Team') || getRefVal(ref, 'targetTeam') || 'Technical';
        const normTeam = rawTeam.toLowerCase().replace(/\s+/g, '');
        const normFilter = adminTeamFilter.toLowerCase().replace(/\s+/g, '');
        if (normTeam !== normFilter && rawTeam.toLowerCase() !== adminTeamFilter.toLowerCase()) {
          return false;
        }
      }

      // 3. Status Filter
      const status = (getRefVal(ref, 'Status') || getRefVal(ref, 'status') || 'Pending').toLowerCase();
      if (adminStatusFilter === 'All') {
        // By default on main referral list, exclude Admitted and Rejected candidates (show only active/in-process/pending)
        if (status === 'admitted' || status === 'rejected') return false;
      } else {
        if (adminStatusFilter === 'Pending' && status !== 'pending') return false;
        if (adminStatusFilter === 'In Process' && !status.includes('process')) return false;
        if (adminStatusFilter === 'Invited to Interview' && (status.includes('taken') || !status.includes('interview'))) return false;
        if (adminStatusFilter === 'Interview Taken' && !status.includes('taken')) return false;
        if (adminStatusFilter === 'Admitted' && status !== 'admitted') return false;
        if (adminStatusFilter === 'Rejected' && status !== 'rejected') return false;
      }

      return true;
    });
  };

  // ── CSV Export for Candidates ──
  const handleExportCandidatesCSV = (mode: 'filtered' | 'all' | 'selected' = 'filtered') => {
    let targetList: ReferralRecord[] = [];

    if (mode === 'selected') {
      const activeList = getActiveAdminReferrals();
      targetList = activeList.filter((r, idx) => selectedReferralIds.has(getRefKey(r, idx)));
      if (targetList.length === 0) {
        targetList = referrals.filter((r, idx) => selectedReferralIds.has(getRefKey(r, idx)));
      }
    } else if (mode === 'all') {
      targetList = referrals;
    } else {
      // mode === 'filtered' (default)
      targetList = getActiveAdminReferrals();
    }

    if (!targetList || targetList.length === 0) {
      setSyncToastMessage('No candidate records found to export for this filter.');
      setTimeout(() => setSyncToastMessage(null), 4000);
      return;
    }

    const headers = [
      'Candidate Name',
      'Registration Number',
      'Candidate Email',
      'Candidate Phone',
      'Target Division',
      'Dossier Status',
      'Recruiter Name',
      'Recruiter Reg No',
      'Recruiter Email',
      'Submission Date',
    ];

    const rows = targetList.map((ref) => {
      const cName = getRefVal(ref, 'Candidate Name') || getRefVal(ref, 'candidateName') || '';
      const cReg = getRefVal(ref, 'Candidate Registration Number') || getRefVal(ref, 'candidateRegNo') || '';
      const cEmail = getRefVal(ref, 'Candidate Email') || getRefVal(ref, 'candidateEmail') || '';
      const cPhone = getRefVal(ref, 'Candidate Phone') || getRefVal(ref, 'candidatePhone') || '';
      const targetT = formatTeamName(getRefVal(ref, 'Target Team') || getRefVal(ref, 'targetTeam') || 'Technical');
      const status = getRefVal(ref, 'Status') || getRefVal(ref, 'status') || 'Pending';
      const rName = getRefVal(ref, 'Referrer Name') || getRefVal(ref, 'referrerName') || '';
      const rReg = getRefVal(ref, 'Referrer Registration Number') || getRefVal(ref, 'referrerRegNo') || '';
      const rEmail = getRefVal(ref, 'Referrer Email') || getRefVal(ref, 'referrerEmail') || '';
      const rawTs = getRefVal(ref, 'Timestamp') || getRefVal(ref, 'timestamp') || '';
      let formattedDate = '';
      if (rawTs) {
        try {
          const d = new Date(rawTs);
          formattedDate = isNaN(d.getTime()) ? String(rawTs) : d.toLocaleString('en-IN');
        } catch {
          formattedDate = String(rawTs);
        }
      }

      return [
        `"${String(cName).replace(/"/g, '""')}"`,
        `"${String(cReg).replace(/"/g, '""')}"`,
        `"${String(cEmail).replace(/"/g, '""')}"`,
        `"${String(cPhone).replace(/"/g, '""')}"`,
        `"${String(targetT).replace(/"/g, '""')}"`,
        `"${String(status).replace(/"/g, '""')}"`,
        `"${String(rName).replace(/"/g, '""')}"`,
        `"${String(rReg).replace(/"/g, '""')}"`,
        `"${String(rEmail).replace(/"/g, '""')}"`,
        `"${String(formattedDate).replace(/"/g, '""')}"`,
      ];
    });

    // Prepend UTF-8 BOM (\uFEFF) for guaranteed correct character encoding in Excel
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    const dateStr = new Date().toISOString().slice(0, 10);
    let filename = '';
    if (mode === 'filtered') {
      const cleanTeam = adminTeamFilter === 'All' ? 'AllDivisions' : adminTeamFilter.replace(/[^a-zA-Z0-9]/g, '');
      const cleanStatus = adminStatusFilter === 'All' ? 'ActivePipeline' : adminStatusFilter.replace(/[^a-zA-Z0-9]/g, '');
      filename = `VRGC_Referrals_${cleanTeam}_${cleanStatus}_${dateStr}.csv`;
    } else if (mode === 'selected') {
      filename = `VRGC_Referrals_Selected_${targetList.length}_${dateStr}.csv`;
    } else {
      filename = `VRGC_Referrals_All_Candidates_${dateStr}.csv`;
    }

    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setSyncToastMessage(`Exported ${targetList.length} candidate dossier(s) to CSV! 📊`);
    setTimeout(() => setSyncToastMessage(null), 4000);
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
    if (s.includes('taken')) {
      return (
        <span className="flex items-center gap-1.5 text-[10px] bg-indigo-500/20 border border-indigo-400 text-indigo-300 font-extrabold px-3 py-1 rounded-full uppercase tracking-wider font-code-sm shadow-[0_0_12px_rgba(99,102,241,0.35)]">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
          INTERVIEW TAKEN
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

  const getCandidateStatusBadge = (statusText?: string, record?: ReferralRecord) => {
    const s = (statusText || 'Pending').toLowerCase().trim();
    const xp = calculateCandidateXP(s, record);
    if (s === 'admitted' || s.includes('admit')) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] bg-emerald-500/20 border border-emerald-400 text-emerald-300 font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider font-mono shadow-[0_0_12px_rgba(168,85,247,0.35)]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>ADMITTED</span>
          <span className="text-emerald-200 font-black ml-0.5">(+100 XP)</span>
        </span>
      );
    }
    if (s.includes('taken')) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] bg-indigo-500/20 border border-indigo-400 text-indigo-300 font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider font-mono shadow-[0_0_12px_rgba(99,102,241,0.35)]">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
          <span>INTERVIEW TAKEN</span>
          <span className="text-indigo-200 font-black ml-0.5">(+50 XP)</span>
        </span>
      );
    }
    if (s.includes('interview')) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] bg-purple-500/20 border border-purple-400 text-purple-300 font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider font-mono shadow-[0_0_12px_rgba(168,85,247,0.35)]">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
          <span>INTERVIEW</span>
          <span className="text-purple-200 font-black ml-0.5">(+50 XP)</span>
        </span>
      );
    }
    if (s === 'rejected' || s.includes('reject')) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] bg-rose-500/20 border border-rose-500 text-rose-400 font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider font-mono shadow-[0_0_12px_rgba(239,68,68,0.35)]">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
          <span>REJECTED</span>
          <span className="text-rose-300 font-black ml-0.5">(+{xp} XP)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] bg-cyan-500/20 border border-cyan-400 text-cyan-300 font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider font-mono shadow-[0_0_12px_rgba(6,182,212,0.35)]">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
        <span>{s.includes('process') ? 'IN PROCESS' : 'PENDING'}</span>
        <span className="text-cyan-200 font-black ml-0.5">(+10 XP)</span>
      </span>
    );
  };

  const getSelectStatusColor = (statusText?: string) => {
    const s = (statusText || 'Pending').toLowerCase();
    if (s === 'admitted') return 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 font-bold';
    if (s.includes('taken')) return 'bg-indigo-950/80 border-indigo-500/60 text-indigo-300 font-bold';
    if (s.includes('interview')) return 'bg-purple-950/80 border-purple-500/60 text-purple-300 font-bold';
    if (s.includes('process')) return 'bg-amber-950/80 border-amber-500/60 text-amber-300 font-bold';
    if (s === 'rejected') return 'bg-red-950/80 border-red-500/60 text-red-400 font-bold';
    return 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300 font-bold';
  };

  const leaderboard = getLeaderboardData();
  const userEmail = (currentUser?.email || '').toLowerCase().trim();
  const userRegNo = (referrerInfo ? referrerInfo['Registration Number'] : extractRegNo(currentUser?.email)).toUpperCase().trim();
  const userRankIndex = leaderboard.findIndex(
    r => (userEmail && r.email && r.email.toLowerCase() === userEmail) ||
         (userRegNo && userRegNo !== 'UNKNOWN' && r.registrationNumber.toUpperCase() === userRegNo)
  );
  const userStats = userRankIndex !== -1 ? leaderboard[userRankIndex] : null;
  const userRank = userRankIndex !== -1 ? `#${userRankIndex + 1}` : 'UNRANKED';
  const userTier = userRankIndex !== -1 ? getRecruiterTier(userRankIndex + 1) : getRecruiterTier(999);

  const myReferralsList = getMyReferrals();
  const myReferralsXP = myReferralsList.reduce((acc, ref) => {
    const s = getRefVal(ref, 'Status') || getRefVal(ref, 'status') || 'Pending';
    return acc + calculateCandidateXP(s, ref);
  }, 0);
  const userXP = userStats ? userStats.totalXP : myReferralsXP;

  if (authLoading) {
    return (
      <div className="flex-grow min-h-[calc(100dvh-132px)] md:min-h-[70vh] flex items-center justify-center relative overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-4 text-purple-400 font-label-caps text-xs stagger-in">
          <span className="material-symbols-outlined animate-spin text-[40px]">sync</span>
          <span>Loading Access Permissions...</span>
        </div>
      </div>
    );
  }

  if (!currentUser || !isAuthorized) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-132px)] md:min-h-[calc(100vh-76px)] overflow-y-auto px-4 md:px-8 py-8 flex items-center justify-center relative bg-mesh">
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
      </div>
    );
  }

  if (showThankYou) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-132px)] md:min-h-[calc(100vh-76px)] flex items-center justify-center p-4 sm:p-8 bg-mesh">
        <div className="glass-panel p-8 sm:p-12 rounded-2xl max-w-md text-center space-y-6 border border-purple-500/20 relative z-10 shadow-[0_0_50px_rgba(168,85,247,0.15)] stagger-in">
          <span className="material-symbols-outlined text-[80px] text-purple-400 animate-pulse">
            check_circle
          </span>
          <h2 className="font-display-lg text-3xl text-white font-extrabold">TRANSMITTED</h2>
          <p className="font-body-lg text-slate-300">
            Candidate referral details have been successfully transmitted to the VRGC database.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full overflow-x-hidden pt-4 sm:pt-6 pb-12 sm:pb-16 px-2.5 sm:px-6 md:px-8 relative bg-mesh">
      <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8 stagger-in">

        {/* Navigation Tabs - Optimized for mobile touch scrolling & desktop flex */}
        <div className="flex items-center border-b border-purple-500/25 gap-1.5 sm:gap-2 relative z-10 overflow-x-auto no-scrollbar scroll-smooth pb-1 -mx-2 px-2 sm:mx-0 sm:px-0">
          <button
            onClick={() => setActiveTab('form')}
            className={`flex items-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 px-3 sm:px-5 font-label-caps text-[11px] sm:text-xs tracking-wider border-b-2 font-bold transition-all duration-300 rounded-t-xl shrink-0 cursor-pointer ${activeTab === 'form'
              ? 'border-purple-500 text-purple-300 bg-purple-500/10 shadow-[0_-5px_15px_rgba(168,85,247,0.15)]'
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">send</span>
            <span>SUBMIT REFERRAL</span>
          </button>

          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`flex items-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 px-3 sm:px-5 font-label-caps text-[11px] sm:text-xs tracking-wider border-b-2 font-bold transition-all duration-300 rounded-t-xl shrink-0 cursor-pointer ${activeTab === 'leaderboard'
              ? 'border-purple-500 text-purple-300 bg-purple-500/10 shadow-[0_-5px_15px_rgba(168,85,247,0.15)]'
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">trophy</span>
            <span>LEADERBOARD</span>
          </button>

          <button
            onClick={() => setActiveTab('my_ops')}
            className={`flex items-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 px-3 sm:px-5 font-label-caps text-[11px] sm:text-xs tracking-wider border-b-2 font-bold transition-all duration-300 rounded-t-xl shrink-0 cursor-pointer ${activeTab === 'my_ops'
              ? 'border-purple-500 text-purple-300 bg-purple-500/10 shadow-[0_-5px_15px_rgba(168,85,247,0.15)]'
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
              }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">assignment</span>
            <span>MY REGISTRY</span>
          </button>

          {isMasterAdmin && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`flex items-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 px-3 sm:px-5 font-label-caps text-[11px] sm:text-xs tracking-wider border-b-2 font-bold transition-all duration-300 rounded-t-xl shrink-0 cursor-pointer ${activeTab === 'admin'
                ? 'border-rose-500 text-rose-300 bg-rose-500/10 shadow-[0_-5px_15px_rgba(244,63,94,0.15)]'
                : 'border-transparent text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/5'
                }`}
            >
              <span className="material-symbols-outlined text-sm sm:text-base">admin_panel_settings</span>
              <span>ADMIN DESK</span>
            </button>
          )}

          <button
            onClick={onRedirect}
            className="ml-auto shrink-0 bg-purple-500/10 border border-purple-500/30 hover:border-purple-400 hover:bg-purple-500/20 text-purple-300 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-xs font-extrabold font-label-caps transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(168,85,247,0.15)] cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            <span>DASHBOARD</span>
          </button>
        </div>

        {/* Referrer Profile Badge */}
        <div className="glass-panel p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-purple-500/30 relative overflow-hidden bg-gradient-to-r from-[#130728] via-[#0e041f] to-[#080213] flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6 shadow-[0_0_40px_rgba(168,85,247,0.15)]">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500" />
          <div className="flex flex-col sm:flex-row items-center gap-3.5 sm:gap-4 relative z-10 w-full md:w-auto text-center sm:text-left">
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
              <div className="font-code-sm text-[11px] sm:text-xs text-slate-300 tracking-wider flex flex-wrap justify-center sm:justify-start gap-1.5 sm:gap-2 items-center">
                <span className="bg-purple-500/15 border border-purple-500/30 px-2.5 py-0.5 rounded-full">ID: <strong className="text-purple-300 font-bold">{referrerInfo ? referrerInfo['Registration Number'] : extractRegNo(currentUser.email)}</strong></span>
                <span className="bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-full">RANK: <strong className="text-amber-300 font-bold">{userRank}</strong></span>
                <span className={`border px-2.5 py-0.5 rounded-full ${userTier.color}`}>TIER: <strong>{userTier.name}</strong></span>
                <span className="bg-purple-500/15 border border-purple-500/30 px-2.5 py-0.5 rounded-full">SCORE: <strong className="text-purple-300 font-bold">{userXP} XP</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-purple-500/15">
            <div className="text-center px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl bg-black/40 border border-purple-500/20">
              <div className="text-[8.5px] sm:text-[9px] text-slate-400 font-label-caps tracking-widest font-bold">DAILY SUBMISSIONS</div>
              <div className="font-code-sm text-base sm:text-lg font-bold text-white mt-0.5">
                <span className={dailyCount >= 5 ? 'text-rose-400' : 'text-emerald-400'}>{dailyCount}</span> / 5
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center justify-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 font-label-caps font-bold border border-rose-500/30 hover:border-rose-500/60 px-4 sm:px-5 py-2.5 sm:py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 transition-all duration-300 cursor-pointer"
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
              <section className="bg-gradient-to-b from-[#130728] via-[#0b0318] to-[#06010d] border border-purple-500/30 p-6 md:p-10 rounded-3xl relative space-y-8 shadow-[0_0_40px_rgba(168,85,247,0.12)]">

                {/* Benefits Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                  {/* Referrer Benefits */}
                  <div className="p-5 rounded-2xl border border-purple-500/25 bg-gradient-to-br from-purple-950/40 to-transparent space-y-3 relative overflow-hidden">
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
                  <div className="p-5 rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/30 to-transparent space-y-3 relative overflow-hidden">
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
                  <span className="material-symbols-outlined text-purple-400 text-sm">calendar_month</span>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
                          className={`w-full bg-[#0a0315] border rounded-xl pl-10 pr-4 py-3 text-white font-mono text-sm uppercase placeholder-slate-500 focus:outline-none transition-all ${errors.registrationNumber
                              ? 'border-rose-500/80 focus:border-rose-400 focus:ring-1 focus:ring-rose-400/50 bg-rose-950/20'
                              : 'border-purple-500/30 focus:border-purple-400 focus:ring-1 focus:ring-purple-400/50'
                            }`}
                          placeholder="25XXX10000"
                          type="text"
                        />
                      </div>
                      {errors.registrationNumber && (
                        <p className="text-rose-400 text-xs font-semibold mt-1.5 flex items-start gap-1.5 bg-rose-950/40 border border-rose-500/30 p-2.5 rounded-xl">
                          <span className="material-symbols-outlined text-sm shrink-0 text-rose-400 mt-0.5">error</span>
                          <span>{errors.registrationNumber}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300 group-hover:scale-105 transition-transform">
                          <span className="material-symbols-outlined text-base">
                            {targetTeam === 'Technical' ? 'terminal' :
                              targetTeam === 'Design' ? 'palette' :
                                targetTeam === 'Education' ? 'school' :
                                  (targetTeam === 'Esports(PC)' || targetTeam === 'Esports (PC)') ? 'sports_esports' :
                                    (targetTeam === 'Esports(Mobile)' || targetTeam === 'Esports (Mobile)') ? 'smartphone' :
                                      targetTeam === 'PR' ? 'campaign' : 'share'}
                          </span>
                        </div>
                        <div>
                          <div className="text-white text-sm font-bold tracking-wide flex items-center gap-2">
                            <span>{formatTeamName(targetTeam)}</span>
                            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              Active Domain
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {targetTeam === 'Technical' && 'Full stack development, bot systems, infrastructure'}
                            {targetTeam === 'Design' && 'UI/UX interface design, 3D assets, visual branding'}
                            {targetTeam === 'Education' && 'Workshops, training sessions, VR/AR curriculum'}
                            {(targetTeam === 'Esports(PC)' || targetTeam === 'Esports (PC)') && 'Competitive tournaments & PC scrim coordination'}
                            {(targetTeam === 'Esports(Mobile)' || targetTeam === 'Esports (Mobile)') && 'Mobile gaming rosters & battle-royale operations'}
                            {targetTeam === 'PR' && 'Public relations, institutional outreach, sponsorship'}
                            {targetTeam === 'Social Media' && 'Content strategy, media management, broadcast'}
                          </div>
                        </div>
                      </div>
                      <span className={`material-symbols-outlined text-purple-400 transition-transform duration-200 ${isTeamDropdownOpen ? 'rotate-180' : ''}`}>
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
                            { name: 'Esports(PC)', icon: 'sports_esports', desc: 'Competitive tournaments & PC scrim coordination', badge: 'PC League' },
                            { name: 'Esports(Mobile)', icon: 'smartphone', desc: 'Mobile gaming rosters & battle-royale operations', badge: 'Mobile' },
                            { name: 'PR', icon: 'campaign', desc: 'Public relations, institutional outreach, sponsorship', badge: 'Outreach' },
                            { name: 'Social Media', icon: 'share', desc: 'Content strategy, media management, broadcast', badge: 'Media' },
                          ].map((teamItem) => {
                            const isSelected = targetTeam === teamItem.name || (teamItem.name === 'Esports(PC)' && targetTeam === 'Esports (PC)') || (teamItem.name === 'Esports(Mobile)' && targetTeam === 'Esports (Mobile)');
                            return (
                              <button
                                key={teamItem.name}
                                type="button"
                                onClick={() => {
                                  setTargetTeam(teamItem.name);
                                  setIsTeamDropdownOpen(false);
                                }}
                                className={`w-full p-2.5 rounded-xl flex items-center justify-between text-left transition-all duration-150 cursor-pointer ${isSelected
                                  ? 'bg-purple-600/30 border border-purple-400/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                                  : 'hover:bg-white/5 border border-transparent'
                                  }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSelected
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
                    <SpecularButton
                      type="submit"
                      size="md"
                      radius={16}
                      tint="#9333ea"
                      tintOpacity={0.85}
                      lineColor="#c084fc"
                      baseColor="#581c87"
                      intensity={1.3}
                      disabled={isSubmitting || dailyCount >= 5}
                      className="w-full sm:w-auto font-black py-3 px-10 text-xs font-label-caps flex items-center justify-center gap-2 uppercase tracking-widest text-white shadow-[0_0_30px_rgba(168,85,247,0.4)]"
                    >
                      <span>{isSubmitting ? 'TRANSMITTING REFERRAL...' : 'TRANSMIT REFERRAL'}</span>
                      <span className="material-symbols-outlined text-base">send</span>
                    </SpecularButton>
                  </div>
                </form>
              </section>
            </div>
          </div>
        )}

        {/* TAB 2: LEADERBOARD */}
        {activeTab === 'leaderboard' && (
          <div className="space-y-5 sm:space-y-8 text-left">
            {/* Header / Stats Summary */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 mb-2">
                  <span className="material-symbols-outlined text-xs text-amber-400">emoji_events</span>
                  VRGC RECRUITER HONORS
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight">
                  Recruiter Leaderboard &amp; Tier Standings
                </h3>
              </div>

              {/* Total Active Recruiters Counter */}
              <div className="px-4 py-2.5 rounded-2xl bg-purple-500/10 border border-purple-500/25 flex items-center gap-3 shrink-0 w-fit">
                <span className="material-symbols-outlined text-purple-400 text-2xl">groups</span>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">ACTIVE RECRUITERS</div>
                  <div className="text-base sm:text-lg font-black text-white font-mono">{leaderboard.length}</div>
                </div>
              </div>
            </div>

            {/* Top 3 Podium Highlight — 3-Card Side-by-Side Row on Mobile & Desktop */}
            {leaderboard.length >= 3 && (() => {
              const rank2Theme = getPodiumTierTheme(leaderboard[1].tier?.name);
              const rank3Theme = getPodiumTierTheme(leaderboard[2].tier?.name);

              return (
                <div className="grid grid-cols-3 gap-1.5 sm:gap-4 pt-3 sm:pt-4">
                  {/* #2 Rank (Left) - Dynamically matches League Color */}
                  <div className={`p-2 sm:p-5 rounded-2xl sm:rounded-3xl ${rank2Theme.cardBg} ${rank2Theme.cardBorder} relative flex flex-col items-center text-center ${rank2Theme.cardShadow} transition-all`}>
                    <div className="relative mb-1.5 sm:mb-3">
                      {leaderboard[1].photoURL ? (
                        <img
                          src={leaderboard[1].photoURL}
                          alt={leaderboard[1].name}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(leaderboard[1].name)}&background=1e1035&color=c084fc&bold=true`;
                          }}
                          className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl object-cover ${rank2Theme.avatarBorder}`}
                        />
                      ) : (
                        <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl ${rank2Theme.avatarFallback} flex items-center justify-center font-black text-sm sm:text-xl shadow-md`}>
                          {leaderboard[1].name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className={`absolute -bottom-1 -right-1 sm:-bottom-1.5 sm:-right-1.5 w-4 h-4 sm:w-6 sm:h-6 rounded-full ${rank2Theme.rankBadge} flex items-center justify-center text-[9px] sm:text-xs font-black shadow-md`}>
                        2
                      </div>
                    </div>
                    <span className={`text-[7px] sm:text-[9px] font-black uppercase tracking-wider px-1.5 sm:px-2.5 py-0.5 rounded-full ${rank2Theme.badgePill} mb-1 sm:mb-2 truncate max-w-full`}>
                      #2 {leaderboard[1].tier?.name?.toUpperCase() || 'APEX TITAN'}
                    </span>
                    <h4 className="text-xs sm:text-base font-extrabold text-white truncate max-w-full">{leaderboard[1].name.trim().split(' ')[0]}</h4>
                    <span className="text-[8.5px] sm:text-xs text-slate-400 font-mono truncate max-w-full">{leaderboard[1].registrationNumber}</span>
                    <div className={`mt-2.5 sm:mt-4 pt-2 sm:pt-3 border-t ${rank2Theme.divider} w-full flex flex-col items-center gap-0.5 sm:gap-1`}>
                      <span className="text-[9px] sm:text-xs text-slate-400">Refs: <strong className="text-white">{leaderboard[1].totalReferrals}</strong></span>
                      <span className={`font-black ${rank2Theme.xpColor} font-mono text-xs sm:text-base`}>{leaderboard[1].totalXP} XP</span>
                    </div>
                  </div>

                  {/* #1 Rank - Mythic Prime (Center, Elevated with Crown) */}
                  <div className="p-2.5 sm:p-6 rounded-2xl sm:rounded-3xl bg-gradient-to-b from-[#261504] via-[#140a02] to-[#080401] border-2 border-amber-400/80 relative flex flex-col items-center text-center shadow-[0_0_30px_rgba(245,158,11,0.3)] -translate-y-1.5 sm:-translate-y-2 transition-all">
                    {/* Crown Floating Tab */}
                    <div className="absolute -top-2.5 sm:-top-3 px-2 sm:px-3 py-0.5 rounded-full bg-amber-400 text-black font-black text-[9px] sm:text-[10px] uppercase tracking-widest shadow-[0_0_15px_rgba(245,158,11,0.6)] flex items-center justify-center">
                      👑
                    </div>
                    <div className="relative mt-1 sm:mt-2 mb-1.5 sm:mb-3">
                      {leaderboard[0].photoURL ? (
                        <img
                          src={leaderboard[0].photoURL}
                          alt={leaderboard[0].name}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(leaderboard[0].name)}&background=261504&color=f59e0b&bold=true`;
                          }}
                          className="w-11 h-11 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl object-cover border-2 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.5)] bg-amber-950/50"
                        />
                      ) : (
                        <div className="w-11 h-11 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-gradient-to-tr from-amber-600 to-yellow-400 border-2 border-amber-300 flex items-center justify-center text-black font-black text-sm sm:text-2xl shadow-[0_0_20px_rgba(245,158,11,0.5)]">
                          {leaderboard[0].name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="absolute -bottom-1 -right-1 sm:-bottom-1.5 sm:-right-1.5 w-4 h-4 sm:w-6 sm:h-6 rounded-full bg-amber-400 border border-amber-200 flex items-center justify-center text-black text-[9px] sm:text-xs font-black shadow-md">
                        1
                      </div>
                    </div>
                    <span className="text-[7px] sm:text-[9px] font-black uppercase tracking-wider px-1.5 sm:px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/50 mb-1 sm:mb-2 truncate max-w-full">
                      #1 MYTHIC PRIME
                    </span>
                    <h4 className="text-xs sm:text-base font-black text-white truncate max-w-full">{leaderboard[0].name.trim().split(' ')[0]}</h4>
                    <span className="text-[8.5px] sm:text-xs text-amber-200/80 font-mono font-bold truncate max-w-full">{leaderboard[0].registrationNumber}</span>
                    <div className="mt-2.5 sm:mt-4 pt-2 sm:pt-3 border-t border-amber-500/30 w-full flex flex-col items-center gap-0.5 sm:gap-1">
                      <span className="text-[9px] sm:text-xs text-slate-300">
                        {leaderboard[0].admittedCount > 0 ? (
                          <>Adm: <strong className="text-emerald-400 font-bold">{leaderboard[0].admittedCount}</strong></>
                        ) : (
                          <>Refs: <strong className="text-white font-bold">{leaderboard[0].totalReferrals}</strong></>
                        )}
                      </span>
                      <span className="font-black text-amber-300 font-mono text-xs sm:text-base">{leaderboard[0].totalXP} XP</span>
                    </div>
                  </div>

                  {/* #3 Rank (Right) - Dynamically matches League Color (Apex Titan) */}
                  <div className={`p-2 sm:p-5 rounded-2xl sm:rounded-3xl ${rank3Theme.cardBg} ${rank3Theme.cardBorder} relative flex flex-col items-center text-center ${rank3Theme.cardShadow} transition-all`}>
                    <div className="relative mb-1.5 sm:mb-3">
                      {leaderboard[2].photoURL ? (
                        <img
                          src={leaderboard[2].photoURL}
                          alt={leaderboard[2].name}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(leaderboard[2].name)}&background=1e1035&color=c084fc&bold=true`;
                          }}
                          className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl object-cover ${rank3Theme.avatarBorder}`}
                        />
                      ) : (
                        <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl ${rank3Theme.avatarFallback} flex items-center justify-center font-black text-sm sm:text-xl shadow-md`}>
                          {leaderboard[2].name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className={`absolute -bottom-1 -right-1 sm:-bottom-1.5 sm:-right-1.5 w-4 h-4 sm:w-6 sm:h-6 rounded-full ${rank3Theme.rankBadge} flex items-center justify-center text-[9px] sm:text-xs font-black shadow-md`}>
                        3
                      </div>
                    </div>
                    <span className={`text-[7px] sm:text-[9px] font-black uppercase tracking-wider px-1.5 sm:px-2.5 py-0.5 rounded-full ${rank3Theme.badgePill} mb-1 sm:mb-2 truncate max-w-full`}>
                      #3 {leaderboard[2].tier?.name?.toUpperCase() || 'APEX TITAN'}
                    </span>
                    <h4 className="text-xs sm:text-base font-extrabold text-white truncate max-w-full">{leaderboard[2].name.trim().split(' ')[0]}</h4>
                    <span className="text-[8.5px] sm:text-xs text-slate-400 font-mono truncate max-w-full">{leaderboard[2].registrationNumber}</span>
                    <div className={`mt-2.5 sm:mt-4 pt-2 sm:pt-3 border-t ${rank3Theme.divider} w-full flex flex-col items-center gap-0.5 sm:gap-1`}>
                      <span className="text-[9px] sm:text-xs text-slate-400">Refs: <strong className="text-white">{leaderboard[2].totalReferrals}</strong></span>
                      <span className={`font-black ${rank3Theme.xpColor} font-mono text-xs sm:text-base`}>{leaderboard[2].totalXP} XP</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Standings Table — Directly Under Podium (Matches Mobile Screenshot) */}
            <div className="bg-[#0b0318]/90 border border-purple-500/30 rounded-3xl p-3.5 sm:p-6 shadow-[0_0_35px_rgba(168,85,247,0.1)] space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between px-1 sm:px-2">
                <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
                  ALL OPERATOR STANDINGS
                </span>
                <span className="text-[10px] sm:text-xs text-slate-400 font-mono">
                  Ranked by Total Recruiter XP
                </span>
              </div>

              <div className="space-y-2">
                {leaderboard.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">No referral records on leaderboard yet.</div>
                ) : (
                  leaderboard.map((lb, index) => {
                    const tier = lb.tier || getRecruiterTier(lb.rankNumber);
                    const isCurrentUser = Boolean(
                      (userRegNo && userRegNo !== 'UNKNOWN' && lb.registrationNumber.toUpperCase() === userRegNo.toUpperCase()) ||
                      (userEmail && lb.email && lb.email.toLowerCase() === userEmail)
                    );

                    return (
                      <div
                        key={lb.id || (lb.registrationNumber && lb.registrationNumber !== 'UNKNOWN' ? lb.registrationNumber : `lb-${lb.rankNumber || index}`)}
                        className={`p-2.5 sm:p-3.5 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-2 sm:gap-3 ${isCurrentUser
                          ? 'bg-purple-600/20 border-purple-400/80 shadow-[0_0_20px_rgba(168,85,247,0.25)]'
                          : 'bg-black/50 border-purple-500/15 hover:border-purple-500/40 hover:bg-white/5'
                          }`}
                      >
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          {/* Rank badge + Avatar */}
                          <div className="shrink-0 flex items-center gap-1.5 sm:gap-2">
                            {renderRankBadge(lb.rankNumber)}
                            {lb.photoURL ? (
                              <img
                                src={lb.photoURL}
                                alt={lb.name}
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(lb.name)}&background=1e1035&color=c084fc&bold=true`;
                                }}
                                className="w-8 h-8 sm:w-10 sm:h-10 rounded-full sm:rounded-xl object-cover border border-purple-500/30 bg-purple-950/40"
                              />
                            ) : (
                              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full sm:rounded-xl bg-purple-900/60 border border-purple-500/30 flex items-center justify-center text-white font-bold text-xs sm:text-sm">
                                {lb.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>

                          {/* Operator Details */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 sm:gap-2">
                              <h4 className="text-white font-bold text-xs sm:text-sm truncate">{lb.name}</h4>
                              {isCurrentUser && (
                                <span className="text-[8px] sm:text-[9px] font-black uppercase px-1.5 py-0.2 rounded-full bg-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.5)]">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 sm:gap-1.5 text-[9px] sm:text-xs text-slate-400 font-mono mt-0.5 truncate">
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

                        {/* Right side: Stacked XP & Tier Name */}
                        <div className="text-right shrink-0">
                          <div className={`text-xs sm:text-base font-black font-mono tracking-tight ${lb.rankNumber === 1
                            ? 'text-amber-300'
                            : lb.rankNumber <= 6
                              ? 'text-rose-400'
                              : lb.rankNumber <= 16
                                ? 'text-cyan-300'
                                : 'text-slate-300'
                            }`}>
                            {lb.totalXP} XP
                          </div>
                          <div className={`text-[8px] sm:text-[9.5px] uppercase font-bold tracking-wider ${lb.rankNumber === 1
                            ? 'text-amber-400'
                            : lb.rankNumber <= 6
                              ? 'text-rose-400'
                              : lb.rankNumber <= 16
                                ? 'text-cyan-400'
                                : 'text-slate-500'
                            }`}>
                            {tier.name}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RANKING REWARDS & TIER DIVISIONS SHOWCASE */}
            <div className="space-y-4 pt-2">
              <div className="bg-[#0b0318]/90 border border-purple-500/30 rounded-3xl p-4 sm:p-6 shadow-[0_0_35px_rgba(168,85,247,0.1)] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-400 text-lg">military_tech</span>
                    <h4 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
                      RANKING REWARDS &amp; TIER DIVISIONS
                    </h4>
                  </div>
                  <span className="text-[10px] sm:text-xs text-slate-400 font-mono">Standings Tier Allocations</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Tier 1: Mythic Prime */}
                  <div className="p-4 rounded-2xl bg-gradient-to-b from-[#2a1705] to-[#120802] border border-amber-500/40 space-y-2 shadow-[0_0_20px_rgba(245,158,11,0.15)] relative overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40">
                        RANK 1
                      </span>
                      <span className="material-symbols-outlined text-amber-400 text-lg">sports_esports</span>
                    </div>
                    <div className="text-sm font-black text-white">Mythic Prime</div>
                    <p className="text-[11px] text-amber-200/70 leading-relaxed">
                      Crown Recruiter standing, supreme club honors &amp; VIP consideration.
                    </p>
                  </div>

                  {/* Tier 2: Apex Titan */}
                  <div className="p-4 rounded-2xl bg-gradient-to-b from-[#28050e] to-[#120207] border border-rose-500/40 space-y-2 shadow-[0_0_20px_rgba(244,63,94,0.2)] relative overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/40">
                        NEXT 5 (RANKS 2–6)
                      </span>
                      <span className="material-symbols-outlined text-rose-400 text-lg">bolt</span>
                    </div>
                    <div className="text-sm font-black text-white">Apex Titan</div>
                    <p className="text-[11px] text-rose-200/70 leading-relaxed">
                      Executive core intake fast-track &amp; Apex Recruiter distinction.
                    </p>
                  </div>

                  {/* Tier 3: Cyber Elite */}
                  <div className="p-4 rounded-2xl bg-gradient-to-b from-[#081a28] to-[#040e16] border border-cyan-500/40 space-y-2 shadow-[0_0_20px_rgba(6,182,212,0.15)] relative overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/40">
                        NEXT 10 (RANKS 7–16)
                      </span>
                      <span className="material-symbols-outlined text-cyan-400 text-lg">videogame_asset</span>
                    </div>
                    <div className="text-sm font-black text-white">Cyber Elite</div>
                    <p className="text-[11px] text-cyan-200/70 leading-relaxed">
                      Cyber Division distinction badge &amp; exclusive outreach pipeline perks.
                    </p>
                  </div>

                  {/* Tier 4: Challenger */}
                  <div className="p-4 rounded-2xl bg-gradient-to-b from-[#13111c] to-[#07060a] border border-slate-700/50 space-y-2 shadow-[0_0_15px_rgba(148,163,184,0.08)] relative overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        RANKS 17+ (REMAINING)
                      </span>
                      <span className="material-symbols-outlined text-slate-400 text-lg">military_tech</span>
                    </div>
                    <div className="text-sm font-black text-white">Challenger</div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Active recruitment operative climbing towards Cyber Elite ranks.
                    </p>
                  </div>
                </div>
              </div>

              {/* XP Point System Transparency Banner */}
              <div className="p-4 sm:p-5 rounded-2xl bg-[#0e041d]/80 border border-purple-500/25 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-purple-400 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-xs">tune</span>
                    STRICT RECRUITER XP FORMULA
                  </div>
                  <div className="text-xs text-slate-300">
                    Calculated strictly per referred candidate (provisional points replace as stages advance):
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full md:w-auto">
                  <div className="px-3 py-2 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-center">
                    <div className="text-cyan-300 font-mono font-black text-sm">+10 XP</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Submission</div>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-purple-950/40 border border-purple-500/30 text-center">
                    <div className="text-purple-300 font-mono font-black text-sm">+50 XP</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Interview</div>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-center">
                    <div className="text-emerald-300 font-mono font-black text-sm">+100 XP</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Admitted</div>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-rose-950/40 border border-rose-500/30 text-center">
                    <div className="text-rose-300 font-mono font-black text-sm">10 / 50 XP</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Rejected (Retained)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: MY REGISTRY */}
        {activeTab === 'my_ops' && (
          <div className="glass-panel p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-purple-500/30 space-y-6 text-left">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-purple-500/20 pb-4">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-white uppercase tracking-tight">MY SUBMITTED CANDIDATES</h3>
                <p className="text-xs text-slate-400 mt-0.5">Track candidate evaluation stages and individual recruiter XP contribution</p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto px-3.5 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30">
                <span className="text-xs text-slate-400 font-mono">My Total Score:</span>
                <span className="text-sm font-black text-purple-300 font-mono">{userXP} XP</span>
              </div>
            </div>

            <div className="space-y-3">
              {myReferralsList.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  You haven't submitted any candidate referrals yet.
                </div>
              ) : (
                myReferralsList.map((ref, idx) => {
                  const status = getRefVal(ref, 'Status') || getRefVal(ref, 'status') || 'Pending';
                  const candidateXP = calculateCandidateXP(status, ref);
                  const cReg = getRefVal(ref, 'Candidate Registration Number') || getRefVal(ref, 'candidateRegNo') || 'UNKNOWN';
                  const cName = getRefVal(ref, 'Candidate Name') || getRefVal(ref, 'candidateName') || 'Candidate';
                  const targetT = getRefVal(ref, 'Target Team') || getRefVal(ref, 'targetTeam') || 'Technical';

                  return (
                    <div key={ref.id || `${cReg}-${idx}`} className="p-3.5 sm:p-4 bg-black/50 border border-white/5 hover:border-purple-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-white font-bold text-sm">{cName}</h4>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/25">
                            {formatTeamName(targetT)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-1 flex-wrap">
                          <span>{cReg}</span>
                          <span>•</span>
                          <span className="text-slate-300">
                            XP Earned: <strong className={candidateXP > 0 ? "text-purple-300 font-bold" : "text-rose-400 font-bold"}>
                              {candidateXP > 0 ? `+${candidateXP}` : 0} XP
                            </strong>
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 self-end sm:self-auto shrink-0">
                        {getCandidateStatusBadge(status, ref)}
                        {canDeleteReferrals && (
                          <button
                            type="button"
                            title="Delete Referral (Admin)"
                            onClick={() => {
                              setPendingDeleteReferral({ docId: ref.id, regNo: cReg, candidateName: cName });
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-base">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
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
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto">
                {[
                  { label: 'Pending', count: referrals.filter(r => (getRefVal(r, 'Status') || getRefVal(r, 'status') || 'Pending').toLowerCase() === 'pending').length, color: 'text-cyan-300 bg-cyan-950/40 border-cyan-500/30' },
                  { label: 'Process', count: referrals.filter(r => (getRefVal(r, 'Status') || getRefVal(r, 'status') || '').toLowerCase().includes('process')).length, color: 'text-amber-300 bg-amber-950/40 border-amber-500/30' },
                  {
                    label: 'Interview', count: referrals.filter(r => {
                      const st = (getRefVal(r, 'Status') || getRefVal(r, 'status') || '').toLowerCase();
                      return st.includes('interview') && !st.includes('taken');
                    }).length, color: 'text-purple-300 bg-purple-950/40 border-purple-500/30'
                  },
                  { label: 'Taken', count: referrals.filter(r => (getRefVal(r, 'Status') || getRefVal(r, 'status') || '').toLowerCase().includes('taken')).length, color: 'text-indigo-300 bg-indigo-950/40 border-indigo-500/30' },
                  { label: 'Admitted', count: referrals.filter(r => (getRefVal(r, 'Status') || getRefVal(r, 'status') || '').toLowerCase() === 'admitted').length, color: 'text-emerald-300 bg-emerald-950/40 border-emerald-500/30' },
                ].map((s, idx) => (
                  <span key={idx} className={`px-2.5 py-1 rounded-xl text-[11px] font-mono font-bold border ${s.color} flex items-center justify-between sm:justify-start gap-1.5`}>
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
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs p-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                )}
              </div>

              {/* Filters Flex Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:items-center gap-2.5 shrink-0 w-full md:w-auto">
                {/* Team Filter */}
                <div className="flex items-center gap-2 justify-between sm:justify-start min-w-0">
                  <span className="text-[10px] font-black text-purple-300 uppercase tracking-wider shrink-0">TEAM:</span>
                  <select
                    value={adminTeamFilter}
                    onChange={(e) => setAdminTeamFilter(e.target.value)}
                    className="bg-[#05010a] border border-purple-500/30 text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-purple-400 cursor-pointer font-bold tracking-wide flex-1 md:flex-none min-w-0 max-w-full truncate"
                  >
                    <option value="All">All Divisions</option>
                    <option value="Technical">Technical</option>
                    <option value="Design">Design</option>
                    <option value="Education">Education</option>
                    <option value="Esports(PC)">Esports(PC)</option>
                    <option value="Esports(Mobile)">Esports(Mobile)</option>
                    <option value="PR">PR</option>
                    <option value="Social Media">Social Media</option>
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-2 justify-between sm:justify-start min-w-0">
                  <span className="text-[10px] font-black text-purple-300 uppercase tracking-wider shrink-0">STATUS:</span>
                  <select
                    value={adminStatusFilter}
                    onChange={(e) => setAdminStatusFilter(e.target.value)}
                    className="bg-[#05010a] border border-purple-500/30 text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-purple-400 cursor-pointer font-bold tracking-wide flex-1 md:flex-none min-w-0 max-w-full truncate"
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

                {/* CSV Export Options (Direct Filtered Download + Dropdown) */}
                <div className="relative ref-export-dropdown-container flex items-center justify-end sm:justify-start">
                  <div className="inline-flex items-center rounded-xl bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-600 hover:to-indigo-600 border border-purple-400/40 text-white shadow-[0_0_15px_rgba(147,51,234,0.3)] transition-all">
                    {/* Direct 1-Click Button: Download CSV for Currently Chosen Filter */}
                    <button
                      type="button"
                      onClick={() => handleExportCandidatesCSV('filtered')}
                      className="px-3 py-2 text-xs font-bold font-mono flex items-center gap-1.5 cursor-pointer hover:bg-white/10 rounded-l-xl transition-colors whitespace-nowrap active:scale-95"
                      title={`Download CSV for chosen filter (${getActiveAdminReferrals().length} candidates)`}
                    >
                      <span className="material-symbols-outlined text-base text-purple-200">download</span>
                      <span>Export CSV</span>
                      <span className="text-[10px] bg-black/40 px-1.5 py-0.5 rounded-full border border-purple-300/30 font-bold text-purple-200">
                        {getActiveAdminReferrals().length}
                      </span>
                    </button>

                    {/* Dropdown Menu Toggle */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowExportMenu(!showExportMenu);
                      }}
                      className="px-1.5 py-2 border-l border-purple-400/30 hover:bg-white/10 rounded-r-xl transition-colors cursor-pointer flex items-center justify-center text-purple-200"
                      title="More CSV export options"
                    >
                      <span className="material-symbols-outlined text-base">
                        {showExportMenu ? 'arrow_drop_up' : 'arrow_drop_down'}
                      </span>
                    </button>
                  </div>

                  {/* Dropdown Options Popup */}
                  {showExportMenu && (
                    <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-[#120724] border border-purple-500/50 rounded-2xl p-2.5 shadow-[0_15px_40px_rgba(0,0,0,0.9)] z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 text-left space-y-1.5">
                      <div className="px-2.5 py-1.5 border-b border-purple-500/20 flex items-center justify-between">
                        <span className="text-[10px] font-mono font-bold text-purple-300 uppercase tracking-wider">
                          Download Candidates CSV
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowExportMenu(false)}
                          className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-xs">close</span>
                        </button>
                      </div>

                      {/* Option 1: Chosen Filter */}
                      <button
                        type="button"
                        onClick={() => {
                          handleExportCandidatesCSV('filtered');
                          setShowExportMenu(false);
                        }}
                        className="w-full p-2.5 rounded-xl hover:bg-purple-900/40 border border-transparent hover:border-purple-500/30 flex items-start gap-2.5 transition-all text-left group cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                          <span className="material-symbols-outlined text-base">filter_list</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white group-hover:text-purple-200">
                              Chosen Filter View
                            </span>
                            <span className="text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-md border border-purple-500/30">
                              {getActiveAdminReferrals().length}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">
                            Team: {adminTeamFilter} • Status: {adminStatusFilter}
                            {adminSearchQuery ? ` • "${adminSearchQuery}"` : ''}
                          </p>
                        </div>
                      </button>

                      {/* Option 2: All Candidates */}
                      <button
                        type="button"
                        onClick={() => {
                          handleExportCandidatesCSV('all');
                          setShowExportMenu(false);
                        }}
                        className="w-full p-2.5 rounded-xl hover:bg-purple-900/40 border border-transparent hover:border-purple-500/30 flex items-start gap-2.5 transition-all text-left group cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                          <span className="material-symbols-outlined text-base">database</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white group-hover:text-indigo-200">
                              All Candidates (Complete)
                            </span>
                            <span className="text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded-md border border-indigo-500/30">
                              {referrals.length}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Entire database archive across all divisions &amp; statuses
                          </p>
                        </div>
                      </button>

                      {/* Option 3: Selected Candidates (if any selected) */}
                      {selectedReferralIds.size > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            handleExportCandidatesCSV('selected');
                            setShowExportMenu(false);
                          }}
                          className="w-full p-2.5 rounded-xl hover:bg-emerald-950/40 border border-transparent hover:border-emerald-500/30 flex items-start gap-2.5 transition-all text-left group cursor-pointer"
                        >
                          <div className="w-8 h-8 rounded-lg bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                            <span className="material-symbols-outlined text-base">check_box</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white group-hover:text-emerald-200">
                                Selected Candidates
                              </span>
                              <span className="text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-md border border-emerald-500/30">
                                {selectedReferralIds.size}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Only candidate rows currently checked in the table
                            </p>
                          </div>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bulk Action Toolbar */}
            {selectedReferralIds.size > 0 && (
              <div className="p-3 sm:p-4 rounded-2xl bg-[#140b24] border border-purple-500 shadow-[0_0_30px_rgba(147,51,234,0.35)] flex flex-col md:flex-row md:items-center justify-between gap-3 animate-fade-in">
                <div className="flex items-center justify-between sm:justify-start gap-2.5 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-purple-700 flex items-center justify-center text-white font-black text-xs font-mono shrink-0">
                      {selectedReferralIds.size}
                    </span>
                    <div>
                      <div className="text-xs font-black text-white uppercase tracking-tight">
                        {selectedReferralIds.size} Candidate(s) Selected
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Bulk change pipeline, edit candidate info, or delete from database
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedReferralIds(new Set())}
                    className="text-[11px] text-purple-300 hover:text-white underline cursor-pointer font-bold shrink-0 ml-auto sm:ml-2"
                  >
                    Deselect All
                  </button>
                </div>

                {/* Quick Bulk Actions */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {/* If 1 candidate selected, show Edit button */}
                  {selectedReferralIds.size === 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const activeList = getActiveAdminReferrals();
                        const cand = activeList.find((r, idx) => selectedReferralIds.has(getRefKey(r, idx)));
                        if (cand) openEditCandidateModal(cand);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-purple-600/30 border border-purple-400 text-purple-200 hover:bg-purple-600 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-[0_0_12px_rgba(168,85,247,0.3)]"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                      Edit Candidate
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => handleApplyBulkStatus('In Process')}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-amber-950/80 border border-amber-500/60 text-amber-300 hover:bg-amber-900 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">timelapse</span>
                    Set In Process
                  </button>

                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => handleApplyBulkStatus('Invited to Interview')}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-purple-950/80 border border-purple-500/60 text-purple-300 hover:bg-purple-900 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">event</span>
                    Set Interview
                  </button>

                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => handleApplyBulkStatus('Interview Taken')}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-indigo-950/80 border border-indigo-500/60 text-indigo-300 hover:bg-indigo-900 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">how_to_reg</span>
                    Set Interview Taken
                  </button>

                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => handleApplyBulkStatus('Admitted')}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-black font-mono bg-emerald-700 hover:bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)] transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">verified</span>
                    Admit to Database
                  </button>

                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => handleApplyBulkStatus('Rejected')}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-rose-950/80 border border-rose-500/60 text-rose-300 hover:bg-rose-900 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">cancel</span>
                    Set Rejected
                  </button>

                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => handleApplyBulkStatus('Pending')}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-cyan-950/80 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-900 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">hourglass_empty</span>
                    Set Pending
                  </button>

                  {/* Export Selected CSV Button */}
                  <button
                    type="button"
                    onClick={() => handleExportCandidatesCSV('selected')}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono bg-purple-600/40 border border-purple-400/60 text-purple-200 hover:bg-purple-600 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-[0_0_12px_rgba(168,85,247,0.3)]"
                    title="Export selected candidates to CSV"
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    <span>Export CSV ({selectedReferralIds.size})</span>
                  </button>

                  {/* Bulk Delete Button */}
                  {canDeleteReferrals && (
                    <button
                      type="button"
                      disabled={bulkUpdating}
                      onClick={() => {
                        const activeList = getActiveAdminReferrals();
                        const targetRefs = activeList.filter((r, idx) => selectedReferralIds.has(getRefKey(r, idx)));
                        if (targetRefs.length > 0) {
                          setPendingBulkDelete(targetRefs);
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-red-600/20 border border-red-500/60 text-red-300 hover:bg-red-600 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-[0_0_15px_rgba(239,68,68,0.25)] disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">delete_sweep</span>
                      Delete Selected
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Candidate Dossiers Table & Mobile/Tablet Cards */}
            <div className="bg-[#090214]/95 border border-purple-500/30 rounded-2xl p-3 sm:p-5 shadow-[0_0_30px_rgba(0,0,0,0.6)] space-y-3 w-full min-w-0 pb-6">
              {/* Mobile/Tablet Select All Toolbar */}
              <div className="lg:hidden flex items-center justify-between p-2.5 bg-[#120724] border border-purple-500/20 rounded-xl text-xs text-slate-300 font-mono">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      getActiveAdminReferrals().length > 0 &&
                      getActiveAdminReferrals().every((r, i) => selectedReferralIds.has(getRefKey(r, i)))
                    }
                    onChange={handleToggleSelectAll}
                    className="accent-purple-600 rounded cursor-pointer w-4 h-4"
                  />
                  <span className="font-bold">Select All ({getActiveAdminReferrals().length})</span>
                </label>
                <span className="text-[10px] text-purple-400 font-bold">{selectedReferralIds.size} selected</span>
              </div>

              {/* Mobile & Tablet Card List (Zero Horizontal Scroll) */}
              <div className="lg:hidden space-y-3">
                {getActiveAdminReferrals().length > 0 ? (
                  getActiveAdminReferrals().map((ref, idx, arr) => {
                    const isMobileNearBottom = arr.length > 1 && idx === arr.length - 1;
                    const refKey = getRefKey(ref, idx);
                    const isSelected = selectedReferralIds.has(refKey);
                    const cName = getRefVal(ref, "Candidate Name") || getRefVal(ref, "candidateName") || "Candidate Profile";
                    const cReg = getRefVal(ref, "Candidate Registration Number") || getRefVal(ref, "candidateRegNo") || "UNKNOWN";
                    const refName = getRefVal(ref, "Referrer Name") || getRefVal(ref, "referrerName") || "VRGC Recruiter";
                    const refReg = getRefVal(ref, "Referrer Registration Number") || getRefVal(ref, "referrerRegNo") || "UNKNOWN";
                    const currentStatus = getRefVal(ref, "Status") || getRefVal(ref, "status") || "Pending";
                    const isUpdating = isUpdatingStatus === cReg;

                    return (
                      <div
                        key={cReg + idx}
                        onClick={() => setInspectingCandidate(ref)}
                        className={`p-3.5 rounded-2xl border transition-all duration-150 cursor-pointer space-y-2.5 w-full min-w-0 ${isSelected ? 'bg-purple-950/60 border-purple-400/80 shadow-[0_0_15px_rgba(168,85,247,0.2)]' : 'bg-[#0c0417] border-purple-500/20 hover:border-purple-500/40'
                          }`}
                      >
                        {/* Top: Checkbox, Name, Reg, Division */}
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="flex items-start gap-2.5 min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelectOne(refKey)}
                              className="accent-purple-600 rounded cursor-pointer w-4 h-4 shrink-0 mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <h4 className="font-bold text-white text-xs sm:text-sm truncate">{cName}</h4>
                              <div className="text-[11px] text-purple-400 font-mono font-bold">{cReg}</div>
                              <div className="text-[10px] text-slate-400 truncate max-w-full">{getRefVal(ref, "Candidate Email") || getRefVal(ref, "candidateEmail")}</div>
                            </div>
                          </div>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold font-mono bg-yellow-500/10 text-yellow-300 border border-yellow-500/25 shrink-0">
                            {formatTeamName(getRefVal(ref, "Target Team") || getRefVal(ref, "targetTeam"))}
                          </span>
                        </div>

                        {/* Recruiter info */}
                        <div className="text-[10.5px] font-mono text-slate-400 bg-purple-950/20 border border-purple-500/15 px-2.5 py-1 rounded-xl flex items-center justify-between gap-2 min-w-0">
                          <span className="text-slate-400 shrink-0">Recruiter:</span>
                          <span className="text-slate-200 font-bold truncate min-w-0 text-right">{refName} ({refReg})</span>
                        </div>

                        {/* Actions row: Status dropdown & actions */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-purple-500/15" onClick={(e) => e.stopPropagation()}>
                          <div className="relative min-w-0">
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => setActiveStatusDropdownId(activeStatusDropdownId === (ref.id || cReg) ? null : (ref.id || cReg))}
                              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold font-mono tracking-wide flex items-center justify-between gap-1.5 border transition-colors cursor-pointer shadow-md ${getSelectStatusColor(currentStatus)}`}
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
                                <div className={`absolute left-0 ${isMobileNearBottom ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} z-50 bg-[#0d041c] border border-purple-500/50 rounded-xl p-1.5 shadow-[0_15px_50px_rgba(0,0,0,0.95)] min-w-[190px] max-w-[calc(100vw-3rem)] w-max space-y-1 text-left animate-in fade-in duration-100`}>
                                  {[
                                    { name: 'Pending', icon: 'hourglass_empty', color: 'text-cyan-300 hover:bg-cyan-950/50' },
                                    { name: 'In Process', icon: 'timelapse', color: 'text-amber-300 hover:bg-amber-950/50' },
                                    { name: 'Invited to Interview', icon: 'event', color: 'text-purple-300 hover:bg-purple-950/50' },
                                    { name: 'Interview Taken', icon: 'how_to_reg', color: 'text-indigo-300 hover:bg-indigo-950/50' },
                                    { name: 'Admitted', icon: 'verified', color: 'text-emerald-300 hover:bg-emerald-950/50' },
                                    { name: 'Rejected', icon: 'cancel', color: 'text-rose-400 hover:bg-rose-950/50' },
                                  ].map((opt) => {
                                    const isOptionSelected = currentStatus === opt.name;
                                    return (
                                      <button
                                        key={opt.name}
                                        type="button"
                                        onClick={() => {
                                          setActiveStatusDropdownId(null);
                                          handleUpdateStatus(ref.id, cReg, cName, opt.name);
                                        }}
                                        className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center justify-between gap-3 transition-colors cursor-pointer whitespace-nowrap ${isOptionSelected
                                          ? 'bg-purple-600/35 text-white border border-purple-400/50'
                                          : `${opt.color} hover:text-white`
                                          }`}
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="material-symbols-outlined text-sm">{opt.icon}</span>
                                          <span>{opt.name}</span>
                                        </div>
                                        {isOptionSelected && (
                                          <span className="material-symbols-outlined text-xs text-purple-300">check</span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                            <button
                              type="button"
                              title="Inspect Candidate Dossier"
                              onClick={() => setInspectingCandidate(ref)}
                              className="px-2.5 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-[11px] font-bold font-mono border border-purple-500/20 flex items-center gap-1 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-xs">visibility</span>
                              <span>Inspect</span>
                            </button>

                            {canDeleteReferrals && (
                              <button
                                type="button"
                                title="Edit Candidate Details"
                                onClick={() => openEditCandidateModal(ref)}
                                className="px-2.5 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-[11px] font-bold font-mono border border-purple-500/20 flex items-center gap-1 cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-xs">edit</span>
                                <span>Edit</span>
                              </button>
                            )}

                            {canDeleteReferrals && (
                              <button
                                type="button"
                                title="Delete Referral Dossier"
                                disabled={isDeletingReferral === cReg}
                                onClick={() => setPendingDeleteReferral({ docId: ref.id, regNo: cReg, candidateName: cName })}
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
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-8 text-center text-slate-500 text-xs font-mono">
                    No candidate dossiers found.
                  </div>
                )}
              </div>

              {/* Desktop Table (hidden on mobile and tablet) */}
              <div className="hidden lg:block overflow-x-auto custom-scrollbar pb-16">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-purple-500/20 text-[10px] text-slate-400 uppercase tracking-widest font-black">
                      <th className="py-2.5 px-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={
                            getActiveAdminReferrals().length > 0 &&
                            getActiveAdminReferrals().every((r, i) => selectedReferralIds.has(getRefKey(r, i)))
                          }
                          onChange={handleToggleSelectAll}
                          className="accent-purple-600 rounded cursor-pointer w-3.5 h-3.5"
                          title="Select All / Deselect All Visible Candidates"
                        />
                      </th>
                      <th className="py-2.5 px-3 font-black text-left">CANDIDATE INFO</th>
                      <th className="py-2.5 px-3 font-black text-left">RECRUITER IDENT</th>
                      <th className="py-2.5 px-3 font-black text-left">DIVISION</th>
                      <th className="py-2.5 px-3 font-black text-right">DOSSIER STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getActiveAdminReferrals().length > 0 ? (
                      getActiveAdminReferrals().map((ref, idx, arr) => {
                        const isNearBottom = arr.length > 2 ? idx >= arr.length - 3 : idx >= 1;
                        const refKey = getRefKey(ref, idx);
                        const isSelected = selectedReferralIds.has(refKey);
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
                            className={`border-b border-white/5 cursor-pointer transition-colors duration-150 group ${isSelected ? 'bg-purple-950/60 border-l-4 border-l-purple-500' : 'hover:bg-white/5'
                              }`}
                          >
                            <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelectOne(refKey)}
                                className="accent-purple-600 rounded cursor-pointer w-3.5 h-3.5"
                              />
                            </td>
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
                                {formatTeamName(getRefVal(ref, "Target Team") || getRefVal(ref, "targetTeam"))}
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
                                      <div className={`absolute right-0 ${isNearBottom ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} z-50 bg-[#0d041c] border border-purple-500/50 rounded-xl p-1.5 shadow-[0_15px_50px_rgba(0,0,0,0.95)] min-w-[190px] w-max space-y-1 text-left animate-in fade-in duration-100`}>
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
                                              className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center justify-between gap-3 transition-colors cursor-pointer whitespace-nowrap ${isSelected
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
                                    title="Edit Candidate Details"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEditCandidateModal(ref);
                                    }}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-purple-300 hover:bg-purple-500/15 transition-all cursor-pointer"
                                  >
                                    <span className="material-symbols-outlined text-sm">edit</span>
                                  </button>
                                )}

                                {canDeleteReferrals && (
                                  <button
                                    type="button"
                                    title="Delete Referral Dossier"
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
                        <td colSpan={5} className="py-12 text-center text-slate-500 text-xs italic">
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
        {mounted && typeof document !== 'undefined' && pendingStatusChange && createPortal(
          <div className="fixed inset-0 z-[10000] p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto overscroll-contain flex flex-col justify-start sm:justify-center items-center">
            <div className="glass-panel p-4 sm:p-7 rounded-2xl max-w-md max-w-[calc(100vw-1.5rem)] w-full text-center space-y-3.5 sm:space-y-5 border border-purple-500/30 shadow-[0_0_50px_rgba(0,0,0,0.8)] my-auto max-h-[92dvh] overflow-y-auto custom-scrollbar">
              <span className={`material-symbols-outlined text-4xl sm:text-5xl animate-pulse ${pendingStatusChange.newStatus.toLowerCase() === 'rejected' ? 'text-red-500' : 'text-green-400'
                }`}>
                {pendingStatusChange.newStatus.toLowerCase() === 'rejected' ? 'cancel_presentation' : 'verified'}
              </span>
              <div className="space-y-1.5">
                <h3 className="font-display-lg text-lg sm:text-xl text-white font-extrabold uppercase">
                  Confirm Candidate Action
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Are you sure you want to change the status of candidate <strong className="text-white">"{pendingStatusChange.candidateName}"</strong> to <strong className={pendingStatusChange.newStatus.toLowerCase() === 'rejected' ? 'text-red-400' : 'text-green-400'}>{pendingStatusChange.newStatus.toUpperCase()}</strong>?
                </p>
              </div>
              <div className="flex gap-2.5 sm:gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingStatusChange(null)}
                  className="flex-1 py-2.5 sm:py-3 border border-purple-500/30 hover:bg-white/5 rounded-xl font-label-caps text-xs text-white tracking-widest cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { docId, regNo, newStatus } = pendingStatusChange;
                    executeStatusUpdate(docId, regNo, newStatus);
                  }}
                  className={`flex-1 py-2.5 sm:py-3 rounded-xl font-label-caps text-xs text-black font-black tracking-widest cursor-pointer ${pendingStatusChange.newStatus.toLowerCase() === 'rejected'
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-green-400 hover:bg-green-500'
                    }`}
                >
                  CONFIRM
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Sync Toast Notification */}
        {mounted && typeof document !== 'undefined' && syncToastMessage && createPortal(
          <div className="fixed bottom-6 right-4 left-4 sm:left-auto sm:right-6 z-[10000] glass-panel p-4 rounded-xl border border-green-500/40 bg-black/90 flex items-center gap-3 text-left shadow-[0_10px_30px_rgba(0,0,0,0.8)] max-w-sm">
            <span className="material-symbols-outlined text-green-400 text-lg shrink-0">check_circle</span>
            <span className="text-xs text-white font-bold">{syncToastMessage}</span>
          </div>,
          document.body
        )}

      </div>

      {/* Candidate Detail Inspector Modal */}
      {mounted && typeof document !== 'undefined' && inspectingCandidate && createPortal(
        <div className="fixed inset-0 z-[10000] p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto overscroll-contain flex flex-col justify-start sm:justify-center items-center">
          <div className="glass-panel p-4 sm:p-7 rounded-2xl max-w-lg max-w-[calc(100vw-1.5rem)] w-full text-left space-y-3.5 sm:space-y-4 border border-purple-500/30 shadow-[0_0_60px_rgba(168,85,247,0.4)] relative my-auto max-h-[92dvh] overflow-y-auto custom-scrollbar animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-start border-b border-purple-500/20 pb-3">
              <div>
                <h3 className="font-display-lg text-lg sm:text-2xl text-white font-extrabold">
                  Candidate Dossier
                </h3>
                <p className="text-[10px] text-purple-400 font-code-sm uppercase tracking-wider mt-0.5">
                  ID: {inspectingCandidate.id || 'LOCAL_RECORD'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingCandidate(null)}
                className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg sm:text-xl">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3.5 text-xs">
              <div>
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">CANDIDATE NAME</span>
                <span className="text-xs sm:text-sm font-bold text-white block">{getRefVal(inspectingCandidate, "Candidate Name") || getRefVal(inspectingCandidate, "candidateName")}</span>
              </div>

              <div>
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">REGISTRATION NUMBER</span>
                <span className="text-xs sm:text-sm font-bold text-purple-400 font-code-sm block">{getRefVal(inspectingCandidate, "Candidate Registration Number") || getRefVal(inspectingCandidate, "candidateRegNo")}</span>
              </div>

              <div className="sm:col-span-2">
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">EMAIL ADDRESS</span>
                <span className="text-xs sm:text-sm font-bold text-white block truncate">{getRefVal(inspectingCandidate, "Candidate Email") || getRefVal(inspectingCandidate, "candidateEmail")}</span>
              </div>

              <div>
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">PHONE NUMBER</span>
                <span className="text-xs sm:text-sm font-bold text-white block">{getRefVal(inspectingCandidate, "Candidate Phone") || getRefVal(inspectingCandidate, "candidatePhone")}</span>
              </div>

              <div>
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">TARGETED TEAM</span>
                <span className="text-xs sm:text-sm font-bold text-yellow-400 block">{formatTeamName(getRefVal(inspectingCandidate, "Target Team") || getRefVal(inspectingCandidate, "targetTeam"))}</span>
              </div>

              <div className="sm:col-span-2">
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest block font-bold mb-0.5">SUBMISSION TIMESTAMP</span>
                <span className="text-xs sm:text-sm font-bold text-white block">{new Date(getRefVal(inspectingCandidate, "Timestamp") || getRefVal(inspectingCandidate, "timestamp") || new Date()).toLocaleString()}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-purple-500/20 pt-3">
              <div className="flex items-center justify-between sm:justify-start gap-2">
                <span className="text-[10px] text-purple-300 font-label-caps tracking-widest font-bold">STATUS:</span>
                {getStatusPill(getRefVal(inspectingCandidate, "Status") || getRefVal(inspectingCandidate, "status"))}
              </div>
              <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
                {canDeleteReferrals && (
                  <button
                    type="button"
                    onClick={() => openEditCandidateModal(inspectingCandidate)}
                    className="flex-1 sm:flex-none justify-center px-3 py-1.5 rounded-lg border border-purple-500/40 text-purple-300 hover:bg-purple-500/20 text-xs font-bold font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">edit</span>
                    <span>EDIT</span>
                  </button>
                )}
                {canDeleteReferrals && (
                  <button
                    type="button"
                    onClick={() => {
                      const cReg = getRefVal(inspectingCandidate, "Candidate Registration Number") || getRefVal(inspectingCandidate, "candidateRegNo") || "UNKNOWN";
                      const cName = getRefVal(inspectingCandidate, "Candidate Name") || getRefVal(inspectingCandidate, "candidateName") || "Candidate";
                      setPendingDeleteReferral({ docId: inspectingCandidate.id, regNo: cReg, candidateName: cName });
                    }}
                    className="flex-1 sm:flex-none justify-center px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/20 text-xs font-bold font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                    <span>DELETE</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Bulk Delete Referral Confirmation Modal */}
      {mounted && typeof document !== 'undefined' && pendingBulkDelete && createPortal(
        <div className="fixed inset-0 z-[10000] p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto overscroll-contain flex flex-col justify-start sm:justify-center items-center">
          <div className="glass-panel p-4 sm:p-6 rounded-2xl max-w-lg max-w-[calc(100vw-1.5rem)] w-full text-center space-y-3.5 sm:space-y-4 border border-rose-500/50 shadow-[0_0_60px_rgba(244,63,94,0.3)] my-auto max-h-[92dvh] overflow-y-auto custom-scrollbar">
            <div className="w-12 h-12 sm:w-14 sm:h-14 mx-auto rounded-2xl bg-rose-500/15 border-2 border-rose-500/40 flex items-center justify-center text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.3)] shrink-0">
              <span className="material-symbols-outlined text-2xl sm:text-3xl">delete_sweep</span>
            </div>
            <div className="space-y-1.5">
              <h3 className="font-display-lg text-lg sm:text-xl text-white font-extrabold uppercase">
                Delete {pendingBulkDelete.length} Candidate(s)?
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to permanently delete the <strong className="text-white">{pendingBulkDelete.length} selected candidate referral dossier(s)</strong> from the referrals pipeline and database?
              </p>
              <div className="max-h-28 sm:max-h-36 overflow-y-auto custom-scrollbar p-2.5 bg-black/50 border border-rose-500/20 rounded-xl text-left space-y-1 mt-2">
                {pendingBulkDelete.map((cand, i) => {
                  const name = getRefVal(cand, 'Candidate Name') || getRefVal(cand, 'candidateName') || 'Candidate';
                  const reg = getRefVal(cand, 'Candidate Registration Number') || getRefVal(cand, 'candidateRegNo') || '';
                  const team = formatTeamName(getRefVal(cand, 'Target Team') || getRefVal(cand, 'targetTeam') || '');
                  return (
                    <div key={i} className="text-[11px] font-mono flex items-center justify-between text-slate-300 py-0.5 border-b border-white/5 last:border-0">
                      <span className="truncate text-white font-bold">{name}</span>
                      <span className="text-purple-400 shrink-0 ml-2">{reg} • {team}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-rose-400/90 font-medium">
                ⚠️ This action cannot be undone and will permanently remove these records from the database.
              </p>
            </div>
            <div className="flex gap-2.5 sm:gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingBulkDelete(null)}
                className="flex-1 py-2.5 sm:py-3 border border-purple-500/30 hover:bg-white/5 rounded-xl font-label-caps text-xs text-white tracking-widest cursor-pointer"
              >
                CANCEL
              </button>
              <button
                type="button"
                disabled={bulkUpdating}
                onClick={executeBulkDeleteReferrals}
                className="flex-1 py-2.5 sm:py-3 rounded-xl font-label-caps text-xs text-white font-black tracking-widest bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 shadow-[0_0_20px_rgba(244,63,94,0.4)] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {bulkUpdating ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                    <span>DELETING...</span>
                  </>
                ) : (
                  <span>DELETE ALL {pendingBulkDelete.length}</span>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Candidate Modal */}
      {mounted && typeof document !== 'undefined' && editingCandidate && createPortal(
        <div className="fixed inset-0 z-[10000] p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto overscroll-contain flex flex-col justify-start sm:justify-center items-center">
          <div className="glass-panel p-4 sm:p-6 rounded-2xl max-w-lg max-w-[calc(100vw-1.5rem)] w-full bg-[#0c0417]/95 border border-purple-500/40 shadow-[0_0_50px_rgba(168,85,247,0.3)] my-auto max-h-[92dvh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Header (Pinned) */}
            <div className="shrink-0 flex items-center justify-between border-b border-purple-500/20 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0">
                  <span className="material-symbols-outlined text-base sm:text-lg">edit_note</span>
                </div>
                <div>
                  <h3 className="font-heading text-sm sm:text-base font-black text-white">
                    Edit Candidate Dossier
                  </h3>
                  <p className="text-[10px] sm:text-[11px] text-slate-400 font-mono">
                    Update candidate details directly in database
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingCandidate(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Form with scrollable fields & pinned footer */}
            <form onSubmit={handleSaveEditCandidate} className="flex-1 flex flex-col min-h-0 text-left mt-2">
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 -mr-1 py-1 space-y-3 sm:space-y-3.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-purple-300 font-mono">
                    Candidate Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editFormData.candidateName}
                    onChange={(e) => setEditFormData({ ...editFormData, candidateName: e.target.value })}
                    className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-400 font-mono"
                    placeholder="e.g. John Doe"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-purple-300 font-mono">
                      Registration Number *
                    </label>
                    <input
                      type="text"
                      required
                      value={editFormData.candidateRegNo}
                      onChange={(e) => setEditFormData({ ...editFormData, candidateRegNo: e.target.value.toUpperCase() })}
                      className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-purple-300 focus:outline-none focus:border-purple-400 font-mono uppercase"
                      placeholder="25XXX10000"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-purple-300 font-mono">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      value={editFormData.candidatePhone}
                      onChange={(e) => setEditFormData({ ...editFormData, candidatePhone: e.target.value })}
                      className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-400 font-mono"
                      placeholder="e.g. 9876543210"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-purple-300 font-mono">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={editFormData.candidateEmail}
                    onChange={(e) => setEditFormData({ ...editFormData, candidateEmail: e.target.value.toLowerCase() })}
                    className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-400 font-mono"
                    placeholder="e.g. student@vitbhopal.ac.in"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-purple-300 font-mono">
                      Target Division / Team
                    </label>
                    <select
                      value={editFormData.targetTeam}
                      onChange={(e) => setEditFormData({ ...editFormData, targetTeam: e.target.value })}
                      className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-yellow-300 focus:outline-none focus:border-purple-400 font-mono cursor-pointer font-bold"
                    >
                      <option value="Technical">Technical</option>
                      <option value="Design">Design</option>
                      <option value="Education">Education</option>
                      <option value="Esports(PC)">Esports(PC)</option>
                      <option value="Esports(Mobile)">Esports(Mobile)</option>
                      <option value="PR">PR</option>
                      <option value="Social Media">Social Media</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-purple-300 font-mono">
                      Dossier Status
                    </label>
                    <select
                      value={editFormData.status}
                      onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                      className="w-full bg-[#0a0315] border border-purple-500/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-400 font-mono cursor-pointer font-bold"
                    >
                      <option value="Pending">Pending</option>
                      <option value="In Process">In Process</option>
                      <option value="Invited to Interview">Invited to Interview</option>
                      <option value="Interview Taken">Interview Taken</option>
                      <option value="Admitted">Admitted</option>
                      <option value="Rejected">Rejected</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Action Buttons (Pinned) */}
              <div className="shrink-0 flex gap-2.5 sm:gap-3 pt-3 border-t border-purple-500/20 mt-1">
                <button
                  type="button"
                  onClick={() => setEditingCandidate(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 font-label-caps text-xs text-slate-300 font-bold tracking-wider transition-colors cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 font-label-caps text-xs text-white font-black tracking-widest transition-all cursor-pointer shadow-[0_0_20px_rgba(168,85,247,0.4)] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSavingEdit ? (
                    <>
                      <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                      <span>SAVING...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">save</span>
                      <span>SAVE CHANGES</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Referral Confirmation Modal */}
      {mounted && typeof document !== 'undefined' && pendingDeleteReferral && createPortal(
        <div className="fixed inset-0 z-[10000] p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto overscroll-contain flex flex-col justify-start sm:justify-center items-center">
          <div className="glass-panel p-4 sm:p-6 rounded-2xl max-w-md max-w-[calc(100vw-1.5rem)] w-full text-center space-y-3.5 sm:space-y-4 border border-rose-500/50 shadow-[0_0_60px_rgba(244,63,94,0.3)] my-auto max-h-[92dvh] overflow-y-auto custom-scrollbar">
            <div className="w-12 h-12 sm:w-14 sm:h-14 mx-auto rounded-2xl bg-rose-500/15 border-2 border-rose-500/40 flex items-center justify-center text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.3)] shrink-0">
              <span className="material-symbols-outlined text-2xl sm:text-3xl">delete_forever</span>
            </div>
            <div className="space-y-1.5">
              <h3 className="font-display-lg text-lg sm:text-xl text-white font-extrabold uppercase">
                Delete Referral Record?
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to permanently delete candidate referral dossier for <strong className="text-white">"{pendingDeleteReferral.candidateName}"</strong> (<span className="text-purple-400 font-mono">{pendingDeleteReferral.regNo}</span>)?
              </p>
              <p className="text-[11px] text-rose-400/90 font-medium">
                ⚠️ This action cannot be undone and will recalculate recruiter leaderboard scores.
              </p>
            </div>
            <div className="flex gap-2.5 sm:gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteReferral(null)}
                className="flex-1 py-2.5 sm:py-3 border border-purple-500/30 hover:bg-white/5 rounded-xl font-label-caps text-xs text-white tracking-widest cursor-pointer"
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
                className="flex-1 py-2.5 sm:py-3 rounded-xl font-label-caps text-xs text-white font-black tracking-widest bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 shadow-[0_0_20px_rgba(244,63,94,0.4)] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
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
        </div>,
        document.body
      )}
    </div>
  );
};

export default Referrals;
