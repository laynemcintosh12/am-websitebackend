/**
 * Customer Model
 * Handles all database interactions for customer records
 * Includes commission and user relationship management
 */

const pool = require('../config/db');

/**
 * Creates or updates a customer record
 * Maintains unique constraint on customer_name
 * Updates all fields and timestamps
 * @param {Object} customer - Customer data object
 * @returns {Object} Created or updated customer record
 */
const upsertCustomer = async (customer) => {
  const query = `
    WITH current_status AS (
      SELECT status, status_changed 
      FROM customers 
      WHERE customer_name = $1::VARCHAR
    )
    INSERT INTO customers (
      customer_name, address, phone, salesman_id, supplementer_id, 
      manager_id, supplement_manager_id, status, initial_scope_price, 
      total_job_price, lead_source, referrer_id, build_date, last_updated_at,
      status_changed
    )
    VALUES (
      $1::VARCHAR, $2, $3, $4, $5, $6, $7, $8::VARCHAR, $9, $10, $11, $12, $13, 
      CURRENT_TIMESTAMP,
      CASE 
        WHEN $8::VARCHAR != COALESCE((SELECT status FROM current_status), $8::VARCHAR)
        THEN CURRENT_TIMESTAMP 
        ELSE COALESCE((SELECT status_changed FROM current_status), CURRENT_TIMESTAMP)
      END
    )
    ON CONFLICT (customer_name) 
    DO UPDATE SET
      address = EXCLUDED.address,
      phone = EXCLUDED.phone,
      salesman_id = EXCLUDED.salesman_id,
      supplementer_id = EXCLUDED.supplementer_id,
      manager_id = EXCLUDED.manager_id,
      supplement_manager_id = EXCLUDED.supplement_manager_id,
      status = EXCLUDED.status::VARCHAR,
      initial_scope_price = EXCLUDED.initial_scope_price,
      total_job_price = EXCLUDED.total_job_price,
      lead_source = EXCLUDED.lead_source,
      referrer_id = EXCLUDED.referrer_id,
      build_date = EXCLUDED.build_date,
      last_updated_at = CURRENT_TIMESTAMP,
      status_changed = CASE 
        WHEN EXCLUDED.status::VARCHAR != customers.status
        THEN CURRENT_TIMESTAMP 
        ELSE customers.status_changed
      END
    RETURNING *;
  `;

  // Ensure all values are properly formatted
  const values = [
    String(customer.name || ''), // Ensure customer_name is a string
    customer.address || null,
    customer.phone || null,
    customer.salesman_id || null,
    customer.supplementer_id || null,
    customer.manager_id || null,
    customer.supplement_manager_id || null,
    String(customer.status || ''), // Ensure status is a string
    customer.initial_scope_price || null,
    customer.total_job_price || null,
    customer.lead_source || null,
    customer.referrer_id || null,
    customer.build_date || null
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
};

/**
 * Retrieves all customers with related data
 * Includes user associations and commission information
 * @returns {Array} All customers with related data
 */
const getAllCustomers = async () => {
  const query = `
    SELECT 
      c.*,
      u1.name as salesman_name,
      u2.name as supplementer_name,
      u3.name as manager_name,
      u4.name as supplement_manager_name,
      (
        SELECT json_agg(
          json_build_object(
            'id', cd.id,
            'commission_amount', cd.commission_amount,
            'is_paid', cd.is_paid,
            'user_id', cd.user_id
          )
        )
        FROM commissions_due cd
        WHERE cd.customer_id = c.id
      ) as commissions
    FROM customers c
    LEFT JOIN users u1 ON c.salesman_id = u1.id
    LEFT JOIN users u2 ON c.supplementer_id = u2.id
    LEFT JOIN users u3 ON c.manager_id = u3.id
    LEFT JOIN users u4 ON c.supplement_manager_id = u4.id
    ORDER BY c.created_at DESC;
  `;
  const result = await pool.query(query);
  return result.rows;
};

/**
 * Searches customers by query string and user association
 * Filters by user roles (salesman, supplementer, etc.)
 * Limits results for performance
 * @param {string} query - Search term
 * @param {number} userId - User performing the search
 * @returns {Array} Matching customer records
 */
const searchCustomersByQuery = async (query, userId) => {
  const searchQuery = `
    SELECT * FROM customers
    WHERE (
      LOWER(customer_name) ILIKE LOWER($1) 
      OR LOWER(address) ILIKE LOWER($1) 
      OR phone ILIKE $1
    )
    AND (
      salesman_id = $2 
      OR supplementer_id = $2 
      OR manager_id = $2 
      OR supplement_manager_id = $2
      OR referrer_id = $2
    )
    ORDER BY last_updated_at DESC
    LIMIT 5;
  `;
  const values = [`%${query}%`, userId];
  const result = await pool.query(searchQuery, values);
  return result.rows;
};

/**
 * Retrieves single customer by ID
 * Used for detailed customer views
 * @param {number} id - Customer ID
 * @returns {Object} Customer record if found
 */
const getCustomerById = async (id) => {
  const query = `
    SELECT * FROM customers
    WHERE id = $1;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0];
};

/**
 * Removes customer record and related data
 * Cascades deletion to commission records
 * @param {number} id - Customer ID to delete
 * @returns {Object} Deleted customer record
 */
const deleteCustomer = async (id) => {
  const query = `
    DELETE FROM customers
    WHERE id = $1
    RETURNING *;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0];
};

module.exports = {
  upsertCustomer,
  getAllCustomers,
  searchCustomersByQuery,
  getCustomerById,
  deleteCustomer,
};