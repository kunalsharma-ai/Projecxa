import { Question } from './questions';
import { questionTemplates } from './questions';

/**
 * Ready-made gate survey question sets per audience (docs/GATE_QUESTION_SETS.md).
 * An executive adds a whole set to a project in one click and then edits, removes or adds questions.
 * An organisation can also change a set itself (Gate & security → Question sets → Save as set), and
 * its version is offered from then on; "Reset" brings back the version below.
 */

export const AUDIENCES = ['b2b', 'b2c', 'parents', 'teens', 'hc_consumer', 'hc_patient', 'hc_caregiver'] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface QuestionSet {
  key: string;
  name: string;
  description: string;
  questions: Question[];
}

type Opt = { id: string; label: string; action: 'accept' | 'qualify' | 'terminate'; exclusive?: boolean };
const o = (id: string, label: string, action: Opt['action'] = 'accept', exclusive?: boolean): Opt => (exclusive ? { id, label, action, exclusive } : { id, label, action });
const q = (x: Omit<Question, 'required' | 'validation'> & Partial<Pick<Question, 'required' | 'validation'>>): Question => ({ required: true, validation: {}, ...x }) as Question;

const age = (min = 18, max?: number) =>
  q({ id: 'age', type: 'number', text: 'How old are you?', validation: { min: 1, max: 120, integer: true }, qualify: max === undefined ? { min } : { min, max } });
const gender = q({ id: 'gender', type: 'single', text: 'What is your gender?', options: [o('male', 'Male'), o('female', 'Female'), o('nonbinary', 'Non-binary or another gender'), o('na', 'Prefer not to say')] });
const insurance = q({
  id: 'insurance',
  type: 'single',
  text: 'How is most of your healthcare paid for?',
  options: [o('private', 'Private or employer health insurance'), o('public', 'Government or public health plan'), o('both', 'Both private and public'), o('self', 'I pay myself, no insurance'), o('na', 'Prefer not to say')],
});
const CONDITIONS = [
  o('diabetes', 'Diabetes'),
  o('heart', 'Heart disease or high blood pressure'),
  o('respiratory', 'Asthma, COPD or another breathing condition'),
  o('cancer', 'Cancer'),
  o('arthritis', 'Arthritis or chronic pain'),
  o('mental', 'Depression, anxiety or another mental health condition'),
  o('neuro', "Alzheimer's, dementia, Parkinson's or another neurological condition"),
  o('autoimmune', 'An autoimmune condition (e.g. lupus, MS, psoriasis)'),
  o('obesity', 'Obesity or weight management'),
  o('other', 'Another long-term condition'),
];

function sets(currency: string): QuestionSet[] {
  const library = Object.fromEntries(questionTemplates(currency).map((t) => [t.question.id, t.question]));
  const { income, employment, education, postal } = library as Record<string, Question>;
  return [
    {
      key: 'b2b',
      name: 'B2B (business decision makers)',
      description: 'Working professionals: job level, department, company size, industry and their role in buying decisions.',
      questions: [
        q({
          id: 'employment',
          type: 'single',
          text: 'Which best describes your current employment?',
          options: [o('full_time', 'Employed full-time', 'qualify'), o('part_time', 'Employed part-time', 'qualify'), o('self_employed', 'Self-employed or business owner', 'qualify'), o('not_working', 'Not working', 'terminate'), o('student', 'Student', 'terminate'), o('retired', 'Retired', 'terminate')],
        }),
        q({
          id: 'job_level',
          type: 'single',
          text: 'Which best describes your job level?',
          options: [o('owner', 'Owner, partner or C-level'), o('vp', 'Vice president or director'), o('manager', 'Manager or team lead'), o('professional', 'Professional or specialist (no reports)'), o('entry', 'Entry level, assistant or intern'), o('other', 'Other')],
        }),
        q({
          id: 'department',
          type: 'dropdown',
          text: 'Which department do you mainly work in?',
          options: [o('exec', 'General management'), o('it', 'IT or technology'), o('finance', 'Finance or accounting'), o('hr', 'Human resources'), o('marketing', 'Marketing'), o('sales', 'Sales or business development'), o('operations', 'Operations or supply chain'), o('procurement', 'Procurement or purchasing'), o('legal', 'Legal or compliance'), o('rnd', 'Research, engineering or product'), o('customer', 'Customer service'), o('other', 'Other')],
        }),
        q({
          id: 'company_size',
          type: 'single',
          text: 'How many people work at your organisation, across all locations?',
          options: [o('1', 'Just me'), o('2_9', '2 to 9'), o('10_49', '10 to 49'), o('50_249', '50 to 249'), o('250_999', '250 to 999'), o('1000_4999', '1,000 to 4,999'), o('5000', '5,000 or more'), o('dk', "I don't know")],
        }),
        q({
          id: 'industry',
          type: 'dropdown',
          text: 'Which industry is your organisation in?',
          options: [o('tech', 'Technology or software'), o('finance', 'Banking, finance or insurance'), o('health', 'Healthcare or pharmaceuticals'), o('manufacturing', 'Manufacturing'), o('retail', 'Retail or e-commerce'), o('professional', 'Professional services or consulting'), o('education', 'Education'), o('government', 'Government or public sector'), o('telecom', 'Telecommunications or media'), o('energy', 'Energy or utilities'), o('construction', 'Construction or real estate'), o('transport', 'Transport or logistics'), o('hospitality', 'Hospitality or travel'), o('agriculture', 'Agriculture'), o('nonprofit', 'Non-profit'), o('other', 'Other')],
        }),
        q({
          id: 'decision_role',
          type: 'single',
          text: 'What is your role in buying products or services for your organisation?',
          options: [o('final', 'I make the final decision', 'qualify'), o('influence', 'I strongly influence the decision', 'qualify'), o('recommend', 'I recommend or evaluate options', 'qualify'), o('none', 'I am not involved', 'terminate')],
        }),
      ],
    },
    {
      key: 'b2c',
      name: 'B2C (general consumers)',
      description: 'Adults 18+: age, gender, location, household, income, employment and education.',
      questions: [
        age(18),
        gender,
        postal,
        q({ id: 'household_size', type: 'single', text: 'How many people live in your household, including you?', options: [o('1', '1'), o('2', '2'), o('3', '3'), o('4', '4'), o('5', '5 or more')] }),
        income,
        employment,
        education,
      ],
    },
    {
      key: 'parents',
      name: 'Parents',
      description: 'Parents or guardians of children under 18: number and ages of children and their say in household purchases.',
      questions: [
        age(18),
        gender,
        q({
          id: 'parent',
          type: 'single',
          text: 'Are you a parent or legal guardian of a child under 18 who lives with you?',
          options: [o('yes', 'Yes', 'qualify'), o('yes_away', 'Yes, but the child does not live with me', 'qualify'), o('no', 'No', 'terminate')],
        }),
        q({ id: 'children_count', type: 'number', text: 'How many children under 18 live in your household?', validation: { min: 0, max: 15, integer: true }, qualify: { min: 1 } }),
        q({
          id: 'children_ages',
          type: 'multi',
          text: 'How old are the children in your household? Choose all that apply.',
          options: [o('0_1', 'Under 2'), o('2_5', '2 to 5'), o('6_9', '6 to 9'), o('10_12', '10 to 12'), o('13_15', '13 to 15'), o('16_17', '16 to 17')],
          validation: { minSelect: 1 },
        }),
        q({
          id: 'purchase_role',
          type: 'single',
          text: 'Who mainly decides what to buy for the children in your household?',
          options: [o('me', 'Mainly me'), o('shared', 'Me and another adult equally'), o('other', 'Mainly another adult')],
        }),
        income,
      ],
    },
    {
      key: 'teens',
      name: 'Teens (13 to 17)',
      description: 'Teenagers with parent or guardian permission: age, gender, school year and the devices they use.',
      questions: [
        q({
          id: 'guardian_consent',
          type: 'single',
          text: 'If you are under 18, has a parent or guardian said you can take part in this survey?',
          help: 'Many countries require a parent or guardian to agree before a young person takes part in research.',
          options: [o('yes', 'Yes, a parent or guardian agreed', 'qualify'), o('no', 'No', 'terminate')],
        }),
        age(13, 17),
        gender,
        q({
          id: 'school_year',
          type: 'single',
          text: 'Which best describes where you are at school?',
          options: [o('middle', 'Middle school or junior secondary'), o('high', 'High school or senior secondary'), o('college', 'College, university or other training'), o('not_studying', 'Not studying at the moment')],
        }),
        q({
          id: 'devices',
          type: 'multi',
          text: 'Which of these do you use at least once a week? Choose all that apply.',
          options: [o('phone', 'My own smartphone'), o('tablet', 'Tablet'), o('computer', 'Laptop or desktop computer'), o('console', 'Games console'), o('none', 'None of these', 'accept', true)],
          validation: { minSelect: 1 },
        }),
        q({ id: 'region', type: 'text', text: 'Which city or town do you live in?', validation: { format: 'letters', maxLength: 60 } }),
      ],
    },
    {
      key: 'hc_consumer',
      name: 'Healthcare: consumers',
      description: 'Adults about their health in general: health cover, how they rate their health, conditions, doctor visits and over-the-counter purchases.',
      questions: [
        age(18),
        gender,
        insurance,
        q({ id: 'health_rating', type: 'single', text: 'In general, how would you rate your health?', options: [o('excellent', 'Excellent'), o('very_good', 'Very good'), o('good', 'Good'), o('fair', 'Fair'), o('poor', 'Poor')] }),
        q({
          id: 'conditions',
          type: 'multi',
          text: 'Has a doctor ever told you that you have any of these? Choose all that apply.',
          options: [...CONDITIONS, o('none', 'None of these', 'accept', true), o('na', 'Prefer not to say', 'accept', true)],
          validation: { minSelect: 1 },
        }),
        q({ id: 'doctor_visits', type: 'single', text: 'How many times have you seen a doctor in the past 12 months?', options: [o('0', 'None'), o('1_2', '1 or 2 times'), o('3_5', '3 to 5 times'), o('6', '6 times or more')] }),
        q({
          id: 'otc',
          type: 'multi',
          text: 'Which of these have you bought for yourself in the past 6 months? Choose all that apply.',
          options: [o('pain', 'Pain relief'), o('cold', 'Cold, flu or allergy medicine'), o('vitamins', 'Vitamins or supplements'), o('digestive', 'Digestive health products'), o('skin', 'Skin care treatments'), o('none', 'None of these', 'accept', true)],
          validation: { minSelect: 1 },
        }),
      ],
    },
    {
      key: 'hc_patient',
      name: 'Healthcare: patients',
      description: 'People diagnosed with a condition: the condition, when they were diagnosed, current treatment and who treats them.',
      questions: [
        age(18),
        gender,
        q({
          id: 'diagnosis',
          type: 'multi',
          text: 'Which of these conditions have you been diagnosed with by a doctor? Choose all that apply.',
          help: 'Change the list to the condition your study is about, and mark that answer as "qualify".',
          options: [...CONDITIONS, o('none', 'None of these', 'terminate', true)],
          validation: { minSelect: 1 },
        }),
        q({ id: 'diagnosed_when', type: 'single', text: 'When were you first diagnosed?', options: [o('lt1', 'Less than 1 year ago'), o('1_2', '1 to 2 years ago'), o('3_5', '3 to 5 years ago'), o('6_10', '6 to 10 years ago'), o('gt10', 'More than 10 years ago')] }),
        q({
          id: 'treatment',
          type: 'single',
          text: 'Are you currently being treated for this condition?',
          options: [o('prescription', 'Yes, with prescription medicine'), o('other', 'Yes, with another treatment (therapy, surgery, devices)'), o('monitoring', 'No, my doctor is only monitoring it'), o('none', 'No treatment')],
        }),
        q({
          id: 'treated_by',
          type: 'single',
          text: 'Who mainly treats you for this condition?',
          options: [o('gp', 'A family doctor or general practitioner'), o('specialist', 'A specialist doctor'), o('nurse', 'A nurse or nurse practitioner'), o('hospital', 'A hospital clinic'), o('none', 'Nobody at the moment')],
        }),
        insurance,
      ],
    },
    {
      key: 'hc_caregiver',
      name: 'Healthcare: caregivers',
      description: 'Unpaid caregivers of a family member or friend: who they care for, the condition, hours per week and how long.',
      questions: [
        age(18),
        gender,
        q({
          id: 'caregiver',
          type: 'single',
          text: 'Do you regularly look after a family member or friend because of their health, without being paid for it?',
          options: [o('yes', 'Yes', 'qualify'), o('paid', 'Yes, but it is my paid job', 'terminate'), o('no', 'No', 'terminate')],
        }),
        q({
          id: 'care_for',
          type: 'single',
          text: 'Who do you mainly care for?',
          options: [o('parent', 'A parent or parent-in-law'), o('partner', 'My spouse or partner'), o('child', 'My child'), o('relative', 'Another relative'), o('friend', 'A friend or neighbour')],
        }),
        q({
          id: 'care_condition',
          type: 'multi',
          text: 'Which conditions does the person you care for have? Choose all that apply.',
          options: [...CONDITIONS, o('frailty', 'Frailty or old age'), o('disability', 'A physical or learning disability'), o('na', 'Prefer not to say', 'accept', true)],
          validation: { minSelect: 1 },
        }),
        q({ id: 'care_hours', type: 'single', text: 'About how many hours a week do you spend caring for them?', options: [o('lt5', 'Less than 5 hours'), o('5_9', '5 to 9 hours'), o('10_19', '10 to 19 hours'), o('20_39', '20 to 39 hours'), o('40', '40 hours or more')] }),
        q({ id: 'care_length', type: 'single', text: 'How long have you been caring for them?', options: [o('lt6m', 'Less than 6 months'), o('6_12m', '6 to 12 months'), o('1_2', '1 to 2 years'), o('3_5', '3 to 5 years'), o('gt5', 'More than 5 years')] }),
        q({ id: 'live_together', type: 'single', text: 'Does the person you care for live with you?', options: [o('yes', 'Yes'), o('no', 'No')] }),
      ],
    },
  ];
}

/** The built-in sets, with income bands in the project's currency. */
export function builtInQuestionSets(currency = 'USD'): QuestionSet[] {
  return sets(currency);
}
