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

const REAL_CYBERPUNK_GIFS = [
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnY5aG51aWVrcTFldGJhYjRycndzYnlvcmV6aGlsYzRxeXUwdDNtZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LqT855y03dANy/giphy.gif',
  'https://media.giphy.com/media/26tn33aiTi1jkl6H6/giphy.gif',
  'https://media.giphy.com/media/3oKIPnAiaMCws8nOsE/giphy.gif',
  'https://media.giphy.com/media/d9A3XKqxodGjC/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3Zsd24ybjRhNDRnbnJraGlnNHZwcmhrMHR4ZnpuaHczOTI3dnA2ZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/13Hgw8hCXKvhwQ/giphy.gif',
  'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif',
  'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif',
  'https://media.giphy.com/media/l41YoV54ZT606Bwzv/giphy.gif',
];

interface CardDeckProps {
  phase: CardPhase;
  targetMember: UnifiedMember;
  csvMembers: CsvMember[];
  databaseMembers?: UnifiedMember[];
  onPhaseComplete: (phase: CardPhase) => void;
  onMemberSelected?: (member: UnifiedMember) => void;
  isPreloading?: boolean;
}

export default function CardDeck({
  phase,
  targetMember,
  csvMembers,
  databaseMembers,
  onPhaseComplete,
  onMemberSelected,
  isPreloading = false,
}: CardDeckProps) {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const cardCount = isMobile ? 5 : 6;

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [orbitalPositions, setOrbitalPositions] = useState<OrbitalPosition[]>(
    () => Array.from({ length: cardCount }, () => ({ ...NEUTRAL })),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [targetAspectRatio, setTargetAspectRatio] = useState<number>(2 / 3);

  const selectedIndexRef = useRef(0);
  const deckAngleRef = useRef(0);
  const timeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Construct deck cards using real GIF avatars from database
  const deckMembers = React.useMemo(() => {
    const targetRegClean = targetMember.regNo.toLowerCase();

    // Map database members by regNo / email for quick lookup
    const dbMap: Record<string, UnifiedMember> = {};
    if (databaseMembers) {
      databaseMembers.forEach((m) => {
        if (m.regNo) dbMap[m.regNo.toLowerCase()] = m;
        if (m.email) dbMap[m.email.toLowerCase()] = m;
      });
    }

    const usedImages = new Set<string>();
    if (targetMember.photoUrl) usedImages.add(targetMember.photoUrl);
    if (targetMember.imageUrl) usedImages.add(targetMember.imageUrl);

    // Filter database members excluding target member
    const pool: UnifiedMember[] = [];
    (databaseMembers || []).forEach((m, i) => {
      if (m.regNo.toLowerCase() === targetRegClean) return;
      const photo = m.photoUrl || m.imageUrl || m.avatarUrl || REAL_CYBERPUNK_GIFS[i % REAL_CYBERPUNK_GIFS.length];
      pool.push({
        ...m,
        photoUrl: photo,
        imageUrl: photo,
        avatarUrl: m.avatarUrl || photo,
      });
      usedImages.add(photo);
    });

    // Enrich CSV members with unique photo assignments
    csvMembers.forEach((c, i) => {
      const regClean = c.registrationNumber.trim().toLowerCase();
      if (regClean === targetRegClean) return;
      if (pool.some((p) => p.regNo.toLowerCase() === regClean)) return;

      const matchedDb = dbMap[regClean] || dbMap[c.email.trim().toLowerCase()];
      let photo = matchedDb?.photoUrl || matchedDb?.imageUrl || (c as any).photoUrl;
      if (!photo || usedImages.has(photo)) {
        photo = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(c.name || c.registrationNumber)}&backgroundColor=0a0a0f`;
      }
      usedImages.add(photo);

      pool.push({
        id: c.registrationNumber || `csv-${i}`,
        regNo: c.registrationNumber,
        name: c.name,
        phone: c.phone,
        email: c.email,
        assignedTeam: c.team,
        position: c.position,
        role: c.position || 'CORE MEMBER',
        photoUrl: photo,
        imageUrl: photo,
        avatarUrl: matchedDb?.avatarUrl || photo,
        joinDate: matchedDb?.joinDate || '2024-08-01',
        specialization: matchedDb?.specialization || `${c.team} Division`,
        rating: matchedDb?.rating || (4.5 + (i % 5) * 0.1),
        fromFirestore: Boolean(matchedDb),
        fromCsv: true,
      });
    });

    const selectedOthers = pool.slice(0, cardCount - 1);

    // Pad with strictly unique fallback SVG avatars if deck needs more members
    while (selectedOthers.length < cardCount - 1) {
      const idx = selectedOthers.length + 1;
      const photo = `https://api.dicebear.com/9.x/pixel-art/svg?seed=vrgc_unique_member_${idx}&backgroundColor=0a0a0f`;
      selectedOthers.push({
        id: `db-gen-${idx}`,
        regNo: `25BCG100${idx}`,
        name: `VRGC Member ${idx}`,
        phone: '+91 90000 00000',
        email: `member${idx}@vrgc.club`,
        assignedTeam: 'Gaming',
        position: 'Core Member',
        role: 'Core Member',
        photoUrl: photo,
        imageUrl: photo,
        avatarUrl: photo,
        joinDate: '2024-08-01',
        specialization: 'Game Dev & Esports',
        rating: 4.8,
        fromFirestore: true,
        fromCsv: false,
      });
    }

    const realTargetAvatar =
      targetMember.avatarUrl ||
      targetMember.imageUrl ||
      targetMember.photoUrl ||
      REAL_CYBERPUNK_GIFS[0];

    const finalTargetMember: UnifiedMember = {
      ...targetMember,
      avatarUrl: realTargetAvatar,
      photoUrl: targetMember.photoUrl || realTargetAvatar,
    };

    return [finalTargetMember, ...selectedOthers];
  }, [targetMember, csvMembers, databaseMembers, cardCount]);

  const onMemberSelectedRef = useRef(onMemberSelected);
  onMemberSelectedRef.current = onMemberSelected;

  const [dims, setDims] = useState({ rx: 120, ry: 60 });
  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setDims({
        rx: Math.min(vw * 0.35, isMobile ? 140 : 260),
        ry: Math.min(vh * 0.16, isMobile ? 90 : 130),
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

    if (isPreloading) return;

    const isOrbiting = phase === 'ROTATING_SHUFFLE' || phase === 'SHUFFLE_ACCELERATE';
    if (!isOrbiting) return;

    const config = phase === 'SHUFFLE_ACCELERATE'
      ? { speed: 0.045, spread: 1.4, chaos: 0.28 }
      : { speed: 0.022, spread: 1.0, chaos: 0.08 };

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
  }, [phase, dims, cardCount, isPreloading]);

  const handlePhaseComplete = useCallback(onPhaseComplete, [onPhaseComplete]);

  useEffect(() => {
    if (isPreloading) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    switch (phase) {
      case 'ENTRY':
        timer = setTimeout(() => handlePhaseComplete('ENTRY'), 400);
        break;
      case 'DECK_APPEAR':
        timer = setTimeout(() => handlePhaseComplete('DECK_APPEAR'), 600);
        break;
      case 'ROTATING_SHUFFLE':
        timer = setTimeout(() => handlePhaseComplete('ROTATING_SHUFFLE'), 2500);
        break;
      case 'SHUFFLE_ACCELERATE':
        timer = setTimeout(() => handlePhaseComplete('SHUFFLE_ACCELERATE'), 1400);
        break;
      case 'COLLAPSE':
        setOrbitalPositions(Array.from({ length: cardCount }, () => ({ ...NEUTRAL })));
        timer = setTimeout(() => handlePhaseComplete('COLLAPSE'), 500);
        break;
      case 'CARD_PICK':
        selectedIndexRef.current = 0;
        setSelectedIndex(0);
        onMemberSelectedRef.current?.(targetMember);
        timer = setTimeout(() => handlePhaseComplete('CARD_PICK'), 950);
        break;
      case 'CARD_FLIP':
        timer = setTimeout(() => handlePhaseComplete('CARD_FLIP'), 900);
        break;
      case 'AVATAR_REVEAL':
        timer = setTimeout(() => handlePhaseComplete('AVATAR_REVEAL'), 500);
        break;
      case 'PROFILE_EXPAND':
        timer = setTimeout(() => handlePhaseComplete('PROFILE_EXPAND'), 750);
        break;
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [phase, handlePhaseComplete, targetMember, cardCount, isPreloading]);

  const isOrbiting = phase === 'ROTATING_SHUFFLE' || phase === 'SHUFFLE_ACCELERATE';
  const isPicking = phase === 'CARD_PICK' || phase === 'CARD_FLIP';

  // Construct a pool of unique non-target VRGC club members (at least cardCount items)
  const shuffleOthers = React.useMemo(() => {
    const targetRegClean = targetMember.regNo.toLowerCase();

    const dbMap: Record<string, UnifiedMember> = {};
    if (databaseMembers) {
      databaseMembers.forEach((m) => {
        if (m.regNo) dbMap[m.regNo.toLowerCase()] = m;
        if (m.email) dbMap[m.email.toLowerCase()] = m;
      });
    }

    const usedImages = new Set<string>();
    if (targetMember.photoUrl) usedImages.add(targetMember.photoUrl);
    if (targetMember.imageUrl) usedImages.add(targetMember.imageUrl);

    const pool: UnifiedMember[] = [];

    (databaseMembers || []).forEach((m, i) => {
      if (m.regNo.toLowerCase() === targetRegClean) return;
      const photo = m.photoUrl || m.imageUrl || m.avatarUrl || REAL_CYBERPUNK_GIFS[i % REAL_CYBERPUNK_GIFS.length];
      if (!usedImages.has(photo)) {
        pool.push({ ...m, photoUrl: photo, imageUrl: photo });
        usedImages.add(photo);
      }
    });

    csvMembers.forEach((c, i) => {
      const regClean = c.registrationNumber.trim().toLowerCase();
      if (regClean === targetRegClean) return;
      if (pool.some((p) => p.regNo.toLowerCase() === regClean)) return;

      const matchedDb = dbMap[regClean] || dbMap[c.email.trim().toLowerCase()];
      let photo = matchedDb?.photoUrl || matchedDb?.imageUrl || (c as any).photoUrl;
      if (!photo || usedImages.has(photo)) {
        photo = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(c.name || c.registrationNumber)}&backgroundColor=0a0a0f`;
      }
      usedImages.add(photo);

      pool.push({
        id: c.registrationNumber || `csv-${i}`,
        regNo: c.registrationNumber,
        name: c.name,
        phone: c.phone,
        email: c.email,
        assignedTeam: c.team,
        position: c.position,
        role: c.position || 'CORE MEMBER',
        photoUrl: photo,
        imageUrl: photo,
        avatarUrl: matchedDb?.avatarUrl || photo,
        joinDate: matchedDb?.joinDate || '2024-08-01',
        specialization: matchedDb?.specialization || `${c.team} Division`,
        rating: matchedDb?.rating || (4.5 + (i % 5) * 0.1),
        fromFirestore: Boolean(matchedDb),
        fromCsv: true,
      });
    });

    // Ensure pool has at least cardCount unique items (zero repeated images)
    while (pool.length < cardCount) {
      const idx = pool.length + 1;
      const photo = `https://api.dicebear.com/9.x/pixel-art/svg?seed=vrgc_unique_shuffle_slot_${idx}&backgroundColor=0a0a0f`;
      pool.push({
        id: `shuffle-gen-${idx}`,
        regNo: `25BCG100${idx}`,
        name: `VRGC Member ${idx}`,
        phone: '+91 90000 00000',
        email: `member${idx}@vrgc.club`,
        assignedTeam: 'Gaming',
        position: 'Core Member',
        role: 'Core Member',
        photoUrl: photo,
        imageUrl: photo,
        avatarUrl: photo,
        joinDate: '2024-08-01',
        specialization: 'Game Dev & Esports',
        rating: 4.8,
        fromFirestore: true,
        fromCsv: false,
      });
    }

    return pool.slice(0, cardCount);
  }, [targetMember, csvMembers, databaseMembers, cardCount]);

  const finalTargetMember = React.useMemo(() => {
    const realTargetAvatar =
      targetMember.avatarUrl ||
      targetMember.imageUrl ||
      targetMember.photoUrl ||
      REAL_CYBERPUNK_GIFS[0];

    return {
      ...targetMember,
      avatarUrl: realTargetAvatar,
      photoUrl: targetMember.photoUrl || realTargetAvatar,
    };
  }, [targetMember]);

  // Target member is excluded from initial ENTRY & DECK_APPEAR animation, but included in 3D shuffle and lands at centre screen!
  const isShuffleOrRevealPhase = ['ROTATING_SHUFFLE', 'SHUFFLE_ACCELERATE', 'COLLAPSE', 'CARD_PICK', 'CARD_FLIP', 'AVATAR_REVEAL', 'PROFILE_EXPAND', 'COMPLETE'].includes(phase);

  return (
    <div
      className="relative w-full h-full flex items-center justify-center pointer-events-none"
      style={{
        perspective: isPicking ? (isMobile ? '700px' : '900px') : (isMobile ? '900px' : '1200px'),
        perspectiveOrigin: isOrbiting ? '50% 40%' : '50% 45%',
        transition: 'perspective 1.2s ease-in-out, perspective-origin 1.2s ease-in-out',
      }}
    >
      {deckMembers.map((member, i) => {
        // Exclude target member from initial decking animation (ENTRY & DECK_APPEAR).
        // Target member joins during 3D shuffle and lands at centre screen upon pick & reveal!
        const cardMemberData = (isShuffleOrRevealPhase && i === selectedIndex)
          ? finalTargetMember
          : (shuffleOthers[i] || member);

        return (
          <AnimatedCard
            key={member.id}
            index={i}
            totalCards={cardCount}
            isSelected={i === selectedIndex}
            phase={phase}
            orbitalPosition={orbitalPositions[i] || NEUTRAL}
            targetAspectRatio={i === selectedIndex ? targetAspectRatio : 2 / 3}
            cardMember={cardMemberData}
          >
            <MemberCard
              member={cardMemberData}
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
        );
      })}
    </div>
  );
}
