const db = require('../config/db');

const CommissionModel = {
  // COMMISSION METHODS - Optimized with better error handling
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
      console.error('Error in getCommissionsDueByUserId:', error);
      throw error;
    }
  },

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
      console.error('Error in getAllCommissionsDue:', error);
      throw error;
    }
  },

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
      console.error('Error in getCommissionDueById:', error);
      throw error;
    }
  },

  addCommissionDue: async (commissionData) => {
    const { 
      user_id, 
      customer_id, 
      commission_amount, 
      build_date, 
      admin_modified = false,
      is_paid = false
    } = commissionData;
    
    try {
      const result = await db.query(
        `INSERT INTO commissions_due 
         (user_id, customer_id, commission_amount, build_date, admin_modified, is_paid, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         RETURNING *`,
        [user_id, customer_id, commission_amount, build_date, admin_modified, is_paid]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in addCommissionDue:', error);
      throw error;
    }
  },

  updateCommissionDue: async (commissionId, commissionData) => {
    const { commission_amount, is_paid, build_date, admin_modified } = commissionData;
    try {
      const result = await db.query(
        `UPDATE commissions_due 
         SET commission_amount = $1, 
             is_paid = $2, 
             build_date = $3,
             admin_modified = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5 
         RETURNING *`,
        [commission_amount, is_paid, build_date, admin_modified, commissionId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in updateCommissionDue:', error);
      throw error;
    }
  },

  deleteCommissionDue: async (commissionId) => {
    try {
      const result = await db.query('DELETE FROM commissions_due WHERE id = $1 RETURNING *', [commissionId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error in deleteCommissionDue:', error);
      throw error;
    }
  },

  // PAYMENT METHODS - Optimized and streamlined
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
      console.error('Error in getPaymentsByUserId:', error);
      throw error;
    }
  },

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
      console.error('Error in getAllPayments:', error);
      throw error;
    }
  },

  // OPTIMIZED: Simplified payment creation with upsert pattern
  addPayment: async (paymentData) => {
    const { user_id, amount, payment_type, check_number, payment_date, notes } = paymentData;
    
    try {
      // Format date properly
      const formattedDate = typeof payment_date === 'string' && payment_date.includes('T')
        ? payment_date.split('T')[0]
        : payment_date;

      // Upsert user balance and add payment in single transaction
      await db.query('BEGIN');

      // Ensure user_balance exists (upsert pattern)
      await db.query(
        `INSERT INTO user_balance (user_id, total_commissions_earned, total_payments_received, current_balance)
         VALUES ($1, 0, 0, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [user_id]
      );

      // Add payment
      const paymentResult = await db.query(
        `INSERT INTO payments 
         (user_id, amount, payment_type, check_number, payment_date, notes) 
         VALUES ($1, $2, $3, $4, $5::date, $6)
         RETURNING *`,
        [user_id, amount, payment_type, check_number, formattedDate, notes]
      );

      // Update balance atomically
      await db.query(
        `UPDATE user_balance 
         SET total_payments_received = total_payments_received + $1,
             current_balance = total_commissions_earned - (total_payments_received + $1),
             last_updated = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [amount, user_id]
      );

      await db.query('COMMIT');
      return paymentResult.rows[0];
      
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Error in addPayment:', error);
      throw error;
    }
  },

  // OPTIMIZED: Simplified payment update
  updatePayment: async (paymentId, paymentData) => {
    const { amount, payment_type, check_number, notes } = paymentData;
    
    try {
      await db.query('BEGIN');

      // Get original amount and update in single query
      const originalResult = await db.query(
        `UPDATE payments 
         SET amount = $2, payment_type = $3, check_number = $4, notes = $5
         WHERE id = $1
         RETURNING *, (SELECT amount FROM payments WHERE id = $1) as old_amount, user_id`,
        [paymentId, amount, payment_type, check_number, notes]
      );

      if (originalResult.rows.length === 0) {
        throw new Error('Payment not found');
      }

      const { user_id, old_amount } = originalResult.rows[0];
      const amountDifference = amount - (old_amount || 0);

      // Update balance only if amount changed
      if (amountDifference !== 0) {
        await db.query(
          `UPDATE user_balance 
           SET total_payments_received = total_payments_received + $1,
               current_balance = current_balance - $1,
               last_updated = CURRENT_TIMESTAMP
           WHERE user_id = $2`,
          [amountDifference, user_id]
        );
      }

      await db.query('COMMIT');
      return originalResult.rows[0];
      
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Error in updatePayment:', error);
      throw error;
    }
  },

  getPaymentById: async (paymentId) => {
    try {
      const result = await db.query(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error in getPaymentById:', error);
      throw error;
    }
  },

  // OPTIMIZED: Parallel deletion with proper transaction handling
  deletePayment: async (paymentId) => {
    try {
      await db.query('BEGIN');

      // Get payment details first - this will fail if payment doesn't exist
      const checkResult = await db.query(
        `SELECT amount, user_id FROM payments WHERE id = $1`,
        [paymentId]
      );

      if (checkResult.rows.length === 0) {
        await db.query('ROLLBACK');
        throw new Error('Payment not found or already deleted');
      }

      const { amount, user_id } = checkResult.rows[0];

      // Delete payment and mappings in parallel
      const [paymentResult] = await Promise.all([
        db.query(`DELETE FROM payments WHERE id = $1 RETURNING *`, [paymentId]),
        db.query(`DELETE FROM payment_commission_mapping WHERE payment_id = $1`, [paymentId])
      ]);

      // Update balance only if payment was actually deleted
      if (paymentResult.rows.length > 0) {
        await db.query(
          `UPDATE user_balance 
           SET total_payments_received = total_payments_received - $1,
               current_balance = current_balance + $1,
               last_updated = CURRENT_TIMESTAMP
           WHERE user_id = $2`,
          [amount, user_id]
        );
      }

      await db.query('COMMIT');
      return paymentResult.rows[0];
      
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Error in deletePayment:', error);
      throw error;
    }
  },

  // BALANCE METHODS - Optimized with upsert patterns
  getUserBalance: async (userId) => {
    try {
      // Use upsert to ensure balance record exists
      const result = await db.query(
        `INSERT INTO user_balance (user_id, total_commissions_earned, total_payments_received, current_balance)
         VALUES ($1, 0, 0, 0)
         ON CONFLICT (user_id) 
         DO UPDATE SET last_updated = CURRENT_TIMESTAMP
         RETURNING *`,
        [userId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in getUserBalance:', error);
      throw error;
    }
  },

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
      console.error('Error in getAllUserBalances:', error);
      throw error;
    }
  },

  // OPTIMIZED: Streamlined customer finalization
  updateCommissionsOnCustomerFinalized: async (customerId, buildDate) => {
    try {
      const result = await db.query(
        `SELECT id, customer_name, salesman_id, supplementer_id, manager_id, 
                supplement_manager_id, referrer_id, total_job_price, initial_scope_price
         FROM customers WHERE id = $1`,
        [customerId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Customer not found');
      }
      
      const customer = result.rows[0];
      
      // Extract user IDs efficiently
      const userIds = [
        customer.salesman_id,
        customer.supplementer_id, 
        customer.manager_id,
        customer.supplement_manager_id,
        customer.referrer_id
      ].filter(Boolean);
      
      return { customer, userIds, buildDate };
    } catch (error) {
      console.error('Error in updateCommissionsOnCustomerFinalized:', error);
      throw error;
    }
  },

  // OPTIMIZED: Single query summaries
  getCommissionSummaryByUser: async (userId, startDate, endDate) => {
    try {
      const result = await db.query(
        `SELECT 
          DATE_TRUNC('month', build_date) as month_year,
          EXTRACT(YEAR FROM build_date) as year,
          EXTRACT(MONTH FROM build_date) as month,
          COUNT(*) as commission_count,
          SUM(commission_amount) as total_commission,
          AVG(commission_amount) as avg_commission
         FROM commissions_due
         WHERE user_id = $1 AND build_date BETWEEN $2 AND $3
         GROUP BY month_year, year, month
         ORDER BY year DESC, month DESC`,
        [userId, startDate, endDate]
      );
      return result.rows;
    } catch (error) {
      console.error('Error in getCommissionSummaryByUser:', error);
      throw error;
    }
  },
  
  getAllCommissionSummary: async (startDate, endDate) => {
    try {
      const result = await db.query(
        `SELECT 
          cd.user_id,
          u.name as user_name,
          u.role,
          DATE_TRUNC('month', cd.build_date) as month_year,
          EXTRACT(YEAR FROM cd.build_date) as year,
          EXTRACT(MONTH FROM cd.build_date) as month,
          COUNT(*) as commission_count,
          SUM(cd.commission_amount) as total_commission,
          AVG(cd.commission_amount) as avg_commission
         FROM commissions_due cd
         JOIN users u ON cd.user_id = u.id
         WHERE cd.build_date BETWEEN $1 AND $2
         GROUP BY cd.user_id, u.name, u.role, month_year, year, month
         ORDER BY u.name ASC, year DESC, month DESC`,
        [startDate, endDate]
      );
      return result.rows;
    } catch (error) {
      console.error('Error in getAllCommissionSummary:', error);
      throw error;
    }
  },

  // MAPPING METHODS - Optimized with joins
  getPaymentCommissionMapping: async (paymentId) => {
    try {
      const result = await db.query(
        `SELECT pcm.*, cd.commission_amount, c.customer_name, u.name as user_name
         FROM payment_commission_mapping pcm
         JOIN commissions_due cd ON pcm.commission_due_id = cd.id
         JOIN customers c ON cd.customer_id = c.id
         JOIN users u ON cd.user_id = u.id
         WHERE pcm.payment_id = $1`,
        [paymentId]
      );
      return result.rows;
    } catch (error) {
      console.error('Error in getPaymentCommissionMapping:', error);
      throw error;
    }
  },
  
  addPaymentCommissionMapping: async (mappingData) => {
    const { payment_id, commission_due_id, amount_applied } = mappingData;
    try {
      await db.query('BEGIN');

      // Add mapping and update commission status in parallel
      const [mappingResult] = await Promise.all([
        db.query(
          `INSERT INTO payment_commission_mapping 
           (payment_id, commission_due_id, amount_applied) 
           VALUES ($1, $2, $3) RETURNING *`,
          [payment_id, commission_due_id, amount_applied]
        ),
        db.query(
          `UPDATE commissions_due 
           SET is_paid = true, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [commission_due_id]
        )
      ]);

      await db.query('COMMIT');
      return mappingResult.rows[0];
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Error in addPaymentCommissionMapping:', error);
      throw error;
    }
  },

  // BULK METHODS - For performance optimization
  checkExistingCommissions: async (customerId) => {
    try {
      const result = await db.query(
        `SELECT cd.*, u.name as user_name, u.role, cd.admin_modified
         FROM commissions_due cd
         JOIN users u ON cd.user_id = u.id
         WHERE cd.customer_id = $1`,
        [customerId]
      );
      return result.rows;
    } catch (error) {
      console.error('Error in checkExistingCommissions:', error);
      throw error;
    }
  },

  getCustomersByIds: async (customerIds) => {
    try {
      if (!customerIds || customerIds.length === 0) {
        return [];
      }

      const result = await db.query(
        `SELECT id, customer_name, status, total_job_price, initial_scope_price,
                salesman_id, supplementer_id, manager_id, supplement_manager_id, 
                referrer_id, build_date, lead_source, address, phone
         FROM customers 
         WHERE id = ANY($1)
         ORDER BY id`,
        [customerIds]
      );
      
      return result.rows;
    } catch (error) {
      console.error('Error in getCustomersByIds:', error);
      throw error;
    }
  },

  getUsersByIds: async (userIds) => {
    try {
      if (!userIds || userIds.length === 0) {
        return [];
      }

      const result = await db.query(
        `SELECT id, name, role, yearly_goal, hire_date
         FROM users 
         WHERE id = ANY($1)
         ORDER BY id`,
        [userIds]
      );
      
      return result.rows;
    } catch (error) {
      console.error('Error in getUsersByIds:', error);
      throw error;
    }
  },

  getTeamsByUserIds: async (userIds) => {
    try {
      if (!userIds || userIds.length === 0) {
        return [];
      }

      const result = await db.query(
        `SELECT user_id, team_id, team_name, team_type, manager_id
         FROM teams 
         WHERE user_id = ANY($1)
         ORDER BY user_id`,
        [userIds]
      );
      
      return result.rows;
    } catch (error) {
      console.error('Error in getTeamsByUserIds:', error);
      throw error;
    }
  }
};

module.exports = CommissionModel;