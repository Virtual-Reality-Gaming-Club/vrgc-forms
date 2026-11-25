"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PaymentItem, PaymentStatus } from '@/types/payment';
import {
  fetchPaymentsFromFirestore,
  createPaymentInFirestore,
  updatePaymentStatusInFirestore,
  deletePaymentFromFirestore,
  batchDeleteCampaignFromFirestore,
  updateInvoiceDetailsInFirestore,
  batchUpdateCampaignInFirestore,
  toggleCampaignFacultyVisibility,
  saveInvoiceToFirestore,
  saveTransactionToFirestore,
  fetchInvoicesFromFirestore,
  fetchPaymentAttemptsFromFirestore,
  seedDemoPayments,
  checkProcessingTimeout,
  syncPaymentStatusWithRazorpay,
  isInvoiceExpired,
  getLogEventTimestamp,
  parseTimestampMs,
  TransactionLog,
  togglePaymentFacultyVisibility,
  PAYMENTS_COLLECTION,
  INVOICES_COLLECTION,
} from '@/lib/payments';
import { logAdminAction } from '@/lib/adminLogs';
import { authDb as db } from '@/lib/firebase';
import { getAuthHeaders } from '@/lib/auth-client';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { User } from 'firebase/auth';
import {
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Search,
  Filter,
  ShieldCheck,
  Zap,
  Sparkles,
  Download,
  PlusCircle,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Receipt,
  X,
  FileText,
  UserCheck,
  UserPlus,
  UserMinus,
  ShieldAlert,
  Trash2,
  Users,
  Megaphone,
  HelpCircle,
  Copy,
  Check,
  FileSpreadsheet,
  Eye,
  EyeOff,
  Layers,
  ArrowUpRight,
  Pencil,
  Lock,
  Upload,
} from 'lucide-react';

interface PaymentsProps {
  onRedirect?: () => void;
  // External auth props — provided by the global AuthContext via page.tsx
  externalUser?: User | null;
  externalUserEmail?: string;
  externalIsAdmin?: boolean;
  externalIsFaculty?: boolean;
  // Legacy prop kept for backwards compat
  isAdmin?: boolean;
}

interface MemberOption {
  name: string;
  regNo: string;
  email: string;
  team: string;
}

export interface BulkParseResult {
  matchedEmails: string[];
  unmatchedTokens: string[];
  matchedMembers: MemberOption[];
  totalParsedCount: number;
}

export function parseBulkMemberIdentifiers(
  inputText: string,
  membersList: MemberOption[],
  membersMap: Map<string, MemberOption>
): BulkParseResult {
  if (!inputText || !inputText.trim()) {
    return { matchedEmails: [], unmatchedTokens: [], matchedMembers: [], totalParsedCount: 0 };
  }

  const regNoToMember = new Map<string, MemberOption>();
  membersList.forEach((m) => {
    if (m.regNo) {
      regNoToMember.set(m.regNo.toUpperCase().trim(), m);
    }
  });

  const matchedEmailsSet = new Set<string>();
  const matchedMembersSet = new Map<string, MemberOption>();
  const unmatchedSet = new Set<string>();

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailsFound: string[] = Array.from(inputText.match(emailRegex) || []);

  const regRegex = /\b\d{2}[A-Za-z]{2,5}\d{4,5}\b/g;
  const regNosFound: string[] = Array.from(inputText.match(regRegex) || []);

  for (const email of emailsFound) {
    const cleanEmail = email.toLowerCase().trim();
    const foundMember = membersMap.get(cleanEmail);
    if (foundMember) {
      matchedEmailsSet.add(foundMember.email.toLowerCase());
      matchedMembersSet.set(foundMember.email.toLowerCase(), foundMember);
    } else {
      unmatchedSet.add(cleanEmail);
    }
  }

  for (const reg of regNosFound) {
    const cleanReg = reg.toUpperCase().trim();
    const foundMember = regNoToMember.get(cleanReg);
    if (foundMember) {
      matchedEmailsSet.add(foundMember.email.toLowerCase());
      matchedMembersSet.set(foundMember.email.toLowerCase(), foundMember);
    } else {
      const isPartOfEmail = emailsFound.some((e) => e.toUpperCase().includes(cleanReg));
      if (!isPartOfEmail) {
        unmatchedSet.add(cleanReg);
      }
    }
  }

  const rawTokens = inputText
    .split(/[\r\n,;\t]+/)
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    .filter((t) => t.length > 0);

  for (const token of rawTokens) {
    const lowerToken = token.toLowerCase();
    const upperToken = token.toUpperCase();
    if (membersMap.has(lowerToken) || regNoToMember.has(upperToken)) {
      continue;
    }
    if (token.includes('@') && !unmatchedSet.has(lowerToken)) {
      unmatchedSet.add(lowerToken);
    }
  }

  return {
    matchedEmails: Array.from(matchedEmailsSet),
    unmatchedTokens: Array.from(unmatchedSet),
    matchedMembers: Array.from(matchedMembersSet.values()),
    totalParsedCount: matchedEmailsSet.size + unmatchedSet.size,
  };
}

interface CampaignGroup {
  key: string;
  title: string;
  category: string;
  amount: number;
  currency: string;
  due_date?: string;
  totalAssigned: number;
  paidCount: number;
  pendingCount: number;
  failedCount: number;
  totalCollected: number;
  totalTarget: number;
  percentage: number;
  items: PaymentItem[];
}

// Function to load Razorpay SDK dynamically
const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    if ((window as any).Razorpay) {
      resolve(true);
      return;
    }
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true), { once: true });
      existingScript.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export function getInvoiceTimeDetails(payment: PaymentItem) {
  const createdMs = payment.created_at ? new Date(payment.created_at).getTime() : Date.now();
  const createdDate = new Date(createdMs);

  const genTimeFormatted = createdDate.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const dueDateFormatted = payment.due_date
    ? new Date(payment.due_date).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    : 'No Due Date';

  return {
    genTimeFormatted,
    dueDateFormatted,
  };
}

export function getPresetDateStr(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
}

export function formatDueDateTimeToIso(dateStr?: string, timeStr?: string): string {
  if (!dateStr || !dateStr.trim()) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  const time = (timeStr && timeStr.trim()) ? timeStr.trim() : '23:59';
  const timeFormatted = time.length === 5 ? `${time}:00` : time;
  if (dateStr.includes('T')) {
    return new Date(dateStr).toISOString();
  }
  const combined = `${dateStr.trim()}T${timeFormatted}+05:30`;
  const parsed = new Date(combined);
  return !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date(dateStr).toISOString();
}

export function splitDueDateTime(isoString?: string) {
  if (!isoString) return { date: getPresetDateStr(7), time: '23:59' };
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { date: getPresetDateStr(7), time: '23:59' };
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return {
      date: `${year}-${month}-${day}`,
      time: `${hours}:${minutes}`,
    };
  } catch {
    return { date: getPresetDateStr(7), time: '23:59' };
  }
}

export function formatDueDateToEodIst(dateStr?: string): string {
  return formatDueDateTimeToIso(dateStr, '23:59');
}

export function renderDescriptionBox(description: string) {
  if (!description) return null;

  const isNotice =
    description.includes('IMPORTANT') ||
    description.includes('⚠️') ||
    description.includes('generated at') ||
    description.includes('Invoice Generated:') ||
    description.includes('AUTOMATICALLY EXPIRE') ||
    description.includes('pay within due date') ||
    description.includes('expire after due date');

  if (isNotice) {
    let cleanText = description
      .replace(/^⚠️\s*/, '')
      .replace(/in 2 hours\s*\([^)]*\)/gi, 'after the due date')
      .replace(/in 2 hours/gi, 'after the due date')
      .replace(/after due date(?!\.)/gi, 'after the due date')
      .trim();

    return (
      <div className="mt-2.5 p-3 rounded-xl bg-[#120726]/90 border border-purple-500/35 shadow-[0_0_20px_rgba(168,85,247,0.12)] relative overflow-hidden group">
        <div className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider text-purple-300 uppercase mb-1">
          <AlertCircle className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 animate-pulse" />
          <span>Important Notice</span>
        </div>
        <p className="text-[11px] text-slate-200 leading-relaxed font-medium whitespace-pre-line">
          {cleanText}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2.5 p-3 rounded-xl bg-[#120726]/90 border border-purple-500/20 text-[11px] text-slate-300 leading-relaxed whitespace-pre-line border-l-2 border-l-purple-500">
      {description}
    </div>
  );
}

const Payments: React.FC<PaymentsProps> = ({
  onRedirect,
  externalUser,
  externalUserEmail = '',
  externalIsAdmin = false,
  externalIsFaculty = false,
  isAdmin: propIsAdmin,
}) => {
  const currentUser = externalUser ?? null;
  const userEmail = externalUserEmail;

  // Role checks
  const isAdminState = externalIsAdmin || propIsAdmin || false;
  const isFacultyState = externalIsFaculty || false;
  const canInitiatePayments = isAdminState;
  const [adminViewAll, setAdminViewAll] = useState<boolean>(true);

  // Members list parsed from public/members.csv
  const [membersList, setMembersList] = useState<MemberOption[]>([]);
  const [membersMap, setMembersMap] = useState<Map<string, MemberOption>>(new Map());

  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');

  // Modals & Active Campaign Roster
  const [activeRosterCampaign, setActiveRosterCampaign] = useState<CampaignGroup | null>(null);
  const [rosterSearch, setRosterSearch] = useState<string>('');
  const [rosterStatusFilter, setRosterStatusFilter] = useState<string>('All');
  const [isSyncingRoster, setIsSyncingRoster] = useState<boolean>(false);

  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [receiptModalPayment, setReceiptModalPayment] = useState<PaymentItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showAssignAllModal, setShowAssignAllModal] = useState<boolean>(false);
  const [showMultiMemberModal, setShowMultiMemberModal] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Multi-Member Specific Persons Due Form state
  const [multiTitle, setMultiTitle] = useState<string>('');
  const [multiAmount, setMultiAmount] = useState<string>('');
  const [multiCategory, setMultiCategory] = useState<string>('Club Fee');
  const [multiDescription, setMultiDescription] = useState<string>('');
  const [multiDueDate, setMultiDueDate] = useState<string>('');
  const [multiDueTime, setMultiDueTime] = useState<string>('23:59');
  const [selectedMultiMemberEmails, setSelectedMultiMemberEmails] = useState<string[]>([]);
  const [multiSearch, setMultiSearch] = useState<string>('');
  const [assigningMulti, setAssigningMulti] = useState<boolean>(false);
  const [multiAssignMode, setMultiAssignMode] = useState<'picker' | 'bulk'>('picker');
  const [multiBulkInput, setMultiBulkInput] = useState<string>('');
  const [multiBulkFileName, setMultiBulkFileName] = useState<string | null>(null);
  const [multiIncludeUnmatched, setMultiIncludeUnmatched] = useState<boolean>(false);
  const multiFileInputRef = useRef<HTMLInputElement | null>(null);

  // Edit Campaign (Batch Invoice) Modal State
  const [editCampaignGroup, setEditCampaignGroup] = useState<CampaignGroup | null>(null);
  const [editCampaignTab, setEditCampaignTab] = useState<'details' | 'members'>('details');
  const [editTitle, setEditTitle] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');
  const [editDueDate, setEditDueDate] = useState<string>('');
  const [editDueTime, setEditDueTime] = useState<string>('23:59');
  const [editVisibleToFaculty, setEditVisibleToFaculty] = useState<boolean>(true);
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [editMembersSearch, setEditMembersSearch] = useState<string>('');
  const [showAddMembersSection, setShowAddMembersSection] = useState<boolean>(false);
  const [addMembersSearch, setAddMembersSearch] = useState<string>('');
  const [selectedAddMemberEmails, setSelectedAddMemberEmails] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState<boolean>(false);
  const [showRosterAddMembersModal, setShowRosterAddMembersModal] = useState<boolean>(false);
  const [addMembersMode, setAddMembersMode] = useState<'picker' | 'bulk'>('picker');
  const [addMembersBulkInput, setAddMembersBulkInput] = useState<string>('');
  const [addMembersBulkFileName, setAddMembersBulkFileName] = useState<string | null>(null);
  const [addMembersIncludeUnmatched, setAddMembersIncludeUnmatched] = useState<boolean>(false);
  const addMembersFileInputRef = useRef<HTMLInputElement | null>(null);

  // Parsed bulk inputs
  const multiBulkParsed = useMemo(() => {
    return parseBulkMemberIdentifiers(multiBulkInput, membersList, membersMap);
  }, [multiBulkInput, membersList, membersMap]);

  const addMembersBulkParsed = useMemo(() => {
    return parseBulkMemberIdentifiers(addMembersBulkInput, membersList, membersMap);
  }, [addMembersBulkInput, membersList, membersMap]);

  // Helper to recompute campaign metrics
  const recalculateCampaignGroup = (group: CampaignGroup, newItems: PaymentItem[]): CampaignGroup => {
    const totalAssigned = newItems.length;
    const paidCount = newItems.filter((i) => i.status === 'Paid').length;
    const pendingCount = newItems.filter((i) => i.status === 'Pending' || i.status === 'Processing').length;
    const failedCount = newItems.filter((i) => i.status === 'Failed').length;
    const totalCollected = paidCount * group.amount;
    const totalTarget = totalAssigned * group.amount;
    const percentage = totalTarget > 0 ? Math.round((totalCollected / totalTarget) * 100) : 0;

    return {
      ...group,
      items: newItems,
      totalAssigned,
      paidCount,
      pendingCount,
      failedCount,
      totalCollected,
      totalTarget,
      percentage,
    };
  };

  // Edit Single Payment Modal State
  const [editSinglePayment, setEditSinglePayment] = useState<PaymentItem | null>(null);
  const [editSingleTitle, setEditSingleTitle] = useState<string>('');
  const [editSingleDescription, setEditSingleDescription] = useState<string>('');
  const [editSingleDueDate, setEditSingleDueDate] = useState<string>('');
  const [editSingleDueTime, setEditSingleDueTime] = useState<string>('23:59');
  const [editSingleStatus, setEditSingleStatus] = useState<PaymentStatus>('Pending');
  const [editSinglePaymentId, setEditSinglePaymentId] = useState<string>('');
  const [fetchingRazorpayId, setFetchingRazorpayId] = useState<boolean>(false);
  const [savingSingleEdit, setSavingSingleEdit] = useState<boolean>(false);
  const [updatingManualStatusId, setUpdatingManualStatusId] = useState<string | null>(null);

  // Non-blocking Custom Delete Modal State
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'campaign' | 'single';
    title: string;
    itemIds: string[];
    memberName?: string;
    totalAssigned?: number;
    isPaid?: boolean;
    amount?: number;
  } | null>(null);
  const [deletingInProgress, setDeletingInProgress] = useState<boolean>(false);

  // Transaction Logs & Audit Modal (admin only)
  const [transactionLogs, setTransactionLogs] = useState<TransactionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [showLogsPanel, setShowLogsPanel] = useState<boolean>(false);

  const sortedTransactionLogs = useMemo(() => {
    return [...transactionLogs].sort((a, b) => {
      const timeA = parseTimestampMs(getLogEventTimestamp(a));
      const timeB = parseTimestampMs(getLogEventTimestamp(b));
      if (timeB !== timeA) return timeB - timeA;
      const createdA = parseTimestampMs(a.created_at);
      const createdB = parseTimestampMs(b.created_at);
      if (createdB !== createdA) return createdB - createdA;
      return (b.id || '').localeCompare(a.id || '');
    });
  }, [transactionLogs]);

  const [auditModalPayment, setAuditModalPayment] = useState<PaymentItem | null>(null);
  const [auditAttempts, setAuditAttempts] = useState<TransactionLog[]>([]);
  const [loadingAudit, setLoadingAudit] = useState<boolean>(false);

  const handleOpenAuditModal = async (payment: PaymentItem) => {
    setAuditModalPayment(payment);
    setLoadingAudit(true);
    try {
      const logs = await fetchPaymentAttemptsFromFirestore(payment.id);
      setAuditAttempts(logs);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  // Visibility states for faculty
  const [newVisibleToFaculty, setNewVisibleToFaculty] = useState<boolean>(true);
  const [allVisibleToFaculty, setAllVisibleToFaculty] = useState<boolean>(true);
  const [multiVisibleToFaculty, setMultiVisibleToFaculty] = useState<boolean>(true);

  const handleToggleFacultyVisibility = async (payment: PaymentItem) => {
    const currentVis = payment.visible_to_faculty !== false;
    const newVis = !currentVis;
    const ok = await togglePaymentFacultyVisibility(payment.id, newVis);
    if (ok) {
      setPayments((prev) =>
        prev.map((p) => (p.id === payment.id ? { ...p, visible_to_faculty: newVis } : p))
      );
      showToast(newVis ? 'Payment marked visible to faculty.' : 'Payment hidden from faculty.', 'info');
    } else {
      showToast('Failed to update faculty visibility in database.', 'error');
    }
  };

  const handleToggleCampaignFacultyVisibility = async (group: CampaignGroup) => {
    const isCurrentlyVisible = group.items.some((i) => i.visible_to_faculty !== false);
    const newVis = !isCurrentlyVisible;
    const itemIds = group.items.map((i) => i.id);
    const itemIdsSet = new Set(itemIds);

    const ok = await toggleCampaignFacultyVisibility(itemIds, newVis);
    if (ok) {
      setPayments((prev) =>
        prev.map((p) => (itemIdsSet.has(p.id) ? { ...p, visible_to_faculty: newVis } : p))
      );
      logAdminAction({
        adminEmail: userEmail || 'admin',
        action: 'EDIT_INVOICE_CAMPAIGN',
        details: `${newVis ? 'Enabled' : 'Disabled'} faculty visibility for campaign "${group.title}" (${itemIds.length} records)`,
      });
      showToast(
        newVis
          ? `Campaign "${group.title}" is now VISIBLE to Faculty Desk! 👁️`
          : `Campaign "${group.title}" is now HIDDEN from Faculty Desk! 🙈`,
        'info'
      );
    } else {
      showToast('Failed to update faculty visibility in database.', 'error');
    }
  };

  // Single Member Due Form state
  const [selectedMemberEmail, setSelectedMemberEmail] = useState<string>('');
  const [singleMemberSearch, setSingleMemberSearch] = useState<string>('');
  const [showSingleDropdown, setShowSingleDropdown] = useState<boolean>(false);
  const [targetEmail, setTargetEmail] = useState<string>('');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newAmount, setNewAmount] = useState<string>('');
  const [newCategory, setNewCategory] = useState<string>('Club Fee');
  const [newDescription, setNewDescription] = useState<string>('');
  const [newDueDate, setNewDueDate] = useState<string>('');
  const [newDueTime, setNewDueTime] = useState<string>('23:59');
  const [creating, setCreating] = useState<boolean>(false);

  // All Members Due Form state
  const [allTitle, setAllTitle] = useState<string>('');
  const [allAmount, setAllAmount] = useState<string>('');
  const [allCategory, setAllCategory] = useState<string>('Club Fee');
  const [allDescription, setAllDescription] = useState<string>('');
  const [allDueDate, setAllDueDate] = useState<string>('');
  const [allDueTime, setAllDueTime] = useState<string>('23:59');
  const [assigningAll, setAssigningAll] = useState<boolean>(false);

  // Load registered crew members from Firestore ('members' and 'id_cards' collections)
  useEffect(() => {
    const loadMembers = async () => {
      try {
        const fetchedMembersMap = new Map<string, MemberOption>();
        const knownRegNos = new Set<string>();

        // 1. Fetch from 'members' bucket collection
        try {
          const membersCol = collection(db, 'members');
          const membersSnap = await getDocs(membersCol);
          membersSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const email = (data.email || data.Email || docSnap.id || '').toLowerCase().trim();
            const regNo = (data.registrationNumber || data['Registration Number'] || data.regNo || '').trim();
            if (email && email.includes('@')) {
              fetchedMembersMap.set(email, {
                name: data.name || data.Name || data.fullName || 'Member',
                regNo: regNo,
                email: email,
                team: data.team || data.Team || data.domain || 'VRGC Crew',
              });
              if (regNo) {
                knownRegNos.add(regNo.toUpperCase());
              }
            }
          });
        } catch (mErr) {
          console.warn('Firestore members collection fetch error:', mErr);
        }

        // 2. Fetch from 'id_cards' bucket collection
        try {
          const idCardsCol = collection(db, 'id_cards');
          const idCardsSnap = await getDocs(idCardsCol);
          idCardsSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const email = (data.email || data.Email || docSnap.id || '').toLowerCase().trim();
            const regNo = (data.regNo || data.registrationNumber || data['Registration Number'] || '').trim();
            const regUpper = regNo.toUpperCase();
            // Avoid adding phantom duplicates if either email is already known or regNo matches an existing member
            if (email && email.includes('@') && !fetchedMembersMap.has(email) && (!regUpper || !knownRegNos.has(regUpper))) {
              fetchedMembersMap.set(email, {
                name: data.fullName || data.name || data.Name || 'Member',
                regNo: regNo,
                email: email,
                team: data.team || data.Team || data.domain || 'VRGC Crew',
              });
              if (regUpper) {
                knownRegNos.add(regUpper);
              }
            }
          });
        } catch (idErr) {
          console.warn('Firestore id_cards collection fetch error:', idErr);
        }

        const uniqueMembers = Array.from(fetchedMembersMap.values());
        setMembersList(uniqueMembers);
        setMembersMap(fetchedMembersMap);
      } catch (err) {
        console.error('Error loading members list from Firestore:', err);
      }
    };

    loadMembers();
  }, []);

  // Fetch payments from Firestore
  const loadPayments = useCallback(async (email: string, adminStatus: boolean) => {
    setLoading(true);
    try {
      let data = await fetchPaymentsFromFirestore(email, adminStatus);
      if (isFacultyState) {
        data = data.filter((p) => p.visible_to_faculty !== false);
      }
      setPayments(data);
    } catch (err) {
      console.error('Error loading payments:', err);
      showToast('Failed to load payments from database', 'error');
    } finally {
      setLoading(false);
    }
  }, [isFacultyState]);

  // Filter pending personal dues for the logged-in user (including payment admins)
  const personalPendingDues = useMemo(() => {
    if (!userEmail) return [];
    return payments.filter(
      (p) => p.user_email?.toLowerCase() === userEmail.toLowerCase() && p.status !== 'Paid'
    );
  }, [payments, userEmail]);

  useEffect(() => {
    if (userEmail || isFacultyState) {
      loadPayments(userEmail, (isAdminState && adminViewAll) || isFacultyState);
    } else {
      setLoading(false);
    }
  }, [userEmail, isAdminState, adminViewAll, isFacultyState, loadPayments]);

  // Firestore realtime listener for payments collection
  useEffect(() => {
    if (!userEmail && !isFacultyState) return;

    const colRef = collection(db, PAYMENTS_COLLECTION);
    const q = (isAdminState && adminViewAll) || isFacultyState
      ? query(colRef)
      : query(colRef, where('user_email', '==', userEmail.toLowerCase()));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let items: PaymentItem[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const rawItem: PaymentItem = {
          id: docSnap.id,
          user_email: data.user_email || '',
          candidate_name: data.candidate_name || data.user_name || '',
          registration_number: data.registration_number || data.regNo || '',
          team: data.team || '',
          title: data.title || '',
          description: data.description || '',
          category: data.category || 'Club Fee',
          amount: Number(data.amount) || 0,
          currency: data.currency || 'INR',
          status: (data.status as PaymentStatus) || 'Pending',
          due_date: data.due_date || '',
          razorpay_order_id: data.razorpay_order_id || '',
          razorpay_payment_id: data.razorpay_payment_id || '',
          razorpay_signature: data.razorpay_signature || '',
          paid_at: data.paid_at || '',
          visible_to_faculty: data.visible_to_faculty !== undefined ? !!data.visible_to_faculty : true,
          created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at || new Date().toISOString(),
          updated_at: data.updated_at?.toDate ? data.updated_at.toDate().toISOString() : data.updated_at || new Date().toISOString(),
        };
        items.push(checkProcessingTimeout(rawItem));
      });

      // If viewing as faculty, filter to only payments visible to faculty
      if (isFacultyState) {
        items = items.filter((p) => p.visible_to_faculty !== false);
      }

      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setPayments(items);
      setLoading(false);
    }, (err) => {
      console.warn('Firestore payments subscription warning:', err);
    });

    return () => unsubscribe();
  }, [userEmail, isAdminState, adminViewAll, isFacultyState]);

  // Periodically check and auto-expire stale "Processing" sessions (> 12 minutes)
  // CRITICAL: Queries Razorpay API first. If captured on Razorpay -> Paid. If not paid & > 12 min -> Failed.
  useEffect(() => {
    const interval = setInterval(() => {
      setPayments((prevPayments) => {
        let hasChanges = false;
        const updated = prevPayments.map((p) => {
          if (p.status === 'Processing') {
            const checked = checkProcessingTimeout(p);
            if (checked.status !== p.status) {
              hasChanges = true;
            }
            return checked;
          }
          return p;
        });
        return hasChanges ? updated : prevPayments;
      });

      // Active Razorpay status lookup for any processing items exceeding 12 minutes
      payments.forEach((p) => {
        if (p.status === 'Processing') {
          const lastUpdatedMs = parseTimestampMs(p.updated_at) || parseTimestampMs(p.created_at);
          if (lastUpdatedMs > 0 && Date.now() - lastUpdatedMs >= 12 * 60 * 1000) {
            syncPaymentStatusWithRazorpay(p.id, p.razorpay_order_id).then((res) => {
              if (res.success && res.status && res.status !== 'Processing') {
                setPayments((prev) =>
                  prev.map((item) => (item.id === p.id ? { ...item, status: res.status as PaymentStatus } : item))
                );
              }
            }).catch((err) => console.warn('Periodic Razorpay sync check error:', err));
          }
        }
      });
    }, 30000); // Run check every 30 seconds

    return () => clearInterval(interval);
  }, [payments]);

  // Auto-sync any Processing payments with Razorpay API on load
  useEffect(() => {
    const processingPayments = payments.filter((p) => p.status === 'Processing');
    if (processingPayments.length > 0) {
      processingPayments.forEach((p) => {
        const lastUpdatedMs = parseTimestampMs(p.updated_at) || parseTimestampMs(p.created_at);
        if (lastUpdatedMs > 0 && Date.now() - lastUpdatedMs >= 12 * 60 * 1000) {
          syncPaymentStatusWithRazorpay(p.id, p.razorpay_order_id).then((res) => {
            if (res.success && res.status && res.status !== 'Processing') {
              setPayments((prev) =>
                prev.map((item) => (item.id === p.id ? { ...item, status: res.status as PaymentStatus } : item))
              );
            }
          }).catch((err) => console.warn('Auto-sync processing payment check warning:', err));
        }
      });
    }
  }, [payments.length]);

  // Auto-sync when user returns to tab (crucial for mobile UPI app switching where browser is backgrounded)
  useEffect(() => {
    let lastSyncTime = 0;
    const handleReturnToTab = () => {
      const now = Date.now();
      if (document.visibilityState === 'visible' && now - lastSyncTime > 5000) {
        const hasProcessing = payments.some((p) => p.status === 'Processing');
        if (hasProcessing) {
          lastSyncTime = now;
          syncPaymentStatusWithRazorpay(undefined, undefined, true).catch(() => {});
        }
      }
    };

    document.addEventListener('visibilitychange', handleReturnToTab);
    window.addEventListener('focus', handleReturnToTab);
    return () => {
      document.removeEventListener('visibilitychange', handleReturnToTab);
      window.removeEventListener('focus', handleReturnToTab);
    };
  }, [payments]);

  // Keep activeRosterCampaign synchronized with live payments state
  useEffect(() => {
    if (!activeRosterCampaign) return;
    const matchingPayments = payments.filter(
      (p) => p.title.trim().toLowerCase() === activeRosterCampaign.title.trim().toLowerCase()
    );
    if (matchingPayments.length > 0) {
      setActiveRosterCampaign((prev) => (prev ? recalculateCampaignGroup(prev, matchingPayments) : null));
    }
  }, [payments]);

  // Load transaction logs from Firestore invoices collection
  const loadTransactionLogs = useCallback(async () => {
    if (!isAdminState) return;
    setLogsLoading(true);
    try {
      const logs = await fetchInvoicesFromFirestore(userEmail, isAdminState);
      setTransactionLogs(logs);
    } catch (err) {
      console.error('Error loading transaction logs:', err);
    } finally {
      setLogsLoading(false);
    }
  }, [userEmail, isAdminState]);

  // Firestore realtime subscription for invoices collection
  useEffect(() => {
    if (!isAdminState || !showLogsPanel) return;

    loadTransactionLogs();

    const colRef = collection(db, PAYMENTS_COLLECTION);
    const unsubscribe = onSnapshot(colRef, () => {
      loadTransactionLogs();
    }, (err) => {
      console.warn('Firestore payments subscription warning:', err);
    });

    return () => unsubscribe();
  }, [isAdminState, showLogsPanel, loadTransactionLogs]);

  // Toast Helper
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Seed sample demo dues (Admin function)
  const handleSeedDemo = async () => {
    if (!isAdminState) {
      showToast('Only authorized VRGC Admins can seed demo dues.', 'error');
      return;
    }
    setLoading(true);
    const destinationEmail = targetEmail || selectedMemberEmail || userEmail || 'member@vrgc.club';
    const seeded = await seedDemoPayments(destinationEmail);
    if (seeded && seeded.length > 0) {
      setPayments((prev) => [...seeded, ...prev]);
      showToast(`Sample payment dues assigned to ${destinationEmail}! 🎉`, 'success');
    } else {
      showToast('Could not seed sample payments.', 'error');
    }
    setLoading(false);
  };

  // Handle Member selection change in Modal
  const handleSelectMemberInModal = (email: string) => {
    setSelectedMemberEmail(email);
    if (email !== 'custom') {
      setTargetEmail(email);
    } else {
      setTargetEmail('');
    }
  };

  // Create single member payment (Admin function)
  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminState) {
      showToast('Unauthorized: Only admins can assign payments.', 'error');
      return;
    }

    const finalTargetEmail = (targetEmail || selectedMemberEmail).trim().toLowerCase();

    if (!newTitle || !newAmount || Number(newAmount) <= 0 || !finalTargetEmail) {
      showToast('Please select a target member email, valid title, and amount.', 'error');
      return;
    }

    setCreating(true);
    try {
      const targetMember = membersMap.get(finalTargetEmail);
      const created = await createPaymentInFirestore({
        user_email: finalTargetEmail,
        candidate_name: targetMember?.name || '',
        registration_number: targetMember?.regNo || '',
        team: targetMember?.team || '',
        title: newTitle,
        description: newDescription || 'Assigned VRGC Payment Due',
        category: newCategory,
        amount: Number(newAmount),
        currency: 'INR',
        status: 'Pending' as PaymentStatus,
        due_date: formatDueDateTimeToIso(newDueDate, newDueTime),
        visible_to_faculty: newVisibleToFaculty,
      });

      if (created) {
        setPayments((prev) => [created, ...prev]);
        logAdminAction({
          adminEmail: userEmail || 'admin',
          action: 'CREATE_DUE',
          targetEmail: finalTargetEmail,
          targetName: targetMember?.name || 'Member',
          details: `Assigned due ₹${newAmount} for "${newTitle}"`,
        });
        showToast(`Payment due of ₹${newAmount} assigned to ${finalTargetEmail}! ✨`, 'success');
      } else {
        showToast('Failed to create payment due in Firestore', 'error');
      }

      setShowCreateModal(false);
      setNewTitle('');
      setNewAmount('');
      setNewDescription('');
      setTargetEmail('');
      setSelectedMemberEmail('');
      setSingleMemberSearch('');
      setShowSingleDropdown(false);
      setNewDueDate('');
      setNewDueTime('23:59');
      setNewVisibleToFaculty(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to create payment due', 'error');
    } finally {
      setCreating(false);
    }
  };

  // Assign Payment Due to ALL Registered Members
  const handleAssignToAllMembers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminState) return;

    if (!allTitle || !allAmount || Number(allAmount) <= 0) {
      showToast('Please enter a valid title and amount.', 'error');
      return;
    }

    if (membersList.length === 0) {
      showToast('No registered crew members found in directory.', 'error');
      return;
    }

    setAssigningAll(true);
    try {
      let createdCount = 0;
      for (const m of membersList) {
        const created = await createPaymentInFirestore({
          user_email: m.email.toLowerCase(),
          candidate_name: m.name,
          registration_number: m.regNo,
          team: m.team,
          title: allTitle,
          description: allDescription || 'Mandatory VRGC Member Due',
          category: allCategory,
          amount: Number(allAmount),
          currency: 'INR',
          status: 'Pending' as PaymentStatus,
          due_date: formatDueDateTimeToIso(allDueDate, allDueTime),
          visible_to_faculty: allVisibleToFaculty,
        });
        if (created) createdCount++;
      }

      logAdminAction({
        adminEmail: userEmail || 'admin',
        action: 'ASSIGN_ALL',
        targetEmail: 'All Members',
        details: `Assigned due ₹${allAmount} for "${allTitle}" to ${createdCount} members`,
      });

      showToast(`Successfully assigned ₹${allAmount} due to ${createdCount} crew members in Firestore! 🎉`, 'success');
      setShowAssignAllModal(false);
      setAllTitle('');
      setAllAmount('');
      setAllDescription('');
      setAllDueDate('');
      setAllDueTime('23:59');
      setAllVisibleToFaculty(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to assign dues to all members.', 'error');
    } finally {
      setAssigningAll(false);
    }
  };

  // Assign Due to Specific Persons (Multi-Member Selection)
  const handleAssignMultiMembers = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!multiTitle.trim() || !multiAmount || Number(multiAmount) <= 0) {
      showToast('Please enter a valid title and amount.', 'error');
      return;
    }

    if (selectedMultiMemberEmails.length === 0) {
      showToast('Please select at least one member.', 'error');
      return;
    }

    setAssigningMulti(true);
    try {
      let createdCount = 0;
      for (const email of selectedMultiMemberEmails) {
        const m = membersMap.get(email.toLowerCase());
        const created = await createPaymentInFirestore({
          user_email: email.toLowerCase(),
          candidate_name: m?.name || '',
          registration_number: m?.regNo || '',
          team: m?.team || '',
          title: multiTitle.trim(),
          description: multiDescription.trim() || 'VRGC Member Payment Due',
          category: multiCategory,
          amount: Number(multiAmount),
          currency: 'INR',
          status: 'Pending' as PaymentStatus,
          due_date: formatDueDateTimeToIso(multiDueDate, multiDueTime),
          visible_to_faculty: multiVisibleToFaculty,
        });
        if (created) createdCount++;
      }

      logAdminAction({
        adminEmail: userEmail || 'admin',
        action: 'ASSIGN_MULTI',
        targetEmail: `${createdCount} members`,
        details: `Assigned due ₹${multiAmount} for "${multiTitle}"`,
      });

      showToast(`Successfully assigned ₹${multiAmount} due to ${createdCount} selected member(s)! 🎉`, 'success');
      setShowMultiMemberModal(false);
      setMultiTitle('');
      setMultiAmount('');
      setMultiDescription('');
      setMultiDueDate('');
      setMultiDueTime('23:59');
      setSelectedMultiMemberEmails([]);
      setMultiSearch('');
      setMultiVisibleToFaculty(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to assign dues to members.', 'error');
    } finally {
      setAssigningMulti(false);
    }
  };

  // Open Edit Campaign Modal
  const handleOpenEditCampaign = (group: CampaignGroup) => {
    const first = group.items[0];
    const { date, time } = splitDueDateTime(group.due_date || first?.due_date);
    setEditCampaignGroup(group);
    setEditCampaignTab('details');
    setShowAddMembersSection(false);
    setSelectedAddMemberEmails([]);
    setAddMembersSearch('');
    setEditMembersSearch('');
    setEditTitle(group.title);
    setEditDescription(first?.description || '');
    setEditDueDate(date);
    setEditDueTime(time);
    setEditVisibleToFaculty(first?.visible_to_faculty !== false);
  };

  // Add members to an invoice campaign
  const handleAddMembersToInvoice = async (targetGroup: CampaignGroup, memberEmailsToAdd: string[]) => {
    if (!targetGroup || !isAdminState || memberEmailsToAdd.length === 0) return;

    // Filter out members that already have this invoice
    const existingEmails = new Set(targetGroup.items.map((i) => (i.user_email || '').toLowerCase()));
    const toAdd = memberEmailsToAdd.filter((email) => !existingEmails.has(email.toLowerCase()));
    if (toAdd.length === 0) {
      showToast('Selected member(s) already have this invoice issued.', 'info');
      return;
    }

    setAddingMembers(true);
    try {
      const firstItem = targetGroup.items[0];
      const isEditingThis = editCampaignGroup && editCampaignGroup.key === targetGroup.key;
      const effectiveTitle = isEditingThis && editTitle.trim() ? editTitle.trim() : targetGroup.title;
      const effectiveDesc = isEditingThis && editDescription.trim() ? editDescription.trim() : (firstItem?.description || 'VRGC Member Payment Due');
      const effectiveDueDate = isEditingThis && editDueDate ? formatDueDateTimeToIso(editDueDate, editDueTime) : (targetGroup.due_date || firstItem?.due_date || '');
      const effectiveVisibleToFaculty = isEditingThis ? editVisibleToFaculty : (firstItem?.visible_to_faculty !== false);

      const newlyCreatedItems: PaymentItem[] = [];
      for (const email of toAdd) {
        const m = membersMap.get(email.toLowerCase());
        const created = await createPaymentInFirestore({
          user_email: email.toLowerCase(),
          candidate_name: m?.name || '',
          registration_number: m?.regNo || '',
          team: m?.team || '',
          title: effectiveTitle,
          description: effectiveDesc,
          category: targetGroup.category,
          amount: targetGroup.amount,
          currency: targetGroup.currency || 'INR',
          status: 'Pending' as PaymentStatus,
          due_date: effectiveDueDate,
          visible_to_faculty: effectiveVisibleToFaculty,
        });
        if (created) {
          newlyCreatedItems.push(created);
        }
      }

      if (newlyCreatedItems.length > 0) {
        // Update global payments state
        setPayments((prev) => [...newlyCreatedItems, ...prev]);

        // Update editCampaignGroup state if open
        setEditCampaignGroup((prev) => {
          if (!prev || prev.key !== targetGroup.key) return prev;
          const updatedItems = [...prev.items, ...newlyCreatedItems];
          return recalculateCampaignGroup(prev, updatedItems);
        });

        // Update activeRosterCampaign state if open
        setActiveRosterCampaign((prev) => {
          if (!prev || prev.key !== targetGroup.key) return prev;
          const updatedItems = [...prev.items, ...newlyCreatedItems];
          return recalculateCampaignGroup(prev, updatedItems);
        });

        logAdminAction({
          adminEmail: userEmail || 'admin',
          action: 'ASSIGN_MULTI',
          targetEmail: `${newlyCreatedItems.length} members`,
          details: `Added ${newlyCreatedItems.length} member(s) to invoice campaign "${effectiveTitle}"`,
        });

        showToast(`Successfully issued invoice to ${newlyCreatedItems.length} member(s)! 🎉`, 'success');
        setSelectedAddMemberEmails([]);
        setShowAddMembersSection(false);
        setShowRosterAddMembersModal(false);
      } else {
        showToast('Failed to add members to invoice.', 'error');
      }
    } catch (err: any) {
      console.error('Error adding members to invoice:', err);
      showToast(err.message || 'Failed to add members to invoice.', 'error');
    } finally {
      setAddingMembers(false);
    }
  };

  // Save Edit Campaign (Batch)
  const handleSaveEditCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCampaignGroup || !isAdminState) return;

    if (!editTitle.trim()) {
      showToast('Please enter a valid invoice title.', 'error');
      return;
    }

    setSavingEdit(true);
    try {
      const finalIsoDueDate = formatDueDateTimeToIso(editDueDate, editDueTime);
      const itemIds = editCampaignGroup.items.map((i) => i.id);
      const itemIdsSet = new Set(itemIds);
      const cleanTitle = editTitle.trim();
      const cleanDesc = editDescription.trim();

      const ok = await batchUpdateCampaignInFirestore(itemIds, {
        title: cleanTitle,
        description: cleanDesc,
        due_date: finalIsoDueDate,
        visible_to_faculty: editVisibleToFaculty,
      });

      if (ok) {
        setPayments((prev) =>
          prev.map((p) =>
            itemIdsSet.has(p.id)
              ? {
                  ...p,
                  title: cleanTitle,
                  description: cleanDesc,
                  due_date: finalIsoDueDate,
                  visible_to_faculty: editVisibleToFaculty,
                }
              : p
          )
        );
        logAdminAction({
          adminEmail: userEmail || 'admin',
          action: 'EDIT_INVOICE_CAMPAIGN',
          details: `Updated campaign "${cleanTitle}" across ${itemIds.length} members (Due: ${finalIsoDueDate}, FacultyVis: ${editVisibleToFaculty})`,
        });
        showToast(`Invoice updated across all ${itemIds.length} members! ✏️`, 'success');
        setEditCampaignGroup(null);
      } else {
        showToast('Failed to update campaign invoices.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error updating campaign', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  // Manual Status Change by SuperAdmin (marks Paid, Pending, or Failed)
  // When marking Paid, auto-verifies directly with Razorpay API first to capture authentic pay_... ID and method
  const handleManualStatusChange = async (
    item: PaymentItem,
    newStatus: PaymentStatus,
    explicitPaymentId?: string
  ) => {
    if (!isAdminState || !item) return;

    const currentEffectiveStatus = item.status === 'Paid' ? 'Paid' : (isInvoiceExpired(item) || item.status === 'Expired') ? 'Expired' : (item.status || 'Pending');
    // Don't no-op if already Paid but has a synthetic manual_ ID, because the user wants to auto-verify & fetch the real Razorpay pay_... ID!
    if (
      currentEffectiveStatus === newStatus &&
      !explicitPaymentId &&
      !(newStatus === 'Paid' && (!item.razorpay_payment_id || item.razorpay_payment_id.startsWith('manual_')))
    ) {
      return;
    }

    setUpdatingManualStatusId(item.id);
    const nowIso = new Date().toISOString();

    let updates: Partial<PaymentItem> = {
      status: newStatus,
    };

    if (newStatus === 'Paid') {
      let resolvedPaymentId =
        explicitPaymentId?.trim() ||
        (item.razorpay_payment_id && !item.razorpay_payment_id.startsWith('manual_')
          ? item.razorpay_payment_id
          : '');
      let resolvedMethod =
        item.payment_method && !item.payment_method.includes('Manual')
          ? item.payment_method
          : '';
      let resolvedPaidAt = item.paid_at || '';
      let verifiedViaRazorpay = false;

      // Auto-verify with Razorpay if not already confirmed pay_ ID, or if explicit ID was passed, or if it had a synthetic manual_ ID
      if (
        !resolvedPaymentId ||
        explicitPaymentId ||
        item.razorpay_payment_id?.startsWith('manual_') ||
        item.status !== 'Paid'
      ) {
        try {
          showToast(`Verifying payment with Razorpay for ${item.candidate_name || item.user_email}...`, 'info');
          const syncRes = await syncPaymentStatusWithRazorpay(
            item.id,
            item.razorpay_order_id,
            false,
            explicitPaymentId?.trim() || undefined
          );

          if (syncRes.success && (syncRes.status === 'Paid' || syncRes.razorpay_payment_id)) {
            if (syncRes.razorpay_payment_id) {
              resolvedPaymentId = syncRes.razorpay_payment_id;
              verifiedViaRazorpay = true;
            }
            if (syncRes.payment_method) {
              resolvedMethod = syncRes.payment_method;
            }
            if (syncRes.paid_at) {
              resolvedPaidAt = syncRes.paid_at;
            }
          }
        } catch (syncErr) {
          console.warn('Razorpay auto-verification query error:', syncErr);
        }
      }

      if (resolvedPaymentId && verifiedViaRazorpay) {
        updates = {
          ...updates,
          status: 'Paid',
          paid_at: resolvedPaidAt || nowIso,
          payment_method: resolvedMethod || 'Razorpay (Online)',
          razorpay_payment_id: resolvedPaymentId,
          error_description: '',
        };
        showToast(`Verified with Razorpay! Captured Txn ID: ${resolvedPaymentId} 🎉`, 'success');
      } else if (resolvedPaymentId) {
        updates = {
          ...updates,
          status: 'Paid',
          paid_at: resolvedPaidAt || item.paid_at || nowIso,
          payment_method: resolvedMethod || item.payment_method || 'Manual Verification (Admin)',
          razorpay_payment_id: resolvedPaymentId,
          error_description: '',
        };
        showToast(`Marked as Paid with ID: ${resolvedPaymentId} ✅`, 'success');
      } else {
        // Fallback when no Razorpay record exists (e.g. offline cash payment)
        updates = {
          ...updates,
          status: 'Paid',
          paid_at: resolvedPaidAt || item.paid_at || nowIso,
          payment_method: resolvedMethod || item.payment_method || 'Manual Verification (Admin)',
          razorpay_payment_id: `manual_${Date.now()}`,
          error_description: '',
        };
        showToast(`No online Razorpay transaction found for candidate. Marked as Manually Verified.`, 'info');
      }
    } else if (newStatus === 'Pending') {
      updates = {
        ...updates,
        paid_at: '',
        error_description: '',
      };
    } else if (newStatus === 'Failed') {
      updates = {
        ...updates,
        failed_at: item.failed_at || nowIso,
        error_description: 'Marked as failed by admin',
      };
    } else if (newStatus === 'Expired') {
      updates = {
        ...updates,
        failed_at: item.failed_at || nowIso,
        error_description: 'Marked as expired by admin (payment deadline exceeded)',
      };
    } else if (newStatus === 'Processing') {
      updates = {
        ...updates,
        error_description: '',
      };
    }

    try {
      const ok = await updatePaymentStatusInFirestore(item.id, updates);

      if (ok) {
        // Save transaction attempt log for audit trail
        saveTransactionToFirestore({
          payment_id: item.id,
          user_email: item.user_email,
          candidate_name: item.candidate_name,
          registration_number: item.registration_number,
          team: item.team,
          payment_title: item.title,
          amount: item.amount,
          currency: item.currency || 'INR',
          status: newStatus,
          paid_at: updates.paid_at,
          failed_at: updates.failed_at,
          payment_method: updates.payment_method,
          razorpay_payment_id: updates.razorpay_payment_id,
          error_description: newStatus === 'Paid'
            ? (updates.payment_method?.includes('Manual')
                ? 'Manually verified and marked Paid by SuperAdmin'
                : 'Auto-verified with Razorpay API and marked Paid by SuperAdmin')
            : newStatus === 'Failed'
            ? 'Marked as Failed by SuperAdmin'
            : newStatus === 'Expired'
            ? 'Marked as Expired by SuperAdmin (payment deadline exceeded)'
            : `Status changed to ${newStatus} by SuperAdmin`,
        }).catch((e) => console.warn('Manual status tx log warning:', e));

        // Optimistically update local payments state
        setPayments((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, ...updates } : p))
        );

        // Update activeRosterCampaign items if open
        if (activeRosterCampaign) {
          setActiveRosterCampaign((prev) =>
            prev
              ? recalculateCampaignGroup(
                  prev,
                  prev.items.map((p) => (p.id === item.id ? { ...p, ...updates } : p))
                )
              : null
          );
        }

        // Update audit modal if open for this item
        if (auditModalPayment && auditModalPayment.id === item.id) {
          setAuditModalPayment((prev) => (prev ? { ...prev, ...updates } : null));
        }

        // Log admin audit action
        logAdminAction({
          adminEmail: userEmail || 'admin',
          action: 'EDIT_INVOICE_SINGLE',
          targetEmail: item.user_email,
          details: `Manually changed invoice status to "${newStatus}" for ${item.candidate_name || item.user_email} (Campaign: ${item.title}, Ref: ${updates.razorpay_payment_id || 'N/A'})`,
        });

        if (newStatus !== 'Paid') {
          showToast(`Status updated to "${newStatus}" for ${item.candidate_name || item.user_email}! ✅`, 'success');
        }
      } else {
        showToast('Failed to update status in database.', 'error');
      }
    } catch (err: any) {
      console.error('Error updating status manually:', err);
      showToast(err.message || 'Error updating status', 'error');
    } finally {
      setUpdatingManualStatusId(null);
    }
  };

  // Open Edit Single Payment Modal
  const handleOpenEditSingle = (payment: PaymentItem) => {
    const { date, time } = splitDueDateTime(payment.due_date);
    const isExp = isInvoiceExpired(payment) || payment.status === 'Expired';
    setEditSinglePayment(payment);
    setEditSingleTitle(payment.title);
    setEditSingleDescription(payment.description || '');
    setEditSingleDueDate(date);
    setEditSingleDueTime(time);
    setEditSingleStatus(payment.status === 'Paid' ? 'Paid' : isExp ? 'Expired' : payment.status || 'Pending');
    setEditSinglePaymentId(payment.razorpay_payment_id || '');
  };

  // Auto-fetch authentic Razorpay payment ID for Edit Single Modal
  const handleAutoFetchRazorpayId = async () => {
    if (!editSinglePayment) return;
    setFetchingRazorpayId(true);
    showToast(`Checking Razorpay API for ${editSinglePayment.candidate_name || editSinglePayment.user_email}...`, 'info');
    try {
      const syncRes = await syncPaymentStatusWithRazorpay(
        editSinglePayment.id,
        editSinglePayment.razorpay_order_id,
        false,
        editSinglePaymentId.trim() || undefined
      );

      if (syncRes.success && (syncRes.status === 'Paid' || syncRes.razorpay_payment_id)) {
        if (syncRes.razorpay_payment_id) {
          setEditSinglePaymentId(syncRes.razorpay_payment_id);
        }
        setEditSingleStatus('Paid');
        showToast(`Found captured payment on Razorpay! ID: ${syncRes.razorpay_payment_id || 'Captured'} 🎉`, 'success');
      } else {
        showToast('No captured Razorpay payment found for this member yet.', 'info');
      }
    } catch (err: any) {
      showToast(err?.message || 'Error checking Razorpay API', 'error');
    } finally {
      setFetchingRazorpayId(false);
    }
  };

  // Save Edit Single Payment
  const handleSaveEditSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSinglePayment || !isAdminState) return;

    if (!editSingleTitle.trim()) {
      showToast('Please enter a valid payment title.', 'error');
      return;
    }

    setSavingSingleEdit(true);
    try {
      const finalIsoDueDate = formatDueDateTimeToIso(editSingleDueDate, editSingleDueTime);
      const cleanTitle = editSingleTitle.trim();
      const cleanDesc = editSingleDescription.trim();
      const cleanPaymentId = editSinglePaymentId.trim();

      const ok = await updateInvoiceDetailsInFirestore(editSinglePayment.id, {
        title: cleanTitle,
        description: cleanDesc,
        due_date: finalIsoDueDate,
      });

      if (ok) {
        // If status or payment ID was changed/entered, apply manual status update
        const origEffectiveStatus =
          editSinglePayment.status === 'Paid'
            ? 'Paid'
            : isInvoiceExpired(editSinglePayment) || editSinglePayment.status === 'Expired'
            ? 'Expired'
            : editSinglePayment.status || 'Pending';
        if (
          editSingleStatus !== origEffectiveStatus ||
          cleanPaymentId !== (editSinglePayment.razorpay_payment_id || '')
        ) {
          await handleManualStatusChange(editSinglePayment, editSingleStatus, cleanPaymentId || undefined);
        }

        setPayments((prev) =>
          prev.map((p) =>
            p.id === editSinglePayment.id
              ? {
                  ...p,
                  title: cleanTitle,
                  description: cleanDesc,
                  due_date: finalIsoDueDate,
                  ...(cleanPaymentId ? { razorpay_payment_id: cleanPaymentId } : {}),
                }
              : p
          )
        );
        if (activeRosterCampaign) {
          setActiveRosterCampaign((prev) =>
            prev
              ? recalculateCampaignGroup(
                  prev,
                  prev.items.map((item) =>
                    item.id === editSinglePayment.id
                      ? {
                          ...item,
                          title: cleanTitle,
                          description: cleanDesc,
                          due_date: finalIsoDueDate,
                          ...(cleanPaymentId ? { razorpay_payment_id: cleanPaymentId } : {}),
                        }
                      : item
                  )
                )
              : null
          );
        }
        if (editCampaignGroup) {
          setEditCampaignGroup((prev) =>
            prev
              ? recalculateCampaignGroup(
                  prev,
                  prev.items.map((item) =>
                    item.id === editSinglePayment.id
                      ? {
                          ...item,
                          title: cleanTitle,
                          description: cleanDesc,
                          due_date: finalIsoDueDate,
                          ...(cleanPaymentId ? { razorpay_payment_id: cleanPaymentId } : {}),
                        }
                      : item
                  )
                )
              : null
          );
        }
        logAdminAction({
          adminEmail: userEmail || 'admin',
          action: 'EDIT_INVOICE_SINGLE',
          targetEmail: editSinglePayment.user_email,
          details: `Updated invoice "${cleanTitle}" for ${editSinglePayment.user_email}`,
        });
        showToast('Member invoice updated successfully! ✏️', 'success');
        setEditSinglePayment(null);
      } else {
        showToast('Failed to update invoice.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error updating invoice', 'error');
    } finally {
      setSavingSingleEdit(false);
    }
  };

  // Delete payment or entire campaign (Admin function - Non-blocking)
  const handleConfirmDelete = async () => {
    if (!deleteTarget || !isAdminState) return;

    setDeletingInProgress(true);
    try {
      if (deleteTarget.type === 'campaign') {
        const itemIds = deleteTarget.itemIds;
        // 1. Optimistically update local state immediately
        setPayments((prev) =>
          prev.filter((p) => !itemIds.includes(p.id) && p.title.trim() !== deleteTarget.title.trim())
        );
        if (activeRosterCampaign && activeRosterCampaign.title.trim() === deleteTarget.title.trim()) {
          setActiveRosterCampaign(null);
        }
        if (editCampaignGroup && editCampaignGroup.title.trim() === deleteTarget.title.trim()) {
          setEditCampaignGroup(null);
        }

        // 2. Perform fast Firestore batch delete
        const ok = await batchDeleteCampaignFromFirestore(itemIds);
        logAdminAction({
          adminEmail: userEmail || 'admin',
          action: 'DELETE',
          details: `Deleted campaign "${deleteTarget.title}" (${itemIds.length} records)`,
        });
        showToast(
          ok
            ? `Campaign "${deleteTarget.title}" deleted from database! 🗑️`
            : `Campaign removed from current view.`,
          'info'
        );
      } else {
        // Single payment record deletion
        const paymentId = deleteTarget.itemIds[0];
        setPayments((prev) => prev.filter((p) => p.id !== paymentId));
        if (activeRosterCampaign) {
          setActiveRosterCampaign((prev) =>
            prev ? recalculateCampaignGroup(prev, prev.items.filter((item) => item.id !== paymentId)) : null
          );
        }
        if (editCampaignGroup) {
          setEditCampaignGroup((prev) =>
            prev ? recalculateCampaignGroup(prev, prev.items.filter((item) => item.id !== paymentId)) : null
          );
        }

        const ok = await deletePaymentFromFirestore(paymentId);
        logAdminAction({
          adminEmail: userEmail || 'admin',
          action: 'DELETE',
          details: `Deleted payment due record #${paymentId.slice(0, 8)}`,
        });
        showToast(
          ok
            ? 'Payment record deleted from database successfully.'
            : 'Payment removed from current view.',
          'info'
        );
      }
    } catch (err: any) {
      console.error('Delete operation error:', err);
      showToast(err.message || 'Error deleting invoice', 'error');
    } finally {
      setDeletingInProgress(false);
      setDeleteTarget(null);
    }
  };

  // Export CSV helper
  const handleExportCSV = (campaignTitle?: string, paidOnly: boolean = false, statusFilter?: string) => {
    let exportItems = payments;

    if (campaignTitle) {
      exportItems = exportItems.filter((p) => p.title.toLowerCase() === campaignTitle.toLowerCase());
    }

    if (statusFilter && statusFilter !== 'All') {
      exportItems = exportItems.filter((p) => {
        const isExp = (isInvoiceExpired(p) || p.status === 'Expired') && p.status !== 'Paid';
        if (statusFilter === 'Unpaid') return (p.status === 'Pending' || p.status === 'Failed' || p.status === 'Processing') && !isExp;
        if (statusFilter === 'Paid') return p.status === 'Paid';
        if (statusFilter === 'Expired') return isExp;
        if (statusFilter === 'Pending') return p.status === 'Pending' && !isExp;
        if (statusFilter === 'Processing') return p.status === 'Processing' && !isExp;
        if (statusFilter === 'Failed') return p.status === 'Failed' && !isExp;
        return true;
      });
    } else if (paidOnly) {
      exportItems = exportItems.filter((p) => p.status === 'Paid');
    }

    if (exportItems.length === 0) {
      const tag = statusFilter && statusFilter !== 'All' ? `${statusFilter} ` : paidOnly ? 'Paid ' : '';
      showToast(`No ${tag.toLowerCase()}payment records to export for this filter.`, 'info');
      return;
    }

    const headers = [
      'Member Name',
      'Regn Number',
      'Team',
      'Payer Email',
      'Payment Title',
      'Category',
      'Amount (INR)',
      'Status',
      'Paid At',
      'Razorpay Payment ID',
      'Razorpay Order ID',
      'Created Date',
    ];

    const rows = exportItems.map((p) => {
      const email = p.user_email ? p.user_email.toLowerCase() : '';
      const member = membersMap.get(email);
      const name = member ? member.name : 'Unknown Member';
      const regNo = member ? member.regNo : '';
      const team = member ? member.team : '';
      const isExp = isInvoiceExpired(p);
      const displayStatus = isExp ? 'Expired' : p.status;

      return [
        `"${name.replace(/"/g, '""')}"`,
        `"${regNo}"`,
        `"${team}"`,
        `"${email}"`,
        `"${(p.title || '').replace(/"/g, '""')}"`,
        `"${p.category || ''}"`,
        p.amount,
        `"${displayStatus}"`,
        `"${p.paid_at ? new Date(p.paid_at).toLocaleString('en-IN') : ''}"`,
        `"${p.razorpay_payment_id || ''}"`,
        `"${p.razorpay_order_id || ''}"`,
        `"${p.created_at ? new Date(p.created_at).toLocaleString('en-IN') : ''}"`,
      ];
    });

    const csvString = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const cleanTitle = (campaignTitle || 'All_Payments').replace(/[^a-zA-Z0-9]/g, '_');
    const exportTag = statusFilter && statusFilter !== 'All' 
      ? statusFilter 
      : paidOnly 
        ? 'PaidOnly' 
        : 'FullReport';
    link.setAttribute('download', `VRGC_${cleanTitle}_${exportTag}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Exported ${exportTag} CSV report with ${exportItems.length} records! 📊`, 'success');
  };

  // Razorpay Checkout Handler
  const handlePayNow = async (payment: PaymentItem) => {
    if (isInvoiceExpired(payment)) {
      showToast('This invoice has expired (payment deadline has passed) and can no longer be paid.', 'error');
      setProcessingId(null);
      return;
    }

    setProcessingId(payment.id);

    try {
      const isSdkLoaded = await loadRazorpayScript();
      if (!isSdkLoaded) {
        showToast('Failed to load Razorpay Checkout SDK. Check internet connection.', 'error');
        setProcessingId(null);
        return;
      }

      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency || 'INR',
          title: payment.title,
          userEmail: userEmail || payment.user_email || '',
        }),
      });

      const orderData = await res.json();

      if (!res.ok || !orderData.success) {
        throw new Error(orderData.error || 'Failed to create Razorpay order.');
      }

      const nowIso = new Date().toISOString();
      setPayments((prev) =>
        prev.map((item) => (item.id === payment.id ? { ...item, status: 'Processing', updated_at: nowIso } : item))
      );

      // Persist Processing status directly into Firestore
      await updatePaymentStatusInFirestore(payment.id, {
        status: 'Processing',
        razorpay_order_id: orderData.order_id,
      });

      let razorpayKey = orderData.key_id;
      if (!razorpayKey) {
        try {
          const keyRes = await fetch('/api/get-razorpay-key');
          if (keyRes.ok) {
            const keyJson = await keyRes.json();
            razorpayKey = keyJson.keyId;
          }
        } catch (err) {
          console.error('Failed to fetch Razorpay key:', err);
        }
      }

      const targetMember = membersMap.get((payment.user_email || userEmail || '').toLowerCase());
      const candidateName = payment.candidate_name || targetMember?.name || currentUser?.displayName || '';
      const regNo = payment.registration_number || targetMember?.regNo || '';
      const candidateTeam = payment.team || targetMember?.team || '';

      const options = {
        key: razorpayKey,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'VRGC Platform',
        description: payment.title,
        order_id: orderData.order_id,
        image: '/icon.svg',
        prefill: {
          name: candidateName || 'VRGC Crew Member',
          email: userEmail || payment.user_email || 'member@vrgc.club',
        },
        theme: {
          color: '#a855f7',
        },
        modal: {
          ondismiss: async () => {
            setProcessingId(null);
            setPayments((prev) =>
              prev.map((item) => (item.id === payment.id ? { ...item, status: 'Failed' } : item))
            );
            // Log payment cancellation to Firestore as a Failed attempt with reattempt opportunity
            await saveTransactionToFirestore({
              payment_id: payment.id,
              user_email: userEmail || payment.user_email || '',
              candidate_name: candidateName,
              registration_number: regNo,
              team: candidateTeam,
              payment_title: payment.title,
              amount: payment.amount,
              currency: payment.currency || 'INR',
              status: 'Failed',
              razorpay_order_id: orderData.order_id,
              error_description: 'Payment gateway closed / cancelled by candidate (click Re-attempt to try again)',
            });
            showToast('Payment window closed or cancelled. Click "Re-attempt Payment" to try again.', 'info');
          },
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const authHeaders = await getAuthHeaders();
            const verifyRes = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...authHeaders,
              },
              body: JSON.stringify({
                paymentId: payment.id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                userEmail: userEmail || payment.user_email || '',
                paymentTitle: payment.title,
                amount: payment.amount,
                currency: payment.currency || 'INR',
              }),
            });

            const verifyData = await verifyRes.json();

            if (verifyRes.ok && verifyData.success) {
              const updatedItem: PaymentItem = {
                ...payment,
                status: 'Paid',
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };

              setPayments((prev) =>
                prev.map((item) => (item.id === payment.id ? updatedItem : item))
              );

              // Save transaction log & update payment status in Firestore
              await saveTransactionToFirestore({
                payment_id: payment.id,
                user_email: payment.user_email || userEmail,
                candidate_name: candidateName,
                registration_number: regNo,
                team: candidateTeam,
                payment_title: payment.title,
                amount: payment.amount,
                currency: payment.currency || 'INR',
                status: 'Paid',
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
                paid_at: updatedItem.paid_at!,
              });

              showToast('Payment Successful 🎉 Your payment has been confirmed successfully.', 'success');
              setReceiptModalPayment(updatedItem);
            } else {
              setPayments((prev) =>
                prev.map((item) => (item.id === payment.id ? { ...item, status: 'Failed' } : item))
              );
              // Log failed transaction to Firestore
              await saveTransactionToFirestore({
                payment_id: payment.id,
                user_email: userEmail || payment.user_email || '',
                candidate_name: candidateName,
                registration_number: regNo,
                team: candidateTeam,
                payment_title: payment.title,
                amount: payment.amount,
                currency: payment.currency || 'INR',
                status: 'Failed',
                error_description: verifyData.error || 'Verification failed',
              });
              showToast(verifyData.error || 'Payment verification failed. You can re-attempt.', 'error');
            }
          } catch (err: any) {
            console.error('Verification error:', err);
            setPayments((prev) =>
              prev.map((item) => (item.id === payment.id ? { ...item, status: 'Failed' } : item))
            );
            await saveTransactionToFirestore({
              payment_id: payment.id,
              user_email: userEmail || payment.user_email || '',
              candidate_name: candidateName,
              registration_number: regNo,
              team: candidateTeam,
              payment_title: payment.title,
              amount: payment.amount,
              currency: payment.currency || 'INR',
              status: 'Failed',
              error_description: err?.message || 'Exception during verification',
            });
            showToast('Verification failed. You can re-attempt payment.', 'error');
          } finally {
            setProcessingId(null);
          }
        },
      };

      const razorpayInstance = new (window as any).Razorpay(options);
      razorpayInstance.on('payment.failed', async (resp: any) => {
        console.error('Razorpay payment failed:', resp.error);
        setProcessingId(null);
        setPayments((prev) =>
          prev.map((item) => (item.id === payment.id ? { ...item, status: 'Failed' } : item))
        );
        // Log failed transaction to Firestore
        await saveTransactionToFirestore({
          payment_id: payment.id,
          user_email: userEmail || payment.user_email || '',
          candidate_name: candidateName,
          registration_number: regNo,
          team: candidateTeam,
          payment_title: payment.title,
          amount: payment.amount,
          currency: payment.currency || 'INR',
          status: 'Failed',
          razorpay_order_id: resp.error?.metadata?.order_id,
          razorpay_payment_id: resp.error?.metadata?.payment_id,
          error_description: resp.error?.description || 'Transaction declined or failed',
        });
        showToast(`Payment Failed: ${resp.error?.description || 'Transaction declined'}. Click "Re-attempt Payment" to try again.`, 'error');
      });

      razorpayInstance.open();
    } catch (error: any) {
      console.error('Payment initialization error:', error);
      setProcessingId(null);
      setPayments((prev) =>
        prev.map((item) => (item.id === payment.id ? { ...item, status: 'Failed' } : item))
      );
      saveTransactionToFirestore({
        payment_id: payment.id,
        user_email: userEmail || payment.user_email || '',
        payment_title: payment.title,
        amount: payment.amount,
        currency: payment.currency || 'INR',
        status: 'Failed',
        error_description: error.message || 'Payment initialization error',
      });
      showToast(error.message || 'Payment Failed. You can re-attempt.', 'error');
    }
  };

  // Group Payments by Campaign Title for Admin & Faculty View
  const campaignGroups = useMemo<CampaignGroup[]>(() => {
    if ((!isAdminState || !adminViewAll) && !isFacultyState) return [];

    const map = new Map<string, PaymentItem[]>();

    payments.forEach((p) => {
      const key = `${p.title.trim()}__${p.amount}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(p);
    });

    const groups: CampaignGroup[] = [];

    map.forEach((items, key) => {
      const first = items[0];
      const title = first.title;
      const category = first.category;
      const amount = Number(first.amount);
      const currency = first.currency || 'INR';
      const due_date = first.due_date;

      const totalAssigned = items.length;
      const paidCount = items.filter((i) => i.status === 'Paid').length;
      const pendingCount = items.filter((i) => i.status === 'Pending' || i.status === 'Processing').length;
      const failedCount = items.filter((i) => i.status === 'Failed').length;
      const totalCollected = paidCount * amount;
      const totalTarget = totalAssigned * amount;
      const percentage = totalTarget > 0 ? Math.round((totalCollected / totalTarget) * 100) : 0;

      // Filter by category or search query if applicable
      const matchesCategory =
        selectedCategory === 'All' || category.toLowerCase() === selectedCategory.toLowerCase();
      const matchesStatus =
        selectedStatus === 'All' ||
        (selectedStatus === 'Paid' && items.some((i) => i.status === 'Paid')) ||
        (selectedStatus === 'Pending' && items.some((i) => (i.status === 'Pending' || !i.status) && !isInvoiceExpired(i))) ||
        (selectedStatus === 'Processing' && items.some((i) => i.status === 'Processing' && !isInvoiceExpired(i))) ||
        (selectedStatus === 'Failed' && items.some((i) => i.status === 'Failed' && !isInvoiceExpired(i))) ||
        (selectedStatus === 'Expired' && items.some((i) => isInvoiceExpired(i) && i.status !== 'Paid'));
      const matchesSearch =
        !searchQuery.trim() ||
        title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        items.some(
          (i) => i.user_email && i.user_email.toLowerCase().includes(searchQuery.toLowerCase())
        );

      if (matchesCategory && matchesStatus && matchesSearch) {
        groups.push({
          key,
          title,
          category,
          amount,
          currency,
          due_date,
          totalAssigned,
          paidCount,
          pendingCount,
          failedCount,
          totalCollected,
          totalTarget,
          percentage,
          items,
        });
      }
    });

    return groups.sort((a, b) => b.totalAssigned - a.totalAssigned);
  }, [payments, isAdminState, adminViewAll, isFacultyState, selectedCategory, selectedStatus, searchQuery]);

  // Statistics calculation
  const stats = useMemo(() => {
    const totalPending = payments
      .filter((p) => p.status !== 'Paid')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const totalPaid = payments
      .filter((p) => p.status === 'Paid')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const pendingCount = payments.filter((p) => (p.status === 'Pending' || p.status === 'Processing' || !p.status) && !isInvoiceExpired(p)).length;
    const failedCount = payments.filter((p) => p.status === 'Failed' && !isInvoiceExpired(p)).length;
    const expiredCount = payments.filter((p) => isInvoiceExpired(p) && p.status !== 'Paid').length;
    const paidCount = payments.filter((p) => p.status === 'Paid').length;
    return { totalPending, totalPaid, pendingCount, failedCount, expiredCount, paidCount, total: payments.length };
  }, [payments]);

  // Filtered items for the Active Campaign Roster modal
  const filteredRosterItems = useMemo(() => {
    if (!activeRosterCampaign) return [];
    return activeRosterCampaign.items.filter((item) => {
      const email = item.user_email ? item.user_email.toLowerCase() : '';
      const member = membersMap.get(email);
      const name = member ? member.name : '';
      const regNo = member ? member.regNo : '';

      const matchesSearch =
        !rosterSearch.trim() ||
        name.toLowerCase().includes(rosterSearch.toLowerCase()) ||
        regNo.toLowerCase().includes(rosterSearch.toLowerCase()) ||
        email.includes(rosterSearch.toLowerCase());

      const isExp = (isInvoiceExpired(item) || item.status === 'Expired') && item.status !== 'Paid';
      const matchesStatus =
        rosterStatusFilter === 'All' ||
        (rosterStatusFilter === 'Unpaid' && (item.status === 'Pending' || item.status === 'Failed' || item.status === 'Processing') && !isExp) ||
        (rosterStatusFilter === 'Paid' && item.status === 'Paid') ||
        (rosterStatusFilter === 'Expired' && isExp) ||
        (rosterStatusFilter === 'Pending' && (item.status === 'Pending' || !item.status) && !isExp) ||
        (rosterStatusFilter === 'Processing' && item.status === 'Processing' && !isExp) ||
        (rosterStatusFilter === 'Failed' && item.status === 'Failed' && !isExp);

      return matchesSearch && matchesStatus;
    });
  }, [activeRosterCampaign, rosterSearch, rosterStatusFilter, membersMap]);

  // Helper badge generator
  const renderStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'Pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            🟡 Pending
          </span>
        );
      case 'Processing':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
            🔵 Processing
          </span>
        );
      case 'Paid':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            🟢 Paid
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <AlertCircle className="w-3.5 h-3.5" />
            🔴 Failed
          </span>
        );
      case 'Cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-500/10 text-slate-400 border border-slate-500/30">
            ⚪ Cancelled
          </span>
        );
      case 'Expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <AlertCircle className="w-3.5 h-3.5" />
            🔴 Expired
          </span>
        );
      default:
        return null;
    }
  };

  // Interactive SuperAdmin Status Selector (Desktop + Mobile Responsive)
  const renderAdminStatusSelect = (item: PaymentItem) => {
    if (!isAdminState) {
      return renderStatusBadge(isInvoiceExpired(item) || item.status === 'Expired' ? 'Expired' : paymentStatusToString(item.status));
    }

    const isUpdating = updatingManualStatusId === item.id;
    const expired = (isInvoiceExpired(item) || item.status === 'Expired') && item.status !== 'Paid';
    const effectiveStatus: PaymentStatus =
      item.status === 'Paid'
        ? 'Paid'
        : expired
        ? 'Expired'
        : item.status || 'Pending';

    return (
      <div className="relative inline-flex items-center">
        <select
          value={effectiveStatus}
          disabled={isUpdating}
          onChange={(e) => handleManualStatusChange(item, e.target.value as PaymentStatus)}
          className={`appearance-none cursor-pointer pl-2.5 pr-6 py-1 rounded-full text-[10px] sm:text-xs font-bold border transition-all focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50 select-none ${
            effectiveStatus === 'Paid'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25'
              : effectiveStatus === 'Processing'
              ? 'bg-blue-500/15 border-blue-500/40 text-blue-400 hover:bg-blue-500/25'
              : effectiveStatus === 'Failed'
              ? 'bg-rose-500/15 border-rose-500/40 text-rose-400 hover:bg-rose-500/25'
              : effectiveStatus === 'Expired'
              ? 'bg-rose-500/15 border-rose-500/40 text-rose-400 hover:bg-rose-500/25'
              : 'bg-amber-500/15 border-amber-500/40 text-amber-400 hover:bg-amber-500/25'
          }`}
          title="SuperAdmin: Click to manually change status"
        >
          <option value="Paid" className="bg-[#180a2b] text-emerald-400">🟢 Paid</option>
          <option value="Pending" className="bg-[#180a2b] text-amber-400">🟡 Pending</option>
          <option value="Processing" className="bg-[#180a2b] text-blue-400">🔵 Processing</option>
          <option value="Failed" className="bg-[#180a2b] text-rose-400">🔴 Failed</option>
          <option value="Expired" className="bg-[#180a2b] text-rose-400">🔴 Expired</option>
        </select>
        {isUpdating ? (
          <RotateCcw className="w-3 h-3 text-purple-400 animate-spin absolute right-1.5 pointer-events-none" />
        ) : (
          <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 pointer-events-none" />
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 text-[#e2e8f0]">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-20 right-4 md:right-8 z-[100] px-6 py-4 rounded-xl backdrop-blur-xl border shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-5 duration-200 ${toastMessage.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200 shadow-[0_0_30px_rgba(16,185,129,0.3)]'
              : toastMessage.type === 'error'
                ? 'bg-rose-950/90 border-rose-500/50 text-rose-200 shadow-[0_0_30px_rgba(244,63,94,0.3)]'
                : 'bg-purple-950/90 border-purple-500/50 text-purple-200 shadow-[0_0_30px_rgba(168,85,247,0.3)]'
            }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          ) : toastMessage.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-purple-400 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold">{toastMessage.text}</span>
        </div>
      )}

      {/* Top Banner & Header — Minimal Admin Panel */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0e0518] border border-purple-500/20 p-4 sm:p-5 shadow-lg">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Left: title + status */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-extrabold text-white tracking-tight">Payments &amp; Dues</h1>
                {isAdminState && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    <ShieldAlert className="w-3 h-3" /> ADMIN
                  </span>
                )}
                {isFacultyState && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    <span className="material-symbols-outlined text-[12px]">school</span> FACULTY VIEW (READ-ONLY)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                {isFacultyState ? 'Official Club Financial Ledger' : (userEmail || 'Guest')} •{' '}
                <span className="text-emerald-400 font-semibold">Razorpay Secured</span>
              </p>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full md:w-auto">
            {onRedirect && (
              <button
                onClick={onRedirect}
                className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-400 transition-all flex items-center justify-center gap-1.5"
              >
                ← Dashboard
              </button>
            )}
            {isFacultyState && (
              <>
                <button
                  onClick={() => handleExportCSV(undefined, true)}
                  className="px-2.5 py-2 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border border-emerald-500/30 text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 whitespace-nowrap"
                  title="Export Paid Records CSV"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                  <span>Paid CSV</span>
                </button>
                <button
                  onClick={() => handleExportCSV(undefined, false)}
                  className="px-2.5 py-2 rounded-lg bg-purple-600/15 hover:bg-purple-600/25 text-purple-300 border border-purple-500/30 text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 whitespace-nowrap"
                  title="Export Full Ledger CSV"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Full Ledger CSV</span>
                </button>
              </>
            )}
            {isAdminState && (
              <>
                <button
                  onClick={() => setAdminViewAll((prev) => !prev)}
                  className={`px-2.5 py-2 rounded-lg border text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${!adminViewAll
                      ? 'bg-purple-600 border-purple-400 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                      : 'bg-purple-600/15 hover:bg-purple-600/25 text-purple-300 border border-purple-500/30'
                    }`}
                  title="Toggle between Campaign Management & My Personal Dues"
                >
                  <CreditCard className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{!adminViewAll ? '📊 All Campaigns' : '💳 Personal Dues'}</span>
                </button>
                <button
                  onClick={() => setShowLogsPanel((v) => !v)}
                  className={`px-2.5 py-2 rounded-lg border text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${showLogsPanel
                      ? 'bg-blue-600/30 border-blue-500/50 text-blue-200'
                      : 'bg-blue-600/10 hover:bg-blue-600/20 text-blue-300 border border-blue-500/30'
                    }`}
                >
                  <Receipt className="w-3.5 h-3.5 shrink-0" />
                  <span>Tx Logs</span>
                </button>
                <button
                  onClick={() => handleExportCSV(undefined, true)}
                  className="px-2.5 py-2 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border border-emerald-500/30 text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={async () => {
                    showToast('Syncing all payment records with Razorpay API...', 'info');
                    try {
                      const res = await syncPaymentStatusWithRazorpay(undefined, undefined, true);
                      if (res.success && res.correctedCount && res.correctedCount > 0) {
                        showToast(`Razorpay Sync Complete! Updated ${res.correctedCount} record(s) with authentic Razorpay details. 🎉`, 'success');
                      } else {
                        showToast('Razorpay Sync complete. All records are up to date.', 'info');
                      }
                      await loadPayments(userEmail, (isAdminState && adminViewAll) || isFacultyState);
                    } catch (err: any) {
                      showToast(err?.message || 'Error syncing with Razorpay', 'error');
                    }
                  }}
                  className="px-2.5 py-2 rounded-lg bg-purple-600/20 hover:bg-purple-600/35 text-purple-300 border border-purple-500/40 text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 shadow-[0_0_15px_rgba(168,85,247,0.2)] whitespace-nowrap"
                  title="Sync and verify all payment statuses with Razorpay API"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span>Sync Razorpay</span>
                </button>
                {/* Initiate Payment Controls — STRICTLY FOR Payment Admins */}
                {canInitiatePayments && (
                  <>
                    <button
                      onClick={() => setShowMultiMemberModal(true)}
                      className="px-2.5 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 shadow-[0_0_15px_rgba(99,102,241,0.2)] whitespace-nowrap"
                    >
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>Specific Persons</span>
                    </button>
                    <button
                      onClick={() => setShowAssignAllModal(true)}
                      className="px-2.5 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 whitespace-nowrap"
                    >
                      <Megaphone className="w-3.5 h-3.5 shrink-0" />
                      <span>All Members</span>
                    </button>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="col-span-2 sm:col-span-1 px-2.5 py-2 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 shadow-[0_0_15px_rgba(168,85,247,0.3)] whitespace-nowrap"
                    >
                      <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Assign Due</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Summary Statistics — Visible to Payment Admins & Faculty */}
      {(canInitiatePayments || isFacultyState) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 sm:p-5 rounded-2xl bg-[#0e0518]/90 border border-purple-500/20 backdrop-blur-md shadow-lg flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>PENDING DUES</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl md:text-3xl font-black text-amber-300">
              ₹{stats.totalPending.toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-amber-400/80 font-medium">
              {stats.pendingCount} Pending &amp; {stats.failedCount} Failed
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-[#0e0518]/90 border border-emerald-500/20 backdrop-blur-md shadow-lg flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>TOTAL COLLECTED</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl sm:text-2xl md:text-3xl font-black text-emerald-300">
              ₹{stats.totalPaid.toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-emerald-400/80 font-medium">
              {stats.paidCount} confirmed transaction{stats.paidCount !== 1 ? 's' : ''}
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-[#0e0518]/90 border border-purple-500/20 backdrop-blur-md shadow-lg flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>{isFacultyState ? 'AUTHORIZED INVOICES' : 'REGISTERED CREW'}</span>
              <Users className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-xl sm:text-2xl md:text-3xl font-black text-purple-300">
              {isFacultyState ? `${campaignGroups.length} Campaign${campaignGroups.length !== 1 ? 's' : ''}` : `${membersList.length} Members`}
            </div>
            <div className="text-[11px] text-slate-400 font-medium">
              {isFacultyState ? `${payments.length} Assigned records visible` : 'Active club directory'}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-[#0e0518]/90 border border-purple-500/20 backdrop-blur-md shadow-lg flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>GATEWAY STATUS</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-emerald-400 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              Razorpay Live
            </div>
            <div className="text-[11px] text-emerald-400/70 font-semibold">
              Payments Secured
            </div>
          </div>
        </div>
      )}

      {/* Transaction Logs Panel (Admin Only) */}
      {isAdminState && showLogsPanel && (
        <div className="rounded-2xl bg-[#0e0518]/90 border border-blue-500/30 backdrop-blur-md shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-blue-500/20 bg-blue-950/30">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-bold text-white">Transaction Logs</h2>
              <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">LIVE</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{transactionLogs.length} records</span>
              <button
                onClick={loadTransactionLogs}
                className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-all"
                title="Refresh logs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-8 gap-3 text-blue-400">
              <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
              <span className="text-xs font-semibold">Loading transaction logs...</span>
            </div>
          ) : transactionLogs.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-400">No transactions recorded yet.</p>
              <p className="text-xs text-slate-500 mt-1">Transaction logs will appear here after payments are processed.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 custom-scrollbar">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#0e0518]/95 border-b border-blue-500/10">
                  <tr className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Member</th>
                    <th className="px-4 py-2 text-left">Payment</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-left">Razorpay ID</th>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTransactionLogs.map((log) => (
                    <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5">
                        {log.status === 'Paid' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" />Paid
                          </span>
                        ) : log.status === 'Failed' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <AlertCircle className="w-3 h-3" />Failed
                          </span>
                        ) : log.status === 'Processing' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <Clock className="w-3 h-3" />Processing
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <Clock className="w-3 h-3" />Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-300 font-mono">{log.user_email}</td>
                      <td className="px-4 py-2.5 text-slate-200 max-w-[160px] truncate">{log.payment_title}</td>
                      <td className="px-4 py-2.5 text-right text-white font-bold">₹{Number(log.amount).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 text-slate-400 font-mono text-[10px]">
                        {log.razorpay_payment_id ? (
                          <span title={log.razorpay_payment_id}>{log.razorpay_payment_id.slice(-8)}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
                        {new Date(getLogEventTimestamp(log)).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-2.5 text-rose-400/80 text-[10px] max-w-[120px] truncate" title={log.error_description}>
                        {log.error_description || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Toolbar: Category & Status Dropdown Filters & Search */}
      <div className="p-4 rounded-2xl bg-[#0e0518]/80 border border-purple-500/20 backdrop-blur-md flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center justify-between">
        {/* Search Input */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search payment title, category or member..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-all"
          />
        </div>

        {/* Dropdown Filters Container */}
        <div className="grid grid-cols-2 sm:flex items-center gap-2.5 w-full sm:w-auto">
          {/* Category Dropdown Filter */}
          <div className="relative flex-1 sm:w-44">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full appearance-none pl-3 pr-8 py-2.5 rounded-xl bg-black/50 border border-purple-500/30 text-xs font-bold text-white focus:outline-none focus:border-purple-400 transition-all cursor-pointer"
            >
              <option value="All" className="bg-[#0e0518] text-white">Category: All</option>
              <option value="Club Fee" className="bg-[#0e0518] text-white">Club Fee</option>
              <option value="Event Registration" className="bg-[#0e0518] text-white">Event Registration</option>
              <option value="Merchandise" className="bg-[#0e0518] text-white">Merchandise</option>
              <option value="Fine" className="bg-[#0e0518] text-white">Fine</option>
            </select>
            <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-purple-400 pointer-events-none" />
          </div>

          {/* Status Dropdown Filter */}
          <div className="relative flex-1 sm:w-40">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full appearance-none pl-3 pr-8 py-2.5 rounded-xl bg-black/50 border border-purple-500/30 text-xs font-bold text-white focus:outline-none focus:border-purple-400 transition-all cursor-pointer"
            >
              <option value="All" className="bg-[#0e0518] text-white">Status: All</option>
              <option value="Pending" className="bg-[#0e0518] text-amber-400">Pending</option>
              <option value="Processing" className="bg-[#0e0518] text-blue-400">Processing</option>
              <option value="Paid" className="bg-[#0e0518] text-emerald-400">Paid</option>
              <option value="Failed" className="bg-[#0e0518] text-rose-400">Failed</option>
              <option value="Expired" className="bg-[#0e0518] text-rose-400">Expired</option>
            </select>
            <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-purple-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Admin Action Required: Pending Personal Invoice Alert Banner */}
      {isAdminState && personalPendingDues.length > 0 && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-purple-900/30 to-fuchsia-900/20 border border-amber-500/40 shadow-[0_0_25px_rgba(245,158,11,0.15)] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 animate-in fade-in duration-300">
          <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 mt-0.5 sm:mt-0">
              <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] sm:text-xs font-bold text-amber-300 uppercase tracking-wider">Action Required</span>
                <span className="px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold bg-amber-500/20 text-amber-200 border border-amber-500/30">
                  {personalPendingDues.length} Pending Invoice{personalPendingDues.length > 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs sm:text-sm font-extrabold text-white mt-0.5 truncate">
                {personalPendingDues[0].title} — <span className="text-amber-300 font-mono">₹{personalPendingDues[0].amount} INR</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
            <button
              onClick={() => setAdminViewAll((prev) => !prev)}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all text-center justify-center"
            >
              {adminViewAll ? 'View My Dues' : 'View All'}
            </button>
            <button
              onClick={() => handlePayNow(personalPendingDues[0])}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-xs font-extrabold shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Pay Now (₹{personalPendingDues[0].amount})</span>
            </button>
          </div>
        </div>
      )}

      {/* MAIN VIEW: Admin Unified Campaign Cards vs Non-Admin Personal Dues */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="p-6 rounded-2xl bg-[#0e0518]/70 border border-purple-500/10 animate-pulse space-y-4"
            >
              <div className="flex justify-between items-center">
                <div className="h-6 w-1/3 bg-purple-500/20 rounded-lg" />
                <div className="h-6 w-20 bg-purple-500/20 rounded-full" />
              </div>
              <div className="h-4 w-2/3 bg-purple-500/10 rounded" />
              <div className="h-10 w-full bg-purple-500/20 rounded-xl" />
            </div>
          ))}
        </div>
      ) : (isAdminState && adminViewAll) || isFacultyState ? (
        /* ADMIN & FACULTY VIEW: Unified Payment Due Campaign Cards */
        campaignGroups.length === 0 ? (
          <div className="p-12 rounded-3xl bg-[#0e0518]/60 border border-purple-500/20 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto text-purple-400">
              <Layers className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white">No Payment Campaigns Found</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              {isFacultyState
                ? 'No faculty-authorized payment campaigns currently found in the system.'
                : 'No active payment campaigns exist. Click below to assign a payment due to all crew members.'}
            </p>
            {isAdminState && (
              <div className="pt-2 flex justify-center gap-3">
                <button
                  onClick={() => setShowAssignAllModal(true)}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-xs font-bold text-white shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all flex items-center gap-2"
                >
                  <Megaphone className="w-4 h-4" />
                  <span>Assign Due to ALL Members</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4">
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 shrink-0">
                <Layers className="w-5 h-5 text-purple-400" />
                <span>Active Payment Campaigns ({campaignGroups.length})</span>
              </h2>
              <span className="text-[11px] sm:text-xs text-slate-400 block sm:inline">
                Click Inspect Roster to view assigned members, paid status, and timestamps.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {campaignGroups.map((group) => (
                <motion.div
                  key={group.key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -2 }}
                  transition={{ duration: 0.2 }}
                  className="relative rounded-2xl overflow-hidden group cursor-default"
                >
                  {/* Glow border effect */}
                  <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${group.percentage >= 80 ? 'from-emerald-500/20 to-teal-500/10'
                      : group.percentage >= 40 ? 'from-purple-500/20 to-fuchsia-500/10'
                        : 'from-amber-500/20 to-orange-500/10'
                    }`} />
                  <div className="relative bg-[#0a0318] border border-white/[0.07] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">

                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className="text-[9px] font-bold tracking-widest text-purple-400/80 uppercase">{group.category}</span>
                          {isAdminState && (
                            group.items.some((i) => i.visible_to_faculty !== false) ? (
                              <span className="text-[8px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <Eye className="w-2.5 h-2.5 text-emerald-400" /> FACULTY: VISIBLE
                              </span>
                            ) : (
                              <span className="text-[8px] font-bold text-slate-400 bg-slate-500/15 border border-slate-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <EyeOff className="w-2.5 h-2.5 text-slate-500" /> FACULTY: HIDDEN
                              </span>
                            )
                          )}
                        </div>
                        <h3 className="text-sm font-extrabold text-white mt-0.5 truncate leading-tight">{group.title}</h3>
                        {group.due_date && (
                          <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-purple-400" />
                            Due {new Date(group.due_date).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xl font-black text-white">₹{group.amount.toLocaleString('en-IN')}</span>
                        {isAdminState && (
                          <>
                            <button
                              onClick={() => handleToggleCampaignFacultyVisibility(group)}
                              title={group.items.some((i) => i.visible_to_faculty !== false) ? "Visible to Faculty (Click to Hide)" : "Hidden from Faculty (Click to Make Visible)"}
                              className={`p-1.5 rounded-lg transition-all ${
                                group.items.some((i) => i.visible_to_faculty !== false)
                                  ? 'text-emerald-400 hover:bg-emerald-500/10'
                                  : 'text-slate-500 hover:bg-white/10'
                              }`}
                            >
                              {group.items.some((i) => i.visible_to_faculty !== false) ? (
                                <Eye className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => handleOpenEditCampaign(group)}
                              title="Edit Invoice Details & Visibility"
                              className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg transition-all"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setDeleteTarget({
                                  type: 'campaign',
                                  title: group.title,
                                  itemIds: group.items.map((item) => item.id),
                                  totalAssigned: group.totalAssigned,
                                });
                              }}
                              title="Delete campaign"
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-semibold text-slate-400">₹{group.totalCollected.toLocaleString('en-IN')} / ₹{group.totalTarget.toLocaleString('en-IN')}</span>
                        <span className={`text-[11px] font-extrabold tabular-nums ${group.percentage >= 80 ? 'text-emerald-400' : group.percentage >= 40 ? 'text-purple-300' : 'text-amber-400'
                          }`}>{group.percentage}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${group.percentage >= 80 ? 'bg-gradient-to-r from-emerald-400 to-teal-400'
                              : group.percentage >= 40 ? 'bg-gradient-to-r from-purple-500 to-fuchsia-400'
                                : 'bg-gradient-to-r from-amber-400 to-orange-400'
                            }`}
                          style={{ width: `${Math.min(group.percentage, 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-3 text-[10px] font-bold">
                      <span className="flex items-center gap-1 text-slate-400">
                        <Users className="w-3 h-3" />{group.totalAssigned} total
                      </span>
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />{group.paidCount} paid
                      </span>
                      <span className="flex items-center gap-1 text-amber-400">
                        <Clock className="w-3 h-3" />{group.pendingCount} pending
                      </span>
                      {group.failedCount > 0 && (
                        <span className="flex items-center gap-1 text-rose-400">
                          <AlertCircle className="w-3 h-3" />{group.failedCount} failed
                        </span>
                      )}
                    </div>

                    {/* Action footer */}
                    <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={() => handleExportCSV(group.title, true)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-[11px] font-bold transition-colors flex items-center gap-1.5"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        Paid CSV
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={() => setActiveRosterCampaign(group)}
                        className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Inspect Roster
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )
      ) : (
        /* REGULAR USER / NON-ADMIN VIEW: Personal Dues Cards */
        payments.length === 0 ? (
          <div className="p-12 rounded-3xl bg-[#0e0518]/60 border border-purple-500/20 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto text-purple-400">
              <CreditCard className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white">No Assigned Dues</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              You currently have no pending payment dues assigned to your account.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {payments.map((payment) => {
              const isExpired = isInvoiceExpired(payment);
              const isProcessing = (processingId === payment.id || payment.status === 'Processing') && payment.status !== 'Failed' && payment.status !== 'Paid' && !isExpired;
              const isPaid = payment.status === 'Paid';
              const isFailed = payment.status === 'Failed' && !isExpired;
              const effectiveStatus: PaymentStatus = isExpired ? 'Expired' : payment.status;
              const timeDetails = getInvoiceTimeDetails(payment);

              return (
                <motion.div
                  key={payment.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.2 }}
                  className="relative rounded-2xl overflow-hidden"
                >
                  {/* Ambient glow under the card */}
                  <div className={`absolute -inset-px rounded-2xl opacity-0 hover:opacity-100 transition-opacity duration-500 ${isPaid ? 'bg-gradient-to-br from-emerald-500/30 to-teal-500/0'
                      : isProcessing ? 'bg-gradient-to-br from-blue-500/30 to-cyan-500/0'
                        : isExpired || isFailed ? 'bg-gradient-to-br from-rose-500/30 to-rose-500/0'
                          : 'bg-gradient-to-br from-purple-500/30 to-fuchsia-500/0'
                    }`} />

                  <div className={`relative h-full bg-gradient-to-b from-[#0f0520] to-[#080211] border rounded-2xl flex flex-col overflow-hidden shadow-2xl ${isPaid ? 'border-emerald-500/25'
                      : isProcessing ? 'border-blue-500/30'
                        : isExpired || isFailed ? 'border-rose-500/25'
                          : 'border-purple-500/15 hover:border-purple-500/35'
                    } transition-colors duration-300`}>

                    {/* Card top accent bar */}
                    <div className={`h-0.5 w-full ${isPaid ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-transparent'
                        : isProcessing ? 'bg-gradient-to-r from-blue-500 via-cyan-400 to-transparent'
                          : isExpired || isFailed ? 'bg-gradient-to-r from-rose-500 via-rose-400 to-transparent'
                            : 'bg-gradient-to-r from-purple-600 via-fuchsia-500 to-transparent'
                      }`} />

                    <div className="p-5 flex flex-col gap-4 flex-1">

                      {/* Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <span className={`inline-block text-[9px] font-extrabold tracking-widest uppercase px-2 py-0.5 rounded mb-2 ${isPaid ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                              : isProcessing ? 'text-blue-400 bg-blue-500/10 border border-blue-500/20'
                                : isExpired ? 'text-rose-400 bg-rose-500/10 border border-rose-500/20'
                                  : 'text-purple-400 bg-purple-500/10 border border-purple-500/20'
                            }`}>
                            {payment.category}
                          </span>
                          <h3 className="text-base font-extrabold text-white leading-tight">{payment.title}</h3>
                          {renderDescriptionBox(payment.description)}
                        </div>
                        {renderStatusBadge(effectiveStatus)}
                      </div>

                      {/* Amount & Date block */}
                      <div className="bg-black/40 border border-white/[0.08] rounded-xl p-3.5 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[9px] font-bold tracking-widest text-slate-500 uppercase mb-0.5">{isPaid ? 'Amount Paid' : 'Amount Due'}</p>
                            <p className={`text-2xl font-black tracking-tight ${isPaid ? 'text-emerald-400' : 'text-white'
                              }`}>
                              ₹{Number(payment.amount).toLocaleString('en-IN')}
                              <span className="text-xs font-normal text-slate-500 ml-1">INR</span>
                            </p>
                          </div>
                        </div>

                        {/* Invoice Generated & Due Date Timestamps */}
                        <div className="pt-2 border-t border-white/[0.06] grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <span className="text-slate-500 block font-semibold uppercase tracking-wider text-[9px]">Invoice Generated</span>
                            <span className="text-slate-200 font-mono font-medium">{timeDetails.genTimeFormatted}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-purple-400/90 block font-semibold uppercase tracking-wider text-[9px]">Payment Due Date</span>
                            <span className="text-purple-200 font-mono font-medium">{timeDetails.dueDateFormatted}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action footer */}
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <span className="text-[10px] font-mono text-slate-600 truncate">#{payment.id.slice(0, 10)}</span>

                        {isPaid ? (
                          <motion.button
                            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                            onClick={() => setReceiptModalPayment(payment)}
                            className="px-4 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
                          >
                            <Receipt className="w-3.5 h-3.5" />
                            View Receipt
                          </motion.button>
                        ) : isExpired ? (
                          <button
                            disabled
                            className="px-4 py-2.5 rounded-xl font-bold text-xs bg-rose-500/10 border border-rose-500/30 text-rose-300 cursor-not-allowed opacity-80 flex items-center gap-1.5"
                          >
                            <AlertCircle className="w-4 h-4 text-rose-400" />
                            <span>Expired (Deadline Passed)</span>
                          </button>
                        ) : (
                          <motion.button
                            whileHover={!isProcessing ? { scale: 1.03 } : {}}
                            whileTap={!isProcessing ? { scale: 0.97 } : {}}
                            disabled={isProcessing}
                            onClick={() => handlePayNow(payment)}
                            className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${isProcessing
                                ? 'bg-blue-600/40 text-blue-200 cursor-wait border border-blue-500/20'
                                : 'bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white shadow-[0_0_25px_rgba(168,85,247,0.35)]'
                              }`}
                          >
                            {isProcessing ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>Processing...</span>
                              </>
                            ) : isFailed ? (
                              <>
                                <RotateCcw className="w-4 h-4 text-rose-300" />
                                <span>Re-attempt Payment (₹{Number(payment.amount).toLocaleString('en-IN')})</span>
                              </>
                            ) : (
                              <>
                                <CreditCard className="w-4 h-4" />
                                <span>Pay ₹{Number(payment.amount).toLocaleString('en-IN')}</span>
                              </>
                            )}
                          </motion.button>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

        )
      )}

      {/* ADMIN CAMPAIGN MEMBER ROSTER MODAL */}
      {activeRosterCampaign && (
        <div className="fixed inset-0 z-[130] bg-black/85 backdrop-blur-md flex items-center justify-center p-2.5 sm:p-4 md:p-6 animate-in fade-in duration-200">
          <div className="bg-[#0e0518] border border-purple-500/40 rounded-2xl sm:rounded-3xl max-w-5xl lg:max-w-6xl w-full p-4 sm:p-5 md:p-6 space-y-3.5 sm:space-y-4 md:space-y-5 shadow-[0_0_60px_rgba(168,85,247,0.3)] relative max-h-[92vh] flex flex-col mx-auto">
            {/* Modal Header */}
            <button
              onClick={() => setActiveRosterCampaign(null)}
              className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all z-10"
              title="Close Roster"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <div className="space-y-1 pr-10">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                <Layers className="w-3.5 h-3.5 text-purple-400" /> CAMPAIGN ROSTER &amp; COMPLIANCE
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-white leading-tight break-words">{activeRosterCampaign.title}</h3>
              <p className="text-[11px] sm:text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Category: <strong className="text-slate-200">{activeRosterCampaign.category}</strong></span>
                <span className="text-slate-600">•</span>
                <span>Amount: <strong className="text-white">₹{activeRosterCampaign.amount} INR</strong></span>
                <span className="text-slate-600">•</span>
                <span>Showing: <strong className="text-purple-300">{filteredRosterItems.length}</strong> of <strong className="text-slate-300">{activeRosterCampaign.items.length}</strong> members</span>
              </p>
            </div>

            {/* Roster Toolbar */}
            <div className="flex flex-col md:flex-row gap-2.5 sm:gap-3 items-stretch md:items-center justify-between bg-surface-container-lowest/60 p-2.5 sm:p-3 rounded-2xl border border-white/5">
              <div className="relative w-full md:max-w-xs flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter roster by member name, reg no or email..."
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-2.5 w-full md:w-auto">
                {/* Roster Status Dropdown Filter */}
                <div className="relative flex-1 sm:flex-initial sm:w-44 min-w-[130px]">
                  <select
                    value={rosterStatusFilter}
                    onChange={(e) => setRosterStatusFilter(e.target.value)}
                    className="w-full appearance-none pl-3 pr-8 py-2 rounded-xl bg-black/60 border border-purple-500/30 text-xs font-bold text-white focus:outline-none focus:border-purple-400 cursor-pointer"
                  >
                    <option value="All" className="bg-[#0e0518] text-white">Status: All</option>
                    <option value="Unpaid" className="bg-[#0e0518] text-amber-300">Status: Unpaid (Pending + Failed)</option>
                    <option value="Paid" className="bg-[#0e0518] text-emerald-400">Status: Paid</option>
                    <option value="Pending" className="bg-[#0e0518] text-amber-400">Status: Pending</option>
                    <option value="Processing" className="bg-[#0e0518] text-blue-400">Status: Processing</option>
                    <option value="Failed" className="bg-[#0e0518] text-rose-400">Status: Failed</option>
                    <option value="Expired" className="bg-[#0e0518] text-rose-400">Status: Expired</option>
                  </select>
                  <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-purple-400 pointer-events-none" />
                </div>

                {isAdminState && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAddMemberEmails([]);
                      setAddMembersSearch('');
                      setShowRosterAddMembersModal(true);
                    }}
                    className="flex-1 sm:flex-initial px-3 py-2 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-purple-300" />
                    <span>Add Members</span>
                  </button>
                )}

                {/* Sync with Razorpay Button in Roster Modal */}
                <button
                  type="button"
                  disabled={isSyncingRoster}
                  onClick={async () => {
                    setIsSyncingRoster(true);
                    showToast('Syncing payment records with Razorpay API...', 'info');
                    try {
                      const res = await syncPaymentStatusWithRazorpay(undefined, undefined, true);
                      if (res.success && res.correctedCount && res.correctedCount > 0) {
                        showToast(`Razorpay Sync Complete! Updated ${res.correctedCount} record(s) with authentic Razorpay details. 🎉`, 'success');
                      } else {
                        showToast('Razorpay Sync complete. All records are up to date.', 'info');
                      }
                      await loadPayments(userEmail, (isAdminState && adminViewAll) || isFacultyState);
                    } catch (err: any) {
                      showToast(err?.message || 'Failed to sync with Razorpay', 'error');
                    } finally {
                      setIsSyncingRoster(false);
                    }
                  }}
                  className="flex-1 sm:flex-initial px-3 py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/35 text-purple-300 border border-purple-500/40 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(168,85,247,0.2)] shrink-0 cursor-pointer disabled:opacity-50"
                  title="Sync and verify payment statuses directly with Razorpay"
                >
                  <RotateCcw className={`w-3.5 h-3.5 text-purple-400 ${isSyncingRoster ? 'animate-spin' : ''}`} />
                  <span>{isSyncingRoster ? 'Syncing...' : 'Sync Razorpay'}</span>
                </button>

                {/* Dynamic CSV Download Button based on current filter */}
                {(() => {
                  const filter = rosterStatusFilter || 'All';
                  let btnColorClass = 'bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border-purple-500/40';
                  let iconColorClass = 'text-purple-400';
                  let btnLabel = 'Download All CSV';

                  if (filter === 'Unpaid') {
                    btnColorClass = 'bg-amber-600/25 hover:bg-amber-600/35 text-amber-300 border-amber-500/50';
                    iconColorClass = 'text-amber-400';
                    btnLabel = 'Download Unpaid CSV';
                  } else if (filter === 'Paid') {
                    btnColorClass = 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/40';
                    iconColorClass = 'text-emerald-400';
                    btnLabel = 'Download Paid CSV';
                  } else if (filter === 'Pending') {
                    btnColorClass = 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-500/40';
                    iconColorClass = 'text-amber-400';
                    btnLabel = 'Download Pending CSV';
                  } else if (filter === 'Processing') {
                    btnColorClass = 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-500/40';
                    iconColorClass = 'text-blue-400';
                    btnLabel = 'Download Processing CSV';
                  } else if (filter === 'Failed') {
                    btnColorClass = 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border-rose-500/40';
                    iconColorClass = 'text-rose-400';
                    btnLabel = 'Download Failed CSV';
                  } else if (filter === 'Expired') {
                    btnColorClass = 'bg-slate-700/40 hover:bg-slate-700/60 text-slate-300 border-slate-500/40';
                    iconColorClass = 'text-slate-400';
                    btnLabel = 'Download Expired CSV';
                  }

                  return (
                    <button
                      onClick={() => handleExportCSV(activeRosterCampaign.title, false, filter)}
                      title={`Export ${btnLabel}`}
                      className={`flex-1 sm:flex-initial px-3 py-2 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer ${btnColorClass}`}
                    >
                      <FileSpreadsheet className={`w-3.5 h-3.5 ${iconColorClass}`} />
                      <span>{btnLabel}</span>
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* Roster List Section */}
            <div className="overflow-y-auto flex-1 custom-scrollbar min-h-0 pr-0.5">
              {filteredRosterItems.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs border border-white/5 rounded-2xl bg-white/[0.02]">
                  No members found matching the selected filter ({rosterStatusFilter}).
                </div>
              ) : (
                <>
                  {/* Mobile View: Cards */}
                  <div className="block md:hidden space-y-2.5 pr-0.5">
                    {filteredRosterItems.map((item) => {
                      const email = item.user_email ? item.user_email.toLowerCase() : '';
                      const member = membersMap.get(email);
                      const name = member ? member.name : 'Unknown Member';
                      const regNo = member ? member.regNo : 'N/A';

                      return (
                        <div key={item.id} className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <h4 className="font-bold text-xs text-white truncate" title={name}>{name}</h4>
                              <p className="text-[10px] text-purple-300 font-mono mt-0.5">{regNo}</p>
                              <p className="text-[10px] text-slate-400 font-mono truncate" title={email}>{email}</p>
                            </div>
                            <div className="shrink-0">
                              {renderAdminStatusSelect(item)}
                            </div>
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2.5 border-t border-white/5 text-[10px]">
                            <div className="font-mono min-w-0">
                              {item.status === 'Paid' && item.paid_at ? (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <button
                                    type="button"
                                    onClick={() => setReceiptModalPayment(item)}
                                    className="flex items-center gap-1.5 flex-wrap text-[10px] text-emerald-400 hover:underline cursor-pointer text-left"
                                    title="Click to view & download official receipt"
                                  >
                                    <Receipt className="w-3 h-3 text-emerald-400 shrink-0" />
                                    <span className="font-bold font-mono truncate max-w-[140px]" title={item.razorpay_payment_id || 'Paid'}>
                                      {item.razorpay_payment_id || 'Paid'}
                                    </span>
                                    <span className="text-[9px] text-slate-500 shrink-0">
                                      {new Date(item.paid_at).toLocaleDateString('en-IN')}
                                    </span>
                                  </button>
                                  {isAdminState && item.razorpay_payment_id?.startsWith('manual_') && (
                                    <button
                                      type="button"
                                      disabled={updatingManualStatusId === item.id}
                                      onClick={() => handleManualStatusChange(item, 'Paid')}
                                      className="p-1 rounded text-purple-300 hover:text-white bg-purple-500/20 hover:bg-purple-500/40 border border-purple-500/30 text-[9px] font-bold transition-all"
                                      title="Auto-verify with Razorpay to fetch real pay_... transaction ID"
                                    >
                                      <RotateCcw className={`w-3 h-3 ${updatingManualStatusId === item.id ? 'animate-spin' : ''}`} />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-amber-400 font-bold">Unpaid</span>
                              )}
                            </div>
                            <div className="flex items-center justify-end gap-1.5 shrink-0 flex-wrap">
                              {isAdminState && (
                                <button
                                  onClick={() => handleOpenEditSingle(item)}
                                  className="px-2 py-1 text-purple-300 hover:bg-purple-500/10 rounded-lg flex items-center gap-1 font-bold text-[10px] transition-colors"
                                >
                                  <Pencil className="w-3 h-3" /> Edit
                                </button>
                              )}
                              <button
                                onClick={() => handleOpenAuditModal(item)}
                                className="px-2 py-1 text-amber-400 hover:bg-amber-500/10 rounded-lg flex items-center gap-1 font-bold text-[10px] transition-colors"
                              >
                                <FileText className="w-3 h-3" /> Audit Logs
                              </button>
                              {isAdminState && (
                                <button
                                  onClick={() =>
                                    setDeleteTarget({
                                      type: 'single',
                                      title: item.title,
                                      itemIds: [item.id],
                                      memberName: name || item.user_email,
                                      isPaid: item.status === 'Paid',
                                      amount: item.amount,
                                    })
                                  }
                                  title="Delete record"
                                  className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop View: Table */}
                  <div className="hidden md:block border border-white/10 rounded-2xl overflow-x-auto custom-scrollbar bg-[#0a0314]/50">
                    <table className="w-full text-left text-xs min-w-[760px]">
                      <thead className="bg-[#180a2b] text-slate-400 font-semibold sticky top-0 border-b border-white/10 z-10">
                        <tr>
                          <th className="p-3.5 whitespace-nowrap min-w-[130px]">Member Name</th>
                          <th className="p-3.5 whitespace-nowrap min-w-[110px]">Registration No</th>
                          <th className="p-3.5 whitespace-nowrap min-w-[170px]">Email</th>
                          <th className="p-3.5 whitespace-nowrap min-w-[105px]">Status</th>
                          <th className="p-3.5 whitespace-nowrap min-w-[135px] text-right">Payment Ref / Date</th>
                          <th className="p-3.5 whitespace-nowrap min-w-[175px] text-center">{isAdminState ? 'Action' : 'Audit Logs'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono text-slate-300">
                        {filteredRosterItems.map((item) => {
                          const email = item.user_email ? item.user_email.toLowerCase() : '';
                          const member = membersMap.get(email);
                          const name = member ? member.name : 'Unknown Member';
                          const regNo = member ? member.regNo : 'N/A';

                          return (
                            <tr key={item.id} className="hover:bg-white/5 transition-colors">
                              <td className="p-3.5 font-sans font-bold text-white whitespace-nowrap max-w-[150px] truncate" title={name}>
                                {name}
                              </td>
                              <td className="p-3.5 text-purple-300 font-semibold whitespace-nowrap">
                                {regNo}
                              </td>
                              <td className="p-3.5 text-slate-400 font-mono text-[11px] max-w-[190px] xl:max-w-[240px] truncate" title={email}>
                                {email}
                              </td>
                              <td className="p-3.5 font-sans whitespace-nowrap">
                                {renderAdminStatusSelect(item)}
                              </td>
                              <td className="p-3.5 text-right whitespace-nowrap font-mono">
                                {item.status === 'Paid' && item.paid_at ? (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setReceiptModalPayment(item)}
                                      className="text-right group/receipt hover:bg-emerald-500/10 p-1.5 rounded-lg transition-colors cursor-pointer block"
                                      title="Click to view & download official receipt"
                                    >
                                      <div className="flex items-center justify-end gap-1 text-[11px] text-emerald-400 font-mono">
                                        <Receipt className="w-3 h-3 text-emerald-400 group-hover/receipt:scale-110 transition-transform shrink-0" />
                                        <span className="truncate max-w-[130px] underline decoration-emerald-500/30 underline-offset-2" title={item.razorpay_payment_id || 'Paid'}>
                                          {item.razorpay_payment_id || 'Paid'}
                                        </span>
                                      </div>
                                      <div className="text-[9px] text-slate-400">
                                        {new Date(item.paid_at).toLocaleDateString('en-IN')}
                                      </div>
                                    </button>
                                    {isAdminState && item.razorpay_payment_id?.startsWith('manual_') && (
                                      <button
                                        type="button"
                                        disabled={updatingManualStatusId === item.id}
                                        onClick={() => handleManualStatusChange(item, 'Paid')}
                                        className="p-1.5 rounded-lg text-purple-300 hover:text-white bg-purple-500/20 hover:bg-purple-500/40 border border-purple-500/30 text-[10px] font-bold transition-all inline-flex items-center gap-1"
                                        title="Auto-verify with Razorpay to fetch real pay_... transaction ID"
                                      >
                                        <RotateCcw className={`w-3 h-3 ${updatingManualStatusId === item.id ? 'animate-spin' : ''}`} />
                                        <span className="text-[9px]">Verify</span>
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-amber-400 text-[11px]">Unpaid</span>
                                )}
                              </td>
                              <td className="p-3.5 text-center whitespace-nowrap shrink-0">
                                <div className="flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0">
                                  {isAdminState && (
                                    <button
                                      onClick={() => handleOpenEditSingle(item)}
                                      title="Edit Invoice Details"
                                      className="p-1.5 text-purple-300 hover:text-purple-200 hover:bg-purple-500/10 rounded-lg transition-all flex items-center gap-1 text-[10px] font-bold shrink-0"
                                    >
                                      <Pencil className="w-3.5 h-3.5 shrink-0" />
                                      <span>Edit</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleOpenAuditModal(item)}
                                    title="View Audit & Attempt Logs"
                                    className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg transition-all flex items-center gap-1 text-[10px] font-bold shrink-0"
                                  >
                                    <FileText className="w-3.5 h-3.5 shrink-0" />
                                    <span>Audit Logs</span>
                                  </button>
                                  {isAdminState && (
                                    <button
                                      onClick={() =>
                                        setDeleteTarget({
                                          type: 'single',
                                          title: item.title,
                                          itemIds: [item.id],
                                          memberName: name || item.user_email,
                                          isPaid: item.status === 'Paid',
                                          amount: item.amount,
                                        })
                                      }
                                      title="Delete record"
                                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all shrink-0"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setActiveRosterCampaign(null)}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all cursor-pointer"
              >
                Close Roster
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Members to Campaign Modal (From Roster) */}
      {showRosterAddMembersModal && activeRosterCampaign && isAdminState && (
        <div className="fixed inset-0 z-[135] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-[#0e0518] border border-purple-500/50 rounded-2xl sm:rounded-3xl max-w-xl w-full p-5 sm:p-7 space-y-4 shadow-[0_0_60px_rgba(168,85,247,0.3)] relative max-h-[85vh] flex flex-col">
            <button
              type="button"
              disabled={addingMembers}
              onClick={() => {
                setShowRosterAddMembersModal(false);
                setSelectedAddMemberEmails([]);
                setAddMembersSearch('');
              }}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all disabled:opacity-50 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1 pr-6">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                <UserPlus className="w-3.5 h-3.5 text-purple-400" /> ISSUE INVOICE TO MEMBERS
              </div>
              <h3 className="text-xl font-bold text-white">Add Members to Invoice</h3>
              <p className="text-xs text-slate-400">
                Invoice: <strong className="text-white">{activeRosterCampaign.title}</strong> (₹{activeRosterCampaign.amount} INR)
              </p>
            </div>

            {/* Selection controls & mode switcher */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-bold">
                  Select Members ({selectedAddMemberEmails.length} selected)
                </span>
                <div className="flex items-center gap-2">
                  {selectedAddMemberEmails.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedAddMemberEmails([])}
                      className="text-[10px] text-rose-400 hover:text-rose-300 underline font-semibold cursor-pointer"
                    >
                      Deselect All
                    </button>
                  )}
                </div>
              </div>

              {/* Sub-tabs: Directory Picker vs Bulk Feeder */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-black/40 border border-white/10 gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setAddMembersMode('picker')}
                  className={`py-1.5 px-3 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    addMembersMode === 'picker'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <Search className="w-3.5 h-3.5" />
                  Directory Picker
                </button>
                <button
                  type="button"
                  onClick={() => setAddMembersMode('bulk')}
                  className={`py-1.5 px-3 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    addMembersMode === 'bulk'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Bulk Feeder (Paste / CSV)
                </button>
              </div>

              {addMembersMode === 'picker' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[11px] text-slate-400">Search available crew members:</span>
                    <button
                      type="button"
                      onClick={() => {
                        const existingSet = new Set(activeRosterCampaign.items.map((i) => (i.user_email || '').toLowerCase()));
                        const filteredEmails = membersList
                          .filter((m) => {
                            if (existingSet.has(m.email.toLowerCase())) return false;
                            if (!addMembersSearch.trim()) return true;
                            const q = addMembersSearch.toLowerCase();
                            return m.name.toLowerCase().includes(q) || m.regNo.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.team.toLowerCase().includes(q);
                          })
                          .map((m) => m.email);
                        setSelectedAddMemberEmails(Array.from(new Set([...selectedAddMemberEmails, ...filteredEmails])));
                      }}
                      className="text-[10px] text-purple-400 hover:text-purple-300 underline font-semibold cursor-pointer"
                    >
                      Select All Filtered
                    </button>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search available members by name, regNo, team..."
                      value={addMembersSearch}
                      onChange={(e) => setAddMembersSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/50 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              ) : (
                /* Bulk Feeder Mode for Add Members */
                <div className="space-y-3 p-3 rounded-2xl bg-black/40 border border-purple-500/30">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5 text-purple-400" />
                        <span>Attach CSV or Text File</span>
                      </span>
                      {addMembersBulkFileName && (
                        <button
                          type="button"
                          onClick={() => {
                            setAddMembersBulkFileName(null);
                            setAddMembersBulkInput('');
                            if (addMembersFileInputRef.current) addMembersFileInputRef.current.value = '';
                          }}
                          className="text-[10px] text-rose-400 hover:text-rose-300 underline cursor-pointer"
                        >
                          Remove File
                        </button>
                      )}
                    </div>
                    <label className="flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-purple-500/40 hover:border-purple-400 bg-purple-500/5 hover:bg-purple-500/10 cursor-pointer transition-all text-xs text-purple-300 font-medium">
                      <input
                        type="file"
                        ref={addMembersFileInputRef}
                        accept=".csv,.txt"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setAddMembersBulkFileName(file.name);
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const text = event.target?.result as string;
                              if (text) setAddMembersBulkInput(text);
                            };
                            reader.readAsText(file);
                          }
                        }}
                      />
                      <FileSpreadsheet className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      {addMembersBulkFileName ? (
                        <span className="font-bold text-white truncate max-w-[260px]">{addMembersBulkFileName}</span>
                      ) : (
                        <span>Click to attach CSV (e.g. <code>unpaid_members.csv</code>)</span>
                      )}
                    </label>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 font-semibold">Or Paste Emails / Reg Numbers:</span>
                      <span className="text-[10px] text-slate-500">Comma, newline or space separated</span>
                    </div>
                    <textarea
                      rows={3}
                      placeholder="e.g.&#10;lokesh.23bcg10015@vitbhopal.ac.in&#10;24BAC10038, 24BAI10199"
                      value={addMembersBulkInput}
                      onChange={(e) => setAddMembersBulkInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono text-xs resize-none"
                    />
                  </div>

                  {addMembersBulkInput.trim().length > 0 && (() => {
                    const existingSet = new Set(activeRosterCampaign.items.map((i) => (i.user_email || '').toLowerCase()));
                    const eligibleEmails = addMembersBulkParsed.matchedEmails.filter((e) => !existingSet.has(e.toLowerCase()));
                    const alreadyIssuedCount = addMembersBulkParsed.matchedEmails.length - eligibleEmails.length;

                    return (
                      <div className="p-2.5 rounded-xl bg-[#140b2b] border border-purple-500/40 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>{eligibleEmails.length} Eligible to Add</span>
                          </div>
                          {alreadyIssuedCount > 0 && (
                            <span className="text-[10px] text-slate-400 font-semibold">
                              ({alreadyIssuedCount} already have this invoice)
                            </span>
                          )}
                        </div>

                        {addMembersBulkParsed.unmatchedTokens.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-white/10 text-[10px]">
                            <span className="text-amber-400 font-semibold">
                              ⚠️ {addMembersBulkParsed.unmatchedTokens.length} unrecognized in roster:
                            </span>
                            <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto no-scrollbar">
                              {addMembersBulkParsed.unmatchedTokens.slice(0, 6).map((tok, i) => (
                                <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
                                  {tok}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            disabled={eligibleEmails.length === 0}
                            onClick={() => {
                              setSelectedAddMemberEmails((prev) => Array.from(new Set([...prev, ...eligibleEmails])));
                              showToast(`Added ${eligibleEmails.length} member(s) to selection!`, 'success');
                            }}
                            className="flex-1 py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-all disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <PlusCircle className="w-3.5 h-3.5" />
                            <span>Add to Selected ({eligibleEmails.length})</span>
                          </button>
                          <button
                            type="button"
                            disabled={eligibleEmails.length === 0}
                            onClick={() => {
                              setSelectedAddMemberEmails(Array.from(new Set(eligibleEmails)));
                              showToast(`Selection replaced with ${eligibleEmails.length} member(s)!`, 'success');
                            }}
                            className="flex-1 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-all disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Replace Selection</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddMembersBulkInput('');
                              setAddMembersBulkFileName(null);
                              if (addMembersFileInputRef.current) addMembersFileInputRef.current.value = '';
                            }}
                            className="py-1.5 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-semibold cursor-pointer"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Unassigned members scroll list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar border border-white/10 rounded-xl bg-black/40 p-2 space-y-1 min-h-[180px] max-h-[300px]">
              {(() => {
                const existingSet = new Set(activeRosterCampaign.items.map((i) => (i.user_email || '').toLowerCase()));
                const available = membersList.filter((m) => {
                  if (existingSet.has(m.email.toLowerCase())) return false;
                  if (!addMembersSearch.trim()) return true;
                  const q = addMembersSearch.toLowerCase();
                  return m.name.toLowerCase().includes(q) || m.regNo.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.team.toLowerCase().includes(q);
                });

                if (available.length === 0) {
                  return (
                    <div className="p-8 text-center text-xs text-slate-400">
                      {membersList.length === 0
                        ? 'Loading member directory...'
                        : 'All available crew members already have this invoice issued.'}
                    </div>
                  );
                }

                return available.map((m) => {
                  const isSelected = selectedAddMemberEmails.includes(m.email);
                  return (
                    <div
                      key={m.email}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedAddMemberEmails((prev) => prev.filter((e) => e !== m.email));
                        } else {
                          setSelectedAddMemberEmails((prev) => [...prev, m.email]);
                        }
                      }}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-purple-600/20 border border-purple-500/40 text-white'
                          : 'hover:bg-white/5 border border-transparent text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-4 h-4 rounded accent-purple-500 cursor-pointer"
                        />
                        <div className="min-w-0 text-left">
                          <div className="font-bold text-xs truncate text-white">
                            {m.name} <span className="text-[10px] text-purple-300 font-normal">({m.regNo || 'N/A'})</span>
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">{m.email}</div>
                        </div>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-white/5 text-purple-300 border border-white/10 shrink-0">
                        {m.team || 'Crew'}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                disabled={addingMembers}
                onClick={() => {
                  setShowRosterAddMembersModal(false);
                  setSelectedAddMemberEmails([]);
                  setAddMembersSearch('');
                }}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={addingMembers || selectedAddMemberEmails.length === 0}
                onClick={() => handleAddMembersToInvoice(activeRosterCampaign, selectedAddMemberEmails)}
                className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {addingMembers ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    <span>Issuing Invoices...</span>
                  </>
                ) : (
                  <span>Issue to {selectedAddMemberEmails.length} Member(s)</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Helper type function */}
      {/* Premium Digital Receipt Modal */}
      <AnimatePresence>
        {receiptModalPayment && (() => {
          const isManualVerified = Boolean(
            receiptModalPayment.payment_method?.includes('Manual') ||
            receiptModalPayment.razorpay_payment_id?.startsWith('manual_')
          );
          const receiptCandidateName =
            receiptModalPayment.candidate_name ||
            membersMap.get(receiptModalPayment.user_email?.toLowerCase() || '')?.name;
          const receiptRegNo =
            receiptModalPayment.registration_number ||
            membersMap.get(receiptModalPayment.user_email?.toLowerCase() || '')?.regNo;

          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="bg-gradient-to-b from-[#1a0f2e] to-[#0e0518] border border-purple-500/30 rounded-[2rem] max-w-md w-full p-1 relative shadow-[0_0_80px_rgba(168,85,247,0.15)] overflow-hidden"
              >
                {/* Background ambient glow */}
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-full h-1/2 blur-[80px] rounded-full pointer-events-none ${
                  isManualVerified ? 'bg-purple-500/20' : 'bg-emerald-500/20'
                }`}></div>

                <div className="bg-[#0e0518]/90 backdrop-blur-xl rounded-[1.8rem] p-6 sm:p-8 relative z-10 max-h-[90vh] overflow-y-auto custom-scrollbar">
                  <button
                    onClick={() => setReceiptModalPayment(null)}
                    className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-all cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  {/* Success Header */}
                  <div className="text-center space-y-4 mb-6">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", damping: 15, stiffness: 200, delay: 0.2 }}
                      className={`w-20 h-20 rounded-full border flex items-center justify-center mx-auto relative ${
                        isManualVerified
                          ? 'bg-purple-500/10 border-purple-500/40 text-purple-400 shadow-[0_0_30px_rgba(168,85,247,0.3)]'
                          : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.3)]'
                      }`}
                    >
                      <motion.div
                        animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.2, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        className={`absolute inset-0 rounded-full blur-md ${
                          isManualVerified ? 'bg-purple-500/20' : 'bg-emerald-500/20'
                        }`}
                      ></motion.div>
                      <CheckCircle2 className="w-10 h-10 relative z-10" />
                    </motion.div>

                    <div>
                      <h3 className="text-2xl sm:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-200 to-white">
                        Payment Successful
                      </h3>
                      <p className={`text-xs font-mono tracking-widest uppercase mt-2 font-bold ${
                        isManualVerified ? 'text-purple-300' : 'text-emerald-400/80'
                      }`}>
                        {isManualVerified ? '🛡️ Manually Verified by SuperAdmin' : '⚡ Automatic Gateway Verified'}
                      </p>
                    </div>
                  </div>

                  {/* Digital Ticket / Receipt Details */}
                  <div className="relative">
                    {/* Dashed line separator mimicking a ticket */}
                    <div className="absolute -top-3 -left-8 -right-8 border-t-2 border-dashed border-white/10"></div>

                    <div className="space-y-3.5 bg-black/40 border border-white/5 rounded-2xl p-4 sm:p-5 text-sm mt-3 relative overflow-hidden">
                      {/* Subtle watermark */}
                      <div className="absolute -bottom-8 -right-8 opacity-5 rotate-12 pointer-events-none">
                        <CheckCircle2 className="w-48 h-48 text-white" />
                      </div>

                      <div className="flex flex-col gap-0.5 pb-2.5 border-b border-white/5">
                        <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase">Item / Campaign</span>
                        <span className="text-white font-semibold text-xs sm:text-sm">{receiptModalPayment.title}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pb-2.5 border-b border-white/5">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase">Amount Paid</span>
                          <span className="text-emerald-400 font-black text-lg">
                            ₹{Number(receiptModalPayment.amount).toLocaleString('en-IN')}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 text-right">
                          <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase">Category</span>
                          <span className="text-purple-300 font-medium text-xs">{receiptModalPayment.category}</span>
                        </div>
                      </div>

                      <div className="space-y-2 text-xs">
                        {receiptCandidateName && (
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase shrink-0">Member Name</span>
                            <span className="text-white font-medium truncate max-w-[210px] text-right">{receiptCandidateName}</span>
                          </div>
                        )}
                        {receiptRegNo && (
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase shrink-0">Reg No</span>
                            <span className="text-purple-300 font-mono text-[11px]">{receiptRegNo}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase shrink-0">Payer Email</span>
                          <span className="text-slate-300 font-mono text-[11px] truncate max-w-[210px] text-right">{receiptModalPayment.user_email || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase shrink-0">Verification</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                            isManualVerified
                              ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          }`}>
                            {isManualVerified ? '🛡️ Manual Verification (SuperAdmin)' : '⚡ Automatic Gateway Verified'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase shrink-0">Payment Method</span>
                          <span className="text-slate-300 text-[11px] font-mono truncate max-w-[210px] text-right">
                            {receiptModalPayment.payment_method || (isManualVerified ? 'Manual Verification (Admin)' : 'Razorpay Online')}
                          </span>
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase shrink-0">Txn / Ref ID</span>
                          <span className="text-slate-400 font-mono text-[10px] bg-white/5 px-2 py-0.5 rounded truncate max-w-[190px]">
                            {receiptModalPayment.razorpay_payment_id || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-[10px] text-slate-500 font-bold tracking-wider uppercase shrink-0">Invoice Issued</span>
                          <span className="text-slate-300 text-[11px] font-mono text-right">
                            {receiptModalPayment.created_at
                              ? new Date(receiptModalPayment.created_at).toLocaleString('en-IN', {
                                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
                              })
                              : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-[10px] text-purple-300 font-bold tracking-wider uppercase shrink-0">Due Date</span>
                          <span className="text-purple-200 text-[11px] font-mono text-right">
                            {receiptModalPayment.due_date
                              ? new Date(receiptModalPayment.due_date).toLocaleDateString('en-IN', {
                                day: 'numeric', month: 'short', year: 'numeric'
                              })
                              : 'No Due Date'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-[10px] text-emerald-400 font-bold tracking-wider uppercase shrink-0">Paid On</span>
                          <span className="text-emerald-300 text-[11px] font-mono font-medium text-right">
                            {receiptModalPayment.paid_at
                              ? new Date(receiptModalPayment.paid_at).toLocaleString('en-IN', {
                                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
                              })
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 mt-6">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => window.print()}
                      className="flex-1 py-3 rounded-xl border border-white/10 hover:bg-white/5 text-white font-bold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      Print / Download
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setReceiptModalPayment(null)}
                      className={`flex-1 py-3 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                        isManualVerified
                          ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]'
                          : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                      }`}
                    >
                      Done
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Admin Assign Due to Single Member Modal */}
      {showCreateModal && canInitiatePayments && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <form
            onSubmit={handleCreatePayment}
            className="bg-[#0e0518] border border-amber-500/40 rounded-3xl max-w-md w-full p-6 md:p-8 space-y-5 shadow-[0_0_50px_rgba(245,158,11,0.2)] relative max-h-[90vh] overflow-y-auto custom-scrollbar"
          >
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                <UserCheck className="w-3 h-3" /> SINGLE MEMBER DUE
              </div>
              <h3 className="text-xl font-bold text-white">Assign Payment Due to Member</h3>
              <p className="text-xs text-slate-400">Select a registered crew member or type a custom email.</p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Search & Select Member *</label>

                {/* Search Input */}
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400/80 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search member by name, reg no, email or team..."
                    value={singleMemberSearch}
                    onFocus={() => setShowSingleDropdown(true)}
                    onChange={(e) => {
                      setSingleMemberSearch(e.target.value);
                      setShowSingleDropdown(true);
                    }}
                    className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-[#0a0315] border border-white/15 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-amber-500 shadow-inner"
                  />
                  {singleMemberSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setSingleMemberSearch('');
                        setShowSingleDropdown(true);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Dropdown Results */}
                {showSingleDropdown && (
                  <div className="mt-1.5 max-h-52 overflow-y-auto rounded-xl bg-[#120726] border border-amber-500/30 p-1.5 space-y-1 shadow-2xl custom-scrollbar text-xs z-20">
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectMemberInModal('custom');
                        setSingleMemberSearch('Custom Email');
                        setShowSingleDropdown(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg font-semibold transition-all flex items-center justify-between ${selectedMemberEmail === 'custom'
                          ? 'bg-amber-500/25 text-amber-200 border border-amber-500/40'
                          : 'text-amber-300 hover:bg-white/5'
                        }`}
                    >
                      <span>+ Type Custom Email Address</span>
                      <span className="text-[10px] text-amber-400/80 font-mono">Custom Email</span>
                    </button>

                    {membersList
                      .filter((m) => {
                        if (!singleMemberSearch.trim() || singleMemberSearch === 'Custom Email') return true;
                        const q = singleMemberSearch.toLowerCase();
                        return (
                          m.name.toLowerCase().includes(q) ||
                          m.regNo.toLowerCase().includes(q) ||
                          m.email.toLowerCase().includes(q) ||
                          m.team.toLowerCase().includes(q)
                        );
                      })
                      .slice(0, 50)
                      .map((m) => {
                        const isSelected = selectedMemberEmail === m.email;
                        return (
                          <button
                            key={m.email}
                            type="button"
                            onClick={() => {
                              handleSelectMemberInModal(m.email);
                              setSingleMemberSearch(`${m.name} (${m.regNo})`);
                              setShowSingleDropdown(false);
                            }}
                            className={`w-full text-left p-2 rounded-lg transition-all flex items-center justify-between gap-2 ${isSelected
                                ? 'bg-amber-500/25 text-white border border-amber-500/40 shadow-sm'
                                : 'text-slate-300 hover:bg-white/5 hover:text-white'
                              }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold truncate text-white">{m.name}</span>
                                {m.regNo && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-white/10 text-slate-300">
                                    {m.regNo}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 truncate mt-0.5">{m.email}</div>
                            </div>
                            {m.team && (
                              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex-shrink-0">
                                {m.team}
                              </span>
                            )}
                          </button>
                        );
                      })}

                    {membersList.filter((m) => {
                      if (!singleMemberSearch.trim() || singleMemberSearch === 'Custom Email') return true;
                      const q = singleMemberSearch.toLowerCase();
                      return (
                        m.name.toLowerCase().includes(q) ||
                        m.regNo.toLowerCase().includes(q) ||
                        m.email.toLowerCase().includes(q) ||
                        m.team.toLowerCase().includes(q)
                      );
                    }).length === 0 && (
                        <div className="p-3 text-center text-slate-400 text-xs">
                          No matching members found.
                        </div>
                      )}
                  </div>
                )}

                {/* Selected Member Details Badge */}
                {selectedMemberEmail && selectedMemberEmail !== 'custom' && membersMap.get(selectedMemberEmail) && (
                  <div className="mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs animate-in fade-in duration-150">
                    <div className="flex items-center gap-2 min-w-0">
                      <UserCheck className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <div className="truncate">
                        <span className="font-bold text-white">{membersMap.get(selectedMemberEmail)?.name}</span>{' '}
                        <span className="text-slate-400 font-mono">({membersMap.get(selectedMemberEmail)?.regNo})</span>
                        <div className="text-[10px] text-amber-200/80 truncate">{selectedMemberEmail}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMemberEmail('');
                        setTargetEmail('');
                        setSingleMemberSearch('');
                        setShowSingleDropdown(true);
                      }}
                      className="text-[10px] font-bold text-slate-400 hover:text-white px-2 py-1 rounded bg-white/5 hover:bg-white/10 transition-all flex-shrink-0 ml-2"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {(selectedMemberEmail === 'custom' || !selectedMemberEmail) && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Member Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. member.24bcg10003@vitbhopal.ac.in"
                    value={targetEmail}
                    onChange={(e) => setTargetEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Payment Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VRGC Membership Fee 2026"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Amount (₹ INR) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="500"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0315] border border-white/10 text-white focus:outline-none focus:border-amber-500 [&>option]:bg-[#130828] [&>option]:text-white"
                  >
                    <option value="Club Fee" className="bg-[#130828]">Club Fee</option>
                    <option value="Event Registration" className="bg-[#130828]">Event Registration</option>
                    <option value="Merchandise" className="bg-[#130828]">Merchandise</option>
                    <option value="Fine" className="bg-[#130828]">Fine</option>
                    <option value="Other" className="bg-[#130828]">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-semibold">Payment Due Date &amp; Time (IST)</label>
                  <span className="text-[10px] text-slate-400">Default: 7 Days from today at 11:59 PM</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="col-span-2 px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-amber-500 font-mono text-xs"
                  />
                  <input
                    type="time"
                    value={newDueTime}
                    onChange={(e) => setNewDueTime(e.target.value)}
                    className="col-span-1 px-3 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-amber-500 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
                  <span className="text-[10px] text-slate-400 font-semibold flex-shrink-0">Presets:</span>
                  {[
                    { label: '+1 Day', days: 1 },
                    { label: '+3 Days', days: 3 },
                    { label: '+7 Days', days: 7 },
                    { label: '+14 Days', days: 14 },
                    { label: '+30 Days', days: 30 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setNewDueDate(getPresetDateStr(preset.days))}
                      className="px-2 py-1 rounded text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-all flex-shrink-0"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Brief description of this payment requirement..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-purple-950/40 border border-purple-500/30">
                <div>
                  <span className="text-xs font-bold text-white block">Visible to Faculty</span>
                  <span className="text-[10px] text-slate-400">Allow faculty members to view this payment due in payments portal</span>
                </div>
                <input
                  type="checkbox"
                  checked={newVisibleToFaculty}
                  onChange={(e) => setNewVisibleToFaculty(e.target.checked)}
                  className="w-4 h-4 accent-purple-500 rounded cursor-pointer"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex-1 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all flex items-center justify-center gap-2"
              >
                {creating ? 'Assigning...' : 'Assign Payment Due'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin Assign Due to ALL Registered Members Modal */}
      {showAssignAllModal && canInitiatePayments && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <form
            onSubmit={handleAssignToAllMembers}
            className="bg-[#0e0518] border border-amber-500/50 rounded-3xl max-w-md w-full p-6 md:p-8 space-y-5 shadow-[0_0_60px_rgba(245,158,11,0.3)] relative max-h-[90vh] overflow-y-auto custom-scrollbar"
          >
            <button
              type="button"
              onClick={() => setShowAssignAllModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <Megaphone className="w-3.5 h-3.5 text-amber-400" /> BROADCAST TO ALL {membersList.length} MEMBERS
              </div>
              <h3 className="text-xl font-bold text-white">Assign Due to ALL Crew Members</h3>
              <p className="text-xs text-slate-400">
                This action will generate a payment due for all <strong className="text-amber-300">{membersList.length} registered members</strong>.
              </p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Broadcast Payment Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VRGC Annual Club Fee 2026"
                  value={allTitle}
                  onChange={(e) => setAllTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Amount (₹ INR per member) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="500"
                    value={allAmount}
                    onChange={(e) => setAllAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={allCategory}
                    onChange={(e) => setAllCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0315] border border-white/10 text-white focus:outline-none focus:border-amber-500 [&>option]:bg-[#130828] [&>option]:text-white"
                  >
                    <option value="Club Fee" className="bg-[#130828]">Club Fee</option>
                    <option value="Event Registration" className="bg-[#130828]">Event Registration</option>
                    <option value="Merchandise" className="bg-[#130828]">Merchandise</option>
                    <option value="Fine" className="bg-[#130828]">Fine</option>
                    <option value="Other" className="bg-[#130828]">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-semibold">Payment Due Date &amp; Time (IST)</label>
                  <span className="text-[10px] text-slate-400">Default: 7 Days from today at 11:59 PM</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    value={allDueDate}
                    onChange={(e) => setAllDueDate(e.target.value)}
                    className="col-span-2 px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-amber-500 font-mono text-xs"
                  />
                  <input
                    type="time"
                    value={allDueTime}
                    onChange={(e) => setAllDueTime(e.target.value)}
                    className="col-span-1 px-3 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-amber-500 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
                  <span className="text-[10px] text-slate-400 font-semibold flex-shrink-0">Presets:</span>
                  {[
                    { label: '+1 Day', days: 1 },
                    { label: '+3 Days', days: 3 },
                    { label: '+7 Days', days: 7 },
                    { label: '+14 Days', days: 14 },
                    { label: '+30 Days', days: 30 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setAllDueDate(getPresetDateStr(preset.days))}
                      className="px-2 py-1 rounded text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-all flex-shrink-0"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Mandatory annual membership dues for all VRGC crew members..."
                  value={allDescription}
                  onChange={(e) => setAllDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-purple-950/40 border border-purple-500/30">
                <div>
                  <span className="text-xs font-bold text-white block">Visible to Faculty</span>
                  <span className="text-[10px] text-slate-400">Allow faculty members to view this broadcast due in payments portal</span>
                </div>
                <input
                  type="checkbox"
                  checked={allVisibleToFaculty}
                  onChange={(e) => setAllVisibleToFaculty(e.target.checked)}
                  className="w-4 h-4 accent-purple-500 rounded cursor-pointer"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setShowAssignAllModal(false)}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={assigningAll}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold text-xs shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all flex items-center justify-center gap-2"
              >
                {assigningAll ? `Assigning to ${membersList.length}...` : `Assign to ALL (${membersList.length})`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin Assign Due to Specific Persons (Multi-Member Selection) Modal */}
      {showMultiMemberModal && canInitiatePayments && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <form
            onSubmit={handleAssignMultiMembers}
            className="bg-[#0e0518] border border-indigo-500/50 rounded-3xl max-w-lg w-full p-6 md:p-8 space-y-5 shadow-[0_0_60px_rgba(99,102,241,0.3)] relative max-h-[90vh] overflow-y-auto custom-scrollbar"
          >
            <button
              type="button"
              onClick={() => setShowMultiMemberModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                <Users className="w-3.5 h-3.5 text-indigo-400" /> MULTI-MEMBER SPECIFIC DUE
              </div>
              <h3 className="text-xl font-bold text-white">Assign Payment Due to Specific Persons</h3>
              <p className="text-xs text-slate-400">
                Select one or multiple crew members from the list below to assign this due.
              </p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Payment Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VRGC Specific Event Pass"
                  value={multiTitle}
                  onChange={(e) => setMultiTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Amount (₹ INR per person) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="500"
                    value={multiAmount}
                    onChange={(e) => setMultiAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={multiCategory}
                    onChange={(e) => setMultiCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0315] border border-white/10 text-white focus:outline-none focus:border-indigo-500 [&>option]:bg-[#130828] [&>option]:text-white"
                  >
                    <option value="Club Fee" className="bg-[#130828]">Club Fee</option>
                    <option value="Event Registration" className="bg-[#130828]">Event Registration</option>
                    <option value="Merchandise" className="bg-[#130828]">Merchandise</option>
                    <option value="Fine" className="bg-[#130828]">Fine</option>
                    <option value="Other" className="bg-[#130828]">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-semibold">Payment Due Date &amp; Time (IST)</label>
                  <span className="text-[10px] text-slate-400">Default: 7 Days from today at 11:59 PM</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    value={multiDueDate}
                    onChange={(e) => setMultiDueDate(e.target.value)}
                    className="col-span-2 px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-indigo-500 font-mono text-xs"
                  />
                  <input
                    type="time"
                    value={multiDueTime}
                    onChange={(e) => setMultiDueTime(e.target.value)}
                    className="col-span-1 px-3 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-indigo-500 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
                  <span className="text-[10px] text-slate-400 font-semibold flex-shrink-0">Presets:</span>
                  {[
                    { label: '+1 Day', days: 1 },
                    { label: '+3 Days', days: 3 },
                    { label: '+7 Days', days: 7 },
                    { label: '+14 Days', days: 14 },
                    { label: '+30 Days', days: 30 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setMultiDueDate(getPresetDateStr(preset.days))}
                      className="px-2 py-1 rounded text-[10px] font-bold bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 transition-all flex-shrink-0"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Details for this specific group payment due..."
                  value={multiDescription}
                  onChange={(e) => setMultiDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-purple-950/40 border border-purple-500/30">
                <div>
                  <span className="text-xs font-bold text-white block">Visible to Faculty</span>
                  <span className="text-[10px] text-slate-400">Allow faculty members to view this targeted payment in payments portal</span>
                </div>
                <input
                  type="checkbox"
                  checked={multiVisibleToFaculty}
                  onChange={(e) => setMultiVisibleToFaculty(e.target.checked)}
                  className="w-4 h-4 accent-purple-500 rounded cursor-pointer"
                />
              </div>

              {/* Specific Member Selection Section */}
              <div className="space-y-3 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <label className="block text-slate-200 font-bold">
                    Select Specific Persons
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {selectedMultiMemberEmails.length} selected
                    </span>
                    {selectedMultiMemberEmails.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedMultiMemberEmails([])}
                        className="text-[10px] text-rose-400 hover:text-rose-300 underline font-semibold cursor-pointer"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                {/* Sub-tabs: Directory Picker vs Bulk Feeder */}
                <div className="grid grid-cols-2 p-1 rounded-xl bg-black/40 border border-white/10 gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setMultiAssignMode('picker')}
                    className={`py-1.5 px-3 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      multiAssignMode === 'picker'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <Search className="w-3.5 h-3.5" />
                    Directory Picker
                  </button>
                  <button
                    type="button"
                    onClick={() => setMultiAssignMode('bulk')}
                    className={`py-1.5 px-3 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      multiAssignMode === 'bulk'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Bulk Feeder (Paste / CSV)
                  </button>
                </div>

                {multiAssignMode === 'picker' ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[11px] text-slate-400">Search directory by name, regNo, team:</span>
                      <button
                        type="button"
                        onClick={() => {
                          const filteredEmails = membersList
                            .filter((m) => {
                              if (!multiSearch.trim()) return true;
                              const q = multiSearch.toLowerCase();
                              return m.name.toLowerCase().includes(q) || m.regNo.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.team.toLowerCase().includes(q);
                            })
                            .map((m) => m.email);
                          setSelectedMultiMemberEmails(Array.from(new Set([...selectedMultiMemberEmails, ...filteredEmails])));
                        }}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-semibold cursor-pointer"
                      >
                        Select All Filtered
                      </button>
                    </div>

                    {/* Filter Search inside modal */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search crew members by name, regNo, team..."
                        value={multiSearch}
                        onChange={(e) => setMultiSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#0a0315] border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    {/* Scrollable Members Checkbox List */}
                    <div className="max-h-48 overflow-y-auto custom-scrollbar border border-white/10 rounded-xl bg-black/40 p-2 space-y-1">
                      {membersList
                        .filter((m) => {
                          if (!multiSearch.trim()) return true;
                          const q = multiSearch.toLowerCase();
                          return m.name.toLowerCase().includes(q) || m.regNo.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.team.toLowerCase().includes(q);
                        })
                        .map((m) => {
                          const isSelected = selectedMultiMemberEmails.includes(m.email);
                          return (
                            <div
                              key={m.email}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedMultiMemberEmails((prev) => prev.filter((e) => e !== m.email));
                                } else {
                                  setSelectedMultiMemberEmails((prev) => [...prev, m.email]);
                                }
                              }}
                              className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all ${
                                isSelected
                                  ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
                                  : 'hover:bg-white/5 border border-transparent text-slate-300'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => { }}
                                  className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                                />
                                <div className="min-w-0 text-left">
                                  <div className="font-bold text-xs truncate text-white">{m.name} <span className="text-[10px] text-indigo-300 font-normal">({m.regNo})</span></div>
                                  <div className="text-[10px] text-slate-400 truncate">{m.email}</div>
                                </div>
                              </div>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-white/5 text-purple-300 border border-white/10 shrink-0">
                                {m.team || 'Member'}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ) : (
                  /* Bulk Feeder Mode */
                  <div className="space-y-3 p-3 rounded-2xl bg-black/40 border border-indigo-500/30">
                    {/* CSV / File Attachment */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                          <Upload className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Attach CSV / Text File</span>
                        </span>
                        {multiBulkFileName && (
                          <button
                            type="button"
                            onClick={() => {
                              setMultiBulkFileName(null);
                              setMultiBulkInput('');
                              if (multiFileInputRef.current) multiFileInputRef.current.value = '';
                            }}
                            className="text-[10px] text-rose-400 hover:text-rose-300 underline cursor-pointer"
                          >
                            Remove File
                          </button>
                        )}
                      </div>
                      <label className="flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-indigo-500/40 hover:border-indigo-400 bg-indigo-500/5 hover:bg-indigo-500/10 cursor-pointer transition-all text-xs text-indigo-300 font-medium">
                        <input
                          type="file"
                          ref={multiFileInputRef}
                          accept=".csv,.txt"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setMultiBulkFileName(file.name);
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                const text = event.target?.result as string;
                                if (text) setMultiBulkInput(text);
                              };
                              reader.readAsText(file);
                            }
                          }}
                        />
                        <FileSpreadsheet className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                        {multiBulkFileName ? (
                          <span className="font-bold text-white truncate max-w-[260px]">{multiBulkFileName}</span>
                        ) : (
                          <span>Click to attach CSV (e.g. <code>unpaid_members.csv</code>)</span>
                        )}
                      </label>
                    </div>

                    {/* Or Paste Raw Text */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-300 font-semibold">Or Paste Email IDs / Reg Numbers:</span>
                        <span className="text-[10px] text-slate-500">Comma, newline or space separated</span>
                      </div>
                      <textarea
                        rows={3}
                        placeholder="e.g.&#10;lokesh.23bcg10015@vitbhopal.ac.in&#10;24BAC10038, 24BAI10199"
                        value={multiBulkInput}
                        onChange={(e) => setMultiBulkInput(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono text-xs resize-none"
                      />
                    </div>

                    {/* Live Match Engine Preview */}
                    {multiBulkInput.trim().length > 0 && (
                      <div className="p-2.5 rounded-xl bg-[#140b2b] border border-indigo-500/40 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>{multiBulkParsed.matchedEmails.length} Roster Member{multiBulkParsed.matchedEmails.length !== 1 ? 's' : ''} Recognized</span>
                          </div>
                          {multiBulkParsed.unmatchedTokens.length > 0 && (
                            <div className="flex items-center gap-1 text-amber-400 text-[11px] font-semibold">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>{multiBulkParsed.unmatchedTokens.length} Unmatched</span>
                            </div>
                          )}
                        </div>

                        {multiBulkParsed.unmatchedTokens.length > 0 && (
                          <div className="space-y-1.5 pt-1.5 border-t border-white/10">
                            <div className="text-[10px] text-slate-400 flex items-center justify-between">
                              <span>Unrecognized in roster:</span>
                              {multiBulkParsed.unmatchedTokens.some((t) => t.includes('@')) && (
                                <label className="flex items-center gap-1 cursor-pointer text-indigo-300 hover:text-white">
                                  <input
                                    type="checkbox"
                                    checked={multiIncludeUnmatched}
                                    onChange={(e) => setMultiIncludeUnmatched(e.target.checked)}
                                    className="w-3 h-3 rounded accent-indigo-500 cursor-pointer"
                                  />
                                  <span>Include {multiBulkParsed.unmatchedTokens.filter((t) => t.includes('@')).length} unlisted email(s)</span>
                                </label>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto no-scrollbar">
                              {multiBulkParsed.unmatchedTokens.slice(0, 8).map((tok, i) => (
                                <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
                                  {tok}
                                </span>
                              ))}
                              {multiBulkParsed.unmatchedTokens.length > 8 && (
                                <span className="text-[9px] text-slate-400 self-center">
                                  +{multiBulkParsed.unmatchedTokens.length - 8} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            disabled={multiBulkParsed.matchedEmails.length === 0 && (!multiIncludeUnmatched || multiBulkParsed.unmatchedTokens.filter((t) => t.includes('@')).length === 0)}
                            onClick={() => {
                              const toAdd = [...multiBulkParsed.matchedEmails];
                              if (multiIncludeUnmatched) {
                                toAdd.push(...multiBulkParsed.unmatchedTokens.filter((t) => t.includes('@')));
                              }
                              setSelectedMultiMemberEmails((prev) => Array.from(new Set([...prev, ...toAdd])));
                              showToast(`Added ${toAdd.length} member(s) to selection!`, 'success');
                            }}
                            className="flex-1 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-all disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <PlusCircle className="w-3.5 h-3.5" />
                            <span>Add to Selected</span>
                          </button>
                          <button
                            type="button"
                            disabled={multiBulkParsed.matchedEmails.length === 0 && (!multiIncludeUnmatched || multiBulkParsed.unmatchedTokens.filter((t) => t.includes('@')).length === 0)}
                            onClick={() => {
                              const toSet = [...multiBulkParsed.matchedEmails];
                              if (multiIncludeUnmatched) {
                                toSet.push(...multiBulkParsed.unmatchedTokens.filter((t) => t.includes('@')));
                              }
                              setSelectedMultiMemberEmails(Array.from(new Set(toSet)));
                              showToast(`Selection replaced with ${toSet.length} member(s)!`, 'success');
                            }}
                            className="flex-1 py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-all disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Replace Selection</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMultiBulkInput('');
                              setMultiBulkFileName(null);
                              if (multiFileInputRef.current) multiFileInputRef.current.value = '';
                            }}
                            className="py-1.5 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-semibold cursor-pointer"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setShowMultiMemberModal(false)}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={assigningMulti || selectedMultiMemberEmails.length === 0}
                className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {assigningMulti ? `Assigning...` : `Assign to ${selectedMultiMemberEmails.length} Member(s)`}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Admin Edit Entire Campaign / Broadcast Due Modal */}
      {editCampaignGroup && isAdminState && (
        <div className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <form
            onSubmit={handleSaveEditCampaign}
            className="bg-[#0e0518] border border-purple-500/50 rounded-3xl max-w-lg w-full p-6 md:p-8 space-y-5 shadow-[0_0_60px_rgba(168,85,247,0.3)] relative max-h-[90vh] overflow-y-auto custom-scrollbar"
          >
            <button
              type="button"
              onClick={() => setEditCampaignGroup(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                <Pencil className="w-3.5 h-3.5 text-purple-400" /> EDIT INVOICE CAMPAIGN
              </div>
              <h3 className="text-xl font-bold text-white">Modify Invoice Details</h3>
              <p className="text-xs text-slate-400">
                Updates will apply to all <strong className="text-purple-300">{editCampaignGroup.totalAssigned} assigned members</strong> for this invoice.
              </p>
            </div>

            <div className="space-y-4 text-xs">
              {/* Locked Amount Banner */}
              <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/20 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Invoice Amount (Locked)</span>
                  <span className="text-sm font-black text-emerald-400">₹{editCampaignGroup.amount.toLocaleString('en-IN')} INR</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-amber-300 font-semibold bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>Amount Cannot Be Changed</span>
                </div>
              </div>

              {/* Title Input */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Invoice / Payment Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VRGC Annual Club Fee 2026"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Due Date & Time */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-semibold">Payment Due Date &amp; Time (IST) *</label>
                  <span className="text-[10px] text-slate-400">Set deadline</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    required
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="col-span-2 px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-purple-500 font-mono text-xs"
                  />
                  <input
                    type="time"
                    required
                    value={editDueTime}
                    onChange={(e) => setEditDueTime(e.target.value)}
                    className="col-span-1 px-3 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-purple-500 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
                  <span className="text-[10px] text-slate-400 font-semibold flex-shrink-0">Presets:</span>
                  {[
                    { label: '+1 Day', days: 1 },
                    { label: '+3 Days', days: 3 },
                    { label: '+7 Days', days: 7 },
                    { label: '+14 Days', days: 14 },
                    { label: '+30 Days', days: 30 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setEditDueDate(getPresetDateStr(preset.days))}
                      className="px-2 py-1 rounded text-[10px] font-bold bg-purple-500/15 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 transition-all flex-shrink-0"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description / Notes</label>
                <textarea
                  rows={3}
                  placeholder="Brief description or instructions for members..."
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
                />
              </div>

              {/* Visible to Faculty Toggle */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30">
                <div>
                  <span className="text-xs font-bold text-white block">Visible to Faculty Desk</span>
                  <span className="text-[10px] text-slate-400">
                    {editVisibleToFaculty
                      ? 'Faculty members CAN view this invoice in faculty payments ledger'
                      : 'Invoice is HIDDEN from faculty members'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={editVisibleToFaculty}
                  onChange={(e) => setEditVisibleToFaculty(e.target.checked)}
                  className="w-4 h-4 accent-purple-500 rounded cursor-pointer"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setEditCampaignGroup(null)}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all flex items-center justify-center gap-2"
              >
                {savingEdit ? 'Saving Changes...' : `Update All (${editCampaignGroup.totalAssigned})`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin Edit Single Payment Record Modal */}
      {editSinglePayment && isAdminState && (
        <div className="fixed inset-0 z-[135] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <form
            onSubmit={handleSaveEditSingle}
            className="bg-[#0e0518] border border-purple-500/50 rounded-3xl max-w-md w-full p-6 md:p-8 space-y-5 shadow-[0_0_60px_rgba(168,85,247,0.3)] relative max-h-[90vh] overflow-y-auto custom-scrollbar"
          >
            <button
              type="button"
              onClick={() => setEditSinglePayment(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                <Pencil className="w-3.5 h-3.5 text-purple-400" /> EDIT MEMBER INVOICE
              </div>
              <h3 className="text-xl font-bold text-white">Modify Member Invoice</h3>
              <p className="text-xs text-slate-400 truncate">
                Member: <strong className="text-purple-300">{editSinglePayment.candidate_name || editSinglePayment.user_email}</strong>
              </p>
            </div>

            <div className="space-y-4 text-xs">
              {/* Locked Amount Banner */}
              <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/20 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Invoice Amount (Locked)</span>
                  <span className="text-sm font-black text-emerald-400">₹{editSinglePayment.amount.toLocaleString('en-IN')} INR</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-amber-300 font-semibold bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>Non-Editable</span>
                </div>
              </div>

              {/* Title Input */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Invoice Title *</label>
                <input
                  type="text"
                  required
                  value={editSingleTitle}
                  onChange={(e) => setEditSingleTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Payment Status Dropdown (SuperAdmin Manual Override) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Payment Status (Manual Override)</label>
                <select
                  value={editSingleStatus}
                  onChange={(e) => setEditSingleStatus(e.target.value as PaymentStatus)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-amber-500 font-bold text-xs"
                >
                  <option value="Paid" className="bg-[#180a2b] text-emerald-400">🟢 Paid (Auto / Gateway Verified)</option>
                  <option value="Pending" className="bg-[#180a2b] text-amber-400">🟡 Pending (Unpaid)</option>
                  <option value="Processing" className="bg-[#180a2b] text-blue-400">🔵 Processing</option>
                  <option value="Failed" className="bg-[#180a2b] text-rose-400">🔴 Failed</option>
                  <option value="Expired" className="bg-[#180a2b] text-rose-400">🔴 Expired</option>
                </select>
              </div>

              {/* Razorpay Transaction ID (pay_...) with Auto-Fetch */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-semibold">
                    Razorpay Reference / Transaction ID
                  </label>
                  <button
                    type="button"
                    disabled={fetchingRazorpayId}
                    onClick={handleAutoFetchRazorpayId}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-500/20 hover:bg-purple-500/35 text-purple-300 border border-purple-500/40 transition-all cursor-pointer disabled:opacity-50"
                    title="Auto-fetch genuine Razorpay pay_... ID and payment details for this member"
                  >
                    <RotateCcw className={`w-3 h-3 ${fetchingRazorpayId ? 'animate-spin text-purple-400' : 'text-purple-300'}`} />
                    <span>{fetchingRazorpayId ? 'Verifying...' : 'Auto-Fetch from Razorpay'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. pay_Q8k39Xm... (or leave blank to auto-detect)"
                  value={editSinglePaymentId}
                  onChange={(e) => setEditSinglePaymentId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono text-xs"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Click <strong>Auto-Fetch from Razorpay</strong> to query Razorpay servers for this candidate&apos;s captured transaction and payment method.
                </p>
              </div>

              {/* Due Date & Time */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-semibold">Payment Due Date &amp; Time (IST) *</label>
                  <span className="text-[10px] text-slate-400">Deadline</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    required
                    value={editSingleDueDate}
                    onChange={(e) => setEditSingleDueDate(e.target.value)}
                    className="col-span-2 px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-amber-500 font-mono text-xs"
                  />
                  <input
                    type="time"
                    required
                    value={editSingleDueTime}
                    onChange={(e) => setEditSingleDueTime(e.target.value)}
                    className="col-span-1 px-3 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white focus:outline-none focus:border-amber-500 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
                  <span className="text-[10px] text-slate-400 font-semibold flex-shrink-0">Presets:</span>
                  {[
                    { label: '+1 Day', days: 1 },
                    { label: '+3 Days', days: 3 },
                    { label: '+7 Days', days: 7 },
                    { label: '+14 Days', days: 14 },
                    { label: '+30 Days', days: 30 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setEditSingleDueDate(getPresetDateStr(preset.days))}
                      className="px-2 py-1 rounded text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-all flex-shrink-0"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description / Notes</label>
                <textarea
                  rows={3}
                  value={editSingleDescription}
                  onChange={(e) => setEditSingleDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setEditSinglePayment(null)}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingSingleEdit}
                className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all flex items-center justify-center gap-2"
              >
                {savingSingleEdit ? 'Saving...' : 'Save Invoice'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin Individual Payment Audit Log Modal */}
      {auditModalPayment && (
        <div className="fixed inset-0 z-[135] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-[#0e0518] border border-amber-500/40 rounded-2xl sm:rounded-3xl max-w-xl w-full p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-5 shadow-[0_0_60px_rgba(245,158,11,0.25)] relative max-h-[92vh] overflow-y-auto custom-scrollbar mx-2 sm:mx-auto">
            <button
              onClick={() => {
                setAuditModalPayment(null);
                setAuditAttempts([]);
              }}
              className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <div className="space-y-1 pr-6">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <FileText className="w-3.5 h-3.5 text-amber-400" /> PAYMENT AUDIT &amp; ATTEMPTS LOG
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white leading-tight">{auditModalPayment.title}</h3>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Detailed transaction audit trail and candidate attempt history for invoice <span className="text-amber-300 font-mono">#{auditModalPayment.id.slice(0, 8)}</span>.
              </p>
            </div>

            {/* Candidate Target Overview Card */}
            <div className="bg-black/50 border border-white/10 rounded-2xl p-3.5 sm:p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-white truncate">
                    {auditModalPayment.candidate_name || membersMap.get(auditModalPayment.user_email?.toLowerCase() || '')?.name || 'Candidate Member'}
                  </h4>
                  <p className="text-xs text-slate-400 font-mono truncate">
                    {auditModalPayment.user_email}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {renderAdminStatusSelect(auditModalPayment)}
                  {auditModalPayment.status === 'Paid' && (
                    <button
                      type="button"
                      onClick={() => setReceiptModalPayment(auditModalPayment)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] sm:text-xs font-bold transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                      title="View & Download Official Receipt"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>Receipt</span>
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      showToast('Syncing status with Razorpay API...', 'info');
                      try {
                        const res = await syncPaymentStatusWithRazorpay(auditModalPayment.id, auditModalPayment.razorpay_order_id);
                        if (res.updated && res.status === 'Paid') {
                          setAuditModalPayment((prev) => (prev ? {
                            ...prev,
                            status: 'Paid',
                            razorpay_payment_id: res.razorpay_payment_id || prev.razorpay_payment_id,
                            payment_method: res.payment_method || prev.payment_method,
                            paid_at: res.paid_at || prev.paid_at,
                          } : null));
                          showToast(`Payment confirmed! Authentic Razorpay ID: ${res.razorpay_payment_id || 'Captured'} 🎉`, 'success');
                          await loadPayments(userEmail, (isAdminState && adminViewAll) || isFacultyState);
                        } else if (res.status === 'Paid') {
                          setAuditModalPayment((prev) => (prev ? {
                            ...prev,
                            status: 'Paid',
                            razorpay_payment_id: res.razorpay_payment_id || prev.razorpay_payment_id,
                            payment_method: res.payment_method || prev.payment_method,
                            paid_at: res.paid_at || prev.paid_at,
                          } : null));
                          showToast('Payment is verified as Paid on Razorpay.', 'success');
                          await loadPayments(userEmail, (isAdminState && adminViewAll) || isFacultyState);
                        } else {
                          if (res.status) {
                            setAuditModalPayment((prev) => (prev ? { ...prev, status: res.status as PaymentStatus } : null));
                          }
                          showToast(`Sync complete. Status: ${res.status || auditModalPayment.status}`, 'info');
                          await loadPayments(userEmail, (isAdminState && adminViewAll) || isFacultyState);
                        }
                      } catch (err: any) {
                        showToast(err?.message || 'Error checking Razorpay API', 'error');
                      }
                    }}
                    title="Check status directly with Razorpay API"
                    className="px-2.5 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-[11px] sm:text-xs font-bold transition-all flex items-center gap-1 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Sync Razorpay</span>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-[10px] sm:text-[11px]">
                <div className="min-w-0">
                  <span className="text-slate-500 block text-[9px] uppercase font-bold">Regn No</span>
                  <span className="text-purple-300 font-mono font-semibold truncate block">
                    {auditModalPayment.registration_number || membersMap.get(auditModalPayment.user_email?.toLowerCase() || '')?.regNo || 'N/A'}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-slate-500 block text-[9px] uppercase font-bold">Team</span>
                  <span className="text-slate-300 font-medium truncate block">
                    {auditModalPayment.team || membersMap.get(auditModalPayment.user_email?.toLowerCase() || '')?.team || 'N/A'}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-slate-500 block text-[9px] uppercase font-bold">Amount Due</span>
                  <span className="text-amber-400 font-bold truncate block">₹{auditModalPayment.amount}</span>
                </div>
              </div>
            </div>

            {/* Audit History Timeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                <span>Attempt History ({auditAttempts.length})</span>
                {loadingAudit && <span className="text-[10px] text-amber-400 animate-pulse">Loading attempts...</span>}
              </h4>

              {loadingAudit ? (
                <div className="p-6 text-center text-slate-400 text-xs animate-pulse">Loading payment attempt logs...</div>
              ) : auditAttempts.length === 0 ? (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center text-xs text-slate-400">
                  {auditModalPayment.error_description ? (
                    <div className="text-left space-y-1">
                      <div className="text-amber-300 font-bold">Latest Payment Log:</div>
                      <div className="text-slate-300">{auditModalPayment.error_description}</div>
                    </div>
                  ) : (
                    "No previous failed or completed payment attempts logged yet."
                  )}
                </div>
              ) : (
                <div className="space-y-2.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                  {auditAttempts.map((attempt, idx) => (
                    <div
                      key={attempt.id || idx}
                      className="p-3 rounded-xl bg-black/40 border border-white/10 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${attempt.status === 'Paid' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : attempt.status === 'Failed' || attempt.status === 'Cancelled' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}>
                          {attempt.status}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {attempt.created_at ? new Date(attempt.created_at).toLocaleString('en-IN') : ''}
                        </span>
                      </div>

                      {attempt.error_description && (
                        <p className="text-slate-300 text-[11px] leading-relaxed break-words">
                          <strong className="text-rose-300 font-bold">Reason / Gateway Output:</strong> {attempt.error_description}
                        </p>
                      )}

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[10px] text-slate-500 font-mono pt-1 border-t border-white/5 gap-1">
                        <span className="truncate">Order: {attempt.razorpay_order_id || 'N/A'}</span>
                        <span className="truncate">Payment: {attempt.razorpay_payment_id || 'N/A'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  setAuditModalPayment(null);
                  setAuditAttempts([]);
                }}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
              >
                Close Audit View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-blocking Modern Delete Confirmation Modal */}
      {deleteTarget && isAdminState && (
        <div className="fixed inset-0 z-[140] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#0e0518] border border-rose-500/50 rounded-3xl max-w-md w-full p-6 md:p-8 space-y-5 shadow-[0_0_60px_rgba(244,63,94,0.35)] relative animate-in zoom-in-95 duration-200">
            <button
              type="button"
              disabled={deletingInProgress}
              onClick={() => setDeleteTarget(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                <Trash2 className="w-3.5 h-3.5 text-rose-400" /> CONFIRM PERMANENT DELETION
              </div>
              <h3 className="text-xl font-bold text-white">
                {deleteTarget.type === 'campaign' ? 'Delete Entire Campaign?' : 'Delete Member Invoice?'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {deleteTarget.type === 'campaign' ? (
                  <>
                    Are you sure you want to permanently delete campaign <strong className="text-rose-300">"{deleteTarget.title}"</strong> and all its <strong className="text-rose-300">{deleteTarget.totalAssigned || deleteTarget.itemIds.length} assigned member invoices</strong> from Firebase?
                  </>
                ) : (
                  <>
                    Are you sure you want to delete invoice <strong className="text-rose-300">"{deleteTarget.title}"</strong> for member <strong className="text-rose-300">{deleteTarget.memberName}</strong> from Firebase?
                  </>
                )}
              </p>
            </div>

            {deleteTarget.isPaid && (
              <div className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/50 text-xs text-amber-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-400">
                  <AlertCircle className="w-4 h-4 shrink-0" /> CAUTION: Member Already Paid
                </div>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  <strong>{deleteTarget.memberName}</strong> has already completed payment of <strong className="text-white">₹{deleteTarget.amount || '—'} INR</strong> for this invoice. Deleting will permanently remove their payment and transaction record from the financial ledger.
                </p>
              </div>
            )}

            <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-rose-300">
                <AlertCircle className="w-3.5 h-3.5" /> Warning: Action Cannot Be Undone
              </div>
              <p className="text-[11px] text-slate-300">
                All associated records and transaction history will be purged from the database without freezing your browser.
              </p>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                disabled={deletingInProgress}
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingInProgress}
                onClick={handleConfirmDelete}
                className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-[0_0_20px_rgba(244,63,94,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {deletingInProgress ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting from DB...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Forever</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper converter
function paymentStatusToString(status: PaymentStatus): PaymentStatus {
  return status;
}

export default Payments;
