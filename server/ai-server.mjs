import { createServer } from 'node:http';
import {
  ANALYSIS_SCHEMA,
  LETTER_SCHEMA,
  validateAnalysis,
  validateLetter,
} from './analysis-schema.mjs';

const port = Number(process.env.AI_SERVER_PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const maxBodyBytes = 8 * 1024 * 1024;

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('request-too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateRequest(body) {
  if (!body || typeof body !== 'object') return 'Invalid request body.';
  if (!body.cv?.name || !body.cv?.dataUrl) return 'A CV file is required.';
  if (!body.job?.title || !body.job?.text) {
    return 'The current job page title and text are required.';
  }
  if (!['zh', 'en', 'de'].includes(body.language)) {
    return 'Language must be zh, en, or de.';
  }
  return null;
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'refusal') {
        throw new Error(`Model refused the request: ${content.refusal}`);
      }
      if (content.type === 'output_text') return content.text;
    }
  }
  throw new Error('The model returned no structured output.');
}

async function analyze(body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured on the AI server.');
    error.status = 503;
    throw error;
  }

  const languageNames = { zh: 'Simplified Chinese', en: 'English', de: 'German' };
  const prompt = [
    'Analyze the attached CV and job posting.',
    'Extract facts conservatively. Do not invent missing qualifications.',
    'List the job language requirements separately. Include proficiency levels when stated; return an empty array when none are stated or reliably implied.',
    'List the job location requirements separately, including city/country, on-site, remote, hybrid, travel, or relocation requirements when stated; return an empty array when none are stated.',
    'Score skills fit, field-of-study fit, growth value, and career-direction fit from 0 to 100.',
    'skillScore must use only the candidate demonstrated skills and experience versus the job skill requirements. Ignore career direction and skill-development goals when calculating skillScore.',
    'majorScore must use only the candidate education, field of study, and academic background versus the job field requirements. Ignore career direction and skill-development goals when calculating majorScore.',
    'Calculate growthScore from five evidence-based sub-scores, each from 0 to 100: 40% alignment with the user skill-development goals; 20% explicit training, mentoring, or learning opportunities; 10% opportunities for independent ownership, research, or complex work; 10% transferable value for the user future career direction; and 20% expansion of the user current academic or professional knowledge.',
    'For growthScore, do not treat ordinary routine duties as growth opportunities. Do not infer training, mentoring, advancement, research, autonomy, or complex work unless the job posting supports it. Missing evidence for a sub-score must produce a conservative score.',
    'careerDirectionScore must compare the user-entered career direction directly with the role, responsibilities, and likely career path. A missing career direction should receive a neutral score of 50.',
    'The job-search priority changes only the overallScore weighting. It must not change skillScore, majorScore, growthScore, or careerDirectionScore.',
    'Calculate overallScore according to the user job-search priority: growth means 25% skills, 25% major, 30% growth, and 20% career direction; success means 35% skills, 25% major, 20% growth, and 20% career direction; balanced means 30% skills, 25% major, 25% growth, and 20% career direction. Round to an integer.',
    'Use recommendation strong for >=80, recommended for >=65, consider for >=50, otherwise low.',
    `Write all human-readable fields in ${languageNames[body.language]}.`,
    `Job page URL: ${body.job.url || 'unknown'}`,
    `Job page title: ${body.job.title}`,
    `Release date: ${body.job.releaseDate || 'not provided'}`,
    `Application deadline: ${body.job.applicationDeadline || 'not provided'}`,
    `Contact: ${(body.job.contact || []).join('; ') || 'not provided'}`,
    `Application emails: ${(body.job.applicationMethod?.emails || []).join('; ') || 'not provided'}`,
    `Application links: ${(body.job.applicationMethod?.links || []).map((link) => `${link.label}: ${link.url}`).join('; ') || 'not provided'}`,
    `Application instructions: ${(body.job.applicationMethod?.descriptions || []).join('; ') || 'not provided'}`,
    `Required application materials: ${(body.job.applicationMaterials || []).join('; ') || 'not provided'}`,
    `Job posting:\n${body.job.text.slice(0, 100_000)}`,
    `Career direction:\n${body.profile?.careerDirection || ''}`,
    `Job-search priority:\n${body.profile?.jobSearchPriority || 'balanced'}`,
    `Skill goals:\n${body.profile?.skillGoals || ''}`,
    `Volunteer experience:\n${body.profile?.volunteerExperience || ''}`,
    `Additional projects:\n${body.profile?.projects || ''}`,
    `Work experience not listed in the CV:\n${body.profile?.additionalWorkExperience || ''}`,
  ].join('\n\n');

  const apiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: body.cv.name,
              file_data: body.cv.dataUrl,
            },
            { type: 'input_text', text: prompt },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'hiwi_match_analysis',
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
    }),
  });

  const responseBody = await apiResponse.json();
  if (!apiResponse.ok) {
    const error = new Error(
      responseBody?.error?.message || `OpenAI API returned ${apiResponse.status}.`,
    );
    error.status = apiResponse.status;
    throw error;
  }

  const result = JSON.parse(extractOutputText(responseBody));
  const validation = validateAnalysis(result);
  if (!validation.valid) {
    const error = new Error(`Invalid AI output: ${validation.errors.join('; ')}`);
    error.status = 502;
    throw error;
  }
  return result;
}

async function generateLetter(body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured on the AI server.');
    error.status = 503;
    throw error;
  }
  if (
    !['cover', 'motivation', 'introduction-email'].includes(body.type) ||
    !['zh', 'en', 'de'].includes(body.language) ||
    !body.job?.title ||
    !Array.isArray(body.focusExperiences) ||
    body.focusExperiences.length === 0
  ) {
    const error = new Error('Invalid letter request.');
    error.status = 400;
    throw error;
  }

  const languageNames = { zh: 'Simplified Chinese', en: 'English', de: 'German' };
  const letterNames = {
    cover: 'professional cover letter',
    motivation: 'motivation letter focused on reasons, goals, and development',
    'introduction-email':
      'short introduction email for a job application, approximately 100 to 160 words, with a direct subject line, greeting, concise fit statement, and polite closing',
  };
  const prompt = [
    `Write a ${letterNames[body.type]} in ${languageNames[body.language]}.`,
    'Use only the supplied facts. Never invent employers, dates, achievements, degrees, or contact details.',
    'Make the text specific to the job and natural rather than generic.',
    'Return a polished subject and letter body. Do not add markdown fences.',
    `Job title: ${body.job.title}`,
    `Organization: ${body.job.company || 'not provided'}`,
    `Job responsibilities: ${(body.job.responsibilities || []).join('; ')}`,
    `Required skills: ${(body.job.requiredSkills || []).join('; ')}`,
    `Language requirements: ${(body.job.languageRequirements || []).join('; ') || 'not provided'}`,
    `Location requirements: ${(body.job.locationRequirements || []).join('; ') || 'not provided'}`,
    `Selected experiences to emphasize:\n- ${body.focusExperiences.join('\n- ')}`,
    `Match strengths: ${(body.match?.strengths || []).join('; ')}`,
    `Known gaps (do not hide or overstate): ${(body.match?.gaps || []).join('; ')}`,
  ].join('\n\n');

  const apiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      input: prompt,
      text: {
        verbosity: 'medium',
        format: {
          type: 'json_schema',
          name: 'hiwi_application_letter',
          strict: true,
          schema: LETTER_SCHEMA,
        },
      },
    }),
  });
  const responseBody = await apiResponse.json();
  if (!apiResponse.ok) {
    const error = new Error(
      responseBody?.error?.message || `OpenAI API returned ${apiResponse.status}.`,
    );
    error.status = apiResponse.status;
    throw error;
  }
  const result = JSON.parse(extractOutputText(responseBody));
  const validation = validateLetter(result);
  if (!validation.valid) {
    const error = new Error(`Invalid letter output: ${validation.errors.join('; ')}`);
    error.status = 502;
    throw error;
  }
  return result;
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }
  if (
    request.method !== 'POST' ||
    !['/analyze', '/generate-letter'].includes(request.url)
  ) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  try {
    const body = await readJson(request);
    if (request.url === '/analyze') {
      const requestError = validateRequest(body);
      if (requestError) {
        sendJson(response, 400, { error: requestError });
        return;
      }
      sendJson(response, 200, { result: await analyze(body) });
    } else {
      sendJson(response, 200, { result: await generateLetter(body) });
    }
  } catch (reason) {
    const status =
      reason?.message === 'request-too-large' ? 413 : reason?.status || 500;
    sendJson(response, status, {
      error: reason instanceof Error ? reason.message : 'Unexpected server error.',
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`HiWi AI server listening on http://127.0.0.1:${port}`);
  console.log(`Model: ${model}`);
});
