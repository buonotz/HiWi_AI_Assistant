export type KeywordGroup = {
  type: 'skills' | 'majors' | 'growth';
  keywords: string[];
  score: number;
};

export type MatchResult = {
  skills: KeywordGroup;
  majors: KeywordGroup;
  growth: KeywordGroup;
  overallScore: number;
  recommendation: 'strong' | 'recommended' | 'consider' | 'low';
};

type ProfileForMatching = {
  careerDirection: string;
  skillGoals: string;
  volunteerExperience: string;
  projects: string;
  additionalWorkExperience: string;
};

const SKILL_KEYWORDS = [
  'Python',
  'Java',
  'JavaScript',
  'TypeScript',
  'React',
  'SQL',
  'Git',
  'Docker',
  'Kubernetes',
  'AWS',
  'Azure',
  'Excel',
  'MATLAB',
  'C++',
  'Machine Learning',
  'Data Analysis',
  '人工智能',
  '机器学习',
  '数据分析',
];

const MAJOR_KEYWORDS = [
  'Computer Science',
  'Data Science',
  'Business Informatics',
  'Engineering',
  'Mathematics',
  'Statistics',
  'Economics',
  'Informatik',
  'Wirtschaftsinformatik',
  'Ingenieurwesen',
  '计算机',
  '数据科学',
  '软件工程',
  '数学',
  '统计学',
  '经济学',
];

const GROWTH_KEYWORDS = [
  'Mentoring',
  'Training',
  'Research',
  'Weiterbildung',
  'Mentoring',
  'Verantwortung',
  'international',
  'flexible',
  'career development',
  'learning opportunities',
  '培训',
  '导师',
  '研究',
  '成长',
  '学习机会',
  '独立负责',
  '国际化',
  '灵活工作',
];

function extractKeywords(text: string, candidates: string[]) {
  const normalizedText = text.toLocaleLowerCase();
  return [...new Set(candidates)].filter((keyword) =>
    normalizedText.includes(keyword.toLocaleLowerCase()),
  );
}

function countProfileMatches(keywords: string[], profileText: string) {
  const normalizedProfile = profileText.toLocaleLowerCase();
  return keywords.filter((keyword) =>
    normalizedProfile.includes(keyword.toLocaleLowerCase()),
  ).length;
}

function score(base: number, keywordCount: number, profileMatches: number) {
  return Math.min(96, base + keywordCount * 5 + profileMatches * 9);
}

export function analyzeJob(
  title: string,
  text: string,
  profile: ProfileForMatching,
): MatchResult {
  const jobText = `${title}\n${text}`;
  const profileText = [
    profile.careerDirection,
    profile.skillGoals,
    profile.volunteerExperience,
    profile.projects,
    profile.additionalWorkExperience,
  ].join('\n');

  const skillKeywords = extractKeywords(jobText, SKILL_KEYWORDS);
  const majorKeywords = extractKeywords(jobText, MAJOR_KEYWORDS);
  const growthKeywords = extractKeywords(jobText, GROWTH_KEYWORDS);

  const skillScore = score(
    44,
    skillKeywords.length,
    countProfileMatches(skillKeywords, profileText),
  );
  const majorScore = score(
    48,
    majorKeywords.length,
    countProfileMatches(majorKeywords, profileText),
  );
  const growthScore = score(
    50,
    growthKeywords.length,
    countProfileMatches(growthKeywords, profile.skillGoals),
  );
  const overallScore = Math.round(
    skillScore * 0.45 + majorScore * 0.3 + growthScore * 0.25,
  );

  const recommendation =
    overallScore >= 80
      ? 'strong'
      : overallScore >= 65
        ? 'recommended'
        : overallScore >= 50
          ? 'consider'
          : 'low';

  return {
    skills: { type: 'skills', keywords: skillKeywords, score: skillScore },
    majors: { type: 'majors', keywords: majorKeywords, score: majorScore },
    growth: {
      type: 'growth',
      keywords: growthKeywords,
      score: growthScore,
    },
    overallScore,
    recommendation,
  };
}
