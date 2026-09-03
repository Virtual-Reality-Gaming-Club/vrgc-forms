"use client";

import React, { useState, useMemo } from 'react';
import type { RosterMember } from './MembersRoster';
import type { MemberFormData } from '@/lib/members';
import { createMember, updateMember, deleteMember } from '@/lib/members';
import type { MemberLogChanges } from '@/lib/adminLogs';

// Lazy-loaded modals to avoid circular imports
import MemberFormModal from './MemberFormModal';
import DeleteMemberModal from './DeleteMemberModal';
import ViewMemberModal from './ViewMemberModal';
import MemberAdminLogs from './MemberAdminLogs';

interface AdminDeskProps {
  members: RosterMember[];
  onMembersChanged: () => void;
  adminName: string;
  adminEmail: string;
}

const AdminDesk: React.FC<AdminDeskProps> = ({
  members,
  onMembersChanged,
  adminName,
  adminEmail,
}) => {
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<RosterMember | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Feedback
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Search/filter within admin desk
  const [adminSearch, setAdminSearch] = useState('');

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Filtered members for admin view
  const adminFilteredMembers = useMemo(() => {
    const q = adminSearch.toLowerCase().trim();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.registrationNumber.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.team.toLowerCase().includes(q)
    );
  }, [members, adminSearch]);

  // Dynamically extract unique teams from active roster data, with fallback to standard club teams
  const availableTeams = useMemo(() => {
    const teamsSet = new Set<string>();
    members.forEach((m) => {
      if (m.teams && m.teams.length > 0) {
        m.teams.forEach((t) => teamsSet.add(t));
      } else if (m.team) {
        teamsSet.add(m.team);
      }
    });
    // Ensure standard core domains are present as baseline
    [
      "Design Team",
      "Education",
      "Esports Mobile",
      "Esports PC",
      "Leadership",
      "PR",
      "Social Media",
      "Technical Team"
    ].forEach((t) => teamsSet.add(t));
    return Array.from(teamsSet).filter(Boolean).sort();
  }, [members]);

  // Dynamically extract unique positions from active roster data, with fallback to standard club roles
  const availablePositions = useMemo(() => {
    const posSet = new Set<string>();
    members.forEach((m) => {
      if (m.position) posSet.add(m.position);
    });
    [
      "Member",
      "Lead",
      "Head",
      "Co-President",
      "Student Coordinator"
    ].forEach((p) => posSet.add(p));
    return Array.from(posSet).filter(Boolean);
  }, [members]);

  // ─── Handlers ──────────────────────────────────────────────────────────

  const handleAddMember = async (data: MemberFormData) => {
    setIsLoading(true);
    try {
      const result = await createMember(data);
      if (result.success) {
        showFeedback('success', `Member ${data.name} added successfully!`);
        setShowAddModal(false);
        onMembersChanged();
      } else {
        showFeedback('error', result.error || 'Failed to add member');
      }
    } catch (err: any) {
      showFeedback('error', err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditMember = async (data: MemberFormData) => {
    if (!selectedMember) return;
    setIsLoading(true);
    try {
      // Compute changes for audit log
      const changes: MemberLogChanges = {};
      const fields: (keyof MemberFormData)[] = ['name', 'registrationNumber', 'email', 'phone', 'team', 'position'];
      for (const field of fields) {
        const oldVal = (selectedMember as any)[field] || '';
        const newVal = data[field] || '';
        if (oldVal !== newVal) {
          changes[field] = { from: String(oldVal), to: String(newVal) };
        }
      }

      const result = await updateMember(selectedMember.id, data, changes);
      if (result.success) {
        showFeedback('success', `Member ${data.name} updated successfully!`);
        setShowEditModal(false);
        setSelectedMember(null);
        onMembersChanged();
      } else {
        showFeedback('error', result.error || 'Failed to update member');
      }
    } catch (err: any) {
      showFeedback('error', err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteMember = async () => {
    if (!selectedMember) return;
    setIsLoading(true);
    try {
      const result = await deleteMember(selectedMember.id);
      if (result.success) {
        showFeedback('success', `Member ${selectedMember.name} deleted successfully`);
        setShowDeleteModal(false);
        setSelectedMember(null);
        onMembersChanged();
      } else {
        showFeedback('error', result.error || 'Failed to delete member');
      }
    } catch (err: any) {
      showFeedback('error', err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const openEdit = (member: RosterMember) => {
    setSelectedMember(member);
    setShowEditModal(true);
  };

  const openDelete = (member: RosterMember) => {
    setSelectedMember(member);
    setShowDeleteModal(true);
  };

  const openView = (member: RosterMember) => {
    setSelectedMember(member);
    setShowViewModal(true);
  };

  // Convert RosterMember to MemberFormData for the edit modal
  const memberToFormData = (m: RosterMember | null): MemberFormData | null => {
    if (!m) return null;
    return {
      name: m.name,
      registrationNumber: m.registrationNumber,
      email: m.email,
      phone: m.phone || '',
      team: m.team,
      position: m.position,
      photoUrl: m.avatarUrl || '',
    };
  };

  return (
    <section className="space-y-5">
      {/* Admin Desk Header */}
      <div className="relative bg-[#120822]/90 border border-rose-500/30 rounded-2xl p-5 overflow-hidden">
        {/* Red accent line at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-rose-500 via-red-500 to-rose-500 opacity-70" />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 sm:gap-4">
          <div className="flex items-center gap-3 min-w-0 max-w-full">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-rose-400 text-xl">admin_panel_settings</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold text-white uppercase tracking-widest flex items-center gap-2">
                <span>Admin Desk</span>
              </h2>
              <p className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[220px] sm:max-w-none">
                Member Management • <span className="text-rose-400 font-mono">{adminEmail}</span>
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2.5 sm:py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-[0_0_15px_rgba(168,85,247,0.3)] active:scale-[0.98] cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">person_add</span>
              Add Member
            </button>
            <button
              onClick={() => setShowLogsModal(true)}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2.5 sm:py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">history</span>
              Activity Logs
            </button>
          </div>
        </div>
      </div>

      {/* Feedback Toast */}
      {feedback && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-bold border ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <span className="material-symbols-outlined text-sm">
            {feedback.type === 'success' ? 'check_circle' : 'error'}
          </span>
          {feedback.message}
        </div>
      )}

      {/* Admin Search */}
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
          search
        </span>
        <input
          type="text"
          value={adminSearch}
          onChange={(e) => setAdminSearch(e.target.value)}
          placeholder="Search members by name, reg number, email, or team..."
          className="w-full bg-black/40 border border-purple-500/30 rounded-xl pl-10 pr-4 py-2.5 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-400 transition-all"
        />
      </div>

      {/* Member Count */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span>
          Managing <strong className="text-white">{adminFilteredMembers.length}</strong> of{' '}
          <strong className="text-purple-300">{members.length}</strong> members
        </span>
        {adminSearch && (
          <button
            onClick={() => setAdminSearch('')}
            className="text-purple-400 hover:text-purple-300 text-[11px] font-semibold cursor-pointer"
          >
            Clear Search
          </button>
        )}
      </div>

      {/* Members Management Grid (Cards on mobile, compact cards on desktop) */}
      {adminFilteredMembers.length === 0 ? (
        <div className="bg-[#12081f]/60 border border-purple-500/20 rounded-2xl p-12 text-center space-y-3">
          <span className="material-symbols-outlined text-4xl text-slate-500">person_search</span>
          <h3 className="text-sm font-bold text-white">No members found</h3>
          <p className="text-xs text-slate-400">
            {adminSearch ? 'Try a different search term.' : 'Add your first member using the button above.'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table View (hidden on mobile) */}
          <div className="hidden md:block bg-[#12081f]/90 border border-purple-500/20 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-black/50 text-purple-300 font-bold border-b border-purple-500/20">
                  <tr>
                    <th className="py-3.5 px-4">Member</th>
                    <th className="py-3.5 px-4">Reg No.</th>
                    <th className="py-3.5 px-4">Team</th>
                    <th className="py-3.5 px-4">Role</th>
                    <th className="py-3.5 px-4">Email</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {adminFilteredMembers.map((m) => (
                    <tr key={m.id || m.email} className="hover:bg-purple-900/10 transition-colors">
                      <td className="py-3 px-4 flex items-center gap-2.5 font-bold text-white">
                        <img
                          src={m.avatarUrl}
                          alt={m.name}
                          className="w-7 h-7 rounded-lg object-cover bg-purple-950 border border-white/10"
                        />
                        <span className="truncate max-w-[160px]">{m.name}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-purple-200">{m.registrationNumber || '—'}</td>
                      <td className="py-3 px-4 truncate max-w-[120px]">{m.team}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                            m.isCoPresident
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : m.isCoordinator
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : m.isLead
                              ? 'bg-purple-500/20 text-purple-200 border border-purple-500/30'
                              : 'bg-white/5 text-slate-300'
                          }`}
                        >
                          {m.position}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400 truncate max-w-[160px]">{m.email}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => openView(m)}
                            title="View Member"
                            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-sm">visibility</span>
                          </button>
                          <button
                            onClick={() => openEdit(m)}
                            title="Edit Member"
                            className="p-1.5 rounded-lg hover:bg-amber-500/15 text-slate-400 hover:text-amber-300 transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-sm">edit</span>
                          </button>
                          <button
                            onClick={() => openDelete(m)}
                            title="Delete Member"
                            className="p-1.5 rounded-lg hover:bg-rose-500/15 text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View (hidden on desktop) */}
          <div className="md:hidden space-y-3">
            {adminFilteredMembers.map((m) => (
              <div
                key={m.id || m.email}
                className="bg-[#130822]/90 border border-white/10 rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={m.avatarUrl}
                    alt={m.name}
                    className="w-10 h-10 rounded-xl object-cover border border-purple-400/30 bg-purple-950"
                  />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-extrabold text-white truncate">{m.name}</h4>
                    <p className="text-[11px] text-purple-300/80 font-mono">{m.registrationNumber || '—'}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[9px] font-bold shrink-0 ${
                      m.isCoPresident
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : m.isCoordinator
                        ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                        : m.isLead
                        ? 'bg-purple-500/20 text-purple-200 border border-purple-500/30'
                        : 'bg-white/5 text-slate-300'
                    }`}
                  >
                    {m.position}
                  </span>
                </div>

                <div className="space-y-1 text-[11px] text-slate-400 font-mono">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-slate-500">TEAM:</span>
                    <span className="text-slate-300 truncate">{m.team}</span>
                  </div>
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-slate-500">MAIL:</span>
                    <span className="text-slate-300 truncate">{m.email}</span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                  <button
                    onClick={() => openView(m)}
                    className="flex-1 min-h-[38px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">visibility</span>
                    View
                  </button>
                  <button
                    onClick={() => openEdit(m)}
                    className="flex-1 min-h-[38px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-300 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">edit</span>
                    Edit
                  </button>
                  <button
                    onClick={() => openDelete(m)}
                    className="flex-1 min-h-[38px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 text-xs font-bold transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ─── Modals ─────────────────────────────────────────────────────── */}

      {/* Add Member Modal */}
      <MemberFormModal
        isOpen={showAddModal}
        onClose={() => {
          if (!isLoading) setShowAddModal(false);
        }}
        onSubmit={handleAddMember}
        isLoading={isLoading}
        availableTeams={availableTeams}
        availablePositions={availablePositions}
      />

      {/* Edit Member Modal */}
      <MemberFormModal
        isOpen={showEditModal}
        onClose={() => {
          if (!isLoading) {
            setShowEditModal(false);
            setSelectedMember(null);
          }
        }}
        onSubmit={handleEditMember}
        initialData={memberToFormData(selectedMember)}
        isLoading={isLoading}
        availableTeams={availableTeams}
        availablePositions={availablePositions}
      />

      {/* Delete Member Modal */}
      <DeleteMemberModal
        isOpen={showDeleteModal}
        onClose={() => {
          if (!isLoading) {
            setShowDeleteModal(false);
            setSelectedMember(null);
          }
        }}
        onConfirm={handleDeleteMember}
        memberName={selectedMember?.name || ''}
        memberRegNo={selectedMember?.registrationNumber || ''}
        isLoading={isLoading}
      />

      {/* View Member Modal */}
      <ViewMemberModal
        isOpen={showViewModal}
        onClose={() => {
          setShowViewModal(false);
          setSelectedMember(null);
        }}
        member={selectedMember}
      />

      {/* Admin Logs Modal */}
      <MemberAdminLogs
        isOpen={showLogsModal}
        onClose={() => setShowLogsModal(false)}
      />
    </section>
  );
};

export default AdminDesk;
