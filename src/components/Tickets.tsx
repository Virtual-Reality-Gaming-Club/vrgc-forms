"use client";

import React, { useState } from 'react';

interface TicketsProps {
  onRedirect?: () => void;
}

const Tickets: React.FC<TicketsProps> = ({ onRedirect }) => {
  const [issueType, setIssueType] = useState('Technical');
  const [priority, setPriority] = useState('low');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) {
      alert('Please fill out all fields before submitting.');
      return;
    }

    setIsSubmitting(true);

    const payload = {
      formType: 'ticket',
      issueType,
      priority,
      subject,
      description,
      fileName: file ? file.name : 'None',
    };

    const handleSuccess = () => {
      setIsSubmitting(false);
      alert('Support ticket submitted successfully to Google Sheets!');
      resetForm();
      if (onRedirect) onRedirect();
    };

    try {
      const res = await fetch('/api/sheets/referral', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Submission failed');
      }

      handleSuccess();
    } catch (error) {
      console.error('Error submitting form', error);
      setIsSubmitting(false);
      alert('Submission failed. Check console logs or Web App configurations.');
    }
  };

  const resetForm = () => {
    setIssueType('Technical');
    setPriority('low');
    setSubject('');
    setDescription('');
    setFile(null);
  };

  return (
    <div className="flex-grow w-full pt-6 pb-12 px-3 sm:px-6 md:px-8 bg-mesh text-left">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Breadcrumbs & Intro */}
        <div className="stagger-in">
          <p className="font-label-caps text-xs text-purple-400 mb-2 uppercase tracking-widest font-bold">
            Help Desk / New Ticket
          </p>
          <h2 className="font-display-lg text-3xl md:text-5xl text-white font-extrabold mb-3 uppercase">
            SUPPORT TICKET
          </h2>
          <p className="text-slate-400 max-w-xl text-sm md:text-base leading-relaxed">
            Experiencing technical glitches or need event clearance? Our Elite Support Team is ready to assist you. Fill out the form below with precision.
          </p>
        </div>

        {/* Ticket Form Card */}
        <div className="glass-panel rounded-2xl p-8 md:p-12 relative overflow-hidden border border-purple-500/30 shadow-[0_0_40px_rgba(168,85,247,0.1)] stagger-in">
          <form className="space-y-8 relative z-10" onSubmit={handleSubmit}>
            {/* Row 1: Issue Type & Priority */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <label className="font-label-caps text-xs text-purple-300 font-bold uppercase tracking-widest">
                  Issue Type
                </label>
                <select
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value)}
                  className="w-full bg-[#0e0518] border border-purple-500/30 text-white rounded-xl p-3.5 text-sm focus:border-purple-500 focus:outline-none cursor-pointer"
                >
                  <option value="Technical">Technical</option>
                  <option value="Event">Event</option>
                  <option value="Membership">Membership</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-label-caps text-xs text-purple-300 font-bold uppercase tracking-widest">
                  Priority Level
                </label>
                <div className="flex gap-2">
                  {['low', 'medium', 'high'].map((lvl) => {
                    const isChecked = priority === lvl;
                    let styleClass = '';
                    if (lvl === 'low') {
                      styleClass = isChecked
                        ? 'bg-purple-500/20 border-purple-500 text-purple-300 font-bold'
                        : 'border-purple-500/20 bg-black/40 text-slate-400';
                    } else if (lvl === 'medium') {
                      styleClass = isChecked
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                        : 'border-purple-500/20 bg-black/40 text-slate-400';
                    } else {
                      styleClass = isChecked
                        ? 'bg-red-500/20 border-red-500 text-red-300 font-bold'
                        : 'border-purple-500/20 bg-black/40 text-slate-400';
                    }
                    return (
                      <label key={lvl} className="flex-1 cursor-pointer">
                        <input
                          className="sr-only"
                          name="priority"
                          type="radio"
                          value={lvl}
                          checked={isChecked}
                          onChange={() => setPriority(lvl)}
                        />
                        <div className={`text-center p-3 rounded-xl border text-xs tracking-wider uppercase transition-all ${styleClass}`}>
                          {lvl}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Subject */}
            <div className="flex flex-col gap-2">
              <label className="font-label-caps text-xs text-purple-300 font-bold uppercase tracking-widest">
                Subject
              </label>
              <input
                className="w-full bg-black/50 border border-purple-500/30 text-white rounded-xl p-3.5 text-sm placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
                placeholder="Brief summary of your query"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-2">
              <label className="font-label-caps text-xs text-purple-300 font-bold uppercase tracking-widest">
                Detailed Description
              </label>
              <textarea
                className="w-full bg-black/50 border border-purple-500/30 text-white rounded-xl p-3.5 text-sm resize-none placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
                placeholder="Describe the steps to reproduce the issue or the specifics of your request..."
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              ></textarea>
            </div>

            {/* File Upload Dropzone */}
            <div className="flex flex-col gap-2">
              <label className="font-label-caps text-xs text-purple-300 font-bold uppercase tracking-widest">
                Screenshots of the issue
              </label>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById('screenshot-upload')?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer ${
                  dragOver ? 'border-purple-500 bg-purple-500/10' : 'border-purple-500/30 bg-black/40 hover:border-purple-500/50'
                }`}
              >
                <span className="material-symbols-outlined text-4xl text-purple-400 mb-3">cloud_upload</span>
                <p className="text-sm font-bold text-white">
                  {file ? `Selected file: ${file.name}` : 'Drag and drop files or browse'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  PNG, JPG or PDF up to 10MB
                </p>
                <input
                  id="screenshot-upload"
                  className="hidden"
                  type="file"
                  onChange={handleFileChange}
                  accept="image/*,application/pdf"
                />
              </div>
            </div>

            {/* Action Area */}
            <div className="pt-4 flex flex-col md:flex-row items-center justify-between gap-6 border-t border-purple-500/20">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-code-sm">
                <span className="material-symbols-outlined text-purple-400 text-base">info</span>
                <span>Avg. response time: &lt; 12 hours</span>
              </div>
              <button
                disabled={isSubmitting}
                className="w-full md:w-auto bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 px-10 rounded-full text-xs font-label-caps tracking-widest uppercase shadow-[0_0_30px_rgba(168,85,247,0.4)] active:scale-95 transition-all flex items-center justify-center gap-2"
                type="submit"
              >
                {isSubmitting ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-sm">sync</span> TRANSMITTING...
                  </>
                ) : (
                  <>
                    <span>SUBMIT TICKET</span>
                    <span className="material-symbols-outlined text-sm">send</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Tickets;
