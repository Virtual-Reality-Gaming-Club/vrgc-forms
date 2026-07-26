'use client';

import React, { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Member } from './members';

interface MemberCardProps {
  member: Member;
  isRevealed: boolean;
}

// Memoized: prevents re-render on every CardDeck orbital tick (was re-rendering 8 cards × 20 fps)
const MemberCard = memo(function MemberCard({ member, isRevealed }: MemberCardProps) {
  // During shuffle: display avatar GIF. After reveal: transition to candidate profile photo.
  const displayImage = isRevealed
    ? (member.photoUrl || member.avatarUrl || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(member.name)}`)
    : (member.avatarUrl || member.photoUrl || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(member.name)}`);

  const [imgSrc, setImgSrc] = React.useState<string>(displayImage);

  React.useEffect(() => {
    setImgSrc(displayImage);
  }, [displayImage]);

  const isSpecial = (member.assignedTeam || '').toLowerCase() === 'student coordinator' || 
                    (member.assignedTeam || '').toLowerCase().includes('president') || 
                    (member.role || '').toLowerCase() === 'student coordinator' || 
                    (member.role || '').toLowerCase().includes('president');

  const displayRole = isSpecial 
    ? ((member.assignedTeam || '').toLowerCase() === 'student coordinator' ? 'Student Coordinator' : member.role)
    : (member.role || 'CORE MEMBER');


  return (
    <div className="relative w-full h-full rounded-3xl flex items-center justify-center select-none">
      {/* Border energy flow ring */}
      {isRevealed && (
        <div
          className="absolute inset-[-2px] rounded-[26px] pointer-events-none z-0"
          style={{
            background: 'conic-gradient(from 0deg, #c084fc, #a855f7, #7c3aed, #c084fc)',
            animation: 'avatar-ring-spin 4s linear infinite',
          }}
        />
      )}

      {/* Card Body — 100% Solid non-transparent background so full-screen background GIF never bleeds through */}
      <div
        className="relative w-full h-full overflow-hidden rounded-3xl z-10 flex flex-col justify-between p-4 sm:p-5 bg-[#06010d] opacity-100"
        style={{
          backgroundColor: '#06010d',
          border: '1px solid rgba(168,85,247,0.4)',
          boxShadow: '0 0 40px rgba(168,85,247,0.35), inset 0 1px 0 rgba(192,132,252,0.2)',
          isolation: 'isolate',
        }}
      >

        {/* Grid pattern background overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.008)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.008)_1px,transparent_1px)] bg-[size:10px_10px] pointer-events-none opacity-40" />

        {/* Holographic sweep */}
        <div
          className="absolute inset-0 pointer-events-none z-[1]"
          style={{
            background: 'linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.03) 45%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 55%, transparent 60%)',
            backgroundSize: '300% 300%',
            animation: 'holographic-shift 8s ease-in-out infinite',
          }}
        />

        {/* Corner Crop Marks */}
        <div className="absolute top-2.5 left-2.5 w-2.5 h-2.5 border-t-2 border-l-2 border-[#a855f7]/50 pointer-events-none z-[5]" />
        <div className="absolute top-2.5 right-2.5 w-2.5 h-2.5 border-t-2 border-r-2 border-[#a855f7]/50 pointer-events-none z-[5]" />
        <div className="absolute bottom-2.5 left-2.5 w-2.5 h-2.5 border-b-2 border-l-2 border-[#a855f7]/50 pointer-events-none z-[5]" />
        <div className="absolute bottom-2.5 right-2.5 w-2.5 h-2.5 border-b-2 border-r-2 border-[#a855f7]/50 pointer-events-none z-[5]" />

        {/* ═══ TOP SECTION: CLUB BRANDING ═══ */}
        <div className="border-b border-[#a855f7]/30 pb-2 relative z-10 text-center w-full">
          <div className="flex items-center gap-1 justify-center">
            <span className="material-symbols-outlined text-[13px] text-[#a855f7]">sports_esports</span>
            <h4 className="font-display-lg text-xs sm:text-sm text-white font-black tracking-widest leading-none">VRGC</h4>
          </div>
          <span className="text-[#a855f7]/90 text-[5px] font-code-sm tracking-wider uppercase block mt-0.5 font-bold">
            VIRTUAL REALITY &amp; GAMING CLUB
          </span>
        </div>

        {/* ═══ PORTRAIT PHOTO FRAME (CENTER) ═══ */}
        <div className="relative w-full flex items-center justify-center my-2 z-[3]">
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '65%',
              height: '65%',
              background: 'radial-gradient(circle, rgba(168,85,247,0.45) 0%, rgba(124,58,237,0.2) 50%, transparent 80%)',
              filter: 'blur(18px)',
              opacity: isRevealed ? 0.9 : 0,
              transition: 'opacity 0.6s',
            }}
          />

          <AnimatePresence>
            {isRevealed && (
              <motion.div
                className="absolute rounded-full pointer-events-none"
                initial={{ scale: 0.5, opacity: 0.8 }}
                animate={{ scale: 1.4, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1, ease: 'easeOut' }}
                style={{
                  width: 'clamp(70px, 30vw, 115px)',
                  height: 'clamp(70px, 30vw, 115px)',
                  border: '2px solid rgba(192,132,252,0.6)',
                }}
              />
            )}
          </AnimatePresence>

          <div
            className="relative flex items-center justify-center rounded-2xl border-2 border-[#a855f7]/40 p-1 bg-black/60 shadow-[0_0_25px_rgba(168,85,247,0.3)] overflow-hidden"
            style={{ width: 'clamp(70px, 28vw, 115px)', height: 'clamp(70px, 28vw, 115px)' }}
          >
            {/* key forces React to remount img on src change → CSS opacity transition crossfades avatar→photo */}
            <img
              key={imgSrc}
              src={imgSrc}
              alt={member.name}
              className="w-full h-full object-cover rounded-xl brightness-105 contrast-105"
              style={{ animation: 'img-fade-in 0.4s ease-out' }}
              loading="eager"
              // @ts-ignore
              fetchPriority="high"
              onError={(e) => {
                const t = e.target as HTMLImageElement;
                t.onerror = null; // prevent infinite loop
                t.src = `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(member.name)}`;
              }}
            />
            <div className="absolute bottom-1 right-1 bg-gradient-to-r from-[#a855f7] to-[#cf5cff] text-white text-[5px] font-black px-1 py-0.5 rounded tracking-widest uppercase shadow-md pointer-events-none opacity-90">
              VERIFIED
            </div>
          </div>
        </div>

        {/* ═══ CANDIDATE DOSSIER DETAILS (BOTTOM) ═══ */}
        <div className="bg-[#0b0512]/90 border border-[#a855f7]/30 p-2.5 sm:p-3 rounded-2xl relative z-10 space-y-1.5 text-left">
          {/* Name */}
          <div className="border-b border-white/10 pb-1">
            <span className="font-code-sm text-[5px] text-[#a855f7] uppercase tracking-widest block font-extrabold">
              NAME
            </span>
            <h3 className="font-display-lg text-xs sm:text-sm text-white font-extrabold tracking-wide uppercase truncate leading-none mt-0.5">
              {member.name}
            </h3>
          </div>

          {/* Reg No & Team */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <span className="font-code-sm text-[5px] text-[#a855f7] uppercase tracking-widest block font-extrabold">
                REGISTRATION NO.
              </span>
              <span className="font-code-sm text-[9px] text-white font-bold tracking-wider block">
                {member.regNo}
              </span>
            </div>
            <div>
              <span className="font-code-sm text-[5px] text-[#a855f7] uppercase tracking-widest block font-extrabold">
                TEAM / DIVISION
              </span>
              <span className="font-code-sm text-[9px] text-white font-bold tracking-wider block uppercase truncate">
                {member.assignedTeam || 'DEVELOPMENT'}
              </span>
            </div>
          </div>

          {/* Position Role Badge */}
          <div className="pt-1 border-t border-white/10 flex items-center gap-1.5 justify-start">
            <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] shadow-[0_0_8px_#a855f7] animate-pulse" />
            <span className="font-code-sm text-[7px] sm:text-[8px] text-[#ddb7ff] font-extrabold uppercase tracking-widest leading-none truncate">
              {displayRole}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default MemberCard;
