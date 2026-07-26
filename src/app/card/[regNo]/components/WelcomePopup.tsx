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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isPreloading) return;

    // Fast, lightweight 1.2s Welcome Banner
    const t1 = setTimeout(() => setVisible(true), 150);
    const t2 = setTimeout(() => setVisible(false), 1400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isPreloading]);

  useEffect(() => {
    const isIntro = ['ENTRY', 'DECK_APPEAR', 'ROTATING_SHUFFLE', 'SHUFFLE_ACCELERATE'].includes(phase);
    if (!isIntro) {
      setVisible(false);
    }
  }, [phase]);

  return (
    <AnimatePresence>
      {visible && (
        <div className="fixed inset-0 pointer-events-none z-[35] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex flex-col items-center justify-center px-6 py-4 rounded-2xl relative overflow-hidden text-center max-w-[90vw]"
            style={{
              background: '#070212',
              border: '1px solid rgba(168, 85, 247, 0.55)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.9)',
            }}
          >
            <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-[#c084fc] to-transparent" />

            <span className="font-mono text-[9px] sm:text-[11px] uppercase tracking-[0.3em] mb-1 text-[#c084fc]/90 font-semibold">
              // VIRTUAL REALITY & GAMING CLUB
            </span>

            <h1 className="font-orbitron font-extrabold text-2xl sm:text-4xl md:text-5xl uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#d8b4fe] via-[#c084fc] to-[#a855f7] leading-tight">
              WELCOME TO VRGC
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
