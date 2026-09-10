"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { User } from 'firebase/auth';
import SpecularButton from './SpecularButton';
import StaggeredMenu, { StaggeredMenuItem } from './StaggeredMenu';
import { cleanFullName } from '../lib/userUtils';
import { PermissionsConfig, resolveUserPagePermission, PageId } from '@/lib/permissions';

interface NavbarProps {
  pageTitle?: string;
  activePage?: string;
  userEmail?: string | null;
  user?: User | null;
  memberData?: { name?: string; fullName?: string; registrationNumber?: string; regNo?: string } | null;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  isFaculty?: boolean;
  userRole?: string | null;
  permissionsConfig?: PermissionsConfig;
  onLogout?: () => Promise<void> | void;
  onLogin?: () => Promise<void> | void;
  onOpenSuperAdminModal?: () => void;
  onPageChange?: (pageId: string) => void;
  onOpenMaintenanceModal?: () => void;
}

const Navbar: React.FC<NavbarProps> = ({
  pageTitle = 'Dashboard',
  activePage = 'dashboard',
  userEmail,
  user,
  memberData,
  isAdmin,
  isSuperAdmin,
  isFaculty,
  userRole,
  permissionsConfig,
  onLogout,
  onLogin,
  onOpenSuperAdminModal,
  onPageChange,
  onOpenMaintenanceModal,
}) => {
  const extractRegNo = (emailAddress?: string | null) => {
    if (!emailAddress) return null;
    const match = emailAddress.match(/\b\d{2}[a-zA-Z]{3}\d{5}\b/);
    return match ? match[0].toUpperCase() : null;
  };

  const regNo = memberData?.registrationNumber || memberData?.regNo || extractRegNo(userEmail);
  const rawName = user?.displayName || memberData?.name || memberData?.fullName || (userEmail ? userEmail.split('@')[0] : 'User');
  const cleanName = cleanFullName(rawName, regNo);
  const firstName = cleanName.trim().split(' ')[0];
  const photoUrl = user?.photoURL || null;

  const handleMobileNavClick = (pageId: string) => {
    if (onPageChange) {
      onPageChange(pageId);
    }
  };

  const baseMobileMenuItems: StaggeredMenuItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: 'dashboard',
      onClick: () => handleMobileNavClick('dashboard'),
    },
    {
      id: 'members',
      label: 'Members Roster',
      icon: 'groups',
      onClick: () => handleMobileNavClick('members'),
    },
    {
      id: 'planned_events',
      label: 'Planned Events',
      icon: 'event_upcoming',
      onClick: () => handleMobileNavClick('planned_events'),
    },
    {
      id: 'payments',
      label: 'Payments & Dues',
      icon: 'payments',
      onClick: () => handleMobileNavClick('payments'),
    },
    {
      id: 'idcard',
      label: 'ID Card Portal',
      icon: 'badge',
      onClick: () => handleMobileNavClick('idcard'),
    },
    {
      id: 'referrals',
      label: 'Referrals',
      icon: 'share',
      onClick: () => handleMobileNavClick('referrals'),
    },
    {
      id: 'contact',
      label: 'Contact Us & Support',
      icon: 'contact_support',
      onClick: () => {
        window.location.href = '/contact';
      },
    },
    {
      id: 'about',
      label: 'About Tech Team',
      icon: 'code',
      onClick: () => {
        window.location.href = '/about';
      },
    },
  ];

  const mobileMenuItems: StaggeredMenuItem[] = baseMobileMenuItems.filter((item) => {
    if (item.id === 'dashboard' || item.id === 'contact' || item.id === 'about') return true;
    if (isSuperAdmin) return true;
    if (!permissionsConfig) return true;

    const perm = resolveUserPagePermission(
      item.id as PageId,
      permissionsConfig,
      userRole,
      isSuperAdmin,
      isFaculty,
      !!userEmail
    );
    return perm.canView;
  });

  if (isSuperAdmin) {
    mobileMenuItems.push({
      id: 'superadmin',
      label: 'Super Admin Enclave',
      icon: 'admin_panel_settings',
      badge: 'SUPER',
      onClick: () => {
        if (onPageChange) onPageChange('superadmin');
        else onOpenSuperAdminModal?.();
      },
    });
  }

  const canAccessMaintenance = onOpenMaintenanceModal && (
    isSuperAdmin ||
    (permissionsConfig
      ? resolveUserPagePermission('maintenance', permissionsConfig, userRole, isSuperAdmin, isFaculty, !!userEmail).canView ||
        resolveUserPagePermission('maintenance', permissionsConfig, userRole, isSuperAdmin, isFaculty, !!userEmail).canEdit
      : isAdmin)
  );

  if (canAccessMaintenance) {
    mobileMenuItems.push({
      id: 'maintenance',
      label: 'Maintenance Desk',
      icon: 'construction',
      badge: 'ADMIN',
      onClick: () => onOpenMaintenanceModal(),
    });
  }

  const mobileExtraFooter = (
    <div className="space-y-3 pt-2">
      {userEmail && onLogout ? (
        <button
          onClick={onLogout}
          className="sm-signout-btn"
          type="button"
        >
          <span className="material-symbols-outlined text-sm">logout</span>
          <span>Sign Out</span>
        </button>
      ) : onLogin ? (
        <button
          onClick={onLogin}
          className="sm-signin-btn"
          type="button"
        >
          <span className="material-symbols-outlined text-sm">login</span>
          <span>Sign In with Google</span>
        </button>
      ) : null}
    </div>
  );

  const mobileUserProfile = userEmail ? {
    name: cleanName,
    email: userEmail,
    regNo: regNo,
    photoUrl: photoUrl,
  } : {
    name: 'Guest Explorer',
    email: 'Sign in to access personalized cards',
    regNo: null,
    photoUrl: null,
  };

  const clubSocialItems = [
    { label: 'Website', link: 'https://vrgc.live/' },
    { label: 'Instagram', link: 'https://www.instagram.com/vrgc.vitb' },
    { label: 'YouTube', link: 'https://www.youtube.com/@vrgcvitb' },
    { label: 'Discord', link: 'https://discord.gg/BjB2Xyr9tP' },
  ];

  return (
    <>
      <header className="bg-black/90 backdrop-blur-2xl flex justify-between items-center w-full max-w-full overflow-x-clip px-3 sm:px-4 md:px-6 lg:px-10 py-2 sm:py-3 md:py-3.5 sticky top-0 z-50 border-b border-[#a855f7]/20 shadow-[0_5px_30px_rgba(0,0,0,0.7)] select-none">
        {/* Background subtle scan line */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.002)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none opacity-45"></div>

        <div className="flex items-center gap-2 sm:gap-4 relative z-10 min-w-0 shrink-0">
          {/* Brand Group */}
          <Link href="/" className="flex items-center gap-1.5 sm:gap-2.5 group cursor-pointer shrink-0">
            <div className="relative">
              <span className="text-xs sm:text-base md:text-lg font-black tracking-wider sm:tracking-widest text-white group-hover:text-purple-300 transition-colors whitespace-nowrap">
                VRGC <span className="text-purple-400">|</span> Forms
              </span>
            </div>
          </Link>

          {/* Current Active Console Tab Badge - Hidden below xl to prevent tag crowding */}
          <div className="hidden xl:flex items-center gap-2 pl-4 border-l border-white/10 shrink-0">
            <span className="material-symbols-outlined text-[13px] text-[#a855f7] animate-pulse">terminal</span>
            <span className="font-code-sm text-[10px] text-white/50 tracking-wider">
              [ <span className="text-white font-bold uppercase">{pageTitle}</span> ]
            </span>
          </div>
        </div>

        {/* Right side: user info + status + auth buttons */}
        <div className="flex items-center gap-1 sm:gap-2 md:gap-2.5 relative z-10 shrink-0">
          
          {/* Super Admin Badge - Responsive on Mobile, Tablet & Desktop */}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => {
                if (onPageChange) onPageChange('superadmin');
                else onOpenSuperAdminModal?.();
              }}
              className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[8px] sm:text-[9.5px] font-black uppercase tracking-wider text-white bg-gradient-to-r from-purple-900/90 via-purple-800/80 to-fuchsia-900/90 border border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.35)] hover:border-purple-400 active:scale-95 transition-all cursor-pointer shrink-0"
              title="Open Super Admin Command Enclave"
            >
              <span className="material-symbols-outlined text-[11px] sm:text-[13px] text-purple-300">admin_panel_settings</span>
              <span className="hidden sm:inline">SUPER ADMIN</span>
              <span className="sm:hidden">SUPER</span>
            </button>
          )}

          {/* Admin / Custom Role Badge */}
          {!isSuperAdmin && (isAdmin || userRole) && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[8px] sm:text-[9px] font-bold border shrink-0 ${
              userRole === 'Technical'
                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-600/50'
                : userRole === 'Payment Admin'
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                : 'bg-purple-950/80 text-purple-300 border-purple-600/50'
            }`}>
              <span className="material-symbols-outlined text-[10px] sm:text-[11px]">
                {userRole === 'Technical'
                  ? 'terminal'
                  : userRole === 'Payment Admin'
                  ? 'account_balance_wallet'
                  : userRole && userRole !== 'Admin'
                  ? 'military_tech'
                  : 'shield'}
              </span>
              <span className="hidden sm:inline">{userRole ? userRole.toUpperCase() : 'ADMIN'}</span>
              <span className="sm:hidden">
                {userRole === 'Payment Admin'
                  ? 'PAY'
                  : userRole === 'Technical'
                  ? 'TECH'
                  : userRole && userRole.length > 7
                  ? userRole.slice(0, 6).toUpperCase()
                  : userRole
                  ? userRole.toUpperCase()
                  : 'ADMIN'}
              </span>
            </span>
          )}

          {/* Faculty Badge */}
          {isFaculty && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[8px] sm:text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shrink-0">
              <span className="material-symbols-outlined text-[10px] sm:text-[11px]">school</span>
              FACULTY
            </span>
          )}

          {/* User First Name & Google Photo Pill (desktop only on lg+) */}
          {userEmail && (
            <div className="hidden lg:flex items-center gap-2 bg-[#12081c]/80 rounded-full px-2.5 py-1 border border-purple-500/30 max-w-[180px] shrink-0">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={firstName || 'User Avatar'}
                  className="w-5 h-5 rounded-full object-cover border border-purple-400/40 shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="material-symbols-outlined text-[14px] text-purple-400 shrink-0">account_circle</span>
              )}
              <span className="text-xs text-white font-extrabold truncate">{firstName}</span>
            </div>
          )}


          {/* Sign In Button (when logged out) */}
          {onLogin && !userEmail && (
            <SpecularButton
              size="xs"
              radius={8}
              tint="#9333ea"
              tintOpacity={0.4}
              lineColor="#c084fc"
              baseColor="#581c87"
              intensity={1.2}
              onClick={onLogin}
              title="Sign In with Google"
              className="text-[9px] sm:text-[11px] px-2 sm:px-3 py-1 font-bold text-white shadow-[0_0_12px_rgba(147,51,234,0.4)] shrink-0"
            >
              <span className="material-symbols-outlined text-[12px]">login</span>
              <span>Sign In</span>
            </SpecularButton>
          )}

          {/* Mobile Menu Drawer via StaggeredMenu (Mobile View Only: < md) */}
          <div className="md:hidden shrink-0">
            <StaggeredMenu
              position="right"
              items={mobileMenuItems}
              socialItems={clubSocialItems}
              displaySocials={true}
              displayItemNumbering={true}
              colors={['#140727', '#2e0854', '#7c3aed']}
              accentColor="#a855f7"
              activeItem={activePage}
              userProfile={mobileUserProfile}
              extraFooter={mobileExtraFooter}
              menuButtonColor="#e9d5ff"
              openMenuButtonColor="#ffffff"
              changeMenuColorOnOpen={true}
              closeOnClickAway={true}
              isFixed={false}
            />
          </div>

          {/* Sign Out Button (desktop only md+) */}
          {onLogout && userEmail && (
            <div className="hidden md:flex items-center shrink-0">
              <SpecularButton
                size="xs"
                radius={8}
                tint="#e11d48"
                tintOpacity={0.15}
                lineColor="#fb7185"
                baseColor="#881337"
                intensity={1}
                onClick={onLogout}
                title="Sign Out"
                className="text-[10px] px-2.5 py-1 font-bold text-rose-300"
              >
                <span className="material-symbols-outlined text-[13px]">logout</span>
                <span>Sign Out</span>
              </SpecularButton>
            </div>
          )}
        </div>
      </header>
    </>
  );
};

export default Navbar;
