'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { UnifiedMember } from '../types';
import { CsvMember } from '../utils/csvParser';

interface AssetPreloaderProps {
  targetMember: UnifiedMember;
  csvMembers?: CsvMember[];
  databaseMembers?: UnifiedMember[];
  onComplete: () => void;
}

export default function AssetPreloader({
  targetMember,
  csvMembers = [],
  databaseMembers = [],
  onComplete,
}: AssetPreloaderProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Collect image/GIF asset URLs to preload into browser cache
    const urlsToPreload: string[] = [];

    if (targetMember.avatarUrl) urlsToPreload.push(targetMember.avatarUrl);
    if (targetMember.photoUrl) urlsToPreload.push(targetMember.photoUrl);
    if (targetMember.imageUrl) urlsToPreload.push(targetMember.imageUrl);

    databaseMembers.forEach((m) => {
      if (m.avatarUrl) urlsToPreload.push(m.avatarUrl);
      if (m.photoUrl) urlsToPreload.push(m.photoUrl);
    });

    urlsToPreload.push('/vrgc-logo.png', '/icon.svg');

    // Preload images into browser memory
    urlsToPreload.forEach((url) => {
      if (url && typeof window !== 'undefined') {
        const img = new Image();
        img.src = url;
      }
    });

    // High-performance 0.6 second progress animation (600ms total: 0.5s - 0.7s target range)
    const startTime = performance.now();
    const duration = 600;

    let animationFrameId: number;

    const updateProgress = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const pct = Math.min(100, Math.floor((elapsed / duration) * 100));
      setProgress(pct);

      if (elapsed < duration) {
        animationFrameId = requestAnimationFrame(updateProgress);
      } else {
        setTimeout(() => {
          onComplete();
        }, 50);
      }
    };

    animationFrameId = requestAnimationFrame(updateProgress);

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [targetMember, databaseMembers, onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
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

      {/* Holographic Scanline Overlay */}
      <div
        className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
        style={{
          background: 'linear-gradient(to bottom, transparent 50%, rgba(168, 85, 247, 0.04) 51%, transparent 52%)',
          backgroundSize: '100% 8px',
        }}
      />

      {/* Central Ambient Glow */}
      <div
        className="absolute w-80 h-80 rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.25) 0%, rgba(5, 1, 10, 0) 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Main HUD Container */}
      <div className="relative z-20 w-full max-w-sm flex flex-col items-center gap-6 text-center">
        {/* Holographic Logo Shield */}
        <div className="relative w-20 h-20 flex items-center justify-center">
          <div
            className="absolute inset-0 rounded-full border-2 border-dashed border-[#c084fc]/60 animate-spin"
            style={{ animationDuration: '6s' }}
          />
          <div className="absolute inset-2 rounded-full border border-purple-500/30" />
          <img
            src="/vrgc-logo.png"
            alt="VRGC"
            className="w-10 h-10 object-contain drop-shadow-[0_0_12px_rgba(168,85,247,0.8)]"
          />
        </div>

        {/* Status Line & Registration Number */}
        <div className="space-y-1">
          <div className="flex items-center justify-center gap-2 text-[#c084fc] font-mono text-[10px] tracking-widest uppercase font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c084fc] animate-ping" />
            <span>ESTABLISHING NEURAL BUFFER</span>
          </div>
          <p className="text-slate-400 font-mono text-[11px] tracking-wider uppercase">
            DOSSIER :: {targetMember.regNo}
          </p>
        </div>

        {/* Progress Indicator Track */}
        <div className="w-full space-y-2">
          <div className="flex justify-between items-center px-1 font-mono text-[10px] text-purple-300/80 tracking-widest uppercase">
            <span>BUFFER SYNC</span>
            <span className="text-[#c084fc] font-bold text-xs">{progress}%</span>
          </div>

          <div className="relative w-full h-2.5 bg-[#0e0518] rounded-full border border-purple-500/40 p-0.5 overflow-hidden shadow-[inset_0_0_8px_rgba(0,0,0,0.8)]">
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
