"use client";

import React, { useState, useEffect } from 'react';
import {
  PermissionsConfig,
  ClubMetadata,
  ALL_PAGE_IDS,
  PageId,
  fetchPermissionsConfig,
  savePermissionsConfig,
  fetchClubMetadata,
  saveClubMetadata,
  DEFAULT_PERMISSIONS_CONFIG,
  DEFAULT_CLUB_METADATA,
  createDefaultPagePermissionsMap,
} from '@/lib/permissions';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { fetchAllFaculty, deleteFacultyMember, createFacultyMember, updateFacultyMember } from '@/lib/faculty';
import { FacultyMember } from '@/types/faculty';
import { CONFIG } from '@/lib/config';

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
  const [activeTab, setActiveTab] = useState<'permissions' | 'roles' | 'metadata' | 'faculty'>('permissions');

  // ─── 1. Permissions Matrix State ──────────────────────────────────────────
  const [permissions, setPermissions] = useState<PermissionsConfig>(DEFAULT_PERMISSIONS_CONFIG);
  const [savingPermissions, setSavingPermissions] = useState<boolean>(false);
  const [permissionsSuccess, setPermissionsSuccess] = useState<string>('');

  // ─── 2. Roles Governance State ────────────────────────────────────────────
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
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
    type: 'admin' | 'faculty' | 'role' | 'domain' | 'position';
    id: string;
    label: string;
  } | null>(null);

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
          (CONFIG.SUPER_ADMIN_EMAILS || []).some((se) => se.toLowerCase() === email)
        );
        const addedBy = data.addedBy || '';
        const createdAt = data.createdAt || data.created_at || '';

        const existing = adminMap.get(email);
        if (!existing) {
          adminMap.set(email, {
            id: d.id,
            email,
            name,
            role: isSuperAdmin ? 'Super Administrator' : role,
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
              role: (isSuperAdmin || existing.isSuperAdmin) ? 'Super Administrator' : role,
              isSuperAdmin: isSuperAdmin || existing.isSuperAdmin,
              addedBy: addedBy || existing.addedBy,
              createdAt: existing.createdAt || createdAt,
            });
          } else {
            duplicateDocIdsToDelete.push(d.id);
            if (isSuperAdmin) {
              existing.isSuperAdmin = true;
              existing.role = 'Super Administrator';
            }
          }
        }
      });

      // Also ensure all environment/config Super Admins are present and marked as Super Administrator
      (CONFIG.SUPER_ADMIN_EMAILS || []).forEach((superEmail) => {
        const cleanSuper = superEmail.toLowerCase().trim();
        if (!cleanSuper) return;
        const existing = adminMap.get(cleanSuper);
        if (existing) {
          existing.isSuperAdmin = true;
          existing.role = 'Super Administrator';
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

  const handleToggleMetadataRole = (roleName: string) => {
    setPermissions((prev) => {
      const exists = prev.allowedMetadataRoles.includes(roleName);
      const updated = exists
        ? prev.allowedMetadataRoles.filter((r) => r !== roleName)
        : [...prev.allowedMetadataRoles, roleName];
      return {
        ...prev,
        allowedMetadataRoles: updated,
      };
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
          addedBy: currentUserEmail,
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
      const nowIso = new Date().toISOString();

      // Immediate optimistic update
      setAdmins((prev) =>
        prev.map((a) => (a.email.toLowerCase() === cleanEmail ? { ...a, role: newRole } : a))
      );

      // Save to canonical document ID in admins and roles
      await setDoc(doc(db, 'admins', cleanEmail), { id: cleanEmail, email: cleanEmail, role: newRole, updatedAt: nowIso }, { merge: true });
      await setDoc(doc(db, 'roles', cleanEmail), { id: cleanEmail, email: cleanEmail, role: newRole, assignedBy: currentUserEmail, updatedAt: nowIso }, { merge: true });

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
      await deleteDoc(doc(db, 'admins', cleanEmail));
      await deleteDoc(doc(db, 'roles', cleanEmail));

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

  return (
    <div className="flex-grow min-h-screen bg-transparent p-3 sm:p-6 md:p-8 pb-36 sm:pb-16 text-left text-white select-none">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        
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

        {/* Tab Navigation Strip - Smooth Touch Horizontal Scroll */}
        <div className="flex border-b border-[#231238] gap-1 sm:gap-2 overflow-x-auto no-scrollbar flex-nowrap scroll-smooth pb-1 -mx-2 px-2 sm:mx-0 sm:px-0">
          <button
            onClick={() => setActiveTab('permissions')}
            className={`px-3 sm:px-5 py-2.5 rounded-t-xl text-xs font-black tracking-wider uppercase flex items-center gap-2 transition-all shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'permissions'
                ? 'border-purple-500 text-white bg-[#140b24]'
                : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="material-symbols-outlined text-base">rule</span>
            Permissions Matrix
          </button>

          <button
            onClick={() => setActiveTab('roles')}
            className={`px-3 sm:px-5 py-2.5 rounded-t-xl text-xs font-black tracking-wider uppercase flex items-center gap-2 transition-all shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'roles'
                ? 'border-purple-500 text-white bg-[#140b24]'
                : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="material-symbols-outlined text-base">badge</span>
            Roles &amp; Admins ({admins.length})
          </button>

          <button
            onClick={() => setActiveTab('metadata')}
            className={`px-3 sm:px-5 py-2.5 rounded-t-xl text-xs font-black tracking-wider uppercase flex items-center gap-2 transition-all shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'metadata'
                ? 'border-purple-500 text-white bg-[#140b24]'
                : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="material-symbols-outlined text-base">category</span>
            Domains &amp; Positions ({clubMetadata.domains.length + clubMetadata.positions.length})
          </button>

          <button
            onClick={() => setActiveTab('faculty')}
            className={`px-3 sm:px-5 py-2.5 rounded-t-xl text-xs font-black tracking-wider uppercase flex items-center gap-2 transition-all shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'faculty'
                ? 'border-purple-500 text-white bg-[#140b24]'
                : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="material-symbols-outlined text-base">school</span>
            Faculty Directory ({facultyList.length})
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
              <div className="flex items-center gap-2 text-xs font-black text-purple-300 uppercase tracking-wider">
                <span className="material-symbols-outlined text-purple-400 text-base">info</span>
                <span>How Portal Permissions &amp; Admin Desks Work</span>
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

            {/* Matrix Table with horizontal scroll */}
            <div className="bg-[#0c0517] border border-[#2b1642] rounded-2xl overflow-hidden shadow-lg overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs min-w-[880px]">
                <thead className="bg-[#140b24] border-b border-[#2b1642] text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-4 w-52">Role / Access Tier</th>
                    {ALL_PAGE_IDS.map((p) => (
                      <th
                        key={p.id}
                        className="p-3 text-center"
                        title={`Configure access for ${p.label}. Hover over checkboxes below to customize View, Edit/Admin Desk, and Maintenance Bypass.`}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="material-symbols-outlined text-sm text-purple-400">{p.icon}</span>
                          <span className="font-extrabold text-white">{p.label}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e0f33]">

                  {/* Row: Members Tier */}
                  <tr className="bg-[#0e071c] hover:bg-[#150a29] transition-colors">
                    <td className="p-4">
                      <div className="font-black text-white flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                        <span>Chapter Members</span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">Authenticated Student Tier</div>
                    </td>
                    {ALL_PAGE_IDS.map((p) => {
                      const perm = permissions.tiers.members?.[p.id] || { canView: false, canEdit: false, bypassMaintenance: false };
                      return (
                        <td key={p.id} className="p-3 text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            <label
                              className="flex items-center gap-1 cursor-pointer text-[10px]"
                              title={`VIEW: When checked, Chapter Members can view the ${p.label} portal.`}
                            >
                              <input
                                type="checkbox"
                                checked={perm.canView}
                                onChange={() => handleToggleTierPermission('members', p.id, 'canView')}
                                className="accent-purple-600 rounded cursor-pointer"
                              />
                              <span className={perm.canView ? 'text-white font-bold' : 'text-slate-500'}>View</span>
                            </label>
                            <label
                              className="flex items-center gap-1 cursor-pointer text-[10px]"
                              title={`EDIT (ADMIN DESK): When checked, Chapter Members get Admin Desk access on ${p.label}. Turn OFF to restrict to regular member submissions.`}
                            >
                              <input
                                type="checkbox"
                                checked={perm.canEdit}
                                onChange={() => handleToggleTierPermission('members', p.id, 'canEdit')}
                                className="accent-purple-600 rounded cursor-pointer"
                              />
                              <span className={perm.canEdit ? 'text-emerald-400 font-bold' : 'text-slate-500'}>Edit</span>
                            </label>
                            <label
                              className="flex items-center gap-1 cursor-pointer text-[10px]"
                              title={`BYPASS: When checked, Chapter Members can access ${p.label} during maintenance.`}
                            >
                              <input
                                type="checkbox"
                                checked={perm.bypassMaintenance}
                                onChange={() => handleToggleTierPermission('members', p.id, 'bypassMaintenance')}
                                className="accent-amber-500 rounded cursor-pointer"
                              />
                              <span className={perm.bypassMaintenance ? 'text-amber-300 font-bold' : 'text-slate-600'}>Bypass</span>
                            </label>
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Row: Faculty Tier */}
                  <tr className="bg-[#0e071c] hover:bg-[#150a29] transition-colors">
                    <td className="p-4">
                      <div className="font-black text-white flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
                        <span>Faculty Advisory</span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">Academic Mentors Tier</div>
                    </td>
                    {ALL_PAGE_IDS.map((p) => {
                      const perm = permissions.tiers.faculty?.[p.id] || { canView: false, canEdit: false, bypassMaintenance: false };
                      return (
                        <td key={p.id} className="p-3 text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            <label
                              className="flex items-center gap-1 cursor-pointer text-[10px]"
                              title={`VIEW: When checked, Faculty can view the ${p.label} portal.`}
                            >
                              <input
                                type="checkbox"
                                checked={perm.canView}
                                onChange={() => handleToggleTierPermission('faculty', p.id, 'canView')}
                                className="accent-indigo-600 rounded cursor-pointer"
                              />
                              <span className={perm.canView ? 'text-white font-bold' : 'text-slate-500'}>View</span>
                            </label>
                            <label
                              className="flex items-center gap-1 cursor-pointer text-[10px]"
                              title={`EDIT (ADMIN DESK): When checked, Faculty get Admin Desk & management access on ${p.label}.`}
                            >
                              <input
                                type="checkbox"
                                checked={perm.canEdit}
                                onChange={() => handleToggleTierPermission('faculty', p.id, 'canEdit')}
                                className="accent-indigo-600 rounded cursor-pointer"
                              />
                              <span className={perm.canEdit ? 'text-emerald-400 font-bold' : 'text-slate-500'}>Edit</span>
                            </label>
                            <label
                              className="flex items-center gap-1 cursor-pointer text-[10px]"
                              title={`BYPASS: When checked, Faculty can access ${p.label} during maintenance.`}
                            >
                              <input
                                type="checkbox"
                                checked={perm.bypassMaintenance}
                                onChange={() => handleToggleTierPermission('faculty', p.id, 'bypassMaintenance')}
                                className="accent-amber-500 rounded cursor-pointer"
                              />
                              <span className={perm.bypassMaintenance ? 'text-amber-300 font-bold' : 'text-slate-600'}>Bypass</span>
                            </label>
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Rows: All Roles (System + Custom) */}
                  {allRolesList.map((roleName) => (
                    <tr key={roleName} className="hover:bg-[#150a29] transition-colors">
                      <td className="p-4">
                        <div className="font-black text-purple-300 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                          <span>{roleName}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {['Admin', 'Payment Admin', 'Technical'].includes(roleName) ? 'Core Administrative Role' : 'Custom Role'}
                        </div>
                      </td>
                      {ALL_PAGE_IDS.map((p) => {
                        const perm = permissions.roles[roleName]?.[p.id] || { canView: false, canEdit: false, bypassMaintenance: false };
                        return (
                          <td key={p.id} className="p-3 text-center">
                            <div className="flex flex-col items-center gap-1.5">
                              <label
                                className="flex items-center gap-1 cursor-pointer text-[10px]"
                                title={`VIEW: When checked, ${roleName} can view and access the ${p.label} portal.`}
                              >
                                <input
                                  type="checkbox"
                                  checked={perm.canView}
                                  onChange={() => handleToggleRolePermission(roleName, p.id, 'canView')}
                                  className="accent-purple-600 rounded cursor-pointer"
                                />
                                <span className={perm.canView ? 'text-white font-bold' : 'text-slate-500'}>View</span>
                              </label>
                              <label
                                className="flex items-center gap-1 cursor-pointer text-[10px]"
                                title={`EDIT (ADMIN DESK): When checked, ${roleName} gets Admin Desk & write authority on ${p.label}. When unchecked, Admin Desk is hidden and locked.`}
                              >
                                <input
                                  type="checkbox"
                                  checked={perm.canEdit}
                                  onChange={() => handleToggleRolePermission(roleName, p.id, 'canEdit')}
                                  className="accent-purple-600 rounded cursor-pointer"
                                />
                                <span className={perm.canEdit ? 'text-emerald-400 font-bold' : 'text-slate-500'}>Edit</span>
                              </label>
                              <label
                                className="flex items-center gap-1 cursor-pointer text-[10px]"
                                title={`BYPASS: When checked, ${roleName} can access ${p.label} during maintenance mode.`}
                              >
                                <input
                                  type="checkbox"
                                  checked={perm.bypassMaintenance}
                                  onChange={() => handleToggleRolePermission(roleName, p.id, 'bypassMaintenance')}
                                  className="accent-amber-500 rounded cursor-pointer"
                                />
                                <span className={perm.bypassMaintenance ? 'text-amber-300 font-bold' : 'text-slate-600'}>Bypass</span>
                              </label>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          {/* Sub-section: Metadata Delegation Permissions */}
          <div className="p-5 bg-[#0e071a] border border-[#261238] rounded-2xl space-y-3">
            <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-400 text-sm">settings_suggest</span>
              <span>Delegated Club Metadata Management</span>
            </h3>
            <p className="text-xs text-slate-300">
              Super Admin can permit designated roles to add, edit, or modify Primary Domains and Member Positions directly in the Members Roster form.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {allRolesList.map((roleName) => {
                const isAllowed = permissions.allowedMetadataRoles.includes(roleName);
                return (
                  <label
                    key={roleName}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                      isAllowed
                        ? 'bg-purple-900/60 border-purple-500 text-white'
                        : 'bg-[#150a24] border-purple-900/30 text-slate-400 hover:text-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isAllowed}
                      onChange={() => handleToggleMetadataRole(roleName)}
                      className="accent-purple-600 rounded cursor-pointer"
                    />
                    <span>{roleName} can manage Domains &amp; Roles</span>
                  </label>
                );
              })}
            </div>
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

            {/* Table */}
            <div className="border border-[#2b1442] rounded-2xl overflow-hidden bg-[#0c0517] overflow-x-auto custom-scrollbar shadow-md">
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
                            {adm.isSuperAdmin ? (
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
                            {adm.isSuperAdmin ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-900/80 text-purple-200 border border-purple-600">
                                SUPER ADMIN
                              </span>
                            ) : (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                adm.role === 'Technical'
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
                            {adm.addedBy || 'System Env'}
                          </td>
                          <td className="p-3.5 text-right">
                            {isCurrent ? (
                              <span className="text-[10px] font-semibold text-slate-500 italic">Current Session</span>
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
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-purple-400 text-base">folder_special</span>
                      <span>{dom}</span>
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
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-indigo-400 text-base">workspace_premium</span>
                      <span>{pos}</span>
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

          {/* Faculty Table */}
          <div className="border border-[#2b1442] rounded-2xl overflow-hidden bg-[#0c0517] overflow-x-auto custom-scrollbar shadow-md">
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
