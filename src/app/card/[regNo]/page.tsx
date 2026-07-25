"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabase";
import Link from 'next/link';

interface PublicIDCardProps {
  params: Promise<{
    regNo: string;
  }>;
}

export default function VerifyCardPage({ params }: PublicIDCardProps) {
  const [regNo, setRegNo] = useState<string>('');
  const [member, setMember] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

  useEffect(() => {
    params.then(p => setRegNo(p.regNo));
  }, [params]);

  const getAdminDisplayRoleOrTeam = (team?: string, position?: string) => {
    const t = (team || '').toLowerCase();
    const p = (position || '').toLowerCase();
    const isSpecial = t === 'student coordinator' || t.includes('president') || p === 'student coordinator' || p.includes('president');
    if (isSpecial) {
      return {
        isSpecial: true,
        label: 'ROLE / POSITION',
        value: t === 'student coordinator' ? 'Student Coordinator' : position
      };
    }
    return {
      isSpecial: false,
      label: 'TEAM / DIVISION',
      value: team
    };
  };

  useEffect(() => {
    const fetchMemberCard = async () => {
      if (!regNo) return;
      setLoading(true);
      setError('');
      try {
        const { data, error } = await supabase
  .from("members")
  .select("*")
  .eq("Registration Number", regNo)
  .single();

      if (error || !data) {
        setError(`No verified ID Card dossier found for registration number: ${regNo}`);
      } else {
        setMember(data);
      }
      } catch (err) {
        console.error("Error fetching public card:", err);
        setError("System calibration failed. Unable to fetch registry records.");
      } finally {
        setLoading(false);
      }
    };

    fetchMemberCard();
  }, [regNo]);

  return (
    <div className="flex-grow p-6 md:p-12 flex flex-col items-center justify-center min-h-screen relative bg-mesh text-white">
      <div className="absolute inset-0 bg-gradient-to-tr from-[#12051e]/20 via-[#05010a] to-[#0c0416] pointer-events-none"></div>

      <div className="w-full max-w-md text-center space-y-8 relative z-10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="w-12 h-12 rounded-full border-2 border-t-2 border-t-[#a855f7] border-white/5 animate-spin"></div>
            <p className="font-code-sm text-xs text-white/50 tracking-widest uppercase">FETCHING DIGITAL REGISTRY...</p>
          </div>
        ) : error ? (
          <div className="glass-panel p-8 rounded-3xl border border-red-500/20 bg-black/60 backdrop-blur-md space-y-6">
            <span className="material-symbols-outlined text-red-400 text-5xl animate-bounce">gavel</span>
            <div className="space-y-2">
              <h3 className="font-display-lg text-lg text-white font-extrabold tracking-widest uppercase">VERIFICATION FAILED</h3>
              <p className="font-body-md text-xs text-red-400/80 leading-relaxed">{error}</p>
            </div>
            <Link 
              href="/"
              className="inline-block px-6 py-2.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold font-label-caps text-xs tracking-wider transition-all"
            >
              RETURN TO CONSOLE
            </Link>
          </div>
        ) : (
          <div className="space-y-6 stagger-in flex flex-col items-center">
            
            {/* Verification Status Header */}
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 font-bold text-xs uppercase tracking-widest">
                <span className="material-symbols-outlined text-sm font-bold">verified</span>
                <span>OFFICIAL VERIFIED MEMBER</span>
              </div>
              <p className="font-code-sm text-[10px] text-white/40 tracking-widest uppercase mt-2">TAP CARD TO ROTATE CREDENTIALS</p>
            </div>

            {/* 3D Flip Card */}
            <div 
              onClick={() => setIsFlipped(!isFlipped)}
              className="relative w-full max-w-[340px] aspect-[2.2/3.4] cursor-pointer group [perspective:1000px]"
            >
              <div className={`relative w-full h-full duration-700 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                
                {/* FRONT OF THE ID CARD */}
                <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] select-none">
                  <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-6 flex flex-col justify-between shadow-[0_0_50px_rgba(168,85,247,0.25)]">
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:12px_12px] pointer-events-none opacity-40"></div>
                    
                    {/* Crop Marks */}
                    <div className="absolute top-3 left-3 w-3 h-3 border-t-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                    <div className="absolute top-3 right-3 w-3 h-3 border-t-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>
                    <div className="absolute bottom-3 left-3 w-3 h-3 border-b-2 border-l-2 border-[#a855f7]/40 pointer-events-none"></div>
                    <div className="absolute bottom-3 right-3 w-3 h-3 border-b-2 border-r-2 border-[#a855f7]/40 pointer-events-none"></div>

                    {/* Top Section */}
                    <div className="flex justify-between items-start border-b border-[#a855f7]/25 pb-3 relative z-10">
                      <div className="text-left w-full">
                        <div className="flex items-center gap-1 justify-center">
                          <span className="material-symbols-outlined text-[14px] text-[#a855f7]">sports_esports</span>
                          <h4 className="font-display-lg text-sm text-white font-black tracking-widest leading-none">VRGC</h4>
                        </div>
                        <span className="text-[#a855f7]/80 text-[5px] font-code-sm tracking-wider uppercase block mt-1 font-bold text-center">VIRTUAL REALITY & GAMING CLUB</span>
                      </div>
                    </div>

                    {/* Portrait Photo Frame */}
                    <div className="flex flex-col items-center justify-center my-3 relative z-10">
                      <div className="w-36 h-36 rounded-2xl border-2 border-[#a855f7]/30 p-1 bg-black/40 shadow-[0_0_20px_rgba(168,85,247,0.15)] relative overflow-hidden">
                        <img 
                          src={member?.["Photo URL"]} 
                          alt="Member Avatar" 
                          className="w-full h-full object-cover rounded-xl"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute bottom-1 right-1 bg-gradient-to-r from-[#a855f7]/80 to-[#cf5cff]/80 text-white text-[6px] font-black px-1.5 py-0.5 rounded tracking-widest uppercase shadow-md pointer-events-none opacity-85">
                          VERIFIED
                        </div>
                      </div>
                    </div>

                    {/* Bio Details */}
                    <div className="bg-[#0b0512]/90 border border-[#a855f7]/25 p-3 rounded-2xl relative z-10 space-y-2.5">
                      <div className="border-b border-white/5 pb-1.5 text-left">
                        <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">NAME</span>
                        <h3 className="font-display-lg text-sm text-white font-extrabold tracking-wide uppercase truncate leading-none">
                          {member?.Name}
                        </h3>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-left">
                        <div>
                          <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">REGISTRATION NO.</span>
                          <span className="font-code-sm text-[10px] text-white font-bold tracking-wider block">
                            {member?.["Registration Number"]}
                          </span>
                        </div>
                        <div>
                          {(() => {
                            const displayInfo = getAdminDisplayRoleOrTeam(member?.Team, member?.Position);
                            return (
                              <>
                                <span className="font-code-sm text-[6px] text-[#a855f7] uppercase tracking-widest block mb-0.5 font-extrabold">{displayInfo.label === 'TEAM / DIVISION' ? 'TEAM' : displayInfo.label}</span>
                                <span className="font-code-sm text-[10px] text-white font-bold tracking-wider block uppercase truncate">
                                  {displayInfo.value || 'DEVELOPMENT'}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="pt-1.5 border-t border-white/5 flex items-center gap-1.5 justify-start">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] shadow-[0_0_8px_#a855f7] animate-pulse"></span>
                        <span className="font-code-sm text-[8px] text-[#ddb7ff] font-extrabold uppercase tracking-widest leading-none">
                          {(() => {
                            const displayInfo = getAdminDisplayRoleOrTeam(member?.Team, member?.Position);
                            return displayInfo.isSpecial ? displayInfo.value : (member?.Position || 'CORE MEMBER');
                          })()}
                        </span>
                      </div>
                    </div>

                    <div className="absolute bottom-1 right-2 text-[5px] font-bold text-white/20 font-code-sm uppercase tracking-widest pointer-events-none">
                      TAP TO FLIP
                    </div>
                  </div>
                </div>

                {/* BACK OF THE ID CARD */}
                <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] select-none">
                  <div className="relative overflow-hidden w-full h-full rounded-3xl border border-[#a855f7]/35 bg-gradient-to-b from-[#12051e] via-[#05010a] to-[#0c0416] p-6 flex flex-col justify-between shadow-[0_0_50px_rgba(168,85,247,0.25)]">
                    {member?.["Avatar URL"] && (
                      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none rounded-3xl">
                        <img 
                          src={member["Avatar URL"]} 
                          alt="Avatar Watermark" 
                          className="w-full h-full object-cover opacity-95 brightness-110 contrast-105"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-[#05010a]/10 bg-gradient-to-b from-transparent via-[#05010a]/20 to-[#05010a]/50"></div>
                      </div>
                    )}

                    <div className="text-center relative z-10 border-b border-[#a855f7]/25 pb-2">
                      <h4 className="font-display-lg text-sm text-white font-black tracking-widest uppercase">VRGC</h4>
                      <span className="font-code-sm text-[5px] text-[#a855f7]/80 tracking-wider block mt-0.5">VIRTUAL REALITY & GAMING CLUB</span>
                    </div>

                    <div className="my-3 flex flex-col items-center justify-center relative z-10">
                      <div className="w-28 h-28 rounded-xl border border-white/10 bg-white p-1.5 shadow-[0_0_25px_rgba(168,85,247,0.25)]">
                        <img 
                          src={member?.["QR Code URL"] || `https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=0-0-0&bgcolor=ffffff&data=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/card/${member?.["Registration Number"] || ''}` : `https://vrgcformsbackup.vercel.app/card/${member?.["Registration Number"] || ''}`)}`} 
                          alt="Scan to Verify" 
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <span className="font-code-sm text-[6px] text-[#a855f7] font-black uppercase tracking-widest block mt-2">SCAN TO CONNECT</span>
                    </div>

                    <div className="space-y-1.5 border-t border-[#a855f7]/25 pt-2.5 relative z-10 text-[7px] font-code-sm text-white/70 text-left w-full pl-2">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[10px] text-[#a855f7]">alternate_email</span>
                        <span>@vrgc_official</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[10px] text-[#a855f7]">forum</span>
                        <span>discord.gg/vrgc</span>
                      </div>
                    </div>

                    <div className="text-center text-[7px] font-extrabold text-[#a855f7]/80 tracking-widest mt-2.5 uppercase relative z-10">
                      PLAY • CREATE • INNOVATE
                    </div>
                  </div>
                </div>

              </div>
            </div>

            <Link
              href="/"
              className="mt-6 px-8 py-3 rounded-full bg-gradient-to-r from-[#a855f7] to-[#cf5cff] text-white hover:opacity-90 transition-all font-bold font-label-caps text-xs tracking-wider shadow-[0_0_20px_rgba(168,85,247,0.3)] inline-block"
            >
              GO TO HOME
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
