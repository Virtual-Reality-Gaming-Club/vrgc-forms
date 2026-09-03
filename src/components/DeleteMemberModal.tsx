"use client";

import React, { useEffect } from "react";

export interface DeleteMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  memberName: string;
  memberRegNo: string;
  isLoading?: boolean;
}

export const DeleteMemberModal: React.FC<DeleteMemberModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  memberName,
  memberRegNo,
  isLoading = false,
}) => {
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // Close on Escape key (unless loading)
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isLoading) {
      onClose();
    }
  };

  const handleConfirm = async () => {
    if (isLoading) return;
    try {
      await onConfirm();
    } catch (error) {
      console.error("Failed to delete member:", error);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm select-none"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-[#0e0518] border border-rose-500/30 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl shadow-rose-950/30 relative flex flex-col max-h-[92vh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3.5 mb-4">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-rose-400 text-2xl">
              warning
            </span>
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight">
              Delete Member?
            </h2>
          </div>
        </div>

        {/* Body message */}
        <div className="text-slate-300 text-sm leading-relaxed mb-6 space-y-2">
          <p>
            This action will permanently remove{" "}
            <span className="font-bold text-rose-300">
              {memberName} ({memberRegNo})
            </span>{" "}
            from the roster.
          </p>
          <p>Are you sure you want to continue?</p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm text-center"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(225,29,72,0.3)] hover:shadow-[0_0_25px_rgba(225,29,72,0.45)]"
          >
            {isLoading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">
                  progress_activity
                </span>
                <span>Deleting...</span>
              </>
            ) : (
              "Delete Member"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteMemberModal;
