/**
 * Customer Controller
 * Handles business logic for customer operations
 * Manages JobNimbus sync and commission processing
 */

const { getAllCustomers, searchCustomersByQuery, 
  getCustomerById, deleteCustomer, upsertCustomer: modelUpsertCustomer } = require('../models/customerModel');
const { fetchJobNimbusData } = require('../services/jobNimbusService');
const { getUserByName, getUserById } = require('../models/userModel');
const { getTeamByUserIdFromDb } = require('../models/teamModel');
const CommissionModel = require('../models/commissionModel');
const { calculateCommission } = require('../services/commissionService');
const logger = require('../utils/logger');
const { sendErrorNotification } = require('../utils/email');
const db = require('../config/db');
const { formatToUnixTimestamp } = require('../utils/dateUtils'); // You'll need to create this
const axios = require('axios');

/**
* Syncs customer data from JobNimbus API
* Processes each customer and updates commission records
* Logs errors without stopping the sync process
*/
const syncCustomers = async (req, res, next = () => {}) => {
try {
logger.info('Starting customer sync process...');

const jobNimbusData = await fetchJobNimbusData();
if (!Array.isArray(jobNimbusData.results)) {
throw new Error('JobNimbus data is not in the expected format.');
}

const processedCustomers = [];
const errors = [];

for (const job of jobNimbusData.results) {
try {
  // Process the customer data
  const customer = await processJobNimbusCustomer(job);
  const upsertedCustomer = await modelUpsertCustomer(customer);
  processedCustomers.push(upsertedCustomer);

  // Handle commission processing for finalized customers
  if (upsertedCustomer.status === 'Finalized') {
    await processCustomerCommissions(upsertedCustomer, errors);
  }
} catch (jobError) {
  logger.error(`Error processing job: ${jobError.message}`);
  errors.push({
    type: 'job',
    jobData: job,
    error: jobError.message
  });
}
}

logger.info(`Sync completed. Processed ${processedCustomers.length} customers. ${errors.length} errors.`);
return res.status(errors.length > 0 ? 207 : 200).json({
message: 'Sync completed',
customersProcessed: processedCustomers.length,
errors: errors.length > 0 ? errors : undefined
});

} catch (error) {
logger.error('Sync failed:', error);
next(error);
}
};

/**
* Processes JobNimbus customer data into database format
* Maps API fields to database columns
* Resolves user associations
*/
const processJobNimbusCustomer = async (job) => {
  // Get user details
  const salesman = job['sales_rep_name'] ? await getUserByName(job['sales_rep_name']) : null;
  const supplementer = job['Supplementer Assigned'] ? await getUserByName(job['Supplementer Assigned']) : null;
  const referrer = job.source_name === 'Affiliate' && job['Affiliate Name'] 
    ? await getUserByName(job['Affiliate Name']) 
    : null;

  // Get manager IDs with validation
  let managerId = null;
  let supplementManagerId = null;

  if (salesman) {
    const salesTeam = await getTeamByUserIdFromDb(salesman.id);
    // Only assign manager if it's different from the salesman
    if (salesTeam && salesTeam.manager_id !== salesman.id) {
      managerId = salesTeam.manager_id;
    }
  }

  if (supplementer) {
    const supplementTeam = await getTeamByUserIdFromDb(supplementer.id);
    // Only assign supplement manager if it's different from the supplementer
    if (supplementTeam && supplementTeam.manager_id !== supplementer.id) {
      supplementManagerId = supplementTeam.manager_id;
    }
  }

  return {
    name: job.name,
    address: job.address_line1,
    phone: job.parent_mobile_phone,
    salesman_id: salesman?.id || null,
    supplementer_id: supplementer?.id || null,
    manager_id: managerId, // Using validated manager ID
    supplement_manager_id: supplementManagerId, // Using validated supplement manager ID
    status: job.status_name,
    initial_scope_price: job['Initial Scope Price'],
    total_job_price: job['Final Job Price'],
    lead_source: job.source_name,
    referrer_id: referrer?.id || null,
    build_date: job['Build Date'] ? new Date(job['Build Date'] * 1000) : null,
  };
};

/**
* Helper function to get manager ID for a user
*/
const getManagerIdForUser = async (userId) => {
try {
const team = await getTeamByUserIdFromDb(userId);
return team ? team.manager_id : null;
} catch (error) {
logger.error(`Error getting manager ID for user ${userId}:`, error);
return null;
}
};

/**
* Processes commission records for finalized customers
* Calculates commission for each role type
* Updates commission records in database
* @param {Object} customer - Finalized customer record
* @param {Array} errors - Array to collect processing errors
*/
const processCustomerCommissions = async (customer, errors) => {
  try {
    const buildDate = customer.build_date || new Date();
    const userCommissions = [];

    // Process all possible roles that could get commission
    const userRoles = [
      { id: customer.salesman_id, role: 'Salesman' },
      { id: customer.supplementer_id, role: 'Supplementer' },
      { id: customer.manager_id, role: 'Sales Manager' },
      { id: customer.supplement_manager_id, role: 'Supplement Manager' },
      { id: customer.referrer_id, role: 'Affiliate Marketer' }
    ].filter(role => role.id);

    // Get all existing commissions for this customer
    const existingCommissions = await CommissionModel.checkExistingCommissions(customer.id);
    const existingCommissionsMap = existingCommissions.reduce((map, commission) => {
      map[commission.user_id] = commission;
      return map;
    }, {});

    // Process each user's commission
    for (const { id, role } of userRoles) {
      try {
        const user = await getUserById(id);
        if (!user) {
          throw new Error(`User ${id} not found`);
        }

        let team = null;
        if (role.includes('Manager')) {
          team = await getTeamByUserIdFromDb(id);
        }

        const commissionAmount = await calculateCommission(user, customer, team);
        
        if (commissionAmount > 0) {
          if (existingCommissionsMap[id]) {
            // Update existing commission
            await CommissionModel.updateCommissionDue(
              existingCommissionsMap[id].id,
              {
                commission_amount: commissionAmount,
                build_date: buildDate
              }
            );
          } else {
            // Create new commission
            await CommissionModel.addCommissionDue({
              user_id: id,
              customer_id: customer.id,
              commission_amount: commissionAmount,
              build_date: buildDate
            });
          }

          userCommissions.push({
            userId: id,
            userName: user.name,
            userRole: role,
            amount: commissionAmount
          });

          // Calculate total commissions for this user from all finalized customers
          const result = await db.query(
            `SELECT SUM(commission_amount) as total_earned
             FROM commissions_due cd
             JOIN customers c ON cd.customer_id = c.id
             WHERE cd.user_id = $1
             AND c.status = 'Finalized'`,
            [id]
          );

          const totalEarned = parseFloat(result.rows[0].total_earned) || 0;

          // Get total payments received
          const paymentsResult = await db.query(
            `SELECT SUM(amount) as total_paid
             FROM payments
             WHERE user_id = $1`,
            [id]
          );

          const totalPaid = parseFloat(paymentsResult.rows[0].total_paid) || 0;

          // Update or create user balance record
          await db.query(
            `INSERT INTO user_balance 
             (user_id, total_commissions_earned, total_payments_received, current_balance, last_updated)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id)
             DO UPDATE SET
               total_commissions_earned = $2,
               total_payments_received = $3,
               current_balance = $4,
               last_updated = CURRENT_TIMESTAMP`,
            [id, totalEarned, totalPaid, totalEarned - totalPaid]
          );
        }
      } catch (userError) {
        logger.error(`Error processing commission for user ${id}:`, userError);
        errors.push({
          type: 'user_commission',
          userId: id,
          customerId: customer.id,
          error: userError.message
        });
      }
    }

    return userCommissions;
  } catch (error) {
    logger.error(`Error processing commissions for customer ${customer.id}:`, error);
    throw error;
  }
};

/**
* Helper function to process commission for a single user
*/
const processUserCommission = async (userId, customer, buildDate, userCommissions, errors) => {
try {
// Get user and team data
const user = await getUserById(userId);
if (!user) {
throw new Error(`User with ID ${userId} not found`);
}

const team = await getTeamByUserIdFromDb(userId);

// Calculate commission based on user role and customer details
const commissionAmount = await calculateCommission(user, customer, team);

if (commissionAmount <= 0) {
logger.info(`Zero or negative commission calculated for user ${userId} on customer ${customer.id}. Skipping.`);
return;
}

// Add commission to database
const newCommission = await CommissionModel.addCommissionDue({
user_id: userId,
customer_id: customer.id,
commission_amount: commissionAmount,
build_date: buildDate
});

// Update user balance
await updateUserBalance(userId, commissionAmount);

userCommissions.push({
userId,
userName: user.name,
userRole: user.role,
amount: commissionAmount
});

logger.info(`Commission of $${commissionAmount} added for user ${user.name} (${user.role}) on customer ${customer.name}`);

} catch (error) {
logger.error(`Error processing commission for user ${userId} on customer ${customer.id}:`, error);
errors.push({
type: 'user_commission',
userId,
customerId: customer.id,
error: error.message
});
}
};

/**
* Helper function to update user balance when adding commission
*/
const updateUserBalance = async (userId, commissionAmount) => {
try {
// Check if user balance exists
const balance = await CommissionModel.getUserBalance(userId);

// Update balance with new commission amount
await db.query(
`UPDATE user_balance 
 SET total_commissions_earned = total_commissions_earned + $1,
     current_balance = current_balance + $1,
     last_updated = CURRENT_TIMESTAMP
 WHERE user_id = $2`,
[commissionAmount, userId]
);

return true;
} catch (error) {
logger.error(`Error updating user balance for user ${userId}:`, error);
throw error;
}
};

/**
* Helper function to check if commissions already exist for a customer
*/
const checkExistingCommissions = async (customerId) => {
try {
const result = await db.query(
`SELECT * FROM commissions_due WHERE customer_id = $1`,
[customerId]
);
return result.rows;
} catch (error) {
logger.error(`Error checking existing commissions for customer ${customerId}:`, error);
throw error;
}
};

/**
* Send email notification for new commissions
*/
const sendCommissionNotification = async (customer, commissions) => {
try {
// This assumes you have an email service set up
// Implementation depends on your email service
if (typeof sendErrorNotification === 'function') {
await sendErrorNotification({
  subject: `New Commissions Ready - ${customer.name}`,
  message: `New commissions have been calculated for customer ${customer.name}. 
            Total commissions: ${commissions.reduce((sum, c) => sum + c.amount, 0).toFixed(2)}. 
            Please review and process payments.`
});
}
} catch (error) {
logger.error('Error sending commission notification:', error);
throw error;
}
};

/**
* Returns all customers with related data
* Used for customer list views and reports
*/
const getCustomers = async (req, res, next) => {
try {
const customers = await getAllCustomers();
res.status(200).json(customers);
} catch (error) {
next(error);
}
};

/**
* Searches customers based on query string
* Filters by user association
* Returns limited results for performance
*/
const searchCustomers = async (req, res, next) => {
try {
const { q: query, userId } = req.query;

if (!query || !userId) {
return res.status(400).json({ 
  error: 'Search query and user ID are required' 
});
}

if (query.length < 2) {
return res.json([]);  // Return empty results for very short queries
}

const customers = await searchCustomersByQuery(query, userId);
res.status(200).json(customers);
} catch (error) {
next(error);
}
};

/**
* Retrieves detailed customer record by ID
* Used for customer detail views
*/
const getCustomer = async (req, res, next) => {
try {
const { customerId } = req.params;
const customer = await getCustomerById(customerId);

if (!customer) {
return res.status(404).json({ error: 'Customer not found' });
}

res.status(200).json(customer);
} catch (error) {
next(error);
}
};

/**
* Removes customer and related records
* Maintains database integrity
*/
const deleteCustomerController = async (req, res, next) => {
try {
const { customerId } = req.params;
const deletedCustomer = await deleteCustomer(customerId);

if (!deletedCustomer) {
return res.status(404).json({ error: 'Customer not found' });
}

res.status(200).json({ message: 'Customer deleted successfully', deletedCustomer });
} catch (error) {
next(error);
}
};

/**
* Manual process to recalculate commissions for a customer
* Used by admin users to force commission updates
*/
const recalculateCustomerCommissions = async (req, res, next) => {
try {
const { customerId } = req.params;

// Check if user is authorized
if (req.user.role !== 'owner' && req.user.role !== 'admin') {
return res.status(403).json({ error: 'Unauthorized. Only admin or owner can recalculate commissions.' });
}

// Get customer data
const customer = await getCustomerById(customerId);
if (!customer) {
return res.status(404).json({ error: 'Customer not found' });
}

// Only process if status is Finalized
if (customer.status !== 'Finalized') {
return res.status(400).json({ 
  error: 'Customer status must be Finalized to calculate commissions.',
  customer: customer
});
}

// Delete existing commissions for this customer
await db.query('DELETE FROM commissions_due WHERE customer_id = $1', [customerId]);

// Process new commissions
const errors = [];
await processCustomerCommissions(customer, errors);

if (errors.length > 0) {
return res.status(207).json({
  message: 'Commissions recalculated with some errors',
  customer: customer,
  errors: errors
});
}

// Get updated commissions
const commissions = await db.query(
`SELECT cd.*, u.name as user_name, u.role 
 FROM commissions_due cd
 JOIN users u ON cd.user_id = u.id
 WHERE cd.customer_id = $1`,
[customerId]
);

res.status(200).json({
message: 'Commissions recalculated successfully',
customer: customer,
commissions: commissions.rows
});

} catch (error) {
logger.error(`Error recalculating commissions for customer ${req.params.customerId}:`, error);
next(error);
}
};

/**
 * Adds a customer to JobNimbus and creates associated task
 * Handles the full flow of customer creation and task assignment
 */
const addCustomerToJobNimbus = async (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      email,
      address,
      city,
      state,
      zip,
      leadSource,
      referrer,
      description
    } = req.body;

    // Log incoming request
    logger.info('Adding customer to JobNimbus:', { 
      firstName, lastName, email, leadSource 
    });

    // Format data according to JobNimbus requirements
    const customerData = {
      first_name: firstName,
      last_name: lastName,
      mobile_phone: phone,
      email: email,
      address_line1: address,
      city: city,
      state_text: state,
      zip: zip,
      record_type_name: "Customer",
      status_name: "New",
      source_name: leadSource,
      "Who Referred?": referrer || null,
      description: description || null,
      is_lead: true,
      country_name: "United States"
    };

    // Add customer to JobNimbus
    const customerResponse = await axios({
      method: 'post',
      url: 'https://app.jobnimbus.com/api1/contacts',
      headers: {
        'Authorization': `Bearer ${process.env.JOBNIMBUSTOKEN}`,
        'Content-Type': 'application/json'
      },
      data: customerData
    });

    // Send success response
    res.status(201).json({
      message: 'Customer added successfully',
      customer: customerResponse.data
    });

  } catch (error) {
    logger.error('Error adding customer to JobNimbus:', error.response?.data || error.message);
    next(error);
  }
};

module.exports = { 
syncCustomers, 
getCustomers, 
searchCustomers, 
getCustomer, 
deleteCustomerController,
recalculateCustomerCommissions,
addCustomerToJobNimbus
};