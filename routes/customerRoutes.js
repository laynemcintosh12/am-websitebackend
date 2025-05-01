/**
 * Customer Routes
 * Defines API endpoints for customer operations
 * Includes sync, retrieval, and management endpoints
 */

const express = require('express');
const router = express.Router();
const { 
    syncCustomers, 
    getCustomers, 
    searchCustomers, 
    getCustomer, 
    deleteCustomerController,
    addCustomerToJobNimbus
} = require('../controllers/customerController');

/**
 * Customer Synchronization
 * POST /api/customers/sync
 * Syncs customer data from JobNimbus
 * Updates commission records for finalized customers
 * Returns sync results and any errors
 */
router.post('/sync', syncCustomers);

/**
 * Customer Retrieval
 * GET /api/customers
 * Returns all customers with related data
 * Includes user associations and commission info
 */
router.get('/', getCustomers);

/**
 * Customer Search
 * GET /api/customers/search?q={query}&userId={userId}
 * Searches customers by name, address, or phone
 * Filters by user association
 * Returns limited results
 */
router.get('/search', searchCustomers);

/**
 * Single Customer Retrieval
 * GET /api/customers/:customerId
 * Returns detailed customer record
 * Includes all related data and status
 */
router.get('/:customerId', getCustomer);

/**
 * Customer Deletion
 * DELETE /api/customers/:customerId
 * Removes customer and related records
 * Maintains database integrity
 */
router.delete('/:customerId', deleteCustomerController);

/**
 * Add Customer to JobNimbus
 * POST /api/customers/jobnimbus
 * Creates customer in JobNimbus CRM
 * Returns created customer data
 */
router.post('/jobnimbus', addCustomerToJobNimbus);

module.exports = router;