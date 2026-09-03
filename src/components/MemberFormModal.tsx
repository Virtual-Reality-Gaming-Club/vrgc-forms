"use client";

import React, { useState, useEffect } from "react";
import type { MemberFormData } from "@/lib/members";

export interface MemberFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: MemberFormData) => Promise<void>;
  initialData?: MemberFormData | null; // null = Add mode, populated = Edit mode
  isLoading?: boolean;
  availableTeams?: string[];
  availablePositions?: string[];
}

const DEFAULT_TEAMS = [
  "Design Team",
  "Education",
  "Esports Mobile",
  "Esports PC",
  "Leadership",
  "PR",
  "Social Media",
  "Technical Team"
];

const DEFAULT_POSITIONS = [
  "Member",
  "Lead",
  "Head",
  "Co-President",
  "Student Coordinator"
];

const defaultFormData: MemberFormData = {
  name: "",
  registrationNumber: "",
  email: "",
  phone: "",
  team: "Technical Team",
  position: "Member",
};

export const MemberFormModal: React.FC<MemberFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  isLoading = false,
  availableTeams,
  availablePositions,
}) => {
  const [formData, setFormData] = useState<MemberFormData>(defaultFormData);
  const [errors, setErrors] = useState<Partial<Record<keyof MemberFormData, string>>>({});

  // Dynamically compute team options from roster data, initialData, and standard defaults
  const teamOptions = React.useMemo(() => {
    const list = new Set(availableTeams && availableTeams.length > 0 ? availableTeams : DEFAULT_TEAMS);
    if (initialData?.team) list.add(initialData.team);
    return Array.from(list).filter(Boolean).sort();
  }, [availableTeams, initialData?.team]);

  // Dynamically compute position options from roster data, initialData, and standard defaults
  const positionOptions = React.useMemo(() => {
    const list = new Set(availablePositions && availablePositions.length > 0 ? availablePositions : DEFAULT_POSITIONS);
    if (initialData?.position) list.add(initialData.position);
    return Array.from(list).filter(Boolean);
  }, [availablePositions, initialData?.position]);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setFormData({
          name: initialData.name || "",
          registrationNumber: initialData.registrationNumber || "",
          email: initialData.email || "",
          phone: initialData.phone || "",
          team: initialData.team || "Technical Team",
          position: initialData.position || "Member",
        });
      } else {
        setFormData(defaultFormData);
      }
      setErrors({});
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, initialData]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isLoading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, isLoading, onClose]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name as keyof MemberFormData]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof MemberFormData, string>> = {};
    if (!formData.name.trim()) newErrors.name = "Name is required";
    if (!formData.registrationNumber.trim()) newErrors.registrationNumber = "Registration number is required";
    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Invalid email format";
    }
    if (!formData.team) newErrors.team = "Team is required";
    if (!formData.position) newErrors.position = "Position is required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    
    await onSubmit({
      ...formData,
      registrationNumber: formData.registrationNumber.toUpperCase()
    });
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm select-none"
      onClick={() => !isLoading && onClose()}
    >
      <div 
        className="w-full max-w-lg bg-[#0e0518] border border-purple-500/30 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-purple-500/20 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <span className="material-symbols-outlined text-purple-400 text-xl sm:text-2xl">
              {initialData ? "edit" : "person_add"}
            </span>
            <h2 className="text-lg sm:text-xl font-semibold text-white">
              {initialData ? "Edit Member" : "Add New Member"}
            </h2>
          </div>
          <button 
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1 overscroll-contain">
          <form id="member-form" onSubmit={handleSubmit} className="space-y-4">
            
            <div className="space-y-1">
              <label className="block text-xs sm:text-sm font-medium text-slate-300 font-label-caps">
                Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                disabled={isLoading}
                placeholder="John Doe"
                className="w-full px-3.5 sm:px-4 py-2.5 sm:py-2 bg-black/40 border border-purple-500/30 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-purple-400 transition-colors text-base sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {errors.name && <p className="text-rose-400 text-[11px] mt-1">{errors.name}</p>}
            </div>

            <div className="space-y-1">
              <label className="block text-xs sm:text-sm font-medium text-slate-300 font-label-caps">
                Registration Number <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                name="registrationNumber"
                value={formData.registrationNumber}
                onChange={handleChange}
                disabled={isLoading}
                placeholder="23BCE0000"
                className="w-full px-3.5 sm:px-4 py-2.5 sm:py-2 bg-black/40 border border-purple-500/30 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-purple-400 transition-colors uppercase text-base sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {errors.registrationNumber && <p className="text-rose-400 text-[11px] mt-1">{errors.registrationNumber}</p>}
            </div>

            <div className="space-y-1">
              <label className="block text-xs sm:text-sm font-medium text-slate-300 font-label-caps">
                Email <span className="text-rose-500">*</span>
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                disabled={isLoading}
                placeholder="john@example.com"
                className="w-full px-3.5 sm:px-4 py-2.5 sm:py-2 bg-black/40 border border-purple-500/30 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-purple-400 transition-colors text-base sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {errors.email && <p className="text-rose-400 text-[11px] mt-1">{errors.email}</p>}
            </div>

            <div className="space-y-1">
              <label className="block text-xs sm:text-sm font-medium text-slate-300 font-label-caps">
                Phone
              </label>
              <input
                type="text"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                disabled={isLoading}
                placeholder="+1 234 567 890"
                className="w-full px-3.5 sm:px-4 py-2.5 sm:py-2 bg-black/40 border border-purple-500/30 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-purple-400 transition-colors text-base sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-1">
                <label className="block text-xs sm:text-sm font-medium text-slate-300 font-label-caps">
                  Team <span className="text-rose-500">*</span>
                </label>
                <select
                  name="team"
                  value={formData.team}
                  onChange={handleChange}
                  disabled={isLoading}
                  className="w-full px-3.5 sm:px-4 py-2.5 sm:py-2 bg-black/40 border border-purple-500/30 rounded-xl text-white focus:outline-none focus:border-purple-400 transition-colors appearance-none cursor-pointer text-base sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="" disabled>Select Team</option>
                  {teamOptions.map(team => (
                    <option key={team} value={team} className="bg-[#120822] text-white">
                      {team}
                    </option>
                  ))}
                </select>
                {errors.team && <p className="text-rose-400 text-[11px] mt-1">{errors.team}</p>}
              </div>

              <div className="space-y-1">
                <label className="block text-xs sm:text-sm font-medium text-slate-300 font-label-caps">
                  Position <span className="text-rose-500">*</span>
                </label>
                <select
                  name="position"
                  value={formData.position}
                  onChange={handleChange}
                  disabled={isLoading}
                  className="w-full px-3.5 sm:px-4 py-2.5 sm:py-2 bg-black/40 border border-purple-500/30 rounded-xl text-white focus:outline-none focus:border-purple-400 transition-colors appearance-none cursor-pointer text-base sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="" disabled>Select Position</option>
                  {positionOptions.map(pos => (
                    <option key={pos} value={pos} className="bg-[#120822] text-white">
                      {pos}
                    </option>
                  ))}
                </select>
                {errors.position && <p className="text-rose-400 text-[11px] mt-1">{errors.position}</p>}
              </div>
            </div>
          </form>
        </div>

        <div className="p-4 sm:p-6 border-t border-purple-500/20 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 sm:gap-3 rounded-b-2xl bg-[#130822]/60 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="w-full sm:w-auto px-5 py-2.5 sm:py-2 rounded-xl bg-white/5 text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm text-center"
          >
            Cancel
          </button>
          <button
            form="member-form"
            type="submit"
            disabled={isLoading}
            className="w-full sm:w-auto px-5 py-2.5 sm:py-2 rounded-xl bg-purple-600 text-white hover:bg-purple-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm flex items-center justify-center min-w-[100px] shadow-[0_0_15px_rgba(168,85,247,0.3)] active:scale-[0.98]"
          >
            {isLoading ? (
              <span className="material-symbols-outlined animate-spin text-[20px]">
                progress_activity
              </span>
            ) : (
              "Save Member"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MemberFormModal;
