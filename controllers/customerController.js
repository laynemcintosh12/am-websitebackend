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
      
      // Optional: Verify team relationships for debugging
      if (process.env.NODE_ENV === 'development') {
        verifyTeamRelationships(allTeams, allUsers);
      }
      
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

    // 2. CREATE OPTIMIZED LOOKUP MAPS with manager relationships
    const lookupMaps = createLookupMaps(referenceData);

    // Log lookup map sizes for debugging
    console.log('Lookup maps created:', {
      users: lookupMaps.userNameMap.size,
      salesmanToManager: lookupMaps.salesmanToManagerMap.size,
      supplementerToManager: lookupMaps.supplementerToManagerMap.size,
      teams: lookupMaps.teamMap.size
    });

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
      managerRelationshipsProcessed: {
        salesmanToManager: lookupMaps.salesmanToManagerMap.size,
        supplementerToManager: lookupMaps.supplementerToManagerMap.size
      },
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
 * OPTIMIZED customer processing using lookup maps and jnid
 */
const processJobNimbusCustomerOptimized = (job, lookupMaps) => {
  try {
    // Use case-insensitive lookups
    const salesman = lookupMaps.userNameMap.get(job['sales_rep_name']?.toLowerCase()) || null;
    const supplementer = lookupMaps.userNameMap.get(job['Supplementer Assigned']?.toLowerCase()) || null;
    const referrer = job.source_name === 'Affiliate' ? 
      lookupMaps.userNameMap.get(job['Affiliate Name']?.toLowerCase()) || null : null;

    // Get manager IDs efficiently using the new lookup maps
    const managerId = salesman ? lookupMaps.salesmanToManagerMap.get(salesman.id) || null : null;
    const supplementManagerId = supplementer ? lookupMaps.supplementerToManagerMap.get(supplementer.id) || null : null;

    console.log('Manager lookup for customer:', job.name, {
      salesmanId: salesman?.id,
      salesmanName: salesman?.name,
      managerId,
      supplementerId: supplementer?.id,
      supplementerName: supplementer?.name,
      supplementManagerId
    });

    // Process the appraisal field - handle various possible formats from JobNimbus
    let goingToAppraisal = false;
    const appraisalField = job['In Appraisal?'] || job['in appraisal?'] || job['In appraisal?'] || job['IN APPRAISAL?'];
    
    console.log('Processing customer:', job.name, 'jnid:', job.jnid, 'appraisalField:', appraisalField, 'type:', typeof appraisalField);
    
    if (appraisalField !== undefined && appraisalField !== null) {
      if (typeof appraisalField === 'boolean') {
        goingToAppraisal = appraisalField;
      } else if (typeof appraisalField === 'string') {
        goingToAppraisal = appraisalField.toLowerCase() === 'true' || 
                          appraisalField.toLowerCase() === 'yes' || 
                          appraisalField === '1';
      } else if (typeof appraisalField === 'number') {
        goingToAppraisal = appraisalField === 1;
      }
    }

    console.log('Final goingToAppraisal value:', goingToAppraisal);

    // Process the date_created field from JobNimbus
    let jnDateAdded = null;
    if (job.date_created) {
      try {
        // Convert Unix timestamp to JavaScript Date
        jnDateAdded = new Date(job.date_created * 1000);
        if (isNaN(jnDateAdded.getTime())) {
          throw new Error('Invalid date format');
        }
      } catch (error) {
        console.error('Error converting date_created for customer:', job.name, error);
        // Fallback to current date instead of null
        jnDateAdded = new Date();
      }
    }

    return {
      jnid: job.jnid?.toString(), // Convert to string and add jnid as primary identifier
      name: job.name?.trim(),
      address: job.address_line1?.trim(),
      phone: job.parent_mobile_phone?.trim(),
      salesman_id: salesman?.id || null,
      supplementer_id: supplementer?.id || null,
      manager_id: managerId, // Now properly populated based on team relationships
      supplement_manager_id: supplementManagerId, // Now properly populated based on team relationships
      status: job.status_name?.trim() || 'Lead',
      initial_scope_price: parseFloat(job['Initial Scope Price']) || null,
      total_job_price: parseFloat(job['Final Job Price']) || null,
      lead_source: job.source_name?.trim(),
      referrer_id: referrer?.id || null,
      build_date: job['Build Date'] ? new Date(job['Build Date'] * 1000) : null,
      going_to_appraisal: goingToAppraisal,
      jn_date_added: jnDateAdded // Add the new field
    };
  } catch (error) {
    logger.error('Error processing JobNimbus customer:', error);
    return null;
  }
};

/**
 * OPTIMIZED: Create lookup maps for O(1) access using jnid
 */
const createLookupMaps = ({ allUsers, allTeams, existingCustomers }) => {
  // Create team maps for efficient manager lookups
  const salesmanToManagerMap = new Map();
  const supplementerToManagerMap = new Map();
  
  // Build efficient lookups for team relationships
  allTeams.forEach(team => {
    // Map each salesman to their manager
    if (team.salesman_ids && Array.isArray(team.salesman_ids)) {
      team.salesman_ids.forEach(salesmanId => {
        salesmanToManagerMap.set(salesmanId, team.manager_id);
      });
    }
    
    // Map each supplementer to their manager
    if (team.supplementer_ids && Array.isArray(team.supplementer_ids)) {
      team.supplementer_ids.forEach(supplementerId => {
        supplementerToManagerMap.set(supplementerId, team.manager_id);
      });
    }
  });

  return {
    userNameMap: new Map(allUsers.map(user => [user.name.toLowerCase(), user])),
    userIdMap: new Map(allUsers.map(user => [user.id, user])),
    teamMap: new Map(allTeams.map(team => [team.manager_id, team])),
    salesmanToManagerMap,
    supplementerToManagerMap,
    // Change to use jnid instead of customer_name for lookups
    existingCustomerByJnidMap: new Map(
      existingCustomers
        .filter(customer => customer.jnid) // Only customers with jnid
        .map(customer => [customer.jnid, customer])
    ),
    existingCustomerByNameMap: new Map(
      existingCustomers.map(customer => [customer.customer_name.toLowerCase(), customer])
    )
  };
};

/**
 * Helper to get manager ID from team map - Updated to handle different team types
 */
const getManagerId = (userId, teamMap) => {
  if (!userId) return null;
  
  const team = teamMap.get(userId);
  if (!team) return null;
  
  // Only return manager_id if the user is not the manager themselves
  return (team.manager_id && team.manager_id !== userId) ? team.manager_id : null;
};

/**
 * Helper to get sales manager ID specifically
 */
const getSalesManagerId = (salesmanId, teamMap) => {
  if (!salesmanId) return null;
  
  // Find team where this user is a salesman
  for (const [userId, team] of teamMap) {
    if (team.salesman_ids && team.salesman_ids.includes(salesmanId)) {
      return team.manager_id;
    }
  }
  return null;
};

/**
 * Helper to get supplement manager ID specifically
 */
const getSupplementManagerId = (supplementerId, teamMap) => {
  if (!supplementerId) return null;
  
  // Find team where this user is a supplementer
  for (const [userId, team] of teamMap) {
    if (team.supplementer_ids && team.supplementer_ids.includes(supplementerId)) {
      return team.manager_id;
    }
  }
  return null;
};

/**
 * Helper function to verify and log team relationships for debugging
 */
const verifyTeamRelationships = (allTeams, allUsers) => {
  console.log('=== Team Relationships Verification ===');
  
  allTeams.forEach(team => {
    const manager = allUsers.find(user => user.id === team.manager_id);
    console.log(`Team: ${team.team_name} (${team.team_type})`);
    console.log(`  Manager: ${manager?.name || 'Unknown'} (ID: ${team.manager_id})`);
    
    if (team.salesman_ids && team.salesman_ids.length > 0) {
      console.log(`  Salesmen:`);
      team.salesman_ids.forEach(id => {
        const salesman = allUsers.find(user => user.id === id);
        console.log(`    - ${salesman?.name || 'Unknown'} (ID: ${id})`);
      });
    }
    
    if (team.supplementer_ids && team.supplementer_ids.length > 0) {
      console.log(`  Supplementers:`);
      team.supplementer_ids.forEach(id => {
        const supplementer = allUsers.find(user => user.id === id);
        console.log(`    - ${supplementer?.name || 'Unknown'} (ID: ${id})`);
      });
    }
    console.log('');
  });
  
  console.log('=== End Team Relationships ===');
};

/**
 * OPTIMIZED: Bulk process commissions with historical team data
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

    // 2. PREPARE COMMISSION CALCULATIONS WITH HISTORICAL CONTEXT
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
          team: teamMap.get(userId), // This will be replaced with historical data in calculateCommission
          existingCommission,
          buildDate: customer.build_date || new Date()
        });
      }
    }

    // 3. CALCULATE COMMISSIONS IN PARALLEL BATCHES WITH HISTORICAL DATA
    const CALC_BATCH_SIZE = 100;
    const commissionsToCreate = [];
    const commissionsToUpdate = [];
    const balanceUpdates = new Map();

    for (let i = 0; i < commissionTasks.length; i += CALC_BATCH_SIZE) {
      const batch = commissionTasks.slice(i, i + CALC_BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(async (task) => {
          // Pass null for team - calculateCommission will fetch historical team data
          // Pass useHistoricalData = true to enable historical team lookup
          const commissionAmount = await calculateCommission(
            task.user, 
            task.customer, 
            null, // Let calculateCommission fetch historical data
            true  // Use historical data
          );
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

    // 4. EXECUTE BULK OPERATIONS (same as before)
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
 * OPTIMIZED: Bulk insert commissions with database defaults - RECOMMENDED
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

  // Let database handle created_at and updated_at with DEFAULT values
  const query = `
    INSERT INTO commissions_due (user_id, customer_id, commission_amount, build_date, admin_modified)
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