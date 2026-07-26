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
  Star,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Video,
  Camera,
  Share2,
  User,
  RotateCcw,
  Home,
} from 'lucide-react';

interface ProfileRevealProps {
  member: UnifiedMember | null;
  isVisible: boolean;
  isComplete: boolean;
  onReplay?: () => void;
}

const SOCIALS = [
  { Icon: Globe, href: 'https://vrgc.club/', label: 'Website', accent: '#c084fc' },
  { Icon: Video, href: 'https://www.youtube.com/@vrgcvitb', label: 'YouTube', accent: '#ff4444' },
  { Icon: Camera, href: 'https://www.instagram.com/vrgc.vitb', label: 'Instagram', accent: '#e040fb' },
  { Icon: Share2, href: 'https://www.linkedin.com/company/vrgc-vitb', label: 'LinkedIn', accent: '#a855f7' },
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

export default function ProfileReveal({ member, isVisible, isComplete, onReplay }: ProfileRevealProps) {
  const [seqStep, setSeqStep] = useState<number>(0);
  const [targetProgress, setTargetProgress] = useState<number>(0);
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const touchStartRef = useRef<number | null>(null);

  const targetProgressRef = useRef(0);
  const scrollProgressRef = useRef(0);
  const rafScrollRef = useRef<number | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Butter-smooth Lerp momentum scrolling RAF loop
  useEffect(() => {
    const updateSmoothScroll = () => {
      const diff = targetProgressRef.current - scrollProgressRef.current;
      if (Math.abs(diff) > 0.0003) {
        scrollProgressRef.current += diff * 0.14; // Silky lerp dampening
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

  const updateTargetProgress = useCallback((newVal: number) => {
    const clamped = Math.max(0, Math.min(1, newVal));
    targetProgressRef.current = clamped;
    setTargetProgress(clamped);
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setSeqStep(0);
      updateTargetProgress(0);
      scrollProgressRef.current = 0;
      setScrollProgress(0);
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
  }, [isVisible, updateTargetProgress]);

  // Lock mobile pull-to-refresh & page overscroll while dossier card active
  useEffect(() => {
    if (!isVisible) return;

    const originalOverscroll = document.body.style.overscrollBehaviorY;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overscrollBehaviorY = 'none';
    document.body.style.overflow = 'hidden';

    const preventPullToRefresh = (e: TouchEvent) => {
      // Prevent browser default pull-to-refresh swipe down gesture while dossier is active
      if (e.touches.length === 1 && targetProgressRef.current < 0.95) {
        if (e.cancelable) e.preventDefault();
      }
    };

    window.addEventListener('touchmove', preventPullToRefresh, { passive: false });

    return () => {
      document.body.style.overscrollBehaviorY = originalOverscroll;
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('touchmove', preventPullToRefresh);
    };
  }, [isVisible]);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (seqStep < 2) return;
    e.preventDefault();
    const delta = e.deltaY * 0.0014;
    updateTargetProgress(targetProgressRef.current + delta);
  }, [seqStep, updateTargetProgress]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (seqStep < 2) return;
    touchStartRef.current = e.touches[0].clientY;
  }, [seqStep]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (seqStep < 2 || touchStartRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const diff = (touchStartRef.current - currentY) * 0.0032;
    updateTargetProgress(targetProgressRef.current + diff);
    touchStartRef.current = currentY;
  }, [seqStep, updateTargetProgress]);

  useEffect(() => {
    if (!isVisible) return;
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [isVisible, handleWheel]);

  if (!member) return null;

  const joinFormatted = member.joinDate
    ? new Date(member.joinDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()
    : '2024 - 2025';

  const topCanvasTop = seqStep === 0 ? '42vh' : `${4 - scrollProgress * 2.5}vh`;
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
      {/* Soft violet radial glow */}
      <div
        className="fixed left-1/2 top-[34vh] -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] rounded-full pointer-events-none z-10 transition-opacity duration-500"
        style={{
          opacity: seqStep === 2 ? 0.45 : 0,
          background: 'radial-gradient(circle, rgba(192, 132, 252, 0.45) 0%, rgba(168, 85, 247, 0.25) 45%, transparent 80%)',
          filter: isMobile ? 'blur(20px)' : 'blur(40px)',
          boxShadow: isMobile ? 'none' : '0 0 45px rgba(168, 85, 247, 0.25)',
        }}
      />

      {/* ═══ TOP CANVAS: NAME & POSITION ═══ */}
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
          top: topCanvasTop,
          background: 'linear-gradient(145deg, rgba(4, 1, 12, 0.98) 0%, rgba(8, 14, 30, 0.96) 50%, rgba(16, 4, 32, 0.98) 100%)',
          backdropFilter: isMobile ? 'none' : 'blur(16px)',
          WebkitBackdropFilter: isMobile ? 'none' : 'blur(16px)',
          border: '1px solid rgba(147, 51, 234, 0.6)',
          boxShadow: isMobile ? '0 8px 25px rgba(0,0,0,0.9)' : '0 12px 35px rgba(0, 0, 0, 0.95), 0 0 30px rgba(124, 58, 237, 0.45)',
          willChange: 'transform, top',
        }}
      >
        <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-[#c084fc] to-transparent" />

        <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-[#c084fc] flex items-center gap-1.5 mb-1">
          <Sparkles size={11} className="text-[#c084fc]" /> // VERIFIED DOSSIER LOADED
        </span>

        <div className="flex items-center gap-2 mb-1 flex-wrap justify-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full border border-[#c084fc]/70 bg-[#4c1d95]/50 text-[#d8b4fe] shadow-[0_0_15px_rgba(147,51,234,0.5)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c084fc] animate-pulse" />
            <span className="font-mono text-[10px] sm:text-xs font-bold tracking-wider uppercase">
              {member.role || member.position || 'CORE MEMBER'}
            </span>
          </div>
          {member.assignedTeam && (
            <>
              <span className="text-[#a855f7]/60 text-xs">•</span>
              <span className="font-rajdhani uppercase font-bold text-white/90 text-xs sm:text-sm tracking-widest">
                {member.assignedTeam}
              </span>
            </>
          )}
        </div>

        <h1
          className="font-orbitron font-extrabold uppercase text-white tracking-wider text-xl sm:text-2xl md:text-3xl leading-tight"
          style={{ animation: isMobile ? 'none' : 'name-glow 3s ease-in-out infinite' }}
        >
          {member.name}
        </h1>

        <div className="absolute top-2 left-2 w-2.5 h-2.5 border-t-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute top-2 right-2 w-2.5 h-2.5 border-t-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-2.5 h-2.5 border-b-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-2.5 h-2.5 border-b-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
      </motion.div>

      {/* ═══ BOTTOM DETAILS DOSSIER CANVAS ═══ */}
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
          background: 'linear-gradient(145deg, rgba(2, 0, 6, 0.98) 0%, rgba(6, 14, 30, 0.96) 50%, rgba(16, 4, 32, 0.98) 100%)',
          backdropFilter: isMobile ? 'none' : 'blur(20px)',
          WebkitBackdropFilter: isMobile ? 'none' : 'blur(20px)',
          border: '1px solid rgba(147, 51, 234, 0.6)',
          boxShadow: isMobile ? '0 10px 30px rgba(0,0,0,0.95)' : '0 15px 45px rgba(0, 0, 0, 0.95), 0 0 35px rgba(109, 40, 217, 0.4)',
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
          <span className="font-mono text-[9px] tracking-widest text-[#00ff88] uppercase font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
            OFFICIAL VERIFIED
          </span>
        </div>

        {/* Complete Unified Details Grid */}
        <div className="grid grid-cols-2 gap-2 text-left shrink-0">
          {/* Reg No */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Hash size={10} /> REGISTRATION NO.
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5">
              {member.regNo}
            </p>
          </div>

          {/* Team / Division */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Award size={10} /> TEAM / DIVISION
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase truncate">
              {member.assignedTeam || 'VRGC'}
            </p>
          </div>

          {/* Role / Position */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <User size={10} /> POSITION / ROLE
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase truncate">
              {member.position || member.role || 'CORE MEMBER'}
            </p>
          </div>

          {/* Phone */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Phone size={10} /> PHONE NUMBER
            </span>
            <p className="font-rajdhani font-semibold text-xs text-white mt-0.5">
              {member.phone || 'N/A'}
            </p>
          </div>

          {/* Specialization / Department */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Sparkles size={10} /> SPECIALIZATION
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase truncate">
              {member.specialization}
            </p>
          </div>

          {/* Joined Date */}
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
              <Calendar size={10} /> JOINED DATE
            </span>
            <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 uppercase">
              {joinFormatted}
            </p>
          </div>
        </div>

        {/* Email Row */}
        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-left shrink-0">
          <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
            <Mail size={10} /> EMAIL ADDRESS
          </span>
          <p className="font-rajdhani font-semibold text-xs sm:text-sm text-white mt-0.5 truncate">
            {member.email || `${member.name.split(' ')[0].toLowerCase()}@vrgc.club`}
          </p>
        </div>

        {/* Member Rating */}
        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between text-left shrink-0">
          <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-[#c084fc] flex items-center gap-1">
            <Star size={10} /> MEMBER RATING
          </span>
          <div className="flex items-center gap-1.5">
            <div className="flex text-[#c084fc] text-xs">
              {[1, 2, 3, 4, 5].map((s) => (
                <span key={s} style={{ opacity: s <= Math.round(member.rating) ? 1 : 0.2 }}>
                  ★
                </span>
              ))}
            </div>
            <span className="font-orbitron font-bold text-xs text-[#c084fc]">
              {member.rating ? member.rating.toFixed(1) : '5.0'}
            </span>
          </div>
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

        <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-[#c084fc]/70 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-[#c084fc]/70 pointer-events-none" />
      </motion.div>

      {/* ═══ BOTTOM ACTION CONTROLS ═══ */}
      {seqStep === 2 && (
        <div className="fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center justify-center gap-2 sm:gap-3 max-w-[95vw]">
          {/* Replay Animation Button */}
          {onReplay && (
            <button
              type="button"
              onClick={onReplay}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-purple-500/70 bg-[#070214]/95 backdrop-blur-xl text-purple-300 hover:text-white hover:border-purple-400 hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(168,85,247,0.4)] font-mono text-[9px] sm:text-[10px] font-bold tracking-wider cursor-pointer"
            >
              <RotateCcw size={13} className="text-purple-400" />
              <span className="whitespace-nowrap">REPLAY ANIMATION</span>
            </button>
          )}

          {/* Main Portal Button */}
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-white/30 bg-black/90 backdrop-blur-xl text-slate-200 hover:text-white hover:border-white/60 hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.15)] font-mono text-[9px] sm:text-[10px] font-bold tracking-wider cursor-pointer"
          >
            <Home size={13} className="text-purple-400" />
            <span className="whitespace-nowrap">MAIN PORTAL</span>
          </Link>

          {/* Dossier Toggle Button */}
          <button
            type="button"
            onClick={() => setScrollProgress((prev) => (prev > 0.5 ? 0 : 1))}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-[#a855f7]/60 bg-[#04010a]/95 backdrop-blur-md text-[#d8b4fe] shadow-[0_0_20px_rgba(147,51,234,0.5)] transition-transform active:scale-95 cursor-pointer"
          >
            <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap">
              {scrollProgress < 0.1
                ? 'DOSSIER'
                : scrollProgress < 0.9
                ? 'SCROLLING...'
                : 'CLOSE'}
            </span>
            {scrollProgress < 0.9 ? (
              <ChevronDown size={13} className="animate-bounce text-[#c084fc]" />
            ) : (
              <ChevronUp size={13} className="animate-bounce text-[#c084fc]" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
