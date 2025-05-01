const { differenceInMonths } = require('date-fns');

const calculateCommission = async (user, customer, team) => {

  const { role } = user;
  const leadSource = customer.lead_source || 'Other';
  const initialScopePrice = customer.initial_scope_price || 0;
  const totalJobPrice = customer.total_job_price || 0;
  const marginAdded = totalJobPrice - initialScopePrice;

  let commission = 0;
  
  switch (role) {
    case 'Affiliate Marketer':
      commission = calculateAffiliateCommission(totalJobPrice);
      break;
    case 'Salesman':
      commission = calculateSalesmanCommission(user, leadSource, initialScopePrice, totalJobPrice, marginAdded);
      break;
    case 'Sales Manager':
      commission = calculateSalesManagerCommission(leadSource, totalJobPrice, team);
      break;
    case 'Supplement Manager':
      commission = calculateSupplementManagerCommission(marginAdded, team, customer.going_to_appraisal);
      break;
    case 'Supplementer':
      commission = calculateSupplementerCommission(marginAdded, customer.going_to_appraisal);
      break;
    default:
      console.log('Unknown role type:', role);
  }

  return commission;
};

const calculateAffiliateCommission = (totalJobPrice) => {
  return Math.min(0.05 * totalJobPrice, 750);
};

const calculateSalesmanCommission = (user, leadSource, initialScopePrice, totalJobPrice, marginAdded) => {
  const tenureMonths = differenceInMonths(new Date(), new Date(user.hire_date || new Date()));
  let inscope = 0, mrgadd = 0;
  
  // For retail jobs (where initialScopePrice is 0), use totalJobPrice instead
  const effectivePrice = initialScopePrice === 0 ? totalJobPrice : initialScopePrice;
  
  // Only calculate margin added if both initialScopePrice and totalJobPrice are non-zero
  if (initialScopePrice > 0 && totalJobPrice > 0) {
    mrgadd = 0.04 * marginAdded;
  }

  // Determine base INSCOPE percentage based on tenure and lead source
  if (tenureMonths <= 6) { // Salesman in Training
    switch(leadSource) {
      case 'Canvassing - Salesman':
        inscope = 0.10 * effectivePrice;
        break;
      case 'Canvassing - Company':
        inscope = (0.08 * effectivePrice) - 300;
        break;
      case 'Affiliate':
        inscope = 0.06 * effectivePrice;
        break;
      case 'Referral':
        inscope = 0.10 * effectivePrice;
        break;
      default:
        inscope = 0.08 * effectivePrice;
    }
  } else if (tenureMonths <= 12) { // Associate Salesman
    switch(leadSource) {
      case 'Canvassing - Salesman':
        inscope = 0.13 * effectivePrice;
        break;
      case 'Canvassing - Company':
        inscope = (0.10 * effectivePrice) - 300;
        break;
      case 'Affiliate':
        inscope = 0.08 * effectivePrice;
        break;
      case 'Referral':
        inscope = 0.10 * effectivePrice;
        break;
      default:
        inscope = 0.10 * effectivePrice;
    }
  } else { // Salesman (1+ year)
    switch(leadSource) {
      case 'Canvassing - Salesman':
        inscope = 0.15 * effectivePrice;
        break;
      case 'Canvassing - Company':
        inscope = (0.12 * effectivePrice) - 300;
        break;
      case 'Affiliate':
        inscope = 0.10 * effectivePrice;
        break;
      case 'Referral':
        inscope = 0.12 * effectivePrice;
        break;
      default:
        inscope = 0.12 * effectivePrice;
    }
  }

  return inscope + mrgadd;
};

const calculateSalesManagerCommission = (leadSource, totalJobPrice, team) => {
  let baseCommission = 0;
  
  // Calculate base commission
  switch(leadSource) {
    case 'Canvassing - Salesman':
    case 'Referral':
      baseCommission = 0.15 * totalJobPrice;
      break;
    case 'Canvassing - Company':
      baseCommission = (0.12 * totalJobPrice) - 300;
      break;
    case 'Affiliate':
      baseCommission = 0.10 * totalJobPrice;
      break;
    default:
      baseCommission = 0.12 * totalJobPrice;
  }

  // Add team override bonuses
  if (team?.members) {
    team.members.forEach(member => {
      const tenureMonths = differenceInMonths(new Date(), new Date(member.hire_date || new Date()));
      if (tenureMonths <= 6) {
        baseCommission += 0.04 * totalJobPrice; // Additional pay over Salesman in Training
      } else if (tenureMonths <= 12) {
        baseCommission += 0.02 * totalJobPrice; // Additional pay over Associate Salesman
      }
    });
  }

  return baseCommission;
};

const calculateSupplementManagerCommission = (marginAdded, team, goingToAppraisal) => {
  // Base commission
  const baseRate = goingToAppraisal ? 0.08 : 0.10;
  let commission = Math.max(baseRate * marginAdded, 500);

  // Manager pay over supplementer
  if (team?.supplementers) {
    const overrideRate = goingToAppraisal ? 0.02 : 0.03;
    team.supplementers.forEach(() => {
      commission += Math.max(overrideRate * marginAdded, 200);
    });
  }

  return commission;
};

const calculateSupplementerCommission = (marginAdded, goingToAppraisal) => {
  const rate = goingToAppraisal ? 0.06 : 0.07;
  return Math.max(rate * marginAdded, 300);
};

module.exports = { calculateCommission };