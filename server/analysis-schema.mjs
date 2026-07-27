export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'cv', 'job', 'match'],
  properties: {
    schemaVersion: { type: 'string', enum: ['1.0'] },
    cv: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'education', 'experience', 'skills', 'languages'],
      properties: {
        summary: { type: 'string' },
        education: { type: 'array', items: { type: 'string' } },
        experience: { type: 'array', items: { type: 'string' } },
        skills: { type: 'array', items: { type: 'string' } },
        languages: { type: 'array', items: { type: 'string' } },
      },
    },
    job: {
      type: 'object',
      additionalProperties: false,
      required: [
        'title',
        'company',
        'responsibilities',
        'requiredSkills',
        'preferredMajors',
        'growthSignals',
        'languageRequirements',
        'locationRequirements',
      ],
      properties: {
        title: { type: 'string' },
        company: { type: 'string' },
        responsibilities: { type: 'array', items: { type: 'string' } },
        requiredSkills: { type: 'array', items: { type: 'string' } },
        preferredMajors: { type: 'array', items: { type: 'string' } },
        growthSignals: { type: 'array', items: { type: 'string' } },
        languageRequirements: { type: 'array', items: { type: 'string' } },
        locationRequirements: { type: 'array', items: { type: 'string' } },
      },
    },
    match: {
      type: 'object',
      additionalProperties: false,
      required: [
        'skillScore',
        'majorScore',
        'growthScore',
        'careerDirectionScore',
        'overallScore',
        'recommendation',
        'strengths',
        'gaps',
        'evidence',
        'summary',
      ],
      properties: {
        skillScore: { type: 'integer', minimum: 0, maximum: 100 },
        majorScore: { type: 'integer', minimum: 0, maximum: 100 },
        growthScore: { type: 'integer', minimum: 0, maximum: 100 },
        careerDirectionScore: { type: 'integer', minimum: 0, maximum: 100 },
        overallScore: { type: 'integer', minimum: 0, maximum: 100 },
        recommendation: {
          type: 'string',
          enum: ['strong', 'recommended', 'consider', 'low'],
        },
        strengths: { type: 'array', items: { type: 'string' } },
        gaps: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
};

export const LETTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'type', 'subject', 'body'],
  properties: {
    schemaVersion: { type: 'string', enum: ['1.0'] },
    type: {
      type: 'string',
      enum: ['cover', 'motivation', 'introduction-email'],
    },
    subject: { type: 'string' },
    body: { type: 'string' },
  },
};

function validateNode(value, schema, path, errors) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path} must be an object`);
      return;
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) {
          errors.push(`${path}.${key} is not allowed`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        validateNode(value[key], childSchema, `${path}.${key}`, errors);
      }
    }
    return;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`);
      return;
    }
    value.forEach((item, index) =>
      validateNode(item, schema.items, `${path}[${index}]`, errors),
    );
    return;
  }

  if (schema.type === 'string' && typeof value !== 'string') {
    errors.push(`${path} must be a string`);
  }
  if (schema.type === 'integer' && !Number.isInteger(value)) {
    errors.push(`${path} must be an integer`);
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path} must be at least ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push(`${path} must be at most ${schema.maximum}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
  }
}

export function validateAnalysis(value) {
  const errors = [];
  validateNode(value, ANALYSIS_SCHEMA, '$', errors);
  return { valid: errors.length === 0, errors };
}

export function validateLetter(value) {
  const errors = [];
  validateNode(value, LETTER_SCHEMA, '$', errors);
  return { valid: errors.length === 0, errors };
}
