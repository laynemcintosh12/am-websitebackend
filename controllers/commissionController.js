const CommissionModel = require('../models/commissionModel');
const commissionService = require('../services/commissionService');
const { getUserDetailsById } = require('../controllers/userController');
const { getTeamByUserIdFromDb } = require('../models/teamModel');  // Updated import
const { getCustomerById } = require('../models/customerModel');  // Updated import
const db = require('../config/db');

// Cache for frequently accessed data
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutes

// Helper function to get from cache or fetch
const getCachedOrFetch = async (key, fetchFunction, ttl = CACHE_TTL) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  
  const data = await fetchFunction();
  cache.set(key, { data, timestamp: Date.now() });
  return data;
};

const CommissionController = {
  // Get commissions due for the current user
  getUserCommissions: async (req, res) => {
    try {
      // Get userId from either auth or query params
      const userId = req.user?.id || req.query.user_id;
      
      if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
      }

      const commissions = await CommissionModel.getCommissionsDueByUserId(userId);
      res.status(200).json(commissions);
    } catch (error) {
      console.error('Error getting user commissions:', error);
      res.status(500).json({ message: 'Server error retrieving commissions', error: error.message });
    }
  },

  // Get all commissions due (admin only)
  getAllCommissions: async (req, res) => {
    try {
      
      const commissions = await CommissionModel.getAllCommissionsDue();
      res.status(200).json(commissions);
    } catch (error) {
      console.error('Error getting all commissions:', error);
      res.status(500).json({ message: 'Server error retrieving all commissions', error: error.message });
    }
  },

  // Get specific commission due by id
  getCommissionById: async (req, res) => {
    try {
      const { id } = req.params;
      const commission = await CommissionModel.getCommissionDueById(id);
      
      if (!commission) {
        return res.status(404).json({ message: 'Commission not found' });
      }
      
      res.status(200).json(commission);
    } catch (error) {
      console.error('Error getting commission by ID:', error);
      res.status(500).json({ message: 'Server error retrieving commission', error: error.message });
    }
  },

  // Add a new commission due record
  addCommission: async (req, res) => {
    try {
      
      const commissionData = req.body;
      const newCommission = await CommissionModel.addCommissionDue(commissionData);
      
      // Update user balance
      await updateUserBalanceOnCommissionChange(commissionData.user_id, commissionData.commission_amount);
      
      res.status(201).json(newCommission);
    } catch (error) {
      console.error('Error adding commission:', error);
      res.status(500).json({ message: 'Server error adding commission', error: error.message });
    }
  },

  // Update a commission due record
  updateCommission: async (req, res) => {
    try {
      
      const { id } = req.params;
      const commissionData = req.body;
      
      // Get the original commission to calculate difference
      const originalCommission = await CommissionModel.getCommissionDueById(id);
      if (!originalCommission) {
        return res.status(404).json({ message: 'Commission not found' });
      }
      
      const updatedCommission = await CommissionModel.updateCommissionDue(id, commissionData);
      
      // Calculate difference for balance update
      const amountDifference = commissionData.commission_amount - originalCommission.commission_amount;
      
      // Only update balance if amount changed
      if (amountDifference !== 0) {
        await updateUserBalanceOnCommissionChange(originalCommission.user_id, amountDifference);
      }
      
      res.status(200).json(updatedCommission);
    } catch (error) {
      console.error('Error updating commission:', error);
      res.status(500).json({ message: 'Server error updating commission', error: error.message });
    }
  },

  // Delete a commission due record
  deleteCommission: async (req, res) => {
    try {

      const { id } = req.params;
      
      // Get the commission first to adjust balance
      const commission = await CommissionModel.getCommissionDueById(id);
      if (!commission) {
        return res.status(404).json({ message: 'Commission not found' });
      }
      
      await CommissionModel.deleteCommissionDue(id);
      
      // Update user balance by subtracting the commission amount
      await updateUserBalanceOnCommissionChange(commission.user_id, -commission.commission_amount);
      
      res.status(200).json({ message: 'Commission deleted successfully' });
    } catch (error) {
      console.error('Error deleting commission:', error);
      res.status(500).json({ message: 'Server error deleting commission', error: error.message });
    }
  },

  // Get user payments
  getUserPayments: async (req, res) => {
    try {
      const userId = req.user.id;
      const payments = await CommissionModel.getPaymentsByUserId(userId);
      res.status(200).json(payments);
    } catch (error) {
      console.error('Error getting user payments:', error);
      res.status(500).json({ message: 'Server error retrieving payments', error: error.message });
    }
  },

  // Get all payments (admin only)
  getAllPayments: async (req, res) => {
    try {
      const payments = await CommissionModel.getAllPayments();
      res.status(200).json(payments);
    } catch (error) {
      console.error('Error getting all payments:', error);
      res.status(500).json({ message: 'Server error retrieving all payments', error: error.message });
    }
  },

  // Add a new payment
  addPayment: async (req, res) => {
    try {
      const paymentData = req.body;
      const newPayment = await CommissionModel.addPayment(paymentData);
      
      // Only attempt commission mapping if commission_due_ids are provided
      if (paymentData.commission_due_ids && Array.isArray(paymentData.commission_due_ids)) {
        // Use Promise.all for parallel processing
        const mappingPromises = paymentData.commission_due_ids.map(async (commissionId) => {
          const commission = await CommissionModel.getCommissionDueById(commissionId);
          if (commission) {
            return CommissionModel.addPaymentCommissionMapping({
              payment_id: newPayment.id,
              commission_due_id: commissionId,
              amount_applied: commission.commission_amount
            });
          }
        });
        
        await Promise.all(mappingPromises.filter(Boolean));
      }
      
      res.status(201).json(newPayment);
    } catch (error) {
      console.error('Error adding payment:', error);
      res.status(500).json({ message: 'Server error adding payment', error: error.message });
    }
  },

  // Update a payment
  updatePayment: async (req, res) => {
    try {
      const { id } = req.params;
      const paymentData = req.body;

      // Validate required fields
      if (!paymentData.amount || !paymentData.payment_type) {
        return res.status(400).json({ message: 'Amount and payment type are required' });
      }

      const updatedPayment = await CommissionModel.updatePayment(id, paymentData);
      
      if (!updatedPayment) {
        return res.status(404).json({ message: 'Payment not found' });
      }

      res.status(200).json(updatedPayment);
    } catch (error) {
      console.error('Error updating payment:', error);
      res.status(500).json({ message: 'Server error updating payment', error: error.message });
    }
  },

  // Delete a payment
  deletePayment: async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get the payment first to adjust balance
      const payment = await CommissionModel.getPaymentById(id);
      if (!payment) {
        return res.status(404).json({ message: 'Payment not found' });
      }
      
      // Delete the payment (this will also handle balance adjustment)
      await CommissionModel.deletePayment(id);
      
      res.status(200).json({ message: 'Payment deleted successfully' });
    } catch (error) {
      console.error('Error deleting payment:', error);
      res.status(500).json({ message: 'Server error deleting payment', error: error.message });
    }
  },

  // Get user balance
  getUserBalance: async (req, res) => {
    try {
      const userId = req.user.id;
      const balance = await CommissionModel.getUserBalance(userId);
      res.status(200).json(balance);
    } catch (error) {
      console.error('Error getting user balance:', error);
      res.status(500).json({ message: 'Server error retrieving balance', error: error.message });
    }
  },

  // Get all user balances (admin only) - with caching
  getAllUserBalances: async (req, res) => {
    try {
      
      const balances = await getCachedOrFetch(
        'all_user_balances',
        () => CommissionModel.getAllUserBalances(),
        60000 // 1 minute cache for frequently accessed data
      );
      res.status(200).json(balances);
    } catch (error) {
      console.error('Error getting all user balances:', error);
      res.status(500).json({ message: 'Server error retrieving all balances', error: error.message });
    }
  },

  // Process customer status change to "Finalized" and create commissions
  processCustomerFinalized: async (req, res) => {
    try {
      const { customerId } = req.params;
      const { buildDate } = req.body;
      
      // Update commissions on customer finalized - this returns customer and user data
      const customerData = await CommissionModel.updateCommissionsOnCustomerFinalized(customerId, buildDate);
      
      // Calculate commissions for all associated users using commission service
      const result = await commissionService.calculateCommissions(customerData);
      
      // Create commission records for each user
      // Use Promise.all for parallel commission creation
      const commissionPromises = result.commissions.map(async (commission) => {
        const newCommission = await CommissionModel.addCommissionDue({
          user_id: commission.userId,
          customer_id: customerId,
          commission_amount: commission.amount,
          build_date: buildDate
        });
        
        // Update user balance
        await updateUserBalanceOnCommissionChange(commission.userId, commission.amount);
        return newCommission;
      });
      
      await Promise.all(commissionPromises);
      
      res.status(200).json({ message: 'Commissions processed successfully', data: result });
    } catch (error) {
      console.error('Error processing customer finalization:', error);
      res.status(500).json({ message: 'Server error processing customer finalization', error: error.message });
    }
  },

  // Get monthly/yearly commission summary for a user
  getUserCommissionSummary: async (req, res) => {
    try {
      // Get userId from either auth token or query params
      const userId = req.user?.id || req.query.user_id;
      
      if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
      }

      const { startDate, endDate } = req.query;
      
      // Validate dates or use defaults
      const validStartDate = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
      const validEndDate = endDate ? new Date(endDate) : new Date();
      
      const summary = await CommissionModel.getCommissionSummaryByUser(
        userId, 
        validStartDate, 
        validEndDate
      );
      
      res.status(200).json(summary);
    } catch (error) {
      console.error('Error getting user commission summary:', error);
      res.status(500).json({ 
        message: 'Server error retrieving commission summary', 
        error: error.message 
      });
    }
  },

  // Get all users' commission summary (admin only)
  getAllCommissionSummary: async (req, res) => {
    try {
      
      const { startDate, endDate } = req.query;
      
      // Validate dates or use defaults
      const validStartDate = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1); // Jan 1 of current year
      const validEndDate = endDate ? new Date(endDate) : new Date(); // Today
      
      const summary = await CommissionModel.getAllCommissionSummary(
        validStartDate, 
        validEndDate
      );
      
      res.status(200).json(summary);
    } catch (error) {
      console.error('Error getting all commission summary:', error);
      res.status(500).json({ message: 'Server error retrieving all commission summary', error: error.message });
    }
  },

  // Get payment-commission mapping details
  getPaymentDetails: async (req, res) => {
    try {
      const { paymentId } = req.params;
      const mappings = await CommissionModel.getPaymentCommissionMapping(paymentId);
      
      res.status(200).json(mappings);
    } catch (error) {
      console.error('Error getting payment details:', error);
      res.status(500).json({ message: 'Server error retrieving payment details', error: error.message });
    }
  },

  // OPTIMIZED: Calculate potential commission for customer(s) without saving to database
  calculatePotentialCommission: async (req, res) => {
    try {
      const userId = req.body.user_id || req.user?.id || req.query.user_id;
      
      if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
      }
      
      const { customerIds } = req.body;
      
      if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
        return res.status(400).json({ message: 'At least one customer ID is required' });
      }
      
      // Use caching for user and team data that doesn't change often
      const [user, customers, team] = await Promise.all([
        getCachedOrFetch(`user_${userId}`, () => getUserDetailsById(userId), 120000), // 2 min cache
        CommissionModel.getCustomersByIds(customerIds), // Don't cache customer data as it changes
        getCachedOrFetch(`team_${userId}`, () => getTeamByUserIdFromDb(userId).catch(() => null), 300000) // 5 min cache
      ]);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Create a map for O(1) customer lookups
      const customerMap = new Map(customers.map(customer => [customer.id, customer]));
      
      // Process in smaller batches for better performance
      const BATCH_SIZE = 20;
      const allCommissions = [];
      
      for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
        const batch = customerIds.slice(i, i + BATCH_SIZE);
        
        const batchPromises = batch.map(async (customerId) => {
          try {
            const customer = customerMap.get(customerId);
            
            if (!customer) {
              return {
                customerId,
                error: 'Customer not found',
                amount: 0
              };
            }
            
            const commissionAmount = await commissionService.calculateCommission(user, customer, team);
            
            return {
              customerId,
              customerName: customer.customer_name || customer.name,
              customerStatus: customer.status,
              amount: commissionAmount,
              jobPrice: customer.total_job_price || 0,
              initialScopePrice: customer.initial_scope_price || 0
            };
            
          } catch (customerError) {
            console.error(`Error calculating potential commission for customer ${customerId}:`, customerError);
            return {
              customerId,
              error: customerError.message,
              amount: 0
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        allCommissions.push(...batchResults);
      }

      res.status(200).json({
        userId,
        userName: user.name,
        userRole: user.role,
        potentialCommissions: allCommissions
      });
      
    } catch (error) {
      console.error('Error calculating potential commissions:', error);
      res.status(500).json({ 
        message: 'Server error calculating potential commissions', 
        error: error.message 
      });
    }
  },

  // High-performance batch version for calculating many potential commissions
  calculatePotentialCommissionsBatch: async (req, res) => {
    try {
      const { userIds, customerIds } = req.body;
      
      if (!userIds || !customerIds || userIds.length === 0 || customerIds.length === 0) {
        return res.status(400).json({ message: 'User IDs and customer IDs are required' });
      }
      
      // BULK FETCH ALL DATA UPFRONT
      const [users, customers, teams] = await Promise.all([
        CommissionModel.getUsersByIds(userIds),
        CommissionModel.getCustomersByIds(customerIds),
        CommissionModel.getTeamsByUserIds(userIds)
      ]);
      
      // Create lookup maps for O(1) access
      const userMap = new Map(users.map(user => [user.id, user]));
      const customerMap = new Map(customers.map(customer => [customer.id, customer]));
      const teamMap = new Map(teams.map(team => [team.user_id, team]));
      
      // Process all combinations efficiently
      const results = [];
      const BATCH_SIZE = 50; // Process in batches to avoid memory issues
      
      for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const userBatch = userIds.slice(i, i + BATCH_SIZE);
        
        const batchPromises = userBatch.map(async (userId) => {
          const user = userMap.get(userId);
          if (!user) return null;
          
          const team = teamMap.get(userId);
          const userCommissions = [];
          
          // Calculate commissions for all customers for this user
          const customerPromises = customerIds.map(async (customerId) => {
            const customer = customerMap.get(customerId);
            if (!customer) return null;
            
            try {
              const commissionAmount = await commissionService.calculateCommission(user, customer, team);
              return {
                customerId,
                customerName: customer.customer_name,
                amount: commissionAmount
              };
            } catch (error) {
              return {
                customerId,
                error: error.message,
                amount: 0
              };
            }
          });
          
          const customerCommissions = await Promise.all(customerPromises);
          
          return {
            userId,
            userName: user.name,
            userRole: user.role,
            commissions: customerCommissions.filter(Boolean)
          };
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(Boolean));
      }

      res.status(200).json({
        results,
        totalUsers: userIds.length,
        totalCustomers: customerIds.length
      });
      
    } catch (error) {
      console.error('Error calculating batch potential commissions:', error);
      res.status(500).json({ 
        message: 'Server error calculating batch potential commissions', 
        error: error.message 
      });
    }
  }
};

// Optimized helper function with better error handling
async function updateUserBalanceOnCommissionChange(userId, amountChange) {
  try {
    // Use upsert pattern to handle missing balance records
    await db.query(
      `INSERT INTO user_balance (user_id, total_commissions_earned, total_payments_received, current_balance, last_updated)
       VALUES ($2, $1, 0, $1, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) 
       DO UPDATE SET
         total_commissions_earned = user_balance.total_commissions_earned + $1,
         current_balance = user_balance.current_balance + $1,
         last_updated = CURRENT_TIMESTAMP`,
      [amountChange, userId]
    );
    
    // Clear cache for this user's balance
    cache.delete('all_user_balances');
    cache.delete(`user_balance_${userId}`);
    
    return true;
  } catch (error) {
    console.error('Error updating user balance:', error);
    throw error;
  }
}

module.exports = {
  ...CommissionController,
  updateUserBalanceOnCommissionChange
};