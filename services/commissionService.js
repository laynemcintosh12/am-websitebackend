const { differenceInMonths } = require('date-fns');
const { getHistoricalTeamDataForCommission } = require('../models/teamModel');

const calculateCommission = async (user, customer, team = null, useHistoricalData = true) => {
  const { role } = user;
  const leadSource = customer.lead_source || 'Other';
  const initialScopePrice = customer.initial_scope_price || 0;
  const totalJobPrice = customer.total_job_price || 0;
  const marginAdded = totalJobPrice - initialScopePrice;

  const customerCreationDate = customer.jn_date_added || customer.created_at;
  const userHireDate = user.hire_date ? new Date(user.hire_date) : null;

  let effectiveTeam = team;
  let customerCreatedBeforeHire = false;

  if (customerCreationDate && userHireDate) {
    const creationDate = new Date(customerCreationDate);
    customerCreatedBeforeHire = creationDate < userHireDate;
  }

  const isExplicitlyAssignedToJob = (
    customer.salesman_id === user.id ||
    customer.supplementer_id === user.id ||
    customer.manager_id === user.id ||
    customer.supplement_manager_id === user.id
  );

  const skipOverrideDueToTiming = customerCreatedBeforeHire && !isExplicitlyAssignedToJob;

  if (useHistoricalData && customerCreationDate) {
    try {
      const historicalTeam = await getHistoricalTeamDataForCommission(user.id, customerCreationDate);
      if (historicalTeam) {
        effectiveTeam = historicalTeam;
      } else {
        effectiveTeam = null;
      }
    } catch (error) {
      effectiveTeam = team;
    }
  }

  let commission = 0;

  switch (role) {
    case 'Affiliate Marketer':
      commission = calculateAffiliateCommission(totalJobPrice);
      break;
    case 'Salesman':
      commission = calculateSalesmanCommission(user, leadSource, initialScopePrice, totalJobPrice, marginAdded, customerCreationDate);
      break;
    case 'Sales Manager':
      commission = calculateSalesManagerCommission(user, customer, leadSource, totalJobPrice, effectiveTeam, skipOverrideDueToTiming);
      break;
    case 'Supplement Manager':
      commission = calculateSupplementManagerCommission(user, customer, marginAdded, effectiveTeam, customer.going_to_appraisal, skipOverrideDueToTiming);
      break;
    case 'Supplementer':
      commission = calculateSupplementerCommission(marginAdded, customer.going_to_appraisal);
      break;
    default:
      commission = 0;
  }

  return commission;
};

const calculateAffiliateCommission = (totalJobPrice) => {
  return Math.min(0.05 * totalJobPrice, 750);
};

const calculateSalesmanCommission = (user, leadSource, initialScopePrice, totalJobPrice, marginAdded, customerCreationDate) => {
  const effectiveDate = customerCreationDate ? new Date(customerCreationDate) : new Date();
  const hireDate = user.hire_date ? new Date(user.hire_date) : effectiveDate;
  const tenureMonths = differenceInMonths(effectiveDate, hireDate);

  let inscope = 0, mrgadd = 0;
  const effectivePrice = initialScopePrice === 0 ? totalJobPrice : initialScopePrice;
  if (initialScopePrice > 0 && totalJobPrice > 0) {
    mrgadd = 0.04 * marginAdded;
  }

  if (tenureMonths <= 6) {
    switch(leadSource) {
      case 'Canvassing - Salesman': inscope = 0.10 * effectivePrice; break;
      case 'Canvassing - Company': inscope = (0.08 * effectivePrice) - 300; break;
      case 'Affiliate': inscope = 0.06 * effectivePrice; break;
      case 'Referral': inscope = 0.10 * effectivePrice; break;
      default: inscope = 0.08 * effectivePrice;
    }
  } else if (tenureMonths <= 12) {
    switch(leadSource) {
      case 'Canvassing - Salesman': inscope = 0.13 * effectivePrice; break;
      case 'Canvassing - Company': inscope = (0.10 * effectivePrice) - 300; break;
      case 'Affiliate': inscope = 0.08 * effectivePrice; break;
      case 'Referral': inscope = 0.10 * effectivePrice; break;
      default: inscope = 0.10 * effectivePrice;
    }
  } else {
    switch(leadSource) {
      case 'Canvassing - Salesman': inscope = 0.15 * effectivePrice; break;
      case 'Canvassing - Company': inscope = (0.12 * effectivePrice) - 300; break;
      case 'Affiliate': inscope = 0.10 * effectivePrice; break;
      case 'Referral': inscope = 0.12 * effectivePrice; break;
      default: inscope = 0.12 * effectivePrice;
    }
  }

  return inscope + mrgadd;
};

const calculateSalesManagerCommission = (user, customer, leadSource, totalJobPrice, team, skipOverride) => {
  if (skipOverride) return 0;

  const isManagerWorkingJob = customer.salesman_id === user.id;
  if (isManagerWorkingJob) {
    switch(leadSource) {
      case 'Canvassing - Salesman':
      case 'Referral': return 0.15 * totalJobPrice;
      case 'Canvassing - Company': return (0.12 * totalJobPrice) - 300;
      case 'Affiliate': return 0.10 * totalJobPrice;
      default: return 0.12 * totalJobPrice;
    }
  } else {
    if (!team || !team.team_members) return 0;

    const teamMember = team.team_members.find(member =>
      member.user_id === customer.salesman_id &&
      member.joined_at <= customer.created_at &&
      (!member.left_at || member.left_at > customer.created_at)
    );

    if (!teamMember) return 0;

    const memberHireDate = teamMember.hire_date ? new Date(teamMember.hire_date) : new Date(customer.created_at);
    const tenureMonths = differenceInMonths(new Date(customer.created_at), memberHireDate);

    if (tenureMonths <= 6) return 0.04 * totalJobPrice;
    if (tenureMonths <= 12) return 0.02 * totalJobPrice;
    return 0.03 * totalJobPrice;
  }
};

const calculateSupplementManagerCommission = (user, customer, marginAdded, team, goingToAppraisal, skipOverride) => {
  if (skipOverride) return 0;

  const isManagerWorkingJob = customer.supplementer_id === user.id;
  if (isManagerWorkingJob) {
    const rate = goingToAppraisal ? 0.08 : 0.10;
    return Math.max(rate * marginAdded, 500);
  } else {
    if (!team || !team.team_members) return 0;

    const teamMember = team.team_members.find(member =>
      member.user_id === customer.supplementer_id &&
      member.joined_at <= customer.created_at &&
      (!member.left_at || member.left_at > customer.created_at)
    );

    if (!teamMember) return 0;

    const rate = goingToAppraisal ? 0.02 : 0.03;
    return Math.max(rate * marginAdded, 200);
  }
};

const calculateSupplementerCommission = (marginAdded, goingToAppraisal) => {
  const rate = goingToAppraisal ? 0.06 : 0.07;
  return Math.max(rate * marginAdded, 300);
};

module.exports = { calculateCommission };
