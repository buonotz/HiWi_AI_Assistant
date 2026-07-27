import type { Language } from './i18n';

export type AiAnalysis = {
  schemaVersion: '1.0';
  cv: {
    summary: string;
    education: string[];
    experience: string[];
    skills: string[];
    languages: string[];
  };
  job: {
    title: string;
    company: string;
    responsibilities: string[];
    requiredSkills: string[];
    preferredMajors: string[];
    growthSignals: string[];
  };
  match: {
    skillScore: number;
    majorScore: number;
    growthScore: number;
    overallScore: number;
    recommendation: 'strong' | 'recommended' | 'consider' | 'low';
    strengths: string[];
    gaps: string[];
    evidence: string[];
    summary: string;
  };
};

export type ApplicationLetter = {
  schemaVersion: '1.0';
  type: 'cover' | 'motivation';
  subject: string;
  body: string;
};

type AnalysisRequest = {
  language: Language;
  cv: { name: string; type: string; dataUrl: string };
  job: { title: string; url: string; text: string };
  profile: {
    background: string;
    careerDirection: string;
    skillGoals: string;
  };
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function validateAiAnalysis(value: unknown): value is AiAnalysis {
  if (!value || typeof value !== 'object') return false;
  const result = value as AiAnalysis;
  const scores = [
    result.match?.skillScore,
    result.match?.majorScore,
    result.match?.growthScore,
    result.match?.overallScore,
  ];
  return (
    result.schemaVersion === '1.0' &&
    typeof result.cv?.summary === 'string' &&
    isStringArray(result.cv?.education) &&
    isStringArray(result.cv?.experience) &&
    isStringArray(result.cv?.skills) &&
    isStringArray(result.cv?.languages) &&
    typeof result.job?.title === 'string' &&
    typeof result.job?.company === 'string' &&
    isStringArray(result.job?.responsibilities) &&
    isStringArray(result.job?.requiredSkills) &&
    isStringArray(result.job?.preferredMajors) &&
    isStringArray(result.job?.growthSignals) &&
    scores.every(
      (score) => Number.isInteger(score) && score >= 0 && score <= 100,
    ) &&
    ['strong', 'recommended', 'consider', 'low'].includes(
      result.match?.recommendation,
    ) &&
    isStringArray(result.match?.strengths) &&
    isStringArray(result.match?.gaps) &&
    isStringArray(result.match?.evidence) &&
    typeof result.match?.summary === 'string'
  );
}

export async function requestAiAnalysis(
  request: AnalysisRequest,
): Promise<AiAnalysis> {
  const response = await fetch('http://127.0.0.1:8787/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `AI server returned ${response.status}.`);
  }
  if (!validateAiAnalysis(body?.result)) {
    throw new Error('invalid-ai-response');
  }
  return body.result;
}

export async function requestApplicationLetter(request: {
  language: Language;
  type: 'cover' | 'motivation';
  focusExperiences: string[];
  job: AiAnalysis['job'];
  match: AiAnalysis['match'];
}): Promise<ApplicationLetter> {
  const response = await fetch('http://127.0.0.1:8787/generate-letter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `AI server returned ${response.status}.`);
  }
  const result = body?.result as ApplicationLetter | undefined;
  if (
    result?.schemaVersion !== '1.0' ||
    !['cover', 'motivation'].includes(result.type) ||
    typeof result.subject !== 'string' ||
    typeof result.body !== 'string'
  ) {
    throw new Error('invalid-letter-response');
  }
  return result;
}
