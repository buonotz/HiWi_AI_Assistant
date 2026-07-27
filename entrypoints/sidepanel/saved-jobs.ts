import type { AiAnalysis, ApplicationLetter } from './ai';

export type ApplicationStatus =
  | 'saved'
  | 'preparing'
  | 'applied'
  | 'interview'
  | 'rejected'
  | 'offer';

export type SavedJob = {
  id: string;
  url: string;
  title: string;
  company: string;
  status: ApplicationStatus;
  deadline: string;
  analysis: AiAnalysis;
  letter: ApplicationLetter | null;
  createdAt: string;
  updatedAt: string;
};
