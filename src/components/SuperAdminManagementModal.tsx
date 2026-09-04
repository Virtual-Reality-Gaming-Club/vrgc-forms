"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';
import {
  fetchAllFaculty,
  createFacultyMember,
  updateFacultyMember,
  deleteFacultyMember,
} from '@/lib/faculty';
import { FacultyMember } from '@/types/faculty';
import { CONFIG } from '@/lib/config';

export interface AdminRecord {
  id: string;
  email: string;
  name?: string;
  role?: string;
  isSuperAdmin?: boolean;
  addedBy?: string;
  createdAt?: string;
}

interface SuperAdminManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserEmail: string;
}

const SuperAdminManagementModal: React.FC<SuperAdminManagementModalProps> = ({
  isOpen,
  onClose,
  currentUserEmail,
}) => {
  const [activeTab, setActiveTab] = useState<'admins' | 'faculty'>('admins');

  // Admins state
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState<boolean>(false);
  const [adminSearch, setAdminSearch] = useState<string>('');
  const [isAddAdminOpen, setIsAddAdminOpen] = useState<boolean>(false);
  const [newAdminEmail, setNewAdminEmail] = useState<string>('');
  const [newAdminName, setNewAdminName] = useState<string>('');
  const [newAdminRole, setNewAdminRole] = useState<'Admin' | 'Payment Admin' | 'Technical'>('Admin');
  const [submittingAdmin, setSubmittingAdmin] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string>('');

  // Faculty state
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

  // Confirmation modal state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'admin' | 'faculty';
    id: string;
    label: string;
  } | null>(null);

  // Load admins from Firestore
  const loadAdmins = async () => {
    setLoadingAdmins(true);
    try {
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

      if (duplicateDocIdsToDelete.length > 0) {
        duplicateDocIdsToDelete.forEach((dupId) => {
          deleteDoc(doc(db, 'admins', dupId)).catch(console.warn);
        });
      }

      setAdmins(Array.from(adminMap.values()));
    } catch (err) {
      console.error('Error loading admins from Firestore:', err);
    } finally {
      setLoadingAdmins(false);
    }
  };

  // Load faculty from Firestore
  const loadFaculty = async () => {
    setLoadingFaculty(true);
    try {
      const list = await fetchAllFaculty();
      setFacultyList(list);
    } catch (err) {
      console.error('Error loading faculty list:', err);
    } finally {
      setLoadingFaculty(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadAdmins();
      loadFaculty();
    }
  }, [isOpen]);

  // Handle Add Admin (writes to both `admins` and `roles` collections in Firebase)
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
      // 1. Update `admins` collection
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

      // 2. Update Firebase `roles` table
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
      await loadAdmins();
    } catch (err: any) {
      console.error('Error adding admin:', err);
      setAdminError(err?.message || 'Failed to save admin record.');
    } finally {
      setSubmittingAdmin(false);
    }
  };

  // Handle Quick Change Admin Role
  const handleUpdateAdminRole = async (adminEmail: string, newRole: 'Admin' | 'Payment Admin' | 'Technical') => {
    try {
      const cleanEmail = adminEmail.toLowerCase().trim();
      const nowIso = new Date().toISOString();

      // Immediate optimistic update
      setAdmins((prev) =>
        prev.map((a) => (a.email.toLowerCase() === cleanEmail ? { ...a, role: newRole } : a))
      );

      await setDoc(doc(db, 'admins', cleanEmail), { id: cleanEmail, email: cleanEmail, role: newRole, updatedAt: nowIso }, { merge: true });
      await setDoc(doc(db, 'roles', cleanEmail), { id: cleanEmail, email: cleanEmail, role: newRole, assignedBy: currentUserEmail, updatedAt: nowIso }, { merge: true });

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

      await loadAdmins();
    } catch (err) {
      console.error('Error updating admin role:', err);
    }
  };

  // Handle Drop Admin (removes from both `admins` and `roles` collections)
  const handleDropAdmin = async (adminId: string) => {
    try {
      const cleanEmail = adminId.toLowerCase().trim();
      await deleteDoc(doc(db, 'admins', cleanEmail));
      await deleteDoc(doc(db, 'roles', cleanEmail));

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
      await loadAdmins();
    } catch (err) {
      console.error('Error dropping admin:', err);
    }
  };

  // Open Faculty Form
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

  // Handle Save Faculty
  const handleSaveFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    setFacultyError('');
    const cleanEmail = facultyFormData.email.toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFacultyError('Please enter a valid faculty email address.');
      return;
    }
    if (!facultyFormData.name.trim()) {
      setFacultyError('Faculty name is required.');
      return;
    }

    setSubmittingFaculty(true);
    try {
      if (editingFaculty) {
        await updateFacultyMember(editingFaculty.email, {
          name: facultyFormData.name.trim(),
          facultyId: facultyFormData.facultyId.trim(),
          department: facultyFormData.department.trim(),
          designation: facultyFormData.designation.trim(),
          phone: facultyFormData.phone.trim(),
        });
      } else {
        await createFacultyMember({
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
      await loadFaculty();
    } catch (err: any) {
      console.error('Error saving faculty member:', err);
      setFacultyError(err?.message || 'Failed to save faculty record.');
    } finally {
      setSubmittingFaculty(false);
    }
  };

  // Handle Delete Faculty
  const handleDeleteFaculty = async (facultyEmail: string) => {
    try {
      await deleteFacultyMember(facultyEmail);
      setDeleteConfirm(null);
      await loadFaculty();
    } catch (err) {
      console.error('Error deleting faculty:', err);
    }
  };

  if (!isOpen) return null;

  const filteredAdmins = admins.filter(
    (a) =>
      a.email.toLowerCase().includes(adminSearch.toLowerCase()) ||
      (a.name && a.name.toLowerCase().includes(adminSearch.toLowerCase())) ||
      (a.role && a.role.toLowerCase().includes(adminSearch.toLowerCase()))
  );

  const filteredFaculty = facultyList.filter(
    (f) =>
      f.name.toLowerCase().includes(facultySearch.toLowerCase()) ||
      f.email.toLowerCase().includes(facultySearch.toLowerCase()) ||
      (f.department && f.department.toLowerCase().includes(facultySearch.toLowerCase())) ||
      (f.facultyId && f.facultyId.toLowerCase().includes(facultySearch.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-black/85 backdrop-blur-md select-none">
      <div className="w-full max-w-5xl max-h-[88vh] flex flex-col bg-[#0f0f0f] border border-purple-600/40 rounded-2xl shadow-[0_0_50px_rgba(147,51,234,0.2)] overflow-hidden text-white text-left mx-1 sm:mx-0">
        {/* Header */}
        <div className="p-4 sm:p-6 bg-[#161616] border-b border-[#262626] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-900/60 border border-purple-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-purple-300 text-2xl">admin_panel_settings</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-white tracking-wide">Super Admin Command Center</h2>
                <span className="px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold bg-purple-700 text-white uppercase tracking-wider">
                  Firebase Database Live
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                Direct management of Administrators and Faculty advisory records stored in Firebase Firestore.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#262626] hover:bg-[#333333] text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-4 bg-[#121212] border-b border-[#262626] flex items-center gap-3 shrink-0">
          <button
            onClick={() => setActiveTab('admins')}
            className={`pb-3 px-4 text-xs font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'admins'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-base">shield_person</span>
            Admins Governance ({admins.length})
          </button>
          <button
            onClick={() => setActiveTab('faculty')}
            className={`pb-3 px-4 text-xs font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'faculty'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-base">school</span>
            Faculty Database ({facultyList.length})
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#0a0a0a] space-y-6">
          {/* TAB 1: ADMINS */}
          {activeTab === 'admins' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-lg">search</span>
                  <input
                    type="text"
                    placeholder="Search admins by name, email, or role..."
                    value={adminSearch}
                    onChange={(e) => setAdminSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-[#161616] border border-[#2a2a2a] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
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
                <form
                  onSubmit={handleAddAdmin}
                  className="p-4 bg-[#141414] border border-purple-600/50 rounded-xl space-y-3 animate-in fade-in duration-200"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">add_moderator</span>
                      Add Admin to Firebase Database
                    </h4>
                    <button
                      type="button"
                      onClick={() => setIsAddAdminOpen(false)}
                      className="text-slate-400 hover:text-white text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>

                  {adminError && (
                    <div className="p-2.5 bg-rose-950/60 border border-rose-600/40 rounded-lg text-rose-300 text-xs font-medium">
                      {adminError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">EMAIL ADDRESS *</label>
                      <input
                        type="email"
                        required
                        placeholder="e.g. member@vitbhopal.ac.in"
                        value={newAdminEmail}
                        onChange={(e) => setNewAdminEmail(e.target.value)}
                        className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">FULL NAME</label>
                      <input
                        type="text"
                        placeholder="e.g. John Doe"
                        value={newAdminName}
                        onChange={(e) => setNewAdminName(e.target.value)}
                        className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">DESIGNATION / ROLE</label>
                      <select
                        value={newAdminRole}
                        onChange={(e) => setNewAdminRole(e.target.value as any)}
                        className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
                      >
                        <option value="Admin">Admin</option>
                        <option value="Payment Admin">Payment Admin</option>
                        <option value="Technical">Technical</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsAddAdminOpen(false)}
                      className="px-3 py-1.5 bg-[#262626] hover:bg-[#333333] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Close
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

              {/* Admins Table with mobile scroll */}
              <div className="border border-[#222222] rounded-xl overflow-hidden bg-[#111111] overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs min-w-[550px]">
                  <thead className="bg-[#181818] border-b border-[#222222] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-3.5">Admin Member</th>
                      <th className="p-3.5">Role</th>
                      <th className="p-3.5">Authority Tier</th>
                      <th className="p-3.5">Added By</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e1e1e]">
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
                          No admin records found in database.
                        </td>
                      </tr>
                    ) : (
                      filteredAdmins.map((adm) => {
                        const isCurrent = adm.email.toLowerCase() === currentUserEmail.toLowerCase();
                        return (
                          <tr key={adm.id} className="hover:bg-[#161616] transition-colors">
                            <td className="p-3.5">
                              <div className="font-bold text-white">{adm.name}</div>
                              <div className="text-[11px] text-slate-400 font-mono">{adm.email}</div>
                            </td>
                            <td className="p-3.5 text-slate-300">
                              {adm.isSuperAdmin ? (
                                <span className="font-bold text-purple-300">Super Admin</span>
                              ) : (
                                <select
                                  value={adm.role === 'Payment Admin' || adm.role === 'Technical' ? adm.role : 'Admin'}
                                  onChange={(e) => handleUpdateAdminRole(adm.email, e.target.value as any)}
                                  className="px-2 py-1 bg-[#1a1a1a] border border-[#333333] rounded text-[11px] font-semibold text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                                  title="Change role in Firebase"
                                >
                                  <option value="Admin">Admin</option>
                                  <option value="Payment Admin">Payment Admin</option>
                                  <option value="Technical">Technical</option>
                                </select>
                              )}
                            </td>
                            <td className="p-3.5">
                              {adm.isSuperAdmin ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-900/60 text-purple-300 border border-purple-600">
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
                                      id: adm.id,
                                      label: `${adm.name || 'Admin'} (${adm.email})`,
                                    })
                                  }
                                  className="px-2.5 py-1 bg-rose-950/50 hover:bg-rose-900 text-rose-300 text-[11px] font-bold rounded border border-rose-800/50 transition-colors cursor-pointer"
                                >
                                  Drop Admin
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
          )}

          {/* TAB 2: FACULTY DATABASE TABLE */}
          {activeTab === 'faculty' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-lg">search</span>
                  <input
                    type="text"
                    placeholder="Search faculty by name, department, or email..."
                    value={facultySearch}
                    onChange={(e) => setFacultySearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-[#161616] border border-[#2a2a2a] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                </div>
                <button
                  onClick={() => openFacultyForm()}
                  className="px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-[0_0_15px_rgba(147,51,234,0.3)] shrink-0"
                >
                  <span className="material-symbols-outlined text-base">person_add</span>
                  Add Faculty Member
                </button>
              </div>

              {/* Faculty Table */}
              <div className="border border-[#222222] rounded-xl overflow-hidden bg-[#111111] overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs min-w-[640px]">
                  <thead className="bg-[#181818] border-b border-[#222222] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-3.5">Faculty Name &amp; ID</th>
                      <th className="p-3.5">Email</th>
                      <th className="p-3.5">Department</th>
                      <th className="p-3.5">Designation</th>
                      <th className="p-3.5">Phone</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e1e1e]">
                    {loadingFaculty ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                            <span>Loading Firestore faculty records...</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredFaculty.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">
                          No faculty records found in database.
                        </td>
                      </tr>
                    ) : (
                      filteredFaculty.map((fac) => (
                        <tr key={fac.id || fac.email} className="hover:bg-[#161616] transition-colors">
                          <td className="p-3.5">
                            <div className="font-bold text-white">{fac.name}</div>
                            <div className="text-[11px] text-purple-300 font-mono font-semibold">
                              {fac.facultyId || 'FAC-ID'}
                            </div>
                          </td>
                          <td className="p-3.5 text-slate-300 font-mono text-[11px]">
                            {fac.email}
                          </td>
                          <td className="p-3.5 text-slate-300">
                            {fac.department || 'General Academic'}
                          </td>
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-900/60 text-purple-300 border border-purple-700">
                              {fac.designation || 'Faculty Mentor'}
                            </span>
                          </td>
                          <td className="p-3.5 text-slate-400 font-mono text-[11px]">
                            {fac.phone || '—'}
                          </td>
                          <td className="p-3.5 text-right space-x-2">
                            <button
                              onClick={() => openFacultyForm(fac)}
                              className="px-2.5 py-1 bg-[#262626] hover:bg-purple-700 text-white text-[11px] font-bold rounded transition-colors cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() =>
                                setDeleteConfirm({
                                  type: 'faculty',
                                  id: fac.email,
                                  label: `${fac.name} (${fac.email})`,
                                })
                              }
                              className="px-2.5 py-1 bg-rose-950/50 hover:bg-rose-900 text-rose-300 text-[11px] font-bold rounded border border-rose-800/50 transition-colors cursor-pointer"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#141414] border-t border-[#262626] flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>Only verified Super Admins can alter access credentials.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#262626] hover:bg-[#333333] text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* Faculty Add / Edit Modal */}
      {isFacultyModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-lg bg-[#141414] border border-purple-600 rounded-2xl p-6 space-y-4 text-left shadow-[0_0_40px_rgba(147,51,234,0.3)]">
            <div className="flex items-center justify-between pb-3 border-b border-[#262626]">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400">school</span>
                {editingFaculty ? 'Modify Faculty Record' : 'Register New Faculty Mentor'}
              </h3>
              <button
                onClick={() => setIsFacultyModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {facultyError && (
              <div className="p-2.5 bg-rose-950/60 border border-rose-600/40 rounded-lg text-rose-300 text-xs font-medium">
                {facultyError}
              </div>
            )}

            <form onSubmit={handleSaveFaculty} className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">FULL NAME *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Jane Smith"
                  value={facultyFormData.name}
                  onChange={(e) => setFacultyFormData({ ...facultyFormData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">EMAIL ADDRESS *</label>
                  <input
                    type="email"
                    required
                    disabled={!!editingFaculty}
                    placeholder="e.g. faculty@vitbhopal.ac.in"
                    value={facultyFormData.email}
                    onChange={(e) => setFacultyFormData({ ...facultyFormData, email: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">FACULTY ID</label>
                  <input
                    type="text"
                    placeholder="e.g. FAC-CSE-101"
                    value={facultyFormData.facultyId}
                    onChange={(e) => setFacultyFormData({ ...facultyFormData, facultyId: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">DEPARTMENT</label>
                  <input
                    type="text"
                    placeholder="e.g. Computer Science & Engg."
                    value={facultyFormData.department}
                    onChange={(e) => setFacultyFormData({ ...facultyFormData, department: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">DESIGNATION</label>
                  <input
                    type="text"
                    placeholder="e.g. Faculty Mentor & Advisory"
                    value={facultyFormData.designation}
                    onChange={(e) => setFacultyFormData({ ...facultyFormData, designation: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">PHONE NUMBER (OPTIONAL)</label>
                <input
                  type="tel"
                  placeholder="e.g. +91 9876543210"
                  value={facultyFormData.phone}
                  onChange={(e) => setFacultyFormData({ ...facultyFormData, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#333333] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#262626]">
                <button
                  type="button"
                  onClick={() => setIsFacultyModalOpen(false)}
                  className="px-4 py-2 bg-[#262626] hover:bg-[#333333] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingFaculty}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submittingFaculty && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editingFaculty ? 'Save Changes' : 'Create Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-3 sm:p-4 bg-black/90">
          <div className="w-full max-w-sm bg-[#161616] border border-rose-600/60 rounded-2xl p-5 sm:p-6 text-center space-y-4 shadow-[0_0_40px_rgba(225,29,72,0.3)] mx-2">
            <div className="w-12 h-12 rounded-full bg-rose-950 border border-rose-600 flex items-center justify-center mx-auto text-rose-400">
              <span className="material-symbols-outlined text-2xl">warning</span>
            </div>
            <div>
              <h4 className="text-sm font-black text-white">Confirm Removal</h4>
              <p className="text-xs text-slate-300 mt-1">
                Are you sure you want to remove <span className="text-rose-400 font-bold">{deleteConfirm.label}</span> from the Firebase {deleteConfirm.type} database?
              </p>
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 bg-[#262626] hover:bg-[#333333] text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deleteConfirm.type === 'admin') {
                    handleDropAdmin(deleteConfirm.id);
                  } else {
                    handleDeleteFaculty(deleteConfirm.id);
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminManagementModal;
