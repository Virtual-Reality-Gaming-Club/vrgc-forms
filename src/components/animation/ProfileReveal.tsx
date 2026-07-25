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
  const touchStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isVisible) {
      setSeqStep(0);
      return;
    }

    setSeqStep(0);

    const t1 = setTimeout(() => {
      setSeqStep(1);
    }, 550);

    const t2 = setTimeout(() => {
      setSeqStep(2);
    }, 1100);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isVisible]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!isVisible || seqStep < 2) return;
      const delta = e.deltaY * 0.0018;
      setScrollProgress((prev) => Math.min(1, Math.max(0, prev + delta)));
    },
    [isVisible, seqStep]
  );

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!isVisible || seqStep < 2) return;
      touchStartRef.current = e.touches[0].clientY;
    },
    [isVisible, seqStep]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isVisible || seqStep < 2 || touchStartRef.current === null) return;
      const currentY = e.touches[0].clientY;
      const diffY = touchStartRef.current - currentY;
      const delta = diffY * 0.0035;
      setScrollProgress((prev) => Math.min(1, Math.max(0, prev + delta)));
      touchStartRef.current = currentY;
    },
    [isVisible, seqStep]
  );

  const handleTouchEnd = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  useEffect(() => {
    if (!isVisible || seqStep < 2) return;
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
  }, [isVisible, seqStep, handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd]);

  if (!isVisible || !member) return null;

  const joinFormatted = member.joinDate ? member.joinDate : '2025';
  const email = `${member.name.toLowerCase().replace(/\s+/g, '.')}.${member.regNo.toLowerCase()}@vitbhopal.ac.in`;

  const titleScale = seqStep === 0 ? 0.75 : 1;
  const titleOpacity = 1;
  const topHeaderY = seqStep === 0 ? 'calc(50vh - 160px)' : 'clamp(68px, 10vh, 100px)';

  return (
    <div className="fixed inset-0 pointer-events-none z-30 flex flex-col items-center justify-between overflow-hidden">
      {/* Dynamic Background Glow */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(168, 85, 247, 0.25) 0%, rgba(124, 58, 237, 0.15) 45%, rgba(6, 2, 16, 0.95) 85%)',
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
            background: 'rgba(147, 51, 234, 0.2)',
            border: '1px solid rgba(192, 132, 252, 0.45)',
            boxShadow: '0 0 15px rgba(168, 85, 247, 0.3)',
          }}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <ShieldCheck size={12} className="text-[#c084fc] animate-pulse" />
          <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-[#d8b4fe] font-semibold">
            {member.role}
          </span>
        </motion.div>

        <h1
          className="font-display-lg font-black text-2xl sm:text-4xl md:text-5xl uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-white via-[#e879f9] to-[#c084fc] drop-shadow-[0_0_25px_rgba(168,85,247,0.85)]"
          style={{ lineHeight: 1.1 }}
        >
          {member.name}
        </h1>

        <div className="flex items-center gap-2 mt-1.5">
          <span className="font-mono text-[10px] sm:text-xs text-[#c084fc] uppercase tracking-widest font-semibold">
            {member.assignedTeam}
          </span>
          <span className="text-white/30">•</span>
          <span className="font-mono text-[10px] sm:text-xs text-white/70 tracking-wider">
            {member.regNo}
          </span>
        </div>
      </motion.div>

      {/* FULL DETAILS OVERLAY CANVAS */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 w-[92%] sm:w-[85%] max-w-md p-5 rounded-3xl flex flex-col gap-3.5 z-40 text-center pointer-events-auto"
        style={{
          bottom: 'clamp(24px, 5vh, 45px)',
          background: 'rgba(8, 3, 20, 0.94)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(168, 85, 247, 0.5)',
          boxShadow:
            '0 0 50px rgba(168, 85, 247, 0.4), inset 0 0 25px rgba(192, 132, 252, 0.15)',
        }}
        initial={{ opacity: 0, y: 120, scale: 0.9 }}
        animate={{
          opacity: seqStep === 2 ? Math.max(0.2, scrollProgress) : 0,
          y: seqStep === 2 ? (1 - scrollProgress) * 120 : 120,
          scale: seqStep === 2 ? 0.9 + scrollProgress * 0.1 : 0.9,
          pointerEvents: scrollProgress > 0.3 ? 'auto' : 'none',
        }}
        transition={
          prefersReduced
            ? { duration: 0.01 }
            : { type: 'spring', stiffness: 200, damping: 25 }
        }
      >
        <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-[#c084fc] to-transparent" />

        <div className="flex items-center justify-between border-b border-[#a855f7]/30 pb-2.5 text-left shrink-0">
          <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-[#c084fc] font-bold">
            // OFFICIAL DOSSIER SPECIFICATIONS
          </span>
          <span className="font-mono text-[9px] text-emerald-400 flex items-center gap-1 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> VERIFIED
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 text-left text-xs">
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-[#c084fc]/50 transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Award size={10} /> SPECIALIZATION
            </span>
            <p className="font-label-caps font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase">
              {member.specialization}
            </p>
          </div>

          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-[#c084fc]/50 transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Calendar size={10} /> JOINED
            </span>
            <p className="font-label-caps font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase">
              {joinFormatted}
            </p>
          </div>

          {member.rating !== undefined && (
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-[#c084fc]/50 transition-colors">
              <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
                <Star size={10} /> RATING
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="flex text-[#c084fc] text-xs">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <span key={s} style={{ opacity: s <= Math.round(member.rating!) ? 1 : 0.2 }}>
                      ★
                    </span>
                  ))}
                </div>
                <span className="font-code-sm font-bold text-xs text-[#c084fc]">
                  {member.rating.toFixed(1)}
                </span>
              </div>
            </div>
          )}

          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-[#c084fc]/50 transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Phone size={10} /> CONTACT
            </span>
            <p className="font-label-caps font-semibold text-xs text-white mt-0.5">
              {member.phone}
            </p>
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-left shrink-0">
          <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
            <Mail size={10} /> EMAIL ADDRESS
          </span>
          <p className="font-label-caps font-semibold text-xs sm:text-sm text-white mt-0.5">
            {email}
          </p>
        </div>

        <div className="pt-2 border-t border-[#a855f7]/30 flex flex-col gap-1.5 shrink-0">
          <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc]/80 text-left">
            // CONNECT & PORTAL LINKS
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {SOCIALS.map((s) => (
              <SocialButton key={s.label} {...s} />
            ))}
          </div>
        </div>

        <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
      </motion.div>

      {seqStep === 2 && (
        <button
          type="button"
          onClick={() => setScrollProgress((prev) => (prev > 0.5 ? 0 : 1))}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-[#a855f7]/60 bg-[#04010a]/95 backdrop-blur-md text-[#d8b4fe] shadow-[0_0_20px_rgba(147,51,234,0.5)] transition-transform active:scale-95 cursor-pointer"
        >
          <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest font-semibold">
            {scrollProgress < 0.1
              ? 'SWIPE / SCROLL DOWN FOR DOSSIER'
              : scrollProgress < 0.9
              ? 'SCROLLING DOSSIER...'
              : 'SCROLL UP TO CLOSE'}
          </span>
          {scrollProgress < 0.9 ? (
            <ChevronDown size={13} className="animate-bounce text-[#c084fc]" />
          ) : (
            <ChevronUp size={13} className="animate-bounce text-[#c084fc]" />
          )}
        </button>
      )}
    </div>
  );
}
