export interface FacultyMember {
  id: string;
  email: string;
  name: string;
  facultyId?: string;
  department?: string;
  designation?: string;
  phone?: string;
  avatarUrl?: string;
  created_at?: string;
}

export type FacultyApprovalStatus = 'approved' | 'rejected' | 'pending';

export interface FacultyDecision {
  facultyEmail: string;
  facultyName?: string;
  facultyId?: string;
  status: FacultyApprovalStatus;
  remarks?: string;
  respondedAt?: string;
}

export interface FutureEventPlan {
  id: string;
  title: string;
  tentativeDate: string;
  description: string;
  driveLink: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  facultyDecisions?: Record<string, FacultyDecision>;
}
