'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CardPhase } from './AnimatedCard';

interface WelcomePopupProps {
  phase: CardPhase;
  isPreloading?: boolean;
}

type TextStep = 'WELCOME' | 'TO' | 'VRGC' | null;

export default function WelcomePopup({ phase, isPreloading = false }: WelcomePopupProps) {
  const [activeWord, setActiveWord] = useState<TextStep>(null);

  useEffect(() => {
    if (isPreloading) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    // 1. WELCOME
    timers.push(setTimeout(() => setActiveWord('WELCOME'), 100));
    timers.push(setTimeout(() => setActiveWord(null), 550));

    // 2. TO
    timers.push(setTimeout(() => setActiveWord('TO'), 650));
    timers.push(setTimeout(() => setActiveWord(null), 1050));

    // 3. VRGC
    timers.push(setTimeout(() => setActiveWord('VRGC'), 1150));
    timers.push(setTimeout(() => setActiveWord(null), 1850));

    return () => timers.forEach(clearTimeout);
  }, [isPreloading]);

  useEffect(() => {
    const isIntro = ['ENTRY', 'DECK_APPEAR', 'ROTATING_SHUFFLE', 'SHUFFLE_ACCELERATE'].includes(phase);
    if (!isIntro) {
      setActiveWord(null);
    }
  }, [phase]);

  return (
    <AnimatePresence mode="wait">
      {activeWord && (
        <div className="fixed inset-0 pointer-events-none z-[35] flex items-center justify-center">
          <motion.div
            key={activeWord}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'linear' }}
            className="flex flex-col items-center justify-center px-8 py-5 rounded-2xl relative overflow-hidden text-center"
            style={{
              background: '#070212',
              border: '1px solid rgba(168, 85, 247, 0.55)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.9)',
            }}
          >
            <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-[#c084fc] to-transparent" />

            <span className="font-mono text-[9px] sm:text-[11px] uppercase tracking-[0.3em] mb-1 text-[#c084fc]/90 font-semibold">
              {activeWord === 'WELCOME' ? '// SYSTEM_INIT' : activeWord === 'TO' ? '// ACCESS_GATEWAY' : '// VIRTUAL REALITY & GAMING CLUB'}
            </span>

            <h1 className="font-orbitron font-black text-3xl sm:text-5xl md:text-6xl uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#d8b4fe] via-[#c084fc] to-[#a855f7] leading-tight">
              {activeWord}
            </h1>

            <div className="absolute top-2 left-2 w-2.5 h-2.5 border-t-2 border-l-2 border-[#c084fc]/70" />
            <div className="absolute top-2 right-2 w-2.5 h-2.5 border-t-2 border-r-2 border-[#c084fc]/70" />
            <div className="absolute bottom-2 left-2 w-2.5 h-2.5 border-b-2 border-l-2 border-[#c084fc]/70" />
            <div className="absolute bottom-2 right-2 w-2.5 h-2.5 border-b-2 border-r-2 border-[#c084fc]/70" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
