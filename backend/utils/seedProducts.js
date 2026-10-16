// Startup seed/backfill: idempotent default product catalog, user account
// number backfill, and settings rebrand migration. Runs once after MongoDB
// connects; never overwrites existing admin edits.
const crypto = require('crypto');
const User = require('../models/User');
const Settings = require('../models/Settings');
const InvestmentPlan = require('../models/InvestmentPlan');
const LoanPlan = require('../models/LoanPlan');
const CardProduct = require('../models/CardProduct');

// 10-digit account number with no leading zero; retry on collision
function randomAccountNumber() {
  return crypto.randomInt(1000000000, 10000000000).toString();
}

async function generateUniqueAccountNumber() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = randomAccountNumber();
    const exists = await User.findOne({ accountNumber: candidate }).select('_id').lean();
    if (!exists) return candidate;
  }
  throw new Error('Could not generate a unique account number');
}

const DEFAULT_INVESTMENT_PLANS = [
  {
    name: 'Starter Growth',
    ROI: 10,
    durationDays: 30,
    minAmount: 100,
    maxAmount: 4999,
    description: 'Conservative short-term growth for new investors. Steady, predictable returns over 30 days.',
    isActive: true
  },
  {
    name: 'Balanced Yield',
    ROI: 17,
    durationDays: 90,
    minAmount: 5000,
    maxAmount: 24999,
    description: 'A balanced medium-term plan blending stability with meaningful returns.',
    isActive: true
  },
  {
    name: 'Wealth Builder',
    ROI: 27,
    durationDays: 180,
    minAmount: 25000,
    maxAmount: 100000,
    description: 'Long-horizon compounding for serious wealth building over six months.',
    isActive: true
  },
  {
    name: 'Premium Horizon',
    ROI: 42,
    durationDays: 365,
    minAmount: 100000,
    maxAmount: 500000,
    description: 'Our premier one-year plan for high-net-worth clients seeking maximum returns.',
    isActive: true
  }
];

const DEFAULT_LOAN_PLANS = [
  {
    name: 'Personal Loan',
    interestRate: 9.9,
    durationMonths: 12,
    minAmount: 500,
    maxAmount: 25000,
    isActive: true
  },
  {
    name: 'Auto Loan',
    interestRate: 7.5,
    durationMonths: 36,
    minAmount: 2000,
    maxAmount: 75000,
    isActive: true
  },
  {
    name: 'Home Improvement',
    interestRate: 6.9,
    durationMonths: 60,
    minAmount: 5000,
    maxAmount: 150000,
    isActive: true
  },
  {
    name: 'Business Boost',
    interestRate: 11.9,
    durationMonths: 24,
    minAmount: 1000,
    maxAmount: 100000,
    isActive: true
  }
];

const DEFAULT_CARD_PRODUCTS = [
  {
    name: 'BrightVale Debit',
    type: 'virtual',
    annualFee: 0,
    perks: ['No annual fee', 'Instant virtual issuance', 'Worldwide acceptance'],
    isActive: true
  },
  {
    name: 'BrightVale Gold',
    type: 'physical',
    annualFee: 49,
    perks: ['1.5% cashback on purchases', 'Travel assistance', 'Purchase protection'],
    isActive: true
  },
  {
    name: 'BrightVale Platinum',
    type: 'physical',
    annualFee: 199,
    perks: ['3% cashback on dining & travel', 'Airport lounge access', 'Priority support'],
    isActive: true
  }
];

async function seedCollection(Model, defaults, label) {
  const count = await Model.countDocuments();
  if (count === 0) {
    await Model.insertMany(defaults);
    console.log(`Seeded ${defaults.length} default ${label}.`);
  } else {
    console.log(`${label} already present (${count} documents) — skipping seed.`);
  }
}

// Backfill account numbers for users created before the field existed.
// Claim each number atomically so concurrent startups can't collide.
async function backfillAccountNumbers() {
  const missing = await User.find({
    $or: [{ accountNumber: { $exists: false } }, { accountNumber: null }]
  }).select('_id');

  let backfilled = 0;
  for (const user of missing) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = randomAccountNumber();
      const claim = await User.updateOne(
        { _id: user._id, $or: [{ accountNumber: { $exists: false } }, { accountNumber: null }] },
        { $set: { accountNumber: candidate } }
      );
      if (claim.modifiedCount === 1) {
        backfilled++;
        break;
      }
      // Someone else assigned it first — retry with a fresh number
      const current = await User.findById(user._id).select('accountNumber').lean();
      if (current && current.accountNumber) break;
    }
  }
  if (backfilled > 0) {
    console.log(`Backfilled account numbers for ${backfilled} user(s).`);
  } else {
    console.log('Account number backfill: all users already have one.');
  }
}

// Rebrand migration: update legacy CrestCoin branding in the Settings doc only.
// The old brand may appear with different capitalization or spacing, so match it
// case-insensitively and convert the values to the BrightVale defaults.
async function migrateSettingsBranding() {
  const settings = await Settings.findOne();
  if (!settings) return;

  const legacyBrandPattern = /crestcoin/i;
  let changed = false;

  if (typeof settings.siteName === 'string' && legacyBrandPattern.test(settings.siteName)) {
    settings.siteName = 'BrightVale Finance';
    changed = true;
  }

  if (typeof settings.supportEmail === 'string' && legacyBrandPattern.test(settings.supportEmail)) {
    settings.supportEmail = 'support@brightvale.finance';
    changed = true;
  }

  // Legacy welcome notification copy still references the old brand
  if (typeof settings.welcomeNotificationTitle === 'string' && legacyBrandPattern.test(settings.welcomeNotificationTitle)) {
    settings.welcomeNotificationTitle = 'Welcome to BrightVale Finance!';
    changed = true;
  }
  if (typeof settings.welcomeNotificationMessage === 'string' && legacyBrandPattern.test(settings.welcomeNotificationMessage)) {
    settings.welcomeNotificationMessage = 'Thank you for joining BrightVale Finance. Start your investment journey today!';
    changed = true;
  }

  if (changed) {
    await settings.save();
    console.log('Settings rebranded: siteName/supportEmail migrated from legacy CrestCoin branding to BrightVale Finance.');
  }
}

// One-time rate refresh: bump the default plans from the previous rate card
// to the current one (idempotent — only touches plans still on old defaults).
async function refreshDefaultPlanRates() {
  const rateCard = [
    { name: 'Starter Growth', from: 8, to: 10 },
    { name: 'Balanced Yield', from: 15, to: 17 },
    { name: 'Wealth Builder', from: 25, to: 27 },
    { name: 'Premium Horizon', from: 40, to: 42 }
  ];
  for (const plan of rateCard) {
    const res = await InvestmentPlan.updateOne(
      { name: plan.name, ROI: plan.from },
      { $set: { ROI: plan.to } }
    );
    if (res.modifiedCount === 1) {
      console.log(`Investment plan "${plan.name}" ROI updated ${plan.from}% -> ${plan.to}%.`);
    }
  }
}

async function seedDefaults() {
  try {
    await seedCollection(InvestmentPlan, DEFAULT_INVESTMENT_PLANS, 'investment plans');
    await seedCollection(LoanPlan, DEFAULT_LOAN_PLANS, 'loan plans');
    await seedCollection(CardProduct, DEFAULT_CARD_PRODUCTS, 'card products');
    await refreshDefaultPlanRates();
    await backfillAccountNumbers();
    await migrateSettingsBranding();
  } catch (error) {
    console.error('Startup seed/backfill failed:', error);
  }
}

module.exports = { seedDefaults, generateUniqueAccountNumber };