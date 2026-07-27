'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { UnifiedMember } from '../types';
import Link from 'next/link';
import {
  Globe,
  ExternalLink,
  ShieldCheck,
  Calendar,
  Phone,
  Mail,
  Award,
  Hash,
  Sparkles,
  ChevronDown,
  ChevronUp,
  User,
  RotateCcw,
  Home,
} from 'lucide-react';

// Inline LinkedIn SVG (brand icons removed from lucide-react v1+)
function LinkedInIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

interface ProfileRevealProps {
  member: UnifiedMember | null;
  isVisible: boolean;
  isComplete: boolean;
  onReplay?: () => void;
}

// Only Website + LinkedIn
const PORTAL_LINKS: Array<{
  Icon: React.ElementType | ((props: { size?: number; color?: string }) => React.ReactElement);
  href: string;
  label: string;
  accent: string;
}> = [
    {
      Icon: Globe,
      href: 'https://vrgc.vercel.app',
      label: 'Website',
      accent: '#c084fc',
    },
    {
      Icon: LinkedInIcon,
      href: 'https://www.linkedin.com/company/vrgc-vitb',
      label: 'LinkedIn',
      accent: '#a855f7',
    },
  ];

function PortalButton({
  Icon,
  href,
  label,
  accent,
}: {
  Icon: React.ElementType | ((props: { size?: number; color?: string }) => React.ReactElement);
  href: string;
  label: string;
  accent: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="pointer-events-auto relative group flex items-center justify-center gap-2.5 overflow-hidden rounded-xl transition-transform active:scale-95"
      style={{
        minHeight: '48px',
        background: 'rgba(6, 2, 16, 0.92)',
        border: `1px solid ${accent}55`,
        textDecoration: 'none',
        padding: '10px 16px',
      }}
    >
      <Icon size={16} color={accent} style={{ flexShrink: 0 }} />
      <span className="font-mono uppercase text-[11px] sm:text-xs text-white/90 tracking-widest font-semibold">
        {label}
      </span>
      <ExternalLink
        size={10}
        className="opacity-40 group-hover:opacity-90 transition-opacity ml-auto shrink-0"
        style={{ color: accent }}
      />
    </a>
  );
}

export default function ProfileReveal({ member, isVisible, isComplete, onReplay }: ProfileRevealProps) {
  const [seqStep, setSeqStep] = useState<number>(0);
  const [showDossier, setShowDossier] = useState<boolean>(false);
  const [scrollProgress, setScrollProgress] = useState<number>(0);

  const dossierRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const autoOpenRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const targetProgressRef = useRef(0);
  const scrollProgressRef = useRef(0);
  const rafScrollRef = useRef<number | null>(null);

  const toggleDossier = useCallback((open?: boolean) => {
    if (autoOpenRef.current) {
      clearTimeout(autoOpenRef.current);
      autoOpenRef.current = null;
    }
    setShowDossier((prev) => {
      const next = open !== undefined ? open : !prev;
      targetProgressRef.current = next ? 1 : 0;
      return next;
    });
  }, []);

  useEffect(() => {
    const handleToggleCustom = () => toggleDossier();
    window.addEventListener('toggle-dossier', handleToggleCustom);
    return () => window.removeEventListener('toggle-dossier', handleToggleCustom);
  }, [toggleDossier]);

  // Butter-smooth Lerp momentum scrolling RAF loop
  useEffect(() => {
    const updateSmoothScroll = () => {
      const diff = targetProgressRef.current - scrollProgressRef.current;
      if (Math.abs(diff) > 0.0003) {
        scrollProgressRef.current += diff * 0.14;
        setScrollProgress(scrollProgressRef.current);
      } else if (scrollProgressRef.current !== targetProgressRef.current) {
        scrollProgressRef.current = targetProgressRef.current;
        setScrollProgress(targetProgressRef.current);
      }
      rafScrollRef.current = requestAnimationFrame(updateSmoothScroll);
    };

    rafScrollRef.current = requestAnimationFrame(updateSmoothScroll);

    return () => {
      if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setSeqStep(0);
      setShowDossier(false);
      targetProgressRef.current = 0;
      scrollProgressRef.current = 0;
      setScrollProgress(0);
      if (autoOpenRef.current) clearTimeout(autoOpenRef.current);
      return;
    }

    setSeqStep(0);

    const t1 = setTimeout(() => setSeqStep(1), 550);
    const t2 = setTimeout(() => {
      setSeqStep(2);
      // Auto-open dossier 600ms after intro animation completes
      autoOpenRef.current = setTimeout(() => toggleDossier(true), 600);
    }, 1100);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (autoOpenRef.current) clearTimeout(autoOpenRef.current);
    };
  }, [isVisible, toggleDossier]);

  // Lock mobile pull-to-refresh & page overscroll while dossier card active
  useEffect(() => {
    if (!isVisible) return;

    const originalOverscroll = document.body.style.overscrollBehaviorY;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overscrollBehaviorY = 'none';
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overscrollBehaviorY = originalOverscroll;
      document.body.style.overflow = originalOverflow;
    };
  }, [isVisible]);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (seqStep < 2) return;

    if (!targetProgressRef.current || targetProgressRef.current < 0.5) {
      if (e.deltaY > 5) toggleDossier(true);
    } else {
      const el = dossierRef.current;
      if (el && el.scrollTop <= 5 && e.deltaY < -15) toggleDossier(false);
    }
  }, [seqStep, toggleDossier]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (seqStep < 2) return;
    touchStartYRef.current = e.touches[0].clientY;
  }, [seqStep]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (seqStep < 2 || touchStartYRef.current === null) return;
    const touchEndY = e.changedTouches[0].clientY;
    const diff = touchStartYRef.current - touchEndY;
    touchStartYRef.current = null;

    if (targetProgressRef.current < 0.5) {
      if (diff > 15) toggleDossier(true);
    } else {
      const el = dossierRef.current;
      if (diff < -25 && (!el || el.scrollTop <= 5)) toggleDossier(false);
    }
  }, [seqStep, toggleDossier]);

  useEffect(() => {
    if (!isVisible) return;
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [isVisible, handleWheel]);

  if (!member) return null;

  const joinFormatted = member.joinDate
    ? new Date(member.joinDate)
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      .toUpperCase()
    : '2024 - 2025';

  const topCanvasTop = `${3.5 - scrollProgress * 2}vh`;
  const topCanvasScale = 1 - scrollProgress * 0.08;

  return (
    <div
      className="fixed inset-0 pointer-events-auto z-30 overflow-hidden flex flex-col items-center justify-center transition-opacity duration-300"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? 'auto' : 'none',
        willChange: 'opacity',
      }}
    >
      {/* ═══ TOP CANVAS: VERIFIED LABEL + NAME ONLY ═══ */}
      <motion.div
        initial={{ x: '-50%', scale: 0.15, opacity: 0 }}
        animate={{
          x: '-50%',
          scale: topCanvasScale,
          opacity: isVisible ? 1 : 0,
        }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="fixed left-1/2 flex flex-col items-center text-center w-[88%] max-w-[400px] px-5 py-3 rounded-2xl z-30 pointer-events-auto transition-all duration-500 ease-out"
        style={{
          top: topCanvasTop,
          background: '#070212',
          border: '1px solid rgba(147, 51, 234, 0.45)',
          boxShadow: '0 6px 20px rgba(0, 0, 0, 0.85)',
          willChange: 'transform, top',
        }}
      >
        {/* Top accent line */}
        <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-[#c084fc] to-transparent" />

        {/* Verified label */}
        <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-[#c084fc] flex items-center gap-1.5 mb-2">
          <Sparkles size={10} className="text-[#c084fc]" />
          // VERIFIED DOSSIER LOADED
        </span>

        {/* Member Name */}
        <h1 className="font-orbitron font-extrabold uppercase text-white tracking-wider text-lg sm:text-2xl md:text-3xl leading-tight break-words max-w-full">
          {member.name || 'VRGC MEMBER'}
        </h1>

        {/* Corner marks */}
        <div className="absolute top-2 left-2 w-2.5 h-2.5 border-t-2 border-l-2 border-[#c084fc]/60 pointer-events-none" />
        <div className="absolute top-2 right-2 w-2.5 h-2.5 border-t-2 border-r-2 border-[#c084fc]/60 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-2.5 h-2.5 border-b-2 border-l-2 border-[#c084fc]/60 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-2.5 h-2.5 border-b-2 border-r-2 border-[#c084fc]/60 pointer-events-none" />
      </motion.div>

      {/* ═══ BOTTOM DETAILS DOSSIER CANVAS ═══ */}
      <div
        ref={dossierRef}
        className="fixed left-1/2 w-[92%] max-w-[420px] p-4 sm:p-5 rounded-2xl flex flex-col gap-3 z-40 no-scrollbar pointer-events-auto"
        style={{
          top: '46dvh',
          maxHeight: '48dvh',
          overflowY: 'auto',
          touchAction: 'pan-y',
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'contain',
          background: '#060212',
          border: '1px solid rgba(147, 51, 234, 0.45)',
          boxShadow: '0 6px 20px rgba(0, 0, 0, 0.9)',
          transform: showDossier && seqStep === 2 ? 'translate(-50%, 0)' : 'translate(-50%, 120%)',
          opacity: showDossier && seqStep === 2 ? 1 : 0,
          transition: 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s linear',
          willChange: 'transform, opacity',
        }}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between pb-2 border-b border-[#a855f7]/30 shrink-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="text-[#c084fc]" size={15} />
            <span className="font-orbitron font-bold text-xs tracking-widest text-white uppercase">
              MEMBER DOSSIER
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="font-mono text-[9px] tracking-widest text-[#00ff88] uppercase font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
              VERIFIED
            </span>
            <span className="font-mono text-[9px] tracking-wider text-[#d8b4fe] uppercase mt-0.5">
              {joinFormatted}
            </span>
          </div>
        </div>

        {/* Details Grid — 2 columns, 2 rows */}
        <div className="grid grid-cols-2 gap-2 text-left shrink-0">
          {/* Top Row: Registration Number */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Hash size={9} /> REGISTRATION NUMBER
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5">
              {member.regNo}
            </p>
          </div>

          {/* Top Row: Contact */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Phone size={9} /> CONTACT
            </span>
            <p className="font-rajdhani font-semibold text-xs text-white mt-0.5">
              {member.phone || 'N/A'}
            </p>
          </div>

          {/* Second Row: Position */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <User size={9} /> POSITION
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase truncate">
              {member.position || member.role || 'CORE MEMBER'}
            </p>
          </div>

          {/* Second Row: Team */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Award size={9} /> TEAM
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase truncate">
              {member.assignedTeam || 'VRGC'}
            </p>
          </div>
        </div>

        {/* Third Row: Email Address — full width */}
        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07] text-left shrink-0">
          <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
            <Mail size={9} /> EMAIL ADDRESS
          </span>
          <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 truncate">
            {member.email || `${(member.name || 'member').split(' ')[0].toLowerCase()}@vrgc.club`}
          </p>
        </div>

        {/* Portal Links — two-card layout */}
        <div className="pt-2 border-t border-[#a855f7]/25 flex flex-col gap-2 shrink-0">
          <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] text-left font-semibold">
            // CONNECT &amp; PORTAL LINKS
          </span>
          <div className="grid grid-cols-2 gap-2">
            {PORTAL_LINKS.map((s) => (
              <PortalButton key={s.label} {...s} />
            ))}
          </div>
        </div>

        {/* Corner marks */}
        <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-[#c084fc]/60 pointer-events-none" />
        <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-[#c084fc]/60 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-[#c084fc]/60 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-[#c084fc]/60 pointer-events-none" />
      </div>

      {/* ═══ BOTTOM ACTION CONTROLS ═══ */}
      {seqStep === 2 && (
        <div className="fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center justify-center gap-2 sm:gap-3 max-w-[95vw]">
          {/* Replay Animation Button */}
          {onReplay && (
            <button
              type="button"
              onClick={onReplay}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-purple-500/60 bg-[#070214]/95 text-purple-300 hover:text-white hover:border-purple-400 hover:scale-105 active:scale-95 transition-transform font-mono text-[9px] sm:text-[10px] font-bold tracking-wider cursor-pointer"
            >
              <RotateCcw size={12} className="text-purple-400" />
              <span className="whitespace-nowrap">REPLAY</span>
            </button>
          )}

          {/* Main Portal Button */}
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-white/25 bg-black/90 text-slate-200 hover:text-white hover:border-white/50 hover:scale-105 active:scale-95 transition-transform font-mono text-[9px] sm:text-[10px] font-bold tracking-wider cursor-pointer"
          >
            <Home size={12} className="text-purple-400" />
            <span className="whitespace-nowrap">MAIN PORTAL</span>
          </Link>

          {/* Dossier Toggle Button */}
          <button
            type="button"
            onClick={() => toggleDossier()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-[#a855f7]/55 bg-[#04010a]/95 text-[#d8b4fe] transition-transform active:scale-95 cursor-pointer"
          >
            <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap">
              {scrollProgress < 0.5 ? 'DOSSIER' : 'CLOSE'}
            </span>
            {scrollProgress < 0.5 ? (
              <ChevronDown size={12} className="animate-bounce text-[#c084fc]" />
            ) : (
              <ChevronUp size={12} className="animate-bounce text-[#c084fc]" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
