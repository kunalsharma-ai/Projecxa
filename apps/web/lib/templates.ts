/** A saved project setup (Projects › Templates). */
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
  type: string;
  category: string;
  clientId: string | null;
  countries: string[];
  include: { client: boolean; surveyLinks: boolean; quotas: boolean; vendors: boolean };
  gateQuestions: number;
  prescreen: number;
  quotaCells: number;
  vendorLinks: number;
  redirectRules: number;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  createdBy: string | null;
}

type Num = number | undefined;
export interface TemplateCountry { countryCode: string; language: string; currency: string; targetGroup?: string; loiMinutes?: Num; irPercent?: Num; cpi?: Num; targetCompletes?: Num; liveSurveyUrl?: string; testSurveyUrl?: string }
export interface TemplateForm {
  type: string;
  category: string;
  clientId: string | null;
  description: string | null;
  devices: Record<string, boolean>;
  security: Record<string, boolean>;
  redirectMode: string;
  defaults: Omit<TemplateCountry, 'countryCode' | 'language' | 'currency'>;
  countries: TemplateCountry[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One sentence on what a template copies beyond the form. */
export function describeTemplate(t: ProjectTemplate) {
  const parts = [
    t.gateQuestions && plural(t.gateQuestions, 'gate question'),
    t.prescreen && plural(t.prescreen, 'prescreener question'),
    t.quotaCells && plural(t.quotaCells, 'quota cell'),
    t.vendorLinks && plural(t.vendorLinks, 'vendor link'),
    t.redirectRules && plural(t.redirectRules, 'redirect rule'),
  ].filter(Boolean) as string[];
  const copies = parts.length ? `${parts.join(', ')}, the respondent page design and autopilot are copied when you create the project.` : 'The respondent page design and autopilot are copied when you create the project.';
  return `${copies} New vendor entry links are made; counts start at zero.`;
}
