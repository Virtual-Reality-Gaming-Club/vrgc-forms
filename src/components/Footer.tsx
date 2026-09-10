"use client";

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Code2, Sparkles, Mail, ShieldCheck } from 'lucide-react';
import { AboutModal } from './AboutModal';
import { useAuth } from '@/lib/auth-context';
import { fetchPermissionsConfig, resolveUserPagePermission, PermissionsConfig } from '@/lib/permissions';

const Footer: React.FC = () => {
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const [permissionsConfig, setPermissionsConfig] = useState<PermissionsConfig | null>(null);
  const {
    isSuperAdmin,
    isAdmin,
    isFaculty,
    isAuthorized,
    userRole,
    userEmail,
  } = useAuth();

  useEffect(() => {
    fetchPermissionsConfig().then(setPermissionsConfig).catch(() => {});
  }, []);

  const pathname = usePathname();

  const ticketPerm = permissionsConfig
    ? resolveUserPagePermission('tickets', permissionsConfig, userRole, isSuperAdmin, isFaculty, isAuthorized)
    : { canView: isSuperAdmin || isAdmin || userRole === 'Technical', canEdit: isSuperAdmin || isAdmin || userRole === 'Technical', bypassMaintenance: false };

  const canResolveTickets = isSuperAdmin || ticketPerm.canView || ticketPerm.canEdit;

  return (
    <footer className="w-full fixed bottom-0 left-0 right-0 z-40 md:sticky md:bottom-0 bg-[#070212]/95 backdrop-blur-xl border-t border-purple-500/25 text-[#cbd5e1] shadow-[0_-5px_25px_rgba(0,0,0,0.8)] pb-[env(safe-area-inset-bottom)] md:pb-0 transition-all duration-300 select-none">
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
      />

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex flex-row items-center justify-between gap-2 text-xs relative z-20">
        <div className="flex items-center gap-1.5 font-medium text-slate-300 text-[10px] sm:text-[11px] md:text-xs">
          <span className="p-0.5 -m-0.5 pointer-events-none select-none">
            <Code2 className="w-3.5 h-3.5 text-purple-400 shrink-0 block" />
          </span>
          <Link 
            href="/about"
            className="flex items-center gap-1 truncate hover:opacity-90 group transition-all text-left focus:outline-none"
            title="Click to view About VRGC Tech Team"
          >
            <span className="hidden sm:inline text-slate-400">Developed by</span>
            <span className="sm:hidden text-slate-400">By</span>
            <strong className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 font-extrabold flex items-center gap-1 underline underline-offset-2 decoration-purple-500/40 group-hover:decoration-pink-400 truncate">
              VRGC Tech Team <Sparkles className="w-3 h-3 text-pink-400 hidden sm:block group-hover:scale-125 transition-transform shrink-0" />
            </strong>
          </Link>
          <span className="text-slate-600 hidden md:inline">|</span>
          <span className="text-slate-400 text-[10px] sm:text-[11px] hidden md:inline">
            Copyright &copy; {new Date().getFullYear()} <strong className="text-purple-300">VRGC Club | VIT Bhopal</strong>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/contact"
            className={`px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold shrink-0 cursor-pointer ${
              pathname === '/contact'
                ? 'bg-purple-600/30 text-white border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.35)]'
                : 'bg-purple-950/60 hover:bg-purple-900/80 text-purple-200 hover:text-white border-purple-500/40 hover:border-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
            }`}
            title="Open Contact Us Page"
          >
            <Mail className="w-3.5 h-3.5 text-purple-400" />
            <span>Contact Us</span>
          </Link>

          {canResolveTickets && (
            <Link
              href="/contact?tab=resolve"
              className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-amber-950/60 hover:bg-amber-900/80 text-amber-200 border border-amber-500/50 hover:border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold shrink-0 cursor-pointer"
              title="Open Support Ticket Resolution Enclave"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span className="hidden sm:inline">Resolve Tickets</span>
              <span className="sm:hidden">Resolve</span>
            </Link>
          )}
        </div>

      </div>
    </footer>
  );
};

export default Footer;
