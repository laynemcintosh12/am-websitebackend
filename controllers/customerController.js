/**
 * OPTIMIZED Customer Controller
 * Major performance improvements:
 * 1. Bulk data fetching upfront
 * 2. Database transactions for batches
 * 3. Parallel processing where safe
 * 4. Reduced database round trips
 * 5. Efficient caching strategy
 */

const { getAllCustomers, searchCustomersByQuery, 
  getCustomerById, deleteCustomer, bulkUpsertCustomers: modelBulkUpsert } = require('../models/customerModel');
const { fetchJobNimbusData } = require('../services/jobNimbusService');
const { getUserByName, getUserById, getAllUsers } = require('../models/userModel'); // Add getAllUsers
const { getTeamByUserIdFromDb, getAllTeams } = require('../models/teamModel'); // Add getAllTeams
const CommissionModel = require('../models/commissionModel');
const { calculateCommission } = require('../services/commissionService');
const logger = require('../utils/logger');
const { sendErrorNotification } = require('../utils/email');
const db = require('../config/db');
const { formatToUnixTimestamp } = require('../utils/dateUtils');
const axios = require('axios');
const { updateUserBalanceOnCommissionChange } = require('./commissionController');

// Cache for frequently accessed data
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutes

/**
 * OPTIMIZED sync function with major performance improvements
 */
const syncCustomers = async (req, res, next = () => {}) => {
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    logger.info('Starting optimized customer sync process...');
    
    // 1. BULK FETCH ALL REFERENCE DATA UPFRONT WITH CACHING
    const cacheKey = 'reference_data';
    let referenceData = cache.get(cacheKey);
    
    if (!referenceData || Date.now() - referenceData.timestamp > CACHE_TTL) {
      const [jobNimbusData, allUsers, allTeams, existingCustomers] = await Promise.all([
        fetchJobNimbusData(),
        getAllUsers(),
        getAllTeams(),
        getAllCustomers({ limit: 10000 }) // Increase limit for better caching
      ]);
      
      referenceData = {
        jobNimbusData,
        allUsers,
        allTeams,
        existingCustomers,
        timestamp: Date.now()
      };
      
      cache.set(cacheKey, referenceData);
    }

    if (!Array.isArray(referenceData.jobNimbusData.results)) {
      throw new Error('JobNimbus data is not in the expected format.');
    }

    // 2. CREATE OPTIMIZED LOOKUP MAPS
    const lookupMaps = createLookupMaps(referenceData);

    const BATCH_SIZE = 200; // Increased batch size for better performance
    const processedCustomers = [];
    const errors = [];
    const commissionsToProcess = [];

    // 3. PROCESS CUSTOMERS IN OPTIMIZED BATCHES
    for (let i = 0; i < referenceData.jobNimbusData.results.length; i += BATCH_SIZE) {
      const batch = referenceData.jobNimbusData.results.slice(i, i + BATCH_SIZE);
      
      // Process customer data transformation in parallel
      const customerData = await Promise.all(
        batch.map(job => processJobNimbusCustomerOptimized(job, lookupMaps))
      );
      
      // 4. BULK UPSERT CUSTOMERS using model method
      const upsertedCustomers = await modelBulkUpsert(customerData.filter(Boolean));
      
      // 5. COLLECT FINALIZED CUSTOMERS FOR COMMISSION PROCESSING
      const finalizedCustomers = upsertedCustomers.filter(customer => 
        customer && customer.status === 'Finalized'
      );
      
      commissionsToProcess.push(...finalizedCustomers);
      processedCustomers.push(...upsertedCustomers);
    }

    // 6. BULK PROCESS ALL COMMISSIONS
    if (commissionsToProcess.length > 0) {
      await bulkProcessCommissions(commissionsToProcess, lookupMaps.userIdMap, lookupMaps.teamMap, errors, client);
    }

    await client.query('COMMIT');
    
    // Clear cache after successful sync
    cache.delete('reference_data');
    
    logger.info(`Optimized sync completed. Processed ${processedCustomers.length} customers. ${errors.length} errors.`);
    
    return res.status(errors.length > 0 ? 207 : 200).json({
      message: 'Optimized sync completed',
      customersProcessed: processedCustomers.length,
      commissionsProcessed: commissionsToProcess.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined // Limit error output
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Optimized sync failed:', error);
    cache.delete('reference_data'); // Clear cache on error
    next(error);
  } finally {
    client.release();
  }
};

/**
 * OPTIMIZED: Create lookup maps for O(1) access
 */
const createLookupMaps = ({ allUsers, allTeams, existingCustomers }) => {
  return {
    userNameMap: new Map(allUsers.map(user => [user.name.toLowerCase(), user])),
    userIdMap: new Map(allUsers.map(user => [user.id, user])),
    teamMap: new Map(allTeams.map(team => [team.user_id, team])),
    existingCustomerMap: new Map(existingCustomers.map(customer => [customer.customer_name.toLowerCase(), customer]))
  };
};

/**
 * OPTIMIZED customer processing using lookup maps
 */
const processJobNimbusCustomerOptimized = (job, lookupMaps) => {
  try {
    // Use case-insensitive lookups
    const salesman = lookupMaps.userNameMap.get(job['sales_rep_name']?.toLowerCase()) || null;
    const supplementer = lookupMaps.userNameMap.get(job['Supplementer Assigned']?.toLowerCase()) || null;
    const referrer = job.source_name === 'Affiliate' ? 
      lookupMaps.userNameMap.get(job['Affiliate Name']?.toLowerCase()) || null : null;

    // Get manager IDs efficiently
    const managerId = salesman ? getManagerId(salesman.id, lookupMaps.teamMap) : null;
    const supplementManagerId = supplementer ? getManagerId(supplementer.id, lookupMaps.teamMap) : null;

    return {
      name: job.name?.trim(),
      address: job.address_line1?.trim(),
      phone: job.parent_mobile_phone?.trim(),
      salesman_id: salesman?.id || null,
      supplementer_id: supplementer?.id || null,
      manager_id: managerId,
      supplement_manager_id: supplementManagerId,
      status: job.status_name?.trim() || 'Lead',
      initial_scope_price: parseFloat(job['Initial Scope Price']) || null,
      total_job_price: parseFloat(job['Final Job Price']) || null,
      lead_source: job.source_name?.trim(),
      referrer_id: referrer?.id || null,
      build_date: job['Build Date'] ? new Date(job['Build Date'] * 1000) : null,
    };
  } catch (error) {
    logger.error('Error processing JobNimbus customer:', error);
    return null;
  }
};

/**
 * Helper to get manager ID from team map
 */
const getManagerId = (userId, teamMap) => {
  const team = teamMap.get(userId);
  return (team && team.manager_id !== userId) ? team.manager_id : null;
};

/**
 * OPTIMIZED: Bulk process commissions with better error handling
 */
const bulkProcessCommissions = async (customers, userIdMap, teamMap, errors, client) => {
  try {
    // 1. GET EXISTING COMMISSIONS IN BULK
    const customerIds = customers.map(c => c.id);
    const existingResult = await client.query(
      `SELECT customer_id, user_id, id, commission_amount, admin_modified 
       FROM commissions_due 
       WHERE customer_id = ANY($1)`,
      [customerIds]
    );
    
    const existingCommissionsMap = new Map();
    existingResult.rows.forEach(commission => {
      const key = `${commission.customer_id}_${commission.user_id}`;
      existingCommissionsMap.set(key, commission);
    });

    // 2. PREPARE COMMISSION CALCULATIONS
    const commissionTasks = [];
    
    for (const customer of customers) {
      const userRoles = [
        { id: customer.salesman_id, role: 'Salesman' },
        { id: customer.supplementer_id, role: 'Supplementer' },
        { id: customer.manager_id, role: 'Sales Manager' },
        { id: customer.supplement_manager_id, role: 'Supplement Manager' },
        { id: customer.referrer_id, role: 'Affiliate Marketer' }
      ].filter(role => role.id && userIdMap.has(role.id));

      for (const { id: userId, role } of userRoles) {
        const existingCommission = existingCommissionsMap.get(`${customer.id}_${userId}`);
        
        // Skip admin-modified commissions
        if (existingCommission?.admin_modified) continue;

        commissionTasks.push({
          customerId: customer.id,
          userId,
          role,
          customer,
          user: userIdMap.get(userId),
          team: teamMap.get(userId),
          existingCommission,
          buildDate: customer.build_date || new Date()
        });
      }
    }

    // 3. CALCULATE COMMISSIONS IN PARALLEL BATCHES
    const CALC_BATCH_SIZE = 100;
    const commissionsToCreate = [];
    const commissionsToUpdate = [];
    const balanceUpdates = new Map();

    for (let i = 0; i < commissionTasks.length; i += CALC_BATCH_SIZE) {
      const batch = commissionTasks.slice(i, i + CALC_BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(async (task) => {
          const team = task.role.includes('Manager') ? task.team : null;
          const commissionAmount = await calculateCommission(task.user, task.customer, team);
          const numericAmount = parseFloat(commissionAmount) || 0;
          
          if (numericAmount <= 0) return null;

          if (task.existingCommission) {
            const oldAmount = parseFloat(task.existingCommission.commission_amount) || 0;
            const difference = numericAmount - oldAmount;
            
            if (Math.abs(difference) > 0.01) { // Only update if significant difference
              commissionsToUpdate.push({
                id: task.existingCommission.id,
                commission_amount: numericAmount,
                build_date: task.buildDate
              });
              
              const currentBalance = balanceUpdates.get(task.userId) || 0;
              balanceUpdates.set(task.userId, currentBalance + difference);
            }
          } else {
            commissionsToCreate.push({
              user_id: task.userId,
              customer_id: task.customerId,
              commission_amount: numericAmount,
              build_date: task.buildDate,
              admin_modified: false
            });
            
            const currentBalance = balanceUpdates.get(task.userId) || 0;
            balanceUpdates.set(task.userId, currentBalance + numericAmount);
          }
          
          return task;
        })
      );

      // Handle failed calculations
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const task = batch[index];
          logger.error(`Commission calculation failed for user ${task.userId}:`, result.reason);
          errors.push({
            type: 'commission_calculation',
            userId: task.userId,
            customerId: task.customerId,
            error: result.reason.message
          });
        }
      });
    }

    // 4. EXECUTE BULK OPERATIONS
    await Promise.all([
      commissionsToCreate.length > 0 ? bulkInsertCommissions(commissionsToCreate, client) : Promise.resolve(),
      commissionsToUpdate.length > 0 ? bulkUpdateCommissions(commissionsToUpdate, client) : Promise.resolve(),
      balanceUpdates.size > 0 ? bulkUpdateUserBalances(balanceUpdates, client) : Promise.resolve()
    ]);

    logger.info(`Processed ${commissionsToCreate.length} new commissions, ${commissionsToUpdate.length} updates`);
    
  } catch (error) {
    logger.error('Bulk commission processing error:', error);
    throw error;
  }
};

/**
 * OPTIMIZED: Bulk insert commissions with single query
 */
const bulkInsertCommissions = async (commissions, client) => {
  if (commissions.length === 0) return;

  const values = [];
  const placeholders = [];
  
  commissions.forEach((comm, index) => {
    const baseIndex = index * 5;
    placeholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}::NUMERIC, $${baseIndex + 4}::TIMESTAMP, $${baseIndex + 5}::BOOLEAN)`);
    values.push(
      comm.user_id,
      comm.customer_id,
      comm.commission_amount,
      comm.build_date,
      comm.admin_modified
    );
  });

  const query = `
    INSERT INTO commissions_due (user_id, customer_id, commission_amount, build_date, admin_modified, created_at, updated_at)
    VALUES ${placeholders.join(', ')}
  `;

  await client.query(query, values);
};

/**
 * OPTIMIZED: Bulk update commissions with single query
 */
const bulkUpdateCommissions = async (commissions, client) => {
  if (commissions.length === 0) return;

  const updates = commissions.map((_, i) => 
    `($${i*3 + 1}::INTEGER, $${i*3 + 2}::NUMERIC, $${i*3 + 3}::TIMESTAMP)`
  ).join(', ');

  const values = commissions.flatMap(comm => [
    comm.id, 
    comm.commission_amount, 
    comm.build_date
  ]);

  const query = `
    UPDATE commissions_due SET
      commission_amount = updates.commission_amount,
      build_date = updates.build_date,
      updated_at = CURRENT_TIMESTAMP
    FROM (VALUES ${updates}) AS updates(id, commission_amount, build_date)
    WHERE commissions_due.id = updates.id
  `;

  await client.query(query, values);
};

/**
 * OPTIMIZED: Bulk update user balances with upsert
 */
const bulkUpdateUserBalances = async (balanceUpdates, client) => {
  if (balanceUpdates.size === 0) return;

  const userIds = Array.from(balanceUpdates.keys());
  
  // Ensure balance records exist
  await client.query(`
    INSERT INTO user_balance (user_id, total_commissions_earned, total_payments_received, current_balance)
    SELECT id, 0, 0, 0 FROM users WHERE id = ANY($1)
    ON CONFLICT (user_id) DO NOTHING
  `, [userIds]);

  // Bulk update balances
  const updates = Array.from(balanceUpdates.entries());
  const updateValues = updates.map((_, i) => 
    `($${i*2 + 1}::INTEGER, $${i*2 + 2}::NUMERIC)`
  ).join(', ');

  const values = updates.flatMap(([userId, amount]) => [userId, amount]);

  await client.query(`
    UPDATE user_balance SET
      total_commissions_earned = total_commissions_earned + updates.amount,
      current_balance = current_balance + updates.amount,
      last_updated = CURRENT_TIMESTAMP
    FROM (VALUES ${updateValues}) AS updates(user_id, amount)
    WHERE user_balance.user_id = updates.user_id
  `, values);
};

/**
 * STREAMLINED: Get all customers with optional filtering
 */
const getCustomers = async (req, res, next) => {
  try {
    const { status, limit = 1000, offset = 0 } = req.query;
    const options = { status, limit: parseInt(limit), offset: parseInt(offset) };
    
    const customers = await getAllCustomers(options);
    res.status(200).json(customers);
  } catch (error) {
    next(error);
  }
};

/**
 * STREAMLINED: Search customers with validation
 */
const searchCustomers = async (req, res, next) => {
  try {
    const { q: query, userId, includeAll } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    if (query.length < 2) {
      return res.json([]);
    }

    const options = { 
      limit: 20, 
      includeAll: includeAll === 'true' 
    };

    const customers = await searchCustomersByQuery(query, userId, options);
    res.status(200).json(customers);
  } catch (error) {
    next(error);
  }
};

/**
 * STREAMLINED: Get customer by ID
 */
const getCustomer = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const customer = await getCustomerById(parseInt(customerId));

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.status(200).json(customer);
  } catch (error) {
    next(error);
  }
};

/**
 * STREAMLINED: Delete customer
 */
const deleteCustomerController = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const deletedCustomer = await deleteCustomer(parseInt(customerId));

    if (!deletedCustomer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.status(200).json({ 
      message: 'Customer deleted successfully', 
      deletedCustomer 
    });
  } catch (error) {
    next(error);
  }
};

/**
 * OPTIMIZED: Recalculate customer commissions
 */
const recalculateCustomerCommissions = async (req, res, next) => {
  const client = await db.connect();
  
  try {
    const { customerId } = req.params;

    // Authorization check
    if (!['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Unauthorized. Only admin or owner can recalculate commissions.' 
      });
    }

    const customer = await getCustomerById(parseInt(customerId));
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    if (customer.status !== 'Finalized') {
      return res.status(400).json({ 
        error: 'Customer status must be Finalized to calculate commissions.',
        customer: customer
      });
    }

    await client.query('BEGIN');

    // Delete existing commissions and update balances
    await client.query(`
      UPDATE user_balance 
      SET total_commissions_earned = total_commissions_earned - cd.commission_amount,
          current_balance = current_balance - cd.commission_amount
      FROM commissions_due cd 
      WHERE cd.customer_id = $1 AND user_balance.user_id = cd.user_id
    `, [customerId]);

    await client.query('DELETE FROM commissions_due WHERE customer_id = $1', [customerId]);

    // Process new commissions
    const errors = [];
    const lookupMaps = createLookupMaps({
      allUsers: await getAllUsers(),
      allTeams: await getAllTeams(),
      existingCustomers: []
    });

    await bulkProcessCommissions([customer], lookupMaps.userIdMap, lookupMaps.teamMap, errors, client);

    await client.query('COMMIT');

    // Get updated commissions
    const commissionsResult = await db.query(`
      SELECT cd.*, u.name as user_name, u.role 
      FROM commissions_due cd
      JOIN users u ON cd.user_id = u.id
      WHERE cd.customer_id = $1
    `, [customerId]);

    res.status(200).json({
      message: 'Commissions recalculated successfully',
      customer: customer,
      commissions: commissionsResult.rows,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`Error recalculating commissions for customer ${req.params.customerId}:`, error);
    next(error);
  } finally {
    client.release();
  }
};

/**
 * OPTIMIZED: Add customer to JobNimbus
 */
const addCustomerToJobNimbus = async (req, res, next) => {
  try {
    const {
      firstName, lastName, phone, email, address, city, state, zip,
      leadSource, referrer, description
    } = req.body;

    // Validation
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }

    logger.info('Adding customer to JobNimbus:', { firstName, lastName, email, leadSource });

    const customerData = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      mobile_phone: phone?.trim(),
      email: email?.trim(),
      address_line1: address?.trim(),
      city: city?.trim(),
      state_text: state?.trim(),
      zip: zip?.trim(),
      record_type_name: "Customer",
      status_name: "New",
      source_name: leadSource || "Website",
      "Who Referred?": referrer?.trim() || null,
      description: description?.trim() || null,
      is_lead: true,
      country_name: "United States"
    };

    const response = await axios({
      method: 'post',
      url: 'https://app.jobnimbus.com/api1/contacts',
      headers: {
        'Authorization': `Bearer ${process.env.JOBNIMBUSTOKEN}`,
        'Content-Type': 'application/json'
      },
      data: customerData,
      timeout: 10000 // 10 second timeout
    });

    res.status(201).json({
      message: 'Customer added successfully',
      customer: response.data
    });

  } catch (error) {
    if (error.response) {
      logger.error('JobNimbus API error:', error.response.data);
      return res.status(error.response.status).json({
        error: 'Failed to add customer to JobNimbus',
        details: error.response.data
      });
    }
    
    logger.error('Error adding customer to JobNimbus:', error.message);
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