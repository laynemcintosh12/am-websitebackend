const CommissionModel = require('../models/commissionModel');
const commissionService = require('../services/commissionService');
const { getUserDetailsById } = require('../controllers/userController');
const { getTeamByUserIdFromDb } = require('../models/teamModel');  // Updated import
const { getCustomerById } = require('../models/customerModel');  // Updated import
const db = require('../config/db');


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
      // This skips mapping for general payments
      if (paymentData.commission_due_ids && Array.isArray(paymentData.commission_due_ids)) {
        for (const commissionId of paymentData.commission_due_ids) {
          const commission = await CommissionModel.getCommissionDueById(commissionId);
          
          console.log("Commission:", commission);
          if (commission) {
            await CommissionModel.addPaymentCommissionMapping({
              payment_id: newPayment.id,
              commission_due_id: commissionId,
              amount_applied: commission.commission_amount
            });
          }
        }
      }
      
      res.status(201).json(newPayment);
    } catch (error) {
      console.error('Error adding payment:', error);
      res.status(500).json({ message: 'Server error adding payment', error: error.message });
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

  // Get all user balances (admin only)
  getAllUserBalances: async (req, res) => {
    try {
      
      const balances = await CommissionModel.getAllUserBalances();
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
      for (const commission of result.commissions) {
        await CommissionModel.addCommissionDue({
          user_id: commission.userId,
          customer_id: customerId,
          commission_amount: commission.amount,
          build_date: buildDate
        });
        
        // Update user balance
        await updateUserBalanceOnCommissionChange(commission.userId, commission.amount);
      }
      
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

  // Add this new method to your CommissionController object

  // Calculate potential commission for customer(s) without saving to database
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
      
      // Get user details using getUserDetailsById
      const user = await getUserDetailsById(userId);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Try to get team information but continue if not found
      let team = null;
      try {
        team = await getTeamByUserIdFromDb(userId);
      } catch (teamError) {
        // Continue without team information
      }
      
      // Calculate potential commissions for each customer
      const potentialCommissions = [];
      
      for (const customerId of customerIds) {
        try {
          // Get customer details - Updated to use getCustomerById
          const customer = await getCustomerById(customerId);
          
          if (!customer) {
            potentialCommissions.push({
              customerId,
              error: 'Customer not found',
              amount: 0
            });
            continue;
          }
          
          // Calculate potential commission using commission service
          const commissionAmount = await commissionService.calculateCommission(user, customer, team);
          
          potentialCommissions.push({
            customerId,
            customerName: customer.customer_name || customer.name,
            customerStatus: customer.status,
            amount: commissionAmount,
            jobPrice: customer.total_job_price || 0,
            initialScopePrice: customer.initial_scope_price || 0
          });
          
        } catch (customerError) {
          console.error(`Error calculating potential commission for customer ${customerId}:`, customerError);
          potentialCommissions.push({
            customerId,
            error: customerError.message,
            amount: 0
          });
        }
      }

      res.status(200).json({
        userId,
        userName: user.name,
        userRole: user.role,
        potentialCommissions
      });
      
    } catch (error) {
      console.error('Error calculating potential commissions:', error);
      res.status(500).json({ 
        message: 'Server error calculating potential commissions', 
        error: error.message 
      });
    }
  }
};

// Helper function to update user balance when commission is added/updated/deleted
async function updateUserBalanceOnCommissionChange(userId, amountChange) {
  try {
    // Get current balance
    const currentBalance = await CommissionModel.getUserBalance(userId);
    
    // Update balance in database
    await db.query(
      `UPDATE user_balance 
       SET total_commissions_earned = total_commissions_earned + $1,
           current_balance = current_balance + $1,
           last_updated = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [amountChange, userId]
    );
    
    return true;
  } catch (error) {
    console.error('Error updating user balance:', error);
    throw error;
  }
  
}

module.exports = {
  ...CommissionController,
  updateUserBalanceOnCommissionChange  // Add this line
};