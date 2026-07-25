export interface Member {
  id: string;
  name: string;
  regNo: string;
  phone: string;
  photoUrl: string;
  /** Portrait URL for TCG card. Replace with real member photos when available. */
  avatarUrl: string;
  assignedTeam: string;
  role: string;
  rating?: number;
  joinDate: string;
  specialization: string;
}

export const MEMBERS: Member[] = [
  {
    id: 'mem-001',
    name: 'Aarav Sharma',
    regNo: '25BCS20045',
    phone: '+91 98765 43210',
    photoUrl: 'https://api.dicebear.com/9.x/pixel-art/svg?seed=Aarav&backgroundColor=0a0a0f',
    avatarUrl: 'https://i.pravatar.cc/500?img=11',
    assignedTeam: 'Technical',
    role: 'Lead',
    rating: 4.9,
    joinDate: '2024-07-15',
    specialization: 'Full-Stack & Cybersec',
  },
  {
    id: 'mem-002',
    name: 'Ananya Verma',
    regNo: '25BCG10008',
    phone: '+91 98123 45678',
    photoUrl: 'https://api.dicebear.com/9.x/pixel-art/svg?seed=Ananya&backgroundColor=0a0a0f',
    avatarUrl: 'https://i.pravatar.cc/500?img=5',
    assignedTeam: 'Design',
    role: 'Core Member',
    rating: 4.7,
    joinDate: '2024-08-01',
    specialization: 'UI/UX & Motion Design',
  },
  {
    id: 'mem-003',
    name: 'Rohan Gupta',
    regNo: '25BCE10102',
    phone: '+91 97654 32109',
    photoUrl: 'https://api.dicebear.com/9.x/pixel-art/svg?seed=Rohan&backgroundColor=0a0a0f',
    avatarUrl: 'https://i.pravatar.cc/500?img=12',
    assignedTeam: 'Operations',
    role: 'Manager',
    rating: 4.4,
    joinDate: '2024-09-10',
    specialization: 'Event Logistics & Ops',
  },
  {
    id: 'mem-004',
    name: 'Priya Iyer',
    regNo: '25BAI10089',
    phone: '+91 99887 76655',
    photoUrl: 'https://api.dicebear.com/9.x/pixel-art/svg?seed=Priyadarshini&backgroundColor=0a0a0f',
    avatarUrl: 'https://i.pravatar.cc/500?img=9',
    assignedTeam: 'Research',
    role: 'Lead',
    rating: 4.8,
    joinDate: '2024-06-20',
    specialization: 'AI & Neural Networks',
  },
  {
    id: 'mem-005',
    name: 'Vikram Singh',
    regNo: '25BIT10314',
    phone: '+91 96543 21098',
    photoUrl: 'https://api.dicebear.com/9.x/pixel-art/svg?seed=Vikramaditya&backgroundColor=0a0a0f',
    avatarUrl: 'https://i.pravatar.cc/500?img=53',
    assignedTeam: 'Marketing',
    role: 'Coordinator',
    rating: 3.9,
    joinDate: '2025-01-12',
    specialization: 'Growth & Digital Strategy',
  },
  {
    id: 'mem-006',
    name: 'Tanvi Kulkarni',
    regNo: '25BME10056',
    phone: '+91 95432 10987',
    photoUrl: 'https://api.dicebear.com/9.x/pixel-art/svg?seed=Tanvi&backgroundColor=0a0a0f',
    avatarUrl: 'https://i.pravatar.cc/500?img=25',
    assignedTeam: 'Content',
    role: 'Core Member',
    rating: 4.2,
    joinDate: '2024-11-05',
    specialization: 'Technical Writing & PR',
  },
  {
    id: 'mem-007',
    name: 'Devansh Nair',
    regNo: '25ECE10221',
    phone: '+91 94321 09876',
    photoUrl: 'https://api.dicebear.com/9.x/pixel-art/svg?seed=Devansh&backgroundColor=0a0a0f',
    avatarUrl: 'https://i.pravatar.cc/500?img=33',
    assignedTeam: 'Technical',
    role: 'Volunteer',
    joinDate: '2025-02-01',
    specialization: 'Embedded Systems & IoT',
  },
  {
    id: 'mem-008',
    name: 'Ishita Patel',
    regNo: '25BCS20188',
    phone: '+91 93210 98765',
    photoUrl: 'https://api.dicebear.com/9.x/pixel-art/svg?seed=Ishita&backgroundColor=0a0a0f',
    avatarUrl: 'https://i.pravatar.cc/500?img=23',
    assignedTeam: 'Operations',
    role: 'Volunteer',
    joinDate: '2025-02-10',
    specialization: 'Sponsorship & Outreach',
  },
];

export function getMemberById(id: string): Member | undefined {
  return MEMBERS.find((m) => m.id === id);
}

export function getRandomMember(): Member {
  return MEMBERS[Math.floor(Math.random() * MEMBERS.length)];
}
