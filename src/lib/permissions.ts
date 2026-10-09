import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type PageId =
  | 'members'
  | 'planned_events'
  | 'referrals'
  | 'idcard'
  | 'payments'
  | 'tickets'
  | 'maintenance'
  | 'documents'
  | 'ideahub'
  | 'live_admin';

export interface PagePermission {
  canView: boolean;
  canEdit: boolean;
  bypassMaintenance: boolean;
}

export interface PermissionsConfig {
  roles: Record<string, Record<PageId, PagePermission>>;
  tiers: {
    members: Record<PageId, PagePermission>;
    faculty: Record<PageId, PagePermission>;
  };
  customRoles: string[];
  allowedMetadataRoles: string[];
  allowedBlockAccessRoles?: string[];
  allowedCasterManagerRoles?: string[];
  allowedCasterManagerEmails?: string[];
  updatedAt?: string;
}

export interface ClubMetadata {
  domains: string[];
  positions: string[];
  updatedAt?: string;
}

export const ALL_PAGE_IDS: { id: PageId; label: string; icon: string }[] = [
  { id: 'members', label: 'Members Roster', icon: 'groups' },
  { id: 'planned_events', label: 'Planned Events', icon: 'event_upcoming' },
  { id: 'referrals', label: 'Referrals Portal', icon: 'share' },
  { id: 'idcard', label: 'ID Card Portal', icon: 'badge' },
  { id: 'payments', label: 'Payments & Dues', icon: 'payments' },
  { id: 'documents', label: 'Documents', icon: 'description' },
  { id: 'tickets', label: 'Resolve Tickets', icon: 'confirmation_number' },
  { id: 'maintenance', label: 'Maintenance Desk', icon: 'construction' },
  { id: 'ideahub', label: 'Idea Curator Hub', icon: 'lightbulb' },
  { id: 'live_admin', label: 'Live Broadcast Hub', icon: 'live_tv' },
];

export const SYSTEM_ROLES = ['Admin', 'Payment Admin', 'Technical', 'Caster'];

export const DEFAULT_DOMAINS = [
  'Technical',
  'Design',
  'Education',
  'Esports PC',
  'Esports Mobile',
  'Esports (PC)',
  'Esports (Mobile)',
  'PR',
  'Social Media',
  'Operations',
  'Faculty Advisory',
  'Management',
];

export const DEFAULT_POSITIONS = [
  'Student Coordinator',
  'Co-President',
  'President',
  'Lead',
  'Co-Lead',
  'Core Member',
  'Member',
  'Creative Director',
  'Faculty Mentor',
  'Advisory Chair',
];

export const createDefaultPagePermission = (
  canView = true,
  canEdit = false,
  bypassMaintenance = false
): PagePermission => ({
  canView,
  canEdit,
  bypassMaintenance,
});

export const createDefaultPagePermissionsMap = (
  canView = true,
  canEdit = false,
  bypassMaintenance = false
): Record<PageId, PagePermission> => {
  const map: Partial<Record<PageId, PagePermission>> = {};
  ALL_PAGE_IDS.forEach((page) => {
    map[page.id] = createDefaultPagePermission(canView, canEdit, bypassMaintenance);
  });
  return map as Record<PageId, PagePermission>;
};

export const DEFAULT_PERMISSIONS_CONFIG: PermissionsConfig = {
  roles: {
    Admin: createDefaultPagePermissionsMap(true, true, true),
    'Payment Admin': {
      ...createDefaultPagePermissionsMap(true, false, true),
      payments: createDefaultPagePermission(true, true, true),
    },
    Technical: {
      ...createDefaultPagePermissionsMap(true, true, true),
    },
    Caster: {
      ...createDefaultPagePermissionsMap(false, false, false),
      live_admin: createDefaultPagePermission(true, true, true),
    },
  },
  tiers: {
    members: {
      members: createDefaultPagePermission(true, false, false),
      planned_events: createDefaultPagePermission(true, false, false),
      referrals: createDefaultPagePermission(true, true, false),
      idcard: createDefaultPagePermission(true, true, false),
      payments: createDefaultPagePermission(true, true, false),
      tickets: createDefaultPagePermission(false, false, false),
      maintenance: createDefaultPagePermission(false, false, false),
      documents: createDefaultPagePermission(true, false, false),
      ideahub: createDefaultPagePermission(true, true, false),
      live_admin: createDefaultPagePermission(false, false, false),
    },
    faculty: {
      members: createDefaultPagePermission(true, false, false),
      planned_events: createDefaultPagePermission(true, true, false),
      referrals: createDefaultPagePermission(true, false, false),
      idcard: createDefaultPagePermission(true, true, false),
      payments: createDefaultPagePermission(true, false, false),
      tickets: createDefaultPagePermission(false, false, false),
      maintenance: createDefaultPagePermission(false, false, false),
      documents: createDefaultPagePermission(true, false, false),
      ideahub: createDefaultPagePermission(true, true, false),
      live_admin: createDefaultPagePermission(false, false, false),
    },
  },
  customRoles: [],
  allowedMetadataRoles: ['Admin', 'Technical'],
  allowedBlockAccessRoles: ['Admin', 'Technical'],
  allowedCasterManagerRoles: ['Admin', 'Technical'],
  allowedCasterManagerEmails: [],
};

export const DEFAULT_CLUB_METADATA: ClubMetadata = {
  domains: DEFAULT_DOMAINS,
  positions: DEFAULT_POSITIONS,
};

// ─── Firestore Data Accessors ────────────────────────────────────────────────

export async function fetchPermissionsConfig(): Promise<PermissionsConfig> {
  try {
    const snap = await getDoc(doc(db, 'config', 'permissions'));
    if (snap.exists()) {
      const data = snap.data() as PermissionsConfig;
      return {
        roles: { ...DEFAULT_PERMISSIONS_CONFIG.roles, ...(data.roles || {}) },
        tiers: {
          members: { ...DEFAULT_PERMISSIONS_CONFIG.tiers.members, ...(data.tiers?.members || {}) },
          faculty: { ...DEFAULT_PERMISSIONS_CONFIG.tiers.faculty, ...(data.tiers?.faculty || {}) },
        },
        customRoles: data.customRoles || [],
        allowedMetadataRoles: data.allowedMetadataRoles || DEFAULT_PERMISSIONS_CONFIG.allowedMetadataRoles,
        allowedBlockAccessRoles: data.allowedBlockAccessRoles || DEFAULT_PERMISSIONS_CONFIG.allowedBlockAccessRoles,
        allowedCasterManagerRoles: data.allowedCasterManagerRoles || DEFAULT_PERMISSIONS_CONFIG.allowedCasterManagerRoles || ['Admin', 'Technical'],
        allowedCasterManagerEmails: data.allowedCasterManagerEmails || [],
        updatedAt: data.updatedAt,
      };
    }
  } catch (err) {
    console.warn('Error fetching permissions from Firestore, using defaults:', err);
  }
  return DEFAULT_PERMISSIONS_CONFIG;
}

export async function savePermissionsConfig(config: PermissionsConfig): Promise<void> {
  await setDoc(doc(db, 'config', 'permissions'), {
    ...config,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function fetchClubMetadata(): Promise<ClubMetadata> {
  try {
    const snap = await getDoc(doc(db, 'config', 'club_metadata'));
    if (snap.exists()) {
      const data = snap.data() as ClubMetadata;
      const domains = Array.from(new Set([...(data.domains || []), ...DEFAULT_DOMAINS]));
      const positions = Array.from(new Set([...(data.positions || []), ...DEFAULT_POSITIONS]));
      return { domains, positions, updatedAt: data.updatedAt };
    }
  } catch (err) {
    console.warn('Error fetching club metadata from Firestore, using defaults:', err);
  }
  return DEFAULT_CLUB_METADATA;
}

export async function saveClubMetadata(metadata: ClubMetadata): Promise<void> {
  await setDoc(doc(db, 'config', 'club_metadata'), {
    ...metadata,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

// ─── Permission Evaluator ────────────────────────────────────────────────────

export function resolveUserPagePermission(
  pageId: PageId,
  config: PermissionsConfig,
  userRole: string | null | undefined,
  isSuperAdmin: boolean,
  isFaculty: boolean,
  isAuthorized: boolean,
  userEmail?: string | null
): PagePermission {
  const cleanRole = userRole?.trim().toLowerCase();
  const cleanEmail = userEmail?.trim().toLowerCase();

  // Super Admin always bypasses all restrictions with full authority
  if (isSuperAdmin || cleanRole === 'super admin' || cleanRole === 'super_admin') {
    return { canView: true, canEdit: true, bypassMaintenance: true };
  }

  // Live Broadcast Hub (Caster / Broadcast Manager access gate)
  if (pageId === 'live_admin') {
    // 1. Direct Caster role
    if (cleanRole === 'caster') {
      return { canView: true, canEdit: true, bypassMaintenance: true };
    }

    // 2. Caster Manager by role
    const managerRoles = (config.allowedCasterManagerRoles || ['Admin', 'Technical']).map((r) =>
      r.trim().toLowerCase()
    );
    if (userRole && managerRoles.includes(cleanRole || '')) {
      return { canView: true, canEdit: true, bypassMaintenance: true };
    }

    // 3. Caster Manager by explicit email delegated by SuperAdmin
    const managerEmails = (config.allowedCasterManagerEmails || []).map((e) =>
      e.trim().toLowerCase()
    );
    if (cleanEmail && managerEmails.includes(cleanEmail)) {
      return { canView: true, canEdit: true, bypassMaintenance: true };
    }

    // 4. Role-specific configured permission in config.roles
    if (userRole && config.roles) {
      if (config.roles[userRole]?.live_admin?.canView) {
        return config.roles[userRole].live_admin;
      }
      const matchingKey = Object.keys(config.roles).find(
        (k) => k.trim().toLowerCase() === cleanRole
      );
      if (matchingKey && config.roles[matchingKey]?.live_admin?.canView) {
        return config.roles[matchingKey].live_admin;
      }
    }

    // Fallback: Denied for standard members / non-casters
    return { canView: false, canEdit: false, bypassMaintenance: false };
  }

  // If user has a specific assigned administrative/custom role
  if (userRole && config.roles) {
    if (config.roles[userRole]?.[pageId]) {
      return config.roles[userRole][pageId];
    }
    // Case-insensitive and trimmed lookup
    const matchingKey = Object.keys(config.roles).find(
      (k) => k.trim().toLowerCase() === cleanRole
    );
    if (matchingKey && config.roles[matchingKey]?.[pageId]) {
      return config.roles[matchingKey][pageId];
    }
  }

  // If user is Faculty
  if (isFaculty) {
    return config.tiers.faculty?.[pageId] || createDefaultPagePermission(false, false, false);
  }

  // Otherwise, fallback to General Member tier
  if (isAuthorized) {
    return config.tiers.members?.[pageId] || createDefaultPagePermission(true, false, false);
  }

  return createDefaultPagePermission(false, false, false);
}
