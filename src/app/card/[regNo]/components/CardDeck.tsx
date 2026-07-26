'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatedCard, CardPhase, OrbitalPosition } from './AnimatedCard';
import MemberCard from './MemberCard';
import { UnifiedMember } from '../types';
import { CsvMember } from '../utils/csvParser';

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
  targetMember: UnifiedMember;
  csvMembers: CsvMember[];
  onPhaseComplete: (phase: CardPhase) => void;
  onMemberSelected?: (member: UnifiedMember) => void;
}

export default function CardDeck({ phase, targetMember, csvMembers, onPhaseComplete, onMemberSelected }: CardDeckProps) {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const cardCount = isMobile ? 5 : 8;

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [orbitalPositions, setOrbitalPositions] = useState<OrbitalPosition[]>(
    () => Array.from({ length: 8 }, () => ({ ...NEUTRAL })),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [targetAspectRatio, setTargetAspectRatio] = useState<number>(2 / 3);

  const selectedIndexRef = useRef(0);
  const deckAngleRef = useRef(0);
  const timeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Construct deck cards: targetMember at index 0, followed by CSV member avatars
  // Lightweight SVG & avatar thumbnails used for background deck cards to guarantee smooth mobile FPS
  const deckMembers = React.useMemo(() => {
    const others = csvMembers
      .filter((m) => m.registrationNumber.toLowerCase() !== targetMember.regNo.toLowerCase())
      .slice(0, cardCount - 1)
      .map((c, i) => {
        const seed = encodeURIComponent(c.name || c.registrationNumber);
        const avatarThumb = (c as any).avatarUrl || `https://api.dicebear.com/9.x/pixel-art/svg?seed=${seed}&backgroundColor=0a0a0f`;
        return {
          id: c.registrationNumber || `csv-${i}`,
          regNo: c.registrationNumber,
          name: c.name,
          phone: c.phone,
          email: c.email,
          assignedTeam: c.team,
          position: c.position,
          role: c.position || 'CORE MEMBER',
          photoUrl: avatarThumb,
          imageUrl: avatarThumb,
          avatarUrl: avatarThumb,
          joinDate: '2024-08-01',
          specialization: `${c.team} Division`,
          rating: 4.5 + (i % 5) * 0.1,
          fromFirestore: false,
          fromCsv: true,
        };
      });

    while (others.length < cardCount - 1) {
      const idx = others.length + 1;
      const avatarThumb = `https://api.dicebear.com/9.x/pixel-art/svg?seed=vrgc_member_${idx}&backgroundColor=0a0a0f`;
      others.push({
        id: `gen-${idx}`,
        regNo: `25BCG100${idx}`,
        name: `VRGC Member ${idx}`,
        phone: '+91 90000 00000',
        email: `member${idx}@vrgc.club`,
        assignedTeam: 'Gaming',
        position: 'Core Member',
        role: 'Core Member',
        photoUrl: avatarThumb,
        imageUrl: avatarThumb,
        avatarUrl: avatarThumb,
        joinDate: '2024-08-01',
        specialization: 'Game Dev & Esports',
        rating: 4.6,
        fromFirestore: false,
        fromCsv: false,
      });
    }

    return [targetMember, ...others];
  }, [targetMember, csvMembers, cardCount]);

  const onMemberSelectedRef = useRef(onMemberSelected);
  onMemberSelectedRef.current = onMemberSelected;

  const [dims, setDims] = useState({ rx: 120, ry: 60 });
  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setDims({
        rx: Math.min(vw * 0.40, isMobile ? 180 : 320),
        ry: Math.min(vh * 0.18, isMobile ? 110 : 160),
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isMobile]);

  // Performant requestAnimationFrame loop for silky 60fps orbital rotation
  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const isOrbiting = phase === 'ROTATING_SHUFFLE' || phase === 'SHUFFLE_ACCELERATE';
    if (!isOrbiting) return;

    const config = phase === 'SHUFFLE_ACCELERATE'
      ? { speed: 0.08, spread: 1.5, chaos: 0.4 }
      : { speed: 0.04, spread: 1.0, chaos: 0.12 };

    let lastTime = performance.now();

    const loop = (now: number) => {
      const delta = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      deckAngleRef.current += config.speed;
      timeRef.current += delta;

      setOrbitalPositions(
        computeOrbitalPositions(
          deckAngleRef.current, cardCount,
          dims.rx, dims.ry,
          config.spread, config.chaos,
          timeRef.current,
        ),
      );

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase, dims, cardCount]);

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
        setOrbitalPositions(Array.from({ length: cardCount }, () => ({ ...NEUTRAL })));
        timer = setTimeout(() => handlePhaseComplete('COLLAPSE'), 600);
        break;
      case 'CARD_PICK':
        selectedIndexRef.current = 0;
        setSelectedIndex(0);
        onMemberSelectedRef.current?.(targetMember);
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
  }, [phase, handlePhaseComplete, targetMember, cardCount]);

  const isOrbiting = phase === 'ROTATING_SHUFFLE' || phase === 'SHUFFLE_ACCELERATE';
  const isPicking = phase === 'CARD_PICK' || phase === 'CARD_FLIP';

  return (
    <div
      className="relative w-full h-full flex items-center justify-center pointer-events-none"
      style={{
        perspective: isPicking ? (isMobile ? '700px' : '900px') : (isMobile ? '900px' : '1200px'),
        perspectiveOrigin: isOrbiting ? '50% 40%' : '50% 45%',
        transition: 'perspective 1.2s ease-in-out, perspective-origin 1.2s ease-in-out',
      }}
    >
      {deckMembers.map((member, i) => (
        <AnimatedCard
          key={member.id}
          index={i}
          totalCards={cardCount}
          isSelected={i === selectedIndex}
          phase={phase}
          orbitalPosition={orbitalPositions[i] || NEUTRAL}
          targetAspectRatio={i === selectedIndex ? targetAspectRatio : 2 / 3}
          cardMember={member}
        >
          <MemberCard
            member={member}
            isRevealed={
              i === selectedIndex &&
              ['CARD_FLIP', 'AVATAR_REVEAL', 'PROFILE_EXPAND', 'COMPLETE'].includes(phase)
            }
            onAspectRatioChange={(ratio) => {
              if (i === selectedIndex) {
                setTargetAspectRatio(ratio);
              }
            }}
          />
        </AnimatedCard>
      ))}
    </div>
  );
}
