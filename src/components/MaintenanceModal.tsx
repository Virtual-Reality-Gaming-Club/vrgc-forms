"use client";

import React, { useState, useEffect } from 'react';

export interface MaintenanceCategory {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export const MAINTENANCE_CATEGORIES: MaintenanceCategory[] = [
  {
    id: 'idcard',
    label: 'ID Card Portal & Forms',
    description: 'Digital ID card generation, profile updates, and photo uploads',
    icon: 'badge',
  },
  {
    id: 'payments',
    label: 'Payments & Dues Portal',
    description: 'Dues collection, Razorpay checkout, and payment ledger',
    icon: 'payments',
  },
  {
    id: 'referrals',
    label: 'Referrals System',
    description: 'Referral tracking, leaderboard, and code generation',
    icon: 'share',
  },
  {
    id: 'register',
    label: 'Event Registration',
    description: 'Public and member event booking and ticket registrations',
    icon: 'how_to_reg',
  },
  {
    id: 'members',
    label: 'Members Roster',
    description: 'Chapter directory, domain subdivisions, and crew roster',
    icon: 'groups',
  },
  {
    id: 'planned_events',
    label: 'Planned Future Events',
    description: 'Faculty advisory review desk and event proposals',
    icon: 'event_upcoming',
  },
];

export interface MaintenanceConfigState {
  all: boolean;
  sections: Record<string, boolean>;
}

interface MaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConfig: {
    all?: boolean;
    enabled?: boolean;
    sections?: Record<string, boolean>;
  };
  onSave: (newConfig: MaintenanceConfigState) => Promise<void>;
  saving?: boolean;
}

const MaintenanceModal: React.FC<MaintenanceModalProps> = ({
  isOpen,
  onClose,
  currentConfig,
  onSave,
  saving = false,
}) => {
  const [allCategories, setAllCategories] = useState<boolean>(false);
  const [sections, setSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      const isAll = !!(currentConfig.all || currentConfig.enabled);
      setAllCategories(isAll);
      const initialSections: Record<string, boolean> = {};
      MAINTENANCE_CATEGORIES.forEach((cat) => {
        initialSections[cat.id] = isAll ? true : !!currentConfig.sections?.[cat.id];
      });
      setSections(initialSections);
    }
  }, [isOpen, currentConfig]);

  if (!isOpen) return null;

  const handleToggleSection = (sectionId: string) => {
    setSections((prev) => {
      const next = { ...prev, [sectionId]: !prev[sectionId] };
      // If any section is turned off, 'all' is no longer true
      const allSelected = MAINTENANCE_CATEGORIES.every((c) => next[c.id]);
      setAllCategories(allSelected);
      return next;
    });
  };

  const handleToggleAll = (checked: boolean) => {
    setAllCategories(checked);
    const updated: Record<string, boolean> = {};
    MAINTENANCE_CATEGORIES.forEach((cat) => {
      updated[cat.id] = checked;
    });
    setSections(updated);
  };

  const activeCount = Object.values(sections).filter(Boolean).length;

  const handleApply = async () => {
    await onSave({
      all: allCategories,
      sections,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-[#0e0518] border border-purple-500/40 rounded-3xl max-w-2xl w-full p-5 sm:p-7 space-y-5 shadow-[0_0_60px_rgba(168,85,247,0.25)] relative max-h-[92vh] flex flex-col text-left text-white">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4 shrink-0">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
              <span className="material-symbols-outlined text-[13px]">construction</span>
              ADMIN CONFIGURATION
            </div>
            <h3 className="text-xl font-extrabold text-white tracking-tight">
              Portal Maintenance Control Center
            </h3>
            <p className="text-xs text-slate-400">
              Configure which sections or forms should be temporarily locked for members during updates.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Master Toggle & Quick Action Bar */}
        <div className="space-y-3 shrink-0">
          {/* Master Switch Banner */}
          <div
            className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${
              allCategories
                ? 'bg-purple-950/60 border-purple-500/60 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                : 'bg-white/5 border-white/10'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  allCategories
                    ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                    : 'bg-white/10 text-slate-400'
                }`}
              >
                <span className="material-symbols-outlined text-xl">build_circle</span>
              </div>
              <div>
                <h4 className="text-sm font-black text-white">
                  Lock All Categories (Entire Portal)
                </h4>
                <p className="text-[11px] text-slate-400">
                  {allCategories
                    ? 'All portal features are currently marked for maintenance'
                    : 'Locks all sections simultaneously for members'}
                </p>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={allCategories}
                onChange={(e) => handleToggleAll(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
            </label>
          </div>

          {/* Quick Buttons & Status */}
          <div className="flex items-center justify-between gap-2 px-1 text-xs">
            <div className="text-slate-400">
              <strong className="text-purple-300">{activeCount}</strong> of{' '}
              <strong className="text-white">{MAINTENANCE_CATEGORIES.length}</strong> categories locked
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleToggleAll(true)}
                className="px-2.5 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 font-bold text-[11px] transition-all cursor-pointer"
              >
                Lock All
              </button>
              <button
                type="button"
                onClick={() => handleToggleAll(false)}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-bold text-[11px] transition-all cursor-pointer"
              >
                Unlock All (Normal)
              </button>
            </div>
          </div>
        </div>

        {/* Categories List (Scrollable) */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {MAINTENANCE_CATEGORIES.map((cat) => {
              const isLocked = !!sections[cat.id];

              return (
                <div
                  key={cat.id}
                  onClick={() => handleToggleSection(cat.id)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                    isLocked
                      ? 'bg-purple-950/40 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                      : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 hover:border-purple-500/30'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isLocked
                          ? 'bg-purple-600 text-white'
                          : 'bg-white/10 text-slate-400'
                      }`}
                    >
                      <span className="material-symbols-outlined text-lg">{cat.icon}</span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white truncate block">
                          {cat.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 truncate block">
                        {isLocked ? (
                          <span className="text-purple-300 font-semibold">🔒 Under Maintenance</span>
                        ) : (
                          <span className="text-emerald-400 font-semibold">✓ Active for Members</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Switch */}
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 pointer-events-none">
                    <input
                      type="checkbox"
                      checked={isLocked}
                      onChange={() => {}}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleApply}
            className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                <span>Applying...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">check_circle</span>
                <span>Save Maintenance Settings</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MaintenanceModal;
