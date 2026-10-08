"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, writeBatch, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { getClientAuthToken } from '@/lib/auth-client';
import readXlsxFile from 'read-excel-file/browser';
import {
  ClubMetadata,
  DEFAULT_CLUB_METADATA,
  DEFAULT_DOMAINS,
  DEFAULT_POSITIONS,
  fetchClubMetadata,
  saveClubMetadata,
  fetchPermissionsConfig,
} from '@/lib/permissions';
import SpecularButton from './SpecularButton';

export interface RosterMember {
  id: string;
  name: string;
  registrationNumber: string;
  email: string;
  phone?: string;
  team: string;
  teams: string[];
  position: string;
  avatarUrl?: string;
  isCoordinator?: boolean;
  isCoPresident?: boolean;
  isLead?: boolean;
  isBlocked?: boolean;
}

export interface LeadershipPerson {
  id: string;
  name: string;
  role: string;
  category: 'Co-President' | 'Student Coordinator';
  teamOrDept: string;
  regNoOrId?: string;
  email: string;
  avatarUrl: string;
}

export interface ParsedMemberRow {
  name: string;
  registrationNumber: string;
  email: string;
  phone: string;
  team: string;
  position: string;
}

export interface ClashingMemberRecord {
  id: string;
  incoming: ParsedMemberRow;
  existing: RosterMember;
  decision: 'update' | 'keep' | 'manual';
  manualEdits?: ParsedMemberRow;
}

export interface PreviewMemberRecord {
  id: string;
  name: string;
  registrationNumber: string;
  email: string;
  phone: string;
  team: string;
  position: string;
  isExisting: boolean;
  existingMember?: RosterMember;
  selected: boolean;
}

/**
 * Splits compound team strings into distinct individual domains.
 * Preserves Esports Mobile and Esports PC as separate individual categories.
 */
export function extractMemberTeams(rawTeamString: string): string[] {
  if (!rawTeamString) return ['General'];
  const str = rawTeamString.trim();
  if (!str) return ['General'];

  const knownDomains = [
    { key: 'Technical Team', pattern: /\b(tech|technical|developer|web|app|xr|unity|unreal)\b/i },
    { key: 'Design Team', pattern: /\b(design|ui\/ux|graphic|creative)\b/i },
    { key: 'Social Media', pattern: /\b(social|social\s*media|content)\b/i },
    { key: 'PR', pattern: /\b(pr|public\s*relations|outreach|marketing)\b/i },
    { key: 'Esports Mobile', pattern: /\b(esport|esports|gaming)?\s*(mobile|bgmi|codm|freefire)\b/i },
    { key: 'Esports PC', pattern: /\b(esport|esports|gaming)?\s*(pc|computer|valorant|cs2|csgo|dota)\b/i },
    { key: 'Esports', pattern: /\b(esport|esports|gaming|game)\b/i },
    { key: 'Events', pattern: /\b(event|events|management|logistics)\b/i },
    { key: 'Education', pattern: /\b(edu|education|training|research)\b/i },
  ];

  const hasMultiple = /(&|\band\b|,|\/|\+)/i.test(str);
  if (hasMultiple) {
    const matched: string[] = [];
    for (const d of knownDomains) {
      if (d.pattern.test(str)) {
        if (d.key === 'Esports' && (matched.includes('Esports Mobile') || matched.includes('Esports PC'))) {
          continue;
        }
        if (!matched.includes(d.key)) {
          matched.push(d.key);
        }
      }
    }
    if (matched.length > 0) {
      return matched;
    }

    const parts = str
      .split(/&|\band\b|,|\/|\+/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > 0) {
      return Array.from(new Set(parts));
    }
  }

  for (const d of knownDomains) {
    if (d.pattern.test(str)) {
      return [d.key];
    }
  }

  return [str];
}

function sheetRowsToObjects(rows: any[][]): Record<string, any>[] {
  if (!rows || rows.length < 2) return [];
  const headers = (rows[0] || []).map((cell) => {
    if (cell == null) return '';
    return String(cell).replace(/^\uFEFF/, '').replace(/["']/g, '').trim();
  });
  const objects: Record<string, any>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const hasData = row.some((cell) => cell != null && String(cell).trim() !== '');
    if (!hasData) continue;

    const obj: Record<string, any> = {};
    headers.forEach((header, colIndex) => {
      if (header) {
        const val = row[colIndex];
        obj[header] = val != null ? String(val).trim() : '';
      }
    });
    objects.push(obj);
  }
  return objects;
}

function parseCSV(text: string): Record<string, any>[] {
  if (!text) return [];
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 0xFEFF) {
    cleanText = cleanText.slice(1);
  }

  // Detect delimiter from first non-empty line
  const firstLine = cleanText.split(/\r\n|\n|\r/)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  let delimiter = ',';
  if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
  else if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';

  const lines: string[][] = [];
  let currentRow: string[] = [''];
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentRow[currentRow.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push('');
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0].trim() !== '')) {
        lines.push(currentRow.map((cell) => cell.trim().replace(/^["']|["']$/g, '')));
      }
      currentRow = [''];
    } else {
      currentRow[currentRow.length - 1] += char;
    }
  }

  if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0].trim() !== '')) {
    lines.push(currentRow.map((cell) => cell.trim().replace(/^["']|["']$/g, '')));
  }

  return sheetRowsToObjects(lines);
}

interface MembersRosterProps {
  onRedirect?: () => void;
  isAdmin?: boolean;
}

const MembersRoster: React.FC<MembersRosterProps> = ({ onRedirect, isAdmin: propIsAdmin }) => {
  const { isSuperAdmin, isAdmin, userRole } = useAuth();
  // canManage governs full write authority (edit member, delete member, add member, import files, bulk operations).
  // When propIsAdmin is provided by the parent (via getPagePermission('members').canEdit), it strictly determines
  // write authority. A custom role with "View Only" (canEdit: false) must NEVER receive write authority.
  // Super Admin always retains unrestricted authority.
  const canManage = isSuperAdmin || (propIsAdmin !== undefined ? propIsAdmin : (isAdmin ?? false));

  const [members, setMembers] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTeam, setSelectedTeam] = useState<string>('ALL');
  const [selectedPosition, setSelectedPosition] = useState<string>('ALL');
  const [blockedFilter, setBlockedFilter] = useState<'ALL' | 'BLOCKED' | 'UNBLOCKED'>('ALL');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Club metadata (domains & positions)
  const [clubMetadata, setClubMetadata] = useState<ClubMetadata>(DEFAULT_CLUB_METADATA);
  const [canManageMetadata, setCanManageMetadata] = useState<boolean>(false);
  const [canBlockAccess, setCanBlockAccess] = useState<boolean>(false);
  const [quickAddModalType, setQuickAddModalType] = useState<'domain' | 'position' | null>(null);
  const [quickAddInput, setQuickAddInput] = useState<string>('');
  const [savingQuickAdd, setSavingQuickAdd] = useState<boolean>(false);

  // Unified File Import & Preview state
  const [importingFile, setImportingFile] = useState<boolean>(false);
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview'>('upload');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [uploadedFileSize, setUploadedFileSize] = useState<string>('');
  const [previewMembers, setPreviewMembers] = useState<PreviewMemberRecord[]>([]);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'new' | 'existing'>('all');
  const [previewSearch, setPreviewSearch] = useState<string>('');
  const [conflictMode, setConflictMode] = useState<'update' | 'skip'>('update');
  const [savingImport, setSavingImport] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual Add / Edit Member state
  const [memberModalOpen, setMemberModalOpen] = useState<boolean>(false);
  const [editingMember, setEditingMember] = useState<RosterMember | null>(null);
  const [memberFormData, setMemberFormData] = useState<ParsedMemberRow>({
    name: '',
    registrationNumber: '',
    email: '',
    phone: '',
    team: 'Technical',
    position: 'Member',
  });
  const [savingMember, setSavingMember] = useState<boolean>(false);
  const [memberFormError, setMemberFormError] = useState<string>('');

  // Delete Member state
  const [deleteConfirmMember, setDeleteConfirmMember] = useState<RosterMember | null>(null);
  const [deletingMember, setDeletingMember] = useState<boolean>(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState<RosterMember[] | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState<boolean>(false);

  const getMemberKey = (m: RosterMember) => (m.id || m.email || m.registrationNumber || '').toLowerCase();

  // Manual Edit inside Clash state
  const [clashEditTarget, setClashEditTarget] = useState<ClashingMemberRecord | null>(null);

  // Load members from Firestore `members` and `id_cards` collections
  const loadAllMembers = async (showLoadingSpinner: boolean = true) => {
    if (showLoadingSpinner) setLoading(true);
    try {
      const membersMap = new Map<string, RosterMember>();

      // 1. Query `members` collection
      try {
        const membersSnap = await getDocs(collection(db, 'members'));
        membersSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const email = (data.email || data.Email || '').toLowerCase().trim();
          const reg = (data.registrationNumber || data['Registration Number'] || data.regNo || docSnap.id || '').toUpperCase().trim();
          const mapKey = email || reg;
          if (mapKey) {
            const pos = (data.position || data.role || 'Member').trim();
            const rawTeam = (data.team || data.domain || 'VRGC Member').trim();
            const posLower = pos.toLowerCase();
            const teamLower = rawTeam.toLowerCase();

            const isCoPres = (posLower.includes('president') || teamLower.includes('president')) && !posLower.includes('vice');
            const isCoord = posLower.includes('student coordinator') || teamLower.includes('student coordinator') || (posLower.includes('coordinator') && !posLower.includes('event'));
            const isLd = posLower.includes('lead') || posLower.includes('head');
            const assignedTeams = extractMemberTeams(rawTeam);
            const memberPhoto = data.photoUrl || data.photoURL || data.avatarUrl || data.photo || data.image || data.avatar || '';

            const isStubRecord = (!data.name || data.name === 'Member') && (!reg || reg.includes('@') || reg === (email || '').toUpperCase());
            if (isStubRecord) {
              // Automatically prune empty stub records
              deleteDoc(docSnap.ref).catch(() => {});
              return;
            }

            membersMap.set(mapKey, {
              id: docSnap.id,
              name: data.name || data.Name || data.fullName || 'Member',
              registrationNumber: reg,
              email: email || `${reg.toLowerCase()}@vitbhopal.ac.in`,
              phone: data.phone || data.Phone || '',
              team: assignedTeams.join(' • '),
              teams: assignedTeams,
              position: pos || 'Member',
              avatarUrl: memberPhoto,
              isCoPresident: isCoPres,
              isCoordinator: isCoord,
              isLead: isLd,
              isBlocked: data.isBlocked === true,
            });
          }
        });
      } catch (mErr) {
        console.warn('Error fetching members collection:', mErr);
      }

      // 2. Query `id_cards` collection to enrich confirmed member photos & details (never fabricates phantom members)
      try {
        const idCardsSnap = await getDocs(collection(db, 'id_cards'));
        idCardsSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const email = (data.email || data.Email || '').toLowerCase().trim();
          const reg = (data.regNo || data.registrationNumber || (!docSnap.id.includes('@') ? docSnap.id : '') || '').toUpperCase().trim();
          const idPhoto = data.photoUrl || data.photoURL || data.avatarUrl || data.photo || data.image || data.avatar || '';

          // Match member by email or registration number
          let existing = email ? membersMap.get(email) : undefined;
          if (!existing && reg) {
            existing = membersMap.get(reg) || Array.from(membersMap.values()).find((m) => m.registrationNumber === reg);
          }

          if (existing) {
            // Enrich member with ID card photo if available
            if (idPhoto) {
              existing.avatarUrl = idPhoto;
            }
            if (!existing.phone && data.phone) {
              existing.phone = data.phone;
            }
            if (data.isBlocked === true) {
              existing.isBlocked = true;
            }
          }
        });
      } catch (idErr) {
        console.warn('Error fetching id_cards collection:', idErr);
      }

      // 3. Query `blocked_users` collection to sync active block status
      try {
        const blockedSnap = await getDocs(collection(db, 'blocked_users'));
        const blockedEmails = new Set<string>();
        const blockedRegs = new Set<string>();
        blockedSnap.forEach((bDoc) => {
          const bData = bDoc.data();
          if (bData?.isBlocked !== false) {
            if (bDoc.id) blockedEmails.add(bDoc.id.toLowerCase().trim());
            if (bData?.email) blockedEmails.add(bData.email.toLowerCase().trim());
            if (bData?.registrationNumber) blockedRegs.add(bData.registrationNumber.toUpperCase().trim());
          }
        });

        membersMap.forEach((mem) => {
          const mEmail = (mem.email || '').toLowerCase().trim();
          const mReg = (mem.registrationNumber || '').toUpperCase().trim();
          if (blockedEmails.has(mEmail) || (mReg && blockedRegs.has(mReg))) {
            mem.isBlocked = true;
          }
        });
      } catch (bErr) {
        console.warn('Error fetching blocked_users collection:', bErr);
      }

      // 4. Fallback any members without photos to personalized Dicebear avatar
      const membersList = Array.from(membersMap.values()).map((m) => ({
        ...m,
        avatarUrl: m.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(m.name || m.email || m.registrationNumber)}`,
      }));

      setMembers(membersList);
    } catch (err) {
      console.error('Failed to load roster:', err);
    } finally {
      if (showLoadingSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAllMembers();

    const loadMetaAndPerms = async () => {
      try {
        const meta = await fetchClubMetadata();
        setClubMetadata(meta);

        const perms = await fetchPermissionsConfig();
        const allowed = isSuperAdmin || (userRole ? perms.allowedMetadataRoles.includes(userRole) : false);
        setCanManageMetadata(allowed);
        
        const allowedBlock = isSuperAdmin || (userRole ? (perms.allowedBlockAccessRoles || []).includes(userRole) : false);
        setCanBlockAccess(allowedBlock);
      } catch (err) {
        console.error('Failed to load club metadata / permissions:', err);
      }
    };
    loadMetaAndPerms();
  }, [isSuperAdmin, userRole]);

  // Compute team counts & metrics
  const { teamCounts, leadershipPeople, uniqueTeams } = useMemo(() => {
    const counts: Record<string, number> = {};
    const teams = new Set<string>();
    const leadership: LeadershipPerson[] = [];

    members.forEach((m) => {
      m.teams.forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
        teams.add(t);
      });

      if (m.isCoPresident) {
        leadership.push({
          id: m.id || m.email,
          name: m.name,
          role: m.position || 'Co-President',
          category: 'Co-President',
          teamOrDept: m.team || 'Leadership',
          regNoOrId: m.registrationNumber,
          email: m.email,
          avatarUrl: m.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(m.name)}`,
        });
      } else if (m.isCoordinator) {
        leadership.push({
          id: m.id || m.email,
          name: m.name,
          role: m.position || 'Student Coordinator',
          category: 'Student Coordinator',
          teamOrDept: m.team || 'Leadership',
          regNoOrId: m.registrationNumber,
          email: m.email,
          avatarUrl: m.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(m.name)}`,
        });
      }
    });

    return {
      teamCounts: counts,
      leadershipPeople: leadership,
      uniqueTeams: Array.from(teams).sort(),
    };
  }, [members]);

  // Filtered members list
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.registrationNumber.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.teams.some((t) => t.toLowerCase().includes(q)) ||
        m.position.toLowerCase().includes(q);

      const matchesTeam =
        selectedTeam === 'ALL' ||
        m.teams.some((t) => t.toLowerCase() === selectedTeam.toLowerCase());

      let matchesPosition = true;
      if (selectedPosition === 'CO_PRESIDENT') {
        matchesPosition = !!m.isCoPresident;
      } else if (selectedPosition === 'COORDINATOR') {
        matchesPosition = !!m.isCoordinator;
      } else if (selectedPosition === 'LEAD') {
        matchesPosition = !!m.isLead;
      } else if (selectedPosition === 'MEMBER') {
        matchesPosition = !m.isCoPresident && !m.isCoordinator && !m.isLead;
      }

      let matchesBlocked = true;
      if (blockedFilter === 'BLOCKED') {
        matchesBlocked = !!m.isBlocked;
      } else if (blockedFilter === 'UNBLOCKED') {
        matchesBlocked = !m.isBlocked;
      }

      return matchesSearch && matchesTeam && matchesPosition && matchesBlocked;
    });
  }, [members, searchQuery, selectedTeam, selectedPosition, blockedFilter]);

  // Page limit for progressive loading (load 12 at a time, exactly like ID card loading system)
  const PAGE_SIZE = 12;
  const [pageLimit, setPageLimit] = useState<number>(PAGE_SIZE);

  // Reset page limit back to PAGE_SIZE whenever user searches or changes filter
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPageLimit(PAGE_SIZE);
  }, [searchQuery, selectedTeam, selectedPosition, blockedFilter]);

  // Paginated visible members slice
  const visibleMembers = useMemo(() => {
    return filteredMembers.slice(0, pageLimit);
  }, [filteredMembers, pageLimit]);

  const handleToggleSelectAll = () => {
    const allKeys = visibleMembers.map((m) => getMemberKey(m));
    const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedMemberIds.has(k));

    if (allSelected) {
      setSelectedMemberIds(new Set());
    } else {
      setSelectedMemberIds(new Set(allKeys));
    }
  };

  const handleToggleSelectOne = (key: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Selected members list and their block state status
  const selectedMembers = useMemo(() => {
    return members.filter((m) => selectedMemberIds.has(getMemberKey(m)));
  }, [members, selectedMemberIds]);

  const hasSelectedBlocked = useMemo(() => {
    return selectedMembers.some((m) => !!m.isBlocked);
  }, [selectedMembers]);

  const hasSelectedUnblocked = useMemo(() => {
    return selectedMembers.some((m) => !m.isBlocked);
  }, [selectedMembers]);

  // Dynamic available domains combining member's current domain, Firestore metadata, and system defaults
  const availableDomains = useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();

    const addDomain = (d?: string) => {
      if (!d) return;
      const trimmed = d.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        list.push(trimmed);
      }
    };

    // 1. Current member's domain if editing (preserves "Esports PC", "PR • Esports PC", etc.)
    if (memberFormData.team) {
      memberFormData.team.split(/[•,;]/).map((s) => s.trim()).filter(Boolean).forEach(addDomain);
      addDomain(memberFormData.team);
    }

    // 2. Club Metadata domains from Firestore
    (clubMetadata.domains || []).forEach(addDomain);

    // 3. System DEFAULT_DOMAINS
    DEFAULT_DOMAINS.forEach(addDomain);

    return list;
  }, [clubMetadata.domains, memberFormData.team]);

  // Dynamic available positions combining member's current position, Firestore metadata, and system defaults
  const availablePositions = useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();

    const addPos = (p?: string) => {
      if (!p) return;
      const trimmed = p.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        list.push(trimmed);
      }
    };

    // 1. Current member's position if editing (preserves "Student Coordinator", "Co-President", "Co-Lead", etc.)
    if (memberFormData.position) {
      addPos(memberFormData.position);
    }

    // 2. Club Metadata positions from Firestore
    (clubMetadata.positions || []).forEach(addPos);

    // 3. System DEFAULT_POSITIONS
    DEFAULT_POSITIONS.forEach(addPos);

    return list;
  }, [clubMetadata.positions, memberFormData.position]);

  // ─── CSV / XLSX Import Logic ────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    const csvContent =
      'Name,Registration Number,Email,Phone,Domain,Position\r\n' +
      'John Doe,24BCG10001,john.24bcg10001@vitbhopal.ac.in,9876543210,Technical Team,Core Member\r\n' +
      'Jane Smith,24BCG10002,jane.24bcg10002@vitbhopal.ac.in,9876543211,Design Team,Lead\r\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'vrgc_members_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  function extractMemberFromRow(row: Record<string, any>): ParsedMemberRow | null {
    const getVal = (possibleKeys: string[], partialKeys?: string[]) => {
      // 1. Exact match on normalized header
      for (const k of possibleKeys) {
        for (const rowKey of Object.keys(row)) {
          const cleanKey = rowKey.replace(/^\uFEFF/, '').replace(/["']/g, '').trim().toLowerCase();
          if (cleanKey === k.toLowerCase()) {
            const val = String(row[rowKey] ?? '').trim();
            return val.replace(/^["']|["']$/g, '');
          }
        }
      }
      // 2. Substring matching
      if (partialKeys) {
        for (const pk of partialKeys) {
          for (const rowKey of Object.keys(row)) {
            const cleanKey = rowKey.replace(/^\uFEFF/, '').replace(/["']/g, '').trim().toLowerCase();
            if (cleanKey.includes(pk.toLowerCase())) {
              const val = String(row[rowKey] ?? '').trim();
              if (val) return val.replace(/^["']|["']$/g, '');
            }
          }
        }
      }
      return '';
    };

    const name =
      getVal(
        ['name', 'full name', 'student name', 'member name', 'first name', 'student_name', 'name of student', 'candidate name'],
        ['student name', 'member name', 'candidate name']
      ) || getVal(['name']);

    const registrationNumber = getVal(
      ['registration number', 'reg no', 'regno', 'reg. no.', 'registration_number', 'reg_no', 'roll no', 'roll number', 'registration no', 'urn', 'reg', 'id', 'registration_no'],
      ['reg no', 'regno', 'registration', 'roll no']
    ).toUpperCase();

    const email = getVal(
      ['email', 'email address', 'vit email', 'email id', 'email_id', 'mail', 'vit email id', 'college email', 'official email', 'e-mail', 'mail id', 'vit mail'],
      ['email', 'mail']
    ).toLowerCase();

    const phone = getVal(
      ['phone', 'phone number', 'mobile', 'contact', 'mobile number', 'whatsapp', 'whatsapp number', 'phone_number', 'contact number', 'mobile_no', 'phone no', 'phone no.'],
      ['phone', 'mobile', 'contact', 'whatsapp']
    );

    const team =
      getVal(['domain', 'team', 'department', 'subdivision', 'assigned team', 'assigned domain', 'club domain', 'teams', 'domains', 'dept', 'track'], ['domain', 'team', 'department', 'subdivision']) ||
      'General';

    const position =
      getVal(['position', 'role', 'designation', 'post', 'status', 'positions', 'designations', 'title'], ['position', 'role', 'designation', 'post']) ||
      'Member';

    if (!email && !registrationNumber && !name) {
      return null;
    }

    return {
      name: name || 'Member',
      registrationNumber,
      email: email || (registrationNumber ? `${registrationNumber.toLowerCase()}@vitbhopal.ac.in` : ''),
      phone,
      team,
      position,
    };
  }

  const processUploadedFile = async (file: File) => {
    setImportError('');
    setImportingFile(true);
    setUploadedFileName(file.name);
    setUploadedFileSize(
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.round(file.size / 1024)} KB`
    );

    try {
      let rawRows: Record<string, any>[] = [];
      const fileName = file.name.toLowerCase();

      if (
        fileName.endsWith('.csv') ||
        fileName.endsWith('.tsv') ||
        fileName.endsWith('.txt') ||
        file.type === 'text/csv' ||
        file.type === 'text/tab-separated-values' ||
        file.type === 'text/plain'
      ) {
        const text = await file.text();
        rawRows = parseCSV(text);
      } else {
        try {
          const result = (await readXlsxFile(file)) as any;
          const rows: any[][] =
            Array.isArray(result) && result.length > 0 && result[0] && Array.isArray(result[0].data)
              ? result[0].data
              : (result as any[][]);
          rawRows = sheetRowsToObjects(rows);
        } catch {
          // If readXlsxFile failed, try text fallback in case it was a renamed CSV
          const text = await file.text();
          rawRows = parseCSV(text);
        }
      }

      if (rawRows.length === 0) {
        throw new Error(
          'No readable rows found in the uploaded file. Please make sure the spreadsheet has a header row and at least one member.'
        );
      }

      const parsedMembers: ParsedMemberRow[] = [];
      rawRows.forEach((row) => {
        const extracted = extractMemberFromRow(row);
        if (extracted) {
          parsedMembers.push(extracted);
        }
      });

      if (parsedMembers.length === 0) {
        throw new Error(
          'Could not identify member columns. Please ensure columns include: Name, Registration Number, Email, Domain, Position.'
        );
      }

      // Build Preview Member records by comparing with current database members
      const previewList: PreviewMemberRecord[] = parsedMembers.map((incoming, idx) => {
        const existing = members.find(
          (m) =>
            (incoming.email && m.email.toLowerCase() === incoming.email.toLowerCase()) ||
            (incoming.registrationNumber &&
              m.registrationNumber &&
              m.registrationNumber.toUpperCase() === incoming.registrationNumber.toUpperCase())
        );

        return {
          id: `preview-${idx}-${incoming.registrationNumber || incoming.email || idx}`,
          name: incoming.name,
          registrationNumber: incoming.registrationNumber,
          email: incoming.email,
          phone: incoming.phone,
          team: incoming.team,
          position: incoming.position,
          isExisting: Boolean(existing),
          existingMember: existing,
          selected: true, // Default to checked
        };
      });

      setPreviewMembers(previewList);
      setImportStep('preview');
      setImportModalOpen(true);
    } catch (err: any) {
      console.error('Error parsing file:', err);
      setImportError(err?.message || 'Failed to parse file. Please upload a valid CSV or Excel file.');
      setImportStep('upload');
      setImportModalOpen(true);
    } finally {
      setImportingFile(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processUploadedFile(file);
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processUploadedFile(file);
    }
  };

  // Confirm Import & Save to Database
  const handleConfirmImport = async () => {
    if (!canManage) {
      setImportError('Permission denied: You have view-only access to the Members Roster.');
      return;
    }
    setSavingImport(true);
    setImportError('');
    try {
      const selectedRecords = previewMembers.filter((m) => m.selected);
      if (selectedRecords.length === 0) {
        throw new Error('Please select at least one member to import.');
      }

      // Filter based on conflictMode if user chose 'skip' existing
      const toImport = selectedRecords.filter((m) => {
        if (m.isExisting && conflictMode === 'skip') {
          return false;
        }
        return true;
      });

      if (toImport.length === 0) {
        throw new Error('No members to import based on your selected options.');
      }

      const payload = toImport.map((m) => ({
        name: m.name,
        registrationNumber: m.registrationNumber,
        email: m.email,
        phone: m.phone,
        team: m.team,
        position: m.position,
      }));

      // Execute import directly into Firestore via client writeBatch (immediate, reliable, zero serverless timeout)
      let importedCount = 0;
      let directWriteSuccess = false;

      try {
        const CHUNK_SIZE = 400;
        const nowIso = new Date().toISOString();

        // Query existing ID cards so imported member updates propagate to the id_cards table
        const idCardsSnap = await getDocs(collection(db, 'id_cards')).catch(() => null);
        const idCardsMap = new Map<string, { ref: any; id: string; data: any }>();
        if (idCardsSnap && !idCardsSnap.empty) {
          idCardsSnap.forEach((d) => {
            const data = d.data();
            const em = (data.email || '').toLowerCase().trim();
            const rg = (data.regNo || data.registrationNumber || '').toUpperCase().trim();
            if (em) idCardsMap.set(em, { ref: d.ref, id: d.id, data });
            if (rg) idCardsMap.set(rg, { ref: d.ref, id: d.id, data });
            if (d.id && d.id.includes('@')) idCardsMap.set(d.id.toLowerCase().trim(), { ref: d.ref, id: d.id, data });
          });
        }

        for (let i = 0; i < toImport.length; i += CHUNK_SIZE) {
          const chunk = toImport.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);

          for (const m of chunk) {
            const cleanName = (m.name || '').trim();
            const cleanReg = (m.registrationNumber || '').toUpperCase().trim();
            const cleanEmail = (m.email || '').toLowerCase().trim();
            const cleanPhone = (m.phone || '').trim();
            const cleanTeam = (m.team || 'General').trim();
            const cleanPos = (m.position || 'Member').trim();

            const targetDocId = (cleanReg || cleanEmail.replace(/[/@.]/g, '_')).trim();
            if (!targetDocId) continue;

            const docRef = doc(db, 'members', targetDocId);
            batch.set(
              docRef,
              {
                name: cleanName || 'Member',
                registrationNumber: cleanReg,
                email: cleanEmail || (cleanReg ? `${cleanReg.toLowerCase()}@vitbhopal.ac.in` : ''),
                phone: cleanPhone,
                team: cleanTeam,
                position: cleanPos,
                updatedAt: nowIso,
              },
              { merge: true }
            );

            // Also synchronize with matching document in id_cards collection
            const matchingIdCard = (cleanEmail && idCardsMap.get(cleanEmail)) || (cleanReg && idCardsMap.get(cleanReg));
            if (matchingIdCard) {
              batch.set(
                matchingIdCard.ref,
                {
                  name: cleanName || matchingIdCard.data.name || 'Member',
                  registrationNumber: cleanReg || matchingIdCard.data.registrationNumber || '',
                  regNo: cleanReg || matchingIdCard.data.regNo || '',
                  email: cleanEmail || matchingIdCard.data.email || '',
                  phone: cleanPhone || matchingIdCard.data.phone || '',
                  team: cleanTeam || matchingIdCard.data.team || 'General',
                  position: cleanPos || matchingIdCard.data.position || 'Member',
                  role: cleanPos || matchingIdCard.data.role || 'Member',
                  updatedAt: nowIso,
                },
                { merge: true }
              );
            }

            importedCount++;
          }

          await batch.commit();
        }
        directWriteSuccess = true;
      } catch (directErr) {
        console.warn('[Members Import] Direct Firestore writeBatch notice, attempting server API fallback:', directErr);
      }

      // If direct write failed (e.g. security rules permission nuance), fallback to backend API with safe JSON parsing
      if (!directWriteSuccess) {
        const token = await getClientAuthToken();
        const res = await fetch('/api/members/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ members: payload }),
        });

        let resData: any = null;
        try {
          const text = await res.text();
          resData = text ? JSON.parse(text) : null;
        } catch {
          resData = null;
        }

        if (!res.ok || !resData?.success) {
          throw new Error(resData?.error || `Failed to import members (Server returned status ${res.status})`);
        }
        importedCount = resData.count || toImport.length;
      }

      await loadAllMembers();
      setImportModalOpen(false);
      setImportStep('upload');
      setPreviewMembers([]);
      alert(`🎉 Successfully imported ${importedCount || toImport.length} members into the database!`);
    } catch (err: any) {
      console.error('Error saving imported members:', err);
      setImportError(err?.message || 'Failed to save members to database.');
    } finally {
      setSavingImport(false);
    }
  };

  // ─── Manual Add / Edit Member ──────────────────────────────────────────────
  const openMemberModal = (member?: RosterMember) => {
    if (!canManage) return;
    setMemberFormError('');
    if (member) {
      setEditingMember(member);
      setMemberFormData({
        name: member.name || '',
        registrationNumber: member.registrationNumber || '',
        email: member.email || '',
        phone: member.phone || '',
        team: member.team || (member.teams && member.teams[0]) || 'Technical',
        position: member.position || 'Core Member',
      });
    } else {
      setEditingMember(null);
      setMemberFormData({
        name: '',
        registrationNumber: '',
        email: '',
        phone: '',
        team: clubMetadata.domains[0] || 'Technical',
        position: clubMetadata.positions[0] || 'Core Member',
      });
    }
    setMemberModalOpen(true);
  };

  const handleSaveQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickAddInput.trim();
    if (!clean || !quickAddModalType) return;

    setSavingQuickAdd(true);
    try {
      if (quickAddModalType === 'domain') {
        if (!clubMetadata.domains.some((d) => d.toLowerCase() === clean.toLowerCase())) {
          const updated = { ...clubMetadata, domains: [...clubMetadata.domains, clean] };
          await saveClubMetadata(updated);
          setClubMetadata(updated);
          setMemberFormData((prev) => ({ ...prev, team: clean }));
        }
      } else {
        if (!clubMetadata.positions.some((p) => p.toLowerCase() === clean.toLowerCase())) {
          const updated = { ...clubMetadata, positions: [...clubMetadata.positions, clean] };
          await saveClubMetadata(updated);
          setClubMetadata(updated);
          setMemberFormData((prev) => ({ ...prev, position: clean }));
        }
      }
      setQuickAddModalType(null);
      setQuickAddInput('');
    } catch (err: any) {
      alert('Failed to add ' + quickAddModalType + ': ' + err.message);
    } finally {
      setSavingQuickAdd(false);
    }
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      setMemberFormError('Permission denied: You have view-only access to the Members Roster.');
      return;
    }
    setMemberFormError('');

    const cleanName = memberFormData.name.trim();
    const cleanReg = memberFormData.registrationNumber.trim().toUpperCase();
    const cleanEmail = memberFormData.email.toLowerCase().trim();
    const cleanDomain = memberFormData.team.trim();
    const cleanPosition = memberFormData.position.trim();
    const cleanPhone = (memberFormData.phone || '').trim();

    // Compulsory fields check: Name, RegNo, Email, Primary Domain, Position are COMPULSORY
    if (!cleanName) {
      setMemberFormError('Full Name is compulsory.');
      return;
    }
    if (!cleanReg) {
      setMemberFormError('Registration Number is compulsory.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setMemberFormError('A valid official institutional email is compulsory.');
      return;
    }
    if (!cleanDomain) {
      setMemberFormError('Primary Domain is compulsory. Please choose from dropdown.');
      return;
    }
    if (!cleanPosition) {
      setMemberFormError('Role / Designation is compulsory. Please choose from dropdown.');
      return;
    }
    // Phone is strictly OPTIONAL!

    setSavingMember(true);
    try {
      // Primary document key is the member's Registration Number (or existing doc ID)
      const targetDocId = (editingMember?.id || cleanReg || cleanEmail).trim();
      const nowIso = new Date().toISOString();

      // Modify the existing member document in Firestore directly
      await setDoc(
        doc(db, 'members', targetDocId),
        {
          name: cleanName,
          registrationNumber: cleanReg,
          email: cleanEmail,
          phone: cleanPhone,
          team: cleanDomain,
          position: cleanPosition,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // If a separate document keyed by email existed (e.g. from an accidental duplicate write), clean it up
      if (cleanEmail && cleanEmail !== targetDocId.toLowerCase() && cleanEmail !== targetDocId) {
        try {
          await deleteDoc(doc(db, 'members', cleanEmail));
        } catch (delErr) {
          // ignore if doc doesn't exist
        }
      }

      // If editing a member whose doc ID changed from an old ID, delete the old doc
      if (editingMember?.id && editingMember.id !== targetDocId) {
        try {
          await deleteDoc(doc(db, 'members', editingMember.id));
        } catch (delErr) {
          // ignore
        }
      }

      // 2. Synchronize changes directly with the 'id_cards' collection in Firebase
      try {
        const oldEmail = (editingMember?.email || '').toLowerCase().trim();
        const oldReg = (editingMember?.registrationNumber || '').toUpperCase().trim();

        const idCardDocsToUpdate: { ref: any; id: string; data: any }[] = [];
        const checkedIdCardIds = new Set<string>();

        const inspectIdCardDoc = async (id: string) => {
          if (!id || checkedIdCardIds.has(id)) return;
          checkedIdCardIds.add(id);
          try {
            const snap = await getDoc(doc(db, 'id_cards', id));
            if (snap.exists()) {
              idCardDocsToUpdate.push({ ref: snap.ref, id: snap.id, data: snap.data() });
            }
          } catch {}
        };

        // Check direct document IDs
        if (cleanEmail) await inspectIdCardDoc(cleanEmail);
        if (oldEmail && oldEmail !== cleanEmail) await inspectIdCardDoc(oldEmail);
        if (cleanReg) await inspectIdCardDoc(cleanReg);
        if (oldReg && oldReg !== cleanReg) await inspectIdCardDoc(oldReg);

        // Query by email and regNo in case document ID is keyed differently
        const idCardQueries = [];
        if (cleanEmail) idCardQueries.push(query(collection(db, 'id_cards'), where('email', '==', cleanEmail)));
        if (oldEmail && oldEmail !== cleanEmail) idCardQueries.push(query(collection(db, 'id_cards'), where('email', '==', oldEmail)));
        if (cleanReg) {
          idCardQueries.push(query(collection(db, 'id_cards'), where('registrationNumber', '==', cleanReg)));
          idCardQueries.push(query(collection(db, 'id_cards'), where('regNo', '==', cleanReg)));
        }
        if (oldReg && oldReg !== cleanReg) {
          idCardQueries.push(query(collection(db, 'id_cards'), where('registrationNumber', '==', oldReg)));
          idCardQueries.push(query(collection(db, 'id_cards'), where('regNo', '==', oldReg)));
        }

        for (const q of idCardQueries) {
          try {
            const qSnap = await getDocs(q);
            qSnap.forEach((d) => {
              if (!checkedIdCardIds.has(d.id)) {
                checkedIdCardIds.add(d.id);
                idCardDocsToUpdate.push({ ref: d.ref, id: d.id, data: d.data() });
              }
            });
          } catch {}
        }

        if (idCardDocsToUpdate.length > 0) {
          // Merge with existing ID card submission data (photos, status, submittedAt, etc.)
          const primaryDoc = idCardDocsToUpdate.find((d) => d.data?.photoUrl || d.data?.avatarUrl) || idCardDocsToUpdate[0];
          const existingData = primaryDoc.data || {};

          const updatedIdCardPayload = {
            ...existingData,
            name: cleanName,
            registrationNumber: cleanReg,
            regNo: cleanReg,
            email: cleanEmail,
            phone: cleanPhone || existingData.phone || '',
            team: cleanDomain,
            position: cleanPosition,
            role: cleanPosition,
            updatedAt: nowIso,
          };

          const targetIdCardDocId = cleanEmail || cleanReg;
          await setDoc(doc(db, 'id_cards', targetIdCardDocId), updatedIdCardPayload, { merge: true });

          // If the ID card was stored under an old doc ID (e.g. oldEmail or oldReg), clean up the old duplicate
          for (const extraDoc of idCardDocsToUpdate) {
            if (extraDoc.id !== targetIdCardDocId) {
              try {
                await deleteDoc(extraDoc.ref);
              } catch {}
            }
          }

          // Trigger Google Sheets sync for ID card record
          try {
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(`https://vrgc.club/card/${cleanReg}`)}`;
            const cardUrl = `https://vrgc.club/card/${cleanReg}`;
            const token = await getClientAuthToken();

            fetch('/api/sheets/id-card', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                action: 'sync_idcard',
                email: cleanEmail,
                name: cleanName,
                regNo: cleanReg,
                registrationNumber: cleanReg,
                phone: cleanPhone || existingData.phone || '',
                team: cleanDomain,
                position: cleanPosition,
                photoUrl: existingData.photoUrl || '',
                avatarUrl: existingData.avatarUrl || '',
                qrCode: qrCodeUrl,
                cardUrl: cardUrl,
                submittedAt: existingData.submittedAt || '',
                status: existingData.status || 'Approved',
              }),
            }).catch(() => {});
          } catch {}
        }
      } catch (idSyncErr) {
        console.warn('Sync to id_cards table warning:', idSyncErr);
      }

      // Immediate local state update so the card refreshes without waiting for loadAllMembers
      const assignedTeams = extractMemberTeams(cleanDomain);
      const posLower = cleanPosition.toLowerCase();
      const teamLower = cleanDomain.toLowerCase();
      const isCoPres = (posLower.includes('president') || teamLower.includes('president')) && !posLower.includes('vice');
      const isCoord = posLower.includes('student coordinator') || teamLower.includes('student coordinator') || (posLower.includes('coordinator') && !posLower.includes('event'));
      const isLd = posLower.includes('lead') || posLower.includes('head');

      setMembers((prev) => {
        const found = prev.some((m) => m.registrationNumber === cleanReg || m.email.toLowerCase() === cleanEmail);
        if (found) {
          return prev.map((m) =>
            m.registrationNumber === cleanReg || m.email.toLowerCase() === cleanEmail
              ? {
                  ...m,
                  id: targetDocId,
                  name: cleanName,
                  registrationNumber: cleanReg,
                  phone: cleanPhone,
                  team: assignedTeams.join(' • '),
                  teams: assignedTeams,
                  position: cleanPosition,
                  isCoPresident: isCoPres,
                  isCoordinator: isCoord,
                  isLead: isLd,
                }
              : m
          );
        } else {
          return [
            {
              id: targetDocId,
              name: cleanName,
              registrationNumber: cleanReg,
              email: cleanEmail,
              phone: cleanPhone,
              team: assignedTeams.join(' • '),
              teams: assignedTeams,
              position: cleanPosition,
              avatarUrl: `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(cleanName || cleanEmail)}`,
              isCoPresident: isCoPres,
              isCoordinator: isCoord,
              isLead: isLd,
            },
            ...prev,
          ];
        }
      });

      setMemberModalOpen(false);
      setEditingMember(null);
      await loadAllMembers();
    } catch (err: any) {
      console.error('Error saving member:', err);
      setMemberFormError(err?.message || 'Failed to save member record.');
    } finally {
      setSavingMember(false);
    }
  };

  // ─── Delete Member ──────────────────────────────────────────────────────────
  const executeDeleteForMember = async (member: RosterMember) => {
      const targetDocId = (member.id || '').trim();
      const cleanEmail = (member.email || '').toLowerCase().trim();
      const cleanReg = (member.registrationNumber || '').toUpperCase().trim();
      
      // 1. Delete from Firestore 'members' collection
      if (targetDocId) {
        await deleteDoc(doc(db, 'members', targetDocId)).catch(() => {});
      }
      if (cleanEmail) {
        await deleteDoc(doc(db, 'members', cleanEmail)).catch(() => {});
        const qMemEmail = query(collection(db, 'members'), where('email', '==', cleanEmail));
        const snapMemEmail = await getDocs(qMemEmail);
        snapMemEmail.forEach((d) => deleteDoc(d.ref).catch(() => {}));
      }
      if (cleanReg) {
        await deleteDoc(doc(db, 'members', cleanReg)).catch(() => {});
        await deleteDoc(doc(db, 'members', cleanReg.toLowerCase())).catch(() => {});
        const qMemReg = query(collection(db, 'members'), where('registrationNumber', '==', cleanReg));
        const snapMemReg = await getDocs(qMemReg);
        snapMemReg.forEach((d) => deleteDoc(d.ref).catch(() => {}));
      }

      // 2. Delete from Firestore 'id_cards' collection (if present)
      if (targetDocId) {
        await deleteDoc(doc(db, 'id_cards', targetDocId)).catch(() => {});
      }
      if (cleanEmail) {
        await deleteDoc(doc(db, 'id_cards', cleanEmail)).catch(() => {});
        const qIdEmail = query(collection(db, 'id_cards'), where('email', '==', cleanEmail));
        const snapIdEmail = await getDocs(qIdEmail);
        snapIdEmail.forEach((d) => deleteDoc(d.ref).catch(() => {}));
      }
      if (cleanReg) {
        await deleteDoc(doc(db, 'id_cards', cleanReg)).catch(() => {});
        await deleteDoc(doc(db, 'id_cards', cleanReg.toLowerCase())).catch(() => {});
        const qIdReg = query(collection(db, 'id_cards'), where('regNo', '==', cleanReg));
        const snapIdReg = await getDocs(qIdReg);
        snapIdReg.forEach((d) => deleteDoc(d.ref).catch(() => {}));
      }

      // 3. Remove from Firestore 'referrals' collection
      // If this member came from referrals, remove their referral record so they can be re-referred cleanly
      if (cleanReg) {
        const qRefReg = query(collection(db, 'referrals'), where('candidateRegNo', '==', cleanReg));
        const snapRefReg = await getDocs(qRefReg);
        snapRefReg.forEach((d) => deleteDoc(d.ref).catch(() => {}));

        const qRefRegTitle = query(collection(db, 'referrals'), where('Candidate Registration Number', '==', cleanReg));
        const snapRefRegTitle = await getDocs(qRefRegTitle);
        snapRefRegTitle.forEach((d) => deleteDoc(d.ref).catch(() => {}));
      }
      if (cleanEmail) {
        const qRefEmail = query(collection(db, 'referrals'), where('candidateEmail', '==', cleanEmail));
        const snapRefEmail = await getDocs(qRefEmail);
        snapRefEmail.forEach((d) => deleteDoc(d.ref).catch(() => {}));
      }

  };

  const handleDeleteMember = async () => {
    if (!canManage || !deleteConfirmMember) return;
    setDeletingMember(true);
    try {
      await executeDeleteForMember(deleteConfirmMember);
      const targetDocId = (deleteConfirmMember.id || '').trim();
      const cleanEmail = (deleteConfirmMember.email || '').toLowerCase().trim();
      const cleanReg = (deleteConfirmMember.registrationNumber || '').toUpperCase().trim();
      setMembers((prev) => prev.filter((m) => {
        const matchId = targetDocId && m.id === targetDocId;
        const matchEmail = cleanEmail && m.email.toLowerCase() === cleanEmail;
        const matchReg = cleanReg && m.registrationNumber.toUpperCase() === cleanReg;
        return !matchId && !matchEmail && !matchReg;
      }));
      setDeleteConfirmMember(null);
      await loadAllMembers();
    } catch (err) {
      console.error('Error deleting member:', err);
    } finally {
      setDeletingMember(false);
    }
  };

  const executeBulkDeleteMembers = async () => {
    if (!canManage || !pendingBulkDelete || pendingBulkDelete.length === 0) return;
    setBulkUpdating(true);
    try {
      for (const member of pendingBulkDelete) {
        await executeDeleteForMember(member);
      }
      setMembers((prev) => prev.filter((m) => !selectedMemberIds.has(getMemberKey(m))));
      setSelectedMemberIds(new Set());
      setPendingBulkDelete(null);
      await loadAllMembers();
    } catch (err: any) {
      console.error('Error in bulk delete:', err);
      alert('Failed to delete selected members: ' + (err?.message || 'Unknown error'));
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleToggleBlockMember = async (member: RosterMember, explicitStatus?: boolean) => {
    if (!canBlockAccess) return;
    try {
      const newStatus = explicitStatus !== undefined ? explicitStatus : !member.isBlocked;
      const cleanEmail = (member.email || '').toLowerCase().trim();
      const cleanReg = (member.registrationNumber || '').toUpperCase().trim();
      const targetDocId = (member.id || cleanReg || cleanEmail).replace(/\//g, '_');

      // Optimistically update local UI state
      setMembers((prev) =>
        prev.map((m) => {
          const matchId = targetDocId && m.id === targetDocId;
          const matchEmail = cleanEmail && m.email.toLowerCase() === cleanEmail;
          const matchReg = cleanReg && m.registrationNumber.toUpperCase() === cleanReg;
          return matchId || matchEmail || matchReg ? { ...m, isBlocked: newStatus } : m;
        })
      );

      // 1. Direct Firestore update for active sync (only update existing docs)
      try {
        if (cleanEmail) {
          const emailSnap = await getDocs(query(collection(db, 'members'), where('email', '==', cleanEmail)));
          emailSnap.forEach((d) => {
            setDoc(d.ref, { isBlocked: newStatus, updatedAt: new Date().toISOString() }, { merge: true }).catch(console.warn);
          });

          // Sync to id_cards collection if document exists
          const idCardDocRef = doc(db, 'id_cards', cleanEmail);
          getDoc(idCardDocRef).then((idSnap) => {
            if (idSnap.exists()) {
              setDoc(idCardDocRef, { isBlocked: newStatus, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
            }
          }).catch(() => {});
        }

        if (cleanReg) {
          const regSnap = await getDocs(query(collection(db, 'members'), where('registrationNumber', '==', cleanReg)));
          regSnap.forEach((d) => {
            setDoc(d.ref, { isBlocked: newStatus, updatedAt: new Date().toISOString() }, { merge: true }).catch(console.warn);
          });
        }

        if (cleanEmail) {
          if (newStatus) {
            await setDoc(doc(db, 'blocked_users', cleanEmail), {
              email: cleanEmail,
              registrationNumber: cleanReg || '',
              isBlocked: true,
              updatedAt: new Date().toISOString(),
            }, { merge: true }).catch(console.warn);
          } else {
            await deleteDoc(doc(db, 'blocked_users', cleanEmail)).catch(() => {});
          }
        }
      } catch (fsErr) {
        console.warn('Direct Firestore block update notice:', fsErr);
      }

      // 2. Call Backend API to update Firestore & Firebase Auth credentials
      try {
        const token = await getClientAuthToken();
        const res = await fetch('/api/members/block', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            email: cleanEmail,
            registrationNumber: cleanReg,
            isBlocked: newStatus,
          }),
        });

        const resData = await res.json();
        if (!res.ok || !resData.success) {
          console.warn('Backend block endpoint response:', resData);
        }
      } catch (apiErr) {
        console.warn('Backend block API fetch notice:', apiErr);
      }
    } catch (e: any) {
      console.error('Failed to update member access:', e);
      alert('Failed to update member access: ' + (e?.message || e));
      await loadAllMembers(false);
    }
  };

  const executeBulkBlockMembers = async (newStatus: boolean) => {
    if (selectedMemberIds.size === 0) return;
    setBulkUpdating(true);
    try {
      const targetMembers = members.filter(m => selectedMemberIds.has(getMemberKey(m)));
      for (const member of targetMembers) {
         if (member.position?.toLowerCase().includes('super')) continue;
         if (member.isBlocked === newStatus) continue;
         await handleToggleBlockMember(member, newStatus);
      }
      // Retain selection so the user can continue viewing and managing their selected batch
    } catch (err: any) {
      console.error('Error in bulk block:', err);
      alert('Failed to update member access for some members.');
    } finally {
      setBulkUpdating(false);
      await loadAllMembers(false);
    }
  };

  useEffect(() => {
    if (importModalOpen || memberModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [importModalOpen, memberModalOpen]);

  return (
    <div className="flex-grow w-full max-w-full overflow-x-clip bg-transparent p-3 sm:p-6 md:p-8 pb-12 sm:pb-16 text-left text-white select-none">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        
        {/* Page Header */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[#262626]">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="px-3 py-1 rounded-md text-[10px] font-black bg-purple-900/60 text-purple-300 border border-purple-600 flex items-center gap-1.5 shadow-[0_0_12px_rgba(147,51,234,0.2)]">
                <span className="material-symbols-outlined text-[13px]">groups</span>
                VRGC CHAPTER ROSTER
              </span>
              <span className="text-[10px] sm:text-[11px] text-slate-400 font-mono">STUDENT LEADERSHIP &amp; CREW DIRECTORY</span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight">
              Club Members &amp; Team Breakdown
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl">
              Official organizational structure of Virtual Reality &amp; Gaming Club with total strength, team subdivisions, and student governance.
            </p>
          </div>

          {/* Header Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Admin-only Import and Add controls */}
            {canManage && (
              <>
                <SpecularButton
                  size="sm"
                  radius={12}
                  tint="#9333ea"
                  tintOpacity={0.8}
                  lineColor="#c084fc"
                  baseColor="#581c87"
                  intensity={1.2}
                  onClick={() => {
                    setImportError('');
                    setImportStep('upload');
                    setImportModalOpen(true);
                  }}
                  disabled={importingFile}
                  className="font-bold text-white shadow-[0_0_15px_rgba(147,51,234,0.3)]"
                >
                  <span className="material-symbols-outlined text-base">upload_file</span>
                  <span>{importingFile ? 'Parsing...' : 'Import CSV / Excel'}</span>
                </SpecularButton>

                <SpecularButton
                  size="sm"
                  radius={12}
                  tint="#1e132e"
                  tintOpacity={0.7}
                  lineColor="#c084fc"
                  baseColor="#581c87"
                  intensity={1.1}
                  onClick={() => openMemberModal()}
                  className="font-bold text-purple-200"
                >
                  <span className="material-symbols-outlined text-base">person_add</span>
                  <span>Add Member</span>
                </SpecularButton>
              </>
            )}

            <SpecularButton
              size="sm"
              radius={12}
              tint="#1a1a1a"
              tintOpacity={0.6}
              lineColor="#94a3b8"
              baseColor="#334155"
              intensity={0.9}
              onClick={() => {
                setSearchQuery('');
                setSelectedTeam('ALL');
                setSelectedPosition('ALL');
                setBlockedFilter('ALL');
              }}
              className="font-bold text-slate-300"
            >
              <span className="material-symbols-outlined text-sm">filter_alt_off</span>
              <span>Reset Filters</span>
            </SpecularButton>
          </div>
        </header>

        {/* Top Summary Cards: Total Strength + Team Counts */}
        <section className="space-y-4">
          <h2 className="text-xs font-bold text-purple-300 tracking-widest uppercase">
            Club Strength &amp; Division Metrics
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-4">
            {/* Total Members Card */}
            <div className="col-span-2 sm:col-span-3 lg:col-span-2 bg-[#141414] border border-purple-600/50 rounded-2xl p-4 sm:p-5 shadow-[0_0_25px_rgba(147,51,234,0.1)] flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-2 right-2 opacity-15">
                <span className="material-symbols-outlined text-6xl sm:text-7xl text-purple-400">diversity_3</span>
              </div>
              <div>
                <span className="text-[10px] font-black text-purple-400 uppercase tracking-wider block mb-1">
                  TOTAL VRGC STRENGTH
                </span>
                <div className="text-3xl sm:text-4xl font-black text-white">
                  {loading ? '…' : members.length}
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-2 sm:mt-3">
                Registered student members across all technical &amp; creative domains
              </p>
            </div>

            {/* Individual Team Cards */}
            {uniqueTeams.map((teamName) => {
              const count = teamCounts[teamName] || 0;
              const isSelected = selectedTeam.toLowerCase() === teamName.toLowerCase();

              return (
                <button
                  key={teamName}
                  onClick={() => setSelectedTeam(isSelected ? 'ALL' : teamName)}
                  className={`p-3 sm:p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between min-w-0 ${
                    isSelected
                      ? 'bg-purple-950 border-purple-500 shadow-[0_0_20px_rgba(147,51,234,0.3)]'
                      : 'bg-[#141414] border-[#262626] hover:border-purple-600/60'
                  }`}
                >
                  <span className="text-[10px] font-bold text-slate-400 uppercase truncate block">
                    {teamName}
                  </span>
                  <div className="text-xl sm:text-2xl font-black text-white mt-1.5 sm:mt-2">{count}</div>
                  <span className="text-[9px] text-purple-300/80 mt-1 font-semibold">Members</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Leadership & Executive Hierarchy */}
        {leadershipPeople.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xs font-bold text-purple-300 tracking-widest uppercase flex items-center gap-2">
              <span className="material-symbols-outlined text-base">military_tech</span>
              Executive Council &amp; Student Leadership
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {leadershipPeople.map((lead) => (
                <div
                  key={lead.id}
                  className="p-4 sm:p-5 bg-[#141414] border border-purple-600/40 rounded-2xl flex items-center gap-3.5 sm:gap-4 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
                >
                  <img
                    src={lead.avatarUrl}
                    alt={lead.name}
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-cover border border-purple-500 bg-purple-950 shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-purple-900/60 text-purple-300 border border-purple-600">
                      {lead.category}
                    </span>
                    <h4 className="text-sm font-black text-white truncate mt-1">{lead.name}</h4>
                    <p className="text-xs text-purple-300 truncate">{lead.role}</p>
                    {lead.regNoOrId && (
                      <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                        {lead.regNoOrId}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Search & Filter Toolbar */}
        <section className="space-y-3">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3.5 sm:p-4 bg-[#141414] border border-[#262626] rounded-2xl">
            {/* Search Input */}
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-lg">search</span>
              <input
                type="text"
                placeholder="Search member by name, reg number, email, or domain..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-[#1c1c1c] border border-[#333333] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            {/* Filter Dropdowns & View Mode */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-2.5 w-full md:w-auto">
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="flex-1 sm:flex-initial px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-xl text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer min-w-[130px]"
              >
                <option value="ALL">All Domains</option>
                {uniqueTeams.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <select
                value={selectedPosition}
                onChange={(e) => setSelectedPosition(e.target.value)}
                className="flex-1 sm:flex-initial px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-xl text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer min-w-[120px]"
              >
                <option value="ALL">All Roles</option>
                <option value="CO_PRESIDENT">Co-Presidents</option>
                <option value="COORDINATOR">Student Coordinators</option>
                <option value="LEAD">Leads &amp; Heads</option>
                <option value="MEMBER">Crew Members</option>
              </select>

              <select
                value={blockedFilter}
                onChange={(e) => setBlockedFilter(e.target.value as 'ALL' | 'BLOCKED' | 'UNBLOCKED')}
                className="flex-1 sm:flex-initial px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-xl text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer min-w-[120px]"
              >
                <option value="ALL">All Status</option>
                <option value="UNBLOCKED">Active</option>
                <option value="BLOCKED">Blocked</option>
              </select>

              {/* View Toggle */}
              <div className="flex items-center bg-[#1c1c1c] border border-[#333333] rounded-xl p-1 shrink-0">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    viewMode === 'grid' ? 'bg-purple-700 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Grid View"
                >
                  <span className="material-symbols-outlined text-base">grid_view</span>
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    viewMode === 'table' ? 'bg-purple-700 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Table View"
                >
                  <span className="material-symbols-outlined text-base">table_rows</span>
                </button>
              </div>
            </div>
          </div>

          {/* Bulk Actions Toolbar */}
          {selectedMemberIds.size > 0 && canManage && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-purple-900/20 border border-purple-500/40 rounded-xl mb-4 shadow-[0_0_15px_rgba(168,85,247,0.15)] animate-in slide-in-from-top-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/30 flex items-center justify-center text-purple-200">
                  <span className="material-symbols-outlined text-sm">checklist</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">
                    {selectedMemberIds.size} Member(s) Selected
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedMemberIds(new Set())}
                    className="text-[11px] text-purple-300 hover:text-white underline cursor-pointer ml-1"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canBlockAccess && hasSelectedUnblocked && !hasSelectedBlocked && (
                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => executeBulkBlockMembers(true)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-red-950/80 border border-red-500/60 text-red-300 hover:bg-red-900 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">block</span>
                    Block Selected
                  </button>
                )}
                {canBlockAccess && hasSelectedBlocked && !hasSelectedUnblocked && (
                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => executeBulkBlockMembers(false)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold font-mono bg-amber-950/80 border border-amber-500/60 text-amber-300 hover:bg-amber-900 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">lock_open</span>
                    Unblock Selected
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => {
                      const targetMembers = members.filter(m => selectedMemberIds.has(getMemberKey(m)));
                      if (targetMembers.length > 0) setPendingBulkDelete(targetMembers);
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

          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>
              Showing <strong className="text-white">{visibleMembers.length}</strong> of{' '}
              <strong className="text-purple-300">{filteredMembers.length}</strong> {filteredMembers.length !== members.length ? `filtered (from ${members.length} total)` : 'total crew members'}
            </span>
            {!canManage && (
              <span className="text-[11px] text-slate-500 font-mono">
                [ Directory Mode: View Only ]
              </span>
            )}
          </div>
        </section>

        {/* Member Directory: Grid or Table View */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-3 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-xs text-purple-300 font-mono tracking-widest uppercase">
              Loading VRGC Member Directory…
            </span>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-12 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-slate-500">search_off</span>
            <h3 className="text-lg font-bold text-white">No Members Match Current Filters</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Try clearing your search query or selecting &quot;All Domains&quot; from the filter options above.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedTeam('ALL');
                setSelectedPosition('ALL');
                setBlockedFilter('ALL');
              }}
              className="px-4 py-2 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold transition-all mt-2 cursor-pointer"
            >
              Clear All Filters
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleMembers.map((m) => {
              const isLead = m.isCoPresident || m.isCoordinator || m.isLead;

              return (
                <div
                  key={m.id || m.email}
                  className={`group relative bg-[#141414] border rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_0_25px_rgba(147,51,234,0.15)] ${
                    isLead ? 'border-purple-600/50 bg-[#161616]' : 'border-[#262626] hover:border-purple-600/60'
                  }`}
                >
                  <div>
                    {/* Top Avatar & Position Badge */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        {canManage && (
                          <input
                            type="checkbox"
                            checked={selectedMemberIds.has(getMemberKey(m))}
                            onChange={() => handleToggleSelectOne(getMemberKey(m))}
                            className="w-4 h-4 rounded accent-purple-600 cursor-pointer"
                          />
                        )}
                        <img
                          src={m.avatarUrl}
                          alt={m.name}
                          className="w-12 h-12 rounded-xl object-cover border border-purple-500 bg-purple-950 shrink-0"
                        />
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded text-[9px] font-bold border truncate max-w-[140px] ${
                          m.isCoPresident
                            ? 'bg-amber-950/60 text-amber-300 border-amber-600'
                            : m.isCoordinator
                            ? 'bg-indigo-950/60 text-indigo-300 border-indigo-600'
                            : isLead
                            ? 'bg-purple-950/60 text-purple-200 border-purple-600'
                            : 'bg-[#222222] text-slate-300 border-[#333333]'
                        }`}
                      >
                        {m.position}
                      </span>
                    </div>

                    {/* Member Details */}
                    <h3 className="text-base font-black text-white group-hover:text-purple-300 transition-colors truncate">
                      {m.name}
                    </h3>
                    <p className="text-xs text-purple-300/90 font-semibold truncate mt-0.5">{m.team}</p>

                    <div className="mt-3 space-y-1 text-[11px] text-slate-400 font-mono">
                      {m.registrationNumber && (
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-slate-500">REG:</span>
                          <span className="text-slate-300 font-bold">{m.registrationNumber}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-slate-500">MAIL:</span>
                        <span className="text-slate-300 truncate">{m.email}</span>
                      </div>
                      {m.phone && (
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-slate-500">TEL:</span>
                          <span className="text-slate-300">{m.phone}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Footer: Domain tag + Admin Actions */}
                  <div className="mt-4 pt-3 border-t border-[#262626] flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-400 uppercase truncate max-w-[120px]">
                      {m.team}
                    </span>

                    {/* Admin Actions (Edit, Delete, Block) */}
                    {(canManage || canBlockAccess) ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {canBlockAccess && !m.position?.toLowerCase().includes('super') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleBlockMember(m);
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
                              m.isBlocked 
                                ? 'bg-amber-950/70 hover:bg-amber-900 text-amber-300 border-amber-600/50' 
                                : 'bg-red-950/70 hover:bg-red-900 text-red-300 border-red-600/50'
                            }`}
                            title={m.isBlocked ? "Unblock Access to VRGC Forms" : "Block Access to VRGC Forms"}
                          >
                            <span className="material-symbols-outlined text-[12px]">{m.isBlocked ? 'lock_open' : 'block'}</span>
                            <span>{m.isBlocked ? "Unblock" : "Block"}</span>
                          </button>
                        )}
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() => openMemberModal(m)}
                              className="px-2 py-1 bg-[#222222] hover:bg-purple-700 text-white rounded text-[10px] font-bold transition-colors cursor-pointer"
                              title="Edit Member Details"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmMember(m)}
                              className="px-2 py-1 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/40 rounded text-[10px] font-bold transition-colors cursor-pointer"
                              title="Delete Member"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Table View */
          <div className="bg-transparent md:bg-[#141414] border-0 md:border md:border-[#262626] rounded-2xl md:overflow-hidden md:shadow-xl">
            {/* Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[720px] text-left text-xs text-slate-300">
                <thead className="bg-[#181818] text-purple-300 font-bold border-b border-[#262626]">
                  <tr>
                    {canManage && (
                      <th className="py-3.5 px-4 w-10">
                        <input
                          type="checkbox"
                          checked={
                            visibleMembers.length > 0 &&
                            visibleMembers.every((m) => selectedMemberIds.has(getMemberKey(m)))
                          }
                          onChange={handleToggleSelectAll}
                          className="w-4 h-4 rounded accent-purple-600 cursor-pointer"
                          title="Select All / Deselect All Visible Members"
                        />
                      </th>
                    )}
                    <th className="py-3.5 px-4">Member Name</th>
                    <th className="py-3.5 px-4">Registration No.</th>
                    <th className="py-3.5 px-4">Domain / Team</th>
                    <th className="py-3.5 px-4">Role / Position</th>
                    <th className="py-3.5 px-4">Official Email</th>
                    <th className="py-3.5 px-4">Contact</th>
                    {(canManage || canBlockAccess) && <th className="py-3.5 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {visibleMembers.map((m) => (
                    <tr key={m.id || m.email} className={`hover:bg-[#1c1c1c] transition-colors ${selectedMemberIds.has(getMemberKey(m)) ? 'bg-purple-900/20' : ''}`}>
                      {canManage && (
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={selectedMemberIds.has(getMemberKey(m))}
                            onChange={() => handleToggleSelectOne(getMemberKey(m))}
                            className="w-4 h-4 rounded accent-purple-600 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="py-3 px-4 flex items-center gap-2.5 font-bold text-white">
                        <img
                          src={m.avatarUrl}
                          alt={m.name}
                          className="w-7 h-7 rounded-lg object-cover bg-purple-950 border border-[#333333]"
                        />
                        <span className="truncate max-w-[180px]">{m.name}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-purple-300 font-bold">{m.registrationNumber || '—'}</td>
                      <td className="py-3 px-4">{m.team}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            m.isCoPresident
                              ? 'bg-amber-950/60 text-amber-300 border border-amber-600'
                              : m.isCoordinator
                              ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-600'
                              : m.isLead
                              ? 'bg-purple-950/60 text-purple-200 border border-purple-600'
                              : 'bg-[#222222] text-slate-300'
                          }`}
                        >
                          {m.position}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">{m.email}</td>
                      <td className="py-3 px-4 font-mono text-slate-400">{m.phone || '—'}</td>
                      {(canManage || canBlockAccess) && (
                        <td className="py-3 px-4 text-right flex justify-end items-center space-x-2">
                          {canBlockAccess && !m.position?.toLowerCase().includes('super') && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleBlockMember(m);
                              }}
                              className={`px-2.5 py-1 rounded text-[11px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
                                m.isBlocked
                                  ? 'bg-amber-950/70 hover:bg-amber-900 text-amber-300 border-amber-600/50'
                                  : 'bg-red-950/70 hover:bg-red-900 text-red-300 border-red-600/50'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[12px]">{m.isBlocked ? 'lock_open' : 'block'}</span>
                              <span>{m.isBlocked ? 'Unblock' : 'Block'}</span>
                            </button>
                          )}
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => openMemberModal(m)}
                                className="px-2.5 py-1 bg-[#222222] hover:bg-purple-700 text-white rounded text-[11px] font-bold transition-colors cursor-pointer"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmMember(m)}
                                className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                                title="Delete Member"
                              >
                                <span className="material-symbols-outlined text-base">delete</span>
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive Roster List (< md) - Subtle Gapping between Cards */}
            <div className="md:hidden space-y-2.5">
              {visibleMembers.map((m) => (
                <div
                  key={m.id || m.email}
                  className={`p-3.5 space-y-2.5 bg-[#141414] border border-[#262626] hover:border-purple-500/40 rounded-2xl transition-all shadow-sm ${selectedMemberIds.has(getMemberKey(m)) ? 'bg-purple-900/20' : ''}`}
                >
                  {/* Top Bar: Avatar + Name + Reg No + Role Badge */}
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {canManage && (
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.has(getMemberKey(m))}
                          onChange={() => handleToggleSelectOne(getMemberKey(m))}
                          className="w-4 h-4 rounded accent-purple-600 cursor-pointer shrink-0"
                        />
                      )}
                      <img
                        src={m.avatarUrl}
                        alt={m.name}
                        className="w-9 h-9 rounded-lg object-cover bg-purple-950 border border-purple-500/40 shrink-0"
                      />
                      <div className="min-w-0">
                        <h4 className="text-xs font-black text-white truncate">{m.name}</h4>
                        <div className="text-[10px] font-mono text-purple-300 font-bold tracking-wider">
                          {m.registrationNumber || '—'}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-bold border shrink-0 ${
                        m.isCoPresident
                          ? 'bg-amber-950/60 text-amber-300 border-amber-600'
                          : m.isCoordinator
                          ? 'bg-indigo-950/60 text-indigo-300 border-indigo-600'
                          : m.isLead
                          ? 'bg-purple-950/60 text-purple-200 border border-purple-600'
                          : 'bg-[#222222] text-slate-300 border-[#333333]'
                      }`}
                    >
                      {m.position}
                    </span>
                  </div>

                  {/* Metadata: Domain + Email + Phone */}
                  <div className="space-y-1 text-[11px] text-slate-400 font-mono">
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <span className="text-[9.5px] text-purple-400 font-bold uppercase tracking-wider font-sans">
                        DOMAIN:
                      </span>
                      <span className="font-sans font-semibold text-xs text-purple-200 truncate">
                        {m.team}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-[9.5px] text-slate-500 font-bold">MAIL:</span>
                      <span className="text-slate-300 truncate">{m.email}</span>
                    </div>

                    {m.phone && (
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-[9.5px] text-slate-500 font-bold">TEL:</span>
                        <span className="text-slate-300">{m.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Bottom: Action Buttons for Admins or Active Status */}
                  <div className="pt-2 border-t border-[#222222] flex items-center justify-between">
                    <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active Member
                    </span>

                    {(canManage || canBlockAccess) && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {canBlockAccess && !m.position?.toLowerCase().includes('super') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleBlockMember(m);
                            }}
                            className={`px-2.5 py-1 rounded text-[10.5px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
                              m.isBlocked
                                ? 'bg-amber-950/70 hover:bg-amber-900 text-amber-300 border-amber-600/50'
                                : 'bg-red-950/70 hover:bg-red-900 text-red-300 border-red-600/50'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[12px]">{m.isBlocked ? 'lock_open' : 'block'}</span>
                            <span>{m.isBlocked ? 'Unblock' : 'Block'}</span>
                          </button>
                        )}
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() => openMemberModal(m)}
                              className="px-2.5 py-1 bg-[#222222] hover:bg-purple-700 text-white rounded text-[10.5px] font-bold transition-colors cursor-pointer flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[12px]">edit</span>
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmMember(m)}
                              className="px-2.5 py-1 bg-rose-950/50 hover:bg-rose-900 text-rose-300 rounded text-[10.5px] font-bold border border-rose-800/40 transition-colors cursor-pointer flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[12px]">delete</span>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Load More Members Button (Progressive Pagination like ID Card Portal) */}
        {!loading && filteredMembers.length > 0 && (
          <div className="space-y-2 pt-2">
            {visibleMembers.length < filteredMembers.length && (
              <div className="text-center pt-4 pb-2 relative z-20">
                <button
                  type="button"
                  onClick={() => setPageLimit((prev) => prev + PAGE_SIZE)}
                  className="px-6 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-bold uppercase tracking-wider hover:bg-purple-500/20 hover:border-purple-500/50 hover:text-white transition-all duration-300 shadow-[0_0_15px_rgba(168,85,247,0.15)] active:scale-95 inline-flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">expand_more</span>
                  <span>LOAD MORE MEMBERS ({filteredMembers.length - visibleMembers.length} REMAINING)</span>
                </button>
              </div>
            )}
            {visibleMembers.length >= filteredMembers.length && filteredMembers.length > PAGE_SIZE && (
              <div className="text-center pt-4 pb-2 text-[11px] font-mono text-slate-500">
                All {filteredMembers.length} members loaded
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── UNIFIED MODAL: Spreadsheet Import & Member Preview ────────────────── */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv, .xlsx, .xls, .tsv, .txt"
        disabled={importingFile}
        onChange={handleFileUpload}
        style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0 }}
      />

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {importModalOpen && (
            <motion.div
              key="import-modal"
              initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/90 backdrop-blur-md"
          >
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-[#121212] border border-purple-600 rounded-2xl shadow-[0_0_50px_rgba(147,51,234,0.35)] overflow-hidden text-left"
            >
              {/* Modal Header */}
              <div className="p-4 sm:p-5 bg-[#181818] border-b border-[#262626] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-900/40 border border-purple-500/40 flex items-center justify-center text-purple-300">
                    <span className="material-symbols-outlined text-2xl">
                      {importStep === 'preview' ? 'table_view' : 'upload_file'}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                      <span>{importStep === 'preview' ? 'Spreadsheet Import Preview' : 'Import Members from Spreadsheet'}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {importStep === 'preview'
                        ? `${uploadedFileName} (${uploadedFileSize}) • ${previewMembers.length} member records parsed`
                        : 'Upload a CSV, Excel (.xlsx, .xls), or TSV file to preview before importing.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setImportModalOpen(false);
                    setImportStep('upload');
                    setPreviewMembers([]);
                  }}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer p-1 rounded-lg hover:bg-[#252525]"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#0e0e0e] space-y-5">
                {importError && (
                  <div className="p-3.5 bg-rose-950/70 border border-rose-600/70 rounded-xl text-rose-200 text-xs font-medium flex items-center gap-2">
                    <span className="material-symbols-outlined text-rose-400 text-base">error</span>
                    <span>{importError}</span>
                  </div>
                )}

                {/* ─── STEP 1: FILE UPLOAD ────────────────────────────────────────── */}
                {importStep === 'upload' && (
                  <div className="space-y-5">
                    {/* Drag and Drop Zone */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={handleDrop}
                      onClick={() => {
                        fileInputRef.current?.click();
                      }}
                      className="border-2 border-dashed border-purple-600/60 hover:border-purple-400 bg-purple-950/20 hover:bg-purple-950/40 rounded-2xl p-8 sm:p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all text-center group"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-purple-900/50 border border-purple-500/50 flex items-center justify-center text-purple-300 group-hover:scale-110 transition-transform shadow-xl shadow-purple-950/60">
                        <span className="material-symbols-outlined text-3xl">
                          {importingFile ? 'hourglass_top' : 'cloud_upload'}
                        </span>
                      </div>
                      <div>
                        <span className="text-base font-bold text-white block">
                          {importingFile ? 'Analyzing spreadsheet...' : 'Click to browse or drag & drop file here'}
                        </span>
                        <span className="text-xs text-slate-400 mt-1 block">
                          Supports .CSV, .XLSX, .XLS, .TSV
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 rounded bg-purple-900/40 border border-purple-700/40 text-[11px] font-mono text-purple-300">.CSV</span>
                        <span className="px-2 py-0.5 rounded bg-purple-900/40 border border-purple-700/40 text-[11px] font-mono text-purple-300">.XLSX</span>
                        <span className="px-2 py-0.5 rounded bg-purple-900/40 border border-purple-700/40 text-[11px] font-mono text-purple-300">.XLS</span>
                      </div>
                    </div>

                    {/* Column Requirements and Sample Template */}
                    <div className="bg-[#181818] p-4 sm:p-5 rounded-xl border border-[#262626] space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <h4 className="text-xs font-black text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-base">checklist</span>
                          Expected Columns in Spreadsheet
                        </h4>
                        <button
                          type="button"
                          onClick={handleDownloadTemplate}
                          className="self-start sm:self-auto px-3.5 py-1.5 bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 hover:text-white rounded-lg font-bold text-xs border border-purple-700/50 flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[16px]">download</span>
                          Download Sample Template (.csv)
                        </button>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed">
                        Column header names are flexibly matched (case-insensitive). You can export directly from Google Forms or Excel:
                      </p>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 text-xs font-mono">
                        <div className="bg-[#222222] p-2 rounded-lg border border-[#333333] flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                          <span className="text-purple-200">Name</span>
                        </div>
                        <div className="bg-[#222222] p-2 rounded-lg border border-[#333333] flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                          <span className="text-purple-200">Reg. Number</span>
                        </div>
                        <div className="bg-[#222222] p-2 rounded-lg border border-[#333333] flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                          <span className="text-purple-200">Email</span>
                        </div>
                        <div className="bg-[#222222] p-2 rounded-lg border border-[#333333] flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                          <span className="text-slate-400">Phone (Optional)</span>
                        </div>
                        <div className="bg-[#222222] p-2 rounded-lg border border-[#333333] flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                          <span className="text-purple-200">Domain / Team</span>
                        </div>
                        <div className="bg-[#222222] p-2 rounded-lg border border-[#333333] flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                          <span className="text-purple-200">Position / Role</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── STEP 2: MEMBER PREVIEW TABLE ────────────────────────────────── */}
                {importStep === 'preview' && (
                  <div className="space-y-4">
                    {/* Summary Statistics Badges */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                      <div className="bg-[#181818] p-3 rounded-xl border border-[#2a2a2a] text-center">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Total Parsed</span>
                        <span className="text-lg font-black text-white">{previewMembers.length}</span>
                      </div>
                      <div className="bg-[#181818] p-3 rounded-xl border border-emerald-900/50 text-center">
                        <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">New to Add</span>
                        <span className="text-lg font-black text-emerald-400">
                          {previewMembers.filter((m) => !m.isExisting).length}
                        </span>
                      </div>
                      <div className="bg-[#181818] p-3 rounded-xl border border-amber-900/50 text-center">
                        <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider block">Existing in DB</span>
                        <span className="text-lg font-black text-amber-400">
                          {previewMembers.filter((m) => m.isExisting).length}
                        </span>
                      </div>
                      <div className="bg-[#181818] p-3 rounded-xl border border-purple-900/50 text-center">
                        <span className="text-[10px] text-purple-300 font-bold uppercase tracking-wider block">Selected</span>
                        <span className="text-lg font-black text-purple-300">
                          {previewMembers.filter((m) => m.selected).length}
                        </span>
                      </div>
                    </div>

                    {/* Filter and Conflict Controls */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#141414] p-3 rounded-xl border border-[#262626]">
                      {/* Search Bar */}
                      <div className="relative flex-1 max-w-sm">
                        <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                          search
                        </span>
                        <input
                          type="text"
                          placeholder="Search preview by name, reg, email..."
                          value={previewSearch}
                          onChange={(e) => setPreviewSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 bg-[#1e1e1e] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      {/* Filter Tabs */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setPreviewFilter('all')}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                            previewFilter === 'all'
                              ? 'bg-purple-600 text-white'
                              : 'bg-[#222222] text-slate-400 hover:text-white'
                          }`}
                        >
                          All ({previewMembers.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewFilter('new')}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                            previewFilter === 'new'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-[#222222] text-slate-400 hover:text-white'
                          }`}
                        >
                          New ({previewMembers.filter((m) => !m.isExisting).length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewFilter('existing')}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                            previewFilter === 'existing'
                              ? 'bg-amber-600 text-white'
                              : 'bg-[#222222] text-slate-400 hover:text-white'
                          }`}
                        >
                          Updates ({previewMembers.filter((m) => m.isExisting).length})
                        </button>
                      </div>

                      {/* Conflict Action Choice */}
                      {previewMembers.some((m) => m.isExisting) && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-slate-400 text-[11px] font-bold">Duplicates:</span>
                          <select
                            value={conflictMode}
                            onChange={(e) => setConflictMode(e.target.value as 'update' | 'skip')}
                            className="bg-[#222222] border border-[#333333] rounded-lg px-2.5 py-1 text-xs text-purple-300 font-bold focus:outline-none"
                          >
                            <option value="update">Update Existing</option>
                            <option value="skip">Skip Existing</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Master Select All Toggle */}
                    <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none font-bold">
                        <input
                          type="checkbox"
                          checked={
                            previewMembers.length > 0 &&
                            previewMembers.every((m) => m.selected)
                          }
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setPreviewMembers((prev) =>
                              prev.map((m) => ({ ...m, selected: checked }))
                            );
                          }}
                          className="w-4 h-4 rounded accent-purple-600 cursor-pointer"
                        />
                        <span>Select All for Import</span>
                      </label>

                      <span className="text-[11px] text-slate-500 font-mono">
                        Showing{' '}
                        {
                          previewMembers.filter((m) => {
                            if (previewFilter === 'new' && m.isExisting) return false;
                            if (previewFilter === 'existing' && !m.isExisting) return false;
                            if (previewSearch) {
                              const q = previewSearch.toLowerCase();
                              return (
                                m.name.toLowerCase().includes(q) ||
                                m.registrationNumber.toLowerCase().includes(q) ||
                                m.email.toLowerCase().includes(q) ||
                                m.team.toLowerCase().includes(q) ||
                                m.position.toLowerCase().includes(q)
                              );
                            }
                            return true;
                          }).length
                        }{' '}
                        members
                      </span>
                    </div>

                    {/* Members Preview Table */}
                    <div className="border border-[#262626] rounded-xl overflow-hidden bg-[#141414] max-h-[50vh] overflow-y-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-[#1c1c1c] text-slate-400 font-bold text-[10px] uppercase sticky top-0 z-10 border-b border-[#262626]">
                          <tr>
                            <th className="p-3 w-10 text-center">#</th>
                            <th className="p-3">Member</th>
                            <th className="p-3">Reg. No</th>
                            <th className="p-3">Phone</th>
                            <th className="p-3">Domain</th>
                            <th className="p-3">Position</th>
                            <th className="p-3 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#222222]">
                          {previewMembers
                            .filter((m) => {
                              if (previewFilter === 'new' && m.isExisting) return false;
                              if (previewFilter === 'existing' && !m.isExisting) return false;
                              if (previewSearch) {
                                const q = previewSearch.toLowerCase();
                                return (
                                  m.name.toLowerCase().includes(q) ||
                                  m.registrationNumber.toLowerCase().includes(q) ||
                                  m.email.toLowerCase().includes(q) ||
                                  m.team.toLowerCase().includes(q) ||
                                  m.position.toLowerCase().includes(q)
                                );
                              }
                              return true;
                            })
                            .map((row, idx) => (
                              <tr
                                key={row.id}
                                className={`hover:bg-[#1a1a1a] transition-colors ${
                                  row.selected ? 'bg-purple-950/10' : 'opacity-60'
                                }`}
                              >
                                <td className="p-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={row.selected}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setPreviewMembers((prev) =>
                                        prev.map((item) =>
                                          item.id === row.id ? { ...item, selected: checked } : item
                                        )
                                      );
                                    }}
                                    className="w-4 h-4 rounded accent-purple-600 cursor-pointer"
                                  />
                                </td>
                                <td className="p-3">
                                  <div className="font-bold text-white flex items-center gap-2">
                                    <span>{row.name}</span>
                                  </div>
                                  <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                                    {row.email}
                                  </div>
                                </td>
                                <td className="p-3 font-mono text-purple-300 font-bold">
                                  {row.registrationNumber || '—'}
                                </td>
                                <td className="p-3 font-mono text-slate-300 text-[11px]">
                                  {row.phone || '—'}
                                </td>
                                <td className="p-3">
                                  <span className="px-2 py-0.5 rounded bg-purple-900/30 text-purple-200 border border-purple-700/30 text-[11px] font-medium">
                                    {row.team}
                                  </span>
                                </td>
                                <td className="p-3 text-slate-300">
                                  <span className="px-2 py-0.5 rounded bg-[#222222] text-slate-200 border border-[#333333] text-[11px] font-medium">
                                    {row.position}
                                  </span>
                                </td>
                                <td className="p-3 text-right">
                                  {row.isExisting ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/60 border border-amber-600/50 text-amber-300 text-[10px] font-bold">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                                      {conflictMode === 'update' ? 'Will Update' : 'Will Skip'}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-600/50 text-emerald-300 text-[10px] font-bold">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                      New Member
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 sm:p-5 bg-[#181818] border-t border-[#262626] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setImportModalOpen(false);
                      setImportStep('upload');
                      setPreviewMembers([]);
                    }}
                    className="px-4 py-2 bg-[#222222] hover:bg-[#333333] text-slate-300 rounded-xl font-bold text-xs cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>

                  {importStep === 'preview' && (
                    <button
                      type="button"
                      onClick={() => setImportStep('upload')}
                      className="px-3.5 py-2 bg-purple-950/40 hover:bg-purple-900/60 text-purple-300 border border-purple-700/40 rounded-xl font-bold text-xs cursor-pointer transition-colors flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[16px]">file_upload</span>
                      <span>Choose Different File</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {importStep === 'upload' ? (
                    <button
                      type="button"
                      onClick={() => {
                        fileInputRef.current?.click();
                      }}
                      disabled={importingFile}
                      className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 active:scale-95 text-white rounded-xl font-bold flex items-center gap-2 cursor-pointer shadow-lg shadow-purple-900/40 transition-all text-xs"
                    >
                      <span className="material-symbols-outlined text-[18px]">upload_file</span>
                      <span>{importingFile ? 'Parsing File...' : 'Choose File to Upload'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConfirmImport}
                      disabled={savingImport || previewMembers.filter((m) => m.selected).length === 0}
                      className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 active:scale-95 text-white rounded-xl font-black flex items-center gap-2 cursor-pointer shadow-xl shadow-purple-900/50 transition-all text-xs disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {savingImport ? (
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <span className="material-symbols-outlined text-[18px]">cloud_done</span>
                      )}
                      <span>
                        {savingImport
                          ? 'Importing to Database...'
                          : `Add ${previewMembers.filter((m) => m.selected).length} Members to DB`}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ─── MODAL 3: Manual Add / Edit Member ────────────────────────────────── */}
      {memberModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto custom-scrollbar bg-[#141414] border border-purple-600 rounded-2xl p-6 space-y-4 text-left shadow-[0_0_40px_rgba(147,51,234,0.3)] mx-1 sm:mx-0">
            <div className="flex items-center justify-between pb-3 border-b border-[#262626]">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400">group_add</span>
                {editingMember ? 'Modify Member Details' : 'Register New Club Member'}
              </h3>
              <button
                onClick={() => setMemberModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {memberFormError && (
              <div className="p-2.5 bg-rose-950/60 border border-rose-600/40 rounded-lg text-rose-300 text-xs font-medium">
                {memberFormError}
              </div>
            )}

            <form onSubmit={handleSaveMember} className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">FULL NAME * (COMPULSORY)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={memberFormData.name}
                  onChange={(e) => setMemberFormData({ ...memberFormData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">OFFICIAL EMAIL * (COMPULSORY)</label>
                  <input
                    type="email"
                    required
                    disabled={!!editingMember}
                    placeholder="e.g. name@vitbhopal.ac.in"
                    value={memberFormData.email}
                    onChange={(e) => setMemberFormData({ ...memberFormData, email: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">REGISTRATION NUMBER * (COMPULSORY)</label>
                  <input
                    type="text"
                    required
                    placeholder="25XXX10000"
                    value={memberFormData.registrationNumber}
                    onChange={(e) => setMemberFormData({ ...memberFormData, registrationNumber: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] font-bold text-slate-400">PRIMARY DOMAIN * (COMPULSORY)</label>
                    {canManageMetadata && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuickAddInput('');
                          setQuickAddModalType('domain');
                        }}
                        className="text-[10px] text-purple-400 hover:text-purple-300 font-bold flex items-center gap-0.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[12px]">add</span>
                        New Domain
                      </button>
                    )}
                  </div>
                  <select
                    required
                    value={memberFormData.team}
                    onChange={(e) => setMemberFormData({ ...memberFormData, team: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    {availableDomains.map((dom) => (
                      <option key={dom} value={dom}>
                        {dom}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] font-bold text-slate-400">ROLE / DESIGNATION * (COMPULSORY)</label>
                    {canManageMetadata && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuickAddInput('');
                          setQuickAddModalType('position');
                        }}
                        className="text-[10px] text-purple-400 hover:text-purple-300 font-bold flex items-center gap-0.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[12px]">add</span>
                        New Role
                      </button>
                    )}
                  </div>
                  <select
                    required
                    value={memberFormData.position}
                    onChange={(e) => setMemberFormData({ ...memberFormData, position: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    {availablePositions.map((pos) => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">PHONE NUMBER (OPTIONAL)</label>
                <input
                  type="tel"
                  placeholder="e.g. +91 9876543210 (Optional)"
                  value={memberFormData.phone}
                  onChange={(e) => setMemberFormData({ ...memberFormData, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#262626]">
                <button
                  type="button"
                  onClick={() => setMemberModalOpen(false)}
                  className="px-4 py-2 bg-[#262626] hover:bg-[#333333] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingMember}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingMember && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editingMember ? 'Save Changes' : 'Add to Roster'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {pendingBulkDelete && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[10000] p-4 bg-black/85 backdrop-blur-sm overflow-y-auto flex items-center justify-center">
          <div className="bg-[#121212] border border-rose-500/50 p-6 rounded-2xl max-w-sm w-full text-center space-y-4 shadow-[0_0_50px_rgba(244,63,94,0.3)]">
            <div className="w-12 h-12 rounded-full bg-rose-950 border border-rose-600 flex items-center justify-center mx-auto text-rose-400">
              <span className="material-symbols-outlined text-2xl">delete_sweep</span>
            </div>
            <div>
              <h4 className="text-sm font-black text-white">Delete {pendingBulkDelete.length} Members?</h4>
              <p className="text-xs text-slate-300 mt-1">
                Are you sure you want to permanently delete the <span className="text-rose-400 font-bold">{pendingBulkDelete.length} selected members</span> from the database? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <button
                onClick={() => setPendingBulkDelete(null)}
                className="px-4 py-2 bg-[#262626] hover:bg-[#333333] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={executeBulkDeleteMembers}
                disabled={bulkUpdating}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {bulkUpdating && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Yes, Delete All
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* ─── MODAL 4: Delete Member Confirmation ──────────────────────────────── */}
      {deleteConfirmMember && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/90">
          <div className="w-full max-w-sm bg-[#161616] border border-rose-600/60 rounded-2xl p-6 text-center space-y-4 shadow-[0_0_40px_rgba(225,29,72,0.3)]">
            <div className="w-12 h-12 rounded-full bg-rose-950 border border-rose-600 flex items-center justify-center mx-auto text-rose-400">
              <span className="material-symbols-outlined text-2xl">person_remove</span>
            </div>
            <div>
              <h4 className="text-sm font-black text-white">Remove Member</h4>
              <p className="text-xs text-slate-300 mt-1">
                Are you sure you want to remove <span className="text-rose-400 font-bold">{deleteConfirmMember.name}</span>{' '}
                ({deleteConfirmMember.email}) from the member roster in Firebase?
              </p>
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <button
                onClick={() => setDeleteConfirmMember(null)}
                className="px-4 py-2 bg-[#262626] hover:bg-[#333333] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteMember}
                disabled={deletingMember}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {deletingMember && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Yes, Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ─── MODAL 5: Quick Add Domain or Role (Delegated Metadata) ─────────────── */}
      {quickAddModalType && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <form
            onSubmit={handleSaveQuickAdd}
            className="w-full max-w-sm bg-[#141414] border border-purple-500 rounded-2xl p-5 space-y-4 shadow-2xl text-left"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#2b1442]">
              <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400 text-base">add_circle</span>
                Add New {quickAddModalType === 'domain' ? 'Primary Domain' : 'Club Role / Position'}
              </h4>
              <button
                type="button"
                onClick={() => setQuickAddModalType(null)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">
                {quickAddModalType === 'domain' ? 'Domain Name' : 'Position Title'}
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder={quickAddModalType === 'domain' ? 'e.g. AI & Robotics' : 'e.g. Student Lead'}
                value={quickAddInput}
                onChange={(e) => setQuickAddInput(e.target.value)}
                className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setQuickAddModalType(null)}
                className="px-3 py-1.5 bg-[#262626] hover:bg-[#333333] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingQuickAdd || !quickAddInput.trim()}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {savingQuickAdd && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Add &amp; Select
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
};

export default MembersRoster;
