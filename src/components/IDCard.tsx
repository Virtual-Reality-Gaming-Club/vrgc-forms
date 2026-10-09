"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { auth, googleProvider, db } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, doc, deleteDoc, updateDoc, setDoc, getDoc, addDoc, getDocs, query, orderBy, limit, where, deleteField } from 'firebase/firestore';
import { supabase } from '../lib/supabase';
import { getAuthHeaders } from '@/lib/auth-client';
import SpecularButton from './SpecularButton';
import { IDCardRequest, generateShortId, formatDisplayId } from '@/types/idcard';
import { getSuperAdminEmails } from '@/lib/superAdminsBridge';

interface IDCardProps {
  onRedirect: () => void;
  externalUser?: User | null;
  externalMemberData?: any;
  externalIsAdmin?: boolean;
  externalIsSuperAdmin?: boolean;
  externalCanManageCardRequests?: boolean;
  externalIsAuthorized?: boolean;
  onLogout?: () => Promise<void>;
}

interface MemberData {
  name: string;
  registrationNumber: string;
  phone: string;
  email: string;
  team: string;
  position: string;
  photoUrl?: string;
  avatarUrl?: string;
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
  submittedAt: string;
  status: string;
  activeRequestId?: string;
  suspendedReason?: string;
  suspendedAt?: string;
  replacementPaid?: boolean;
  replacementFee?: number;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  paidAt?: string;
  requestDenied?: boolean;
  denialMessage?: string;
  deniedAt?: string | null;
}

interface AdminActivityLog {
  id?: string;
  action: string;
  performedBy?: string;
  adminEmail?: string;
  targetEmail?: string;
  targetName?: string;
  targetRegNo?: string;
  details?: string;
  timestamp: string;
}

const DEV_CARD_REQUESTS_KEY = 'vrgc_dev_card_requests';

function getDevCardRequests(): IDCardRequest[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DEV_CARD_REQUESTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r: IDCardRequest) =>
        r &&
        r.fulfillmentStatus !== 'resolved' &&
        r.fulfillmentStatus !== 'denied' &&
        r.status !== 'cancelled' &&
        r.status !== 'resolved'
    );
  } catch {
    return [];
  }
}

function saveDevCardRequest(req: IDCardRequest) {
  if (typeof window === 'undefined') return;
  try {
    const existing = getDevCardRequests();
    const updated = [req, ...existing.filter((r) => r.id !== req.id && r.requestId !== req.requestId)];
    localStorage.setItem(DEV_CARD_REQUESTS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('vrgc_dev_requests_updated'));
  } catch (e) {
    console.warn('Failed saving dev card request to localStorage:', e);
  }
}

function updateDevCardRequest(requestId: string, partial: Partial<IDCardRequest>, userEmail?: string) {
  if (typeof window === 'undefined') return;
  try {
    const existing = getDevCardRequests();
    const cleanEmail = (userEmail || '').toLowerCase().trim();
    if (partial.fulfillmentStatus === 'resolved' || partial.fulfillmentStatus === 'denied' || partial.status === 'cancelled') {
      const updated = existing.filter((r) => {
        if (requestId && (r.id === requestId || r.requestId === requestId)) return false;
        if (cleanEmail && ((r.userEmail && r.userEmail.toLowerCase().trim() === cleanEmail) || (r.email && r.email.toLowerCase().trim() === cleanEmail))) return false;
        return true;
      });
      localStorage.setItem(DEV_CARD_REQUESTS_KEY, JSON.stringify(updated));
      window.dispatchEvent(new Event('vrgc_dev_requests_updated'));
      return;
    }
    let found = false;
    const updated = existing.map((r) => {
      if (r.id === requestId || r.requestId === requestId || (cleanEmail && r.userEmail?.toLowerCase().trim() === cleanEmail)) {
        found = true;
        return { ...r, ...partial };
      }
      return r;
    });
    if (!found) {
      updated.push({
        id: requestId,
        requestId: requestId,
        fulfillmentStatus: 'queued',
        paymentStatus: 'paid',
        feeAmount: 150,
        amount: 150,
        currency: 'INR',
        paymentId: requestId,
        userEmail: userEmail || '',
        candidateName: 'Member',
        registrationNumber: '',
        team: 'General',
        position: 'Member',
        createdAt: new Date().toISOString(),
        expireAt: Date.now() + 86400000,
        ...partial,
      } as IDCardRequest);
    }
    localStorage.setItem(DEV_CARD_REQUESTS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('vrgc_dev_requests_updated'));
  } catch (e) {
    console.warn('Failed updating dev card request in localStorage:', e);
  }
}

function deleteDevCardRequest(requestId: string, userEmail?: string) {
  if (typeof window === 'undefined') return;
  try {
    const existing = getDevCardRequests();
    const cleanEmail = (userEmail || '').toLowerCase().trim();
    const updated = existing.filter((r) => {
      if (requestId && (r.id === requestId || r.requestId === requestId)) return false;
      if (cleanEmail && ((r.userEmail && r.userEmail.toLowerCase().trim() === cleanEmail) || (r.email && r.email.toLowerCase().trim() === cleanEmail))) return false;
      return true;
    });
    localStorage.setItem(DEV_CARD_REQUESTS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('vrgc_dev_requests_updated'));
  } catch (e) {
    console.warn('Failed deleting dev card request from localStorage:', e);
  }
}

const IDCard: React.FC<IDCardProps> = ({
  onRedirect,
  externalUser,
  externalMemberData,
  externalIsAdmin,
  externalIsSuperAdmin,
  externalCanManageCardRequests,
  externalIsAuthorized,
  onLogout
}) => {
  const [bridgeSuperAdmins, setBridgeSuperAdmins] = useState<string[]>([]);

  useEffect(() => {
    getSuperAdminEmails()
      .then((list) => {
        if (Array.isArray(list)) {
          setBridgeSuperAdmins(list.map((e) => e.toLowerCase().trim()));
        }
      })
      .catch(() => {});
  }, []);

  const currentCallerEmail = (externalUser?.email || '').toLowerCase().trim();
  // Only Super Admin has access to Lost & Damaged Replacement Queue and can proceed requests further
  const canManageCardRequests = Boolean(
    externalIsSuperAdmin ||
    bridgeSuperAdmins.includes(currentCallerEmail) ||
    (externalCanManageCardRequests && externalIsSuperAdmin) ||
    false
  );
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
  const [isTeamDropdownOpen, setIsTeamDropdownOpen] = useState<boolean>(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState<boolean>(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewCandidate, setPreviewCandidate] = useState<CandidateSubmission | null>(null);
  const [totalMembers, setTotalMembers] = useState<number>(0);

  // Admin Tabs & ID Card Replacement States
  const [adminSectionTab, setAdminSectionTab] = useState<'dossiers' | 'requests' | 'logs'>('dossiers');
  const [adminLogs, setAdminLogs] = useState<AdminActivityLog[]>([]);
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [logActionFilter, setLogActionFilter] = useState<string>('All');
  const [selectedLogForDetails, setSelectedLogForDetails] = useState<AdminActivityLog | null>(null);
  const [openLogMenuId, setOpenLogMenuId] = useState<string | null>(null);

  // ID Card Replacement Workflow States
  const [showReportLostModal, setShowReportLostModal] = useState<boolean>(false);
  const [isReportingLost, setIsReportingLost] = useState<boolean>(false);
  const [reportLostError, setReportLostError] = useState<string>('');
  const [activeReplacementRequest, setActiveReplacementRequest] = useState<IDCardRequest | null>(null);
  const [isCheckingExpiry, setIsCheckingExpiry] = useState<boolean>(false);
  const [expiryToast, setExpiryToast] = useState<string | null>(null);
  const [dynamicReplacementFee, setDynamicReplacementFee] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('vrgc_dynamic_replacement_fee');
      if (cached && Number(cached) > 0) return Number(cached);
    }
    return 150;
  });
  const [dynamicExpiryMinutes, setDynamicExpiryMinutes] = useState<number>(60);
  const [showFeeSettingsModal, setShowFeeSettingsModal] = useState<boolean>(false);
  const [feeInput, setFeeInput] = useState<number | string>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('vrgc_dynamic_replacement_fee');
      if (cached && Number(cached) > 0) return Number(cached);
    }
    return 150;
  });
  const [expiryInput, setExpiryInput] = useState<number | string>(60);
  const [isSavingFeeSettings, setIsSavingFeeSettings] = useState<boolean>(false);
  const [showEnquiryModal, setShowEnquiryModal] = useState<boolean>(false);
  const [enquiryDetails, setEnquiryDetails] = useState<{
    card: CandidateSubmission | null;
    request: IDCardRequest | null;
  } | null>(null);

  const [queuedRequests, setQueuedRequests] = useState<IDCardRequest[]>([]);
  const latestFirestoreListRef = useRef<IDCardRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState<boolean>(false);
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);
  const [requestSearchQuery, setRequestSearchQuery] = useState<string>('');
  const [resolveSuccessMessage, setResolveSuccessMessage] = useState<string | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<'all' | 'paid' | 'pending'>('all');
  const [isRefreshingQueue, setIsRefreshingQueue] = useState<boolean>(false);

  // Admin 3D Card View & Flipping states
  const [adminViewMode, setAdminViewMode] = useState<'list' | 'cards'>('list');
  const [flippedCardsMap, setFlippedCardsMap] = useState<Record<string, boolean>>({});
  const [previewModalTab, setPreviewModalTab] = useState<'details' | 'card'>('card');
  const [previewFlipped, setPreviewFlipped] = useState<boolean>(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuDirections, setMenuDirections] = useState<Record<string, 'up' | 'down'>>({});
  const [candidateToDelete, setCandidateToDelete] = useState<CandidateSubmission | null>(null);

  // Close mobile 3-dots menu on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      setOpenMenuId(null);
      setOpenLogMenuId(null);
    };
    if (openMenuId || openLogMenuId) {
      window.addEventListener('click', handleOutsideClick);
      return () => window.removeEventListener('click', handleOutsideClick);
    }
  }, [openMenuId, openLogMenuId]);

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

  // Synchronize Auth & Member state from AuthContext props
  useEffect(() => {
    const userToUse = externalUser ?? currentUser;
    if (userToUse && userToUse.email) {
      const lowerEmail = userToUse.email.toLowerCase();
      setCurrentUser(userToUse);

      // Admin status comes exclusively from the auth-context (Firestore-resolved)
      const adminStatus = externalIsAdmin ?? false;
      setIsAdmin(adminStatus);

      if (externalIsAuthorized !== undefined) {
        setIsAuthorized(externalIsAuthorized);
      } else {
        setIsAuthorized(true);
      }

      if (externalMemberData) {
        setMemberData(externalMemberData);
      }

      checkExistingSubmission(lowerEmail);
    } else {
      setCurrentUser(null);
      setIsAuthorized(externalIsAuthorized ?? false);
      setIsAdmin(externalIsAdmin ?? false);
      if (externalMemberData) setMemberData(externalMemberData);
    }
    setAuthLoading(false);
  }, [externalUser, externalMemberData, externalIsAdmin, externalIsAuthorized]);

  // Subscribe to real-time updates from 'id_cards' Firestore collection (Admins only)
  useEffect(() => {
    if (!currentUser || !isAdmin) return;

    setLoadingData(true);
    const unsub = onSnapshot(collection(db, 'id_cards'), (snapshot) => {
      const candidatesMap = new Map<string, CandidateSubmission>();
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as CandidateSubmission;
        const email = (data.email || docSnap.id || '').toLowerCase().trim();
        if (email && email.includes('@')) {
          const existing = candidatesMap.get(email);
          if (!existing) {
            candidatesMap.set(email, { id: docSnap.id, ...data });
          } else {
            const existingTime = new Date(existing.submittedAt || 0).getTime();
            const currTime = new Date(data.submittedAt || 0).getTime();
            if (currTime >= existingTime) {
              candidatesMap.set(email, { id: docSnap.id, ...data });
            }
          }
        }
      });
      const candidatesData = Array.from(candidatesMap.values());
      candidatesData.sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime());
      setCandidates(candidatesData);
      setLoadingData(false);
    }, (error) => {
      console.error("Firestore subscription error:", error);
      setLoadingData(false);
    });

    return () => unsub();
  }, [currentUser, isAdmin]);

  // Subscribe to real-time updates from 'members' Firestore collection to calculate dynamic total member count
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(collection(db, 'members'), (snapshot) => {
      const uniqueEmails = new Set<string>();
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const email = (data.email || data.Email || docSnap.id || '').toLowerCase().trim();
        if (email && email.includes('@')) {
          uniqueEmails.add(email);
        }
      });
      setTotalMembers(uniqueEmails.size > 0 ? uniqueEmails.size : snapshot.size);
    }, (error) => {
      console.warn("Firestore members subscription notice:", error);
    });

    return () => unsub();
  }, [isAdmin]);

  // Real-time listener for admin activity logs with automatic top-15 retention
  useEffect(() => {
    if (!isAdmin) return;
    try {
      const logsQuery = query(collection(db, 'admin_logs'), orderBy('timestamp', 'desc'), limit(50));
      const unsubscribe = onSnapshot(logsQuery, async (snapshot) => {
        const logsList: AdminActivityLog[] = [];

        snapshot.docs.forEach((docSnap, index) => {
          const data = docSnap.data();
          let parsedTimestamp = new Date().toISOString();

          if (data.timestamp?.toDate) {
            parsedTimestamp = data.timestamp.toDate().toISOString();
          } else if (data.timestamp?.seconds) {
            parsedTimestamp = new Date(data.timestamp.seconds * 1000).toISOString();
          } else if (typeof data.timestamp === 'string' || typeof data.timestamp === 'number') {
            const t = new Date(data.timestamp).getTime();
            parsedTimestamp = isNaN(t) ? String(data.timestamp) : new Date(t).toISOString();
          }

          const logEntry: AdminActivityLog = {
            id: docSnap.id,
            action: data.action || 'ACTIVITY',
            performedBy: data.performedBy,
            adminEmail: data.adminEmail,
            targetEmail: data.targetEmail,
            targetName: data.targetName,
            targetRegNo: data.targetRegNo,
            details: data.details,
            timestamp: parsedTimestamp,
          };

          if (index < 15) {
            logsList.push(logEntry);
          }
        });

        setAdminLogs(logsList);
      }, (error) => {
        console.warn('Real-time admin logs listener notice:', error);
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn('Could not query admin_logs:', e);
    }
  }, [isAdmin]);

  // Inline log writer — dispatches to secure server-side endpoint
  const logAdminAction = useCallback(async (
    action: AdminActivityLog['action'],
    details: string,
    targetEmail?: string,
    targetName?: string,
    targetRegNo?: string
  ) => {
    try {
      if (!currentUser || !currentUser.email) return;

      if (typeof window !== 'undefined') {
        try {
          if ((window as any).__vrgc_elevated || sessionStorage.getItem('vrgc_elevated_session') === 'true') {
            return;
          }
        } catch {}
      }

      const adminDisplayName = currentUser.displayName || memberData?.name || (currentUser.email ? currentUser.email.split('@')[0] : 'Admin');
      const authHeaders = await getAuthHeaders();
      if (!authHeaders.Authorization) return;

      await fetch('/api/audit/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          action,
          performedBy: adminDisplayName,
          targetEmail: targetEmail && targetEmail !== 'N/A' ? targetEmail : null,
          targetName: targetName && targetName !== 'N/A' ? targetName : null,
          targetRegNo: targetRegNo && targetRegNo !== 'N/A' ? targetRegNo : null,
          details,
        }),
      });
    } catch (err) {
      console.error('Failed to write admin activity log:', err);
    }
  }, [currentUser, memberData]);

  // Admins can delete individual log entries via server endpoint
  const handleDeleteLog = useCallback(async (logId?: string) => {
    const canDelete = isAdmin;
    if (!logId || !isAdmin || !canDelete) return;
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/audit/logs?logId=${encodeURIComponent(logId)}`, {
        method: 'DELETE',
        headers: {
          ...authHeaders,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete log entry');
      }
      setAdminLogs(prev => prev.filter(l => l.id !== logId));
      setSyncToastMessage('Activity log entry deleted.');
      setTimeout(() => setSyncToastMessage(null), 3000);
    } catch (err) {
      console.error('Failed to delete log entry:', err);
    }
  }, [isAdmin, currentUser]);

  // Purge activity logs older than 15 days via server endpoint
  const [isPurgingLogs, setIsPurgingLogs] = useState<boolean>(false);
  const handlePurgeOldLogs = useCallback(async (days = 15) => {
    const canDelete = isAdmin;
    if (!isAdmin || !canDelete) return;

    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const oldLogs = adminLogs.filter(l => {
      const t = new Date(l.timestamp).getTime();
      return !isNaN(t) && t < cutoffTime;
    });

    if (oldLogs.length === 0) {
      alert(`No activity logs older than ${days} days found.`);
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete ${oldLogs.length} activity logs older than ${days} days?`)) {
      return;
    }

    setIsPurgingLogs(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/audit/logs?days=${days}`, {
        method: 'DELETE',
        headers: {
          ...authHeaders,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to complete bulk log deletion');
      }
      const data = await res.json().catch(() => ({}));
      const deletedCount = data.deletedCount ?? oldLogs.length;
      setAdminLogs(prev => prev.filter(l => !oldLogs.some(ol => ol.id === l.id)));
      setSyncToastMessage(`Successfully purged ${deletedCount} logs older than ${days} days.`);
      setTimeout(() => setSyncToastMessage(null), 4000);
    } catch (err) {
      console.error('Error purging old logs:', err);
      alert('Failed to complete bulk log deletion.');
    } finally {
      setIsPurgingLogs(false);
    }
  }, [isAdmin, currentUser, adminLogs]);

  // Performance optimization: Pagination / Windowing states (Massive TBT & LCP boost)
  const [dossierPageLimit, setDossierPageLimit] = useState<number>(12);
  const [logPageLimit, setLogPageLimit] = useState<number>(15);

  useEffect(() => {
    setDossierPageLimit(12);
  }, [searchQuery, selectedTeam]);

  useEffect(() => {
    setLogPageLimit(15);
  }, [logSearchQuery, logActionFilter]);

  const canDeleteLogs = useMemo(() => {
    return isAdmin;
  }, [isAdmin]);

  const filteredLogs = useMemo(() => {
    return adminLogs.filter(log => {
      const adminMail = log.performedBy || log.adminEmail || 'Admin';
      const matchesSearch =
        !logSearchQuery.trim() ||
        adminMail.toLowerCase().includes(logSearchQuery.toLowerCase()) ||
        (log.targetName || '').toLowerCase().includes(logSearchQuery.toLowerCase()) ||
        (log.targetRegNo || '').toLowerCase().includes(logSearchQuery.toLowerCase()) ||
        (log.details || '').toLowerCase().includes(logSearchQuery.toLowerCase());

      let matchesAction = logActionFilter === 'All';
      if (!matchesAction) {
        if (logActionFilter === 'APPROVE_DOSSIER') matchesAction = log.action === 'APPROVE_DOSSIER' || log.action === 'VERIFY';
        else if (logActionFilter === 'REVERT_PENDING_DOSSIER') matchesAction = log.action === 'REVERT_PENDING_DOSSIER' || log.action === 'SET_PENDING';
        else if (logActionFilter === 'DELETE_DOSSIER') matchesAction = log.action === 'DELETE_DOSSIER' || log.action === 'DELETE';
        else if (logActionFilter === 'FORCE_SHEETS_SYNC') matchesAction = log.action === 'FORCE_SHEETS_SYNC' || log.action === 'SYNC_SHEETS';
        else matchesAction = log.action === logActionFilter;
      }

      return matchesSearch && matchesAction;
    });
  }, [adminLogs, logSearchQuery, logActionFilter]);

  const visibleLogs = useMemo(() => {
    return filteredLogs.slice(0, logPageLimit);
  }, [filteredLogs, logPageLimit]);

  const checkExistingSubmission = async (email: string) => {
    try {
      const docRef = doc(db, 'id_cards', email.toLowerCase());
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setExistingSubmission({ id: docSnap.id, ...docSnap.data() } as CandidateSubmission);
      } else {
        setExistingSubmission(null);
      }
    } catch (err) {
      console.error('Error checking existing submission:', err);
    }
  };

  // Dynamically load Razorpay Checkout SDK
  const loadRazorpayScript = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      if (typeof window !== 'undefined' && (window as any).Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }, []);

  // 1. Real-time dynamic replacement fee and expiry window listener from config/metadata
  useEffect(() => {
    const unsubMeta = onSnapshot(doc(db, 'config', 'metadata'), (metaSnap) => {
      if (metaSnap.exists()) {
        const data = metaSnap.data();
        if (data?.idCardSettings?.replacementFee && Number(data.idCardSettings.replacementFee) > 0) {
          const fee = Number(data.idCardSettings.replacementFee);
          setDynamicReplacementFee(fee);
          setFeeInput(fee);
          if (typeof window !== 'undefined') {
            localStorage.setItem('vrgc_dynamic_replacement_fee', String(fee));
          }
        }
        if (data?.idCardSettings?.expiryMinutes && Number(data.idCardSettings.expiryMinutes) > 0) {
          const exp = Number(data.idCardSettings.expiryMinutes);
          setDynamicExpiryMinutes(exp);
          setExpiryInput(exp);
        }
      }
    }, (err) => {
      console.warn('Metadata snapshot notice:', err);
    });

    const unsubClubMeta = onSnapshot(doc(db, 'config', 'club_metadata'), (clubMetaSnap) => {
      if (clubMetaSnap.exists()) {
        const data = clubMetaSnap.data();
        if (data?.idCardSettings?.replacementFee && Number(data.idCardSettings.replacementFee) > 0) {
          const fee = Number(data.idCardSettings.replacementFee);
          setDynamicReplacementFee(fee);
          setFeeInput(fee);
          if (typeof window !== 'undefined') {
            localStorage.setItem('vrgc_dynamic_replacement_fee', String(fee));
          }
        }
        if (data?.idCardSettings?.expiryMinutes && Number(data.idCardSettings.expiryMinutes) > 0) {
          const exp = Number(data.idCardSettings.expiryMinutes);
          setDynamicExpiryMinutes(exp);
          setExpiryInput(exp);
        }
      }
    }, (err) => {
      console.warn('Club metadata snapshot notice:', err);
    });

    return () => {
      unsubMeta();
      unsubClubMeta();
    };
  }, []);

  // 2. Real-time listener for current user's active replacement request when card is suspended
  useEffect(() => {
    if (!existingSubmission || existingSubmission.status !== 'suspended' || !existingSubmission.activeRequestId) {
      setActiveReplacementRequest(null);
      return;
    }

    const targetReqId = existingSubmission.activeRequestId;

    const syncActiveRequest = (snapData: IDCardRequest | null) => {
      if (snapData) {
        setActiveReplacementRequest(snapData);
      } else {
        const localReq = getDevCardRequests().find((r) => r.id === targetReqId || r.requestId === targetReqId);
        setActiveReplacementRequest(localReq || null);
      }
    };

    let unsub = () => {};
    try {
      const reqDocRef = doc(db, 'id_card_requests', targetReqId);
      unsub = onSnapshot(reqDocRef, async (snap) => {
        if (snap.exists()) {
          const reqData = { id: snap.id, ...snap.data() } as IDCardRequest;
          syncActiveRequest(reqData);

          // Auto-check expiry if pending and past expiration window
          if (reqData.fulfillmentStatus === 'payment_pending' && reqData.expireAt && reqData.expireAt <= Date.now()) {
            try {
              const authHeaders = await getAuthHeaders();
              const res = await fetch('/api/idcard/check-expiry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ requestId: reqData.id, cancelIfUnpaid: false }),
              });
              const data = await res.json();
              if (data.cardReactivated) {
                setExistingSubmission((prev) => (prev ? { ...prev, status: 'active', activeRequestId: undefined } : null));
                setActiveReplacementRequest(null);
                setExpiryToast('Pending replacement invoice expired. Your ID card has been automatically reactivated.');
                setTimeout(() => setExpiryToast(null), 5000);
              }
            } catch (e) {
              console.warn('Auto-check expiry notice:', e);
            }
          }
        } else {
          syncActiveRequest(null);
        }
      }, (err) => {
        console.warn('Notice: id_card_requests active request fallback to dev storage:', err);
        syncActiveRequest(null);
      });
    } catch {
      syncActiveRequest(null);
    }

    const handleDevUpdate = () => {
      const localReq = getDevCardRequests().find((r) => r.id === targetReqId || r.requestId === targetReqId);
      if (localReq) {
        setActiveReplacementRequest(localReq);
      }
    };

    window.addEventListener('vrgc_dev_requests_updated', handleDevUpdate);
    window.addEventListener('storage', handleDevUpdate);

    return () => {
      unsub();
      window.removeEventListener('vrgc_dev_requests_updated', handleDevUpdate);
      window.removeEventListener('storage', handleDevUpdate);
    };
  }, [existingSubmission?.status, existingSubmission?.activeRequestId]);

  // 3. Real-time listener for card replacement requests (Admins with canManageCardRequests only)
  useEffect(() => {
    if (!currentUser || !canManageCardRequests) return;

    setLoadingRequests(true);

    const syncWithLocalDev = (firestoreList: IDCardRequest[]) => {
      const devRequests = getDevCardRequests();
      const map = new Map<string, IDCardRequest>();

      const isDismissed = (r: Partial<IDCardRequest>) =>
        r.fulfillmentStatus === 'resolved' ||
        r.fulfillmentStatus === 'denied' ||
        r.status === 'cancelled' ||
        r.status === 'resolved';

      // 1. Add active Firestore requests
      firestoreList.forEach((r) => {
        if (!isDismissed(r)) {
          map.set(r.id || r.requestId || '', r);
        }
      });

      // 2. Add dev localStorage requests
      devRequests.forEach((r) => {
        if (!isDismissed(r)) {
          const key = r.id || r.requestId || '';
          if (!map.has(key)) {
            map.set(key, r);
          }
        }
      });

      // 3. Cross-reference ALL candidates in 'candidates' who are currently suspended
      // Every suspended ID MUST appear in Super Admin's queue for review, UNLESS already dismissed/resolved/denied!
      candidates.forEach((c) => {
        if (c.status?.toLowerCase() === 'suspended' && !c.requestDenied) {
          const cleanEmail = (c.email || '').toLowerCase().trim();
          const reqId = c.activeRequestId || generateShortId('REQ');

          // If a request for this candidate was already marked dismissed in Dev storage, skip!
          const dismissedInDev = devRequests.find(
            (dr) => (dr.id === reqId || dr.requestId === reqId || (dr.userEmail && dr.userEmail.toLowerCase().trim() === cleanEmail)) && isDismissed(dr)
          );
          if (dismissedInDev) return;

          // If a request for this candidate was already marked dismissed in Firestore, skip!
          const dismissedInFirestore = firestoreList.find(
            (fr) => (fr.id === reqId || fr.requestId === reqId || (fr.userEmail && fr.userEmail.toLowerCase().trim() === cleanEmail)) && isDismissed(fr)
          );
          if (dismissedInFirestore) return;

          const existingItem = map.get(reqId) || devRequests.find(
            (dr) => dr.id === reqId || dr.requestId === reqId || dr.userEmail?.toLowerCase() === c.email.toLowerCase()
          );

          if (existingItem && isDismissed(existingItem)) return;

          const isPaid = Boolean(
            c.replacementPaid ||
            c.paymentStatus === 'paid' ||
            c.fulfillmentStatus === 'queued' ||
            existingItem?.paymentStatus === 'paid' ||
            existingItem?.fulfillmentStatus === 'queued'
          );

          const orderId = existingItem?.orderId || existingItem?.razorpayOrderId || generateShortId('ORD');

          const effectiveFee = (existingItem?.amount && Number(existingItem.amount) > 0)
            ? Number(existingItem.amount)
            : (existingItem?.feeAmount && Number(existingItem.feeAmount) > 0)
            ? Number(existingItem.feeAmount)
            : (c.replacementFee && Number(c.replacementFee) > 0)
            ? Number(c.replacementFee)
            : (dynamicReplacementFee > 0 ? dynamicReplacementFee : 150);

          const requestItem: IDCardRequest = {
            id: reqId,
            requestId: reqId,
            userEmail: c.email,
            email: c.email,
            candidateName: c.name || existingItem?.candidateName || 'Member',
            name: c.name || existingItem?.candidateName || 'Member',
            registrationNumber: c.registrationNumber || existingItem?.registrationNumber || '',
            phone: c.phone || existingItem?.phone || '',
            team: c.team || existingItem?.team || 'General',
            position: c.position || existingItem?.position || 'Core Member',
            photoUrl: c.photoUrl || existingItem?.photoUrl || '',
            avatarUrl: c.avatarUrl || existingItem?.avatarUrl || '',
            feeAmount: effectiveFee,
            amount: effectiveFee,
            currency: existingItem?.currency || 'INR',
            paymentId: existingItem?.paymentId || reqId,
            invoiceId: existingItem?.invoiceId || reqId,
            paymentStatus: isPaid ? 'paid' : 'pending',
            fulfillmentStatus: isPaid ? 'queued' : 'payment_pending',
            razorpayOrderId: orderId,
            orderId: orderId,
            createdAt: c.suspendedAt || existingItem?.createdAt || new Date().toISOString(),
            expireAt: existingItem?.expireAt || (Date.now() + 86400000),
            paidAt: isPaid ? (c.paidAt || existingItem?.paidAt || new Date().toISOString()) : undefined,
          };

          map.set(reqId, requestItem);
        }
      });

      const combined = Array.from(map.values()).filter((r) => !isDismissed(r));
      combined.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      setQueuedRequests(combined);
      setLoadingRequests(false);
    };

    let unsub = () => {};

    try {
      unsub = onSnapshot(collection(db, 'id_card_requests'), (snap) => {
        const list: IDCardRequest[] = [];
        snap.forEach((d) => {
          const item = { id: d.id, ...d.data() } as IDCardRequest;
          const isDismissed = item.fulfillmentStatus === 'resolved' ||
                              item.fulfillmentStatus === 'denied' ||
                              item.status === 'cancelled' ||
                              item.status === 'resolved';
          if (!isDismissed) {
            list.push(item);
          }
        });
        latestFirestoreListRef.current = list;
        syncWithLocalDev(latestFirestoreListRef.current);
      }, (err) => {
        console.warn('Notice: Firestore id_card_requests query falling back to dev storage:', err);
        syncWithLocalDev([]);
      });
    } catch (err) {
      console.warn('Could not query id_card_requests, using dev storage:', err);
      syncWithLocalDev([]);
    }

    const handleDevUpdate = () => {
      syncWithLocalDev(latestFirestoreListRef.current);
    };
    window.addEventListener('vrgc_dev_requests_updated', handleDevUpdate);
    window.addEventListener('storage', handleDevUpdate);

    return () => {
      unsub();
      window.removeEventListener('vrgc_dev_requests_updated', handleDevUpdate);
      window.removeEventListener('storage', handleDevUpdate);
    };
  }, [currentUser, canManageCardRequests, candidates, dynamicReplacementFee]);

  // 4. Open Razorpay Checkout for ID Card Replacement
  const handleOpenRazorpayCheckout = useCallback(async (
    orderId: string,
    amount: number,
    currency: string,
    requestId: string,
    invoiceId: string,
    keyId?: string
  ) => {
    try {
      const isSdkLoaded = await loadRazorpayScript();
      if (!isSdkLoaded) {
        alert('Failed to load Razorpay payment SDK. Please check your network connection.');
        return;
      }

      let razorpayKey = keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      if (!razorpayKey) {
        try {
          const keyRes = await fetch('/api/get-razorpay-key');
          if (keyRes.ok) {
            const keyJson = await keyRes.json();
            razorpayKey = keyJson.keyId;
          }
        } catch (e) {
          console.warn('Failed to load razorpay key:', e);
        }
      }

      if (!razorpayKey) {
        alert('Razorpay payment gateway key is not configured. Please contact the administrator.');
        return;
      }

      const safeAmount = dynamicReplacementFee > 0 ? dynamicReplacementFee : (Number(amount) > 0 ? Number(amount) : 150);
      const safeInvoiceId = invoiceId || requestId || generateShortId('REQ');
      const safeRequestId = requestId || safeInvoiceId;
      const targetEmail = (currentUser?.email || externalUser?.email || '').toLowerCase().trim();

      // Generate or refresh authentic Razorpay order strictly matching current dynamic fee
      let liveOrderId = '';
      try {
        const createRes = await fetch('/api/idcard/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: safeAmount,
            requestId: safeRequestId,
            paymentId: safeInvoiceId,
            userEmail: targetEmail,
            candidateName: existingSubmission?.name || memberData?.name || currentUser?.displayName || 'Member',
          }),
        });
        if (createRes.ok) {
          const createData = await createRes.json();
          if (createData.success && createData.orderId) {
            liveOrderId = createData.orderId;
          }
        }
      } catch (orderErr) {
        console.warn('Order creation error:', orderErr);
      }

      if (!liveOrderId && orderId && orderId.startsWith('order_')) {
        liveOrderId = orderId;
      }

      if (!liveOrderId || !liveOrderId.startsWith('order_')) {
        alert('Could not initialize official Razorpay payment order. Please try again.');
        return;
      }

      const options = {
        key: razorpayKey,
        amount: Math.round(safeAmount * 100),
        currency: currency || 'INR',
        name: 'VRGC Platform',
        description: `ID Card Replacement Fee (₹${safeAmount})`,
        order_id: liveOrderId,
        image: '/icon.svg',
        prefill: {
          name: existingSubmission?.name || memberData?.name || currentUser?.displayName || 'VRGC Member',
          email: targetEmail,
          contact: memberData?.phone || existingSubmission?.phone || '',
        },
        theme: {
          color: '#a855f7',
        },
        modal: {
          ondismiss: () => {
            setExpiryToast('Payment checkout window closed. You can pay anytime before the invoice expires.');
            setTimeout(() => setExpiryToast(null), 4000);
          },
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            setExpiryToast('Verifying payment signature with Razorpay...');
            const authHeaders = await getAuthHeaders();
            const verifyRes = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...authHeaders,
              },
              body: JSON.stringify({
                paymentId: safeInvoiceId,
                requestId: safeRequestId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                userEmail: targetEmail,
                paymentTitle: 'ID Card Replacement Fee',
                amount: safeAmount,
                currency: currency || 'INR',
              }),
            });

            const verifyData = await verifyRes.json();
            if (verifyRes.ok && verifyData.success) {
              const nowIso = new Date().toISOString();

              // 1. Update id_cards in Firestore
              if (targetEmail) {
                try {
                  await updateDoc(doc(db, 'id_cards', targetEmail), {
                    replacementPaid: true,
                    paymentStatus: 'paid',
                    fulfillmentStatus: 'queued',
                    paidAt: nowIso,
                    updatedAt: nowIso,
                  });
                } catch (dbErr) {
                  console.warn('Firestore updateDoc notice:', dbErr);
                }
              }

              // 2. Update id_card_requests in Firestore if exists
              if (safeRequestId) {
                try {
                  await updateDoc(doc(db, 'id_card_requests', safeRequestId), {
                    paymentStatus: 'paid',
                    fulfillmentStatus: 'queued',
                    paidAt: nowIso,
                    razorpayPaymentId: response.razorpay_payment_id,
                    updatedAt: nowIso,
                  });
                } catch (reqDbErr) {
                  console.warn('Firestore request updateDoc notice:', reqDbErr);
                }
              }

              // 3. Upsert into local storage & activeReplacementRequest
              const existingDevReq = activeReplacementRequest || getDevCardRequests().find(r => r.id === safeRequestId || r.requestId === safeRequestId || r.userEmail === targetEmail);
              const fullQueuedReq: IDCardRequest = {
                id: safeRequestId || existingDevReq?.id || generateShortId('REQ'),
                requestId: safeRequestId || existingDevReq?.requestId || generateShortId('REQ'),
                userEmail: targetEmail,
                email: targetEmail,
                candidateName: existingSubmission?.name || memberData?.name || currentUser?.displayName || 'Member',
                name: existingSubmission?.name || memberData?.name || currentUser?.displayName || 'Member',
                registrationNumber: existingSubmission?.registrationNumber || memberData?.registrationNumber || '',
                phone: existingSubmission?.phone || memberData?.phone || '',
                team: existingSubmission?.team || memberData?.team || 'General',
                position: existingSubmission?.position || memberData?.position || 'Core Member',
                photoUrl: existingSubmission?.photoUrl || memberData?.photoUrl || '',
                avatarUrl: existingSubmission?.avatarUrl || memberData?.avatarUrl || '',
                feeAmount: safeAmount,
                amount: safeAmount,
                currency: currency || 'INR',
                paymentId: safeInvoiceId,
                invoiceId: safeInvoiceId,
                paymentStatus: 'paid',
                fulfillmentStatus: 'queued',
                razorpayOrderId: response.razorpay_order_id,
                orderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                createdAt: existingDevReq?.createdAt || nowIso,
                expireAt: Date.now() + 86400000,
                paidAt: nowIso,
              };

              saveDevCardRequest(fullQueuedReq);
              setActiveReplacementRequest(fullQueuedReq);

              // 4. Update in-memory existingSubmission for requester
              setExistingSubmission((prev) =>
                prev ? {
                  ...prev,
                  replacementPaid: true,
                  paymentStatus: 'paid',
                  fulfillmentStatus: 'queued',
                } : null
              );

              // 5. Update Super Admin queue in-memory immediately
              setQueuedRequests((prev) => {
                const reqKey = fullQueuedReq.id || fullQueuedReq.requestId;
                const exists = prev.some((r) => r.id === reqKey || r.requestId === reqKey || r.userEmail?.toLowerCase() === targetEmail.toLowerCase());
                if (exists) {
                  return prev.map((r) =>
                    r.id === reqKey || r.requestId === reqKey || r.userEmail?.toLowerCase() === targetEmail.toLowerCase()
                      ? { ...r, paymentStatus: 'paid', fulfillmentStatus: 'queued', paidAt: fullQueuedReq.paidAt, razorpayPaymentId: response.razorpay_payment_id }
                      : r
                  );
                }
                return [fullQueuedReq, ...prev];
              });

              setCandidates((prev) =>
                prev.map((c) =>
                  c.email.toLowerCase() === targetEmail.toLowerCase()
                    ? { ...c, replacementPaid: true, paymentStatus: 'paid', fulfillmentStatus: 'queued' }
                    : c
                )
              );

              setExpiryToast('Payment Verified 🎉 Your replacement request has been forwarded to the Super Admin re-issuance queue!');
              setTimeout(() => setExpiryToast(null), 5000);

              if (targetEmail) {
                checkExistingSubmission(targetEmail);
              }
            } else {
              alert('Payment verification failed: ' + (verifyData.error || 'Please contact club support.'));
            }
          } catch (err: any) {
            console.error('Error verifying payment:', err);
            alert('Verification request failed. If amount was deducted, it will sync automatically.');
          }
        },
      };

      const razorpayInstance = new (window as any).Razorpay(options);
      razorpayInstance.on('payment.failed', (resp: any) => {
        console.error('Razorpay payment failed:', resp.error);
        alert(`Payment Failed: ${resp.error?.description || 'Transaction declined'}. Please try again.`);
      });
      razorpayInstance.open();
    } catch (err: any) {
      console.error('Error launching Razorpay checkout:', err);
      alert('Could not open payment gateway: ' + err.message);
    }
  }, [currentUser, existingSubmission, memberData, loadRazorpayScript, dynamicReplacementFee]);

  // 5. Trigger Report Lost / Damaged
  const handleReportLost = async () => {
    if (!currentUser) return;
    setIsReportingLost(true);
    setReportLostError('');

    try {
      let data: any = null;
      let usedLocalFallback = false;

      try {
        const authHeaders = await getAuthHeaders();
        const currentFee = dynamicReplacementFee > 0 ? dynamicReplacementFee : 150;
        const res = await fetch('/api/idcard/report-lost', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({
            amount: currentFee,
            replacementFee: currentFee,
            fee: currentFee,
          }),
        });
        data = await res.json();
        if (!res.ok || !data.success) {
          if (data?.localDevFallback || data?.error?.includes('credentials') || data?.error?.includes('Unauthorized')) {
            usedLocalFallback = true;
          } else {
            throw new Error(data.error || 'Failed to submit card replacement report');
          }
        }
      } catch (fetchErr: any) {
        if (fetchErr.message?.includes('Failed to submit card replacement report')) {
          throw fetchErr;
        }
        console.warn('API call notice, engaging local dev fallback:', fetchErr);
        usedLocalFallback = true;
      }

      if (usedLocalFallback) {
        const callerEmail = (currentUser.email || '').toLowerCase().trim();
        const devRequestId = generateShortId('REQ');
        let devOrderId = '';
        const fee = dynamicReplacementFee > 0 ? dynamicReplacementFee : 150;
        const nowIso = new Date().toISOString();
        const expireAt = Date.now() + (dynamicExpiryMinutes || 60) * 60 * 1000;

        try {
          const createRes = await fetch('/api/idcard/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: fee,
              requestId: devRequestId,
              paymentId: devRequestId,
              userEmail: callerEmail,
              candidateName: existingSubmission?.name || memberData?.name || currentUser.displayName || 'Member',
            }),
          });
          if (createRes.ok) {
            const createJson = await createRes.json();
            if (createJson.success && createJson.orderId) {
              devOrderId = createJson.orderId;
            }
          }
        } catch (oErr) {
          console.warn('Failed to pre-create live Razorpay order in fallback:', oErr);
        }

        data = {
          success: true,
          requestId: devRequestId,
          orderId: devOrderId,
          amount: fee,
          currency: 'INR',
          invoiceId: devRequestId,
          paymentId: devRequestId,
          keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '',
          expireAt,
        };
      }

      const callerEmail = (currentUser.email || '').toLowerCase().trim();
      const effectiveRequestId = data?.requestId || generateShortId('REQ');
      const effectiveOrderId = data?.orderId || '';
      const effectivePaymentId = data?.paymentId || data?.invoiceId || effectiveRequestId;
      const effectiveFee = Number(data?.amount ?? (dynamicReplacementFee > 0 ? dynamicReplacementFee : 150));
      const nowIso = new Date().toISOString();
      const expireAt = data?.expireAt || (Date.now() + (dynamicExpiryMinutes || 60) * 60 * 1000);

      const newRequestItem: IDCardRequest = {
        id: effectiveRequestId,
        requestId: effectiveRequestId,
        userEmail: callerEmail,
        email: callerEmail,
        candidateName: existingSubmission?.name || memberData?.name || currentUser.displayName || 'Member',
        name: existingSubmission?.name || memberData?.name || currentUser.displayName || 'Member',
        registrationNumber: existingSubmission?.registrationNumber || memberData?.registrationNumber || 'N/A',
        phone: existingSubmission?.phone || memberData?.phone || '',
        team: existingSubmission?.team || memberData?.team || 'General',
        position: existingSubmission?.position || memberData?.position || 'Core Member',
        photoUrl: existingSubmission?.photoUrl || memberData?.photoUrl || '',
        avatarUrl: existingSubmission?.avatarUrl || memberData?.avatarUrl || '',
        reason: 'lost_replacement',
        feeAmount: effectiveFee,
        replacementFee: effectiveFee,
        amount: effectiveFee,
        currency: data?.currency || 'INR',
        paymentId: effectivePaymentId,
        invoiceId: effectivePaymentId,
        paymentStatus: 'pending',
        fulfillmentStatus: 'payment_pending',
        razorpayOrderId: effectiveOrderId,
        orderId: effectiveOrderId,
        createdAt: nowIso,
        expireAt: expireAt,
      };

      // 1. Unconditionally write to Firestore id_cards so Super Admin and queries immediately know card is SUSPENDED & PAYMENT PENDING
      try {
        await updateDoc(doc(db, 'id_cards', callerEmail), {
          status: 'suspended',
          activeRequestId: effectiveRequestId,
          suspendedReason: 'lost_replacement',
          suspendedAt: nowIso,
          paymentStatus: 'pending',
          fulfillmentStatus: 'payment_pending',
          replacementPaid: false,
          replacementFee: effectiveFee,
          requestDenied: deleteField(),
          denialMessage: deleteField(),
          deniedAt: deleteField(),
          updatedAt: nowIso,
        });
      } catch (dbErr) {
        console.warn('Notice updating id_cards doc to suspended:', dbErr);
      }

      // 2. Unconditionally write to Firestore id_card_requests so Super Admin Replacement Queue receives this pending request
      try {
        await setDoc(doc(db, 'id_card_requests', effectiveRequestId), newRequestItem, { merge: true });
      } catch (reqErr) {
        console.warn('Notice writing id_card_requests doc:', reqErr);
      }

      // 3. Save to dev storage and trigger synchronization across windows/tabs
      saveDevCardRequest(newRequestItem);
      setActiveReplacementRequest(newRequestItem);

      // 4. Update in-memory candidates and queuedRequests immediately
      setCandidates((prev) =>
        prev.map((c) =>
          c.email?.toLowerCase() === callerEmail
            ? {
                ...c,
                status: 'suspended',
                activeRequestId: effectiveRequestId,
                suspendedReason: 'lost_replacement',
                suspendedAt: nowIso,
                paymentStatus: 'pending',
                fulfillmentStatus: 'payment_pending',
                replacementPaid: false,
                replacementFee: effectiveFee,
              }
            : c
        )
      );

      setQueuedRequests((prev) => {
        const withoutThis = prev.filter(
          (r) => r.id !== effectiveRequestId && r.requestId !== effectiveRequestId && r.userEmail?.toLowerCase() !== callerEmail
        );
        return [newRequestItem, ...withoutThis];
      });

      setShowReportLostModal(false);

      // 5. Update existing submission state
      setExistingSubmission((prev) => (prev ? {
        ...prev,
        status: 'suspended',
        activeRequestId: effectiveRequestId,
        suspendedReason: 'lost_replacement',
        paymentStatus: 'pending',
        fulfillmentStatus: 'payment_pending',
        replacementPaid: false,
        replacementFee: effectiveFee,
        requestDenied: false,
        denialMessage: undefined,
        deniedAt: undefined,
      } : null));

      setExpiryToast('Card suspended. Opening payment checkout for replacement fee...');
      setTimeout(() => setExpiryToast(null), 4000);

      // Launch official live Razorpay checkout
      handleOpenRazorpayCheckout(
        data?.orderId || effectiveOrderId,
        effectiveFee,
        data?.currency || 'INR',
        effectiveRequestId,
        effectivePaymentId,
        data?.keyId
      );
    } catch (err: any) {
      console.error('Error reporting lost card:', err);
      setReportLostError(err.message || 'Failed to report lost card. Please try again.');
    } finally {
      setIsReportingLost(false);
    }
  };

  // 6. Cancel Request or Check Expiry
  const handleCancelOrCheckExpiry = async (explicitCancel = false) => {
    if (!currentUser || !existingSubmission?.activeRequestId) return;
    if (explicitCancel) {
      const confirmed = confirm('Are you sure you want to cancel this replacement request? Your ID card will be reactivated and the pending invoice will be deleted.');
      if (!confirmed) return;
    }

    setIsCheckingExpiry(true);
    try {
      let handledViaApi = false;
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch('/api/idcard/check-expiry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({
            requestId: existingSubmission.activeRequestId,
            cancelIfUnpaid: explicitCancel,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          handledViaApi = true;
          if (data.cardReactivated) {
            setExistingSubmission((prev) => (prev ? {
              ...prev,
              status: 'Approved',
              activeRequestId: undefined,
              suspendedReason: undefined,
              replacementPaid: false,
            } : null));
            setActiveReplacementRequest(null);
            setExpiryToast(explicitCancel ? 'Replacement request cancelled. ID card reactivated.' : 'Pending invoice expired. ID card reactivated.');
            setTimeout(() => setExpiryToast(null), 4000);
          } else {
            setExpiryToast(`Request is active: Status is ${data.fulfillmentStatus || 'Payment Pending'}.`);
            setTimeout(() => setExpiryToast(null), 4000);
          }
        }
      } catch (apiErr) {
        console.warn('Check expiry API notice, using fallback:', apiErr);
      }

      if (!handledViaApi && explicitCancel) {
        const callerEmail = (currentUser.email || '').toLowerCase().trim();
        try {
          await updateDoc(doc(db, 'id_cards', callerEmail), {
            status: 'Approved',
            activeRequestId: deleteField(),
            suspendedReason: deleteField(),
            suspendedAt: deleteField(),
            replacementPaid: deleteField(),
            paymentStatus: deleteField(),
            fulfillmentStatus: deleteField(),
            paidAt: deleteField(),
            updatedAt: new Date().toISOString(),
          });
        } catch (dbErr) {
          console.warn('Local dev cancel updateDoc notice:', dbErr);
        }
        deleteDevCardRequest(existingSubmission.activeRequestId);
        setExistingSubmission((prev) => (prev ? {
          ...prev,
          status: 'Approved',
          activeRequestId: undefined,
          suspendedReason: undefined,
          replacementPaid: false,
        } : null));
        setActiveReplacementRequest(null);
        setExpiryToast('Replacement request cancelled. ID card reactivated.');
        setTimeout(() => setExpiryToast(null), 4000);
      } else if (!handledViaApi && !explicitCancel) {
        // Fallback local dev status check
        const targetReqId = existingSubmission.activeRequestId;
        const localReq = getDevCardRequests().find(r => r.id === targetReqId || r.requestId === targetReqId);
        if (localReq && localReq.fulfillmentStatus === 'payment_pending' && localReq.expireAt && localReq.expireAt <= Date.now()) {
          const callerEmail = (currentUser.email || '').toLowerCase().trim();
          try {
            await updateDoc(doc(db, 'id_cards', callerEmail), {
              status: 'Approved',
              activeRequestId: deleteField(),
              suspendedReason: deleteField(),
              suspendedAt: deleteField(),
              replacementPaid: deleteField(),
              updatedAt: new Date().toISOString(),
            });
          } catch (dbErr) {
            console.warn('Local dev expiry updateDoc notice:', dbErr);
          }
          deleteDevCardRequest(targetReqId);
          setExistingSubmission((prev) => (prev ? {
            ...prev,
            status: 'Approved',
            activeRequestId: undefined,
            suspendedReason: undefined,
            replacementPaid: false,
          } : null));
          setActiveReplacementRequest(null);
          setExpiryToast('Pending invoice expired. ID card reactivated.');
          setTimeout(() => setExpiryToast(null), 4000);
        } else if (localReq?.fulfillmentStatus === 'queued' || existingSubmission.replacementPaid) {
          setExpiryToast('Payment verified! Your replacement request is currently in the Super Admin re-issuance queue.');
          setTimeout(() => setExpiryToast(null), 4500);
        } else {
          setExpiryToast('Request active: Replacement fee payment is currently pending.');
          setTimeout(() => setExpiryToast(null), 4000);
        }
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setIsCheckingExpiry(false);
    }
  };

  // 6b. Comprehensive Status & Enquiry Modal Handler
  const handleCheckStatusOrEnquiry = async () => {
    setIsCheckingExpiry(true);
    try {
      const email = (currentUser?.email || externalUser?.email || '').toLowerCase().trim();
      if (!email) {
        setIsCheckingExpiry(false);
        return;
      }

      // 1. Fetch latest card doc from Firestore
      let cardData = existingSubmission;
      try {
        const cardRef = doc(db, 'id_cards', email);
        const cardSnap = await getDoc(cardRef);
        if (cardSnap.exists()) {
          cardData = { id: cardSnap.id, ...cardSnap.data() } as CandidateSubmission;
          setExistingSubmission(cardData);
        }
      } catch (cErr) {
        console.warn('Card lookup notice:', cErr);
      }

      // If card has already been re-issued / reactivated:
      if (cardData && cardData.status && cardData.status.toLowerCase() !== 'suspended') {
        setActiveReplacementRequest(null);
        setShowEnquiryModal(false);
        if (cardData.requestDenied) {
          alert('⚠️ Notice: Your previous ID card replacement request was denied by the administrator. You can try again if you still need a replacement.');
          setExpiryToast('Previous request was denied. You can try again.');
        } else {
          alert('🎉 Great news! Your ID card replacement has been resolved & approved by the Super Admin! Your card is now active.');
          setExpiryToast('ID card is active and approved.');
        }
        setTimeout(() => setExpiryToast(null), 5000);
        setIsCheckingExpiry(false);
        return;
      }

      // 2. Fetch active replacement request from local dev storage or Firestore
      const targetReqId = cardData?.activeRequestId || existingSubmission?.activeRequestId || generateShortId('REQ');
      let req = activeReplacementRequest;

      if (!req && cardData?.activeRequestId) {
        try {
          const reqSnap = await getDoc(doc(db, 'id_card_requests', cardData.activeRequestId));
          if (reqSnap.exists()) {
            req = { id: reqSnap.id, ...reqSnap.data() } as IDCardRequest;
          }
        } catch (e) {
          console.warn('Error fetching request from Firestore:', e);
        }
      }

      if (!req) {
        req = getDevCardRequests().find(
          (r) => r.id === targetReqId || r.requestId === targetReqId || r.userEmail?.toLowerCase() === email
        ) || null;
      }

      const isPaid = Boolean(
        cardData?.replacementPaid ||
        cardData?.paymentStatus === 'paid' ||
        cardData?.fulfillmentStatus === 'queued' ||
        req?.paymentStatus === 'paid' ||
        req?.fulfillmentStatus === 'queued'
      );

      // Always ensure a valid complete request object exists so the modal is never broken
      if (!req) {
        const orderId = generateShortId('ORD');
        req = {
          id: targetReqId,
          requestId: targetReqId,
          userEmail: email,
          email: email,
          candidateName: cardData?.name || memberData?.name || currentUser?.displayName || 'Member',
          name: cardData?.name || memberData?.name || currentUser?.displayName || 'Member',
          registrationNumber: cardData?.registrationNumber || memberData?.registrationNumber || 'N/A',
          phone: cardData?.phone || memberData?.phone || '',
          team: cardData?.team || memberData?.team || 'General',
          position: cardData?.position || memberData?.position || 'Core Member',
          photoUrl: cardData?.photoUrl || memberData?.photoUrl || '',
          avatarUrl: cardData?.avatarUrl || memberData?.avatarUrl || '',
          feeAmount: dynamicReplacementFee || 150,
          amount: dynamicReplacementFee || 150,
          currency: 'INR',
          paymentId: targetReqId,
          invoiceId: targetReqId,
          paymentStatus: isPaid ? 'paid' : 'pending',
          fulfillmentStatus: isPaid ? 'queued' : 'payment_pending',
          razorpayOrderId: orderId,
          orderId: orderId,
          createdAt: cardData?.suspendedAt || new Date().toISOString(),
          expireAt: Date.now() + (dynamicExpiryMinutes || 60) * 60 * 1000,
          paidAt: isPaid ? (cardData?.paidAt || new Date().toISOString()) : undefined,
        };
        saveDevCardRequest(req);
      } else {
        req = {
          ...req,
          paymentStatus: isPaid ? 'paid' : (req.paymentStatus || 'pending'),
          fulfillmentStatus: isPaid ? 'queued' : (req.fulfillmentStatus || 'payment_pending'),
          paidAt: isPaid ? (req.paidAt || cardData?.paidAt || new Date().toISOString()) : undefined,
          amount: req.amount || req.feeAmount || dynamicReplacementFee || 150,
        };
        saveDevCardRequest(req);
      }

      setActiveReplacementRequest(req);
      setEnquiryDetails({
        card: cardData,
        request: req,
      });
      setShowEnquiryModal(true);
    } catch (err: any) {
      console.error('Enquiry check error:', err);
      alert('Unable to load enquiry details: ' + (err?.message || err));
    } finally {
      setIsCheckingExpiry(false);
    }
  };

  // 7. Resolve Request & Issue Card (Super Administrators only)
  const handleResolveRequest = async (requestId: string, candidateName?: string, regNo?: string, email?: string) => {
    if (!canManageCardRequests) {
      alert('Access Denied: Only Super Administrators have permission to review, resolve, and re-issue replacement ID cards.');
      return;
    }
    const confirmed = confirm(`Confirm marking ID card request as RESOLVED and issuing a new active card for ${candidateName || 'this member'}?`);
    if (!confirmed) return;

    setResolvingRequestId(requestId);
    try {
      let resolvedViaApi = false;
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch('/api/idcard/resolve-request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({ requestId }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          resolvedViaApi = true;
        } else if (!data?.localDevFallback && !data?.error?.includes('credentials')) {
          throw new Error(data.error || 'Failed to resolve card request');
        }
      } catch (apiErr: any) {
        if (!apiErr?.message?.includes('credentials')) {
          console.warn('API resolve notice, using client fallback:', apiErr);
        }
      }

      // In local dev fallback or client execution: reactivate target member's card directly in Firestore
      if (email) {
        try {
          await updateDoc(doc(db, 'id_cards', email.toLowerCase().trim()), {
            status: 'Approved',
            activeRequestId: deleteField(),
            suspendedReason: deleteField(),
            suspendedAt: deleteField(),
            replacementPaid: deleteField(),
            paymentStatus: deleteField(),
            fulfillmentStatus: deleteField(),
            paidAt: deleteField(),
            requestDenied: deleteField(),
            denialMessage: deleteField(),
            deniedAt: deleteField(),
            updatedAt: new Date().toISOString(),
          });
        } catch (clientErr) {
          console.warn('Client updateDoc notice on resolve:', clientErr);
        }
      }

      // Direct Firestore deletion / resolution of id_card_requests document
      const idsToClearOnResolve = [requestId].filter(Boolean);
      for (const idToTry of idsToClearOnResolve) {
        try {
          await deleteDoc(doc(db, 'id_card_requests', idToTry));
        } catch {
          try {
            await updateDoc(doc(db, 'id_card_requests', idToTry), {
              fulfillmentStatus: 'resolved',
              status: 'resolved',
              resolvedAt: new Date().toISOString(),
              resolvedBy: currentUser?.email || 'Super Admin',
              updatedAt: new Date().toISOString(),
            });
          } catch (reqErr) {
            console.warn('Notice updating id_card_requests doc on resolve:', reqErr);
          }
        }
      }

      if (email) {
        try {
          const q = query(collection(db, 'id_card_requests'), where('userEmail', '==', email.toLowerCase().trim()));
          const snap = await getDocs(q);
          snap.forEach(async (d) => {
            await deleteDoc(d.ref).catch(() => {});
          });
        } catch (qErr) {
          console.warn('Notice querying id_card_requests by email on resolve:', qErr);
        }
      }

      // Mark resolved / deleted in local dev queue
      deleteDevCardRequest(requestId, email);

      // Immediately filter latestFirestoreListRef so synchronous dev updates won't resurrect this request
      latestFirestoreListRef.current = latestFirestoreListRef.current.filter(
        (r) => r.id !== requestId && r.requestId !== requestId && (!email || r.userEmail?.toLowerCase().trim() !== email.toLowerCase().trim())
      );

      // Update local candidates list immediately
      setCandidates(prev => prev.map(c =>
        ((email && c.email.toLowerCase().trim() === email.toLowerCase().trim()) || (regNo && c.registrationNumber === regNo))
          ? {
              ...c,
              status: 'Approved',
              activeRequestId: undefined,
              suspendedReason: undefined,
              replacementPaid: false,
              requestDenied: false,
              denialMessage: undefined,
              deniedAt: undefined,
            }
          : c
      ));

      if (currentUser?.email && email && currentUser.email.toLowerCase().trim() === email.toLowerCase().trim()) {
        setExistingSubmission(prev => prev ? {
          ...prev,
          status: 'Approved',
          activeRequestId: undefined,
          suspendedReason: undefined,
          replacementPaid: false,
          requestDenied: false,
          denialMessage: undefined,
          deniedAt: undefined,
        } : null);
        setActiveReplacementRequest(null);
      }

      setQueuedRequests((prev) =>
        prev.filter((r) => r.id !== requestId && r.requestId !== requestId && (!email || r.userEmail?.toLowerCase().trim() !== email.toLowerCase().trim()))
      );

      setResolveSuccessMessage(`Card issued and reactivated for ${candidateName || regNo || 'member'}!`);
      setTimeout(() => setResolveSuccessMessage(null), 4000);
    } catch (err: any) {
      alert('Failed to resolve request: ' + err.message);
    } finally {
      setResolvingRequestId(null);
    }
  };

  // 7b. Super Admin: Waive Fee and Re-issue Card immediately
  const handleAdminWaiveAndResolve = async (req: IDCardRequest) => {
    const confirmed = confirm(
      `[Super Admin Override]\n\nWaive replacement fee and APPROVE / RE-ISSUE ID card immediately for ${req.candidateName} (${req.registrationNumber})?`
    );
    if (!confirmed) return;

    await handleResolveRequest(req.id || req.requestId || '', req.candidateName, req.registrationNumber, req.userEmail);
  };

  // 7c. Super Admin: Cancel Request and Notify Requester that Request was Denied
  const handleAdminCancelRequest = async (req: IDCardRequest) => {
    const confirmed = confirm(
      `Deny and cancel replacement request for ${req.candidateName} (${req.registrationNumber})?\n\nThe user will receive a clear notice that their request was denied and they can try again.`
    );
    if (!confirmed) return;

    const email = (req.userEmail || req.email || '').toLowerCase().trim();
    const reqId = req.id || req.requestId || '';
    const nowIso = new Date().toISOString();

    // 1. Attempt API cancel request
    try {
      const authHeaders = await getAuthHeaders();
      await fetch('/api/idcard/cancel-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          requestId: reqId,
          reason: 'Denied by Super Administrator',
        }),
      });
    } catch (apiErr) {
      console.warn('API cancel request notice:', apiErr);
    }

    // 2. Direct Firestore update for target member's ID card (restored to Approved with denial message)
    if (email) {
      try {
        await updateDoc(doc(db, 'id_cards', email), {
          status: 'Approved',
          activeRequestId: deleteField(),
          suspendedReason: deleteField(),
          suspendedAt: deleteField(),
          replacementPaid: deleteField(),
          paymentStatus: deleteField(),
          fulfillmentStatus: deleteField(),
          paidAt: deleteField(),
          requestDenied: true,
          denialMessage: 'Your request has been denied and you can try again.',
          deniedAt: nowIso,
          updatedAt: nowIso,
        });
      } catch (e) {
        console.warn('Admin cancel request updateDoc notice:', e);
      }
    }

    // 2b. Direct Firestore deletion / denial of id_card_requests document
    const idsToClearOnCancel = [reqId, req.id, req.requestId].filter(Boolean) as string[];
    for (const idToTry of Array.from(new Set(idsToClearOnCancel))) {
      try {
        await deleteDoc(doc(db, 'id_card_requests', idToTry));
      } catch {
        try {
          await updateDoc(doc(db, 'id_card_requests', idToTry), {
            fulfillmentStatus: 'denied',
            status: 'cancelled',
            deniedAt: nowIso,
            deniedBy: currentUser?.email || 'Super Admin',
            denialReason: 'Denied by Super Administrator',
            updatedAt: nowIso,
          });
        } catch (reqErr) {
          console.warn('Notice updating id_card_requests doc on cancel:', reqErr);
        }
      }
    }

    if (email) {
      try {
        const q = query(collection(db, 'id_card_requests'), where('userEmail', '==', email));
        const snap = await getDocs(q);
        snap.forEach(async (d) => {
          await deleteDoc(d.ref).catch(() => {});
        });
      } catch (qErr) {
        console.warn('Notice querying id_card_requests by email on cancel:', qErr);
      }
    }

    // 3. Update dev storage
    deleteDevCardRequest(reqId, email);

    // 4. Immediately filter latestFirestoreListRef so synchronous dev updates won't resurrect this request
    latestFirestoreListRef.current = latestFirestoreListRef.current.filter(
      (r) => r.id !== reqId && r.requestId !== reqId && (!email || r.userEmail?.toLowerCase().trim() !== email)
    );

    // 5. Update candidates list in memory
    setCandidates((prev) =>
      prev.map((c) =>
        c.email.toLowerCase().trim() === email || (req.registrationNumber && c.registrationNumber === req.registrationNumber)
          ? {
              ...c,
              status: 'Approved',
              activeRequestId: undefined,
              suspendedReason: undefined,
              replacementPaid: false,
              requestDenied: true,
              denialMessage: 'Your request has been denied and you can try again.',
              deniedAt: nowIso,
            }
          : c
      )
    );

    // 6. Update existing submission if active user is this candidate
    if (existingSubmission && existingSubmission.email?.toLowerCase().trim() === email) {
      setExistingSubmission((prev) =>
        prev
          ? {
              ...prev,
              status: 'Approved',
              activeRequestId: undefined,
              suspendedReason: undefined,
              replacementPaid: false,
              requestDenied: true,
              denialMessage: 'Your request has been denied and you can try again.',
              deniedAt: nowIso,
            }
          : null
      );
      setActiveReplacementRequest(null);
    }

    setQueuedRequests((prev) =>
      prev.filter((r) => r.id !== reqId && r.requestId !== reqId && (!email || r.userEmail?.toLowerCase().trim() !== email))
    );

    setResolveSuccessMessage(`Replacement request denied and cancelled. Notification dispatched to ${req.candidateName}.`);
    setTimeout(() => setResolveSuccessMessage(null), 4000);
  };

  // 7d. Requester: Dismiss Denial Notification Banner
  const handleDismissDenialNotice = async () => {
    const email = (currentUser?.email || externalUser?.email || existingSubmission?.email || '').toLowerCase().trim();
    if (email) {
      try {
        await updateDoc(doc(db, 'id_cards', email), {
          requestDenied: deleteField(),
          denialMessage: deleteField(),
          deniedAt: deleteField(),
        });
      } catch (err) {
        console.warn('Dismiss denial notice error:', err);
      }
    }
    setExistingSubmission((prev) =>
      prev
        ? {
            ...prev,
            requestDenied: false,
            denialMessage: undefined,
            deniedAt: undefined,
          }
        : null
    );
  };

  // 7e. Manual Queue Refresh
  const handleRefreshQueue = () => {
    setIsRefreshingQueue(true);
    window.dispatchEvent(new Event('vrgc_dev_requests_updated'));
    setTimeout(() => {
      setIsRefreshingQueue(false);
      setResolveSuccessMessage('Card requests queue refreshed.');
      setTimeout(() => setResolveSuccessMessage(null), 3000);
    }, 600);
  };

  // 7f. Super Admin: Save ID Card Replacement Fee & Expiry Settings
  const handleSaveFeeSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const newFee = Math.max(1, Number(feeInput) || 150);
    const newExpiry = Math.max(5, Number(expiryInput) || 60);

    setIsSavingFeeSettings(true);
    try {
      const nowIso = new Date().toISOString();
      const payload = {
        idCardSettings: {
          replacementFee: newFee,
          expiryMinutes: newExpiry,
        },
        updatedAt: nowIso,
      };

      // 1. Update config/metadata and config/club_metadata in Firestore
      await Promise.allSettled([
        setDoc(doc(db, 'config', 'metadata'), payload, { merge: true }),
        setDoc(doc(db, 'config', 'club_metadata'), payload, { merge: true }),
      ]);

      // 2. Update local state immediately
      setDynamicReplacementFee(newFee);
      setDynamicExpiryMinutes(newExpiry);
      if (typeof window !== 'undefined') {
        localStorage.setItem('vrgc_dynamic_replacement_fee', String(newFee));
      }

      // Update active replacement request in memory and queuedRequests to reflect new fee
      setActiveReplacementRequest((prev) => prev ? { ...prev, amount: newFee, feeAmount: newFee } : null);
      setQueuedRequests((prev) => prev.map((r) => r.paymentStatus !== 'paid' ? { ...r, amount: newFee, feeAmount: newFee } : r));

      // 3. Log to admin activity logs
      try {
        await addDoc(collection(db, 'admin_logs'), {
          action: 'UPDATE_ID_CARD_SETTINGS',
          adminEmail: (currentUser?.email || externalUser?.email || 'Super Admin').toLowerCase().trim(),
          performedBy: currentUser?.displayName || currentUser?.email || 'Super Admin',
          details: `Updated ID Card replacement fee to ₹${newFee} (Expiry: ${newExpiry}m)`,
          timestamp: nowIso,
        });
      } catch (logErr) {
        console.warn('Failed to log admin action for fee change:', logErr);
      }

      setResolveSuccessMessage(`ID Card replacement fee updated to ₹${newFee} (Expiry: ${newExpiry}m)!`);
      setTimeout(() => setResolveSuccessMessage(null), 4000);
      setShowFeeSettingsModal(false);
    } catch (err: any) {
      alert('Failed to update ID Card fee settings: ' + (err?.message || err));
    } finally {
      setIsSavingFeeSettings(false);
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
          cacheControl: '1296000',
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
          try {
            // Fetch pasted GIF link and convert to Blob for Supabase storage
            const gifRes = await fetch(avatarUrlInput.trim());
            uploadBlob = await gifRes.blob();
            if (uploadBlob.type.includes('png')) avatarExt = 'png';
            else if (uploadBlob.type.includes('jpeg') || uploadBlob.type.includes('jpg')) avatarExt = 'jpg';
            else if (uploadBlob.type.includes('webp')) avatarExt = 'webp';
          } catch (e) {
            console.warn("Could not fetch remote GIF link as blob, saving link directly:", e);
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
              cacheControl: '1296000',
              upsert: true,
              contentType: uploadBlob.type || 'image/gif'
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
        submittedAt: new Date().toISOString(),
        status: 'Pending'
      };

      await setDoc(doc(db, 'id_cards', (currentUser.email || '').toLowerCase()), submissionData);

      // Trigger Google Sheets sync upon submission via server endpoint
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(`https://vrgc.club/card/${submissionData.registrationNumber}`)}`;
      const cardUrl = `https://vrgc.club/card/${submissionData.registrationNumber}`;

      try {
        const authHeaders = await getAuthHeaders().catch(() => ({}));
        fetch('/api/sheets/id-card', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({
            action: 'sync_idcard',
            email: submissionData.email,
            name: submissionData.name,
            regNo: submissionData.registrationNumber,
            registrationNumber: submissionData.registrationNumber,
            phone: submissionData.phone || '',
            team: submissionData.team || '',
            position: submissionData.position || 'Member',
            photoUrl: submissionData.photoUrl || '',
            avatarUrl: submissionData.avatarUrl || '',
            qrCode: qrCodeUrl,
            cardUrl: cardUrl,
            submittedAt: submissionData.submittedAt || '',
            status: submissionData.status || 'Pending',
          }),
        })
          .then(() => console.log("Google Sheets submission sync succeeded for:", submissionData.email))
          .catch(err => console.error("Google Sheets submission sync failed:", err));
      } catch (syncErr) {
        console.warn("Google Sheets submission sync notice:", syncErr);
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

  const handleSyncAllToSheets = async () => {
    if (sheetsCooldown > 0 || isSyncingSheets) return;

    setIsSyncingSheets(true);

    try {
      // Fetch latest active records from Firestore to ensure clean list (excluding deleted entries)
      const querySnap = await getDocs(collection(db, 'id_cards'));
      const activeCandidates: CandidateSubmission[] = [];
      querySnap.forEach((d) => activeCandidates.push({ id: d.id, ...d.data() } as CandidateSubmission));

      // Update local state list
      const sortedCandidates = activeCandidates.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      setCandidates(sortedCandidates);

      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/sheets/id-card', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          action: 'bulk_sync',
          candidates: sortedCandidates.map(c => {
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(`https://vrgc.club/card/${c.registrationNumber}`)}`;
            const cardUrl = `https://vrgc.club/card/${c.registrationNumber}`;
            return {
              email: c.email,
              name: c.name,
              regNo: c.registrationNumber,
              registrationNumber: c.registrationNumber,
              phone: c.phone || '',
              team: c.team || '',
              position: c.position || 'Member',
              photoUrl: c.photoUrl || '',
              avatarUrl: c.avatarUrl || '',
              qrCode: qrCodeUrl,
              cardUrl: cardUrl,
              submittedAt: c.submittedAt || '',
              status: c.status || 'Pending',
            };
          }),
        }),
      });

      const data = await res.json().catch(() => ({}));
      const successCount = typeof data?.count === 'number' ? data.count : sortedCandidates.length;

      setSyncToastMessage(`Parallel sync completed! Transmitted ${successCount} active ID record(s) to Google Sheets.`);
      setTimeout(() => setSyncToastMessage(null), 4500);
      setSheetsCooldown(60);

      // Log sync action
      logAdminAction(
        'FORCE_SHEETS_SYNC',
        `Initiated parallel sync to Google Sheets for ${sortedCandidates.length} candidate submissions`
      );
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

      // Send deletion signal to Google Sheets via server endpoint
      try {
        const authHeaders = await getAuthHeaders();
        fetch('/api/sheets/id-card', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({
            action: 'delete_idcard',
            email: candidate.email,
          }),
        })
          .then(() => console.log("Sent deletion notification to Google Sheets for:", candidate.email))
          .catch(err => console.error("Sheets deletion call failed:", err));
      } catch (delErr) {
        console.error("Sheets deletion call error:", delErr);
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
      setTimeout(() => setSyncToastMessage(null), 4500);

      // Log delete action
      logAdminAction(
        'DELETE_DOSSIER',
        `Deleted candidate ID card dossier for ${candidate.name} (${candidate.registrationNumber || 'No Reg'})`,
        candidate.email,
        candidate.name,
        candidate.registrationNumber
      );
    } catch (err: any) {
      console.error("Delete failed:", err);
      setSyncToastMessage("Failed to delete entry: " + (err?.message || err));
      setTimeout(() => setSyncToastMessage(null), 4500);
    }
  };

  const toggleStatus = async (candidate: CandidateSubmission) => {
    if (candidate.status?.toLowerCase() === 'suspended') {
      alert(
        `Action Blocked: This ID card is currently SUSPENDED due to an active lost/damaged card replacement request (${candidate.activeRequestId || 'Active Request'}).\n\nIt cannot be directly approved or modified here. The member must complete the replacement fee payment, and only a Super Administrator can resolve and re-issue the card through the "CARD REQUESTS" queue.`
      );
      return;
    }

    try {
      const currentStatus = candidate.status || 'Pending';
      const newStatus = currentStatus === 'Approved' ? 'Pending' : 'Approved';
      await updateDoc(doc(db, 'id_cards', candidate.email.toLowerCase()), {
        status: newStatus
      });

      // Update local state list
      setCandidates(prev => prev.map(c =>
        c.email.toLowerCase() === candidate.email.toLowerCase()
          ? { ...c, status: newStatus }
          : c
      ));

      // Trigger status update in Google Sheets via server endpoint
      try {
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(`https://vrgc.club/card/${candidate.registrationNumber}`)}`;
        const cardUrl = `https://vrgc.club/card/${candidate.registrationNumber}`;

        const authHeaders = await getAuthHeaders();
        fetch('/api/sheets/id-card', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({
            action: 'sync_idcard',
            email: candidate.email,
            name: candidate.name,
            regNo: candidate.registrationNumber,
            registrationNumber: candidate.registrationNumber,
            phone: candidate.phone || '',
            team: candidate.team || '',
            position: candidate.position || 'Member',
            photoUrl: candidate.photoUrl || '',
            avatarUrl: candidate.avatarUrl || '',
            qrCode: qrCodeUrl,
            cardUrl: cardUrl,
            submittedAt: candidate.submittedAt || '',
            status: newStatus,
          }),
        }).catch(err => console.error("Sheets status sync error:", err));
      } catch (toggleErr) {
        console.error("Sheets status sync trigger error:", toggleErr);
      }

      if (previewCandidate && previewCandidate.email.toLowerCase() === candidate.email.toLowerCase()) {
        setPreviewCandidate(prev => prev ? { ...prev, status: newStatus } : null);
      }

      setSyncToastMessage(`Updated status for ${candidate.name} to ${newStatus}.`);
      setTimeout(() => setSyncToastMessage(null), 3000);

      // Log status change
      logAdminAction(
        newStatus === 'Approved' ? 'APPROVE_DOSSIER' : 'REVERT_PENDING_DOSSIER',
        newStatus === 'Approved'
          ? `Approved digital identity dossier for ${candidate.name} (${candidate.registrationNumber || 'No Reg'})`
          : `Reverted dossier for ${candidate.name} (${candidate.registrationNumber || 'No Reg'}) back to Pending`,
        candidate.email,
        candidate.name,
        candidate.registrationNumber
      );
    } catch (err: any) {
      console.error("Status update failed:", err);
      setSyncToastMessage("Failed to update status: " + (err?.message || err));
      setTimeout(() => setSyncToastMessage(null), 4000);
    }
  };

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const reg = (c.registrationNumber || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const search = searchQuery.toLowerCase();

      const matchesSearch = name.includes(search) || reg.includes(search) || email.includes(search);

      let matchesTeam = false;
      if (selectedTeam === 'All') {
        matchesTeam = true;
      } else if (selectedTeam.toLowerCase() === 'management') {
        const team = (c.team || '').toLowerCase();
        const pos = (c.position || '').toLowerCase();
        matchesTeam =
          team.includes('management') ||
          team.includes('coordinator') ||
          team.includes('president') ||
          pos.includes('management') ||
          pos.includes('coordinator') ||
          pos.includes('president');
      } else if (selectedTeam === 'Esports (Mobile)' || selectedTeam === 'Esports(Mobile)') {
        const team = (c.team || '').toLowerCase();
        matchesTeam = team.includes('mobile') || team === 'esports(mobile)';
      } else if (selectedTeam === 'Esports (PC)' || selectedTeam === 'Esports(PC)') {
        const team = (c.team || '').toLowerCase();
        matchesTeam = team.includes('pc') || team === 'esports(pc)';
      } else {
        matchesTeam = c.team && c.team.toLowerCase() === selectedTeam.toLowerCase();
      }

      let matchesStatus = true;
      if (selectedStatus !== 'All') {
        const cStatus = (c.status || 'Pending').toLowerCase();
        if (selectedStatus === 'suspended') {
          matchesStatus = cStatus === 'suspended';
        } else if (selectedStatus === 'suspended_unpaid') {
          const isPaid = Boolean(
            c.replacementPaid ||
            c.paymentStatus === 'paid' ||
            c.fulfillmentStatus === 'queued' ||
            queuedRequests.some(
              (r) =>
                (r.userEmail?.toLowerCase() === c.email?.toLowerCase() ||
                  (c.activeRequestId && (r.id === c.activeRequestId || r.requestId === c.activeRequestId))) &&
                (r.paymentStatus === 'paid' || r.fulfillmentStatus === 'queued')
            )
          );
          matchesStatus = cStatus === 'suspended' && !isPaid;
        } else if (selectedStatus === 'suspended_paid') {
          const isPaid = Boolean(
            c.replacementPaid ||
            c.paymentStatus === 'paid' ||
            c.fulfillmentStatus === 'queued' ||
            queuedRequests.some(
              (r) =>
                (r.userEmail?.toLowerCase() === c.email?.toLowerCase() ||
                  (c.activeRequestId && (r.id === c.activeRequestId || r.requestId === c.activeRequestId))) &&
                (r.paymentStatus === 'paid' || r.fulfillmentStatus === 'queued')
            )
          );
          matchesStatus = cStatus === 'suspended' && isPaid;
        } else {
          matchesStatus = cStatus === selectedStatus.toLowerCase();
        }
      }

      return matchesSearch && matchesTeam && matchesStatus;
    });
  }, [candidates, searchQuery, selectedTeam, selectedStatus, queuedRequests]);

  const visibleCandidates = useMemo(() => {
    return filteredCandidates.slice(0, dossierPageLimit);
  }, [filteredCandidates, dossierPageLimit]);

  if (authLoading) {
    return (
      <div className="flex-grow min-h-[calc(100dvh-132px)] md:min-h-[70vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <span className="material-symbols-outlined text-[64px] text-primary animate-spin">
            sync
          </span>
          <p className="font-code-sm text-primary tracking-widest text-sm">
            VALIDATING REGISTERED IDENTITY...
          </p>
        </div>
      </div>
    );
  }

  if (!currentUser || !isAuthorized) {
    return (
      <div className="flex-grow min-h-[calc(100dvh-132px)] md:min-h-[calc(100vh-76px)] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden text-left bg-mesh">
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
      </div>
    );
  }

  return (
    <div className="flex-grow w-full relative overflow-hidden text-left bg-mesh pb-12 sm:pb-16">
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
            <SpecularButton
              size="xs"
              radius={10}
              tint="#e11d48"
              tintOpacity={0.2}
              lineColor="#fb7185"
              baseColor="#881337"
              intensity={1.1}
              onClick={handleLogout}
              className="font-bold text-rose-400 font-label-caps tracking-wider"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              <span>LOGOUT</span>
            </SpecularButton>
          </div>
        </header>

        {/* Tab Headers (Admins Only) */}
        {isAdmin && (
          <div className="flex border-b border-outline-variant/30 mb-8 relative z-20">
            <button
              onClick={() => setActiveSubTab('portal')}
              className={`px-6 py-3 font-label-caps tracking-wider text-xs md:text-sm font-bold border-b-2 transition-all duration-300 ${activeSubTab === 'portal'
                ? 'border-primary text-primary shadow-[0_4px_12px_rgba(207,92,255,0.15)]'
                : 'border-transparent text-on-surface-variant hover:text-white'
                }`}
            >
              ID CARD PORTAL
            </button>
            <button
              onClick={() => setActiveSubTab('admin')}
              className={`px-6 py-3 font-label-caps tracking-wider text-xs md:text-sm font-bold border-b-2 transition-all duration-300 flex items-center gap-2 ${activeSubTab === 'admin'
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
                {/* Denial Alert Banner (if previous replacement request was denied by admin) */}
                {Boolean(existingSubmission.requestDenied && existingSubmission.status !== 'suspended') && (
                  <div className="w-full max-w-[420px] mb-6 p-4 rounded-2xl bg-gradient-to-b from-amber-950/85 to-black/90 border border-amber-500/60 shadow-[0_0_30px_rgba(245,158,11,0.25)] space-y-3 text-center animate-in fade-in duration-300">
                    <div className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-amber-400 text-lg">info</span>
                      <span className="text-xs font-black tracking-widest uppercase font-mono text-amber-300">
                        REPLACEMENT REQUEST DENIED
                      </span>
                    </div>

                    <p className="text-xs text-amber-200/95 leading-relaxed font-medium">
                      {existingSubmission.denialMessage || 'Your request has been denied and you can try again.'}
                    </p>

                    <div className="flex items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          handleDismissDenialNotice();
                          setReportLostError('');
                          setShowReportLostModal(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-98"
                      >
                        <span className="material-symbols-outlined text-sm font-bold">refresh</span>
                        <span>Try Again</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleDismissDenialNotice}
                        className="px-3.5 py-2 rounded-xl bg-black/50 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-mono font-bold flex items-center justify-center gap-1 cursor-pointer transition-all"
                      >
                        <span>Dismiss</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Suspended Alert Banner (if card is suspended) */}
                {existingSubmission.status === 'suspended' && (() => {
                  const isSuspendedPaid = Boolean(
                    existingSubmission.replacementPaid ||
                    existingSubmission.paymentStatus === 'paid' ||
                    existingSubmission.fulfillmentStatus === 'queued' ||
                    activeReplacementRequest?.paymentStatus === 'paid' ||
                    activeReplacementRequest?.fulfillmentStatus === 'queued'
                  );
                  const feeAmount = dynamicReplacementFee > 0 ? dynamicReplacementFee : (activeReplacementRequest?.amount || 150);

                  return (
                    <div className="w-full max-w-[420px] mb-6 p-4 rounded-2xl bg-gradient-to-b from-rose-950/70 to-black/80 border border-rose-500/50 shadow-[0_0_30px_rgba(244,63,94,0.25)] space-y-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping shrink-0" />
                        <span className="text-xs font-black tracking-widest uppercase font-mono text-rose-300">
                          CARD SUSPENDED • REPORTED LOST / DAMAGED
                        </span>
                      </div>

                      <p className="text-xs text-rose-200/90 leading-relaxed">
                        {isSuspendedPaid
                          ? 'Your replacement fee is confirmed! Your replacement request has been forwarded to the Super Admin re-issuance queue.'
                          : `Your card is currently deactivated. Complete the replacement fee of ₹${feeAmount} to queue your card for administrative re-issuance.`}
                      </p>

                      {!isSuspendedPaid && (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between text-[11px] font-mono px-3 py-1.5 rounded-xl bg-black/40 border border-rose-900/40 text-rose-300">
                            <span>Fee Due: ₹{feeAmount}</span>
                            <span>
                              Status: <strong className="text-amber-400">Payment Pending</strong>
                            </span>
                          </div>

                          {existingSubmission.activeRequestId && (
                            <div className="flex items-center justify-between text-[10px] font-mono px-3 py-1 rounded-lg bg-black/30 border border-white/5 text-rose-300/80">
                              <span>Request ID:</span>
                              <span className="font-bold text-rose-200">
                                {formatDisplayId(existingSubmission.activeRequestId, 'REQ')}
                              </span>
                            </div>
                          )}

                          <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                const req = activeReplacementRequest || getDevCardRequests().find(r => r.userEmail === currentUser?.email);
                                const oid = req?.orderId || req?.razorpayOrderId || '';
                                const amt = feeAmount;
                                const cur = req?.currency || 'INR';
                                const rid = req?.id || req?.requestId || existingSubmission?.activeRequestId || generateShortId('REQ');
                                const iid = req?.invoiceId || req?.paymentId || rid;
                                handleOpenRazorpayCheckout(oid, amt, cur, rid, iid);
                              }}
                              className="w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-98"
                            >
                              <span className="material-symbols-outlined text-sm">payment</span>
                              <span>Pay Replacement Fee (₹{feeAmount})</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCancelOrCheckExpiry(true)}
                              disabled={isCheckingExpiry}
                              className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl bg-black/50 hover:bg-rose-950/60 border border-rose-500/30 text-rose-300 hover:text-white text-xs font-mono font-bold flex items-center justify-center gap-1 cursor-pointer transition-all shrink-0"
                              title="Cancel request and unlock ID card immediately"
                            >
                              <span className="material-symbols-outlined text-xs">close</span>
                              <span>Cancel</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {isSuspendedPaid && (
                        <div className="p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-500/40 flex items-center justify-center gap-2 text-indigo-300 text-xs font-mono font-bold">
                          <span className="material-symbols-outlined text-sm text-indigo-400 animate-pulse">hourglass_top</span>
                          <span>In Super Admin Re-Issuance Queue</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 3D Flip Card Container */}
                <div
                  onClick={() => existingSubmission.status !== 'suspended' && setIsFlipped(!isFlipped)}
                  className={`relative w-full max-w-[340px] aspect-[2.2/3.4] group [perspective:1000px] ${
                    existingSubmission.status === 'suspended'
                      ? 'pointer-events-none grayscale opacity-60 filter contrast-75 cursor-not-allowed select-none'
                      : 'cursor-pointer'
                  }`}
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
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(`${typeof window !== 'undefined' ? window.location.origin : 'https://vrgc.club'}/card/${existingSubmission.registrationNumber || ''}`)}`}
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
                  {existingSubmission.status === 'suspended' ? (
                    <div className="flex items-center gap-1.5 text-[10px] text-rose-400 font-bold bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/30 font-mono">
                      <span className="material-symbols-outlined text-xs text-rose-400">lock</span>
                      <span>CARD SUSPENDED (REPLACEMENT IN PROGRESS)</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-[10px] text-green-400 font-bold bg-green-500/5 px-2.5 py-1 rounded-full border border-green-500/20">
                      <span className="material-symbols-outlined text-xs">verified</span>
                      <span>DOSSIER ACTIVE (RESPONSE RECORDED)</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
                    {existingSubmission.status !== 'suspended' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDownload(existingSubmission)}
                          className="group flex items-center gap-2 px-5 py-2.5 rounded-full border border-[#a855f7]/30 hover:border-[#a855f7] hover:text-white transition-all text-xs font-bold font-label-caps bg-black/40 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">download</span>
                          <span>DOWNLOAD PHOTO</span>
                        </button>
                        {existingSubmission.avatarUrl && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const response = await fetch(existingSubmission.avatarUrl);
                                const blob = await response.blob();
                                const blobUrl = window.URL.createObjectURL(blob);
                                const link = document.createElement('a');
                                link.href = blobUrl;
                                link.download = `${existingSubmission.registrationNumber || 'ID'}_Avatar.jpg`;
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                                window.URL.revokeObjectURL(blobUrl);
                              } catch (err) {
                                window.open(existingSubmission.avatarUrl, '_blank');
                              }
                            }}
                            className="group flex items-center gap-2 px-5 py-2.5 rounded-full border border-[#a855f7]/30 hover:border-[#a855f7] hover:text-white transition-all text-xs font-bold font-label-caps bg-black/40 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-sm">sports_esports</span>
                            <span>DOWNLOAD AVATAR</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReportLostError('');
                            setShowReportLostModal(true);
                          }}
                          className="group flex items-center gap-2 px-5 py-2.5 rounded-full border border-rose-500/40 hover:border-rose-400 bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 hover:text-white transition-all text-xs font-bold font-label-caps cursor-pointer shadow-[0_0_15px_rgba(244,63,94,0.15)]"
                        >
                          <span className="material-symbols-outlined text-sm text-rose-400">report_problem</span>
                          <span>REPORT LOST / DAMAGED</span>
                        </button>
                      </>
                    )}

                    {existingSubmission.status === 'suspended' && (
                      <button
                        type="button"
                        onClick={handleCheckStatusOrEnquiry}
                        disabled={isCheckingExpiry}
                        className="flex items-center gap-2 px-6 py-3 rounded-full border border-purple-500/50 hover:border-purple-400 bg-purple-950/60 hover:bg-purple-900/70 text-purple-200 hover:text-white text-xs font-mono font-bold cursor-pointer transition-all shadow-[0_0_25px_rgba(168,85,247,0.35)] hover:scale-102 active:scale-98"
                      >
                        <span className={`material-symbols-outlined text-sm text-purple-300 ${isCheckingExpiry ? 'animate-spin' : ''}`}>sync</span>
                        <span>{isCheckingExpiry ? 'Checking Live Status...' : 'Check Status / Enquiry'}</span>
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
                          disabled={isSubmitting}
                          className="w-full sm:w-auto bg-white/5 hover:bg-white/15 text-white border border-white/25 hover:border-white/50 font-bold py-3.5 px-8 rounded-full shadow-[0_0_20px_rgba(255,255,255,0.05)] hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] hover:scale-[1.01] active:scale-95 transition-all flex items-center justify-center gap-2 text-xs font-label-caps tracking-widest uppercase"
                          type="submit"
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

                      {/* Load More Activity Logs Button */}
                      {visibleLogs.length < filteredLogs.length && (
                        <div className="text-center py-3 border-t border-white/5 bg-black/20">
                          <button
                            type="button"
                            onClick={() => setLogPageLimit(prev => prev + 20)}
                            className="px-5 py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-bold font-label-caps tracking-wider hover:bg-purple-500/20 hover:border-purple-500/50 transition-all duration-300 active:scale-95 inline-flex items-center gap-2"
                          >
                            <span className="material-symbols-outlined text-sm">expand_more</span>
                            <span>LOAD MORE LOGS ({filteredLogs.length - visibleLogs.length} REMAINING)</span>
                          </button>
                        </div>
                      )}
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

            {/* Admin section header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/5 pb-4">
              <div>
                <h3 className="font-display-lg text-lg text-white font-bold uppercase tracking-wider flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-base">admin_panel_settings</span>
                    Candidate Dossier Submissions
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-red-500/20 text-red-300 border border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                    {candidates.length} / {Math.max(candidates.length, totalMembers)} MEMBERS
                  </span>
                </h3>
                <p className="text-xs text-on-surface-variant max-w-lg mt-0.5">
                  Select and verify candidate digital identity dossiers.
                </p>
              </div>

              <button
                disabled={isSyncingSheets || sheetsCooldown > 0}
                onClick={handleSyncAllToSheets}
                className={`px-4 py-2.5 rounded-xl border text-xs font-label-caps tracking-wider flex items-center justify-center gap-2 shrink-0 transition-all duration-300 font-bold ${sheetsCooldown > 0 || isSyncingSheets
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
            <div className="flex items-center gap-2.5 border-b border-white/10 pb-3 flex-wrap">
              <button
                type="button"
                onClick={() => setAdminSectionTab('dossiers')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold font-label-caps tracking-wider flex items-center gap-2 transition-all duration-200 cursor-pointer ${adminSectionTab === 'dossiers'
                  ? 'bg-primary/20 border border-primary/40 text-white shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                  : 'bg-black/30 border border-white/5 text-white/60 hover:text-white hover:bg-white/5'
                  }`}
              >
                <span className="material-symbols-outlined text-base">badge</span>
                <span>DOSSIERS ({candidates.length})</span>
              </button>

              {canManageCardRequests && (
                <button
                  type="button"
                  onClick={() => setAdminSectionTab('requests')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold font-label-caps tracking-wider flex items-center gap-2 transition-all duration-200 cursor-pointer ${adminSectionTab === 'requests'
                    ? 'bg-indigo-600/30 border border-indigo-500 text-white shadow-[0_0_18px_rgba(99,102,241,0.35)]'
                    : 'bg-black/30 border border-white/5 text-white/60 hover:text-white hover:bg-white/5'
                    }`}
                >
                  <span className="material-symbols-outlined text-base text-indigo-400">published_with_changes</span>
                  <span>CARD REQUESTS</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    SUPER ADMIN
                  </span>
                  {queuedRequests.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500 text-white shadow-sm animate-pulse">
                      {queuedRequests.length}
                    </span>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => setAdminSectionTab('logs')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold font-label-caps tracking-wider flex items-center gap-2 transition-all duration-200 cursor-pointer ${adminSectionTab === 'logs'
                  ? 'bg-primary/20 border border-primary/40 text-white shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                  : 'bg-black/30 border border-white/5 text-white/60 hover:text-white hover:bg-white/5'
                  }`}
              >
                <span className="material-symbols-outlined text-base">history</span>
                <span>ACTIVITY LOGS ({adminLogs.length})</span>
              </button>

              {canManageCardRequests && (
                <div className="ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setFeeInput(dynamicReplacementFee);
                      setExpiryInput(dynamicExpiryMinutes);
                      setShowFeeSettingsModal(true);
                    }}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold font-mono tracking-wider flex items-center gap-1.5 bg-gradient-to-r from-purple-950/80 to-indigo-950/80 hover:from-purple-900 hover:to-indigo-900 border border-purple-500/40 hover:border-purple-400 text-purple-200 hover:text-white transition-all cursor-pointer shadow-sm active:scale-98"
                    title="Super Admin: Click to change ID Card replacement fee & expiry window"
                  >
                    <span className="material-symbols-outlined text-sm text-purple-400">payments</span>
                    <span>ID FEE: ₹{dynamicReplacementFee}</span>
                    <span className="material-symbols-outlined text-xs text-purple-300 opacity-80">edit</span>
                  </button>
                </div>
              )}
            </div>

            {/* DOSSIERS SUB-TAB */}
            {adminSectionTab === 'dossiers' && (
              <div className="space-y-6">
                <div className="glass-panel p-3.5 sm:p-4 rounded-2xl border border-purple-500/25 bg-[#090214]/90 flex flex-col md:flex-row md:items-center gap-3 sm:gap-4 shadow-xl relative z-30">
                  {/* Search Input */}
                  <div className="relative flex-1 w-full">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-purple-400 text-base">search</span>
                    <input
                      type="text"
                      placeholder="Search candidate name, reg number, or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[#05010a] border border-purple-500/30 rounded-xl pl-9 pr-8 py-2 text-xs text-white focus:outline-none focus:border-purple-400 placeholder:text-slate-500 font-mono transition-all"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs p-1"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    )}
                  </div>

                  {/* Filter Selects & View Mode Toggle */}
                  <div className="flex items-center justify-between md:justify-end gap-2.5 shrink-0 w-full md:w-auto flex-wrap sm:flex-nowrap">
                    {/* Team Filter Dropdown */}
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setIsTeamDropdownOpen(!isTeamDropdownOpen);
                          setIsStatusDropdownOpen(false);
                        }}
                        className="px-3 py-2 rounded-xl bg-[#070210] border border-purple-500/30 hover:border-purple-400 text-xs font-bold font-mono text-purple-200 flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                      >
                        <span className="text-[10px] text-purple-400 font-black">TEAM:</span>
                        <span className="truncate max-w-[110px] text-white">{selectedTeam}</span>
                        <span className={`material-symbols-outlined text-xs text-purple-400 transition-transform ${isTeamDropdownOpen ? 'rotate-180' : ''}`}>
                          expand_more
                        </span>
                      </button>

                      {isTeamDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setIsTeamDropdownOpen(false)} />
                          <div className="absolute right-0 top-full mt-2 z-50 bg-[#0d041c] border border-purple-500/50 rounded-2xl p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.95)] w-52 space-y-1 text-left animate-in fade-in duration-100">
                            {[
                              'All',
                              'Technical',
                              'Design',
                              'Education',
                              'Esports (PC)',
                              'Esports (Mobile)',
                              'PR',
                              'Social Media',
                              'Management'
                            ].map((tm) => (
                              <button
                                key={tm}
                                type="button"
                                onClick={() => {
                                  setSelectedTeam(tm);
                                  setIsTeamDropdownOpen(false);
                                }}
                                className={`w-full px-3 py-2 rounded-xl text-xs font-mono font-bold flex items-center justify-between transition-colors cursor-pointer ${
                                  selectedTeam === tm
                                    ? 'bg-purple-600/35 text-white border border-purple-400/40'
                                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                                }`}
                              >
                                <span>{tm === 'All' ? 'All Teams' : tm}</span>
                                {selectedTeam === tm && (
                                  <span className="material-symbols-outlined text-xs text-purple-300">check</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Status Filter Dropdown */}
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setIsStatusDropdownOpen(!isStatusDropdownOpen);
                          setIsTeamDropdownOpen(false);
                        }}
                        className="px-3 py-2 rounded-xl bg-[#070210] border border-purple-500/30 hover:border-purple-400 text-xs font-bold font-mono text-purple-200 flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                      >
                        <span className="text-[10px] text-purple-400 font-black">STATUS:</span>
                        <span className="text-white max-w-[130px] truncate">
                          {selectedStatus === 'suspended_unpaid'
                            ? 'Suspended (Unpaid)'
                            : selectedStatus === 'suspended_paid'
                            ? 'Suspended (Paid)'
                            : selectedStatus === 'suspended'
                            ? 'Suspended'
                            : selectedStatus}
                        </span>
                        <span className={`material-symbols-outlined text-xs text-purple-400 transition-transform ${isStatusDropdownOpen ? 'rotate-180' : ''}`}>
                          expand_more
                        </span>
                      </button>

                      {isStatusDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setIsStatusDropdownOpen(false)} />
                          <div className="absolute right-0 top-full mt-2 z-50 bg-[#0d041c] border border-purple-500/50 rounded-2xl p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.95)] w-56 space-y-1 text-left animate-in fade-in duration-100">
                            {[
                              { label: 'All Statuses', value: 'All', icon: 'list' },
                              { label: 'Approved', value: 'Approved', icon: 'verified', color: 'text-emerald-300' },
                              { label: 'Pending', value: 'Pending', icon: 'hourglass_empty', color: 'text-amber-300' },
                              { label: 'Suspended (All)', value: 'suspended', icon: 'lock_person', color: 'text-rose-300' },
                              { label: 'Suspended (Unpaid)', value: 'suspended_unpaid', icon: 'schedule', color: 'text-amber-400' },
                              { label: 'Suspended (Paid)', value: 'suspended_paid', icon: 'task_alt', color: 'text-emerald-400' },
                            ].map((st) => (
                              <button
                                key={st.value}
                                type="button"
                                onClick={() => {
                                  setSelectedStatus(st.value);
                                  setIsStatusDropdownOpen(false);
                                }}
                                className={`w-full px-3 py-2 rounded-xl text-xs font-mono font-bold flex items-center justify-between transition-colors cursor-pointer ${
                                  selectedStatus === st.value
                                    ? 'bg-purple-600/35 text-white border border-purple-400/40'
                                    : `${st.color || 'text-slate-300'} hover:text-white hover:bg-white/5`
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="material-symbols-outlined text-sm">{st.icon}</span>
                                  <span>{st.label}</span>
                                </div>
                                {selectedStatus === st.value && (
                                  <span className="material-symbols-outlined text-xs text-purple-300">check</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* 3D Card View Switch */}
                    <button
                      type="button"
                      onClick={() => setAdminViewMode(prev => prev === 'cards' ? 'list' : 'cards')}
                      className="p-2 rounded-xl bg-[#070210] border border-purple-500/30 text-purple-300 hover:text-white hover:border-purple-400 transition-all duration-200 flex items-center justify-center shrink-0 active:scale-95 cursor-pointer"
                      title={adminViewMode === 'cards' ? 'Switch to List View' : 'Switch to 3D Cards View'}
                    >
                      <span className="material-symbols-outlined text-base">
                        {adminViewMode === 'cards' ? 'format_list_bulleted' : 'style'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="glass-panel p-4 rounded-2xl relative space-y-4 pb-28 sm:pb-16 z-10">
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

                        {visibleCandidates.map((c, index) => {
                          const submissionDate = c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : "N/A";
                          const display = getAdminDisplayRoleOrTeam(c.team, c.position);
                          const isNearBottom = index >= Math.max(1, filteredCandidates.length - 2);

                          const isSusp = c.status?.toLowerCase() === 'suspended';
                          const cReq = isSusp
                            ? queuedRequests.find(
                                (r) =>
                                  r.userEmail?.toLowerCase() === c.email?.toLowerCase() ||
                                  (c.activeRequestId && (r.id === c.activeRequestId || r.requestId === c.activeRequestId))
                              )
                            : null;
                          const isSuspPaid = Boolean(
                            c.replacementPaid ||
                            c.paymentStatus === 'paid' ||
                            c.fulfillmentStatus === 'queued' ||
                            cReq?.paymentStatus === 'paid' ||
                            cReq?.fulfillmentStatus === 'queued'
                          );
                          const feeVal = cReq?.amount || cReq?.feeAmount || c.replacementFee || dynamicReplacementFee || 150;

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

                                <div className="col-span-2 text-center flex items-center justify-center">
                                  {isSusp ? (
                                    <span className="px-3 py-1 rounded-full border border-rose-500/40 bg-rose-500/15 text-rose-300 text-[9px] font-label-caps font-bold tracking-wider flex items-center gap-1.5 animate-pulse">
                                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                      SUSPENDED
                                    </span>
                                  ) : (
                                    <span
                                      className={`px-3 py-1 rounded-full border text-[9px] font-label-caps font-bold tracking-wider flex items-center gap-1.5 ${
                                        c.status === 'Approved'
                                          ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                          : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                                      }`}
                                    >
                                      <span
                                        className={`w-1.5 h-1.5 rounded-full ${
                                          c.status === 'Approved' ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'
                                        }`}
                                      />
                                      {c.status || 'Pending'}
                                    </span>
                                  )}
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

                                  {isSusp ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAdminSectionTab('requests');
                                        setRequestSearchQuery(c.name || c.registrationNumber || c.email);
                                      }}
                                      className="p-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 hover:text-white transition-all shrink-0 cursor-pointer shadow-sm"
                                      title={isSuspPaid ? "Card Suspended (Fee Paid): View in Card Requests queue to Approve & Re-Issue" : "Card Suspended (Payment Not Completed): View in Card Requests queue to Waive Fee or Cancel"}
                                    >
                                      <span className="material-symbols-outlined text-sm">open_in_new</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); toggleStatus(c); }}
                                      className={`p-2 rounded-lg border transition-all shrink-0 ${c.status === 'Approved'
                                        ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20'
                                        : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                                        }`}
                                      title={c.status === 'Approved' ? 'Mark as Pending' : 'Approve Dossier'}
                                    >
                                      <span className="material-symbols-outlined text-sm">
                                        {c.status === 'Approved' ? 'history' : 'verified'}
                                      </span>
                                    </button>
                                  )}

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
                              <div className="flex md:hidden flex-col p-3.5 space-y-2.5">
                                <div className="flex items-center justify-between gap-2.5">
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="w-10 h-10 rounded-lg border border-primary/30 bg-black/40 overflow-hidden shrink-0">
                                      <img src={c.photoUrl} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="font-bold text-white text-xs truncate">{c.name}</div>
                                      <div className="text-[10px] text-primary font-code-sm font-bold">{c.registrationNumber}</div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    {isSusp ? (
                                      <span className="px-2 py-0.5 rounded-full border border-rose-500/40 bg-rose-500/15 text-rose-300 text-[8px] font-label-caps font-bold tracking-wider animate-pulse">
                                        SUSPENDED
                                      </span>
                                    ) : (
                                      <span
                                        className={`px-2 py-0.5 rounded-full border text-[8px] font-label-caps font-bold tracking-wider ${
                                          c.status === 'Approved'
                                            ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                            : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                                        }`}
                                      >
                                        {c.status || 'Pending'}
                                      </span>
                                    )}

                                    {/* Mobile 3-Dots Menu Box */}
                                    <div className="relative">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const menuKey = c.id || c.email;
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          const spaceBelow = window.innerHeight - rect.bottom;
                                          const openUp = spaceBelow < 220;
                                          setMenuDirections(prev => ({ ...prev, [menuKey]: openUp ? 'up' : 'down' }));
                                          setOpenMenuId(openMenuId === menuKey ? null : menuKey);
                                        }}
                                        className="p-1.5 rounded-lg bg-black/60 border border-white/10 text-white/80 hover:text-white hover:border-purple-500/50 transition-all"
                                        title="Actions Menu"
                                      >
                                        <span className="material-symbols-outlined text-base">more_vert</span>
                                      </button>

                                      {openMenuId === (c.id || c.email) && (
                                        <div
                                          onClick={(e) => e.stopPropagation()}
                                          className={`absolute right-0 ${menuDirections[c.id || c.email] === 'up' ? 'bottom-full mb-2' : 'top-9'
                                            } z-[300] w-48 bg-[#12081c] border border-[#a855f7]/40 backdrop-blur-2xl rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.9)] py-1.5 text-xs font-body-md`}
                                        >
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOpenMenuId(null);
                                              setPreviewCandidate(c);
                                              setPreviewModalTab('card');
                                              setPreviewFlipped(false);
                                            }}
                                            className="w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 text-purple-400 font-bold hover:bg-white/10 transition-colors"
                                          >
                                            <span className="material-symbols-outlined text-base">style</span>
                                            <span>3D Card View</span>
                                          </button>

                                          {c.status?.toLowerCase() === 'suspended' ? (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuId(null);
                                                setAdminSectionTab('requests');
                                                setRequestSearchQuery(c.name || c.registrationNumber || c.email);
                                              }}
                                              className="w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 text-amber-300 font-bold hover:bg-white/10 transition-colors"
                                            >
                                              <span className="material-symbols-outlined text-base">open_in_new</span>
                                              <span>{isSuspPaid ? 'View in Requests Queue' : 'Manage Unpaid Request'}</span>
                                            </button>
                                          ) : (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuId(null);
                                                toggleStatus(c);
                                              }}
                                              className={`w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 hover:bg-white/10 transition-colors ${c.status === 'Approved' ? 'text-yellow-400 font-bold' : 'text-green-400 font-bold'
                                                }`}
                                            >
                                              <span className="material-symbols-outlined text-base">
                                                {c.status === 'Approved' ? 'history' : 'verified'}
                                              </span>
                                              <span>{c.status === 'Approved' ? 'Mark Pending' : 'Approve Dossier'}</span>
                                            </button>
                                          )}

                                          <button
                                            disabled={downloadingId === c.id}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOpenMenuId(null);
                                              handleDownload(c);
                                            }}
                                            className="w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 text-white/90 hover:bg-white/10 transition-colors font-bold"
                                          >
                                            <span className={`material-symbols-outlined text-base ${downloadingId === c.id ? 'animate-spin' : ''}`}>
                                              {downloadingId === c.id ? 'sync' : 'download'}
                                            </span>
                                            <span>Download ID Photo</span>
                                          </button>

                                          <div className="my-1 border-t border-white/10"></div>

                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOpenMenuId(null);
                                              handleDelete(c);
                                            }}
                                            className="w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 text-red-400 hover:bg-red-500/20 transition-colors font-bold"
                                          >
                                            <span className="material-symbols-outlined text-base">delete</span>
                                            <span>Delete Dossier</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5 text-[10px]">
                                  <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 font-bold uppercase text-[9px] font-label-caps border border-purple-500/20 truncate max-w-[150px]">
                                    {display.value}
                                  </span>
                                  <span className="text-white/50 truncate font-code-sm text-[10px]">
                                    {c.email}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      /* 3D CARDS GRID VIEW FOR ADMIN */
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 py-4">
                        {visibleCandidates.map((c) => {
                          const cardId = c.id || c.email;
                          const isFlipped = !!flippedCardsMap[cardId];
                          const displayInfo = getAdminDisplayRoleOrTeam(c.team, c.position);

                          const isSusp = c.status?.toLowerCase() === 'suspended';
                          const cReq = isSusp
                            ? queuedRequests.find(
                                (r) =>
                                  r.userEmail?.toLowerCase() === c.email?.toLowerCase() ||
                                  (c.activeRequestId && (r.id === c.activeRequestId || r.requestId === c.activeRequestId))
                              )
                            : null;
                          const isSuspPaid = Boolean(
                            c.replacementPaid ||
                            c.paymentStatus === 'paid' ||
                            c.fulfillmentStatus === 'queued' ||
                            cReq?.paymentStatus === 'paid' ||
                            cReq?.fulfillmentStatus === 'queued'
                          );
                          const feeVal = cReq?.amount || cReq?.feeAmount || c.replacementFee || dynamicReplacementFee || 150;

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
                                            isSusp
                                              ? isSuspPaid ? 'bg-indigo-600/90' : 'bg-rose-600/90'
                                              : c.status === 'Approved' ? 'bg-green-500/80' : 'bg-yellow-500/80'
                                          }`}>
                                            {isSusp
                                              ? isSuspPaid ? `SUSPENDED • PAID (₹${feeVal})` : `SUSPENDED • UNPAID (₹${feeVal})`
                                              : c.status === 'Approved' ? 'VERIFIED' : 'PENDING'}
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
                                            src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(`${typeof window !== 'undefined' ? window.location.origin : 'https://vrgc.club'}/card/${c.registrationNumber || ''}`)}`}
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

                                {isSusp ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAdminSectionTab('requests');
                                      setRequestSearchQuery(c.name || c.registrationNumber || c.email);
                                    }}
                                    className="p-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 hover:text-white transition-all cursor-pointer shadow-sm"
                                    title={isSuspPaid ? "Card Suspended (Fee Paid): View in Card Requests queue to Approve & Re-Issue" : "Card Suspended (Payment Not Completed): View in Card Requests queue to Waive Fee or Cancel"}
                                  >
                                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => toggleStatus(c)}
                                    className={`p-1.5 rounded-lg border transition-all ${c.status === 'Approved'
                                      ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20'
                                      : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                                      }`}
                                    title={c.status === 'Approved' ? 'Mark as Pending' : 'Approve Dossier'}
                                  >
                                    <span className="material-symbols-outlined text-xs">
                                      {c.status === 'Approved' ? 'history' : 'verified'}
                                    </span>
                                  </button>
                                )}

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

                    {/* Load More Dossiers Button */}
                    {visibleCandidates.length < filteredCandidates.length && (
                      <div className="text-center pt-4 pb-2 relative z-20">
                        <button
                          type="button"
                          onClick={() => setDossierPageLimit(prev => prev + 12)}
                          className="px-6 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-bold font-label-caps tracking-wider hover:bg-purple-500/20 hover:border-purple-500/50 transition-all duration-300 shadow-[0_0_15px_rgba(168,85,247,0.15)] active:scale-95 inline-flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-sm">expand_more</span>
                          <span>LOAD MORE DOSSIERS ({filteredCandidates.length - visibleCandidates.length} REMAINING)</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ID CARD REQUESTS SUB-TAB (Admins with canManageCardRequests only) */}
            {adminSectionTab === 'requests' && canManageCardRequests && (() => {
              const isDismissed = (r: IDCardRequest) =>
                r.fulfillmentStatus === 'resolved' ||
                r.fulfillmentStatus === 'denied' ||
                r.status === 'cancelled' ||
                r.status === 'resolved';

              const activeQueuedRequests = queuedRequests.filter((r) => !isDismissed(r));
              const paidRequests = activeQueuedRequests.filter((r) => r.paymentStatus === 'paid' || r.fulfillmentStatus === 'queued');
              const pendingRequests = activeQueuedRequests.filter((r) => r.paymentStatus !== 'paid' && r.fulfillmentStatus !== 'queued');

              const filteredRequests = activeQueuedRequests.filter((r) => {
                // Status Filter
                if (requestStatusFilter === 'paid' && (r.paymentStatus !== 'paid' && r.fulfillmentStatus !== 'queued')) return false;
                if (requestStatusFilter === 'pending' && (r.paymentStatus === 'paid' || r.fulfillmentStatus === 'queued')) return false;

                // Search Query
                if (!requestSearchQuery.trim()) return true;
                const q = requestSearchQuery.toLowerCase();
                return (
                  (r.candidateName || '').toLowerCase().includes(q) ||
                  (r.registrationNumber || '').toLowerCase().includes(q) ||
                  (r.userEmail || '').toLowerCase().includes(q) ||
                  (r.team || '').toLowerCase().includes(q) ||
                  (r.position || '').toLowerCase().includes(q)
                );
              });

              return (
                <div className="space-y-6">
                  {/* Action & Filter Bar */}
                  <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-indigo-500/25 bg-[#090214]/90 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="material-symbols-outlined text-indigo-400 text-lg">published_with_changes</span>
                        <h2 className="text-sm font-black text-white uppercase tracking-wider">
                          Lost &amp; Damaged Replacement Queue
                        </h2>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-950 border border-indigo-500/40 text-indigo-300">
                          {queuedRequests.length} Total Requests
                        </span>
                        {paidRequests.length > 0 && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950 border border-emerald-500/40 text-emerald-300">
                            {paidRequests.length} Ready to Issue
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setFeeInput(dynamicReplacementFee);
                            setExpiryInput(dynamicExpiryMinutes);
                            setShowFeeSettingsModal(true);
                          }}
                          className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-950/90 hover:bg-purple-900 border border-purple-500/50 text-purple-300 hover:text-white flex items-center gap-1 cursor-pointer transition-all shadow-sm active:scale-98"
                          title="Super Admin: Click to change ID Card replacement fee & expiry window"
                        >
                          <span className="material-symbols-outlined text-[12px] text-purple-400">payments</span>
                          <span>FEE: ₹{dynamicReplacementFee}</span>
                          <span className="material-symbols-outlined text-[10px] text-purple-300">edit</span>
                        </button>
                      </div>
                      <p className="text-xs text-slate-400">
                        Review lost/damaged replacement requests. Super Admins can resolve paid requests, override &amp; waive fees, or configure dynamic re-issuance fee.
                      </p>
                    </div>

                    {/* Filter Pills, Search Bar & Refresh */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
                      {/* Filter Pills */}
                      <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/5">
                        <button
                          type="button"
                          onClick={() => setRequestStatusFilter('all')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold cursor-pointer transition-all ${
                            requestStatusFilter === 'all'
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          ALL ({queuedRequests.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setRequestStatusFilter('paid')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold cursor-pointer transition-all ${
                            requestStatusFilter === 'paid'
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-emerald-300'
                          }`}
                        >
                          PAID ({paidRequests.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setRequestStatusFilter('pending')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold cursor-pointer transition-all ${
                            requestStatusFilter === 'pending'
                              ? 'bg-amber-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-amber-300'
                          }`}
                        >
                          PENDING ({pendingRequests.length})
                        </button>
                      </div>

                      {/* Search Bar */}
                      <div className="relative flex-1 sm:w-64">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 text-base">search</span>
                        <input
                          type="text"
                          placeholder="Search candidate..."
                          value={requestSearchQuery}
                          onChange={(e) => setRequestSearchQuery(e.target.value)}
                          className="w-full bg-black/40 border border-indigo-900/60 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono transition-all"
                        />
                      </div>

                      {/* Set Fee Button */}
                      <button
                        type="button"
                        onClick={() => {
                          setFeeInput(dynamicReplacementFee);
                          setExpiryInput(dynamicExpiryMinutes);
                          setShowFeeSettingsModal(true);
                        }}
                        className="p-2 sm:px-3 sm:py-2 rounded-xl bg-purple-950/70 hover:bg-purple-900/90 border border-purple-500/40 text-purple-200 hover:text-white text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all shrink-0 active:scale-98"
                        title="Super Admin: Configure replacement fee and expiry window"
                      >
                        <span className="material-symbols-outlined text-sm text-purple-400">payments</span>
                        <span className="hidden sm:inline">SET FEE (₹{dynamicReplacementFee})</span>
                      </button>

                      {/* Refresh Button */}
                      <button
                        type="button"
                        onClick={handleRefreshQueue}
                        disabled={isRefreshingQueue}
                        className="p-2 sm:px-3 sm:py-2 rounded-xl bg-indigo-950/60 hover:bg-indigo-900/80 border border-indigo-500/30 text-indigo-300 hover:text-white text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all shrink-0"
                        title="Force reload all requests"
                      >
                        <span className={`material-symbols-outlined text-sm ${isRefreshingQueue ? 'animate-spin' : ''}`}>sync</span>
                        <span className="hidden sm:inline">REFRESH</span>
                      </button>
                    </div>
                  </div>

                  {/* Success Alert Banner */}
                  {resolveSuccessMessage && (
                    <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs font-mono font-bold flex items-center gap-2 shadow-lg animate-fade-in">
                      <span className="material-symbols-outlined text-emerald-400 text-base">check_circle</span>
                      <span>{resolveSuccessMessage}</span>
                    </div>
                  )}

                  {/* Loading State */}
                  {loadingRequests && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                      <span className="text-xs font-mono text-slate-400">Loading queued card replacement requests...</span>
                    </div>
                  )}

                  {/* Empty State */}
                  {!loadingRequests && filteredRequests.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 px-4 rounded-2xl bg-[#090214]/60 border border-white/5 space-y-3 text-center">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-950/60 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-[0_0_25px_rgba(99,102,241,0.2)]">
                        <span className="material-symbols-outlined text-2xl">task_alt</span>
                      </div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                        {requestSearchQuery ? 'No Matching Replacement Requests' : 'Replacement Queue is Clear'}
                      </h3>
                      <p className="text-xs text-slate-400 max-w-md">
                        {requestSearchQuery
                          ? 'No card replacement requests found matching your filter criteria.'
                          : 'There are currently no active replacement requests for suspended cards. When a card is reported lost or damaged, it will appear here immediately.'}
                      </p>
                    </div>
                  )}

                  {/* Requests Grid */}
                  {!loadingRequests && filteredRequests.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredRequests.map((req) => {
                        const isReqPaid = req.paymentStatus === 'paid' || req.fulfillmentStatus === 'queued';

                        return (
                          <div
                            key={req.id}
                            className={`p-5 rounded-2xl border transition-all duration-300 shadow-[0_4px_25px_rgba(0,0,0,0.6)] space-y-4 flex flex-col justify-between ${
                              isReqPaid
                                ? 'bg-[#0e071c] border-emerald-500/30 hover:border-emerald-500/60'
                                : 'bg-[#120815] border-amber-500/30 hover:border-amber-500/60'
                            }`}
                          >
                            <div className="space-y-3">
                              {/* Card Header: Reg No and Paid/Pending Badge */}
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 tracking-wider">
                                  {req.registrationNumber}
                                </span>
                                {isReqPaid ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 shadow-sm">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    PAID ₹{req.amount || 150} • READY
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-950/80 border border-rose-500/50 text-rose-300 shadow-sm">
                                    <span className="material-symbols-outlined text-[11px] text-rose-400">hourglass_top</span>
                                    PAYMENT NOT COMPLETED (₹{req.amount || 150})
                                  </span>
                                )}
                              </div>

                              {/* Candidate Details */}
                              <div>
                                <h3 className="font-bold text-white text-base truncate">{req.candidateName}</h3>
                                <p className="text-xs text-slate-400 font-mono truncate">{req.userEmail}</p>
                              </div>

                              {/* Team & Position */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/50 text-purple-300 uppercase">
                                  {req.team || 'Member'}
                                </span>
                                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300 uppercase">
                                  {req.position || 'Core Member'}
                                </span>
                              </div>

                              {/* Metadata Details */}
                              <div className="space-y-1 pt-2 border-t border-white/5 text-[11px] font-mono text-slate-400">
                                <div className="flex items-center justify-between">
                                  <span>Suspended At:</span>
                                  <span className="text-slate-300 font-bold">
                                    {req.createdAt ? new Date(req.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Recent'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span>Request ID:</span>
                                  <span className="text-slate-300 font-mono font-bold truncate max-w-[150px]" title={req.id}>
                                    {formatDisplayId(req.id || req.requestId, 'REQ')}
                                  </span>
                                </div>
                                {(req.orderId || req.razorpayOrderId) && (
                                  <div className="flex items-center justify-between">
                                    <span>Order ID:</span>
                                    <span className="text-slate-300 font-mono font-bold truncate max-w-[150px]" title={req.orderId || req.razorpayOrderId}>
                                      {formatDisplayId(req.orderId || req.razorpayOrderId, 'ORD')}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="pt-2 space-y-2">
                              {isReqPaid ? (
                                <button
                                  type="button"
                                  disabled={resolvingRequestId === req.id}
                                  onClick={() => handleResolveRequest(req.id, req.candidateName, req.registrationNumber, req.userEmail)}
                                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-98"
                                >
                                  {resolvingRequestId === req.id ? (
                                    <>
                                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                      <span>Reactivating &amp; Resolving...</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="material-symbols-outlined text-sm">verified</span>
                                      <span>Approve &amp; Re-Issue Card</span>
                                    </>
                                  )}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={resolvingRequestId === req.id}
                                  onClick={() => handleAdminWaiveAndResolve(req)}
                                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-300 hover:text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm active:scale-98"
                                  title="Super Admin Override: Waive replacement fee and issue active card immediately"
                                >
                                  <span className="material-symbols-outlined text-sm">verified_user</span>
                                  <span>Waive Fee &amp; Re-Issue Card</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleAdminCancelRequest(req)}
                                className="w-full py-2 px-3 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 hover:text-white font-bold text-[11px] uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-98"
                                title="Deny request and restore member card with retry notification"
                              >
                                <span className="material-symbols-outlined text-xs">close</span>
                                <span>Cancel Request</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ACTIVITY LOGS SUB-TAB */}
            {adminSectionTab === 'logs' && (() => {
              const canDeleteLogs = isAdmin;
              return (
                <div className="space-y-4">
                  {/* Search & Action Filter Controls */}
                  <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-white/5 flex flex-col md:flex-row md:items-center gap-2.5 sm:gap-4">
                    <div className="relative flex-1 w-full">
                      <span className="material-symbols-outlined absolute left-3 top-2.5 text-outline text-sm">search</span>
                      <input
                        type="text"
                        placeholder="Search logs, email, candidate..."
                        value={logSearchQuery}
                        onChange={(e) => setLogSearchQuery(e.target.value)}
                        className="w-full bg-black/30 border border-outline-variant/30 rounded-lg pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-primary placeholder:text-white/30 transition-all duration-300"
                      />
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-2 shrink-0 w-full md:w-auto">
                      <label className="text-[10px] font-label-caps text-outline tracking-wider font-bold shrink-0">ACTION:</label>
                      <select
                        value={logActionFilter}
                        onChange={(e) => setLogActionFilter(e.target.value)}
                        className="bg-black/50 border border-outline-variant/30 text-white rounded-lg px-3 py-1.5 text-xs focus:ring-0 focus:border-primary cursor-pointer hover:bg-black/80 font-label-caps flex-1 md:flex-initial min-w-0"
                      >
                        <option value="All">All Actions</option>
                        <option value="APPROVE_DOSSIER">Approvals</option>
                        <option value="REVERT_PENDING_DOSSIER">Reversions</option>
                        <option value="DELETE_DOSSIER">Deletions</option>
                        <option value="FORCE_SHEETS_SYNC">Sheets Syncs</option>
                      </select>
                    </div>
                  </div>

                  {/* Audit Logs Table & Mobile Cards */}
                  {filteredLogs.length === 0 ? (
                    <div className="glass-panel p-12 rounded-2xl border border-white/5 bg-white/5 text-center space-y-3">
                      <span className="material-symbols-outlined text-4xl text-white/30">find_in_page</span>
                      <div className="text-white font-bold text-sm">No Activity Logs Found</div>
                      <p className="text-xs text-white/50 max-w-md mx-auto">
                        {logSearchQuery || logActionFilter !== 'All'
                          ? 'No logs match your current search query or action type filter.'
                          : 'All administrative activities (approvals, reversions to pending, deletions, syncs) will automatically record here in real-time.'}
                      </p>
                    </div>
                  ) : (
                    <div className="glass-panel rounded-2xl border border-white/5 bg-black/40 overflow-hidden shadow-2xl">
                      {/* DESKTOP TABLE VIEW */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/10 bg-white/5 text-[10px] font-label-caps text-outline tracking-wider uppercase">
                              <th className="py-3.5 px-4">Timestamp</th>
                              <th className="py-3.5 px-4">Action</th>
                              <th className="py-3.5 px-4">Admin Name</th>
                              <th className="py-3.5 px-4">Target Candidate</th>
                              <th className="py-3.5 px-4">Activity Details</th>
                              {canDeleteLogs && <th className="py-3.5 px-4 text-right">Actions</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-xs">
                            {visibleLogs.map(log => {
                              const dateObj = new Date(log.timestamp);
                              const formattedTime = isNaN(dateObj.getTime())
                                ? log.timestamp
                                : dateObj.toLocaleString('en-US', {
                                  month: 'short', day: 'numeric', year: 'numeric',
                                  hour: '2-digit', minute: '2-digit', second: '2-digit'
                                });
                              const rawAdmin = log.performedBy || log.adminEmail || 'Admin';
                              const foundCandidate = candidates.find(c => (c.email || '').toLowerCase() === rawAdmin.toLowerCase());
                              const adminMail = rawAdmin.includes('@')
                                ? (foundCandidate?.name || rawAdmin.split('@')[0])
                                : rawAdmin;

                              let badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/30';
                              let badgeLabel: string = log.action;
                              let badgeIcon = 'info';

                              if (log.action === 'APPROVE_DOSSIER' || log.action === 'VERIFY') {
                                badgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                                badgeLabel = 'APPROVED';
                                badgeIcon = 'verified';
                              } else if (log.action === 'REVERT_PENDING_DOSSIER' || log.action === 'SET_PENDING') {
                                badgeStyle = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                                badgeLabel = 'REVERTED PENDING';
                                badgeIcon = 'history';
                              } else if (log.action === 'DELETE_DOSSIER' || log.action === 'DELETE') {
                                badgeStyle = 'bg-red-500/20 text-red-300 border-red-500/40';
                                badgeLabel = 'DELETED';
                                badgeIcon = 'delete';
                              } else if (log.action === 'FORCE_SHEETS_SYNC' || log.action === 'SYNC_SHEETS') {
                                badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
                                badgeLabel = 'SHEETS SYNC';
                                badgeIcon = 'cloud_upload';
                              }

                              return (
                                <tr key={log.id || log.timestamp + Math.random()} className="hover:bg-white/5 transition-colors">
                                  <td className="py-3.5 px-4 font-code-sm text-[11px] whitespace-nowrap">
                                    <span className="text-purple-300 font-mono font-bold inline-flex items-center gap-1.5">
                                      <span className="material-symbols-outlined text-xs text-purple-400">schedule</span>
                                      <span>{formattedTime}</span>
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-4 whitespace-nowrap">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold font-label-caps tracking-wider ${badgeStyle}`}>
                                      <span className="material-symbols-outlined text-xs">{badgeIcon}</span>
                                      <span>{badgeLabel}</span>
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-4 font-bold text-white text-[11px] whitespace-nowrap">
                                    {adminMail}
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
                                          if (log.id && confirm('Are you sure you want to delete this activity log entry?')) {
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

                      {/* MOBILE CLEAN LOG CARD VIEW */}
                      <div className="flex md:hidden flex-col gap-2.5 p-1">
                        {visibleLogs.map(log => {
                          const dateObj = new Date(log.timestamp);
                          const formattedTime = isNaN(dateObj.getTime())
                            ? log.timestamp
                            : dateObj.toLocaleString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                              hour: '2-digit', minute: '2-digit', second: '2-digit'
                            });
                          const rawAdmin = log.performedBy || log.adminEmail || 'Admin';
                          const foundCandidate = candidates.find(c => (c.email || '').toLowerCase() === rawAdmin.toLowerCase());
                          const adminMail = rawAdmin.includes('@')
                            ? (foundCandidate?.name || rawAdmin.split('@')[0])
                            : rawAdmin;
                          const logKey = log.id || log.timestamp;

                          let badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/30';
                          let badgeLabel: string = log.action;
                          let badgeIcon = 'info';

                          if (log.action === 'APPROVE_DOSSIER' || log.action === 'VERIFY') {
                            badgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                            badgeLabel = 'APPROVED';
                            badgeIcon = 'verified';
                          } else if (log.action === 'REVERT_PENDING_DOSSIER' || log.action === 'SET_PENDING') {
                            badgeStyle = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                            badgeLabel = 'REVERTED';
                            badgeIcon = 'history';
                          } else if (log.action === 'DELETE_DOSSIER' || log.action === 'DELETE') {
                            badgeStyle = 'bg-red-500/20 text-red-300 border-red-500/40';
                            badgeLabel = 'DELETED';
                            badgeIcon = 'delete';
                          } else if (log.action === 'FORCE_SHEETS_SYNC' || log.action === 'SYNC_SHEETS') {
                            badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/30';
                            badgeLabel = 'SHEETS SYNC';
                            badgeIcon = 'cloud_upload';
                          }

                          return (
                            <div
                              key={logKey + Math.random()}
                              onClick={() => setSelectedLogForDetails(log)}
                              className="rounded-xl border border-white/5 bg-white/5 hover:border-primary/30 hover:bg-white/10 transition-all duration-200 cursor-pointer p-3.5 space-y-3 overflow-visible"
                            >
                              {/* Top Header Row: Action Badge + Statically Highlighted Timestamp */}
                              <div className="flex items-center justify-between gap-2">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[9px] font-bold font-label-caps tracking-wider ${badgeStyle}`}>
                                  <span className="material-symbols-outlined text-xs">{badgeIcon}</span>
                                  <span>{badgeLabel}</span>
                                </span>

                                <span className="text-purple-300 font-mono text-[9px] font-bold inline-flex items-center gap-1 shrink-0">
                                  <span className="material-symbols-outlined text-[10px] text-purple-400">schedule</span>
                                  <span>{formattedTime}</span>
                                </span>
                              </div>

                              {/* Content Body Row: Primary Candidate/Details on Left, 3-Dots Menu on Right */}
                              <div className="flex items-center justify-between gap-3 pt-0.5 border-t border-white/5">
                                <div className="min-w-0 flex-1">
                                  {log.targetName && log.targetName !== 'N/A' ? (
                                    <div className="truncate">
                                      <span className="font-bold text-white text-xs">{log.targetName}</span>
                                      {log.targetRegNo && log.targetRegNo !== 'N/A' && (
                                        <span className="text-primary font-code-sm text-[10px] ml-1.5 font-bold">({log.targetRegNo})</span>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-white/90 font-medium truncate">
                                      {log.details || adminMail}
                                    </div>
                                  )}
                                  <div className="text-[10px] text-white/40 truncate font-code-sm mt-0.5">
                                    By: {adminMail}
                                  </div>
                                </div>

                                {/* Actions Container */}
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {canDeleteLogs && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (log.id && confirm('Are you sure you want to delete this activity log entry?')) {
                                          handleDeleteLog(log.id);
                                        }
                                      }}
                                      className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all active:scale-95 shrink-0"
                                      title="Delete Log Entry"
                                    >
                                      <span className="material-symbols-outlined text-sm">delete</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedLogForDetails(log);
                                    }}
                                    className="p-1.5 rounded-lg bg-black/60 border border-white/10 text-white/80 hover:text-white hover:border-purple-500/50 transition-all active:scale-95 shrink-0"
                                    title="View Log Details"
                                  >
                                    <span className="material-symbols-outlined text-base">more_vert</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

      </section>

      {/* Floating Expiry & Status Notification Toast */}
      {expiryToast && (
        <div className="fixed top-20 right-4 z-[250] max-w-md p-4 rounded-2xl bg-[#0e071c] border border-indigo-500/60 text-white text-xs font-mono shadow-[0_10px_35px_rgba(0,0,0,0.8),0_0_20px_rgba(99,102,241,0.3)] flex items-start justify-between gap-3 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-base shrink-0">info</span>
            <p className="leading-snug">{expiryToast}</p>
          </div>
          <button
            type="button"
            onClick={() => setExpiryToast(null)}
            className="text-slate-400 hover:text-white shrink-0 cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* Report Lost / Damaged ID Card Confirmation Modal */}
      {showReportLostModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[200] overflow-y-auto p-4 sm:p-6 flex min-h-full items-center justify-center animate-fade-in">
          <div className="glass-panel p-6 md:p-8 rounded-3xl max-w-lg w-full border border-rose-500/40 bg-[#0e0618] relative space-y-5 text-left my-auto shadow-[0_0_50px_rgba(244,63,94,0.3)]">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-rose-500/20 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                  <span className="material-symbols-outlined text-lg">credit_card_off</span>
                </div>
                <div>
                  <h3 className="text-base text-white font-extrabold uppercase tracking-tight">
                    Report Lost / Damaged ID Card
                  </h3>
                  <p className="text-[11px] text-rose-300 font-mono">Immediate Deactivation &amp; Re-issuance</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowReportLostModal(false)}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {/* Explanation & Steps */}
            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <p>
                By reporting your card as lost or damaged, you will initiate the official club replacement workflow:
              </p>

              <div className="space-y-2 p-3.5 rounded-2xl bg-black/40 border border-rose-950/60 font-mono text-[11px]">
                <div className="flex items-start gap-2">
                  <span className="text-rose-400 font-bold">1.</span>
                  <span>Your current digital and physical ID card will be <strong className="text-rose-300">suspended</strong> immediately.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-indigo-400 font-bold">2.</span>
                  <span>A replacement invoice for <strong className="text-white">₹{dynamicReplacementFee}</strong> will be generated with a <strong className="text-indigo-300">{dynamicExpiryMinutes}-minute</strong> window.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">3.</span>
                  <span>Upon fee confirmation, your request is queued for administrative reprinting, verification, and reactivation.</span>
                </div>
              </div>

              {reportLostError && (
                <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs font-mono font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-rose-400 text-base">error</span>
                  <span>{reportLostError}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
              <button
                type="button"
                disabled={isReportingLost}
                onClick={() => setShowReportLostModal(false)}
                className="px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-bold text-slate-300 uppercase tracking-wider cursor-pointer transition-all"
              >
                Keep Card Active (Cancel)
              </button>
              <button
                type="button"
                disabled={isReportingLost}
                onClick={handleReportLost}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 disabled:opacity-40 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-98"
              >
                {isReportingLost ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Suspending &amp; Invoicing...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">lock_open</span>
                    <span>Confirm &amp; Proceed to Pay (₹{dynamicReplacementFee})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
                <div className={`p-3 rounded-lg text-xs font-bold ${reportStatus === 'success'
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
      {previewCandidate && (() => {
        const isPreviewSuspended = previewCandidate.status?.toLowerCase() === 'suspended';
        const previewReq = isPreviewSuspended
          ? queuedRequests.find(r => (r.registrationNumber && r.registrationNumber === previewCandidate.registrationNumber) || (r.userEmail && r.userEmail.toLowerCase() === previewCandidate.email.toLowerCase()))
          : undefined;
        const isPreviewPaid = previewReq ? (previewReq.paymentStatus === 'paid' || previewReq.fulfillmentStatus === 'queued') : false;
        const previewFee = previewReq?.amount || previewCandidate.replacementFee || dynamicReplacementFee;

        return (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] overflow-y-auto p-4 sm:p-6 md:p-8 flex min-h-full items-center justify-center">
            <div className="bg-[#0b0612]/95 border border-[#a855f7]/30 backdrop-blur-2xl p-5 sm:p-6 md:p-8 rounded-3xl max-w-2xl w-full relative text-left space-y-6 shadow-[0_0_50px_rgba(168,85,247,0.25)] my-auto max-h-[90vh] overflow-y-auto overflow-x-hidden flex flex-col">
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
                        className={`px-3 py-1 rounded-full border text-[9px] font-label-caps font-black tracking-wider uppercase ${isPreviewSuspended
                          ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                          : previewCandidate.status === 'Approved'
                          ? 'bg-green-500/10 border-green-500/30 text-green-400 shadow-[0_0_15px_rgba(74,222,128,0.1)]'
                          : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.1)]'
                          }`}
                      >
                        {isPreviewSuspended
                          ? 'SUSPENDED'
                          : (previewCandidate.status || 'Pending')}
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
                              <div className={`absolute bottom-1 right-1 text-white text-[6px] font-black px-1.5 py-0.5 rounded tracking-widest uppercase shadow-md pointer-events-none ${isPreviewSuspended
                                ? !isPreviewPaid
                                  ? 'bg-rose-600/90'
                                  : 'bg-amber-600/90'
                                : previewCandidate.status === 'Approved'
                                ? 'bg-green-500/80'
                                : 'bg-yellow-500/80'
                                }`}>
                                {isPreviewSuspended
                                  ? !isPreviewPaid
                                    ? `SUSPENDED • UNPAID (₹${previewFee})`
                                    : `SUSPENDED • PAID (₹${previewFee})`
                                  : previewCandidate.status === 'Approved'
                                  ? 'VERIFIED'
                                  : 'PENDING'}
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
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(`${typeof window !== 'undefined' ? window.location.origin : 'https://vrgc.club'}/card/${previewCandidate.registrationNumber || ''}`)}`}
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

              {isPreviewSuspended && (
                <div className={`mt-3 p-3 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 ${
                  !isPreviewPaid
                    ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                    : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                }`}>
                  <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                    <span className={`material-symbols-outlined text-base shrink-0 mt-0.5 sm:mt-0 ${!isPreviewPaid ? 'text-rose-400' : 'text-amber-400'}`}>
                      {!isPreviewPaid ? 'warning' : 'lock_person'}
                    </span>
                    <div className="space-y-0.5 min-w-0">
                      <p className={`font-bold uppercase tracking-wider text-[11px] ${!isPreviewPaid ? 'text-rose-300' : 'text-amber-300'}`}>
                        {!isPreviewPaid
                          ? `CARD SUSPENDED • PAYMENT NOT COMPLETED (₹${previewFee} PENDING)`
                          : `CARD SUSPENDED • REPLACEMENT FEE PAID (₹${previewFee})`}
                      </p>
                      <p className="text-[10px] text-slate-300 leading-snug">
                        {!isPreviewPaid
                          ? `The cardholder suspended their ID card, but replacement payment has NOT been completed yet. Super Admin can waive fee & re-issue or manage it in the Card Requests queue.`
                          : `The replacement fee has been completed. The request is currently queued and awaiting Super Admin re-issue fulfillment.`}
                      </p>
                    </div>
                  </div>
                  {canManageCardRequests && (
                    <button
                      type="button"
                      onClick={() => {
                        setAdminSectionTab('requests');
                        setRequestSearchQuery(previewCandidate.registrationNumber || previewCandidate.email || '');
                        setPreviewCandidate(null);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-200 hover:text-white text-[10px] font-mono font-bold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer shadow-sm"
                    >
                      <span className="material-symbols-outlined text-xs">open_in_new</span>
                      <span>OPEN IN QUEUE</span>
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2.5 pt-4 border-t border-white/10 w-full items-stretch sm:items-center">
                {isPreviewSuspended ? (
                  canManageCardRequests ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAdminSectionTab('requests');
                        setRequestSearchQuery(previewCandidate.registrationNumber || previewCandidate.email || '');
                        setPreviewCandidate(null);
                      }}
                      className={`w-full sm:flex-1 py-2 px-4 rounded-full text-[10.5px] font-bold font-label-caps flex items-center justify-center gap-1.5 border transition-all duration-300 cursor-pointer shadow-md hover:scale-[1.01] ${
                        !isPreviewPaid
                          ? 'bg-rose-600/25 border-rose-500/50 text-rose-200 hover:bg-rose-600/40'
                          : 'bg-amber-600/25 border-amber-500/50 text-amber-200 hover:bg-amber-600/40'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm font-bold shrink-0">published_with_changes</span>
                      <span className="text-center leading-tight">
                        {!isPreviewPaid
                          ? `MANAGE IN REQUESTS QUEUE (PAYMENT PENDING - ₹${previewFee})`
                          : `MANAGE IN REQUESTS QUEUE (PAID - ₹${previewFee})`}
                      </span>
                    </button>
                  ) : (
                    <div className="w-full sm:flex-1 py-2 px-4 rounded-full text-[10.5px] font-bold font-label-caps flex items-center justify-center gap-1.5 border bg-rose-500/10 border-rose-500/40 text-rose-300/80 cursor-not-allowed">
                      <span className="material-symbols-outlined text-sm font-bold shrink-0">lock</span>
                      <span>APPROVAL LOCKED (SUSPENDED)</span>
                    </div>
                  )
                ) : (
                  <button
                    onClick={() => toggleStatus(previewCandidate)}
                    className={`w-full sm:flex-1 font-bold py-2 px-4 rounded-full text-[10.5px] font-bold font-label-caps flex items-center justify-center gap-1.5 border transition-all duration-300 hover:scale-[1.01] ${previewCandidate.status === 'Approved'
                      ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 shadow-[0_0_15px_rgba(250,204,21,0.15)]'
                      : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20 shadow-[0_0_20px_rgba(74,222,128,0.15)]'
                      }`}
                  >
                    <span className="material-symbols-outlined text-sm font-bold shrink-0">
                      {previewCandidate.status === 'Approved' ? 'history' : 'verified'}
                    </span>
                    <span>{previewCandidate.status === 'Approved' ? 'MARK PENDING' : 'APPROVE DOSSIER'}</span>
                  </button>
                )}

                <button
                  onClick={() => { handleDownload(previewCandidate); setPreviewCandidate(null); }}
                  className="w-full sm:flex-1 bg-gradient-to-r from-[#a855f7] to-[#cf5cff] hover:opacity-90 text-white font-bold py-2 px-4 rounded-full text-[10.5px] font-label-caps flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-[1.01] shadow-[0_0_15px_rgba(168,85,247,0.25)]"
                >
                  <span className="material-symbols-outlined text-sm font-bold shrink-0">download</span>
                  <span>DOWNLOAD PHOTO</span>
                </button>

                <button
                  onClick={() => { handleDelete(previewCandidate); setPreviewCandidate(null); }}
                  className="w-full sm:w-auto bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 text-red-400 px-4 py-2 rounded-full text-[10.5px] font-bold font-label-caps flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-[1.01] shrink-0"
                >
                  <span className="material-symbols-outlined text-sm font-bold shrink-0">delete</span>
                  <span>DELETE DOSSIER</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* Log Details Modal */}
      {selectedLogForDetails && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[300] overflow-y-auto p-4 sm:p-6 flex min-h-full items-center justify-center animate-in fade-in duration-200">
          <div className="glass-panel p-6 md:p-8 rounded-2xl max-w-lg w-full border border-purple-500/30 relative space-y-5 text-left my-auto shadow-[0_0_50px_rgba(168,85,247,0.2)]">
            <div className="flex justify-between items-center border-b border-white/10 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
                  <span className="material-symbols-outlined text-purple-400 text-base">history</span>
                </div>
                <div>
                  <h3 className="font-headline-sm text-sm md:text-base text-white font-bold uppercase tracking-wider">Activity Log Details</h3>
                  <p className="text-[10px] text-white/50 font-mono">ID: {selectedLogForDetails.id || 'N/A'}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLogForDetails(null)}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {/* Log Meta Details */}
            <div className="space-y-3.5 text-xs">
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] font-label-caps text-outline uppercase font-bold">Action Type:</span>
                {(() => {
                  let badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/30';
                  let badgeLabel: string = selectedLogForDetails.action;
                  let badgeIcon = 'info';
                  if (selectedLogForDetails.action === 'APPROVE_DOSSIER' || selectedLogForDetails.action === 'VERIFY') {
                    badgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                    badgeLabel = 'APPROVED';
                    badgeIcon = 'verified';
                  } else if (selectedLogForDetails.action === 'REVERT_PENDING_DOSSIER' || selectedLogForDetails.action === 'SET_PENDING') {
                    badgeStyle = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                    badgeLabel = 'REVERTED PENDING';
                    badgeIcon = 'history';
                  } else if (selectedLogForDetails.action === 'DELETE_DOSSIER' || selectedLogForDetails.action === 'DELETE') {
                    badgeStyle = 'bg-red-500/20 text-red-300 border-red-500/40';
                    badgeLabel = 'DELETED';
                    badgeIcon = 'delete';
                  } else if (selectedLogForDetails.action === 'FORCE_SHEETS_SYNC' || selectedLogForDetails.action === 'SYNC_SHEETS') {
                    badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
                    badgeLabel = 'SHEETS SYNC';
                    badgeIcon = 'cloud_upload';
                  }
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-bold font-label-caps tracking-wider ${badgeStyle}`}>
                      <span className="material-symbols-outlined text-xs">{badgeIcon}</span>
                      <span>{badgeLabel}</span>
                    </span>
                  );
                })()}
              </div>

              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] font-label-caps text-outline uppercase font-bold">Timestamp:</span>
                <span className="text-purple-300 font-mono text-[11px] font-bold inline-flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-xs text-purple-400">schedule</span>
                  <span>{(() => {
                    const d = new Date(selectedLogForDetails.timestamp);
                    return isNaN(d.getTime()) ? selectedLogForDetails.timestamp : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  })()}</span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] font-label-caps text-outline uppercase font-bold">Admin Name:</span>
                <span className="font-bold text-white font-code-sm text-[11px] truncate">
                  {(() => {
                    const raw = selectedLogForDetails.performedBy || selectedLogForDetails.adminEmail || 'Admin';
                    const found = candidates.find(c => (c.email || '').toLowerCase() === raw.toLowerCase());
                    return raw.includes('@')
                      ? (found?.name || raw.split('@')[0])
                      : raw;
                  })()}
                </span>
              </div>

              {selectedLogForDetails.targetName && selectedLogForDetails.targetName !== 'N/A' && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <span className="text-[10px] font-label-caps text-outline uppercase font-bold block">Target Candidate:</span>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-xs">{selectedLogForDetails.targetName}</span>
                    <span className="text-primary font-code-sm text-xs font-bold">{selectedLogForDetails.targetRegNo}</span>
                  </div>
                  {selectedLogForDetails.targetEmail && (
                    <div className="text-[10px] font-code-sm text-white/50">{selectedLogForDetails.targetEmail}</div>
                  )}
                </div>
              )}

              <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                <span className="text-[10px] font-label-caps text-outline uppercase font-bold block">Activity Details:</span>
                <p className="text-xs text-white/80 leading-relaxed font-sans">{selectedLogForDetails.details || 'No additional details provided.'}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/10">
              {isAdmin ? (
                <button
                  onClick={() => {
                    if (selectedLogForDetails.id && confirm('Are you sure you want to delete this activity log entry?')) {
                      handleDeleteLog(selectedLogForDetails.id);
                      setSelectedLogForDetails(null);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs font-bold font-label-caps flex items-center gap-1.5 transition-all"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  <span>DELETE LOG</span>
                </button>
              ) : <div />}
              <button
                onClick={() => setSelectedLogForDetails(null)}
                className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold font-label-caps transition-all"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replacement Request Status & Enquiry Modal */}
      {showEnquiryModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[300] overflow-y-auto p-4 sm:p-6 flex min-h-full items-center justify-center animate-in fade-in duration-200">
          <div className="glass-panel p-6 sm:p-8 rounded-3xl max-w-lg w-full border border-purple-500/30 relative space-y-6 text-left my-auto shadow-[0_0_60px_rgba(168,85,247,0.25)] bg-[#0d041a]/95">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
                  <span className="material-symbols-outlined text-xl">contact_support</span>
                </div>
                <div>
                  <h3 className="font-display-lg text-base sm:text-lg text-white font-extrabold uppercase tracking-wider">
                    Replacement Status Enquiry
                  </h3>
                  <p className="text-xs text-white/60 font-mono">
                    ID: {formatDisplayId(enquiryDetails?.request?.id || existingSubmission?.activeRequestId, 'REQ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEnquiryModal(false)}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {/* Current Dossier Summary */}
            <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60 font-mono">Member Name:</span>
                <span className="text-white font-bold">{existingSubmission?.name || memberData?.name || currentUser?.displayName || 'Member'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60 font-mono">Registration No:</span>
                <span className="text-primary font-mono font-bold">{existingSubmission?.registrationNumber || memberData?.registrationNumber || 'N/A'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60 font-mono">Current Card Status:</span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                  SUSPENDED (IN REPLACEMENT)
                </span>
              </div>
            </div>

            {/* Live Progress Tracker (3 Stages) */}
            <div className="space-y-3">
              <span className="text-[10px] font-mono uppercase font-bold text-white/50 tracking-widest block">
                ISSUANCE LIFECYCLE
              </span>

              <div className="space-y-3">
                {/* Stage 1: Request Lodged */}
                <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-xs">check</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-300">1. Loss / Damage Reported</span>
                      <span className="text-[10px] font-mono text-emerald-400/80 font-bold">COMPLETED</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Card temporarily deactivated for security. Replacement record created.
                    </p>
                  </div>
                </div>

                {/* Stage 2: Fee Payment */}
                {(() => {
                  const isPaid = enquiryDetails?.request?.fulfillmentStatus === 'queued' ||
                    enquiryDetails?.request?.paymentStatus === 'paid' ||
                    existingSubmission?.replacementPaid;

                  return (
                    <div className={`flex items-start gap-3 p-3 rounded-xl border ${
                      isPaid
                        ? 'bg-emerald-950/30 border-emerald-500/30'
                        : 'bg-amber-950/30 border-amber-500/30'
                    }`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        isPaid
                          ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-400'
                          : 'bg-amber-500/20 border border-amber-500/50 text-amber-400'
                      }`}>
                        <span className="material-symbols-outlined text-xs">
                          {isPaid ? 'check' : 'hourglass_top'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold ${isPaid ? 'text-emerald-300' : 'text-amber-300'}`}>
                            2. Replacement Fee Payment (₹{dynamicReplacementFee > 0 ? dynamicReplacementFee : (enquiryDetails?.request?.amount || 150)})
                          </span>
                          <span className={`text-[10px] font-mono font-bold ${isPaid ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {isPaid ? 'PAID & VERIFIED' : 'PENDING'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          {isPaid
                            ? 'Fee payment confirmed. Receipt generated and attached to request.'
                            : 'Replacement fee is pending payment. Complete payment to forward request to issuance.'}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* Stage 3: Super Admin Re-Issuance */}
                {(() => {
                  const isPaid = enquiryDetails?.request?.fulfillmentStatus === 'queued' ||
                    enquiryDetails?.request?.paymentStatus === 'paid' ||
                    existingSubmission?.replacementPaid;

                  return (
                    <div className={`flex items-start gap-3 p-3 rounded-xl border ${
                      isPaid
                        ? 'bg-indigo-950/40 border-indigo-500/40'
                        : 'bg-white/5 border-white/5 opacity-50'
                    }`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        isPaid
                          ? 'bg-indigo-500/20 border border-indigo-500/50 text-indigo-400'
                          : 'bg-white/10 text-white/40'
                      }`}>
                        <span className={`material-symbols-outlined text-xs ${isPaid ? 'animate-pulse' : ''}`}>
                          badge
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold ${isPaid ? 'text-indigo-300' : 'text-white/60'}`}>
                            3. Super Admin Queue & Re-Issuance
                          </span>
                          <span className={`text-[10px] font-mono font-bold ${isPaid ? 'text-indigo-400' : 'text-white/40'}`}>
                            {isPaid ? 'IN QUEUE' : 'AWAITING PAYMENT'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          {isPaid
                            ? 'Your request is in the Super Admin re-issuance queue. Once approved, your physical badge and active status will be restored.'
                            : 'Pending payment confirmation before joining the issuance queue.'}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 border-t border-white/10 flex flex-col sm:flex-row items-center gap-2.5">
              {(() => {
                const isPaid = enquiryDetails?.request?.fulfillmentStatus === 'queued' ||
                  enquiryDetails?.request?.paymentStatus === 'paid' ||
                  existingSubmission?.replacementPaid;

                if (!isPaid) {
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setShowEnquiryModal(false);
                          const req = enquiryDetails?.request || activeReplacementRequest;
                          const oid = req?.orderId || req?.razorpayOrderId || '';
                          const amt = dynamicReplacementFee > 0 ? dynamicReplacementFee : (req?.amount || 150);
                          const cur = req?.currency || 'INR';
                          const rid = req?.id || req?.requestId || existingSubmission?.activeRequestId || generateShortId('REQ');
                          const iid = req?.invoiceId || req?.paymentId || rid;
                          handleOpenRazorpayCheckout(oid, amt, cur, rid, iid);
                        }}
                        className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all active:scale-98"
                      >
                        <span className="material-symbols-outlined text-sm">payment</span>
                        <span>Pay Fee Now (₹{dynamicReplacementFee > 0 ? dynamicReplacementFee : (enquiryDetails?.request?.amount || 150)})</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setShowEnquiryModal(false);
                          await handleCancelOrCheckExpiry(true);
                        }}
                        className="w-full sm:w-auto py-2.5 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-mono font-bold flex items-center justify-center gap-1 cursor-pointer transition-all"
                      >
                        <span className="material-symbols-outlined text-sm">cancel</span>
                        <span>Cancel Request</span>
                      </button>
                    </>
                  );
                }

                return (
                  <div className="flex flex-col sm:flex-row items-center gap-2 w-full">
                    <button
                      type="button"
                      onClick={async () => {
                        setShowEnquiryModal(false);
                        await handleCheckStatusOrEnquiry();
                      }}
                      className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-purple-600/40 hover:bg-purple-600/60 border border-purple-500/50 text-white font-bold text-xs font-mono uppercase tracking-wider cursor-pointer transition-all flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">sync</span>
                      <span>Check Live Admin Status</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEnquiryModal(false)}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs font-mono uppercase tracking-wider cursor-pointer transition-all"
                    >
                      Close
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Super Admin: ID Card Fee & Settings Modal */}
      {showFeeSettingsModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[350] overflow-y-auto p-4 sm:p-6 flex min-h-full items-center justify-center animate-in fade-in duration-200">
          <div className="glass-panel p-6 sm:p-8 rounded-3xl max-w-lg w-full border border-purple-500/40 relative space-y-6 text-left my-auto shadow-[0_0_60px_rgba(168,85,247,0.3)] bg-[#0d041a]/95">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
                  <span className="material-symbols-outlined text-xl">payments</span>
                </div>
                <div>
                  <h3 className="font-display-lg text-base sm:text-lg text-white font-extrabold uppercase tracking-wider">
                    ID Card Fee &amp; Expiry Settings
                  </h3>
                  <p className="text-xs text-purple-300/70 font-mono">
                    Super Admin Dynamic Fee Engine
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFeeSettingsModal(false)}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {/* Current Active Info */}
            <div className="p-4 rounded-2xl bg-black/40 border border-purple-500/20 flex items-center justify-between text-xs font-mono">
              <div>
                <span className="text-white/60 block text-[10px]">CURRENT FEE</span>
                <span className="text-emerald-400 font-bold text-sm">₹{dynamicReplacementFee}</span>
              </div>
              <div className="text-right">
                <span className="text-white/60 block text-[10px]">PAYMENT WINDOW</span>
                <span className="text-indigo-300 font-bold text-sm">{dynamicExpiryMinutes} Minutes</span>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveFeeSettings} className="space-y-5">
              {/* Replacement Fee Input */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block font-mono flex items-center justify-between">
                  <span>Replacement Fee (₹ INR)</span>
                  <span className="text-[10px] text-slate-400">Charged per re-issuance</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-400 font-bold text-sm">₹</span>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={feeInput}
                    onChange={(e) => setFeeInput(e.target.value)}
                    required
                    className="w-full pl-8 pr-4 py-3 bg-black/60 border border-purple-900/60 focus:border-purple-500 rounded-2xl text-white font-mono text-sm focus:outline-none transition-all shadow-inner"
                    placeholder="e.g. 150"
                  />
                </div>
                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] text-slate-500 font-mono mr-1">Presets:</span>
                  {[50, 100, 150, 200, 250, 300].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setFeeInput(preset)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold cursor-pointer transition-all border ${
                        Number(feeInput) === preset
                          ? 'bg-purple-600 text-white border-purple-400 shadow-sm'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      ₹{preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expiry Window Input */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block font-mono flex items-center justify-between">
                  <span>Payment Window (Minutes)</span>
                  <span className="text-[10px] text-slate-400">Auto-cancellation period</span>
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-400 text-base">schedule</span>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={expiryInput}
                    onChange={(e) => setExpiryInput(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 bg-black/60 border border-purple-900/60 focus:border-purple-500 rounded-2xl text-white font-mono text-sm focus:outline-none transition-all shadow-inner"
                    placeholder="e.g. 60"
                  />
                </div>
                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] text-slate-500 font-mono mr-1">Presets:</span>
                  {[
                    { label: '30m', val: 30 },
                    { label: '60m', val: 60 },
                    { label: '120m', val: 120 },
                    { label: '24h', val: 1440 },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setExpiryInput(preset.val)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold cursor-pointer transition-all border ${
                        Number(expiryInput) === preset.val
                          ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary Note */}
              <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-500/20 text-xs text-purple-200/90 leading-relaxed font-sans">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-sm text-purple-400 shrink-0 mt-0.5">info</span>
                  <span>
                    When members report a lost or damaged ID card, they will be billed{' '}
                    <strong className="text-white">₹{feeInput || 150}</strong>. Unpaid requests will automatically expire after{' '}
                    <strong className="text-indigo-300">{expiryInput || 60} minutes</strong>.
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFeeSettingsModal(false)}
                  className="w-1/3 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white font-bold text-xs uppercase font-mono cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingFeeSettings}
                  className="w-2/3 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-40 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-purple-900/30 transition-all active:scale-98"
                >
                  {isSavingFeeSettings ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Saving Settings...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">save</span>
                      <span>Save Fee Settings</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default IDCard;
