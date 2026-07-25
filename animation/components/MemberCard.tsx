'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Member } from '../lib/members';

interface MemberCardProps {
  member: Member;
  isRevealed: boolean;
}

export default function MemberCard({ member, isRevealed }: MemberCardProps) {
  return (
    <div className="relative w-full h-full rounded-2xl flex items-center justify-center">
      {/* Border energy flow */}
      {isRevealed && (
        <div
          className="absolute inset-[-2px] rounded-[18px] pointer-events-none z-0"
          style={{
            background: 'conic-gradient(from 0deg, #c084fc, #a855f7, #7c3aed, #c084fc)',
            animation: 'avatar-ring-spin 4s linear infinite',
          }}
        />
      )}

      {/* Card Content */}
      <div
        className="relative w-full h-full overflow-hidden rounded-2xl z-10"
        style={{
          background: 'linear-gradient(135deg, rgba(4,2,14,0.95), rgba(12,4,28,0.96))',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 4px 30px rgba(0,0,0,0.8), inset 0 1px 0 rgba(192,132,252,0.15)',
        }}
      >
        {/* Glass reflection */}
        <div
          className="absolute inset-0 pointer-events-none z-[1]"
          style={{
            background: 'linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.03) 45%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 55%, transparent 60%)',
            backgroundSize: '300% 300%',
            animation: 'holographic-shift 8s ease-in-out infinite',
          }}
        />

        {/* Holographic scan line */}
        <div
          className="absolute top-0 left-0 pointer-events-none z-[4]"
          style={{
            height: '1px',
            width: '100%',
            background: 'linear-gradient(to right, transparent, rgba(192,132,252,0.25), transparent)',
            animation: 'scanline 4s linear infinite',
          }}
        />

        {/* Corner decorations */}
        <div className="absolute top-2 left-2 w-[10px] h-[10px] border-t border-l pointer-events-none z-[5]" style={{ borderColor: 'rgba(192,132,252,0.3)' }} />
        <div className="absolute top-2 right-2 w-[10px] h-[10px] border-t border-r pointer-events-none z-[5]" style={{ borderColor: 'rgba(192,132,252,0.3)' }} />
        <div className="absolute bottom-2 left-2 w-[10px] h-[10px] border-b border-l pointer-events-none z-[5]" style={{ borderColor: 'rgba(192,132,252,0.3)' }} />
        <div className="absolute bottom-2 right-2 w-[10px] h-[10px] border-b border-r pointer-events-none z-[5]" style={{ borderColor: 'rgba(192,132,252,0.3)' }} />

        {/* ═══ AVATAR AREA (top 58%) ═══ */}
        <div className="relative w-full flex items-center justify-center z-[3]" style={{ height: '58%' }}>
          {/* Radial glow behind avatar */}
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '70%',
              height: '70%',
              background: 'radial-gradient(circle, rgba(168,85,247,0.4) 0%, rgba(124,58,237,0.2) 50%, transparent 80%)',
              filter: 'blur(20px)',
              opacity: isRevealed ? 0.85 : 0,
              transition: 'opacity 0.6s',
            }}
          />
          
          {/* Ripple effect on reveal */}
          <AnimatePresence>
            {isRevealed && (
              <motion.div
                className="absolute rounded-full pointer-events-none"
                initial={{ scale: 0.5, opacity: 0.8 }}
                animate={{ scale: 1.5, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1, ease: 'easeOut' }}
                style={{
                  width: 'clamp(65px, 28vw, 120px)',
                  height: 'clamp(65px, 28vw, 120px)',
                  border: '2px solid rgba(192,132,252,0.6)',
                }}
              />
            )}
          </AnimatePresence>

          {/* Avatar container */}
          <div
            className="relative flex items-center justify-center"
            style={{ width: 'clamp(65px, 28vw, 120px)', height: 'clamp(65px, 28vw, 120px)' }}
          >
            {/* Double rings */}
            <div
              className="absolute inset-[-4px] rounded-full pointer-events-none"
              style={{
                border: '2px dashed rgba(192,132,252,0.5)',
                animation: 'avatar-ring-spin 6s linear infinite',
              }}
            />
            <div
              className="absolute inset-[-8px] rounded-full pointer-events-none"
              style={{
                border: '1px solid rgba(147,51,234,0.5)',
                animation: 'avatar-ring-spin 8s linear infinite reverse',
              }}
            />

            <motion.img
              src={member.avatarUrl}
              alt={member.name}
              className="w-full h-full object-cover rounded-full"
              style={{ padding: '3px' }}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{
                scale: isRevealed ? 1 : 0.5,
                opacity: isRevealed ? 1 : 0,
              }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              loading="eager"
            />

            {/* Status dot + VERIFIED */}
            <div
              className="absolute bottom-0 right-0 flex items-center gap-1"
              style={{
                opacity: isRevealed ? 1 : 0,
                transition: 'opacity 0.3s',
              }}
            >
              <span className="font-mono" style={{ fontSize: '0.35rem', color: 'rgba(192,132,252,0.5)' }}>VERIFIED</span>
              <div
                className="rounded-full"
                style={{
                  width: '7px',
                  height: '7px',
                  backgroundColor: '#c084fc',
                  boxShadow: '0 0 6px #c084fc',
                  animation: 'status-blink 2s ease-in-out infinite',
                }}
              />
            </div>
          </div>
        </div>

        {/* ═══ INFO AREA (bottom 42%) ═══ */}
        <div
          className="absolute bottom-0 left-0 right-0 px-3 pb-2 flex flex-col items-center justify-end gap-[3px] z-[3]"
          style={{ height: '42%' }}
        >
          {/* Name */}
          <motion.h3
            className="font-orbitron font-bold text-white text-center uppercase leading-none"
            style={{
              fontSize: 'clamp(0.7rem, 3vw, 1rem)',
              textShadow: '0 0 15px rgba(168,85,247,0.7)',
            }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: isRevealed ? 1 : 0, y: isRevealed ? 0 : 12 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            {member.name}
          </motion.h3>

          {/* Team name */}
          <motion.div
            className="font-rajdhani uppercase font-semibold"
            style={{
              fontSize: 'clamp(0.45rem, 1.8vw, 0.6rem)',
              color: 'rgba(192,132,252,0.6)',
              letterSpacing: '0.05em',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: isRevealed ? 1 : 0 }}
            transition={{ duration: 0.4, delay: 0.25 }}
          >
            {member.assignedTeam}
          </motion.div>

          {/* Divider */}
          <motion.div
            className="my-1"
            style={{
              width: '55%',
              height: '1px',
              background: 'linear-gradient(90deg, #c084fc, transparent, #7c3aed)',
            }}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: isRevealed ? 0.6 : 0, scaleX: isRevealed ? 1 : 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          />

          {/* Role badge */}
          <motion.div
            className="inline-block rounded-full px-2 py-[2px] whitespace-nowrap"
            style={{
              background: 'rgba(147,51,234,0.25)',
              border: '1px solid rgba(192,132,252,0.5)',
              color: '#d8b4fe',
              letterSpacing: '0.1em',
              fontSize: 'clamp(0.4rem, 1.6vw, 0.55rem)',
              fontFamily: 'var(--font-rajdhani)',
              textTransform: 'uppercase',
              boxShadow: '0 0 10px rgba(168,85,247,0.3)',
            }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: isRevealed ? 1 : 0, scale: isRevealed ? 1 : 0.8 }}
            transition={{ duration: 0.3, delay: 0.35 }}
          >
            {member.role}
          </motion.div>

          {/* Rating stars + number */}
          {member.rating !== undefined && (
            <motion.div
              className="flex items-center gap-1"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: isRevealed ? 1 : 0, y: isRevealed ? 0 : 4 }}
              transition={{ duration: 0.3, delay: 0.45 }}
            >
              <div className="flex gap-px" style={{ fontSize: 'clamp(0.45rem, 1.6vw, 0.6rem)' }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <span
                    key={star}
                    style={
                      star <= Math.round(member.rating!)
                        ? { color: '#c084fc', filter: 'drop-shadow(0 0 3px rgba(168,85,247,0.6))' }
                        : { color: 'rgba(192,132,252,0.2)' }
                    }
                  >
                    ★
                  </span>
                ))}
              </div>
              <span
                className="font-orbitron font-bold"
                style={{ fontSize: 'clamp(0.45rem, 1.6vw, 0.6rem)', color: '#c084fc' }}
              >
                {member.rating.toFixed(1)}
              </span>
            </motion.div>
          )}

          {/* Reg number */}
          <motion.p
            className="font-mono mt-1"
            style={{
              fontSize: 'clamp(0.35rem, 1.2vw, 0.45rem)',
              letterSpacing: '0.15em',
              color: 'rgba(192,132,252,0.35)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: isRevealed ? 1 : 0 }}
            transition={{ duration: 0.3, delay: 0.55 }}
          >
            {member.regNo}
          </motion.p>
        </div>
      </div>
    </div>
  );
}
