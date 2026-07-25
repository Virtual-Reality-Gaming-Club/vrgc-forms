'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

interface RatingRevealProps {
  rating: number | undefined;
  isRevealed: boolean;
}

export default function RatingReveal({ rating, isRevealed }: RatingRevealProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const [isGlitching, setIsGlitching] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (rating === undefined || !isRevealed) {
      setDisplayValue(0);
      setIsGlitching(false);
      return;
    }
    if (shouldReduceMotion) {
      setDisplayValue(rating);
      return;
    }

    let startTime = 0;
    const duration = 700;
    const delay = 300;
    
    setIsGlitching(true);
    const glitchTimer = setTimeout(() => setIsGlitching(false), 1000);

    const animate = (time: number) => {
      if (!startTime) startTime = time;
      const elapsed = time - startTime;

      if (elapsed < delay) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      const progress = Math.min((elapsed - delay) / duration, 1);
      const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayValue(rating * easeOut);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(rating);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(glitchTimer);
    };
  }, [rating, isRevealed, shouldReduceMotion]);

  if (rating === undefined) {
    return (
      <div className="flex items-center justify-center py-1">
        <span
          className="font-mono uppercase"
          style={{ 
            fontSize: 'clamp(0.45rem, 1.6vw, 0.55rem)', 
            letterSpacing: '0.3em',
            color: 'rgba(0,240,255,0.3)'
          }}
        >
          UNRATED
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 relative">
      {/* Glow ring */}
      {isRevealed && (
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 0.5, 0], scale: [0, 1.2, 2.5] }}
          transition={{ duration: 1.2, delay: 0.3, ease: 'easeOut' }}
          className="absolute inset-0 m-auto rounded-full pointer-events-none"
          style={{ width: '80px', height: '80px', border: '1px solid rgba(0,240,255,0.4)' }}
        />
      )}

      {/* POWER LEVEL label */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 5 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        <span
          className="font-mono uppercase block mb-[-0.2rem]"
          style={{
            fontSize: 'clamp(0.45rem, 1.6vw, 0.55rem)',
            letterSpacing: '0.3em',
            color: 'rgba(0,240,255,0.4)',
          }}
        >
          POWER LEVEL
        </span>
      </motion.div>

      {/* Rating number */}
      <motion.div
        initial={!shouldReduceMotion ? { opacity: 0, scale: 0.8 } : false}
        animate={isRevealed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        transition={{ delay: 0.3, duration: 0.4, ease: 'easeOut' }}
        className="relative z-10"
      >
        <span
          className={`font-orbitron font-bold text-transparent bg-clip-text ${isRevealed && isGlitching ? 'animate-glitch-text' : ''}`}
          style={{
            backgroundImage: 'linear-gradient(to right, #00f0ff, #a855f7)',
            fontSize: 'clamp(1.6rem, 6vw, 2.5rem)',
            textShadow: '0 0 25px rgba(0,240,255,0.4)',
            display: 'inline-block'
          }}
        >
          {displayValue.toFixed(1)}
        </span>
      </motion.div>

      {/* Stars */}
      <div
        className="relative inline-flex leading-none gap-0.5"
        style={{ fontSize: 'clamp(0.8rem, 2.8vw, 1rem)' }}
      >
        {[1, 2, 3, 4, 5].map((star, i) => {
          const isFilled = star <= Math.round(rating);
          return (
            <motion.span
              key={star}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={isRevealed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
              transition={{ delay: i * 0.1, duration: 0.3 }}
              style={
                isFilled
                  ? { color: '#00f0ff', filter: 'drop-shadow(0 0 6px rgba(0,240,255,0.6))' }
                  : { color: 'rgba(0,240,255,0.12)' }
              }
            >
              ★
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}
