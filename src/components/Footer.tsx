"use client";

import React, { useState } from 'react';
import { Phone, ShieldCheck, Code2, ChevronUp, ChevronDown, Headset } from 'lucide-react';

const Footer: React.FC = () => {
  const [showFullSupport, setShowFullSupport] = useState<boolean>(false);

  return (
    <footer className="w-full sticky bottom-0 z-40 bg-[#070212]/95 backdrop-blur-xl border-t border-purple-500/30 text-[#cbd5e1] shadow-[0_-10px_30px_rgba(0,0,0,0.5)] transition-all duration-300">
      
      {/* Expandable Support Details Panel */}
      {showFullSupport && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 border-b border-purple-500/20 bg-[#0d041e]/90 animate-in slide-in-from-bottom-3 duration-200">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="space-y-1 text-center md:text-left">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                <ShieldCheck className="w-3 h-3 text-purple-400" />
                <span>VRGC TECHNICAL SUPPORT DESK</span>
              </div>
              <p className="text-xs text-slate-300 font-semibold">
                Facing payment issues or technical bugs? Contact our Technical Leads directly.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              {/* Rishav Mandal */}
              <a
                href="tel:9830442043"
                className="px-3 py-2 rounded-xl bg-purple-950/60 border border-purple-500/40 hover:bg-purple-900/60 transition-all flex items-center gap-2.5 group"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                  RM
                </div>
                <div className="text-left text-xs">
                  <div className="font-bold text-white group-hover:text-purple-300 transition-colors">
                    Rishav Mandal <span className="text-[9px] text-purple-400 font-normal">(Tech Lead)</span>
                  </div>
                  <div className="text-[11px] font-mono text-emerald-400 font-bold flex items-center gap-1">
                    <Phone className="w-3 h-3" /> +91 9830442043
                  </div>
                </div>
              </a>

              {/* Abhinav Mishra */}
              <a
                href="tel:7007864924"
                className="px-3 py-2 rounded-xl bg-indigo-950/60 border border-indigo-500/40 hover:bg-indigo-900/60 transition-all flex items-center gap-2.5 group"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                  AM
                </div>
                <div className="text-left text-xs">
                  <div className="font-bold text-white group-hover:text-indigo-300 transition-colors">
                    Abhinav Mishra <span className="text-[9px] text-indigo-400 font-normal">(Co-Lead)</span>
                  </div>
                  <div className="text-[11px] font-mono text-emerald-400 font-bold flex items-center gap-1">
                    <Phone className="w-3 h-3" /> +91 7007864924
                  </div>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Main Ultra-Sleek Docked Footer Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        
        {/* Left: Developer Credit */}
        <div className="flex items-center gap-2 font-medium text-slate-300 text-[11px] sm:text-xs">
          <Code2 className="w-4 h-4 text-purple-400 shrink-0" />
          <span>Developed by <strong className="text-white font-extrabold">VRGC Technical Team</strong></span>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span className="text-slate-400 text-[11px] hidden sm:inline">Copyright hold by <strong className="text-purple-300">VRGC Club | VIT Bhopal</strong></span>
        </div>

        {/* Right: Quick Direct Contact Pills & Expand Toggle */}
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <a
            href="tel:9830442043"
            className="px-2.5 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[11px] font-bold transition-all flex items-center gap-1.5"
            title="Call Rishav Mandal (Tech Lead)"
          >
            <Phone className="w-3 h-3 text-emerald-400" />
            <span>Rishav: 9830442043</span>
          </a>

          <a
            href="tel:7007864924"
            className="px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[11px] font-bold transition-all flex items-center gap-1.5"
            title="Call Abhinav Mishra (Co-Lead)"
          >
            <Phone className="w-3 h-3 text-emerald-400" />
            <span>Abhinav: 7007864924</span>
          </a>

          <button
            onClick={() => setShowFullSupport((v) => !v)}
            className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-[11px] font-bold transition-all flex items-center gap-1"
            title="Toggle Technical Support Panel"
          >
            <Headset className="w-3 h-3 text-purple-400" />
            {showFullSupport ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronUp className="w-3 h-3 text-slate-400" />}
          </button>
        </div>

      </div>
    </footer>
  );
};

export default Footer;
