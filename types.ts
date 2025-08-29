
export enum MemberRole {
  MEMBER = 'Member',
  PRESIDENT = 'President',
  VICE_PRESIDENT = 'Vice-President',
  SECRETARY = 'Secretary',
  TREASURER = 'Treasurer',
  TECHNICAL_OFFICER = 'Technical Officer',
  TEACHER_IN_CHARGE = 'Teacher in Charge',
}

export interface TeamMember {
  id: number;
  name: string;
  role: MemberRole;
  grade?: string;
  bio?: string;
  photoUrl?: string;
}

export interface GalleryEvent {
  id: number;
  title: string;
  images: string[]; // This will be a JSON string from DB, parsed on frontend
}

export interface NewsArticle {
  id: number;
  title: string;
  author: string;
  content: string;
  imageUrl?: string;
  createdAt: string;
}

export interface BlogPost {
  id: number;
  title: string;
  author: string;
  excerpt: string;
  content: string;
  imageUrl?: string;
  createdAt: string;
}

export interface ApplicationForm {
  url: string;
  fileName: string;
  updatedAt: string;
}

export enum AdminRole {
    ADMIN = 'ADMIN',
    SUPERADMIN = 'SUPERADMIN'
}

export interface AdminUser {
    id: number;
    email: string;
    role: AdminRole;
    clubId: string; // To associate admin with a specific club
}
