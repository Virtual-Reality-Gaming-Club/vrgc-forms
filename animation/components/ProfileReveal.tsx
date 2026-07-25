'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Member } from '../lib/members';
import {
  ExternalLink,
  ShieldCheck,
  Calendar,
  Phone,
  Mail,
  Award,
  Hash,
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

/* ─── Social Links ─── */
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
  // Reveal sequence steps:
  // 0 = ZOOM_IN (Name & Position zooms from small at center)
  // 1 = MOVE_TOP (Name & Position glides up to top position)
  // 2 = READY_CANVASES (Remaining canvases appear on screen)
  const [seqStep, setSeqStep] = useState<number>(0);

  // Continuous smooth scroll progress: 0.0 (Top Canvas + Image only) to 1.0 (Full Details overlay)
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const touchStartRef = useRef<number | null>(null);

  // Choreograph sequence when reveal becomes visible
  useEffect(() => {
    if (!isVisible) {
      setSeqStep(0);
      return;
    }

    // Step 0: Zoom in at center screen (0ms)
    setSeqStep(0);

    // Step 1: Move from center to top of screen (550ms)
    const t1 = setTimeout(() => {
      setSeqStep(1);
    }, 550);

    // Step 2: Remaining canvases appear (1100ms)
    const t2 = setTimeout(() => {
      setSeqStep(2);
    }, 1100);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isVisible]);

  // Smooth, lag-free wheel event handler
  const handleWheel = useCallback((e: WheelEvent) => {
    if (seqStep < 2) return;
    e.preventDefault();
    const delta = e.deltaY * 0.0012;
    setScrollProgress((prev) => Math.max(0, Math.min(1, prev + delta)));
  }, [seqStep]);

  // Touch drag event handler
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (seqStep < 2) return;
    touchStartRef.current = e.touches[0].clientY;
  }, [seqStep]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (seqStep < 2 || touchStartRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const diff = (touchStartRef.current - currentY) * 0.003;
    setScrollProgress((prev) => Math.max(0, Math.min(1, prev + diff)));
    touchStartRef.current = currentY;
  }, [seqStep]);

  useEffect(() => {
    if (!isVisible) return;
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [isVisible, handleWheel]);

  if (!member) return null;

  const email = `${member.name.split(' ')[0].toLowerCase()}@vrgc.club`;
  const joinFormatted = new Date(member.joinDate)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    .toUpperCase();

  // Choreographed vertical positioning for Name & Position canvas
  const topHeaderY = seqStep === 0 ? 'calc(50vh - 160px)' : 'clamp(68px, 10vh, 100px)';
  const topCanvasScale = seqStep === 0 ? 1 : 1 - scrollProgress * 0.08;

  const detailsCanvasTop = `${100 - scrollProgress * 52}vh`;
  const detailsCanvasOpacity = seqStep === 2 ? Math.min(1, scrollProgress * 1.6) : 0;

  return (
    <div
      className="fixed inset-0 pointer-events-auto z-30 overflow-hidden flex flex-col items-center justify-center transition-opacity duration-300"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      style={{
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? 'auto' : 'none',
        willChange: 'opacity',
      }}
    >
      <style>{`
        @keyframes name-glow {
          0%, 100% { text-shadow: 0 0 15px rgba(168,85,247,0.8), 0 0 30px rgba(124,58,237,0.5), 2px 2px 4px rgba(0,0,0,1); }
          50% { text-shadow: 0 0 25px rgba(192,132,252,0.95), 0 0 50px rgba(168,85,247,0.7), 2px 2px 6px rgba(0,0,0,1); }
        }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ═══ SOFT VIOLET AURA GLOW BEHIND THE IMAGE CANVAS        ═══ */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <div
        className="fixed left-1/2 top-[34vh] -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] rounded-full pointer-events-none z-10 transition-opacity duration-500"
        style={{
          opacity: seqStep === 2 ? 0.45 : 0,
          background: 'radial-gradient(circle, rgba(192, 132, 252, 0.45) 0%, rgba(168, 85, 247, 0.25) 45%, transparent 80%)',
          filter: 'blur(40px)',
          boxShadow: '0 0 45px rgba(168, 85, 247, 0.25)',
        }}
      />

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ═══ TOP CANVAS: NAME & POSITION (CENTERED ON VERTICAL AXIS) ═══ */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ x: '-50%', scale: 0.15, opacity: 0 }}
        animate={{
          x: '-50%',
          scale: topCanvasScale,
          opacity: isVisible ? 1 : 0,
        }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="fixed left-1/2 flex flex-col items-center text-center w-[92%] max-w-[420px] px-5 py-3.5 rounded-2xl z-30 pointer-events-auto transition-all duration-500 ease-out"
        style={{
          top: topHeaderY,
          background: 'linear-gradient(145deg, rgba(4, 1, 12, 0.96) 0%, rgba(8, 14, 30, 0.94) 50%, rgba(16, 4, 32, 0.96) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(147, 51, 234, 0.6)',
          boxShadow: '0 12px 35px rgba(0, 0, 0, 0.95), 0 0 30px rgba(124, 58, 237, 0.45), inset 0 0 15px rgba(168, 85, 247, 0.2)',
          willChange: 'transform, top',
        }}
      >
        {/* Glowing Accent Bar */}
        <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-[#c084fc] to-transparent" />

        {/* Header Tag */}
        <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-[#c084fc] flex items-center gap-1.5 mb-1">
          <ShieldCheck size={11} className="text-[#c084fc]" /> // MEMBER IDENTIFIED
        </span>

        {/* Position / Role Badge & Team */}
        <div className="flex items-center gap-2 mb-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full border border-[#c084fc]/70 bg-[#4c1d95]/50 text-[#d8b4fe] shadow-[0_0_15px_rgba(147,51,234,0.5)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c084fc] animate-pulse" />
            <span className="font-mono text-[10px] sm:text-xs font-bold tracking-wider uppercase">
              {member.role}
            </span>
          </div>
          <span className="text-[#a855f7]/60 text-xs">•</span>
          <span className="font-rajdhani uppercase font-bold text-white/90 text-xs sm:text-sm tracking-widest">
            {member.assignedTeam}
          </span>
        </div>

        {/* Player Name */}
        <h1
          className="font-orbitron font-extrabold uppercase text-white tracking-wider text-xl sm:text-2xl md:text-3xl leading-tight"
          style={{ animation: 'name-glow 3s ease-in-out infinite' }}
        >
          {member.name}
        </h1>

        {/* Corner Brackets */}
        <div className="absolute top-2 left-2 w-2.5 h-2.5 border-t-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute top-2 right-2 w-2.5 h-2.5 border-t-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-2.5 h-2.5 border-b-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-2.5 h-2.5 border-b-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
      </motion.div>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ═══ DETAILS CANVAS (CENTERED ON VERTICAL AXIS)             ═══ */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <motion.div
        animate={{
          x: '-50%',
          opacity: seqStep === 2 ? detailsCanvasOpacity : 0,
        }}
        transition={{ duration: 0.3 }}
        className="fixed left-1/2 w-[92%] max-w-[420px] p-4 sm:p-5 rounded-2xl flex flex-col gap-3 overflow-hidden z-40 no-scrollbar pointer-events-auto transition-all duration-300 ease-out"
        style={{
          top: detailsCanvasTop,
          maxHeight: '52vh',
          overflowY: 'auto',
          background: 'linear-gradient(145deg, rgba(2, 0, 6, 0.96) 0%, rgba(6, 14, 30, 0.94) 50%, rgba(16, 4, 32, 0.96) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(147, 51, 234, 0.6)',
          boxShadow: '0 15px 45px rgba(0, 0, 0, 0.95), 0 0 35px rgba(109, 40, 217, 0.4), inset 0 0 20px rgba(124, 58, 237, 0.15)',
          willChange: 'top, opacity',
        }}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between pb-2 border-b border-[#a855f7]/35 shrink-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="text-[#c084fc]" size={16} />
            <span className="font-orbitron font-bold text-xs sm:text-sm tracking-widest text-white uppercase">
              MEMBER DOSSIER
            </span>
          </div>
          <span className="font-mono text-[9px] tracking-widest text-[#c084fc] uppercase font-bold">
            STATUS: VERIFIED
          </span>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-2 text-left shrink-0">
          {/* Reg No */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-[#c084fc]/50 transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Hash size={10} /> REGISTRATION NUMBER
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5">
              {member.regNo}
            </p>
          </div>

          {/* Member ID */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-[#c084fc]/50 transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <ShieldCheck size={10} /> MEMBER ID
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase">
              {member.id}
            </p>
          </div>

          {/* Specialization */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-[#c084fc]/50 transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Award size={10} /> SPECIALIZATION
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase">
              {member.specialization}
            </p>
          </div>

          {/* Joined Date */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-[#c084fc]/50 transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Calendar size={10} /> JOINED
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase">
              {joinFormatted}
            </p>
          </div>

          {/* Rating */}
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
                <span className="font-orbitron font-bold text-xs text-[#c084fc]">
                  {member.rating.toFixed(1)}
                </span>
              </div>
            </div>
          )}

          {/* Phone */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-[#c084fc]/50 transition-colors">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Phone size={10} /> CONTACT
            </span>
            <p className="font-rajdhani font-semibold text-xs text-white mt-0.5">
              {member.phone}
            </p>
          </div>
        </div>

        {/* Email Row */}
        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-left shrink-0">
          <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
            <Mail size={10} /> EMAIL ADDRESS
          </span>
          <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5">
            {email}
          </p>
        </div>

        {/* Social Links */}
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

        {/* Corner Bracket Accents */}
        <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
      </motion.div>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ═══ SCROLL GUIDANCE PROMPT BUTTON                          ═══ */}
      {/* ═════════════════════════════════════════════════════════════ */}
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
