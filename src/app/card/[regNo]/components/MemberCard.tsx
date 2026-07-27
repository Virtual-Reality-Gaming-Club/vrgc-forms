'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { UnifiedMember } from '../types';

interface MemberCardProps {
  member: UnifiedMember;
  isRevealed: boolean;
  onAspectRatioChange?: (ratio: number) => void;
}

export default function MemberCard({ member, isRevealed, onAspectRatioChange }: MemberCardProps) {
  const [imgError, setImgError] = useState(false);

  // Real photo pipeline: photoUrl / imageUrl — fall back to pixel art if error or empty
  const realPhoto = member.photoUrl || member.imageUrl;
  const fallbackImg = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(member.name || member.regNo)}&backgroundColor=0a0a0f`;

  // When revealed: show real photo unless error occurred
  const displayImage = !imgError && realPhoto && realPhoto.trim() !== '' ? realPhoto : fallbackImg;

  // Measure real image dimensions once for aspect-ratio morphing — abort on cleanup
  useEffect(() => {
    if (!displayImage || !onAspectRatioChange) return;
    let cancelled = false;
    const img = new window.Image();
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      if (img.naturalWidth && img.naturalHeight > 0) {
        onAspectRatioChange(img.naturalWidth / img.naturalHeight);
      }
    };
    img.onerror = () => {
      if (cancelled) return;
      setImgError(true);
    };
    img.src = displayImage;
    return () => { cancelled = true; };
  }, [displayImage, onAspectRatioChange]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight > 0) {
      onAspectRatioChange?.(img.naturalWidth / img.naturalHeight);
    }
  };

  return (
    <div
      className="relative w-full h-full rounded-2xl flex items-center justify-center overflow-hidden shadow-2xl bg-[#060212]"
      style={{
        background: 'linear-gradient(135deg, rgba(4,2,14,0.98), rgba(12,4,28,0.98))',
        border: '1.5px solid rgba(192,132,252,0.6)',
        boxShadow: '0 10px 45px rgba(0,0,0,0.95), 0 0 30px rgba(168,85,247,0.35)',
      }}
    >
      {/* Border energy ring flow */}
      {isRevealed && (
        <div
          className="absolute inset-[-2px] rounded-[18px] pointer-events-none z-0"
          style={{
            background: 'conic-gradient(from 0deg, #c084fc, #a855f7, #7c3aed, #c084fc)',
            animation: 'avatar-ring-spin 4s linear infinite',
          }}
        />
      )}

      {/* Holographic Scanline */}
      <div
        className="absolute top-0 left-0 pointer-events-none z-[4]"
        style={{
          height: '2px',
          width: '100%',
          background: 'linear-gradient(to right, transparent, rgba(192,132,252,0.6), transparent)',
          animation: 'scanline 4s linear infinite',
        }}
      />

      {/* Corner Crop Marks */}
      <div className="absolute top-2.5 left-2.5 w-3.5 h-3.5 border-t-2 border-l-2 border-[#c084fc]/75 pointer-events-none z-10" />
      <div className="absolute top-2.5 right-2.5 w-3.5 h-3.5 border-t-2 border-r-2 border-[#c084fc]/75 pointer-events-none z-10" />
      <div className="absolute bottom-2.5 left-2.5 w-3.5 h-3.5 border-b-2 border-l-2 border-[#c084fc]/75 pointer-events-none z-10" />
      <div className="absolute bottom-2.5 right-2.5 w-3.5 h-3.5 border-b-2 border-r-2 border-[#c084fc]/75 pointer-events-none z-10" />

      {/* Member Photo Canvas (Fills entire card canvas) */}
      <div className="relative w-full h-full flex items-center justify-center overflow-hidden p-1.5 z-10">
        <Image
          src={displayImage}
          alt={member.name || 'Member Photo'}
          onLoad={handleImageLoad}
          onError={() => setImgError(true)}
          unoptimized={true}
          referrerPolicy="no-referrer"
          className="object-cover rounded-xl shadow-lg border border-purple-500/30 block pointer-events-none select-none"
          priority={true}
          fill
          sizes="(max-width: 768px) 100vw, 400px"
        />

        {/* Holographic glass reflection — desktop only (hidden on mobile via CSS) */}
        <div
          className="hidden md:block absolute inset-0 pointer-events-none z-[5]"
          style={{
            background:
              'linear-gradient(135deg, transparent 35%, rgba(255,255,255,0.04) 45%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 55%, transparent 65%)',
            backgroundSize: '300% 300%',
            animation: 'holographic-shift 6s ease-in-out infinite',
          }}
        />

        {/* Verified Badge Overlay */}
        <div className="absolute bottom-3 right-3 bg-gradient-to-r from-[#a855f7]/90 to-[#cf5cff]/90 text-white font-black text-[8px] sm:text-[9px] px-2 py-0.5 rounded tracking-widest uppercase shadow-md pointer-events-none z-10 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          VERIFIED
        </div>
      </div>
    </div>
  );
}
