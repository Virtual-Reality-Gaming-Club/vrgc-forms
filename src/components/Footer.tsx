"use client";

import React, { useState } from 'react';
import { Phone, ShieldCheck, Code2, ChevronUp, ChevronDown, Headset, Sparkles, MessageCircle } from 'lucide-react';

const Footer: React.FC = () => {
  const [showFullSupport, setShowFullSupport] = useState<boolean>(false);

  return (
    <footer className="w-full sticky bottom-[60px] md:bottom-0 z-40 bg-[#070212]/80 backdrop-blur-xl border-t border-purple-500/20 text-[#cbd5e1] shadow-[0_-10px_40px_rgba(107,33,168,0.1)] transition-all duration-300">

      {/* Expandable Support Details Panel */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${showFullSupport ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
      >
        <div className="overflow-hidden bg-gradient-to-b from-[#0d041e]/90 to-[#070212]/95 border-b border-purple-500/20 relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-900/20 via-transparent to-transparent pointer-events-none" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 relative z-10">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">

              <div className="space-y-2 text-center md:text-left flex-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
                  <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                  <span className="tracking-wider">TECHNICAL SUPPORT DESK</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 font-medium max-w-md mx-auto md:mx-0 leading-relaxed">
                  Facing payment issues or technical bugs? Our Technical Leads are available to assist you directly.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 md:gap-4 w-full md:w-auto">
                {/* Rishav Mandal */}
                <a
                  href="https://wa.me/919830442043"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-purple-950/40 border border-purple-500/30 hover:bg-purple-900/50 hover:border-purple-400/50 hover:shadow-[0_0_20px_rgba(168,85,247,0.2)] transition-all flex items-center gap-3 group"
                >
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-xs font-black shrink-0 shadow-lg group-hover:scale-105 transition-transform">
                    RM
                  </div>
                  <div className="text-left text-xs flex-1">
                    <div className="font-bold text-white group-hover:text-purple-300 transition-colors text-sm">
                      Rishav Mandal <span className="text-[10px] text-purple-400 font-normal ml-1 border border-purple-500/30 px-1.5 py-0.5 rounded-md bg-purple-900/30">(Tech Lead)</span>
                    </div>
                    <div className="text-[11px] font-mono text-emerald-400 font-bold flex items-center gap-1.5 mt-0.5">
                      <MessageCircle className="w-3 h-3" /> WhatsApp
                    </div>
                  </div>
                </a>

                {/* Abhinav Mishra */}
                <a
                  href="https://wa.me/917007864924"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 hover:bg-indigo-900/50 hover:border-indigo-400/50 hover:shadow-[0_0_20px_rgba(99,102,241,0.2)] transition-all flex items-center gap-3 group"
                >
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white text-xs font-black shrink-0 shadow-lg group-hover:scale-105 transition-transform">
                    AM
                  </div>
                  <div className="text-left text-xs flex-1">
                    <div className="font-bold text-white group-hover:text-indigo-300 transition-colors text-sm">
                      Abhinav Mishra <span className="text-[10px] text-indigo-400 font-normal ml-1 border border-indigo-500/30 px-1.5 py-0.5 rounded-md bg-indigo-900/30">(Co-Lead)</span>
                    </div>
                    <div className="text-[11px] font-mono text-emerald-400 font-bold flex items-center gap-1.5 mt-0.5">
                      <MessageCircle className="w-3 h-3" /> WhatsApp
                    </div>
                  </div>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Ultra-Sleek Docked Footer Bar */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 flex flex-row items-center justify-between gap-2 text-xs relative z-20">

        {/* Left: Developer Credit */}
        <div className="flex items-center gap-1.5 font-medium text-slate-300 text-[10px] sm:text-[11px] md:text-xs">
          <Code2 className="w-3.5 h-3.5 text-purple-400 shrink-0 hidden sm:block" />
          <span className="flex items-center gap-1 truncate">
            <span className="hidden sm:inline">Developed by</span>
            <span className="sm:hidden">By</span>
            <strong className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 font-extrabold flex items-center gap-1">
              VRGC Tech Team <Sparkles className="w-3 h-3 text-pink-400 hidden sm:block" />
            </strong>
          </span>
          <span className="text-slate-600 hidden md:inline">|</span>
          <span className="text-slate-400 text-[10px] sm:text-[11px] hidden md:inline">
            Copyright &copy; {new Date().getFullYear()} <strong className="text-purple-300">VRGC Club | VIT Bhopal</strong>
          </span>
        </div>

        {/* Right: Expand Toggle (Query) */}
        <button
          onClick={() => setShowFullSupport((v) => !v)}
          className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 border text-[10px] sm:text-[11px] font-bold shrink-0
            ${showFullSupport
              ? 'bg-purple-500/20 text-purple-200 border-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.3)]'
              : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10 hover:border-white/20'
            }
          `}
          title="Toggle Technical Support Panel"
        >
          <Headset className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${showFullSupport ? 'text-purple-300' : 'text-purple-400'}`} />
          <span>{showFullSupport ? 'Close' : 'Query'}</span>
          <ChevronUp className={`w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 transition-transform duration-300 ${showFullSupport ? 'rotate-180' : ''}`} />
        </button>

      </div>
    </footer>
  );
};

export default Footer;
