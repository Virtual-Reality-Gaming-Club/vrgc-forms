'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { UnifiedMember } from '../types';

interface AssetPreloaderProps {
  targetMember: UnifiedMember;
  databaseMembers?: UnifiedMember[];
  onComplete: () => void;
}

declare global {
  interface Window {
    __VRGC_IMAGE_CACHE__?: HTMLImageElement[];
  }
}

// Max number of other-member deck images to preload (matches card count)
const DECK_PRELOAD_LIMIT = 6;

export default function AssetPreloader({
  targetMember,
  databaseMembers = [],
  onComplete,
}: AssetPreloaderProps) {
  const [progress, setProgress] = useState(0);
  // Stable ref so onComplete never causes effect re-run
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__VRGC_IMAGE_CACHE__ = window.__VRGC_IMAGE_CACHE__ || [];

    // ── Priority 1: Critical images for the animation (target member only) ──
    const criticalUrls = [
      targetMember.avatarUrl,
      targetMember.photoUrl,
    ].filter((u): u is string => Boolean(u && u.trim()));

    const uniqueCritical = [...new Set(criticalUrls)];
    let loadedCount = 0;
    const total = uniqueCritical.length || 1;
    let completed = false;

    const finish = () => {
      if (completed) return;
      completed = true;
      setProgress(100);
      // Slight delay for the progress bar to visually complete
      setTimeout(() => onCompleteRef.current(), 20);
    };

    uniqueCritical.forEach(url => {
      const img = new Image();
      img.decoding = 'async';
      (img as any).fetchPriority = 'high';

      const handleDone = () => {
        loadedCount++;
        const pct = Math.min(100, Math.floor((loadedCount / total) * 100));
        setProgress(prev => Math.max(prev, pct));
        if (loadedCount >= total) finish();
      };

      img.onload = handleDone;
      img.onerror = handleDone;
      img.src = url;
      window.__VRGC_IMAGE_CACHE__!.push(img);
    });

    // Fast cap: complete within 150ms for high performance
    const startTime = performance.now();
    const maxDuration = 150;
    let rafId: number;

    const tick = (now: number) => {
      if (completed) return;
      const elapsed = now - startTime;
      const pct = Math.min(95, Math.floor((elapsed / maxDuration) * 95));
      setProgress(prev => Math.max(prev, pct));
      if (elapsed < maxDuration) {
        rafId = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only — refs handle stable callbacks

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#05010a] text-white p-6 overflow-hidden select-none"
    >
      {/* Cyberpunk Grid Background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(168, 85, 247, 0.15) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(168, 85, 247, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '36px 36px',
        }}
      />

      {/* Central Ambient Glow */}
      <div
        className="absolute w-72 h-72 rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.22) 0%, rgba(5, 1, 10, 0) 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Main HUD Container */}
      <div className="relative z-20 w-full max-w-sm flex flex-col items-center gap-6 text-center">
        {/* Logo */}
        <div className="relative w-20 h-20 flex items-center justify-center">
          <div
            className="absolute inset-0 rounded-full border-2 border-dashed border-[#c084fc]/60"
            style={{ animation: 'avatar-ring-spin 6s linear infinite' }}
          />
          <div className="absolute inset-2 rounded-full border border-purple-500/30" />
          <img
            src="/vrgc-logo.png"
            alt="VRGC"
            className="w-10 h-10 object-contain drop-shadow-[0_0_12px_rgba(168,85,247,0.8)]"
          />
        </div>

        {/* Status */}
        <div className="space-y-1">
          <div className="flex items-center justify-center gap-2 text-[#c084fc] font-mono text-[10px] tracking-widest uppercase font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c084fc] animate-ping" />
            <span>ESTABLISHING NEURAL BUFFER</span>
          </div>
          <p className="text-slate-400 font-mono text-[11px] tracking-wider uppercase">
            DOSSIER :: {targetMember.regNo}
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full space-y-2">
          <div className="flex justify-between items-center px-1 font-mono text-[10px] text-purple-300/80 tracking-widest uppercase">
            <span>BUFFER SYNC</span>
            <span className="text-[#c084fc] font-bold text-xs">{progress}%</span>
          </div>
          <div className="relative w-full h-2.5 bg-[#0e0518] rounded-full border border-purple-500/40 p-0.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-600 via-[#c084fc] to-cyan-400 rounded-full transition-all duration-75 ease-out shadow-[0_0_12px_rgba(192,132,252,0.8)]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Corner Brackets */}
        <div className="absolute -top-6 -left-4 w-4 h-4 border-t-2 border-l-2 border-[#c084fc]/60" />
        <div className="absolute -top-6 -right-4 w-4 h-4 border-t-2 border-r-2 border-[#c084fc]/60" />
        <div className="absolute -bottom-6 -left-4 w-4 h-4 border-b-2 border-l-2 border-[#c084fc]/60" />
        <div className="absolute -bottom-6 -right-4 w-4 h-4 border-b-2 border-r-2 border-[#c084fc]/60" />
      </div>
    </motion.div>
  );
}
