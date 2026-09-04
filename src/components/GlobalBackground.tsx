"use client";

import React from 'react';
import Ferrofluid from './Ferrofluid';

export const GlobalBackground: React.FC = () => {
  return (
    <div 
      className="fixed inset-0 pointer-events-none overflow-hidden select-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      {/* Base Solid Deep Space Background */}
      <div className="absolute inset-0 bg-[#03010A]" />

      {/* Ferrofluid Canvas Container */}
      <div className="absolute inset-0 opacity-55">
        <Ferrofluid
          colors={["#d8b4fe", "#c084fc", "#a855f7", "#7c3aed", "#6366f1", "#4f46e5"]}
          speed={0.28}
          scale={2.1}
          turbulence={0.85}
          fluidity={0.22}
          rimWidth={0.23}
          sharpness={2.6}
          shimmer={0.7}
          glow={2.2}
          flowDirection="up"
          opacity={0.65}
          mouseInteraction={true}
          mouseStrength={0.6}
          mouseRadius={0.25}
          mouseDampening={0.12}
        />
      </div>

      {/* Subtle Contrast-Preserving Ambient Glow */}
      <div 
        className="absolute inset-0 bg-gradient-to-b from-[#03010A]/50 via-transparent to-[#03010A]/70 pointer-events-none" 
      />
    </div>
  );
};

export default GlobalBackground;
