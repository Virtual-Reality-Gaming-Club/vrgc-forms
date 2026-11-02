"use client";

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import SpecularButton from './SpecularButton';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import Image from 'next/image';
import { normalizeDepartment, departmentTemplates } from '@/data/offerLetterTemplates';

interface OfferLetterProps {
  onPageChange: (page: string) => void;
}

const OfferLetter: React.FC<OfferLetterProps> = ({ onPageChange }) => {
  const { memberData, user, userEmail, authLoading } = useAuth();
  const letterRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Original member data from Firestore (not overridden by admin role)
  const [origPosition, setOrigPosition] = useState<string | null>(null);
  const [origTeam, setOrigTeam] = useState<string | null>(null);
  const [dataReady, setDataReady] = useState(false);

  // Website access roles that grant portal privileges and should not appear on official offer letters
  const WEBSITE_ROLES = ['admin', 'super admin', 'super administrator', 'payment admin', 'administrator'];

  const sanitizeClubPosition = (pos: string | null | undefined): string | null => {
    if (!pos) return null;
    const clean = pos.trim();
    if (WEBSITE_ROLES.includes(clean.toLowerCase())) {
      return null;
    }
    return clean;
  };

  /* ── Fetch original member record for correct position/team ──────────── */
  useEffect(() => {
    if (!userEmail) {
      // Defer state update to avoid synchronous cascading render warning
      setTimeout(() => setDataReady(true), 0);
      return;
    }

    const fetchOriginal = async () => {
      try {
        const email = userEmail.toLowerCase().trim();
        let foundData: any = null;

        // 1. Check members collection by email
        const qEmail = query(collection(db, 'members'), where('email', '==', email));
        const snapEmail = await getDocs(qEmail);
        if (!snapEmail.empty) {
          foundData = snapEmail.docs[0].data();
        }

        // 2. Check members collection by regNo if available
        if (!foundData && memberData?.registrationNumber) {
          const reg = memberData.registrationNumber.toUpperCase().trim();
          const qReg = query(collection(db, 'members'), where('registrationNumber', '==', reg));
          const snapReg = await getDocs(qReg);
          if (!snapReg.empty) {
            foundData = snapReg.docs[0].data();
          }
        }

        // 3. Fallback to id_cards collection if not found in members
        if (!foundData) {
          const qIdEmail = query(collection(db, 'id_cards'), where('email', '==', email));
          const snapId = await getDocs(qIdEmail);
          if (!snapId.empty) {
            foundData = snapId.docs[0].data();
          }
        }

        if (foundData) {
          const pos = sanitizeClubPosition(foundData.position || foundData.role);
          setOrigPosition(pos);
          setOrigTeam(foundData.team || foundData.domain || null);
        }
      } catch (err) {
        console.warn('OfferLetter: failed to fetch original member data:', err);
      } finally {
        setDataReady(true);
      }
    };

    fetchOriginal();
  }, [userEmail, memberData?.registrationNumber]);

  /* ── PDF download ────────────────────────────────────────────────────── */
  const handleDownloadPdf = useCallback(async () => {
    if (!letterRef.current || !memberData) return;
    setIsGeneratingPdf(true);

    try {
      const original = letterRef.current;
      const clone = original.cloneNode(true) as HTMLElement;

      // 1. Create a dedicated A4 PDF rendering container
      const A4_W = 794;
      const A4_H = 1123;

      clone.style.position = 'absolute';
      clone.style.top = '-9999px';
      clone.style.left = '-9999px';
      clone.style.width = `${A4_W}px`;
      clone.style.height = `${A4_H}px`;
      clone.style.maxWidth = 'none';
      clone.style.maxHeight = 'none';
      clone.style.boxSizing = 'border-box';
      clone.style.overflow = 'hidden';
      clone.style.transform = 'none';
      clone.style.margin = '0';

      // Remove box shadow / rounding for clean print
      clone.style.boxShadow = 'none';
      clone.style.borderRadius = '0';
      clone.style.border = 'none';

      document.body.appendChild(clone);

      // 2. Convert unsupported colors (oklab, oklch) to RGB using browser's native parser
      const colorCanvas = document.createElement('canvas');
      colorCanvas.width = 1;
      colorCanvas.height = 1;
      const ctx = colorCanvas.getContext('2d', { willReadFrequently: true });

      const toRgba = (colorStr: string) => {
        if (!ctx) return colorStr;
        const lower = colorStr.toLowerCase();
        if (!lower.includes('oklch') && !lower.includes('oklab') && !lower.includes('color(') && !lower.includes('lab') && !lower.includes('lch')) {
          return colorStr;
        }
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = colorStr;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
      };

      const sanitizeComplexString = (str: string) => {
        if (!str) return str;
        if (!str.match(/(oklch|oklab|color|lab|lch)\(/i)) return str;
        const colorRegex = /(oklch|oklab|color|lab|lch)\([^)]+\)/gi;
        return str.replace(colorRegex, (match) => toRgba(match));
      };

      const origNodes = [original, ...Array.from(original.querySelectorAll('*'))] as HTMLElement[];
      const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))] as HTMLElement[];

      const propsToSanitize = [
        'color', 'backgroundColor', 'borderColor',
        'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
        'boxShadow', 'textShadow', 'outlineColor'
      ];

      for (let i = 0; i < origNodes.length; i++) {
        const o = origNodes[i];
        const c = cloneNodes[i];
        const computed = window.getComputedStyle(o);

        propsToSanitize.forEach(prop => {
          const val = computed[prop as any];
          if (val) {
            c.style[prop as any] = sanitizeComplexString(val);
          }
        });

        c.style.transition = 'none';
        c.style.animation = 'none';
      }

      // 3. Wait for all images to fully load
      const images = Array.from(clone.querySelectorAll('img'));
      await Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }));

      // Allow a brief moment for the DOM to paint the clone
      await new Promise(r => setTimeout(r, 100));

      // 4. Proportional scaling if content exceeds A4 height
      const scrollH = clone.scrollHeight;
      if (scrollH > A4_H) {
        const scale = A4_H / scrollH;
        // Wrap clone contents in a scaler div to shrink it
        const wrapper = document.createElement('div');
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.transformOrigin = 'top center';
        wrapper.style.width = '100%';

        while (clone.firstChild) {
          wrapper.appendChild(clone.firstChild);
        }
        clone.appendChild(wrapper);
      }

      // 5. Capture with html2canvas forcing desktop media queries
      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#07020F',
        logging: false,
        width: A4_W,
        height: A4_H,
        windowWidth: 1200,
        windowHeight: 1080
      });

      // Cleanup clone
      document.body.removeChild(clone);

      // 6. Generate exact A4 PDF
      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);

      const regNo = memberData.registrationNumber || 'MEMBER';
      pdf.save(`VRGC_Offer_Letter_${regNo.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);

    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [memberData]);

  /* ── Loading state ───────────────────────────────────────────────────── */
  if (authLoading || !dataReady) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
          <p className="text-sm text-slate-400 font-medium">Loading your offer letter…</p>
        </div>
      </div>
    );
  }

  /* ── Not logged in ───────────────────────────────────────────────────── */
  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#0c0517]/95 border border-purple-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.15)] flex flex-col items-center gap-5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-purple-950/80 border border-purple-500/50 flex items-center justify-center shadow-inner">
            <span className="material-symbols-outlined text-purple-400 text-3xl">lock</span>
          </div>
          <h3 className="text-xl font-black text-white">Sign In Required</h3>
          <p className="text-xs text-slate-400 leading-relaxed">Please sign in to access your personalized offer letter.</p>
        </div>
      </div>
    );
  }

  /* ── Incomplete member data ──────────────────────────────────────────── */
  if (!memberData || !memberData.name || !memberData.registrationNumber) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#0c0517]/95 border border-amber-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-[0_0_60px_rgba(245,158,11,0.1)] flex flex-col items-center gap-5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-950/80 border border-amber-500/50 flex items-center justify-center shadow-inner">
            <span className="material-symbols-outlined text-amber-400 text-3xl">error_outline</span>
          </div>
          <h3 className="text-xl font-black text-white">Offer Letter Unavailable</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Your member profile is incomplete. Please ensure your name, registration number, department, and position are updated.
          </p>
          <button onClick={() => onPageChange('dashboard')} className="px-4 py-2 bg-[#1b0d2e] hover:bg-[#271342] text-slate-200 text-xs font-bold rounded-xl border border-purple-500/30 transition-all cursor-pointer flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>
    );
  }

  const { registrationNumber, name } = memberData;
  const position = sanitizeClubPosition(origPosition) || sanitizeClubPosition(memberData.position) || 'Core Member';
  const team = origTeam || memberData.team;

  const deptKey = normalizeDepartment(team);

  if (!deptKey) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#0c0517]/95 border border-amber-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-[0_0_60px_rgba(245,158,11,0.1)] flex flex-col items-center gap-5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-950/80 border border-amber-500/50 flex items-center justify-center shadow-inner">
            <span className="material-symbols-outlined text-amber-400 text-3xl">error_outline</span>
          </div>
          <h3 className="text-xl font-black text-white">Offer Letter Unavailable</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Offer letter unavailable. Please contact an admin to verify your department assignment.
          </p>
          <button onClick={() => onPageChange('dashboard')} className="px-4 py-2 bg-[#1b0d2e] hover:bg-[#271342] text-slate-200 text-xs font-bold rounded-xl border border-purple-500/30 transition-all cursor-pointer flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>
    );
  }

  const template = departmentTemplates[deptKey];

  return (
    <div className="flex-1 p-4 sm:p-6 md:p-8 w-full mx-auto flex flex-col items-center">

      {/* ── Page header (Not part of PDF) ────────────────────────────────── */}
      <div className="w-full max-w-4xl mb-6">
        <button
          onClick={() => onPageChange('dashboard')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-4 bg-[#1b0d2e] hover:bg-[#271342] text-slate-200 text-xs font-bold rounded-xl border border-purple-500/30 transition-all cursor-pointer"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          <span>Back to Dashboard</span>
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-purple-950/80 border border-purple-500/40 flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.2)]">
            <span className="material-symbols-outlined text-purple-400 text-xl sm:text-2xl">workspace_premium</span>
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">Offer Letter</h1>
            <p className="text-xs sm:text-sm text-slate-400 font-medium">Official VRGC Core Team Appointment Letter</p>
          </div>
        </div>
      </div>

      {/* ── Official Offer Letter Document ───────────────────────────────── */}
      <div
        ref={letterRef}
        className="w-full bg-[#07020F] shadow-[0_0_50px_rgba(147,51,234,0.15)] rounded-sm overflow-hidden relative mx-auto"
        style={{
          containerType: 'inline-size',
          aspectRatio: '1 / 1.414',
          maxWidth: '800px',
          backgroundSize: '100% 100%',
          // New background (VRGC header centred). "?v=2" makes browsers fetch it instead of the old cached image.
          backgroundImage: 'url("/offerLetters/offer-letter-background.jpeg?v=2")'
        }}
      >
        {/* Header logos — symmetric pair above the centred VRGC wordmark.
            Both share the same height (the VIT logo's original size: 22cqi wide ≈ 8.95cqi tall), top
            offset and side margin (mirrored), and the same white-on-dark treatment. Heights are in
            cqi so they scale with the letter. */}
        {/* VIT Bhopal – Office of Students' Welfare Logo (top-left) */}
        <div className="absolute top-[3.5%] left-[4.8%] pointer-events-none">
          <Image
            unoptimized
            src="/offerLetters/osw-logo-white.png"
            alt="Office of Students' Welfare, VIT Bhopal University"
            width={984}
            height={305}
            style={{ height: '8.95cqi', width: 'auto' }}
            className="object-contain block"
          />
        </div>

        {/* VIT Bhopal Logo Overlay (top-right) — original size */}
        <div className="absolute top-[3.5%] right-[4.8%] pointer-events-none">
          <Image
            unoptimized
            src="/offerLetters/vit-bhopal-logo.png"
            alt="VIT Bhopal Logo"
            width={354}
            height={144}
            style={{ height: '8.95cqi', width: 'auto' }}
            className="object-contain block"
          />
        </div>

        {/* Document Content Container */}
        <div className="absolute z-10 top-[26.5%] left-[26%] right-[9%] bottom-[8%] flex flex-col justify-between">

          {/* Body Content */}
          <div className="text-[#f8f9fa] leading-[1.6] font-medium tracking-wide" style={{ fontSize: '1.45cqi' }}>

            <h3 className="font-black text-white mb-[3%] tracking-tight" style={{ fontSize: '2.4cqi' }}>
              CONGRATULATIONS!
            </h3>

            <p className="mb-[2.5%]">
              Dear <span className="font-bold text-white">{name} ({registrationNumber})</span>,
            </p>

            <p className="mb-[2.5%] text-justify">
              {template.p1}
            </p>

            <p className="mb-[3%] text-justify">
              {template.p2}
            </p>

            <p className="mb-[3%] text-justify">
              {template.closing}
            </p>

            {template.hasWelcomeLine && (
              <p className="mb-[3%] font-semibold text-white">
                Welcome to the VRGC Core Team. The next level begins now.
              </p>
            )}

            {/* Position Box */}
            <div className="inline-block border-l-[4px] border-purple-500 bg-purple-950/40 px-[4%] py-[2.5%] mb-[3%]">
              <p className="m-0" style={{ fontSize: '1.5cqi' }}>
                <span className="text-slate-300 mr-2">Position:</span>
                <span className="font-bold text-white">{position}</span>
              </p>
              <div className="h-1.5" />
              <p className="m-0" style={{ fontSize: '1.5cqi' }}>
                <span className="text-slate-300 mr-2">Department:</span>
                <span className="font-bold text-white">{template.displayName}</span>
              </p>
            </div>

            {/* Closing */}
            <div className="text-slate-300 space-y-[2px]" style={{ fontSize: '1.2cqi' }}>
              <p className="font-bold text-slate-200">With Best Wishes,</p>
              <p className="font-bold text-slate-200">VRGC Recruitment Team</p>
              <p className="font-bold text-slate-200">Virtual Reality and Gaming Club</p>
              <p className="italic text-slate-300 pt-1" style={{ fontSize: '1.1cqi' }}>
                E-Sports • Game Development • Virtual Reality • Workshops • Innovation
              </p>
              <p className="font-bold text-white pt-1">&quot;Play Together. Build Together. Win Together.&quot;</p>
            </div>
          </div>

          {/* Signatures Footer */}
          <div className="grid grid-cols-3 gap-2 mt-auto pt-2 relative z-20">
            <div className="flex flex-col items-center text-center">
              <div style={{ height: '7cqi' }} className="w-full flex items-end justify-center mb-1">
                <img src="/offerLetters/signature-lokesh-white-cropped.png?v=2" alt="Lokesh Sharma" style={{ height: '6.5cqi' }} className="max-w-[75%] object-contain object-bottom" />
              </div>
              <div className="h-[1px] w-[66%] bg-slate-500 mb-1" />
              <p className="font-bold text-white tracking-wide uppercase" style={{ fontSize: '1.15cqi' }}>Lokesh Sharma</p>
              <p className="text-slate-400" style={{ fontSize: '0.95cqi' }}>Co-President, VRGC</p>
            </div>

            <div className="flex flex-col items-center text-center">
              <div style={{ height: '7cqi' }} className="w-full flex items-end justify-center mb-1">
                <img src="/offerLetters/signature-dangi-white-cropped.png" alt="Dr. Ramraj Dangi" style={{ height: '6.0cqi' }} className="max-w-[75%] object-contain object-bottom" />
              </div>
              <div className="h-[1px] w-[66%] bg-slate-500 mb-1" />
              <p className="font-bold text-white tracking-wide uppercase" style={{ fontSize: '1.15cqi' }}>Dr. Ramraj Dangi</p>
              <p className="text-slate-400" style={{ fontSize: '0.95cqi' }}>Faculty Coordinator, VRGC</p>
            </div>

            <div className="flex flex-col items-center text-center">
              <div style={{ height: '7cqi' }} className="w-full flex items-end justify-center mb-1">
                <img src="/offerLetters/signature-shivansh-white-cropped.png" alt="Shivansh Sharma" style={{ height: '4.4cqi' }} className="max-w-[80%] object-contain object-bottom" />
              </div>
              <div className="h-[1px] w-[66%] bg-slate-500 mb-1" />
              <p className="font-bold text-white tracking-wide uppercase" style={{ fontSize: '1.15cqi' }}>Shivansh Sharma</p>
              <p className="text-slate-400" style={{ fontSize: '0.95cqi' }}>Co-President, VRGC</p>
            </div>
          </div>

        </div>
      </div>

      {/* ── Download button ───────────────────────────────────────── */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
        <SpecularButton
          size="md"
          radius={14}
          tint="#9333ea"
          tintOpacity={0.7}
          lineColor="#c084fc"
          baseColor="#581c87"
          intensity={1.2}
          onClick={handleDownloadPdf}
          className="font-bold text-white shadow-[0_0_25px_rgba(168,85,247,0.3)]"
        >
          {isGeneratingPdf ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin mr-2" />
              <span>Generating PDF…</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-lg mr-1.5">download</span>
              <span>Download Offer Letter</span>
            </>
          )}
        </SpecularButton>
        <span className="text-[10px] text-slate-500 font-mono">
          VRGC_Offer_Letter_{registrationNumber.replace(/[^a-zA-Z0-9]/g, '_')}.pdf
        </span>
      </div>

    </div>
  );
};

export default OfferLetter;