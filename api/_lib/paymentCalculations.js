// Payment calculation utilities for Omnya Portal

const BASE_VIDEO_PAY = 10.00;
const BONUS_ELIGIBILITY_DAYS = 10;
const WITHDRAWAL_COOLDOWN_DAYS = 14;
const MIN_WITHDRAWAL_AMOUNT = 0;

const BONUS_TIERS = [
  { minViews: 10000000, bonus: 1000, label: '10M+ views' },
  { minViews: 1000000,  bonus: 500,  label: '1M views'   },
  { minViews: 500000,   bonus: 350,  label: '500K views' },
  { minViews: 250000,   bonus: 250,  label: '250K views' },
  { minViews: 100000,   bonus: 150,  label: '100K views' },
  { minViews: 50000,    bonus: 50,   label: '50K views'  },
];

function calculateBasePay() {
  return 10.00;
}

function getBonusTier(views) {
  for (const tier of BONUS_TIERS) {
    if (views >= tier.minViews) {
      return tier;
    }
  }
  return null;
}

function calculateBonusByViews(views) {
  const tier = getBonusTier(views);
  return tier ? tier.bonus : 0;
}

function isBonusEligible(postedAt) {
  if (!postedAt) return false;
  const postedDate = new Date(postedAt);
  const eligibilityMs = BONUS_ELIGIBILITY_DAYS * 24 * 60 * 60 * 1000;
  return (Date.now() - postedDate.getTime()) >= eligibilityMs;
}

function getDaysUntilBonusEligible(postedAt) {
  if (!postedAt) return BONUS_ELIGIBILITY_DAYS;
  const postedDate = new Date(postedAt);
  const msElapsed = Date.now() - postedDate.getTime();
  const daysElapsed = msElapsed / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(BONUS_ELIGIBILITY_DAYS - daysElapsed));
}

function canRequestWithdrawal(lastActiveRequestDate) {
  if (lastActiveRequestDate === null || lastActiveRequestDate === undefined) return true;
  const lastDate = new Date(lastActiveRequestDate);
  const cooldownMs = WITHDRAWAL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return (Date.now() - lastDate.getTime()) >= cooldownMs;
}

function getNextWithdrawalDate(lastActiveRequestDate) {
  if (lastActiveRequestDate === null || lastActiveRequestDate === undefined) return null;
  const lastDate = new Date(lastActiveRequestDate);
  const cooldownMs = WITHDRAWAL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return new Date(lastDate.getTime() + cooldownMs);
}

function getAvailableBalance(earnings) {
  if (!Array.isArray(earnings)) return 0;
  return earnings
    .filter((e) => e.status === 'approved')
    .reduce((sum, e) => sum + parseFloat(e.amount), 0);
}

function maskEmail(email) {
  if (!email) return '';
  const atIndex = email.indexOf('@');
  if (atIndex < 1) return email;
  const firstChar = email.charAt(0);
  const domain = email.slice(atIndex);
  return `${firstChar}***${domain}`;
}

function formatPayoutDestination(creator) {
  if (!creator) return 'No payout method on file';

  const method = creator.payout_method;

  if (method === 'zelle') {
    const dest = creator.zelle_destination;
    if (!dest) return 'Zelle (no destination on file)';
    // Mask if it looks like an email, otherwise show last 4 digits
    if (dest.includes('@')) {
      return `Zelle: ${maskEmail(dest)}`;
    }
    const last4 = dest.slice(-4);
    return `Zelle: ***-***-${last4}`;
  }

  if (method === 'bank_transfer') {
    const accountNum = creator.bank_account_number;
    if (!accountNum) return 'Bank Transfer (no account on file)';
    const last4 = String(accountNum).slice(-4);
    return `Bank Transfer: ****${last4}`;
  }

  return 'No payout method on file';
}

module.exports = {
  BASE_VIDEO_PAY,
  BONUS_ELIGIBILITY_DAYS,
  WITHDRAWAL_COOLDOWN_DAYS,
  MIN_WITHDRAWAL_AMOUNT,
  BONUS_TIERS,
  calculateBasePay,
  getBonusTier,
  calculateBonusByViews,
  isBonusEligible,
  getDaysUntilBonusEligible,
  canRequestWithdrawal,
  getNextWithdrawalDate,
  getAvailableBalance,
  maskEmail,
  formatPayoutDestination,
};
