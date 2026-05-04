import type { CoachCategory, CoachCategoryGroup } from './reader.js';

export type CategoryJob =
  | 'hard_obligation'
  | 'everyday'
  | 'true_expense'
  | 'savings_goal'
  | 'discretionary'
  | 'inflow'
  | 'credit_card_payment'
  | 'unknown';

const HARD_OBLIGATION_HINTS = [
  'mortgage',
  'rent',
  'daycare',
  'utilities',
  'utility',
  'electric',
  'gas bill',
  'water',
  'internet',
  'phone',
  'cell',
  'insurance',
  'car payment',
  'auto loan',
  'subscription',
  'subscriptions',
  'tuition',
  'student loan',
  'loan payment',
  'hoa',
];

const EVERYDAY_HINTS = [
  'grocer',
  'groceries',
  'food',
  'gas',
  'fuel',
  'fun',
  'dining',
  'restaurant',
  'eating out',
  'personal care',
  'household',
  'transportation',
  'spending money',
];

const TRUE_EXPENSE_HINTS = [
  'true expense',
  'sinking',
  'maintenance',
  'home maintenance',
  'auto maintenance',
  'car maintenance',
  'gift',
  'gifts',
  'pet',
  'travel',
  'vacation',
  'medical',
  'dentist',
  'doctor',
  'taxes',
  'tax',
  'annual',
  'irregular',
  'birthday',
  'christmas',
  'holiday',
];

const SAVINGS_HINTS = [
  'emergency',
  'savings',
  'hsa',
  'ira',
  'roth',
  '401k',
  '529',
  'brokerage',
  'taxable',
  'investment',
  'goal',
  'down payment',
  'fund',
];

const DISCRETIONARY_HINTS = [
  'james',
  'angie',
  'sloan',
  'family fun',
  'business',
  'personal',
  'allowance',
  'hobby',
];

const INFLOW_HINTS = [
  'inflow',
  'ready to assign',
];

const CC_PAYMENT_GROUP_HINTS = [
  'credit card payment',
  'credit card payments',
];

function lower(s?: string | null): string {
  return (s ?? '').toLowerCase();
}

function matches(haystack: string, hints: string[]): boolean {
  return hints.some((h) => haystack.includes(h));
}

export function classifyCategory(
  category: CoachCategory,
  group?: CoachCategoryGroup | null
): CategoryJob {
  const groupName = lower(group?.name ?? category.category_group_name);
  const catName = lower(category.name);
  const combined = `${groupName} ${catName}`;

  if (matches(catName, INFLOW_HINTS) || matches(groupName, INFLOW_HINTS)) {
    return 'inflow';
  }
  if (matches(groupName, CC_PAYMENT_GROUP_HINTS)) {
    return 'credit_card_payment';
  }
  if (matches(combined, HARD_OBLIGATION_HINTS)) return 'hard_obligation';
  if (matches(combined, TRUE_EXPENSE_HINTS)) return 'true_expense';
  if (matches(combined, SAVINGS_HINTS)) return 'savings_goal';
  if (matches(combined, EVERYDAY_HINTS)) return 'everyday';
  if (matches(combined, DISCRETIONARY_HINTS)) return 'discretionary';
  return 'unknown';
}

export function buildGroupIndex(
  groups: CoachCategoryGroup[]
): Map<string, CoachCategoryGroup> {
  const idx = new Map<string, CoachCategoryGroup>();
  for (const g of groups) idx.set(g.id, g);
  return idx;
}
