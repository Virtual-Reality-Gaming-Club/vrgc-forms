"use client";

import React, { useState, useEffect } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

// ── Types ────────────────────────────────────────────────────────────

export interface LiveStreamFeed {
  id: string;
  title: string;
  youtubeId: string;
  isActive: boolean;
  order: number;
}

export interface LiveConfigState {
  isLive: boolean;
  broadcastState: "live" | "starting_soon" | "offline";
  layoutMode: "auto" | "single" | "split-2" | "quad-4";
  activeStreamIndex: number;
  streams: LiveStreamFeed[];
  updatedAt?: any;
}

export interface TeamScoreState {
  id: string;
  name: string;
  tag: string;
  captain?: string;
  logo: string;
  side: "ATK" | "DEF";
  score: number;
  mapsWon: number;
  timeoutsRemaining: number;
  accentColor: string;
}

export interface ParallelMatch {
  id: string;
  matchNumber: number;
  stage: "Quarter-Finals" | "Semi-Finals" | "Grand Finals" | "Placement" | string;
  isFeatured: boolean;
  status: "upcoming" | "live" | "paused" | "ended";
  mapName: string;
  seriesFormat: "BO1" | "BO3" | "BO5";
  currentMapNumber: number;
  totalMaps: number;
  phase: "first_half" | "halftime" | "second_half" | "overtime" | "timeout" | "ended";
  activeTimeoutTeamId: string | null;
  team1: TeamScoreState;
  team2: TeamScoreState;
}

export interface LiveMatchTournamentState {
  gameType: string;
  tournamentName: string;
  activeMatchCount: number;
  featuredMatchId: string;
  matches: ParallelMatch[];
  showScoreboard: boolean;
  // Backward compatibility fields
  team1: TeamScoreState;
  team2: TeamScoreState;
  currentMap: string;
  currentMapNumber: number;
  totalMaps: number;
  seriesFormat: "BO1" | "BO3" | "BO5";
  phase: "first_half" | "halftime" | "second_half" | "overtime" | "timeout" | "ended";
  activeTimeoutTeamId: string | null;
  status: "upcoming" | "live" | "paused" | "ended";
  updatedAt?: any;
}

// ── Default State Values ─────────────────────────────────────────────

const DEFAULT_CONFIG: LiveConfigState = {
  isLive: false,
  broadcastState: "offline",
  layoutMode: "single",
  activeStreamIndex: 0,
  streams: [
    {
      id: "stream-1",
      title: "Main Broadcast Feed",
      youtubeId: "dQw4w9WgXcQ",
      isActive: true,
      order: 1,
    },
  ],
};

const DEFAULT_MATCHES: ParallelMatch[] = [
  {
    id: "match-1",
    matchNumber: 1,
    stage: "Semi-Finals",
    isFeatured: true,
    status: "live",
    mapName: "Ascent",
    seriesFormat: "BO3",
    currentMapNumber: 1,
    totalMaps: 3,
    phase: "first_half",
    activeTimeoutTeamId: null,
    team1: {
      id: "m1-t1",
      name: "VRGC Alpha",
      tag: "VRGC",
      logo: "/assets/teams/team_attackers.svg",
      side: "ATK",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#ff4655",
    },
    team2: {
      id: "m1-t2",
      name: "Shadow Royals",
      tag: "SHD",
      logo: "/assets/teams/team_defenders.svg",
      side: "DEF",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#00f0ff",
    },
  },
  {
    id: "match-2",
    matchNumber: 2,
    stage: "Semi-Finals",
    isFeatured: false,
    status: "live",
    mapName: "Bind",
    seriesFormat: "BO3",
    currentMapNumber: 1,
    totalMaps: 3,
    phase: "first_half",
    activeTimeoutTeamId: null,
    team1: {
      id: "m2-t1",
      name: "Titan Squad",
      tag: "TITAN",
      logo: "/assets/teams/team_attackers.svg",
      side: "ATK",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#ff4655",
    },
    team2: {
      id: "m2-t2",
      name: "Reaper Esports",
      tag: "REAP",
      logo: "/assets/teams/team_defenders.svg",
      side: "DEF",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#00f0ff",
    },
  },
  {
    id: "match-3",
    matchNumber: 3,
    stage: "Quarter-Finals",
    isFeatured: false,
    status: "upcoming",
    mapName: "Haven",
    seriesFormat: "BO3",
    currentMapNumber: 1,
    totalMaps: 3,
    phase: "first_half",
    activeTimeoutTeamId: null,
    team1: {
      id: "m3-t1",
      name: "Ghost Warriors",
      tag: "GHOST",
      logo: "/assets/teams/team_attackers.svg",
      side: "ATK",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#ff4655",
    },
    team2: {
      id: "m3-t2",
      name: "Nexus Vipers",
      tag: "NEXUS",
      logo: "/assets/teams/team_defenders.svg",
      side: "DEF",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#00f0ff",
    },
  },
  {
    id: "match-4",
    matchNumber: 4,
    stage: "Quarter-Finals",
    isFeatured: false,
    status: "upcoming",
    mapName: "Split",
    seriesFormat: "BO3",
    currentMapNumber: 1,
    totalMaps: 3,
    phase: "first_half",
    activeTimeoutTeamId: null,
    team1: {
      id: "m4-t1",
      name: "Apex Knights",
      tag: "APEX",
      logo: "/assets/teams/team_attackers.svg",
      side: "ATK",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#ff4655",
    },
    team2: {
      id: "m4-t2",
      name: "Soul Survivors",
      tag: "SOUL",
      logo: "/assets/teams/team_defenders.svg",
      side: "DEF",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#00f0ff",
    },
  },
  {
    id: "match-5",
    matchNumber: 5,
    stage: "Grand Finals",
    isFeatured: false,
    status: "upcoming",
    mapName: "Sunset",
    seriesFormat: "BO5",
    currentMapNumber: 1,
    totalMaps: 5,
    phase: "first_half",
    activeTimeoutTeamId: null,
    team1: {
      id: "m5-t1",
      name: "Finalist 1",
      tag: "TBD1",
      logo: "/assets/teams/team_attackers.svg",
      side: "ATK",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#ff4655",
    },
    team2: {
      id: "m5-t2",
      name: "Finalist 2",
      tag: "TBD2",
      logo: "/assets/teams/team_defenders.svg",
      side: "DEF",
      score: 0,
      mapsWon: 0,
      timeoutsRemaining: 2,
      accentColor: "#00f0ff",
    },
  },
];

const DEFAULT_TOURNAMENT: LiveMatchTournamentState = {
  gameType: "valorant",
  tournamentName: "VRGC Valorant Invitational",
  activeMatchCount: 2,
  featuredMatchId: "match-1",
  matches: DEFAULT_MATCHES,
  showScoreboard: true,
  team1: DEFAULT_MATCHES[0].team1,
  team2: DEFAULT_MATCHES[0].team2,
  currentMap: DEFAULT_MATCHES[0].mapName,
  currentMapNumber: DEFAULT_MATCHES[0].currentMapNumber,
  totalMaps: DEFAULT_MATCHES[0].totalMaps,
  seriesFormat: DEFAULT_MATCHES[0].seriesFormat,
  phase: DEFAULT_MATCHES[0].phase,
  activeTimeoutTeamId: DEFAULT_MATCHES[0].activeTimeoutTeamId,
  status: DEFAULT_MATCHES[0].status,
};

const VALORANT_MAP_POOL = [
  "Ascent",
  "Bind",
  "Haven",
  "Split",
  "Sunset",
  "Lotus",
  "Abyss",
  "Icebox",
  "Breeze",
];

const STAGES = ["Quarter-Finals", "Semi-Finals", "Grand Finals", "Placement"];

function parseYouTubeId(input: string): string {
  if (!input) return "";
  const clean = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) {
    return clean;
  }
  const match = clean.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+?&v=|live\/|shorts\/))([a-zA-Z0-9_-]{11})/
  );
  if (match && match[1]) {
    return match[1];
  }
  try {
    const url = new URL(clean.startsWith("http") ? clean : `https://${clean}`);
    const vParam = url.searchParams.get("v");
    if (vParam && vParam.length === 11) return vParam;
  } catch {}
  return clean.length >= 11 ? clean.slice(0, 11) : clean;
}

export default function LiveBroadcastControl() {
  const [config, setConfig] = useState<LiveConfigState>(DEFAULT_CONFIG);
  const [tournament, setTournament] = useState<LiveMatchTournamentState>(DEFAULT_TOURNAMENT);
  const [viewMode, setViewMode] = useState<"grid" | "bracket">("grid");
  const [saveStatus, setSaveStatus] = useState<string>("Synced");
  const [mainStreamTitle, setMainStreamTitle] = useState<string>("");
  const [mainStreamUrl, setMainStreamUrl] = useState<string>("");
  const [newStreamTitle, setNewStreamTitle] = useState<string>("");
  const [newStreamUrl, setNewStreamUrl] = useState<string>("");

  // ── Caster & Permissions State ─────────────────────────────────────
  const { user, userEmail, isSuperAdmin, userRole } = useAuth();
  const [isCasterModalOpen, setIsCasterModalOpen] = useState(false);
  const [castersList, setCastersList] = useState<
    Array<{ email: string; name?: string; assignedBy?: string; assignedAt?: string }>
  >([]);
  const [allowedManagerRoles, setAllowedManagerRoles] = useState<string[]>([
    "Admin",
    "Technical",
  ]);
  const [allowedManagerEmails, setAllowedManagerEmails] = useState<string[]>([]);
  const [newCasterEmail, setNewCasterEmail] = useState("");
  const [newCasterName, setNewCasterName] = useState("");
  const [newManagerEmail, setNewManagerEmail] = useState("");
  const [casterActionLoading, setCasterActionLoading] = useState(false);
  const [casterActionMessage, setCasterActionMessage] = useState("");

  const canManageCasters =
    isSuperAdmin ||
    allowedManagerEmails.includes(userEmail?.toLowerCase() || "") ||
    allowedManagerRoles.some(
      (r) => r.toLowerCase() === (userRole || "").toLowerCase()
    );

  const fetchCastersData = async () => {
    try {
      const res = await fetch("/api/live/casters");
      if (res.ok) {
        const data = await res.json();
        setCastersList(data.casters || []);
        if (data.allowedCasterManagerRoles) {
          setAllowedManagerRoles(data.allowedCasterManagerRoles);
        }
        if (data.allowedCasterManagerEmails) {
          setAllowedManagerEmails(data.allowedCasterManagerEmails);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch casters data:", err);
    }
  };

  useEffect(() => {
    fetchCastersData();
  }, []);

  const handleGrantCaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCasterEmail.trim()) return;
    setCasterActionLoading(true);
    setCasterActionMessage("");
    try {
      const res = await fetch("/api/live/casters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerEmail: userEmail || user?.email,
          targetEmail: newCasterEmail.trim(),
          targetName: newCasterName.trim() || newCasterEmail.trim().split("@")[0],
          action: "grant",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCasterActionMessage(`✓ Granted Caster role to ${newCasterEmail}`);
        setNewCasterEmail("");
        setNewCasterName("");
        await fetchCastersData();
      } else {
        setCasterActionMessage(`✕ Error: ${data.error || "Failed to grant role"}`);
      }
    } catch (err: any) {
      setCasterActionMessage(`✕ Error: ${err?.message || "Request failed"}`);
    } finally {
      setCasterActionLoading(false);
    }
  };

  const handleRevokeCaster = async (targetEmail: string) => {
    if (!confirm(`Revoke Caster role from ${targetEmail}?`)) return;
    setCasterActionLoading(true);
    setCasterActionMessage("");
    try {
      const res = await fetch("/api/live/casters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerEmail: userEmail || user?.email,
          targetEmail,
          action: "revoke",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCasterActionMessage(`✓ Revoked Caster role from ${targetEmail}`);
        await fetchCastersData();
      } else {
        setCasterActionMessage(`✕ Error: ${data.error || "Failed to revoke role"}`);
      }
    } catch (err: any) {
      setCasterActionMessage(`✕ Error: ${err?.message || "Request failed"}`);
    } finally {
      setCasterActionLoading(false);
    }
  };

  const handleToggleManagerRole = async (roleName: string) => {
    if (!isSuperAdmin) return;
    const exists = allowedManagerRoles.includes(roleName);
    const updated = exists
      ? allowedManagerRoles.filter((r) => r !== roleName)
      : [...allowedManagerRoles, roleName];

    setAllowedManagerRoles(updated);
    try {
      await fetch("/api/live/casters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerEmail: userEmail || user?.email,
          allowedCasterManagerRoles: updated,
        }),
      });
    } catch (err) {
      console.warn("Failed to update caster manager roles:", err);
    }
  };

  const handleAddManagerEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin || !newManagerEmail.trim()) return;
    const cleanEmail = newManagerEmail.trim().toLowerCase();
    if (allowedManagerEmails.includes(cleanEmail)) return;
    const updated = [...allowedManagerEmails, cleanEmail];
    setAllowedManagerEmails(updated);
    setNewManagerEmail("");
    try {
      await fetch("/api/live/casters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerEmail: userEmail || user?.email,
          allowedCasterManagerEmails: updated,
        }),
      });
    } catch (err) {
      console.warn("Failed to add caster manager email:", err);
    }
  };

  const handleRemoveManagerEmail = async (emailToRemove: string) => {
    if (!isSuperAdmin) return;
    const updated = allowedManagerEmails.filter((e) => e !== emailToRemove);
    setAllowedManagerEmails(updated);
    try {
      await fetch("/api/live/casters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerEmail: userEmail || user?.email,
          allowedCasterManagerEmails: updated,
        }),
      });
    } catch (err) {
      console.warn("Failed to remove caster manager email:", err);
    }
  };

  // ── Real-time Firestore Subscriptions ──────────────────────────────
  useEffect(() => {
    const unsubConfig = onSnapshot(doc(db, "live_config", "global"), (snap) => {
      if (snap.exists()) {
        const cData = snap.data() as LiveConfigState;
        setConfig(cData);
        if (cData.streams && cData.streams.length > 0 && cData.streams[0]) {
          setMainStreamTitle((prev) => (prev !== "" ? prev : cData.streams[0].title || ""));
          setMainStreamUrl((prev) => (prev !== "" ? prev : cData.streams[0].youtubeId || ""));
        }
      }
    });

    const unsubMatch = onSnapshot(doc(db, "live_matches", "current"), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        if (data.matches && Array.isArray(data.matches) && data.matches.length > 0) {
          setTournament(data as LiveMatchTournamentState);
        } else {
          // Backward compatibility migration: wrap existing single match into matches[0]
          setTournament((prev) => ({
            ...prev,
            ...data,
            matches: prev.matches.map((m, idx) =>
              idx === 0
                ? {
                    ...m,
                    team1: data.team1 || m.team1,
                    team2: data.team2 || m.team2,
                    mapName: data.currentMap || m.mapName,
                    phase: data.phase || m.phase,
                  }
                : m
            ),
          }));
        }
      }
    });

    return () => {
      unsubConfig();
      unsubMatch();
    };
  }, []);

  // ── Database Mutation Handlers ─────────────────────────────────────

  const persistConfig = async (nextConfig: LiveConfigState) => {
    setConfig(nextConfig);
    setSaveStatus("Saving...");
    try {
      await setDoc(doc(db, "live_config", "global"), {
        ...nextConfig,
        updatedAt: serverTimestamp(),
      });
      setSaveStatus("Synced");
    } catch (err) {
      console.error("Failed to update broadcast config:", err);
      setSaveStatus("Error");
    }
  };

  const persistTournament = async (nextState: LiveMatchTournamentState) => {
    // Keep legacy single-match root fields in sync with the featured match
    const featuredMatch =
      nextState.matches.find((m) => m.id === nextState.featuredMatchId) || nextState.matches[0];

    const payload: LiveMatchTournamentState = {
      ...nextState,
      team1: featuredMatch.team1,
      team2: featuredMatch.team2,
      currentMap: featuredMatch.mapName,
      currentMapNumber: featuredMatch.currentMapNumber,
      totalMaps: featuredMatch.totalMaps,
      seriesFormat: featuredMatch.seriesFormat,
      phase: featuredMatch.phase,
      activeTimeoutTeamId: featuredMatch.activeTimeoutTeamId,
      status: featuredMatch.status,
    };

    setTournament(payload);
    setSaveStatus("Saving...");
    try {
      await setDoc(doc(db, "live_matches", "current"), {
        ...payload,
        updatedAt: serverTimestamp(),
      });
      setSaveStatus("Synced");
    } catch (err) {
      console.error("Failed to update tournament matches:", err);
      setSaveStatus("Error");
    }
  };

  // ── Active Match & Team Count Stepper ──────────────────────────────

  const handleStepMatchCount = (delta: number) => {
    const newCount = Math.max(1, Math.min(5, tournament.activeMatchCount + delta));
    if (newCount === tournament.activeMatchCount) return;

    let updatedMatches = [...tournament.matches];
    while (updatedMatches.length < newCount) {
      const matchNum = updatedMatches.length + 1;
      updatedMatches.push({
        id: `match-${matchNum}`,
        matchNumber: matchNum,
        stage: matchNum === 1 ? "Grand Finals" : matchNum <= 3 ? "Semi-Finals" : "Quarter-Finals",
        isFeatured: false,
        status: "upcoming",
        mapName: VALORANT_MAP_POOL[(matchNum - 1) % VALORANT_MAP_POOL.length] || "Ascent",
        seriesFormat: "BO3",
        currentMapNumber: 1,
        totalMaps: 3,
        phase: "first_half",
        activeTimeoutTeamId: null,
        team1: {
          id: `m${matchNum}-t1`,
          name: `Team ${matchNum * 2 - 1}`,
          tag: `T${matchNum * 2 - 1}`,
          captain: "",
          logo: "/assets/teams/team_attackers.svg",
          side: "ATK",
          score: 0,
          mapsWon: 0,
          timeoutsRemaining: 2,
          accentColor: "#ff4655",
        },
        team2: {
          id: `m${matchNum}-t2`,
          name: `Team ${matchNum * 2}`,
          tag: `T${matchNum * 2}`,
          captain: "",
          logo: "/assets/teams/team_defenders.svg",
          side: "DEF",
          score: 0,
          mapsWon: 0,
          timeoutsRemaining: 2,
          accentColor: "#00f0ff",
        },
      });
    }

    persistTournament({
      ...tournament,
      activeMatchCount: newCount,
      matches: updatedMatches,
    });
  };

  const handleDeleteMatch = (matchId: string) => {
    if (tournament.activeMatchCount <= 1) return;
    const remaining = tournament.matches.filter((m) => m.id !== matchId);
    const reindexed = remaining.map((m, idx) => ({
      ...m,
      matchNumber: idx + 1,
    }));
    const newCount = Math.max(1, tournament.activeMatchCount - 1);
    const newFeatured =
      tournament.featuredMatchId === matchId
        ? reindexed[0]?.id || "match-1"
        : tournament.featuredMatchId;

    persistTournament({
      ...tournament,
      activeMatchCount: newCount,
      featuredMatchId: newFeatured,
      matches: reindexed,
    });
  };

  const handleSetFeaturedMatch = (matchId: string) => {
    const updatedMatches = tournament.matches.map((m) => ({
      ...m,
      isFeatured: m.id === matchId,
    }));
    persistTournament({
      ...tournament,
      featuredMatchId: matchId,
      matches: updatedMatches,
    });
  };

  // ── Match Updaters ─────────────────────────────────────────────────

  const updateMatch = (matchId: string, updater: (match: ParallelMatch) => ParallelMatch) => {
    const updated = tournament.matches.map((m) => (m.id === matchId ? updater(m) : m));
    persistTournament({
      ...tournament,
      matches: updated,
    });
  };

  const updateRoundScore = (matchId: string, teamKey: "team1" | "team2", delta: number) => {
    updateMatch(matchId, (m) => {
      const nextScore = Math.max(0, m[teamKey].score + delta);
      let nextPhase = m.phase;
      const otherKey = teamKey === "team1" ? "team2" : "team1";
      if (nextScore >= 12 && m[otherKey].score === 12) {
        nextPhase = "overtime";
      }
      return {
        ...m,
        phase: nextPhase,
        [teamKey]: {
          ...m[teamKey],
          score: nextScore,
        },
      };
    });
  };

  const updateMapsWon = (matchId: string, teamKey: "team1" | "team2", delta: number) => {
    updateMatch(matchId, (m) => ({
      ...m,
      [teamKey]: {
        ...m[teamKey],
        mapsWon: Math.max(0, m[teamKey].mapsWon + delta),
      },
    }));
  };

  const handleSwapSides = (matchId: string) => {
    updateMatch(matchId, (m) => {
      const t1NextSide = m.team1.side === "ATK" ? "DEF" : "ATK";
      const t2NextSide = m.team2.side === "ATK" ? "DEF" : "ATK";
      return {
        ...m,
        phase: m.phase === "first_half" ? "second_half" : m.phase,
        team1: {
          ...m.team1,
          side: t1NextSide,
          accentColor: t1NextSide === "ATK" ? "#ff4655" : "#00f0ff",
        },
        team2: {
          ...m.team2,
          side: t2NextSide,
          accentColor: t2NextSide === "ATK" ? "#ff4655" : "#00f0ff",
        },
      };
    });
  };

  const handleResetMatch = (matchId: string) => {
    if (confirm("Reset current scores for this match back to 0 - 0?")) {
      updateMatch(matchId, (m) => ({
        ...m,
        phase: "first_half",
        activeTimeoutTeamId: null,
        team1: { ...m.team1, score: 0 },
        team2: { ...m.team2, score: 0 },
      }));
    }
  };

  // ── Stream Feed Handlers ───────────────────────────────────────────

  const handleToggleBroadcast = () => {
    const isLive = !config.isLive;
    persistConfig({
      ...config,
      isLive,
      broadcastState: isLive ? "live" : "offline",
    });
  };

  const handleUpdateMainStream = (title: string, urlOrId: string, andGoLive: boolean = false) => {
    const ytId = parseYouTubeId(urlOrId);
    if (!ytId) {
      alert("Please enter a valid YouTube video URL or 11-character video ID.");
      return;
    }

    const cleanTitle = title.trim() || (config.streams[0]?.title ?? "Main Broadcast Feed");
    let updatedStreams = [...config.streams];
    if (updatedStreams.length === 0) {
      updatedStreams = [
        {
          id: "stream-1",
          title: cleanTitle,
          youtubeId: ytId,
          isActive: true,
          order: 1,
        },
      ];
    } else {
      updatedStreams[0] = {
        ...updatedStreams[0],
        title: cleanTitle,
        youtubeId: ytId,
        isActive: true,
      };
    }

    persistConfig({
      ...config,
      streams: updatedStreams,
      ...(andGoLive ? { isLive: true, broadcastState: "live" } : {}),
    });
  };

  const handleUpdateFeed = (feedId: string, updates: Partial<LiveStreamFeed>) => {
    persistConfig({
      ...config,
      streams: config.streams.map((s) => (s.id === feedId ? { ...s, ...updates } : s)),
    });
  };

  const handleAddStream = (e: React.FormEvent) => {
    e.preventDefault();
    const ytId = parseYouTubeId(newStreamUrl);
    if (!ytId) return;

    const newFeed: LiveStreamFeed = {
      id: `stream-${Date.now()}`,
      title: newStreamTitle.trim() || `Feed ${config.streams.length + 1}`,
      youtubeId: ytId,
      isActive: true,
      order: config.streams.length + 1,
    };

    persistConfig({
      ...config,
      streams: [...config.streams, newFeed],
    });
    setNewStreamTitle("");
    setNewStreamUrl("");
  };

  const handleRemoveStream = (streamId: string) => {
    persistConfig({
      ...config,
      streams: config.streams.filter((s) => s.id !== streamId),
    });
  };

  const activeMatches = tournament.matches.slice(0, tournament.activeMatchCount);

  // Dynamic grid class based on number of active matches
  const getGridClass = () => {
    switch (tournament.activeMatchCount) {
      case 1:
        return "grid grid-cols-1 gap-6";
      case 2:
        return "grid grid-cols-1 lg:grid-cols-2 gap-5";
      case 3:
        return "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4";
      case 4:
        return "grid grid-cols-1 md:grid-cols-2 gap-4";
      case 5:
      default:
        return "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4";
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 space-y-6 text-slate-100 select-none">
      {/* ── Top Header Bar ─────────────────────────────────────────── */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0c0517]/90 border border-purple-500/20 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <span className="material-symbols-outlined text-white text-2xl">sports_esports</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-wide text-white">Live Broadcast Studio</h1>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  config.isLive
                    ? "bg-rose-950 text-rose-300 border border-rose-500/40 animate-pulse"
                    : "bg-slate-800 text-slate-400 border border-slate-700"
                }`}
              >
                {config.isLive ? "LIVE BROADCAST" : "OFFLINE"}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Synchronizing real-time feeds and parallel scoring with{" "}
              <span className="text-purple-400 font-mono">vrgc.live/live</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {(isSuperAdmin || canManageCasters) && (
            <button
              onClick={() => setIsCasterModalOpen(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all border border-purple-500/30 bg-purple-950/60 hover:bg-purple-900 text-purple-200 flex items-center gap-1.5 cursor-pointer shadow-md shadow-purple-950/30 active:scale-95"
              title="Manage Casters & Delegation Permissions"
            >
              <span className="material-symbols-outlined text-sm text-purple-300">record_voice_over</span>
              <span>Casters ({castersList.length})</span>
            </button>
          )}

          {userRole === "Caster" && !isSuperAdmin && !canManageCasters && (
            <span className="px-3 py-1.5 rounded-xl text-xs font-bold border border-amber-500/30 bg-amber-950/40 text-amber-300 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">badge</span>
              <span>Caster Desk</span>
            </span>
          )}

          <span
            className={`text-xs px-3 py-1 rounded-lg border font-mono ${
              saveStatus === "Synced"
                ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                : saveStatus === "Saving..."
                ? "bg-amber-950/60 border-amber-500/40 text-amber-300"
                : "bg-rose-950/60 border-rose-500/40 text-rose-300"
            }`}
          >
            {saveStatus}
          </span>

          <button
            onClick={handleToggleBroadcast}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer ${
              config.isLive
                ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30"
            }`}
          >
            <span className="material-symbols-outlined text-sm">
              {config.isLive ? "stop_circle" : "play_circle"}
            </span>
            <span>{config.isLive ? "End Broadcast" : "Go Live"}</span>
          </button>
        </div>
      </header>

      {/* ── Parallel Matches Switcher & View Mode Toolbar ───────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#0e061c]/80 border border-purple-500/20 backdrop-blur-xl">
        {/* ── Single Entry Point: Teams & Parallel Matches Stepper ── */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-purple-400">groups</span>
              <span>Tournament Teams:</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {tournament.activeMatchCount} Parallel {tournament.activeMatchCount === 1 ? "Match" : "Matches"} Active
            </span>
          </div>

          <div className="flex items-center bg-[#130726] border border-purple-500/30 rounded-xl p-1 shadow-inner shadow-black/50">
            {/* Minus Button */}
            <button
              onClick={() => handleStepMatchCount(-1)}
              disabled={tournament.activeMatchCount <= 1}
              className={`w-9 h-9 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer ${
                tournament.activeMatchCount <= 1
                  ? "opacity-30 cursor-not-allowed text-slate-500"
                  : "bg-purple-950/70 hover:bg-purple-800 text-purple-200 border border-purple-500/20 active:scale-95"
              }`}
              title="Remove 2 Teams (1 Match)"
              aria-label="Decrease teams"
            >
              <span className="material-symbols-outlined text-base">remove</span>
            </button>

            {/* Central Display */}
            <div className="px-4 py-1 text-center min-w-[130px]">
              <div className="text-sm font-black text-white tracking-wide flex items-center justify-center gap-1.5">
                <span className="text-purple-400 font-mono text-base">{tournament.activeMatchCount * 2}</span>
                <span className="text-xs uppercase font-bold text-slate-200">Teams</span>
              </div>
              <div className="text-[10px] font-mono text-purple-300/80 font-bold">
                {tournament.activeMatchCount} {tournament.activeMatchCount === 1 ? "Match" : "Matches"}
              </div>
            </div>

            {/* Plus Button */}
            <button
              onClick={() => handleStepMatchCount(1)}
              disabled={tournament.activeMatchCount >= 5}
              className={`w-9 h-9 rounded-lg flex items-center justify-center font-black transition-all cursor-pointer ${
                tournament.activeMatchCount >= 5
                  ? "opacity-30 cursor-not-allowed text-slate-500"
                  : "bg-purple-950/70 hover:bg-purple-800 text-purple-200 border border-purple-500/20 active:scale-95"
              }`}
              title="Add 2 Teams (1 Match)"
              aria-label="Increase teams"
            >
              <span className="material-symbols-outlined text-base">add</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${
              viewMode === "grid"
                ? "bg-[#25123d] border-purple-400 text-purple-200"
                : "bg-[#140a27] border-purple-500/20 text-slate-400"
            }`}
          >
            <span className="material-symbols-outlined text-sm">grid_view</span>
            <span>Match Tiles</span>
          </button>

          <button
            onClick={() => setViewMode("bracket")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${
              viewMode === "bracket"
                ? "bg-[#25123d] border-purple-400 text-purple-200"
                : "bg-[#140a27] border-purple-500/20 text-slate-400"
            }`}
          >
            <span className="material-symbols-outlined text-sm">account_tree</span>
            <span>Tournament Progression Chart</span>
          </button>
        </div>
      </div>

      {/* ── View 1: Tournament Progression Bracket Chart ────────────── */}
      {viewMode === "bracket" && (
        <section className="p-6 rounded-2xl bg-[#0e061c]/90 border border-purple-500/30 backdrop-blur-xl space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-purple-500/20">
            <div>
              <h2 className="text-base font-black text-white tracking-wide">
                Tournament Stage Flow Chart
              </h2>
              <p className="text-xs text-slate-400">
                Visual advancement from Quarter-Finals &rarr; Semi-Finals &rarr; Grand Finals
              </p>
            </div>
            <button
              onClick={() => setViewMode("grid")}
              className="text-xs text-purple-300 hover:text-white underline cursor-pointer"
            >
              Back to Score Tiles
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {/* Stage Column 1: Quarter-Finals */}
            <div className="space-y-3">
              <div className="p-2 rounded-lg bg-indigo-950/60 border border-indigo-500/30 text-center">
                <span className="text-xs font-black uppercase text-indigo-300 tracking-wider">
                  Quarter-Finals (QF)
                </span>
              </div>
              {tournament.matches
                .filter((m) => m.stage === "Quarter-Finals")
                .map((m) => (
                  <div
                    key={m.id}
                    className="p-3.5 rounded-xl bg-[#130826] border border-purple-500/20 space-y-2 shadow-lg"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>MATCH {m.matchNumber}</span>
                      <span className="text-purple-300 font-bold">{m.mapName}</span>
                    </div>
                    <div className="flex items-center justify-between font-bold text-xs">
                      <span className="text-white">{m.team1.name}</span>
                      <span className="font-mono text-purple-300">{m.team1.score}</span>
                    </div>
                    <div className="flex items-center justify-between font-bold text-xs">
                      <span className="text-white">{m.team2.name}</span>
                      <span className="font-mono text-purple-300">{m.team2.score}</span>
                    </div>
                  </div>
                ))}
            </div>

            {/* Stage Column 2: Semi-Finals */}
            <div className="space-y-3">
              <div className="p-2 rounded-lg bg-purple-950/60 border border-purple-500/40 text-center">
                <span className="text-xs font-black uppercase text-purple-200 tracking-wider">
                  Semi-Finals (SF)
                </span>
              </div>
              {tournament.matches
                .filter((m) => m.stage === "Semi-Finals")
                .map((m) => (
                  <div
                    key={m.id}
                    className="p-3.5 rounded-xl bg-[#150a2b] border border-purple-500/30 space-y-2 shadow-lg"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>MATCH {m.matchNumber}</span>
                      <span className="text-purple-300 font-bold">{m.mapName}</span>
                    </div>
                    <div className="flex items-center justify-between font-bold text-xs">
                      <span className="text-white">{m.team1.name}</span>
                      <span className="font-mono text-purple-300">{m.team1.score}</span>
                    </div>
                    <div className="flex items-center justify-between font-bold text-xs">
                      <span className="text-white">{m.team2.name}</span>
                      <span className="font-mono text-purple-300">{m.team2.score}</span>
                    </div>
                  </div>
                ))}
            </div>

            {/* Stage Column 3: Grand Finals */}
            <div className="space-y-3">
              <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-500/40 text-center">
                <span className="text-xs font-black uppercase text-amber-200 tracking-wider">
                  Grand Finals (GF)
                </span>
              </div>
              {tournament.matches
                .filter((m) => m.stage === "Grand Finals")
                .map((m) => (
                  <div
                    key={m.id}
                    className="p-4 rounded-xl bg-[#1a0c36] border border-amber-500/40 space-y-2.5 shadow-xl shadow-amber-950/20"
                  >
                    <div className="flex items-center justify-between text-[11px] text-amber-300 font-mono">
                      <span>CHAMPIONSHIP MATCH</span>
                      <span className="font-bold">{m.mapName}</span>
                    </div>
                    <div className="flex items-center justify-between font-bold text-sm">
                      <span className="text-white">{m.team1.name}</span>
                      <span className="font-mono text-amber-400 text-base">{m.team1.score}</span>
                    </div>
                    <div className="flex items-center justify-between font-bold text-sm">
                      <span className="text-white">{m.team2.name}</span>
                      <span className="font-mono text-amber-400 text-base">{m.team2.score}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </section>
      )}

      {/* ── View 2: Adaptive Parallel Match Tiles Grid ─────────────── */}
      {viewMode === "grid" && (
        <section className={getGridClass()}>
          {activeMatches.map((m) => {
            const isFeatured = tournament.featuredMatchId === m.id;
            return (
              <div
                key={m.id}
                className={`p-4 md:p-5 rounded-2xl bg-[#0e061c]/90 border transition-all space-y-4 relative overflow-hidden backdrop-blur-xl ${
                  isFeatured
                    ? "border-purple-400 shadow-[0_0_30px_rgba(168,85,247,0.25)]"
                    : "border-purple-500/20"
                }`}
              >
                {/* Match Card Header */}
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-purple-500/10">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-purple-900/60 text-purple-300 font-mono text-xs font-bold">
                      M{m.matchNumber}
                    </span>
                    <select
                      value={m.stage}
                      onChange={(e) =>
                        updateMatch(m.id, (prev) => ({ ...prev, stage: e.target.value }))
                      }
                      className="px-2 py-1 rounded bg-[#140a27] border border-purple-500/20 text-xs font-bold text-purple-200 focus:outline-none"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleSetFeaturedMatch(m.id)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        isFeatured
                          ? "bg-purple-600 text-white"
                          : "bg-slate-800 text-slate-400 hover:text-white"
                      }`}
                      title="Set as featured match on main video stream"
                    >
                      {isFeatured ? "★ FEATURED" : "SET FEATURED"}
                    </button>

                    <button
                      onClick={() => handleSwapSides(m.id)}
                      className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#1b0d2e] hover:bg-[#271342] text-amber-300 border border-amber-500/30 cursor-pointer"
                      title="Swap Sides"
                    >
                      Swap
                    </button>

                    <button
                      onClick={() => handleResetMatch(m.id)}
                      className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900 hover:bg-slate-800 text-slate-400 cursor-pointer"
                      title="Reset scores"
                    >
                      Reset
                    </button>

                    {tournament.activeMatchCount > 1 && (
                      <button
                        onClick={() => handleDeleteMatch(m.id)}
                        className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-500/30 cursor-pointer"
                        title="Delete Match (Removes 2 Teams)"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {/* Map & Format Row */}
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className="text-[10px] text-slate-400 uppercase font-mono">Map:</span>
                    <select
                      value={m.mapName}
                      onChange={(e) =>
                        updateMatch(m.id, (prev) => ({ ...prev, mapName: e.target.value }))
                      }
                      className="px-2 py-0.5 rounded bg-[#140a27] border border-purple-500/20 text-xs text-slate-200 focus:outline-none"
                    >
                      {VALORANT_MAP_POOL.map((map) => (
                        <option key={map} value={map}>
                          {map}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400 uppercase font-mono">Format:</span>
                    <select
                      value={m.seriesFormat}
                      onChange={(e) =>
                        updateMatch(m.id, (prev) => ({
                          ...prev,
                          seriesFormat: e.target.value as any,
                        }))
                      }
                      className="px-1.5 py-0.5 rounded bg-[#140a27] border border-purple-500/20 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="BO1">BO1</option>
                      <option value="BO3">BO3</option>
                      <option value="BO5">BO5</option>
                    </select>
                  </div>
                </div>

                {/* Team 1 Score Box */}
                <div
                  className="p-3 rounded-xl border flex items-center justify-between gap-3"
                  style={{
                    backgroundColor: "#130826",
                    borderColor:
                      m.team1.side === "ATK" ? "rgba(255, 70, 85, 0.4)" : "rgba(0, 240, 255, 0.4)",
                  }}
                >
                  <div className="flex-1 overflow-hidden space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase font-mono ${
                          m.team1.side === "ATK"
                            ? "bg-rose-950 text-rose-300"
                            : "bg-cyan-950 text-cyan-300"
                        }`}
                      >
                        {m.team1.side}
                      </span>
                      <input
                        type="text"
                        value={m.team1.tag}
                        onChange={(e) =>
                          updateMatch(m.id, (prev) => ({
                            ...prev,
                            team1: { ...prev.team1, tag: e.target.value },
                          }))
                        }
                        className="w-16 bg-transparent text-[11px] font-mono text-purple-300 border-b border-transparent hover:border-purple-500/30 focus:outline-none"
                        placeholder="TAG"
                      />
                    </div>
                    <input
                      type="text"
                      value={m.team1.name}
                      onChange={(e) =>
                        updateMatch(m.id, (prev) => ({
                          ...prev,
                          team1: { ...prev.team1, name: e.target.value },
                        }))
                      }
                      className="w-full bg-transparent font-bold text-sm text-white border-b border-transparent hover:border-purple-500/30 focus:outline-none truncate"
                      placeholder="Team 1 Name"
                    />
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] text-amber-400 font-mono font-bold">CPT:</span>
                      <input
                        type="text"
                        value={m.team1.captain || ""}
                        onChange={(e) =>
                          updateMatch(m.id, (prev) => ({
                            ...prev,
                            team1: { ...prev.team1, captain: e.target.value },
                          }))
                        }
                        className="w-full bg-transparent text-xs text-amber-200 placeholder-slate-500 border-b border-transparent hover:border-amber-500/30 focus:outline-none"
                        placeholder="Captain Name"
                      />
                    </div>
                  </div>

                  {/* Score + Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-2xl font-black font-mono text-white tabular-nums px-2.5 py-0.5 rounded-lg bg-black/40 border border-white/5">
                      {m.team1.score}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => updateRoundScore(m.id, "team1", 1)}
                        className="w-6 h-6 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center cursor-pointer shadow"
                      >
                        +
                      </button>
                      <button
                        onClick={() => updateRoundScore(m.id, "team1", -1)}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center cursor-pointer"
                      >
                        -
                      </button>
                    </div>
                  </div>
                </div>

                {/* Team 2 Score Box */}
                <div
                  className="p-3 rounded-xl border flex items-center justify-between gap-3"
                  style={{
                    backgroundColor: "#130826",
                    borderColor:
                      m.team2.side === "ATK" ? "rgba(255, 70, 85, 0.4)" : "rgba(0, 240, 255, 0.4)",
                  }}
                >
                  <div className="flex-1 overflow-hidden space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase font-mono ${
                          m.team2.side === "ATK"
                            ? "bg-rose-950 text-rose-300"
                            : "bg-cyan-950 text-cyan-300"
                        }`}
                      >
                        {m.team2.side}
                      </span>
                      <input
                        type="text"
                        value={m.team2.tag}
                        onChange={(e) =>
                          updateMatch(m.id, (prev) => ({
                            ...prev,
                            team2: { ...prev.team2, tag: e.target.value },
                          }))
                        }
                        className="w-16 bg-transparent text-[11px] font-mono text-purple-300 border-b border-transparent hover:border-purple-500/30 focus:outline-none"
                        placeholder="TAG"
                      />
                    </div>
                    <input
                      type="text"
                      value={m.team2.name}
                      onChange={(e) =>
                        updateMatch(m.id, (prev) => ({
                          ...prev,
                          team2: { ...prev.team2, name: e.target.value },
                        }))
                      }
                      className="w-full bg-transparent font-bold text-sm text-white border-b border-transparent hover:border-purple-500/30 focus:outline-none truncate"
                      placeholder="Team 2 Name"
                    />
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] text-amber-400 font-mono font-bold">CPT:</span>
                      <input
                        type="text"
                        value={m.team2.captain || ""}
                        onChange={(e) =>
                          updateMatch(m.id, (prev) => ({
                            ...prev,
                            team2: { ...prev.team2, captain: e.target.value },
                          }))
                        }
                        className="w-full bg-transparent text-xs text-amber-200 placeholder-slate-500 border-b border-transparent hover:border-amber-500/30 focus:outline-none"
                        placeholder="Captain Name"
                      />
                    </div>
                  </div>

                  {/* Score + Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-2xl font-black font-mono text-white tabular-nums px-2.5 py-0.5 rounded-lg bg-black/40 border border-white/5">
                      {m.team2.score}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => updateRoundScore(m.id, "team2", 1)}
                        className="w-6 h-6 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center cursor-pointer shadow"
                      >
                        +
                      </button>
                      <button
                        onClick={() => updateRoundScore(m.id, "team2", -1)}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center cursor-pointer"
                      >
                        -
                      </button>
                    </div>
                  </div>
                </div>

                {/* Series Maps Won Quick Toggles */}
                <div className="flex items-center justify-between text-[11px] pt-1 text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <span>Series:</span>
                    <button
                      onClick={() => updateMapsWon(m.id, "team1", 1)}
                      className="px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 hover:text-white cursor-pointer"
                    >
                      {m.team1.tag}: {m.team1.mapsWon}W
                    </button>
                    <span>-</span>
                    <button
                      onClick={() => updateMapsWon(m.id, "team2", 1)}
                      className="px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 hover:text-white cursor-pointer"
                    >
                      {m.team2.tag}: {m.team2.mapsWon}W
                    </button>
                  </div>

                  <span className="font-mono text-[10px] text-purple-400">
                    Rounds: {m.team1.score + m.team2.score}
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ── YouTube Broadcast Feeds Section ────────────────────────── */}
      <section className="p-5 rounded-2xl bg-[#0e061c]/80 border border-purple-500/20 backdrop-blur-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-purple-500/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-purple-400">smart_display</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-purple-200">
              Broadcast Video Stream Setup
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                config.isLive
                  ? "bg-rose-950 text-rose-300 border border-rose-500/40 animate-pulse"
                  : "bg-slate-800 text-slate-400 border border-slate-700"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${config.isLive ? "bg-rose-400" : "bg-slate-500"}`}></span>
              {config.isLive ? "BROADCAST LIVE" : "BROADCAST OFFLINE"}
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {config.streams.filter((s) => s.isActive).length} Active Feed(s)
            </span>
          </div>
        </div>

        {/* Primary Stream Quick Editor Card */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-[#160a2c] to-[#0e051c] border border-purple-500/30 space-y-3.5 shadow-lg shadow-black/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 shadow-sm shadow-rose-500"></span>
              <span className="text-xs font-black uppercase tracking-wider text-white">
                Primary YouTube Live Stream (Main Stage)
              </span>
            </div>
            {mainStreamUrl && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/80 border border-purple-500/40 text-purple-300">
                Extracted Video ID: <strong className="text-white">{parseYouTubeId(mainStreamUrl) || "Invalid"}</strong>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1">
                Stream Title
              </label>
              <input
                type="text"
                placeholder="e.g. VRGC Valorant Grand Finals 2026 - Main Stage"
                value={mainStreamTitle}
                onChange={(e) => setMainStreamTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0a0314] border border-purple-500/30 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-400 font-medium"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1">
                YouTube Live Stream URL or Video ID
              </label>
              <input
                type="text"
                placeholder="Paste YouTube Link (e.g. https://www.youtube.com/watch?v=... or https://youtube.com/live/...)"
                value={mainStreamUrl}
                onChange={(e) => setMainStreamUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0a0314] border border-purple-500/30 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-400 font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-400">
              Pasting a YouTube live link immediately updates the spectator video player on{" "}
              <span className="text-purple-300 font-mono">vrgc.live/live</span> without page refresh.
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleUpdateMainStream(mainStreamTitle, mainStreamUrl, false)}
                disabled={!mainStreamUrl.trim()}
                className="px-4 py-2 rounded-xl bg-purple-900/60 hover:bg-purple-800 disabled:opacity-40 text-purple-200 border border-purple-500/30 font-bold text-xs transition-all cursor-pointer shadow flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm">save</span>
                <span>Update Stream</span>
              </button>

              <button
                type="button"
                onClick={() => handleUpdateMainStream(mainStreamTitle, mainStreamUrl, true)}
                disabled={!mainStreamUrl.trim()}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 disabled:opacity-40 text-white font-bold text-xs transition-all cursor-pointer shadow-md shadow-rose-600/30 flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm">podcasts</span>
                <span>Apply &amp; GO LIVE</span>
              </button>
            </div>
          </div>
        </div>

        {/* Multi-Feed Grid & Add Stream */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Active Feeds List */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300 block">
              Configured Feeds ({config.streams.length})
            </span>
            {config.streams.map((feed, idx) => (
              <div
                key={feed.id}
                className="p-3 rounded-xl bg-[#140a27] border border-purple-500/20 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-purple-900/60 text-purple-300 font-mono text-[10px] flex items-center justify-center font-bold">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold text-white">
                      {idx === 0 ? "Main Broadcast Stream" : `POV / Feed ${idx + 1}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() =>
                        handleUpdateFeed(feed.id, { isActive: !feed.isActive })
                      }
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        feed.isActive
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {feed.isActive ? "ACTIVE" : "MUTED"}
                    </button>
                    {config.streams.length > 1 && (
                      <button
                        onClick={() => handleRemoveStream(feed.id)}
                        className="w-5 h-5 rounded bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 flex items-center justify-center cursor-pointer text-xs"
                        title="Remove stream feed"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <input
                    type="text"
                    value={feed.title}
                    onChange={(e) => handleUpdateFeed(feed.id, { title: e.target.value })}
                    className="w-full px-2 py-1 rounded bg-[#0a0314] border border-purple-500/20 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-400"
                    placeholder="Feed Title"
                  />
                  <input
                    type="text"
                    value={feed.youtubeId}
                    onChange={(e) =>
                      handleUpdateFeed(feed.id, {
                        youtubeId: parseYouTubeId(e.target.value) || e.target.value,
                      })
                    }
                    className="w-full px-2 py-1 rounded bg-[#0a0314] border border-purple-500/20 text-xs text-purple-300 font-mono placeholder-slate-500 focus:outline-none focus:border-purple-400"
                    placeholder="YouTube ID or URL"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Add Additional Feed Form */}
          <form
            onSubmit={handleAddStream}
            className="p-4 rounded-xl bg-[#130826] border border-purple-500/20 space-y-2.5 h-fit"
          >
            <span className="text-[11px] font-bold text-purple-200 uppercase block">
              + Add Additional Camera / POV Feed
            </span>
            <input
              type="text"
              placeholder="Stream Title (e.g. Court POV or Tactical Map)"
              value={newStreamTitle}
              onChange={(e) => setNewStreamTitle(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-[#0e061c] border border-purple-500/20 text-xs text-slate-200 focus:outline-none focus:border-purple-400"
            />
            <input
              type="text"
              placeholder="Paste YouTube Link or Video ID"
              value={newStreamUrl}
              onChange={(e) => setNewStreamUrl(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-[#0e061c] border border-purple-500/20 text-xs text-slate-200 focus:outline-none focus:border-purple-400 font-mono"
            />
            <button
              type="submit"
              disabled={!newStreamUrl.trim()}
              className="w-full py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs transition-all cursor-pointer shadow-md shadow-purple-600/30 flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              <span>Add Extra Feed</span>
            </button>
          </form>
        </div>
      </section>

      {/* ── Caster Delegation & Access Modal ─────────────────────── */}
      {isCasterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-2xl bg-[#0d0519] border border-purple-500/30 rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-purple-500/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-900/60 border border-purple-500/30 flex items-center justify-center text-purple-300">
                  <span className="material-symbols-outlined text-xl">record_voice_over</span>
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Caster Management & Delegation</h3>
                  <p className="text-xs text-slate-400">
                    Grant casting desk access or configure delegation authorities
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setIsCasterModalOpen(false);
                  setCasterActionMessage("");
                }}
                className="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {casterActionMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-bold border ${
                  casterActionMessage.startsWith("✓")
                    ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                    : "bg-rose-950/60 border-rose-500/40 text-rose-300"
                }`}
              >
                {casterActionMessage}
              </div>
            )}

            {/* 1. Super Admin Section: Who Can Grant Caster Role */}
            {isSuperAdmin && (
              <div className="p-4 rounded-xl bg-[#140826] border border-purple-500/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-black uppercase text-purple-300 tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">admin_panel_settings</span>
                      <span>Super Admin Authority: Who Can Assign Casters</span>
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Toggle roles or designate specific emails allowed to grant the Caster role
                    </p>
                  </div>
                </div>

                {/* Role Chips */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400">Allowed Manager Roles:</span>
                  <div className="flex flex-wrap gap-2">
                    {["Admin", "Technical", "Payment Admin", "Lead", "Student Coordinator"].map((r) => {
                      const isAllowed = allowedManagerRoles.includes(r);
                      return (
                        <button
                          key={r}
                          onClick={() => handleToggleManagerRole(r)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                            isAllowed
                              ? "bg-purple-600/60 border-purple-400 text-white"
                              : "bg-[#0b0314] border-purple-500/20 text-slate-400 hover:border-purple-500/40"
                          }`}
                        >
                          <span className="material-symbols-outlined text-xs">
                            {isAllowed ? "check" : "add"}
                          </span>
                          <span>{r}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Delegated Emails List */}
                <div className="space-y-2 pt-2 border-t border-purple-500/10">
                  <span className="text-[10px] font-mono uppercase text-slate-400">
                    Specific Delegated Individuals ({allowedManagerEmails.length}):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {allowedManagerEmails.map((email) => (
                      <span
                        key={email}
                        className="px-2.5 py-1 rounded-md bg-[#0a0212] border border-purple-500/30 text-xs font-mono text-purple-200 flex items-center gap-2"
                      >
                        <span>{email}</span>
                        <button
                          onClick={() => handleRemoveManagerEmail(email)}
                          className="text-slate-400 hover:text-rose-400 cursor-pointer"
                          title="Remove manager"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    {allowedManagerEmails.length === 0 && (
                      <span className="text-xs text-slate-500 italic">No specific individuals delegated yet.</span>
                    )}
                  </div>

                  <form onSubmit={handleAddManagerEmail} className="flex gap-2 pt-1">
                    <input
                      type="email"
                      placeholder="Delegate manager by email (e.g. member@vitbhopal.ac.in)..."
                      value={newManagerEmail}
                      onChange={(e) => setNewManagerEmail(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-[#0c0416] border border-purple-500/20 text-xs text-slate-200 focus:outline-none focus:border-purple-400"
                    />
                    <button
                      type="submit"
                      disabled={!newManagerEmail.trim()}
                      className="px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white font-bold text-xs cursor-pointer"
                    >
                      Add Manager
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* 2. Caster Assignment Form */}
            {canManageCasters && (
              <form onSubmit={handleGrantCaster} className="p-4 rounded-xl bg-[#140826] border border-purple-500/20 space-y-3">
                <div>
                  <span className="text-xs font-black uppercase text-purple-200 tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-purple-400">person_add</span>
                    <span>Grant Caster Role to Member</span>
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    User will be granted the Caster role and authorized to operate the broadcast studio desk
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="email"
                    required
                    placeholder="Student/Member College Email..."
                    value={newCasterEmail}
                    onChange={(e) => setNewCasterEmail(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-[#0c0416] border border-purple-500/20 text-xs text-slate-200 focus:outline-none focus:border-purple-400"
                  />
                  <input
                    type="text"
                    placeholder="Caster Display Name / Tag (Optional)..."
                    value={newCasterName}
                    onChange={(e) => setNewCasterName(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-[#0c0416] border border-purple-500/20 text-xs text-slate-200 focus:outline-none focus:border-purple-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={casterActionLoading || !newCasterEmail.trim()}
                  className="w-full py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-40 text-white font-bold text-xs transition-all shadow-md cursor-pointer"
                >
                  {casterActionLoading ? "Processing..." : "Grant Caster Access"}
                </button>
              </form>
            )}

            {/* 3. Active Casters List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-purple-300 tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">groups</span>
                  <span>Active Broadcasters & Casters ({castersList.length})</span>
                </span>
                <button
                  onClick={fetchCastersData}
                  className="text-[11px] text-purple-300 hover:text-white underline cursor-pointer"
                >
                  Refresh
                </button>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {castersList.map((c) => (
                  <div
                    key={c.email}
                    className="p-3 rounded-xl bg-[#130724] border border-purple-500/20 flex items-center justify-between gap-3 shadow"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-300 flex items-center justify-center font-bold text-xs">
                        🎙
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-white truncate">{c.name || c.email}</span>
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-500/30">
                            CASTER
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono block truncate">{c.email}</span>
                      </div>
                    </div>

                    {canManageCasters && (
                      <button
                        onClick={() => handleRevokeCaster(c.email)}
                        disabled={casterActionLoading}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-500/30 transition-all cursor-pointer shrink-0"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}

                {castersList.length === 0 && (
                  <div className="p-6 text-center rounded-xl bg-[#130724] border border-purple-500/10 text-xs text-slate-400">
                    No active casters registered yet. Use the form above to grant access.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
