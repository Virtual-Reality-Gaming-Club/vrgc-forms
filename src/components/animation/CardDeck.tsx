'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AnimatedCard, CardPhase, OrbitalPosition } from './AnimatedCard';
import MemberCard from './MemberCard';
import { MEMBERS, Member } from './members';

const CARD_COUNT = 8;
const NEUTRAL: OrbitalPosition = { x: 0, y: 0, scale: 1, opacity: 1, rotateZ: 0, rotateX: 0, rotateY: 0, zIndex: 10 };

function computeOrbitalPositions(
  deckAngle: number, count: number,
  radiusX: number, radiusY: number,
  spread: number, chaos: number,
  time: number,
): OrbitalPosition[] {
  return Array.from({ length: count }, (_, i) => {
    const baseAngle = (Math.PI * 2 / count) * i;
    const worldAngle = baseAngle + deckAngle;

    const wobbleX = Math.sin(time * 2.5 + i * 1.7) * chaos * 15;
    const wobbleY = Math.cos(time * 1.8 + i * 2.3) * chaos * 12;

    const x = Math.cos(worldAngle) * radiusX * spread + wobbleX;
    const depthFactor = Math.sin(worldAngle);
    const y = Math.sin(worldAngle * 2 + 0.3) * radiusY * spread + wobbleY;

    const chaosScale = 1 + Math.sin(i * 1.4 + time * 3) * chaos * 0.3;

    const scale = (0.55 + (depthFactor + 1) * 0.3) * chaosScale;
    const opacity = 0.3 + (depthFactor + 1) * 0.35;
    const rotateZ = Math.sin(worldAngle + Math.PI / 3) * (10 + chaos * 25) * spread;
    const rotateX = Math.sin(worldAngle * 1.5 + time) * chaos * 18;
    const rotateY = Math.cos(worldAngle * 0.7 + time * 1.2) * chaos * 15;
    const zIndex = Math.round(depthFactor * count) + count + 2;

    return { x: x * chaosScale, y, scale, opacity, rotateZ, rotateX, rotateY, zIndex };
  });
}

interface CardDeckProps {
  phase: CardPhase;
  onPhaseComplete: (phase: CardPhase) => void;
  onMemberSelected?: (member: Member) => void;
  targetMember?: Member | null;
  otherMembers?: Member[];
}

export default function CardDeck({ phase, onPhaseComplete, onMemberSelected, targetMember, otherMembers }: CardDeckProps) {
  const [orbitalPositions, setOrbitalPositions] = useState<OrbitalPosition[]>(
    () => Array.from({ length: CARD_COUNT }, () => ({ ...NEUTRAL })),
  );
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const selectedIndexRef = useRef(-1);
  const deckAngleRef = useRef(0);
  const timeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pool = useMemo(() => {
    return (otherMembers && otherMembers.length > 0) ? otherMembers : MEMBERS;
  }, [otherMembers]);

  const [cardMembers, setCardMembers] = useState<Member[]>(() => {
    if (targetMember) {
      const others = pool.filter(m => m.id !== targetMember.id).sort(() => Math.random() - 0.5).slice(0, CARD_COUNT - 1);
      return [targetMember, ...others];
    }
    return pool.slice(0, CARD_COUNT);
  });

  useEffect(() => {
    if (targetMember) {
      const others = pool.filter(m => m.id !== targetMember.id).sort(() => Math.random() - 0.5).slice(0, CARD_COUNT - 1);
      setCardMembers([targetMember, ...others]);
    } else {
      setCardMembers([...pool].sort(() => Math.random() - 0.5).slice(0, CARD_COUNT));
    }
  }, [targetMember, pool]);

  const cardMembersRef = useRef(cardMembers);
  cardMembersRef.current = cardMembers;

  const onMemberSelectedRef = useRef(onMemberSelected);
  onMemberSelectedRef.current = onMemberSelected;

  const [dims, setDims] = useState({ rx: 120, ry: 60 });
  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      if (vw >= 1024) setDims({ rx: 280, ry: 130 });
      else if (vw >= 768) setDims({ rx: 200, ry: 95 });
      else if (vw >= 480) setDims({ rx: 140, ry: 70 });
      else setDims({ rx: 105, ry: 50 });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const isOrbiting = phase === 'ROTATING_SHUFFLE' || phase === 'SHUFFLE_ACCELERATE';
    if (!isOrbiting) return;

    const config = phase === 'SHUFFLE_ACCELERATE'
      ? { speed: 0.11, spread: 1.8, chaos: 0.7 }
      : { speed: 0.055, spread: 1.0, chaos: 0.15 };

    intervalRef.current = setInterval(() => {
      deckAngleRef.current += config.speed;
      timeRef.current += 0.05;
      setOrbitalPositions(
        computeOrbitalPositions(
          deckAngleRef.current, CARD_COUNT,
          dims.rx, dims.ry,
          config.spread, config.chaos,
          timeRef.current,
        ),
      );
    }, 50);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [phase, dims]);

  const handlePhaseComplete = useCallback(onPhaseComplete, [onPhaseComplete]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    switch (phase) {
      case 'ENTRY':
        timer = setTimeout(() => handlePhaseComplete('ENTRY'), 300);
        break;
      case 'DECK_APPEAR':
        timer = setTimeout(() => handlePhaseComplete('DECK_APPEAR'), 700);
        break;
      case 'ROTATING_SHUFFLE':
        timer = setTimeout(() => handlePhaseComplete('ROTATING_SHUFFLE'), 3400);
        break;
      case 'SHUFFLE_ACCELERATE':
        timer = setTimeout(() => handlePhaseComplete('SHUFFLE_ACCELERATE'), 1800);
        break;
      case 'COLLAPSE':
        setOrbitalPositions(Array.from({ length: CARD_COUNT }, () => ({ ...NEUTRAL })));
        timer = setTimeout(() => handlePhaseComplete('COLLAPSE'), 600);
        break;
      case 'CARD_PICK':
        if (selectedIndexRef.current === -1) {
          const pick = targetMember ? 0 : Math.floor(Math.random() * CARD_COUNT);
          selectedIndexRef.current = pick;
          setSelectedIndex(pick);
          onMemberSelectedRef.current?.(cardMembersRef.current[pick]);
        }
        timer = setTimeout(() => handlePhaseComplete('CARD_PICK'), 1100);
        break;
      case 'CARD_FLIP':
        timer = setTimeout(() => handlePhaseComplete('CARD_FLIP'), 1000);
        break;
      case 'AVATAR_REVEAL':
        timer = setTimeout(() => handlePhaseComplete('AVATAR_REVEAL'), 600);
        break;
      case 'PROFILE_EXPAND':
        timer = setTimeout(() => handlePhaseComplete('PROFILE_EXPAND'), 1000);
        break;
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [phase, handlePhaseComplete, targetMember]);

  const isOrbiting = phase === 'ROTATING_SHUFFLE' || phase === 'SHUFFLE_ACCELERATE';
  const isPicking = phase === 'CARD_PICK' || phase === 'CARD_FLIP';

  return (
    <div
      className="relative w-full h-full flex items-center justify-center"
      style={{
        perspective: isPicking ? '900px' : '1200px',
        perspectiveOrigin: isOrbiting ? '50% 40%' : '50% 45%',
        transition: 'perspective 1.2s ease-in-out, perspective-origin 1.2s ease-in-out',
      }}
    >
      {cardMembers.map((member, i) => (
        <AnimatedCard
          key={member.id}
          index={i}
          totalCards={CARD_COUNT}
          isSelected={i === selectedIndex}
          phase={phase}
          orbitalPosition={orbitalPositions[i]}
          avatarUrl={member.avatarUrl}
        >
          <MemberCard member={member} isRevealed={i === selectedIndex && ['AVATAR_REVEAL', 'PROFILE_EXPAND', 'COMPLETE'].includes(phase)} />
        </AnimatedCard>
      ))}
    </div>
  );
}
