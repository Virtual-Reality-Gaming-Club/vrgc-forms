'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Member } from './members';
import {
  ExternalLink,
  ShieldCheck,
  Calendar,
  Phone,
  Mail,
  Award,
  Star,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';

const GlobeIcon = ({ size, style }: { size: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const YoutubeIcon = ({ size, style }: { size: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

const InstagramIcon = ({ size, style }: { size: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

const LinkedinIcon = ({ size, style }: { size: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
  </svg>
);

interface ProfileRevealProps {
  member: Member | null;
  isVisible: boolean;
  isComplete: boolean;
}

const SOCIALS = [
  { Icon: GlobeIcon, href: 'https://vrgc.vercel.app/', label: 'Website', accent: '#c084fc' },
  { Icon: LinkedinIcon, href: 'https://www.linkedin.com/company/vrgc-vitb', label: 'LinkedIn', accent: '#a855f7' },
];

function SocialButton({
  Icon,
  href,
  label,
  accent,
}: {
  Icon: React.ElementType;
  href: string;
  label: string;
  accent: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="pointer-events-auto relative group flex items-center gap-2 overflow-hidden px-2.5 py-1.5 rounded-lg transition-transform active:scale-95"
      style={{
        background: 'rgba(6, 2, 16, 0.9)',
        border: '1px solid rgba(147, 51, 234, 0.4)',
        textDecoration: 'none',
      }}
    >
      <Icon size={13} style={{ color: accent, flexShrink: 0 }} />
      <span className="font-mono uppercase text-[10px] text-white/90 tracking-wider whitespace-nowrap">
        {label}
      </span>
      <ExternalLink size={9} className="opacity-50 group-hover:opacity-100 transition-opacity ml-auto" style={{ color: accent }} />
    </a>
  );
}

export default function ProfileReveal({ member, isVisible, isComplete }: ProfileRevealProps) {
  const prefersReduced = useReducedMotion();
  const [seqStep, setSeqStep] = useState<number>(0);
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [isDossierOpen, setIsDossierOpen] = useState<boolean>(false);
  const touchStartRef = useRef<number | null>(null);
  // rAF throttle flag: only one scrollProgress update per animation frame
  const rafPendingRef = useRef(false);

  useEffect(() => {
    const handleToggleDossier = () => {
      setIsDossierOpen((prev) => !prev);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('toggle-dossier', handleToggleDossier);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('toggle-dossier', handleToggleDossier);
      }
    };
  }, []);

  useEffect(() => {
    if (!isVisible) {
      const resetTimer = setTimeout(() => {
        setSeqStep(0);
        setIsDossierOpen(false);
      }, 0);
      return () => clearTimeout(resetTimer);
    }
    const t1 = setTimeout(() => setSeqStep(1), 100);
    const t2 = setTimeout(() => setSeqStep(2), 900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isVisible]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!isVisible) return;
      const delta = e.deltaY * 0.0018;
      if (!rafPendingRef.current) {
        rafPendingRef.current = true;
        requestAnimationFrame(() => {
          setScrollProgress((prev) => Math.min(1, Math.max(0, prev + delta)));
          rafPendingRef.current = false;
        });
      }
    },
    [isVisible]
  );

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!isVisible) return;
      touchStartRef.current = e.touches[0].clientY;
    },
    [isVisible]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isVisible || touchStartRef.current === null) return;
      const currentY = e.touches[0].clientY;
      const diffY = touchStartRef.current - currentY;
      const delta = diffY * 0.0035;
      touchStartRef.current = currentY;
      if (!rafPendingRef.current) {
        rafPendingRef.current = true;
        requestAnimationFrame(() => {
          setScrollProgress((prev) => Math.min(1, Math.max(0, prev + delta)));
          rafPendingRef.current = false;
        });
      }
    },
    [isVisible]
  );

  const handleTouchEnd = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isVisible, handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd]);

  if (!isVisible || !member) return null;

  const joinFormatted = member.joinDate ? member.joinDate : '2025';
  const emailAddress = member.email || `${member.name.toLowerCase().replace(/\s+/g, '.')}.${member.regNo.toLowerCase()}@vitbhopal.ac.in`;

  const showDossier = isDossierOpen || scrollProgress > 0.05;
  const effectiveProgress = isDossierOpen ? 1 : scrollProgress;

  // Dynamic cyan-blue theme when dossier is open or scrolled
  const isBlueTheme = showDossier || scrollProgress > 0.1;
  const accentColor = isBlueTheme ? '#38bdf8' : '#c084fc';
  const cardBg = isBlueTheme ? 'rgba(4, 16, 38, 0.96)' : 'rgba(8, 3, 20, 0.94)';
  const cardBorder = isBlueTheme ? '1px solid rgba(56, 189, 248, 0.65)' : '1px solid rgba(168, 85, 247, 0.5)';
  const cardShadow = isBlueTheme
    ? '0 0 60px rgba(56, 189, 248, 0.5), inset 0 0 30px rgba(56, 189, 248, 0.2)'
    : '0 0 50px rgba(168, 85, 247, 0.4), inset 0 0 25px rgba(192, 132, 252, 0.15)';

  const titleScale = seqStep === 0 ? 0.75 : 1;
  const titleOpacity = 1;
  const topHeaderY = seqStep === 0 ? 'calc(50vh - 160px)' : 'clamp(24px, 4vh, 45px)';
  const dossierPointerEvents = showDossier ? 'auto' : 'none';

  return (
    <div className="fixed inset-0 pointer-events-none z-30 flex flex-col items-center justify-between overflow-hidden">
      {/* Dynamic Background Glow */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isBlueTheme
            ? 'radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.25) 0%, rgba(14, 165, 233, 0.15) 45%, rgba(2, 6, 23, 0.95) 85%)'
            : 'radial-gradient(circle at 50% 50%, rgba(168, 85, 247, 0.25) 0%, rgba(124, 58, 237, 0.15) 45%, rgba(6, 2, 16, 0.95) 85%)',
          transition: 'background 0.5s ease-in-out',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: scrollProgress > 0.1 ? 0.95 : 0.6 }}
        transition={{ duration: 0.5 }}
      />

      {/* TOP HEADER CANVAS: Name & Position */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center text-center px-4 w-full max-w-lg z-40 pointer-events-none"
        style={{ top: topHeaderY }}
        initial={{ scale: 0.75, opacity: 0 }}
        animate={{ scale: titleScale, opacity: titleOpacity }}
        transition={
          prefersReduced
            ? { duration: 0.01 }
            : { type: 'spring', stiffness: 220, damping: 22 }
        }
      >
        <motion.div
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-2"
          style={{
            background: isBlueTheme ? 'rgba(56, 189, 248, 0.2)' : 'rgba(147, 51, 234, 0.2)',
            border: isBlueTheme ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid rgba(192, 132, 252, 0.45)',
            boxShadow: isBlueTheme ? '0 0 15px rgba(56, 189, 248, 0.4)' : '0 0 15px rgba(168, 85, 247, 0.3)',
            transition: 'all 0.5s ease-in-out',
          }}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <ShieldCheck size={12} style={{ color: accentColor }} className="animate-pulse" />
          <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-white font-semibold">
            {member.role}
          </span>
        </motion.div>

        {/* text-shadow replaces drop-shadow filter — cheaper on mobile GPU */}
        <h1
          className="font-display-lg font-black text-2xl sm:text-4xl md:text-5xl uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-white via-[#7dd3fc] to-[#38bdf8]"
          style={{
            lineHeight: 1.1,
            textShadow: isBlueTheme ? '0 0 25px rgba(56,189,248,0.85)' : '0 0 25px rgba(168,85,247,0.85)',
            transition: 'text-shadow 0.5s ease-in-out',
          }}
        >
          {member.name}
        </h1>

        <div className="flex items-center gap-2 mt-1.5">
          <span className="font-mono text-[10px] sm:text-xs uppercase tracking-widest font-semibold" style={{ color: accentColor }}>
            {member.assignedTeam}
          </span>
          <span className="text-white/30">•</span>
          <span className="font-mono text-[10px] sm:text-xs text-white/70 tracking-wider">
            {member.regNo}
          </span>
        </div>
      </motion.div>

      {/* FULL DETAILS OVERLAY CANVAS (Dossier specifications card turns blue on scroll) */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 w-[92%] sm:w-[85%] max-w-md p-5 rounded-3xl flex flex-col gap-3.5 z-40 text-center"
        style={{
          bottom: showDossier ? 'clamp(64px, 10vh, 85px)' : 'clamp(24px, 5vh, 45px)',
          background: cardBg,
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: cardBorder,
          boxShadow: cardShadow,
          pointerEvents: dossierPointerEvents,
          transition: 'bottom 0.4s ease-out, background 0.5s ease-in-out, border 0.5s ease-in-out, box-shadow 0.5s ease-in-out',
        }}
        initial={{ opacity: 0, y: 140, scale: 0.85 }}
        animate={{
          opacity: showDossier ? Math.max(0.9, effectiveProgress) : 0,
          y: showDossier ? (1 - effectiveProgress) * 140 : 140,
          scale: showDossier ? 0.85 + effectiveProgress * 0.15 : 0.85,
        }}
        transition={
          prefersReduced
            ? { duration: 0.01 }
            : { type: 'spring', stiffness: 200, damping: 25 }
        }
      >
        <div className="absolute top-0 left-1/4 right-1/4 h-[2px]" style={{ background: `linear-gradient(to right, transparent, ${accentColor}, transparent)` }} />

        <div className="flex items-center justify-between border-b pb-2.5 text-left shrink-0" style={{ borderColor: isBlueTheme ? 'rgba(56, 189, 248, 0.3)' : 'rgba(168, 85, 247, 0.3)' }}>
          <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest font-bold" style={{ color: accentColor }}>
            {'// OFFICIAL DOSSIER SPECIFICATIONS'}
          </span>
          <span className="font-mono text-[9px] text-emerald-400 flex items-center gap-1 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> VERIFIED
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 text-left text-xs">
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider flex items-center gap-1" style={{ color: accentColor }}>
              <Award size={10} /> ROLE
            </span>
            <p className="font-label-caps font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase">
              {member.specialization}
            </p>
          </div>

          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider flex items-center gap-1" style={{ color: accentColor }}>
              <Calendar size={10} /> VERIFIED
            </span>
            <p className="font-label-caps font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase">
              {joinFormatted}
            </p>
          </div>

          {member.rating !== undefined && (
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] transition-colors">
              <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider flex items-center gap-1" style={{ color: accentColor }}>
                <Star size={10} /> RATING
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="flex text-amber-400 text-xs">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <span key={s} style={{ opacity: s <= Math.round(member.rating!) ? 1 : 0.2 }}>
                      ★
                    </span>
                  ))}
                </div>
                <span className="font-code-sm font-bold text-xs" style={{ color: accentColor }}>
                  {member.rating.toFixed(1)}
                </span>
              </div>
            </div>
          )}

          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider flex items-center gap-1" style={{ color: accentColor }}>
              <Phone size={10} /> CONTACT
            </span>
            <p className="font-label-caps font-semibold text-xs text-white mt-0.5">
              {member.phone}
            </p>
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-left shrink-0">
          <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider flex items-center gap-1" style={{ color: accentColor }}>
            <Mail size={10} /> EMAIL ADDRESS
          </span>
          <p className="font-label-caps font-semibold text-xs sm:text-sm text-white mt-0.5 break-all">
            {emailAddress}
          </p>
        </div>

        <div className="pt-2 border-t flex flex-col gap-1.5 shrink-0" style={{ borderColor: isBlueTheme ? 'rgba(56, 189, 248, 0.3)' : 'rgba(168, 85, 247, 0.3)' }}>
          <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-left opacity-80" style={{ color: accentColor }}>
            {'// CONNECT & PORTAL LINKS'}
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {SOCIALS.map((s) => (
              <SocialButton key={s.label} {...s} accent={accentColor} />
            ))}
          </div>
        </div>

        <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 pointer-events-none" style={{ borderColor: accentColor }} />
        <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 pointer-events-none" style={{ borderColor: accentColor }} />
        <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 pointer-events-none" style={{ borderColor: accentColor }} />
        <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 pointer-events-none" style={{ borderColor: accentColor }} />
      </motion.div>

      {/* BOTTOM ACTION BAR: REPLAY ANIMATION & VRGC PORTAL */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-full border bg-[#04010a]/95 backdrop-blur-md text-white shadow-xl">
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('replay-animation'));
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.08] hover:bg-white/[0.16] text-[10px] font-mono uppercase tracking-wider font-semibold transition-all active:scale-95 cursor-pointer border border-white/20"
          style={{ borderColor: accentColor }}
        >
          <RotateCcw size={11} style={{ color: accentColor }} />
          <span>REPLAY</span>
        </button>

        <button
          type="button"
          onClick={() => setScrollProgress((prev) => (prev > 0.5 ? 0 : 1))}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest font-semibold transition-transform active:scale-95 cursor-pointer"
          style={{ color: accentColor }}
        >
          <span>{showDossier ? 'CLOSE DOSSIER' : 'DOSSIER INFO'}</span>
          {showDossier ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        <a
          href="https://vrgc.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#38bdf8]/20 hover:bg-[#38bdf8]/30 text-[10px] font-mono uppercase tracking-wider font-semibold transition-all active:scale-95 cursor-pointer border border-[#38bdf8]/50 text-white text-decoration-none"
        >
          <span>VRGC PORTAL</span>
          <ExternalLink size={10} className="text-[#38bdf8]" />
        </a>
      </div>
    </div>
  );
}
