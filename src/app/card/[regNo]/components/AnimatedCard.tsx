'use client';

import React from 'react';
import { motion, useReducedMotion, TargetAndTransition } from 'framer-motion';
import { UnifiedMember } from '../types';

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
  targetAspectRatio?: number;
  cardMember?: UnifiedMember;
  children?: React.ReactNode;
}

export const AnimatedCard: React.FC<AnimatedCardProps> = ({
  index,
  totalCards,
  isSelected,
  phase,
  orbitalPosition,
  targetAspectRatio = 2 / 3,
  cardMember,
  children,
}) => {
  const prefersReduced = useReducedMotion();

  const revealX = 0;
  const revealY = 40;

  const isFlipped =
    isSelected &&
    ['CARD_FLIP', 'AVATAR_REVEAL', 'PROFILE_EXPAND', 'COMPLETE'].includes(phase);

  const currentAspectRatio = isFlipped ? targetAspectRatio : 2 / 3;

  const cardGifUrl =
    cardMember?.avatarUrl ||
    cardMember?.photoUrl ||
    cardMember?.imageUrl ||
    `https://api.dicebear.com/9.x/pixel-art/svg?seed=member_${index}&backgroundColor=0a0a0f`;

  const getState = (): TargetAndTransition => {
    if (prefersReduced) {
      if (isFlipped) {
        return { x: revealX, y: revealY, scale: 1.05, opacity: 1, rotateY: 0, rotateZ: 0, rotateX: 0 };
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
          rotateY: orbitalPosition.x * 0.08,
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
              opacity: 0.15,
              rotateZ: 0,
              rotateY: 0,
              rotateX: 15,
              filter: 'blur(3px)',
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
              rotateY: 0,
              rotateX: 0,
              transition: {
                duration: 0.45,
                ease: 'easeInOut',
              },
            }
          : {
              x: (index - totalCards / 2) * 40,
              y: 30,
              scale: 0.5,
              opacity: 0.12,
              rotateZ: 0,
              rotateY: 0,
              rotateX: 18,
              filter: 'blur(3px)',
              transition: { duration: 0.5 },
            };

      case 'AVATAR_REVEAL':
      case 'PROFILE_EXPAND':
      case 'COMPLETE':
        return isSelected
          ? {
              x: revealX,
              y: revealY,
              scale: 1.08,
              opacity: 1,
              rotateZ: 0,
              rotateY: 0,
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
              opacity: 0.08,
              rotateZ: (index - totalCards / 2) * 3,
              rotateY: 0,
              rotateX: 20,
              filter: 'blur(3px)',
              transition: { duration: 0.2 },
            };

      default:
        return { x: 0, y: 0, scale: 1, opacity: 1, rotateY: 0, rotateZ: 0, rotateX: 0 };
    }
  };

  const isActive =
    isSelected &&
    ['CARD_PICK', 'CARD_FLIP', 'AVATAR_REVEAL', 'PROFILE_EXPAND', 'COMPLETE'].includes(phase);
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
      animate={{
        ...getState(),
        aspectRatio: currentAspectRatio,
      }}
      transition={{
        aspectRatio: {
          type: 'spring',
          stiffness: 140,
          damping: 18,
        },
      }}
      style={{
        position: 'absolute',
        width: 'clamp(200px, 58vw, 320px)',
        willChange: 'transform, opacity',
        zIndex: isActive ? totalCards + 10 : baseZIndex,
        animation: isIdleFloat ? 'card-idle-float 3s ease-in-out infinite' : 'none',
      }}
    >
      {/* ═══ SIDE 2: Selected Member Photo Canvas (Displayed after flip) ═══ */}
      <div
        className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-auto"
        style={{
          zIndex: isFlipped ? 20 : 1,
          opacity: isFlipped ? 1 : 0,
          transition: phase === 'CARD_FLIP' ? 'opacity 0.01s linear 0.2s' : 'opacity 0.25s ease-in-out',
        }}
      >
        <div className="w-full h-full rounded-2xl overflow-hidden flex flex-col items-center justify-center">
          {children}
        </div>
      </div>

      {/* ═══ SIDE 1: Member Avatar GIF Face (Displayed during starting shuffle animation) ═══ */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden"
        style={{
          zIndex: isFlipped ? 1 : 10,
          opacity: isFlipped ? 0 : 1,
          transition: phase === 'CARD_FLIP' ? 'opacity 0.01s linear 0.2s' : 'opacity 0.25s ease-in-out',
        }}
      >
        {isActive && (
          <div 
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{
              filter: 'blur(30px)',
              transform: 'scale(1.05)',
              background: 'radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(124,58,237,0.4) 100%)',
              opacity: 0.45,
            }}
          />
        )}
        <div
          className={`absolute inset-0 rounded-2xl flex flex-col items-center justify-between overflow-hidden ${isActive ? 'animate-glow-bloom' : ''}`}
          style={{
            backgroundColor: '#05020c',
            border: isActive ? '1.5px solid #c084fc' : '1.5px solid rgba(168, 85, 247, 0.45)',
            boxShadow: isActive
              ? '0 0 25px rgba(168,85,247,0.5), 0 8px 32px rgba(0,0,0,0.85)'
              : '0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(192,132,252,0.15)',
            transition: 'border-color 0.5s ease-in-out',
          }}
        >
          {/* Member Avatar GIF Canvas */}
          <div className="relative w-full h-full p-1 flex items-center justify-center overflow-hidden">
            <img
              src={cardGifUrl}
              alt="Member Avatar GIF"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover rounded-xl shadow-lg border border-purple-500/30 block"
              loading="eager"
              decoding="async"
              style={{ willChange: 'transform, opacity' }}
            />

            {/* Holographic Scanline */}
            <div
              className="absolute top-0 left-0 pointer-events-none z-[4]"
              style={{
                height: '2px',
                width: '100%',
                background: 'linear-gradient(to right, transparent, rgba(192,132,252,0.6), transparent)',
                animation: 'scanline 4s linear infinite',
              }}
            />

            {/* Crosshatch geometric overlay */}
            <div
              className="absolute inset-0 pointer-events-none opacity-10"
              style={{
                backgroundImage: `
                  repeating-linear-gradient(45deg, rgba(168,85,247,0.5) 0px, rgba(168,85,247,0.5) 1px, transparent 1px, transparent 10px),
                  repeating-linear-gradient(-45deg, rgba(168,85,247,0.5) 0px, rgba(168,85,247,0.5) 1px, transparent 1px, transparent 10px)
                `,
              }}
            />

            {/* Registration Number Tag Badge */}
            {cardMember?.regNo && (
              <div className="absolute top-2 left-2 bg-[#05020c]/85 border border-[#a855f7]/60 px-1.5 py-0.5 rounded text-[8px] font-mono text-[#c084fc] tracking-widest uppercase shadow-md pointer-events-none z-10">
                {cardMember.regNo}
              </div>
            )}

            {/* Corner Crop Marks */}
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-[#c084fc]/70 pointer-events-none z-10" />
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-[#c084fc]/70 pointer-events-none z-10" />
            <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-[#c084fc]/70 pointer-events-none z-10" />
            <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-[#c084fc]/70 pointer-events-none z-10" />
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default AnimatedCard;
