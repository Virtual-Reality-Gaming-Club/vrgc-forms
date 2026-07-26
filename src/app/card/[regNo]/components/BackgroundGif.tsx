'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface BackgroundGifProps {
  avatarUrl: string;
  isVisible: boolean;
  isComplete?: boolean;
}

export default function BackgroundGif({ avatarUrl, isVisible, isComplete = false }: BackgroundGifProps) {
  const [isDesktop, setIsDesktop] = useState<boolean>(false);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!avatarUrl) return null;

  // On mobile phones, suppress background GIF completely until animation is complete!
  const shouldRenderMobile = isDesktop || isComplete;
  if (!shouldRenderMobile) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: isVisible ? 0.76 : 0 }}
      transition={{ duration: 1.2, ease: 'easeInOut' }}
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden flex items-center justify-center"
    >
      {isDesktop ? (
        /* PC / Desktop Mode: Horizontal Mode */
        <div className="relative w-full h-full flex items-center justify-center bg-black/10">
          <img
            src={avatarUrl}
            alt="Cyberpunk Avatar Background (PC)"
            className="w-full h-full object-cover filter brightness-105 contrast-110 saturate-125"
            loading="eager"
            decoding="async"
            style={{
              objectPosition: 'center 35%',
              willChange: 'transform, opacity',
            }}
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#020006] via-transparent to-[#020006]/50" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#020006]/60 via-transparent to-[#020006]/60" />
        </div>
      ) : (
        /* Phone / Mobile Mode: Vertical Mode */
        <div className="relative w-full h-full flex items-center justify-center bg-black/10">
          <img
            src={avatarUrl}
            alt="Cyberpunk Avatar Background (Mobile)"
            className="w-full h-full object-cover filter brightness-105 contrast-110 saturate-125"
            loading="eager"
            decoding="async"
            style={{
              objectPosition: 'center center',
              willChange: 'transform, opacity',
            }}
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#020006]/60 via-transparent to-[#020006]/70" />
        </div>
      )}
    </motion.div>
  );
}
