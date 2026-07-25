"use client";

import React, { useState, useEffect } from 'react';
import { auth, googleProvider, db } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, doc, deleteDoc, updateDoc, setDoc, getDoc, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { supabase } from '../lib/supabase';
import { CONFIG } from '../lib/config';

interface IDCardProps {
  onRedirect: () => void;
}

interface MemberData {
  name: string;
  registrationNumber: string;
  phone: string;
  email: string;
  team: string;
  position: string;
}

interface CandidateSubmission {
  id?: string;
  name: string;
  registrationNumber: string;
  phone: string;
  team: string;
  position: string;
  email: string;
  photoUrl: string;
  avatarUrl: string;
  qrCodeUrl?: string;
  submittedAt: string;
  status: string;
}

interface AdminActivityLog {
  id?: string;
  action: 'DELETE_DOSSIER' | 'APPROVE_DOSSIER' | 'REVERT_PENDING_DOSSIER' | 'FORCE_SHEETS_SYNC' | 'DATA_REPORT_SUBMITTED';
  performedBy: string;
  targetEmail?: string;
  targetName?: string;
  targetRegNo?: string;
  details: string;
  timestamp: string;
}

const IDCard: React.FC<IDCardProps> = ({ onRedirect }) => {
  const getAdminDisplayRoleOrTeam = (team?: string, position?: string) => {
    const t = (team || '').toLowerCase();
    const p = (position || '').toLowerCase();
    const isSpecial = t === 'student coordinator' || t.includes('president') || p === 'student coordinator' || p.includes('president');
    if (isSpecial) {
      return {
        isSpecial: true,
        label: 'ROLE / POSITION',
        value: t === 'student coordinator' ? 'Student Coordinator' : position
      };
    }
    return {
      isSpecial: false,
      label: 'TEAM / DIVISION',
      value: team
    };
  };

  const getQrCodeImageUrl = (regNo?: string, savedQrUrl?: string) => {
    if (savedQrUrl && savedQrUrl.trim()) return savedQrUrl;
    const origin = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL || 'https://vrgcforms.vercel.app');
    return `https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(`${origin}/card/${regNo || ''}`)}`;
  };

  // Authentication & Member Data States
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Tab selections
  const [activeSubTab, setActiveSubTab] = useState<'portal' | 'admin'>('portal');

  // Member Fields
  const [memberData, setMemberData] = useState<MemberData | null>(null);

  // Form Submission States
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarUrlInput, setAvatarUrlInput] = useState<string>('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [isPreviewFlipped, setIsPreviewFlipped] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitSuccess, setSubmitSuccess] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>('');
  const [existingSubmission, setExistingSubmission] = useState<CandidateSubmission | null>(null);

  // Data Correction Report States
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [reportIssueText, setReportIssueText] = useState<string>('');
  const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);
  const [reportStatus, setReportStatus] = useState<string | null>(null);

  // Admin Candidates & filters state
  const [candidates, setCandidates] = useState<CandidateSubmission[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTeam, setSelectedTeam] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingAvatarId, setDownloadingAvatarId] = useState<string | null>(null);
  const [previewCandidate, setPreviewCandidate] = useState<CandidateSubmission | null>(null);
  
  // Admin 3D Card View & Flipping states
  const [adminViewMode, setAdminViewMode] = useState<'list' | 'cards'>('list');
  const [flippedCardsMap, setFlippedCardsMap] = useState<Record<string, boolean>>({});
  const [previewModalTab, setPreviewModalTab] = useState<'details' | 'card'>('card');
  const [previewFlipped, setPreviewFlipped] = useState<boolean>(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuDirections, setMenuDirections] = useState<Record<string, 'up' | 'down'>>({});
  const [candidateToDelete, setCandidateToDelete] = useState<CandidateSubmission | null>(null);

  // Admin Activity Logs States
  const [adminSectionTab, setAdminSectionTab] = useState<'dossiers' | 'logs'>('dossiers');
  const [adminLogs, setAdminLogs] = useState<AdminActivityLog[]>([]);
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [logActionFilter, setLogActionFilter] = useState<string>('All');

  // Log helper for admin activity audit trail
  const logAdminAction = async (
    action: AdminActivityLog['action'],
    details: string,
    targetEmail?: string,
    targetName?: string,
    targetRegNo?: string
  ) => {
    try {
      if (!db || !currentUser) return;
      const logEntry: AdminActivityLog = {
        action,
        performedBy: currentUser.email || 'Admin',
        targetEmail: targetEmail || 'N/A',
        targetName: targetName || 'N/A',
        targetRegNo: targetRegNo || 'N/A',
        details,
        timestamp: new Date().toISOString()
      };
      await addDoc(collection(db, 'admin_logs'), logEntry);
    } catch (err) {
      console.error("Failed to write admin activity log:", err);
    }
  };

  const handleDeleteLog = async (logId?: string) => {
    if (!logId || !db) return;
    const userEmail = (currentUser?.email || '').toLowerCase();
    if (userEmail !== 'abhinav.25bcy10254@vitbhopal.ac.in') {
      return;
    }
    try {
      await deleteDoc(doc(db, 'admin_logs', logId));
      setAdminLogs(prev => prev.filter(l => l.id !== logId));
      setSyncToastMessage("Activity log entry deleted.");
      setTimeout(() => setSyncToastMessage(null), 3000);
    } catch (err: any) {
      console.error("Failed to delete log entry:", err);
    }
  };

  // Real-time listener for admin_logs
  useEffect(() => {
    if (!isAdmin || !db) return;
    try {
      const logsQuery = query(collection(db, 'admin_logs'), orderBy('timestamp', 'desc'), limit(100));
      const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
        const logsList: AdminActivityLog[] = [];
        snapshot.forEach(docSnap => {
          logsList.push({ id: docSnap.id, ...docSnap.data() } as AdminActivityLog);
        });
        setAdminLogs(logsList);
      }, (error) => {
        console.warn("Real-time admin logs listener notice:", error);
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn("Could not query admin_logs:", e);
    }
  }, [isAdmin]);

  // Close mobile 3-dots menu on outside click
  useEffect(() => {
    const handleOutsideClick = () => setOpenMenuId(null);
    if (openMenuId) {
      window.addEventListener('click', handleOutsideClick);
      return () => window.removeEventListener('click', handleOutsideClick);
    }
  }, [openMenuId]);

  // Google Sheets Force Sync states
  const [isSyncingSheets, setIsSyncingSheets] = useState<boolean>(false);
  const [sheetsCooldown, setSheetsCooldown] = useState<number>(0);
  const [syncToastMessage, setSyncToastMessage] = useState<string | null>(null);

  // Cooldown timer countdown
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (sheetsCooldown > 0) {
      timer = setInterval(() => {
        setSheetsCooldown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [sheetsCooldown]);

  const [loadedMembersList, setLoadedMembersList] = useState<MemberData[]>([]);

  // Fetch whitelist admin emails and member roster from CSVs
  useEffect(() => {
    const fetchCSVData = async () => {
      setAuthLoading(true);
      try {
        const adminRes = await fetch('/admins.csv');
        let adminEmailsList: string[] = [];
        if (adminRes.ok) {
          const adminText = await adminRes.text();
          adminEmailsList = adminText.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('Email'))
            .map(email => email.toLowerCase());
        }

        const memberRes = await fetch('/members.csv');
        let membersList: MemberData[] = [];
        if (memberRes.ok) {
          const memberText = await memberRes.text();
          const lines = memberText.split('\n');
          const headers = lines[0].split(',').map(h => h.trim());
          const emailIdx = headers.findIndex(h => h.toLowerCase() === 'email');
          const nameIdx = headers.findIndex(h => h.toLowerCase() === 'name');
          const regIdx = headers.findIndex(h => h.toLowerCase() === 'registration number');
          const phoneIdx = headers.findIndex(h => h.toLowerCase() === 'phone');
          const teamIdx = headers.findIndex(h => h.toLowerCase() === 'team');
          const posIdx = headers.findIndex(h => h.toLowerCase() === 'position');

          for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const currentLine = lines[i].split(',');
            membersList.push({
              name: currentLine[nameIdx] ? currentLine[nameIdx].trim() : '',
              registrationNumber: currentLine[regIdx] ? currentLine[regIdx].trim() : '',
              phone: currentLine[phoneIdx] ? currentLine[phoneIdx].trim() : '',
              email: currentLine[emailIdx] ? currentLine[emailIdx].trim().toLowerCase() : '',
              team: currentLine[teamIdx] ? currentLine[teamIdx].trim() : '',
              position: currentLine[posIdx] ? currentLine[posIdx].trim() : 'Member'
            });
          }
        }

        setLoadedMembersList(membersList);

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (user) {
            setCurrentUser(user);
            const lowerEmail = user.email ? user.email.toLowerCase() : '';
            const matchedAdmin = adminEmailsList.includes(lowerEmail);
            setIsAdmin(matchedAdmin);

            const userEntries = membersList.filter(m => m.email === lowerEmail);
            if (userEntries.length > 0) {
              const teams = Array.from(new Set(userEntries.map(m => m.team).filter(Boolean))).join(', ');
              const positions = Array.from(new Set(userEntries.map(m => m.position).filter(Boolean))).join(', ');

              const matchedMember: MemberData = {
                name: userEntries[0].name,
                registrationNumber: userEntries[0].registrationNumber,
                phone: userEntries[0].phone,
                email: userEntries[0].email,
                team: teams,
                position: positions
              };

              setMemberData(matchedMember);
              setIsAuthorized(true);
              await checkExistingSubmission(user.email || '');
            } else if (matchedAdmin) {
              setMemberData({
                name: user.displayName || 'Administrator',
                registrationNumber: 'ADMIN',
                phone: '',
                email: user.email || '',
                team: 'Management',
                position: 'Lead'
              });
              setIsAuthorized(true);
              await checkExistingSubmission(user.email || '');
            } else {
              setIsAuthorized(false);
              setAuthError('Access Denied: You are not authorized. Only registered members can access this portal.');
              await signOut(auth);
            }
          } else {
            setCurrentUser(null);
            setIsAuthorized(false);
            setMemberData(null);
            setExistingSubmission(null);
            setIsAdmin(false);
          }
          setAuthLoading(false);
        });

        return () => unsubscribe();
      } catch (err) {
        console.error("Error loading CSV auth data: ", err);
        setAuthLoading(false);
      }
    };

    fetchCSVData();
  }, []);

  // Subscribe to real-time updates from 'id_cards' Firestore collection (Admins only)
  useEffect(() => {
    if (!currentUser || !isAdmin) return;

    setLoadingData(true);
    const unsub = onSnapshot(collection(db, 'id_cards'), (snapshot) => {
      const candidatesData: CandidateSubmission[] = [];
      snapshot.forEach((doc) => {
        candidatesData.push({ id: doc.id, ...doc.data() } as CandidateSubmission);
      });
      candidatesData.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      setCandidates(candidatesData);
      setLoadingData(false);
    }, (error) => {
      console.error("Firestore subscription error:", error);
      setLoadingData(false);
    });

    return () => unsub();
  }, [currentUser, isAdmin]);

  const checkExistingSubmission = async (email: string) => {
    try {
      const docRef = doc(db, 'id_cards', email.toLowerCase());
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setExistingSubmission(docSnap.data() as CandidateSubmission);
      } else {
        setExistingSubmission(null);
      }
    } catch (err) {
      console.error('Error checking existing submission:', err);
    }
  };

  const handleLogin = async () => {
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Login error:', err);
      if (err?.code === 'auth/unauthorized-domain' || err?.message?.includes('unauthorized domain')) {
        setAuthError('Unauthorized Domain: Add your Vercel domain (e.g. your-app.vercel.app) to Firebase Console > Authentication > Settings > Authorized Domains.');
      } else if (err?.code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup was closed before completion. Please try again.');
      } else {
        setAuthError(err?.message || 'Failed to sign in. Please verify your Google Account.');
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      setIsAuthorized(false);
      setMemberData(null);
      setExistingSubmission(null);
      setIsAdmin(false);
      setActiveSubTab('portal');
    } catch (err) {
      console.error('Signout error:', err);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Photo must be less than 5MB.');
      return;
    }

    setPhotoFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Avatar must be less than 5MB.');
      return;
    }

    setAvatarFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !currentUser || !memberData) return;
    if (!photoFile) {
      setSubmitError('Please upload an identification photo.');
      return;
    }
    if (!avatarFile && !avatarUrlInput.trim()) {
      setSubmitError('Please upload a gaming avatar file or paste a direct GIF/Image URL link.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');

    try {
      // Helper to sanitize text for file names
      const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const userRegNo = memberData.registrationNumber || 'NO_REG';
      const userNameStr = sanitize(memberData.name || 'user');
      const userEmailStr = sanitize(currentUser.email || 'email');
      const timestamp = Date.now();

      // 1. Upload Identification Photo to 'id-cards' Bucket
      const photoExt = photoFile.name.split('.').pop();
      const photoFileName = `${userRegNo}_${userNameStr}_${userEmailStr}_photo_${timestamp}.${photoExt}`;
      const photoFilePath = `id-photos/${photoFileName}`;

      const { error: photoUploadError } = await supabase.storage
        .from('id-cards')
        .upload(photoFilePath, photoFile, {
          cacheControl: '3600',
          upsert: true
        });

      if (photoUploadError) {
        throw new Error(`Supabase photo upload failed: ${photoUploadError.message}.`);
      }

      const { data: { publicUrl: photoPublicUrl } } = supabase.storage
        .from('id-cards')
        .getPublicUrl(photoFilePath);

      // 2. Upload Gaming Avatar strictly to 'avatar' Bucket (from file OR fetched from pasted GIF link)
      let avatarPublicUrl = avatarUrlInput.trim();
      if (avatarFile || avatarUrlInput.trim()) {
        const timestamp = Date.now();
        let uploadBlob: Blob | File | null = avatarFile;
        let avatarExt = 'gif';

        if (!uploadBlob && avatarUrlInput.trim()) {
          const gifUrl = avatarUrlInput.trim();
          try {
            // Attempt 1: Direct fetch of remote link
            const gifRes = await fetch(gifUrl);
            if (gifRes.ok) {
              uploadBlob = await gifRes.blob();
            } else {
              throw new Error(`Direct fetch status ${gifRes.status}`);
            }
          } catch (e) {
            console.warn("Direct fetch of remote GIF link failed or CORS blocked, trying server proxy:", e);
            try {
              // Attempt 2: Server proxy fetch bypassing CORS limits
              const proxyRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(gifUrl)}`);
              if (proxyRes.ok) {
                uploadBlob = await proxyRes.blob();
              } else {
                console.warn(`Proxy fetch status ${proxyRes.status}`);
              }
            } catch (proxyErr) {
              console.warn("Proxy fetch of remote GIF link failed:", proxyErr);
            }
          }

          if (uploadBlob) {
            const blobType = (uploadBlob.type || '').toLowerCase();
            if (blobType.includes('png')) avatarExt = 'png';
            else if (blobType.includes('jpeg') || blobType.includes('jpg')) avatarExt = 'jpg';
            else if (blobType.includes('webp')) avatarExt = 'webp';
            else avatarExt = 'gif';
          }
        } else if (avatarFile) {
          avatarExt = avatarFile.name.split('.').pop() || 'gif';
        }

        if (uploadBlob) {
          const avatarFileName = `${userRegNo}_${userNameStr}_${userEmailStr}_avatar_${timestamp}.${avatarExt}`;
          const avatarFilePath = `avatars/${avatarFileName}`;

          const { error: avatarUploadError } = await supabase.storage
            .from('avatar')
            .upload(avatarFilePath, uploadBlob, {
              cacheControl: '3600',
              upsert: true,
              contentType: uploadBlob.type || (avatarExt === 'gif' ? 'image/gif' : `image/${avatarExt}`)
            });

          if (avatarUploadError) {
            console.warn("Supabase avatar upload error, keeping direct link:", avatarUploadError.message);
          } else {
            const { data: { publicUrl: uploadedUrl } } = supabase.storage
              .from('avatar')
              .getPublicUrl(avatarFilePath);
            avatarPublicUrl = uploadedUrl;
          }
        }
      }
      
      let qrCodePublicUrl = '';
      try {
        const qrOrigin = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL || 'https://vrgcforms.vercel.app');
        const qrContent = `${qrOrigin}/card/${encodeURIComponent(memberData.registrationNumber)}`;
        const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(qrContent)}`;

        let qrBlob: Blob | null = null;
        try {
          const qrRes = await fetch(qrApiUrl);
          if (qrRes.ok) qrBlob = await qrRes.blob();
        } catch {
          const proxyQrRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(qrApiUrl)}`);
          if (proxyQrRes.ok) qrBlob = await proxyQrRes.blob();
        }

        if (qrBlob) {
          const qrFileName = `${userRegNo}_${userNameStr}_${userEmailStr}_qr_${timestamp}.png`;
          const qrFilePath = `qrcodes/${qrFileName}`;
          const { error: qrUploadError } = await supabase.storage
            .from('qr-codes')
            .upload(qrFilePath, qrBlob, {
              cacheControl: '3600',
              upsert: true,
              contentType: 'image/png'
            });

          if (!qrUploadError) {
            const { data: { publicUrl: uploadedQrUrl } } = supabase.storage
              .from('qr-codes')
              .getPublicUrl(qrFilePath);
            qrCodePublicUrl = uploadedQrUrl;
          } else {
            console.warn("Supabase qr-codes upload error:", qrUploadError.message);
          }
        }
      } catch (qrErr) {
        console.warn("QR code Supabase storage error:", qrErr);
      }

      // 3. Save Submission details to Firestore
      const submissionData: CandidateSubmission = {
        name: memberData.name,
        registrationNumber: memberData.registrationNumber,
        phone: memberData.phone,
        team: memberData.team,
        position: memberData.position,
        email: currentUser.email || '',
        photoUrl: photoPublicUrl,
        avatarUrl: avatarPublicUrl,
        qrCodeUrl: qrCodePublicUrl || '',
        submittedAt: new Date().toISOString(),
        status: 'Pending'
      };

      await setDoc(doc(db, 'id_cards', (currentUser.email || '').toLowerCase()), submissionData);

      if (CONFIG.GOOGLE_SCRIPT_ID_CARD_URL) {
        const sheetSyncUrl = `${CONFIG.GOOGLE_SCRIPT_ID_CARD_URL}?action=sync_idcard&email=${encodeURIComponent(submissionData.email)}&name=${encodeURIComponent(submissionData.name)}&regNo=${encodeURIComponent(submissionData.registrationNumber)}&phone=${encodeURIComponent(submissionData.phone || '')}&team=${encodeURIComponent(submissionData.team || '')}&position=${encodeURIComponent(submissionData.position || 'Member')}&photoUrl=${encodeURIComponent(submissionData.photoUrl || '')}&avatarUrl=${encodeURIComponent(submissionData.avatarUrl || '')}&qrCodeUrl=${encodeURIComponent(submissionData.qrCodeUrl || '')}&submittedAt=${encodeURIComponent(submissionData.submittedAt || '')}&status=${encodeURIComponent(submissionData.status || 'Pending')}`;
        sendGoogleScriptRequest(sheetSyncUrl);
      }

      setSubmitSuccess(true);
      setExistingSubmission(submissionData);
    } catch (err: any) {
      console.error('Submission error:', err);
      setSubmitError(err.message || 'An error occurred during submission. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportIssueText.trim() || !currentUser || !memberData) return;

    setIsSubmittingReport(true);
    setReportStatus(null);

    try {
      await addDoc(collection(db, 'data_reports'), {
        name: memberData.name,
        registrationNumber: memberData.registrationNumber,
        email: currentUser.email,
        team: memberData.team,
        position: memberData.position,
        reportedIssue: reportIssueText,
        submittedAt: new Date().toISOString(),
        status: 'Pending'
      });

      setReportStatus('success');
      setReportIssueText('');
      setTimeout(() => {
        setShowReportModal(false);
        setReportStatus(null);
      }, 2000);
    } catch (err: any) {
      console.error("Error reporting data issue:", err);
      setReportStatus("Error: " + err.message);
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const sendGoogleScriptRequest = (url: string): Promise<boolean> => {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (success: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve(success);
        }
      };

      // 1. Image Beacon ping (Works 100% reliably in cross-origin / hosted environments)
      const img = new Image();
      img.onload = () => done(true);
      img.onerror = () => done(true); // Apps Script response text triggers onerror on <img>, but GET request executed on Google server
      img.src = url;

      // 2. Fetch no-cors fallback
      fetch(url, { mode: 'no-cors', cache: 'no-cache' })
        .then(() => done(true))
        .catch(() => done(true));

      // 3. Fallback safety timer
      setTimeout(() => done(true), 2500);
    });
  };

  const handleSyncAllToSheets = async () => {
    if (sheetsCooldown > 0 || isSyncingSheets) return;
    if (!CONFIG.GOOGLE_SCRIPT_ID_CARD_URL) {
      setSyncToastMessage("Google Script URL is not configured.");
      setTimeout(() => setSyncToastMessage(null), 4000);
      return;
    }

    setIsSyncingSheets(true);

    try {
      // Fetch latest active records from Firestore to ensure clean list (excluding deleted entries)
      const querySnap = await getDocs(collection(db, 'id_cards'));
      const activeCandidates: CandidateSubmission[] = [];
      querySnap.forEach((d) => activeCandidates.push({ id: d.id, ...d.data() } as CandidateSubmission));

      // Update local state list
      const sortedCandidates = activeCandidates.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      setCandidates(sortedCandidates);

      if (sortedCandidates.length === 0) {
        setSyncToastMessage("No active candidate records found in Firebase to sync.");
        setTimeout(() => setSyncToastMessage(null), 4000);
        setIsSyncingSheets(false);
        return;
      }

      let successCount = 0;
      for (let i = 0; i < sortedCandidates.length; i++) {
        const c = sortedCandidates[i];
        const sheetSyncUrl = `${CONFIG.GOOGLE_SCRIPT_ID_CARD_URL}?action=sync_idcard&email=${encodeURIComponent(c.email)}&name=${encodeURIComponent(c.name)}&regNo=${encodeURIComponent(c.registrationNumber)}&phone=${encodeURIComponent(c.phone || '')}&team=${encodeURIComponent(c.team || '')}&position=${encodeURIComponent(c.position || 'Member')}&photoUrl=${encodeURIComponent(c.photoUrl || '')}&avatarUrl=${encodeURIComponent(c.avatarUrl || '')}&qrCodeUrl=${encodeURIComponent(c.qrCodeUrl || '')}&submittedAt=${encodeURIComponent(c.submittedAt || '')}&status=${encodeURIComponent(c.status || 'Pending')}`;
        
        const ok = await sendGoogleScriptRequest(sheetSyncUrl);
        if (ok) successCount++;

        if (i < sortedCandidates.length - 1) {
          await new Promise(res => setTimeout(res, 120));
        }
      }

      logAdminAction(
        'FORCE_SHEETS_SYNC',
        `Initiated full sync to Google Sheets for ${sortedCandidates.length} candidate submissions`
      );

      setSyncToastMessage(`Full Sheet Refresh Complete! Successfully refreshed all ${successCount} of ${sortedCandidates.length} active Firebase candidate records (with QR code links) in Google Sheets.`);
      setTimeout(() => setSyncToastMessage(null), 4500);
      setSheetsCooldown(60);
    } catch (err) {
      console.error("Error during force sync to Sheets:", err);
      setSyncToastMessage("Sync failed. Check connection or script configuration.");
      setTimeout(() => setSyncToastMessage(null), 4500);
    } finally {
      setIsSyncingSheets(false);
    }
  };

  const handleDownload = async (candidate: CandidateSubmission) => {
    if (!candidate.photoUrl) return;
    setDownloadingId(candidate.id || candidate.email);

    try {
      const response = await fetch(candidate.photoUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${candidate.registrationNumber || 'ID'}_Photo.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Direct download failed, opening in new tab:", err);
      window.open(candidate.photoUrl, '_blank');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadAvatar = async (candidate: CandidateSubmission) => {
    if (!candidate.avatarUrl) return;
    const targetId = candidate.id || candidate.email;
    setDownloadingAvatarId(targetId);

    try {
      let response;
      try {
        response = await fetch(candidate.avatarUrl);
        if (!response.ok) throw new Error('Direct fetch failed');
      } catch (e) {
        response = await fetch(`/api/proxy-image?url=${encodeURIComponent(candidate.avatarUrl)}`);
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const urlLower = candidate.avatarUrl.toLowerCase();
      const isGif = urlLower.includes('.gif') || blob.type.includes('gif');
      const isPng = urlLower.includes('.png') || blob.type.includes('png');
      const isWebp = urlLower.includes('.webp') || blob.type.includes('webp');
      const ext = isGif ? 'gif' : isPng ? 'png' : isWebp ? 'webp' : 'jpg';

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${candidate.registrationNumber || 'ID'}_Avatar.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Direct avatar download failed, opening in new tab:", err);
      window.open(candidate.avatarUrl, '_blank');
    } finally {
      setDownloadingAvatarId(null);
    }
  };

  const handleDelete = (candidate: CandidateSubmission) => {
    setCandidateToDelete(candidate);
  };

  const confirmDeleteCandidate = async () => {
    if (!candidateToDelete) return;
    const candidate = candidateToDelete;
    setCandidateToDelete(null);

    try {
      if (candidate.photoUrl) {
        const index = candidate.photoUrl.indexOf('id-photos/');
        if (index !== -1) {
          const filePath = decodeURIComponent(candidate.photoUrl.substring(index));
          await supabase.storage.from('id-cards').remove([filePath]);
        }
      }
      if (candidate.avatarUrl) {
        const avatarIdx = candidate.avatarUrl.indexOf('avatars/');
        if (avatarIdx !== -1) {
          const avatarFilePath = decodeURIComponent(candidate.avatarUrl.substring(avatarIdx));
          const bucketName = candidate.avatarUrl.includes('/avatar/') ? 'avatar' : 'id-cards';
          await supabase.storage.from(bucketName).remove([avatarFilePath]);
        } else {
          const photoIdx = candidate.avatarUrl.indexOf('id-photos/');
          if (photoIdx !== -1) {
            const filePath = decodeURIComponent(candidate.avatarUrl.substring(photoIdx));
            await supabase.storage.from('id-cards').remove([filePath]);
          }
        }
      }

      // Delete from Firestore database
      await deleteDoc(doc(db, 'id_cards', candidate.email.toLowerCase()));

      // Instantly remove from local candidates state array
      setCandidates(prev => prev.filter(c => c.email.toLowerCase() !== candidate.email.toLowerCase()));

      // Send deletion signal to Google Sheets via Apps Script
      if (CONFIG.GOOGLE_SCRIPT_ID_CARD_URL) {
        const deleteSheetUrl = `${CONFIG.GOOGLE_SCRIPT_ID_CARD_URL}?action=delete_idcard&email=${encodeURIComponent(candidate.email)}`;
        sendGoogleScriptRequest(deleteSheetUrl);
      }

      // Close preview modal if deleting current candidate
      if (previewCandidate && previewCandidate.email.toLowerCase() === candidate.email.toLowerCase()) {
        setPreviewCandidate(null);
      }

      if (currentUser && candidate.email.toLowerCase() === (currentUser.email || '').toLowerCase()) {
        setExistingSubmission(null);
        setSubmitSuccess(false);
      }

      setSyncToastMessage(`Deleted submission for ${candidate.name}. Form response unlocked & Google Sheets notified.`);
      logAdminAction(
        'DELETE_DOSSIER',
        `Deleted candidate ID card dossier for ${candidate.name} (${candidate.registrationNumber || 'No Reg'})`,
        candidate.email,
        candidate.name,
        candidate.registrationNumber
      );
      setTimeout(() => setSyncToastMessage(null), 4500);
    } catch (err: any) {
      console.error("Delete failed:", err);
      setSyncToastMessage("Failed to delete entry: " + (err?.message || err));
      setTimeout(() => setSyncToastMessage(null), 4500);
    }
  };

  const toggleStatus = async (candidate: CandidateSubmission) => {
    try {
      const currentStatus = candidate.status || 'Pending';
      const newStatus = currentStatus === 'Approved' ? 'Pending' : 'Approved';
      await updateDoc(doc(db, 'id_cards', candidate.email.toLowerCase()), {
        status: newStatus
      });

      // Log admin activity
      logAdminAction(
        newStatus === 'Approved' ? 'APPROVE_DOSSIER' : 'REVERT_PENDING_DOSSIER',
        newStatus === 'Approved'
          ? `Approved digital identity dossier for ${candidate.name} (${candidate.registrationNumber || 'No Reg'})`
          : `Reverted dossier for ${candidate.name} (${candidate.registrationNumber || 'No Reg'}) back to Pending`,
        candidate.email,
        candidate.name,
        candidate.registrationNumber
      );

      // Update local state list
      setCandidates(prev => prev.map(c => 
        c.email.toLowerCase() === candidate.email.toLowerCase() 
          ? { ...c, status: newStatus }
          : c
      ));

      // Trigger status update in Google Sheets
      if (CONFIG.GOOGLE_SCRIPT_ID_CARD_URL) {
        const statusSyncUrl = `${CONFIG.GOOGLE_SCRIPT_ID_CARD_URL}?action=sync_idcard&email=${encodeURIComponent(candidate.email)}&name=${encodeURIComponent(candidate.name)}&regNo=${encodeURIComponent(candidate.registrationNumber)}&phone=${encodeURIComponent(candidate.phone || '')}&team=${encodeURIComponent(candidate.team || '')}&position=${encodeURIComponent(candidate.position || 'Member')}&photoUrl=${encodeURIComponent(candidate.photoUrl || '')}&avatarUrl=${encodeURIComponent(candidate.avatarUrl || '')}&qrCodeUrl=${encodeURIComponent(candidate.qrCodeUrl || '')}&submittedAt=${encodeURIComponent(candidate.submittedAt || '')}&status=${encodeURIComponent(newStatus)}`;
        sendGoogleScriptRequest(statusSyncUrl);
      }

      if (previewCandidate && previewCandidate.email.toLowerCase() === candidate.email.toLowerCase()) {
        setPreviewCandidate(prev => prev ? { ...prev, status: newStatus } : null);
      }

      setSyncToastMessage(`Updated status for ${candidate.name} to ${newStatus}.`);
      setTimeout(() => setSyncToastMessage(null), 3000);
    } catch (err: any) {
      console.error("Status update failed:", err);
      setSyncToastMessage("Failed to update status: " + (err?.message || err));
      setTimeout(() => setSyncToastMessage(null), 4000);
    }
  };

  const filteredCandidates = candidates.filter((c) => {
    const name = (c.name || '').toLowerCase();
    const reg = (c.registrationNumber || '').toLowerCase();
    const email = (c.email || '').toLowerCase();
    const search = searchQuery.toLowerCase();

    const matchesSearch = name.includes(search) || reg.includes(search) || email.includes(search);
    
    let matchesTeam = false;
    const teamLower = (c.team || '').toLowerCase();
    const posLower = (c.position || '').toLowerCase();
    const selLower = selectedTeam.toLowerCase();

    if (selectedTeam === 'All') {
      matchesTeam = true;
    } else if (selLower === 'management') {
      matchesTeam = 
        teamLower.includes('management') || 
        teamLower.includes('coordinator') || 
        teamLower.includes('president') ||
        posLower.includes('management') || 
        posLower.includes('coordinator') || 
        posLower.includes('president');
    } else if (selLower.includes('esports') && selLower.includes('pc')) {
      matchesTeam = teamLower.includes('esports') && teamLower.includes('pc');
    } else if (selLower.includes('esports') && selLower.includes('mobile')) {
      matchesTeam = teamLower.includes('esports') && teamLower.includes('mobile');
    } else if (selLower === 'esports') {
      matchesTeam = teamLower.includes('esports');
    } else {
      matchesTeam = c.team && c.team.toLowerCase() === selectedTeam.toLowerCase();
    }

    const matchesStatus =
      selectedStatus === 'All' ||
      (c.status || 'Pending').toLowerCase() === selectedStatus.toLowerCase();

    return matchesSearch && matchesTeam && matchesStatus;
  });

  if (authLoading) {
    return (
      <main className="flex-grow min-h-[70vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <span className="material-symbols-outlined text-[64px] text-primary animate-spin">
            sync
          </span>
          <p className="font-code-sm text-primary tracking-widest text-sm">
            VALIDATING REGISTERED IDENTITY...
          </p>
        </div>
      </main>
    );
  }

  if (!currentUser || !isAuthorized) {
    return (
      <main className="flex-grow min-h-screen flex items-center justify-center p-6 relative overflow-hidden text-left bg-mesh">
        <div className="glass-panel p-10 md:p-12 rounded-2xl max-w-lg w-full text-center space-y-6 border border-purple-500/20 relative z-10 shadow-[0_0_50px_rgba(168,85,247,0.15)] bg-black/70 backdrop-blur-xl">
          <div className="space-y-3">
            <span className="font-label-caps text-xs text-purple-400 tracking-widest block font-bold">IDENTITY CONFIRMATION</span>
            <h2 className="font-display-lg text-3xl md:text-4xl text-white font-extrabold tracking-tight uppercase">
              Member ID Portal
            </h2>
            <p className="font-body-md text-slate-300 max-w-sm mx-auto text-sm">
              Please authenticate using your registered email address to access the digital ID Card System.
            </p>
          </div>

          {authError && (
            <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/30 text-red-400 text-sm font-body-md text-left flex items-start gap-3">
              <span className="material-symbols-outlined text-red-500 text-lg shrink-0 mt-0.5">lock_hazard</span>
              <div>
                <strong className="block font-bold">AUTHENTICATION ERROR</strong>
                <span className="opacity-95">{authError}</span>
              </div>
            </div>
          )}

          <div className="space-y-3 pt-2">
            <button
              onClick={handleLogin}
              className="w-full bg-white text-black font-extrabold py-4 px-8 rounded-2xl shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:bg-slate-100 hover:scale-[1.01] active:scale-98 transition-all flex items-center justify-center gap-3 font-label-caps text-xs tracking-wider"
            >
              <span className="material-symbols-outlined font-bold text-black">login</span>
              <span>AUTHENTICATE WITH GOOGLE</span>
            </button>

            <button
              onClick={onRedirect}
              className="w-full bg-black/40 border border-purple-500/30 hover:border-purple-400 text-slate-300 hover:text-white py-3.5 px-8 rounded-2xl transition-all flex items-center justify-center gap-3 text-xs font-bold font-label-caps tracking-wider"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              <span>BACK TO DASHBOARD</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-grow min-h-screen relative overflow-hidden text-left bg-mesh">
      <section className="max-w-6xl mx-auto px-4 py-12 md:py-20">
        
        {/* Header Section */}
        <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="text-left">
            <span className="font-label-caps text-xs text-primary tracking-widest block mb-2 font-bold">
              VRGC SECURE DOSSIER REGISTRY
            </span>
            <h2 className="font-display-lg text-3xl md:text-5xl mb-4 text-white font-extrabold tracking-tight uppercase">
              ID CARD ISSUANCE
            </h2>
            <p className="font-body-lg text-on-surface-variant max-w-xl text-sm md:text-base leading-relaxed">
              Verify your candidate records and upload your profile photo to register your digital ID Card.
            </p>
          </div>

          <div className="flex flex-wrap gap-4 self-start md:self-end z-20">
            <button
              onClick={handleLogout}
              className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 hover:border-red-500/50 px-5 py-2.5 rounded-full text-xs font-label-caps tracking-wider transition-all flex items-center gap-2 font-bold"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              <span>LOGOUT</span>
            </button>
          </div>
        </header>

        {/* Tab Headers (Admins Only) */}
        {isAdmin && (
          <div className="flex border-b border-outline-variant/30 mb-8 relative z-20">
            <button
              onClick={() => setActiveSubTab('portal')}
              className={`px-6 py-3 font-label-caps tracking-wider text-xs md:text-sm font-bold border-b-2 transition-all duration-300 ${
                activeSubTab === 'portal'
                  ? 'border-primary text-primary shadow-[0_4px_12px_rgba(207,92,255,0.15)]'
                  : 'border-transparent text-on-surface-variant hover:text-white'
              }`}
            >
              ID CARD PORTAL
            </button>
            <button
              onClick={() => setActiveSubTab('admin')}
              className={`px-6 py-3 font-label-caps tracking-wider text-xs md:text-sm font-bold border-b-2 transition-all duration-300 flex items-center gap-1.5 ${
                activeSubTab === 'admin'
                  ? 'border-red-500 text-red-400 shadow-[0_4px_12px_rgba(239,68,68,0.25)]'
                  : 'border-transparent text-red-400/80 hover:text-red-400'
              }`}
            >
              <span className="material-symbols-outlined text-sm text-red-400">admin_panel_settings</span>
              <span>ADMIN DASHBOARD</span>
            </button>
          </div>
        )}

        {/* SUB TAB 1: PORTAL */}
        {activeSubTab === 'portal' && (
          <div className="space-y-6">
            {existingSubmission ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 stagger-in">
                {/* 3D Flip Card Container */}
                <div 
                  onClick={() => setIsFlipped(!isFlipped)}
                  className="relative w-full max-w-[340px] aspect-[2.2/3.4] cursor-pointer group [perspective:1000px]"
                >
                  <div className={`relative w-full h-full duration-700 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                    
                    {/* FRONT OF THE ID CARD */}
                    <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] select-none">
                      <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-6 flex flex-col justify-between shadow-[0_0_50px_rgba(168,85,247,0.25)]">
                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none opacity-40"></div>
                        
                        <div className="absolute top-3 left-3 w-3 h-3 border-t-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute top-3 right-3 w-3 h-3 border-t-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute bottom-3 left-3 w-3 h-3 border-b-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute bottom-3 right-3 w-3 h-3 border-b-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>

                        <div className="flex justify-between items-start border-b border-[#a855f7]/25 pb-3 relative z-10">
                          <div className="text-left w-full">
                            <div className="flex items-center gap-1 justify-center">
                              <span className="material-symbols-outlined text-[14px] text-[#a855f7]">sports_esports</span>
                              <h4 className="font-display-lg text-sm text-white font-black tracking-widest leading-none">VRGC</h4>
                            </div>
                            <span className="text-[#a855f7]/80 text-[5px] font-code-sm tracking-wider uppercase block mt-1 font-bold text-center">VIRTUAL REALITY & GAMING CLUB</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-center justify-center my-3 relative z-10">
                          <div className="w-36 h-36 rounded-2xl border-2 border-[#a855f7]/30 p-1 bg-black/40 shadow-[0_0_20px_rgba(168,85,247,0.15)] relative overflow-hidden">
                            <img 
                              src={existingSubmission.photoUrl} 
                              alt="Member Avatar" 
                              className="w-full h-full object-cover rounded-xl"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute bottom-1 right-1 bg-gradient-to-r from-[#a855f7]/80 to-[#cf5cff]/80 text-white text-[6px] font-black px-1.5 py-0.5 rounded tracking-widest uppercase shadow-md pointer-events-none opacity-85">
                              VERIFIED
                            </div>
                          </div>
                        </div>

                        <div className="bg-[#0b0512]/90 border border-[#a855f7]/25 p-3 rounded-2xl relative z-10 space-y-2.5">
                          <div className="border-b border-white/5 pb-1.5 text-left">
                            <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">NAME</span>
                            <h3 className="font-display-lg text-sm text-white font-extrabold tracking-wide uppercase truncate leading-none">
                              {existingSubmission.name}
                            </h3>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-left">
                            <div>
                              <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">REGISTRATION NO.</span>
                              <span className="font-code-sm text-[10px] text-white font-bold tracking-wider block">
                                {existingSubmission.registrationNumber}
                              </span>
                            </div>
                            <div>
                              {(() => {
                                const displayInfo = getAdminDisplayRoleOrTeam(existingSubmission.team, existingSubmission.position);
                                return (
                                  <>
                                    <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">{displayInfo.label === 'TEAM / DIVISION' ? 'TEAM' : displayInfo.label}</span>
                                    <span className="font-code-sm text-[10px] text-white font-bold tracking-wider block uppercase truncate">
                                      {displayInfo.value}
                                    </span>
                                  </>
                                );
                              })()}
                            </div>
                          </div>

                          <div className="pt-1.5 border-t border-white/5 flex items-center gap-1.5 justify-start">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] shadow-[0_0_8px_#a855f7] animate-pulse"></span>
                            <span className="font-code-sm text-[8px] text-[#ddb7ff] font-extrabold uppercase tracking-widest leading-none">
                              {(() => {
                                const displayInfo = getAdminDisplayRoleOrTeam(existingSubmission.team, existingSubmission.position);
                                return displayInfo.isSpecial ? displayInfo.value : (existingSubmission.position || 'CORE MEMBER');
                              })()}
                            </span>
                          </div>
                        </div>

                        <div className="absolute bottom-1 right-2 text-[5px] font-bold text-white/20 font-code-sm uppercase tracking-widest pointer-events-none">
                          TAP TO FLIP
                        </div>
                      </div>
                    </div>

                    {/* BACK OF THE ID CARD */}
                    <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] select-none">
                      <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-6 flex flex-col justify-between shadow-[0_0_50px_rgba(168,85,247,0.25)]">
                        {existingSubmission.avatarUrl && (
                          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none rounded-3xl">
                            <img 
                              src={existingSubmission.avatarUrl} 
                              alt="Avatar Watermark" 
                              className="w-full h-full object-cover opacity-95 brightness-110 contrast-105"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-[#05010a]/10 bg-gradient-to-b from-transparent via-[#05010a]/20 to-[#05010a]/50"></div>
                          </div>
                        )}

                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none opacity-40"></div>
                        
                        <div className="absolute top-3 left-3 w-3 h-3 border-t-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute top-3 right-3 w-3 h-3 border-t-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute bottom-3 left-3 w-3 h-3 border-b-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute bottom-3 right-3 w-3 h-3 border-b-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>

                        <div className="text-center relative z-10 border-b border-[#a855f7]/25 pb-2">
                          <h4 className="font-display-lg text-sm text-white font-black tracking-widest uppercase">VRGC</h4>
                          <span className="font-code-sm text-[5px] text-[#a855f7]/80 tracking-wider block mt-0.5">VIRTUAL REALITY & GAMING CLUB</span>
                        </div>

                        <div className="my-3 flex flex-col items-center justify-center relative z-10">
                          <div className="w-28 h-28 rounded-xl border border-white/10 bg-white p-1.5 shadow-[0_0_25px_rgba(168,85,247,0.25)]">
                            <img 
                              src={getQrCodeImageUrl(existingSubmission.registrationNumber, existingSubmission.qrCodeUrl)} 
                              alt="Scan to Verify" 
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <span className="font-code-sm text-[6px] text-[#a855f7] font-black uppercase tracking-widest block mt-2">SCAN TO CONNECT</span>
                        </div>

                        <div className="space-y-1.5 border-t border-[#a855f7]/25 pt-2.5 relative z-10 text-[7px] font-code-sm text-white/70 text-left w-full pl-2">
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[10px] text-[#a855f7]">alternate_email</span>
                            <span>@vrgc_official</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[10px] text-[#a855f7]">forum</span>
                            <span>discord.gg/vrgc</span>
                          </div>
                        </div>

                        <div className="text-center text-[7px] font-extrabold text-[#a855f7]/80 tracking-widest mt-2.5 uppercase relative z-10">
                          PLAY • CREATE • INNOVATE
                        </div>

                        <div className="absolute bottom-1 right-2 text-[5px] font-bold text-white/20 font-code-sm uppercase tracking-widest pointer-events-none">
                          TAP TO FLIP
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                <div className="border-t border-white/5 pt-4 mt-6 flex flex-col items-center gap-2">
                  <div className="flex items-center gap-1 text-[10px] text-green-400 font-bold bg-green-500/5 px-2.5 py-1 rounded-full border border-green-500/20">
                    <span className="material-symbols-outlined text-xs">verified</span>
                    <span>DOSSIER ACTIVE (RESPONSE RECORDED)</span>
                  </div>
                  
                  <div className="flex gap-4 mt-2">
                    <button
                      onClick={() => handleDownload(existingSubmission)}
                      className="group flex items-center gap-2 px-6 py-2.5 rounded-full border border-[#a855f7]/30 hover:border-[#a855f7] hover:text-white transition-all text-xs font-bold font-label-caps bg-black/40"
                    >
                      <span className="material-symbols-outlined text-sm">download</span>
                      <span>DOWNLOAD PHOTO</span>
                    </button>
                    {existingSubmission.avatarUrl && (
                      <button
                        onClick={() => handleDownloadAvatar(existingSubmission)}
                        className="group flex items-center gap-2 px-6 py-2.5 rounded-full border border-[#a855f7]/30 hover:border-[#a855f7] hover:text-white transition-all text-xs font-bold font-label-caps bg-black/40"
                      >
                        <span className={`material-symbols-outlined text-sm ${downloadingAvatarId === (existingSubmission.id || existingSubmission.email) ? 'animate-spin' : ''}`}>
                          {downloadingAvatarId === (existingSubmission.id || existingSubmission.email) ? 'sync' : 'sports_esports'}
                        </span>
                        <span>DOWNLOAD AVATAR</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* FORM SUBMISSION VIEW (FIRST TIME) */
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start stagger-in">
                {/* Live Preview Card */}
                <div className="lg:col-span-5 flex flex-col items-center gap-6">
                  <div className="w-full flex justify-between items-center">
                    <h3 className="font-label-caps text-xs text-outline tracking-wider font-bold">LIVE PREVIEW</h3>
                    <span className="text-[10px] text-[#a855f7] font-bold uppercase tracking-widest font-code-sm">TAP CARD TO FLIP</span>
                  </div>
                  
                  <div 
                    onClick={() => setIsPreviewFlipped(!isPreviewFlipped)}
                    className="relative w-full max-w-[320px] aspect-[2.2/3.4] cursor-pointer group [perspective:1000px]"
                  >
                    <div className={`relative w-full h-full duration-700 [transform-style:preserve-3d] ${isPreviewFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                      
                      {/* FRONT PREVIEW */}
                      <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] select-none">
                        <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-6 flex flex-col justify-between shadow-[0_0_40px_rgba(168,85,247,0.15)]">
                          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none opacity-40"></div>
                          
                          <div className="absolute top-3 left-3 w-3 h-3 border-t-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                          <div className="absolute top-3 right-3 w-3 h-3 border-t-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>
                          <div className="absolute bottom-3 left-3 w-3 h-3 border-b-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                          <div className="absolute bottom-3 right-3 w-3 h-3 border-b-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>

                          <div className="flex justify-between items-start border-b border-[#a855f7]/25 pb-3 relative z-10">
                            <div className="text-left w-full">
                              <div className="flex items-center gap-1 justify-center">
                                <span className="material-symbols-outlined text-[14px] text-[#a855f7]">sports_esports</span>
                                <h4 className="font-display-lg text-sm text-white font-black tracking-widest leading-none">VRGC</h4>
                              </div>
                              <span className="text-[#a855f7]/80 text-[5px] font-code-sm tracking-wider uppercase block mt-1 font-bold text-center">VIRTUAL REALITY & GAMING CLUB</span>
                            </div>
                          </div>

                          <div className="flex flex-col items-center justify-center my-3 relative z-10">
                            <div className="w-36 h-36 rounded-2xl border-2 border-dashed border-[#a855f7]/30 p-1 bg-black/40 shadow-[0_0_20px_rgba(168,85,247,0.15)] relative overflow-hidden flex items-center justify-center">
                              {photoPreview ? (
                                <img 
                                  src={photoPreview} 
                                  alt="ID Preview" 
                                  className="w-full h-full object-cover rounded-xl"
                                />
                              ) : (
                                <div className="text-center p-4 space-y-1 text-white/40">
                                  <span className="material-symbols-outlined text-[#a855f7]/55 text-3xl animate-pulse">face</span>
                                  <p className="font-code-sm text-[8px] tracking-widest uppercase font-bold text-white/50">UPLOAD IMAGE</p>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="bg-[#0b0512]/90 border border-[#a855f7]/25 p-3 rounded-2xl relative z-10 space-y-2.5">
                            <div className="border-b border-white/5 pb-1.5 text-left">
                              <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">NAME</span>
                              <h3 className="font-display-lg text-sm text-white font-extrabold tracking-wide uppercase truncate leading-none">
                                {memberData?.name || 'FULL NAME'}
                              </h3>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-left">
                              <div>
                                <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">REGISTRATION NO.</span>
                                <span className="font-code-sm text-[10px] text-white font-bold tracking-wider block">
                                  {memberData?.registrationNumber || '24XXXXXX'}
                                </span>
                              </div>
                              <div>
                                {(() => {
                                  const displayInfo = getAdminDisplayRoleOrTeam(memberData?.team, memberData?.position);
                                  return (
                                    <>
                                      <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">{displayInfo.label === 'TEAM / DIVISION' ? 'TEAM' : displayInfo.label}</span>
                                      <span className="font-code-sm text-[10px] text-white font-bold tracking-wider block uppercase truncate">
                                        {displayInfo.value || 'TECH/DESIGN'}
                                      </span>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>

                            <div className="pt-1.5 border-t border-white/5 flex items-center gap-1.5 justify-start">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] shadow-[0_0_8px_#a855f7] animate-pulse"></span>
                              <span className="font-code-sm text-[8px] text-[#ddb7ff] font-extrabold uppercase tracking-widest leading-none">
                                {(() => {
                                  const displayInfo = getAdminDisplayRoleOrTeam(memberData?.team, memberData?.position);
                                  return displayInfo.isSpecial ? displayInfo.value : (memberData?.position || 'CORE MEMBER');
                                })()}
                              </span>
                            </div>
                          </div>

                          <div className="absolute bottom-1 right-2 text-[5px] font-bold text-white/20 font-code-sm uppercase tracking-widest pointer-events-none">
                            TAP TO FLIP
                          </div>
                        </div>
                      </div>

                      {/* BACK PREVIEW */}
                      <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] select-none">
                        <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-6 flex flex-col justify-between shadow-[0_0_40px_rgba(168,85,247,0.15)]">
                          {avatarPreview && (
                            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none rounded-3xl">
                              <img 
                                src={avatarPreview} 
                                alt="Avatar Watermark Preview" 
                                className="w-full h-full object-cover opacity-95 brightness-110 contrast-105"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-[#05010a]/10 bg-gradient-to-b from-transparent via-[#05010a]/20 to-[#05010a]/50"></div>
                            </div>
                          )}

                          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none opacity-40"></div>
                          
                          <div className="absolute top-3 left-3 w-3 h-3 border-t-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                          <div className="absolute top-3 right-3 w-3 h-3 border-t-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>
                          <div className="absolute bottom-3 left-3 w-3 h-3 border-b-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                          <div className="absolute bottom-3 right-3 w-3 h-3 border-b-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>

                          <div className="text-center relative z-10 border-b border-[#a855f7]/25 pb-2">
                            <h4 className="font-display-lg text-sm text-white font-black tracking-widest uppercase">VRGC</h4>
                            <span className="font-code-sm text-[5px] text-[#a855f7]/80 tracking-wider block mt-0.5">VIRTUAL REALITY & GAMING CLUB</span>
                          </div>

                          <div className="my-3 flex flex-col items-center justify-center relative z-10">
                            <div className="w-28 h-28 rounded-xl border border-white/10 bg-white p-1.5 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
                              <img 
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(`${typeof window !== 'undefined' ? window.location.origin : 'https://vrgc.club'}/card/${memberData?.registrationNumber || '24XXXXXX'}`)}`} 
                                alt="Scan to Verify" 
                                className="w-full h-full object-contain"
                              />
                            </div>
                            <span className="font-code-sm text-[6px] text-[#a855f7] font-black uppercase tracking-widest block mt-2">SCAN TO VERIFY</span>
                          </div>

                          <div className="space-y-1.5 border-t border-[#a855f7]/25 pt-2.5 relative z-10 text-[7px] font-code-sm text-white/70 text-left w-full pl-2">
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[10px] text-[#a855f7]">alternate_email</span>
                              <span>@vrgc_official</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[10px] text-[#a855f7]">forum</span>
                              <span>discord.gg/vrgc</span>
                            </div>
                          </div>

                          <div className="text-center text-[7px] font-extrabold text-[#a855f7]/80 tracking-widest mt-2.5 uppercase relative z-10">
                            PLAY • CREATE • INNOVATE
                          </div>

                          <div className="absolute bottom-1 right-2 text-[5px] font-bold text-white/20 font-code-sm uppercase tracking-widest pointer-events-none">
                            TAP TO FLIP
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>

                {/* Form Fields */}
                <div className="lg:col-span-7 space-y-6">
                  <form onSubmit={handleSubmit} className="glass-panel p-6 md:p-8 rounded-2xl space-y-8 border border-purple-500/20 text-left bg-black/70 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.8)]">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block font-label-caps text-[10px] text-purple-300 mb-2 tracking-widest font-bold">&nbsp;&nbsp;MEMBER FULL NAME : </label>
                        <input
                          readOnly
                          value={memberData?.name || ''}
                          className="w-full bg-black/80 border border-white/10 rounded-xl px-4 py-2.5 text-white/90 font-body-md focus:outline-none cursor-not-allowed text-xs md:text-sm"
                          type="text"
                        />
                      </div>
                      <div>
                        <label className="block font-label-caps text-[10px] text-purple-300 mb-2 tracking-widest font-bold">&nbsp;&nbsp;REGISTRATION NUMBER : </label>
                        <input
                          readOnly
                          value={memberData?.registrationNumber || ''}
                          className="w-full bg-black/80 border border-white/10 rounded-xl px-4 py-2.5 text-purple-400 font-code-sm focus:outline-none cursor-not-allowed uppercase text-xs md:text-sm"
                          type="text"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block font-label-caps text-[10px] text-purple-300 mb-2 tracking-widest font-bold">&nbsp;&nbsp;CONTACT : </label>
                        <input
                          readOnly
                          value={memberData?.phone || ''}
                          className="w-full bg-black/80 border border-white/10 rounded-xl px-4 py-2.5 text-white/90 font-body-md focus:outline-none cursor-not-allowed text-xs md:text-sm"
                          type="text"
                        />
                      </div>
                      <div>
                        <label className="block font-label-caps text-[10px] text-purple-300 mb-2 tracking-widest font-bold">&nbsp;&nbsp;ASSIGNED TEAM : </label>
                        <input
                          readOnly
                          value={memberData?.team || ''}
                          className="w-full bg-black/80 border border-white/10 rounded-xl px-4 py-2.5 text-white/90 font-body-md focus:outline-none cursor-not-allowed text-xs md:text-sm"
                          type="text"
                        />
                      </div>
                      <div>
                        <label className="block font-label-caps text-[10px] text-purple-300 mb-2 tracking-widest font-bold">&nbsp;&nbsp;ROLE / POSITION : </label>
                        <input
                          readOnly
                          value={memberData?.position || 'Member'}
                          className="w-full bg-black/80 border border-white/10 rounded-xl px-4 py-2.5 text-white/90 font-body-md focus:outline-none cursor-not-allowed uppercase text-xs md:text-sm"
                          type="text"
                        />
                      </div>
                    </div>

                    {/* Image Selection - Perfectly Matched Height Level */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                      <div className="flex flex-col space-y-2 h-full">
                        <label className="block font-label-caps text-[10px] text-purple-300 tracking-widest font-bold uppercase truncate">
                        &nbsp;UPLOAD IDENTIFICATION PHOTO :
                        </label>
                        <div className="border-2 border-dashed border-purple-500/30 hover:border-purple-400/60 rounded-2xl p-5 transition-all duration-300 bg-black/60 hover:bg-black/80 relative flex-1 min-h-[140px] flex flex-col items-center justify-center text-center cursor-pointer">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoChange}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                          <span className="material-symbols-outlined text-3xl text-purple-400/80 mb-1">cloud_upload</span>
                          <p className="font-body-md text-xs text-white/90 font-bold truncate max-w-[200px]">
                            {photoFile ? photoFile.name : "Choose Profile Image"}
                          </p>
                          <p className="font-code-sm text-[9px] text-slate-400 mt-1">PNG, JPG, or WEBP up to 5MB</p>
                        </div>
                      </div>

                      <div className="flex flex-col space-y-2 h-full">
                        <label className="block font-label-caps text-[10px] text-purple-300 tracking-widest font-bold uppercase truncate">
                        &nbsp;UPLOAD GAMING AVATAR (FOR BACKSIDE) :
                        </label>
                        <div className="border-2 border-dashed border-purple-500/30 hover:border-purple-400/60 rounded-2xl p-4 transition-all duration-300 bg-black/60 hover:bg-black/80 relative flex-1 min-h-[110px] flex flex-col items-center justify-center text-center cursor-pointer">
                          <input
                            type="file"
                            accept="image/*,image/gif"
                            onChange={handleAvatarChange}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                          {avatarPreview ? (
                            <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-yellow-400/80 shadow-[0_0_15px_rgba(234,179,8,0.3)]">
                              <img 
                                src={avatarPreview} 
                                alt="Avatar Preview" 
                                className="w-full h-full object-cover" 
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          ) : (
                            <>
                              <span className="material-symbols-outlined text-2xl text-purple-400/80 mb-0.5">sports_esports</span>
                              <p className="font-body-md text-xs text-white/90 font-bold truncate max-w-[200px]">
                                {avatarFile ? avatarFile.name : "Choose File (PNG/JPG/GIF)"}
                              </p>
                              <p className="font-code-sm text-[9px] text-slate-400 mt-0.5">Up to 5MB file upload</p>
                            </>
                          )}
                        </div>

                        {/* Direct GIF / Avatar URL Input */}
                        <div className="pt-1">
                          <label className="block text-[9px] font-label-caps text-purple-300/80 mb-1 tracking-wider font-bold">
                          &nbsp;OR PASTE DIRECT GIF / IMAGE URL &nbsp;LINK:
                          </label>
                          <div className="relative">
                            <input
                              type="url"
                              placeholder="https://media.giphy.com/media/.../giphy.gif"
                              value={avatarUrlInput}
                              onChange={(e) => {
                                let url = e.target.value.trim();
                                setAvatarUrlInput(url);
                                if (url) {
                                  // Auto-format Giphy webpage URLs to direct raw GIF URLs
                                  if (url.includes('giphy.com/gifs/')) {
                                    const parts = url.split('-');
                                    const gifId = parts[parts.length - 1];
                                    if (gifId) url = `https://media.giphy.com/media/${gifId}/giphy.gif`;
                                  }
                                  setAvatarPreview(url);
                                } else if (!avatarFile) {
                                  setAvatarPreview(null);
                                }
                              }}
                              className="w-full bg-black/80 border border-purple-500/30 rounded-xl px-3 py-2 text-[11px] text-white focus:outline-none focus:border-purple-400 font-code-sm placeholder:text-slate-500"
                            />
                            {avatarUrlInput && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAvatarUrlInput('');
                                  setAvatarFile(null);
                                  setAvatarPreview(null);
                                }}
                                className="absolute right-2 top-2 text-slate-400 hover:text-white"
                              >
                                <span className="material-symbols-outlined text-sm">cancel</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {submitError && (
                      <div className="bg-error/10 border border-error/30 text-error px-4 py-3 rounded-xl text-xs font-body-md">
                        {submitError}
                      </div>
                    )}

                    <div className="pt-6 border-t border-outline-variant/20 flex flex-col sm:flex-row gap-4 items-center justify-between">
                      <span className="font-code-sm text-[9px] text-on-surface-variant text-center sm:text-left">
                        SUBMITTING THIS FORM REGISTERS A SINGLE PORTAL RESPONSE.
                      </span>

                      <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-4 items-center">
                        <button
                          type="button"
                          onClick={() => setShowReportModal(true)}
                          className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-[#262626] text-red-400 border border-red-500/20 hover:border-red-500/40 font-bold py-3.5 px-6 rounded-full text-xs transition-all flex items-center justify-center gap-2"
                        >
                          <span className="material-symbols-outlined text-sm">report_problem</span>
                          <span>REPORT ERROR</span>
                        </button>

                        <button
                          disabled={isSubmitting ||!photoFile || (!avatarFile && !avatarUrlInput.trim())}
                          className={`w-full sm:w-auto font-bold py-3.5 px-8 rounded-full transition-all flex items-center justify-center gap-2 text-xs font-label-caps tracking-widest uppercase ${
  isSubmitting ||
  !photoFile ||
  (!avatarFile && !avatarUrlInput.trim())
    ? 'bg-white/5 text-white/40 border border-white/10 cursor-not-allowed'
    : 'bg-white/5 hover:bg-white/15 text-white border border-white/25 hover:border-white/50 shadow-[0_0_20px_rgba(255,255,255,0.05)] hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] hover:scale-[1.01] active:scale-95'
}`}
                        >
                          {isSubmitting ? (
                            <>
                              <span className="material-symbols-outlined animate-spin text-sm text-white">sync</span> REGISTERING...
                            </>
                          ) : (
                            'SUBMIT DOSSIER'
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUB TAB 2: ADMIN DASHBOARD */}
        {activeSubTab === 'admin' && isAdmin && (
          <div className="space-y-6 stagger-in text-left">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/5 pb-4">
              <div>
                <h3 className="font-display-lg text-lg text-white font-bold uppercase tracking-wider flex flex-wrap items-center gap-2.5">
                  <span className="material-symbols-outlined text-primary text-base">admin_panel_settings</span>
                  <span>Candidate Dossier Submissions</span>
                  <span className="px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs font-bold font-code-sm shadow-[0_0_15px_rgba(168,85,247,0.2)] flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    {candidates.length} / {loadedMembersList.length  || 48} REGISTERED
                  </span>
                </h3>
                <p className="text-xs text-on-surface-variant max-w-lg mt-0.5">
                  Select and verify candidate digital identity dossiers.
                </p>
              </div>

              <button
                disabled={isSyncingSheets || sheetsCooldown > 0}
                onClick={handleSyncAllToSheets}
                className={`px-4 py-2.5 rounded-xl border text-xs font-label-caps tracking-wider flex items-center justify-center gap-2 shrink-0 transition-all duration-300 font-bold ${
                  sheetsCooldown > 0 || isSyncingSheets
                    ? 'bg-black/40 border-outline-variant/30 text-on-surface-variant/50 cursor-not-allowed'
                    : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)] active:scale-95'
                }`}
              >
                <span className={`material-symbols-outlined text-base ${isSyncingSheets ? 'animate-spin text-emerald-400' : ''}`}>
                  {isSyncingSheets ? 'sync' : sheetsCooldown > 0 ? 'hourglass_top' : 'cloud_upload'}
                </span>
                <span>
                  {isSyncingSheets 
                    ? 'PARALLEL SYNCING...' 
                    : sheetsCooldown > 0 
                      ? `COOLDOWN (${sheetsCooldown}s)` 
                      : 'SYNC TO GOOGLE SHEETS'}
                </span>
              </button>
            </div>

            {/* ADMIN SUB-SECTION TABS */}
            <div className="flex items-center gap-2.5 border-b border-white/10 pb-3">
              <button
                onClick={() => setAdminSectionTab('dossiers')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold font-label-caps tracking-wider flex items-center gap-2 transition-all duration-200 ${
                  adminSectionTab === 'dossiers'
                    ? 'bg-primary/20 border border-primary/40 text-white shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                    : 'bg-black/30 border border-white/5 text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="material-symbols-outlined text-base">badge</span>
                <span>DOSSIERS ({candidates.length})</span>
              </button>

              <button
                onClick={() => setAdminSectionTab('logs')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold font-label-caps tracking-wider flex items-center gap-2 transition-all duration-200 ${
                  adminSectionTab === 'logs'
                    ? 'bg-primary/20 border border-primary/40 text-white shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                    : 'bg-black/30 border border-white/5 text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="material-symbols-outlined text-base">history</span>
                <span>ACTIVITY LOGS ({adminLogs.length})</span>
              </button>
            </div>

            {adminSectionTab === 'dossiers' && (
              <div className="space-y-6">
                <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-white/5 bg-white/5 flex flex-col md:flex-row md:items-center gap-3 sm:gap-4">
              <div className="relative flex-1 w-full">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-outline text-sm">search</span>
                <input
                  type="text"
                  placeholder="Search candidate name, registration number, or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-black/30 border border-outline-variant/30 rounded-lg pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-primary placeholder:text-white/25 transition-all duration-300"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between md:justify-end gap-3 shrink-0 w-full md:w-auto">
                <div className="flex items-center gap-2 min-w-0">
                  <label className="text-[10px] font-label-caps text-outline tracking-wider font-bold shrink-0">TEAM:</label>
                  <select
                    value={selectedTeam}
                    onChange={(e) => setSelectedTeam(e.target.value)}
                    className="w-full sm:w-auto bg-black/50 border border-outline-variant/30 text-white rounded-lg px-3 py-1.5 text-xs focus:ring-0 focus:border-primary cursor-pointer hover:bg-black/80 font-label-caps shrink-0"
                  >
                    <option value="All">All Teams</option>
                    <option value="Design">Design</option>
                    <option value="Education">Education</option>
                    <option value="Esports (PC)">Esports (PC)</option>
                    <option value="Esports (Mobile)">Esports (Mobile)</option>
                    <option value="PR">PR</option>
                    <option value="Social Media">Social Media</option>
                    <option value="Technical">Technical</option>
                    <option value="Management">Management</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-label-caps text-outline tracking-wider font-bold">
                    STATUS:
                  </label>

                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="w-full sm:w-auto bg-black/50 border border-outline-variant/30 text-white rounded-lg px-3 py-1.5 text-xs focus:ring-0 focus:border-primary cursor-pointer hover:bg-black/80 font-label-caps"
                  >
                    <option value="All">All</option>
                    <option value="Pending">Pending</option>
                    <option value="Approved">Approved</option>
                  </select>
                </div>

                {/* 3D Card View Push Button Switch (Logo Only) */}
                <button
                  type="button"
                  onClick={() => setAdminViewMode(prev => prev === 'cards' ? 'list' : 'cards')}
                  className="p-2 rounded-lg bg-black/40 border border-white/10 text-white/80 hover:text-white hover:border-primary/50 transition-all duration-300 flex items-center justify-center shrink-0 active:scale-95"
                  title={adminViewMode === 'cards' ? 'Switch to List View' : 'Switch to 3D Cards View'}
                >
                  <span className="material-symbols-outlined text-lg">
                    {adminViewMode === 'cards' ? 'format_list_bulleted' : 'style'}
                  </span>
                </button>
              </div>
            </div>

            <div className="glass-panel p-4 rounded-2xl relative space-y-4 pb-28 sm:pb-16">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-3 border-b border-white/5 text-xs text-on-surface-variant font-code-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-white/80 font-bold">TOTAL REGISTERED:</span>
                  <span className="text-primary font-black text-sm">{candidates.length}</span>
                  <span className="text-white/40 font-bold">/ {loadedMembersList.length  || 48}</span>
                </div>
                {filteredCandidates.length !== candidates.length && (
                  <div className="text-purple-300/90 text-[11px] font-medium bg-purple-500/10 border border-purple-500/20 px-2.5 py-0.5 rounded-full">
                    Showing {filteredCandidates.length} filtered candidate{filteredCandidates.length === 1 ? '' : 's'}
                  </div>
                )}
              </div>

              <div className="space-y-4 relative z-10">
                {loadingData ? (
                  <div className="py-12 text-center text-on-surface-variant font-code-sm animate-pulse">
                    LOADING SECURE RECORDS...
                  </div>
                ) : filteredCandidates.length === 0 ? (
                  <div className="py-16 text-center text-on-surface-variant italic text-xs md:text-sm">
                    No matching candidate ID dossiers found.
                  </div>
                ) : adminViewMode === 'list' ? (
                  <>
                    <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 border-b border-outline-variant/20 text-xs text-on-surface-variant font-label-caps tracking-widest font-bold">
                      <div className="col-span-3">CANDIDATE</div>
                      <div className="col-span-3">CONTACT / TEAM</div>
                      <div className="col-span-2 text-center">SUBMITTED</div>
                      <div className="col-span-2 text-center">STATUS</div>
                      <div className="col-span-2 text-right">ACTIONS</div>
                    </div>

                    {filteredCandidates.map((c, index) => {
                      const submissionDate = c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : "N/A";
                      const display = getAdminDisplayRoleOrTeam(c.team, c.position);
                      const isNearBottom = index >= Math.max(1, filteredCandidates.length - 2);

                      return (
                        <div
                          key={c.id || c.email}
                          onClick={() => {
                            setPreviewCandidate(c);
                            setPreviewModalTab('details');
                            setPreviewFlipped(false);
                          }}
                          className="rounded-xl border border-white/5 bg-white/5 hover:border-primary/30 hover:bg-white/10 transition-all duration-200 cursor-pointer overflow-visible"
                        >
                          {/* DESKTOP TABLE ROW VIEW */}
                          <div className="hidden md:grid grid-cols-12 gap-4 p-4 items-center">
                            <div className="col-span-3 flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-lg border border-primary/30 bg-black/40 overflow-hidden shrink-0">
                                <img src={c.photoUrl} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-bold text-white text-sm truncate">{c.name}</div>
                                <div className="text-xs text-primary font-code-sm">{c.registrationNumber}</div>
                              </div>
                            </div>

                            <div className="col-span-3 text-xs text-on-surface-variant font-code-sm space-y-0.5 min-w-0">
                              <div className="truncate text-white">{c.email}</div>
                              <div className="truncate">
                                {c.phone || "No Phone"} |{' '}
                                <span className="text-primary font-bold uppercase">
                                  {display.value}
                                </span>
                              </div>
                            </div>

                            <div className="col-span-2 text-center text-xs text-on-surface-variant font-code-sm">
                              {submissionDate}
                            </div>

                            <div className="col-span-2 text-center flex justify-center">
                              <span
                                className={`px-3 py-1 rounded-full border text-[9px] font-label-caps font-bold tracking-wider ${
                                  c.status === 'Approved'
                                    ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                    : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                                }`}
                              >
                                {c.status || 'Pending'}
                              </span>
                            </div>

                            <div className="col-span-2 flex justify-end gap-1.5 relative z-30">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewCandidate(c);
                                  setPreviewModalTab('card');
                                  setPreviewFlipped(false);
                                }}
                                className="p-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all shrink-0"
                                title="View Interactive 3D Card"
                              >
                                <span className="material-symbols-outlined text-sm">style</span>
                              </button>

                              <button
                                onClick={(e) => { e.stopPropagation(); toggleStatus(c); }}
                                className={`p-2 rounded-lg border transition-all shrink-0 ${
                                  c.status === 'Approved'
                                    ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20'
                                    : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                                }`}
                                title={c.status === 'Approved' ? 'Mark as Pending' : 'Approve Dossier'}
                              >
                                <span className="material-symbols-outlined text-sm">
                                  {c.status === 'Approved' ? 'history' : 'verified'}
                                </span>
                              </button>

                              <button
                                disabled={downloadingId === c.id}
                                onClick={(e) => { e.stopPropagation(); handleDownload(c); }}
                                className="p-2 rounded-lg bg-white/5 border border-white/5 text-on-surface-variant hover:text-white hover:border-white/20 transition-all shrink-0"
                                title="Download ID Photo"
                              >
                                <span className={`material-symbols-outlined text-sm ${downloadingId === c.id ? 'animate-spin' : ''}`}>
                                  {downloadingId === c.id ? 'sync' : 'download'}
                                </span>
                              </button>

                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(c); }}
                                className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/40 transition-all shrink-0"
                                title="Delete and Unlock Response"
                              >
                                <span className="material-symbols-outlined text-sm">delete</span>
                              </button>
                            </div>
                          </div>

                          {/* MOBILE CLEAN DOSSIER CARD VIEW */}
                          <div className="flex md:hidden items-center justify-between p-3.5 gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="w-11 h-11 rounded-lg border border-primary/30 bg-black/40 overflow-hidden shrink-0">
                                <img src={c.photoUrl} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="font-bold text-white text-xs truncate">{c.name}</div>
                                <div className="text-[10px] text-primary font-code-sm font-bold truncate">{c.registrationNumber}</div>
                                <div className="text-[10px] text-white/50 font-code-sm truncate">{c.team || display.value}</div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`px-2.5 py-1 rounded-full border text-[9px] font-label-caps font-bold tracking-wider ${
                                  c.status === 'Approved'
                                    ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                    : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                                }`}
                              >
                                {c.status || 'Pending'}
                              </span>
                              <span className="material-symbols-outlined text-white/40 text-sm">chevron_right</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  /* 3D CARDS GRID VIEW FOR ADMIN */
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 py-4">
                    {filteredCandidates.map((c) => {
                      const cardId = c.id || c.email;
                      const isFlipped = !!flippedCardsMap[cardId];
                      const displayInfo = getAdminDisplayRoleOrTeam(c.team, c.position);

                      return (
                        <div key={cardId} className="flex flex-col items-center gap-3">
                          {/* 3D Flippable Card Element */}
                          <div 
                            onClick={() => setFlippedCardsMap(prev => ({ ...prev, [cardId]: !prev[cardId] }))}
                            className="relative w-full max-w-[290px] aspect-[2.2/3.4] cursor-pointer group [perspective:1000px]"
                          >
                            <div className={`relative w-full h-full duration-700 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                              
                              {/* FRONT OF THE ID CARD */}
                              <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] select-none">
                                <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-5 flex flex-col justify-between shadow-[0_0_35px_rgba(168,85,247,0.2)]">
                                  <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none opacity-40"></div>
                                  
                                  <div className="absolute top-2.5 left-2.5 w-2.5 h-2.5 border-t-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                                  <div className="absolute top-2.5 right-2.5 w-2.5 h-2.5 border-t-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>
                                  <div className="absolute bottom-2.5 left-2.5 w-2.5 h-2.5 border-b-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                                  <div className="absolute bottom-2.5 right-2.5 w-2.5 h-2.5 border-b-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>

                                  <div className="flex justify-between items-start border-b border-[#a855f7]/25 pb-2 relative z-10">
                                    <div className="text-left w-full">
                                      <div className="flex items-center gap-1 justify-center">
                                        <span className="material-symbols-outlined text-[12px] text-[#a855f7]">sports_esports</span>
                                        <h4 className="font-display-lg text-xs text-white font-black tracking-widest leading-none">VRGC</h4>
                                      </div>
                                      <span className="text-[#a855f7]/80 text-[4.5px] font-code-sm tracking-wider uppercase block mt-0.5 font-bold text-center">VIRTUAL REALITY & GAMING CLUB</span>
                                    </div>
                                  </div>

                                  <div className="flex flex-col items-center justify-center my-2 relative z-10">
                                    <div className="w-28 h-28 rounded-xl border-2 border-[#a855f7]/30 p-1 bg-black/40 shadow-[0_0_20px_rgba(168,85,247,0.15)] relative overflow-hidden">
                                      <img 
                                        src={c.photoUrl} 
                                        alt={c.name} 
                                        className="w-full h-full object-cover rounded-lg"
                                        referrerPolicy="no-referrer"
                                      />
                                      <div className={`absolute bottom-1 right-1 text-white text-[5px] font-black px-1 py-0.5 rounded tracking-widest uppercase shadow-md pointer-events-none ${
                                        c.status === 'Approved' ? 'bg-green-500/80' : 'bg-yellow-500/80'
                                      }`}>
                                        {c.status === 'Approved' ? 'VERIFIED' : 'PENDING'}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="bg-[#0b0512]/90 border border-[#a855f7]/25 p-2.5 rounded-xl relative z-10 space-y-1.5">
                                    <div className="border-b border-white/5 pb-1 text-left">
                                      <span className="font-code-sm text-[5px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">NAME</span>
                                      <h3 className="font-display-lg text-xs text-white font-extrabold tracking-wide uppercase truncate leading-none">
                                        {c.name}
                                      </h3>
                                    </div>

                                    <div className="grid grid-cols-2 gap-1.5 text-left">
                                      <div>
                                        <span className="font-code-sm text-[5px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">REG NO.</span>
                                        <span className="font-code-sm text-[9px] text-white font-bold tracking-wider block">
                                          {c.registrationNumber}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="font-code-sm text-[5px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">
                                          {displayInfo.label === 'TEAM / DIVISION' ? 'TEAM' : 'ROLE'}
                                        </span>
                                        <span className="font-code-sm text-[9px] text-white font-bold tracking-wider block uppercase truncate">
                                          {displayInfo.value}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="pt-1 border-t border-white/5 flex items-center gap-1 justify-start">
                                      <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] shadow-[0_0_8px_#a855f7] animate-pulse"></span>
                                      <span className="font-code-sm text-[7px] text-[#ddb7ff] font-extrabold uppercase tracking-widest leading-none truncate">
                                        {displayInfo.isSpecial ? displayInfo.value : (c.position || 'MEMBER')}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="absolute bottom-1 right-2 text-[5px] font-bold text-white/30 font-code-sm uppercase tracking-widest pointer-events-none">
                                    TAP TO FLIP 🔄
                                  </div>
                                </div>
                              </div>

                              {/* BACK OF THE ID CARD */}
                              <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] select-none">
                                <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-5 flex flex-col justify-between shadow-[0_0_35px_rgba(168,85,247,0.2)]">
                                  {c.avatarUrl && (
                                    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none rounded-3xl">
                                      <img 
                                        src={c.avatarUrl} 
                                        alt="Avatar Watermark" 
                                        className="w-full h-full object-cover opacity-95 brightness-110 contrast-105"
                                        referrerPolicy="no-referrer"
                                      />
                                      <div className="absolute inset-0 bg-[#05010a]/10 bg-gradient-to-b from-transparent via-[#05010a]/20 to-[#05010a]/50"></div>
                                    </div>
                                  )}

                                  <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none opacity-40"></div>
                                  
                                  <div className="absolute top-2.5 left-2.5 w-2.5 h-2.5 border-t-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                                  <div className="absolute top-2.5 right-2.5 w-2.5 h-2.5 border-t-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>
                                  <div className="absolute bottom-2.5 left-2.5 w-2.5 h-2.5 border-b-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                                  <div className="absolute bottom-2.5 right-2.5 w-2.5 h-2.5 border-b-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>

                                  <div className="text-center relative z-10 border-b border-[#a855f7]/25 pb-1.5">
                                    <h4 className="font-display-lg text-xs text-white font-black tracking-widest uppercase">VRGC</h4>
                                    <span className="font-code-sm text-[4.5px] text-[#a855f7]/80 tracking-wider block mt-0.5">VIRTUAL REALITY & GAMING CLUB</span>
                                  </div>

                                  <div className="my-2 flex flex-col items-center justify-center relative z-10">
                                    <div className="w-24 h-24 rounded-xl border border-white/10 bg-white p-1.5 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
                                      <img 
                                        src={getQrCodeImageUrl(c.registrationNumber, c.qrCodeUrl)}
                                        alt="Scan to Verify" 
                                        className="w-full h-full object-contain"
                                      />
                                    </div>
                                    <span className="font-code-sm text-[5.5px] text-[#a855f7] font-black uppercase tracking-widest block mt-1.5">SCAN TO CONNECT</span>
                                  </div>

                                  <div className="space-y-1 border-t border-[#a855f7]/25 pt-2 relative z-10 text-[6.5px] font-code-sm text-white/70 text-left w-full pl-2">
                                    <div className="flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[9px] text-[#a855f7]">alternate_email</span>
                                      <span>@vrgc_official</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[9px] text-[#a855f7]">forum</span>
                                      <span>discord.gg/vrgc</span>
                                    </div>
                                  </div>

                                  <div className="text-center text-[6px] font-extrabold text-[#a855f7]/80 tracking-widest mt-1.5 uppercase relative z-10">
                                    PLAY • CREATE • INNOVATE
                                  </div>

                                  <div className="absolute bottom-1 right-2 text-[5px] font-bold text-white/30 font-code-sm uppercase tracking-widest pointer-events-none">
                                    TAP TO FLIP 🔄
                                  </div>
                                </div>
                              </div>

                            </div>
                          </div>

                          {/* Quick Admin Actions toolbar under 3D card */}
                          <div className="flex items-center gap-2 bg-black/60 border border-white/10 p-1.5 rounded-xl">
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewCandidate(c);
                                setPreviewModalTab('details');
                                setPreviewFlipped(false);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white text-[10px] font-bold font-label-caps flex items-center gap-1 border border-white/10"
                              title="View Full Dossier"
                            >
                              <span className="material-symbols-outlined text-xs">folder_shared</span>
                              <span>DOSSIER</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleStatus(c)}
                              className={`p-1.5 rounded-lg border transition-all ${
                                c.status === 'Approved'
                                  ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20'
                                  : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                              }`}
                              title={c.status === 'Approved' ? 'Mark as Pending' : 'Approve Dossier'}
                            >
                              <span className="material-symbols-outlined text-xs">
                                {c.status === 'Approved' ? 'history' : 'verified'}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={downloadingId === c.id}
                              onClick={() => handleDownload(c)}
                              className="p-1.5 rounded-lg bg-white/5 border border-white/5 text-on-surface-variant hover:text-white transition-all"
                              title="Download ID Photo"
                            >
                              <span className={`material-symbols-outlined text-xs ${downloadingId === c.id ? 'animate-spin' : ''}`}>
                                {downloadingId === c.id ? 'sync' : 'download'}
                              </span>
                            </button>

                            {c.avatarUrl && (
                              <button
                                type="button"
                                disabled={downloadingAvatarId === (c.id || c.email)}
                                onClick={() => handleDownloadAvatar(c)}
                                className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 hover:text-white transition-all"
                                title="Download Gaming Avatar"
                              >
                                <span className={`material-symbols-outlined text-xs ${downloadingAvatarId === (c.id || c.email) ? 'animate-spin' : ''}`}>
                                  {downloadingAvatarId === (c.id || c.email) ? 'sync' : 'sports_esports'}
                                </span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDelete(c)}
                              className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"
                              title="Delete Dossier"
                            >
                              <span className="material-symbols-outlined text-xs">delete</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

          {/* ADMIN ACTIVITY LOGS SUBTAB */}
            {adminSectionTab === 'logs' && (
              <div className="space-y-4">
                {/* Search & Action Filter Controls */}
                <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-white/5 bg-white/5 flex flex-col md:flex-row md:items-center gap-3 sm:gap-4">
                  <div className="relative flex-1 w-full">
                    <span className="material-symbols-outlined absolute left-3 top-2.5 text-outline text-sm">search</span>
                    <input
                      type="text"
                      placeholder="Search admin email, candidate name, reg number, or details..."
                      value={logSearchQuery}
                      onChange={(e) => setLogSearchQuery(e.target.value)}
                      className="w-full bg-black/30 border border-outline-variant/30 rounded-lg pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-primary placeholder:text-white/25 transition-all duration-300"
                    />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <label className="text-[10px] font-label-caps text-outline tracking-wider font-bold">ACTION TYPE:</label>
                    <select
                      value={logActionFilter}
                      onChange={(e) => setLogActionFilter(e.target.value)}
                      className="bg-black/50 border border-outline-variant/30 text-white rounded-lg px-3 py-1.5 text-xs focus:ring-0 focus:border-primary cursor-pointer hover:bg-black/80 font-label-caps"
                    >
                      <option value="All">All Actions</option>
                      <option value="APPROVE_DOSSIER">Approvals</option>
                      <option value="REVERT_PENDING_DOSSIER">Reversions to Pending</option>
                      <option value="DELETE_DOSSIER">Deletions</option>
                      <option value="FORCE_SHEETS_SYNC">Google Sheets Syncs</option>
                    </select>
                  </div>
                </div>

                {/* Audit Logs Table List */}
                {(() => {
                  const canDeleteLogs = (currentUser?.email || '').toLowerCase() === 'abhinav.25bcy10254@vitbhopal.ac.in';
                  const filteredLogs = adminLogs.filter(log => {
                    const matchesSearch =
                      !logSearchQuery.trim() ||
                      (log.performedBy || '').toLowerCase().includes(logSearchQuery.toLowerCase()) ||
                      (log.targetName || '').toLowerCase().includes(logSearchQuery.toLowerCase()) ||
                      (log.targetRegNo || '').toLowerCase().includes(logSearchQuery.toLowerCase()) ||
                      (log.details || '').toLowerCase().includes(logSearchQuery.toLowerCase());
                    const matchesAction = logActionFilter === 'All' || log.action === logActionFilter;
                    return matchesSearch && matchesAction;
                  });

                  if (filteredLogs.length === 0) {
                    return (
                      <div className="glass-panel p-12 rounded-2xl border border-white/5 bg-white/5 text-center space-y-3">
                        <span className="material-symbols-outlined text-4xl text-white/30">find_in_page</span>
                        <div className="text-white font-bold text-sm">No Activity Logs Found</div>
                        <p className="text-xs text-white/50 max-w-md mx-auto">
                          {logSearchQuery || logActionFilter !== 'All'
                            ? 'No logs match your current search query or action type filter.'
                            : 'All administrative activities (approvals, reversions to pending, deletions, syncs) will automatically record here in real-time.'}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="glass-panel rounded-2xl border border-white/5 bg-black/40 overflow-hidden shadow-2xl">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/10 bg-white/5 text-[10px] font-label-caps text-outline tracking-wider uppercase">
                              <th className="py-3.5 px-4">Timestamp</th>
                              <th className="py-3.5 px-4">Action</th>
                              <th className="py-3.5 px-4">Admin Email</th>
                              <th className="py-3.5 px-4">Target Candidate</th>
                              <th className="py-3.5 px-4">Activity Details</th>
                              {canDeleteLogs && <th className="py-3.5 px-4 text-right">Actions</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-xs">
                            {filteredLogs.map(log => {
                              const dateObj = new Date(log.timestamp);
                              const formattedTime = isNaN(dateObj.getTime())
                                ? log.timestamp
                                : dateObj.toLocaleString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                  });

                              let badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/30';
                              let badgeLabel: string = log.action;
                              let badgeIcon = 'info';

                              if (log.action === 'APPROVE_DOSSIER') {
                                badgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                                badgeLabel = 'APPROVED';
                                badgeIcon = 'verified';
                              } else if (log.action === 'REVERT_PENDING_DOSSIER') {
                                badgeStyle = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                                badgeLabel = 'REVERTED PENDING';
                                badgeIcon = 'history';
                              } else if (log.action === 'DELETE_DOSSIER') {
                                badgeStyle = 'bg-red-500/20 text-red-300 border-red-500/40';
                                badgeLabel = 'DELETED';
                                badgeIcon = 'delete';
                              } else if (log.action === 'FORCE_SHEETS_SYNC') {
                                badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
                                badgeLabel = 'SHEETS SYNC';
                                badgeIcon = 'cloud_upload';
                              }

                              return (
                                <tr key={log.id || log.timestamp + Math.random()} className="hover:bg-white/5 transition-colors">
                                  <td className="py-3.5 px-4 font-code-sm text-[11px] text-white/70 whitespace-nowrap">
                                    {formattedTime}
                                  </td>
                                  <td className="py-3.5 px-4 whitespace-nowrap">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold font-label-caps tracking-wider ${badgeStyle}`}>
                                      <span className="material-symbols-outlined text-xs">{badgeIcon}</span>
                                      <span>{badgeLabel}</span>
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-4 font-bold text-white text-[11px] whitespace-nowrap">
                                    {log.performedBy}
                                  </td>
                                  <td className="py-3.5 px-4 whitespace-nowrap">
                                    {log.targetName && log.targetName !== 'N/A' ? (
                                      <div>
                                        <div className="font-bold text-white text-[11px]">{log.targetName}</div>
                                        <div className="text-[10px] text-primary font-code-sm">{log.targetRegNo}</div>
                                      </div>
                                    ) : (
                                      <span className="text-white/40 text-[11px]">N/A</span>
                                    )}
                                  </td>
                                  <td className="py-3.5 px-4 text-white/80 text-[11px]">
                                    {log.details}
                                  </td>
                                  {canDeleteLogs && (
                                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                      <button
                                        onClick={() => {
                                          if (log.id && confirm("Are you sure you want to delete this activity log entry?")) {
                                            handleDeleteLog(log.id);
                                          }
                                        }}
                                        className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/40 transition-all shrink-0"
                                        title="Delete Log Entry"
                                      >
                                        <span className="material-symbols-outlined text-xs">delete</span>
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

      </section>

      {/* Mismatch report modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[200] overflow-y-auto p-4 sm:p-6 flex min-h-full items-center justify-center">
          <div className="glass-panel p-6 md:p-8 rounded-2xl max-w-lg w-full border border-outline-variant/30 relative space-y-6 text-left my-auto shadow-2xl">
            <div className="flex justify-between items-center border-b border-outline-variant/20 pb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-red-500 text-base">report_problem</span>
                <h3 className="font-headline-sm text-sm md:text-base text-white font-bold uppercase tracking-wider">Report Registration Error</h3>
              </div>
              <button 
                onClick={() => setShowReportModal(false)}
                className="text-on-surface-variant hover:text-white"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>

            <p className="text-xs text-on-surface-variant leading-relaxed">
              If the pre-filled information displayed on your dossier (Name, Registration number, Team, Role) does not match your official files, describe the errors below. Administrators will verify and revise.
            </p>

            <form onSubmit={handleReportSubmit} className="space-y-4">
              <div>
                <label className="block font-label-caps text-[10px] text-outline mb-1.5 tracking-widest font-bold">DESCRIPTION OF ISSUE</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Example: My name spelling is incorrect. It should be spelled 'Siddharth' instead of 'Sidhart'..."
                  value={reportIssueText}
                  onChange={(e) => setReportIssueText(e.target.value)}
                  className="w-full bg-black/40 border border-outline-variant/30 rounded-xl px-4 py-3 text-white placeholder:text-white/20 font-body-md text-xs md:text-sm focus:outline-none focus:border-primary transition-all"
                ></textarea>
              </div>

              {reportStatus && (
                <div className={`p-3 rounded-lg text-xs font-bold ${
                  reportStatus === 'success' 
                    ? 'bg-green-500/10 border border-green-500/20 text-green-400' 
                    : 'bg-error/10 border border-error/20 text-error'
                }`}>
                  {reportStatus === 'success' ? 'Report logged! Admins have been notified.' : reportStatus}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant/20">
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="px-5 py-2.5 rounded-full border border-outline hover:bg-white/5 text-xs font-bold font-label-caps"
                >
                  CANCEL
                </button>
                <button
                  disabled={isSubmittingReport}
                  type="submit"
                  className="bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 px-6 py-2.5 rounded-full text-xs font-bold flex items-center gap-1.5"
                >
                  {isSubmittingReport ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-sm">sync</span> SUBMITTING...
                    </>
                  ) : (
                    'SUBMIT REPORT'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Candidate detailed view modal */}
      {previewCandidate && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] overflow-y-auto p-4 sm:p-6 md:p-8 flex min-h-full items-center justify-center">
          <div className="bg-[#0b0612]/95 border border-[#a855f7]/30 backdrop-blur-2xl p-5 sm:p-6 md:p-8 rounded-3xl max-w-2xl w-full relative text-left space-y-6 shadow-[0_0_50px_rgba(168,85,247,0.25)] my-auto max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="sticky top-0 z-50 bg-[#0b0612]/90 backdrop-blur-md flex flex-row justify-between items-center gap-3 border-b border-white/15 pb-3 pt-1 -mt-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-base animate-pulse">folder_shared</span>
                <h4 className="font-display-lg text-xs sm:text-sm text-white font-extrabold uppercase tracking-widest truncate">
                  Candidate ID Dossier
                </h4>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                {/* 3D Card View Push Button Switch (Logo Only) */}
                <button
                  type="button"
                  onClick={() => setPreviewModalTab(prev => prev === 'card' ? 'details' : 'card')}
                  className="p-2 rounded-lg bg-black/40 border border-white/10 text-white/80 hover:text-white hover:border-primary/50 transition-all duration-300 flex items-center justify-center shrink-0 active:scale-95"
                  title={previewModalTab === 'card' ? 'Switch to Candidate Details' : 'Switch to Interactive 3D Card'}
                >
                  <span className="material-symbols-outlined text-lg">
                    {previewModalTab === 'card' ? 'format_list_bulleted' : 'style'}
                  </span>
                </button>

                <button 
                  onClick={() => setPreviewCandidate(null)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all duration-200 shrink-0"
                  title="Close Modal"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            </div>

            {previewModalTab === 'details' ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8 items-center">
                <div className="md:col-span-5 flex flex-col items-center justify-center relative py-2 sm:py-4">
                  <div className="w-36 h-36 sm:w-48 sm:h-48 rounded-2xl border-2 border-[#a855f7]/30 p-1 relative z-10 bg-black/40 shadow-[0_0_30px_rgba(168,85,247,0.15)] group">
                    <div className="w-full h-full rounded-xl overflow-hidden bg-black relative">
                      <img 
                        src={previewCandidate.photoUrl} 
                        alt="Avatar" 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                        referrerPolicy="no-referrer" 
                      />
                    </div>
                  </div>
                </div>

                <div className="md:col-span-7 space-y-4 sm:space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5 text-xs font-body-md">
                    <div className="border-b border-white/5 pb-2">
                      <span className="font-code-sm text-[8px] text-[#a855f7] uppercase tracking-widest block font-bold mb-0.5">FULL NAME</span>
                      <span className="text-white text-sm font-bold block truncate">{previewCandidate.name}</span>
                    </div>
                    <div className="border-b border-white/5 pb-2">
                      <span className="font-code-sm text-[8px] text-[#a855f7] uppercase tracking-widest block font-bold mb-0.5">REG NO</span>
                      <span className="text-[#ddb7ff] text-sm font-bold font-code-sm block">{previewCandidate.registrationNumber}</span>
                    </div>
                    {(() => {
                      const display = getAdminDisplayRoleOrTeam(previewCandidate.team, previewCandidate.position);
                      if (display.isSpecial) {
                        return (
                          <div className="col-span-1 sm:col-span-2 border-b border-white/5 pb-2">
                            <span className="font-code-sm text-[8px] text-[#a855f7] uppercase tracking-widest block font-bold mb-0.5">ROLE / POSITION</span>
                            <span className="text-white text-sm font-bold block uppercase">{display.value}</span>
                          </div>
                        );
                      } else {
                        return (
                          <>
                            <div className="border-b border-white/5 pb-2">
                              <span className="font-code-sm text-[8px] text-[#a855f7] uppercase tracking-widest block font-bold mb-0.5">TEAM / DIVISION</span>
                              <span className="text-white text-sm font-bold block uppercase">{previewCandidate.team}</span>
                            </div>
                            <div className="border-b border-white/5 pb-2">
                              <span className="font-code-sm text-[8px] text-[#a855f7] uppercase tracking-widest block font-bold mb-0.5">ROLE / POSITION</span>
                              <span className="text-white text-sm font-bold block uppercase">{previewCandidate.position}</span>
                            </div>
                          </>
                        );
                      }
                    })()}
                    <div className="border-b border-white/5 pb-2">
                      <span className="font-code-sm text-[8px] text-[#a855f7] uppercase tracking-widest block font-bold mb-0.5">PHONE NUMBER</span>
                      <span className="text-white text-sm block font-code-sm">{previewCandidate.phone || "N/A"}</span>
                    </div>
                    <div className="border-b border-white/5 pb-2">
                      <span className="font-code-sm text-[8px] text-[#a855f7] uppercase tracking-widest block font-bold mb-0.5">SUBMISSION DATE</span>
                      <span className="text-white/60 block font-code-sm">
                        {previewCandidate.submittedAt ? new Date(previewCandidate.submittedAt).toLocaleDateString() : "N/A"}
                      </span>
                    </div>
                    <div className="col-span-1 sm:col-span-2 border-b border-white/5 pb-2">
                      <span className="font-code-sm text-[8px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-bold">EMAIL ADDRESS</span>
                      <span className="text-white block font-code-sm text-xs font-semibold break-all">{previewCandidate.email}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 pt-1">
                    <span className="font-code-sm text-[8px] text-white/45 tracking-widest block font-bold uppercase">DOSSIER STATUS:</span>
                    <span
                      className={`px-3 py-1 rounded-full border text-[9px] font-label-caps font-black tracking-wider uppercase ${
                        previewCandidate.status === 'Approved'
                          ? 'bg-green-500/10 border-green-500/30 text-green-400 shadow-[0_0_15px_rgba(74,222,128,0.1)]'
                          : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.1)]'
                      }`}
                    >
                      {previewCandidate.status || 'Pending'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              /* 3D FLIPPABLE CARD TAB IN MODAL */
              <div className="flex flex-col items-center justify-center py-4 space-y-4">
                <div 
                  onClick={() => setPreviewFlipped(!previewFlipped)}
                  className="relative w-full max-w-[310px] aspect-[2.2/3.4] cursor-pointer group [perspective:1000px]"
                >
                  <div className={`relative w-full h-full duration-700 [transform-style:preserve-3d] ${previewFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                    
                    {/* FRONT OF CARD */}
                    <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] select-none">
                      <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-6 flex flex-col justify-between shadow-[0_0_50px_rgba(168,85,247,0.25)]">
                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none opacity-40"></div>
                        
                        <div className="absolute top-3 left-3 w-3 h-3 border-t-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute top-3 right-3 w-3 h-3 border-t-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute bottom-3 left-3 w-3 h-3 border-b-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute bottom-3 right-3 w-3 h-3 border-b-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>

                        <div className="flex justify-between items-start border-b border-[#a855f7]/25 pb-3 relative z-10">
                          <div className="text-left w-full">
                            <div className="flex items-center gap-1 justify-center">
                              <span className="material-symbols-outlined text-[14px] text-[#a855f7]">sports_esports</span>
                              <h4 className="font-display-lg text-sm text-white font-black tracking-widest leading-none">VRGC</h4>
                            </div>
                            <span className="text-[#a855f7]/80 text-[5px] font-code-sm tracking-wider uppercase block mt-1 font-bold text-center">VIRTUAL REALITY & GAMING CLUB</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-center justify-center my-3 relative z-10">
                          <div className="w-32 h-32 rounded-2xl border-2 border-[#a855f7]/30 p-1 bg-black/40 shadow-[0_0_20px_rgba(168,85,247,0.15)] relative overflow-hidden">
                            <img 
                              src={previewCandidate.photoUrl} 
                              alt={previewCandidate.name} 
                              className="w-full h-full object-cover rounded-xl"
                              referrerPolicy="no-referrer"
                            />
                            <div className={`absolute bottom-1 right-1 text-white text-[6px] font-black px-1.5 py-0.5 rounded tracking-widest uppercase shadow-md pointer-events-none ${
                              previewCandidate.status === 'Approved' ? 'bg-green-500/80' : 'bg-yellow-500/80'
                            }`}>
                              {previewCandidate.status === 'Approved' ? 'VERIFIED' : 'PENDING'}
                            </div>
                          </div>
                        </div>

                        <div className="bg-[#0b0512]/90 border border-[#a855f7]/25 p-3 rounded-2xl relative z-10 space-y-2">
                          <div className="border-b border-white/5 pb-1.5 text-left">
                            <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">NAME</span>
                            <h3 className="font-display-lg text-sm text-white font-extrabold tracking-wide uppercase truncate leading-none">
                              {previewCandidate.name}
                            </h3>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-left">
                            <div>
                              <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">REGISTRATION NO.</span>
                              <span className="font-code-sm text-[10px] text-white font-bold tracking-wider block">
                                {previewCandidate.registrationNumber}
                              </span>
                            </div>
                            <div>
                              {(() => {
                                const displayInfo = getAdminDisplayRoleOrTeam(previewCandidate.team, previewCandidate.position);
                                return (
                                  <>
                                    <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">
                                      {displayInfo.label === 'TEAM / DIVISION' ? 'TEAM' : 'ROLE'}
                                    </span>
                                    <span className="font-code-sm text-[10px] text-white font-bold tracking-wider block uppercase truncate">
                                      {displayInfo.value}
                                    </span>
                                  </>
                                );
                              })()}
                            </div>
                          </div>

                          <div className="pt-1.5 border-t border-white/5 flex items-center gap-1.5 justify-start">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] shadow-[0_0_8px_#a855f7] animate-pulse"></span>
                            <span className="font-code-sm text-[8px] text-[#ddb7ff] font-extrabold uppercase tracking-widest leading-none">
                              {(() => {
                                const displayInfo = getAdminDisplayRoleOrTeam(previewCandidate.team, previewCandidate.position);
                                return displayInfo.isSpecial ? displayInfo.value : (previewCandidate.position || 'MEMBER');
                              })()}
                            </span>
                          </div>
                        </div>

                        <div className="absolute bottom-1 right-2 text-[5px] font-bold text-white/30 font-code-sm uppercase tracking-widest pointer-events-none">
                          TAP CARD TO FLIP 🔄
                        </div>
                      </div>
                    </div>

                    {/* BACK OF CARD */}
                    <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] select-none">
                      <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-6 flex flex-col justify-between shadow-[0_0_50px_rgba(168,85,247,0.25)]">
                        {previewCandidate.avatarUrl && (
                          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none rounded-3xl">
                            <img 
                              src={previewCandidate.avatarUrl} 
                              alt="Avatar Watermark" 
                              className="w-full h-full object-cover opacity-95 brightness-110 contrast-105"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-[#05010a]/10 bg-gradient-to-b from-transparent via-[#05010a]/20 to-[#05010a]/50"></div>
                          </div>
                        )}

                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none opacity-40"></div>
                        
                        <div className="absolute top-3 left-3 w-3 h-3 border-t-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute top-3 right-3 w-3 h-3 border-t-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute bottom-3 left-3 w-3 h-3 border-b-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                        <div className="absolute bottom-3 right-3 w-3 h-3 border-b-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>

                        <div className="text-center relative z-10 border-b border-[#a855f7]/25 pb-2">
                          <h4 className="font-display-lg text-sm text-white font-black tracking-widest uppercase">VRGC</h4>
                          <span className="font-code-sm text-[5px] text-[#a855f7]/80 tracking-wider block mt-0.5">VIRTUAL REALITY & GAMING CLUB</span>
                        </div>

                        <div className="my-3 flex flex-col items-center justify-center relative z-10">
                          <div className="w-28 h-28 rounded-xl border border-white/10 bg-white p-1.5 shadow-[0_0_25px_rgba(168,85,247,0.25)]">
                            <img 
                              src={getQrCodeImageUrl(previewCandidate.registrationNumber, previewCandidate.qrCodeUrl)}
                              alt="Scan to Verify" 
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <span className="font-code-sm text-[6px] text-[#a855f7] font-black uppercase tracking-widest block mt-2">SCAN TO CONNECT</span>
                        </div>

                        <div className="space-y-1.5 border-t border-[#a855f7]/25 pt-2.5 relative z-10 text-[7px] font-code-sm text-white/70 text-left w-full pl-2">
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[10px] text-[#a855f7]">alternate_email</span>
                            <span>@vrgc_official</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[10px] text-[#a855f7]">forum</span>
                            <span>discord.gg/vrgc</span>
                          </div>
                        </div>

                        <div className="text-center text-[7px] font-extrabold text-[#a855f7]/80 tracking-widest mt-2.5 uppercase relative z-10">
                          PLAY • CREATE • INNOVATE
                        </div>

                        <div className="absolute bottom-1 right-2 text-[5px] font-bold text-white/30 font-code-sm uppercase tracking-widest pointer-events-none">
                          TAP CARD TO FLIP 🔄
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setPreviewFlipped(!previewFlipped)}
                  className="px-5 py-2 rounded-full bg-primary/10 border border-primary/40 text-primary text-xs font-bold font-label-caps flex items-center gap-2 hover:bg-primary/20 transition-all"
                >
                  <span className="material-symbols-outlined text-sm">flip_to_back</span>
                  <span>FLIP CARD ({previewFlipped ? 'BACK SIDE' : 'FRONT SIDE'})</span>
                </button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3.5 pt-6 border-t border-white/10">
              <button
                onClick={() => toggleStatus(previewCandidate)}
                className={`w-full sm:flex-1 font-bold py-3 px-6 rounded-full text-xs font-bold font-label-caps flex items-center justify-center gap-2 border transition-all duration-300 hover:scale-[1.01] ${
                  previewCandidate.status === 'Approved'
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                    : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                }`}
              >
                <span className="material-symbols-outlined text-sm font-bold">
                  {previewCandidate.status === 'Approved' ? 'history' : 'verified'}
                </span>
                <span>{previewCandidate.status === 'Approved' ? 'REVERT TO PENDING' : 'APPROVE DOSSIER'}</span>
              </button>

              <button
                onClick={() => { handleDownload(previewCandidate); setPreviewCandidate(null); }}
                className="w-full sm:flex-1 bg-gradient-to-r from-[#a855f7] to-[#cf5cff] hover:opacity-90 text-white font-bold py-3 px-6 rounded-full text-xs font-bold font-label-caps flex items-center justify-center gap-2 transition-all duration-300 hover:scale-[1.01] shadow-[0_0_25px_rgba(168,85,247,0.3)]"
              >
                <span className="material-symbols-outlined text-sm font-bold">download</span>
                <span>DOWNLOAD PHOTO</span>
              </button>

              {previewCandidate.avatarUrl && (
                <button
                  onClick={() => { handleDownloadAvatar(previewCandidate); setPreviewCandidate(null); }}
                  className="w-full sm:flex-1 bg-purple-600/30 border border-purple-500/40 hover:bg-purple-600/50 text-white font-bold py-3 px-6 rounded-full text-xs font-bold font-label-caps flex items-center justify-center gap-2 transition-all duration-300 hover:scale-[1.01]"
                >
                  <span className={`material-symbols-outlined text-sm font-bold ${downloadingAvatarId === (previewCandidate.id || previewCandidate.email) ? 'animate-spin' : ''}`}>
                    {downloadingAvatarId === (previewCandidate.id || previewCandidate.email) ? 'sync' : 'sports_esports'}
                  </span>
                  <span>DOWNLOAD AVATAR</span>
                </button>
              )}

              <button
                onClick={() => { handleDelete(previewCandidate); setPreviewCandidate(null); }}
                className="w-full sm:w-auto bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 text-red-400 px-6 py-3 rounded-full text-xs font-bold font-label-caps flex items-center justify-center gap-2 transition-all duration-300 hover:scale-[1.01]"
              >
                <span className="material-symbols-outlined text-sm font-bold">delete</span>
                <span>DELETE DOSSIER</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Glassmorphic Delete Confirmation Modal */}
      {candidateToDelete && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[300] overflow-y-auto p-4 sm:p-6 flex min-h-full items-center justify-center">
          <div className="glass-panel p-6 sm:p-8 rounded-3xl max-w-md w-full border border-red-500/30 bg-[#0e0618]/95 relative space-y-6 text-left shadow-[0_0_50px_rgba(239,68,68,0.25)] my-auto">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="w-10 h-10 rounded-2xl bg-red-500/15 border border-red-500/40 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-red-400 text-xl">delete_forever</span>
              </div>
              <div>
                <h3 className="font-display-lg text-sm sm:text-base text-white font-black uppercase tracking-wider">
                  Confirm Dossier Deletion
                </h3>
                <span className="font-code-sm text-[10px] text-red-400 font-bold uppercase tracking-widest block">
                  PERMANENT ACTION
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs font-body-md text-white/80">
              <p>
                Are you sure you want to delete the ID dossier for <strong className="text-white font-bold">{candidateToDelete.name}</strong> (<span className="text-[#ddb7ff] font-code-sm">{candidateToDelete.registrationNumber}</span>)?
              </p>
              <p className="text-white/70 text-[11px] leading-relaxed bg-white/5 p-3 rounded-xl border border-white/10">
                ⚠️ This will unlock their form response in the portal and send a row removal signal to Google Sheets.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCandidateToDelete(null)}
                className="px-5 py-2.5 rounded-full border border-white/20 hover:bg-white/10 text-white text-xs font-bold font-label-caps transition-all"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={confirmDeleteCandidate}
                className="bg-red-500/20 border border-red-500/50 hover:bg-red-500/30 text-red-400 px-6 py-2.5 rounded-full text-xs font-bold font-label-caps flex items-center gap-2 shadow-[0_0_20px_rgba(239,68,68,0.2)] transition-all active:scale-95"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
                <span>CONFIRM DELETE</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sync Toast Notification */}
      {syncToastMessage && (
        <div className="fixed bottom-6 right-6 z-[250] stagger-in glass-panel p-4 rounded-xl border border-green-500/40 bg-black/90 backdrop-blur-md flex items-center gap-3 text-left shadow-[0_10px_30px_rgba(0,0,0,0.8)] max-w-md">
          <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-green-400 text-lg">check_circle</span>
          </div>
          <div className="flex-1 min-w-0 space-y-0.5">
            <h4 className="text-green-400 font-bold text-xs uppercase tracking-wider">Secure Dossier Registry</h4>
            <p className="text-xs text-on-surface-variant leading-snug">{syncToastMessage}</p>
          </div>
          <button 
            onClick={() => setSyncToastMessage(null)}
            className="text-on-surface-variant hover:text-white p-1 text-xs"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

    </main>
  );
};

export default IDCard;
