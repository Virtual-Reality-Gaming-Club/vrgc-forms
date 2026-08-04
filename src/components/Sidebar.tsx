"use client";

import React from 'react';
import { isMemberAdminUser } from '@/lib/adminAuth';

interface SidebarProps {
  activePage: string;
  onPageChange: (pageId: string) => void;
  isAdmin?: boolean;
  userEmail?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ activePage, onPageChange, isAdmin, userEmail }) => {
  const isMemberAdmin = isMemberAdminUser(userEmail);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'referrals', label: 'Referrals', icon: 'share' },
    { id: 'idcard', label: 'ID Card Form', icon: 'badge' },
    { id: 'payments', label: 'Payments & Dues', icon: 'payments' },
    { id: 'tickets', label: 'Tickets', icon: 'confirmation_number' },
    ...(isMemberAdmin ? [{ id: 'admin-register', label: 'Admin Member Portal', icon: 'manage_accounts' }] : []),
  ];

  return (
    <aside className="h-[calc(100vh-76px)] w-64 hidden md:flex flex-col p-4 bg-surface-container-lowest border-r border-outline-variant sticky top-[76px]">
      <div className="flex flex-col gap-2 flex-grow">
        {menuItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`flex items-center gap-4 px-4 py-3 text-left transition-all duration-200 ${
                isActive
                  ? 'text-on-primary bg-primary rounded-xl shadow-[0_0_20px_rgba(168,85,247,0.3)] scale-98 font-bold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/10 hover:border-l-4 hover:border-primary border-l-4 border-transparent'
              }`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="font-body-md text-body-md">{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
};

export default Sidebar;

