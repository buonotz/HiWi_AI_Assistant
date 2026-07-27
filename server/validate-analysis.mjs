import { validateAnalysis, validateLetter } from './analysis-schema.mjs';

const validFixture = {
  schemaVersion: '1.0',
  cv: {
    summary: 'Computer science student',
    education: ['B.Sc. Computer Science'],
    experience: ['Student developer'],
    skills: ['TypeScript'],
    languages: ['English'],
  },
  job: {
    title: 'HiWi',
    company: 'Example University',
    responsibilities: ['Develop a prototype'],
    requiredSkills: ['TypeScript'],
    preferredMajors: ['Computer Science'],
    growthSignals: ['Mentoring'],
    languageRequirements: ['English'],
    locationRequirements: ['On-site in Munich'],
  },
  match: {
    skillScore: 85,
    majorScore: 90,
    growthScore: 80,
    careerDirectionScore: 85,
    overallScore: 86,
    recommendation: 'strong',
    strengths: ['Relevant degree'],
    gaps: [],
    evidence: ['TypeScript appears in CV and job description'],
    summary: 'Strong match',
  },
};

const validResult = validateAnalysis(validFixture);
const invalidResult = validateAnalysis({
  ...validFixture,
  match: { ...validFixture.match, skillScore: 101 },
});

if (!validResult.valid || invalidResult.valid) {
  console.error({ validResult, invalidResult });
  process.exit(1);
}

const validLetter = validateLetter({
  schemaVersion: '1.0',
  type: 'cover',
  subject: 'Application',
  body: 'Dear Hiring Team...',
});
const invalidLetter = validateLetter({
  schemaVersion: '1.0',
  type: 'other',
  subject: 'Application',
  body: 'Dear Hiring Team...',
});

if (!validLetter.valid || invalidLetter.valid) {
  console.error({ validLetter, invalidLetter });
  process.exit(1);
}

console.log('AI analysis and letter schema validation passed.');
