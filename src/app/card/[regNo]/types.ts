export interface UnifiedMember {
  id: string;
  regNo: string;
  name: string;
  phone: string;
  email: string;
  assignedTeam: string;
  position: string;
  role: string;
  photoUrl: string;
  imageUrl: string;
  avatarUrl: string;
  joinDate: string;
  specialization: string;
  rating: number;
  fromFirestore: boolean;
  fromCsv: boolean;
}
