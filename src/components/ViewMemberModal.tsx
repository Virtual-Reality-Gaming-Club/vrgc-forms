"use client";

import React, { useEffect } from 'react';
import type { RosterMember } from './MembersRoster';

export interface ViewMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: RosterMember | null;
}

export const ViewMemberModal: React.FC<ViewMemberModalProps> = ({
  isOpen,
  onClose,
  member,
}) => {
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen && member) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen, member]);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen || !member) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, member, onClose]);

  // Return null if member is null or modal is closed
  if (!isOpen || !member) return null;

  // Avatar with dicebear fallback
  const dicebearFallback = `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(
    member.name || member.email || 'VRGC'
  )}`;
  const avatarSrc = member.avatarUrl || dicebearFallback;

  // Position badge styling (matching MembersRoster: purple/amber/indigo depending on role)
  const posLower = (member.position || '').toLowerCase();
  const isCoPres = Boolean(
    member.isCoPresident ||
      (posLower.includes('president') && !posLower.includes('vice'))
  );
  const isCoord = Boolean(
    member.isCoordinator ||
      posLower.includes('student coordinator') ||
      (posLower.includes('coordinator') && !posLower.includes('event'))
  );
  const isLd = Boolean(
    member.isLead || posLower.includes('lead') || posLower.includes('head')
  );

  const positionBadgeStyles = isCoPres
    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : isCoord
    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
    : isLd
    ? 'bg-purple-500/20 text-purple-200 border-purple-500/40'
    : 'bg-white/5 text-slate-300 border-white/10';

  // Info fields list
  const infoFields = [
    {
      key: 'regNo',
      icon: 'badge',
      label: 'Registration Number',
      value: member.registrationNumber || '—',
      isMono: true,
    },
    {
      key: 'email',
      icon: 'mail',
      label: 'Email',
      value: member.email || '—',
      isMono: true,
    },
    ...(member.phone && member.phone.trim()
      ? [
          {
            key: 'phone',
            icon: 'phone',
            label: 'Phone',
            value: member.phone.trim(),
            isMono: true,
          },
        ]
      : []),
    {
      key: 'team',
      icon: 'group',
      label: 'Team',
      value:
        member.team ||
        (member.teams && member.teams.length > 0
          ? member.teams.join(' • ')
          : '—'),
      isMono: false,
    },
    {
      key: 'position',
      icon: 'military_tech',
      label: 'Position',
      value: member.position || 'Member',
      isMono: false,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="relative bg-[#0e0518] border border-purple-500/30 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl shadow-purple-950/50 max-h-[92vh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <span className="material-symbols-outlined text-xl">close</span>
        </button>

        {/* Member Header: Avatar, Name & Position Badge */}
        <div className="flex flex-col items-center text-center">
          <img
            src={avatarSrc}
            alt={member.name}
            onError={(e) => {
              const target = e.currentTarget;
              if (target.src !== dicebearFallback) {
                target.src = dicebearFallback;
              }
            }}
            className="w-16 h-16 rounded-2xl object-cover border border-purple-400/30 bg-purple-950/80 shadow-md shrink-0"
          />

          <h3 className="text-xl font-extrabold text-white mt-3 tracking-tight break-words max-w-full">
            {member.name}
          </h3>

          <div className="mt-2">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${positionBadgeStyles}`}
            >
              {member.position || 'Member'}
            </span>
          </div>
        </div>

        {/* Info Fields List */}
        <div className="space-y-2.5 mt-6">
          {infoFields.map((field) => (
            <div
              key={field.key}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-[#120822]/70 border border-purple-500/15"
            >
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-purple-400 text-lg">
                  {field.icon}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-slate-400 text-[11px] uppercase tracking-wider font-semibold font-label-caps">
                  {field.label}
                </div>
                <div
                  className={`text-white text-sm truncate ${
                    field.isMono ? 'font-mono' : 'font-medium'
                  }`}
                  title={field.value}
                >
                  {field.value}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Status Badge at Bottom */}
        <div className="mt-6 pt-4 border-t border-purple-500/20 flex items-center justify-center">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Active Member
          </span>
        </div>
      </div>
    </div>
  );
};

export default ViewMemberModal;
