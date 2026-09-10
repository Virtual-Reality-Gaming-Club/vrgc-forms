"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  PermissionsConfig,
  ClubMetadata,
  ALL_PAGE_IDS,
  PageId,
  PagePermission,
  fetchPermissionsConfig,
  savePermissionsConfig,
  fetchClubMetadata,
  saveClubMetadata,
  DEFAULT_PERMISSIONS_CONFIG,
  DEFAULT_CLUB_METADATA,
  createDefaultPagePermissionsMap,
} from '@/lib/permissions';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, query, where, onSnapshot, orderBy, limit, writeBatch } from 'firebase/firestore';
import { fetchAllFaculty, deleteFacultyMember, createFacultyMember, updateFacultyMember } from '@/lib/faculty';
import { FacultyMember } from '@/types/faculty';
import { CONFIG } from '@/lib/config';
import {
  SessionRecord,
  cleanupStaleAuditSessions,
  deleteAuditSessionById,
} from '@/lib/sessionTracker';
import { getSuperAdminEmails } from '@/lib/superAdminsBridge';
import {
  SupportFaq,
  FAQ_CATEGORIES,
  subscribeSupportFaqs,
  createSupportFaq,
  updateSupportFaq,
  deleteSupportFaq,
  reorderSupportFaqs,
  seedDefaultSupportFaqs,
} from '@/lib/supportFaqs';

interface SuperAdminControlCenterProps {
  onRedirect: () => void;
  currentUserEmail: string;
}

interface AdminRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  isSuperAdmin?: boolean;
  addedBy?: string;
  createdAt?: string;
}

const SuperAdminControlCenter: React.FC<SuperAdminControlCenterProps> = ({
  onRedirect,
  currentUserEmail,
}) => {
  const [activeTab, setActiveTab] = useState<'permissions' | 'roles' | 'metadata' | 'faculty' | 'audit' | 'faqs'>('permissions');
  const [selectedMobileRole, setSelectedMobileRole] = useState<string>('Members');
  const [mobileViewMode, setMobileViewMode] = useState<'by_role' | 'by_portal'>('by_role');
  const [selectedMobilePortal, setSelectedMobilePortal] = useState<PageId>('members');
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Close permission dropdowns on click outside
  useEffect(() => {
    if (!openDropdownId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.perm-dropdown-container')) {
        setOpenDropdownId(null);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [openDropdownId]);

  // ─── 1. Permissions Matrix State ──────────────────────────────────────────
  const [permissions, setPermissions] = useState<PermissionsConfig>(DEFAULT_PERMISSIONS_CONFIG);
  const [savingPermissions, setSavingPermissions] = useState<boolean>(false);
  const [permissionsSuccess, setPermissionsSuccess] = useState<string>('');

  // ─── 2. Roles Governance State ────────────────────────────────────────────
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [superAdminEmails, setSuperAdminEmails] = useState<string[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState<boolean>(false);
  const [adminSearch, setAdminSearch] = useState<string>('');
  const [isAddAdminOpen, setIsAddAdminOpen] = useState<boolean>(false);
  const [newAdminEmail, setNewAdminEmail] = useState<string>('');
  const [newAdminName, setNewAdminName] = useState<string>('');
  const [newAdminRole, setNewAdminRole] = useState<string>('Admin');
  const [submittingAdmin, setSubmittingAdmin] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string>('');

  // Custom role creation
  const [newCustomRoleName, setNewCustomRoleName] = useState<string>('');
  const [creatingCustomRole, setCreatingCustomRole] = useState<boolean>(false);

  // ─── 3. Club Domains & Positions Metadata State ───────────────────────────
  const [clubMetadata, setClubMetadata] = useState<ClubMetadata>(DEFAULT_CLUB_METADATA);
  const [newDomainInput, setNewDomainInput] = useState<string>('');
  const [newPositionInput, setNewPositionInput] = useState<string>('');
  const [savingMetadata, setSavingMetadata] = useState<boolean>(false);
  const [metadataSuccess, setMetadataSuccess] = useState<string>('');

  // ─── 4. Faculty State ─────────────────────────────────────────────────────
  const [facultyList, setFacultyList] = useState<FacultyMember[]>([]);
  const [loadingFaculty, setLoadingFaculty] = useState<boolean>(false);
  const [facultySearch, setFacultySearch] = useState<string>('');
  const [isFacultyModalOpen, setIsFacultyModalOpen] = useState<boolean>(false);
  const [editingFaculty, setEditingFaculty] = useState<FacultyMember | null>(null);
  const [facultyFormData, setFacultyFormData] = useState({
    name: '',
    email: '',
    facultyId: '',
    department: '',
    designation: '',
    phone: '',
  });
  const [submittingFaculty, setSubmittingFaculty] = useState<boolean>(false);
  const [facultyError, setFacultyError] = useState<string>('');

  // Confirmation modal
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'admin' | 'faculty' | 'role' | 'domain' | 'position' | 'session' | 'faq';
    id: string;
    label: string;
  } | null>(null);

  // ─── 6. Ticket FAQs Governance State ─────────────────────────────────────
  const [faqs, setFaqs] = useState<SupportFaq[]>([]);
  const [loadingFaqs, setLoadingFaqs] = useState<boolean>(true);
  const [faqSearch, setFaqSearch] = useState<string>('');
  const [faqCategoryFilter, setFaqCategoryFilter] = useState<string>('all');
  const [isFaqModalOpen, setIsFaqModalOpen] = useState<boolean>(false);
  const [editingFaq, setEditingFaq] = useState<SupportFaq | null>(null);
  const [faqFormData, setFaqFormData] = useState({
    question: '',
    answer: '',
    category: 'general',
    isActive: true,
  });
  const [submittingFaq, setSubmittingFaq] = useState<boolean>(false);
  const [isSeedingFaqs, setIsSeedingFaqs] = useState<boolean>(false);
  const [faqActionMsg, setFaqActionMsg] = useState<string>('');

  // ─── 5. Visitor Presence & Sessions Audit State ──────────────────────────
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loadingSessions, setLoadingSessions] = useState<boolean>(true);
  const [sessionSearch, setSessionSearch] = useState<string>('');
  const [sessionStatusFilter, setSessionStatusFilter] = useState<'all' | 'online' | 'members' | 'guests'>('all');
  const [sessionDateFilter, setSessionDateFilter] = useState<'all' | 'today' | 'week'>('all');
  const [sessionsFetched, setSessionsFetched] = useState<boolean>(false);
  const [isRefreshingSessions, setIsRefreshingSessions] = useState<boolean>(false);

  // Purge / Delete Audit Logs by Scheduled Time Range State
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState<boolean>(false);
  const [purgePreset, setPurgePreset] = useState<'all' | '1h' | '3h' | '6h' | 'custom'>('all');
  const [purgeStartDate, setPurgeStartDate] = useState<string>('');
  const [purgeEndDate, setPurgeEndDate] = useState<string>('');
  const [isPurgingLogs, setIsPurgingLogs] = useState<boolean>(false);
  const [purgeSuccessMessage, setPurgeSuccessMessage] = useState<string>('');

  const formatToLocalInput = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleSelectPurgePreset = (preset: 'all' | '1h' | '3h' | '6h' | 'custom') => {
    setPurgePreset(preset);
    const now = new Date();
    if (preset === '1h') {
      setPurgeStartDate(formatToLocalInput(new Date(Date.now() - 12 * 3600 * 1000)));
      setPurgeEndDate(formatToLocalInput(new Date(Date.now() - 3600 * 1000)));
    } else if (preset === '3h') {
      setPurgeStartDate(formatToLocalInput(new Date(Date.now() - 12 * 3600 * 1000)));
      setPurgeEndDate(formatToLocalInput(new Date(Date.now() - 3 * 3600 * 1000)));
    } else if (preset === '6h') {
      setPurgeStartDate(formatToLocalInput(new Date(Date.now() - 12 * 3600 * 1000)));
      setPurgeEndDate(formatToLocalInput(new Date(Date.now() - 6 * 3600 * 1000)));
    } else if (preset === 'all') {
      setPurgeStartDate(formatToLocalInput(new Date(Date.now() - 12 * 3600 * 1000)));
      setPurgeEndDate(formatToLocalInput(now));
    }
  };

  const handleExecutePurgeLogs = async () => {
    if (!purgeStartDate && !purgeEndDate) {
      alert('Please select a start and/or end time for the deletion range.');
      return;
    }

    setIsPurgingLogs(true);
    try {
      const fromDate = purgeStartDate ? new Date(purgeStartDate) : new Date(0);
      const toDate = purgeEndDate ? new Date(purgeEndDate) : new Date();
      const fromIso = fromDate.toISOString();
      const toIso = toDate.toISOString();
      const fromMs = fromDate.getTime();
      const toMs = toDate.getTime();

      // 1. Gather all matching session IDs from frontend state
      const idsToDelete = new Set<string>();
      sessions.forEach((s) => {
        const t = new Date(s.enteredAt).getTime();
        if (!isNaN(t) && t >= fromMs && t <= toMs) {
          idsToDelete.add(s.id);
        }
      });

      // 2. Query Firestore directly for any sessions in range
      try {
        const q = query(
          collection(db, 'audit_sessions'),
          where('enteredAt', '>=', fromIso),
          where('enteredAt', '<=', toIso),
          limit(400)
        );
        const snap = await getDocs(q);
        snap.forEach((d) => idsToDelete.add(d.id));
      } catch (qErr) {
        console.warn('[AuditPurge] Firestore query notice:', qErr);
      }

      // 3. Batch delete from Firestore database
      if (idsToDelete.size > 0) {
        const batch = writeBatch(db);
        idsToDelete.forEach((id) => {
          batch.delete(doc(db, 'audit_sessions', id));
        });
        await batch.commit();
      }

      // 4. Immediately update website frontend state
      setSessions((prev) => prev.filter((s) => !idsToDelete.has(s.id)));

      const count = idsToDelete.size;
      setPurgeSuccessMessage(`Successfully deleted ${count} audit session log(s) from Firebase & website!`);
      setTimeout(() => setPurgeSuccessMessage(''), 4000);
      setIsPurgeModalOpen(false);
    } catch (err: any) {
      console.error('[AuditPurge] Error:', err);
      alert('Failed to delete audit logs: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsPurgingLogs(false);
    }
  };

  const handleDeleteSingleSession = async (sessionId: string) => {
    try {
      await deleteAuditSessionById(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setPurgeSuccessMessage('Session log removed from Firebase & website.');
      setTimeout(() => setPurgeSuccessMessage(''), 3000);
    } catch (err: any) {
      alert('Failed to delete session: ' + (err?.message || 'Unknown error'));
    }
  };

  // Fetch audit sessions on demand (Minimum Firebase Reads — Spark Free Tier Friendly)
  const fetchAuditSessions = useCallback(async (forceRefresh = false) => {
    if (sessionsFetched && !forceRefresh) return;
    setIsRefreshingSessions(true);
    if (!sessionsFetched) setLoadingSessions(true);

    try {
      // Limit to 50 most recent sessions to save read quotas
      const q = query(
        collection(db, 'audit_sessions'),
        orderBy('enteredAt', 'desc'),
        limit(50)
      );
      const snap = await getDocs(q);
      const list: SessionRecord[] = [];
      const staleDocRefs: any[] = [];
      const nowMs = Date.now();
      const twelveHoursMs = 12 * 60 * 60 * 1000;

      snap.forEach((d) => {
        const data = d.data() as Omit<SessionRecord, 'id'>;
        const enteredMs = new Date(data.enteredAt).getTime();
        // Sessions older than 12 hours: automatically pruned from DB and excluded from frontend
        if (!isNaN(enteredMs) && (nowMs - enteredMs) > twelveHoursMs) {
          staleDocRefs.push(d.ref);
        } else {
          list.push({ id: d.id, ...data });
        }
      });

      setSessions(list);
      setSessionsFetched(true);

      // Automatically batch-delete stale records older than 12 hours from Firestore
      if (staleDocRefs.length > 0) {
        const batch = writeBatch(db);
        staleDocRefs.forEach((ref) => batch.delete(ref));
        await batch.commit().catch((err) => console.warn('[AuditSessions] Batch delete error:', err));
      }
      // Also trigger TTL cleanup for any other lingering sessions older than 12 hours
      cleanupStaleAuditSessions().catch(() => {});
    } catch (err) {
      console.warn('[AuditSessions] Fetch error:', err);
    } finally {
      setLoadingSessions(false);
      setIsRefreshingSessions(false);
    }
  }, [sessionsFetched]);

  // Only load audit sessions when Super Admin actually opens the Presence & Audit tab
  useEffect(() => {
    if (activeTab === 'audit') {
      fetchAuditSessions();
    }
  }, [activeTab, fetchAuditSessions]);

  // Helper to determine if a session is currently active/online
  const isSessionOnline = (s: SessionRecord): boolean => {
    if (s.status !== 'online' || s.leftAt) return false;
    const nowMs = Date.now();
    const enteredMs = new Date(s.enteredAt).getTime();
    if (!isNaN(enteredMs) && (nowMs - enteredMs) > 12 * 3600 * 1000) {
      return false;
    }
    const lastActiveMs = s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : enteredMs;
    if (isNaN(lastActiveMs)) return false;
    // Considered online if activity ping occurred within the last 4 minutes
    return (nowMs - lastActiveMs) < 4 * 60 * 1000;
  };

  const resolveSessionDisplayRole = (s: SessionRecord): string => {
    const rawRole = s.userRole || (s.isLoggedIn ? 'Member' : 'Guest');
    if (rawRole === 'Super Admin') {
      const email = (s.userEmail || '').toLowerCase().trim();
      const isLegit = superAdminEmails.map((e) => e.toLowerCase().trim()).includes(email);
      if (!isLegit) {
        return s.isLoggedIn ? 'Member' : 'Guest';
      }
    }
    return rawRole;
  };

  const formatAddedBy = (addedBy?: string | null): string => {
    if (!addedBy) return 'System Env';
    const email = addedBy.toLowerCase().trim();
    if (email.includes('@')) {
      const isLegitSuperAdmin = superAdminEmails.map((e) => e.toLowerCase().trim()).includes(email);
      if (!isLegitSuperAdmin) {
        return 'System Config';
      }
    }
    return addedBy;
  };

  const formatAuditDateTime = (isoString?: string | null): string => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return String(isoString);
      return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return String(isoString);
    }
  };

  // Format relative elapsed time
  const formatAuditRelativeTime = (isoString?: string | null): string => {
    if (!isoString) return '';
    try {
      const ms = new Date(isoString).getTime();
      const diff = Math.max(0, Math.round((Date.now() - ms) / 1000));
      if (diff < 60) return 'just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    } catch {
      return '';
    }
  };

  // Calculated presence stats
  const onlineCount = sessions.filter(isSessionOnline).length;
  const membersCount = sessions.filter((s) => s.isLoggedIn).length;
  const guestsCount = sessions.filter((s) => !s.isLoggedIn).length;

  // Filtered session records
  const filteredSessions = sessions.filter((s) => {
    // Status filter
    if (sessionStatusFilter === 'online' && !isSessionOnline(s)) return false;
    if (sessionStatusFilter === 'members' && !s.isLoggedIn) return false;
    if (sessionStatusFilter === 'guests' && s.isLoggedIn) return false;

    // Date filter
    if (sessionDateFilter !== 'all') {
      const sessionTime = new Date(s.enteredAt).getTime();
      if (sessionDateFilter === 'today') {
        const isToday = new Date(s.enteredAt).toDateString() === new Date().toDateString();
        if (!isToday) return false;
      } else if (sessionDateFilter === 'week') {
        if (Date.now() - sessionTime > 7 * 86400000) return false;
      }
    }

    // Search filter
    if (sessionSearch.trim()) {
      const q = sessionSearch.toLowerCase().trim();
      const matchesName = (s.userName || '').toLowerCase().includes(q);
      const matchesEmail = (s.userEmail || '').toLowerCase().includes(q);
      const matchesRole = (s.userRole || '').toLowerCase().includes(q);
      const matchesDevice = (s.device || '').toLowerCase().includes(q);
      const matchesPath = (s.currentPath || '').toLowerCase().includes(q);
      return matchesName || matchesEmail || matchesRole || matchesDevice || matchesPath;
    }

    return true;
  });

  // ─── Loaders ──────────────────────────────────────────────────────────────
  const loadAllData = async () => {
    setLoadingAdmins(true);
    setLoadingFaculty(true);
    try {
      // 1. Permissions
      const perms = await fetchPermissionsConfig();
      setPermissions(perms);

      // 2. Club Metadata
      const meta = await fetchClubMetadata();
      setClubMetadata(meta);

      // 3. Admins
      const bridgeSuperAdmins = await getSuperAdminEmails();
      setSuperAdminEmails(bridgeSuperAdmins);
      const snap = await getDocs(collection(db, 'admins'));
      const adminMap = new Map<string, AdminRecord>();
      const duplicateDocIdsToDelete: string[] = [];

      snap.forEach((d) => {
        const data = d.data();
        const email = (data.email || d.id).toLowerCase().trim();
        if (!email) return;

        const fallbackName = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const name = (data.name && data.name !== 'Admin' && data.name !== 'Administrator') ? data.name : fallbackName;
        const role = data.role || 'Admin';
        const isSuperAdmin = !!(
          data.role === 'super_admin' ||
          data.isSuperAdmin ||
          bridgeSuperAdmins.some((se) => se.toLowerCase() === email)
        );
        const addedBy = data.addedBy || '';
        const createdAt = data.createdAt || data.created_at || '';

        const existing = adminMap.get(email);
        const displayRole = role && role !== 'super_admin' ? role : (isSuperAdmin ? 'Super Administrator' : 'Admin');

        if (!existing) {
          adminMap.set(email, {
            id: d.id,
            email,
            name,
            role: displayRole,
            isSuperAdmin,
            addedBy,
            createdAt,
          });
        } else {
          // Duplicate document detected for the same email in Firestore!
          if (existing.role === 'Admin' && role !== 'Admin') {
            duplicateDocIdsToDelete.push(existing.id);
            adminMap.set(email, {
              id: d.id,
              email,
              name: name !== fallbackName ? name : existing.name,
              role: role && role !== 'super_admin' ? role : ((isSuperAdmin || existing.isSuperAdmin) ? 'Super Administrator' : 'Admin'),
              isSuperAdmin: isSuperAdmin || existing.isSuperAdmin,
              addedBy: addedBy || existing.addedBy,
              createdAt: existing.createdAt || createdAt,
            });
          } else {
            duplicateDocIdsToDelete.push(d.id);
            if (isSuperAdmin) {
              existing.isSuperAdmin = true;
              if (!existing.role) {
                existing.role = 'Super Administrator';
              }
            }
          }
        }
      });

      // Also ensure all environment/config Super Admins are present in the table
      bridgeSuperAdmins.forEach((superEmail) => {
        const cleanSuper = superEmail.toLowerCase().trim();
        if (!cleanSuper) return;
        const existing = adminMap.get(cleanSuper);
        if (existing) {
          existing.isSuperAdmin = true;
          // Retain custom assigned role if set in Firestore, otherwise default to Super Administrator
          if (!existing.role) {
            existing.role = 'Super Administrator';
          }
        } else {
          const fallbackName = cleanSuper.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          adminMap.set(cleanSuper, {
            id: cleanSuper,
            email: cleanSuper,
            name: fallbackName,
            role: 'Super Administrator',
            isSuperAdmin: true,
            addedBy: 'System Config',
            createdAt: '',
          });
        }
      });

      // Automatically purge duplicate records from Firestore
      if (duplicateDocIdsToDelete.length > 0) {
        duplicateDocIdsToDelete.forEach((dupId) => {
          deleteDoc(doc(db, 'admins', dupId)).catch(console.warn);
        });
      }

      setAdmins(Array.from(adminMap.values()));

      // 4. Faculty
      const faculties = await fetchAllFaculty();
      setFacultyList(faculties);
    } catch (err) {
      console.error('Error loading Super Admin Control Center data:', err);
    } finally {
      setLoadingAdmins(false);
      setLoadingFaculty(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // ─── Matrix Toggle Handlers ───────────────────────────────────────────────
  const handleToggleTierPermission = (
    tierKey: 'members' | 'faculty',
    pageId: PageId,
    field: 'canView' | 'canEdit' | 'bypassMaintenance'
  ) => {
    setPermissions((prev) => {
      const current = prev.tiers[tierKey]?.[pageId] || { canView: false, canEdit: false, bypassMaintenance: false };
      return {
        ...prev,
        tiers: {
          ...prev.tiers,
          [tierKey]: {
            ...prev.tiers[tierKey],
            [pageId]: {
              ...current,
              [field]: !current[field],
            },
          },
        },
      };
    });
  };

  const handleToggleRolePermission = (
    roleName: string,
    pageId: PageId,
    field: 'canView' | 'canEdit' | 'bypassMaintenance'
  ) => {
    setPermissions((prev) => {
      const currentRoleMap = prev.roles[roleName] || createDefaultPagePermissionsMap(true, false, false);
      const currentPagePerm = currentRoleMap[pageId] || { canView: false, canEdit: false, bypassMaintenance: false };
      return {
        ...prev,
        roles: {
          ...prev.roles,
          [roleName]: {
            ...currentRoleMap,
            [pageId]: {
              ...currentPagePerm,
              [field]: !currentPagePerm[field],
            },
          },
        },
      };
    });
  };

  // Set composite Access Level: 'none' (Locked), 'view' (View Only), 'edit' (View & Edit)
  const handleSetTierAccessLevel = (
    tierKey: 'members' | 'faculty',
    pageId: PageId,
    level: 'none' | 'view' | 'edit'
  ) => {
    const isBinary = pageId === 'tickets' || pageId === 'maintenance';
    setPermissions((prev) => {
      const current = prev.tiers[tierKey]?.[pageId] || { canView: false, canEdit: false, bypassMaintenance: false };
      return {
        ...prev,
        tiers: {
          ...prev.tiers,
          [tierKey]: {
            ...prev.tiers[tierKey],
            [pageId]: {
              ...current,
              canView: level !== 'none',
              canEdit: isBinary ? level !== 'none' : level === 'edit',
              bypassMaintenance: level === 'none' ? false : current.bypassMaintenance,
            },
          },
        },
      };
    });
  };

  const handleSetRoleAccessLevel = (
    roleName: string,
    pageId: PageId,
    level: 'none' | 'view' | 'edit'
  ) => {
    const isBinary = pageId === 'tickets' || pageId === 'maintenance';
    setPermissions((prev) => {
      const currentRoleMap = prev.roles[roleName] || createDefaultPagePermissionsMap(true, false, false);
      const currentPagePerm = currentRoleMap[pageId] || { canView: false, canEdit: false, bypassMaintenance: false };
      return {
        ...prev,
        roles: {
          ...prev.roles,
          [roleName]: {
            ...currentRoleMap,
            [pageId]: {
              ...currentPagePerm,
              canView: level !== 'none',
              canEdit: isBinary ? level !== 'none' : level === 'edit',
              bypassMaintenance: level === 'none' ? false : currentPagePerm.bypassMaintenance,
            },
          },
        },
      };
    });
  };

  // Quick preset helper to apply to all 5 portals for a role or tier in 1 tap
  const handleApplyRolePreset = (
    target: 'members' | 'faculty' | string,
    preset: 'view_all' | 'edit_all' | 'lock_all'
  ) => {
    const canView = preset !== 'lock_all';
    const canEdit = preset === 'edit_all';

    setPermissions((prev) => {
      if (target === 'members' || target === 'faculty') {
        const currentTier = (prev.tiers[target] || {}) as Record<PageId, PagePermission>;
        const updatedTier = { ...currentTier } as Record<PageId, PagePermission>;
        ALL_PAGE_IDS.forEach((p) => {
          const isBinary = p.id === 'tickets' || p.id === 'maintenance';
          const cur = updatedTier[p.id] || { canView: false, canEdit: false, bypassMaintenance: false };
          updatedTier[p.id] = {
            ...cur,
            canView,
            canEdit: isBinary ? canView : canEdit,
            bypassMaintenance: preset === 'lock_all' ? false : cur.bypassMaintenance,
          };
        });
        return {
          ...prev,
          tiers: {
            ...prev.tiers,
            [target]: updatedTier,
          },
        };
      } else {
        const currentRole = (prev.roles[target] || {}) as Record<PageId, PagePermission>;
        const updatedRole = { ...currentRole } as Record<PageId, PagePermission>;
        ALL_PAGE_IDS.forEach((p) => {
          const isBinary = p.id === 'tickets' || p.id === 'maintenance';
          const cur = updatedRole[p.id] || { canView: false, canEdit: false, bypassMaintenance: false };
          updatedRole[p.id] = {
            ...cur,
            canView,
            canEdit: isBinary ? canView : canEdit,
            bypassMaintenance: preset === 'lock_all' ? false : cur.bypassMaintenance,
          };
        });
        return {
          ...prev,
          roles: {
            ...prev.roles,
            [target]: updatedRole,
          },
        };
      }
    });
  };

  const handleSavePermissions = async () => {
    setSavingPermissions(true);
    setPermissionsSuccess('');
    try {
      await savePermissionsConfig(permissions);
      setPermissionsSuccess('Permissions Matrix successfully synced to Firestore in real-time!');
      setTimeout(() => setPermissionsSuccess(''), 4000);
    } catch (err: any) {
      console.error('Failed to save permissions:', err);
      alert('Error saving permissions matrix: ' + err.message);
    } finally {
      setSavingPermissions(false);
    }
  };

  // ─── Custom Role Creation & Deletion ──────────────────────────────────────
  const handleCreateCustomRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRole = newCustomRoleName.trim();
    if (!cleanRole) return;
    if (['Admin', 'Payment Admin', 'Technical', ...(permissions.customRoles || [])].includes(cleanRole)) {
      alert('A role with this name already exists.');
      return;
    }

    setCreatingCustomRole(true);
    try {
      const updatedCustomRoles = [...(permissions.customRoles || []), cleanRole];
      const updatedRolesMap = {
        ...permissions.roles,
        [cleanRole]: createDefaultPagePermissionsMap(true, false, false),
      };

      const newPerms: PermissionsConfig = {
        ...permissions,
        customRoles: updatedCustomRoles,
        roles: updatedRolesMap,
      };

      await savePermissionsConfig(newPerms);
      setPermissions(newPerms);
      setNewCustomRoleName('');
    } catch (err: any) {
      console.error('Error creating custom role:', err);
      alert('Failed to register custom role: ' + err.message);
    } finally {
      setCreatingCustomRole(false);
    }
  };

  const handleDeleteCustomRole = async (roleName: string) => {
    try {
      const updatedCustomRoles = (permissions.customRoles || []).filter((r) => r !== roleName);
      const updatedRolesMap = { ...permissions.roles };
      delete updatedRolesMap[roleName];

      const newPerms: PermissionsConfig = {
        ...permissions,
        customRoles: updatedCustomRoles,
        roles: updatedRolesMap,
        allowedMetadataRoles: permissions.allowedMetadataRoles.filter((r) => r !== roleName),
      };

      await savePermissionsConfig(newPerms);
      setPermissions(newPerms);
      setDeleteConfirm(null);
    } catch (err: any) {
      console.error('Error deleting custom role:', err);
      alert('Failed to delete custom role.');
    }
  };

  // ─── Admins Assignment Handlers ───────────────────────────────────────────
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError('');
    const cleanEmail = newAdminEmail.toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setAdminError('Please enter a valid institutional email address.');
      return;
    }

    setSubmittingAdmin(true);
    try {
      const nowIso = new Date().toISOString();
      await setDoc(
        doc(db, 'admins', cleanEmail),
        {
          id: cleanEmail,
          email: cleanEmail,
          name: newAdminName.trim() || cleanEmail.split('@')[0],
          role: newAdminRole,
          addedBy: formatAddedBy(currentUserEmail),
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      await setDoc(
        doc(db, 'roles', cleanEmail),
        {
          id: cleanEmail,
          email: cleanEmail,
          name: newAdminName.trim() || cleanEmail.split('@')[0],
          role: newAdminRole,
          assignedBy: currentUserEmail,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Sync to members collection if member record exists
      try {
        const memQuery = query(collection(db, 'members'), where('email', '==', cleanEmail));
        const memSnap = await getDocs(memQuery);
        for (const memDoc of memSnap.docs) {
          await setDoc(doc(db, 'members', memDoc.id), { role: newAdminRole, position: newAdminRole }, { merge: true });
        }
      } catch (memErr) {
        console.warn('Sync to member doc warning:', memErr);
      }

      setNewAdminEmail('');
      setNewAdminName('');
      setNewAdminRole('Admin');
      setIsAddAdminOpen(false);
      await loadAllData();
    } catch (err: any) {
      console.error('Error adding admin:', err);
      setAdminError(err?.message || 'Failed to save admin record.');
    } finally {
      setSubmittingAdmin(false);
    }
  };

  const handleUpdateAdminRole = async (adminEmail: string, newRole: string) => {
    try {
      const cleanEmail = adminEmail.toLowerCase().trim();
      const isTargetSuperAdmin =
        superAdminEmails.map((e) => e.toLowerCase().trim()).includes(cleanEmail) ||
        admins.some((a) => a.email.toLowerCase() === cleanEmail && (a.isSuperAdmin || a.role === 'Super Administrator'));

      if (isTargetSuperAdmin) {
        alert('Operation Denied: The role of a Super Administrator is immutable and cannot be changed.');
        return;
      }

      const nowIso = new Date().toISOString();

      // Immediate optimistic update
      setAdmins((prev) =>
        prev.map((a) => (a.email.toLowerCase() === cleanEmail ? { ...a, role: newRole } : a))
      );

      // Save to canonical document ID in admins and roles
      await setDoc(doc(db, 'admins', cleanEmail), { id: cleanEmail, email: cleanEmail, role: newRole, updatedAt: nowIso }, { merge: true });
      await setDoc(doc(db, 'roles', cleanEmail), { id: cleanEmail, email: cleanEmail, role: newRole, assignedBy: currentUserEmail, updatedAt: nowIso }, { merge: true });

      // Sync role change to members collection
      try {
        const memQuery = query(collection(db, 'members'), where('email', '==', cleanEmail));
        const memSnap = await getDocs(memQuery);
        for (const memDoc of memSnap.docs) {
          await setDoc(doc(db, 'members', memDoc.id), { role: newRole, position: newRole }, { merge: true });
        }
      } catch (memErr) {
        console.warn('Sync to member doc warning:', memErr);
      }

      // Clean up any other duplicate documents in admins collection with matching email but different doc ID
      try {
        const q = query(collection(db, 'admins'), where('email', '==', cleanEmail));
        const dupSnap = await getDocs(q);
        for (const dupDoc of dupSnap.docs) {
          if (dupDoc.id !== cleanEmail) {
            await deleteDoc(doc(db, 'admins', dupDoc.id));
          }
        }
      } catch (cleanupErr) {
        console.warn('Duplicate admin cleanup error:', cleanupErr);
      }

      await loadAllData();
    } catch (err) {
      console.error('Error updating admin role:', err);
    }
  };

  const handleDropAdmin = async (adminEmail: string) => {
    try {
      const cleanEmail = adminEmail.toLowerCase().trim();
      const isTargetSuperAdmin =
        superAdminEmails.map((e) => e.toLowerCase().trim()).includes(cleanEmail) ||
        admins.some((a) => a.email.toLowerCase() === cleanEmail && (a.isSuperAdmin || a.role === 'Super Administrator'));

      if (isTargetSuperAdmin) {
        alert('Operation Denied: Super Administrators cannot drop another Super Administrator as all Super Admins share equal authority.');
        return;
      }

      await deleteDoc(doc(db, 'admins', cleanEmail));
      await deleteDoc(doc(db, 'roles', cleanEmail));

      // Reset role in members collection
      try {
        const memQuery = query(collection(db, 'members'), where('email', '==', cleanEmail));
        const memSnap = await getDocs(memQuery);
        for (const memDoc of memSnap.docs) {
          const memData = memDoc.data();
          const updatedData: any = { role: null };
          if (memData.position === 'Admin' || memData.position === 'Technical' || memData.position === 'Payment Admin') {
            updatedData.position = 'Member';
          }
          await setDoc(doc(db, 'members', memDoc.id), updatedData, { merge: true });
        }
      } catch (memErr) {
        console.warn('Clear member role warning:', memErr);
      }

      // Also delete any other documents matching email
      try {
        const q = query(collection(db, 'admins'), where('email', '==', cleanEmail));
        const dupSnap = await getDocs(q);
        for (const dupDoc of dupSnap.docs) {
          await deleteDoc(doc(db, 'admins', dupDoc.id));
        }
      } catch (cleanupErr) {
        console.warn('Duplicate admin deletion error:', cleanupErr);
      }

      setDeleteConfirm(null);
      await loadAllData();
    } catch (err) {
      console.error('Error dropping admin:', err);
    }
  };

  // ─── Domains & Positions Handlers ─────────────────────────────────────────
  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDomain = newDomainInput.trim();
    if (!cleanDomain) return;
    if (clubMetadata.domains.some((d) => d.toLowerCase() === cleanDomain.toLowerCase())) {
      alert('This domain already exists.');
      return;
    }

    setSavingMetadata(true);
    try {
      const updated = {
        ...clubMetadata,
        domains: [...clubMetadata.domains, cleanDomain],
      };
      await saveClubMetadata(updated);
      setClubMetadata(updated);
      setNewDomainInput('');
      setMetadataSuccess(`Added domain "${cleanDomain}"!`);
      setTimeout(() => setMetadataSuccess(''), 3000);
    } catch (err: any) {
      alert('Failed to save domain: ' + err.message);
    } finally {
      setSavingMetadata(false);
    }
  };

  const handleDeleteDomain = async (domainName: string) => {
    setSavingMetadata(true);
    try {
      const updated = {
        ...clubMetadata,
        domains: clubMetadata.domains.filter((d) => d !== domainName),
      };
      await saveClubMetadata(updated);
      setClubMetadata(updated);
      setDeleteConfirm(null);
    } catch (err: any) {
      alert('Failed to delete domain: ' + err.message);
    } finally {
      setSavingMetadata(false);
    }
  };

  const handleAddPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPos = newPositionInput.trim();
    if (!cleanPos) return;
    if (clubMetadata.positions.some((p) => p.toLowerCase() === cleanPos.toLowerCase())) {
      alert('This position/role already exists.');
      return;
    }

    setSavingMetadata(true);
    try {
      const updated = {
        ...clubMetadata,
        positions: [...clubMetadata.positions, cleanPos],
      };
      await saveClubMetadata(updated);
      setClubMetadata(updated);
      setNewPositionInput('');
      setMetadataSuccess(`Added position "${cleanPos}"!`);
      setTimeout(() => setMetadataSuccess(''), 3000);
    } catch (err: any) {
      alert('Failed to save position: ' + err.message);
    } finally {
      setSavingMetadata(false);
    }
  };

  const handleDeletePosition = async (positionName: string) => {
    setSavingMetadata(true);
    try {
      const updated = {
        ...clubMetadata,
        positions: clubMetadata.positions.filter((p) => p !== positionName),
      };
      await saveClubMetadata(updated);
      setClubMetadata(updated);
      setDeleteConfirm(null);
    } catch (err: any) {
      alert('Failed to delete position: ' + err.message);
    } finally {
      setSavingMetadata(false);
    }
  };

  // ─── Faculty Form Handlers ────────────────────────────────────────────────
  const openFacultyForm = (faculty?: FacultyMember) => {
    setFacultyError('');
    if (faculty) {
      setEditingFaculty(faculty);
      setFacultyFormData({
        name: faculty.name || '',
        email: faculty.email || '',
        facultyId: faculty.facultyId || '',
        department: faculty.department || '',
        designation: faculty.designation || '',
        phone: faculty.phone || '',
      });
    } else {
      setEditingFaculty(null);
      setFacultyFormData({
        name: '',
        email: '',
        facultyId: '',
        department: '',
        designation: '',
        phone: '',
      });
    }
    setIsFacultyModalOpen(true);
  };

  const handleSaveFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    setFacultyError('');
    const cleanEmail = facultyFormData.email.toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFacultyError('A valid official faculty email is required.');
      return;
    }
    if (!facultyFormData.name.trim()) {
      setFacultyError('Faculty member name is required.');
      return;
    }

    setSubmittingFaculty(true);
    try {
      if (editingFaculty) {
        await updateFacultyMember(cleanEmail, {
          name: facultyFormData.name.trim(),
          facultyId: facultyFormData.facultyId.trim(),
          department: facultyFormData.department.trim(),
          designation: facultyFormData.designation.trim(),
          phone: facultyFormData.phone.trim(),
        });
      } else {
        await createFacultyMember({
          id: cleanEmail,
          email: cleanEmail,
          name: facultyFormData.name.trim(),
          facultyId: facultyFormData.facultyId.trim(),
          department: facultyFormData.department.trim(),
          designation: facultyFormData.designation.trim(),
          phone: facultyFormData.phone.trim(),
        });
      }

      setIsFacultyModalOpen(false);
      setEditingFaculty(null);
      const list = await fetchAllFaculty();
      setFacultyList(list);
    } catch (err: any) {
      console.error('Error saving faculty member:', err);
      setFacultyError(err?.message || 'Failed to save faculty record.');
    } finally {
      setSubmittingFaculty(false);
    }
  };

  const handleDeleteFaculty = async (facultyEmail: string) => {
    try {
      await deleteFacultyMember(facultyEmail);
      setDeleteConfirm(null);
      const list = await fetchAllFaculty();
      setFacultyList(list);
    } catch (err) {
      console.error('Error deleting faculty:', err);
    }
  };

  // ─── Support FAQs Handlers ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeSupportFaqs((list) => {
      setFaqs(list);
      setLoadingFaqs(false);
    });
    return () => unsub();
  }, []);

  const openAddFaqModal = () => {
    setEditingFaq(null);
    setFaqFormData({
      question: '',
      answer: '',
      category: 'general',
      isActive: true,
    });
    setIsFaqModalOpen(true);
  };

  const openEditFaqModal = (faq: SupportFaq) => {
    setEditingFaq(faq);
    setFaqFormData({
      question: faq.question,
      answer: faq.answer,
      category: faq.category || 'general',
      isActive: faq.isActive !== false,
    });
    setIsFaqModalOpen(true);
  };

  const handleSaveFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!faqFormData.question.trim() || !faqFormData.answer.trim()) {
      alert('Both question and answer are required.');
      return;
    }
    setSubmittingFaq(true);
    try {
      if (editingFaq) {
        await updateSupportFaq(
          editingFaq.id,
          {
            question: faqFormData.question.trim(),
            answer: faqFormData.answer.trim(),
            category: faqFormData.category,
            isActive: faqFormData.isActive,
          },
          currentUserEmail
        );
        setFaqActionMsg('FAQ updated successfully!');
      } else {
        const nextOrder = faqs.length > 0 ? Math.max(...faqs.map((f) => f.order || 0)) + 1 : 1;
        await createSupportFaq(
          {
            question: faqFormData.question.trim(),
            answer: faqFormData.answer.trim(),
            category: faqFormData.category,
            order: nextOrder,
            isActive: faqFormData.isActive,
          },
          currentUserEmail
        );
        setFaqActionMsg('New FAQ created successfully!');
      }
      setIsFaqModalOpen(false);
      setEditingFaq(null);
      setTimeout(() => setFaqActionMsg(''), 4000);
    } catch (err: any) {
      console.error('Error saving FAQ:', err);
      alert('Failed to save FAQ: ' + err.message);
    } finally {
      setSubmittingFaq(false);
    }
  };

  const handleDeleteFaq = async (faqId: string) => {
    setFaqs((prev) => prev.filter((f) => f.id !== faqId));
    try {
      await deleteSupportFaq(faqId);
      setFaqActionMsg('FAQ removed from database.');
      setTimeout(() => setFaqActionMsg(''), 4000);
    } catch (err: any) {
      console.error('Error deleting FAQ:', err);
      alert('Failed to delete FAQ: ' + err.message);
    }
  };

  const handleToggleFaqActive = async (faq: SupportFaq) => {
    const nextActive = !faq.isActive;
    const nextStatus = nextActive ? 'active' : 'hidden';
    setFaqs((prev) =>
      prev.map((f) => (f.id === faq.id ? { ...f, isActive: nextActive, status: nextStatus } : f))
    );
    try {
      await updateSupportFaq(faq.id, { isActive: nextActive, status: nextStatus }, currentUserEmail);
      setFaqActionMsg(nextActive ? 'FAQ is now active and visible.' : 'FAQ hidden from members.');
      setTimeout(() => setFaqActionMsg(''), 3000);
    } catch (err: any) {
      console.error('Error toggling FAQ status:', err);
      alert('Failed to update FAQ status: ' + err.message);
    }
  };

  const handleMoveFaq = async (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === faqs.length - 1)) {
      return;
    }
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const newFaqs = [...faqs];
    const [moved] = newFaqs.splice(index, 1);
    newFaqs.splice(targetIndex, 0, moved);
    setFaqs(newFaqs);
    try {
      await reorderSupportFaqs(newFaqs);
    } catch (err: any) {
      console.error('Error reordering FAQs:', err);
    }
  };

  const handleSeedFaqs = async () => {
    setIsSeedingFaqs(true);
    setFaqActionMsg('');
    try {
      const seeded = await seedDefaultSupportFaqs(currentUserEmail);
      setFaqs(seeded);
      setFaqActionMsg('Standard VRGC FAQs successfully saved to Firebase!');
      setTimeout(() => setFaqActionMsg(''), 4000);
    } catch (err: any) {
      console.error('Error seeding FAQs:', err);
      alert('Failed to seed FAQs: ' + err.message);
    } finally {
      setIsSeedingFaqs(false);
    }
  };

  const filteredFaqs = faqs.filter((faq) => {
    const q = faqSearch.toLowerCase();
    const matchesSearch =
      faq.question.toLowerCase().includes(q) ||
      faq.answer.toLowerCase().includes(q);
    const matchesCategory =
      faqCategoryFilter === 'all' || faq.category === faqCategoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Filter lists
  const filteredAdmins = admins.filter((a) => {
    const q = adminSearch.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q) ||
      a.role.toLowerCase().includes(q)
    );
  });

  const filteredFaculty = facultyList.filter((f) => {
    const q = facultySearch.toLowerCase();
    return (
      f.name.toLowerCase().includes(q) ||
      f.email.toLowerCase().includes(q) ||
      (f.department || '').toLowerCase().includes(q) ||
      (f.designation || '').toLowerCase().includes(q)
    );
  });

  // All roles available for matrix and assignment
  const allRolesList = ['Admin', 'Payment Admin', 'Technical', ...(permissions.customRoles || [])];

  // Modern Dropdown + Bypass permission control cell renderer
  const renderPermissionControl = (
    cellId: string,
    perm: PagePermission,
    onSetLevel: (level: 'none' | 'view' | 'edit') => void,
    onToggleBypass: () => void,
    options?: { compact?: boolean; openUpward?: boolean; isBinary?: boolean }
  ) => {
    // Binary Visibility Mode: Direct 1-tap toggle for portals like Resolve Tickets & Maintenance Desk
    if (options?.isBinary) {
      const isAllowed = perm.canView;
      return (
        <div className="inline-flex items-center gap-1.5 relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetLevel(isAllowed ? 'none' : 'view');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer select-none ${
              isAllowed
                ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-200 hover:bg-emerald-900/60 hover:border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.18)]'
                : 'bg-rose-950/70 border-rose-600/50 text-rose-300 hover:bg-rose-900/60 hover:border-rose-400'
            } ${options?.compact ? 'text-[11px] py-1 px-2' : ''}`}
            title={isAllowed ? 'Click to revoke access (No Access)' : 'Click to grant view access (View Allowed)'}
          >
            <span className="material-symbols-outlined text-sm shrink-0">
              {isAllowed ? 'visibility' : 'visibility_off'}
            </span>
            <span className="whitespace-nowrap font-bold">
              {isAllowed ? 'View Allowed' : 'No Access'}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${isAllowed ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'} ml-0.5 shrink-0`} />
          </button>

          {/* Bypass Maintenance Quick Toggle Chip */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleBypass();
            }}
            className={`flex items-center gap-1 rounded-xl border font-mono font-bold transition-all cursor-pointer ${
              perm.bypassMaintenance
                ? 'bg-amber-950/80 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)] hover:bg-amber-900/80'
                : 'bg-[#10071f] border-[#2b1642] text-slate-500 hover:text-slate-300 hover:border-slate-700'
            } ${options?.compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-[11px]'}`}
            title={
              perm.bypassMaintenance
                ? 'Bypass Active: Can access during maintenance'
                : 'Click to allow bypassing maintenance mode'
            }
          >
            <span className="material-symbols-outlined text-xs">
              {perm.bypassMaintenance ? 'verified_user' : 'shield'}
            </span>
            <span className={options?.compact ? 'hidden sm:inline' : 'inline'}>Bypass</span>
          </button>
        </div>
      );
    }

    const isLocked = !perm.canView;
    const isEdit = perm.canView && perm.canEdit;
    const isViewOnly = perm.canView && !perm.canEdit;
    const isDropdownOpen = openDropdownId === cellId;

    // Config for the current active level pill
    const levelConfig = isLocked
      ? {
        label: 'No Access',
        icon: 'lock',
        color: 'bg-rose-950/70 border-rose-600/50 text-rose-300 hover:border-rose-400',
      }
      : isEdit
        ? {
          label: 'View & Edit',
          icon: 'edit',
          color: 'bg-emerald-950/70 border-emerald-500/60 text-emerald-200 hover:border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.18)]',
        }
        : {
          label: 'View Only',
          icon: 'visibility',
          color: 'bg-purple-950/70 border-purple-500/60 text-purple-200 hover:border-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.18)]',
        };

    return (
      <div className="inline-flex items-center gap-1.5 perm-dropdown-container relative">
        {/* Dropdown Menu Trigger Button */}
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpenDropdownId(isDropdownOpen ? null : cellId);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer select-none ${levelConfig.color
              } ${options?.compact ? 'text-[11px] py-1 px-2' : ''}`}
            title="Click to change access level"
          >
            <span className="material-symbols-outlined text-sm shrink-0">
              {levelConfig.icon}
            </span>
            <span className="whitespace-nowrap">{levelConfig.label}</span>
            <span
              className={`material-symbols-outlined text-xs transition-transform duration-200 opacity-70 ${isDropdownOpen ? 'rotate-180' : ''
                }`}
            >
              expand_more
            </span>
          </button>

          {/* Floating Dropdown Popover */}
          {isDropdownOpen && (
            <div
              className={`absolute right-0 z-50 w-44 rounded-xl bg-[#0e071c] border border-purple-500/40 shadow-[0_10px_30px_rgba(0,0,0,0.8),0_0_20px_rgba(147,51,234,0.25)] p-1.5 space-y-1 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 ${options?.openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                }`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Option 1: No Access */}
              <button
                type="button"
                onClick={() => {
                  onSetLevel('none');
                  setOpenDropdownId(null);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${isLocked
                  ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60'
                  : 'text-slate-300 hover:bg-rose-950/30 hover:text-rose-200'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-rose-400">lock</span>
                  <span>No Access</span>
                </div>
                {isLocked && (
                  <span className="material-symbols-outlined text-xs text-rose-400">check</span>
                )}
              </button>

              {/* Option 2: View Only */}
              <button
                type="button"
                onClick={() => {
                  onSetLevel('view');
                  setOpenDropdownId(null);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${isViewOnly
                  ? 'bg-purple-950/60 text-purple-300 border border-purple-800/60'
                  : 'text-slate-300 hover:bg-purple-950/30 hover:text-purple-200'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-purple-400">visibility</span>
                  <span>View Only</span>
                </div>
                {isViewOnly && (
                  <span className="material-symbols-outlined text-xs text-purple-400">check</span>
                )}
              </button>

              {/* Option 3: View & Edit */}
              <button
                type="button"
                onClick={() => {
                  onSetLevel('edit');
                  setOpenDropdownId(null);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${isEdit
                  ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                  : 'text-slate-300 hover:bg-emerald-950/30 hover:text-emerald-200'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-emerald-400">edit</span>
                  <span>View &amp; Edit</span>
                </div>
                {isEdit && (
                  <span className="material-symbols-outlined text-xs text-emerald-400">check</span>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Bypass Maintenance Quick Toggle Chip */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleBypass();
          }}
          className={`flex items-center gap-1 rounded-xl border font-mono font-bold transition-all cursor-pointer ${perm.bypassMaintenance
            ? 'bg-amber-950/80 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)] hover:bg-amber-900/80'
            : 'bg-[#10071f] border-[#2b1642] text-slate-500 hover:text-slate-300 hover:border-slate-700'
            } ${options?.compact
              ? 'px-2 py-1 text-[10px]'
              : 'px-2.5 py-1.5 text-[11px]'
            }`}
          title={
            perm.bypassMaintenance
              ? 'Bypass Active: Can access during maintenance'
              : 'Click to allow bypassing maintenance mode'
          }
        >
          <span className="material-symbols-outlined text-xs">
            {perm.bypassMaintenance ? 'verified_user' : 'shield'}
          </span>
          <span className={options?.compact ? 'hidden sm:inline' : 'inline'}>Bypass</span>
        </button>
      </div>
    );
  };

  return (
    <div className="flex-grow w-full max-w-full bg-transparent p-3 sm:p-6 md:p-8 pb-12 sm:pb-16 text-left text-white select-none overflow-x-hidden">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8 w-full min-w-0">

        {/* Enclave Header */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 sm:p-6 bg-[#0e0618] border border-purple-600/50 rounded-2xl sm:rounded-3xl shadow-[0_0_40px_rgba(147,51,234,0.18)]">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-purple-700 text-white border border-purple-400 shadow-[0_0_10px_rgba(147,51,234,0.4)] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[12px]">security</span>
                SUPER ADMIN ENCLAVE
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-[#1c112b] text-purple-300 border border-purple-800 font-mono">
                SECURE ACCESS • ZERO HARDCODED
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight uppercase">
              Command Control Center
            </h1>

            <p className="text-slate-300 text-xs sm:text-sm max-w-3xl leading-relaxed">
              Configure cross-tier page visibility, write permissions, maintenance mode bypass, custom role registries, and official chapter metadata in real time.
            </p>
          </div>

          <button
            onClick={onRedirect}
            className="self-start lg:self-center px-4 py-2 bg-[#1a0f2b] hover:bg-[#25153d] border border-purple-500/40 text-purple-300 text-xs font-bold rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Return to Dashboard
          </button>
        </header>

        {/* Tab Navigation Strip - Zero Scroll Responsive Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-1.5 p-1.5 bg-[#090312] border border-[#231238] rounded-2xl w-full max-w-full shadow-inner">
          <button
            onClick={() => setActiveTab('permissions')}
            className={`px-2 sm:px-3 py-2.5 rounded-xl text-[11px] sm:text-xs font-black tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${activeTab === 'permissions'
              ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] border-purple-400/60'
              : 'bg-[#130924] text-slate-400 hover:text-white hover:bg-white/5 border-purple-950/40'
              }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">rule</span>
            <span className="truncate">Permissions</span>
          </button>

          <button
            onClick={() => setActiveTab('roles')}
            className={`px-2 sm:px-3 py-2.5 rounded-xl text-[11px] sm:text-xs font-black tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${activeTab === 'roles'
              ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] border-purple-400/60'
              : 'bg-[#130924] text-slate-400 hover:text-white hover:bg-white/5 border-purple-950/40'
              }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">badge</span>
            <span className="truncate">Admins ({admins.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('metadata')}
            className={`px-2 sm:px-3 py-2.5 rounded-xl text-[11px] sm:text-xs font-black tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${activeTab === 'metadata'
              ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] border-purple-400/60'
              : 'bg-[#130924] text-slate-400 hover:text-white hover:bg-white/5 border-purple-950/40'
              }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">category</span>
            <span className="truncate">Domains ({clubMetadata.domains.length + clubMetadata.positions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('faculty')}
            className={`px-2 sm:px-3 py-2.5 rounded-xl text-[11px] sm:text-xs font-black tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${activeTab === 'faculty'
              ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] border-purple-400/60'
              : 'bg-[#130924] text-slate-400 hover:text-white hover:bg-white/5 border-purple-950/40'
              }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">school</span>
            <span className="truncate">Faculty ({facultyList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`px-2 sm:px-3 py-2.5 rounded-xl text-[11px] sm:text-xs font-black tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${activeTab === 'audit'
              ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] border-purple-400/60'
              : 'bg-[#130924] text-slate-400 hover:text-white hover:bg-white/5 border-purple-950/40'
              }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">visibility</span>
            <span className="truncate">Presence &amp; Audit</span>
            {sessionsFetched && onlineCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('faqs')}
            className={`px-2 sm:px-3 py-2.5 rounded-xl text-[11px] sm:text-xs font-black tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${activeTab === 'faqs'
              ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] border-purple-400/60'
              : 'bg-[#130924] text-slate-400 hover:text-white hover:bg-white/5 border-purple-950/40'
              }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">quiz</span>
            <span className="truncate">Ticket FAQs ({faqs.length})</span>
          </button>
        </div>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: PERMISSIONS MATRIX                                            */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'permissions' && (
          <div className="space-y-6">

            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-[#0e071a] border border-[#261238] rounded-2xl">
              <div>
                <h2 className="text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <span>Granular Page Access &amp; Control Matrix</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure page visibility, admin desk write privileges, and maintenance overrides per role.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
                {permissionsSuccess && (
                  <span className="text-xs text-emerald-400 font-bold bg-[#052e16] border border-emerald-600 px-3 py-1.5 rounded-xl animate-fade-in text-center">
                    {permissionsSuccess}
                  </span>
                )}
                <button
                  onClick={handleSavePermissions}
                  disabled={savingPermissions}
                  className="w-full sm:w-auto px-5 py-2.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-black tracking-wider uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  {savingPermissions && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Save Permissions Matrix
                </button>
              </div>
            </div>

            {/* How Permissions Work Explanatory Card */}
            <div className="p-4 bg-[#090214] border border-[#2b1442] rounded-2xl space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-black text-purple-300 uppercase tracking-wider">
                  <span className="material-symbols-outlined text-purple-400 text-base">info</span>
                  <span>How Portal Permissions &amp; Admin Desks Work</span>
                </div>
                <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/60 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  Maintenance &amp; Tickets use 1-Tap Binary Visibility
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="p-3 bg-[#140b24] border border-[#2b1442] rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-white font-bold text-xs">
                    <span className="w-2 h-2 rounded-full bg-white" />
                    <span>VIEW (Page Access)</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Controls whether this role can see the page in the navigation bar and open it. If <span className="text-rose-400 font-bold">unchecked</span>, the portal displays a locked Access Denied screen.
                  </p>
                </div>

                <div className="p-3 bg-[#140b24] border border-[#2b1442] rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-300 font-bold text-xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>EDIT (Admin Desk &amp; Actions)</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Controls whether this role sees the <span className="text-emerald-400 font-bold">Admin Desk / Dashboard</span> (approving admissions, reviewing ID dossiers, managing rosters, audit logs). If <span className="text-amber-400 font-bold">unchecked</span>, the Admin Desk is completely hidden and the user only sees regular member forms.
                  </p>
                </div>

                <div className="p-3 bg-[#140b24] border border-[#2b1442] rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span>BYPASS (Maintenance Override)</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Allows this specific role or tier to access and use the portal even when the page is actively placed under Maintenance Mode by administrators.
                  </p>
                </div>
              </div>
            </div>

            {/* Unified Master-Detail Permissions Governance (Zero Horizontal Scrollbar, Zero Clutter) */}
            <div className="space-y-4">
              {/* Header with View Mode Switcher */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-[#0e071c] border border-purple-500/25 rounded-2xl shadow-md">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                    <span className="material-symbols-outlined text-base">tune</span>
                  </div>
                  <div>
                    <div className="font-extrabold uppercase tracking-wide">Governance Access Configurator</div>
                    <div className="text-[10px] text-slate-400 font-normal">Configure granular permissions without horizontal scrolling</div>
                  </div>
                </div>

                {/* View Mode Toggle: By Role vs By Portal */}
                <div className="inline-flex rounded-xl bg-black/60 p-1 border border-white/10 text-xs font-bold font-mono self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setMobileViewMode('by_role')}
                    className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${mobileViewMode === 'by_role'
                      ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.4)] font-extrabold'
                      : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    <span className="material-symbols-outlined text-sm">badge</span>
                    <span>Configure by Role</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileViewMode('by_portal')}
                    className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${mobileViewMode === 'by_portal'
                      ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.4)] font-extrabold'
                      : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    <span className="material-symbols-outlined text-sm">view_quilt</span>
                    <span>Configure by Portal</span>
                  </button>
                </div>
              </div>

              {/* Mode A: Configure by Role */}
              {mobileViewMode === 'by_role' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Left Column: Role Selector Sidebar */}
                  <div className="lg:col-span-4 xl:col-span-3 space-y-2">
                    <div className="p-3 bg-[#0e071c] border border-purple-500/20 rounded-2xl space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-purple-400 font-bold px-1 flex items-center justify-between">
                        <span>ROLES &amp; ACCESS TIERS</span>
                        <span className="text-slate-500">
                          {2 + allRolesList.length} Total
                        </span>
                      </div>
                      <div className="space-y-1.5 flex flex-row lg:flex-col overflow-x-auto lg:overflow-x-visible pb-1 lg:pb-0 custom-scrollbar">
                        {[
                          { id: 'Members', label: 'Chapter Members', tier: 'members' as const, sub: 'Student Tier', dot: 'bg-cyan-400' },
                          { id: 'Faculty', label: 'Faculty Advisory', tier: 'faculty' as const, sub: 'Academic Mentors', dot: 'bg-indigo-400' },
                          ...allRolesList.map((r) => ({
                            id: r,
                            label: r,
                            tier: null,
                            sub: ['Admin', 'Payment Admin', 'Technical'].includes(r) ? 'Core Administrative' : 'Custom Role',
                            dot: 'bg-purple-500',
                          })),
                        ].map((rItem) => {
                          const isSelected = selectedMobileRole === rItem.id;
                          const activeCount = ALL_PAGE_IDS.filter((p) => {
                            const perm = rItem.tier === 'members'
                              ? permissions.tiers.members?.[p.id]
                              : rItem.tier === 'faculty'
                                ? permissions.tiers.faculty?.[p.id]
                                : permissions.roles[rItem.id]?.[p.id];
                            return perm?.canView;
                          }).length;

                          return (
                            <button
                              key={rItem.id}
                              type="button"
                              onClick={() => setSelectedMobileRole(rItem.id)}
                              className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2.5 shrink-0 lg:shrink ${isSelected
                                ? 'bg-purple-900/50 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.25)] text-white'
                                : 'bg-[#140b24] border-[#2b1642] text-slate-300 hover:border-purple-500/40 hover:text-white'
                                }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className={`w-2.5 h-2.5 rounded-full ${rItem.dot} shrink-0`} />
                                <div className="min-w-0">
                                  <div className="font-extrabold text-xs truncate">{rItem.label}</div>
                                  <div className="text-[10px] text-slate-400 font-mono truncate">{rItem.sub}</div>
                                </div>
                              </div>
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold shrink-0 ${isSelected ? 'bg-purple-950 text-purple-200 border border-purple-400/50' : 'bg-black/40 text-slate-400'
                                }`}>
                                {activeCount}/{ALL_PAGE_IDS.length}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: 10 Portal Cards Grid for Selected Role */}
                  <div className="lg:col-span-8 xl:col-span-9 space-y-4">
                    {(() => {
                      const roleId = selectedMobileRole;
                      const isMembers = roleId === 'Members';
                      const isFaculty = roleId === 'Faculty';
                      const title = isMembers ? 'Chapter Members' : isFaculty ? 'Faculty Advisory' : roleId;
                      const sub = isMembers
                        ? 'Authenticated Student Tier'
                        : isFaculty
                          ? 'Academic Mentors Tier'
                          : ['Admin', 'Payment Admin', 'Technical'].includes(roleId)
                            ? 'Core Administrative Role'
                            : 'Custom Role';
                      const dotColor = isMembers ? 'bg-cyan-400' : isFaculty ? 'bg-indigo-400' : 'bg-purple-500';

                      return (
                        <div className="space-y-4">
                          {/* Role Header Banner with 1-Tap Batch Presets */}
                          <div className="p-4 rounded-2xl bg-[#0e071c] border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
                            <div className="flex items-center gap-2.5">
                              <span className={`w-3.5 h-3.5 rounded-full ${dotColor} shrink-0`} />
                              <div>
                                <h3 className="font-black text-white text-sm sm:text-base">{title}</h3>
                                <span className="text-xs text-slate-400 font-mono">{sub}</span>
                              </div>
                            </div>

                            {/* Presets */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() =>
                                  handleApplyRolePreset(isMembers ? 'members' : isFaculty ? 'faculty' : roleId, 'view_all')
                                }
                                className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-purple-900/40 border border-purple-500/30 text-purple-300 hover:bg-purple-900/80 cursor-pointer transition-colors"
                                title="Grant View Only on all portals"
                              >
                                View All ({ALL_PAGE_IDS.length})
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleApplyRolePreset(isMembers ? 'members' : isFaculty ? 'faculty' : roleId, 'edit_all')
                                }
                                className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-950/80 cursor-pointer transition-colors"
                                title="Grant Full Write Authority on all portals"
                              >
                                Full All ({ALL_PAGE_IDS.length})
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleApplyRolePreset(isMembers ? 'members' : isFaculty ? 'faculty' : roleId, 'lock_all')
                                }
                                className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-black/40 border border-white/10 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 cursor-pointer transition-colors"
                                title="Lock all portals for this role"
                              >
                                Lock All
                              </button>
                            </div>
                          </div>

                          {/* 10 Portal Cards Grid (Zero Horizontal Scroll!) */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {ALL_PAGE_IDS.map((p) => {
                              const perm: PagePermission = isMembers
                                ? permissions.tiers.members?.[p.id] || { canView: false, canEdit: false, bypassMaintenance: false }
                                : isFaculty
                                  ? permissions.tiers.faculty?.[p.id] || { canView: false, canEdit: false, bypassMaintenance: false }
                                  : permissions.roles[roleId]?.[p.id] || { canView: false, canEdit: false, bypassMaintenance: false };

                              const setLevel = (level: 'none' | 'view' | 'edit') => {
                                if (isMembers) handleSetTierAccessLevel('members', p.id, level);
                                else if (isFaculty) handleSetTierAccessLevel('faculty', p.id, level);
                                else handleSetRoleAccessLevel(roleId, p.id, level);
                              };

                              const toggleBypass = () => {
                                if (isMembers) handleToggleTierPermission('members', p.id, 'bypassMaintenance');
                                else if (isFaculty) handleToggleTierPermission('faculty', p.id, 'bypassMaintenance');
                                else handleToggleRolePermission(roleId, p.id, 'bypassMaintenance');
                              };

                              const cellId = `matrix_${roleId}_${p.id}`;

                              return (
                                <div
                                  key={p.id}
                                  className="p-3.5 sm:p-4 rounded-2xl bg-[#0e071c] border border-[#2b1642] hover:border-purple-500/40 transition-all space-y-3 shadow-md"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                                        <span className="material-symbols-outlined text-base">{p.icon}</span>
                                      </div>
                                      <div className="min-w-0">
                                        <h4 className="font-extrabold text-white text-xs sm:text-sm truncate">{p.label}</h4>
                                        <span className="text-[10px] text-slate-400 font-mono block truncate">
                                          {!perm.canView
                                            ? 'Access Denied'
                                            : (p.id === 'tickets' || p.id === 'maintenance')
                                              ? 'View Allowed'
                                              : perm.canEdit
                                                ? 'Full Write Authority'
                                                : 'Read-Only Viewer'}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Permission Dropdown + Bypass Toggle */}
                                    <div className="shrink-0">
                                      {renderPermissionControl(cellId, perm, setLevel, toggleBypass, {
                                        compact: false,
                                        isBinary: p.id === 'tickets' || p.id === 'maintenance',
                                      })}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Mode B: Configure by Portal */}
              {mobileViewMode === 'by_portal' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Left Column: Portal Selector Sidebar */}
                  <div className="lg:col-span-4 xl:col-span-3 space-y-2">
                    <div className="p-3 bg-[#0e071c] border border-purple-500/20 rounded-2xl space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-purple-400 font-bold px-1 flex items-center justify-between">
                        <span>SYSTEM PORTALS</span>
                        <span className="text-slate-500">{ALL_PAGE_IDS.length} Total</span>
                      </div>
                      <div className="space-y-1.5 flex flex-row lg:flex-col overflow-x-auto lg:overflow-x-visible pb-1 lg:pb-0 custom-scrollbar">
                        {ALL_PAGE_IDS.map((p) => {
                          const isSelected = selectedMobilePortal === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setSelectedMobilePortal(p.id)}
                              className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2.5 shrink-0 lg:shrink ${isSelected
                                ? 'bg-purple-600 border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.35)] text-white font-extrabold'
                                : 'bg-[#140b24] border-[#2b1642] text-slate-300 hover:border-purple-500/40 hover:text-white'
                                }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="material-symbols-outlined text-base shrink-0">{p.icon}</span>
                                <span className="text-xs truncate">{p.label}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Role Cards Grid for Selected Portal */}
                  <div className="lg:col-span-8 xl:col-span-9 space-y-4">
                    {(() => {
                      const portal = ALL_PAGE_IDS.find((p) => p.id === selectedMobilePortal) || ALL_PAGE_IDS[0];
                      const roleItems = [
                        { id: 'Members', label: 'Chapter Members', tier: 'members' as const, sub: 'Authenticated Student Tier', dot: 'bg-cyan-400' },
                        { id: 'Faculty', label: 'Faculty Advisory', tier: 'faculty' as const, sub: 'Academic Mentors Tier', dot: 'bg-indigo-400' },
                        ...allRolesList.map((r) => ({
                          id: r,
                          label: r,
                          tier: null,
                          sub: ['Admin', 'Payment Admin', 'Technical'].includes(r) ? 'Core Administrative Role' : 'Custom Role',
                          dot: 'bg-purple-500',
                        })),
                      ];

                      return (
                        <div className="space-y-4">
                          {/* Portal Header Banner */}
                          <div className="p-4 rounded-2xl bg-[#0e071c] border border-purple-500/30 flex items-center justify-between gap-3 shadow-lg">
                            <div className="flex items-center gap-2.5">
                              <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
                                <span className="material-symbols-outlined text-lg">{portal.icon}</span>
                              </div>
                              <div>
                                <h3 className="font-black text-white text-base">{portal.label}</h3>
                                <span className="text-xs text-slate-400 font-mono">
                                  {(portal.id === 'tickets' || portal.id === 'maintenance')
                                    ? 'Binary Visibility Governance (View Allowed vs No Access)'
                                    : 'Role Access Governance'}
                                </span>
                              </div>
                            </div>
                            <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-purple-950 text-purple-300 border border-purple-600/40">
                              {roleItems.length} Roles
                            </span>
                          </div>

                          {/* Role Cards Grid (Zero Horizontal Scroll!) */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {roleItems.map((r) => {
                              const perm: PagePermission =
                                r.tier === 'members'
                                  ? permissions.tiers.members?.[portal.id] || { canView: false, canEdit: false, bypassMaintenance: false }
                                  : r.tier === 'faculty'
                                    ? permissions.tiers.faculty?.[portal.id] || { canView: false, canEdit: false, bypassMaintenance: false }
                                    : permissions.roles[r.id]?.[portal.id] || { canView: false, canEdit: false, bypassMaintenance: false };

                              const setLevel = (level: 'none' | 'view' | 'edit') => {
                                if (r.tier === 'members') handleSetTierAccessLevel('members', portal.id, level);
                                else if (r.tier === 'faculty') handleSetTierAccessLevel('faculty', portal.id, level);
                                else handleSetRoleAccessLevel(r.id, portal.id, level);
                              };

                              const toggleBypass = () => {
                                if (r.tier === 'members') handleToggleTierPermission('members', portal.id, 'bypassMaintenance');
                                else if (r.tier === 'faculty') handleToggleTierPermission('faculty', portal.id, 'bypassMaintenance');
                                else handleToggleRolePermission(r.id, portal.id, 'bypassMaintenance');
                              };

                              const cellId = `portal_grid_${portal.id}_${r.id}`;

                              return (
                                <div
                                  key={r.id}
                                  className="p-3.5 sm:p-4 rounded-2xl bg-[#0e071c] border border-[#2b1642] hover:border-purple-500/40 transition-all space-y-3 shadow-md"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <span className={`w-2.5 h-2.5 rounded-full ${r.dot} shrink-0`} />
                                      <div className="min-w-0">
                                        <h4 className="font-extrabold text-white text-xs sm:text-sm truncate">{r.label}</h4>
                                        <span className="text-[10px] text-slate-400 font-mono block truncate">
                                          {!perm.canView
                                            ? 'Access Denied'
                                            : (portal.id === 'tickets' || portal.id === 'maintenance')
                                              ? 'View Allowed'
                                              : perm.canEdit
                                                ? 'Full Write Authority'
                                                : 'Read-Only Viewer'} • {r.sub}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="shrink-0">
                                      {renderPermissionControl(cellId, perm, setLevel, toggleBypass, {
                                        compact: false,
                                        isBinary: portal.id === 'tickets' || portal.id === 'maintenance',
                                      })}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: ROLES & ADMINS                                                */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'roles' && (
          <div className="space-y-6">

            {/* Custom Roles Registry Block */}
            <div className="p-5 bg-[#0e071a] border border-[#261238] rounded-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-400 text-base">military_tech</span>
                    <span>Registered System &amp; Custom Roles</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    System roles (Admin, Payment Admin, Technical) are permanent. Custom roles can be created, configured, or removed.
                  </p>
                </div>

                {/* Add Custom Role Form */}
                <form onSubmit={handleCreateCustomRole} className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto">
                  <input
                    type="text"
                    placeholder="New Role (e.g. Lead, Event Admin)"
                    value={newCustomRoleName}
                    onChange={(e) => setNewCustomRoleName(e.target.value)}
                    className="flex-1 sm:flex-initial px-3 py-1.5 bg-[#160b26] border border-purple-900/60 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    type="submit"
                    disabled={creatingCustomRole || !newCustomRoleName.trim()}
                    className="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shrink-0"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    <span>Add Role</span>
                  </button>
                </form>
              </div>

              {/* Role Pills */}
              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                {['Admin', 'Payment Admin', 'Technical'].map((sysRole) => (
                  <span
                    key={sysRole}
                    className="px-3 py-1.5 rounded-xl bg-purple-950/80 border border-purple-600 text-purple-200 text-xs font-bold font-mono flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <span>{sysRole} (System)</span>
                  </span>
                ))}

                {(permissions.customRoles || []).map((cRole) => (
                  <span
                    key={cRole}
                    className="px-3 py-1.5 rounded-xl bg-[#1a0f2b] border border-purple-500/40 text-white text-xs font-bold font-mono flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span>{cRole}</span>
                    <button
                      onClick={() =>
                        setDeleteConfirm({
                          type: 'role',
                          id: cRole,
                          label: `Custom Role: "${cRole}"`,
                        })
                      }
                      className="text-slate-400 hover:text-rose-400 cursor-pointer ml-1"
                      title="Delete Custom Role"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Admin Accounts Table */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-lg">search</span>
                  <input
                    type="text"
                    placeholder="Search admins by name, email, or role..."
                    value={adminSearch}
                    onChange={(e) => setAdminSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-[#12081f] border border-[#2d1445] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                </div>
                <button
                  onClick={() => {
                    setAdminError('');
                    setIsAddAdminOpen(true);
                  }}
                  className="px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-[0_0_15px_rgba(147,51,234,0.3)] shrink-0"
                >
                  <span className="material-symbols-outlined text-base">person_add</span>
                  Add New Admin
                </button>
              </div>

              {/* Add Admin Form Card */}
              {isAddAdminOpen && (
                <form onSubmit={handleAddAdmin} className="p-4 sm:p-5 bg-[#12081f] border border-purple-500/50 rounded-2xl space-y-3 shadow-lg animate-fade-in">
                  <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-400 text-sm">person_add</span>
                    Assign Admin Authority
                  </h4>

                  {adminError && (
                    <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs font-medium">
                      {adminError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">EMAIL ADDRESS *</label>
                      <input
                        type="email"
                        required
                        placeholder="member@vitbhopal.ac.in"
                        value={newAdminEmail}
                        onChange={(e) => setNewAdminEmail(e.target.value)}
                        className="w-full px-3 py-2 bg-[#1c0f2e] border border-purple-900/60 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">FULL NAME</label>
                      <input
                        type="text"
                        placeholder="e.g. John Doe"
                        value={newAdminName}
                        onChange={(e) => setNewAdminName(e.target.value)}
                        className="w-full px-3 py-2 bg-[#1c0f2e] border border-purple-900/60 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">ASSIGNED ROLE</label>
                      <select
                        value={newAdminRole}
                        onChange={(e) => setNewAdminRole(e.target.value)}
                        className="w-full px-3 py-2 bg-[#1c0f2e] border border-purple-900/60 rounded-lg text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                      >
                        {allRolesList.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsAddAdminOpen(false)}
                      className="px-3 py-1.5 bg-[#26133d] hover:bg-[#331852] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submittingAdmin}
                      className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {submittingAdmin && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                      Save to Firestore
                    </button>
                  </div>
                </form>
              )}

              {/* Mobile Cards (Zero Horizontal Scroll) */}
              <div className="md:hidden space-y-3">
                {loadingAdmins ? (
                  <div className="p-8 text-center text-slate-400 bg-[#0c0517] border border-[#2b1442] rounded-2xl">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                      <span className="text-xs">Loading Firestore admins...</span>
                    </div>
                  </div>
                ) : filteredAdmins.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 bg-[#0c0517] border border-[#2b1442] rounded-2xl text-xs">
                    No admin records match the search.
                  </div>
                ) : (
                  filteredAdmins.map((adm) => {
                    const isCurrent = adm.email.toLowerCase() === currentUserEmail.toLowerCase();
                    return (
                      <div key={adm.id} className="p-4 rounded-2xl bg-[#0c0517] border border-[#2b1442] space-y-3 shadow-md w-full min-w-0">
                        {/* Top: Name, Tier Badge */}
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-purple-950 border border-purple-600 flex items-center justify-center text-purple-300 font-black text-xs shrink-0">
                              {adm.name ? adm.name.charAt(0).toUpperCase() : 'A'}
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-white text-xs sm:text-sm truncate">{adm.name || 'Admin Member'}</h4>
                              <div className="text-[11px] text-purple-400 font-mono truncate">{adm.email}</div>
                            </div>
                          </div>
                          <div className="shrink-0">
                            {adm.role === 'Super Administrator' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-900/80 text-purple-200 border border-purple-600">
                                SUPER ADMIN
                              </span>
                            ) : (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${adm.role === 'Technical'
                                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-600/50'
                                : adm.role === 'Payment Admin'
                                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/50'
                                  : 'bg-purple-950/80 text-purple-300 border border-purple-600/50'
                                }`}>
                                {adm.role ? adm.role.toUpperCase() : 'ADMIN'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Role Selector */}
                        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#140b24] border border-[#261238] text-xs">
                          <span className="text-[10px] text-slate-400 uppercase font-mono font-bold shrink-0">ASSIGNED ROLE:</span>
                          {adm.role === 'Super Administrator' ? (
                            <span className="text-xs font-bold text-purple-300">Super Administrator</span>
                          ) : (
                            <select
                              value={adm.role || 'Admin'}
                              onChange={(e) => handleUpdateAdminRole(adm.email, e.target.value)}
                              className="px-2.5 py-1 bg-[#160b26] border border-purple-900/60 rounded text-xs font-semibold text-white focus:outline-none focus:border-purple-500 cursor-pointer min-w-0 flex-1 text-right"
                              title="Change role in Firestore"
                            >
                              {allRolesList.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        {/* Footer: Added By & Action */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-purple-500/10">
                          <span className="text-[10px] font-mono text-slate-400">
                            Added by: <strong className="text-slate-300">{formatAddedBy(adm.addedBy)}</strong>
                          </span>
                          {isCurrent ? (
                            <span className="text-[10px] font-semibold text-purple-400 italic">Current Session (You)</span>
                          ) : adm.isSuperAdmin || adm.role === 'Super Administrator' ? (
                            <span className="px-2.5 py-1 bg-purple-950/40 text-purple-300 text-[10px] font-bold rounded border border-purple-700/50 flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs">shield</span>
                              <span>Protected Super Admin</span>
                            </span>
                          ) : (
                            <button
                              onClick={() =>
                                setDeleteConfirm({
                                  type: 'admin',
                                  id: adm.email,
                                  label: `Admin: ${adm.name} (${adm.email})`,
                                })
                              }
                              className="px-3 py-1 bg-rose-950/50 hover:bg-rose-900 text-rose-300 text-xs font-bold rounded-lg border border-rose-800/50 transition-colors cursor-pointer flex items-center gap-1"
                              title="Drop Admin Privileges"
                            >
                              <span className="material-symbols-outlined text-xs">person_remove</span>
                              <span>Drop Admin</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Desktop Table (hidden on mobile) */}
              <div className="hidden md:block border border-[#2b1442] rounded-2xl overflow-hidden bg-[#0c0517] overflow-x-auto custom-scrollbar shadow-md">
                <table className="w-full text-left text-xs min-w-[640px]">
                  <thead className="bg-[#140b24] border-b border-[#2b1442] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-3.5">Admin Profile</th>
                      <th className="p-3.5">Role</th>
                      <th className="p-3.5">Authority Tier</th>
                      <th className="p-3.5">Added By</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e0f33]">
                    {loadingAdmins ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-400">
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                            <span>Loading Firestore admins...</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredAdmins.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-400">
                          No admin records match the search.
                        </td>
                      </tr>
                    ) : (
                      filteredAdmins.map((adm) => {
                        const isCurrent = adm.email.toLowerCase() === currentUserEmail.toLowerCase();
                        return (
                          <tr key={adm.id} className="hover:bg-[#150a29] transition-colors">
                            <td className="p-3.5">
                              <div className="font-bold text-white">{adm.name}</div>
                              <div className="text-[11px] text-purple-400 font-mono">{adm.email}</div>
                            </td>
                            <td className="p-3.5">
                              {adm.role === 'Super Administrator' ? (
                                <span className="font-bold text-purple-300">Super Administrator</span>
                              ) : (
                                <select
                                  value={adm.role || 'Admin'}
                                  onChange={(e) => handleUpdateAdminRole(adm.email, e.target.value)}
                                  className="px-2.5 py-1 bg-[#160b26] border border-purple-900/60 rounded text-[11px] font-semibold text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                                  title="Change role in Firestore"
                                >
                                  {allRolesList.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="p-3.5">
                              {adm.role === 'Super Administrator' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-900/80 text-purple-200 border border-purple-600">
                                  SUPER ADMIN
                                </span>
                              ) : (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${adm.role === 'Technical'
                                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-600/50'
                                  : adm.role === 'Payment Admin'
                                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/50'
                                    : 'bg-purple-950/80 text-purple-300 border border-purple-600/50'
                                  }`}>
                                  {adm.role ? adm.role.toUpperCase() : 'ADMIN'}
                                </span>
                              )}
                            </td>
                            <td className="p-3.5 text-slate-400 text-[11px] font-mono">
                              {formatAddedBy(adm.addedBy)}
                            </td>
                            <td className="p-3.5 text-right">
                              {isCurrent ? (
                                <span className="text-[10px] font-semibold text-purple-400 italic">Current Session (You)</span>
                              ) : adm.isSuperAdmin || adm.role === 'Super Administrator' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-purple-950/50 text-purple-300 text-[10px] font-bold border border-purple-700/50" title="Super Administrators hold equal authority and cannot drop each other">
                                  <span className="material-symbols-outlined text-xs">shield</span>
                                  <span>Protected</span>
                                </span>
                              ) : (
                                <button
                                  onClick={() =>
                                    setDeleteConfirm({
                                      type: 'admin',
                                      id: adm.email,
                                      label: `Admin: ${adm.name} (${adm.email})`,
                                    })
                                  }
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
                                  title="Drop Admin Privileges"
                                >
                                  <span className="material-symbols-outlined text-base">person_remove</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* TAB 3: CLUB DOMAINS & POSITIONS METADATA                             */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'metadata' && (
          <div className="space-y-6">
            {metadataSuccess && (
              <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-600/40 text-emerald-300 text-xs font-bold">
                {metadataSuccess}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Primary Domains Registry */}
              <div className="p-5 bg-[#0e071a] border border-[#261238] rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                      <span className="material-symbols-outlined text-purple-400 text-base">domain</span>
                      <span>Primary Domains ({clubMetadata.domains.length})</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Domains populate the required domain dropdown in Members Roster and recruitment pipelines.
                    </p>
                  </div>
                </div>

                {/* Add Domain Form */}
                <form onSubmit={handleAddDomain} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="New Domain (e.g. AI & Robotics)"
                    value={newDomainInput}
                    onChange={(e) => setNewDomainInput(e.target.value)}
                    className="flex-1 px-3 py-2 bg-[#160b26] border border-purple-900/60 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    type="submit"
                    disabled={savingMetadata || !newDomainInput.trim()}
                    className="px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    <span>Add</span>
                  </button>
                </form>

                {/* Domains List */}
                <div className="space-y-2 max-h-[380px] overflow-y-auto custom-scrollbar pr-1">
                  {clubMetadata.domains.map((dom) => (
                    <div
                      key={dom}
                      className="flex items-center justify-between p-3 rounded-xl bg-[#140b24] border border-[#2b1442] text-xs font-bold text-white hover:border-purple-500/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="material-symbols-outlined text-purple-400 text-base shrink-0">folder_special</span>
                        <span className="truncate">{dom}</span>
                      </div>
                      <button
                        onClick={() =>
                          setDeleteConfirm({
                            type: 'domain',
                            id: dom,
                            label: `Domain: "${dom}"`,
                          })
                        }
                        className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                        title="Delete Domain"
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Club Hierarchy & Positions Registry */}
              <div className="p-5 bg-[#0e071a] border border-[#261238] rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                      <span className="material-symbols-outlined text-purple-400 text-base">stars</span>
                      <span>Club Positions &amp; Roles ({clubMetadata.positions.length})</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Positions populate the required role dropdown in Members Roster and digital identity cards.
                    </p>
                  </div>
                </div>

                {/* Add Position Form */}
                <form onSubmit={handleAddPosition} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="New Role (e.g. Technical Director)"
                    value={newPositionInput}
                    onChange={(e) => setNewPositionInput(e.target.value)}
                    className="flex-1 px-3 py-2 bg-[#160b26] border border-purple-900/60 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    type="submit"
                    disabled={savingMetadata || !newPositionInput.trim()}
                    className="px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    <span>Add</span>
                  </button>
                </form>

                {/* Positions List */}
                <div className="space-y-2 max-h-[380px] overflow-y-auto custom-scrollbar pr-1">
                  {clubMetadata.positions.map((pos) => (
                    <div
                      key={pos}
                      className="flex items-center justify-between p-3 rounded-xl bg-[#140b24] border border-[#2b1442] text-xs font-bold text-white hover:border-purple-500/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="material-symbols-outlined text-indigo-400 text-base shrink-0">workspace_premium</span>
                        <span className="truncate">{pos}</span>
                      </div>
                      <button
                        onClick={() =>
                          setDeleteConfirm({
                            type: 'position',
                            id: pos,
                            label: `Position: "${pos}"`,
                          })
                        }
                        className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                        title="Delete Position"
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* TAB 4: FACULTY DATABASE TABLE                                        */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'faculty' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-lg">search</span>
                <input
                  type="text"
                  placeholder="Search faculty by name, email, department..."
                  value={facultySearch}
                  onChange={(e) => setFacultySearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#12081f] border border-[#2d1445] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
              <button
                onClick={() => openFacultyForm()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-[0_0_15px_rgba(99,102,241,0.3)] shrink-0"
              >
                <span className="material-symbols-outlined text-base">add</span>
                Register Faculty Advisor
              </button>
            </div>

            {/* Faculty Modal */}
            {isFacultyModalOpen && (
              <form onSubmit={handleSaveFaculty} className="p-4 sm:p-5 bg-[#12081f] border border-indigo-500/50 rounded-2xl space-y-3 shadow-lg animate-fade-in">
                <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="material-symbols-outlined text-indigo-400 text-sm">school</span>
                  {editingFaculty ? 'Edit Faculty Record' : 'Register Faculty Advisor'}
                </h4>

                {facultyError && (
                  <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs font-medium">
                    {facultyError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">FACULTY NAME *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Dr. Jane Smith"
                      value={facultyFormData.name}
                      onChange={(e) => setFacultyFormData({ ...facultyFormData, name: e.target.value })}
                      className="w-full px-3 py-2 bg-[#1c0f2e] border border-purple-900/60 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">EMAIL ADDRESS *</label>
                    <input
                      type="email"
                      required
                      disabled={!!editingFaculty}
                      placeholder="faculty@vitbhopal.ac.in"
                      value={facultyFormData.email}
                      onChange={(e) => setFacultyFormData({ ...facultyFormData, email: e.target.value })}
                      className="w-full px-3 py-2 bg-[#1c0f2e] border border-purple-900/60 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">FACULTY ID</label>
                    <input
                      type="text"
                      placeholder="e.g. EMP1024"
                      value={facultyFormData.facultyId}
                      onChange={(e) => setFacultyFormData({ ...facultyFormData, facultyId: e.target.value })}
                      className="w-full px-3 py-2 bg-[#1c0f2e] border border-purple-900/60 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">DEPARTMENT / SCHOOL</label>
                    <input
                      type="text"
                      placeholder="e.g. SCSE / Gaming Tech"
                      value={facultyFormData.department}
                      onChange={(e) => setFacultyFormData({ ...facultyFormData, department: e.target.value })}
                      className="w-full px-3 py-2 bg-[#1c0f2e] border border-purple-900/60 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">CLUB DESIGNATION</label>
                    <input
                      type="text"
                      placeholder="e.g. Faculty Mentor"
                      value={facultyFormData.designation}
                      onChange={(e) => setFacultyFormData({ ...facultyFormData, designation: e.target.value })}
                      className="w-full px-3 py-2 bg-[#1c0f2e] border border-purple-900/60 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">CONTACT PHONE</label>
                    <input
                      type="text"
                      placeholder="Optional phone"
                      value={facultyFormData.phone}
                      onChange={(e) => setFacultyFormData({ ...facultyFormData, phone: e.target.value })}
                      className="w-full px-3 py-2 bg-[#1c0f2e] border border-purple-900/60 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsFacultyModalOpen(false)}
                    className="px-3 py-1.5 bg-[#26133d] hover:bg-[#331852] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingFaculty}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {submittingFaculty && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    Save Faculty Record
                  </button>
                </div>
              </form>
            )}

            {/* Mobile Cards (Zero Horizontal Scroll) */}
            <div className="md:hidden space-y-3">
              {loadingFaculty ? (
                <div className="p-8 text-center text-slate-400 bg-[#0c0517] border border-[#2b1442] rounded-2xl">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    <span className="text-xs">Loading Faculty records...</span>
                  </div>
                </div>
              ) : filteredFaculty.length === 0 ? (
                <div className="p-6 text-center text-slate-400 bg-[#0c0517] border border-[#2b1442] rounded-2xl text-xs">
                  No faculty records match the search.
                </div>
              ) : (
                filteredFaculty.map((f) => (
                  <div key={f.email} className="p-4 rounded-2xl bg-[#0c0517] border border-[#2b1442] space-y-3 shadow-md w-full min-w-0">
                    {/* Top: Name, Designation */}
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-indigo-950 border border-indigo-600 flex items-center justify-center text-indigo-300 shrink-0">
                          <span className="material-symbols-outlined text-base">school</span>
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-white text-xs sm:text-sm truncate">{f.name}</h4>
                          <div className="text-[11px] text-indigo-400 font-mono truncate">{f.email}</div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-600/50 shrink-0">
                        {f.designation || 'Faculty Advisor'}
                      </span>
                    </div>

                    {/* Department & Phone */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-[#140b24] border border-[#261238] p-2.5 rounded-xl">
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">DEPT:</span>
                        <span className="text-slate-200 truncate block">{f.department || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">PHONE:</span>
                        <span className="text-slate-200 truncate block">{f.phone || '—'}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-purple-500/10">
                      <button
                        onClick={() => openFacultyForm(f)}
                        className="px-3 py-1 bg-indigo-950/60 hover:bg-indigo-900 text-indigo-300 text-xs font-bold rounded-lg border border-indigo-800/50 transition-colors cursor-pointer flex items-center gap-1"
                        title="Edit Faculty Record"
                      >
                        <span className="material-symbols-outlined text-xs">edit</span>
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() =>
                          setDeleteConfirm({
                            type: 'faculty',
                            id: f.email,
                            label: `Faculty: ${f.name} (${f.email})`,
                          })
                        }
                        className="px-3 py-1 bg-rose-950/50 hover:bg-rose-900 text-rose-300 text-xs font-bold rounded-lg border border-rose-800/50 transition-colors cursor-pointer flex items-center gap-1"
                        title="Delete Faculty Record"
                      >
                        <span className="material-symbols-outlined text-xs">delete</span>
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Desktop Table (hidden on mobile) */}
            <div className="hidden md:block border border-[#2b1442] rounded-2xl overflow-hidden bg-[#0c0517] overflow-x-auto custom-scrollbar shadow-md">
              <table className="w-full text-left text-xs min-w-[650px]">
                <thead className="bg-[#140b24] border-b border-[#2b1442] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-3.5">Faculty Member</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">Designation</th>
                    <th className="p-3.5">Contact</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e0f33]">
                  {loadingFaculty ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                          <span>Loading Faculty records...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredFaculty.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        No faculty records match the search.
                      </td>
                    </tr>
                  ) : (
                    filteredFaculty.map((f) => (
                      <tr key={f.email} className="hover:bg-[#150a29] transition-colors">
                        <td className="p-3.5">
                          <div className="font-bold text-white">{f.name}</div>
                          <div className="text-[11px] text-indigo-400 font-mono">{f.email}</div>
                        </td>
                        <td className="p-3.5 text-slate-300">
                          {f.department || '—'}
                        </td>
                        <td className="p-3.5 text-slate-300">
                          {f.designation || 'Faculty Advisor'}
                        </td>
                        <td className="p-3.5 text-slate-400 font-mono text-[11px]">
                          {f.phone || '—'}
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openFacultyForm(f)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                              title="Edit Faculty Record"
                            >
                              <span className="material-symbols-outlined text-base">edit</span>
                            </button>
                            <button
                              onClick={() =>
                                setDeleteConfirm({
                                  type: 'faculty',
                                  id: f.email,
                                  label: `Faculty: ${f.name} (${f.email})`,
                                })
                              }
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
                              title="Delete Faculty Record"
                            >
                              <span className="material-symbols-outlined text-base">delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* TAB 5: VISITOR PRESENCE & SESSION DURATION AUDIT                     */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'audit' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Header Card */}
            <div className="p-4 sm:p-6 bg-[#0e0618] border border-purple-600/40 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-400">visibility</span>
                    Visitor Presence &amp; Session Duration Audit
                  </h3>
                  {onlineCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      {onlineCount} ACTIVE NOW
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                  Streamlined tracking of individuals entering the website. Displays visitor identity, exact entry timestamp, device environment, and active online presence without background overhead.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => fetchAuditSessions(true)}
                  disabled={isRefreshingSessions}
                  className="px-3 py-2 bg-purple-900/40 hover:bg-purple-800/60 border border-purple-600/40 text-purple-200 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  title="Refresh audit sessions"
                >
                  <span className={`material-symbols-outlined text-sm ${isRefreshingSessions ? 'animate-spin' : ''}`}>
                    refresh
                  </span>
                  <span>{isRefreshingSessions ? 'Refreshing...' : 'Refresh'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleSelectPurgePreset('all');
                    setIsPurgeModalOpen(true);
                  }}
                  className="px-3 py-2 bg-rose-950/50 hover:bg-rose-900/70 border border-rose-600/40 text-rose-300 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Permanently delete audit sessions for a scheduled or custom time window"
                >
                  <span className="material-symbols-outlined text-sm">delete_sweep</span>
                  <span>Delete Logs</span>
                </button>
              </div>
            </div>

            {purgeSuccessMessage && (
              <div className="p-3.5 bg-emerald-950/70 border border-emerald-500/50 rounded-2xl text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in shadow-lg">
                <span className="material-symbols-outlined text-base text-emerald-400">check_circle</span>
                <span>{purgeSuccessMessage}</span>
              </div>
            )}

            {/* 4 Summary Analytics Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* Card 1: Active Right Now */}
              <div className="p-4 rounded-2xl bg-[#0e071c] border border-emerald-500/30 space-y-1 shadow-md">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-black uppercase tracking-wider font-mono">ACTIVE RIGHT NOW</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                </div>
                <div className="text-2xl sm:text-3xl font-black text-emerald-300 font-mono flex items-baseline gap-2">
                  <span>{onlineCount}</span>
                  <span className="text-[10px] font-normal text-emerald-400/80 font-sans">currently online</span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono">Live visitors actively on website</p>
              </div>

              {/* Card 2: Total Tracked Sessions */}
              <div className="p-4 rounded-2xl bg-[#0e071c] border border-purple-500/30 space-y-1 shadow-md">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-black uppercase tracking-wider font-mono">TOTAL SESSIONS</span>
                  <span className="material-symbols-outlined text-sm text-purple-400">groups</span>
                </div>
                <div className="text-2xl sm:text-3xl font-black text-white font-mono flex items-baseline gap-2">
                  <span>{sessions.length}</span>
                  <span className="text-[10px] font-normal text-purple-300/80 font-sans">total visits</span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono">Historical entry presence logs</p>
              </div>

              {/* Card 3: Identified Members */}
              <div className="p-4 rounded-2xl bg-[#0e071c] border border-cyan-500/30 space-y-1 shadow-md">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-black uppercase tracking-wider font-mono">IDENTIFIED MEMBERS</span>
                  <span className="material-symbols-outlined text-sm text-cyan-400">verified_user</span>
                </div>
                <div className="text-2xl sm:text-3xl font-black text-cyan-300 font-mono flex items-baseline gap-2">
                  <span>{membersCount}</span>
                  <span className="text-[10px] font-normal text-cyan-400/80 font-sans">registered</span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono">Authenticated member sessions</p>
              </div>

              {/* Card 4: Guest Visitors */}
              <div className="p-4 rounded-2xl bg-[#0e071c] border border-amber-500/30 space-y-1 shadow-md">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-black uppercase tracking-wider font-mono">GUEST VISITORS</span>
                  <span className="material-symbols-outlined text-sm text-amber-400">person_outline</span>
                </div>
                <div className="text-xl sm:text-2xl font-black text-amber-300 font-mono flex items-baseline gap-2">
                  <span>{guestsCount}</span>
                  <span className="text-xs text-slate-400 font-mono font-normal">anonymous</span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono">Guest portal visits</p>
              </div>
            </div>

            {/* Search & Filter Toolbar */}
            <div className="p-4 bg-[#0e071c] border border-[#26133b] rounded-2xl space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                {/* Search input */}
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                    search
                  </span>
                  <input
                    type="text"
                    placeholder="Filter by Name, Email, Device, or Role..."
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-[#160b26] border border-purple-900/60 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                {/* Date Scope Filter */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-bold shrink-0">SCOPE:</span>
                  {(['all', 'today', 'week'] as const).map((dScope) => (
                    <button
                      key={dScope}
                      onClick={() => setSessionDateFilter(dScope)}
                      className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg border transition-all cursor-pointer ${sessionDateFilter === dScope
                        ? 'bg-purple-600 border-purple-400 text-white'
                        : 'bg-[#160b26] border-purple-900/40 text-slate-400 hover:text-white'
                        }`}
                    >
                      {dScope === 'all' ? 'All Time' : dScope === 'today' ? 'Today' : 'Last 7 Days'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status Filter Chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-purple-500/10">
                <span className="text-[10px] font-mono text-slate-400 uppercase font-bold mr-1 shrink-0">STATUS:</span>
                <button
                  onClick={() => setSessionStatusFilter('all')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${sessionStatusFilter === 'all'
                    ? 'bg-purple-600 border-purple-400 text-white'
                    : 'bg-[#160b26] border-purple-900/40 text-slate-400 hover:text-white'
                    }`}
                >
                  All Sessions ({sessions.length})
                </button>

                <button
                  onClick={() => setSessionStatusFilter('online')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${sessionStatusFilter === 'online'
                    ? 'bg-emerald-600 border-emerald-400 text-white'
                    : 'bg-[#160b26] border-emerald-900/40 text-emerald-400 hover:bg-emerald-950/40'
                    }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Online Now ({onlineCount})
                </button>

                <button
                  onClick={() => setSessionStatusFilter('members')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${sessionStatusFilter === 'members'
                    ? 'bg-purple-600 border-purple-400 text-white'
                    : 'bg-[#160b26] border-purple-900/40 text-slate-400 hover:text-white'
                    }`}
                >
                  Identified Members ({membersCount})
                </button>

                <button
                  onClick={() => setSessionStatusFilter('guests')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${sessionStatusFilter === 'guests'
                    ? 'bg-purple-600 border-purple-400 text-white'
                    : 'bg-[#160b26] border-purple-900/40 text-slate-400 hover:text-white'
                    }`}
                >
                  Guest Visitors ({guestsCount})
                </button>

                {sessionSearch && (
                  <button
                    onClick={() => setSessionSearch('')}
                    className="ml-auto text-[10px] text-purple-400 hover:text-purple-300 underline font-mono cursor-pointer"
                  >
                    Clear search
                  </button>
                )}
              </div>
            </div>

            {/* Mobile View: Cards */}
            <div className="md:hidden space-y-3">
              {loadingSessions ? (
                <div className="p-8 text-center text-slate-400 bg-[#0c0517] border border-[#2b1442] rounded-2xl">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                    <span className="text-xs">Loading presence audit logs...</span>
                  </div>
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="p-6 text-center text-slate-400 bg-[#0c0517] border border-[#2b1442] rounded-2xl text-xs">
                  No visitor sessions match your current filter.
                </div>
              ) : (
                filteredSessions.map((s) => {
                  const isOnline = isSessionOnline(s);

                  return (
                    <div
                      key={s.id}
                      className={`p-4 rounded-2xl border space-y-3 shadow-md w-full min-w-0 transition-all ${isOnline
                        ? 'bg-[#0b141a] border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.1)]'
                        : 'bg-[#0c0517] border-[#2b1442]'
                        }`}
                    >
                      {/* Header: User & Live Status */}
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {s.userPhoto ? (
                            <img
                              src={s.userPhoto}
                              alt="Avatar"
                              className="w-8 h-8 rounded-full object-cover border border-purple-400/50 shrink-0"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border ${s.isLoggedIn
                              ? 'bg-purple-950 border-purple-600 text-purple-300'
                              : 'bg-slate-900 border-slate-700 text-slate-400'
                              }`}>
                              {s.isLoggedIn ? (s.userName?.charAt(0).toUpperCase() || 'M') : 'G'}
                            </div>
                          )}
                          <div className="min-w-0">
                            <h4 className="font-bold text-white text-xs sm:text-sm truncate">
                              {s.userName || 'Guest Visitor'}
                            </h4>
                            <div className="text-[10px] text-purple-400 font-mono truncate">
                              {s.userEmail || 'Unauthenticated Visitor'}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-1.5">
                          {isOnline ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 flex items-center gap-1 animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              ONLINE NOW
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#1b1226] text-slate-400 border border-[#2b1d3d]">
                              OFFLINE
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirm({
                                type: 'session',
                                id: s.id,
                                label: `${s.userName || 'Visitor'} session from ${formatAuditDateTime(s.enteredAt)}`,
                              })
                            }
                            className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Delete this session record permanently"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </div>
                      </div>

                      {/* Role & Device Row */}
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                        {(() => {
                          const displayRole = resolveSessionDisplayRole(s);
                          return (
                            <span className={`px-2 py-0.5 rounded font-bold uppercase ${displayRole === 'Super Admin'
                              ? 'bg-purple-900/60 text-purple-200 border border-purple-600'
                              : displayRole === 'Technical'
                                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-600/50'
                                : displayRole === 'Payment Admin'
                                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/50'
                                  : s.isLoggedIn
                                    ? 'bg-purple-950/60 text-purple-300 border border-purple-800'
                                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                              }`}>
                              {displayRole}
                            </span>
                          );
                        })()}
                        <span className="text-slate-400 flex items-center gap-1 truncate">
                          <span className="material-symbols-outlined text-xs text-slate-400">
                            {s.deviceType === 'mobile' ? 'smartphone' : s.deviceType === 'tablet' ? 'tablet_mac' : 'computer'}
                          </span>
                          {s.device || 'Browser'}
                        </span>
                      </div>

                      {/* Entered At and Offline status */}
                      <div className="p-2.5 rounded-xl bg-[#140b24] border border-[#261238] text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-slate-400 font-mono uppercase font-bold">ENTERED AT:</span>
                          <span className="font-mono text-white text-[11px]">{formatAuditDateTime(s.enteredAt)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[9px] text-purple-400 font-mono">
                          <span>TIME AGO:</span>
                          <span>{formatAuditRelativeTime(s.enteredAt)}</span>
                        </div>
                        {!isOnline && s.leftAt && (
                          <div className="flex items-center justify-between pt-1 border-t border-purple-500/10 text-[9px] text-slate-400 font-mono">
                            <span>LEFT AT:</span>
                            <span>{formatAuditDateTime(s.leftAt)} ({formatAuditRelativeTime(s.leftAt)})</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table View (md+) - Exactly 4 Columns Requested */}
            <div className="hidden md:block border border-[#2b1442] rounded-2xl overflow-hidden bg-[#0c0517] overflow-x-auto custom-scrollbar shadow-md">
              <table className="w-full text-left text-xs min-w-[700px]">
                <thead className="bg-[#140b24] border-b border-[#2b1442] text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-3.5">Visitor Profile</th>
                    <th className="p-3.5">Entered At</th>
                    <th className="p-3.5">Device Environment</th>
                    <th className="p-3.5">Online Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e0f33]">
                  {loadingSessions ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                          <span>Loading presence audit logs...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredSessions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-400">
                        No visitor sessions match your current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredSessions.map((s) => {
                      const isOnline = isSessionOnline(s);

                      return (
                        <tr
                          key={s.id}
                          className={`transition-colors ${isOnline ? 'bg-[#0d1c24]/50 hover:bg-[#0d1c24]/80' : 'hover:bg-[#150a29]'
                            }`}
                        >
                          {/* 1. Visitor Profile */}
                          <td className="p-3.5">
                            <div className="flex items-center gap-2.5">
                              {s.userPhoto ? (
                                <img
                                  src={s.userPhoto}
                                  alt="Avatar"
                                  className="w-8 h-8 rounded-full object-cover border border-purple-400/50 shrink-0"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 border ${s.isLoggedIn
                                  ? 'bg-purple-950 border-purple-600 text-purple-300'
                                  : 'bg-slate-900 border-slate-700 text-slate-400'
                                  }`}>
                                  {s.isLoggedIn ? (s.userName?.charAt(0).toUpperCase() || 'M') : 'G'}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="font-bold text-white flex items-center gap-1.5">
                                  <span className="truncate">{s.userName || 'Guest Visitor'}</span>
                                  {isOnline && (
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" title="Online now" />
                                  )}
                                </div>
                                <div className="text-[11px] text-purple-400 font-mono truncate">
                                  {s.userEmail || 'Anonymous Guest'}
                                </div>
                                <div className="mt-0.5">
                                  {(() => {
                                    const displayRole = resolveSessionDisplayRole(s);
                                    return (
                                      <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider ${displayRole === 'Super Admin'
                                        ? 'bg-purple-900/60 text-purple-200 border border-purple-600'
                                        : displayRole === 'Technical'
                                          ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-600/50'
                                          : displayRole === 'Payment Admin'
                                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/50'
                                            : s.isLoggedIn
                                              ? 'bg-purple-950/60 text-purple-300 border border-purple-800'
                                              : 'bg-slate-900 text-slate-400 border border-slate-800'
                                        }`}>
                                        {displayRole}
                                      </span>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* 2. Entered At */}
                          <td className="p-3.5">
                            <div className="font-mono text-white text-xs">{formatAuditDateTime(s.enteredAt)}</div>
                            <div className="text-[10px] text-purple-400 font-mono mt-0.5">
                              {formatAuditRelativeTime(s.enteredAt)}
                            </div>
                          </td>

                          {/* 3. Device Environment */}
                          <td className="p-3.5 text-slate-300">
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="material-symbols-outlined text-sm text-slate-400">
                                {s.deviceType === 'mobile' ? 'smartphone' : s.deviceType === 'tablet' ? 'tablet_mac' : 'computer'}
                              </span>
                              <span className="font-semibold text-white">{s.device || 'Unknown'}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono uppercase mt-0.5">{s.deviceType}</div>
                          </td>

                          {/* 4. Online Status & Actions */}
                          <td className="p-3.5">
                            <div className="flex items-center justify-between gap-3">
                              {isOnline ? (
                                <div>
                                  <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 inline-flex items-center gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    Online Now
                                  </span>
                                  <div className="text-[10px] text-emerald-400/80 font-mono mt-0.5">Active on website</div>
                                </div>
                              ) : (
                                <div>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1e112e] text-slate-400 border border-[#3b1f5c] inline-flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                    Offline
                                  </span>
                                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                    {s.leftAt ? `Left ${formatAuditRelativeTime(s.leftAt)}` : 'Session closed'}
                                  </div>
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteConfirm({
                                    type: 'session',
                                    id: s.id,
                                    label: `${s.userName || 'Visitor'} session from ${formatAuditDateTime(s.enteredAt)}`,
                                  })
                                }
                                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                title="Delete this session record permanently"
                              >
                                <span className="material-symbols-outlined text-base">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* TAB 6: TICKET FAQS GOVERNANCE                                      */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'faqs' && (
          <div className="space-y-6">

            {/* Action & Overview Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 sm:p-5 bg-[#0e071a] border border-[#261238] rounded-2xl shadow-lg">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300">
                    <span className="material-symbols-outlined text-lg">quiz</span>
                  </span>
                  <h2 className="text-base font-black text-white uppercase tracking-tight">
                    Ticket FAQs &amp; Self-Service Knowledge Base
                  </h2>
                </div>
                <p className="text-xs text-slate-400">
                  Manage the FAQ items displayed to members above the ticket dispatching form on the Resolve Tickets page.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {faqActionMsg && (
                  <span className="px-3 py-1.5 rounded-xl bg-emerald-950 border border-emerald-500/60 text-emerald-300 text-xs font-bold animate-in fade-in">
                    {faqActionMsg}
                  </span>
                )}
                <button
                  type="button"
                  disabled={isSeedingFaqs}
                  onClick={handleSeedFaqs}
                  className="px-3.5 py-2 bg-[#170c29] hover:bg-[#251540] disabled:opacity-50 border border-purple-800/60 text-purple-300 hover:text-white text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                  title="Populate or restore standard VRGC FAQs into Firestore"
                >
                  {isSeedingFaqs ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                      <span>Seeding to Firebase...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">auto_awesome</span>
                      <span>Seed Standard FAQs</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={openAddFaqModal}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-[0_0_15px_rgba(168,85,247,0.35)] transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-base">add_circle</span>
                  <span>Add New FAQ</span>
                </button>
              </div>
            </div>

            {/* Filter & Search Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 bg-[#0c0417] border border-[#231238] rounded-2xl">
              <div className="relative flex-1 max-w-md">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Search FAQ questions or solutions..."
                  value={faqSearch}
                  onChange={(e) => setFaqSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#140b24] border border-[#2e154a] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors font-sans"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-400 font-bold uppercase hidden sm:inline">
                  Category:
                </span>
                <select
                  value={faqCategoryFilter}
                  onChange={(e) => setFaqCategoryFilter(e.target.value)}
                  className="px-3 py-2 bg-[#140b24] border border-[#2e154a] rounded-xl text-xs text-white focus:outline-none focus:border-purple-500 transition-colors cursor-pointer"
                >
                  <option value="all">All Categories ({faqs.length})</option>
                  {FAQ_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({faqs.filter((f) => f.category === c.id).length})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* FAQ List Cards */}
            {loadingFaqs ? (
              <div className="p-12 text-center text-slate-400 bg-[#0c0417] border border-[#231238] rounded-2xl space-y-2">
                <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto" />
                <p className="text-xs font-mono">Syncing Support FAQs from Firestore...</p>
              </div>
            ) : filteredFaqs.length === 0 ? (
              <div className="p-12 text-center bg-[#0c0417] border border-[#231238] rounded-2xl space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-950/60 border border-purple-500/40 text-purple-300 flex items-center justify-center mx-auto">
                  <span className="material-symbols-outlined text-2xl">help_outline</span>
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">No FAQs Found</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {faqSearch || faqCategoryFilter !== 'all'
                    ? 'No questions match your current search or category filter.'
                    : 'No FAQs have been added to Firestore yet. Add your first FAQ or seed standard defaults.'}
                </p>
                <div className="pt-2 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={openAddFaqModal}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
                  >
                    Add FAQ
                  </button>
                  <button
                    type="button"
                    disabled={isSeedingFaqs}
                    onClick={handleSeedFaqs}
                    className="px-4 py-2 bg-[#170c29] border border-purple-800 disabled:opacity-50 text-purple-300 hover:text-white text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    {isSeedingFaqs && (
                      <span className="w-3.5 h-3.5 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                    )}
                    <span>{isSeedingFaqs ? 'Seeding...' : 'Seed Standard FAQs'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredFaqs.map((faq, idx) => {
                  const cat = FAQ_CATEGORIES.find((c) => c.id === faq.category) || {
                    id: 'general',
                    label: 'General Inquiry',
                    color: 'fuchsia',
                  };
                  return (
                    <div
                      key={faq.id}
                      className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                        faq.isActive !== false
                          ? 'bg-[#0e071c] border-purple-500/30 hover:border-purple-500/60 shadow-[0_0_20px_rgba(147,51,234,0.06)]'
                          : 'bg-[#090312]/70 border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        {/* Order & Content */}
                        <div className="flex items-start gap-3 min-w-0">
                          {/* Order Badges and Reorder Controls */}
                          <div className="flex flex-col items-center gap-1 shrink-0">
                            <span className="w-7 h-7 rounded-lg bg-purple-950/80 border border-purple-600/50 text-purple-300 font-mono text-xs font-black flex items-center justify-center">
                              #{idx + 1}
                            </span>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMoveFaq(idx, 'up')}
                                className="w-6 h-5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-20 text-slate-400 hover:text-white flex items-center justify-center text-[10px] cursor-pointer"
                                title="Move FAQ up"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                disabled={idx === filteredFaqs.length - 1}
                                onClick={() => handleMoveFaq(idx, 'down')}
                                className="w-6 h-5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-20 text-slate-400 hover:text-white flex items-center justify-center text-[10px] cursor-pointer"
                                title="Move FAQ down"
                              >
                                ▼
                              </button>
                            </div>
                          </div>

                          <div className="space-y-2 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-purple-900/60 text-purple-200 border border-purple-600/40">
                                {cat.label}
                              </span>
                              {faq.isActive !== false ? (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-950 text-emerald-300 border border-emerald-600/40 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  Active &amp; Visible
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-slate-400 border border-slate-700">
                                  Hidden / Draft
                                </span>
                              )}
                              {faq.updatedBy && (
                                <span className="text-[10px] font-mono text-slate-500 hidden sm:inline truncate">
                                  by {faq.updatedBy}
                                </span>
                              )}
                            </div>

                            <h3 className="text-sm sm:text-base font-bold text-white tracking-tight leading-snug">
                              {faq.question}
                            </h3>

                            <p className="text-xs text-slate-300 leading-relaxed bg-[#140a24]/80 p-3 rounded-xl border border-purple-900/30">
                              {faq.answer}
                            </p>
                          </div>
                        </div>

                        {/* Action Controls */}
                        <div className="flex items-center gap-1.5 shrink-0 self-end lg:self-start pt-2 lg:pt-0">
                          <button
                            type="button"
                            onClick={() => handleToggleFaqActive(faq)}
                            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              faq.isActive !== false
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50 hover:bg-emerald-900/60'
                                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                            }`}
                            title={faq.isActive !== false ? 'Click to hide from members' : 'Click to make visible to members'}
                          >
                            <span className="material-symbols-outlined text-sm">
                              {faq.isActive !== false ? 'visibility' : 'visibility_off'}
                            </span>
                            <span>{faq.isActive !== false ? 'Hide' : 'Show'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditFaqModal(faq)}
                            className="p-2 rounded-xl bg-purple-900/40 hover:bg-purple-900/80 border border-purple-500/40 text-purple-200 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                            title="Edit this FAQ"
                          >
                            <span className="material-symbols-outlined text-sm">edit</span>
                            <span className="hidden sm:inline">Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirm({
                                type: 'faq',
                                id: faq.id,
                                label: `FAQ: "${faq.question}"`,
                              })
                            }
                            className="p-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-600/40 text-rose-300 text-xs font-bold transition-all cursor-pointer"
                            title="Delete this FAQ"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Add / Edit Support FAQ Modal ── */}
        {isFaqModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm select-none animate-in fade-in duration-150">
            <div className="max-w-lg w-full bg-[#10061d] border border-purple-500/40 rounded-3xl p-5 sm:p-7 space-y-5 shadow-2xl mx-2 text-left">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-purple-500/20 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0">
                    <span className="material-symbols-outlined text-2xl">
                      {editingFaq ? 'edit_note' : 'add_circle'}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-tight">
                      {editingFaq ? 'Edit Support FAQ' : 'Add New Support FAQ'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Configure quick solutions for the Resolve Tickets &amp; Support page
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => !submittingFaq && setIsFaqModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSaveFaq} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Question <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. How do I verify my payment status?"
                    value={faqFormData.question}
                    onChange={(e) => setFaqFormData({ ...faqFormData, question: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#150a24] border border-[#2e154a] focus:border-purple-500 focus:outline-none text-xs text-white placeholder-slate-500 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Category <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={faqFormData.category}
                    onChange={(e) => setFaqFormData({ ...faqFormData, category: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#150a24] border border-[#2e154a] focus:border-purple-500 focus:outline-none text-xs text-white transition-colors cursor-pointer"
                  >
                    {FAQ_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-bold text-slate-300 uppercase tracking-wider">
                      Detailed Answer / Solution <span className="text-rose-400">*</span>
                    </label>
                    <span className="text-[10px] font-mono text-slate-400">
                      {faqFormData.answer.length}/1000
                    </span>
                  </div>
                  <textarea
                    required
                    rows={4}
                    maxLength={1000}
                    placeholder="Write the clear solution, instructions, or links to guide members..."
                    value={faqFormData.answer}
                    onChange={(e) => setFaqFormData({ ...faqFormData, answer: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#150a24] border border-[#2e154a] focus:border-purple-500 focus:outline-none text-xs text-white placeholder-slate-500 transition-colors custom-scrollbar"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="faq-is-active"
                    checked={faqFormData.isActive}
                    onChange={(e) => setFaqFormData({ ...faqFormData, isActive: e.target.checked })}
                    className="w-4 h-4 rounded bg-[#140b24] border-purple-700 text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                  <label htmlFor="faq-is-active" className="text-xs font-medium text-slate-300 cursor-pointer select-none">
                    Active &amp; visible immediately to members on Resolve Tickets page
                  </label>
                </div>

                {/* Footer Buttons */}
                <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-4 border-t border-purple-500/20">
                  <button
                    type="button"
                    disabled={submittingFaq}
                    onClick={() => setIsFaqModalOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 bg-[#1e1035] hover:bg-[#2c184d] text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingFaq}
                    className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-50 text-white text-xs font-black tracking-wider uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                  >
                    {submittingFaq ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Saving to Firebase...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">save</span>
                        <span>{editingFaq ? 'Update FAQ' : 'Save New FAQ'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Purge Audit Logs by Scheduled Time Range Modal ── */}
        {isPurgeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm select-none animate-in fade-in duration-150">
            <div className="max-w-lg w-full bg-[#10061d] border border-rose-500/40 rounded-3xl p-5 sm:p-7 space-y-5 shadow-2xl mx-2 text-left">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-purple-500/20 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                    <span className="material-symbols-outlined text-2xl">delete_sweep</span>
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-tight">
                      Delete Audit Session Logs
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Permanently wipe visitor tracking records from Firebase &amp; Dashboard
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => !isPurgingLogs && setIsPurgeModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              {/* Quick Presets */}
              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-purple-300 block">
                  Quick Time Range Presets
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'all', label: 'All Logs (12h)' },
                    { id: '1h', label: 'Older than 1h' },
                    { id: '3h', label: 'Older than 3h' },
                    { id: '6h', label: 'Older than 6h' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPurgePreset(p.id as any)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                        purgePreset === p.id
                          ? 'bg-rose-950/70 border-rose-500 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
                          : 'bg-[#170c29] border-purple-900/40 text-slate-300 hover:border-purple-500/50 hover:text-white'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scheduled Range Datetime Pickers */}
              <div className="p-4 rounded-2xl bg-[#0a0314] border border-[#2b1442] space-y-3">
                <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-rose-400">schedule</span>
                  <span>Scheduled Time Window (In Between)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">
                      Start Time (From):
                    </label>
                    <input
                      type="datetime-local"
                      value={purgeStartDate}
                      onChange={(e) => {
                        setPurgePreset('custom');
                        setPurgeStartDate(e.target.value);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-[#140b24] border border-purple-900/60 text-xs font-mono text-white focus:outline-none focus:border-rose-500 transition-colors"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">
                      End Time (To):
                    </label>
                    <input
                      type="datetime-local"
                      value={purgeEndDate}
                      onChange={(e) => {
                        setPurgePreset('custom');
                        setPurgeEndDate(e.target.value);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-[#140b24] border border-purple-900/60 text-xs font-mono text-white focus:outline-none focus:border-rose-500 transition-colors"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  Only visitor presence sessions entered <strong className="text-white">between these two timestamps</strong> will be targeted.
                </p>
              </div>

              {/* Real-Time Preview Banner */}
              {(() => {
                const fromMs = purgeStartDate ? new Date(purgeStartDate).getTime() : 0;
                const toMs = purgeEndDate ? new Date(purgeEndDate).getTime() : Infinity;
                const matched = sessions.filter((s) => {
                  const t = new Date(s.enteredAt).getTime();
                  return !isNaN(t) && t >= fromMs && t <= toMs;
                }).length;

                return (
                  <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/30 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-rose-400 text-lg">info</span>
                      <span className="text-xs text-rose-200">
                        Matches <strong className="text-white font-mono font-black">{matched}</strong> visible session log(s) in this dashboard
                      </span>
                    </div>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-900/50 text-rose-300 border border-rose-500/30">
                      Target: {matched}
                    </span>
                  </div>
                );
              })()}

              {/* Action Buttons */}
              <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 pt-2 border-t border-purple-500/20">
                <button
                  type="button"
                  disabled={isPurgingLogs}
                  onClick={() => setIsPurgeModalOpen(false)}
                  className="w-full sm:w-auto px-4 py-2.5 bg-[#1e1035] hover:bg-[#2c184d] text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPurgingLogs || (!purgeStartDate && !purgeEndDate)}
                  onClick={handleExecutePurgeLogs}
                  className="w-full sm:w-auto px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-black tracking-wider uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                >
                  {isPurgingLogs ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Deleting from Firebase...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">delete_forever</span>
                      <span>Permanently Delete Logs</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Confirmation Modal ── */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm select-none">
            <div className="max-w-sm w-full bg-[#12081f] border border-rose-500/40 rounded-2xl p-5 sm:p-6 space-y-4 shadow-2xl mx-2">
              <div className="w-12 h-12 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                <span className="material-symbols-outlined text-2xl">warning</span>
              </div>
              <div>
                <h4 className="text-sm font-black text-white uppercase">Confirm Deletion</h4>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Are you sure you want to permanently remove <strong className="text-white">{deleteConfirm.label}</strong>?
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-3 py-1.5 bg-[#25133d] hover:bg-[#331852] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (deleteConfirm.type === 'admin') handleDropAdmin(deleteConfirm.id);
                    else if (deleteConfirm.type === 'faculty') handleDeleteFaculty(deleteConfirm.id);
                    else if (deleteConfirm.type === 'role') handleDeleteCustomRole(deleteConfirm.id);
                    else if (deleteConfirm.type === 'domain') handleDeleteDomain(deleteConfirm.id);
                    else if (deleteConfirm.type === 'position') handleDeletePosition(deleteConfirm.id);
                    else if (deleteConfirm.type === 'session') handleDeleteSingleSession(deleteConfirm.id);
                    else if (deleteConfirm.type === 'faq') handleDeleteFaq(deleteConfirm.id);
                    setDeleteConfirm(null);
                  }}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default SuperAdminControlCenter;
