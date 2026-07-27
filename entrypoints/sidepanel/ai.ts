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
    languageRequirements: string[];
    locationRequirements: string[];
  };
  match: {
    skillScore: number;
    majorScore: number;
    growthScore: number;
    careerDirectionScore: number;
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
  type: 'cover' | 'motivation' | 'introduction-email';
  subject: string;
  body: string;
};

type AnalysisRequest = {
  language: Language;
  cv: { name: string; type: string; dataUrl: string };
  job: { title: string; url: string; text: string };
  profile: {
    careerDirection: string;
    skillGoals: string;
    volunteerExperience: string;
    projects: string;
    additionalWorkExperience: string;
    jobSearchPriority: 'growth' | 'success' | 'balanced';
  };
};

const ANALYSIS_CACHE_PREFIX = 'aiAnalysisCache:v7:';
const BACKGROUND_SCORE_CACHE_PREFIX = 'backgroundScores:v1:';
const CAREER_SCORE_CACHE_PREFIX = 'careerDirectionScores:v1:';
const GROWTH_SCORE_CACHE_PREFIX = 'growthScores:v1:';

async function createFingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

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
    result.match?.careerDirectionScore,
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
    isStringArray(result.job?.languageRequirements) &&
    isStringArray(result.job?.locationRequirements) &&
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

function applyOverallScore(
  result: AiAnalysis,
  priority: AnalysisRequest['profile']['jobSearchPriority'],
) {
  const weights =
    priority === 'growth'
      ? { skills: 0.25, major: 0.25, growth: 0.3, career: 0.2 }
      : priority === 'success'
        ? { skills: 0.35, major: 0.25, growth: 0.2, career: 0.2 }
        : { skills: 0.3, major: 0.25, growth: 0.25, career: 0.2 };
  result.match.overallScore = Math.round(
    result.match.skillScore * weights.skills +
      result.match.majorScore * weights.major +
      result.match.growthScore * weights.growth +
      result.match.careerDirectionScore * weights.career,
  );
  result.match.recommendation =
    result.match.overallScore >= 80
      ? 'strong'
      : result.match.overallScore >= 65
        ? 'recommended'
        : result.match.overallScore >= 50
          ? 'consider'
          : 'low';
}

export async function requestAiAnalysis(
  request: AnalysisRequest,
): Promise<AiAnalysis> {
  const fingerprint = await createFingerprint(request);
  const cacheKey = `${ANALYSIS_CACHE_PREFIX}${fingerprint}`;
  const cached = (await browser.storage.local.get(cacheKey))[cacheKey];
  if (validateAiAnalysis(cached)) {
    return cached;
  }

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

  const backgroundFingerprint = await createFingerprint({
    cv: request.cv,
    job: request.job,
    profile: {
      volunteerExperience: request.profile.volunteerExperience,
      projects: request.profile.projects,
      additionalWorkExperience: request.profile.additionalWorkExperience,
    },
  });
  const backgroundScoreKey =
    `${BACKGROUND_SCORE_CACHE_PREFIX}${backgroundFingerprint}`;
  const storedScores = (await browser.storage.local.get(backgroundScoreKey))[
    backgroundScoreKey
  ] as { skillScore?: unknown; majorScore?: unknown } | undefined;
  const hasStoredScores =
    Number.isInteger(storedScores?.skillScore) &&
    Number.isInteger(storedScores?.majorScore);
  const result = body.result as AiAnalysis;

  if (hasStoredScores) {
    result.match.skillScore = storedScores!.skillScore as number;
    result.match.majorScore = storedScores!.majorScore as number;
  } else {
    await browser.storage.local.set({
      [backgroundScoreKey]: {
        skillScore: result.match.skillScore,
        majorScore: result.match.majorScore,
      },
    });
  }

  const careerFingerprint = await createFingerprint({
    job: request.job,
    careerDirection: request.profile.careerDirection,
  });
  const careerScoreKey = `${CAREER_SCORE_CACHE_PREFIX}${careerFingerprint}`;
  const storedCareerScore = (
    await browser.storage.local.get(careerScoreKey)
  )[careerScoreKey];
  if (Number.isInteger(storedCareerScore)) {
    result.match.careerDirectionScore = storedCareerScore as number;
  } else {
    await browser.storage.local.set({
      [careerScoreKey]: result.match.careerDirectionScore,
    });
  }

  const growthFingerprint = await createFingerprint({
    cv: request.cv,
    job: request.job,
    profile: {
      careerDirection: request.profile.careerDirection,
      skillGoals: request.profile.skillGoals,
      volunteerExperience: request.profile.volunteerExperience,
      projects: request.profile.projects,
      additionalWorkExperience: request.profile.additionalWorkExperience,
    },
  });
  const growthScoreKey = `${GROWTH_SCORE_CACHE_PREFIX}${growthFingerprint}`;
  const storedGrowthScore = (
    await browser.storage.local.get(growthScoreKey)
  )[growthScoreKey];
  if (Number.isInteger(storedGrowthScore)) {
    result.match.growthScore = storedGrowthScore as number;
  } else {
    await browser.storage.local.set({
      [growthScoreKey]: result.match.growthScore,
    });
  }

  applyOverallScore(result, request.profile.jobSearchPriority);

  await browser.storage.local.set({ [cacheKey]: result });
  return result;
}

export async function requestApplicationLetter(request: {
  language: Language;
  type: 'cover' | 'motivation' | 'introduction-email';
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
    !['cover', 'motivation', 'introduction-email'].includes(result.type) ||
    typeof result.subject !== 'string' ||
    typeof result.body !== 'string'
  ) {
    throw new Error('invalid-letter-response');
  }
  return result;
}
