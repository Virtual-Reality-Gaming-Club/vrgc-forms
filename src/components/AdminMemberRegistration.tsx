"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { supabase } from '@/lib/supabase';
import { CONFIG } from '@/lib/config';
import {
  collection,
  getDocs,
  getDoc,
  setDoc,
  doc,
  deleteDoc,
  addDoc,
  onSnapshot,
  orderBy,
  limit,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';

interface AdminMemberPortalProps {
  onRedirect?: () => void;
  currentUserEmail?: string;
}

interface MemberRecord {
  id: string;
  name: string;
  registrationNumber: string;
  email: string;
  team: string;
  position: string;
  photoUrl?: string;
  avatarUrl?: string;
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

const DEFAULT_TEAMS = [
  'Leadership',
  'Design',
  'Education',
  'Esports (Mobile)',
  'Esports (PC)',
  'PR',
  'Social Media',
  'Technical',
];

const DEFAULT_POSITIONS = [
  'Lead',
  'Co-Lead',
  'Core Member',
];

const FORBIDDEN_POSITIONS = [
  'student coordinator',
  'vice president',
  'co-president',
  'president',
  'member',
];

// STRICT Member-only action types for audit logging
const MEMBER_ACTION_TYPES = [
  'ADD_MEMBER',
  'UPDATE_MEMBER',
  'MAKE_ADMIN',
  'REMOVE_ADMIN',
  'DELETE_MEMBER_DOSSIER',
];

// Helper to clean, split comma-separated strings, deduplicate, normalize Esports, and remove forbidden options
const cleanCategories = (rawItems: string[], forbidden: string[] = []): string[] => {
  const set = new Set<string>();
  const forbiddenLower = forbidden.map((f) => f.toLowerCase().trim());

  rawItems.forEach((item) => {
    if (!item || typeof item !== 'string') return;

    const parts = item.split(',');
    parts.forEach((p) => {
      let trimmed = p.trim();
      if (!trimmed) return;
      if (forbiddenLower.includes(trimmed.toLowerCase())) return;

      const lower = trimmed.toLowerCase();
      if (lower.includes('esports') && (lower.includes('mobile') || lower.includes('(mobile)'))) {
        trimmed = 'Esports (Mobile)';
      } else if (lower.includes('esports') && (lower.includes('pc') || lower.includes('(pc)'))) {
        trimmed = 'Esports (PC)';
      }

      set.add(trimmed);
    });
  });

  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

// Helper to retrieve and preserve existing photo/avatar Supabase links during updates
const getMemberExistingMedia = async (oldEmail: string, oldRegNo: string, selectedMember: MemberRecord | null) => {
  let photoUrl = selectedMember?.photoUrl || '';
  let avatarUrl = selectedMember?.avatarUrl || '';

  // Look up in 'id_cards' if missing from selectedMember
  if ((!photoUrl || !avatarUrl) && oldEmail) {
    try {
      const idSnap = await getDoc(doc(db, 'id_cards', oldEmail));
      if (idSnap.exists()) {
        const idData = idSnap.data();
        if (!photoUrl) photoUrl = idData.photoUrl || idData.photo || idData.imageUrl || idData.publicUrl || '';
        if (!avatarUrl) avatarUrl = idData.avatarUrl || idData.avatar || '';
      }
    } catch (_) {}
  }

  // Look up in 'members' if missing
  if ((!photoUrl || !avatarUrl) && oldEmail) {
    try {
      const memSnap = await getDoc(doc(db, 'members', oldEmail));
      if (memSnap.exists()) {
        const memData = memSnap.data();
        if (!photoUrl) photoUrl = memData.photoUrl || memData.photo || memData.imageUrl || memData.publicUrl || '';
        if (!avatarUrl) avatarUrl = memData.avatarUrl || memData.avatar || '';
      }
    } catch (_) {}
  }

  // Look up by registration number in 'id_cards' if missing
  if ((!photoUrl || !avatarUrl) && oldRegNo) {
    try {
      const idRegQ = query(collection(db, 'id_cards'), where('registrationNumber', '==', oldRegNo));
      const idRegSnap = await getDocs(idRegQ);
      if (!idRegSnap.empty) {
        const idData = idRegSnap.docs[0].data();
        if (!photoUrl) photoUrl = idData.photoUrl || idData.photo || idData.imageUrl || idData.publicUrl || '';
        if (!avatarUrl) avatarUrl = idData.avatarUrl || idData.avatar || '';
      }
    } catch (_) {}
  }

  return { photoUrl, avatarUrl };
};

// Helper to permanently delete files (images, avatars, gifs) from Supabase Storage to free up disk space
const deleteSupabaseMediaFile = async (mediaUrl?: string) => {
  if (!mediaUrl || typeof mediaUrl !== 'string') return;

  try {
    const urlObj = new URL(mediaUrl);
    const pathname = decodeURIComponent(urlObj.pathname);
    const parts = pathname.split('/').filter(Boolean);

    const publicIndex = parts.indexOf('public');
    if (publicIndex !== -1 && publicIndex < parts.length - 2) {
      const bucket = parts[publicIndex + 1];
      const filePath = parts.slice(publicIndex + 2).join('/');

      if (bucket && filePath) {
        const { error } = await supabase.storage.from(bucket).remove([filePath]);
        if (error) {
          console.warn(`Supabase storage delete error for bucket "${bucket}", path "${filePath}":`, error);
        } else {
          console.log(`Deleted Supabase file: ${bucket}/${filePath}`);
        }
      }
    } else {
      if (pathname.includes('/id-cards/')) {
        const filePath = pathname.substring(pathname.indexOf('/id-cards/') + '/id-cards/'.length);
        if (filePath) await supabase.storage.from('id-cards').remove([filePath]);
      }
      if (pathname.includes('/avatar/')) {
        const filePath = pathname.substring(pathname.indexOf('/avatar/') + '/avatar/'.length);
        if (filePath) await supabase.storage.from('avatar').remove([filePath]);
      }
    }
  } catch (err) {
    console.warn('Error parsing or deleting Supabase storage file:', err);
  }
};

const AdminMemberRegistration: React.FC<AdminMemberPortalProps> = ({ onRedirect, currentUserEmail }) => {
  const [activeTab, setActiveTab] = useState<'add' | 'update' | 'remove' | 'logs'>('add');

  // Shared loaded categories
  const [teamCategories, setTeamCategories] = useState<string[]>(DEFAULT_TEAMS);
  const [positionCategories, setPositionCategories] = useState<string[]>(DEFAULT_POSITIONS);

  // All loaded members from Firestore for lookup & autocomplete
  const [allMembers, setAllMembers] = useState<MemberRecord[]>([]);

  // Activity Logs state
  const [logs, setLogs] = useState<AdminActivityLog[]>([]);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logActionFilter, setLogActionFilter] = useState('All');

  // Messages & Loading states
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ADD MEMBER STATE
  const [addName, setAddName] = useState('');
  const [addRegNo, setAddRegNo] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addTeam, setAddTeam] = useState('');
  const [addPosition, setAddPosition] = useState(DEFAULT_POSITIONS[0]);
  const [addCustomTeam, setAddCustomTeam] = useState('');
  const [showAddCustomTeam, setShowAddCustomTeam] = useState(false);
  const [addCustomPosition, setAddCustomPosition] = useState('');
  const [showAddCustomPosition, setShowAddCustomPosition] = useState(false);

  // UPDATE MEMBER STATE
  const [updateSearchQuery, setUpdateSearchQuery] = useState('');
  const [selectedMemberToUpdate, setSelectedMemberToUpdate] = useState<MemberRecord | null>(null);
  const [updateName, setUpdateName] = useState('');
  const [updateRegNo, setUpdateRegNo] = useState('');
  const [updateEmail, setUpdateEmail] = useState('');
  const [updateTeam, setUpdateTeam] = useState('');
  const [updatePosition, setUpdatePosition] = useState(DEFAULT_POSITIONS[0]);
  const [updateCustomTeam, setUpdateCustomTeam] = useState('');
  const [showUpdateCustomTeam, setShowUpdateCustomTeam] = useState(false);
  const [updateCustomPosition, setUpdateCustomPosition] = useState('');
  const [showUpdateCustomPosition, setShowUpdateCustomPosition] = useState(false);

  // REMOVE MEMBER STATE
  const [removeRegNoInput, setRemoveRegNoInput] = useState('');
  const [removeDossier, setRemoveDossier] = useState<MemberRecord | null>(null);
  const [isSearchingRemove, setIsSearchingRemove] = useState(false);

  // Real-time listener for admin activity logs
  useEffect(() => {
    try {
      const logsQ = query(collection(db, 'admin_logs'), orderBy('timestamp', 'desc'), limit(100));
      const unsub = onSnapshot(logsQ, (snapshot) => {
        const list: AdminActivityLog[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as AdminActivityLog);
        });
        setLogs(list);
      });
      return () => unsub();
    } catch (err) {
      console.warn('admin_logs listener error:', err);
    }
  }, []);

  // Logger helper - writes log entry to 'admin_logs'
  const logAdminAction = useCallback(
    async (
      action: string,
      targetEmail?: string,
      targetName?: string,
      targetRegNo?: string,
      details?: string
    ) => {
      try {
        const logEntry: AdminActivityLog = {
          action,
          performedBy: currentUserEmail || 'Admin',
          adminEmail: currentUserEmail || 'Admin',
          targetEmail: targetEmail || '',
          targetName: targetName || '',
          targetRegNo: targetRegNo || '',
          details: details || '',
          timestamp: new Date().toISOString(),
        };
        await addDoc(collection(db, 'admin_logs'), logEntry);
      } catch (err) {
        console.warn('Failed to write admin activity log:', err);
      }
    },
    [currentUserEmail]
  );

  const handleDeleteLog = async (logId?: string) => {
    if (!logId) return;
    try {
      await deleteDoc(doc(db, 'admin_logs', logId));
      setLogs((prev) => prev.filter((l) => l.id !== logId));
    } catch (err) {
      console.error('Error deleting activity log:', err);
    }
  };

  // Helper function to remove old / duplicate member documents when updating details
  const cleanupOldMemberDuplicates = async (
    oldEmail: string,
    oldRegNo: string,
    oldDocId: string,
    finalEmail: string,
    finalRegNo: string
  ) => {
    try {
      const toDeleteDocIds = new Set<string>();

      if (oldEmail && oldEmail !== finalEmail) {
        toDeleteDocIds.add(oldEmail);
      }
      if (oldDocId && oldDocId !== finalEmail) {
        toDeleteDocIds.add(oldDocId);
      }

      // 1. Delete known old document IDs from 'members'
      for (const dId of Array.from(toDeleteDocIds)) {
        try {
          await deleteDoc(doc(db, 'members', dId));
        } catch (e) {
          console.warn(`Failed to delete old member doc ${dId}:`, e);
        }
      }

      // 2. Delete any member document matching oldRegNo if oldRegNo changed
      if (oldRegNo && oldRegNo !== finalRegNo) {
        try {
          const memQ = query(collection(db, 'members'), where('registrationNumber', '==', oldRegNo));
          const memSnap = await getDocs(memQ);
          memSnap.forEach(async (dSnap) => {
            if (dSnap.id !== finalEmail) {
              await deleteDoc(doc(db, 'members', dSnap.id));
            }
          });
        } catch (_) {}
      }

      // 3. Delete any member document matching finalRegNo whose document ID is different from finalEmail
      try {
        const dupRegQ = query(collection(db, 'members'), where('registrationNumber', '==', finalRegNo));
        const dupRegSnap = await getDocs(dupRegQ);
        dupRegSnap.forEach(async (dSnap) => {
          if (dSnap.id !== finalEmail) {
            await deleteDoc(doc(db, 'members', dSnap.id));
          }
        });
      } catch (_) {}

      // 4. Delete old document from 'id_cards' if email changed
      if (oldEmail && oldEmail !== finalEmail) {
        try {
          await deleteDoc(doc(db, 'id_cards', oldEmail));
        } catch (_) {}
        if (oldDocId && oldDocId !== finalEmail) {
          try {
            await deleteDoc(doc(db, 'id_cards', oldDocId));
          } catch (_) {}
        }
      }

      // 5. Delete old document from 'admins' if email changed
      if (oldEmail && oldEmail !== finalEmail) {
        try {
          await deleteDoc(doc(db, 'admins', oldEmail));
        } catch (_) {}
        if (oldDocId && oldDocId !== finalEmail) {
          try {
            await deleteDoc(doc(db, 'admins', oldDocId));
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('Error during old member deduplication cleanup:', err);
    }
  };

  // Load Categories & Members from Database
  const loadDatabaseData = useCallback(async () => {
    try {
      const rawTeams: string[] = [...DEFAULT_TEAMS];
      const rawPositions: string[] = [...DEFAULT_POSITIONS];
      const fetchedMembersMap = new Map<string, MemberRecord>();

      // 1. Fetch from 'members' collection
      try {
        const membersSnap = await getDocs(collection(db, 'members'));
        membersSnap.forEach((dSnap) => {
          const data = dSnap.data();
          const em = (data.email || dSnap.id || '').toLowerCase().trim();
          const reg = (data.registrationNumber || data.regNo || '').toUpperCase().trim();
          const name = data.name || 'Member';
          const t = data.team || '';
          const p = data.position || '';

          if (t) rawTeams.push(t);
          if (p) rawPositions.push(p);

          if (em && em.includes('@')) {
            fetchedMembersMap.set(em, {
              id: dSnap.id,
              name,
              registrationNumber: reg,
              email: em,
              team: t || 'Technical',
              position: p || DEFAULT_POSITIONS[0],
              photoUrl: data.photoUrl || data.photo || data.imageUrl,
              avatarUrl: data.avatarUrl || data.avatar,
            });
          }
        });
      } catch (e) {
        console.warn('Members fetch error:', e);
      }

      // 2. Fetch from 'id_cards' collection and merge profile photo/avatar if present
      try {
        const idCardsSnap = await getDocs(collection(db, 'id_cards'));
        idCardsSnap.forEach((dSnap) => {
          const data = dSnap.data();
          const em = (data.email || dSnap.id || '').toLowerCase().trim();
          const reg = (data.registrationNumber || data.regNo || '').toUpperCase().trim();
          const name = data.fullName || data.name || 'Member';
          const t = data.team || '';
          const p = data.position || '';
          const photoUrl = data.photoUrl || data.photo || data.imageUrl || data.publicUrl || '';
          const avatarUrl = data.avatarUrl || data.avatar || '';

          if (t) rawTeams.push(t);
          if (p) rawPositions.push(p);

          if (em && em.includes('@')) {
            const existing = fetchedMembersMap.get(em);
            if (existing) {
              if (photoUrl) existing.photoUrl = photoUrl;
              if (avatarUrl) existing.avatarUrl = avatarUrl;
              if (!existing.name || existing.name === 'Member') existing.name = name;
              if (!existing.registrationNumber) existing.registrationNumber = reg;
            } else {
              fetchedMembersMap.set(em, {
                id: dSnap.id,
                name,
                registrationNumber: reg,
                email: em,
                team: t || 'Technical',
                position: p || DEFAULT_POSITIONS[0],
                photoUrl,
                avatarUrl,
              });
            }
          }
        });
      } catch (e) {
        console.warn('id_cards fetch error:', e);
      }

      // Clean & Deduplicate Teams
      const cleanedTeams = cleanCategories(rawTeams);
      setTeamCategories(cleanedTeams);
      setPositionCategories(DEFAULT_POSITIONS);

      if (cleanedTeams.length > 0 && !addTeam) setAddTeam(cleanedTeams[0]);

      setAllMembers(Array.from(fetchedMembersMap.values()));
    } catch (err) {
      console.error('Error loading database data:', err);
    }
  }, [addTeam]);

  useEffect(() => {
    loadDatabaseData();
  }, [loadDatabaseData]);

  // Clear alerts on tab change
  const handleTabSwitch = (tab: 'add' | 'update' | 'remove' | 'logs') => {
    setActiveTab(tab);
    setErrorMessage('');
    setSuccessMessage('');
  };

  // SUBMIT ADD MEMBER
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    const finalName = addName.trim();
    const finalRegNo = addRegNo.trim().toUpperCase();
    const finalEmail = addEmail.trim().toLowerCase();
    const finalTeam = showAddCustomTeam || addTeam === 'Other' ? addCustomTeam.trim() : addTeam.trim();
    const finalPosition = showAddCustomPosition || addPosition === 'Other' ? addCustomPosition.trim() : addPosition.trim();

    if (!finalName) return setErrorMessage('Please enter Member Name.');
    if (!finalRegNo) return setErrorMessage('Please enter Registration Number.');
    if (!finalTeam) return setErrorMessage('Please select or specify Team.');
    if (!finalPosition) return setErrorMessage('Please select or specify Position.');
    if (!finalEmail || !finalEmail.includes('@')) return setErrorMessage('Please enter a valid Official Email.');

    setIsSubmitting(true);

    try {
      // Deduplicate: remove any existing document with same regNo under a different ID
      try {
        const dupRegQ = query(collection(db, 'members'), where('registrationNumber', '==', finalRegNo));
        const dupRegSnap = await getDocs(dupRegQ);
        dupRegSnap.forEach(async (dSnap) => {
          if (dSnap.id !== finalEmail) {
            await deleteDoc(doc(db, 'members', dSnap.id));
          }
        });
      } catch (_) {}

      const docId = finalEmail;
      const memberData = {
        name: finalName,
        registrationNumber: finalRegNo,
        regNo: finalRegNo,
        position: finalPosition,
        team: finalTeam,
        email: finalEmail,
        createdAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'members', docId), memberData, { merge: true });

      // Log admin activity (Member Changes Only)
      await logAdminAction(
        'ADD_MEMBER',
        finalEmail,
        finalName,
        finalRegNo,
        `Added new member (Team: ${finalTeam}, Position: ${finalPosition})`
      );

      setSuccessMessage(`Member "${finalName}" added successfully to database!`);
      setAddName('');
      setAddRegNo('');
      setAddEmail('');
      setAddCustomTeam('');
      setShowAddCustomTeam(false);
      setAddCustomPosition('');
      setShowAddCustomPosition(false);

      if (teamCategories.length > 0) setAddTeam(teamCategories[0]);
      setAddPosition(DEFAULT_POSITIONS[0]);

      loadDatabaseData();
    } catch (err: any) {
      console.error('Error adding member:', err);
      setErrorMessage(err?.message || 'Failed to add member to database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // UPDATE MEMBER HANDLERS
  const handleSelectMemberToUpdate = (m: MemberRecord) => {
    setSelectedMemberToUpdate(m);
    setUpdateName(m.name);
    setUpdateRegNo(m.registrationNumber);
    setUpdateEmail(m.email);

    if (DEFAULT_POSITIONS.includes(m.position)) {
      setUpdatePosition(m.position);
      setShowUpdateCustomPosition(false);
    } else {
      setUpdatePosition('Other');
      setUpdateCustomPosition(m.position);
      setShowUpdateCustomPosition(true);
    }

    if (teamCategories.includes(m.team)) {
      setUpdateTeam(m.team);
      setShowUpdateCustomTeam(false);
    } else {
      setUpdateTeam('Other');
      setUpdateCustomTeam(m.team);
      setShowUpdateCustomTeam(true);
    }
  };

  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!selectedMemberToUpdate) return setErrorMessage('Please select a member to update.');

    const finalName = updateName.trim();
    const finalRegNo = updateRegNo.trim().toUpperCase();
    const finalEmail = updateEmail.trim().toLowerCase();
    const finalTeam = showUpdateCustomTeam || updateTeam === 'Other' ? updateCustomTeam.trim() : updateTeam.trim();
    const finalPosition = showUpdateCustomPosition || updatePosition === 'Other' ? updateCustomPosition.trim() : updatePosition.trim();

    if (!finalName || !finalRegNo || !finalTeam || !finalPosition || !finalEmail) {
      return setErrorMessage('Please fill in all required fields.');
    }

    setIsSubmitting(true);

    try {
      const oldEmail = (selectedMemberToUpdate.email || '').toLowerCase().trim();
      const oldRegNo = (selectedMemberToUpdate.registrationNumber || '').toUpperCase().trim();
      const oldDocId = selectedMemberToUpdate.id;

      // Preserve existing Supabase photo and avatar GIF URLs across member updates & email changes
      const { photoUrl, avatarUrl } = await getMemberExistingMedia(oldEmail, oldRegNo, selectedMemberToUpdate);

      // 1. Remove old member record/duplicates from database to prevent duplicate entries
      await cleanupOldMemberDuplicates(oldEmail, oldRegNo, oldDocId, finalEmail, finalRegNo);

      // 2. Set new/updated member in 'members' collection with transferred Supabase photo/avatar links
      const updatePayload: Record<string, any> = {
        name: finalName,
        registrationNumber: finalRegNo,
        regNo: finalRegNo,
        team: finalTeam,
        position: finalPosition,
        email: finalEmail,
        updatedAt: serverTimestamp(),
      };
      if (photoUrl) {
        updatePayload.photoUrl = photoUrl;
        updatePayload.photo = photoUrl;
      }
      if (avatarUrl) {
        updatePayload.avatarUrl = avatarUrl;
        updatePayload.avatar = avatarUrl;
      }

      await setDoc(doc(db, 'members', finalEmail), updatePayload, { merge: true });

      // 3. Update in 'id_cards' collection with transferred Supabase photo/avatar links
      try {
        const idCardRef = doc(db, 'id_cards', finalEmail);
        const idCardPayload: Record<string, any> = {
          name: finalName,
          fullName: finalName,
          registrationNumber: finalRegNo,
          regNo: finalRegNo,
          team: finalTeam,
          position: finalPosition,
          email: finalEmail,
          updatedAt: serverTimestamp(),
        };
        if (photoUrl) {
          idCardPayload.photoUrl = photoUrl;
          idCardPayload.photo = photoUrl;
        }
        if (avatarUrl) {
          idCardPayload.avatarUrl = avatarUrl;
          idCardPayload.avatar = avatarUrl;
        }
        await setDoc(idCardRef, idCardPayload, { merge: true });
      } catch (idErr) {
        console.warn('id_cards sync update warning:', idErr);
      }

      // 4. If this user is also an Admin, update their details in 'admins' collection too
      try {
        const oldAdminSnap = await getDoc(doc(db, 'admins', oldEmail));
        const newAdminSnap = await getDoc(doc(db, 'admins', finalEmail));
        if (oldAdminSnap.exists() || newAdminSnap.exists()) {
          const adminPayload: Record<string, any> = {
            name: finalName,
            email: finalEmail,
            registrationNumber: finalRegNo,
            regNo: finalRegNo,
            role: 'admin',
            updatedAt: serverTimestamp(),
          };
          if (photoUrl) adminPayload.photoUrl = photoUrl;
          if (avatarUrl) adminPayload.avatarUrl = avatarUrl;
          await setDoc(doc(db, 'admins', finalEmail), adminPayload, { merge: true });
        }
      } catch (adminErr) {
        console.warn('admins sync update warning:', adminErr);
      }

      // Log activity (Member Changes Only)
      await logAdminAction(
        'UPDATE_MEMBER',
        finalEmail,
        finalName,
        finalRegNo,
        `Updated member profile details across members, id_cards, and admins collections`
      );

      setSuccessMessage(`Member "${finalName}" details and Supabase profile image/avatar links successfully updated in database!`);
      setSelectedMemberToUpdate(null);
      loadDatabaseData();
    } catch (err: any) {
      console.error('Error updating member:', err);
      setErrorMessage(err?.message || 'Failed to update member in database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMakeAdminSubmit = async () => {
    setErrorMessage('');
    setSuccessMessage('');

    if (!selectedMemberToUpdate && !updateEmail) {
      return setErrorMessage('Please select a member or enter email to make admin.');
    }

    const finalName = updateName.trim();
    const finalRegNo = updateRegNo.trim().toUpperCase();
    const finalEmail = updateEmail.trim().toLowerCase();
    const finalTeam = showUpdateCustomTeam || updateTeam === 'Other' ? updateCustomTeam.trim() : updateTeam.trim();
    const finalPosition = showUpdateCustomPosition || updatePosition === 'Other' ? updateCustomPosition.trim() : updatePosition.trim();

    if (!finalName || !finalRegNo || !finalTeam || !finalPosition || !finalEmail) {
      return setErrorMessage('Please fill in all required fields before making admin.');
    }

    setIsSubmitting(true);

    try {
      const oldEmail = (selectedMemberToUpdate?.email || updateEmail).toLowerCase().trim();
      const oldRegNo = (selectedMemberToUpdate?.registrationNumber || updateRegNo).toUpperCase().trim();
      const oldDocId = selectedMemberToUpdate?.id || updateEmail;

      // Preserve existing Supabase photo and avatar GIF URLs
      const { photoUrl, avatarUrl } = await getMemberExistingMedia(oldEmail, oldRegNo, selectedMemberToUpdate);

      // Cleanup old/duplicate records
      await cleanupOldMemberDuplicates(oldEmail, oldRegNo, oldDocId, finalEmail, finalRegNo);

      // 1. Add/Update member in 'members' collection with photo/avatar links
      const memberPayload: Record<string, any> = {
        name: finalName,
        registrationNumber: finalRegNo,
        regNo: finalRegNo,
        team: finalTeam,
        position: finalPosition,
        email: finalEmail,
        updatedAt: serverTimestamp(),
      };
      if (photoUrl) {
        memberPayload.photoUrl = photoUrl;
        memberPayload.photo = photoUrl;
      }
      if (avatarUrl) {
        memberPayload.avatarUrl = avatarUrl;
        memberPayload.avatar = avatarUrl;
      }
      await setDoc(doc(db, 'members', finalEmail), memberPayload, { merge: true });

      // 2. Add to 'admins' collection with photo/avatar links
      const adminPayload: Record<string, any> = {
        name: finalName,
        email: finalEmail,
        registrationNumber: finalRegNo,
        regNo: finalRegNo,
        role: 'admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (photoUrl) adminPayload.photoUrl = photoUrl;
      if (avatarUrl) adminPayload.avatarUrl = avatarUrl;

      await setDoc(doc(db, 'admins', finalEmail), adminPayload, { merge: true });

      // 3. Sync to 'id_cards' if exists with photo/avatar links
      try {
        const idCardPayload: Record<string, any> = {
          name: finalName,
          fullName: finalName,
          registrationNumber: finalRegNo,
          regNo: finalRegNo,
          team: finalTeam,
          position: finalPosition,
          email: finalEmail,
          updatedAt: serverTimestamp(),
        };
        if (photoUrl) {
          idCardPayload.photoUrl = photoUrl;
          idCardPayload.photo = photoUrl;
        }
        if (avatarUrl) {
          idCardPayload.avatarUrl = avatarUrl;
          idCardPayload.avatar = avatarUrl;
        }
        await setDoc(doc(db, 'id_cards', finalEmail), idCardPayload, { merge: true });
      } catch (idErr) {
        console.warn('id_cards sync warning:', idErr);
      }

      // Log activity (Member Changes Only)
      await logAdminAction(
        'MAKE_ADMIN',
        finalEmail,
        finalName,
        finalRegNo,
        `Promoted member to Admin role and saved to members list (transferred photo/avatar links)`
      );

      setSuccessMessage(`Member "${finalName}" (${finalEmail}) is now an Admin and saved to the members list with profile media preserved!`);
      setSelectedMemberToUpdate(null);
      loadDatabaseData();
    } catch (err: any) {
      console.error('Error making member admin:', err);
      setErrorMessage(err?.message || 'Failed to assign admin role in database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveAdminSubmit = async () => {
    setErrorMessage('');
    setSuccessMessage('');

    if (!selectedMemberToUpdate && !updateEmail) {
      return setErrorMessage('Please select a member or enter email to remove as admin.');
    }

    const finalName = updateName.trim() || selectedMemberToUpdate?.name || 'Member';
    const finalRegNo = updateRegNo.trim().toUpperCase() || selectedMemberToUpdate?.registrationNumber || '';
    const finalEmail = updateEmail.trim().toLowerCase() || selectedMemberToUpdate?.email || '';

    if (!finalEmail) {
      return setErrorMessage('Please enter or select a valid member email.');
    }

    setIsSubmitting(true);

    try {
      // 1. Remove ONLY from 'admins' collection in Firestore
      try {
        const adminRef = doc(db, 'admins', finalEmail);
        await deleteDoc(adminRef);
      } catch (e) {
        console.warn('admins remove doc warning:', e);
      }

      try {
        if (finalRegNo) {
          const adminQ = query(collection(db, 'admins'), where('registrationNumber', '==', finalRegNo));
          const adminSnap = await getDocs(adminQ);
          adminSnap.forEach(async (dSnap) => {
            await deleteDoc(doc(db, 'admins', dSnap.id));
          });
        }
      } catch (_) {}

      // Note: Member STAYS registered in 'members' and 'id_cards'!

      // Log admin activity (Member Changes Only)
      await logAdminAction(
        'REMOVE_ADMIN',
        finalEmail,
        finalName,
        finalRegNo,
        `Revoked Admin role for member. Member remains active in members database.`
      );

      setSuccessMessage(`Admin role revoked for "${finalName}" (${finalEmail}). Member remains registered in members list.`);
      setSelectedMemberToUpdate(null);
      loadDatabaseData();
    } catch (err: any) {
      console.error('Error removing admin role:', err);
      setErrorMessage(err?.message || 'Failed to remove admin role in database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // REMOVE MEMBER HANDLERS
  const handleSearchRemoveDossier = async (regToSearch?: string) => {
    setErrorMessage('');
    setSuccessMessage('');
    const targetReg = (regToSearch || removeRegNoInput).trim().toUpperCase();

    if (!targetReg) {
      setRemoveDossier(null);
      return setErrorMessage('Please enter a Registration Number.');
    }

    setIsSearchingRemove(true);

    try {
      let foundRecord: MemberRecord | null = null;

      // Search in allLoadedMembers first
      const localMatch = allMembers.find(
        (m) =>
          m.registrationNumber.toUpperCase() === targetReg ||
          m.id.toUpperCase() === targetReg ||
          m.email.toUpperCase() === targetReg
      );

      if (localMatch) {
        foundRecord = { ...localMatch };
      } else {
        // Query Firestore 'members' by regNo / registrationNumber
        const membersQ = query(collection(db, 'members'), where('registrationNumber', '==', targetReg));
        const membersSnap = await getDocs(membersQ);

        if (!membersSnap.empty) {
          const d = membersSnap.docs[0].data();
          const em = (d.email || membersSnap.docs[0].id).toLowerCase();
          foundRecord = {
            id: membersSnap.docs[0].id,
            name: d.name || 'Member',
            registrationNumber: targetReg,
            email: em,
            team: d.team || 'Technical',
            position: d.position || DEFAULT_POSITIONS[0],
            photoUrl: d.photoUrl || d.photo || d.imageUrl,
            avatarUrl: d.avatarUrl || d.avatar,
          };
        } else {
          // Query Firestore 'id_cards'
          const idCardsQ = query(collection(db, 'id_cards'), where('registrationNumber', '==', targetReg));
          const idCardsSnap = await getDocs(idCardsQ);

          if (!idCardsSnap.empty) {
            const d = idCardsSnap.docs[0].data();
            foundRecord = {
              id: idCardsSnap.docs[0].id,
              name: d.fullName || d.name || 'Member',
              registrationNumber: targetReg,
              email: (d.email || idCardsSnap.docs[0].id).toLowerCase(),
              team: d.team || 'Technical',
              position: d.position || DEFAULT_POSITIONS[0],
              photoUrl: d.photoUrl || d.photo || d.imageUrl,
              avatarUrl: d.avatarUrl || d.avatar,
            };
          }
        }
      }

      // If record found, also fetch photo/avatar from id_cards collection by email if missing
      if (foundRecord && !foundRecord.photoUrl && !foundRecord.avatarUrl && foundRecord.email) {
        try {
          const idCardDocRef = doc(db, 'id_cards', foundRecord.email.toLowerCase().trim());
          const idCardDocSnap = await getDoc(idCardDocRef);
          if (idCardDocSnap.exists()) {
            const idData = idCardDocSnap.data();
            foundRecord.photoUrl = idData.photoUrl || idData.photo || idData.imageUrl || foundRecord.photoUrl;
            foundRecord.avatarUrl = idData.avatarUrl || idData.avatar || foundRecord.avatarUrl;
          }
        } catch (e) {
          console.warn('Direct id_cards doc photo lookup warning:', e);
        }
      }

      if (foundRecord) {
        setRemoveDossier(foundRecord);
      } else {
        setRemoveDossier(null);
        setErrorMessage(`No member record found for Registration Number: "${targetReg}".`);
      }
    } catch (err: any) {
      console.error('Error finding member dossier:', err);
      setErrorMessage(err?.message || 'Error looking up member registration.');
    } finally {
      setIsSearchingRemove(false);
    }
  };

  const handleDeleteMemberDossier = async () => {
    if (!removeDossier) return;
    const m = removeDossier;
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);

    try {
      const cleanEmail = m.email.toLowerCase().trim();

      // Gather ALL media URLs (profile photo & avatar GIF) across collections before Firestore document deletion
      const mediaUrlsToDelete = new Set<string>();

      if (m.photoUrl) mediaUrlsToDelete.add(m.photoUrl);
      if (m.avatarUrl) mediaUrlsToDelete.add(m.avatarUrl);

      // Check 'id_cards' for existing image/avatar URLs
      try {
        const idCardSnap = await getDoc(doc(db, 'id_cards', cleanEmail));
        if (idCardSnap.exists()) {
          const d = idCardSnap.data();
          if (d.photoUrl) mediaUrlsToDelete.add(d.photoUrl);
          if (d.photo) mediaUrlsToDelete.add(d.photo);
          if (d.imageUrl) mediaUrlsToDelete.add(d.imageUrl);
          if (d.publicUrl) mediaUrlsToDelete.add(d.publicUrl);
          if (d.avatarUrl) mediaUrlsToDelete.add(d.avatarUrl);
          if (d.avatar) mediaUrlsToDelete.add(d.avatar);
        }
      } catch (_) {}

      // Check 'members' for existing image/avatar URLs
      try {
        const memSnap = await getDoc(doc(db, 'members', cleanEmail));
        if (memSnap.exists()) {
          const d = memSnap.data();
          if (d.photoUrl) mediaUrlsToDelete.add(d.photoUrl);
          if (d.photo) mediaUrlsToDelete.add(d.photo);
          if (d.imageUrl) mediaUrlsToDelete.add(d.imageUrl);
          if (d.publicUrl) mediaUrlsToDelete.add(d.publicUrl);
          if (d.avatarUrl) mediaUrlsToDelete.add(d.avatarUrl);
          if (d.avatar) mediaUrlsToDelete.add(d.avatar);
        }
      } catch (_) {}

      // 1. Purge all photo & avatar files permanently from Supabase Storage to reclaim disk space
      for (const mediaUrl of Array.from(mediaUrlsToDelete)) {
        await deleteSupabaseMediaFile(mediaUrl);
      }

      // 2. Delete from Firestore 'members' collection
      try {
        const memberRef = doc(db, 'members', cleanEmail);
        await deleteDoc(memberRef);
      } catch (e) {
        console.warn('Members delete doc warning:', e);
      }

      try {
        const memQ = query(collection(db, 'members'), where('registrationNumber', '==', m.registrationNumber));
        const memSnap = await getDocs(memQ);
        memSnap.forEach(async (d) => {
          await deleteDoc(doc(db, 'members', d.id));
        });
      } catch (_) {}

      // 3. Delete from Firestore 'id_cards' collection
      try {
        const idCardRef = doc(db, 'id_cards', cleanEmail);
        await deleteDoc(idCardRef);
      } catch (e) {
        console.warn('id_cards delete doc warning:', e);
      }

      try {
        const idQ = query(collection(db, 'id_cards'), where('registrationNumber', '==', m.registrationNumber));
        const idSnap = await getDocs(idQ);
        idSnap.forEach(async (d) => {
          await deleteDoc(doc(db, 'id_cards', d.id));
        });
      } catch (_) {}

      // 4. Delete from Firestore 'admins' collection if present
      try {
        const adminRef = doc(db, 'admins', cleanEmail);
        await deleteDoc(adminRef);
      } catch (e) {
        console.warn('admins delete doc warning:', e);
      }

      try {
        const adminQ = query(collection(db, 'admins'), where('registrationNumber', '==', m.registrationNumber));
        const adminSnap = await getDocs(adminQ);
        adminSnap.forEach(async (d) => {
          await deleteDoc(doc(db, 'admins', d.id));
        });
      } catch (_) {}

      // 5. Send deletion sync to Google Sheets if configured
      if (CONFIG.GOOGLE_SCRIPT_ID_CARD_URL) {
        const deleteSheetUrl = `${CONFIG.GOOGLE_SCRIPT_ID_CARD_URL}?action=delete_idcard&email=${encodeURIComponent(cleanEmail)}`;
        fetch(deleteSheetUrl, { mode: 'no-cors' }).catch(console.error);
      }

      // Log activity with specific action identifier for Member Portal deletion
      await logAdminAction(
        'DELETE_MEMBER_DOSSIER',
        cleanEmail,
        m.name,
        m.registrationNumber,
        'Permanently deleted member dossier, database records, and Supabase profile/avatar storage files'
      );

      setSuccessMessage(`Member "${m.name}" (${m.registrationNumber}) dossier, database records, and Supabase storage files (photos/avatars) have been permanently deleted.`);
      setRemoveDossier(null);
      setRemoveRegNoInput('');
      loadDatabaseData();
    } catch (err: any) {
      console.error('Error deleting member dossier:', err);
      setErrorMessage(err?.message || 'Failed to complete member deletion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter autocomplete for update tab
  const filteredUpdateMembers = updateSearchQuery
    ? allMembers.filter(
        (m) =>
          m.name.toLowerCase().includes(updateSearchQuery.toLowerCase()) ||
          m.registrationNumber.toLowerCase().includes(updateSearchQuery.toLowerCase()) ||
          m.email.toLowerCase().includes(updateSearchQuery.toLowerCase())
      )
    : allMembers;

  // Filter logs ONLY for Member Portal Changes (Excludes all ID Card portal logs)
  const memberOnlyLogs = logs.filter((log) => {
    const act = (log.action || '').toUpperCase().trim();
    return MEMBER_ACTION_TYPES.includes(act);
  });

  // Filter logs for logs tab search and action filter
  const visibleLogs = memberOnlyLogs.filter((log) => {
    const queryLower = logSearchQuery.toLowerCase().trim();
    const matchesSearch =
      !queryLower ||
      (log.performedBy || '').toLowerCase().includes(queryLower) ||
      (log.adminEmail || '').toLowerCase().includes(queryLower) ||
      (log.targetName || '').toLowerCase().includes(queryLower) ||
      (log.targetRegNo || '').toLowerCase().includes(queryLower) ||
      (log.targetEmail || '').toLowerCase().includes(queryLower) ||
      (log.details || '').toLowerCase().includes(queryLower);

    const matchesAction =
      logActionFilter === 'All' || log.action.toUpperCase() === logActionFilter.toUpperCase();

    return matchesSearch && matchesAction;
  });

  return (
    <main className="flex-grow min-h-screen relative overflow-hidden bg-mesh text-left py-4 sm:py-8 md:py-16 px-2.5 sm:px-4">
      <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8">
        {/* Header Banner */}
        <div className="bg-[#0e0518]/90 border border-purple-500/30 rounded-2xl p-4 sm:p-6 md:p-8 backdrop-blur-xl shadow-[0_0_50px_rgba(168,85,247,0.15)] relative">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-purple-400 text-2xl sm:text-3xl">admin_panel_settings</span>
              <span className="font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                ADMIN CONTROL CENTER
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto">
              <button
                onClick={() => handleTabSwitch('logs')}
                className={`flex-1 sm:flex-none px-3.5 py-2 border rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer min-h-[40px] ${
                  activeTab === 'logs'
                    ? 'bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 text-white border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.35)]'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10 border-white/10'
                }`}
              >
                <span className="material-symbols-outlined text-sm text-purple-400">history</span>
                <span>Activity Logs ({memberOnlyLogs.length})</span>
              </button>

              {onRedirect && (
                <button
                  onClick={onRedirect}
                  className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                >
                  <span className="material-symbols-outlined text-sm">arrow_back</span>
                  <span>Dashboard</span>
                </button>
              )}
            </div>
          </div>

          <h2 className="font-display-lg text-xl sm:text-2xl md:text-4xl font-extrabold text-white uppercase tracking-tight">
            Member Management Portal
          </h2>
          <p className="font-body-lg text-slate-400 text-xs sm:text-sm mt-1.5 leading-relaxed">
            Add new member credentials, update existing profiles, remove member dossiers, or review administrative action logs.
          </p>

          {/* Top Navigation Tabs (Responsive grid on mobile) */}
          <div className="grid grid-cols-3 gap-1.5 sm:flex sm:items-center sm:gap-2 mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-purple-500/20 w-full">
            <button
              onClick={() => handleTabSwitch('add')}
              className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs uppercase tracking-wider transition-all cursor-pointer min-h-[42px] ${
                activeTab === 'add'
                  ? 'bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]'
                  : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-sm sm:text-base">person_add</span>
              <span className="truncate">Add</span>
            </button>

            <button
              onClick={() => handleTabSwitch('update')}
              className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs uppercase tracking-wider transition-all cursor-pointer min-h-[42px] ${
                activeTab === 'update'
                  ? 'bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]'
                  : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-sm sm:text-base">edit_note</span>
              <span className="truncate">Update</span>
            </button>

            <button
              onClick={() => handleTabSwitch('remove')}
              className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs uppercase tracking-wider transition-all cursor-pointer min-h-[42px] ${
                activeTab === 'remove'
                  ? 'bg-gradient-to-r from-red-950 via-red-900 to-rose-950 text-red-100 border border-red-800/80 shadow-[0_0_20px_rgba(153,27,27,0.5)]'
                  : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-sm sm:text-base text-red-400">person_remove</span>
              <span className="truncate">Remove</span>
            </button>
          </div>
        </div>

        {/* Global Feedback Banner */}
        {errorMessage && (
          <div className="p-3.5 sm:p-4 rounded-xl bg-red-950/90 border border-red-800/60 text-red-200 text-xs sm:text-sm flex items-center gap-3 backdrop-blur-xl">
            <span className="material-symbols-outlined text-red-400 shrink-0 text-lg sm:text-xl">error</span>
            <span className="leading-snug">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3.5 sm:p-4 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs sm:text-sm flex items-center gap-3 backdrop-blur-xl">
            <span className="material-symbols-outlined text-emerald-400 shrink-0 text-lg sm:text-xl">check_circle</span>
            <span className="leading-snug">{successMessage}</span>
          </div>
        )}

        {/* TAB 1: ADD MEMBER */}
        {activeTab === 'add' && (
          <div className="bg-[#0e0518]/90 border border-purple-500/30 rounded-2xl p-4 sm:p-8 md:p-10 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.15)] relative">
            <h3 className="font-display-lg text-lg sm:text-xl font-bold text-white uppercase mb-5 sm:mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-400">person_add</span>
              <span>Register New Member</span>
            </h3>

            <form onSubmit={handleAddSubmit} className="space-y-4 sm:space-y-6">
              {/* Member Name & Registration Number */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                <div className="space-y-1.5 sm:space-y-2">
                  <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                    MEMBER NAME *
                  </label>
                  <input
                    type="text"
                    required
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="e.g. Alex Morgan"
                    className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                  />
                </div>

                <div className="space-y-1.5 sm:space-y-2">
                  <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                    REGISTRATION NUMBER *
                  </label>
                  <input
                    type="text"
                    required
                    value={addRegNo}
                    onChange={(e) => setAddRegNo(e.target.value.toUpperCase())}
                    placeholder="e.g. 24BCE10263"
                    className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white font-code-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm uppercase min-h-[44px]"
                  />
                </div>
              </div>

              {/* Position & Team Dropdowns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                {/* Position Dropdown */}
                <div className="space-y-1.5 sm:space-y-2">
                  <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                    POSITION *
                  </label>
                  {!showAddCustomPosition && addPosition !== 'Other' ? (
                    <select
                      value={addPosition}
                      onChange={(e) => {
                        if (e.target.value === 'Other') {
                          setShowAddCustomPosition(true);
                          setAddPosition('Other');
                        } else {
                          setAddPosition(e.target.value);
                        }
                      }}
                      className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm cursor-pointer min-h-[44px]"
                    >
                      {DEFAULT_POSITIONS.map((pos) => (
                        <option key={pos} value={pos} className="bg-[#130924] text-white">
                          {pos}
                        </option>
                      ))}
                      <option value="Other" className="bg-[#130924] text-purple-300 font-bold">
                        Other (Specify Custom Position)...
                      </option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        value={addCustomPosition}
                        onChange={(e) => setAddCustomPosition(e.target.value)}
                        placeholder="Type custom position..."
                        className="flex-1 bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddCustomPosition(false);
                          setAddPosition(DEFAULT_POSITIONS[0]);
                        }}
                        className="px-3 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-xl text-xs font-bold hover:bg-purple-500/30 min-h-[44px]"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Team Dropdown */}
                <div className="space-y-1.5 sm:space-y-2">
                  <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                    TEAM *
                  </label>
                  {!showAddCustomTeam && addTeam !== 'Other' ? (
                    <select
                      value={addTeam}
                      onChange={(e) => {
                        if (e.target.value === 'Other') {
                          setShowAddCustomTeam(true);
                          setAddTeam('Other');
                        } else {
                          setAddTeam(e.target.value);
                        }
                      }}
                      className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm cursor-pointer min-h-[44px]"
                    >
                      {teamCategories.map((t) => (
                        <option key={t} value={t} className="bg-[#130924] text-white">
                          {t}
                        </option>
                      ))}
                      <option value="Other" className="bg-[#130924] text-purple-300 font-bold">
                        Other (Specify Custom Team)...
                      </option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        value={addCustomTeam}
                        onChange={(e) => setAddCustomTeam(e.target.value)}
                        placeholder="Type custom team..."
                        className="flex-1 bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddCustomTeam(false);
                          if (teamCategories.length > 0) setAddTeam(teamCategories[0]);
                        }}
                        className="px-3 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-xl text-xs font-bold hover:bg-purple-500/30 min-h-[44px]"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Official Email Address */}
              <div className="space-y-1.5 sm:space-y-2">
                <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                  OFFICIAL EMAIL ADDRESS *
                </label>
                <input
                  type="email"
                  required
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value.toLowerCase())}
                  placeholder="name.24xx@vitbhopal.ac.in"
                  className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white font-code-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                />
              </div>

              <div className="pt-3 sm:pt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-extrabold py-3.5 px-8 rounded-xl shadow-[0_0_25px_rgba(168,85,247,0.4)] transition-all duration-200 disabled:opacity-50 min-h-[46px] cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>ADDING TO DATABASE...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-lg">person_add</span>
                      <span>ADD MEMBER</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 2: UPDATE MEMBER */}
        {activeTab === 'update' && (
          <div className="bg-[#0e0518]/90 border border-purple-500/30 rounded-2xl p-4 sm:p-8 md:p-10 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.15)] relative">
            <h3 className="font-display-lg text-lg sm:text-xl font-bold text-white uppercase mb-5 sm:mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-400">edit_note</span>
              <span>Update Existing Member Details</span>
            </h3>

            {!selectedMemberToUpdate ? (
              <div className="space-y-4 sm:space-y-6">
                <div className="space-y-1.5 sm:space-y-2">
                  <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                    SEARCH MEMBER BY NAME, REGISTRATION NUMBER, OR EMAIL
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={updateSearchQuery}
                      onChange={(e) => setUpdateSearchQuery(e.target.value)}
                      placeholder="Type name, reg number or email..."
                      className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 pl-10 text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                    />
                    <span className="material-symbols-outlined absolute left-3 top-3 text-purple-400 text-xl">
                      search
                    </span>
                  </div>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                  <label className="block font-label-caps text-[10px] text-slate-400 font-bold tracking-wider uppercase">
                    SELECT A MEMBER FROM DATABASE ({filteredUpdateMembers.length} AVAILABLE)
                  </label>
                  {filteredUpdateMembers.length === 0 ? (
                    <div className="p-4 rounded-xl bg-[#130924]/40 border border-purple-500/20 text-slate-400 text-xs sm:text-sm text-center">
                      No matching registered members found.
                    </div>
                  ) : (
                    filteredUpdateMembers.map((m) => (
                      <button
                        key={m.email}
                        type="button"
                        onClick={() => handleSelectMemberToUpdate(m)}
                        className="w-full text-left p-3.5 sm:p-4 rounded-xl bg-[#130924]/60 hover:bg-purple-900/30 border border-purple-500/20 hover:border-purple-500/50 transition-all flex items-center justify-between group cursor-pointer"
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="font-bold text-white text-xs sm:text-sm flex items-center gap-2 flex-wrap">
                            <span className="truncate">{m.name}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-code-sm shrink-0">
                              {m.registrationNumber || 'NO REG'}
                            </span>
                          </div>
                          <div className="text-[11px] sm:text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                            <span className="truncate max-w-[160px] sm:max-w-xs">{m.email}</span>
                            <span>•</span>
                            <span className="text-purple-300">{m.team}</span>
                            <span>•</span>
                            <span className="text-indigo-300">{m.position}</span>
                          </div>
                        </div>
                        <span className="material-symbols-outlined text-purple-400 group-hover:translate-x-1 transition-transform shrink-0">
                          arrow_forward
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleUpdateSubmit} className="space-y-4 sm:space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 rounded-xl bg-purple-950/40 border border-purple-500/30 mb-4 gap-3">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-purple-400 text-xl shrink-0">person</span>
                    <div className="min-w-0">
                      <div className="font-bold text-white text-xs sm:text-sm truncate">Editing Member: {selectedMemberToUpdate.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">{selectedMemberToUpdate.email}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedMemberToUpdate(null)}
                    className="w-full sm:w-auto px-3 py-1.5 bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold rounded-lg transition-all min-h-[36px]"
                  >
                    Change Member
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                      MEMBER NAME *
                    </label>
                    <input
                      type="text"
                      required
                      value={updateName}
                      onChange={(e) => setUpdateName(e.target.value)}
                      className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                    />
                  </div>

                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                      REGISTRATION NUMBER *
                    </label>
                    <input
                      type="text"
                      required
                      value={updateRegNo}
                      onChange={(e) => setUpdateRegNo(e.target.value.toUpperCase())}
                      className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white font-code-sm focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm uppercase min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  {/* Position Dropdown */}
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                      POSITION *
                    </label>
                    {!showUpdateCustomPosition && updatePosition !== 'Other' ? (
                      <select
                        value={updatePosition}
                        onChange={(e) => {
                          if (e.target.value === 'Other') {
                            setShowUpdateCustomPosition(true);
                            setUpdatePosition('Other');
                          } else {
                            setUpdatePosition(e.target.value);
                          }
                        }}
                        className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm cursor-pointer min-h-[44px]"
                      >
                        {DEFAULT_POSITIONS.map((pos) => (
                          <option key={pos} value={pos} className="bg-[#130924] text-white">
                            {pos}
                          </option>
                        ))}
                        <option value="Other" className="bg-[#130924] text-purple-300 font-bold">
                          Other (Specify Custom Position)...
                        </option>
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          value={updateCustomPosition}
                          onChange={(e) => setUpdateCustomPosition(e.target.value)}
                          placeholder="Type custom position..."
                          className="flex-1 bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setShowUpdateCustomPosition(false);
                            setUpdatePosition(DEFAULT_POSITIONS[0]);
                          }}
                          className="px-3 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-xl text-xs font-bold hover:bg-purple-500/30 min-h-[44px]"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Team Dropdown */}
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                      TEAM *
                    </label>
                    {!showUpdateCustomTeam && updateTeam !== 'Other' ? (
                      <select
                        value={updateTeam}
                        onChange={(e) => {
                          if (e.target.value === 'Other') {
                            setShowUpdateCustomTeam(true);
                            setUpdateTeam('Other');
                          } else {
                            setUpdateTeam(e.target.value);
                          }
                        }}
                        className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm cursor-pointer min-h-[44px]"
                      >
                        {teamCategories.map((t) => (
                          <option key={t} value={t} className="bg-[#130924] text-white">
                            {t}
                          </option>
                        ))}
                        <option value="Other" className="bg-[#130924] text-purple-300 font-bold">
                          Other (Specify Custom Team)...
                        </option>
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          value={updateCustomTeam}
                          onChange={(e) => setUpdateCustomTeam(e.target.value)}
                          placeholder="Type custom team..."
                          className="flex-1 bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setShowUpdateCustomTeam(false);
                            if (teamCategories.length > 0) setAddTeam(teamCategories[0]);
                          }}
                          className="px-3 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-xl text-xs font-bold hover:bg-purple-500/30 min-h-[44px]"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5 sm:space-y-2">
                  <label className="block font-label-caps text-[10px] sm:text-xs text-purple-300 font-bold tracking-widest uppercase">
                    OFFICIAL EMAIL ADDRESS (DATABASE RECORD KEY) *
                  </label>
                  <input
                    type="email"
                    required
                    value={updateEmail}
                    onChange={(e) => setUpdateEmail(e.target.value.toLowerCase())}
                    className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white font-code-sm focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                  />
                </div>

                <div className="pt-4 flex flex-col sm:flex-row sm:justify-end gap-3 w-full">
                  <button
                    type="button"
                    onClick={() => setSelectedMemberToUpdate(null)}
                    className="w-full sm:w-auto px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-bold rounded-xl text-xs sm:text-sm transition-all min-h-[46px] flex items-center justify-center cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-extrabold py-3.5 px-6 sm:px-8 rounded-xl shadow-[0_0_25px_rgba(168,85,247,0.4)] transition-all duration-200 disabled:opacity-50 min-h-[46px] cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>SAVING...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-lg">save</span>
                        <span>UPDATE DETAILS</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleMakeAdminSubmit}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-purple-700 via-fuchsia-600 to-violet-600 hover:from-purple-600 hover:to-violet-500 text-white font-extrabold py-3.5 px-6 rounded-xl shadow-[0_0_25px_rgba(192,38,211,0.4)] transition-all duration-200 disabled:opacity-50 min-h-[46px] cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-lg text-purple-200">admin_panel_settings</span>
                    <span>MAKE ADMIN</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRemoveAdminSubmit}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-red-950 via-red-900 to-rose-950 hover:from-red-900 hover:to-red-800 text-red-100 border border-red-700/80 font-extrabold py-3.5 px-6 rounded-xl shadow-[0_0_25px_rgba(153,27,27,0.5)] transition-all duration-200 disabled:opacity-50 min-h-[46px] cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-lg text-red-400">admin_panel_settings</span>
                    <span>REMOVE AS ADMIN</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* TAB 3: REMOVE MEMBER & DOSSIER PREVIEW */}
        {activeTab === 'remove' && (
          <div className="bg-[#0e0518]/90 border border-red-900/40 rounded-2xl p-4 sm:p-8 md:p-10 backdrop-blur-xl shadow-[0_0_60px_rgba(153,27,27,0.2)] relative">
            <h3 className="font-display-lg text-lg sm:text-xl font-bold text-white uppercase mb-5 sm:mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-red-400">person_remove</span>
              <span>Remove Member &amp; Delete Dossier</span>
            </h3>

            <div className="space-y-3 sm:space-y-4 mb-6 sm:mb-8">
              <label className="block font-label-caps text-[10px] sm:text-xs text-red-300 font-bold tracking-widest uppercase">
                ENTER REGISTRATION NUMBER TO PREVIEW DOSSIER *
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={removeRegNoInput}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setRemoveRegNoInput(val);
                    if (val) handleSearchRemoveDossier(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearchRemoveDossier();
                  }}
                  placeholder="e.g. 24BCE10263"
                  className="flex-1 bg-[#130924]/80 border border-red-900/50 rounded-xl px-3.5 py-3 text-white font-code-sm uppercase placeholder-slate-500 focus:border-red-700 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={() => handleSearchRemoveDossier()}
                  disabled={isSearchingRemove}
                  className="w-full sm:w-auto px-6 py-3 bg-red-950/80 hover:bg-red-900/80 border border-red-800/80 text-red-200 font-bold rounded-xl text-xs sm:text-sm transition-all flex items-center justify-center gap-2 min-h-[44px] cursor-pointer"
                >
                  {isSearchingRemove ? (
                    <div className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                  ) : (
                    <span className="material-symbols-outlined text-lg text-red-400">search</span>
                  )}
                  <span>Find Member</span>
                </button>
              </div>
            </div>

            {removeDossier && (
              <div className="space-y-6 pt-4 border-t border-red-900/30 stagger-in">
                <div className="text-[10px] sm:text-xs font-label-caps text-slate-400 font-bold tracking-widest uppercase">
                  MEMBER DOSSIER PREVIEW:
                </div>

                <div className="relative w-full max-w-full sm:max-w-md mx-auto bg-gradient-to-br from-[#1c080e] via-[#100307] to-[#080104] border-2 border-red-800/60 rounded-2xl p-4 sm:p-6 shadow-[0_0_50px_rgba(153,27,27,0.3)] overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-red-900/10 rounded-full blur-2xl pointer-events-none" />

                  <div className="flex items-center justify-between pb-3.5 border-b border-red-900/40 mb-4 sm:mb-5">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-red-400 text-lg sm:text-xl">badge</span>
                      <span className="font-display-lg text-[10px] sm:text-xs font-black tracking-wider text-white">
                        VRGC | OFFICIAL DOSSIER
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[8px] sm:text-[9px] font-bold bg-red-950/80 text-red-300 border border-red-800/60">
                      FLAGGED FOR DELETION
                    </span>
                  </div>

                  <div className="flex items-center gap-3.5 sm:gap-5">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-red-800/50 bg-black/80 shrink-0 flex items-center justify-center shadow-lg">
                      <img
                        src={
                          removeDossier.photoUrl ||
                          removeDossier.avatarUrl ||
                          `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(removeDossier.name)}`
                        }
                        alt={removeDossier.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          if (removeDossier.avatarUrl && target.src !== removeDossier.avatarUrl) {
                            target.src = removeDossier.avatarUrl;
                          } else {
                            target.src = `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(removeDossier.name)}`;
                          }
                        }}
                      />
                    </div>

                    <div className="space-y-1 min-w-0 flex-1 text-left">
                      <h4 className="font-display-lg text-base sm:text-lg text-white font-extrabold truncate">
                        {removeDossier.name}
                      </h4>
                      <div className="inline-block px-2 py-0.5 rounded bg-red-950/60 border border-red-800/50 text-red-300 font-code-sm text-[10px] sm:text-xs font-bold tracking-wider">
                        {removeDossier.registrationNumber || 'NO REG'}
                      </div>
                      <div className="text-[11px] sm:text-xs text-slate-300 font-semibold truncate pt-0.5">
                        {removeDossier.email}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-red-300 font-bold pt-0.5">
                        <span>{removeDossier.team}</span>
                        <span>•</span>
                        <span>{removeDossier.position}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 sm:mt-5 p-2.5 sm:p-3 rounded-xl bg-red-950/90 border border-red-800/50 text-red-200 text-[11px] sm:text-xs flex items-center gap-2">
                    <span className="material-symbols-outlined text-red-400 text-sm sm:text-base shrink-0">warning</span>
                    <span>Action is permanent. Will delete records & Supabase storage files.</span>
                  </div>
                </div>

                <div className="pt-2 sm:pt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={handleDeleteMemberDossier}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto flex items-center justify-center gap-3 bg-gradient-to-r from-red-950 via-red-900 to-rose-950 hover:from-red-900 hover:to-red-800 text-red-100 border border-red-700/80 font-extrabold py-3.5 px-8 rounded-xl shadow-[0_0_35px_rgba(153,27,27,0.6)] transition-all duration-200 disabled:opacity-50 min-h-[46px] cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-5 h-5 border-2 border-red-200/30 border-t-red-200 rounded-full animate-spin" />
                        <span>DELETING DOSSIER & FILES...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-xl text-red-400">delete_forever</span>
                        <span className="tracking-wider uppercase text-xs sm:text-sm">DELETE MEMBER DOSSIER</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: MEMBER ACTIVITY LOGS ONLY */}
        {activeTab === 'logs' && (
          <div className="bg-[#0e0518]/90 border border-purple-500/30 rounded-2xl p-4 sm:p-8 md:p-10 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.15)] relative">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-6">
              <h3 className="font-display-lg text-lg sm:text-xl font-bold text-white uppercase flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400">history</span>
                <span>Member Portal Audit Trail</span>
              </h3>
              <span className="text-[11px] sm:text-xs text-slate-400 font-code-sm">
                MEMBER LOGS ONLY ({visibleLogs.length} OF {memberOnlyLogs.length})
              </span>
            </div>

            {/* Filter Controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-6">
              <div className="md:col-span-2 relative">
                <input
                  type="text"
                  value={logSearchQuery}
                  onChange={(e) => setLogSearchQuery(e.target.value)}
                  placeholder="Search by Admin Email, Target Member, Reg No..."
                  className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 pl-10 text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm min-h-[44px]"
                />
                <span className="material-symbols-outlined absolute left-3 top-3 text-purple-400 text-xl">
                  search
                </span>
              </div>

              <div>
                <select
                  value={logActionFilter}
                  onChange={(e) => setLogActionFilter(e.target.value)}
                  className="w-full bg-[#130924]/80 border border-purple-500/30 rounded-xl px-3.5 py-3 text-white focus:border-purple-500 focus:outline-none transition-all text-base sm:text-sm cursor-pointer min-h-[44px]"
                >
                  <option value="All" className="bg-[#130924] text-white">All Member Action Types</option>
                  <option value="ADD_MEMBER" className="bg-[#130924] text-emerald-300">ADD_MEMBER</option>
                  <option value="UPDATE_MEMBER" className="bg-[#130924] text-cyan-300">UPDATE_MEMBER</option>
                  <option value="MAKE_ADMIN" className="bg-[#130924] text-fuchsia-300">MAKE_ADMIN</option>
                  <option value="REMOVE_ADMIN" className="bg-[#130924] text-amber-300">REMOVE_ADMIN</option>
                  <option value="DELETE_MEMBER_DOSSIER" className="bg-[#130924] text-red-400">DELETE_MEMBER_DOSSIER</option>
                </select>
              </div>
            </div>

            {/* Logs List / Table */}
            {visibleLogs.length === 0 ? (
              <div className="p-8 text-center bg-[#130924]/40 border border-purple-500/20 rounded-xl text-slate-400 text-xs sm:text-sm space-y-2">
                <span className="material-symbols-outlined text-4xl text-slate-600">history_toggle_off</span>
                <p>No member activity logs match your current search or filter criteria.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-purple-500/20 bg-[#130924]/60 overflow-hidden">
                {/* DESKTOP TABLE */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-purple-500/20 bg-purple-950/40 text-[10px] font-label-caps text-purple-300 tracking-wider uppercase">
                        <th className="py-3.5 px-4">TIMESTAMP</th>
                        <th className="py-3.5 px-4">ACTION</th>
                        <th className="py-3.5 px-4">PERFORMED BY</th>
                        <th className="py-3.5 px-4">TARGET MEMBER</th>
                        <th className="py-3.5 px-4">ACTIVITY DETAILS</th>
                        <th className="py-3.5 px-4 text-right">ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-purple-500/10 text-xs">
                      {visibleLogs.map((log) => {
                        const dateObj = new Date(log.timestamp);
                        const formattedTime = isNaN(dateObj.getTime())
                          ? log.timestamp
                          : dateObj.toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            });

                        let badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
                        let badgeLabel = log.action;
                        let badgeIcon = 'info';

                        if (log.action === 'ADD_MEMBER') {
                          badgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                          badgeLabel = 'MEMBER ADDED';
                          badgeIcon = 'person_add';
                        } else if (log.action === 'UPDATE_MEMBER') {
                          badgeStyle = 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
                          badgeLabel = 'MEMBER UPDATED';
                          badgeIcon = 'edit_note';
                        } else if (log.action === 'MAKE_ADMIN') {
                          badgeStyle = 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40';
                          badgeLabel = 'MADE ADMIN';
                          badgeIcon = 'admin_panel_settings';
                        } else if (log.action === 'REMOVE_ADMIN') {
                          badgeStyle = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                          badgeLabel = 'REVOKED ADMIN';
                          badgeIcon = 'no_accounts';
                        } else if (log.action === 'DELETE_MEMBER_DOSSIER') {
                          badgeStyle = 'bg-red-950/80 text-red-300 border-red-800/60';
                          badgeLabel = 'DOSSIER DELETED';
                          badgeIcon = 'delete_forever';
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
                              {log.performedBy || log.adminEmail || 'Admin'}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {log.targetName || log.targetRegNo ? (
                                <div>
                                  <div className="font-bold text-white text-[11px]">{log.targetName || 'Member'}</div>
                                  <div className="text-[10px] text-purple-300 font-code-sm">{log.targetRegNo || log.targetEmail}</div>
                                </div>
                              ) : (
                                <span className="text-slate-500 text-[11px]">N/A</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-slate-300 text-[11px]">
                              {log.details}
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <button
                                onClick={() => {
                                  if (log.id && confirm('Delete this member activity log entry from database?')) {
                                    handleDeleteLog(log.id);
                                  }
                                }}
                                className="p-1.5 rounded-lg bg-red-950/90 border border-red-800/60 text-red-300 hover:bg-red-900 hover:border-red-700 transition-all shrink-0 cursor-pointer"
                                title="Delete Log Entry"
                              >
                                <span className="material-symbols-outlined text-xs">delete</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE CARDS */}
                <div className="flex md:hidden flex-col gap-3 p-3">
                  {visibleLogs.map((log) => {
                    const dateObj = new Date(log.timestamp);
                    const formattedTime = isNaN(dateObj.getTime())
                      ? log.timestamp
                      : dateObj.toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        });

                    let badgeStyle = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
                    let badgeLabel = log.action;
                    let badgeIcon = 'info';

                    if (log.action === 'ADD_MEMBER') {
                      badgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                      badgeLabel = 'MEMBER ADDED';
                      badgeIcon = 'person_add';
                    } else if (log.action === 'UPDATE_MEMBER') {
                      badgeStyle = 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
                      badgeLabel = 'MEMBER UPDATED';
                      badgeIcon = 'edit_note';
                    } else if (log.action === 'MAKE_ADMIN') {
                      badgeStyle = 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40';
                      badgeLabel = 'MADE ADMIN';
                      badgeIcon = 'admin_panel_settings';
                    } else if (log.action === 'REMOVE_ADMIN') {
                      badgeStyle = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                      badgeLabel = 'REVOKED ADMIN';
                      badgeIcon = 'no_accounts';
                    } else if (log.action === 'DELETE_MEMBER_DOSSIER') {
                      badgeStyle = 'bg-red-950/80 text-red-300 border-red-800/60';
                      badgeLabel = 'DOSSIER DELETED';
                      badgeIcon = 'delete_forever';
                    }

                    return (
                      <div key={log.id || log.timestamp + Math.random()} className="p-[#130924]/80 p-3.5 rounded-xl border border-purple-500/20 space-y-2 text-left">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold ${badgeStyle}`}>
                            <span className="material-symbols-outlined text-xs">{badgeIcon}</span>
                            <span>{badgeLabel}</span>
                          </span>
                          <span className="text-[10px] text-purple-300 font-mono">{formattedTime}</span>
                        </div>
                        <div className="text-xs text-white font-bold truncate">
                          Target: {log.targetName} ({log.targetRegNo || log.targetEmail})
                        </div>
                        <div className="text-[11px] text-slate-300 leading-snug">{log.details}</div>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2 border-t border-white/5">
                          <span className="truncate max-w-[200px]">By: {log.performedBy || log.adminEmail}</span>
                          {log.id && (
                            <button
                              onClick={() => {
                                if (confirm('Delete log entry?')) handleDeleteLog(log.id);
                              }}
                              className="text-red-300 hover:text-red-200 font-bold px-2 py-1 bg-red-950/90 border border-red-800/60 rounded"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
};

export default AdminMemberRegistration;
