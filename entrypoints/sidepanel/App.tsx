import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AiAnalysis,
  ApplicationLetter,
  requestAiAnalysis,
  requestApplicationLetter,
} from './ai';
import { getTranslator, Language, TranslationKey } from './i18n';
import { analyzeJob } from './matching';
import {
  ApplicationStatus,
  SavedJob,
} from './saved-jobs';

type PageInfo = {
  title: string;
  url: string;
  releaseDate: string;
  applicationDeadline: string;
  text: string;
  applicationMaterials: string[];
  contact: string[];
  applicationMethod: {
    descriptions: string[];
    emails: string[];
    links: { label: string; url: string }[];
  };
};

type StoredCv = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

type UserProfile = {
  background: string;
  careerDirection: string;
  skillGoals: string;
  cv: StoredCv | null;
};

const PROFILE_KEY = 'userProfile';
const LANGUAGE_KEY = 'displayLanguage';
const SAVED_JOBS_KEY = 'savedJobs';
const MAX_CV_SIZE = 3 * 1024 * 1024;
const EMPTY_PROFILE: UserProfile = {
  background: '',
  careerDirection: '',
  skillGoals: '',
  cv: null,
};

function readPage(noTitle: string, noBody: string): PageInfo {
  const isLinkedInJob =
    /(^|\.)linkedin\.com$/i.test(window.location.hostname) &&
    window.location.pathname.startsWith('/jobs/');
  const normalize = (value: string) =>
    value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const textOf = (element: Element | null) =>
    normalize(element?.textContent || '');
  const semanticTextOf = (element: Element) => {
    const blockSelector = 'h1, h2, h3, h4, h5, h6, p, li, dt, dd, pre';
    const inlineHeadingPattern =
      /^(?:your profile|required qualifications?|additional qualifications?|preferred qualifications?|responsibilities|your tasks|our offer|we offer|what we offer|application process|how to apply|aufgaben|ihre aufgaben|dein profil|ihr profil|anforderungen|qualifikationen|wir bieten|bewerbungsprozess|bewerbung|工作职责|岗位职责|任职要求|资格要求|加分项|我们提供|申请流程|申请方式)\s*:?\s*$/i;
    const blocks = Array.from(element.querySelectorAll(blockSelector))
      .filter(
        (block) =>
          !Array.from(block.children).some((child) =>
            child.matches(blockSelector),
          ),
      )
      .map((block) => {
        const clone = block.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
        clone.querySelectorAll('strong, b').forEach((emphasis) => {
          const emphasizedText = normalize(emphasis.textContent || '');
          if (inlineHeadingPattern.test(emphasizedText)) {
            emphasis.replaceWith(`\n\n${emphasizedText}\n\n`);
          } else {
            emphasis.before(' ');
            emphasis.after(' ');
          }
        });
        return normalize(clone.textContent || '');
      })
      .filter(Boolean);
    const deduplicated = blocks.filter(
      (block, index) => index === 0 || block !== blocks[index - 1],
    );
    return deduplicated.length > 0
      ? deduplicated.join('\n\n')
      : normalize(element.textContent || '');
  };
  const unique = <T,>(items: T[]) => [...new Set(items)];
  const sectionHeadingPattern =
    /^(?:your profile|required qualifications?|additional qualifications?|preferred qualifications?|responsibilities|your tasks|our offer|we offer|what we offer|application process|how to apply|about the job|job overview|benefits?\s*(?:&|and)\s*perks?|location|aufgaben|ihre aufgaben|dein profil|ihr profil|anforderungen|qualifikationen|wir bieten|bewerbungsprozess|bewerbung)\s*:?\s*$/i;
  const joinWrappedParagraphs = (value: string) => {
    const lines = value
      .split(/\n+/)
      .map((line) => normalize(line))
      .filter(Boolean);
    const paragraphs: string[] = [];

    for (const line of lines) {
      const previous = paragraphs.at(-1);
      const isHeading = sectionHeadingPattern.test(line);
      const previousIsHeading = previous
        ? sectionHeadingPattern.test(previous)
        : false;
      const words = line.replace(/[.:]$/, '').split(/\s+/).filter(Boolean);
      const titleCaseWords = words.filter(
        (word) =>
          /^(?:a|an|and|as|at|by|for|from|in|of|on|or|the|to|with)$/i.test(
            word,
          ) || /^[A-ZÄÖÜ0-9$#]/.test(word),
      ).length;
      const isStructuralLine =
        isHeading ||
        /^(?:employment type|available shifts?|location|job overview|benefits?\s*(?:&|and)\s*perks?)\s*:/i.test(
          line,
        ) ||
        (words.length <= 12 &&
          titleCaseWords / Math.max(words.length, 1) >= 0.85 &&
          !/[!?]$/.test(line));
      const previousIsComplete = previous
        ? /[.!?;:)\]”"']$/.test(previous)
        : true;
      const looksLikeContinuation =
        /^[a-z,.;:)\]”"']/.test(line) ||
        Boolean(previous && previous.length < 55);

      if (
        previous &&
        !isStructuralLine &&
        !previousIsHeading &&
        (!previousIsComplete || looksLikeContinuation)
      ) {
        paragraphs[paragraphs.length - 1] = normalize(`${previous} ${line}`);
      } else {
        paragraphs.push(line);
      }
    }

    return paragraphs.join('\n\n');
  };

  const titleSelectors = [
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    '.jobs-details-top-card__job-title',
    '[data-job-title]',
    '[itemprop="title"]',
    '[class*="job-title" i]',
    '[class*="position-title" i]',
    '.page-title',
  ];
  const explicitTitle = titleSelectors
    .map((selector) => document.querySelector(selector))
    .find((element) => textOf(element).length > 5);
  const headingCandidates = Array.from(
    document.querySelectorAll('h1, h2'),
  ).filter((heading) => textOf(heading).length > 5);
  const titleTermPattern =
    /assistant|student|intern|research|developer|engineer|manager|analyst|wissenschaft|mitarbeiter|praktik|werkstudent|hiwi|stelle|岗位|助理|实习|工程师|研究/i;
  const scoreTitle = (heading: Element) => {
    const text = textOf(heading);
    const documentTitleMatch = document.title
      .toLocaleLowerCase()
      .includes(text.toLocaleLowerCase());
    return (
      text.length +
      (titleTermPattern.test(text) ? 500 : 0) +
      (documentTitleMatch ? 250 : 0) -
      (/university|universität|portal|welcome|home/i.test(text) ? 300 : 0)
    );
  };
  const jobHeading =
    explicitTitle ||
    headingCandidates.sort((a, b) => scoreTitle(b) - scoreTitle(a))[0] ||
    null;
  const extractedTitle =
    textOf(jobHeading) ||
    document.title.replace(/^(?:TUM|MyTUM)\s*[-–|]\s*/i, '') ||
    noTitle;

  const candidateSelectors = [
    'main',
    'article',
    '[role="main"]',
    '#main',
    '#content',
    '.main-content',
    '.page-content',
    '[class*="job-detail" i]',
    '[class*="job-description" i]',
    '[class*="stellenanzeige" i]',
    '[class*="vacancy" i]',
  ];
  const candidates = unique(
    candidateSelectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)),
    ),
  ).filter((element) => textOf(element).length > 120);
  const jobTerms =
    /responsibilit|requirement|qualification|task|profile|offer|bewerb|aufgabe|anforder|qualifikation|wir bieten|tätigkeit|职责|要求|资格|工作内容|岗位描述/gi;
  const scoreCandidate = (element: Element) => {
    const text = textOf(element);
    const termCount = text.match(jobTerms)?.length || 0;
    const linkTextLength = Array.from(element.querySelectorAll('a')).reduce(
      (sum, link) => sum + textOf(link).length,
      0,
    );
    return Math.min(text.length, 20_000) + termCount * 500 - linkTextLength * 0.5;
  };
  let source =
    candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0] ||
    document.body;
  const linkedInDetails = isLinkedInJob
    ? document.querySelector(
        [
          '.jobs-search__job-details--container',
          '.jobs-details',
          '.job-view-layout',
          '.jobs-details__main-content',
        ].join(','),
      )
    : null;
  if (isLinkedInJob) {
    const linkedInDescriptionCandidates = Array.from(
      (linkedInDetails || document).querySelectorAll(
        [
          '.jobs-description__content',
          '.jobs-box__html-content',
          '.jobs-description-content__text',
          '#job-details',
          '[class*="jobs-description" i]',
        ].join(','),
      ),
    ).filter((element) => textOf(element).length > 100);
    const longestLinkedInDescription =
      linkedInDescriptionCandidates.sort(
        (a, b) =>
          (b as HTMLElement).innerText.length -
          (a as HTMLElement).innerText.length,
      )[0] || null;
    source =
      longestLinkedInDescription ||
      linkedInDetails ||
      source;
  }
  if (jobHeading && !isLinkedInJob) {
    let anchoredSource: Element = jobHeading;
    while (
      anchoredSource.parentElement &&
      textOf(anchoredSource).length < 700
    ) {
      anchoredSource = anchoredSource.parentElement;
    }
    const anchoredLength = textOf(anchoredSource).length;
    if (anchoredLength >= 300 && anchoredLength < 50_000) {
      source = anchoredSource;
    }
  }
  const cleaned = source.cloneNode(true) as HTMLElement;
  cleaned
    .querySelectorAll(
      [
        'nav',
        'header',
        'footer',
        'aside',
        'script',
        'style',
        'noscript',
        'iframe',
        'dialog',
        'button',
        '[role="navigation"]',
        '[class*="cookie" i]',
        '[id*="cookie" i]',
        '[class*="breadcrumb" i]',
        '[class*="sidebar" i]',
        '[class*="navigation" i]',
        '[class*="social" i]',
        '[class*="share" i]',
        '[class*="advert" i]',
        '.jobs-job-board-list',
        '.jobs-search-results-list',
        '.job-card-container',
        '.jobs-unified-top-card__job-insight-view-model-secondary',
        '[class*="premium" i]',
      ].join(','),
    )
    .forEach((element) => element.remove());
  const extractedVisibleText =
    isLinkedInJob && cleaned.innerText
      ? normalize(cleaned.innerText)
      : semanticTextOf(cleaned);
  let cleanedText = joinWrappedParagraphs(extractedVisibleText) || noBody;
  const titlePosition = cleanedText
    .toLocaleLowerCase()
    .indexOf(extractedTitle.toLocaleLowerCase());
  if (titlePosition >= 0) {
    cleanedText = normalize(
      cleanedText.slice(titlePosition + extractedTitle.length),
    );
  }

  const dateContext =
    /release|published|posted|date|veröffentlicht|eingestellt|datum|发布日期|发布时间/i;
  const datePattern =
    /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i;
  const dateElements = Array.from(
    source.querySelectorAll(
      'time, [class*="date" i], [id*="date" i], [class*="publish" i], [class*="release" i]',
    ),
  );
  const myTumUrlDate = window.location.href.match(
    /NewsArticle_(\d{4})(\d{2})(\d{2})/i,
  );
  const releaseDateFromUrl = myTumUrlDate
    ? `${myTumUrlDate[3]}.${myTumUrlDate[2]}.${myTumUrlDate[1]}`
    : '';
  const releaseDate =
    releaseDateFromUrl ||
    (isLinkedInJob
      ? textOf(linkedInDetails || source)
          .match(
            /\b(?:reposted|posted)\s+(?:\d+\s+)?(?:minute|hour|day|week|month)s?\s+ago\b/i,
          )?.[0] || ''
      : '') ||
    dateElements
      .map((element) => {
        const value =
          element.getAttribute('datetime') || textOf(element);
        const context = `${textOf(element.parentElement)} ${value}`;
        return dateContext.test(context) || element.tagName === 'TIME'
          ? value.match(datePattern)?.[0] || value
          : '';
      })
      .find(Boolean) ||
    cleanedText
      .split('\n')
      .find((line, index) => index < 5 && datePattern.test(line))
      ?.match(datePattern)?.[0] ||
    '';
  if (releaseDate) {
    cleanedText = normalize(
      cleanedText.replace(
        new RegExp(`^\\s*${releaseDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n?`),
        '',
      ),
    );
  }

  const emailPattern = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
  const phonePattern = /(?:\+\d{1,3}[\s/-]?)?(?:\(?\d{2,5}\)?[\s/-]?){2,5}\d{2,}/g;
  const emails = unique([
    ...(cleanedText.match(emailPattern) || []),
    ...Array.from(source.querySelectorAll('a[href^="mailto:"]')).map((link) =>
      (link.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0],
    ),
  ]).filter(Boolean);
  const phones = unique([
    ...(cleanedText.match(phonePattern) || []),
    ...Array.from(source.querySelectorAll('a[href^="tel:"]')).map((link) =>
      (link.getAttribute('href') || '').replace(/^tel:/i, ''),
    ),
  ]).filter(
    (phone) =>
      Boolean(phone) && (phone.match(/\d/g)?.length || 0) >= 7,
  );
  const contactLines = cleanedText
    .split('\n')
    .filter(
      (line) =>
        /contact|ansprechpartner|kontakt|联系人/i.test(line) &&
        line.length < 240,
    )
    .slice(0, 3);
  const contact = unique([...contactLines, ...emails, ...phones]);

  const applicationLinks = Array.from(
    (linkedInDetails || source).querySelectorAll('a[href]'),
  )
    .map((link) => ({
      label: textOf(link) || link.getAttribute('href') || '',
      url: (link as HTMLAnchorElement).href,
    }))
    .filter(
      ({ label, url }) =>
        !url.startsWith('mailto:') &&
        /apply|application|bewerb|stellenportal|申请|投递/i.test(`${label} ${url}`),
    )
    .filter(
      (link, index, links) =>
        links.findIndex((candidate) => candidate.url === link.url) === index,
    )
    .slice(0, 5);

  const materialPattern =
    /cover letter|motivation letter|curriculum vitae|\bCV\b|résumé|resume|academic transcript|transcript|reference|certificate|application document|single PDF|anschreiben|motivationsschreiben|lebenslauf|zeugnis|referenz|bewerbungsunterlagen|申请信|动机信|简历|成绩单|推荐信|证明材料|申请材料/i;
  const explicitApplicationDocumentPattern =
    /cover letter|motivation letter|curriculum vitae|\bCV\b|résumé|resume|academic transcript|transcript|reference|application document|single PDF|anschreiben|motivationsschreiben|lebenslauf|zeugnis|referenz|bewerbungsunterlagen/i;
  const applicationMaterials = unique(
    cleanedText
      .split(/\n+|(?<=[.!?。！？])\s+/)
      .map((part) => normalize(part))
      .filter(
        (part) =>
          part.length >= 5 &&
          part.length <= 500 &&
          materialPattern.test(part) &&
          (explicitApplicationDocumentPattern.test(part) ||
            /apply|application|bewerb/i.test(part)),
      ),
  ).slice(0, 8);

  const contactSectionPattern =
    /^(?:contact|kontakt|ansprechpartner|联系人|联系方式)\b|(?:contact|kontakt|联系人)\s*:/i;
  const applicationProcessPattern =
    /application process|how to apply|apply (?:by|via|at|online)|application (?:documents?|materials?)|send (?:your|the) application|subject line|single PDF|bewerbungsprozess|bewerben sie sich|bewerbung (?:per|über|an)|bewerbungsunterlagen|申请流程|申请方式|投递方式|发送申请|申请材料/i;
  const privacyPattern =
    /data protection|privacy policy|datenschutz|general data protection regulation|GDPR|数据保护|隐私政策/i;
  const linkedInNoisePattern =
    /try premium|premium career|job search faster with premium|subscribers are .* more likely|free trial|we.?ll remind you|how your profile and resume fit|AI-powered advice|show match details|tailor my resume|help me stand out/i;
  const sourceParagraphs = cleanedText
    .split(/\n+/)
    .map((paragraph) => normalize(paragraph))
    .filter(Boolean);
  const applicationDescriptions = unique(
    sourceParagraphs.filter(
      (paragraph) =>
        !/^(?:application process|how to apply|bewerbungsprozess|bewerbung|申请流程|申请方式)\s*:?\s*$/i.test(
          paragraph,
        ) &&
        (applicationProcessPattern.test(paragraph) ||
          emails.some((email) =>
            paragraph.toLocaleLowerCase().includes(email.toLocaleLowerCase()),
          ) ||
          applicationLinks.some(
            (link) =>
              paragraph.includes(link.label) || paragraph.includes(link.url),
          )),
    ),
  ).slice(0, 8);
  const deadlineContextPattern =
    /deadline|apply by|application by|by\s+(?=\w+\s+\d)|bewerbungsfrist|bis zum|截止|截至/i;
  const applicationDeadline =
    applicationDescriptions
      .find(
        (description) =>
          deadlineContextPattern.test(description) &&
          datePattern.test(description),
      )
      ?.match(datePattern)?.[0] ||
    sourceParagraphs
      .find(
        (paragraph) =>
          deadlineContextPattern.test(paragraph) &&
          datePattern.test(paragraph),
      )
      ?.match(datePattern)?.[0] ||
    '';
  const cleanedParagraphs = sourceParagraphs
    .filter(
      (paragraph) =>
        !materialPattern.test(paragraph) &&
        !applicationProcessPattern.test(paragraph) &&
        !contactSectionPattern.test(paragraph) &&
        !privacyPattern.test(paragraph) &&
        !(isLinkedInJob && linkedInNoisePattern.test(paragraph)) &&
        !emails.some((email) =>
          paragraph.toLocaleLowerCase().includes(email.toLocaleLowerCase()),
        ) &&
        !phones.some((phone) => paragraph.includes(phone)),
    );
  cleanedText = cleanedParagraphs.join('\n\n') || noBody;

  return {
    title: extractedTitle,
    url: window.location.href,
    releaseDate,
    text: cleanedText,
    applicationMaterials,
    contact,
    applicationDeadline,
    applicationMethod: {
      descriptions: applicationDescriptions,
      emails,
      links: applicationLinks,
    },
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('file-read-error'));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number) {
  return `${(bytes / 1024).toFixed(bytes >= 1024 * 1024 ? 0 : 1)} KB`;
}

function isJobSectionHeading(paragraph: string) {
  const normalized = paragraph.trim();
  if (!normalized || normalized.length > 100) return false;
  const words = normalized
    .replace(/[.:]$/, '')
    .split(/\s+/)
    .filter(Boolean);
  const minorWords = /^(?:a|an|and|as|at|but|by|for|from|in|of|on|or|the|to|with)$/i;
  const titleCaseWords = words.filter(
    (word) => minorWords.test(word) || /^[A-ZÄÖÜ0-9$#]/.test(word),
  ).length;
  const looksLikeStandaloneTitle =
    words.length <= 14 &&
    (words.length === 1 || titleCaseWords / words.length >= 0.8) &&
    !/[!?]$/.test(normalized);
  return (
    /^(?:your profile|required qualifications?|additional qualifications?|preferred qualifications?|responsibilities|your tasks|our offer|we offer|what we offer|about (?:the role|you|us)|requirements?|qualifications?|benefits?|aufgaben|ihre aufgaben|dein profil|ihr profil|anforderungen|qualifikationen|wir bieten|unser angebot|was wir bieten|工作职责|岗位职责|你的背景|任职要求|资格要求|加分项|我们提供|岗位要求|职位要求)\s*:?\s*$/i.test(
      normalized,
    ) ||
    (normalized.endsWith(':') && normalized.split(/\s+/).length <= 8) ||
    looksLikeStandaloneTitle
  );
}

function App() {
  const [language, setLanguage] = useState<Language>('zh');
  const t = useMemo(() => getTranslator(language), [language]);
  const [activeView, setActiveView] = useState<
    'page' | 'profile' | 'matching' | 'letter' | 'jobs'
  >('page');
  const [page, setPage] = useState<PageInfo | null>(null);
  const [pageError, setPageError] = useState('');
  const [pageLoading, setPageLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [profileReady, setProfileReady] = useState(false);
  const [profileStatus, setProfileStatus] = useState('');
  const [profileError, setProfileError] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiResult, setAiResult] = useState<AiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [letterType, setLetterType] = useState<'cover' | 'motivation'>('cover');
  const [selectedExperiences, setSelectedExperiences] = useState<string[]>([]);
  const [letter, setLetter] = useState<ApplicationLetter | null>(null);
  const [letterLoading, setLetterLoading] = useState(false);
  const [letterError, setLetterError] = useState('');
  const [copied, setCopied] = useState(false);
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([]);
  const [jobStatus, setJobStatus] = useState('');
  const experienceOptions = useMemo(
    () =>
      aiResult
        ? [
            ...aiResult.cv.experience,
            ...aiResult.cv.education,
            ...aiResult.cv.skills,
          ].filter((item, index, items) => item && items.indexOf(item) === index)
        : [],
    [aiResult],
  );
  const matchResult = useMemo(
    () => (page ? analyzeJob(page.title, page.text, profile) : null),
    [page, profile],
  );

  const loadPage = useCallback(async () => {
    setPageLoading(true);
    setPageError('');

    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab.id) {
        throw new Error(t('noActivePage'));
      }

      const [result] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: readPage,
        args: [t('noTitle'), t('noBody')],
      });

      if (!result?.result) {
        throw new Error(t('noPageContent'));
      }

      setPage(result.result);
    } catch (reason) {
      setPage(null);
      setPageError(
        reason instanceof Error
          ? reason.message
          : t('pageReadFailed'),
      );
    } finally {
      setPageLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    browser.storage.local
      .get([PROFILE_KEY, LANGUAGE_KEY, SAVED_JOBS_KEY])
      .then((result) => {
        const storedProfile = result[PROFILE_KEY] as UserProfile | undefined;
        const storedLanguage = result[LANGUAGE_KEY] as Language | undefined;
        const storedJobs = result[SAVED_JOBS_KEY] as SavedJob[] | undefined;
        if (storedProfile) {
          setProfile({ ...EMPTY_PROFILE, ...storedProfile });
        }
        if (storedLanguage && ['zh', 'en', 'de'].includes(storedLanguage)) {
          setLanguage(storedLanguage);
        }
        if (Array.isArray(storedJobs)) {
          setSavedJobs(storedJobs);
        }
      })
      .catch(() => setProfileError(t('profileReadFailed')))
      .finally(() => setProfileReady(true));
  }, []);

  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    setPageError('');
    setProfileError('');
    setProfileStatus('');
    void browser.storage.local.set({ [LANGUAGE_KEY]: nextLanguage });
  };

  const updateProfile = (
    field: 'background' | 'careerDirection' | 'skillGoals',
    value: string,
  ) => {
    setProfile((current) => ({ ...current, [field]: value }));
    setProfileStatus('');
  };

  const handleCvChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setProfileError('');
    setProfileStatus('');

    if (!file) return;
    if (file.size > MAX_CV_SIZE) {
      setProfileError(t('cvTooLarge'));
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setProfile((current) => ({
        ...current,
        cv: {
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
        },
      }));
    } catch (reason) {
      setProfileError(
        reason instanceof Error && reason.message !== 'file-read-error'
          ? reason.message
          : t('cvReadFailed'),
      );
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    setProfileError('');
    setProfileStatus('');

    try {
      await browser.storage.local.set({ [PROFILE_KEY]: profile });
      setProfileStatus(t('saved'));
    } catch {
      setProfileError(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const runAiAnalysis = async () => {
    setAiError('');
    if (!profile.cv) {
      setAiError(t('aiNeedsCv'));
      return;
    }
    if (!page) {
      setAiError(t('aiNeedsPage'));
      return;
    }

    setAiLoading(true);
    try {
      const result = await requestAiAnalysis({
        language,
        cv: {
          name: profile.cv.name,
          type: profile.cv.type,
          dataUrl: profile.cv.dataUrl,
        },
        job: page,
        profile: {
          background: profile.background,
          careerDirection: profile.careerDirection,
          skillGoals: profile.skillGoals,
        },
      });
      setAiResult(result);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '';
      setAiError(
        message === 'invalid-ai-response'
          ? t('invalidAiResponse')
          : message && !message.toLowerCase().includes('fetch')
            ? message
            : t('aiServerError'),
      );
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (experienceOptions.length > 0 && selectedExperiences.length === 0) {
      setSelectedExperiences(experienceOptions.slice(0, 3));
    }
  }, [experienceOptions, selectedExperiences.length]);

  const generateApplicationLetter = async () => {
    setLetterError('');
    setCopied(false);
    if (!aiResult) {
      setLetterError(t('analysisRequired'));
      return;
    }
    if (selectedExperiences.length === 0) {
      setLetterError(t('selectExperience'));
      return;
    }
    setLetterLoading(true);
    try {
      const generatedLetter = await requestApplicationLetter({
          language,
          type: letterType,
          focusExperiences: selectedExperiences,
          job: aiResult.job,
          match: aiResult.match,
        });
      setLetter(generatedLetter);
      if (page) {
        const nextJobs = savedJobs.map((job) =>
          job.url === page.url
            ? {
                ...job,
                letter: generatedLetter,
                updatedAt: new Date().toISOString(),
              }
            : job,
        );
        if (nextJobs.some((job) => job.url === page.url)) {
          setSavedJobs(nextJobs);
          await browser.storage.local.set({ [SAVED_JOBS_KEY]: nextJobs });
        }
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '';
      setLetterError(
        message === 'invalid-letter-response'
          ? t('letterFormatError')
          : message && !message.toLowerCase().includes('fetch')
            ? message
            : t('aiServerError'),
      );
    } finally {
      setLetterLoading(false);
    }
  };

  const copyLetter = async () => {
    if (!letter) return;
    try {
      await navigator.clipboard.writeText(`${letter.subject}\n\n${letter.body}`);
      setCopied(true);
    } catch {
      setLetterError(t('copyFailed'));
    }
  };

  const persistJobs = async (jobs: SavedJob[]) => {
    setSavedJobs(jobs);
    await browser.storage.local.set({ [SAVED_JOBS_KEY]: jobs });
  };

  const saveCurrentJob = async () => {
    setJobStatus('');
    if (!aiResult || !page) {
      setJobStatus(t('saveAnalysisFirst'));
      return;
    }
    const now = new Date().toISOString();
    const existing = savedJobs.find((job) => job.url === page.url);
    const record: SavedJob = {
      id: existing?.id || crypto.randomUUID(),
      url: page.url,
      title: aiResult.job.title || page.title,
      company: aiResult.job.company,
      status: existing?.status || 'saved',
      deadline: existing?.deadline || '',
      analysis: aiResult,
      letter: letter || existing?.letter || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await persistJobs(
      existing
        ? savedJobs.map((job) => (job.id === existing.id ? record : job))
        : [record, ...savedJobs],
    );
    setJobStatus(t('jobSaved'));
  };

  const updateSavedJob = async (
    id: string,
    patch: Partial<Pick<SavedJob, 'status' | 'deadline'>>,
  ) => {
    await persistJobs(
      savedJobs.map((job) =>
        job.id === id
          ? { ...job, ...patch, updatedAt: new Date().toISOString() }
          : job,
      ),
    );
  };

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">HIWI AI ASSISTANT</p>
          <h1>
            {activeView === 'page'
              ? t('currentPage')
              : activeView === 'profile'
                ? t('userProfile')
                : activeView === 'matching'
                  ? t('matchAnalysis')
                  : activeView === 'letter'
                    ? t('applicationLetter')
                    : t('jobManagement')}
          </h1>
        </div>
        <div className="header-actions">
          <label className="language-picker">
            <span>{t('language')}</span>
            <select
              value={language}
              onChange={(event) =>
                changeLanguage(event.target.value as Language)
              }
              aria-label={t('language')}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
            </select>
          </label>
        </div>
      </header>

      <nav className="tabs" aria-label="Side panel">
        <button
          type="button"
          className={activeView === 'page' ? 'active' : ''}
          onClick={() => setActiveView('page')}
        >
          {t('pageContent')}
        </button>
        <button
          type="button"
          className={activeView === 'profile' ? 'active' : ''}
          onClick={() => setActiveView('profile')}
        >
          {t('userProfile')}
        </button>
        <button
          type="button"
          className={activeView === 'matching' ? 'active' : ''}
          onClick={() => setActiveView('matching')}
        >
          {t('matchAnalysis')}
        </button>
        <button
          type="button"
          className={activeView === 'letter' ? 'active' : ''}
          onClick={() => setActiveView('letter')}
        >
          {t('applicationLetter')}
        </button>
        <button
          type="button"
          className={activeView === 'jobs' ? 'active' : ''}
          onClick={() => setActiveView('jobs')}
        >
          {t('jobManagement')}
        </button>
      </nav>

      {activeView === 'page' ? (
        <>
          <button
            className="save-button page-read-button"
            type="button"
            onClick={() => void loadPage()}
            disabled={pageLoading}
          >
            {pageLoading ? t('loading') : t('readCurrentPage')}
          </button>
          {pageError && <p className="status error">{pageError}</p>}
          {page && (
            <section aria-live="polite">
              <div className="field">
                <h2>{t('title')}</h2>
                <p>{page.title}</p>
              </div>
              <div className="field">
                <h2>URL</h2>
                <a href={page.url} target="_blank" rel="noreferrer">
                  {page.url}
                </a>
              </div>
              <div className="field">
                <h2>{t('releaseDate')}</h2>
                <p>{page.releaseDate || t('notFound')}</p>
              </div>
              <div className="field">
                <h2>{t('applicationDeadline')}</h2>
                <p>{page.applicationDeadline || t('notFound')}</p>
              </div>
              <div className="field content">
                <h2>{t('body')}</h2>
                <div className="job-body">
                  {page.text.split(/\n{2,}/).map((paragraph, index) =>
                    isJobSectionHeading(paragraph) ? (
                      <strong
                        className="job-section-heading"
                        key={`${paragraph}-${index}`}
                      >
                        {paragraph}
                      </strong>
                    ) : (
                      <p key={`${paragraph.slice(0, 40)}-${index}`}>
                        {paragraph}
                      </p>
                    ),
                  )}
                </div>
              </div>
              <div className="field">
                <h2>{t('applicationMaterials')}</h2>
                {page.applicationMaterials.length > 0 ? (
                  <ul className="extracted-list">
                    {page.applicationMaterials.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{t('notFound')}</p>
                )}
              </div>
              <div className="field">
                <h2>{t('contact')}</h2>
                {page.contact.length > 0 ? (
                  <ul className="extracted-list">
                    {page.contact.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{t('notFound')}</p>
                )}
              </div>
              <div className="field">
                <h2>{t('applicationMethod')}</h2>
                {page.applicationMethod.emails.length === 0 &&
                page.applicationMethod.links.length === 0 &&
                page.applicationMethod.descriptions.length === 0 ? (
                  <p>{t('notFound')}</p>
                ) : (
                  <ul className="extracted-list">
                    {page.applicationMethod.descriptions.map((description) => (
                      <li key={description}>{description}</li>
                    ))}
                    {page.applicationMethod.emails.map((email) => (
                      <li key={email}>
                        <a href={`mailto:${email}`}>{email}</a>
                      </li>
                    ))}
                    {page.applicationMethod.links.map((link) => (
                      <li key={link.url}>
                        <a href={link.url} target="_blank" rel="noreferrer">
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
          {!page && pageLoading && (
            <p className="status">{t('readingPage')}</p>
          )}
        </>
      ) : activeView === 'profile' ? (
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveProfile();
          }}
        >
          <div className="field">
            <label htmlFor="cv">{t('cvUpload')}</label>
            <p className="hint">{t('cvHint')}</p>
            <label className="upload-button" htmlFor="cv">
              {profile.cv ? t('replaceCv') : t('selectCv')}
            </label>
            <input
              id="cv"
              className="file-input"
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(event) => void handleCvChange(event)}
            />
            {profile.cv && (
              <div className="file-card">
                <div>
                  <strong>{profile.cv.name}</strong>
                  <span>{formatFileSize(profile.cv.size)}</span>
                </div>
                <button
                  className="text-button danger"
                  type="button"
                  onClick={() => {
                    setProfile((current) => ({ ...current, cv: null }));
                    setProfileStatus('');
                  }}
                >
                  {t('remove')}
                </button>
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="background">{t('background')}</label>
            <textarea
              id="background"
              rows={6}
              placeholder={t('backgroundPlaceholder')}
              value={profile.background}
              onChange={(event) =>
                updateProfile('background', event.target.value)
              }
            />
          </div>

          <div className="field">
            <label htmlFor="career-direction">{t('careerDirection')}</label>
            <input
              id="career-direction"
              type="text"
              list="career-options"
              placeholder={t('careerPlaceholder')}
              value={profile.careerDirection}
              onChange={(event) =>
                updateProfile('careerDirection', event.target.value)
              }
            />
            <datalist id="career-options">
              <option value="AI / Machine Learning Engineer" />
              <option value="Software Engineer" />
              <option value="Data Analyst" />
              <option value="Product Manager" />
              <option value="Academic Research" />
            </datalist>
          </div>

          <div className="field">
            <label htmlFor="skill-goals">{t('skillGoals')}</label>
            <textarea
              id="skill-goals"
              rows={5}
              placeholder={t('skillGoalsPlaceholder')}
              value={profile.skillGoals}
              onChange={(event) =>
                updateProfile('skillGoals', event.target.value)
              }
            />
          </div>

          {profileError && <p className="status error">{profileError}</p>}
          {profileStatus && (
            <p className="status success" role="status">
              {profileStatus}
            </p>
          )}

          <button
            className="save-button"
            type="submit"
            disabled={!profileReady || saving}
          >
            {saving ? t('saving') : t('saveLocal')}
          </button>
        </form>
      ) : activeView === 'matching' ? (
        <section className="matching-view" aria-live="polite">
          <div className="ai-actions">
            <div>
              <h2>{t('aiAnalysis')}</h2>
              <p>OpenAI · GPT-5.6 Luna</p>
            </div>
            <button
              type="button"
              onClick={() => void runAiAnalysis()}
              disabled={aiLoading}
            >
              {aiLoading ? t('aiAnalyzing') : t('runAiAnalysis')}
            </button>
          </div>
          {aiError && <p className="status error">{aiError}</p>}
          {pageError && <p className="status error">{pageError}</p>}
          {aiResult && (
            <div className="ai-result">
              <button
                className="save-button"
                type="button"
                onClick={() => void saveCurrentJob()}
              >
                {t('saveJob')}
              </button>
              {jobStatus && <p className="status success">{jobStatus}</p>}
              <div
                className={`recommendation recommendation-${aiResult.match.recommendation}`}
              >
                <p>{t('recommendationLevel')}</p>
                <strong>
                  {t(
                    {
                      strong: 'stronglyRecommended',
                      recommended: 'recommended',
                      consider: 'consider',
                      low: 'lowMatch',
                    }[aiResult.match.recommendation] as TranslationKey,
                  )}
                </strong>
                <span>
                  {t('overallMatch')} {aiResult.match.overallScore} / 100
                </span>
              </div>

              <div className="score-grid ai-scores">
                {[
                  [t('skillsMatch'), aiResult.match.skillScore],
                  [t('majorsMatch'), aiResult.match.majorScore],
                  [t('growthValue'), aiResult.match.growthScore],
                ].map(([label, score]) => (
                  <article className="score-card" key={label}>
                    <div className="score-heading">
                      <h2>{label}</h2>
                      <strong>{score}</strong>
                    </div>
                    <div className="score-track">
                      <span style={{ width: `${score}%` }} />
                    </div>
                  </article>
                ))}
              </div>

              <article className="field analysis-detail">
                <h2>{t('cvSummary')}</h2>
                <p>{aiResult.cv.summary}</p>
                {[
                  [t('education'), aiResult.cv.education],
                  [t('experience'), aiResult.cv.experience],
                  [t('extractedSkills'), aiResult.cv.skills],
                  [t('languages'), aiResult.cv.languages],
                ].map(([label, items]) => (
                  <div className="detail-group" key={String(label)}>
                    <strong>{label}</strong>
                    <ul>
                      {(items as string[]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </article>

              <article className="field analysis-detail">
                <h2>{t('parsedJob')}</h2>
                <p>
                  <strong>{aiResult.job.title}</strong>
                  {aiResult.job.company ? ` · ${aiResult.job.company}` : ''}
                </p>
                {[
                  [t('responsibilities'), aiResult.job.responsibilities],
                  [t('requiredSkills'), aiResult.job.requiredSkills],
                  [t('preferredMajors'), aiResult.job.preferredMajors],
                  [t('growthSignals'), aiResult.job.growthSignals],
                ].map(([label, items]) => (
                  <div className="detail-group" key={String(label)}>
                    <strong>{label}</strong>
                    <ul>
                      {(items as string[]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </article>

              <article className="field analysis-detail">
                <h2>{t('aiSummary')}</h2>
                <p>{aiResult.match.summary}</p>
                {[
                  [t('strengths'), aiResult.match.strengths],
                  [t('gaps'), aiResult.match.gaps],
                  [t('evidence'), aiResult.match.evidence],
                ].map(([label, items]) => (
                  <div className="detail-group" key={String(label)}>
                    <strong>{label}</strong>
                    <ul>
                      {(items as string[]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </article>
            </div>
          )}
          {!matchResult ? (
            <div className="field empty-analysis">
              <h2>{t('noAnalysis')}</h2>
              <p>{t('noAnalysisHint')}</p>
              <button type="button" onClick={() => void loadPage()}>
                {t('readCurrentPage')}
              </button>
            </div>
          ) : (
            <>
              <h2 className="section-label">{t('localPrototype')}</h2>
              <div
                className={`recommendation recommendation-${matchResult.recommendation}`}
              >
                <p>{t('recommendationLevel')}</p>
                <strong>
                  {t(
                    {
                      strong: 'stronglyRecommended',
                      recommended: 'recommended',
                      consider: 'consider',
                      low: 'lowMatch',
                    }[matchResult.recommendation] as TranslationKey,
                  )}
                </strong>
                <span>
                  {t('overallMatch')} {matchResult.overallScore} / 100
                </span>
              </div>

              <div className="score-grid">
                {[matchResult.skills, matchResult.majors, matchResult.growth].map(
                  (group) => (
                    <article className="score-card" key={group.type}>
                      <div className="score-heading">
                        <h2>
                          {t(
                            {
                              skills: 'skillsMatch',
                              majors: 'majorsMatch',
                              growth: 'growthValue',
                            }[group.type] as TranslationKey,
                          )}
                        </h2>
                        <strong>{group.score}</strong>
                      </div>
                      <div
                        className="score-track"
                        role="progressbar"
                        aria-label={group.type}
                        aria-valuenow={group.score}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span style={{ width: `${group.score}%` }} />
                      </div>
                      <div className="keywords">
                        {group.keywords.length > 0 ? (
                          group.keywords.map((keyword) => (
                            <span className="keyword" key={keyword}>
                              {keyword}
                            </span>
                          ))
                        ) : (
                          <span className="no-keywords">{t('noKeywords')}</span>
                        )}
                      </div>
                    </article>
                  ),
                )}
              </div>

              <p className="prototype-note">
                {t('prototypeNote')}
              </p>
              <button
                className="save-button"
                type="button"
                onClick={() => void loadPage()}
                disabled={pageLoading}
              >
                {pageLoading ? t('analyzing') : t('analyzeAgain')}
              </button>
            </>
          )}
        </section>
      ) : activeView === 'letter' ? (
        <section className="letter-view">
          {!aiResult ? (
            <div className="field empty-analysis">
              <h2>{t('analysisRequired')}</h2>
              <button type="button" onClick={() => setActiveView('matching')}>
                {t('matchAnalysis')}
              </button>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="letter-type">{t('letterType')}</label>
                <select
                  id="letter-type"
                  className="form-select"
                  value={letterType}
                  onChange={(event) =>
                    setLetterType(event.target.value as 'cover' | 'motivation')
                  }
                >
                  <option value="cover">{t('coverLetter')}</option>
                  <option value="motivation">{t('motivationLetter')}</option>
                </select>
              </div>

              <fieldset className="field experience-picker">
                <legend>{t('focusExperience')}</legend>
                <p className="hint">{t('focusHint')}</p>
                {experienceOptions.map((experience) => (
                  <label key={experience}>
                    <input
                      type="checkbox"
                      checked={selectedExperiences.includes(experience)}
                      onChange={(event) =>
                        setSelectedExperiences((current) =>
                          event.target.checked
                            ? [...current, experience]
                            : current.filter((item) => item !== experience),
                        )
                      }
                    />
                    <span>{experience}</span>
                  </label>
                ))}
              </fieldset>

              {letterError && <p className="status error">{letterError}</p>}
              <button
                className="save-button"
                type="button"
                onClick={() => void generateApplicationLetter()}
                disabled={letterLoading}
              >
                {letterLoading ? t('generatingLetter') : t('generateLetter')}
              </button>

              {letter && (
                <div className="letter-editor">
                  <div className="field">
                    <label htmlFor="letter-subject">{t('letterSubject')}</label>
                    <input
                      id="letter-subject"
                      type="text"
                      value={letter.subject}
                      onChange={(event) =>
                        setLetter({ ...letter, subject: event.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="letter-body">{t('letterBody')}</label>
                    <textarea
                      id="letter-body"
                      className="letter-textarea"
                      value={letter.body}
                      onChange={(event) =>
                        setLetter({ ...letter, body: event.target.value })
                      }
                    />
                  </div>
                  <button
                    className="save-button"
                    type="button"
                    onClick={() => void copyLetter()}
                  >
                    {copied ? t('copied') : t('copyText')}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="jobs-view">
          {savedJobs.length === 0 ? (
            <div className="field empty-analysis">
              <h2>{t('noSavedJobs')}</h2>
            </div>
          ) : (
            savedJobs.map((job) => (
              <article className="saved-job-card" key={job.id}>
                <div className="saved-job-heading">
                  <div>
                    <h2>{job.title}</h2>
                    <p>{job.company}</p>
                  </div>
                  <span className={`status-badge status-${job.status}`}>
                    {t(
                      {
                        saved: 'savedStatus',
                        preparing: 'preparingStatus',
                        applied: 'appliedStatus',
                        interview: 'interviewStatus',
                        rejected: 'rejectedStatus',
                        offer: 'offerStatus',
                      }[job.status] as TranslationKey,
                    )}
                  </span>
                </div>

                <div className="job-controls">
                  <label>
                    <span>{t('applicationStatus')}</span>
                    <select
                      className="form-select"
                      value={job.status}
                      onChange={(event) =>
                        void updateSavedJob(job.id, {
                          status: event.target.value as ApplicationStatus,
                        })
                      }
                    >
                      <option value="saved">{t('savedStatus')}</option>
                      <option value="preparing">{t('preparingStatus')}</option>
                      <option value="applied">{t('appliedStatus')}</option>
                      <option value="interview">{t('interviewStatus')}</option>
                      <option value="rejected">{t('rejectedStatus')}</option>
                      <option value="offer">{t('offerStatus')}</option>
                    </select>
                  </label>
                  <label>
                    <span>{t('deadline')}</span>
                    <input
                      type="date"
                      value={job.deadline}
                      onChange={(event) =>
                        void updateSavedJob(job.id, {
                          deadline: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>

                <div className="job-meta">
                  <span>
                    {job.letter
                      ? `✓ ${t('generatedLetter')}`
                      : t('noGeneratedLetter')}
                  </span>
                  <span>
                    {t('savedOn')}{' '}
                    {new Date(job.createdAt).toLocaleDateString(language)}
                  </span>
                </div>

                <div className="job-actions">
                  <a href={job.url} target="_blank" rel="noreferrer">
                    {t('openJob')}
                  </a>
                  <button
                    className="text-button danger"
                    type="button"
                    onClick={() =>
                      void persistJobs(
                        savedJobs.filter((item) => item.id !== job.id),
                      )
                    }
                  >
                    {t('deleteRecord')}
                  </button>
                </div>

                {job.letter && (
                  <details>
                    <summary>{t('generatedLetter')}</summary>
                    <strong>{job.letter.subject}</strong>
                    <pre>{job.letter.body}</pre>
                  </details>
                )}
              </article>
            ))
          )}
        </section>
      )}
    </main>
  );
}

export default App;
