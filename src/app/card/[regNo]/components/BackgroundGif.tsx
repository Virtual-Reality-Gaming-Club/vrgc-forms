'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface BackgroundGifProps {
  avatarUrl: string;
  isVisible: boolean;
}

export default function BackgroundGif({ avatarUrl, isVisible }: BackgroundGifProps) {
  if (!avatarUrl || !isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: isVisible ? 0.42 : 0,
        scale: isVisible ? 1 : 0.9,
      }}
      transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
    >
      {/* Single <img> — CSS handles mobile vs desktop framing */}
      <img
        src={avatarUrl}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        loading="eager"
        decoding="async"
        fetchPriority="high"
        className="w-full h-full object-cover filter brightness-105 contrast-110 saturate-120"
        style={{
          objectPosition: 'center 30%',
          willChange: 'opacity',
        }}
      />
      {/* Gradient vignette — blends avatar into background */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#020006]/80 via-transparent to-[#020006]/40" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#020006]/50 via-transparent to-[#020006]/50" />
    </motion.div>
  );
}
