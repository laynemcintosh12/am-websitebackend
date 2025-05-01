const db = require('../config/db');

const CommissionModel = {
  // Get all commissions due for a specific user
  getCommissionsDueByUserId: async (userId) => {
    try {
      const result = await db.query(
        `SELECT cd.*, c.customer_name, c.build_date 
         FROM commissions_due cd
         JOIN customers c ON cd.customer_id = c.id
         WHERE cd.user_id = $1
         ORDER BY cd.created_at DESC`,
        [userId]
      );
      return result.rows;
    } catch (error) {
      throw error;
    }
  },

  // Get all commissions due (admin only)
  getAllCommissionsDue: async () => {
    try {
      const result = await db.query(
        `SELECT cd.*, c.customer_name, u.name as user_name, u.role, c.build_date
         FROM commissions_due cd
         JOIN customers c ON cd.customer_id = c.id
         JOIN users u ON cd.user_id = u.id
         ORDER BY cd.created_at DESC`
      );
      return result.rows;
    } catch (error) {
      throw error;
    }
  },

  // Get specific commission due by id
  getCommissionDueById: async (commissionId) => {
    try {
      const result = await db.query(
        `SELECT cd.*, c.customer_name, u.name as user_name, c.build_date
         FROM commissions_due cd
         JOIN customers c ON cd.customer_id = c.id
         JOIN users u ON cd.user_id = u.id
         WHERE cd.id = $1`,
        [commissionId]
      );
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  },

  // Add a new commission due record
  addCommissionDue: async (commissionData) => {
    const { user_id, customer_id, commission_amount, build_date } = commissionData;
    try {
      const result = await db.query(
        `INSERT INTO commissions_due 
         (user_id, customer_id, commission_amount, build_date, updated_at) 
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING *`,
        [user_id, customer_id, commission_amount, build_date]
      );
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  },

  // Update a commission due record
  updateCommissionDue: async (commissionId, commissionData) => {
    const { commission_amount, is_paid, build_date } = commissionData;
    try {
      const result = await db.query(
        `UPDATE commissions_due 
         SET commission_amount = $1, 
             is_paid = $2, 
             build_date = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 
         RETURNING *`,
        [commission_amount, is_paid, build_date, commissionId]
      );
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  },

  // Delete a commission due record
  deleteCommissionDue: async (commissionId) => {
    try {
      await db.query('DELETE FROM commissions_due WHERE id = $1', [commissionId]);
      return true;
    } catch (error) {
      throw error;
    }
  },

  // Get all payments for a specific user
  getPaymentsByUserId: async (userId) => {
    try {
      const result = await db.query(
        `SELECT * FROM payments 
         WHERE user_id = $1 
         ORDER BY payment_date DESC`,
        [userId]
      );
      return result.rows;
    } catch (error) {
      throw error;
    }
  },

  // Get all payments (admin only)
  getAllPayments: async () => {
    try {
      const result = await db.query(
        `SELECT p.*, u.name as user_name 
         FROM payments p
         JOIN users u ON p.user_id = u.id
         ORDER BY p.payment_date DESC`
      );
      return result.rows;
    } catch (error) {
      throw error;
    }
  },

  // Add a new payment
  addPayment: async (paymentData) => {
    const { user_id, amount, payment_type, check_number, payment_date, notes } = paymentData;
    try {
      const result = await db.query(
        `INSERT INTO payments 
         (user_id, amount, payment_type, check_number, payment_date, notes) 
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [user_id, amount, payment_type, check_number, payment_date || 'CURRENT_TIMESTAMP', notes]
      );
      
      // Update user_balance
      await db.query(
        `UPDATE user_balance 
         SET total_payments_received = total_payments_received + $1,
             current_balance = total_commissions_earned - (total_payments_received + $1),
             last_updated = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [amount, user_id]
      );
      
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  },

  // Get user balance
  getUserBalance: async (userId) => {
    try {
      const result = await db.query(
        `SELECT * FROM user_balance WHERE user_id = $1`,
        [userId]
      );
      
      // If user balance doesn't exist, create one
      if (result.rows.length === 0) {
        const newBalance = await db.query(
          `INSERT INTO user_balance 
           (user_id, total_commissions_earned, total_payments_received, current_balance) 
           VALUES ($1, 0, 0, 0)
           RETURNING *`,
          [userId]
        );
        return newBalance.rows[0];
      }
      
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  },

  // Get all user balances (admin only)
  getAllUserBalances: async () => {
    try {
      const result = await db.query(
        `SELECT ub.*, u.name as user_name, u.role, u.yearly_goal
         FROM user_balance ub
         JOIN users u ON ub.user_id = u.id
         ORDER BY u.name ASC`
      );
      return result.rows;
    } catch (error) {
      throw error;
    }
  },

  // Update commissions_due when customer status changes to "Finalized"
  updateCommissionsOnCustomerFinalized: async (customerId, buildDate) => {
    try {
      // Get customer details
      const customerResult = await db.query(
        `SELECT * FROM customers WHERE id = $1`,
        [customerId]
      );
      
      const customer = customerResult.rows[0];
      
      if (!customer) {
        throw new Error('Customer not found');
      }
      
      // Get all associated users
      const userIds = [];
      
      if (customer.salesman_id) userIds.push(customer.salesman_id);
      if (customer.supplementer_id) userIds.push(customer.supplementer_id);
      if (customer.manager_id) userIds.push(customer.manager_id);
      if (customer.supplement_manager_id) userIds.push(customer.supplement_manager_id);
      if (customer.referrer_id) userIds.push(customer.referrer_id);
      
      // We'll assume commissionService is imported elsewhere and called as needed
      // This is a placeholder for the connection to that service
      return {
        customerId,
        userIds,
        buildDate
      };
    } catch (error) {
      throw error;
    }
  },

  // Get monthly/yearly commission summaries for a user
  getCommissionSummaryByUser: async (userId, startDate, endDate) => {
    try {
      const result = await db.query(
        `SELECT 
          EXTRACT(YEAR FROM build_date) as year,
          EXTRACT(MONTH FROM build_date) as month,
          SUM(commission_amount) as total_commission
         FROM commissions_due
         WHERE user_id = $1
           AND build_date BETWEEN $2 AND $3
         GROUP BY year, month
         ORDER BY year DESC, month DESC`,
        [userId, startDate, endDate]
      );
      return result.rows;
    } catch (error) {
      throw error;
    }
  },
  
  // Get monthly/yearly commission summaries for all users (admin only)
  getAllCommissionSummary: async (startDate, endDate) => {
    try {
      const result = await db.query(
        `SELECT 
          user_id,
          u.name as user_name,
          u.role,
          EXTRACT(YEAR FROM cd.build_date) as year,
          EXTRACT(MONTH FROM cd.build_date) as month,
          SUM(commission_amount) as total_commission
         FROM commissions_due cd
         JOIN users u ON cd.user_id = u.id
         WHERE cd.build_date BETWEEN $1 AND $2
         GROUP BY user_id, u.name, u.role, year, month
         ORDER BY user_name ASC, year DESC, month DESC`,
        [startDate, endDate]
      );
      return result.rows;
    } catch (error) {
      throw error;
    }
  },

  // Get payment-commission mapping
  getPaymentCommissionMapping: async (paymentId) => {
    try {
      const result = await db.query(
        `SELECT pcm.*, cd.commission_amount, c.customer_name
         FROM payment_commission_mapping pcm
         JOIN commissions_due cd ON pcm.commission_due_id = cd.id
         JOIN customers c ON cd.customer_id = c.id
         WHERE pcm.payment_id = $1`,
        [paymentId]
      );
      return result.rows;
    } catch (error) {
      throw error;
    }
  },
  
  // Add payment-commission mapping
  addPaymentCommissionMapping: async (mappingData) => {
    const { payment_id, commission_due_id, amount_applied } = mappingData;
    try {
      const result = await db.query(
        `INSERT INTO payment_commission_mapping 
         (payment_id, commission_due_id, amount_applied) 
         VALUES ($1, $2, $3)
         RETURNING *`,
        [payment_id, commission_due_id, amount_applied]
      );
      
      // Update commission due status
      await db.query(
        `UPDATE commissions_due 
         SET is_paid = true,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [commission_due_id]
      );
      
      return result.rows[0];
    } catch (error) {
      throw error;
    }
  },

  // Check existing commissions for a customer
  checkExistingCommissions: async (customerId) => {
    try {
      const result = await db.query(
        `SELECT cd.*, u.name as user_name, u.role
         FROM commissions_due cd
         JOIN users u ON cd.user_id = u.id
         WHERE cd.customer_id = $1`,
        [customerId]
      );
      return result.rows;
    } catch (error) {
      throw error;
    }
  }
};

module.exports = CommissionModel;