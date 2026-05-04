import {
  type CoachFakeData,
} from './budgetCoachFakeReader.js';
import {
  makeCategory,
  makeGroup,
  makeScheduled,
  makeTransaction,
} from './budgetCoachFakeReader.js';
import type { CoachMonth } from '../budget-coach/reader.js';

export const COACH_BUDGET_ID = 'budget-coach-1';

export function makeCoachFixtureData(): CoachFakeData {
  // Categories shared across months
  const groceries = makeCategory('cat-groceries', 'group-everyday', 'Groceries');
  const fun = makeCategory('cat-fun', 'group-everyday', 'Fun Stuff');
  const dining = makeCategory('cat-dining', 'group-everyday', 'Dining Out');

  const mortgage = makeCategory('cat-mortgage', 'group-obligations', 'Mortgage');
  const daycare = makeCategory('cat-daycare', 'group-obligations', 'Daycare');
  const phone = makeCategory('cat-phone', 'group-obligations', 'Phone / Tech');

  const homeMaint = makeCategory('cat-home-maint', 'group-true', 'Home Maintenance');
  const travel = makeCategory('cat-travel', 'group-true', 'Travel');
  const carMaint = makeCategory('cat-car-maint', 'group-true', 'Car Maintenance');

  const emergency = makeCategory('cat-emergency', 'group-savings', 'Emergency Fund');
  const ira = makeCategory('cat-ira', 'group-savings', 'IRA');

  const jamesPersonal = makeCategory('cat-james', 'group-discretionary', 'James');
  const business = makeCategory('cat-business', 'group-discretionary', 'Business Expenses');

  const ccPayment = makeCategory('cat-cc-amazon', 'group-cc', 'Amazon Card Payment');
  const inflow = makeCategory('cat-inflow', 'group-inflow', 'Inflow: Ready to Assign');

  const groups = [
    makeGroup('group-everyday', 'Everyday Spending', [groceries, fun, dining]),
    makeGroup('group-obligations', 'Hard Obligations', [mortgage, daycare, phone]),
    makeGroup('group-true', 'True Expenses', [homeMaint, travel, carMaint]),
    makeGroup('group-savings', 'Savings Goals', [emergency, ira]),
    makeGroup('group-discretionary', 'Discretionary', [jamesPersonal, business]),
    makeGroup('group-cc', 'Credit Card Payments', [ccPayment]),
    makeGroup('group-inflow', 'Internal Master Category', [inflow]),
  ];

  // ---- May 2026 month ----
  const mayCategories = [
    { ...groceries, budgeted: 600_000, activity: -450_000, balance: 150_000 },
    { ...fun, budgeted: 100_000, activity: -180_000, balance: -80_000 },
    { ...dining, budgeted: 100_000, activity: -120_000, balance: -20_000 },
    { ...mortgage, budgeted: 1_500_000, activity: -2_500_000, balance: -1_000_000, goal_type: 'TB', goal_target: 2_500_000, goal_under_funded: 1_000_000 },
    { ...daycare, budgeted: 800_000, activity: -1_200_000, balance: -400_000, goal_type: 'TB', goal_target: 1_200_000, goal_under_funded: 400_000 },
    { ...phone, budgeted: 50_000, activity: -75_000, balance: -25_000, goal_type: 'TB', goal_target: 75_000, goal_under_funded: 25_000 },
    { ...homeMaint, budgeted: 100_000, activity: 0, balance: 250_000 },
    { ...travel, budgeted: 200_000, activity: -300_000, balance: -100_000, goal_type: 'TBD', goal_target: 1_000_000, goal_target_month: '2026-12-01', goal_under_funded: 800_000 },
    { ...carMaint, budgeted: 50_000, activity: 0, balance: 400_000 },
    { ...emergency, budgeted: 500_000, activity: 0, balance: 5_000_000, goal_type: 'TB', goal_target: 10_000_000, goal_under_funded: 5_000_000 },
    { ...ira, budgeted: 0, activity: 0, balance: 0, goal_type: 'NEED', goal_target: 600_000, goal_under_funded: 600_000 },
    { ...jamesPersonal, budgeted: 100_000, activity: -40_000, balance: 60_000 },
    { ...business, budgeted: 100_000, activity: -150_000, balance: -50_000 },
    { ...ccPayment, budgeted: 0, activity: 0, balance: -200_000 },
    { ...inflow, budgeted: 0, activity: 0, balance: 0 },
  ];

  const mayMonth: CoachMonth = {
    month: '2026-05-01',
    income: 6_000_000,
    budgeted: 4_100_000,
    activity: -5_015_000,
    to_be_budgeted: 350_000,
    age_of_money: 30,
    categories: mayCategories,
  };

  // ---- April 2026 month ----
  const aprCategories = [
    { ...groceries, budgeted: 600_000, activity: -550_000, balance: 50_000 },
    { ...fun, budgeted: 100_000, activity: -90_000, balance: 10_000 },
    { ...dining, budgeted: 100_000, activity: -110_000, balance: -10_000 },
    { ...mortgage, budgeted: 2_500_000, activity: -2_500_000, balance: 0, goal_type: 'TB', goal_target: 2_500_000, goal_under_funded: 0 },
    { ...daycare, budgeted: 1_200_000, activity: -1_200_000, balance: 0, goal_type: 'TB', goal_target: 1_200_000, goal_under_funded: 0 },
    { ...phone, budgeted: 75_000, activity: -75_000, balance: 0 },
    { ...homeMaint, budgeted: 100_000, activity: 0, balance: 250_000 },
    { ...travel, budgeted: 200_000, activity: 0, balance: -100_000 },
    { ...carMaint, budgeted: 50_000, activity: 0, balance: 400_000 },
    { ...emergency, budgeted: 500_000, activity: 0, balance: 5_000_000 },
    { ...ira, budgeted: 600_000, activity: -600_000, balance: 0 },
    { ...jamesPersonal, budgeted: 100_000, activity: -100_000, balance: 0 },
    { ...business, budgeted: 100_000, activity: -110_000, balance: -10_000 },
    { ...ccPayment, budgeted: 0, activity: 0, balance: -50_000 },
    { ...inflow, budgeted: 0, activity: 0, balance: 0 },
  ];

  const aprMonth: CoachMonth = {
    month: '2026-04-01',
    income: 6_000_000,
    budgeted: 6_125_000,
    activity: -5_335_000,
    to_be_budgeted: 0,
    age_of_money: 28,
    categories: aprCategories,
  };

  // ---- Mar 2026 month (clean) ----
  const marMonth: CoachMonth = {
    month: '2026-03-01',
    income: 6_000_000,
    budgeted: 6_000_000,
    activity: -5_000_000,
    to_be_budgeted: 0,
    age_of_money: 25,
    categories: aprCategories.map((c) => ({ ...c, balance: c.balance >= 0 ? c.balance : 0 })),
  };

  // ---- Transactions ----
  const transactions = [
    // Repeated grocery payee — should yield high-confidence suggestion
    makeTransaction('tx-grocery-historic-1', {
      date: '2026-04-05', amount: -45_000,
      payee_id: 'payee-grocer', payee_name: 'Local Grocer',
      category_id: 'cat-groceries', category_name: 'Groceries', approved: true,
    }),
    makeTransaction('tx-grocery-historic-2', {
      date: '2026-04-12', amount: -52_000,
      payee_id: 'payee-grocer', payee_name: 'Local Grocer',
      category_id: 'cat-groceries', category_name: 'Groceries', approved: true,
    }),
    makeTransaction('tx-grocery-historic-3', {
      date: '2026-04-19', amount: -38_000,
      payee_id: 'payee-grocer', payee_name: 'Local Grocer',
      category_id: 'cat-groceries', category_name: 'Groceries', approved: true,
    }),
    // Uncategorized grocery (should get high confidence)
    makeTransaction('tx-grocery-needs-cat', {
      date: '2026-05-02', amount: -42_000,
      payee_id: 'payee-grocer', payee_name: 'Local Grocer',
      category_id: null, category_name: null, approved: false,
    }),
    // Brand-new payee with import name only (no history) — keyword-driven medium
    makeTransaction('tx-shell-gas', {
      date: '2026-05-01', amount: -55_000,
      payee_id: null, payee_name: 'SHELL OIL', import_payee_name: 'SHELL OIL 12345',
      category_id: null, category_name: null, approved: false,
    }),
    // Ambiguous merchant
    makeTransaction('tx-ambig', {
      date: '2026-05-03', amount: -25_000,
      payee_id: null, payee_name: 'Random Store',
      category_id: null, category_name: null, approved: false,
    }),
    // Already categorized + approved — should not appear in queue or suggestions
    makeTransaction('tx-clean', {
      date: '2026-05-04', amount: -30_000,
      payee_id: 'payee-grocer', payee_name: 'Local Grocer',
      category_id: 'cat-groceries', category_name: 'Groceries', approved: true,
    }),
    // Transfer — should be excluded everywhere
    makeTransaction('tx-transfer', {
      date: '2026-05-04', amount: -100_000,
      payee_id: null, payee_name: 'Transfer : Visa',
      transfer_account_id: 'acct-credit',
      category_id: null, category_name: null, approved: true,
    }),
    // Income — should not appear in queue/suggestions
    makeTransaction('tx-paycheck', {
      date: '2026-04-28', amount: 2_500_000,
      payee_id: 'payee-employer', payee_name: 'Employer Inc',
      category_id: 'cat-inflow', category_name: 'Inflow: Ready to Assign', approved: true,
    }),
    // Large notable transaction in May
    makeTransaction('tx-vet-bill', {
      date: '2026-05-02', amount: -425_000,
      payee_id: 'payee-vet', payee_name: 'Pet Hospital',
      category_id: null, category_name: null, approved: false,
    }),
    // Recurring in May (would-be subscription)
    makeTransaction('tx-netflix-1', {
      date: '2026-05-01', amount: -15_990,
      payee_id: null, payee_name: 'Netflix',
      category_id: null, category_name: null, approved: false,
    }),
    makeTransaction('tx-netflix-2', {
      date: '2026-05-08', amount: -15_990,
      payee_id: null, payee_name: 'Netflix',
      category_id: null, category_name: null, approved: false,
    }),
    // Amazon historic categorizations (mixed-merchant: history alone shouldn't be enough to auto-apply)
    makeTransaction('tx-amazon-historic-1', {
      date: '2026-04-04', amount: -28_500,
      payee_id: 'payee-amazon', payee_name: 'Amazon.com',
      category_id: 'cat-james', category_name: 'James', approved: true,
    }),
    makeTransaction('tx-amazon-historic-2', {
      date: '2026-04-11', amount: -41_200,
      payee_id: 'payee-amazon', payee_name: 'Amazon.com',
      category_id: 'cat-james', category_name: 'James', approved: true,
    }),
    makeTransaction('tx-amazon-historic-3', {
      date: '2026-04-18', amount: -16_700,
      payee_id: 'payee-amazon', payee_name: 'Amazon.com',
      category_id: 'cat-james', category_name: 'James', approved: true,
    }),
    // New Amazon charge — payee history would push to "high" but item-level evidence is required.
    makeTransaction('tx-amazon-needs-cat', {
      date: '2026-05-03', amount: -22_300,
      payee_id: 'payee-amazon', payee_name: 'Amazon.com',
      import_payee_name: 'AMAZON.COM*RX9YZ',
      category_id: null, category_name: null, approved: false,
    }),
  ];

  const scheduled = [
    makeScheduled('sched-mortgage', {
      date_next: '2026-05-15', amount: -2_500_000,
      payee_id: 'payee-bank', payee_name: 'Mortgage Co.',
      category_id: 'cat-mortgage', category_name: 'Mortgage',
    }),
    makeScheduled('sched-daycare', {
      date_next: '2026-05-05', amount: -1_200_000,
      payee_id: 'payee-daycare', payee_name: 'Sunny Daycare',
      category_id: 'cat-daycare', category_name: 'Daycare',
    }),
    makeScheduled('sched-future', {
      date_next: '2026-08-01', amount: -100_000,
      payee_id: 'payee-x', payee_name: 'Some Future Bill',
      category_id: 'cat-phone', category_name: 'Phone / Tech',
    }),
  ];

  const accounts = [
    {
      id: 'acct-checking', name: 'Checking', type: 'checking', on_budget: true,
      closed: false, balance: 1_000_000, cleared_balance: 1_000_000, uncleared_balance: 0, deleted: false,
    },
    {
      id: 'acct-credit', name: 'Visa', type: 'creditCard', on_budget: true,
      closed: false, balance: -200_000, cleared_balance: -200_000, uncleared_balance: 0, deleted: false,
    },
  ];

  const payees = [
    { id: 'payee-grocer', name: 'Local Grocer', transfer_account_id: null, deleted: false },
    { id: 'payee-employer', name: 'Employer Inc', transfer_account_id: null, deleted: false },
    { id: 'payee-vet', name: 'Pet Hospital', transfer_account_id: null, deleted: false },
    { id: 'payee-bank', name: 'Mortgage Co.', transfer_account_id: null, deleted: false },
    { id: 'payee-daycare', name: 'Sunny Daycare', transfer_account_id: null, deleted: false },
    { id: 'payee-x', name: 'Some Future Bill', transfer_account_id: null, deleted: false },
    { id: 'payee-amazon', name: 'Amazon.com', transfer_account_id: null, deleted: false },
  ];

  return {
    budgetId: COACH_BUDGET_ID,
    monthsByMonth: {
      '2026-05': mayMonth,
      '2026-04': aprMonth,
      '2026-03': marMonth,
    },
    categories: groups,
    transactions,
    scheduled,
    accounts,
    payees,
  };
}
