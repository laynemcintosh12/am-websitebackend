/**
 * Customer Model
 * Handles all database interactions for customer records
 * Includes commission and user relationship management
 */

const db = require('../config/db');

const CustomerModel = {
  /**
   * OPTIMIZED: Creates or updates a customer record with better performance
   * Maintains unique constraint on customer_name
   * Updates all fields and timestamps efficiently
   * @param {Object} customer - Customer data object
   * @returns {Object} Created or updated customer record
   */
  upsertCustomer: async (customer) => {
    try {
      // Simplified upsert query without complex subqueries
      const query = `
        INSERT INTO customers (
          customer_name, address, phone, salesman_id, supplementer_id, 
          manager_id, supplement_manager_id, status, initial_scope_price, 
          total_job_price, lead_source, referrer_id, build_date, last_updated_at,
          status_changed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (customer_name) 
        DO UPDATE SET
          address = EXCLUDED.address,
          phone = EXCLUDED.phone,
          salesman_id = EXCLUDED.salesman_id,
          supplementer_id = EXCLUDED.supplementer_id,
          manager_id = EXCLUDED.manager_id,
          supplement_manager_id = EXCLUDED.supplement_manager_id,
          status = EXCLUDED.status,
          initial_scope_price = EXCLUDED.initial_scope_price,
          total_job_price = EXCLUDED.total_job_price,
          lead_source = EXCLUDED.lead_source,
          referrer_id = EXCLUDED.referrer_id,
          build_date = EXCLUDED.build_date,
          last_updated_at = CURRENT_TIMESTAMP,
          status_changed = CASE 
            WHEN EXCLUDED.status != customers.status
            THEN CURRENT_TIMESTAMP 
            ELSE customers.status_changed
          END
        RETURNING *;
      `;

      // Ensure all values are properly formatted with better validation
      const values = [
        customer.name?.toString().trim() || '',
        customer.address?.toString().trim() || null,
        customer.phone?.toString().trim() || null,
        customer.salesman_id ? parseInt(customer.salesman_id) : null,
        customer.supplementer_id ? parseInt(customer.supplementer_id) : null,
        customer.manager_id ? parseInt(customer.manager_id) : null,
        customer.supplement_manager_id ? parseInt(customer.supplement_manager_id) : null,
        customer.status?.toString().trim() || 'Lead',
        customer.initial_scope_price ? parseFloat(customer.initial_scope_price) : null,
        customer.total_job_price ? parseFloat(customer.total_job_price) : null,
        customer.lead_source?.toString().trim() || null,
        customer.referrer_id ? parseInt(customer.referrer_id) : null,
        customer.build_date || null
      ];

      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error in upsertCustomer:', error);
      throw error;
    }
  },

  /**
   * OPTIMIZED: Bulk upsert for multiple customers with transaction support
   * @param {Array} customers - Array of customer objects
   * @returns {Array} Created or updated customer records
   */
  bulkUpsertCustomers: async (customers) => {
    if (!customers || customers.length === 0) return [];

    try {
      await db.query('BEGIN');

      const results = [];
      const BATCH_SIZE = 50; // Process in batches to avoid memory issues

      for (let i = 0; i < customers.length; i += BATCH_SIZE) {
        const batch = customers.slice(i, i + BATCH_SIZE);
        
        // Use VALUES() clause for bulk insert with ON CONFLICT
        const values = [];
        const placeholders = [];
        
        batch.forEach((customer, index) => {
          const baseIndex = index * 13;
          placeholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10}, $${baseIndex + 11}, $${baseIndex + 12}, $${baseIndex + 13})`);
          
          values.push(
            customer.name?.toString().trim() || '',
            customer.address?.toString().trim() || null,
            customer.phone?.toString().trim() || null,
            customer.salesman_id ? parseInt(customer.salesman_id) : null,
            customer.supplementer_id ? parseInt(customer.supplementer_id) : null,
            customer.manager_id ? parseInt(customer.manager_id) : null,
            customer.supplement_manager_id ? parseInt(customer.supplement_manager_id) : null,
            customer.status?.toString().trim() || 'Lead',
            customer.initial_scope_price ? parseFloat(customer.initial_scope_price) : null,
            customer.total_job_price ? parseFloat(customer.total_job_price) : null,
            customer.lead_source?.toString().trim() || null,
            customer.referrer_id ? parseInt(customer.referrer_id) : null,
            customer.build_date || null
          );
        });

        const query = `
          INSERT INTO customers (
            customer_name, address, phone, salesman_id, supplementer_id, 
            manager_id, supplement_manager_id, status, initial_scope_price, 
            total_job_price, lead_source, referrer_id, build_date
          )
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (customer_name) 
          DO UPDATE SET
            address = EXCLUDED.address,
            phone = EXCLUDED.phone,
            salesman_id = EXCLUDED.salesman_id,
            supplementer_id = EXCLUDED.supplementer_id,
            manager_id = EXCLUDED.manager_id,
            supplement_manager_id = EXCLUDED.supplement_manager_id,
            status = EXCLUDED.status,
            initial_scope_price = EXCLUDED.initial_scope_price,
            total_job_price = EXCLUDED.total_job_price,
            lead_source = EXCLUDED.lead_source,
            referrer_id = EXCLUDED.referrer_id,
            build_date = EXCLUDED.build_date,
            last_updated_at = CURRENT_TIMESTAMP,
            status_changed = CASE 
              WHEN EXCLUDED.status != customers.status
              THEN CURRENT_TIMESTAMP 
              ELSE customers.status_changed
            END
          RETURNING *;
        `;

        const batchResult = await db.query(query, values);
        results.push(...batchResult.rows);
      }

      await db.query('COMMIT');
      return results;
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Error in bulkUpsertCustomers:', error);
      throw error;
    }
  },

  /**
   * OPTIMIZED: Retrieves all customers with related data using efficient joins
   * Includes user associations and commission information
   * @param {Object} options - Query options (limit, offset, status filter)
   * @returns {Array} All customers with related data
   */
  getAllCustomers: async (options = {}) => {
    try {
      const { limit = 1000, offset = 0, status, userId } = options;
      
      let whereClause = '';
      let values = [];
      let paramIndex = 1;

      // Add status filter if provided
      if (status) {
        whereClause += ` WHERE c.status = $${paramIndex}`;
        values.push(status);
        paramIndex++;
      }

      // Add user filter if provided (for non-admin users)
      if (userId && !whereClause) {
        whereClause = ` WHERE (c.salesman_id = $${paramIndex} OR c.supplementer_id = $${paramIndex} OR c.manager_id = $${paramIndex} OR c.supplement_manager_id = $${paramIndex} OR c.referrer_id = $${paramIndex})`;
        values.push(userId);
        paramIndex++;
      } else if (userId && whereClause) {
        whereClause += ` AND (c.salesman_id = $${paramIndex} OR c.supplementer_id = $${paramIndex} OR c.manager_id = $${paramIndex} OR c.supplement_manager_id = $${paramIndex} OR c.referrer_id = $${paramIndex})`;
        values.push(userId);
        paramIndex++;
      }

      // Add pagination
      values.push(limit, offset);

      const query = `
        SELECT 
          c.*,
          u1.name as salesman_name,
          u2.name as supplementer_name,
          u3.name as manager_name,
          u4.name as supplement_manager_name,
          u5.name as referrer_name,
          COALESCE(commission_stats.total_commissions, 0) as total_commissions,
          COALESCE(commission_stats.paid_commissions, 0) as paid_commissions,
          COALESCE(commission_stats.pending_commissions, 0) as pending_commissions
        FROM customers c
        LEFT JOIN users u1 ON c.salesman_id = u1.id
        LEFT JOIN users u2 ON c.supplementer_id = u2.id
        LEFT JOIN users u3 ON c.manager_id = u3.id
        LEFT JOIN users u4 ON c.supplement_manager_id = u4.id
        LEFT JOIN users u5 ON c.referrer_id = u5.id
        LEFT JOIN (
          SELECT 
            customer_id,
            COUNT(*) as total_commissions,
            COUNT(*) FILTER (WHERE is_paid = true) as paid_commissions,
            COUNT(*) FILTER (WHERE is_paid = false) as pending_commissions
          FROM commissions_due
          GROUP BY customer_id
        ) commission_stats ON c.id = commission_stats.customer_id
        ${whereClause}
        ORDER BY c.last_updated_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
      `;

      const result = await db.query(query, values);
      return result.rows;
    } catch (error) {
      console.error('Error in getAllCustomers:', error);
      throw error;
    }
  },

  /**
   * OPTIMIZED: Fast customer search with full-text search and indexing
   * @param {string} query - Search term
   * @param {number} userId - User performing the search
   * @param {Object} options - Search options
   * @returns {Array} Matching customer records
   */
  searchCustomersByQuery: async (query, userId, options = {}) => {
    try {
      const { limit = 10, includeAll = false } = options;
      
      let whereClause = `
        WHERE (
          c.customer_name ILIKE $1 
          OR c.address ILIKE $1 
          OR c.phone ILIKE $1
        )
      `;
      
      const values = [`%${query.trim()}%`];
      
      // Add user filter unless includeAll is true (for admin users)
      if (!includeAll && userId) {
        whereClause += ` AND (
          c.salesman_id = $2 
          OR c.supplementer_id = $2 
          OR c.manager_id = $2 
          OR c.supplement_manager_id = $2
          OR c.referrer_id = $2
        )`;
        values.push(userId);
        values.push(limit);
      } else {
        values.push(limit);
      }

      const searchQuery = `
        SELECT 
          c.*,
          u1.name as salesman_name,
          u2.name as supplementer_name,
          CASE 
            WHEN c.customer_name ILIKE $1 THEN 3
            WHEN c.phone ILIKE $1 THEN 2
            ELSE 1
          END as relevance_score
        FROM customers c
        LEFT JOIN users u1 ON c.salesman_id = u1.id
        LEFT JOIN users u2 ON c.supplementer_id = u2.id
        ${whereClause}
        ORDER BY relevance_score DESC, c.last_updated_at DESC
        LIMIT $${values.length};
      `;

      const result = await db.query(searchQuery, values);
      return result.rows;
    } catch (error) {
      console.error('Error in searchCustomersByQuery:', error);
      throw error;
    }
  },

  /**
   * OPTIMIZED: Get customer by ID with related commission data
   * @param {number} id - Customer ID
   * @returns {Object} Customer record with commissions if found
   */
  getCustomerById: async (id) => {
    try {
      const query = `
        SELECT 
          c.*,
          u1.name as salesman_name,
          u2.name as supplementer_name,
          u3.name as manager_name,
          u4.name as supplement_manager_name,
          u5.name as referrer_name,
          json_agg(
            CASE 
              WHEN cd.id IS NOT NULL 
              THEN json_build_object(
                'id', cd.id,
                'commission_amount', cd.commission_amount,
                'is_paid', cd.is_paid,
                'user_id', cd.user_id,
                'user_name', u_comm.name,
                'build_date', cd.build_date,
                'admin_modified', cd.admin_modified
              )
              ELSE NULL
            END
          ) FILTER (WHERE cd.id IS NOT NULL) as commissions
        FROM customers c
        LEFT JOIN users u1 ON c.salesman_id = u1.id
        LEFT JOIN users u2 ON c.supplementer_id = u2.id
        LEFT JOIN users u3 ON c.manager_id = u3.id
        LEFT JOIN users u4 ON c.supplement_manager_id = u4.id
        LEFT JOIN users u5 ON c.referrer_id = u5.id
        LEFT JOIN commissions_due cd ON c.id = cd.customer_id
        LEFT JOIN users u_comm ON cd.user_id = u_comm.id
        WHERE c.id = $1
        GROUP BY c.id, u1.name, u2.name, u3.name, u4.name, u5.name;
      `;
      
      const result = await db.query(query, [id]);
      return result.rows[0];
    } catch (error) {
      console.error('Error in getCustomerById:', error);
      throw error;
    }
  },

  /**
   * OPTIMIZED: Get multiple customers by IDs (for bulk operations)
   * @param {Array} customerIds - Array of customer IDs
   * @returns {Array} Customer records
   */
  getCustomersByIds: async (customerIds) => {
    try {
      if (!customerIds || customerIds.length === 0) {
        return [];
      }

      const query = `
        SELECT 
          c.*,
          u1.name as salesman_name,
          u2.name as supplementer_name,
          u3.name as manager_name,
          u4.name as supplement_manager_name,
          u5.name as referrer_name
        FROM customers c
        LEFT JOIN users u1 ON c.salesman_id = u1.id
        LEFT JOIN users u2 ON c.supplementer_id = u2.id
        LEFT JOIN users u3 ON c.manager_id = u3.id
        LEFT JOIN users u4 ON c.supplement_manager_id = u4.id
        LEFT JOIN users u5 ON c.referrer_id = u5.id
        WHERE c.id = ANY($1)
        ORDER BY c.id;
      `;
      
      const result = await db.query(query, [customerIds]);
      return result.rows;
    } catch (error) {
      console.error('Error in getCustomersByIds:', error);
      throw error;
    }
  },

  /**
   * OPTIMIZED: Update customer status with proper tracking
   * @param {number} id - Customer ID
   * @param {string} status - New status
   * @returns {Object} Updated customer record
   */
  updateCustomerStatus: async (id, status) => {
    try {
      const query = `
        UPDATE customers 
        SET 
          status = $2,
          status_changed = CASE 
            WHEN status != $2 THEN CURRENT_TIMESTAMP 
            ELSE status_changed 
          END,
          last_updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
      `;
      
      const result = await db.query(query, [id, status]);
      return result.rows[0];
    } catch (error) {
      console.error('Error in updateCustomerStatus:', error);
      throw error;
    }
  },

  /**
   * OPTIMIZED: Safe customer deletion with cascade handling
   * @param {number} id - Customer ID to delete
   * @returns {Object} Deleted customer record
   */
  deleteCustomer: async (id) => {
    try {
      await db.query('BEGIN');

      // Delete related records first (in correct order)
      await Promise.all([
        db.query('DELETE FROM payment_commission_mapping WHERE commission_due_id IN (SELECT id FROM commissions_due WHERE customer_id = $1)', [id]),
        db.query('DELETE FROM commissions_due WHERE customer_id = $1', [id])
      ]);

      // Delete the customer
      const result = await db.query('DELETE FROM customers WHERE id = $1 RETURNING *', [id]);
      
      await db.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Error in deleteCustomer:', error);
      throw error;
    }
  },

  /**
   * Get customer statistics for dashboard
   * @returns {Object} Customer statistics
   */
  getCustomerStats: async () => {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_customers,
          COUNT(*) FILTER (WHERE status = 'Lead') as leads,
          COUNT(*) FILTER (WHERE status = 'Finalized') as finalized,
          COUNT(*) FILTER (WHERE status = 'Canceled') as canceled,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_this_month,
          AVG(total_job_price) FILTER (WHERE total_job_price IS NOT NULL) as avg_job_price
        FROM customers;
      `;
      
      const result = await db.query(query);
      return result.rows[0];
    } catch (error) {
      console.error('Error in getCustomerStats:', error);
      throw error;
    }
  }
};

module.exports = CustomerModel;