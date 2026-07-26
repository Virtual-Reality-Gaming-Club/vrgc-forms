'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CardDeck from './CardDeck';
import ProfileReveal from './ProfileReveal';
import HudOverlay from './HudOverlay';
import WelcomePopup from './WelcomePopup';
import BackgroundGif from './BackgroundGif';
import AssetPreloader from './AssetPreloader';
import { CardPhase } from './AnimatedCard';
import { UnifiedMember } from '../types';
import { CsvMember } from '../utils/csvParser';

const PHASE_ORDER: CardPhase[] = [
  'ENTRY','DECK_APPEAR','ROTATING_SHUFFLE','SHUFFLE_ACCELERATE',
  'COLLAPSE','CARD_PICK','CARD_FLIP','AVATAR_REVEAL','PROFILE_EXPAND','COMPLETE',
];

function Particles({ intensity }: { intensity: number }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const count = isMobile ? 12 : 32;

  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${(i * 13 + 7) % 100}%`,
      size: 2 + (i % 3) * 2,
      delay: (i * 0.7) % 5,
      duration: 4 + (i % 4) * 2,
      color: ['#c084fc','#a855f7','#7c3aed','#d8b4fe','#9333ea'][i % 5],
      up: i % 2 === 0,
    }));
  }, [count]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-[1]">
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: p.left,
            bottom: p.up ? '-4px' : 'auto',
            top: p.up ? 'auto' : '-4px',
            width: p.size * intensity,
            height: p.size * intensity,
            backgroundColor: p.color,
            boxShadow: isMobile ? 'none' : `0 0 6px ${p.color}`,
            opacity: 0.7 * Math.min(intensity, 1),
            animation: `${p.up ? 'float-up' : 'float-down'} ${p.duration}s ${p.delay}s linear infinite`,
          }}
        />
      ))}
    </div>
  );
}

function EnergyOrbs({ phase }: { phase: CardPhase }) {
  const isActive = !['ENTRY','COMPLETE'].includes(phase);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Reduce orb count and blur on mobile for smooth 60fps
  const orbs = isMobile
    ? [
        { color: 'rgba(124,58,237,0.18)', size: '36vmax', x: '50%', y: '40%', anim: 'orb-drift-1', dur: '18s' },
      ]
    : [
        { color: 'rgba(124,58,237,0.18)', size: '42vmax', x: '20%', y: '25%', anim: 'orb-drift-1', dur: '18s' },
        { color: 'rgba(109,40,217,0.15)', size: '38vmax', x: '75%', y: '60%', anim: 'orb-drift-2', dur: '22s' },
        { color: 'rgba(147,51,234,0.14)', size: '32vmax', x: '50%', y: '80%', anim: 'orb-drift-1', dur: '25s' },
      ];

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-[1]">
      {orbs.map((orb, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: orb.x, top: orb.y,
            width: orb.size, height: orb.size,
            background: `radial-gradient(circle, ${orb.color}, transparent 70%)`,
            filter: isMobile ? 'blur(20px)' : 'blur(45px)',
            animation: isActive ? `${orb.anim} ${orb.dur} ease-in-out infinite` : 'none',
            transform: 'translate(-50%,-50%)',
            opacity: isActive ? 1 : 0,
            transition: 'opacity 1s',
          }}
        />
      ))}
    </div>
  );
}

function FloatingGeometries() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const count = isMobile ? 3 : 7;
  const shapes = useMemo(() => {
    const all = [
      { type: 'hexagon', top: '15%', left: '8%', anim: 'geo-float-1', dur: '20s', delay: '0s', size: 22, stroke: 'rgba(147,51,234,0.2)' },
      { type: 'diamond', top: '25%', left: '85%', anim: 'geo-float-3', dur: '25s', delay: '5s', size: 26, stroke: 'rgba(192,132,252,0.2)' },
      { type: 'circle', top: '80%', left: '80%', anim: 'geo-float-1', dur: '22s', delay: '1s', size: 28, stroke: 'rgba(192,132,252,0.15)' },
      { type: 'triangle', top: '70%', left: '12%', anim: 'geo-float-2', dur: '18s', delay: '2s', size: 20, stroke: 'rgba(124,58,237,0.18)' },
      { type: 'hexagon', top: '45%', left: '5%', anim: 'geo-float-2', dur: '15s', delay: '4s', size: 18, stroke: 'rgba(147,51,234,0.2)' },
      { type: 'triangle', top: '10%', left: '60%', anim: 'geo-float-3', dur: '19s', delay: '7s', size: 25, stroke: 'rgba(124,58,237,0.18)' },
      { type: 'diamond', top: '85%', left: '40%', anim: 'geo-float-1', dur: '24s', delay: '3s', size: 22, stroke: 'rgba(168,85,247,0.2)' },
    ];
    return all.slice(0, count);
  }, [count]);

  return (
    <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden">
      {shapes.map((s, i) => (
        <div key={i} className="absolute flex items-center justify-center" style={{ top: s.top, left: s.left, animation: `${s.anim} ${s.dur} ${s.delay} ease-in-out infinite` }}>
          {s.type === 'hexagon' && (
            <svg width={s.size} height={s.size} viewBox="0 0 24 24" fill="none" stroke={s.stroke} strokeWidth="1">
              <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
            </svg>
          )}
          {s.type === 'diamond' && (
            <svg width={s.size} height={s.size} viewBox="0 0 24 24" fill="none" stroke={s.stroke} strokeWidth="1">
              <polygon points="12 2 22 12 12 22 2 12" />
            </svg>
          )}
          {s.type === 'circle' && (
            <svg width={s.size} height={s.size} viewBox="0 0 24 24" fill="none" stroke={s.stroke} strokeWidth="1" strokeDasharray="4 2">
              <circle cx="12" cy="12" r="10" />
            </svg>
          )}
          {s.type === 'triangle' && (
            <svg width={s.size} height={s.size} viewBox="0 0 24 24" fill="none" stroke={s.stroke} strokeWidth="1">
              <polygon points="12 2 22 20 2 20" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

interface EntryExperienceProps {
  targetMember: UnifiedMember;
  csvMembers: CsvMember[];
  databaseMembers?: UnifiedMember[];
}

export default function EntryExperience({ targetMember, csvMembers, databaseMembers }: EntryExperienceProps) {
  const [isPreloading, setIsPreloading] = useState(true);
  const [phase, setPhase] = useState<CardPhase>('ENTRY');
  const [selectedMember, setSelectedMember] = useState<UnifiedMember>(targetMember);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handlePhaseComplete = useCallback((completedPhase: CardPhase) => {
    const idx = PHASE_ORDER.indexOf(completedPhase);
    const next = PHASE_ORDER[idx + 1];
    if (next) setPhase(next);
  }, []);

  const handleMemberSelected = useCallback((member: UnifiedMember) => {
    setSelectedMember(member);
  }, []);

  const handleReplay = useCallback(() => {
    setIsPreloading(true);
    setPhase('ENTRY');
  }, []);

  const isRevealPhase = ['AVATAR_REVEAL','PROFILE_EXPAND','COMPLETE'].includes(phase);
  const isProfileVisible = ['PROFILE_EXPAND','COMPLETE'].includes(phase);
  const isShuffling = ['ROTATING_SHUFFLE','SHUFFLE_ACCELERATE'].includes(phase);
  const showBurst = phase === 'CARD_PICK';
  const showRing = ['CARD_PICK','CARD_FLIP'].includes(phase);

  const particleIntensity = isShuffling ? 1.2 : isRevealPhase ? 0.6 : showBurst ? 1.5 : 0.8;

  return (
    <>
      <AnimatePresence mode="wait">
        {isPreloading && (
          <AssetPreloader
            targetMember={targetMember}
            csvMembers={csvMembers}
            databaseMembers={databaseMembers}
            onComplete={() => setIsPreloading(false)}
          />
        )}
      </AnimatePresence>

      <div
        className="relative flex flex-col items-center justify-center overflow-hidden w-full min-h-screen"
        style={{
          width: '100vw',
          height: '100dvh',
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #020006 0%, #080116 25%, #100228 50%, #0a011a 75%, #020006 100%)',
          backgroundSize: isMobile ? '100% 100%' : '400% 400%',
          animation: isMobile ? 'none' : 'bg-shift 20s ease infinite',
        }}
      >
        {/* Background GIF rendered behind full screen after animation complete */}
        <BackgroundGif
          avatarUrl={targetMember.avatarUrl}
          isVisible={isProfileVisible}
          isComplete={phase === 'COMPLETE'}
        />

        {/* Camera breathing wrapper */}
        <div className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{ animation: isMobile ? 'none' : 'camera-breathe 12s ease-in-out infinite' }}>
          <EnergyOrbs phase={phase} />
          <FloatingGeometries />
          <Particles intensity={particleIntensity} />
          
          <div 
            className="absolute w-full h-[2px] z-[2] pointer-events-none"
            style={{
              background: 'linear-gradient(to right, transparent, rgba(192,132,252,0.25), transparent)',
              animation: 'scanline 8s linear infinite',
            }}
          />

          <motion.div
            className="absolute pointer-events-none z-[2]"
            style={{
              top: '35%', left: '50%',
              width: 'min(92vw, 650px)', height: 'min(92vw, 650px)',
            }}
            initial={{ x: '-50%', y: '-50%' }}
            animate={{
              x: '-50%', y: '-50%',
              opacity: isRevealPhase ? 0.45 : isShuffling ? 0.35 : showBurst ? 0.6 : 0.25,
              scale: isRevealPhase ? 1.3 : showBurst ? 1.5 : isShuffling ? 1.1 : 0.8,
            }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          >
            <div className="w-full h-full rounded-full" style={{
              background: 'radial-gradient(circle, rgba(192,132,252,0.45) 0%, rgba(168,85,247,0.25) 45%, transparent 80%)',
              filter: isMobile ? 'blur(20px)' : 'blur(45px)',
            }} />
          </motion.div>
          
          {/* Card deck */}
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-auto">
            <CardDeck
              phase={phase}
              targetMember={targetMember}
              csvMembers={csvMembers}
              databaseMembers={databaseMembers}
              onPhaseComplete={handlePhaseComplete}
              onMemberSelected={handleMemberSelected}
              isPreloading={isPreloading}
            />
          </div>

          {/* Profile reveal overlay */}
          <div className="pointer-events-auto">
            <ProfileReveal
              member={selectedMember}
              isVisible={isProfileVisible}
              isComplete={phase === 'COMPLETE'}
              onReplay={handleReplay}
            />
          </div>
          
          <WelcomePopup phase={phase} isPreloading={isPreloading} />
          <HudOverlay phase={phase} />
        </div>

        {/* Phase dots */}
        <motion.div
          className="absolute bottom-4 left-1/2 flex items-center gap-1.5 z-40 pointer-events-none"
          initial={{ x: '-50%' }}
          animate={{ x: '-50%', opacity: phase === 'COMPLETE' ? 0 : 0.3 }}
        >
          {PHASE_ORDER.slice(0, -1).map(p => (
            <motion.div key={p} className="rounded-full transition-all" animate={{
              width: phase === p ? 12 : 4,
              height: 4,
              backgroundColor: phase === p ? '#c084fc' : 'rgba(255,255,255,0.3)',
              boxShadow: phase === p ? '0 0 8px rgba(192,132,252,0.8)' : '0 0 0px rgba(0,0,0,0)',
            }} transition={{ type: 'spring', stiffness: 300, damping: 25 }} />
          ))}
        </motion.div>
      </div>
    </>
  );
}
