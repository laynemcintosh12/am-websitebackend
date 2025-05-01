const express = require('express');
const router = express.Router();
const CommissionController = require('../controllers/commissionController');

// ==========================================
// Commission Due Routes
// ==========================================

// Get commissions due for current user
router.get('/commissions', CommissionController.getUserCommissions);

// Get all commissions due (admin only)
router.get('/commissions/all', CommissionController.getAllCommissions);

// Get specific commission due by id
router.get('/commissions/:id', CommissionController.getCommissionById);

// Add a new commission due record (admin only)
router.post('/commissions', CommissionController.addCommission);

// Update a commission due record (admin only)
router.put('/commissions/:id', CommissionController.updateCommission);

// Delete a commission due record (admin only)
router.delete('/commissions/:id', CommissionController.deleteCommission);

// ==========================================
// Payment Routes
// ==========================================

// Get payments for current user
router.get('/payments', CommissionController.getUserPayments);

// Get all payments (admin only)
router.get('/payments/all', CommissionController.getAllPayments);

// Add a new payment (admin only)
router.post('/payments', CommissionController.addPayment);

// Get payment details including commission mappings
router.get('/payments/:paymentId/details', CommissionController.getPaymentDetails);

// ==========================================
// Balance Routes
// ==========================================

// Get balance for current user
router.get('/balance', CommissionController.getUserBalance);

// Get all user balances (admin only)
router.get('/balance/all', CommissionController.getAllUserBalances);

// ==========================================
// Reports & Summaries Routes
// ==========================================

// Get commission summary for current user (with optional date filtering)
router.get('/summary', CommissionController.getUserCommissionSummary);

// Get commission summary for all users (admin only)
router.get('/summary/all', CommissionController.getAllCommissionSummary);

// ==========================================
// Customer Finalization Route
// ==========================================

// Process customer finalization and generate commissions (called from customer controller)
router.post('/process-customer/:customerId', CommissionController.processCustomerFinalized);

// Calculate potential commissions for multiple customers
router.post('/commissions/calculate-potential', CommissionController.calculatePotentialCommission);

module.exports = router;