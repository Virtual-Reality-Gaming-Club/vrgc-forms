"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import * as XLSX from 'xlsx';
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

interface MembersRosterProps {
  onRedirect?: () => void;
  isAdmin?: boolean;
}

const MembersRoster: React.FC<MembersRosterProps> = ({ onRedirect, isAdmin: propIsAdmin }) => {
  const { isSuperAdmin, userRole } = useAuth();
  const canManage = isSuperAdmin || (propIsAdmin ?? false);

  const [members, setMembers] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTeam, setSelectedTeam] = useState<string>('ALL');
  const [selectedPosition, setSelectedPosition] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Club metadata (domains & positions)
  const [clubMetadata, setClubMetadata] = useState<ClubMetadata>(DEFAULT_CLUB_METADATA);
  const [canManageMetadata, setCanManageMetadata] = useState<boolean>(false);
  const [quickAddModalType, setQuickAddModalType] = useState<'domain' | 'position' | null>(null);
  const [quickAddInput, setQuickAddInput] = useState<string>('');
  const [savingQuickAdd, setSavingQuickAdd] = useState<boolean>(false);

  // File import state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importingFile, setImportingFile] = useState<boolean>(false);
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [newEntriesToImport, setNewEntriesToImport] = useState<ParsedMemberRow[]>([]);
  const [clashingEntries, setClashingEntries] = useState<ClashingMemberRecord[]>([]);
  const [savingImport, setSavingImport] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>('');

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

  // Manual Edit inside Clash state
  const [clashEditTarget, setClashEditTarget] = useState<ClashingMemberRecord | null>(null);

  // Load members from Firestore `members` and `id_cards` collections
  const loadAllMembers = async () => {
    setLoading(true);
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
            });
          }
        });
      } catch (mErr) {
        console.warn('Error fetching members collection:', mErr);
      }

      // 2. Query `id_cards` collection to enrich member photos & missing records
      try {
        const idCardsSnap = await getDocs(collection(db, 'id_cards'));
        idCardsSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const email = (data.email || data.Email || '').toLowerCase().trim();
          const reg = (data.regNo || data.registrationNumber || docSnap.id || '').toUpperCase().trim();
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
          } else {
            // Add member from id_cards if not found in members collection
            const pos = (data.position || data.role || 'Member').trim();
            const rawTeam = (data.team || data.domain || 'General').trim();
            const posLower = pos.toLowerCase();
            const teamLower = rawTeam.toLowerCase();

            const isCoPres = (posLower.includes('president') || teamLower.includes('president')) && !posLower.includes('vice');
            const isCoord = posLower.includes('student coordinator') || teamLower.includes('student coordinator') || (posLower.includes('coordinator') && !posLower.includes('event'));
            const isLd = posLower.includes('lead') || posLower.includes('head');
            const assignedTeams = extractMemberTeams(rawTeam);
            const mapKey = email || reg || docSnap.id;

            membersMap.set(mapKey, {
              id: docSnap.id,
              name: data.name || data.fullName || 'Member',
              registrationNumber: reg,
              email: email || `${reg.toLowerCase()}@vitbhopal.ac.in`,
              phone: data.phone || '',
              team: assignedTeams.join(' • '),
              teams: assignedTeams,
              position: pos || 'Member',
              avatarUrl: idPhoto,
              isCoPresident: isCoPres,
              isCoordinator: isCoord,
              isLead: isLd,
            });
          }
        });
      } catch (idErr) {
        console.warn('Error fetching id_cards collection:', idErr);
      }

      // 3. Fallback any members without photos to personalized Dicebear avatar
      const membersList = Array.from(membersMap.values()).map((m) => ({
        ...m,
        avatarUrl: m.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(m.name || m.email || m.registrationNumber)}`,
      }));

      setMembers(membersList);
    } catch (err) {
      console.error('Failed to load roster:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllMembers();

    const loadMetaAndPerms = async () => {
      try {
        const meta = await fetchClubMetadata();
        setClubMetadata(meta);

        const perms = await fetchPermissionsConfig();
        const allowed = isSuperAdmin || (userRole ? perms.allowedMetadataRoles.includes(userRole) : false);
        setCanManageMetadata(allowed);
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

      return matchesSearch && matchesTeam && matchesPosition;
    });
  }, [members, searchQuery, selectedTeam, selectedPosition]);

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
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError('');
    setImportingFile(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

      if (rawRows.length === 0) {
        throw new Error('No data found in uploaded file.');
      }

      const parsedRows: ParsedMemberRow[] = [];

      rawRows.forEach((row) => {
        // Flexible key lookup
        const getVal = (possibleKeys: string[]) => {
          for (const k of possibleKeys) {
            for (const rowKey of Object.keys(row)) {
              if (rowKey.trim().toLowerCase() === k.toLowerCase()) {
                return String(row[rowKey]).trim();
              }
            }
          }
          return '';
        };

        const name = getVal(['name', 'full name', 'student name', 'member name']);
        const registrationNumber = getVal(['registration number', 'reg no', 'regno', 'reg. no.', 'registration_number']).toUpperCase();
        const email = getVal(['email', 'email address', 'mail', 'email id']).toLowerCase();
        const phone = getVal(['phone', 'phone number', 'mobile', 'contact', 'mobile number']);
        const team = getVal(['team', 'domain', 'subdivision', 'department']) || 'General';
        const position = getVal(['position', 'role', 'designation']) || 'Member';

        if (email || registrationNumber || name) {
          parsedRows.push({
            name: name || 'Member',
            registrationNumber,
            email,
            phone,
            team,
            position,
          });
        }
      });

      // Clash Detection
      const newItems: ParsedMemberRow[] = [];
      const clashes: ClashingMemberRecord[] = [];

      parsedRows.forEach((incoming, idx) => {
        const existing = members.find(
          (m) =>
            (incoming.email && m.email.toLowerCase() === incoming.email) ||
            (incoming.registrationNumber && m.registrationNumber && m.registrationNumber.toUpperCase() === incoming.registrationNumber)
        );

        if (existing) {
          // Check if values actually clash
          const nameClash = incoming.name && existing.name.toLowerCase() !== incoming.name.toLowerCase();
          const teamClash = incoming.team && existing.team.toLowerCase() !== incoming.team.toLowerCase();
          const posClash = incoming.position && existing.position.toLowerCase() !== incoming.position.toLowerCase();
          const regClash = incoming.registrationNumber && existing.registrationNumber !== incoming.registrationNumber;

          if (nameClash || teamClash || posClash || regClash) {
            clashes.push({
              id: `clash-${idx}`,
              incoming,
              existing,
              decision: 'update',
            });
          } else {
            // Identical or no major clash
            newItems.push(incoming);
          }
        } else {
          newItems.push(incoming);
        }
      });

      setNewEntriesToImport(newItems);
      setClashingEntries(clashes);
      setImportModalOpen(true);
    } catch (err: any) {
      console.error('Error parsing file:', err);
      setImportError(err?.message || 'Failed to parse file. Please upload a valid CSV or Excel file.');
      alert(err?.message || 'Failed to parse spreadsheet file.');
    } finally {
      setImportingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Confirm Import & Save to Firestore
  const handleConfirmImport = async () => {
    setSavingImport(true);
    setImportError('');
    try {
      // 1. Process new items using Registration Number as document key
      for (const item of newEntriesToImport) {
        const cleanReg = (item.registrationNumber || '').trim().toUpperCase();
        const docId = cleanReg || (item.email || '').toLowerCase().trim() || `${Date.now()}-${Math.random()}`;
        await setDoc(
          doc(db, 'members', docId),
          {
            name: item.name,
            registrationNumber: item.registrationNumber,
            email: item.email,
            phone: item.phone,
            team: item.team,
            position: item.position,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }

      // 2. Process clashes based on decision
      for (const clash of clashingEntries) {
        if (clash.decision === 'keep') continue;

        const targetData = clash.decision === 'manual' && clash.manualEdits ? clash.manualEdits : clash.incoming;
        const cleanReg = (targetData.registrationNumber || clash.existing.registrationNumber || '').trim().toUpperCase();
        const docId = clash.existing.id || cleanReg || (targetData.email || clash.existing.email || '').toLowerCase().trim();

        await setDoc(
          doc(db, 'members', docId),
          {
            name: targetData.name || clash.existing.name,
            registrationNumber: targetData.registrationNumber || clash.existing.registrationNumber,
            email: targetData.email || clash.existing.email,
            phone: targetData.phone || clash.existing.phone || '',
            team: targetData.team || clash.existing.team,
            position: targetData.position || clash.existing.position,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }

      setImportModalOpen(false);
      await loadAllMembers();
    } catch (err: any) {
      console.error('Error saving imported members:', err);
      setImportError(err?.message || 'Failed to save members to Firestore.');
    } finally {
      setSavingImport(false);
    }
  };

  // ─── Manual Add / Edit Member ──────────────────────────────────────────────
  const openMemberModal = (member?: RosterMember) => {
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
  const handleDeleteMember = async () => {
    if (!deleteConfirmMember) return;
    setDeletingMember(true);
    try {
      const targetDocId = (deleteConfirmMember.id || deleteConfirmMember.registrationNumber || deleteConfirmMember.email).trim();
      const cleanEmail = (deleteConfirmMember.email || '').toLowerCase().trim();
      
      await deleteDoc(doc(db, 'members', targetDocId));
      if (cleanEmail && cleanEmail !== targetDocId) {
        try { await deleteDoc(doc(db, 'members', cleanEmail)); } catch {}
      }

      setMembers((prev) => prev.filter((m) => m.id !== targetDocId && m.email.toLowerCase() !== cleanEmail));
      setDeleteConfirmMember(null);
      await loadAllMembers();
    } catch (err) {
      console.error('Error deleting member:', err);
    } finally {
      setDeletingMember(false);
    }
  };

  return (
    <div className="flex-grow min-h-screen bg-transparent p-3 sm:p-6 md:p-8 pb-36 sm:pb-16 text-left text-white select-none">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        
        {/* Hidden File Input for CSV/Excel */}
        <input
          type="file"
          ref={fileInputRef}
          accept=".csv, .xlsx, .xls"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* Page Header */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[#262626]">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-md text-[10px] font-black bg-purple-900/60 text-purple-300 border border-purple-600 flex items-center gap-1.5 shadow-[0_0_12px_rgba(147,51,234,0.2)]">
                <span className="material-symbols-outlined text-[13px]">groups</span>
                VRGC CHAPTER ROSTER
              </span>
              <span className="text-[11px] text-slate-400 font-mono">STUDENT LEADERSHIP &amp; CREW DIRECTORY</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">
              Club Members &amp; Team Breakdown
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
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
                  onClick={() => fileInputRef.current?.click()}
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
                  className={`p-3 sm:p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between ${
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

          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>
              Showing <strong className="text-white">{filteredMembers.length}</strong> of{' '}
              <strong className="text-purple-300">{members.length}</strong> total crew members
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
              }}
              className="px-4 py-2 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold transition-all mt-2 cursor-pointer"
            >
              Clear All Filters
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredMembers.map((m) => {
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
                      <img
                        src={m.avatarUrl}
                        alt={m.name}
                        className="w-12 h-12 rounded-xl object-cover border border-purple-500 bg-purple-950 shrink-0"
                      />
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

                    {/* Admin Actions (Edit & Delete) */}
                    {canManage ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openMemberModal(m)}
                          className="px-2 py-1 bg-[#222222] hover:bg-purple-700 text-white rounded text-[10px] font-bold transition-colors cursor-pointer"
                          title="Edit Member Details"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirmMember(m)}
                          className="px-2 py-1 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/40 rounded text-[10px] font-bold transition-colors cursor-pointer"
                          title="Delete Member"
                        >
                          Delete
                        </button>
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
          <div className="bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[720px] text-left text-xs text-slate-300">
                <thead className="bg-[#181818] text-purple-300 font-bold border-b border-[#262626]">
                  <tr>
                    <th className="py-3.5 px-4">Member Name</th>
                    <th className="py-3.5 px-4">Registration No.</th>
                    <th className="py-3.5 px-4">Domain / Team</th>
                    <th className="py-3.5 px-4">Role / Position</th>
                    <th className="py-3.5 px-4">Official Email</th>
                    <th className="py-3.5 px-4">Contact</th>
                    {canManage && <th className="py-3.5 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {filteredMembers.map((m) => (
                    <tr key={m.id || m.email} className="hover:bg-[#1c1c1c] transition-colors">
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
                      {canManage && (
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => openMemberModal(m)}
                            className="px-2.5 py-1 bg-[#222222] hover:bg-purple-700 text-white rounded text-[11px] font-bold transition-colors cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteConfirmMember(m)}
                            className="px-2.5 py-1 bg-rose-950/50 hover:bg-rose-900 text-rose-300 rounded text-[11px] font-bold border border-rose-800/40 transition-colors cursor-pointer"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ─── MODAL 1: CSV/XLSX Import & Clash Resolution ──────────────────────── */}
      {importModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-6 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-4xl max-h-[88vh] flex flex-col bg-[#121212] border border-purple-600 rounded-2xl shadow-[0_0_50px_rgba(147,51,234,0.3)] overflow-hidden text-left mx-1 sm:mx-0">
            {/* Modal Header */}
            <div className="p-5 bg-[#181818] border-b border-[#262626] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-purple-400 text-2xl">table_chart</span>
                <div>
                  <h3 className="text-base font-black text-white">Spreadsheet Import Preview &amp; Clash Resolution</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Total Parsed: <span className="text-white font-bold">{newEntriesToImport.length + clashingEntries.length}</span> | 
                    Ready to Add: <span className="text-emerald-400 font-bold">{newEntriesToImport.length}</span> | 
                    Clashes Detected: <span className="text-amber-400 font-bold">{clashingEntries.length}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setImportModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0e0e0e]">
              {importError && (
                <div className="p-3 bg-rose-950/60 border border-rose-600 rounded-xl text-rose-300 text-xs font-medium">
                  {importError}
                </div>
              )}

              {/* Clashing Entries Section */}
              {clashingEntries.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base">warning</span>
                      Clashing Member Data ({clashingEntries.length})
                    </h4>

                    {/* Bulk Action Buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setClashingEntries((prev) =>
                            prev.map((c) => ({ ...c, decision: 'update' }))
                          )
                        }
                        className="px-2.5 py-1 rounded bg-purple-900/60 hover:bg-purple-800 text-purple-200 text-[10px] font-bold border border-purple-600 cursor-pointer"
                      >
                        Update All Clashes
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setClashingEntries((prev) =>
                            prev.map((c) => ({ ...c, decision: 'keep' }))
                          )
                        }
                        className="px-2.5 py-1 rounded bg-[#222222] hover:bg-[#333333] text-slate-300 text-[10px] font-bold border border-[#444444] cursor-pointer"
                      >
                        Skip All Clashes
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400">
                    The following members already exist in the database with differing values. Choose whether to update them with the imported values or keep the current database values.
                  </p>

                  <div className="space-y-3">
                    {clashingEntries.map((clash, idx) => (
                      <div
                        key={clash.id}
                        className="p-4 bg-[#141414] border border-[#2a2a2a] rounded-xl space-y-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <span className="font-bold text-sm text-white flex items-center gap-2">
                            <span>#{idx + 1}</span>
                            <span>{clash.incoming.name || clash.existing.name}</span>
                            <span className="font-mono text-xs text-purple-300">
                              ({clash.incoming.email || clash.existing.email})
                            </span>
                          </span>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setClashingEntries((prev) =>
                                  prev.map((c) =>
                                    c.id === clash.id ? { ...c, decision: 'update' } : c
                                  )
                                );
                              }}
                              className={`px-3 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                                clash.decision === 'update'
                                  ? 'bg-purple-600 text-white'
                                  : 'bg-[#222222] text-slate-400 hover:text-white'
                              }`}
                            >
                              Update with File
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setClashingEntries((prev) =>
                                  prev.map((c) =>
                                    c.id === clash.id ? { ...c, decision: 'keep' } : c
                                  )
                                );
                              }}
                              className={`px-3 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                                clash.decision === 'keep'
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-[#222222] text-slate-400 hover:text-white'
                              }`}
                            >
                              Keep Existing (Skip)
                            </button>
                            <button
                              type="button"
                              onClick={() => setClashEditTarget(clash)}
                              className={`px-3 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                                clash.decision === 'manual'
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-[#222222] text-slate-400 hover:text-white'
                              }`}
                            >
                              Edit Manually
                            </button>
                          </div>
                        </div>

                        {/* Comparison Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          {/* Current Values */}
                          <div className="p-3 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                              Current in Database
                            </span>
                            <div><strong className="text-slate-400">Name:</strong> {clash.existing.name}</div>
                            <div><strong className="text-slate-400">Reg No:</strong> {clash.existing.registrationNumber || '—'}</div>
                            <div><strong className="text-slate-400">Team:</strong> {clash.existing.team}</div>
                            <div><strong className="text-slate-400">Role:</strong> {clash.existing.position}</div>
                            <div><strong className="text-slate-400">Phone:</strong> {clash.existing.phone || '—'}</div>
                          </div>

                          {/* Incoming Values */}
                          <div className="p-3 bg-[#1e132e] border border-purple-600/50 rounded-lg space-y-1">
                            <span className="text-[10px] font-bold text-purple-300 uppercase block mb-1">
                              Incoming from File {clash.decision === 'manual' && '(Manually Adjusted)'}
                            </span>
                            <div><strong className="text-purple-300">Name:</strong> {clash.decision === 'manual' && clash.manualEdits ? clash.manualEdits.name : clash.incoming.name}</div>
                            <div><strong className="text-purple-300">Reg No:</strong> {clash.decision === 'manual' && clash.manualEdits ? clash.manualEdits.registrationNumber : clash.incoming.registrationNumber || '—'}</div>
                            <div><strong className="text-purple-300">Team:</strong> {clash.decision === 'manual' && clash.manualEdits ? clash.manualEdits.team : clash.incoming.team}</div>
                            <div><strong className="text-purple-300">Role:</strong> {clash.decision === 'manual' && clash.manualEdits ? clash.manualEdits.position : clash.incoming.position}</div>
                            <div><strong className="text-purple-300">Phone:</strong> {clash.decision === 'manual' && clash.manualEdits ? clash.manualEdits.phone : clash.incoming.phone || '—'}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ready to Add New Members Section */}
              <div className="space-y-3">
                <h4 className="text-xs font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  New Members Ready to Add ({newEntriesToImport.length})
                </h4>

                {newEntriesToImport.length === 0 ? (
                  <p className="text-xs text-slate-500">No completely new member records.</p>
                ) : (
                  <div className="border border-[#262626] rounded-xl overflow-hidden bg-[#141414] max-h-60 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#1c1c1c] text-slate-400 font-bold text-[10px] uppercase">
                        <tr>
                          <th className="p-2.5">Name</th>
                          <th className="p-2.5">Reg No.</th>
                          <th className="p-2.5">Email</th>
                          <th className="p-2.5">Team</th>
                          <th className="p-2.5">Role</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#222222]">
                        {newEntriesToImport.slice(0, 50).map((row, i) => (
                          <tr key={i} className="hover:bg-[#1a1a1a]">
                            <td className="p-2.5 font-bold text-white">{row.name}</td>
                            <td className="p-2.5 font-mono text-purple-300">{row.registrationNumber || '—'}</td>
                            <td className="p-2.5 font-mono text-slate-400">{row.email}</td>
                            <td className="p-2.5">{row.team}</td>
                            <td className="p-2.5">{row.position}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-[#181818] border-t border-[#262626] flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="px-4 py-2 bg-[#262626] hover:bg-[#333333] text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={savingImport || (newEntriesToImport.length === 0 && clashingEntries.length === 0)}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 shadow-[0_0_15px_rgba(147,51,234,0.3)]"
              >
                {savingImport && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Confirm &amp; Commit to Firebase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: Manual Edit Inside Clash ────────────────────────────────── */}
      {clashEditTarget && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/95">
          <div className="w-full max-w-md bg-[#161616] border border-purple-600 rounded-2xl p-6 space-y-4 text-left shadow-[0_0_40px_rgba(147,51,234,0.3)]">
            <h4 className="text-sm font-black text-white uppercase tracking-wider">
              Manually Edit Clashing Record
            </h4>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">NAME</label>
                <input
                  type="text"
                  value={clashEditTarget.manualEdits?.name ?? clashEditTarget.incoming.name}
                  onChange={(e) =>
                    setClashEditTarget({
                      ...clashEditTarget,
                      manualEdits: {
                        ...(clashEditTarget.manualEdits || clashEditTarget.incoming),
                        name: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 bg-[#222222] border border-[#333333] rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">REGISTRATION NUMBER</label>
                <input
                  type="text"
                  value={clashEditTarget.manualEdits?.registrationNumber ?? clashEditTarget.incoming.registrationNumber}
                  onChange={(e) =>
                    setClashEditTarget({
                      ...clashEditTarget,
                      manualEdits: {
                        ...(clashEditTarget.manualEdits || clashEditTarget.incoming),
                        registrationNumber: e.target.value.toUpperCase(),
                      },
                    })
                  }
                  className="w-full px-3 py-2 bg-[#222222] border border-[#333333] rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">TEAM / DOMAIN</label>
                <input
                  type="text"
                  value={clashEditTarget.manualEdits?.team ?? clashEditTarget.incoming.team}
                  onChange={(e) =>
                    setClashEditTarget({
                      ...clashEditTarget,
                      manualEdits: {
                        ...(clashEditTarget.manualEdits || clashEditTarget.incoming),
                        team: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 bg-[#222222] border border-[#333333] rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">ROLE / POSITION</label>
                <input
                  type="text"
                  value={clashEditTarget.manualEdits?.position ?? clashEditTarget.incoming.position}
                  onChange={(e) =>
                    setClashEditTarget({
                      ...clashEditTarget,
                      manualEdits: {
                        ...(clashEditTarget.manualEdits || clashEditTarget.incoming),
                        position: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 bg-[#222222] border border-[#333333] rounded-lg text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#262626]">
              <button
                type="button"
                onClick={() => setClashEditTarget(null)}
                className="px-3 py-1.5 bg-[#262626] text-slate-300 rounded text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setClashingEntries((prev) =>
                    prev.map((c) =>
                      c.id === clashEditTarget.id
                        ? {
                            ...c,
                            decision: 'manual',
                            manualEdits: clashEditTarget.manualEdits || clashEditTarget.incoming,
                          }
                        : c
                    )
                  );
                  setClashEditTarget(null);
                }}
                className="px-4 py-1.5 bg-emerald-600 text-white font-bold rounded text-xs"
              >
                Apply Adjustments
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 3: Manual Add / Edit Member ────────────────────────────────── */}
      {memberModalOpen && (
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
                    placeholder="e.g. 24BCG10051"
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
        </div>
      )}

      {/* ─── MODAL 4: Delete Member Confirmation ──────────────────────────────── */}
      {deleteConfirmMember && (
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
        </div>
      )}

      {/* ─── MODAL 5: Quick Add Domain or Role (Delegated Metadata) ─────────────── */}
      {quickAddModalType && (
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
        </div>
      )}
    </div>
  );
};

export default MembersRoster;
