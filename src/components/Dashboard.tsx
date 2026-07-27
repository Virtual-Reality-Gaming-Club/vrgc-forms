"use client";

import React, { useRef, useState, useEffect } from 'react';

interface DashboardProps {
  onPageChange: (page: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onPageChange }) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [transformStyle, setTransformStyle] = useState<React.CSSProperties>({});

  // Mouse tilt handlers for desktop
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Calculate rotation degree (max 15 degrees)
    const rotateY = ((x - centerX) / centerX) * 15;
    const rotateX = -((y - centerY) / centerY) * 15;

    setTransformStyle({
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.05, 1.05, 1.05)`,
      transition: 'transform 0.1s ease-out',
    });
  };

  const handleMouseLeave = () => {
    setTransformStyle({
      transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
      transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
    });
  };

  // Device orientation tilt handler for mobile
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const { beta, gamma } = e; // beta: -180 to 180 (X-axis), gamma: -90 to 90 (Y-axis)
      if (beta === null || gamma === null) return;
      
      // Limit beta and gamma to reasonable tilt range (e.g. -30 to 30)
      const clampedBeta = Math.min(Math.max(beta, -30), 30);
      const clampedGamma = Math.min(Math.max(gamma, -30), 30);
      
      // Map to rotation degrees (max 12deg)
      const rotateX = (clampedBeta / 30) * 12;
      const rotateY = (clampedGamma / 30) * 12;

      setTransformStyle({
        transform: `perspective(1000px) rotateX(${-rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`,
        transition: 'transform 0.2s ease-out',
      });
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

  return (
    <div className="flex-grow min-h-[calc(100vh-117px)] overflow-y-auto p-4 md:p-8 bg-mesh relative text-left select-none">
      <div className="max-w-6xl mx-auto space-y-12">
        {/* Header / Hero Section */}
        <section className="flex flex-col md:flex-row items-center justify-between gap-8 stagger-in pb-8 border-b border-purple-500/10">
          <div className="space-y-3 max-w-2xl text-left w-full">
            <span className="font-label-caps text-xs text-purple-400 tracking-widest block font-bold">
              COMMAND CENTER
            </span>
            <h2 className="font-display-lg text-3xl md:text-[40px] text-white font-extrabold uppercase tracking-tight">
              Direct Access Portal
            </h2>
            <p className="font-body-lg text-slate-400 text-sm md:text-base leading-relaxed">
              Streamlined navigation for the Elite Tier ecosystem. Select a destination to initiate your workflow.
            </p>
          </div>
          {/* Mouse & Device Tilt Hero Logo Card */}
          <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={transformStyle}
            className="w-full md:w-80 h-44 rounded-2xl overflow-hidden border border-purple-500/30 flex items-center justify-center bg-gradient-to-br from-[#0e0518] to-[#05010a] relative shadow-[0_0_40px_rgba(168,85,247,0.15)] flex-shrink-0 cursor-pointer select-none"
          >
            <img src="/vrgc-logo.png" alt="VRGC Hero Logo" className="w-full h-full object-cover opacity-85 pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#05010a] via-transparent to-transparent pointer-events-none"></div>
          </div>
        </section>

        {/* Navigation Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Referral Program Card */}
          <button
            onClick={() => onPageChange('referrals')}
            className="group relative flex flex-col items-start p-8 bg-[#1A1A1A] border border-[#333333] hover:border-purple-500 rounded-2xl glow-hover transition-all duration-300 text-left overflow-hidden h-[300px] w-full"
          >
            <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-[150px] text-purple-400">share</span>
            </div>
            <div className="mb-auto z-10">
              <div className="w-14 h-14 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-purple-400 text-3xl">loyalty</span>
              </div>
              <h3 className="font-display-lg text-xl text-white font-bold mb-2">
                Referral Program
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Expand the VRGC network. Track affiliate status and manage reward milestones.
              </p>
            </div>
            <div className="mt-4 w-full flex items-center justify-between z-10">
              <span className="font-label-caps text-xs text-purple-400 font-bold group-hover:translate-x-2 transition-transform duration-300">
                OPEN PROGRAM
              </span>
              <span className="material-symbols-outlined text-white">arrow_forward</span>
            </div>
          </button>

          {/* Payments & Dues Portal Card */}
          <button
            onClick={() => onPageChange('payments')}
            className="group relative flex flex-col items-start p-8 bg-[#1A1A1A] border border-[#333333] hover:border-purple-500 rounded-2xl glow-hover transition-all duration-300 text-left overflow-hidden h-[300px] w-full"
          >
            <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-[150px] text-purple-400">payments</span>
            </div>
            <div className="mb-auto z-10">
              <div className="w-14 h-14 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-purple-400 text-3xl">payments</span>
              </div>
              <h3 className="font-display-lg text-xl text-white font-bold mb-2">
                Payments &amp; Dues
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Manage club membership fees, payment receipts, active dues, and payment logs.
              </p>
            </div>
            <div className="mt-4 w-full flex items-center justify-between z-10">
              <span className="font-label-caps text-xs text-purple-400 font-bold group-hover:translate-x-2 transition-transform duration-300">
                PAY DUES
              </span>
              <span className="material-symbols-outlined text-white">arrow_forward</span>
            </div>
          </button>

          {/* ID Card Portal Card */}
          <button
            onClick={() => onPageChange('idcard')}
            className="group relative flex flex-col items-start p-8 bg-[#1A1A1A] border border-[#333333] hover:border-purple-500 rounded-2xl glow-hover transition-all duration-300 text-left overflow-hidden h-[300px] w-full"
          >
            <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-[150px] text-purple-400">badge</span>
            </div>
            <div className="mb-auto z-10">
              <div className="w-14 h-14 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-purple-400 text-3xl">badge</span>
              </div>
              <h3 className="font-display-lg text-xl text-white font-bold mb-2">
                Digital ID Card
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Claim your VRGC Digital ID credentials. Submit profile photo and download generated pass.
              </p>
            </div>
            <div className="mt-4 w-full flex items-center justify-between z-10">
              <span className="font-label-caps text-xs text-purple-400 font-bold group-hover:translate-x-2 transition-transform duration-300">
                GENERATE CARD
              </span>
              <span className="material-symbols-outlined text-white">arrow_forward</span>
            </div>
          </button>

          {/* Support Tickets Card */}
          <button
            onClick={() => onPageChange('tickets')}
            className="group relative flex flex-col items-start p-8 bg-[#1A1A1A] border border-[#333333] hover:border-purple-500 rounded-2xl glow-hover transition-all duration-300 text-left overflow-hidden h-[300px] w-full"
          >
            <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-[150px] text-purple-400">confirmation_number</span>
            </div>
            <div className="mb-auto z-10">
              <div className="w-14 h-14 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-purple-400 text-3xl">support_agent</span>
              </div>
              <h3 className="font-display-lg text-xl text-white font-bold mb-2">
                Support Tickets
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Priority support for hardware issues, server calibration, and account operations.
              </p>
            </div>
            <div className="mt-4 w-full flex items-center justify-between z-10">
              <span className="font-label-caps text-xs text-purple-400 font-bold group-hover:translate-x-2 transition-transform duration-300">
                LOCKED
              </span>
              <span className="material-symbols-outlined text-white">lock</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
