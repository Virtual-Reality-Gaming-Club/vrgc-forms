'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import CardDeck from './CardDeck';
import ProfileReveal from './ProfileReveal';
import HudOverlay from './HudOverlay';
import WelcomePopup from './WelcomePopup';
import { CardPhase } from './AnimatedCard';
import { Member } from './members';

const PHASE_ORDER: CardPhase[] = [
  'ENTRY','DECK_APPEAR','ROTATING_SHUFFLE','SHUFFLE_ACCELERATE',
  'COLLAPSE','CARD_PICK','CARD_FLIP','AVATAR_REVEAL','PROFILE_EXPAND','COMPLETE',
];

// SSR-safe touch detection: starts false (matches server), updates after mount
function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    const isTouchDetected = window.matchMedia('(hover: none)').matches;
    if (isTouchDetected) {
      const timer = setTimeout(() => setIsTouch(true), 0);
      return () => clearTimeout(timer);
    }
  }, []);
  return isTouch;
}

function Particles({ intensity }: { intensity: number }) {
  const isTouch = useIsTouchDevice();

  // Particle arrays are deterministic (no Math.random) so server/client HTML matches.
  // After hydration, isTouch updates via useEffect and React re-renders harmlessly on client.
  const particles = useMemo(() => {
    // Mobile: 8 std + 0 micro; desktop: 32 std + 12 micro
    const stdCount = isTouch ? 8 : 32;
    const microCount = isTouch ? 0 : 12;
    const std = Array.from({ length: stdCount }, (_, i) => ({
      id: i,
      left: `${(i * 11 + 7) % 100}%`,
      size: 3 + (i % 3) * 2,
      delay: (i * 0.7) % 6,
      duration: 5 + (i % 4) * 2,
      color: ['#c084fc','#a855f7','#7c3aed','#d8b4fe','#9333ea','#e879f9','#a855f7'][i % 7],
      up: i % 2 === 0,
      isMicro: false
    }));
    const micro = Array.from({ length: microCount }, (_, i) => ({
      id: i + stdCount,
      left: `${(i * 17 + 3) % 100}%`,
      size: 1 + (i % 2),
      delay: (i * 0.5) % 4,
      duration: 3 + (i % 2),
      color: ['#c084fc','#a855f7','#d8b4fe'][i % 3],
      up: i % 3 !== 0,
      isMicro: true
    }));
    return [...std, ...micro];
  }, [isTouch]);

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
            // px suffix prevents React from omitting 'px' on numeric 0 — but these are never 0
            width: `${p.size * intensity}px`,
            height: `${p.size * intensity}px`,
            backgroundColor: p.color,
            boxShadow: `0 0 ${6 * intensity}px ${p.color}`,
            opacity: p.isMicro ? 0.9 * Math.min(intensity, 1) : 0.7 * Math.min(intensity, 1),
            animation: `${p.up ? 'float-up' : 'float-down'} ${p.duration}s ${p.delay}s linear infinite`,
          }}
        />
      ))}
    </div>
  );
}

function EnergyOrbs({ phase }: { phase: CardPhase }) {
  const isTouch = useIsTouchDevice();
  const isActive = !['ENTRY','COMPLETE'].includes(phase);
  // On touch devices only render the first 2 orbs (fewer filter:blur layers = less GPU pressure)
  const orbDefs = [
    { color: 'rgba(124,58,237,0.18)', size: '42vmax', x: '20%', y: '25%', anim: 'orb-drift-1', dur: '18s' },
    { color: 'rgba(109,40,217,0.15)', size: '38vmax', x: '75%', y: '60%', anim: 'orb-drift-2', dur: '22s' },
    { color: 'rgba(147,51,234,0.14)', size: '32vmax', x: '50%', y: '80%', anim: 'orb-drift-1', dur: '25s' },
    { color: 'rgba(91,33,182,0.16)', size: '28vmax', x: '30%', y: '70%', anim: 'orb-drift-2', dur: '20s' },
  ];
  const orbs = isTouch ? orbDefs.slice(0, 2) : orbDefs;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-[1]">
      {orbs.map((orb, i) => (
        <div
          key={i}
          className="absolute rounded-full energy-orb"
          style={{
            left: orb.x, top: orb.y,
            width: orb.size, height: orb.size,
            background: `radial-gradient(circle, ${orb.color}, transparent 70%)`,
            filter: 'blur(45px)',
            animation: isActive ? `${orb.anim} ${orb.dur} ease-in-out infinite` : 'none',
            transform: 'translate(-50%,-50%)',
            opacity: isActive ? 1 : 0,
            transition: 'opacity 1s',
            contain: 'strict',
          }}
        />
      ))}
    </div>
  );
}

function FogLayers() {
  // fog-layer class used by mobile CSS to suppress these entirely on narrow screens
  return (
    <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden">
      <div className="absolute rounded-full fog-layer" style={{ width: '60vmax', height: '60vmax', top: '-10%', left: '-10%', backgroundColor: 'rgba(124,58,237,0.04)', filter: 'blur(80px)', animation: 'fog-drift-1 30s infinite' }} />
      <div className="absolute rounded-full fog-layer" style={{ width: '70vmax', height: '70vmax', top: '20%', right: '-15%', backgroundColor: 'rgba(109,40,217,0.03)', filter: 'blur(80px)', animation: 'fog-drift-2 35s infinite' }} />
      <div className="absolute rounded-full fog-layer" style={{ width: '50vmax', height: '50vmax', bottom: '-10%', left: '20%', backgroundColor: 'rgba(91,33,182,0.03)', filter: 'blur(80px)', animation: 'fog-drift-1 25s infinite reverse' }} />
    </div>
  );
}

function FloatingGeometries() {
  const shapes = useMemo(() => {
    return [
      { type: 'hexagon', top: '15%', left: '8%', anim: 'geo-float-1', dur: '20s', delay: '0s', size: 24, stroke: 'rgba(147,51,234,0.18)' },
      { type: 'triangle', top: '70%', left: '12%', anim: 'geo-float-2', dur: '18s', delay: '2s', size: 20, stroke: 'rgba(124,58,237,0.18)' },
      { type: 'diamond', top: '25%', left: '85%', anim: 'geo-float-3', dur: '25s', delay: '5s', size: 30, stroke: 'rgba(192,132,252,0.2)' },
      { type: 'circle', top: '80%', left: '80%', anim: 'geo-float-1', dur: '22s', delay: '1s', size: 35, stroke: 'rgba(192,132,252,0.12)' },
      { type: 'hexagon', top: '45%', left: '5%', anim: 'geo-float-2', dur: '15s', delay: '4s', size: 18, stroke: 'rgba(147,51,234,0.2)' },
      { type: 'triangle', top: '10%', left: '60%', anim: 'geo-float-3', dur: '19s', delay: '7s', size: 25, stroke: 'rgba(124,58,237,0.18)' },
      { type: 'diamond', top: '85%', left: '40%', anim: 'geo-float-1', dur: '24s', delay: '3s', size: 22, stroke: 'rgba(168,85,247,0.2)' },
    ];
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden">
      {shapes.map((s, i) => (
        // floating-geo-item class used by mobile CSS to hide items 5-7
        <div key={i} className="absolute flex items-center justify-center floating-geo-item" style={{ top: s.top, left: s.left, animation: `${s.anim} ${s.dur} ${s.delay} ease-in-out infinite` }}>
          {s.type === 'hexagon' && (
            <svg width={s.size} height={s.size} viewBox="0 0 24 24" fill="none" stroke={s.stroke} strokeWidth="1">
              <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
            </svg>
          )}
          {s.type === 'triangle' && (
            <svg width={s.size} height={s.size} viewBox="0 0 24 24" fill="none" stroke={s.stroke} strokeWidth="1">
              <polygon points="12 2 22 20 2 20" />
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
        </div>
      ))}
    </div>
  );
}

function HudRings({ phase }: { phase: CardPhase }) {
  if (phase === 'ENTRY') return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden">
      <div className="absolute rounded-full" style={{
        top: '40%', left: '20%', width: '80px', height: '80px',
        border: '1px dashed rgba(147,51,234,0.2)',
        animation: 'hud-ring-spin 25s linear infinite'
      }} />
      <div className="absolute rounded-full" style={{
        top: '55%', left: '75%', width: '100px', height: '100px',
        border: '1px dashed rgba(168,85,247,0.2)',
        animation: 'hud-ring-spin 30s linear infinite reverse'
      }} />
    </div>
  );
}

function SparkBurst({ active }: { active: boolean }) {
  // Deterministic values (no Math.random) — prevents hydration mismatch
  const sparks = useMemo(() =>
    Array.from({ length: 16 }, (_, i) => {
      const angle = (Math.PI * 2 / 16) * i;
      const dist = 80 + (i % 5) * 24; // 80, 104, 128, 152, 176 repeating
      return {
        id: i,
        sx: `${Math.cos(angle) * dist}px`,
        sy: `${Math.sin(angle) * dist}px`,
        color: ['#e879f9','#c084fc','#a855f7','#d8b4fe','#9333ea','#7c3aed'][i % 6],
        delay: (i % 4) * 0.04,   // 0, 0.04, 0.08, 0.12
        size: 3 + (i % 4),       // 3, 4, 5, 6
      };
    }),
  []);
  if (!active) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-[25] flex items-center justify-center">
      {sparks.map(s => (
        <div
          key={s.id}
          className="absolute rounded-full"
          style={{
            width: s.size, height: s.size,
            backgroundColor: s.color,
            boxShadow: `0 0 8px ${s.color}`,
            '--sx': s.sx, '--sy': s.sy,
            animation: `spark 0.6s ${s.delay}s ease-out forwards`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function EnergyRing({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-[20] flex items-center justify-center">
      {[0, 0.15, 0.3].map((delay, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 'clamp(100px, 40vw, 200px)',
            height: 'clamp(100px, 40vw, 200px)',
            border: `1px solid rgba(192,132,252,0.5)`,
            animation: `energy-wave 1.5s ${delay}s ease-out forwards`,
          }}
        />
      ))}
    </div>
  );
}

function LightStreaks({ phase }: { phase: CardPhase }) {
  const isActive = !['ENTRY','COMPLETE'].includes(phase);
  if (!isActive) return null;
  
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-[2]">
      {[
        { anim: 'light-streak', top: '20%', left: '-100%', delay: '0s', dur: '10s', rotate: '25deg' },
        { anim: 'light-streak-2', top: '60%', left: '-50%', delay: '4s', dur: '12s', rotate: '-15deg' },
        { anim: 'light-streak', top: '80%', left: '-100%', delay: '2s', dur: '8s', rotate: '35deg' },
      ].map((streak, i) => (
        <div
          key={i}
          className="absolute h-[2px] w-[200%]"
          style={{
            top: streak.top,
            left: streak.left,
            background: 'linear-gradient(to right, transparent, rgba(192,132,252,0.35), transparent)',
            transform: `rotate(${streak.rotate})`,
            transformOrigin: 'center left',
            animation: `${streak.anim} ${streak.dur} ${streak.delay} linear infinite`,
          }}
        />
      ))}
    </div>
  );
}

interface EntryExperienceProps {
  targetMember?: Member | null;
  otherMembers?: Member[];
  onSkip?: () => void;
  /** URL of the member's GIF/avatar image — used as full-screen cover background */
  backgroundGifUrl?: string;
  /** Optional MP4/WebM video URL of pre-rendered card animation loop for hardware video acceleration */
  videoBackgroundUrl?: string;
}

export default function EntryExperience({
  targetMember,
  otherMembers,
  onSkip,
  backgroundGifUrl,
  videoBackgroundUrl,
}: EntryExperienceProps) {
  const [phase, setPhase] = useState<CardPhase>('ENTRY');
  const [selectedMember, setSelectedMember] = useState<Member | null>(targetMember || null);
  const prefersReduced = useReducedMotion();

  const handlePhaseComplete = useCallback((completedPhase: CardPhase) => {
    const idx = PHASE_ORDER.indexOf(completedPhase);
    const next = PHASE_ORDER[idx + 1];
    if (next) setPhase(next);
  }, []);

  useEffect(() => {
    const handleReplay = () => {
      setPhase('ENTRY');
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('replay-animation', handleReplay);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('replay-animation', handleReplay);
      }
    };
  }, []);

  const handleMemberSelected = useCallback((member: Member) => {
    setSelectedMember(member);
  }, []);

  const isRevealPhase = ['AVATAR_REVEAL','PROFILE_EXPAND','COMPLETE'].includes(phase);
  const isProfileVisible = ['CARD_FLIP','AVATAR_REVEAL','PROFILE_EXPAND','COMPLETE'].includes(phase);
  const isShuffling = ['ROTATING_SHUFFLE','SHUFFLE_ACCELERATE'].includes(phase);
  const showBurst = phase === 'CARD_PICK';
  const showRing = ['CARD_PICK','CARD_FLIP'].includes(phase);

  const particleIntensity = isShuffling ? 1.4 : isRevealPhase ? 0.6 : showBurst ? 1.8 : 0.8;

  // Phase indicator dots: memoized to avoid recomputing on every render
  const phaseDots = useMemo(() => PHASE_ORDER.slice(0, -1), []);

  return (
    <div
      className="relative flex flex-col items-center justify-center w-full min-h-screen"
      style={{
        width: '100%',
        height: '100dvh',
        minHeight: '100vh',
        // Background is transparent — the dark overlay div below (z-index:0) is the
        // sole background controller so the GIF at z-index:-1 can always show through.
        // The body element provides the ultimate dark fallback (#05010a).
        background: 'transparent',
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden',
        transform: 'translateZ(0)',
        overflowX: 'hidden',
        touchAction: 'pan-y',
      }}
    >
      {/* ── PRE-RENDERED MP4/WEBM VIDEO BACKGROUND (IF PROVIDED) ── */}
      {videoBackgroundUrl && (
        <video
          src={videoBackgroundUrl}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
            zIndex: -1,
            opacity: 0.5,
            filter: 'blur(12px)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* ── FULL-SCREEN AVATAR GIF COVER BACKGROUND ── */}
      {!videoBackgroundUrl && (backgroundGifUrl || selectedMember?.avatarUrl || targetMember?.avatarUrl) && (
        <img
          src={backgroundGifUrl || selectedMember?.avatarUrl || targetMember?.avatarUrl || ''}
          alt="Avatar GIF Fullscreen Background"
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onLoad={() => {/* GIF loaded — opacity is now controlled by isRevealPhase only */}}
          style={{
            position: 'fixed',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center top',
            zIndex: -1,
            // Post-reveal: high opacity + near-zero blur → member photo is clearly recognizable
            // Pre-reveal: low opacity + heavy blur → ambient glow only, not distracting during shuffle
            opacity: isRevealPhase ? 0.82 : 0.18,
            filter: isRevealPhase
              ? 'blur(0px) brightness(1.12) contrast(1.08) saturate(1.15)'
              : 'blur(10px) brightness(0.85)',
            transform: 'scale(1.03)',
            transition: 'opacity 1.0s ease-in-out, filter 1.0s ease-in-out',
            pointerEvents: 'none',
            willChange: 'opacity, filter',
          }}
        />
      )}

      {/* Dark overlay — always present, controls the visible background colour.
          Before reveal: near-opaque (looks like the original dark gradient).
          After reveal: partially transparent, letting the GIF show through.
          Without backgroundGifUrl: always near-opaque (same visual as before). */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          background: (backgroundGifUrl && isRevealPhase)
            ? 'linear-gradient(135deg, rgba(2,0,6,0.72) 0%, rgba(8,1,22,0.65) 40%, rgba(16,2,40,0.6) 70%, rgba(2,0,6,0.72) 100%)'
            : 'linear-gradient(135deg, rgba(2,0,6,0.97) 0%, rgba(8,1,22,0.96) 40%, rgba(16,2,40,0.96) 70%, rgba(2,0,6,0.97) 100%)',
          transition: 'background 1.4s ease-in-out',
          pointerEvents: 'none',
        }}
      />

      {/* Camera breathing wrapper */}
      <div
        className="absolute inset-0 w-full h-full pointer-events-none z-[1]"
        style={{ animation: 'camera-breathe 12s ease-in-out infinite', overflowX: 'hidden' }}
      >
          
          {/* Expensive blur effects — conditionally suppressed by prefersReduced and mobile CSS */}
          {!prefersReduced && <EnergyOrbs phase={phase} />}
          {!prefersReduced && <FogLayers />}
          {!prefersReduced && <FloatingGeometries />}
          {!prefersReduced && <HudRings phase={phase} />}
          <Particles intensity={particleIntensity} />
          {!prefersReduced && <LightStreaks phase={phase} />}
          
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
              filter: 'blur(45px)',
            }} />
          </motion.div>

          <div className="absolute left-0 right-0 bottom-0 h-[60%] pointer-events-none z-[1] overflow-hidden" style={{
            perspective: '500px',
          }}>
            <div className="absolute inset-0" style={{
              transform: 'rotateX(65deg)',
              transformOrigin: 'top center',
              animation: 'hex-pulse 4s infinite alternate',
            }}>
              <svg width="100%" height="100%">
                <defs>
                  <pattern id="hex-pattern" width="69.282" height="40" patternUnits="userSpaceOnUse" patternTransform="scale(1.2)">
                    <path d="M69.282 10L34.641 30 0 10V-30l34.641-20L69.282-30V10z M69.282 50L34.641 70 0 50V10l34.641-20L69.282 10V50z M34.641 30L0 50v-40l34.641-20L69.282 10V50z" 
                          fill="none" stroke="rgba(168,85,247,0.12)" strokeWidth="0.5"/>
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#hex-pattern)" />
              </svg>
            </div>
          </div>
          
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-auto">
            <CardDeck
              phase={phase}
              onPhaseComplete={handlePhaseComplete}
              onMemberSelected={handleMemberSelected}
              targetMember={targetMember}
              otherMembers={otherMembers}
            />
          </div>

          <AnimatePresence>
            {showBurst && <SparkBurst active={showBurst} />}
          </AnimatePresence>

          <AnimatePresence>
            {showRing && <EnergyRing active={showRing} />}
          </AnimatePresence>

          <div className="pointer-events-auto">
            <ProfileReveal
              member={selectedMember || targetMember || null}
              isVisible={isProfileVisible}
              isComplete={phase === 'COMPLETE'}
            />
          </div>
          
          <WelcomePopup phase={phase} />
          <HudOverlay phase={phase} />

          {/* Vignette gradients — filter:blur removed (gradient alone is sufficient) */}
          <div className="absolute top-0 left-0 right-0 h-[15%] pointer-events-none z-[3]"
            style={{ 
              background: 'linear-gradient(to bottom, rgba(10,1,24,0.5) 0%, transparent 100%)',
            }} 
          />

          <div className="absolute bottom-0 left-0 right-0 h-[15%] pointer-events-none z-[3]"
            style={{ 
              background: 'linear-gradient(to top, rgba(10,1,24,0.5) 0%, transparent 100%)',
            }} 
          />
      </div>

      {/* Phase progress dots */}
      <motion.div
        className="absolute bottom-4 left-1/2 flex items-center gap-1.5 z-40"
        initial={{ x: '-50%' }}
        animate={{ x: '-50%', opacity: phase === 'COMPLETE' ? 0 : 0.3 }}
      >
        {phaseDots.map(p => (
          <motion.div
            key={p}
            className="rounded-full transition-all"
            animate={{
              width: phase === p ? 12 : 4,
              height: 4,
              backgroundColor: phase === p ? '#c084fc' : 'rgba(255,255,255,0.3)',
              // boxShadow removed from Framer Motion animate — moved to static conditional style
            }}
            style={{
              boxShadow: phase === p ? '0 0 8px rgba(192,132,252,0.8)' : undefined,
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          />
        ))}
      </motion.div>
    </div>
  );
}
