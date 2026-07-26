'use client';

import React, { useMemo } from 'react';
import { motion, useReducedMotion, TargetAndTransition } from 'framer-motion';

export type CardPhase =
  | 'ENTRY'
  | 'DECK_APPEAR'
  | 'ROTATING_SHUFFLE'
  | 'SHUFFLE_ACCELERATE'
  | 'COLLAPSE'
  | 'CARD_PICK'
  | 'CARD_FLIP'
  | 'AVATAR_REVEAL'
  | 'PROFILE_EXPAND'
  | 'COMPLETE';

export interface OrbitalPosition {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotateZ: number;
  rotateX?: number;
  rotateY?: number;
  zIndex: number;
}

interface AnimatedCardProps {
  index: number;
  totalCards: number;
  isSelected: boolean;
  phase: CardPhase;
  orbitalPosition: OrbitalPosition;
  avatarUrl?: string;
  children?: React.ReactNode;
}

export const AnimatedCard: React.FC<AnimatedCardProps> = ({
  index,
  totalCards,
  isSelected,
  phase,
  orbitalPosition,
  avatarUrl,
  children,
}) => {
  const prefersReduced = useReducedMotion();

  const revealX = 0;
  const revealY = 40;

  const animateState = useMemo((): TargetAndTransition => {
    if (prefersReduced) {
      const flipped = ['CARD_FLIP', 'AVATAR_REVEAL', 'PROFILE_EXPAND', 'COMPLETE'].includes(phase);
      if (flipped) {
        return isSelected
          ? { x: revealX, y: revealY, scale: 1.05, opacity: 1, rotateY: 180, rotateZ: 0, rotateX: 0 }
          : { x: 0, y: 0, scale: 0.8, opacity: 0, rotateY: 0, rotateZ: 0, rotateX: 0 };
      }
      return { x: 0, y: 0, scale: 1, opacity: 1, rotateY: 0, rotateZ: 0, rotateX: 0 };
    }

    switch (phase) {
      case 'ENTRY':
        return {
          x: 0,
          y: 500 + index * 25,
          scale: 0.6,
          opacity: 0,
          rotateY: 0,
          rotateZ: (index - totalCards / 2) * 4,
          rotateX: 0,
          transition: { duration: 0 },
        };

      case 'DECK_APPEAR':
        return {
          x: (index - totalCards / 2) * 1.8,
          y: index * -2.5,
          scale: 1 - index * 0.012,
          opacity: 1,
          rotateY: 0,
          rotateZ: (index - totalCards / 2) * 0.6,
          rotateX: 0,
          transition: {
            delay: index * 0.055,
            type: 'spring' as const,
            stiffness: 300,
            damping: 22,
          },
        };

      case 'ROTATING_SHUFFLE':
      case 'SHUFFLE_ACCELERATE':
        return {
          x: orbitalPosition.x,
          y: orbitalPosition.y,
          scale: orbitalPosition.scale,
          opacity: orbitalPosition.opacity,
          rotateZ: orbitalPosition.rotateZ,
          // Clamp to ±75° — prevents front face (member photo) from ever showing during shuffle
          rotateY: Math.max(-75, Math.min(75, orbitalPosition.x * 0.08)),
          rotateX: orbitalPosition.y * 0.12,
          transition: {
            type: 'spring' as const,
            stiffness: 180,
            damping: 16,
            mass: 0.6,
          },
        };

      case 'COLLAPSE':
        return {
          x: (index - totalCards / 2) * 1,
          y: index * -1.8,
          scale: 1 - index * 0.01,
          opacity: 1,
          rotateZ: 0,
          rotateY: 0,
          rotateX: 0,
          transition: {
            type: 'spring' as const,
            stiffness: 300,
            damping: 26,
          },
        };

      case 'CARD_PICK':
        return isSelected
          ? {
              x: 0,
              y: -80,
              scale: 1.18,
              opacity: 1,
              rotateZ: 0,
              rotateY: 0,
              rotateX: -6,
              transition: {
                type: 'spring' as const,
                stiffness: 400,
                damping: 18,
                delay: 0.12,
              },
            }
          : {
              x: (index - totalCards / 2) * 35,
              y: 20 + index * 8,
              scale: 0.55,
              // Replaced blur(3px) with lower opacity — avoids full GPU raster invalidation
              opacity: 0.1,
              rotateZ: 0,
              rotateY: 0,
              rotateX: 15,
              transition: {
                type: 'spring' as const,
                stiffness: 200,
                damping: 28,
              },
            };

      case 'CARD_FLIP':
        return isSelected
          ? {
              x: revealX,
              y: revealY,
              scale: 1.18,
              opacity: 1,
              rotateZ: 0,
              rotateY: 180,
              rotateX: 0,
              transition: {
                type: 'spring' as const,
                stiffness: 140,
                damping: 15,
                mass: 1.8,
              },
            }
          : {
              x: (index - totalCards / 2) * 40,
              y: 30,
              scale: 0.5,
              opacity: 0.08,
              rotateZ: 0,
              rotateY: 0,
              rotateX: 18,
              transition: { duration: 0.5 },
            };

      case 'AVATAR_REVEAL':
      case 'PROFILE_EXPAND':
        return isSelected
          ? {
              x: revealX,
              y: revealY,
              scale: 1.08,
              opacity: 1,
              rotateZ: 0,
              rotateY: 180,
              rotateX: 0,
              transition: {
                type: 'spring' as const,
                stiffness: 200,
                damping: 25,
              },
            }
          : {
              x: (index - totalCards / 2) * 45,
              y: 35 + Math.sin(index) * 10,
              scale: 0.45,
              opacity: 0.07,
              rotateZ: (index - totalCards / 2) * 3,
              rotateY: 0,
              rotateX: 20,
              transition: { duration: 0.3 },
            };

      case 'COMPLETE':
        return isSelected
          ? {
              x: revealX,
              y: revealY,
              scale: 1.08,
              opacity: 1,
              rotateZ: 0,
              rotateY: 180,
              rotateX: 0,
              transition: {
                type: 'spring' as const,
                stiffness: 180,
                damping: 25,
              },
            }
          : {
              x: (index - totalCards / 2) * 45,
              y: 35 + Math.sin(index) * 10,
              scale: 0.4,
              opacity: 0.06,
              rotateZ: (index - totalCards / 2) * 3,
              rotateY: 0,
              rotateX: 20,
              transition: { duration: 0.2 },
            };

      default:
        return { x: 0, y: 0, scale: 1, opacity: 1, rotateY: 0, rotateZ: 0, rotateX: 0 };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isSelected, orbitalPosition.x, orbitalPosition.y, orbitalPosition.scale, orbitalPosition.opacity, orbitalPosition.rotateZ, prefersReduced, index, totalCards]);

  const isActive =
    isSelected &&
    ['CARD_PICK', 'CARD_FLIP', 'AVATAR_REVEAL', 'PROFILE_EXPAND', 'COMPLETE'].includes(phase);
  const isRevealed =
    isSelected && ['AVATAR_REVEAL', 'PROFILE_EXPAND', 'COMPLETE'].includes(phase);
  const isOrbiting = phase === 'ROTATING_SHUFFLE' || phase === 'SHUFFLE_ACCELERATE';
  const baseZIndex = isOrbiting ? orbitalPosition.zIndex : totalCards - index;
  const isIdleFloat = isSelected && phase === 'COMPLETE';

  return (
    <motion.div
      className={isIdleFloat ? 'animate-card-float' : ''}
      initial={
        prefersReduced
          ? { opacity: 0 }
          : {
              y: 500 + index * 25,
              scale: 0.6,
              opacity: 0,
              rotateY: 0,
              rotateZ: (index - totalCards / 2) * 4,
              rotateX: 0,
            }
      }
      animate={animateState}
      style={{
        position: 'absolute',
        width: 'clamp(160px, 52vw, 280px)',
        aspectRatio: '2 / 3',
        transformStyle: 'preserve-3d',
        // Only include filter in willChange when it's actually animated (removed — no longer used)
        willChange: 'transform, opacity',
        zIndex: isActive ? totalCards + 10 : baseZIndex,
      }}
    >
      {/* ═══ FRONT FACE ═══ */}
      <div
        className="absolute inset-0 rounded-2xl overflow-hidden"
        style={{
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          transform: 'rotateY(180deg)',
        }}
      >
        {isRevealed && (
          <div
            className="absolute inset-[-2px] rounded-[18px] pointer-events-none z-0"
            style={{
              background: 'conic-gradient(from 0deg, #c084fc, #a855f7, #7c3aed, #c084fc)',
              animation: 'avatar-ring-spin 4s linear infinite',
            }}
          />
        )}
        
        <div className="absolute inset-0 z-10 rounded-2xl overflow-hidden">
          {children}

          {/* Holographic overlay (only when revealed) */}
          {isRevealed && (
            <>
              <div
                className="absolute inset-0 pointer-events-none rounded-2xl"
                style={{
                  background: `linear-gradient(
                    125deg,
                    transparent 0%, transparent 22%,
                    rgba(216,180,254,0.12) 25%,
                    rgba(192,132,252,0.12) 28%,
                    transparent 32%, transparent 68%,
                    rgba(168,85,247,0.12) 72%,
                    rgba(216,180,254,0.12) 75%,
                    transparent 78%, transparent 100%
                  )`,
                  backgroundSize: '250% 250%',
                  animation: 'holographic-shift 4s ease-in-out infinite',
                  mixBlendMode: 'screen',
                  zIndex: 30,
                }}
              />
              <div
                className="absolute inset-0 pointer-events-none rounded-2xl"
                style={{
                  background: `linear-gradient(
                    45deg,
                    transparent 0%, transparent 20%,
                    rgba(168,85,247,0.1) 23%,
                    rgba(124,58,237,0.1) 26%,
                    transparent 30%, transparent 70%,
                    rgba(168,85,247,0.1) 73%,
                    rgba(124,58,237,0.1) 76%,
                    transparent 80%, transparent 100%
                  )`,
                  backgroundSize: '300% 300%',
                  animation: 'holographic-shift 6s ease-in-out infinite reverse',
                  mixBlendMode: 'screen',
                  zIndex: 31,
                }}
              />
            </>
          )}

          {isActive && (
            <div
              className="absolute pointer-events-none z-40"
              style={{
                top: '10%',
                right: '10%',
                width: '30px',
                height: '30px',
                background: 'radial-gradient(circle, rgba(168,85,247,0.4) 0%, transparent 70%)',
                // blur removed — replaced with stronger radial opacity; saves a GPU raster layer per card
                opacity: 0.6,
                animation: 'neon-pulse 2s infinite',
              }}
            />
          )}
        </div>
      </div>

      {/* ═══ BACK FACE ═══ */}
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
      >
        {/* Active glow: replaced blur(30px) filter div with box-shadow on the card wrapper.
            box-shadow is composited by the browser without a raster invalidation. */}
        <div
          className={`absolute inset-0 rounded-2xl flex items-center justify-center overflow-hidden ${isActive ? 'animate-glow-bloom' : ''}`}
          style={{
            backgroundColor: '#05020c',
            border: isActive ? '1.5px solid #c084fc' : '1.5px solid rgba(168, 85, 247, 0.35)',
            boxShadow: isActive
              ? '0 0 25px rgba(168,85,247,0.5), 0 8px 32px rgba(0,0,0,0.85)'
              : '0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(192,132,252,0.1)',
            transition: 'border-color 0.5s ease-in-out',
          }}
        >
          {/* Uploaded Avatar image/GIF back background */}
          {avatarUrl ? (
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none rounded-2xl">
              <img 
                src={avatarUrl} 
                alt="Card Back Avatar" 
                className="w-full h-full object-cover opacity-90 brightness-110 contrast-105"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-[#05010a]/30 bg-gradient-to-b from-transparent via-[#05010a]/40 to-[#05010a]/80" />
            </div>
          ) : (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                opacity: 0.08,
                backgroundImage: `
                  repeating-linear-gradient(45deg, rgba(168,85,247,0.5) 0px, rgba(168,85,247,0.5) 1px, transparent 1px, transparent 10px),
                  repeating-linear-gradient(-45deg, rgba(168,85,247,0.5) 0px, rgba(168,85,247,0.5) 1px, transparent 1px, transparent 10px)
                `,
              }}
            />
          )}

          {/* Radial depth glow behind card */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 50% 35%, rgba(168,85,247,0.18) 0%, transparent 60%)',
            }}
          />

          {/* Center emblem */}
          <svg
            className="w-14 h-14 text-purple-400 opacity-25 pointer-events-none"
            viewBox="0 0 100 100"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <polygon points="50,5 89,27 89,73 50,95 11,73 11,27" />
            <polygon points="50,20 72,35 72,65 50,80 28,65 28,35" />
            <circle cx="50" cy="50" r="7" fill="currentColor" opacity="0.4" />
          </svg>

          {/* Inner frame */}
          <div className="absolute inset-3 rounded-xl border border-purple-500/[0.15] pointer-events-none" />

          {/* Corner accents */}
          <div className="absolute top-2 left-2 w-5 h-5 border-t-[1.5px] border-l-[1.5px] border-[#c084fc]/35 rounded-tl-sm pointer-events-none" />
          <div className="absolute top-2 right-2 w-5 h-5 border-t-[1.5px] border-r-[1.5px] border-[#c084fc]/35 rounded-tr-sm pointer-events-none" />
          <div className="absolute bottom-2 left-2 w-5 h-5 border-b-[1.5px] border-l-[1.5px] border-[#c084fc]/35 rounded-bl-sm pointer-events-none" />
          <div className="absolute bottom-2 right-2 w-5 h-5 border-b-[1.5px] border-r-[1.5px] border-[#c084fc]/35 rounded-br-sm pointer-events-none" />

          {/* Animated light sweep */}
          <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
            <div
              style={{
                position: 'absolute',
                top: '-60%',
                left: '-60%',
                width: '220%',
                height: '220%',
                background:
                  'linear-gradient(110deg, transparent 38%, rgba(255,255,255,0.05) 44%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 56%, transparent 62%)',
                animation: 'light-sweep 4s ease-in-out infinite',
              }}
            />
          </div>

          {/* Bottom-edge gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-purple-500/[0.04] via-transparent to-transparent pointer-events-none" />
        </div>
      </div>
    </motion.div>
  );
};

export default AnimatedCard;
