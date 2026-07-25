'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { CardPhase } from './AnimatedCard';

interface WelcomePopupProps {
  phase: CardPhase;
}

type TextStep = 'WELCOME' | 'TO' | 'VRGC' | null;

export default function WelcomePopup({ phase }: WelcomePopupProps) {
  const [activeWord, setActiveWord] = useState<TextStep>(null);
  const [visible, setVisible] = useState(false);
  const [showBlast, setShowBlast] = useState(false);

  useEffect(() => {
    // Explicit timeline guarantees each word shows for 1.0s and fades to opacity 0 before next text
    // T = 0.3s  -> WELCOME (opacity 1)
    // T = 1.3s  -> WELCOME fades to opacity 0 (duration 0.35s)
    // T = 1.8s  -> TO (opacity 1)
    // T = 2.8s  -> TO fades to opacity 0 (duration 0.35s)
    // T = 3.3s  -> VRGC (opacity 1)
    // T = 3.9s  -> SUDDEN CENTER ENERGY BLAST & GIF CANVAS TRIGGER (<1s, behind VRGC)
    // T = 4.3s  -> VRGC fades to opacity 0
    // T = 4.8s  -> null (complete)

    const timers: ReturnType<typeof setTimeout>[] = [];

    // 1. WELCOME
    timers.push(setTimeout(() => { setActiveWord('WELCOME'); setVisible(true); }, 300));
    timers.push(setTimeout(() => { setVisible(false); }, 1300));

    // 2. TO
    timers.push(setTimeout(() => { setActiveWord('TO'); setVisible(true); }, 1800));
    timers.push(setTimeout(() => { setVisible(false); }, 2800));

    // 3. VRGC
    timers.push(setTimeout(() => { setActiveWord('VRGC'); setVisible(true); }, 3300));
    
    // Sudden Radial Energy Blast + Background GIF Canvas Trigger (T = 3.9s)
    timers.push(setTimeout(() => { setShowBlast(true); }, 3900));
    
    timers.push(setTimeout(() => { setVisible(false); }, 4300));
    timers.push(setTimeout(() => { setShowBlast(false); }, 4650));

    // Complete
    timers.push(setTimeout(() => { setActiveWord(null); }, 4800));

    return () => timers.forEach(clearTimeout);
  }, []);

  // Hide if intro completes
  useEffect(() => {
    const isIntro = ['ENTRY', 'DECK_APPEAR', 'ROTATING_SHUFFLE', 'SHUFFLE_ACCELERATE'].includes(phase);
    if (!isIntro) {
      setActiveWord(null);
      setVisible(false);
      setShowBlast(false);
    }
  }, [phase]);

  return (
    <>
      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* ═══ SUDDEN CENTER ENERGY BLAST & GIF CANVAS OVERLAY (<1s)        ═══ */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {showBlast && (
        <div className="fixed inset-0 pointer-events-none z-[30] flex items-center justify-center overflow-hidden">
          {/* Transparent GIF Canvas Container for testing background blast GIF */}
          <div
            id="gif-blast-canvas"
            className="absolute inset-0 w-full h-full pointer-events-none bg-transparent"
            style={{
              /* Insert background GIF image or canvas renderer here when testing */
              backgroundImage: 'none',
              backgroundPosition: 'center',
              backgroundSize: 'cover',
            }}
          />

          {/* Explosive Radial Energy Wave expanding from center across full screen */}
          <motion.div
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 4.5, opacity: [1, 0.9, 0] }}
            transition={{ duration: 0.55, ease: [0.11, 0, 0.5, 1] }}
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '50vmin',
              height: '50vmin',
              background: 'radial-gradient(circle, rgba(192, 132, 252, 0.85) 0%, rgba(168, 85, 247, 0.6) 35%, rgba(124, 58, 237, 0.35) 60%, transparent 80%)',
              boxShadow: '0 0 120px rgba(168, 85, 247, 0.9), inset 0 0 60px rgba(216, 180, 254, 0.8)',
            }}
          />

          {/* Secondary shockwave ring */}
          <motion.div
            initial={{ scale: 0, opacity: 0.8 }}
            animate={{ scale: 5.2, opacity: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: 'easeOut' }}
            className="absolute rounded-full border-2 border-[#c084fc] pointer-events-none"
            style={{
              width: '40vmin',
              height: '40vmin',
              boxShadow: '0 0 80px rgba(192, 132, 252, 0.8)',
            }}
          />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* ═══ TEXT POPUP CARD SEQUENCE ("WELCOME" -> "TO" -> "VRGC")       ═══ */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeWord && (
        <div className="fixed inset-0 pointer-events-none z-[35] flex items-center justify-center">
          <motion.div
            key={activeWord}
            initial={{ opacity: 0, scale: 0.8, y: 15, filter: 'blur(8px)' }}
            animate={{
              opacity: visible ? 1 : 0,
              scale: visible ? 1 : 1.08,
              y: visible ? 0 : -15,
              filter: visible ? 'blur(0px)' : 'blur(10px)',
            }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center justify-center px-8 py-6 rounded-2xl relative overflow-hidden"
            style={{
              background:
                activeWord === 'WELCOME'
                  ? 'rgba(20, 8, 38, 0.88)'
                  : activeWord === 'TO'
                  ? 'rgba(26, 10, 48, 0.88)'
                  : 'rgba(30, 8, 54, 0.92)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(168, 85, 247, 0.55)',
              boxShadow: '0 0 45px rgba(168, 85, 247, 0.4), inset 0 0 20px rgba(192, 132, 252, 0.15)',
            }}
          >
            {/* Top HUD accent line */}
            <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-[#c084fc] to-transparent" />

            {/* Subtitle */}
            <span className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.3em] mb-1.5 text-[#c084fc]/80">
              {activeWord === 'WELCOME' ? '// SYSTEM_INIT' : activeWord === 'TO' ? '// ACCESS_GATEWAY' : '// VIRTUAL REALITY & GAMING CLUB'}
            </span>

            {/* Main Word */}
            <h1
              className="font-orbitron font-black text-4xl sm:text-6xl md:text-7xl uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#d8b4fe] via-[#c084fc] to-[#a855f7]"
              style={{
                filter: 'drop-shadow(0 0 30px rgba(168, 85, 247, 0.85))',
              }}
            >
              {activeWord}
            </h1>

            {/* Corner Accents */}
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-[#c084fc]/70" />
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-[#c084fc]/70" />
            <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-[#c084fc]/70" />
            <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-[#c084fc]/70" />
          </motion.div>
        </div>
      )}
    </>
  );
}
