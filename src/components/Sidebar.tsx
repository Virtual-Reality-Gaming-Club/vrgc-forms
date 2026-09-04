"use client";

import React from 'react';
import { PermissionsConfig, resolveUserPagePermission, PageId } from '@/lib/permissions';
import SpecularButton from './SpecularButton';

interface SidebarProps {
  activePage: string;
  onPageChange: (pageId: string) => void;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  isFaculty?: boolean;
  isAuthorized?: boolean;
  userRole?: string | null;
  permissionsConfig?: PermissionsConfig;
}

const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onPageChange,
  isAdmin = false,
  isSuperAdmin = false,
  isFaculty = false,
  isAuthorized = true,
  userRole,
  permissionsConfig,
}) => {
  // Base menu items
  const baseItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'members', label: 'Members Roster', icon: 'groups' },
    { id: 'planned_events', label: 'Planned Events', icon: 'event_upcoming' },
    { id: 'payments', label: isFaculty ? 'Payments View' : 'Payments & Dues', icon: 'payments' },
    { id: 'idcard', label: 'ID Card Portal', icon: 'badge' },
    { id: 'referrals', label: 'Referrals', icon: 'share' },
  ];

  // Filter based on permissions matrix
  const menuItems = baseItems.filter((item) => {
    if (item.id === 'dashboard') return true;
    if (isSuperAdmin) return true;
    if (!permissionsConfig) return true;

    const perm = resolveUserPagePermission(
      item.id as PageId,
      permissionsConfig,
      userRole,
      isSuperAdmin,
      isFaculty,
      isAuthorized
    );
    return perm.canView;
  });

  // If Super Admin, add dedicated Super Admin Enclave
  if (isSuperAdmin) {
    menuItems.push({
      id: 'superadmin',
      label: 'Super Admin',
      icon: 'admin_panel_settings',
    });
  }

  return (
    <aside className="h-[calc(100vh-76px)] w-64 hidden md:flex flex-col p-4 bg-[#090314]/90 backdrop-blur-2xl border-r border-purple-500/20 sticky top-[76px] select-none">
      <div className="flex flex-col gap-2.5 flex-grow">
        {/* Role indicator banner inside sidebar */}
        {isFaculty && (
          <div className="px-4 py-2 mb-1 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-sm">school</span>
            <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">
              Faculty Workspace
            </span>
          </div>
        )}

        {menuItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <SpecularButton
              key={item.id}
              size="sm"
              radius={12}
              tint={isActive ? '#9333ea' : '#120524'}
              tintOpacity={isActive ? 0.95 : 0.4}
              lineColor={isActive ? '#c084fc' : '#a855f7'}
              baseColor={isActive ? '#581c87' : '#2e1065'}
              intensity={isActive ? 1.3 : 0.8}
              followMouse
              autoAnimate={isActive}
              onClick={() => onPageChange(item.id)}
              className={`w-full justify-start text-left transition-all duration-200 ${
                isActive
                  ? 'text-white shadow-[0_0_20px_rgba(168,85,247,0.4)] font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3 w-full py-0.5">
                <span className={`material-symbols-outlined text-lg ${isActive ? 'text-white' : 'text-purple-400'}`}>
                  {item.icon}
                </span>
                <span className="text-xs font-bold tracking-wide">{item.label}</span>
              </div>
            </SpecularButton>
          );
        })}
      </div>
    </aside>
  );
};

export default Sidebar;
