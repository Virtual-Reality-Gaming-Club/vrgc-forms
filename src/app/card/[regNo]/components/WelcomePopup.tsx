'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { CardPhase } from './AnimatedCard';

interface WelcomePopupProps {
  phase: CardPhase;
  isPreloading?: boolean;
}

type TextStep = 'WELCOME' | 'TO' | 'VRGC' | null;

export default function WelcomePopup({ phase, isPreloading = false }: WelcomePopupProps) {
  const [activeWord, setActiveWord] = useState<TextStep>(null);
  const [visible, setVisible] = useState(false);
  const [showBlast, setShowBlast] = useState(false);

  useEffect(() => {
    if (isPreloading) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    // 1. WELCOME
    timers.push(setTimeout(() => { setActiveWord('WELCOME'); setVisible(true); }, 200));
    timers.push(setTimeout(() => { setVisible(false); }, 1100));

    // 2. TO
    timers.push(setTimeout(() => { setActiveWord('TO'); setVisible(true); }, 1400));
    timers.push(setTimeout(() => { setVisible(false); }, 2100));

    // 3. VRGC (Extended prominent display duration)
    timers.push(setTimeout(() => { setActiveWord('VRGC'); setVisible(true); }, 2400));
    timers.push(setTimeout(() => { setShowBlast(true); }, 3800));
    timers.push(setTimeout(() => { setVisible(false); }, 4400));
    timers.push(setTimeout(() => { setShowBlast(false); }, 4750));

    // Complete
    timers.push(setTimeout(() => { setActiveWord(null); }, 4900));

    return () => timers.forEach(clearTimeout);
  }, [isPreloading]);

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
      {showBlast && (
        <div className="fixed inset-0 pointer-events-none z-[30] flex items-center justify-center overflow-hidden">
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
            <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-[#c084fc] to-transparent" />

            <span className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.3em] mb-1.5 text-[#c084fc]/80">
              {activeWord === 'WELCOME' ? '// SYSTEM_INIT' : activeWord === 'TO' ? '// ACCESS_GATEWAY' : '// VIRTUAL REALITY & GAMING CLUB'}
            </span>

            <h1
              className="font-orbitron font-black text-4xl sm:text-6xl md:text-7xl uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#d8b4fe] via-[#c084fc] to-[#a855f7]"
              style={{
                filter: 'drop-shadow(0 0 30px rgba(168, 85, 247, 0.85))',
              }}
            >
              {activeWord}
            </h1>

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
