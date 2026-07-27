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
    'Score skills fit, field-of-study fit, and growth value from 0 to 100.',
    'Calculate overallScore as 45% skills, 30% major, and 25% growth, rounded to an integer.',
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
    `User-entered background:\n${body.profile?.background || ''}`,
    `Career direction:\n${body.profile?.careerDirection || ''}`,
    `Skill goals:\n${body.profile?.skillGoals || ''}`,
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
    !['cover', 'motivation'].includes(body.type) ||
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
