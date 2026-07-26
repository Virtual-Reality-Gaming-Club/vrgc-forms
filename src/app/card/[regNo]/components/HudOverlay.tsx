'use client';

import React, { useEffect, useState } from 'react';
import type { CardPhase } from './AnimatedCard';
import { motion, AnimatePresence } from 'framer-motion';

interface HudOverlayProps {
  phase: CardPhase;
}

const PHASE_ORDER: CardPhase[] = [
  'ENTRY', 'DECK_APPEAR', 'ROTATING_SHUFFLE', 'SHUFFLE_ACCELERATE',
  'COLLAPSE', 'CARD_PICK', 'CARD_FLIP', 'AVATAR_REVEAL', 'PROFILE_EXPAND', 'COMPLETE',
];

const HEX_DATA = '0A F3 7B 00 C1 E8 2D 9F 4A B6 1C D7 3E 88 5F 02'.split(' ');
const DATA_COLUMN = [...Array(20)].map(() => HEX_DATA).flat();

export default function HudOverlay({ phase }: HudOverlayProps) {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const getStatusText = (p: CardPhase) => {
    switch (p) {
      case 'ENTRY': return 'INITIALIZING...';
      case 'DECK_APPEAR': return 'DECK LOADED';
      case 'ROTATING_SHUFFLE':
      case 'SHUFFLE_ACCELERATE': return 'SHUFFLING...';
      case 'COLLAPSE': return 'SELECTING...';
      case 'CARD_PICK': return 'CARD SELECTED';
      case 'CARD_FLIP': return 'REVEALING...';
      case 'AVATAR_REVEAL':
      case 'PROFILE_EXPAND': return 'PROFILE LOADED';
      case 'COMPLETE': return 'SYSTEM READY';
      default: return 'ACTIVE';
    }
  };

  const phaseIndex = PHASE_ORDER.indexOf(phase);
  const progressPercent = Math.max(0, Math.min(100, (phaseIndex / (PHASE_ORDER.length - 1)) * 100));
  const isComplete = phase === 'COMPLETE';
  const isEntry = phase === 'ENTRY';

  const statusColor = isEntry ? '#9ca3af' : isComplete ? '#00ff88' : '#c084fc';

  return (
    <div className="fixed inset-0 pointer-events-none z-[45]">
      {/* Scanline overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(168,85,247,0.015) 2px, rgba(168,85,247,0.015) 4px)',
          opacity: 0.4,
        }}
      />

      {/* Data stream columns */}
      {!isEntry && (
        <>
          <div className="absolute left-[4px] top-1/2 -translate-y-1/2 h-[60vh] w-[14px] overflow-hidden hidden sm:flex justify-center pointer-events-none">
            <div 
              className="flex flex-col text-center font-mono"
              style={{
                fontSize: '7px',
                lineHeight: '1.5',
                color: 'rgba(168,85,247,0.08)',
                animation: 'data-stream 20s linear infinite'
              }}
            >
              {[...DATA_COLUMN, ...DATA_COLUMN].map((hex, i) => (
                <div key={i}>{hex}</div>
              ))}
            </div>
          </div>
          <div className="absolute right-[4px] top-1/2 -translate-y-1/2 h-[60vh] w-[14px] overflow-hidden hidden sm:flex justify-center pointer-events-none">
            <div 
              className="flex flex-col text-center font-mono"
              style={{
                fontSize: '7px',
                lineHeight: '1.5',
                color: 'rgba(168,85,247,0.08)',
                animation: 'data-stream 20s linear infinite'
              }}
            >
              {[...DATA_COLUMN, ...DATA_COLUMN].map((hex, i) => (
                <div key={i}>{hex}</div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Corner brackets */}
      {[
        { pos: 'top-[10px] left-[10px] md:top-[14px] md:left-[14px]', borders: 'border-t border-l', dotPos: '-top-[1.5px] -left-[1.5px]' },
        { pos: 'top-[10px] right-[10px] md:top-[14px] md:right-[14px]', borders: 'border-t border-r', dotPos: '-top-[1.5px] -right-[1.5px]' },
        { pos: 'bottom-[10px] left-[10px] md:bottom-[14px] md:left-[14px]', borders: 'border-b border-l', dotPos: '-bottom-[1.5px] -left-[1.5px]' },
        { pos: 'bottom-[10px] right-[10px] md:bottom-[14px] md:right-[14px]', borders: 'border-b border-r', dotPos: '-bottom-[1.5px] -right-[1.5px]' },
      ].map((c, i) => (
        <div
          key={i}
          className={`absolute ${c.pos} w-[22px] h-[22px] md:w-[32px] md:h-[32px] ${c.borders}`}
          style={{
            borderColor: 'rgba(168,85,247,0.4)',
            borderWidth: '1.5px',
            animation: 'corner-pulse 3s ease-in-out infinite',
          }}
        >
          <div 
            className={`absolute ${c.dotPos} w-[3px] h-[3px] rounded-full`} 
            style={{ backgroundColor: 'rgba(192,132,252,0.6)' }} 
          />
        </div>
      ))}

      {/* Status block */}
      <div
        className="absolute flex items-center gap-1.5"
        style={{
          top: 'clamp(36px, 5vh, 52px)',
          left: 'clamp(10px, 2vw, 18px)',
        }}
      >
        <div
          className="rounded-full shrink-0"
          style={{
            width: '5px',
            height: '5px',
            backgroundColor: statusColor,
            boxShadow: isEntry ? 'none' : `0 0 6px ${statusColor}`,
            animation: isEntry ? 'none' : 'status-blink 2s ease-in-out infinite',
          }}
        />
        <span
          className="font-mono uppercase"
          style={{
            fontSize: 'clamp(0.4rem, 1.2vw, 0.5rem)',
            letterSpacing: '0.12em',
            color: statusColor,
            animation: 'hud-flicker 4s ease-in-out infinite',
          }}
        >
          {getStatusText(phase)}
        </span>
      </div>

      {/* Timestamp */}
      <div
        className="absolute flex flex-col items-end"
        style={{
          top: 'clamp(36px, 5vh, 52px)',
          right: 'clamp(10px, 2vw, 18px)',
        }}
      >
        <span
          className="font-mono"
          style={{ fontSize: 'clamp(0.35rem, 1vw, 0.45rem)', color: 'rgba(192,132,252,0.45)', letterSpacing: '0.15em' }}
        >
          VRGC NEXUS v2.0
        </span>
        <span
          className="font-mono"
          style={{ fontSize: 'clamp(0.4rem, 1.2vw, 0.5rem)', color: 'rgba(168,85,247,0.35)', letterSpacing: '0.12em' }}
        >
          {time}
        </span>
      </div>

      {/* Progress bar */}
      <AnimatePresence>
        {!isComplete && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.4 }}
            className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5"
            style={{ bottom: 'clamp(16px, 3vh, 28px)' }}
          >
            <div
              className="rounded-full overflow-hidden"
              style={{
                width: 'clamp(100px, 25vw, 180px)',
                height: '2px',
                background: 'rgba(168,85,247,0.12)',
              }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #a855f7, #c084fc, #e879f9)' }}
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
              />
            </div>
            <div className="flex flex-col items-center">
              <span
                className="font-mono uppercase"
                style={{
                  fontSize: 'clamp(0.3rem, 0.9vw, 0.4rem)',
                  color: 'rgba(192,132,252,0.4)',
                  letterSpacing: '0.15em',
                }}
              >
                {phase.replace(/_/g, ' ')}
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.3rem',
                  color: 'rgba(168,85,247,0.3)',
                  marginTop: '2px',
                }}
              >
                {phaseIndex + 1}/{PHASE_ORDER.length}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
